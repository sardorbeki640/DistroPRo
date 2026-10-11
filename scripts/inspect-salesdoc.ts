import fs from 'node:fs';
import { SalesDocAdapter } from '../server/integrations/adapters/salesdoc.adapter.ts';
const d=JSON.parse(fs.readFileSync('.data/finance_db.json','utf8'));
const c=d.integrations.find((i:any)=>i.provider_name==='SALESDOC').config;
const a=new SalesDocAdapter();
for(const [method,params] of [['getOrder',{limit:1,page:1,filter:{include:'all',agent:'all'}}],['getStock',{}],['getPaymentType',{}]] as const){
 try{
 const r=await a.executeSalesDocMethod(c,method,params,undefined,true);
 const v=r.result;
 console.log(JSON.stringify({method,pagination:r.pagination,keys:Object.keys(v||{}),sample:method==='getOrder'?{keys:Object.keys(v.order?.[0]||{}),itemKeys:Object.keys(v.order?.[0]?.orderProducts?.[0]||{}),dateDocument:v.order?.[0]?.dateDocument,paymentType:v.order?.[0]?.paymentType}:method==='getStock'?{warehouseKeys:Object.keys(v.warehouse?.[0]||{}),productKeys:Object.keys(v.warehouse?.[0]?.products?.[0]||{}),warehouseCount:v.warehouse?.length}:v}));
 }catch(e:any){console.log(method,e.message)}
}
