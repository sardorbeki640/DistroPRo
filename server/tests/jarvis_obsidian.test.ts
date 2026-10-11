import {afterEach,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {db} from '../db/database.ts';
import {JarvisService} from '../jarvis/jarvis.service.ts';
import {AUTO_MARK,checkVaultPath,inside,searchVault,syncVault,writeJarvisNote} from '../jarvis/obsidian.ts';
import {TOOLS,toolsFor,runTool} from '../jarvis/tools.ts';

process.env.JWT_SECRET ||= 'test-secret-for-jarvis-0123456789';
const actor={companyId:'c',userId:'u',email:'u@x'};
let vault='';

beforeEach(()=>{
 db.init();db.reset();
 vault=fs.mkdtempSync(path.join(os.tmpdir(),'jarvis-vault-'));
 db.insert('companies',{id:'c',name:'Nam Distribution'} as any);
 db.insert('users',{id:'u',company_id:'c',email:'u@x',full_name:'Xusan',status:'ACTIVE'} as any);
 db.insert('roles',{id:'r',company_id:'c',name:'SUPER_ADMIN',description:'',is_system:true,created_at:''} as any);
 db.insert('user_roles',{id:'ur',user_id:'u',role_id:'r'} as any);
 db.insert('agents',{id:'a1',company_id:'c',code:'ТП1',full_name:'Ali Valiyev',phone:'',status:'ACTIVE',created_at:''} as any);
 db.insert('customers',{id:'k',company_id:'c',code:'a0_1',name:'Chust do‘kon',phone:'+998901112233',agent_id:'a1',credit_limit:0,current_balance:500000,status:'ACTIVE',is_active:true,created_at:''} as any);
});
afterEach(()=>{fs.rmSync(vault,{recursive:true,force:true});});

test('tool names are unique (the AI service refuses a list with a repeated name)',()=>{
 const names=TOOLS.map(t=>t.name);
 assert.equal(new Set(names).size,names.length,`repeated: ${names.filter((n,i)=>names.indexOf(n)!==i)}`);
});

test('the vault is filled from the books; the owner’s own notes are never overwritten',()=>{
 fs.writeFileSync(path.join(vault,'Bosh sahifa.md'),'Mening rejalarim — tegma');
 const r=syncVault('c',vault);
 assert.ok(r.written>=6);
 assert.deepEqual(r.skipped,['Bosh sahifa'],'the owner wrote that note');
 assert.equal(fs.readFileSync(path.join(vault,'Bosh sahifa.md'),'utf8'),'Mening rejalarim — tegma');
 const agent=fs.readFileSync(path.join(vault,'Agentlar','Ali Valiyev.md'),'utf8');
 assert.ok(agent.includes(AUTO_MARK)&&agent.includes('# Ali Valiyev'));
 const debts=fs.readFileSync(path.join(vault,'Mijozlar','Qarzdorlar.md'),'utf8');
 assert.match(debts,/Chust do‘kon/);assert.match(debts,/\[\[Agentlar\/Ali Valiyev\|Ali Valiyev\]\]/,'linked to the agent note');
 const today=fs.readdirSync(path.join(vault,'Kundalik'));
 assert.equal(today.length,1);
 // A second run replaces Jarvis's notes in place (no duplicates).
 syncVault('c',vault);
 assert.equal(fs.readdirSync(path.join(vault,'Kundalik')).length,1);
});

test('Jarvis writes only inside the vault and only its own notes',()=>{
 assert.throws(()=>inside(vault,'../tashqarida'),/tashqarisi/);
 assert.throws(()=>inside(vault,'.obsidian/app.json'),/sozlama/);
 const w=writeJarvisNote(vault,'Qarz rejasi: oktyabr','1. Chust do‘konga qo‘ng‘iroq');
 assert.equal(w.saved,'Jarvis/Qarz rejasi oktyabr');
 writeJarvisNote(vault,'Qarz rejasi: oktyabr','2. To‘lov va’dasi olindi',true);
 const text=fs.readFileSync(path.join(vault,'Jarvis','Qarz rejasi oktyabr.md'),'utf8');
 assert.ok(text.includes('1. Chust')&&text.includes('2. To‘lov'),'append keeps the earlier part');
 fs.mkdirSync(path.join(vault,'Jarvis'),{recursive:true});
 fs.writeFileSync(path.join(vault,'Jarvis','Mening.md'),'egasi yozgan');
 assert.throws(()=>writeJarvisNote(vault,'Mening','yangi'),/egasi yozgan/);
 assert.throws(()=>writeJarvisNote(vault,'Mening','yangi',true),/egasi yozgan/);
});

test('search finds the owner’s notes and Jarvis’s, marking which is which',()=>{
 fs.mkdirSync(path.join(vault,'Rejalar'));
 fs.writeFileSync(path.join(vault,'Rejalar','2027.md'),'Yangi ombor ochish: Chust shahrida, bahorda');
 syncVault('c',vault);
 const hits=searchVault(vault,'chust ombor');
 assert.equal(hits[0].note,'Rejalar/2027');assert.equal(hits[0].mine,true);
 assert.ok(hits.some(h=>!h.mine),'Jarvis notes are found too');
});

test('vault settings: checked path, folder created and filled; Obsidian tools offered only when connected',async()=>{
 assert.throws(()=>checkVaultPath('nisbiy/papka'),/To‘liq manzil/);
 assert.throws(()=>checkVaultPath(path.parse(vault).root),/Diskning o‘zini/);
 assert.ok(!toolsFor('c').some(t=>t.name.startsWith('obsidian_')));
 const target=path.join(vault,'Biznes');
 const v=JarvisService.saveObsidian(actor,{vault:target,auto:true});
 assert.deepEqual([v.vault,v.auto,v.exists,!!v.last_sync],[target,true,true,true]);
 assert.ok(fs.existsSync(path.join(target,'Agentlar','Agentlar.md')));
 assert.ok(toolsFor('c').some(t=>t.name==='obsidian_search'));
 const found=await runTool(actor,'obsidian_search',{query:'Ali'});
 assert.equal(found.ok,true);assert.match(found.text,/Agentlar\/Ali Valiyev/);
 const off=JarvisService.saveObsidian(actor,{vault:null});
 assert.equal(off.vault,null);
 assert.ok(!toolsFor('c').some(t=>t.name.startsWith('obsidian_')));
});
