import {beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {db} from '../db/database.ts';
import {TeamsService} from '../services/teams.service.ts';
import {SalaryService} from '../services/salary.service.ts';
import {agentOfUser,myPerformance} from '../services/agent-strategy.service.ts';

const owner={id:'u',email:'u@x'};
beforeEach(()=>{
 db.init();db.reset();
 db.insert('agents',{id:'tp1',company_id:'c',full_name:'ТП1',code:'d0_1',status:'ACTIVE'} as any);
 db.insert('employees',{id:'e-ali',company_id:'c',full_name:'Ali',position:'Savdo agenti',phone:'',salary_type:'PIECEWORK',status:'ACTIVE',created_at:''} as any);
 for(const [sku,cat] of [['s1','Семичка'],['b1','BRANDO']]) db.insert('products',{id:sku,company_id:'c',sku,name:sku,category:cat,unit:'dona',purchase_cost:0,current_cost:0,selling_price:0} as any);
 // September: one delivered order on the shared profile, 1000 of each team's category.
 db.insert('sales_orders',{id:'o1',company_id:'c',customer_id:'k1',agent_id:'tp1',order_date:'2026-09-05',total_sales:2000,discount_amount:0,return_amount:0,net_sales:2000,status:'DELIVERED'} as any);
 db.insert('sales_order_items',{id:'i1',sales_order_id:'o1',sku:'s1',product_id:'s1',product_name:'s1',quantity:1,total_amount:1000} as any);
 db.insert('sales_order_items',{id:'i2',sales_order_id:'o1',sku:'b1',product_id:'b1',product_name:'b1',quantity:1,total_amount:1000} as any);
});

test('one profile used by two people is two employees: a new one is created, each place holds one employee',()=>{
 assert.throws(()=>TeamsService.save('c',[{name:'1-Komanda',categories:['Семичка'],member_employees:{tp1:'NEW'}}],owner),/ismini yozing/);
 const r=TeamsService.save('c',[
  {name:'1-Komanda',categories:['Семичка'],member_employees:{tp1:'e-ali'}},
  {name:'2-Komanda',categories:['BRANDO'],members:{tp1:'Vali'},member_employees:{tp1:'NEW'}}
 ],owner);
 assert.deepEqual(r.created,['Vali']);
 const vali=db.findOne('employees',e=>e.full_name==='Vali')!;
 assert.deepEqual([vali.position,vali.status],['Savdo agenti','ACTIVE']);
 assert.equal(TeamsService.list('c')[1].member_employees!.tp1,vali.id);
 assert.equal(TeamsService.list('c')[0].members.tp1,'Ali','the name follows the employee');
 assert.throws(()=>TeamsService.save('c',[
  {name:'1-Komanda',categories:['Семичка'],member_employees:{tp1:'e-ali'}},
  {name:'2-Komanda',categories:['BRANDO'],member_employees:{tp1:'e-ali'}}
 ],owner),/ikki joyga/);
 assert.deepEqual(TeamsService.placesOf('c',vali.id).map(p=>p.team_name),['2-Komanda']);
});

test('each person’s percent of own sales counts only their team’s categories; the cabinet shows their part',()=>{
 TeamsService.save('c',[
  {name:'1-Komanda',categories:['Семичка'],member_employees:{tp1:'e-ali'}},
  {name:'2-Komanda',categories:['BRANDO'],members:{tp1:'Vali'},member_employees:{tp1:'NEW'}}
 ],owner);
 const ali=db.findById('employees','e-ali')!;
 const base=SalaryService.percentBase('c',ali,{type:'PERCENT',percent:5,base:'OWN_SALES'} as any,'2026-09');
 assert.equal(base.base,1000,'only Семичка, not the whole profile (2000)');
 assert.match(base.label,/1-Komanda/);
 // Signed in as Ali: the cabinet finds the shared profile and his team's part.
 db.insert('users',{id:'u-ali',company_id:'c',email:'ali@x',full_name:'Ali',status:'ACTIVE'} as any);
 db.update('employees','e-ali',{user_id:'u-ali'} as any);
 assert.equal(agentOfUser('c','u-ali')!.id,'tp1');
 const p:any=myPerformance('c','u-ali');
 assert.equal(p.team.name,'1-Komanda');
 assert.deepEqual(p.team.categories,['Семичка']);
});
