import {beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {db} from '../db/database.ts';
import {BotService} from '../services/bot.service.ts';
import {TelegramService} from '../services/telegram.service.ts';
import {StaffBotService} from '../services/staff-bot.service.ts';
import {AttendanceService} from '../services/attendance.service.ts';
import {CrmService} from '../services/crm.service.ts';

process.env.JWT_SECRET ||= 'test-secret-for-staff-bot-0123456789';
beforeEach(()=>{db.init();db.reset();});
const TOKEN='123456789:AAHfakeTokenForTests_abcdefghijklmnopq';
const owner={id:'u-owner',email:'o@x'};

/** A fake Telegram: getUpdates returns what the test queues (and confirms by offset); sendMessage is recorded. */
function fakeTelegram(){
 const sent:any[]=[];const queue:any[]=[];let blocked=new Set<string>();
 TelegramService.fetchImpl=(async(url:string,init:any)=>{
  const method=String(url).split('/').pop();const body=JSON.parse(init.body||'{}');
  const reply=(o:any)=>({json:async()=>o,status:o.ok?200:400}) as any;
  if(method==='getMe')return reply({ok:true,result:{id:1,first_name:'Distro',username:'distro_staff_bot'}});
  if(method==='getUpdates'){const from=Number(body.offset||0);return reply({ok:true,result:queue.filter(u=>u.update_id>=from)});}
  if(method==='sendMessage'){if(blocked.has(String(body.chat_id)))return reply({ok:false,error_code:403,description:'Forbidden: bot was blocked by the user'});sent.push(body);return reply({ok:true,result:{}});}
  return reply({ok:false,error_code:404,description:'Not Found'});
 }) as any;
 let id=100;
 const write=(chatId:number,text:string,first='Ali')=>queue.push({update_id:++id,message:{chat:{id:chatId,type:'private',first_name:first},text}});
 return {sent,write,block:(c:string)=>blocked.add(c)};
}

function company(){
 db.insert('users',{id:'u-owner',company_id:'c',email:'o@x',full_name:'Rahbar',status:'ACTIVE'} as any);
 db.insert('users',{id:'u-ali',company_id:'c',email:'a@x',full_name:'Ali',status:'ACTIVE'} as any);
 db.insert('employees',{id:'e-ali',company_id:'c',user_id:'u-ali',full_name:'Ali Valiyev',position:'Savdo agenti',phone:'',salary_type:'FIXED',status:'ACTIVE',created_at:''} as any);
}
async function personalBot(extra:any={}){
 return BotService.save('c',owner,{name:'Xodimlar',bot_token:TOKEN,chat_id:'',events:[],personal:true,...extra});
}

test('a personal bot needs no group chat; an employee links their own Telegram by the /start link, and only them',async()=>{
 const tg=fakeTelegram();company();
 await assert.rejects(()=>BotService.save('c',owner,{name:'x',bot_token:TOKEN,chat_id:'',events:[]}),/Chat ID/,'an ordinary bot still needs a chat');
 await assert.rejects(()=>personalBot({events:['DAILY_REPORT']}),/chat tanlang/);
 const bot=await personalBot();
 assert.equal(bot.personal,true);

 const link=StaffBotService.link('c',{user_id:'u-ali'});
 assert.match(link.url,/^https:\/\/t\.me\/distro_staff_bot\?start=[\w-]{16}$/);
 const code=link.url.split('=')[1];
 assert.equal(StaffBotService.link('c',{employee_id:'e-ali'}).url,link.url,'the login and the employee card are one person');

 tg.write(777,'/start wrong-code','Begona');
 tg.write(555,`/start ${code}`);
 await StaffBotService.pollUpdates(db.findById('notification_channels',bot.id)!);
 const me=StaffBotService.me('c','u-ali');
 assert.equal(me.linked,true);
 assert.match(me.chat_name!,/Ali/);
 assert.ok(tg.sent.some(m=>m.chat_id==='555'&&/ulandi/.test(m.text)));
 assert.ok(tg.sent.some(m=>m.chat_id==='777'&&/havola/.test(m.text)),'a stranger is told how to link, nothing is bound');
 assert.equal(db.find('staff_telegram',r=>r.chat_id==='777').length,0);

 // The used code no longer works: a forwarded link cannot bind someone else.
 tg.write(888,`/start ${code}`,'Boshqa');
 await StaffBotService.pollUpdates(db.findById('notification_channels',bot.id)!);
 assert.equal(StaffBotService.resolve('c',{employee_id:'e-ali'})!.chat_id,'555');
 // Updates are read once: the offset moved on.
 const sentBefore=tg.sent.length;
 await StaffBotService.pollUpdates(db.findById('notification_channels',bot.id)!);
 assert.equal(tg.sent.length,sentBefore);
 // Chats seen are still offered by "Chatni topish".
 const found=await BotService.findChats('c',{id:bot.id});
 assert.ok(found.chats.some(c=>c.id==='555'));
});

test('reminders go to the person’s own chat; muted or switched-off types are not sent; a blocked bot stops sending',async()=>{
 const tg=fakeTelegram();company();
 const bot=await personalBot({personal_events:['TASK_ASSIGNED','SALARY_PAID','VIOLATION']});
 const code=StaffBotService.link('c',{user_id:'u-ali'}).url.split('=')[1];
 tg.write(555,`/start ${code}`);
 await StaffBotService.pollUpdates(db.findById('notification_channels',bot.id)!);
 tg.sent.length=0;

 // A task given by the owner reaches Ali.
 const seesAll=CrmService.seesAll;(CrmService as any).seesAll=()=>true;
 try{CrmService.createTask({userId:'u-owner',companyId:'c',email:'o@x',roles:['OWNER'],permissions:['*']} as any,{title:'Mijoz <A> bilan uchrashish',assignee_user_id:'u-ali',due_date:'2026-10-05'});
  // One Ali gives himself is not announced.
  CrmService.createTask({userId:'u-ali',companyId:'c',email:'a@x'} as any,{title:'O‘zimga'});
 }finally{(CrmService as any).seesAll=seesAll;}
 assert.equal(StaffBotService.notify('c',{user_id:'u-ali'},'LATE','x','y'),false,'LATE is switched off for this company');
 await BotService.deliverPending();
 assert.equal(tg.sent.length,1);
 assert.equal(tg.sent[0].chat_id,'555');
 assert.match(tg.sent[0].text,/Yangi vazifa[\s\S]*Mijoz &lt;A&gt; bilan/);
 assert.equal(tg.sent[0].message_thread_id,undefined);

 StaffBotService.setMuted('c','u-ali',['SALARY_PAID']);
 assert.equal(StaffBotService.notify('c',{employee_id:'e-ali'},'SALARY_PAID','x','y'),false,'muted by the employee');

 // The employee blocks the bot: the message fails at once and nothing more is queued.
 tg.block('555');
 assert.equal(StaffBotService.notify('c',{employee_id:'e-ali'},'VIOLATION','x','y'),true);
 await BotService.deliverPending();
 assert.ok(StaffBotService.resolve('c',{employee_id:'e-ali'})!.blocked_at);
 assert.equal(StaffBotService.notify('c',{employee_id:'e-ali'},'VIOLATION','x','y'),false);
});

test('start-of-work reminder before the deadline, a missed-start notice after it, each once a day; lateness tells the percent',async()=>{
 const tg=fakeTelegram();company();
 const bot=await personalBot({remind_before_min:15,missed_after_min:30});
 const s=AttendanceService.settings('c');
 db.update('attendance_settings',s.id,{employee_groups:{'e-ali':'grp-sklad'},rules_since:'2026-01-01'} as any); // start by 10:00, Mon–Sat
 const code=StaffBotService.link('c',{user_id:'u-ali'}).url.split('=')[1];
 tg.write(555,`/start ${code}`);
 await StaffBotService.pollUpdates(db.findById('notification_channels',bot.id)!);

 const at=(hhmm:string)=>new Date(`2026-10-01T${hhmm}:00+05:00`); // Thursday, Tashkent time
 StaffBotService.queueScheduled(at('09:30'));
 assert.equal(db.find('notifications',n=>n.personal_type==='CHECKIN_REMINDER').length,0,'too early');
 StaffBotService.queueScheduled(at('09:46'));
 StaffBotService.queueScheduled(at('09:50'));
 assert.equal(db.find('notifications',n=>n.personal_type==='CHECKIN_REMINDER').length,1,'once');
 StaffBotService.queueScheduled(at('10:31'));
 StaffBotService.queueScheduled(at('10:40'));
 assert.equal(db.find('notifications',n=>n.personal_type==='CHECKIN_MISSED').length,1);

 AttendanceService.tellLate('c','e-ali','2026-10-01','10:20',20);
 const late=db.find('notifications',n=>n.personal_type==='LATE');
 assert.equal(late.length,1);
 assert.match(late[0].content,/20 daqiqa/);
});

test('agents get their customers’ debts in the morning',async()=>{
 const tg=fakeTelegram();company();
 const bot=await personalBot({morning_hour:8});
 db.insert('agents',{id:'a1',company_id:'c',employee_id:'e-ali',code:'d0_3',full_name:'Ali',phone:'',commission_rate:0,status:'ACTIVE',created_at:''} as any);
 db.insert('customers',{id:'k1',company_id:'c',agent_id:'a1',code:'1',name:'Do‘kon 1',current_balance:1_500_000,status:'ACTIVE',is_active:true} as any);
 db.insert('customers',{id:'k2',company_id:'c',agent_id:'a1',code:'2',name:'Do‘kon 2',current_balance:0,status:'ACTIVE',is_active:true} as any);
 const code=StaffBotService.link('c',{user_id:'u-ali'}).url.split('=')[1];
 tg.write(555,`/start ${code}`);
 await StaffBotService.pollUpdates(db.findById('notification_channels',bot.id)!);
 StaffBotService.queueScheduled(new Date('2026-10-01T07:00:00+05:00'));
 assert.equal(db.find('notifications',n=>n.personal_type==='AGENT_DEBTS').length,0);
 StaffBotService.queueScheduled(new Date('2026-10-01T08:05:00+05:00'));
 const n=db.find('notifications',n=>n.personal_type==='AGENT_DEBTS');
 assert.equal(n.length,1);
 assert.match(n[0].content,/Do‘kon 1/);
 assert.doesNotMatch(n[0].content,/Do‘kon 2/);
});
