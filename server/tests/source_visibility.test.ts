import {beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {db} from '../db/database.ts';
import {tagSalesDocRows} from '../services/source-tagging.service.ts';
import {SalesDocHistoryService} from '../services/salesdoc-history.service.ts';
import {LinkoAdapter} from '../integrations/adapters/linko.adapter.ts';
import {businessToday} from '../utils/date.ts';

beforeEach(()=>{db.init();db.reset();});
const base={company_id:'c',phone:'',credit_limit:0,current_balance:0,status:'ACTIVE',is_active:true,created_at:''};

test('rows of a switched-off integration are hidden everywhere and come back when it is switched on',()=>{
 db.insert('integrations',{id:'sd',company_id:'c',provider_name:'SALESDOC',status:'CONNECTED',config:{}} as any);
 db.insert('integrations',{id:'lk',company_id:'c',provider_name:'LINKO',status:'CONNECTED',config:{}} as any);
 db.insert('customers',{...base,id:'a',code:'a0_1',name:'SD',source_integration_id:'sd'} as any);
 db.insert('customers',{...base,id:'b',code:'lk-1',name:'LK',source_integration_id:'lk'} as any);
 db.insert('customers',{...base,id:'m',code:'MY',name:'Qo‘lda'} as any);
 db.insert('sales_orders',{id:'o',company_id:'c',customer_id:'a',status:'DELIVERED',order_date:'2026-09-01',total_sales:10,source_integration_id:'sd'} as any);
 db.insert('sales_order_items',{id:'i',sales_order_id:'o',product_id:'p',quantity:1} as any);
 db.insert('customer_balance_transactions',{id:'t',company_id:'c',customer_id:'a',transaction_type:'DEBIT',amount:5,date:'2026-09-01'} as any);
 assert.equal(db.findById('sales_order_items','i')!.source_integration_id,'sd','line inherits from its order');
 assert.equal(db.findById('customer_balance_transactions','t')!.source_integration_id,'sd','ledger row inherits from its customer');
 db.update('integrations','sd',{disabled:true,status:'DISCONNECTED'});
 assert.deepEqual(db.find('customers',c=>c.company_id==='c').map(c=>c.id).sort(),['b','m']);
 assert.equal(db.getTable('sales_orders').length,0);
 assert.equal(db.getTable('sales_order_items').length,0);
 assert.equal(db.findOne('customer_balance_transactions',()=>true),null);
 assert.equal(db.getTableIncludingHidden('customers').length,3,'nothing is deleted');
 db.update('integrations','sd',{disabled:false,status:'CONNECTED'});
 assert.equal(db.find('customers',()=>true).length,3);
});

test('existing SalesDoc rows are tagged by their ids; hand-made rows stay visible',()=>{
 db.insert('integrations',{id:'sd',company_id:'c',provider_name:'SALESDOC',status:'CONNECTED',config:{}} as any);
 db.insert('customers',{...base,id:'a',code:'SD-CUST-a0_1',name:'SD'} as any);
 db.insert('customers',{...base,id:'m',code:'MY-7',name:'Qo‘lda'} as any);
 db.insert('products',{id:'p',company_id:'c',sku:'d0_20',name:'T',source:'SALESDOC',is_active:true} as any);
 db.insert('agents',{id:'g',company_id:'c',code:'d0_6',full_name:'A'} as any);
 db.insert('sales_orders',{id:'o',company_id:'c',external_id:'d0_99',source:'DISTRIBUTION',customer_id:'a',status:'DELIVERED',order_date:'2026-09-01'} as any);
 const counts=tagSalesDocRows('sd');
 assert.deepEqual([counts.customers,counts.products,counts.agents,counts.sales_orders],[1,1,1,1]);
 db.update('integrations','sd',{disabled:true});
 assert.deepEqual(db.find('customers',()=>true).map(c=>c.id),['m']);
});

test('Linko history: products with categories, customers, agents, orders and ledger balances, all tagged',async()=>{
 const today=businessToday();
 db.insert('integrations',{id:'lk',company_id:'c',provider_name:'LINKO',status:'CONNECTED',config:{history_start_date:today.slice(0,8)+'01'}} as any);
 const a=new LinkoAdapter();
 a.importProducts=async()=>[{sku:'lk-5',name:'Sut',category:'Sut mahsulotlari',brand:'Biolife',unit:'dona',purchase_cost:0}];
 a.importCustomers=async()=>[{externalCode:'lk-1',name:'Do‘kon',address:'Chust',balance:0,agentCode:'lk-u7',agentName:'Ali',isActive:true} as any];
 a.importEmployees=async()=>[{externalId:'lk-u7',name:'Ali',role:'AGENT'}];
 let withItems:any='unset';
 a.importOrders=async(_c:any,o:any)=>{withItems=o.withItems;return [{externalId:'lk-100',orderNumber:'100',customerCode:'lk-1',customerName:'Do‘kon',totalAmount:900,returnAmount:100,status:'DELIVERED',orderDate:today,itemsCount:0,agentCode:'lk-u7',agentName:'Ali'}];};
 a.importLedger=async()=>[
  {externalId:'lk-tx-1',customerCode:'lk-1',customerName:'Do‘kon',date:today,amount:-900,kind:'SALE',orderExternalId:'lk-100'},
  {externalId:'lk-tx-2',customerCode:'lk-1',customerName:'Do‘kon',date:today,amount:400,kind:'PAYMENT',paymentMethod:'cash'}
 ];
 const r=await SalesDocHistoryService.sync('c','lk','u',a);
 assert.equal(r.provider,'LINKO');
 assert.equal(withItems,false,'Linko orders are loaded without lines');
 const p=db.findOne('products',p=>p.sku==='lk-5')!;
 assert.equal(p.category,'Sut mahsulotlari');assert.equal(p.brand,'Biolife');assert.equal(p.source,'LINKO');assert.equal(p.source_integration_id,'lk');
 const c=db.findOne('customers',c=>c.code==='lk-1')!;
 assert.equal(c.address,'Chust');assert.equal(c.current_balance,500);assert.equal(c.source_integration_id,'lk');
 const agent=db.findOne('agents',g=>g.code==='lk-u7')!;
 assert.equal(c.agent_id,agent.id);
 const o=db.findOne('sales_orders',o=>o.external_id==='lk-100')!;
 assert.deepEqual([o.net_sales,o.return_amount,o.total_sales,o.agent_id,o.source_integration_id],[900,100,1000,agent.id,'lk']);
 assert.equal(db.find('customer_balance_transactions',t=>t.customer_id===c.id).length,2);
 // A second run upserts by Linko id: no duplicate ledger rows.
 await SalesDocHistoryService.sync('c','lk','u',a);
 assert.equal(db.find('customer_balance_transactions',t=>t.customer_id===c.id).length,2);
 db.update('integrations','lk',{disabled:true});
 assert.equal(db.find('sales_orders',()=>true).length,0);
});

test('switching off during a history download stops it at once; loaded months stay, no failure alert',async()=>{
 const today=businessToday();
 db.insert('integrations',{id:'lk2',company_id:'c',provider_name:'LINKO',status:'CONNECTED',config:{history_start_date:'2026-01-01'}} as any);
 const a=new LinkoAdapter();
 a.importProducts=async()=>[];a.importCustomers=async()=>[];a.importEmployees=async()=>[];a.importLedger=async()=>[];
 let calls=0;
 a.importOrders=async(_c:any,o:any)=>{calls++;
  // The user switches the integration off while the second month is downloading.
  if(calls===2)SalesDocHistoryService.stop('lk2');
  return [{externalId:`lk-${calls}`,orderNumber:String(calls),customerCode:'lk-1',customerName:'Do‘kon',totalAmount:100,returnAmount:0,status:'DELIVERED',orderDate:o.dateFrom,itemsCount:0}];};
 const run=SalesDocHistoryService.sync('c','lk2','u',a);
 assert.equal(SalesDocHistoryService.isRunning('lk2'),true);
 const r:any=await run;
 assert.equal(r.details.stopped,true);
 assert.equal(calls,2,'nothing more is downloaded');
 assert.equal(SalesDocHistoryService.isRunning('lk2'),false);
 const h=db.findById('integrations','lk2')!.config.history;
 assert.equal(h.status,'PARTIAL');
 assert.equal(h.error,null);
 assert.equal(Object.keys(h.chunks).length,1,'the first month is kept, the interrupted one is not stored');
 assert.equal(db.find('notifications',()=>true).length,0,'a stop is not a failure');
 assert.ok(today);
});