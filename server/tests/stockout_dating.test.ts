import {beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {db} from '../db/database.ts';
import {ForecastService} from '../services/forecast.service.ts';
import {addDays,businessToday} from '../utils/date.ts';

process.env.JWT_SECRET ||= 'test-secret-for-stockout-0123456789';
beforeEach(()=>{db.init();db.reset();});

const today=businessToday();
const product=(id:string,extra:any)=>db.insert('products',{id,company_id:'c',sku:id,name:id,is_active:true,stock_quantity:0,purchase_cost:50,selling_price:100,...extra} as any);

test('stock-outs are dated from the last sale or the last in-stock sighting, not "1 day" each sync',()=>{
 // 30-day forecast window fully covered by loaded history.
 db.insert('integrations',{id:'i',company_id:'c',provider_name:'SALESDOC',status:'CONNECTED',config:{forecast_days:30,history:{from:addDays(today,-100)}}} as any);
 product('sold-out',{last_sale_date:addDays(today,-10),velocity_quantity:40,daily_sales_avg:40/30,out_of_stock_days:1});
 product('written-off',{last_sale_date:addDays(today,-20),last_in_stock_at:addDays(today,-2),velocity_quantity:0});
 product('never-seen',{});
 product('long-gone',{last_sale_date:addDays(today,-200),velocity_quantity:0});
 product('in-stock',{stock_quantity:5,last_sale_date:addDays(today,-1)});

 const r=ForecastService.getOutOfStockLostProfit('c');
 const by=Object.fromEntries(r.items.map(i=>[i.id,i]));
 assert.equal(by['in-stock'],undefined,'a product in stock is not listed');

 assert.equal(by['sold-out'].days_out_of_stock,10);
 assert.equal(by['sold-out'].out_of_stock_since,addDays(today,-10));
 // 40 sold in the 20 in-stock days of the 30-day window: 2 a day, 10 days lost, 50 profit each.
 assert.equal(by['sold-out'].daily_sales_avg,2);
 assert.equal(by['sold-out'].lost_units,20);
 assert.equal(by['sold-out'].lost_profit_uzs,1000);

 assert.equal(by['written-off'].days_out_of_stock,2,'seen in stock after the last sale');
 assert.equal(by['never-seen'].days_out_of_stock,null);
 assert.equal(by['never-seen'].lost_profit_uzs,0);
 assert.equal(by['long-gone'].days_out_of_stock,200);
 assert.equal(by['long-gone'].lost_units,0,'no sales in the window: nothing invented');
 assert.equal(r.summary.since_unknown_count,1);
});
