import fs from 'node:fs';
import {SalesDocAdapter} from '../server/integrations/adapters/salesdoc.adapter.ts';
const d=JSON.parse(fs.readFileSync('.data/finance_db.json','utf8'));
const c=d.integrations.find((i:any)=>i.provider_name==='SALESDOC').config;
const a=new SalesDocAdapter();
const r=await a.executeSalesDocMethod(c,'getStock',{});
for(const w of r.warehouse||[]) for(const p of w.products||[]) if(/marlena|марлена/i.test(p.name||'')) console.log(JSON.stringify({warehouse:{id:w.SD_id,name:w.name},product:p}));
