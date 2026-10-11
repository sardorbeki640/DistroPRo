import {beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {db} from '../db/database.ts';

process.env.JWT_SECRET ||= 'test-secret-for-storage-0123456789';
beforeEach(()=>{db.init();db.reset();});
const reopen=()=>{db.close();db.init();};

test('rows survive a restart in their order; duplicate legacy ids are kept apart',()=>{
 db.insert('companies',{id:'b',name:'B'} as any);
 db.insert('companies',{id:'a',name:'A'} as any);
 db.update('companies','b',{name:'B2'} as any);
 db.upsertMany('companies',[{id:'c',name:'C'} as any,{id:'a',name:'A2'} as any]);
 db.insert('notifications',{id:'dup',n:1} as any);
 db.insert('notifications',{id:'dup',n:2} as any);
 reopen();
 assert.deepEqual(db.getTable('companies').map((c:any)=>[c.id,c.name]),[['b','B2'],['a','A2'],['c','C']]);
 assert.deepEqual(db.getTable('notifications').map((n:any)=>n.n),[1,2]);
});

test('a failed transaction leaves memory and disk unchanged; deletes and bulk removes persist',()=>{
 db.insert('companies',{id:'keep'} as any);
 assert.throws(()=>db.transaction(()=>{db.update('companies','keep',{name:'X'} as any);db.delete('companies','keep');db.insert('companies',{id:'new'} as any);throw new Error('no');}),/no/);
 assert.deepEqual(db.getTable('companies').map((c:any)=>[c.id,c.name]),[['keep',undefined]]);
 assert.deepEqual(db.readPersisted('companies').map((c:any)=>c.id),['keep']);
 db.insert('companies',{id:'gone'} as any);
 db.removeWhere('companies',(c:any)=>c.id==='gone');
 db.delete('companies','keep');
 reopen();
 assert.equal(db.getTable('companies').length,0);
});

test('integration passwords are encrypted on disk and readable in memory',()=>{
 db.insert('integrations',{id:'i',company_id:'c',provider_name:'LINKO',status:'CONNECTED',config:{username:'u',password:'Sir-123',api_token:'tok-9'}} as any);
 const disk=JSON.stringify(db.readPersisted('integrations'));
 const raw=JSON.stringify((db as any).sql.prepare("SELECT data FROM rows WHERE tbl='integrations'").all());
 assert.ok(!raw.includes('Sir-123') && !raw.includes('tok-9'),'not plain on disk');
 assert.ok(disk.includes('Sir-123'),'readPersisted decrypts');
 reopen();
 assert.equal((db.findById('integrations','i') as any).config.password,'Sir-123');
});

test('in-place edits are saved only when marked; checkpoint saves everything',()=>{
 db.insert('customers',{id:'k',company_id:'c',name:'A'} as any);
 (db.findById('customers','k') as any).name='B';
 db.markDirty('customers',[db.findById('customers','k')]);
 db.persist();
 assert.equal(db.readPersisted('customers')[0].name,'B');
 (db.findById('customers','k') as any).name='C';
 db.checkpointAll();
 assert.equal(db.readPersisted('customers')[0].name,'C');
});

test('old finance_db.json is imported once and kept; backups are complete copies',()=>{
 db.close();
 const dir=db.directory;
 const sqliteFile=path.join(dir,'finance.sqlite');
 for(const f of fs.readdirSync(dir)) if(f.startsWith('finance.sqlite')) fs.rmSync(path.join(dir,f));
 fs.writeFileSync(path.join(dir,'finance_db.json'),JSON.stringify({companies:[{id:'old',name:'Eski'}],customers:[{id:'x',company_id:'old',name:'M'}]}));
 db.init();
 assert.equal(db.findById('companies','old')!.name,'Eski');
 assert.ok(fs.readdirSync(dir).some(f=>f.startsWith('finance_db.json.imported-')));
 assert.ok(!fs.existsSync(path.join(dir,'finance_db.json')));
 assert.ok(fs.existsSync(sqliteFile));
 const copy=db.backupTo(path.join(dir,'backups','test.sqlite'));
 assert.ok(fs.statSync(copy).size>0);
});
