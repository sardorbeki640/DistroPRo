import {beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {db} from '../db/database.ts';
import {AttendanceService,gpsDistance} from '../services/attendance.service.ts';
import {SalaryService} from '../services/salary.service.ts';

process.env.JWT_SECRET ||= 'test-secret-for-attendance-0123456789';
beforeEach(()=>{db.init();db.reset();});
const boss={id:'boss',email:'b@x'};
// Fake descriptors: different seeds are clearly different people (distance > 0.8), small noise is the same person.
const face=(seed:number,noise=0)=>Array.from({length:128},(_,i)=>Math.sin(seed*1.9+i*0.7)*0.1+(noise?Math.cos(i*7+noise)*noise:0));
const at=(date:string,hhmm:string)=>new Date(`${date}T${hhmm}:00+05:00`); // Tashkent

function setup(){
 db.insert('employees',{id:'e1',company_id:'c',full_name:'Ali Dostavchik',position:'Dostavchik',phone:'',salary_type:'FIXED',status:'ACTIVE',created_at:''} as any);
 db.insert('users',{id:'u1',company_id:'c',email:'ali@x',full_name:'Ali',status:'ACTIVE',employee_id:'e1'} as any);
 AttendanceService.enroll('c','e1',[face(1),face(1,0.002),face(1,0.003)],true,boss);
 // Profile created long before the tested days.
 const p=db.find('face_profiles',()=>true)[0];
 db.update('face_profiles',p.id,{enrolled_at:'2026-09-01T00:00:00.000Z'} as any);
}
const check=(type:'IN'|'OUT',when:Date,extra:any={})=>AttendanceService.check('c',{id:'u1',email:'ali@x'},{type,descriptor:face(1,0.001),liveness_passed:true,lat:41.3111,lng:69.2797,accuracy_m:20,...extra},when);

test('enrollment needs consent and one person; descriptors are encrypted on disk',()=>{
 db.insert('employees',{id:'e9',company_id:'c',full_name:'X',position:'x',phone:'',salary_type:'FIXED',status:'ACTIVE',created_at:''} as any);
 assert.throws(()=>AttendanceService.enroll('c','e9',[face(2),face(2),face(2)],false,boss),/roziligi/);
 assert.throws(()=>AttendanceService.enroll('c','e9',[face(2),face(3),face(2)],true,boss),/mos emas/);
 AttendanceService.enroll('c','e9',[face(2),face(2,0.002),face(2,0.001)],true,boss);
 const raw=JSON.stringify((db as any).sql.prepare("SELECT data FROM rows WHERE tbl='face_profiles'").all());
 assert.ok(!raw.includes(String(face(2)[5]).slice(0,8)),'no plain descriptor numbers on disk');
 assert.equal(AttendanceService.profiles('c')[0].samples,3);
});

test('a profile made from a photo sends a near miss to review; a stranger is still refused',()=>{
 setup();
 const p=db.find('face_profiles',()=>true)[0];
 db.update('face_profiles',p.id,{source:'PHOTO'} as any);
 // A live face 0.5 away from every sample: over the 0.45 threshold, within the photo slack.
 const base=face(1);const dir=face(5).map((v,i)=>v-base[i]);const len=Math.hypot(...dir);
 const near=base.map((v,i)=>v+dir[i]/len*0.5);
 const r=AttendanceService.check('c',{id:'u1',email:'ali@x'},{type:'IN',descriptor:near,liveness_passed:true,lat:41.3111,lng:69.2797,accuracy_m:20},at('2026-09-29','08:55'));
 assert.equal(r.event.status,'REVIEW');
 assert.match(r.message,/rasmdan olingan/);
 const stranger=AttendanceService.check('c',{id:'u1',email:'ali@x'},{type:'OUT',descriptor:face(7),liveness_passed:true,lat:41.3111,lng:69.2797,accuracy_m:20},at('2026-09-29','18:00'));
 assert.equal(stranger.event.status,'REJECTED');
});

test('a check is accepted, rejected or sent to review for the right reasons',()=>{
 setup();
 const ok=check('IN',at('2026-09-29','08:55'));
 assert.equal(ok.event.status,'ACCEPTED');
 assert.throws(()=>check('IN',at('2026-09-29','08:56')),/hozirgina/);
 const stranger=AttendanceService.check('c',{id:'u1',email:'ali@x'},{type:'OUT',descriptor:face(7),liveness_passed:true,lat:41.3,lng:69.2,accuracy_m:10},at('2026-09-29','12:00'));
 assert.equal(stranger.event.status,'REJECTED');
 assert.match(stranger.message,/yuz mos kelmadi/);
 const photo=AttendanceService.check('c',{id:'u1',email:'ali@x'},{type:'OUT',descriptor:face(1,0.001),liveness_passed:false,lat:41.3,lng:69.2,accuracy_m:10},at('2026-09-29','12:05'));
 assert.equal(photo.event.status,'REJECTED','a photo held to the camera fails liveness');
 const noGps=check('OUT',at('2026-09-29','18:05'),{lat:null,lng:null});
 assert.equal(noGps.event.status,'REVIEW');
 // Face ID only at the work place: outside every zone the check is refused (and kept for the manager).
 AttendanceService.saveSettings('c',{zones:[{id:'z',name:'Ombor',lat:41.3111,lng:69.2797,radius_m:200}],require_zone:true} as any,boss);
 assert.equal(check('IN',at('2026-09-30','09:00')).event.zone_id,'z');
 const far=check('OUT',at('2026-09-30','18:00'),{lat:41.40,lng:69.30});
 assert.equal(far.event.status,'REJECTED');
 assert.match(far.message,/uzoqdasiz/);
 assert.ok(gpsDistance(41.3111,69.2797,41.40,69.30)>9000);
});

test('Face ID only within 100 m of the work place: 60 m passes, 150 m and a vague or missing location do not',()=>{
 setup();
 // 0.0009° of latitude ≈ 100 m.
 AttendanceService.saveSettings('c',{zones:[{name:'Sklad',lat:41.3111,lng:69.2797,radius_m:100}],require_zone:true} as any,boss);
 const s=AttendanceService.settings('c');
 const v=(lat:number,acc=10)=>AttendanceService.zoneVerdict(s,lat,69.2797,acc);
 assert.equal(v(41.3111+0.00054).ok,true,'≈60 m is inside');
 const out=v(41.3111+0.00135);
 assert.equal(out.ok,false,'≈150 m is outside');
 assert.match(out.message,/150 m uzoqdasiz — Face ID faqat 100 m ichida/);
 assert.match(v(41.3111,250).message,/aniqligi past/,'a ±250 m reading cannot prove the place');
 assert.equal(AttendanceService.zoneVerdict(s,null,null,null).ok,false);
 assert.equal(AttendanceService.zoneCheck('c','u1',41.3111,69.2797,15).ok,true);
 assert.equal(AttendanceService.me('c','u1').zone_required,true);
 // A check from 150 m is refused even though the face matches.
 const r=check('IN',at('2026-10-01','08:30'),{lat:41.3111+0.00135});
 assert.equal(r.event.status,'REJECTED');
 assert.equal(AttendanceService.dayFor(s,'e1','2026-10-01').first_in,null);
 // Rule off: anywhere is allowed again.
 AttendanceService.saveSettings('c',{require_zone:false} as any,boss);
 assert.equal(AttendanceService.zoneVerdict(AttendanceService.settings('c'),41.4,69.3,10).ok,true);
});

test('work places: a switched-off one does not count; one limited to some employees counts only for them',()=>{
 setup();
 db.insert('employees',{id:'e2',company_id:'c',full_name:'Vali Skladchi',position:'Skladchi',phone:'',salary_type:'FIXED',status:'ACTIVE',created_at:''} as any);
 AttendanceService.saveSettings('c',{require_zone:true,zones:[
  {name:'Sklad',lat:41.3111,lng:69.2797,radius_m:100,employee_ids:['e2','not-ours']},
  {name:'Eski ofis',lat:41.40,lng:69.30,radius_m:100,active:false}
 ]} as any,boss);
 const s=AttendanceService.settings('c');
 assert.deepEqual(s.zones[0].employee_ids,['e2'],'unknown employees are dropped');
 assert.equal(s.zones[1].active,false);
 assert.equal(AttendanceService.zoneVerdict(s,41.3111,69.2797,10,'e2').ok,true,'the warehouse worker at the warehouse');
 const other=AttendanceService.zoneVerdict(s,41.3111,69.2797,10,'e1');
 assert.equal(other.ok,false);assert.match(other.message,/biriktirilmagan/,'Ali has no place of his own');
 assert.equal(AttendanceService.zoneVerdict(s,41.40,69.30,10,'e2').ok,false,'the switched-off office does not count');
 // A place for everyone lets Ali in again.
 AttendanceService.saveSettings('c',{zones:[...s.zones,{name:'Ofis',lat:41.35,lng:69.28,radius_m:200}]} as any,boss);
 assert.equal(AttendanceService.zoneVerdict(AttendanceService.settings('c'),41.35,69.28,10,'e1').ok,true);
});

test('lateness, early leave, absence, excuse and the penalty with its monthly cap reach payroll',()=>{
 setup();
 AttendanceService.saveSettings('c',{default_schedule:{start:'09:00',end:'18:00',grace_minutes:10,workdays:[1,2,3,4,5,6]},penalty:{mode:'PER_MINUTE',amount:1000,early_leave:true,monthly_cap:50000}} as any,boss);
 check('IN',at('2026-09-28','09:05'));            // within grace: not late
 check('OUT',at('2026-09-28','18:00'));
 check('IN',at('2026-09-29','09:25'));            // 25 min late
 check('OUT',at('2026-09-29','17:40'));           // 20 min early
 check('IN',at('2026-09-30','09:40'));            // 40 min late, excused below
 const rows=AttendanceService.report('c','2026-09-28','2026-09-30');
 const by=Object.fromEntries(rows.map(r=>[r.date,r]));
 assert.equal(by['2026-09-28'].late_minutes,0);
 assert.equal(by['2026-09-29'].late_minutes,25);
 assert.equal(by['2026-09-29'].early_minutes,20);
 assert.equal(by['2026-09-29'].penalty,45000);
 assert.equal(by['2026-09-30'].penalty,5000,'cap 50 000: 45 000 used on the 29th, only 5 000 of the 40 000 left');
 AttendanceService.excuse('c','e1','2026-09-30',true,'mijozga topshiriq',boss);
 const after=Object.fromEntries(AttendanceService.report('c','2026-09-28','2026-09-30').map(r=>[r.date,r]));
 assert.equal(after['2026-09-30'].status,'EXCUSED');
 assert.equal(after['2026-09-30'].penalty,0);
 // A workday with no arrival is an absence.
 assert.equal(AttendanceService.report('c','2026-09-26','2026-09-26')[0].status,'ABSENT');
 // Payroll: the penalty is a deduction.
 const pay=SalaryService.calculateMonthlySalary({company_id:'c',employee_id:'e1',period_month:'2026-09',user_id:'u',user_email:'u@x'});
 assert.equal(pay.deduction_amount,45000);
 assert.match(pay.deduction_breakdown[0].description,/Davomat jarimasi/);
});

test('a manager decides a check under review',()=>{
 setup();
 const r=check('IN',at('2026-09-29','09:00'),{accuracy_m:900});
 assert.equal(r.event.status,'REVIEW');
 assert.equal(AttendanceService.report('c','2026-09-29','2026-09-29')[0].first_in,null,'not counted until accepted');
 AttendanceService.review('c',r.event.id,'ACCEPTED','telefon GPS yomon edi',boss);
 assert.equal(AttendanceService.report('c','2026-09-29','2026-09-29')[0].first_in,'09:00');
});
