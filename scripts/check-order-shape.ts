import fs from 'node:fs';
import {SalesDocAdapter} from '../server/integrations/adapters/salesdoc.adapter.ts';
const d=JSON.parse(fs.readFileSync('.data/finance_db.json','utf8'));
const c=d.integrations.find((i:any)=>i.provider_name==='SALESDOC').config;
const a=new SalesDocAdapter();
const raw=await a.readAll(c,'getOrder','order',{filter:{include:'all',agent:'all',status:[3,4],period:{date:{from:'2026-06-22',to:'2026-09-29'}}}});
const items=raw.flatMap(o=>o.orderProducts||[]).filter(i=>/marlena|марлена/i.test(JSON.stringify(i.product)));
const groups:any={};for(const i of items){const k=JSON.stringify(i.product);groups[k]??={count:0,quantity:0,returned:0,sample:i};groups[k].count++;groups[k].quantity+=Number(i.quantity);groups[k].returned+=Number(i.returned);}
console.log(JSON.stringify({count:raw.length,sampleProduct:raw[0]?.orderProducts?.[0],groups},null,2));
