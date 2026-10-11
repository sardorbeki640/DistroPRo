import {beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {db} from '../db/database.ts';
import {StaffService} from '../services/staff.service.ts';

beforeEach(()=>{
 db.init();db.reset();
 db.insert('companies',{id:'c',name:'Nam'} as any);
 for(const [id,name] of [['r-owner','SUPER_ADMIN'],['r-admin','ADMIN'],['r-emp','EMPLOYEE']]) db.insert('roles',{id,company_id:'c',name,description:'',is_system:true,created_at:''} as any);
 const user=(id:string,email:string,login:string,role:string,employee_id?:string)=>{
  db.insert('users',{id,company_id:'c',email,login,full_name:id,status:'ACTIVE',employee_id,created_at:'',updated_at:''} as any);
  db.insert('user_roles',{id:'ur-'+id,user_id:id,role_id:role} as any);
 };
 db.insert('employees',{id:'e1',company_id:'c',user_id:'ali',full_name:'Ali',position:'Agent',phone:'901',salary_type:'FIXED',status:'ACTIVE',created_at:''} as any);
 db.insert('agents',{id:'g1',company_id:'c',employee_id:'e1',user_id:'ali',code:'AG-001',full_name:'Ali',phone:'901',commission_rate:0,status:'ACTIVE',created_at:''} as any);
 db.insert('employees',{id:'e-owner',company_id:'c',user_id:'owner',full_name:'Egasi',position:'Direktor',phone:'',salary_type:'FIXED',status:'ACTIVE',created_at:''} as any);
 user('owner','owner@x.uz','owner','r-owner','e-owner');
 user('admin','admin@x.uz','admin','r-admin');
 user('ali','ali@xodim.local','ali','r-emp','e1');
});
const op=(id:string)=>({userId:id,email:`${id}@x`,companyId:'c'});

test('anyone edits their own profile; position stays with the manager; name syncs to card and agent',()=>{
 const p=StaffService.updateMyProfile(op('ali'),{full_name:'  Ali   Karimov ',phone:'+998 90 111 22 33',login:'ali.k',email:'ali@mail.uz',position:'Direktor'});
 assert.deepEqual([p.full_name,p.phone,p.login,p.email,p.position],['Ali Karimov','+998 90 111 22 33','ali.k','ali@mail.uz','Agent']);
 assert.equal(db.findById('employees','e1')!.full_name,'Ali Karimov');
 assert.equal(db.findById('agents','g1')!.phone,'+998 90 111 22 33');
 assert.throws(()=>StaffService.updateMyProfile(op('ali'),{login:'admin'}),/band/);
 assert.throws(()=>StaffService.updateMyProfile(op('ali'),{email:'owner@x.uz'}),/boshqa hisobda/);
 assert.throws(()=>StaffService.updateMyProfile(op('ali'),{phone:'abc'}),/Telefon/);
});

test('admin edits a staff profile; the owner account is changed only by the owner',()=>{
 const row:any=StaffService.updateStaffProfile(op('admin'),'e1',{full_name:'Ali Valiyev',position:'Katta agent',login:'ali.v'});
 assert.deepEqual([row.employee.full_name,row.employee.position,row.account.login],['Ali Valiyev','Katta agent','ali.v']);
 assert.equal(db.findById('users','ali')!.full_name,'Ali Valiyev');
 assert.throws(()=>StaffService.updateStaffProfile(op('admin'),'e-owner',{full_name:'Boshqa'}),/faqat egasi/);
 const own:any=StaffService.updateStaffProfile(op('owner'),'e-owner',{position:'Bosh direktor'});
 assert.equal(own.employee.position,'Bosh direktor');
});
