import {beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {db} from '../db/database.ts';
import {removeTestExpenseCategoriesMigration} from '../db/migrations/015_remove_test_expense_categories.ts';

beforeEach(()=>{db.init();db.reset();});
const cat=(id:string,name:string,created='2026-09-20T10:00:00.000Z')=>db.insert('expense_categories',{id,company_id:'c',name,monthly_limit:0,is_active:true,created_at:created,updated_at:created} as any);

test('test leftovers leave the category list (kept in quarantine); real and used categories stay',async()=>{
 cat('t1','Sinov Toifasi 1');cat('t2','Audit Sinovi Toifasi-3072');cat('t3','Kichik Limit Toifasi-1763');cat('t4','Eski Toifa-5060');
 cat('used','Audit Sinovi Toifasi');                       // a test name, but an expense points at it
 cat('real','Ofis va Ma\'muriy');                           // a real category
 cat('later','Eski Toifa','2026-11-01T00:00:00.000Z');     // created by someone later: not touched
 db.insert('expenses',{id:'e',company_id:'c',category_id:'used',amount:1,date:'2026-09-21',status:'CONFIRMED',created_at:''} as any);
 await removeTestExpenseCategoriesMigration.up();
 assert.deepEqual(db.getTable('expense_categories').map(c=>c.id).sort(),['later','real','used']);
 const q=db.getTable('_quarantine').filter((r:any)=>r.table==='expense_categories');
 assert.deepEqual(q.map((r:any)=>r.row.id).sort(),['t1','t2','t3','t4']);
 // Running again changes nothing.
 await removeTestExpenseCategoriesMigration.up();
 assert.equal(db.getTable('expense_categories').length,3);
});
