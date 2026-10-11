import {beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {db} from '../db/database.ts';
import {CashService} from '../services/cash.service.ts';
import {BotService} from '../services/bot.service.ts';
import {TelegramService,escapeHtml} from '../services/telegram.service.ts';
import {NotificationService} from '../services/notification.service.ts';

process.env.JWT_SECRET ||= 'test-secret-for-cashday-bots-0123456789';
beforeEach(()=>{db.init();db.reset();});
const TOKEN='123456789:AAHfakeTokenForTests_abcdefghijklmnopq';

function openDay(status='OPEN'){
 db.insert('cash_days',{id:'d1',company_id:'c',register_id:'r',date:'2026-09-30',status,opening_balance:0} as any);
 db.insert('customers',{id:'k1',company_id:'c',code:'K1',name:'Mijoz',current_balance:500,status:'ACTIVE'} as any);
 db.insert('daily_order_entries',{id:'e1',company_id:'c',cash_day_id:'d1',order_number:'1',customer_id:'k1',sale_amount:500} as any);
 db.insert('cash_transactions',{id:'t1',company_id:'c',cash_day_id:'d1',transaction_type:'CREDIT_SALE',amount:500,payment_method:'OTHER',description:'',created_by:'u',created_at:'',updated_at:''} as any);
 db.insert('customer_balance_transactions',{id:'l1',company_id:'c',customer_id:'k1',transaction_type:'DEBIT',amount:500,balance_after:500,reference_type:'SALE',reference_id:'e1',date:'2026-09-30',status:'CONFIRMED',created_at:''} as any);
 db.insert('customer_balance_transactions',{id:'l0',company_id:'c',customer_id:'k1',transaction_type:'DEBIT',amount:200,balance_after:200,reference_type:'SALE',reference_id:'other',date:'2026-09-01',status:'CONFIRMED',created_at:''} as any);
}

test('an open cash day is deleted with its entries; its ledger rows are reversed and the balance recomputed',()=>{
 openDay();
 db.insert('integration_transactions',{id:'p1',company_id:'c',status:'FAILED',payload:{dayId:'d1'}} as any);
 const r=CashService.deleteCashDay('c','d1','u','u@x','noto‘g‘ri sana');
 assert.equal(db.findById('cash_days','d1'),null);
 assert.equal(db.find('daily_order_entries',()=>true).length,0);
 assert.equal(db.find('cash_transactions',()=>true).length,0);
 assert.equal(db.findById('integration_transactions','p1'),null);
 assert.equal(db.findById('customer_balance_transactions','l1')!.status,'REVERSED');
 assert.equal(db.findById('customer_balance_transactions','l0')!.status,'CONFIRMED','other days untouched');
 assert.equal(db.findById('customers','k1')!.current_balance,200);
 assert.equal(r.ledger_reversed,1);
 assert.ok(r.backup,'a backup is taken first');
});

test('deleting is refused when it would leave things out of step',()=>{
 openDay();
 assert.throws(()=>CashService.deleteCashDay('c','d1','u','u@x',''),/sababini/);
 db.insert('integration_transactions',{id:'p2',company_id:'c',status:'PROCESSED',payload:{dayId:'d1'}} as any);
 assert.throws(()=>CashService.deleteCashDay('c','d1','u','u@x','xato'),/distribyutor tizimiga yuborilgan/);
 assert.ok(db.findById('cash_days','d1'),'nothing deleted');
 db.delete('integration_transactions','p2');
 db.update('cash_days','d1',{status:'CLOSED'} as any);
 assert.throws(()=>CashService.deleteCashDay('c','d1','u','u@x','xato'),/ochiq/);
 assert.throws(()=>CashService.deleteCashDay('other','d1','u','u@x','xato'),/topilmadi/);
});

/** A fake Telegram: records sent messages; chat "bad" does not exist. */
function fakeTelegram(){
 const sent:any[]=[];
 TelegramService.fetchImpl=(async(url:string,init:any)=>{
  const method=String(url).split('/').pop();const body=JSON.parse(init.body||'{}');
  const reply=(o:any)=>({json:async()=>o,status:o.ok?200:400}) as any;
  if(!String(url).includes(TOKEN))return reply({ok:false,error_code:401,description:'Unauthorized'});
  if(method==='getMe')return reply({ok:true,result:{id:1,first_name:'Distro',username:'distro_test_bot'}});
  if(method==='getUpdates')return reply({ok:true,result:[{message:{chat:{id:555,type:'private',first_name:'Ali'}}},{my_chat_member:{chat:{id:-100777,type:'supergroup',title:'Rahbariyat'}}}]});
  if(method==='sendMessage'){if(body.chat_id==='bad')return reply({ok:false,error_code:400,description:'Bad Request: chat not found'});sent.push(body);return reply({ok:true,result:{}});}
  return reply({ok:false,error_code:404,description:'Not Found'});
 }) as any;
 return sent;
}

test('a bot is connected, finds its chats, receives subscribed events and the daily report',async()=>{
 const sent=fakeTelegram();
 const user={id:'u',email:'u@x'};
 const found=await BotService.findChats('c',{bot_token:TOKEN});
 assert.equal(found.bot.username,'distro_test_bot');
 assert.deepEqual(found.chats.map(c=>c.id).sort(),['-100777','555']);
 await assert.rejects(()=>BotService.save('c',user,{name:'x',bot_token:'123:short',chat_id:'555',events:[]}),/token/i);

 const bot=await BotService.save('c',user,{name:'Rahbar',bot_token:TOKEN,chat_id:'-100777',events:['CASH_DAY_CLOSED','DAILY_REPORT','NOT_A_TYPE'],daily_report_hour:20});
 assert.deepEqual(bot.events.sort(),['CASH_DAY_CLOSED','DAILY_REPORT']);
 assert.equal(bot.token_masked,'123456789:••••nopq');
 const raw=JSON.stringify((db as any).sql.prepare("SELECT data FROM rows WHERE tbl='notification_channels'").all());
 assert.ok(!raw.includes(TOKEN),'token encrypted on disk');

 NotificationService.dispatchEvent('c','CASH_DAY_CLOSED','Kassa yopildi',`Yopdi: ${escapeHtml('<Ali & Co>')}`);
 NotificationService.dispatchEvent('c','CASH_CLOSING_DISCREPANCY','Farq','not subscribed');
 const r=await BotService.deliverPending();
 assert.equal(r.sent,1);
 assert.equal(sent.length,1);
 assert.equal(sent[0].chat_id,'-100777');
 assert.match(sent[0].text,/&lt;Ali &amp; Co&gt;/);

 // Daily report: queued once after the hour, not before, not twice.
 BotService.queueDailyReports(new Date('2026-10-01T10:00:00Z')); // 15:00 Tashkent
 assert.equal(db.find('notifications',n=>n.title.includes('Kunlik')).length,0);
 BotService.queueDailyReports(new Date('2026-10-01T15:30:00Z')); // 20:30 Tashkent
 BotService.queueDailyReports(new Date('2026-10-01T16:00:00Z'));
 assert.equal(db.find('notifications',n=>n.title.includes('Kunlik')).length,1);
 await BotService.deliverPending();
 assert.match(sent[1].text,/Kunlik hisobot/);
});

test('a permanent Telegram error fails the message at once; a missing chat is explained',async()=>{
 fakeTelegram();
 await BotService.save('c',{id:'u',email:'u@x'},{name:'Bad',bot_token:TOKEN,chat_id:'@bad_chat',events:['CASH_DAY_CLOSED']});
 const ch=db.find('notification_channels',()=>true)[0];
 db.update('notification_channels',ch.id,{config:{...ch.config,chat_id:'bad'}} as any);
 NotificationService.dispatchEvent('c','CASH_DAY_CLOSED','t','m');
 const r=await BotService.deliverPending();
 assert.equal(r.failed,1);
 const n=db.find('notifications',()=>true)[0];
 assert.equal(n.status,'FAILED');
 assert.match(n.error_message!,/Chat topilmadi/);
 await assert.rejects(()=>BotService.test('c',{id:ch.id}),/Chat topilmadi/);
});
