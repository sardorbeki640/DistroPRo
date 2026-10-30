import { test, beforeEach } from 'node:test';
import { businessToday } from '../utils/date.ts';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../db/database.ts';
import { ForecastService } from '../services/forecast.service.ts';
import { AnalyticsService } from '../services/analytics.service.ts';
import { DistributionAdapter } from '../integrations/adapters/distribution.adapter.ts';
import { NotificationService } from '../services/notification.service.ts';
import { SetupService } from '../services/setup.service.ts';
import { AuthService } from '../services/auth.service.ts';
import { initialSchemaMigration } from '../db/migrations/001_initial_schema.ts';
import { seedInitialDataMigration } from '../db/migrations/002_seed_initial_data.ts';
beforeEach(()=>{db.init();db.reset();});
test('failed transaction restores disk and memory; later writes still commit',()=>{
 assert.throws(()=>db.transaction(()=>{db.insert('companies',{id:'rejected'} as any);throw new Error('rollback');}));
 assert.equal(db.findById('companies','rejected'),null);
 assert.equal(db.readPersisted('companies').length,0);
 db.insert('companies',{id:'accepted'} as any);
 assert.equal(db.readPersisted('companies')[0].id,'accepted');
});
test('nested rollback commits only accepted records',()=>{
 db.transaction(()=>{db.insert('companies',{id:'outer'} as any);try{db.transaction(()=>{db.insert('companies',{id:'inner'} as any);throw Error('no');});}catch{}});
 assert.deepEqual(db.getTable('companies').map(c=>c.id),['outer']);
});
test('zero sales and zero shortage days do not invent lost profit',()=>{
 db.insert('products',{id:'p',company_id:'c',is_active:true,stock_quantity:0,daily_sales_avg:0,out_of_stock_days:0,purchase_cost:50,selling_price:100} as any);
 assert.equal(ForecastService.getOutOfStockLostProfit('c').summary.total_lost_profit_uzs,0);
});
test('all registers contribute, bank is unknown and historical snapshot fails explicitly',()=>{
 const date=businessToday();
 for(const [register,amount] of [['a',100],['b',200]] as const) db.insert('cash_days',{id:register,register_id:register,company_id:'c',date,status:'CLOSED',actual_closing_balance:amount,terminal_payment:1000000} as any);
 const report=AnalyticsService.getBalanceSheet('c',date);
 assert.equal(report.complete,false);
 assert.equal(report.assets.cash_in_registers,300);
 assert.equal(report.assets.bank_balances,null);
 assert.equal(report.net_equity,null);
 assert.throws(()=>AnalyticsService.getBalanceSheet('c','2020-01-01'),/Tarixiy/);
});
test('default balance snapshot excludes future-dated cash and expenses',()=>{
 const today=businessToday();
 db.insert('cash_days',{id:'future-day',register_id:'main',company_id:'c',date:'9999-12-31',status:'CLOSED',actual_closing_balance:900,cash_inflow:900,cash_outflow:400} as any);
 db.insert('expenses',{id:'future-expense',company_id:'c',date:'9999-12-31',status:'CONFIRMED',amount:700} as any);
 const report=AnalyticsService.getBalanceSheet('c');
 assert.equal(report.as_of_date,today);
 assert.equal(report.cashflow.total_inflow,0);
 assert.equal(report.cashflow.total_outflow,0);
});
test('unconfigured SMS never reports delivery',()=>{
 // The stock alert goes to Telegram bots; with none subscribed it must not claim delivery.
 const alert=ForecastService.sendAdminStockAlertSMS('c','u','test@example.test');
 assert.equal(alert.sent,false);
 assert.doesNotMatch(alert.message,/yuborilmoqda/);
 const notification=NotificationService.queueNotification({company_id:'c',channel_type:'SMS',title:'test',content:'test'});
 assert.equal(notification.status,'PENDING');assert.equal(notification.sent_at,null);
});
test('unconfigured ERP cannot report success',async()=>{
 const adapter=new DistributionAdapter();
 assert.equal((await adapter.testConnection({})).ok,false);
 await assert.rejects(()=>adapter.exportData({type:'test',data:[]} as any,{}),/ulanmagan/);
});
test('owner setup disables seeded users and cannot run twice',async()=>{
 await initialSchemaMigration.up();await seedInitialDataMigration.up();
 SetupService.createOwner('owner@example.test','Test-only-password-2026!');
 assert.equal(SetupService.required(),false);
 assert.equal(db.findById('users','usr-superadmin-01')?.status,'INACTIVE');
 const login=await AuthService.login('owner@example.test','Test-only-password-2026!');
 assert.equal(login.user.is_super_admin,true);
 assert.throws(()=>SetupService.createOwner('second@example.test','Another-test-password!'));
});
test('deactivated accounts cannot reuse issued tokens',async()=>{
 await initialSchemaMigration.up();await seedInitialDataMigration.up();
 const login=await AuthService.login('cashier@distro.uz','Cashier123!');
 db.update('users',login.user.id,{status:'INACTIVE'});
 assert.throws(()=>AuthService.verifyToken(login.token));
});
