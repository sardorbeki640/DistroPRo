import fs from 'node:fs';
import {SalesDocAdapter} from '../server/integrations/adapters/salesdoc.adapter.ts';
import {SalesDocHistoryService} from '../server/services/salesdoc-history.service.ts';
const snapshot=JSON.parse(fs.readFileSync('.data/salesdoc-history-staged.json','utf8'));
const a=new SalesDocAdapter();
a.importProducts=async()=>snapshot.products;
a.importOrders=async()=>snapshot.orders;
console.log(await SalesDocHistoryService.sync(snapshot.companyId,snapshot.integrationId,'system-history-repair',a));
