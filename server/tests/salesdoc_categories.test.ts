import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SalesDocAdapter} from '../integrations/adapters/salesdoc.adapter.ts';

/** A fake SalesDoc where getProduct gives only category/brand ids, as the real API does (9.4), and names come from 9.5 / 9.17. */
function fakeServer(failCategories=false, failPrices=false, emptyPriceError=false){
 return async(_e:string,body:any)=>{
  const m=body.method;
  if(m==='login') return {status:true,result:{userId:'d0_1',token:'t'}};
  if(m==='getProduct') return {status:true,result:{product:[
   {SD_id:'d0_10',name:'Cola 1L',category:{SD_id:'d0_3',CS_id:'d0_3',code_1C:'000000003'},brand:{SD_id:'d0_7'}},
   {SD_id:'d0_11',name:'Suv 0.5L',category:{SD_id:'d0_4'}},
   {SD_id:'d0_12',name:'Nomsiz',category:{SD_id:'d0_99'}}
  ]},pagination:{total:3}};
  if(m==='getProductCategory'){
   if(failCategories) return {status:false,error:{code:500,message:'down'}};
   return {status:true,result:{productCategory:[{SD_id:'d0_3',CS_id:'d0_3',code_1C:'000000003',name:'Gazli ichimliklar'},{SD_id:'d0_4',name:'Suvlar'}]},pagination:{total:2}};
  }
  if(m==='getBrand') return {status:true,result:{brand:[{SD_id:'d0_7',name:'Coca-Cola'}]},pagination:{total:1}};
  if(m==='getStock') return {status:true,result:{warehouse:[]},pagination:{total:0}};
  if(m==='getPriceType') return {status:true,result:{priceType:[
   {SD_id:'d0_1',code_1C:'000000001',name:'Розница',type:'sale',active:'Y'},
   {SD_id:'d0_2',code_1C:'000000002',name:'Келиш Нарх',type:'sale',active:'Y'},
   {SD_id:'d0_3',code_1C:'000000003',name:'Оптом',type:'sale',active:'N'}
  ]},pagination:{total:3}};
  if(m==='getPrice'){
   if(emptyPriceError) return {status:false,error:{code:500,message:''}};
   if(failPrices) return {status:false,error:{code:503,message:'price service unavailable'}};
   const t=body.params.priceType.SD_id;
   const table:any={d0_1:[[ 'd0_10',15000],['d0_11',3000]],d0_2:[['d0_10',1],['d0_11',2100]],d0_3:[['d0_10',14000]]};
   return {status:true,result:(table[t]||[]).map(([id,price]:any)=>({product:{SD_id:id,CS_id:id},price}))};
  }
  return {status:true,result:{}};
 };
}
const config={auth_type:'SERVER_CREDENTIALS',server_url:'https://cat-test.salesdoc.io/api/v2',username:'u',password:'p'};

test('SalesDoc products get their category and brand names',async()=>{
 const a=new SalesDocAdapter();(a as any).postSalesDocApi=fakeServer();
 const products=await a.importProducts(config);
 const by=Object.fromEntries(products.map((p:any)=>[p.sku,p]));
 assert.equal(by.d0_10.category,'Gazli ichimliklar');
 assert.equal(by.d0_10.brand,'Coca-Cola');
 assert.equal(by.d0_11.category,'Suvlar');
 assert.equal(by.d0_12.category,'Asosiy','unknown category id falls back');
});

test('every SalesDoc price type is kept as listed; selling and purchase prices come from the right types',async()=>{
 const a=new SalesDocAdapter();(a as any).postSalesDocApi=fakeServer();
 const by=Object.fromEntries((await a.importProducts({...config,server_url:'https://price-test.salesdoc.io/api/v2'})).map((p:any)=>[p.sku,p]));
 assert.equal(by.d0_10.selling_price,15000,'first active sale type');
 assert.equal(by.d0_10.purchase_cost,1,'"Келиш Нарх" is the purchase price, taken as it is');
 assert.equal(by.d0_11.purchase_cost,2100);
 assert.deepEqual(by.d0_10.prices.map((x:any)=>[x.name,x.kind,x.price]),[['Розница','sale',15000],['Келиш Нарх','purchase',1],['Оптом','sale',14000]]);
 assert.equal(by.d0_12.selling_price,0,'no price in SalesDoc: none invented');
 assert.deepEqual(by.d0_12.prices,[]);

 const chosen=new SalesDocAdapter();(chosen as any).postSalesDocApi=fakeServer();
 const p=(await chosen.importProducts({...config,server_url:'https://price-test2.salesdoc.io/api/v2',sale_price_type_id:'d0_3'})).find((x:any)=>x.sku==='d0_10');
 assert.equal(p.selling_price,14000,'the owner chose "Оптом" as selling price');
});

test('a failed category read keeps products importing',async()=>{
 const a=new SalesDocAdapter();(a as any).postSalesDocApi=fakeServer(true);
 const products=await a.importProducts({...config,server_url:'https://cat-test2.salesdoc.io/api/v2'});
 assert.equal(products.length,3);
 assert.ok(products.every((p:any)=>p.category==='Asosiy'));
});

test('price-list failures are retained as sync warnings instead of being hidden as success',async()=>{
 const a=new SalesDocAdapter();(a as any).postSalesDocApi=fakeServer(false,true);
 const products=await a.importProducts({...config,server_url:'https://price-fail-test.salesdoc.io/api/v2'});
 assert.equal(products.length,3,'stock and product import can still complete');
 assert.ok((products as any).warnings.some((w:string)=>w.includes('getPrice')||w.includes('SalesDoctor')));
 assert.ok((products as any).warnings.some((w:string)=>w.includes('kirim narxi')));
});

test('SalesDoc empty error text is replaced with a useful diagnostic',async()=>{
 const a=new SalesDocAdapter();(a as any).postSalesDocApi=fakeServer(false,false,true);
 const result=await a.readPriceLists({...config,server_url:'https://price-empty-error.salesdoc.io/api/v2'});
 assert.ok(result.warnings.some(w=>w.includes('SalesDoctor aniq xato matnini qaytarmadi (kod 500)')));
});
