import { activeDistribution } from '../integrations/distribution.ts';
import type { ExternalSyncOrder } from '../integrations/interfaces.ts';
import type { HistoryAdapter } from './salesdoc-history.service.ts';
import { SalesDocHistoryService } from './salesdoc-history.service.ts';
import { daysBetween, isValidIsoDate } from '../utils/date.ts';

const CACHE_TTL_MS = 30_000;
const MAX_HISTORY_DAYS = 3660;
const SALES_DOC_CHUNK_DAYS = 7;
const SALES_DOC_MAX_PARALLEL = 3;
type LiveResult = { integrationId: string; provider: string; from: string; to: string; fetchedAt: string; orders: ExternalSyncOrder[] };
const cache = new Map<string, { expiresAt: number; value: LiveResult }>();
const inflight = new Map<string, Promise<LiveResult>>();

/** Read-only order-history access. Responses stay in a short in-memory cache and are never persisted. */
export class LiveHistoryService {
  static async getOrders(companyId: string, from: string, to: string): Promise<LiveResult> {
    if (!isValidIsoDate(from) || !isValidIsoDate(to) || from > to) throw new Error('Tarix oralig‘i YYYY-MM-DD formatida to‘g‘ri bo‘lsin.');
    if (daysBetween(from, to) + 1 > MAX_HISTORY_DAYS) throw new Error(`Jonli tarix so‘rovi ${MAX_HISTORY_DAYS} kundan oshmasin.`);
    const distribution = activeDistribution(companyId);
    if (!distribution) throw new Error('Jonli tarix uchun faol distributsiya integratsiyasi ulanmagan.');
    if (!distribution.capabilities.history || typeof (distribution.adapter as any).importOrders !== 'function') {
      throw new Error(`${distribution.name} buyurtmalar tarixini jonli o‘qishni qo‘llamaydi.`);
    }
    const key = `${companyId}:${distribution.integration.id}:${from}:${to}`;
    const current = cache.get(key);
    if (current && current.expiresAt > Date.now()) return current.value;
    const running = inflight.get(key);
    if (running) return running;

    const work = (async () => {
      const config = distribution.integration.config || {};
      const adapter = distribution.adapter as HistoryAdapter;
      const ranges: Array<{ from: string; to: string }> = [];
      for (let start = from; start <= to;) {
        const end = new Date(Math.min(Date.parse(to), Date.parse(`${start}T00:00:00Z`) + (SALES_DOC_CHUNK_DAYS - 1) * 86400000)).toISOString().slice(0, 10);
        ranges.push({ from: start, to: end });
        start = new Date(Date.parse(`${end}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
      }
      const orders: ExternalSyncOrder[] = [];
      for (let offset = 0; offset < ranges.length; offset += SALES_DOC_MAX_PARALLEL) {
        const batch = ranges.slice(offset, offset + SALES_DOC_MAX_PARALLEL);
        const results = await Promise.all(batch.map(range => SalesDocHistoryService.fetchRange(adapter, config, range.from, range.to, true)));
        for (const group of results) orders.push(...group);
      }
      const uniqueOrders = [...new Map(orders.filter(order => !!order.externalId).map(order => [order.externalId, order])).values()];
      const value: LiveResult = {
        integrationId: distribution.integration.id,
        provider: distribution.name,
        from,
        to,
        fetchedAt: new Date().toISOString(),
        orders: uniqueOrders
      };
      cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, value });
      return value;
    })();
    inflight.set(key, work);
    try { return await work; }
    finally { if (inflight.get(key) === work) inflight.delete(key); }
  }
}
