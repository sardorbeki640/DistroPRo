import {afterEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {callLlm} from '../jarvis/llm.ts';
import {detectLang,speakable} from '../jarvis/voice.ts';
import type {ClaudeMessage} from '../jarvis/claude.ts';

const realFetch=globalThis.fetch;
afterEach(()=>{globalThis.fetch=realFetch;});
const json=(body:any)=>new Response(JSON.stringify(body),{status:200,headers:{'content-type':'application/json'}});

// A finished tool round in the stored (Claude) format.
const history:ClaudeMessage[]=[
 {role:'user',content:'Qarz qancha?'},
 {role:'assistant',content:[{type:'text',text:'Qarang.'},{type:'tool_use',id:'t1',name:'debt_aging',input:{limit:5}}]},
 {role:'user',content:[{type:'tool_result',tool_use_id:'t1',content:'{"total_debt":10}'}]}
];
const tools=[{name:'debt_aging',description:'Qarzlar',input_schema:{type:'object',properties:{limit:{type:'number'}},additionalProperties:false}}];

test('OpenAI-style services get system, tool_calls and tool messages; answers come back as blocks',async()=>{
 let sent:any;let url='';let auth='';
 globalThis.fetch=(async(u:any,init:any)=>{url=String(u);auth=init.headers.authorization;sent=JSON.parse(init.body);
  return json({choices:[{message:{content:null,tool_calls:[{id:'c9',type:'function',function:{name:'debt_aging',arguments:'{"limit":3}'}}]}}]});}) as any;
 const r=await callLlm({provider:'openai_compatible',model:'deepseek-chat',apiKey:'k1',baseUrl:'https://api.deepseek.com/v1/'},{system:'S',messages:history,tools});
 assert.equal(url,'https://api.deepseek.com/v1/chat/completions');assert.equal(auth,'Bearer k1');
 assert.deepEqual(sent.messages.map((m:any)=>m.role),['system','user','assistant','tool']);
 assert.equal(sent.messages[2].tool_calls[0].function.arguments,'{"limit":5}');
 assert.equal(sent.messages[3].tool_call_id,'t1');
 assert.equal(sent.tools[0].function.name,'debt_aging');
 assert.equal(r.stop_reason,'tool_use');assert.deepEqual(r.content[0],{type:'tool_use',id:'c9',name:'debt_aging',input:{limit:3}});
});

test('Gemini gets functionCall / functionResponse parts and a schema without additionalProperties',async()=>{
 let sent:any;let key='';
 globalThis.fetch=(async(_u:any,init:any)=>{key=init.headers['x-goog-api-key'];sent=JSON.parse(init.body);
  return json({candidates:[{content:{parts:[{text:'Qarz 10 so‘m.'}]}}]});}) as any;
 const r=await callLlm({provider:'gemini',model:'gemini-2.5-flash',apiKey:'g1'},{system:'S',messages:history,tools});
 assert.equal(key,'g1');
 assert.deepEqual(sent.contents.map((c:any)=>c.role),['user','model','user']);
 assert.deepEqual(sent.contents[1].parts[1],{functionCall:{name:'debt_aging',args:{limit:5}}});
 assert.equal(sent.contents[2].parts[0].functionResponse.name,'debt_aging');
 assert.equal('additionalProperties' in sent.tools[0].functionDeclarations[0].parameters,false);
 assert.deepEqual([r.stop_reason,(r.content[0] as any).text],['end_turn','Qarz 10 so‘m.']);
});

test('Gemini thought signatures come back with their function call and never reach Claude',async()=>{
 let sent:any;
 globalThis.fetch=(async(_u:any,init:any)=>{sent=JSON.parse(init.body);
  return json({candidates:[{content:{parts:[{functionCall:{name:'debt_aging',args:{}},thoughtSignature:'SIG-1'}]}}]});}) as any;
 const r=await callLlm({provider:'gemini',model:'gemini-3.8-flash',apiKey:'g'},{system:'S',messages:[{role:'user',content:'a'}],tools});
 const use=r.content[0] as any;
 assert.equal(use.thought_signature,'SIG-1');
 const next=[{role:'user',content:'a'},{role:'assistant',content:r.content},{role:'user',content:[{type:'tool_result',tool_use_id:use.id,content:'{}'}]}] as ClaudeMessage[];
 globalThis.fetch=(async(_u:any,init:any)=>{sent=JSON.parse(init.body);return json({candidates:[{content:{parts:[{text:'ok'}]}}]});}) as any;
 await callLlm({provider:'gemini',model:'m',apiKey:'g'},{system:'S',messages:next,tools});
 assert.equal(sent.contents[1].parts[0].thoughtSignature,'SIG-1');
 globalThis.fetch=(async(_u:any,init:any)=>{sent=JSON.parse(init.body);return json({content:[{type:'text',text:'ok'}],stop_reason:'end_turn'});}) as any;
 await callLlm({provider:'anthropic',model:'claude-sonnet-5',apiKey:'k'},{system:'S',messages:next,tools});
 assert.equal('thought_signature' in sent.messages[1].content[0],false);
});

test('service errors become plain messages',async()=>{
 globalThis.fetch=(async()=>new Response(JSON.stringify({error:{message:'bad key'}}),{status:401})) as any;
 await assert.rejects(callLlm({provider:'openai',model:'m',apiKey:'x'},{system:'S',messages:[{role:'user',content:'a'}],tools:[]}),/kalit qabul qilinmadi/);
});

test('speech language and readable text',()=>{
 assert.equal(detectLang('Сколько у нас долгов?'),'ru');
 assert.equal(detectLang('Qarzlar qancha?'),'uz');
 assert.equal(detectLang('Қарзлар қанча?'),'uz');
 assert.equal(speakable('**Xulosa**\n\n- Birinchi\n- Ikkinchi'),'Xulosa. Birinchi Ikkinchi');
});

test('Claude: Opus 5 with room to think, refusal fallback on, a busy service is tried again, a refusal is explained', async () => {
 const { claudeRetry } = await import('../jarvis/claude.ts');
 claudeRetry.delays = [0, 0];
 const calls:any[] = [];
 let answer = 0;
 globalThis.fetch = (async (_u:any, init:any) => {
  calls.push({ headers: init.headers, body: JSON.parse(init.body) });
  answer++;
  if (answer === 1) return new Response(JSON.stringify({ type:'error', error:{ type:'overloaded_error', message:'Overloaded' } }), { status: 529 });
  return json({ content:[{ type:'thinking', thinking:'', signature:'s' }, { type:'text', text:'Salom' }], stop_reason:'end_turn' });
 }) as any;
 const r = await callLlm({ provider:'anthropic', model:'claude-opus-5', apiKey:'sk-ant-x' }, { system:'S', messages:[{ role:'user', content:'a' }], tools:[], maxTokens:2500 });
 assert.equal(calls.length, 2, 'retried after 529');
 assert.equal(calls[1].body.model, 'claude-opus-5');
 assert.ok(calls[1].body.max_tokens >= 16000, 'thinking needs room');
 assert.equal(calls[1].body.fallbacks, 'default');
 assert.equal(calls[1].headers['anthropic-beta'], 'server-side-fallback-2026-07-01');
 assert.equal(r.content.filter((b:any) => b.type === 'text').map((b:any) => b.text).join(''), 'Salom');
 globalThis.fetch = (async () => json({ content:[], stop_reason:'refusal' })) as any;
 await assert.rejects(() => callLlm({ provider:'anthropic', model:'claude-opus-5', apiKey:'k' }, { system:'S', messages:[{ role:'user', content:'a' }], tools:[] }), /xavfsizlik/);
 globalThis.fetch = (async () => new Response(JSON.stringify({ error:{ message:'bad key' } }), { status: 401 })) as any;
 await assert.rejects(() => callLlm({ provider:'anthropic', model:'claude-opus-5', apiKey:'k' }, { system:'S', messages:[{ role:'user', content:'a' }], tools:[] }), /kaliti qabul qilinmadi/);
});