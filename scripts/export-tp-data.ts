import fs from 'node:fs';
import path from 'node:path';
import {SalesDocAdapter} from '../server/integrations/adapters/salesdoc.adapter.ts';
const root=path.resolve('../outputs/01a0d982-tp-report');fs.mkdirSync(root,{recursive:true});
const d=JSON.parse(fs.readFileSync('.data/finance_db.json','utf8'));
const config=d.integrations.find((i:any)=>i.provider_name==='SALESDOC').config;
const a=new SalesDocAdapter();
const audit:any[]=[];
async function get(method:string,key:string,from:string,to:string):Promise<any[]> {
 const cache=path.join(root,`${method}-${from}-${to}.json`);
 if(fs.existsSync(cache)) return JSON.parse(fs.readFileSync(cache,'utf8'));
 const rows:any[]=[];const sigs=new Set();let expected=-1;
 try {
 for(let page=1;page<=1000;page++) {
  const filter:any={period:{date:{from,to}}};if(method==='getOrder'){filter.agent='all';filter.include='all';filter.status=[1,2,3,4,5];}
  const r=await a.executeSalesDocMethod(config,method,{limit:500,page,filter},undefined,true);
  const batch=r.result?.[key];if(!Array.isArray(batch))throw Error('Unknown response '+method);
  expected=Number(r.pagination?.total??batch.length);const sig=JSON.stringify(batch);
  if(batch.length&&sigs.has(sig)) throw Error('Repeated page');sigs.add(sig);rows.push(...batch);
  if(rows.length>=expected)break;if(!batch.length)throw Error('Short page');
 }
 if(rows.length!==expected)throw Error(`Expected ${expected}, got ${rows.length}`);
 fs.writeFileSync(cache,JSON.stringify(rows));audit.push({method,from,to,expected,received:rows.length});return rows;
 }catch(err){
  if(from===to)throw err;
  const start=Date.parse(from+'T00:00Z'),end=Date.parse(to+'T00:00Z');
  const middle=new Date(start+Math.floor((end-start)/86400000/2)*86400000).toISOString().slice(0,10);
  const next=new Date(Date.parse(middle+'T00:00Z')+86400000).toISOString().slice(0,10);
  return [...await get(method,key,from,middle),...await get(method,key,next,to)];
 }
}
// June is the explicit comparison base for newly active / inactive outlets in July.
const intervals=[['2026-06-01','2026-06-30'],['2026-07-01','2026-07-31'],['2026-08-01','2026-08-31'],['2026-09-01','2026-09-30']];
const orders:any[]=[],visits:any[]=[];
for(const [from,to] of intervals){
 const [os,vs]=await Promise.all([get('getOrder','order',from,to),get('getVisit','visit',from,to)]);
 orders.push(...os);visits.push(...vs);console.log(JSON.stringify({month:from.slice(0,7),orders:os.length,visits:vs.length}));
}
const ids=new Set();const uniqueOrders=orders.filter(o=>{const id=o.SD_id||o.CS_id;if(!id)throw Error('Order missing ID');if(ids.has(id))return false;ids.add(id);return true;});
const data={retrievedAt:new Date().toISOString(),source:'https://namdistribution.salesdoc.io/api/v2',orders:uniqueOrders,visits,audit};
fs.writeFileSync(path.join(root,'source.json'),JSON.stringify(data));
console.log(JSON.stringify({done:true,orders:uniqueOrders.length,visits:visits.length,orderFields:Object.keys(orders[0]||{}),visitFields:Object.keys(visits[0]||{}),sampleCredit:orders.slice(0,3).map(o=>({consignment:o.consignment,consigDate:o.consigDate,paymentType:o.paymentType,dateDocument:o.dateDocument,dateCreate:o.dateCreate}))}));
