import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SalesDocAdapter} from '../integrations/adapters/salesdoc.adapter.ts';

/** A fake SalesDoc that, like the real one, keeps one live token per account: each login revokes the previous token. */
function fakeServer(){
 let live='';let logins=0;let n=0;
 const post=async(_e:string,body:any)=>{
  await new Promise(r=>setTimeout(r,5));
  if(body.method==='login'){logins++;live=`t${++n}`;return {status:true,result:{userId:'d0_1',token:live}};}
  if(body.auth.token!==live) return {status:false,error:{code:401,message:'Invalid token'}};
  return {status:true,result:{ok:body.method}};
 };
 return {post,logins:()=>logins,revoke:()=>{live='revoked';}};
}

test('parallel requests share one login and survive a token revoked elsewhere',async()=>{
 const a=new SalesDocAdapter();const s=fakeServer();
 (a as any).postSalesDocApi=s.post;
 const config={auth_type:'SERVER_CREDENTIALS',server_url:'https://race-test.salesdoc.io/api/v2',username:'u',password:'p'};
 const first=await Promise.all([1,2,3,4,5].map(i=>a.executeSalesDocMethod(config,'getPaymentType',{i})));
 assert.equal(first.length,5);
 assert.equal(s.logins(),1,'one login for five parallel requests');
 s.revoke();   // e.g. someone signed in to the SalesDoc cabinet with the same account
 const second=await Promise.all([1,2,3,4,5].map(i=>a.executeSalesDocMethod(config,'getOrder',{i})));
 assert.ok(second.every((r:any)=>r.ok==='getOrder'),'all requests succeed after the revoke');
 assert.equal(s.logins(),2,'the revoke costs exactly one new login');
});
