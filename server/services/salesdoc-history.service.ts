import { randomUUID } from 'node:crypto';
import { db } from '../db/database.ts';
import type { Agent, Customer, CustomerBalanceTransaction, Product, SalesOrder, SalesOrderItem } from '../db/schema.ts';
import type { ExternalSyncOrder } from '../integrations/interfaces.ts';
import { SalesDocAdapter } from '../integrations/adapters/salesdoc.adapter.ts';
import { LinkoAdapter } from '../integrations/adapters/linko.adapter.ts';
import { tagIntegrationRows } from './source-tagging.service.ts';

/** Distribution systems whose order history is loaded month by month (SalesDoc, Linko). */
export type HistoryAdapter = SalesDocAdapter | LinkoAdapter;
import { ForecastService } from './forecast.service.ts';
import { canonicalCustomerCode, computeOrderCogs, isPlausibleCost } from './cogs.ts';
import { inventoryObservation } from './inventory-observation.ts';
import { addDays, businessToday, isValidIsoDate } from '../utils/date.ts';
import { NotificationService } from './notification.service.ts';
import { escapeHtml } from './telegram.service.ts';
import { territoryIdFor } from './territory.ts';

/** One calendar month of SalesDoc orders that was fetched completely. */
export interface HistoryChunk { from: string; to: string; orders: number; skipped: number; synced_at: string }

export interface HistoryState {
  status: 'RUNNING' | 'COMPLETE' | 'PARTIAL' | 'FAILED';
  mode: 'full' | 'recent';
  complete: boolean;           // every month from `from` up to today is loaded
  start: string | null;        // where the business history begins (configured, or found by the empty-month search)
  from: string | null;         // start of the continuously loaded range
  to: string | null;
  first_order: string | null;
  orders: number;              // SalesDoc orders stored locally
  skipped: number;             // orders without customer or date (listed in errors)
  months_total: number;
  months_done: number;
  current: string | null;
  started_at: string;
  synced_at: string | null;
  error: string | null;
  errors: string[];
  chunks: Record<string, HistoryChunk>;
  range_chunks?: Record<string, HistoryChunk>;
  refetch_all?: boolean;       // re-download settled months on the next full run
  agent_mapping_version?: number;
  ledger_synced_to?: string | null; // Linko: customer ledger loaded up to this date (next runs re-read the last week)
  ledger_rows?: number;
}

type OrderStoreIndexes = {
  customers: Map<string, Customer>;
  products: Map<string, Product>;
  ordersByExternal: Map<string, SalesOrder>;
  agentByCode: Map<string, string>;
};

// A month older than this is final in SalesDoc (orders are delivered or cancelled) and is not re-downloaded.
const SETTLED_AFTER_DAYS = 45;
// Without a configured start date, the search goes back until this many empty months in a row.
const EMPTY_MONTHS_TO_STOP = 12;
const OLDEST_MONTH = '2010-01';

const monthKey = (date: string) => date.slice(0, 7);
// Raise when customer cards must be read again right away (e.g. the territory field changed).
const CARDS_VERSION = 3;
const AGENT_MAPPING_VERSION = 1;
const monthStart = (key: string) => `${key}-01`;
function monthEnd(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}
function previousMonth(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
}

/** Thrown inside a run when the user switched the integration off: the run stops between months, nothing is lost. */
class HistoryStopped extends Error {}

export class SalesDocHistoryService {
  private static running = new Set<string>();
  private static stopRequested = new Set<string>();
  private static stockHistoryRunning = new Set<string>();

  static isRunning(integrationId: string) { return this.running.has(integrationId); }

  /**
   * SalesDoc's dated stock endpoint returns a full warehouse snapshot and is rate-limited to one call per five minutes.
   * Walks backwards one warehouse/request at a time, then records the last positive day for currently empty products.
   * Until a positive historical day is found, the app deliberately reports the stock-out date as unknown.
   */
  static async syncSalesDocStockoutHistory(companyId: string, integrationId: string, adapter: SalesDocAdapter, now = Date.now()) {
    if (this.stockHistoryRunning.has(integrationId)) return { skipped: true };
    const integration = db.findById('integrations', integrationId);
    if (!integration || integration.company_id !== companyId || integration.disabled || integration.status !== 'CONNECTED') return { skipped: true };
    const start = isValidIsoDate(integration.config?.history_start_date) ? integration.config.history_start_date : null;
    if (!start) return { skipped: true, reason: 'Tarix boshlanish sanasi belgilanmagan' };
    const today = businessToday();
    const products = db.find('products', p => p.company_id === companyId && p.source_integration_id === integrationId && p.is_active && (Number(p.stock_quantity) || 0) <= 0);
    if (!products.length) return { skipped: true, reason: 'Qoldig‘i 0 mahsulot yo‘q' };
    const currentConfig = integration.config || {};
    let history = currentConfig.stockout_history || {};
    if (history.start_date && history.start_date !== start) history = {};
    const unresolved = () => db.find('products', p => p.company_id === companyId && p.source_integration_id === integrationId && p.is_active && (Number(p.stock_quantity) || 0) <= 0 && !p.stockout_started_at);
    if (history.complete && history.start_date === start) return { skipped: true, complete: true, unresolved: unresolved().length };
    if (unresolved().length === 0) return { skipped: true, complete: true, unresolved: 0 };
    const lastRequest = Date.parse(history.last_request_at || '') || 0;
    if (now - lastRequest < 5 * 60_000) return { skipped: true, reason: 'SalesDoctor tarixiy qoldiq API cheklovi' };

    this.stockHistoryRunning.add(integrationId);
    try {
      const warehouses = Array.isArray(history.warehouses) && history.warehouses.length
        ? history.warehouses as { id: string; name: string }[]
        : await adapter.listWarehouses(integration.config);
      if (!warehouses.length) throw new Error('SalesDoctor omborlari topilmadi; tarixiy qoldiq olinmadi.');
      let date = isValidIsoDate(history.date) ? history.date : addDays(today, -1);
      if (date < start) {
        history = { ...history, start_date: start, complete: true, date, warehouses, finished_at: new Date(now).toISOString() };
        db.update('integrations', integrationId, { config: { ...currentConfig, stockout_history: history } });
        return { skipped: true, complete: true, unresolved: unresolved().length };
      }
      const warehouseIndex = Number.isInteger(history.warehouse_index) ? history.warehouse_index : 0;
      const totals: Record<string, number> = { ...(history.quantities || {}) };
      const last_request_at = new Date(now).toISOString();
      // Save the throttle before the external call so a restart cannot violate SalesDoc's five-minute limit.
      db.update('integrations', integrationId, { config: { ...currentConfig, stockout_history: { ...history, warehouses, date, warehouse_index: warehouseIndex, quantities: totals, last_request_at, complete: false } } });
      const snapshot = await adapter.importStockForDate(integration.config, date, warehouses[warehouseIndex].id);
      for (const item of snapshot) totals[item.sku] = (totals[item.sku] || 0) + (Number(item.quantity) || 0);

      let nextDate = date;
      let nextWarehouseIndex = warehouseIndex + 1;
      let nextTotals = totals;
      let complete = false;
      let resolved = 0;
      if (nextWarehouseIndex >= warehouses.length) {
        const rows: Product[] = [];
        for (const product of unresolved()) {
          const quantity = totals[String(product.sku)] || 0;
          if (quantity > 0) {
            rows.push({ ...product, stockout_started_at: addDays(date, 1), updated_at: new Date(now).toISOString() });
            resolved++;
          }
        }
        if (rows.length) db.upsertMany('products', rows);
        nextDate = addDays(date, -1);
        nextWarehouseIndex = 0;
        nextTotals = {};
        complete = unresolved().length === 0 || nextDate < start;
      }
      const nextHistory = {
        ...history, start_date: start, warehouses, date: nextDate, warehouse_index: nextWarehouseIndex,
        quantities: nextTotals, last_request_at, complete,
        finished_at: complete ? new Date(now).toISOString() : null,
        last_error: null
      };
      db.update('integrations', integrationId, { config: { ...db.findById('integrations', integrationId)!.config, stockout_history: nextHistory } });
      return { skipped: false, date, warehouse: warehouses[warehouseIndex].name, resolved, complete, unresolved: unresolved().length };
    } catch (err: any) {
      const latest = db.findById('integrations', integrationId)!;
      const stockout_history = { ...(latest.config?.stockout_history || history), last_request_at: new Date(now).toISOString(), last_error: String(err?.message || err) };
      db.update('integrations', integrationId, { config: { ...latest.config, stockout_history } });
      console.warn('[SalesDocHistory] tarixiy ombor qoldig‘i:', err.message);
      return { skipped: false, error: String(err?.message || err) };
    } finally {
      this.stockHistoryRunning.delete(integrationId);
    }
  }

  /** Asks a running download to stop after the request in flight; months already saved stay. */
  static stop(integrationId: string): boolean {
    if (!this.running.has(integrationId)) return false;
    this.stopRequested.add(integrationId);
    return true;
  }

  private static checkStop(integrationId: string) {
    if (this.stopRequested.has(integrationId)) throw new HistoryStopped('Yuklash to‘xtatildi.');
  }

  static getState(integrationId: string): HistoryState | null {
    return (db.findById('integrations', integrationId)?.config?.history as HistoryState) || null;
  }

  /** Starts the download in the background; progress is saved per month in integration.config.history. */
  static start(companyId: string, integrationId: string, userId: string, mode: 'full' | 'recent' = 'full', adapter: HistoryAdapter = new SalesDocAdapter()) {
    if (this.running.has(integrationId)) throw new Error('Tarix yuklanmoqda. Tugashini kuting.');
    this.sync(companyId, integrationId, userId, adapter, mode).catch(err => console.warn('[SalesDocHistory]', err.message));
    return { started: true };
  }

  /**
   * Loads order history month by month, newest first, so forecasts get recent data soonest.
   * Settled months already loaded are skipped, which makes an interrupted run resumable.
   */
  static async sync(companyId: string, integrationId: string, userId: string, adapter: HistoryAdapter = new SalesDocAdapter(), mode: 'full' | 'recent' = 'full') {
    if (this.running.has(integrationId)) throw new Error('Tarix yuklanmoqda. Tugashini kuting.');
    this.running.add(integrationId);
    this.stopRequested.delete(integrationId);
    const today = businessToday();
    const integration = db.findById('integrations', integrationId);
    if (!integration || integration.company_id !== companyId) { this.running.delete(integrationId); throw new Error('Integratsiya topilmadi'); }
    const previous = (integration.config.history || {}) as Partial<HistoryState> & { refetch_all?: boolean };
    const runMode = adapter instanceof SalesDocAdapter && previous.agent_mapping_version !== AGENT_MAPPING_VERSION ? 'full' : mode;
    // Set by a migration when stored months must be downloaded again (e.g. a new field); cleared after a full run.
    const refetchAll = (!!previous.refetch_all || (adapter instanceof SalesDocAdapter && previous.agent_mapping_version !== AGENT_MAPPING_VERSION)) && runMode === 'full';
    const state: HistoryState = {
      status: 'RUNNING', mode: runMode, complete: false, start: previous.start || null, from: previous.from || null, to: previous.to || null,
      first_order: previous.first_order || null, orders: previous.orders || 0, skipped: 0,
      months_total: 0, months_done: 0, current: null, started_at: new Date().toISOString(), synced_at: previous.synced_at || null,
      error: null, errors: [], chunks: { ...(previous.chunks || {}) }, refetch_all: refetchAll,
      range_chunks: { ...(previous.range_chunks || {}) }, agent_mapping_version: previous.agent_mapping_version
    };
    const save = () => {
      const current = db.findById('integrations', integrationId)!;
      db.update('integrations', integrationId, { config: { ...current.config, history: { ...state, errors: state.errors.slice(-50) } } });
    };
    save();

    try {
      const config = integration.config;
      // Linko has ~70 lines per order (millions in total): its orders are loaded without lines to keep the database small.
      const isLinko = adapter instanceof LinkoAdapter;
      await this.importProducts(companyId, integrationId, adapter, config);
      this.checkStop(integrationId);
      if (adapter instanceof LinkoAdapter) await this.importLinkoDirectory(companyId, integrationId, adapter, config);
      if (adapter instanceof SalesDocAdapter) {
        state.current = 'agentlar';
        save();
        await this.importSalesDocAgents(companyId, integrationId, adapter, config);
      }
      this.checkStop(integrationId);

      const configuredStart = isValidIsoDate(config.history_start_date) ? config.history_start_date as string : null;
      const stopMonth = configuredStart ? monthKey(configuredStart)
        : runMode === 'recent' ? monthKey(addDays(today, -62)) : OLDEST_MONTH;
      const settledBefore = addDays(today, -SETTLED_AFTER_DAYS);
      state.months_total = Math.max(1, monthDiff(stopMonth, monthKey(today)) + 1);

      let month = monthKey(today);
      let emptyStreak = 0;
      let earliestWithOrders: string | null = null;
      while (month >= stopMonth) {
        state.current = month;
        const from = month === stopMonth && configuredStart ? configuredStart : monthStart(month);
        const to = monthEnd(month) < today ? monthEnd(month) : today;
        const known = state.chunks[month];
        const settled = to < settledBefore && !refetchAll;
        if (known && settled && known.from <= from) {
          // Loaded earlier and cannot change any more.
          emptyStreak = known.orders ? 0 : emptyStreak + 1;
          if (known.orders) earliestWithOrders = month;
        } else {
          // SalesDoc months can contain thousands of orders and lines. Fetch and
          // persist one week at a time so a single large month cannot starve the
          // Render free instance's 5s health check or hold the whole month in RAM.
          const ranges: Array<{ from: string; to: string }> = [];
          if (adapter instanceof SalesDocAdapter) {
            for (let rangeStart = from; rangeStart <= to;) {
              const rangeEnd = addDays(rangeStart, Math.min(6, Math.round((Date.parse(to) - Date.parse(rangeStart)) / 86400000)));
              ranges.push({ from: rangeStart, to: rangeEnd });
              rangeStart = addDays(rangeEnd, 1);
            }
          } else ranges.push({ from, to });

          let stored = 0;
          let skipped = 0;
          for (const range of ranges) {
            const rangeKey = `${month}:${range.from}:${range.to}`;
            const savedRange = state.range_chunks?.[rangeKey];
            if (settled && savedRange?.from === range.from && savedRange?.to === range.to) {
              stored += savedRange.orders;
              skipped += savedRange.skipped;
              continue;
            }
            this.checkStop(integrationId);
            const orders = await this.fetchRange(adapter, config, range.from, range.to, !isLinko);
            // Switched off while this range was downloading: it is not stored.
            this.checkStop(integrationId);
            const result = await this.storeOrders(companyId, userId, orders, state.errors, integrationId, true);
            stored += result.stored;
            skipped += result.skipped;
            state.range_chunks ||= {};
            state.range_chunks[rangeKey] = { ...range, orders: result.stored, skipped: result.skipped, synced_at: new Date().toISOString() };
            save();
            // Keep health checks and other requests responsive between bounded
            // external reads even when a month has many weeks of data.
            await new Promise<void>(resolve => setImmediate(resolve));
          }
          state.chunks[month] = { from, to, orders: stored, skipped, synced_at: new Date().toISOString() };
          for (const key of Object.keys(state.range_chunks || {})) if (key.startsWith(`${month}:`)) delete state.range_chunks![key];
          state.skipped += skipped;
          emptyStreak = stored ? 0 : emptyStreak + 1;
          if (stored) earliestWithOrders = month;
        }
        state.months_done++;
        save();
        if (!configuredStart && runMode === 'full' && emptyStreak >= EMPTY_MONTHS_TO_STOP) break;
        month = previousMonth(month);
      }
      // The start is known only after a full search (or when configured); a recent-only run keeps the previous one.
      if (configuredStart) state.start = configuredStart;
      else if (runMode === 'full') state.start = earliestWithOrders ? monthStart(earliestWithOrders) : today;

      this.checkStop(integrationId);
      // Customer cards (territory, phone, address) from the client directory, once a day; orders alone do not carry them.
      if (!(adapter instanceof LinkoAdapter)) await this.refreshCustomerCards(companyId, integrationId, adapter, config);
      if (adapter instanceof LinkoAdapter) {
        state.current = 'qarzlar';
        save();
        await this.importLinkoLedger(companyId, integrationId, adapter, config, state, today);
      }
      // Customers, products and agents stored before tagging existed (or created elsewhere) get their source.
      tagIntegrationRows(integrationId);
      // Settled months are not downloaded again, so costs entered later must reach them locally.
      this.recomputeCogs(companyId);
      this.finish(companyId, state, today, integrationId);
      if (runMode === 'full') {
        state.refetch_all = false;
        if (adapter instanceof SalesDocAdapter) state.agent_mapping_version = AGENT_MAPPING_VERSION;
      }
      state.status = state.complete ? 'COMPLETE' : 'PARTIAL';
      state.synced_at = new Date().toISOString();
      state.current = null;
      save();
      // A run that finishes after the user switched the integration off must not switch it back on.
      db.update('integrations', integrationId, { last_sync_at: state.synced_at, status: db.findById('integrations', integrationId)?.disabled ? 'DISCONNECTED' : 'CONNECTED' });
      ForecastService.calculateHistoricalSalesVelocity(companyId);
      return { provider: adapter.providerName, status: state.complete ? 'SUCCESS' as const : 'PARTIAL' as const, recordsImported: state.orders, recordsFailed: state.skipped, syncedAt: state.synced_at, details: { history: { ...state, chunks: undefined } } };
    } catch (err: any) {
      if (err instanceof HistoryStopped) {
        // Stopped by the user: not a failure (no alert); saved months stay and the next run continues from them.
        state.status = 'PARTIAL';
        state.error = null;
        state.current = null;
        this.finish(companyId, state, today, integrationId);
        state.status = 'PARTIAL';
        save();
        return { provider: adapter.providerName, status: 'PARTIAL' as const, recordsImported: state.orders, recordsFailed: state.skipped, syncedAt: state.synced_at, details: { stopped: true } };
      }
      // Months saved before the failure stay; the next run continues from there.
      state.status = 'FAILED';
      state.error = err.message;
      state.current = null;
      this.finish(companyId, state, today, integrationId);
      state.status = 'FAILED';
      save();
      // Told once when it starts failing, not on every 15-minute retry.
      if (previous.status !== 'FAILED') {
        NotificationService.dispatchEvent(companyId, 'DISTRIBUTION_SYNC_FAILURE', `❗ ${adapter instanceof LinkoAdapter ? 'Linko' : 'SalesDoc'}dan yuklash to‘xtadi`,
          `${escapeHtml(err.message)}\n\nYuklangan oylar saqlangan; keyingi urinishda davom etadi.`);
      }
      throw err;
    } finally {
      this.running.delete(integrationId);
      this.stopRequested.delete(integrationId);
    }
  }

  /**
   * Reads a date range. When SalesDoc repeats a page for a wide range (seen in practice), the range is split
   * in half until it is small enough; a single day that still fails stops the run instead of saving a gap.
   */
  static async fetchRange(adapter: HistoryAdapter, config: Record<string, any>, from: string, to: string, withItems = true): Promise<ExternalSyncOrder[]> {
    try {
      return await adapter.importOrders(config, { dateFrom: from, dateTo: to, status: [1, 2, 3, 4, 5], withItems });
    } catch (err: any) {
      const transientGateway = /HTTP 502|HTTP 503|HTTP 504|Bad Gateway|gateway timeout/i.test(err.message);
      if (transientGateway || /tarmoq xatosi|vaqti tugadi/i.test(err.message)) {
        // GET history pages are safe to retry. A shorter range after transient gateway failures
        // also keeps a large month from repeatedly overwhelming the provider.
        for (let attempt = 0; attempt < 2; attempt++) {
          await new Promise(resolve => setTimeout(resolve, 1200 * (attempt + 1)));
          try { return await adapter.importOrders(config, { dateFrom: from, dateTo: to, status: [1, 2, 3, 4, 5], withItems }); }
          catch (retryError: any) { err = retryError; }
        }
      }
      const span = Math.round((Date.parse(to) - Date.parse(from)) / 86400000);
      // A persistent gateway outage is not a bad date range. Splitting a month into
      // daily requests would multiply load on an unavailable service, so keep this
      // chunk resumable and retry it during the next scheduled/manual run.
      if (transientGateway || from === to || !/takrorladi|uzilib|chegara|tarmoq xatosi|vaqti tugadi/i.test(err.message)) throw new Error(`${from}–${to}: ${err.message}`);
      const mid = addDays(from, Math.floor(span / 2));
      const left = await this.fetchRange(adapter, config, from, mid, withItems);
      const right = await this.fetchRange(adapter, config, addDays(mid, 1), to, withItems);
      const seen = new Set(left.map(o => o.externalId));
      return left.concat(right.filter(o => !seen.has(o.externalId)));
    }
  }

  private static async importProducts(companyId: string, integrationId: string, adapter: HistoryAdapter, config: Record<string, any>) {
    const products = await adapter.importProducts(config);
    const source: Product['source'] = adapter instanceof LinkoAdapter ? 'LINKO' : 'SALESDOC';
    const now = new Date().toISOString();
    db.transaction(() => {
      const liveCodes = new Set(products.map(p => String(p.sku)));
      const existing = db.find('products', p => p.company_id === companyId && (!p.source_integration_id || p.source_integration_id === integrationId));
      const bySku = new Map(existing.map(p => [p.sku, p]));
      const rows: Product[] = [];
      let newStockoutDetected = false;
      for (const p of existing) {
        if (p.source === source && (!p.source_integration_id || p.source_integration_id === integrationId) && !liveCodes.has(p.sku)) rows.push({ ...p, is_active: false });
      }
      for (const p of products) {
        const old = bySku.get(String(p.sku));
        if ((Number(p.stock_quantity) || 0) <= 0 && (!old || (Number(old.stock_quantity) || 0) > 0)) newStockoutDetected = true;
        const price = p.selling_price || old?.selling_price || 0;
        rows.push({
          ...(old || { id: randomUUID(), created_at: now, selling_price: 0, stock_quantity: 0 }),
          ...p,
          // A later sync may omit the detailed price list; keep the last imported list in that case.
          prices: p.prices ?? old?.prices,
          // Category and brand come from the distribution system; a hand-made category is kept when it sends none.
          category: p.category || old?.category || 'Asosiy',
          brand: p.brand || old?.brand,
          // Keep the last real cost when the system has none (e.g. entered by hand); placeholders are dropped.
          // A real cost from the system is taken as it is. A placeholder there (1 so'm, or none) never erases a real cost
          // entered here by hand; the system's own price list stays visible in `prices` unchanged.
          purchase_cost: isPlausibleCost(p.purchase_cost, price) ? p.purchase_cost : (old && isPlausibleCost(old.purchase_cost, price) ? old.purchase_cost : p.purchase_cost || 0),
          current_cost: isPlausibleCost(p.purchase_cost, price) ? p.purchase_cost : (old && isPlausibleCost(old.current_cost, price) ? old.current_cost : p.purchase_cost || 0),
          daily_sales_avg: old?.daily_sales_avg ?? 0,
          ...inventoryObservation(old || { stock_quantity: 0 }, Number(p.stock_quantity) || 0, businessToday()),
          // A new zero after a previously positive stock state needs fresh historical verification.
          stockout_started_at: Number(p.stock_quantity) > 0 ? null : ((Number(old?.stock_quantity) || 0) <= 0 ? old?.stockout_started_at ?? null : null),
          // Keep the last positive inventory sighting; it is evidence of availability, not an exact depletion date.
          last_in_stock_at: Number(p.stock_quantity) > 0 ? businessToday() : old?.last_in_stock_at ?? null,
          sku: String(p.sku), company_id: companyId, source, is_active: true, updated_at: now, source_integration_id: integrationId
        } as Product);
      }
      db.upsertMany('products', rows);
      if (adapter instanceof SalesDocAdapter && newStockoutDetected) {
        const integration = db.findById('integrations', integrationId);
        if (integration) db.update('integrations', integrationId, {
          config: {
            ...integration.config,
            stockout_history: {
              ...(integration.config.stockout_history || {}),
              start_date: isValidIsoDate(config.history_start_date) ? config.history_start_date : null,
              date: addDays(businessToday(), -1), warehouse_index: 0, quantities: {},
              last_request_at: null, complete: false, finished_at: null, last_error: null
            }
          }
        });
      }
    });
  }

  /** Linko customers (address, responsible agent, active flag) and staff, before orders arrive. */
  /**
   * Territory, phone and address of the system's customers, from its client directory. At most once a day (the
   * directory is large); a failure is only logged, it never stops the order history.
   */
  static async refreshCustomerCards(companyId: string, integrationId: string, adapter: HistoryAdapter, config: Record<string, any>, now = Date.now()) {
    const cfg = db.findById('integrations', integrationId)?.config || {};
    const last = Date.parse(cfg.customers_synced_at || '') || 0;
    // A newer way of reading the cards runs at once instead of waiting a day.
    if (cfg.customers_cards_version === CARDS_VERSION && now - last < 20 * 3600_000) return { updated: 0, skipped: true };
    let cards;
    try { cards = await adapter.importCustomers(config); } catch (err: any) { console.warn('[SalesDocHistory] mijozlar kartasi:', err.message); return { updated: 0, skipped: false }; }
    const byCode = new Map(db.find('customers', c => c.company_id === companyId && !!c.code && (!c.source_integration_id || c.source_integration_id === integrationId)).map(c => [canonicalCustomerCode(c.code), c]));
    let updated = 0;
    const nowIso = new Date(now).toISOString();
    const customerRows: Customer[] = [];
    const balanceRows: CustomerBalanceTransaction[] = [];
    for (const card of cards) {
      let c = byCode.get(canonicalCustomerCode(card.externalCode));
      if (!c) {
        c = { id: randomUUID(), company_id: companyId, code: card.externalCode, name: card.name || card.externalCode, phone: card.phone || '', address: card.address || '', credit_limit: 0, credit_limit_enabled: false, current_balance: 0, status: 'ACTIVE', is_active: card.isActive !== false, created_at: nowIso, source_integration_id: integrationId } as Customer;
        byCode.set(canonicalCustomerCode(card.externalCode), c);
      }
      const patch: Partial<Customer> = {};
      const territory_id = territoryIdFor(companyId, card.territory);
      if (territory_id && territory_id !== c.territory_id) patch.territory_id = territory_id;
      if (card.phone && !c.phone) patch.phone = card.phone;
      if (card.address && !c.address) patch.address = card.address;
      if (card.isActive !== undefined && card.isActive !== c.is_active) patch.is_active = card.isActive;
      const customer = { ...c, ...patch, source_integration_id: integrationId, updated_at: nowIso } as Customer;
      customerRows.push(customer);

      // getBalance is the authoritative current snapshot. Balance reports read the transaction ledger,
      // so reconcile one stable snapshot row instead of only changing the cached customer column.
      const remoteBalance = Number(card.balance);
      if (Number.isFinite(remoteBalance)) {
        const externalId = `${integrationId}:balance-snapshot:${customer.id}`;
        const ledger = db.find('customer_balance_transactions', t => t.company_id === companyId && t.customer_id === customer.id && t.status !== 'REVERSED' && t.external_id !== externalId);
        const baseBalance = ledger.reduce((sum, t) => sum + (t.transaction_type === 'DEBIT' ? Number(t.amount) || 0 : -(Number(t.amount) || 0)), 0);
        const delta = Math.round(remoteBalance - baseBalance);
        const existing = db.find('customer_balance_transactions', t => t.company_id === companyId && t.source_integration_id === integrationId && t.external_id === externalId)[0];
        if (delta === 0) {
          if (existing && existing.status !== 'REVERSED') balanceRows.push({ ...existing, amount: 0, debit_amount: 0, credit_amount: 0, status: 'REVERSED', balance_after: remoteBalance, updated_at: nowIso });
        } else {
          const debit = delta > 0;
          balanceRows.push({
            ...(existing || { id: `${integrationId}:balance:${customer.id}`, created_at: nowIso }),
            company_id: companyId, customer_id: customer.id, transaction_type: debit ? 'DEBIT' : 'CREDIT',
            ledger_type: debit ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT', debit_amount: debit ? delta : 0,
            credit_amount: debit ? 0 : -delta, amount: Math.abs(delta), currency: 'UZS', balance_after: remoteBalance,
            reference_type: 'ADJUSTMENT', reference_id: externalId, external_id: externalId, source_system: 'SALESDOC',
            comment: 'SalesDoctor joriy balansiga moslashtirish', date: businessToday(), transaction_date: businessToday(),
            status: 'CONFIRMED', created_by: 'salesdoc-sync', created_at: existing?.created_at || nowIso,
            updated_at: nowIso, source_integration_id: integrationId
          } as CustomerBalanceTransaction);
        }
        customer.current_balance = Math.round(remoteBalance);
      }
      if (Object.keys(patch).length || !c.source_integration_id) updated++;
    }
    db.transaction(() => {
      if (customerRows.length) db.upsertMany('customers', customerRows);
      if (balanceRows.length) db.upsertMany('customer_balance_transactions', balanceRows);
    });
    const current = db.findById('integrations', integrationId)!;
    db.update('integrations', integrationId, { config: { ...current.config, customers_synced_at: new Date(now).toISOString(), customers_cards_version: CARDS_VERSION } });
    if (updated || balanceRows.length) console.log(`[SalesDocHistory] mijozlar yangilandi: ${updated} ta, balans moslashtirildi: ${balanceRows.length} ta`);
    return { updated, skipped: false };
  }

  private static async importLinkoDirectory(companyId: string, integrationId: string, adapter: LinkoAdapter, config: Record<string, any>) {
    const [markets, staff] = await Promise.all([adapter.importCustomers(config), adapter.importEmployees(config)]);
    const now = new Date().toISOString();
    db.transaction(() => {
      const agents = new Map(db.find('agents', a => a.company_id === companyId && !!a.code && (!a.source_integration_id || a.source_integration_id === integrationId)).map(a => [String(a.code), a]));
      const agentRows: Agent[] = [];
      for (const s of staff) {
        if (s.role !== 'AGENT' && s.role !== 'SUPERVISOR') continue;
        const old = agents.get(s.externalId);
        const row = { ...(old || { id: randomUUID(), company_id: companyId, commission_rate: 0, created_at: now }), code: s.externalId, full_name: s.name, phone: s.phone || old?.phone || '', status: 'ACTIVE', source_integration_id: integrationId } as Agent;
        agents.set(s.externalId, row);
        agentRows.push(row);
      }
      for (const m of markets) {
        if (m.agentCode && !agents.has(m.agentCode)) {
          const row = { id: randomUUID(), company_id: companyId, code: m.agentCode, full_name: m.agentName || m.agentCode, phone: '', commission_rate: 0, status: 'ACTIVE', created_at: now, source_integration_id: integrationId } as Agent;
          agents.set(m.agentCode, row);
          agentRows.push(row);
        }
      }
      if (agentRows.length) db.upsertMany('agents', agentRows);
      const customers = new Map(db.find('customers', c => c.company_id === companyId && !!c.code && (!c.source_integration_id || c.source_integration_id === integrationId)).map(c => [c.code, c]));
      const rows: Customer[] = markets.map(m => {
        const old = customers.get(m.externalCode);
        return {
          ...(old || { id: randomUUID(), company_id: companyId, credit_limit: 0, credit_limit_enabled: false, current_balance: 0, status: 'ACTIVE', created_at: now }),
          code: m.externalCode, name: m.name, address: m.address || old?.address || '', phone: old?.phone || m.phone || '',
          agent_id: (m.agentCode && agents.get(m.agentCode)?.id) || old?.agent_id || null,
          is_active: m.isActive !== false, source_integration_id: integrationId, updated_at: now
        } as Customer;
      });
      if (rows.length) db.upsertMany('customers', rows);
    });
  }

  /** SalesDoctor's order history uses agent ids, so import all ids before linking historical orders. */
  private static async importSalesDocAgents(companyId: string, integrationId: string, adapter: SalesDocAdapter, config: Record<string, any>) {
    const staff = await adapter.importEmployees(config);
    const agents = db.find('agents', a => a.company_id === companyId && (!a.source_integration_id || a.source_integration_id === integrationId));
    const byCode = new Map<string, Agent>();
    const byName = new Map<string, Agent[]>();
    const nameKey = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
    for (const agent of agents) {
      for (const code of [agent.code, ...(agent.external_codes || [])].filter(Boolean)) byCode.set(String(code), agent);
      const key = nameKey(agent.full_name);
      const rows = byName.get(key) || [];
      rows.push(agent); byName.set(key, rows);
    }
    const now = new Date().toISOString();
    const rows: Agent[] = [];
    for (const person of staff) {
      if (person.role !== 'AGENT' && person.role !== 'SUPERVISOR') continue;
      const codes = [...new Set([person.externalId, person.code_1C].filter((v): v is string => !!v).map(String))];
      if (!codes.length) continue;
      const existing = codes.map(code => byCode.get(code)).find(Boolean)
        || ((byName.get(nameKey(person.name)) || []).length === 1 ? byName.get(nameKey(person.name))![0] : undefined);
      const canonicalCode = String(person.code_1C || person.externalId);
      const agent: Agent = {
        ...(existing || { id: randomUUID(), company_id: companyId, commission_rate: person.commissionRate || 0, created_at: now }),
        code: existing?.code || canonicalCode,
        external_codes: [...new Set([...(existing?.external_codes || []), existing?.code, ...codes].filter((v): v is string => !!v))],
        full_name: person.name || existing?.full_name || canonicalCode,
        phone: person.phone || existing?.phone || '',
        status: 'ACTIVE', source_integration_id: integrationId
      } as Agent;
      rows.push(agent);
      for (const code of agent.external_codes || []) byCode.set(code, agent);
      byCode.set(agent.code, agent);
      const key = nameKey(agent.full_name);
      byName.set(key, [...(byName.get(key) || []).filter(a => a.id !== agent.id), agent]);
    }
    if (rows.length) db.upsertMany('agents', rows);

    // Previous full-history chunks did not preserve the provider's agent id. Once an agent directory is available,
    // new rows keep that original id and the one-time full refresh below repairs already-imported months too.
    const allAliases = new Map<string, string>();
    for (const agent of db.find('agents', a => a.company_id === companyId && a.source_integration_id === integrationId)) {
      for (const code of [agent.code, ...(agent.external_codes || [])].filter(Boolean)) allAliases.set(String(code), agent.id);
    }
    const changed: SalesOrder[] = [];
    for (const order of db.find('sales_orders', o => o.company_id === companyId && o.source_integration_id === integrationId && !!o.external_agent_code)) {
      const agentId = allAliases.get(String(order.external_agent_code));
      if (agentId && order.agent_id !== agentId) changed.push({ ...order, agent_id: agentId, updated_at: now });
    }
    if (changed.length) db.upsertMany('sales_orders', changed);
  }

  /**
   * Linko customer ledger (sale debts, payments, returns) with real dates, so balances, debt ageing and collections work.
   * The first run reads everything; later runs re-read the last week (late corrections) and upsert by Linko id.
   */
  private static async importLinkoLedger(companyId: string, integrationId: string, adapter: LinkoAdapter, config: Record<string, any>, state: HistoryState, today: string) {
    const from = state.ledger_synced_to ? addDays(state.ledger_synced_to, -7) : undefined;
    const entries = await adapter.importLedger(config, from, from ? today : undefined);
    const now = new Date().toISOString();
    db.transaction(() => {
      const customers = new Map(db.find('customers', c => c.company_id === companyId && !!c.code && (!c.source_integration_id || c.source_integration_id === integrationId)).map(c => [c.code, c]));
      const oldLedgerIds = new Map(db.find('customer_balance_transactions', t => t.company_id === companyId && t.source_integration_id === integrationId && !!t.external_id).map(t => [String(t.external_id), t.id]));
      const newCustomers: Customer[] = [];
      const rows: CustomerBalanceTransaction[] = [];
      for (const e of entries) {
        if (!isValidIsoDate(e.date) || !e.amount) continue;
        let customer = customers.get(e.customerCode);
        if (!customer) {
          customer = { id: randomUUID(), company_id: companyId, code: e.customerCode, name: e.customerName, phone: '', address: '', credit_limit: 0, credit_limit_enabled: false, current_balance: 0, status: 'ACTIVE', is_active: true, created_at: now, source_integration_id: integrationId } as Customer;
          customers.set(e.customerCode, customer);
          newCustomers.push(customer);
        }
        const debit = e.amount < 0;
        const value = Math.abs(e.amount);
        rows.push({
          id: oldLedgerIds.get(e.externalId) || `${integrationId}:${e.externalId}`, company_id: companyId, customer_id: customer.id,
          transaction_type: debit ? 'DEBIT' : 'CREDIT',
          ledger_type: e.kind === 'SALE' ? 'SALE' : e.kind === 'PAYMENT' ? 'PAYMENT' : e.kind === 'RETURN' ? 'RETURN' : debit ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT',
          debit_amount: debit ? value : 0, credit_amount: debit ? 0 : value, amount: value, currency: 'UZS',
          payment_method: e.paymentMethod, balance_after: 0,
          reference_type: e.kind === 'SALE' ? 'SALE' : e.kind === 'PAYMENT' ? 'PAYMENT' : e.kind === 'RETURN' ? 'RETURN' : 'ADJUSTMENT',
          reference_id: e.orderExternalId || e.externalId, external_id: e.externalId, source_system: 'LINKO', comment: e.comment,
          date: e.date, transaction_date: e.date, status: 'CONFIRMED', created_by: 'linko-sync', created_at: now,
          source_integration_id: integrationId
        } as CustomerBalanceTransaction);
      }
      if (newCustomers.length) db.upsertMany('customers', newCustomers);
      if (rows.length) db.upsertMany('customer_balance_transactions', rows);
      // Running balance per customer and the cached current balance (debt > 0).
      const touched = new Set(rows.map(r => r.customer_id));
      const byCustomer = new Map<string, any[]>();
      for (const t of db.getTableIncludingHidden('customer_balance_transactions') as any[]) {
        if (!touched.has(t.customer_id)) continue;
        const list = byCustomer.get(t.customer_id) || [];
        list.push(t);
        byCustomer.set(t.customer_id, list);
      }
      const balances: Customer[] = [];
      const runningChanged: any[] = [];
      for (const [customerId, list] of byCustomer) {
        list.sort((a, b) => (a.date === b.date ? String(a.created_at).localeCompare(String(b.created_at)) : a.date.localeCompare(b.date)));
        let balance = 0;
        for (const t of list) {
          if (t.status === 'REVERSED') continue;
          balance += (t.debit_amount || 0) - (t.credit_amount || 0);
          if (t.balance_after !== balance) { t.balance_after = balance; runningChanged.push(t); }
        }
        const c = db.findById('customers', customerId);
        if (c && c.current_balance !== balance) balances.push({ ...c, current_balance: balance, updated_at: now });
      }
      // balance_after was set in place, so those rows are marked for saving.
      if (runningChanged.length) db.markDirty('customer_balance_transactions', runningChanged);
      if (balances.length) db.upsertMany('customers', balances);
    });
    state.ledger_synced_to = today;
    state.ledger_rows = (state.ledger_rows || 0) + entries.length;
  }

  /**
   * Upserts one chunk of orders with their lines. Returns counts; problems are listed, not fatal.
   * Rows are tagged with the integration. Orders read without lines (items undefined) keep their stored lines and cost.
   * createAgents: agents unknown locally are created from the order (Linko; SalesDoc agents come from its own list).
   */
  private static async storeOrders(companyId: string, userId: string, orders: ExternalSyncOrder[], errors: string[], integrationId?: string, createAgents = false) {
    // A busy month can contain thousands of rows. Keep each transaction bounded and
    // yield between batches so the free Render instance can answer health checks.
    let stored = 0;
    let skipped = 0;
    const sourceRow = (row: { source_integration_id?: string | null }) => !row.source_integration_id || row.source_integration_id === integrationId;
    // A week may need many 50-order transactions. Build the lookup tables once
    // for the whole week instead of rescanning all history rows for every batch.
    const indexes: OrderStoreIndexes = {
      customers: new Map(db.find('customers', c => c.company_id === companyId && !!c.code && sourceRow(c)).map(c => [canonicalCustomerCode(c.code), c])),
      products: new Map(db.find('products', p => p.company_id === companyId && sourceRow(p)).map(p => [p.sku, p])),
      ordersByExternal: new Map(db.find('sales_orders', o => o.company_id === companyId && !!o.external_id && sourceRow(o)).map(o => [o.external_id!, o])),
      agentByCode: new Map()
    };
    for (const agent of db.find('agents', a => a.company_id === companyId && !!a.code && sourceRow(a))) {
      for (const code of [agent.code, ...(agent.external_codes || [])]) if (code) indexes.agentByCode.set(String(code), agent.id);
    }
    const replacedOrderIds = new Set<string>();
    const replacementItems: SalesOrderItem[] = [];
    const batchSize = 50;
    for (let offset = 0; offset < orders.length; offset += batchSize) {
      const result = this.storeOrdersChunk(companyId, userId, orders.slice(offset, offset + batchSize), errors, integrationId, createAgents, indexes, replacedOrderIds, replacementItems);
      stored += result.stored;
      skipped += result.skipped;
      await new Promise<void>(resolve => setImmediate(resolve));
    }
    if (replacedOrderIds.size) {
      // Replace lines for a bounded date range in one pass. Doing this once for
      // every 50 orders rescanned the growing history table quadratically.
      db.transaction(() => {
        db.removeWhere('sales_order_items', item => replacedOrderIds.has(item.sales_order_id));
        if (replacementItems.length) db.upsertMany('sales_order_items', replacementItems);
      });
    }
    return { stored, skipped };
  }

  private static storeOrdersChunk(companyId: string, userId: string, orders: ExternalSyncOrder[], errors: string[], integrationId?: string, createAgents = false, indexes?: OrderStoreIndexes, replacedOrderIds = new Set<string>(), replacementItems: SalesOrderItem[] = []) {
    const now = new Date().toISOString();
    let stored = 0;
    let skipped = 0;
    db.transaction(() => {
      const activeIndexes = indexes || { customers: new Map(), products: new Map(), ordersByExternal: new Map(), agentByCode: new Map() } as OrderStoreIndexes;
      const { customers, products: productBySku, ordersByExternal, agentByCode } = activeIndexes;
      const newAgents: Agent[] = [];
      if (createAgents) {
        for (const order of orders) {
          if (!order.agentCode || agentByCode.has(order.agentCode)) continue;
          const agent = { id: randomUUID(), company_id: companyId, code: order.agentCode, full_name: order.agentName || order.agentCode, phone: '', commission_rate: 0, status: 'ACTIVE', created_at: now, source_integration_id: integrationId || null } as Agent;
          agentByCode.set(order.agentCode, agent.id);
          newAgents.push(agent);
        }
      }
      const withLines = new Set<string>();
      const newCustomers: Customer[] = [];
      const customerAgent = new Map<string, string>();
      const orderRows: SalesOrder[] = [];
      const itemRows: SalesOrderItem[] = [];
      for (const order of orders) {
        if (!order.customerCode || order.customerCode === 'UNKNOWN' || !isValidIsoDate(order.orderDate)) {
          skipped++;
          errors.push(`Buyurtma ${order.orderNumber || order.externalId}: mijoz yoki sana yo‘q — o‘tkazib yuborildi.`);
          continue;
        }
        let customer = customers.get(canonicalCustomerCode(order.customerCode));
        if (!customer) {
          customer = { id: randomUUID(), company_id: companyId, code: order.customerCode, name: order.customerName, phone: '', address: '', credit_limit: 0, credit_limit_enabled: false, current_balance: 0, status: 'ACTIVE', is_active: true, created_at: now, source_integration_id: integrationId || null } as Customer;
          customers.set(canonicalCustomerCode(order.customerCode), customer);
          newCustomers.push(customer);
        }
        const old = ordersByExternal.get(order.externalId);
        const id = old?.id || randomUUID();
        const keepLines = order.items === undefined;
        const cogs = keepLines ? null : computeOrderCogs(order.items || [], productBySku);
        const cogsTotal = cogs ? cogs.total : old?.total_cogs || 0;
        const cogsStatus = cogs ? cogs.status : old?.cogs_status || 'UNKNOWN';
        const status: SalesOrder['status'] = order.status === 'CANCELLED' ? 'CANCELLED' : ['DELIVERED', 'CLOSED'].includes(order.status) ? 'DELIVERED' : 'PENDING';
        const row: SalesOrder = {
          ...(old || { created_by: userId, created_at: now }),
          id, company_id: companyId, external_id: order.externalId, order_number: order.orderNumber,
          order_date: order.orderDate, delivery_date: order.deliveryDate || order.orderDate, customer_id: customer.id, customer_name: customer.name,
          agent_id: order.agentCode ? agentByCode.get(String(order.agentCode)) || null : old?.agent_id || null,
          external_agent_code: order.agentCode || null,
          expeditor_name: order.expeditorName?.trim() || old?.expeditor_name || null,
          // The distribution total is already net of returns; total_sales keeps the gross so net = total_sales − return_amount as everywhere else.
          total_sales: order.totalAmount + (order.returnAmount || 0), discount_amount: 0, return_amount: order.returnAmount || 0, net_sales: order.totalAmount,
          total_cogs: cogsTotal, cogs_status: cogsStatus,
          gross_profit: cogsStatus === 'KNOWN' ? order.totalAmount - cogsTotal : 0,
          payment_type: 'CREDIT', status, source: 'DISTRIBUTION', updated_at: now,
          ...(integrationId ? { source_integration_id: integrationId } : {})
        } as SalesOrder;
        ordersByExternal.set(order.externalId, row);
        orderRows.push(row);
        // A customer without an agent gets the agent of its most recent order (months load newest first).
        if (row.agent_id && !customer.agent_id && !customerAgent.has(customer.id)) customerAgent.set(customer.id, row.agent_id);
        if (cogs) {
          replacedOrderIds.add(id);
          for (const line of cogs.lines) itemRows.push({ ...line, id: randomUUID(), sales_order_id: id, ...(integrationId ? { source_integration_id: integrationId } : {}) });
        }
        stored++;
      }
      if (newAgents.length) db.upsertMany('agents', newAgents);
      for (const c of newCustomers) if (customerAgent.has(c.id)) c.agent_id = customerAgent.get(c.id)!;
      if (newCustomers.length) db.upsertMany('customers', newCustomers);
      const newIds = new Set(newCustomers.map(c => c.id));
      const existingAssigned = [...customerAgent].filter(([id]) => !newIds.has(id));
      if (existingAssigned.length) db.upsertMany('customers', existingAssigned.map(([id, agent_id]) => ({ ...db.findById('customers', id)!, agent_id })));
      if (orderRows.length) db.upsertMany('sales_orders', orderRows);
      replacementItems.push(...itemRows);
    });
    return { stored, skipped };
  }

  /** Cost of goods of every stored SalesDoc order from today's product costs (history keeps no past costs). */
  static recomputeCogs(companyId: string) {
    const products = db.find('products', p => p.company_id === companyId);
    // Build the SKU indexes once. Filtering and rebuilding this map for every order
    // made a full history import scale as orders × products and could block Render's
    // event loop long enough to fail its 5 second health check.
    const productsByIntegration = new Map<string, Map<string, Product>>();
    const allProducts = new Map<string, Product>();
    for (const product of products) allProducts.set(product.sku, product);
    const productsForOrder = (integrationId?: string | null) => {
      if (!integrationId) return allProducts;
      let indexed = productsByIntegration.get(integrationId);
      if (!indexed) {
        indexed = new Map<string, Product>();
        for (const product of products) {
          if (!product.source_integration_id || product.source_integration_id === integrationId) indexed.set(product.sku, product);
        }
        productsByIntegration.set(integrationId, indexed);
      }
      return indexed;
    };
    const orders = db.find('sales_orders', o => o.company_id === companyId && !!o.external_id && o.source === 'DISTRIBUTION');
    const orderIds = new Set(orders.map(o => o.id));
    const itemsByOrder = new Map<string, SalesOrderItem[]>();
    for (const item of db.getTable('sales_order_items')) {
      if (!orderIds.has(item.sales_order_id)) continue;
      const list = itemsByOrder.get(item.sales_order_id) || [];
      list.push(item);
      itemsByOrder.set(item.sales_order_id, list);
    }
    const orderRows: SalesOrder[] = [];
    const itemRows: SalesOrderItem[] = [];
    for (const order of orders) {
      const items = itemsByOrder.get(order.id) || [];
      const orderProducts = productsForOrder(order.source_integration_id);
      const cogs = computeOrderCogs(items.map(i => ({ sku: i.sku || i.product_id, name: i.product_name, quantity: i.quantity, price: i.unit_price, total: i.total_amount })), orderProducts);
      if (order.cogs_status !== cogs.status || order.total_cogs !== cogs.total) {
        orderRows.push({ ...order, total_cogs: cogs.total, cogs_status: cogs.status, gross_profit: cogs.status === 'KNOWN' ? order.net_sales - cogs.total : 0 });
      }
      items.forEach((item, idx) => {
        const line = cogs.lines[idx];
        if (line && (item.unit_cost !== line.unit_cost || item.total_cogs !== line.total_cogs)) itemRows.push({ ...item, unit_cost: line.unit_cost, total_cogs: line.total_cogs });
      });
    }
    if (!orderRows.length && !itemRows.length) return 0;
    db.transaction(() => {
      if (orderRows.length) db.upsertMany('sales_orders', orderRows);
      if (itemRows.length) db.upsertMany('sales_order_items', itemRows);
    });
    return orderRows.length;
  }

  /** Coverage: the continuous run of loaded months ending today. Complete only if it reaches the history start. */
  private static finish(companyId: string, state: HistoryState, today: string, integrationId?: string) {
    let month = monthKey(today);
    let from: string | null = null;
    while (state.chunks[month]) { from = state.chunks[month].from; month = previousMonth(month); }
    state.from = from;
    state.to = from ? today : null;
    const localOrders = db.find('sales_orders', o => o.company_id === companyId && !!o.external_id && o.source === 'DISTRIBUTION'
      && (!integrationId || !o.source_integration_id || o.source_integration_id === integrationId));
    state.orders = localOrders.length;
    state.first_order = localOrders.reduce<string | null>((min, o) => (!min || o.order_date < min ? o.order_date : min), null);
    state.complete = state.status !== 'FAILED' && !!state.start && !!from && from <= state.start;
  }
}
function monthDiff(fromKey: string, toKey: string): number {
  const [fy, fm] = fromKey.split('-').map(Number);
  const [ty, tm] = toKey.split('-').map(Number);
  return (ty - fy) * 12 + (tm - fm);
}
