import {beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {db} from '../db/database.ts';
import {SalesDocAdapter} from '../integrations/adapters/salesdoc.adapter.ts';
import {CashPostingService} from '../services/cash-posting.service.ts';
import {CashService} from '../services/cash.service.ts';
import {ForecastService} from '../services/forecast.service.ts';
beforeEach(()=>{db.init();db.reset();});
function fixture(){
 db.insert('integrations',{id:'i',company_id:'c',provider_name:'SALESDOC',status:'CONNECTED',config:{payment_types:{CASH:{SD_id:'UZS'},TERMINAL:{SD_id:'UZS'}}}} as any);
 db.insert('cash_days',{id:'day',company_id:'c',status:'OPEN',date:'2026-09-29',opening_balance:0} as any);
 db.insert('daily_order_entries',{id:'row',company_id:'c',cash_day_id:'day',customer_id:'cust',order_number:'1',sale_amount:100,cash_payment:60,terminal_click:10,integration_id:'i',external_order_id:'order',customer_ref:{SD_id:'client'},order_ref:{SD_id:'order'},payment_type_ref:{SD_id:'UZS'}} as any);
}
test('pagination visits all pages and preserves zero totals, stable IDs and returns',async()=>{
 const a=new SalesDocAdapter();let pages:number[]=[];
 a.executeSalesDocMethod=async(_c,_m,p)=>{pages.push(p!.page);return {pagination:{total:2},result:{order:[{SD_id:String(p!.page),status:3,totalSummaAfterDiscount:0,totalSumma:100,client:{SD_id:'c'},dateDocument:'2026-09-01',orderProducts:[{product:{SD_id:'p',code_1C:'shared'},quantity:2,returned:1,price:5,summa:10}],totalReturnsSumma:5}]}};};
 const rows=await a.importOrders({});assert.deepEqual(pages,[1,2]);assert.equal(rows[0].totalAmount,0);assert.equal(rows[0].returnAmount,5);assert.equal(rows[0].items?.[0].sku,'p');assert.equal(rows[0].items?.[0].quantity,2);
});
test('incomplete and repeated history fails rather than publishing partial success',async()=>{
 const a=new SalesDocAdapter();a.executeSalesDocMethod=async()=>({pagination:{total:3},result:{order:[{SD_id:'1'}]}});
 await assert.rejects(()=>a.readAll({},'getOrder','order'),/takrorladi/);
});
test('cash save sends exact payments once, with source references, without overwriting balances',async()=>{
 fixture();const a=new SalesDocAdapter();const payloads:any[]=[];
 a.executeSalesDocMethod=async(_c,m,_p,data)=>{assert.equal(m,'setPayment');payloads.push(data.payment[0]);return {completed:1,error:0};};a.readAll=async()=>[];
 assert.equal((await CashPostingService.save('c','day',a)).confirmed,2);
 assert.equal((await CashPostingService.save('c','day',a)).confirmed,2);
 assert.equal(payloads.length,2);assert.deepEqual(payloads.map(p=>p.amount),[60,10]);assert.deepEqual(payloads[0].client,{SD_id:'client'});
 assert.throws(()=>CashService.updateRegistryOrder('row','c',{cash_payment:0},'u','u@test'),/qulflangan/);
});
test('timeout is durable and never blindly re-sends; reconciliation confirms receipt',async()=>{
 fixture();const a=new SalesDocAdapter();let calls=0;
 a.executeSalesDocMethod=async()=>{calls++;throw Error('timeout');};a.readAll=async()=>[];
 const result=await CashPostingService.save('c','day',a);assert.equal(result.pending,2);
 a.readAll=async()=>[];await CashPostingService.save('c','day',a);assert.equal(calls,2);
 a.readAll=async()=>db.getTable('integration_transactions').map(t=>t.payload.payment);
 assert.equal((await CashPostingService.save('c','day',a)).confirmed,2);assert.equal(calls,2);
});
test('partial rejection cannot appear as confirmed and tenant access is enforced',async()=>{
 fixture();const a=new SalesDocAdapter();a.executeSalesDocMethod=async()=>({completed:0,error:1});a.readAll=async()=>[];
 assert.equal((await CashPostingService.save('c','day',a)).confirmed,0);
 await assert.rejects(()=>CashPostingService.save('other','day',a),/topilmadi/);
});
test('legacy home payment does not create a separate SalesDoc payment method',async()=>{
 fixture();db.update('daily_order_entries','row',{uy_oplata:10});const a=new SalesDocAdapter();
 await CashPostingService.save('c','day',a);
 assert.deepEqual(db.find('integration_transactions',()=>true).map(t=>(t.payload as any).method).sort(),['CASH','TERMINAL']);
});
test('100 calendar days, delivered sales only, real product identity and fractional demand',()=>{
 db.insert('integrations',{id:'i',company_id:'c',provider_name:'SALESDOC',config:{forecast_days:100}} as any);
 db.insert('products',{id:'p',sku:'external',company_id:'c',is_active:true,stock_quantity:28,purchase_cost:0,selling_price:10} as any);
 const day=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Tashkent'});
 db.insert('sales_orders',{id:'o',company_id:'c',status:'DELIVERED',order_date:day} as any);
 db.insert('sales_orders',{id:'pending',company_id:'c',status:'PENDING',order_date:day} as any);
 db.insert('sales_order_items',{id:'1',sales_order_id:'o',product_id:'external',quantity:2} as any);
 db.insert('sales_order_items',{id:'2',sales_order_id:'pending',product_id:'p',quantity:1000} as any);
 ForecastService.calculateHistoricalSalesVelocity('c');
 const result=ForecastService.getStockRunRate('c');assert.equal(result.items[0].effective_daily_sales,0.02);assert.equal(result.items[0].days_remaining,1400);
});
