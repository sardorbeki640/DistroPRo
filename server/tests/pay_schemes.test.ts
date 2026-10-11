import {beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {db} from '../db/database.ts';
import {SalaryService,cleanPayComponents} from '../services/salary.service.ts';

process.env.JWT_SECRET ||= 'test-secret-for-pay-schemes-0123456789';
beforeEach(()=>{db.init();db.reset();});

const who={user_id:'u',user_email:'u@x'};
const employee=(id:string,name:string)=>db.insert('employees',{id,company_id:'c',full_name:name,position:'x',phone:'',salary_type:'FIXED',status:'ACTIVE',created_at:''} as any);
const order=(id:string,date:string,net:number,extra:any={})=>db.insert('sales_orders',{id,company_id:'c',order_number:id,order_date:date,customer_id:'k',customer_name:'K',status:'DELIVERED',total_sales:net,return_amount:0,net_sales:net,...extra} as any);
const calc=(id:string)=>SalaryService.calculateMonthlySalary({company_id:'c',employee_id:id,period_month:'2026-09',...who});

test('any employee: monthly + daily + piece + percent parts, each from its own source',()=>{
 employee('e1','Ali Valiyev');
 db.insert('agents',{id:'ag1',company_id:'c',employee_id:'e1',code:'A1',full_name:'Ali',phone:'',commission_rate:0,status:'ACTIVE',created_at:''} as any);
 SalaryService.setPayComponents('c','e1',cleanPayComponents([
  {type:'MONTHLY',amount:2000000},
  {type:'DAILY',rate:100000},
  {type:'PER_UNIT',unit:'PIECE',rate:500},
  {type:'PERCENT',percent:2,base:'OWN_SALES'},
  {type:'PERCENT',percent:1,base:'COMPANY_SALES'}
 ]));
 order('o1','2026-09-03',1000000,{agent_id:'ag1'});
 order('o2','2026-09-10',500000,{agent_id:'other'});
 order('o3','2026-08-30',9000000,{agent_id:'ag1'}); // another month
 order('o4','2026-09-11',700000,{agent_id:'ag1',status:'PENDING'}); // not delivered
 SalaryService.recordWork({company_id:'c',employee_id:'e1',unit_type:'DAY',units:20,date:'2026-09-30',...who});          // rate from scheme
 SalaryService.recordWork({company_id:'c',employee_id:'e1',unit_type:'PIECE',units:300,date:'2026-09-15',...who});
 SalaryService.recordWork({company_id:'c',employee_id:'e1',unit_type:'PIECE',units:10,rate:700,date:'2026-09-16',...who}); // own rate

 const r=calc('e1');
 assert.equal(r.base_amount,2000000);
 assert.equal(r.piecework_amount,20*100000+300*500+10*700);
 assert.equal(r.bonus_amount,Math.round(1000000*0.02)+Math.round(1500000*0.01));
 assert.equal(r.final_amount,2000000+2157000+35000);
 assert.equal(db.findById('employees','e1')!.salary_type,'HYBRID');
 assert.equal(db.findOne('agents',a=>a.id==='ag1')!.commission_rate,2,'agent commission follows the scheme');
});

test('expeditor percent counts only orders that person delivered',()=>{
 employee('e2','Bobur Karimov');
 SalaryService.setPayComponents('c','e2',cleanPayComponents([{type:'PERCENT',percent:3,base:'OWN_DELIVERIES'}]));
 order('d1','2026-09-05',400000,{expeditor_name:' bobur karimov '});
 order('d2','2026-09-06',600000,{expeditor_name:'Boshqa'});
 const r=calc('e2');
 assert.equal(r.bonus_amount,12000);
 assert.equal(db.findById('employees','e2')!.salary_type,'PIECEWORK');
});

test('no invented pay: no rule means zero; work needs a rate; a paid month is closed',()=>{
 employee('e3','Nodir');
 assert.equal(calc('e3').final_amount,0,'no 5 000 000 default');
 assert.throws(()=>SalaryService.recordWork({company_id:'c',employee_id:'e3',unit_type:'HOUR',units:8,date:'2026-09-01',...who}),/stavka kiritilmagan/);
 db.insert('salaries',{id:'s',company_id:'c',employee_id:'e3',period_month:'2026-09',base_amount:0,bonus_amount:0,deduction_amount:0,piecework_amount:0,final_amount:0,status:'PAID',created_at:''} as any);
 assert.throws(()=>SalaryService.recordWork({company_id:'c',employee_id:'e3',unit_type:'HOUR',units:8,rate:30000,date:'2026-09-02',...who}),/to‘langan/);
 assert.throws(()=>cleanPayComponents([{type:'PERCENT',percent:150,base:'OWN_SALES'}]),/Foiz/);
});

test('older rules keep working: base salary and an agent commission',()=>{
 employee('e4','Old');
 db.insert('salary_rules',{id:'r',company_id:'c',employee_id:'e4',base_salary:3000000,is_active:true} as any);
 db.insert('agents',{id:'ag4',company_id:'c',employee_id:'e4',code:'A4',full_name:'Old',phone:'',commission_rate:1.5,status:'ACTIVE',created_at:''} as any);
 order('x','2026-09-09',2000000,{agent_id:'ag4'});
 const r=calc('e4');
 assert.equal(r.base_amount,3000000);
 assert.equal(r.bonus_amount,30000);
});
