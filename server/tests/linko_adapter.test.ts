import {afterEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {LinkoAdapter} from '../integrations/adapters/linko.adapter.ts';

const realFetch=globalThis.fetch;
afterEach(()=>{globalThis.fetch=realFetch;});
const json=(status:number,body:any)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});

test('server field accepts a bare name, a host or a URL',()=>{
 const a=new LinkoAdapter();
 assert.equal(a.normalizeEndpoint('biolife'),'https://biolife.linko.uz/ru/api/v1');
 assert.equal(a.normalizeEndpoint(' biolife.linko.uz/ '),'https://biolife.linko.uz/ru/api/v1');
 assert.equal(a.normalizeEndpoint('https://biolife.linko.uz/#/sign-in'),'https://biolife.linko.uz/ru/api/v1');
 assert.throws(()=>a.normalizeEndpoint(''));
});

test('signs in with login and password, then sends the token and follows pagination',async()=>{
 const calls:{url:string;auth?:string;body?:any}[]=[];
 globalThis.fetch=(async(url:any,init?:any)=>{
  const u=String(url);calls.push({url:u,auth:init?.headers?.Authorization,body:init?.body&&JSON.parse(init.body)});
  if(u.endsWith('/main/user/auth/'))return json(200,{token:'tok1'});
  if(u.includes('page=2'))return json(200,{count:3,next:null,results:[{id:3}]});
  return json(200,{count:3,next:'https://t1.linko.uz/ru/api/v1/sales/order/?page=2',results:[{id:1},{id:2}]});
 }) as any;
 const rows=await new LinkoAdapter().readAll({auth_type:'SERVER_CREDENTIALS',server_url:'t1',username:'u',password:'p'},'/sales/order/');
 assert.deepEqual(rows.map(r=>r.id),[1,2,3]);
 assert.deepEqual(calls[0].body,{username:'u',password:'p',can_handle_2fa:true});
 assert.ok(calls.slice(1).every(c=>c.auth==='Token tok1'));
});

test('SMS confirmation and wrong server give a clear message instead of a crash',async()=>{
 globalThis.fetch=(async()=>json(200,{verify_by_sms:true,id:5})) as any;
 const sms=await new LinkoAdapter().testConnection({auth_type:'SERVER_CREDENTIALS',server_url:'t2',username:'u',password:'p'});
 assert.equal(sms.ok,false);assert.match(sms.message,/SMS/);
 globalThis.fetch=(async()=>json(404,{})) as any;
 const missing=await new LinkoAdapter().testConnection({auth_type:'SERVER_CREDENTIALS',server_url:'t3',username:'u',password:'p'});
 assert.equal(missing.ok,false);assert.match(missing.message,/topilmadi/);
});

test('record shape lists field names and types, never values',()=>{
 const shape=LinkoAdapter.shapeOf({id:1,market:{name:'Secret shop'},products:[{price:5}],note:null});
 assert.deepEqual(shape,['id:number','market.name:string','products[]','products[].price:number','note:null']);
 assert.ok(!shape.join(' ').includes('Secret'));
});

