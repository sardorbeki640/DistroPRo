import {beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {db} from '../db/database.ts';
import {AttendanceService} from '../services/attendance.service.ts';
import {SalaryService,cleanPayComponents} from '../services/salary.service.ts';
import {businessToday} from '../utils/date.ts';

process.env.JWT_SECRET ||= 'test-secret-for-discipline-0123456789';
beforeEach(()=>{db.init();db.reset();});
const boss={id:'boss',email:'b@x'};
const face=(seed:number,noise=0)=>Array.from({length:128},(_,i)=>Math.sin(seed*1.9+i*0.7)*0.1+(noise?Math.cos(i*7+noise)*noise:0));
const at=(date:string,hhmm:string)=>new Date(`${date}T${hhmm}:00+05:00`);
const emp=(id:string,name:string)=>db.insert('employees',{id,company_id:'c',full_name:name,position:'x',phone:'',salary_type:'FIXED',status:'ACTIVE',created_at:''} as any);

/** Rule book from Sept 1; an agent (first SalesDoc visit) and a warehouse worker (Face ID). */
function setup(){
 db.insert('companies',{id:'c',name:'C'} as any);
 emp('agent','Agent Ali'); emp('sklad','Sklad Vali');
 db.insert('agents',{id:'ag1',company_id:'c',code:'d0_3',full_name:'Ali (SD)',phone:'',commission_rate:0,status:'ACTIVE',created_at:''} as any);
 db.insert('integrations',{id:'i',company_id:'c',provider_name:'SALESDOC',status:'CONNECTED',config:{}} as any);
 const s=AttendanceService.settings('c');
 assert.equal(s.penalty.mode,'RULES','new companies start with the rule book');
 AttendanceService.saveSettings('c',{employee_groups:{agent:'grp-agent',sklad:'grp-sklad'},agent_links:{agent:'ag1'}} as any,boss);
 db.update('attendance_settings',s.id,{rules_since:'2026-09-01'} as any);
 db.insert('users',{id:'us',company_id:'c',email:'v@x',full_name:'Vali',status:'ACTIVE',employee_id:'sklad'} as any);
 AttendanceService.enroll('c','sklad',[face(4),face(4,0.002),face(4,0.001)],true,boss);
 db.update('face_profiles','face-sklad',{enrolled_at:'2026-09-01T00:00:00.000Z'} as any);
}
/** A fake connected system returning visits: first visit of each day is what counts. */
function fakeVisits(list:[string,string][]){
 return {importVisits:async()=>list.map(([date,time])=>({agentCode:'d0_3',start:`${date} ${time}`}))};
}

test('agents: the first SalesDoc visit is the start of work; after 09:30 is late',async()=>{
 setup();
 const r=await AttendanceService.syncVisits('c','2026-09-01','2026-09-30',fakeVisits([['2026-09-28','09:10'],['2026-09-28','08:55'],['2026-09-29','09:45'],['2026-09-29','11:00']]));
 assert.equal(r.days,2);
 const rows=Object.fromEntries(AttendanceService.report('c','2026-09-28','2026-09-29','agent').map(x=>[x.date,x]));
 assert.equal(rows['2026-09-28'].first_in,'08:55','earliest visit of the day');
 assert.equal(rows['2026-09-28'].late_minutes,0);
 assert.equal(rows['2026-09-29'].late_minutes,15,'09:45 is 15 minutes after the 09:30 deadline');
 assert.equal(rows['2026-09-29'].penalty_percent,0.5);
});

test('rule book: 0.5% for every late day, adding up (no step after the 10th); absence 2%, excused absence free; manual violations; payroll',async()=>{
 setup();
 // Agent: late on 12 workdays of September (Mon–Sat), on time on the others.
 const workdays:string[]=[];
 for(let d=1;d<=30;d++){const date=`2026-09-${String(d).padStart(2,'0')}`;if(new Date(`${date}T12:00:00Z`).getUTCDay()!==0)workdays.push(date);}
 await AttendanceService.syncVisits('c','2026-09-01','2026-09-30',fakeVisits(workdays.map((d,i)=>[d,i<12?'09:40':'09:00'])));
 const occ=AttendanceService.occurrences('c','agent','2026-09');
 const late=occ.filter(o=>o.type==='LATE');
 assert.equal(late.length,12);
 // Every lateness costs the same 0.5% and they add up: 12 times = 6%.
 assert.deepEqual(late.map(o=>o.percent),Array(12).fill(0.5));
 assert.equal(late.reduce((s,o)=>s+o.percent,0),6);

 // Warehouse worker: Face ID; late after 10:00; one absence excused, one not; a nasiya misuse entered by hand.
 const vali={id:'us',email:'v@x'};
 const ok=(d:string,t:string)=>AttendanceService.check('c',vali,{type:'IN',descriptor:face(4,0.001),liveness_passed:true,lat:41.3,lng:69.2,accuracy_m:15},at(d,t));
 for(const d of workdays){
  if(d==='2026-09-14'||d==='2026-09-15')continue;          // two absences
  ok(d,d==='2026-09-16'?'10:20':'09:50');                    // one late day (10:20 > 10:00)
 }
 AttendanceService.excuse('c','sklad','2026-09-14',true,'ruxsat bilan',boss);
 AttendanceService.addViolation('c',{employee_id:'sklad',date:'2026-09-20',type:'NASIYA_MISUSE',note:'mijoz pulini ishlatdi'},boss);
 const v=AttendanceService.occurrences('c','sklad','2026-09');
 assert.deepEqual(v.map(o=>`${o.date.slice(8)} ${o.type} ${o.percent}`),['15 ABSENT 2','16 LATE 0.5','20 NASIYA_MISUSE 4']);

 // Late excuses are not accepted by default ("har qanday bahona qabul qilinmaydi").
 AttendanceService.excuse('c','sklad','2026-09-16',true,'tirbandlik',boss);
 assert.ok(AttendanceService.occurrences('c','sklad','2026-09').some(o=>o.type==='LATE'),'excuse ignored for lateness');

 // Payroll: 5 000 000 earned, 6.5% → 325 000 deducted.
 SalaryService.setPayComponents('c','sklad',cleanPayComponents([{type:'MONTHLY',amount:5000000}]));
 const pay=SalaryService.calculateMonthlySalary({company_id:'c',employee_id:'sklad',period_month:'2026-09',user_id:'u',user_email:'u@x'});
 assert.equal(pay.deduction_amount,325000);
 assert.equal(pay.final_amount,4675000);
 assert.match(pay.deduction_breakdown[0].description,/Intizom jarimasi 6.5%/);

 // A manual violation entered by mistake is cancelled; percents are editable.
 const nas=AttendanceService.violations('c','2026-09').find(x=>x.type==='NASIYA_MISUSE')!;
 AttendanceService.cancelViolation('c',nas.id,'xato kiritildi',boss);
 const s=AttendanceService.settings('c');
 AttendanceService.saveSettings('c',{rules:s.rules!.map(r=>r.type==='ABSENT'?{...r,percent:3}:r)} as any,boss);
 assert.deepEqual(AttendanceService.occurrences('c','sklad','2026-09').map(o=>`${o.type} ${o.percent}`),['ABSENT 3','LATE 0.5']);
 assert.throws(()=>AttendanceService.saveSettings('c',{rules:[{...s.rules![0],percent:150}]} as any,boss),/0–100%/);
});

test('the example from the rule book: 4 late days on 5 000 000 → 4 900 000',async()=>{
 setup();
 await AttendanceService.syncVisits('c','2026-09-01','2026-09-30',fakeVisits([['2026-09-01','09:31'],['2026-09-02','10:00'],['2026-09-03','09:50'],['2026-09-04','11:00']]));
 // Only these four days are tracked for the example (other days: not absent for this check).
 db.update('attendance_settings',AttendanceService.settings('c').id,{rules:AttendanceService.settings('c').rules!.map(r=>r.type==='ABSENT'?{...r,active:false}:r)} as any);
 SalaryService.setPayComponents('c','agent',cleanPayComponents([{type:'MONTHLY',amount:5000000}]));
 const pay=SalaryService.calculateMonthlySalary({company_id:'c',employee_id:'agent',period_month:'2026-09',user_id:'u',user_email:'u@x'});
 assert.equal(pay.final_amount,4900000);
 assert.ok(businessToday()>='2026-10-01');
});
