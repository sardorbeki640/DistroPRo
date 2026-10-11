import {beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {db} from '../db/database.ts';
import {CashService} from '../services/cash.service.ts';
import {AnalyticsService} from '../services/analytics.service.ts';

process.env.JWT_SECRET ||= 'test-secret-for-bank-deposit-0123456789';
beforeEach(()=>{db.init();db.reset();});
const who={user_id:'u',user_email:'u@x'};

function dayWithCash(){
 db.insert('companies',{id:'c',name:'C'} as any);
 db.insert('cash_days',{id:'d1',company_id:'c',register_id:'r',date:'2026-09-30',status:'OPEN',opening_balance:1000000} as any);
 db.insert('cash_transactions',{id:'s1',company_id:'c',cash_day_id:'d1',transaction_type:'SALE_PAYMENT',amount:4000000,payment_method:'CASH',description:'',created_by:'u',created_at:'',updated_at:''} as any);
 CashService.recalculateCashDayTotals('d1');
}

test('inkassa lowers the cash in the register, is not an expense; only the bank fee is',()=>{
 dayWithCash();
 const pnlBefore=AnalyticsService.getProfitAndLoss('c','2026-09-01','2026-09-30');
 const t=CashService.recordBankDeposit({company_id:'c',cash_day_id:'d1',amount:3000000,bank_name:'Kapitalbank',receipt_no:'A-17',fee:15000,...who});
 assert.equal(t.transfer_kind,'BANK_DEPOSIT');
 assert.equal(db.findById('cash_days','d1')!.calculated_closing_balance,1000000+4000000-3000000,'register cash down by the deposit only');

 const expenses=db.find('expenses',e=>e.status==='CONFIRMED');
 assert.equal(expenses.length,1,'the commission is the only expense');
 assert.equal(expenses[0].amount,15000);
 assert.equal(expenses[0].payment_method,'BANK_TRANSFER','paid by the bank, not from the register');

 const pnl=AnalyticsService.getProfitAndLoss('c','2026-09-01','2026-09-30');
 assert.equal(pnl.total_operating_expenses-pnlBefore.total_operating_expenses,15000,'profit falls by the commission, not by the deposit');

 const bs=AnalyticsService.getBalanceSheet('c');
 assert.equal(bs.cashflow.breakdown.bank_deposits,3000000);
 assert.ok(bs.cashflow.total_outflow<3000000,'the deposit is not counted as an outflow');
 assert.equal(CashService.getDailyFilesList('c')[0].bank_deposits_total,3000000);
});

test('a mistaken inkassa is removed with its fee; checks on input',()=>{
 dayWithCash();
 assert.throws(()=>CashService.recordBankDeposit({company_id:'c',cash_day_id:'d1',amount:0,bank_name:'X bank',...who}),/musbat/);
 assert.throws(()=>CashService.recordBankDeposit({company_id:'c',cash_day_id:'d1',amount:100,bank_name:'',...who}),/Bank/);
 assert.throws(()=>CashService.recordBankDeposit({company_id:'c',cash_day_id:'d1',amount:100,bank_name:'X bank',fee:100,...who}),/komissiya/);
 const t=CashService.recordBankDeposit({company_id:'c',cash_day_id:'d1',amount:2000000,bank_name:'X bank',fee:10000,...who});
 CashService.deleteBankDeposit('c',t.id,'u','u@x');
 assert.equal(db.findById('cash_transactions',t.id),null);
 assert.equal(db.find('expenses',e=>e.status==='CONFIRMED').length,0,'fee cancelled');
 assert.equal(db.find('cash_transactions',x=>x.transaction_type==='EXPENSE').length,0,'fee cash-day record removed');
 assert.equal(db.findById('cash_days','d1')!.calculated_closing_balance,5000000);
 db.update('cash_days','d1',{status:'CLOSED'} as any);
 assert.throws(()=>CashService.recordBankDeposit({company_id:'c',cash_day_id:'d1',amount:100,bank_name:'X bank',...who}),/ochiq/);
});
