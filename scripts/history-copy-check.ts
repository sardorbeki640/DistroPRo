// Loads the full SalesDoc order history into the database in FINANCE_DATA_DIR (use a COPY) and reports coverage.
// Read-only towards SalesDoc: login, getProduct, getStock, getPriceType, getPrice, getOrder.
// Usage: FINANCE_DATA_DIR=<folder with a copy of finance_db.json> npx tsx scripts/history-copy-check.ts
import { db } from '../server/db/database.ts';
import { SalesDocHistoryService } from '../server/services/salesdoc-history.service.ts';
import { ForecastService } from '../server/services/forecast.service.ts';

if (!process.env.FINANCE_DATA_DIR) throw new Error('FINANCE_DATA_DIR ga nusxa papkasini bering; asosiy baza bilan ishlatmang.');
const integration = db.findOne('integrations', i => /SALESDOC/.test(i.provider_name.toUpperCase()));
if (!integration) throw new Error('SalesDoc integratsiyasi topilmadi');
const t0 = Date.now();
const timer = setInterval(() => {
  const h = SalesDocHistoryService.getState(integration.id);
  console.log(`[${Math.round((Date.now() - t0) / 1000)}s] ${h?.current || '-'} · oylar ${h?.months_done} · buyurtmalar ${h?.orders}`);
}, 15000);
try {
  const result = await SalesDocHistoryService.sync(integration.company_id, integration.id, 'history-check');
  console.log('RESULT', JSON.stringify({ status: result.status, orders: result.recordsImported, skipped: result.recordsFailed }));
} catch (err: any) {
  console.log('FAILED', err.message);
} finally {
  clearInterval(timer);
}
const h = SalesDocHistoryService.getState(integration.id)!;
console.log('HISTORY', JSON.stringify({ ...h, chunks: undefined, errors: h.errors.slice(0, 5) }));
console.log('MONTHS', Object.entries(h.chunks).map(([m, c]) => `${m}:${c.orders}`).join(' '));
const orders = db.find('sales_orders', o => !!o.external_id);
console.log('ORDERS by status', JSON.stringify(orders.reduce((m: any, o) => (m[o.status] = (m[o.status] || 0) + 1, m), {})), 'cogs', JSON.stringify(orders.reduce((m: any, o) => (m[o.cogs_status || 'legacy'] = (m[o.cogs_status || 'legacy'] || 0) + 1, m), {})));
const run = ForecastService.getStockRunRate(integration.company_id);
console.log('FORECAST', JSON.stringify(run.history));
for (const item of run.items.filter(i => /marlena/i.test(i.name)).slice(0, 5)) {
  console.log('ITEM', item.name, JSON.stringify({ stock: item.stock_quantity, daily: item.effective_daily_sales, days: item.days_remaining, qty: item.velocity_quantity, saleDays: item.velocity_sale_days, confidence: item.confidence }));
}
console.log(`TOTAL ${Math.round((Date.now() - t0) / 1000)}s`);
