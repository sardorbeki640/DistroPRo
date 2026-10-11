import {beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {db} from '../db/database.ts';
import {CustomerBalanceService} from '../services/customer_balance.service.ts';

process.env.JWT_SECRET ||= 'test-secret-for-customer-report-0123456789';
beforeEach(()=>{db.init();db.reset();});

/** Customers with a mixed ledger: debits, payments, returns, a reversed row, rows before and inside the period. */
function seed(customers:number,perCustomer:number){
 const cust:any[]=[];const tx:any[]=[];
 db.insert('agents',{id:'ag1',company_id:'c1',code:'A1',full_name:'Agent',status:'ACTIVE'} as any);
 db.insert('territories',{id:'t1',company_id:'c1',name:'Hudud'} as any);
 for(let i=0;i<customers;i++){
  cust.push({id:`cu${i}`,company_id:'c1',code:`K${i}`,name:`Mijoz ${i}`,phone:'',agent_id:'ag1',territory_id:'t1',credit_limit:i%3?1000:0,debt_alert_threshold:i%5?500:0,status:'ACTIVE'});
  for(let j=0;j<perCustomer;j++){
   const ref=['SALE','PAYMENT','RETURN','ADJUSTMENT'][j%4];
   tx.push({id:`tx${i}-${j}`,company_id:'c1',customer_id:`cu${i}`,amount:100+j*7+i,transaction_type:ref==='SALE'?'DEBIT':'CREDIT',reference_type:ref,
    date:`2026-0${1+(j%9)}-1${j%10}`,created_at:'2026-01-01T00:00:00.000Z',status:j===3?'REVERSED':'CONFIRMED'});
  }
 }
 db.upsertMany('customers',cust as any);db.upsertMany('customer_balance_transactions',tx as any);
}

test('customer report matches the per-customer ledger rules',()=>{
 seed(40,12);
 const filter={fromDate:'2026-03-01',toDate:'2026-07-31'};
 const report=CustomerBalanceService.getCustomerBalanceReport('c1',filter);
 assert.equal(report.length,40);
 for(const r of report){
  const s=CustomerBalanceService.getPeriodSummary(r.id,filter.fromDate,filter.toDate);
  assert.equal(r.opening_balance,s.opening_balance,`opening ${r.id}`);
  assert.equal(r.closing_balance,s.closing_balance,`closing ${r.id}`);
  const txs=db.find('customer_balance_transactions',(t:any)=>t.customer_id===r.id&&t.status!=='REVERSED'&&t.date>=filter.fromDate&&t.date<=filter.toDate);
  const sum=(ref:string)=>txs.filter((t:any)=>t.reference_type===ref).reduce((a:number,t:any)=>a+t.amount,0);
  assert.deepEqual([r.sales,r.payments,r.returns,r.adjustments],[sum('SALE'),sum('PAYMENT'),sum('RETURN'),sum('ADJUSTMENT')]);
  assert.equal(r.agent_name,'Agent');assert.equal(r.territory_name,'Hudud');
 }
 const agent=CustomerBalanceService.getAgentDebtSummary('ag1',filter.fromDate,filter.toDate)[0];
 let debt=0;for(const r of report){const b=CustomerBalanceService.calculateLedgerBalance('c1',r.id,filter.toDate);if(b>0)debt+=b;}
 assert.equal(agent.total_debt,debt);
 assert.equal(agent.total_sales,report.reduce((a,r)=>a+r.sales,0));
 const terr=CustomerBalanceService.getTerritoryDebtSummary('t1',filter.fromDate,filter.toDate)[0];
 assert.equal(terr.total_debt,debt);
});

test('customer report stays fast on a real-sized ledger (5k customers, 75k rows)',()=>{
 seed(5000,15);
 const t=Date.now();
 const report=CustomerBalanceService.getCustomerBalanceReport('c1',{});
 const ms=Date.now()-t;
 assert.equal(report.length,5000);
 assert.ok(ms<3000,`took ${ms} ms`);
});
