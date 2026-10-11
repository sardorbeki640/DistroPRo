import {beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {db} from '../db/database.ts';
import {JarvisService} from '../jarvis/jarvis.service.ts';
import {computeInsights} from '../jarvis/insights.ts';

process.env.JWT_SECRET ||= 'test-secret-for-jarvis-0123456789';
const KEY='sk-ant-api03-'+'x'.repeat(40);
const ctx={companyId:'c',userId:'u',email:'u@x'};
const actor={companyId:'c',userId:'u',email:'u@x'};

beforeEach(()=>{
 db.init();db.reset();JarvisService.transport=undefined;
 db.insert('companies',{id:'c',name:'Nam Distribution'} as any);
 db.insert('users',{id:'u',company_id:'c',email:'u@x',full_name:'Xusan',status:'ACTIVE'} as any);
 // Jarvis is for the owner (the route refuses everyone else).
 db.insert('roles',{id:'r',company_id:'c',name:'SUPER_ADMIN',description:'',is_system:true,created_at:''} as any);
 db.insert('user_roles',{id:'ur',user_id:'u',role_id:'r'} as any);
 db.insert('customers',{id:'k',company_id:'c',code:'a0_1',name:'Chust do‘kon',phone:'',credit_limit:0,current_balance:500000,status:'ACTIVE',is_active:true,created_at:''} as any);
});

test('API key is checked, stored encrypted and never returned',()=>{
 assert.throws(()=>JarvisService.saveSettings(actor,{api_key:'hello'}),/Claude API/);
 const s=JarvisService.saveSettings(actor,{api_key:KEY,model:'claude-sonnet-5'});
 assert.deepEqual([s.configured,s.model],[true,'claude-sonnet-5']);
 assert.ok(!JSON.stringify(s).includes(KEY));
 assert.ok(!JSON.stringify(db.getTable('jarvis_settings')).includes(KEY),'not stored in plain text');
 assert.throws(()=>JarvisService.saveSettings(actor,{model:'bad model!'}),/Model/);
});

test('any AI: switching service needs its own key; addresses must be https or this computer',()=>{
 let s=JarvisService.saveSettings(actor,{api_key:KEY});
 assert.deepEqual([s.provider,s.model],['anthropic','claude-opus-5'],'Claude Opus 5 by default');
 // Gemini was removed: it cannot be chosen, and an old Gemini setup counts as "not set up" until Claude gets a key.
 assert.throws(()=>JarvisService.saveSettings(actor,{provider:'gemini' as any}),/Noma’lum AI/);
 db.update('jarvis_settings','c',{provider:'gemini',model:'gemini-3.8-flash'} as any);
 s=JarvisService.publicSettings('c') as any;
 assert.deepEqual([s.provider,s.configured,s.has_key,s.model],['anthropic',false,false,'claude-opus-5']);
 assert.equal(JarvisService.ready('c'),false);
 s=JarvisService.saveSettings(actor,{provider:'anthropic',api_key:KEY});
 assert.deepEqual([s.provider,s.configured],['anthropic',true]);
 assert.throws(()=>JarvisService.saveSettings(actor,{provider:'openai_compatible',base_url:'http://example.com/v1'}),/https/);
 s=JarvisService.saveSettings(actor,{provider:'openai_compatible',base_url:'http://localhost:11434/v1',model:'llama3.1'});
 assert.deepEqual([s.configured,s.base_url,s.model],[true,'http://localhost:11434/v1','llama3.1'],'Ollama works without a key');
 s=JarvisService.saveSettings(actor,{voice_provider:'azure',voice_key:'a'.repeat(32),voice_region:'westeurope',voice_gender:'male'});
 assert.deepEqual(s.voice,{provider:'azure',configured:true,region:'westeurope',gender:'male'});
 assert.ok(!JSON.stringify(db.getTable('jarvis_settings')).includes('a'.repeat(32)),'voice key encrypted');
 assert.equal(JarvisService.voiceConfig('c').key,'a'.repeat(32));
});

test('a question runs the tools Claude asks for, logs them, and stores the answer',async()=>{
 JarvisService.saveSettings(actor,{api_key:KEY});
 const bodies:any[]=[];let seenKey='';
 JarvisService.transport=async(config,body)=>{
  bodies.push(JSON.parse(JSON.stringify(body)));seenKey=config.apiKey;
  if(bodies.length===1) return {stop_reason:'tool_use',content:[{type:'text',text:'Ko‘rib chiqaman.'},{type:'tool_use',id:'t1',name:'business_overview',input:{}}]};
  return {stop_reason:'end_turn',content:[{type:'text',text:'Jami qarz 500 000 so‘m.'}]};
 };
 const view=await JarvisService.ask(ctx,'Qarzlar qancha?');
 assert.equal(seenKey,KEY);
 assert.match(bodies[0].system,/Nam Distribution/);
 assert.ok(bodies[0].tools.some((t:any)=>t.name==='debt_aging'));
 const result=bodies[1].messages.at(-1).content[0];
 assert.equal(result.type,'tool_result');assert.equal(result.tool_use_id,'t1');
 assert.match(result.content,/"total_debt":500000/);
 assert.deepEqual(view.items.map(i=>i.role),['user','assistant','tool','assistant']);
 assert.equal(view.items.at(-1)!.text,'Jami qarz 500 000 so‘m.');
 const actions=JarvisService.actions(ctx);
 assert.equal(actions.length,1);assert.equal(actions[0].tool,'business_overview');assert.equal(actions[0].status,'DONE');
 // A follow-up in the same conversation sends the earlier turn too.
 JarvisService.transport=async(_c,body)=>{bodies.push(body);return {stop_reason:'end_turn',content:[{type:'text',text:'Ha.'}]};};
 await JarvisService.ask(ctx,'Rahmat',view.id);
 assert.equal((bodies.at(-1) as any).messages.length,5);
});

test('tool errors go back to Claude; CRM task is created through the tool',async()=>{
 JarvisService.saveSettings(actor,{api_key:KEY});
 let step=0;let errorText='';
 JarvisService.transport=async(_c,body:any)=>{
  step++;
  if(step===1) return {stop_reason:'tool_use',content:[{type:'tool_use',id:'a',name:'customer_card',input:{customer:'Yo‘q mijoz'}},{type:'tool_use',id:'b',name:'create_crm_task',input:{title:'Chust do‘kondan qarz undirish',customer:'Chust',due_date:'2026-10-05',priority:'HIGH'}}]};
  errorText=body.messages.at(-1).content[0].content;
  return {stop_reason:'end_turn',content:[{type:'text',text:'Vazifa yaratildi.'}]};
 };
 await JarvisService.ask(ctx,'Chust do‘kon uchun vazifa yarat');
 assert.match(errorText,/topilmadi/);
 const task=db.findOne('crm_tasks',t=>t.title==='Chust do‘kondan qarz undirish')!;
 assert.equal(task.customer_id,'k');assert.equal(task.priority,'HIGH');
 assert.deepEqual(JarvisService.actions(ctx).map(a=>a.status).sort(),['DONE','FAILED']);
});

test('memory: remember / forget through tools, and memories reach the next conversation',async()=>{
 JarvisService.saveSettings(actor,{api_key:KEY});
 let step=0;let systems:string[]=[];
 JarvisService.transport=async(_c,body:any)=>{
  systems.push(body.system);step++;
  if(step===1) return {stop_reason:'tool_use',content:[{type:'tool_use',id:'m1',name:'remember',input:{text:'Oylik savdo rejasi 1,5 mlrd so‘m'}}]};
  if(step===3) return {stop_reason:'tool_use',content:[{type:'tool_use',id:'m2',name:'forget',input:{text:'savdo rejasi'}}]};
  return {stop_reason:'end_turn',content:[{type:'text',text:'Bo‘ldi.'}]};
 };
 await JarvisService.ask(ctx,'Eslab qol: oylik reja 1,5 mlrd');
 assert.equal(JarvisService.memories(ctx).length,1);
 await JarvisService.ask(ctx,'Rejani unut');
 assert.match(systems[2],/Oylik savdo rejasi 1,5 mlrd/,'memory is in the next system prompt');
 assert.equal(JarvisService.memories(ctx).length,0);
});

test('“open the cash page” comes back as a navigation for the screen',async()=>{
 JarvisService.saveSettings(actor,{api_key:KEY});
 let step=0;
 JarvisService.transport=async()=>{step++;return step===1?{stop_reason:'tool_use',content:[{type:'tool_use',id:'n',name:'open_page',input:{page:'cash'}}]}:{stop_reason:'end_turn',content:[{type:'text',text:'Kassa ochildi.'}]};};
 const r:any=await JarvisService.ask(ctx,'Kassani och');
 assert.deepEqual(r.client_actions,[{type:'navigate',page:'cash'}]);
});

test('insights: old debts, stock running out and unopened cash are flagged without AI',()=>{
 db.insert('customer_balance_transactions',{id:'d1',company_id:'c',customer_id:'k',transaction_type:'DEBIT',debit_amount:900000,credit_amount:0,amount:900000,date:'2026-01-10',status:'CONFIRMED',created_at:''} as any);
 db.insert('customer_balance_transactions',{id:'p1',company_id:'c',customer_id:'k',transaction_type:'CREDIT',debit_amount:0,credit_amount:400000,amount:400000,date:'2026-02-10',status:'CONFIRMED',created_at:''} as any);
 db.insert('products',{id:'p',company_id:'c',sku:'s',name:'Sut 1 l',is_active:true,stock_quantity:20,daily_sales_avg:10,purchase_cost:0} as any);
 const list=computeInsights('c',true);
 const debt=list.find(i=>i.id==='debt-60')!;
 assert.match(debt.title,/500 000/);assert.match(debt.detail,/Chust/);
 assert.equal(list.find(i=>i.id==='stock')!.level,'critical');
 assert.ok(list.some(i=>i.id==='cost'));
});

test('morning briefing runs once a day only when switched on',async()=>{
 JarvisService.saveSettings(actor,{api_key:KEY});
 let calls=0;
 JarvisService.transport=async()=>{calls++;return {stop_reason:'end_turn',content:[{type:'text',text:'Brifing.'}]};};
 assert.equal(await JarvisService.morningBriefing('c'),null,'off by default');
 JarvisService.saveSettings(actor,{auto_briefing:true});
 const id=await JarvisService.morningBriefing('c');
 assert.ok(id);assert.match(JarvisService.listConversations(ctx)[0].title,/Ertalabki brifing/);
 assert.equal(await JarvisService.morningBriefing('c'),null,'only once a day');
 assert.equal(calls,1);
});

test('without a key nothing is sent; a failed first call leaves no empty conversation',async()=>{
 await assert.rejects(JarvisService.ask(ctx,'Salom'),/API kalitini/);
 JarvisService.saveSettings(actor,{api_key:KEY});
 JarvisService.transport=async()=>{throw new Error('Claude limiti');};
 await assert.rejects(JarvisService.ask(ctx,'Salom'),/limiti/);
 assert.equal(JarvisService.listConversations(ctx).length,0);
});

test('agent strategy: the AI gets the agent’s real numbers and its JSON plan is cleaned; cached until asked again', async () => {
 const { agentStrategy } = await import('../services/agent-strategy.service.ts');
 db.insert('agents',{id:'ag',company_id:'c',full_name:'ТП1',code:'d0_1',status:'ACTIVE'} as any);
 db.insert('sales_orders',{id:'o1',company_id:'c',customer_id:'k',agent_id:'ag',order_date:'2026-08-10',total_sales:1000,discount_amount:0,return_amount:0,status:'DELIVERED'} as any);
 const A={from:'2026-08-01',to:'2026-08-31'},B={from:'2026-09-01',to:'2026-09-30'};
 await assert.rejects(()=>agentStrategy('c','ag',A,B),/AI ulanmagan/);
 JarvisService.saveSettings(actor,{api_key:KEY,model:'claude-sonnet-5'});
 let calls=0;let seen='';
 JarvisService.transport=async(_c:any,r:any)=>{calls++;seen=r.messages[0].content;return {stop_reason:'end_turn',content:[{type:'text',text:'```json\n{"verdict":"Savdo tushgan","score":14,"strengths":["Mijozlar sodiq"],"problems":[{"title":"Chust do‘kon to‘xtagan","evidence":"1000 → 0"}],"actions":[{"title":"Chust do‘konga qo‘ng‘iroq","why":"to‘xtagan","how":"bugun","target":"1000 so‘m","deadline":"3 kun"},{"bad":1}],"watch":["Haftalik buyurtma ≥ 5"],"call_list":[{"customer":"Chust do‘kon","reason":"to‘xtagan","offer":"aksiya"}],"team_notes":[]}\n```'}]};};
 const r=await agentStrategy('c','ag',A,B);
 assert.match(seen,/Chust do‘kon/,'stopped customers are in the facts');
 assert.match(seen,/"agent":"ТП1"/);
 assert.equal(r.strategy.score,10,'score kept within 1–10');
 assert.equal(r.strategy.actions.length,1,'an action without a title is dropped');
 assert.equal(r.strategy.call_list[0].customer,'Chust do‘kon');
 assert.equal((await agentStrategy('c','ag',A,B)).cached,true);
 assert.equal(calls,1);
 await agentStrategy('c','ag',A,B,true);
 assert.equal(calls,2,'asked again: a new plan');
});
test('strategies stay up to date by themselves: written when the numbers change, at most every 6 hours; the agent sees theirs', async () => {
 const S = await import('../services/agent-strategy.service.ts');
 const { db: d } = await import('../db/database.ts');
 const today='2026-10-04';
 const p=S.defaultPeriods(today);
 assert.deepEqual(p,{a:{from:'2026-09-01',to:'2026-09-04'},b:{from:'2026-10-01',to:'2026-10-04'}});
 assert.deepEqual(S.defaultPeriods('2026-03-31').a,{from:'2026-02-01',to:'2026-02-28'},'a shorter month is cut at its end');
 d.insert('employees',{id:'e1',company_id:'c',user_id:'u',full_name:'Ali',position:'Agent',status:'ACTIVE'} as any);
 d.insert('agents',{id:'ag',company_id:'c',full_name:'ТП1',code:'d0_1',status:'ACTIVE',employee_id:'e1'} as any);
 const real=S.defaultPeriods();
 d.insert('sales_orders',{id:'o1',company_id:'c',customer_id:'k',agent_id:'ag',order_date:real.a.from,total_sales:1000,discount_amount:0,return_amount:0,status:'DELIVERED'} as any);
 JarvisService.saveSettings(actor,{api_key:KEY,model:'claude-sonnet-5'});
 let calls=0;
 JarvisService.transport=async()=>{calls++;return {stop_reason:'end_turn',content:[{type:'text',text:`{"verdict":"Reja ${calls}","score":6,"actions":[{"title":"Qo‘ng‘iroq"}]}`}]};};
 // Early in today's business day, so "+7 hours" stays the same day (a new day is a change by itself).
 const t0=Date.parse(`${real.b.to}T03:00:00+05:00`);
 assert.equal((await S.refreshStrategies(t0)).written,1);
 assert.equal(S.storedStrategy('c','ag')!.strategy.verdict,'Reja 1');
 assert.equal((await S.refreshStrategies(t0+60_000)).written,0,'too soon');
 assert.equal((await S.refreshStrategies(t0+7*3600_000)).written,0,'nothing changed');
 d.insert('sales_orders',{id:'o2',company_id:'c',customer_id:'k',agent_id:'ag',order_date:real.b.from,total_sales:5000,discount_amount:0,return_amount:0,status:'PENDING'} as any);
 assert.equal((await S.refreshStrategies(t0+7*3600_000)).written,1,'numbers changed: a new strategy');
 assert.equal(S.storedStrategy('c','ag')!.history.length,2);
 const mine=S.myPerformance('c','u');
 assert.equal(mine.agent!.name,'ТП1');
 assert.equal((mine as any).strategy.strategy.verdict,'Reja 2');
 assert.equal((mine as any).data.totals.b.sales,5000);
 assert.equal(calls,2);
 // The next day is a change by itself: the strategy is written again.
 assert.equal((await S.refreshStrategies(t0+24*3600_000)).written,1);
});