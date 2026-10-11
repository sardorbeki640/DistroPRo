import {beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {db} from '../db/database.ts';
import {CashService} from '../services/cash.service.ts';
import {CashPostingService} from '../services/cash-posting.service.ts';
import {integrationProvider} from '../integrations/provider.ts';
import {businessToday} from '../utils/date.ts';

beforeEach(()=>{db.init();db.reset();});
const user={user_id:'u',user_email:'u@x'};
function fixture(){
 db.insert('cash_registers',{id:'reg',company_id:'c',code:'main',name:'Asosiy'} as any);
 db.insert('customers',{id:'sd',company_id:'c',code:'SD-CUST-a0_1004',name:'SalesDoc mijoz',phone:'',credit_limit:0,current_balance:500,status:'ACTIVE',is_active:true,created_at:''} as any);
 db.insert('customers',{id:'local',company_id:'c',code:'MY-7',name:'Ichki mijoz',phone:'',credit_limit:0,current_balance:500,status:'ACTIVE',is_active:true,created_at:''} as any);
 db.insert('customer_balance_transactions',{id:'open-sd',company_id:'c',customer_id:'sd',transaction_type:'DEBIT',debit_amount:500,credit_amount:0,amount:500,date:'2026-01-01',status:'CONFIRMED'} as any);
 db.insert('integrations',{id:'i',company_id:'c',provider_name:'SALESDOC',status:'CONNECTED',config:{payment_types:{OLD_DEBT:{SD_id:'d0_5'},TERMINAL:{SD_id:'d0_9'}}}} as any);
}

test('a Customers-section payment opens today’s cash day, counts in its totals and lowers the debt',()=>{
 fixture();
 const r=CashService.recordDebtCollection({company_id:'c',customer_id:'sd',amount:200,payment_method:'CASH',...user});
 assert.equal(r.cash_day.date,businessToday());
 assert.equal(r.entry.nasiyadan_kirim,200);
 assert.deepEqual(r.entry.customer_ref,{SD_id:'a0_1004'});
 assert.equal(r.sent_to_salesdoc_with_day,true);
 const tx=db.find('cash_transactions',t=>t.order_id===r.entry.id);
 assert.equal(tx.length,1);assert.equal(tx[0].transaction_type,'CREDIT_COLLECTION');
 assert.equal(db.findById('customers','sd')!.current_balance,300);
 assert.equal((db.findById('cash_days',r.cash_day.id) as any).credit_collection,200);
});

test('terminal payment is a terminal row; a closed day refuses instead of losing the money',()=>{
 fixture();
 const r=CashService.recordDebtCollection({company_id:'c',customer_id:'local',amount:50,payment_method:'TERMINAL',...user});
 assert.equal(r.entry.terminal_click,50);assert.equal(r.entry.customer_ref,undefined);assert.equal(r.sent_to_salesdoc_with_day,false);
 db.update('cash_days',r.cash_day.id,{status:'CLOSED'});
 assert.throws(()=>CashService.recordDebtCollection({company_id:'c',customer_id:'local',amount:5,payment_method:'CASH',...user}),/yopilgan/);
});

test('the day is sent to SalesDoc: debt row goes to the client balance, non-SalesDoc customer is skipped',async()=>{
 fixture();
 CashService.recordDebtCollection({company_id:'c',customer_id:'sd',amount:200,payment_method:'CASH',...user});
 const r=CashService.recordDebtCollection({company_id:'c',customer_id:'local',amount:70,payment_method:'CASH',...user});
 const sent:any[]=[];
 // Any distribution system: the common payment capability (postPayment / listDayPayments).
 const adapter:any={postPayment:async(_c:any,p:any)=>{sent.push(p);},listDayPayments:async()=>[]};
 await CashPostingService.save('c',r.cash_day.id,adapter).catch(()=>{});
 const jobs=db.find('integration_transactions',j=>j.company_id==='c');
 assert.equal(jobs.length,1);
 assert.deepEqual(jobs[0].payload.payment.client,{SD_id:'a0_1004'});
 assert.equal(jobs[0].payload.payment.paymentType.SD_id,'d0_5');
 assert.equal(jobs[0].payload.payment.order,undefined);
});

test('a payment already in SalesDoc (local record lost) is recognised and not sent twice; an unreadable SalesDoc blocks sending',async()=>{
 fixture();
 const r=CashService.recordDebtCollection({company_id:'c',customer_id:'sd',amount:200,payment_method:'CASH',...user});
 let sent=0;
 const comment=`Kassa ${r.cash_day.date}; OLD_DEBT; qarz to‘lovi ${r.entry.order_number}`;
 const adapter:any={postPayment:async()=>{sent++;},listDayPayments:async()=>{throw new Error('down');}};
 const blocked=await CashPostingService.save('c',r.cash_day.id,adapter);
 assert.equal(sent,0);assert.match(blocked.message,/tekshirib bo‘lmadi/);
 adapter.listDayPayments=async()=>[{code_1C:'OTHER-ID',comment,amount:200,client:{SD_id:'a0_1004'}}];
 const res=await CashPostingService.save('c',r.cash_day.id,adapter);
 assert.equal(sent,0);assert.equal(res.confirmed,1);
 assert.equal(db.find('integration_transactions',j=>j.company_id==='c')[0].status,'PROCESSED');
});

test('a switched-off integration cannot be synced',async()=>{
 fixture();
 db.update('integrations','i',{disabled:true,status:'DISCONNECTED'});
 await assert.rejects(integrationProvider.syncProvider('c','SALESDOC','u','u@x'),/o‘chirilgan/);
});
