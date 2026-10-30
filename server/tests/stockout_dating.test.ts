import {beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {db} from '../db/database.ts';
import {ForecastService} from '../services/forecast.service.ts';
import {addDays,businessToday} from '../utils/date.ts';

process.env.JWT_SECRET ||= 'test-secret-for-stockout-0123456789';
beforeEach(()=>{db.init();db.reset();});

const today=businessToday();
const product=(id:string,extra:any)=>db.insert('products',{id,company_id:'c',source_integration_id:'i',sku:id,name:id,is_active:true,stock_quantity:0,purchase_cost:50,selling_price:100,...extra} as any);

test('stock-out duration starts at a verified zero snapshot, and last-sale dates alone never invent a stock-out',()=>{
 // 30-day forecast window fully covered by loaded history.
 db.insert('integrations',{id:'i',company_id:'c',provider_name:'SALESDOC',status:'CONNECTED',config:{forecast_days:30,history:{from:addDays(today,-100)}}} as any);
 product('sold-out',{last_sale_date:addDays(today,-20),zero_stock_observed_at:addDays(today,-10),stock_observed_at:today});
 product('written-off',{last_sale_date:addDays(today,-20),last_in_stock_at:addDays(today,-2),zero_stock_observed_at:addDays(today,-2),stock_observed_at:today});
 product('never-seen',{last_sale_date:addDays(today,-2)});
 product('long-gone',{last_sale_date:addDays(today,-200),zero_stock_observed_at:addDays(today,-200),stock_observed_at:today});
 product('in-stock',{stock_quantity:5,last_sale_date:addDays(today,-1)});
 db.insert('sales_orders',{id:'baseline-order',company_id:'c',source_integration_id:'i',status:'DELIVERED',order_date:addDays(today,-20)} as any);
 db.insert('sales_order_items',{id:'baseline-line',sales_order_id:'baseline-order',product_id:'sold-out',sku:'sold-out',quantity:40,unit_price:100,total_amount:4000} as any);

 const r=ForecastService.getOutOfStockLostProfit('c');
 const by=Object.fromEntries(r.items.map(i=>[i.id,i]));
 assert.equal(by['in-stock'],undefined,'a product in stock is not listed');

 assert.equal(by['sold-out'].days_out_of_stock,10);
 assert.equal(by['sold-out'].out_of_stock_since,addDays(today,-10));
 // 40 sold in the 30-day baseline before the first zero observation; only the following 10 confirmed days count.
 assert.equal(by['sold-out'].days_out_of_stock,10);
 assert.equal(by['sold-out'].daily_sales_avg,Number((40/30).toFixed(3)));
 assert.equal(by['sold-out'].lost_units,40/30*10);
 assert.equal(by['sold-out'].lost_sales_uzs,40/30*10*100);
 assert.equal(by['sold-out'].lost_profit_uzs,40/30*10*50);

 assert.equal(by['written-off'].days_out_of_stock,2,'first zero observation, not the last sale, is used');
 assert.equal(by['never-seen'].days_out_of_stock,null,'a sale date alone cannot establish an empty-stock date');
 assert.equal(by['never-seen'].estimate_status,'STOCKOUT_DATE_UNKNOWN');
 assert.equal(by['never-seen'].lost_profit_uzs,0);
 assert.equal(by['long-gone'].days_out_of_stock,200);
 assert.equal(by['long-gone'].estimate_status,'NO_DEMAND_DATA','the selected forecast window does not contain a baseline before the old stock-out');
 assert.equal(by['long-gone'].lost_units,0,'missing history is not turned into fabricated lost sales');
 assert.equal(r.summary.since_unknown_count,1);
});

test('a connected integration with no loaded history has no forecast coverage',()=>{
 db.insert('integrations',{id:'i',company_id:'c',provider_name:'SALESDOC',status:'CONNECTED',config:{forecast_days:30}} as any);
 product('p',{source_integration_id:'i',stock_quantity:5});
 db.insert('sales_orders',{id:'o',company_id:'c',source_integration_id:'i',status:'DELIVERED',order_date:today} as any);
 db.insert('sales_order_items',{id:'line',sales_order_id:'o',product_id:'p',sku:'p',quantity:100} as any);
 ForecastService.calculateHistoricalSalesVelocity('c');
 const result=ForecastService.getStockRunRate('c');
 assert.equal(result.history.covered_days,0);
 assert.equal(result.items[0].effective_daily_sales,0);
 assert.match(result.history.warning,/tarixi yuklanmagan/i);
});

test('legacy zero-stock products use their last confirmed inventory snapshot and count elapsed days through today',()=>{
 db.insert('integrations',{id:'i',company_id:'c',provider_name:'SALESDOC',status:'CONNECTED',config:{forecast_days:30,history:{from:addDays(today,-100)}}} as any);
 product('legacy-zero',{stock_observed_at:addDays(today,-1),zero_stock_observed_at:null,last_in_stock_at:null,last_sale_date:null});
 const result=ForecastService.getOutOfStockLostProfit('c');
 assert.equal(result.items[0].out_of_stock_since,addDays(today,-1));
 assert.equal(result.items[0].days_out_of_stock,1);
});
