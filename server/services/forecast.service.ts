import { db } from '../db/database.ts';
import type { Product, Notification } from '../db/schema.ts';
import { AuditService } from './audit.service.ts';
import { NotificationService } from './notification.service.ts';
import { integrationProvider } from '../integrations/provider.ts';
import { addDays, businessToday, daysBetween, isValidIsoDate } from '../utils/date.ts';
import { SalesDocHistoryService } from './salesdoc-history.service.ts';
import { activeDistribution, distributionIntegrations } from '../integrations/distribution.ts';
import { isPlausibleCost } from './cogs.ts';

export interface StockRunRateItem {
  id: string;
  sku: string;
  name: string;
  category: string;
  unit: string;
  stock_quantity: number;
  purchase_cost: number;
  selling_price: number;
  daily_sales_avg: number;
  effective_daily_sales: number;
  days_remaining: number;
  velocity_days: number;
  velocity_quantity: number;
  velocity_sale_days: number;
  last_sale_date: string | null;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
  status: 'OUT_OF_STOCK' | 'CRITICAL' | 'LOW' | 'OPTIMAL' | 'OVERSTOCKED';
  safety_stock: number;
  reorder_quantity: number;
  reorder_cost: number;
  source: string;
}

export interface OutOfStockLostProfitItem {
  id: string;
  sku: string;
  name: string;
  category: string;
  unit: string;
  purchase_cost: number;
  selling_price: number;
  unit_profit: number;
  profit_margin_pct: number;
  daily_sales_avg: number;            // daily sales while the product was in stock
  days_out_of_stock: number | null;   // null: no sale and no in-stock sighting to date it
  out_of_stock_since: string | null;
  stockout_date_accuracy: 'HISTORICAL' | 'OBSERVED' | 'UNKNOWN';
  zero_stock_observed_at: string | null;
  stock_observed_at: string | null;
  estimate_status: 'ESTIMATED' | 'STOCKOUT_DATE_UNKNOWN' | 'NO_DEMAND_DATA' | 'PRICE_UNKNOWN';
  last_sale_date: string | null;
  lost_units: number;
  lost_sales_uzs: number;
  lost_profit_uzs: number;
  source: string;
}

export class ForecastService {
  /** Forecast window and the part of it that loaded history actually covers. */
  public static getForecastWindow(companyId: string) {
    // Only use the active server. Falling back to a disabled/old connection leaks its stock and history after a switch.
    const integration=activeDistribution(companyId)?.integration;
    const days=Number(integration?.config.forecast_days||100);
    if(!Number.isInteger(days)||days<1||days>3660) throw new Error('Prognoz davri 1–3660 kun bo‘lsin');
    const end=businessToday();
    const start=addDays(end,-(days-1));
    const history=integration?.config.history;
    // Days before the loaded history are unknown, not "zero sales"; they are left out of the divisor.
    const historyFrom=isValidIsoDate(history?.from) ? history.from : null;
    const coveredFrom=historyFrom && historyFrom>start ? historyFrom : start;
    const coveredDays=integration && !historyFrom ? 0 : Math.max(0,daysBetween(coveredFrom,end)+1);
    return {days,start,end,coveredFrom,coveredDays,covered:coveredDays>0&&coveredFrom===start,history,integrationId:integration?.id||null};
  }

  /**
   * Daily demand = delivered quantity in the window ÷ calendar days of loaded history in the window.
   * Also stores how many days had sales and a confidence label, so a single sale is not read as a trend.
   */
  public static calculateHistoricalSalesVelocity(companyId: string): void {
    const w=this.getForecastWindow(companyId);
    const sameSource=(row:{source_integration_id?:string|null;source?:string|null})=>w.integrationId
      ? row.source_integration_id===w.integrationId
      : !row.source_integration_id && (!row.source || row.source==='MANUAL');
    const orderDate=new Map(db.find('sales_orders',o=>o.company_id===companyId && sameSource(o) && o.status==='DELIVERED' && o.order_date>=w.coveredFrom && o.order_date<=w.end).map(o=>[o.id,o.order_date]));
    const allDelivered=new Map(db.find('sales_orders',o=>o.company_id===companyId && sameSource(o) && o.status==='DELIVERED').map(o=>[o.id,o.order_date]));
    const products=db.find('products',p=>p.company_id===companyId && sameSource(p));
    const map=new Map(products.flatMap(p=>[[p.id,p.id],[p.sku,p.id]]));
    const stats=new Map<string,{qty:number;days:Set<string>;first:string|null;last:string|null}>();
    for(const item of db.getTable('sales_order_items')){
      const id=map.get(item.product_id)||map.get(item.sku||'');
      const date=allDelivered.get(item.sales_order_id);
      if(!id || !date || !Number.isFinite(item.quantity)) continue;
      const s=stats.get(id)||{qty:0,days:new Set<string>(),first:null,last:null};
      if(!s.first||date<s.first) s.first=date;
      if(!s.last||date>s.last) s.last=date;
      if(orderDate.has(item.sales_order_id)){s.qty+=item.quantity;if(item.quantity>0)s.days.add(date);}
      stats.set(id,s);
    }
    db.transaction(()=>{
      const rows=products.map(p=>{
        const s=stats.get(p.id);
        const saleDays=s?.days.size||0;
        const confidence: Product['velocity_confidence']=w.coveredDays===0?'NONE':!w.covered||saleDays<3?'LOW':saleDays<10?'MEDIUM':'HIGH';
        return {...p,
          daily_sales_avg:w.coveredDays>0?(s?.qty||0)/w.coveredDays:0,
          velocity_days:w.coveredDays,velocity_quantity:s?.qty||0,velocity_sale_days:saleDays,
          first_sale_date:s?.first||null,last_sale_date:s?.last||null,velocity_confidence:confidence};
      });
      db.upsertMany('products',rows);
    });
  }

  /**
   * Ensures existing active products have calculated velocities if missing
   */
  public static ensureProductsWithVelocities(companyId: string): void {
    const existing = db.find('products', p => p.company_id === companyId);
    if (existing.length === 0) {
      return; // Do not insert fake products
    }

    for (const p of existing) {
      if (p.daily_sales_avg === undefined) {
        const qty = p.stock_quantity ?? 0;
        const defaultDaily = 0;
        db.update('products', p.id, {
          daily_sales_avg: defaultDaily,
          out_of_stock_days: qty === 0 ? (p.out_of_stock_days || 0) : 0,
          min_stock_level: p.min_stock_level || Math.round(defaultDaily * 7)
        });
      }
    }
  }

  /**
   * Calculates Stock Run-rate and days of coverage for any daily sales pace
   */
  public static getStockRunRate(
    companyId: string, 
    runRateFactor: number = 1.0, 
    customDailyDemandMap?: Record<string, number>
  ) {
    if (!Number.isFinite(runRateFactor) || runRateFactor < 0 || runRateFactor > 100) throw new Error('Savdo koeffitsienti 0–100 oralig‘ida bo‘lsin');
    if (customDailyDemandMap && Object.values(customDailyDemandMap).some(v => typeof v !== 'number' || !Number.isFinite(v) || v < 0)) throw new Error('Kunlik talab manfiy bo‘lmagan son bo‘lsin');
    this.ensureProductsWithVelocities(companyId);
    const selectedIntegrationId=this.getForecastWindow(companyId).integrationId;
    const products = db.find('products', p => p.company_id === companyId && p.is_active && (selectedIntegrationId
      ? p.source_integration_id===selectedIntegrationId
      : !p.source_integration_id && (!p.source || p.source==='MANUAL')));

    const items: StockRunRateItem[] = [];
    let totalStockValue = 0;
    let totalReorderCost = 0;
    let criticalCount = 0;
    let lowCount = 0;
    let outOfStockCount = 0;
    let inStockCount = 0;
    let totalDaysSum = 0;

    for (const p of products) {
      const stock = Math.max(0, p.stock_quantity || 0);
      const baseDaily = Math.max(0, p.daily_sales_avg ?? 0);
      const customDaily = customDailyDemandMap && customDailyDemandMap[p.id];
      const effectiveDaily = customDaily !== undefined ? customDaily : baseDaily * runRateFactor;

      let daysRemaining = 0;
      let status: StockRunRateItem['status'] = 'OPTIMAL';

      if (stock === 0) {
        daysRemaining = 0;
        status = 'OUT_OF_STOCK';
        outOfStockCount++;
      } else {
        inStockCount++;
        daysRemaining = effectiveDaily > 0 ? Number((stock / effectiveDaily).toFixed(1)) : 999;

        if (daysRemaining <= 3) {
          status = 'CRITICAL';
          criticalCount++;
        } else if (daysRemaining <= 7) {
          status = 'LOW';
          lowCount++;
        } else if (daysRemaining > 35) {
          status = 'OVERSTOCKED';
        } else {
          status = 'OPTIMAL';
        }

        if(effectiveDaily>0) totalDaysSum += daysRemaining;
        else inStockCount--;
      }

      const safetyStock = Math.round(effectiveDaily * 10);
      const targetStock = Math.round(effectiveDaily * 30);
      const reorderQty = Math.max(0, targetStock - stock);
      const reorderCost = reorderQty * (p.purchase_cost || p.current_cost || 0);

      totalStockValue += stock * (p.purchase_cost || p.current_cost || 0);
      totalReorderCost += reorderCost;

      items.push({
        id: p.id,
        sku: p.sku,
        name: p.name,
        category: p.category || 'Umumiy',
        unit: p.unit || 'dona',
        stock_quantity: stock,
        purchase_cost: p.purchase_cost || p.current_cost || 0,
        selling_price: p.selling_price || 0,
        daily_sales_avg: baseDaily,
        effective_daily_sales: effectiveDaily,
        days_remaining: daysRemaining,
        velocity_days: p.velocity_days ?? 0,
        velocity_quantity: p.velocity_quantity ?? 0,
        velocity_sale_days: p.velocity_sale_days ?? 0,
        last_sale_date: p.last_sale_date ?? null,
        confidence: p.velocity_confidence ?? 'NONE',
        status,
        safety_stock: safetyStock,
        reorder_quantity: reorderQty,
        reorder_cost: reorderCost,
        source: p.source || 'MANUAL'
      });
    }

    const avgDays = inStockCount > 0 ? Number((totalDaysSum / inStockCount).toFixed(1)) : 0;

    const w=this.getForecastWindow(companyId);
    const history=w.history;
    const warning=!history?.from
      ? 'Buyurtmalar tarixi yuklanmagan. Prognoz hisoblanmaydi — Integratsiyalar bo‘limida “To‘liq tarixni yuklash”ni bosing.'
          : w.coveredDays===0
            ? 'Buyurtmalar tarixi yuklanmagan yoki davr hali tasdiqlanmagan. Kunlik sotuv tezligi va tugagan mahsulotlar yo‘qotish summasi hisoblanmaydi.'
          : !w.covered
        ? `Tarix ${history.from} dan boshlab yuklangan, prognoz davri esa ${w.start} dan. Hisob faqat ${w.coveredDays} kunlik ma'lumotga tayanadi — ishonchlilik past.`
        : history.status==='FAILED'
          ? `Oxirgi yuklash xato bilan to'xtadi (${history.error}). Oldingi yuklangan oylar ishlatildi.`
          : `Hisob: qoldiq ÷ (${w.start} – ${w.end} dagi yetkazilgan miqdor ÷ ${w.coveredDays} kun). Ombor va o'lchov birligi ulangan tizim bilan bir xil bo'lishi kerak.`;
    return {
      history: {complete:!!history?.complete,covered:w.covered,days:w.days,covered_days:w.coveredDays,window_from:w.start,window_to:w.end,history_from:history?.from||null,status:history?.status||null,orders:history?.orders||0,synced_at:history?.synced_at||null,first_order:history?.first_order||null,warning},
      run_rate_factor: runRateFactor,
      summary: {
        total_products: products.length,
        in_stock_count: inStockCount,
        out_of_stock_count: outOfStockCount,
        critical_count: criticalCount,
        low_count: lowCount,
        optimal_count: products.length - outOfStockCount - criticalCount - lowCount,
        avg_days_remaining: avgDays,
        total_stock_value_uzs: totalStockValue,
        total_reorder_cost_uzs: totalReorderCost
      },
      items: items.sort((a, b) => a.days_remaining - b.days_remaining)
    };
  }

  /**
   * Evaluates Stock-Out items, days missing, lost sales, and lost net profit
   */
  /** First verified zero-stock snapshot. Legacy rows fall back to their latest known inventory snapshot. */
  public static outOfStockSince(p: Pick<Product, 'zero_stock_observed_at' | 'stock_observed_at' | 'stockout_started_at' | 'source'>): string | null {
    // SalesDoc has a dated stock endpoint: never call a first-seen-zero observation the actual depletion date.
    const since = p.stockout_started_at || (p.source === 'SALESDOC' ? null : p.zero_stock_observed_at || p.stock_observed_at);
    return isValidIsoDate(since) && since <= businessToday() ? since : null;
  }

  public static getOutOfStockLostProfit(companyId: string) {
    this.ensureProductsWithVelocities(companyId);
    const w = this.getForecastWindow(companyId);
    const selectedIntegrationId=w.integrationId;
    const products = db.find('products', p => p.company_id === companyId && p.is_active && (selectedIntegrationId
      ? p.source_integration_id===selectedIntegrationId
      : !p.source_integration_id && (!p.source || p.source==='MANUAL')));
    const today = businessToday();

    const outItems = products.filter(p => (p.stock_quantity || 0) <= 0);

    const resultItems: OutOfStockLostProfitItem[] = [];
    let totalLostSales = 0;
    let totalLostProfit = 0;
    let totalLostUnits = 0;

    let profitUnknownCount = 0;
    let sinceUnknownCount = 0;
    let estimateUnknownCount = 0;
    const selectedSource = (row: { source_integration_id?: string | null; source?: string | null }) => selectedIntegrationId
      ? row.source_integration_id === selectedIntegrationId
      : !row.source_integration_id && (!row.source || row.source === 'MANUAL');
    const productByAlias = new Map<string, Product>();
    for (const p of products) for (const alias of [p.id, p.sku]) if (alias) productByAlias.set(String(alias), p);
    const deliveredOrders = new Map(db.find('sales_orders', o => o.company_id === companyId && selectedSource(o) && o.status === 'DELIVERED')
      .map(o => [o.id, o.order_date] as const));
    const salesByProduct = new Map<string, { date: string; qty: number; value: number }[]>();
    for (const line of db.getTable('sales_order_items')) {
      const p = productByAlias.get(String(line.product_id || '')) || productByAlias.get(String(line.sku || ''));
      const date = deliveredOrders.get(line.sales_order_id);
      const qty = Number(line.quantity);
      if (!p || !date || !Number.isFinite(qty) || qty <= 0) continue;
      const value = Number(line.total_amount) > 0 ? Number(line.total_amount) : Math.max(0, Number(line.unit_price) || 0) * qty;
      const list = salesByProduct.get(p.id) || [];
      list.push({ date, qty, value });
      salesByProduct.set(p.id, list);
    }
    for (const p of outItems) {
      const since = this.outOfStockSince(p);
      const stockObservedAt = isValidIsoDate(p.stock_observed_at) && p.stock_observed_at <= today ? p.stock_observed_at : null;
      // Count calendar days elapsed since the first zero observation through today. The separately shown
      // stock_observed_at date tells the user how fresh the underlying inventory snapshot is.
      const daysOut = since && stockObservedAt && stockObservedAt >= since ? Math.max(0, daysBetween(since, today)) : null;
      if (since === null || !stockObservedAt) sinceUnknownCount++;
      const lostFromCandidate = since ? addDays(since, 1) : null;
      const coverageStart = w.coveredFrom > w.start ? w.coveredFrom : w.start;
      const lostFrom = lostFromCandidate && lostFromCandidate > coverageStart ? lostFromCandidate : coverageStart;
      const lossEnd = stockObservedAt && stockObservedAt < w.end ? stockObservedAt : w.end;
      const lostDaysInWindow = since && stockObservedAt && w.coveredDays > 0 && lostFrom <= lossEnd ? daysBetween(lostFrom, lossEnd) + 1 : 0;
      // Use a same-length, fully loaded period immediately before the first confirmed zero snapshot as the demand
      // baseline. Do not treat days after the zero snapshot as zero demand, or infer a stock-out from last_sale_date.
      const baselineEnd = since ? addDays(since, -1) : null;
      const requestedBaselineStart = baselineEnd ? addDays(baselineEnd, -(w.days - 1)) : null;
      const baselineStart = requestedBaselineStart && isValidIsoDate(w.history?.from) && w.history.from > requestedBaselineStart
        ? w.history.from : requestedBaselineStart;
      const baselineDays = !baselineEnd || !baselineStart || baselineStart > baselineEnd || (selectedIntegrationId && !isValidIsoDate(w.history?.from))
        ? 0 : daysBetween(baselineStart, baselineEnd) + 1;
      const baselineLines = (salesByProduct.get(p.id) || []).filter(x => baselineStart && baselineEnd && x.date >= baselineStart && x.date <= baselineEnd);
      const soldBeforeOut = baselineLines.reduce((s, x) => s + x.qty, 0);
      const salesValueBeforeOut = baselineLines.reduce((s, x) => s + x.value, 0);
      const dailyAvg = baselineDays > 0 ? soldBeforeOut / baselineDays : 0;
      const estimateStatus: OutOfStockLostProfitItem['estimate_status'] = since === null || stockObservedAt === null
        ? 'STOCKOUT_DATE_UNKNOWN'
        : soldBeforeOut <= 0 || baselineDays <= 0
          ? 'NO_DEMAND_DATA'
          : (salesValueBeforeOut <= 0 && !(p.selling_price > 0))
            ? 'PRICE_UNKNOWN'
            : 'ESTIMATED';
      if (estimateStatus !== 'ESTIMATED') estimateUnknownCount++;
      // Losses are estimates for the selected window and only begin after the first verified zero snapshot.
      const lostUnits = estimateStatus === 'ESTIMATED' ? lostDaysInWindow * dailyAvg : 0;
      const observedSalePrice = soldBeforeOut > 0 ? salesValueBeforeOut / soldBeforeOut : 0;
      const estimateSalePrice = observedSalePrice || p.selling_price || 0;
      // Without a real purchase cost the whole price would count as profit; lost profit is then not calculated.
      const cost = p.purchase_cost || p.current_cost || 0;
      const costKnown = isPlausibleCost(cost, estimateSalePrice);
      if (!costKnown && lostUnits > 0) profitUnknownCount++;
      const unitProfit = costKnown ? Math.max(0, estimateSalePrice - cost) : 0;
      const lostSales = lostUnits * estimateSalePrice;
      const lostProfit = lostUnits * unitProfit;
      const marginPct = estimateSalePrice > 0
        ? Number(((unitProfit / estimateSalePrice) * 100).toFixed(1))
        : 0;

      totalLostSales += lostSales;
      totalLostProfit += lostProfit;
      totalLostUnits += lostUnits;

      resultItems.push({
        id: p.id,
        sku: p.sku,
        name: p.name,
        category: p.category || 'Umumiy',
        unit: p.unit || 'dona',
        purchase_cost: p.purchase_cost || p.current_cost || 0,
        selling_price: p.selling_price || 0,
        unit_profit: unitProfit,
        profit_margin_pct: marginPct,
        daily_sales_avg: Number(dailyAvg.toFixed(3)),
        days_out_of_stock: daysOut,
        out_of_stock_since: since,
        stockout_date_accuracy: p.stockout_started_at ? 'HISTORICAL' : since ? 'OBSERVED' : 'UNKNOWN',
        zero_stock_observed_at: since,
        stock_observed_at: stockObservedAt,
        estimate_status: estimateStatus,
        last_sale_date: p.last_sale_date ?? null,
        lost_units: lostUnits,
        lost_sales_uzs: lostSales,
        lost_profit_uzs: lostProfit,
        source: p.source || 'MANUAL'
      });
    }

    return {
      summary: {
        out_of_stock_count: resultItems.length,
        total_lost_units: totalLostUnits,
        total_lost_sales_uzs: totalLostSales,
        total_lost_profit_uzs: totalLostProfit,
        profit_unknown_count: profitUnknownCount,
        since_unknown_count: sinceUnknownCount,
        estimate_unknown_count: estimateUnknownCount,
        window_days: w.coveredDays
      },
      // Biggest loss first, then the longest out of stock.
      items: resultItems.sort((a, b) => b.lost_profit_uzs - a.lost_profit_uzs || b.lost_sales_uzs - a.lost_sales_uzs || (b.days_out_of_stock ?? -1) - (a.days_out_of_stock ?? -1))
    };
  }

  /**
   * Dispatches real SMS Alert to Administrator's phone with stockout & lost profit summary
   */
  public static sendAdminStockAlertSMS(
    companyId: string, 
    userId: string, 
    userEmail: string, 
    targetPhone?: string
  ) {
    // No SMS gateway is connected: the alert goes to the Telegram bots that receive "stock-out" messages.
    const data = this.getOutOfStockLostProfit(companyId);
    const s = data.summary;
    if (!s.out_of_stock_count) return { success: true, sent: false, message: 'Tugagan tovar yo‘q — ogohlantirish kerak emas.' };
    const money = (v: number) => `${Math.round(v).toLocaleString('ru-RU')} so‘m`;
    const top = [...data.items].sort((a, b) => b.lost_sales_uzs - a.lost_sales_uzs).slice(0, 5);
    const lines = top.map(i => `• ${i.name}: ${i.days_out_of_stock === null ? '0 qoldiq sanasi tasdiqlanmagan' : `0 qoldiq ${i.days_out_of_stock} kun oldin tasdiqlangan`}, ${i.estimate_status === 'ESTIMATED' ? `taxminiy boy berilgan savdo ${money(i.lost_sales_uzs)}` : 'boy berilgan savdo hisoblanmadi — tarix yetarli emas'}`);
    const profitLine = s.profit_unknown_count
      ? `Boy berilgan foyda: hisoblanmadi (${s.profit_unknown_count} ta tovarda kirim narxi yo‘q).`
      : `Boy berilgan foyda: ${money(s.total_lost_profit_uzs)}.`;
    const message = [`Omborda ${s.out_of_stock_count} ta tovarning qoldig‘i 0.`, ...lines, '', `Taxminiy boy berilgan savdo: ${money(s.total_lost_sales_uzs)}.`, `${s.estimate_unknown_count} ta tovarda yetarli sana yoki sotuv tarixi yo‘q.`, profitLine, 'Ta’minotchiga buyurtma bering.'].join('\n');
    const notif = NotificationService.dispatchEvent(companyId, 'STOCKOUT_WARNING', '🚨 Tugagan tovarlar', message, { out_of_stock_count: s.out_of_stock_count, total_lost_sales_uzs: s.total_lost_sales_uzs });
    AuditService.log({ company_id: companyId, user_id: userId, user_email: userEmail, action: 'CREATE', entity: 'Notification', entity_id: notif.id, new_value: { event: 'STOCKOUT_WARNING', count: s.out_of_stock_count }, reason: 'Tugagan tovarlar ogohlantirishi yuborildi' });
    const hasBot = db.find('notification_rules', r => r.company_id === companyId && r.event_type === 'STOCKOUT_WARNING' && r.is_active).length > 0;
    return {
      success: true, sent: hasBot, preview: message,
      message: hasBot
        ? `Ogohlantirish (${s.out_of_stock_count} ta tovar) “Tovar tugashi” xabarini oladigan Telegram botlarga yuborilmoqda.`
        : `Xabar tayyor, lekin “Tovar tugashi” xabarini oladigan bot yo‘q. Sozlamalar → Botlar bo‘limida botga shu turdagi xabarni yoqing.`
    };
  }

  /**
   * Real-time automated sync with 1C / SalesDoc / SmartUp / Linko
   */
  public static async syncIntegratedWarehouse(companyId: string, userId: string, userEmail: string, providerName?: string) {
    // Only a connected integration is used; a requested but unconnected one (e.g. 1C) is an error, not a silent success.
    const dists = distributionIntegrations(companyId).filter(d => d.integration.status === 'CONNECTED' && !d.integration.disabled);
    const dist = providerName ? dists.find(d => d.integration.provider_name.toUpperCase() === providerName.toUpperCase()) : activeDistribution(companyId);
    if (!dist) throw new Error(providerName ? `${providerName} ulanmagan.` : 'Ulangan distributsiya dasturi yo‘q.');
    const integration = dist.integration;
    const provider = integration.provider_name;
    this.ensureProductsWithVelocities(companyId);

    let message: string;
    let syncRes: any;
    if (dist.capabilities.history) {
      // Stock and the last two months are refreshed in the background; older settled months are kept.
      const running = SalesDocHistoryService.isRunning(integration.id);
      if (!running) SalesDocHistoryService.start(companyId, integration.id, userId, integration.config?.history?.complete ? 'recent' : 'full', dist.adapter as any);
      message = running ? `${dist.name} yuklanishi davom etmoqda.` : `${dist.name} qoldiqlari va oxirgi buyurtmalar fonda yangilanmoqda. Bir necha daqiqadan keyin sahifani yangilang.`;
      syncRes = { background: true };
    } else {
      syncRes = await integrationProvider.syncProvider(companyId, provider, userId, userEmail, integration.id);
      message = syncRes.status === 'FAILED' ? `${provider} yangilanmadi: ${(syncRes.errors || []).join('; ')}` : `${provider}: ${syncRes.recordsImported} ta yozuv yangilandi, ${syncRes.recordsFailed} ta o‘tkazib yuborildi.`;
    }

    const now = new Date().toISOString();

    AuditService.log({
      company_id: companyId,
      user_id: userId,
      user_email: userEmail,
      action: 'SYNC',
      entity: 'WarehouseInventorySync',
      entity_id: provider,
      old_value: null,
      new_value: { provider, synced_at: now, result: syncRes },
      reason: message
    });

    const runRate = this.getStockRunRate(companyId);
    const outOfStock = this.getOutOfStockLostProfit(companyId);

    return {
      success: syncRes.status !== 'FAILED',
      message,
      synced_at: now,
      provider,
      runRate,
      outOfStock
    };
  }
}
