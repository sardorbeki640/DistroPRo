import {beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {db} from '../db/database.ts';
import {BotService} from '../services/bot.service.ts';
import {TelegramService} from '../services/telegram.service.ts';
import {StaffBotService} from '../services/staff-bot.service.ts';
import {AttendanceService} from '../services/attendance.service.ts';
import {businessToday} from '../utils/date.ts';

process.env.JWT_SECRET ||= 'test-secret-for-penalty-posts-0123456789';
const TOKEN='123456789:AAHfakeTokenForTests_abcdefghijklmnopq';
const owner={id:'u-owner',email:'o@x'};
beforeEach(()=>{
 db.init();db.reset();
 TelegramService.fetchImpl=(async(url:string)=>{const m=String(url).split('/').pop();return {status:200,json:async()=>m==='getMe'?{ok:true,result:{id:1,username:'distro_staff_bot'}}:{ok:true,result:[]}} as any;}) as any;
 db.insert('users',{id:'u-owner',company_id:'c',email:'o@x',full_name:'Rahbar',status:'ACTIVE'} as any);
 for(const [id,name,pos] of [['e-ali','Ali Valiyev','Savdo agenti'],['e-vali','Vali Karimov','Savdo agenti'],['e-dos','Dos Dostavchi','Dostavchik']]) db.insert('employees',{id,company_id:'c',full_name:name,position:pos,phone:'',salary_type:'FIXED',status:'ACTIVE',created_at:''} as any);
});

async function setup(){
 await BotService.save('c',owner,{name:'Xodimlar',bot_token:TOKEN,chat_id:'',events:[],personal:true});
 const s=AttendanceService.settings('c');
 // Agents and couriers in their work groups (the default rule book: lateness 0.5%, nasiya misuse 4%).
 AttendanceService.saveSettings('c',{employee_groups:{'e-ali':'grp-agent','e-vali':'grp-agent','e-dos':'grp-sklad'}} as any,owner);
 assert.equal(s.penalty.mode,'RULES');
}
const posts=()=>db.find('notifications',n=>n.id.startsWith('pp')).sort((a,b)=>a.id.localeCompare(b.id));

test('each agent’s violations go to their own group, the couriers’ to the common one; the month total adds up',async()=>{
 await setup();
 assert.throws(()=>AttendanceService.savePenaltyPosts('c',{enabled:true,groups:{},employees:{}},owner),/guruh tanlang/);
 const v=AttendanceService.savePenaltyPosts('c',{enabled:true,groups:{'grp-sklad':'-100500'},employees:{'e-ali':'-100111','e-vali':'-100222','e-x':'not-a-chat'}},owner);
 assert.equal(v.config.since,businessToday());
 assert.deepEqual(v.config.employees,{'e-ali':'-100111','e-vali':'-100222'},'a bad chat id is dropped');
 const today=businessToday();
 AttendanceService.addViolation('c',{employee_id:'e-ali',date:today,type:'NASIYA_MISUSE',note:'mijoz pulini ishlatdi'},owner);
 AttendanceService.addViolation('c',{employee_id:'e-ali',date:today,type:'TASK_LATE',note:'hisobot kechikdi'},owner);
 AttendanceService.addViolation('c',{employee_id:'e-dos',date:today,type:'TASK_LATE',note:'yuk kech yetkazildi'},owner);
 StaffBotService.queuePenaltyPosts();
 const p=posts();
 assert.equal(p.length,3);
 const ali=p.filter(n=>n.personal_chat_id==='-100111');
 assert.equal(ali.length,2,'Ali’s own group');
 assert.ok(ali.some(n=>/Jarima: <b>4%<\/b>/.test(n.content)));
 assert.ok(ali.some(n=>/Shu oy jami: <b>4\.5%<\/b> \(2 ta/.test(n.content)),'the second one shows the running total');
 assert.equal(p.filter(n=>n.personal_chat_id==='-100500').length,1,'the courier in the common group');
 assert.ok(!p.some(n=>n.personal_chat_id==='-100222'),'Vali had nothing');
 // Nothing is posted twice.
 StaffBotService.queuePenaltyPosts();
 assert.equal(posts().length,3);
 // A cancelled violation is announced in the same group.
 const nas=db.find('discipline_violations',x=>x.type==='NASIYA_MISUSE')[0];
 AttendanceService.cancelViolation('c',nas.id,'xato kiritildi',owner);
 const cancel=db.findById('notifications',`ppx-${nas.id}`)!;
 assert.equal(cancel.personal_chat_id,'-100111');
 assert.match(cancel.content,/xato kiritildi/);
});

test('violations from before posting was switched on are not posted; switched off nothing is posted',async()=>{
 await setup();
 AttendanceService.addViolation('c',{employee_id:'e-dos',date:businessToday(),type:'TASK_LATE',note:'eski hodisa'},owner);
 AttendanceService.savePenaltyPosts('c',{enabled:true,groups:{'grp-sklad':'-100500'},employees:{}},owner);
 const s=AttendanceService.settings('c');
 db.update('attendance_settings',s.id,{penalty_posts:{...s.penalty_posts!,since:'2999-01-01'}} as any);
 StaffBotService.queuePenaltyPosts();
 assert.equal(posts().length,0,'before “since”');
 db.update('attendance_settings',s.id,{penalty_posts:{...s.penalty_posts!,since:businessToday(),enabled:false}} as any);
 StaffBotService.queuePenaltyPosts();
 assert.equal(posts().length,0,'switched off');
});
