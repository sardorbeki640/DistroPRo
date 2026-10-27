import {beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {db} from '../db/database.ts';
import {BotService} from '../services/bot.service.ts';
import {TelegramService} from '../services/telegram.service.ts';
import {StaffBotService} from '../services/staff-bot.service.ts';
import {AttendanceService} from '../services/attendance.service.ts';
import {SheetsService} from '../services/sheets.service.ts';
import {ExpenseService} from '../services/expense.service.ts';

process.env.JWT_SECRET ||= 'test-secret-for-video-sheets-0123456789';
beforeEach(()=>{db.init();db.reset();});
const TOKEN='123456789:AAHfakeTokenForTests_abcdefghijklmnopq';
const owner={id:'u-owner',email:'o@x'};
const GROUP=-1001234567;

function fakeTelegram(){
 const sent:any[]=[];const queue:any[]=[];
 TelegramService.fetchImpl=(async(url:string,init:any)=>{
  const method=String(url).split('/').pop();const body=JSON.parse(init.body||'{}');
  const reply=(o:any)=>({json:async()=>o,status:o.ok?200:400}) as any;
  if(method==='getMe')return reply({ok:true,result:{id:1,first_name:'Distro',username:'distro_staff_bot'}});
  if(method==='getUpdates'){const from=Number(body.offset||0);return reply({ok:true,result:queue.filter(u=>u.update_id>=from)});}
  if(method==='sendMessage'){sent.push(body);return reply({ok:true,result:{}});}
  return reply({ok:false,error_code:404,description:'Not Found'});
 }) as any;
 let id=100,msg=1;
 const write=(chatId:number,text:string,first='Ali')=>queue.push({update_id:++id,message:{message_id:msg++,chat:{id:chatId,type:'private',first_name:first},from:{id:chatId,first_name:first},date:1,text}});
 const video=(fromId:number,at:string,extra:any={})=>queue.push({update_id:++id,message:{message_id:msg++,chat:{id:GROUP,type:'supergroup',title:'Dostavka'},from:{id:fromId,first_name:'Vali'},date:Math.floor(Date.parse(at)/1000),video_note:{file_id:`f${msg}`,duration:5,length:240},...extra}});
 return {sent,write,video};
}

function company(){
 db.insert('users',{id:'u-owner',company_id:'c',email:'o@x',full_name:'Rahbar',status:'ACTIVE'} as any);
 db.insert('employees',{id:'e-vali',company_id:'c',full_name:'Vali Dostavchi',position:'Dostavchik',phone:'',salary_type:'FIXED',status:'ACTIVE',created_at:''} as any);
 db.insert('employees',{id:'e-face',company_id:'c',full_name:'Soli Face',position:'Dostavchik',phone:'',salary_type:'FIXED',status:'ACTIVE',created_at:''} as any);
 const s=AttendanceService.settings('c');
 // Couriers group: start by 10:00; Vali marks it by round video, Soli by Face ID.
 db.update('attendance_settings',s.id,{employee_groups:{'e-vali':'grp-sklad','e-face':'grp-sklad'},employee_methods:{'e-vali':'TELEGRAM_VIDEO'},rules_since:'2026-01-01'} as any);
}
async function linkBot(tg:ReturnType<typeof fakeTelegram>){
 const bot=await BotService.save('c',owner,{name:'Xodimlar',bot_token:TOKEN,chat_id:'',events:[],personal:true,checkin_chat_id:String(GROUP),checkin_chat_title:'Dostavka'});
 for(const [emp,chat] of [['e-vali',701],['e-face',702]] as const){
  const code=StaffBotService.link('c',{employee_id:emp}).url.split('=')[1];
  tg.write(chat,`/start ${code}`);
 }
 await StaffBotService.pollUpdates(db.findById('notification_channels',bot.id)!);
 tg.sent.length=0;
 return bot;
}

test('a round video in the couriers’ group starts the day at the time Telegram received it; only the first counts',async()=>{
 const tg=fakeTelegram();company();
 const bot=await linkBot(tg);
 tg.video(701,'2026-10-01T09:40:00+05:00');
 tg.video(701,'2026-10-01T11:00:00+05:00');
 await StaffBotService.pollUpdates(db.findById('notification_channels',bot.id)!);
 const ev=db.find('attendance_events',e=>e.employee_id==='e-vali');
 assert.equal(ev.length,1,'the second video is not recorded');
 assert.equal(ev[0].method,'TELEGRAM_VIDEO');
 assert.equal(ev[0].at,new Date('2026-10-01T09:40:00+05:00').toISOString());
 assert.equal(AttendanceService.dayFor(AttendanceService.settings('c'),'e-vali','2026-10-01').first_in,'09:40');
 assert.match(tg.sent[0].text,/09:40 da boshlandi/);
 assert.equal(tg.sent[0].chat_id,GROUP);
 assert.equal(tg.sent.filter(m=>m.chat_id===GROUP).length,1,'the later video gets no reply in the group');
});

test('the admin assigns a Telegram account: videos count without opening the bot, the earlier one too; strangers get no reply',async()=>{
 const tg=fakeTelegram();company();
 const bot=await BotService.save('c',owner,{name:'Xodimlar',bot_token:TOKEN,chat_id:'',events:[],personal:true,checkin_chat_id:String(GROUP),checkin_chat_title:'Dostavka'});
 tg.sent.length=0;
 // Vali never opened the bot: his video is kept, nothing is said in the group.
 tg.video(888001,'2026-10-01T09:45:00+05:00');
 await StaffBotService.pollUpdates(db.findById('notification_channels',bot.id)!);
 assert.equal(tg.sent.length,0);
 assert.equal(db.find('attendance_events',e=>e.employee_id==='e-vali').length,0);
 const view=StaffBotService.telegramAccounts('c');
 assert.deepEqual(view.senders.map(s=>[s.id,s.name,s.videos]),[['888001','Vali',1]]);
 // The admin picks his employee: the kept video counts now (09:45), and he leaves the "unassigned" list.
 assert.throws(()=>StaffBotService.assignTelegram('c','e-vali','abc',owner),/raqamlardan/);
 const r=StaffBotService.assignTelegram('c','e-vali','888001',owner);
 assert.equal(r.counted,1);
 assert.equal(AttendanceService.dayFor(AttendanceService.settings('c'),'e-vali','2026-10-01').first_in,'09:45');
 assert.equal(StaffBotService.telegramAccounts('c').senders.length,0);
 assert.throws(()=>StaffBotService.assignTelegram('c','e-face','888001',owner),/allaqachon Vali/);
 // The next day his video counts straight away, with the reply in the group.
 tg.video(888001,'2026-10-02T09:30:00+05:00');
 await StaffBotService.pollUpdates(db.findById('notification_channels',bot.id)!);
 assert.equal(AttendanceService.dayFor(AttendanceService.settings('c'),'e-vali','2026-10-02').first_in,'09:30');
 assert.match(tg.sent.find(m=>m.chat_id===GROUP)!.text,/Vali Dostavchi — ish 09:30 da boshlandi/);
});

test('late video: lateness counted; forwarded, too short, unlinked or Face ID employees’ videos do not count',async()=>{
 const tg=fakeTelegram();company();
 const bot=await linkBot(tg);
 tg.video(701,'2026-10-01T10:25:00+05:00',{forward_origin:{type:'user'}});
 tg.video(701,'2026-10-01T10:26:00+05:00',{video_note:{file_id:'x',duration:1}});
 tg.video(999,'2026-10-01T10:27:00+05:00');
 tg.video(702,'2026-10-01T10:28:00+05:00');
 tg.video(701,'2026-10-01T10:30:00+05:00');
 await StaffBotService.pollUpdates(db.findById('notification_channels',bot.id)!);
 const texts=tg.sent.filter(m=>m.chat_id===GROUP).map(m=>m.text);
 assert.match(texts[0],/forward/);
 assert.match(texts[1],/qisqa/);
 // 999 is nobody's account: no reply (the admin sees him in the list to assign).
 assert.match(texts[2],/Face ID orqali/);
 assert.match(texts[3],/30 daqiqa kech/);
 assert.equal(texts.length,4);
 assert.deepEqual(StaffBotService.telegramAccounts('c').senders.map(s=>s.id),['999']);
 assert.equal(db.find('attendance_events',e=>e.employee_id==='e-face').length,0);
 assert.equal(AttendanceService.dayFor(AttendanceService.settings('c'),'e-vali','2026-10-01').late_minutes,30);
});

test('Google Sheets: each start goes once to the month’s sheet with the secret token; failures stay queued and retry',async()=>{
 company();
 await assert.rejects(async()=>SheetsService.save('c',{enabled:true,url:'https://example.com/x'},owner),/script\.google\.com/);
 SheetsService.save('c',{enabled:true,url:'https://script.google.com/macros/s/AKfy-abc_123/exec'},owner);
 const token=SheetsService.settings('c')!.token;
 assert.match(SheetsService.view('c').script,new RegExp(token));
 AttendanceService.recordVideo('c','e-vali',new Date('2026-10-01T09:05:00+05:00'),{chat_id:'g',message_id:1});
 AttendanceService.exportStart('c','e-vali','2026-10-01');
 assert.equal(db.find('sheet_rows',()=>true).length,1,'once per employee and day');

 const posts:any[]=[];let fail=true;
 SheetsService.fetchImpl=(async(_u:string,init:any)=>{posts.push(JSON.parse(init.body));return {status:200,text:async()=>fail?'<html>login</html>':JSON.stringify({ok:true,added:1})} as any;}) as any;
 await SheetsService.flush(Date.now());
 let row=db.find('sheet_rows',()=>true)[0];
 assert.equal(row.status,'PENDING');
 assert.match(SheetsService.view('c').last_error!,/Anyone/);
 fail=false;
 await SheetsService.flush(Date.now()+10*60_000);
 row=db.find('sheet_rows',()=>true)[0];
 assert.equal(row.status,'SENT');
 const last=posts[posts.length-1];
 assert.equal(last.token,token);
 assert.equal(last.groups[0].sheet,'Davomat 2026-10');
 assert.deepEqual(last.groups[0].rows[0].slice(0,6),['01.10.2026','Vali Dostavchi','Dostavchik','Sklad / dostavchiklar','Dumaloq video','09:05']);
});

test('penalties go to “Jarimalar YYYY-MM” by themselves: each once, with the month total; a cancellation is a row under it',async()=>{
 company();
 SheetsService.save('c',{enabled:true,url:'https://script.google.com/macros/s/AKfy-abc_123/exec'},owner);
 const now=new Date('2026-10-20T12:00:00+05:00');
 // Vali (couriers' group, start by 10:00 by round video) late twice, and a manual nasiya misuse.
 AttendanceService.recordVideo('c','e-vali',new Date('2026-10-01T10:20:00+05:00'),{chat_id:'g',message_id:1});
 AttendanceService.recordVideo('c','e-vali',new Date('2026-10-02T10:05:00+05:00'),{chat_id:'g',message_id:2});
 const v=AttendanceService.addViolation('c',{employee_id:'e-vali',date:'2026-10-03',type:'NASIYA_MISUSE',note:'mijoz pulini ishlatdi'},owner);
 db.removeWhere('sheet_rows',()=>true);           // only the penalties are looked at here
 AttendanceService.exportPenalties(now,'c');
 const rows=db.find('sheet_rows',r=>r.sheet==='Jarimalar').sort((a,b)=>a.id.localeCompare(b.id));
 const mine=rows.filter(r=>r.values[1]==='Vali Dostavchi');
 const late=mine.filter(r=>r.values[4]==='Ishga kech qolish / kech boshlash');
 assert.deepEqual(late.map(r=>[r.values[0],r.values[5],r.values[6]]),[['01.10.2026','20 daqiqa kech',0.5],['02.10.2026','5 daqiqa kech',0.5]]);
 const nas=mine.find(r=>r.values[4]==='Nasiya pulini so‘ramasdan ishlatib qo‘yish')!;
 assert.deepEqual([nas.values[6],nas.values[8]],[4,'Rahbar kiritgan']);
 // The "month total" column adds up row by row (absent workdays without a video count too, 2% each).
 const byDate=[...mine].sort((a,b)=>Number(a.values[7])-Number(b.values[7]));
 const sum=Math.round(mine.reduce((s,r)=>s+Number(r.values[6]),0)*100)/100;
 assert.equal(byDate[byDate.length-1].values[7],sum);
 assert.ok(mine.some(r=>r.values[4]==='Ruxsatsiz, javob so‘ramasdan ishga chiqmaslik'&&r.values[6]===2));
 // Each one only once.
 const count=db.find('sheet_rows',()=>true).length;
 AttendanceService.exportPenalties(now,'c');
 assert.equal(db.find('sheet_rows',()=>true).length,count);
 // A cancelled one gets a row under it.
 AttendanceService.cancelViolation('c',v.id,'xato kiritildi',owner);
 const cx=db.findById('sheet_rows',`c:pencx:${v.id}`)!;
 assert.deepEqual([cx.sheet,cx.values[8]],['Jarimalar','BEKOR QILINDI']);
 // Sent with the penalties header.
 const posts:any[]=[];
 SheetsService.fetchImpl=(async(_u:string,init:any)=>{posts.push(JSON.parse(init.body));return {status:200,text:async()=>JSON.stringify({ok:true,added:1})} as any;}) as any;
 await SheetsService.flush(Date.now());
 const g=posts[0].groups.find((x:any)=>x.sheet==='Jarimalar');
 assert.equal(g.header[6],'Jarima (so‘m yoki %)');
 assert.match(SheetsService.view('c').script,/g\.header \|\| body\.header/);
});

test('a face profile from an uploaded photo keeps its portrait until replaced; removing it deletes the portrait too',()=>{
 company();
 const d=(seed:number)=>Array.from({length:128},(_,i)=>Number((Math.sin(i*0.37)*0.1+seed*0.001).toFixed(6)));
 const jpeg='data:image/jpeg;base64,'+Buffer.from([0xff,0xd8,0xff,0xe0,1,2,3,4]).toString('base64');
 AttendanceService.enroll('c','e-face',[d(1),d(2),d(3)],true,owner,{photo:jpeg,source:'PHOTO'});
 const p=AttendanceService.profiles('c')[0];
 assert.equal(p.has_photo,true);assert.equal(p.source,'PHOTO');
 const file=AttendanceService.profilePhotoPath('c','e-face');
 assert.ok(fs.existsSync(file));
 // Re-enrolling without a new portrait keeps the old one.
 AttendanceService.enroll('c','e-face',[d(1),d(2),d(3)],true,owner,{source:'CAMERA'});
 assert.equal(AttendanceService.profilePhotoPath('c','e-face'),file);
 AttendanceService.removeProfile('c','e-face',owner);
 assert.equal(fs.existsSync(file),false);
 assert.ok(path.basename(file).startsWith('e-face'));
});

test('expense filters accept several values at once',()=>{
 for(const [id,cat,method,status] of [['x1','k1','CASH','CONFIRMED'],['x2','k2','TERMINAL','CONFIRMED'],['x3','k3','CASH','CANCELLED']]){
  db.insert('expenses',{id,company_id:'c',category_id:cat,payment_method:method,status,amount:100,date:'2026-10-01',description:'',created_by:'u',created_at:'2026-10-01'} as any);
 }
 const ids=(f:any)=>ExpenseService.getExpenses({company_id:'c',...f}).expenses.map((e:any)=>e.id).sort();
 assert.deepEqual(ids({category_id:'k1,k2'}),['x1','x2']);
 assert.deepEqual(ids({payment_method:'CASH'}),['x1','x3']);
 assert.deepEqual(ids({status:'CONFIRMED,CANCELLED',payment_method:'CASH,TERMINAL'}),['x1','x2','x3']);
});
