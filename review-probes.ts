import { db } from './server/db/database.ts';
import { AnalyticsService } from './server/services/analytics.service.ts';
import { ForecastService } from './server/services/forecast.service.ts';
// Synthetic data only; no calls to external services and no persisted business changes.
db.init();
const data = db.getData() as any;
for (const key of Object.keys(data)) if (Array.isArray(data[key])) data[key] = [];
let saved = '';
db.persist = () => { saved = JSON.stringify(data); };
data.cash_days.push({id:'test-day',company_id:'test',date:'2026-09-27',status:'CLOSED',terminal_payment:1000000,click_payment:0,actual_closing_balance:0});
const balance = AnalyticsService.getBalanceSheet('test','2020-01-01');
console.log('BALANCE_WITH_FUTURE_RECEIPT', JSON.stringify(balance));
data.products.push({id:'test-product',company_id:'test',sku:'TEST',name:'Synthetic',is_active:true,stock_quantity:0,daily_sales_avg:0,out_of_stock_days:0,purchase_cost:50,selling_price:100});
console.log('ZERO_SALES_FORECAST', JSON.stringify(ForecastService.getOutOfStockLostProfit('test').items));
try { db.transaction(() => {db.insert('companies',{id:'rollback-test',name:'Synthetic'} as any);throw new Error('Abort');}); } catch {}
console.log('ROLLBACK_MEMORY',db.findById('companies','rollback-test') !== null);
console.log('ROLLBACK_LAST_PERSISTED',JSON.parse(saved).companies.some((c:any)=>c.id==='rollback-test'));
