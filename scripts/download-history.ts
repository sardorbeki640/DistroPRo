import fs from 'node:fs';
import {SalesDocAdapter} from '../server/integrations/adapters/salesdoc.adapter.ts';
const d=JSON.parse(fs.readFileSync('.data/finance_db.json','utf8'));
const i=d.integrations.find((i:any)=>i.provider_name==='SALESDOC');
const a=new SalesDocAdapter();
const products=await a.importProducts(i.config);console.log('Mahsulotlar: '+products.length);
const orders=await a.importOrders(i.config);console.log('Buyurtmalar: '+orders.length);
fs.writeFileSync('.data/salesdoc-history-staged.json',JSON.stringify({integrationId:i.id,companyId:i.company_id,products,orders}));
console.log('Tarix tayyorlandi; asosiy baza hali o‘zgarmadi.');
