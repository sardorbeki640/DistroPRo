import fs from 'node:fs';
const edit=(p,f)=>fs.writeFileSync(p,f(fs.readFileSync(p,'utf8').replaceAll('\r\n','\n')));
edit('server/services/forecast.service.ts',s=>{
 const a=s.indexOf('    const end =',s.indexOf('calculateHistoricalSalesVelocity'));
 const b=s.indexOf('\n  /**',a);
 s=s.slice(0,a)+`    const integration=db.findOne('integrations',i=>i.company_id===companyId && /SALESDOC|SALES_DOCTOR/.test(i.provider_name));
    const days=Number(integration?.config.forecast_days||100);
    if(!Number.isInteger(days)||days<1||days>3660) throw new Error('Prognoz davri 1–3660 kun bo‘lsin');
    const end=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Tashkent'});
    const start=new Date(Date.parse(end+'T00:00:00Z')-(days-1)*86400000).toISOString().slice(0,10);
    const orders=new Set(db.find('sales_orders',o=>o.company_id===companyId && o.status==='DELIVERED' && o.order_date>=start && o.order_date<=end).map(o=>o.id));
    const products=db.find('products',p=>p.company_id===companyId);
    const map=new Map(products.flatMap(p=>[[p.id,p.id],[p.sku,p.id]]));
    const quantities=new Map<string,number>();
    for(const item of db.getTable('sales_order_items')){
      const id=map.get(item.product_id)||map.get(item.sku||'');
      if(id && orders.has(item.sales_order_id) && Number.isFinite(item.quantity)) quantities.set(id,(quantities.get(id)||0)+item.quantity);
    }
    db.transaction(()=>{
      for(const p of products) db.update('products',p.id,{daily_sales_avg:(quantities.get(p.id)||0)/days});
    });
  }
`+s.slice(b);
 s=s.replace('    this.ensureProductsWithVelocities(companyId);',`    this.ensureProductsWithVelocities(companyId);`,1);
 s=s.replace('Number((baseDaily * runRateFactor).toFixed(1))','baseDaily * runRateFactor');
 // Keep numeric transport sentinel for backward-compatible consumers, but never present it as a real day count.
 s=s.replace('        totalDaysSum += Math.min(daysRemaining, 60);','        if(effectiveDaily>0) totalDaysSum += daysRemaining;\n        else inStockCount--;');
 s=s.replace('    return {\n      run_rate_factor:',`    const integration=db.findOne('integrations',i=>i.company_id===companyId && /SALESDOC|SALES_DOCTOR/.test(i.provider_name));
    const history=integration?.config.history;
    return {
      history: {complete:!!history?.complete,days:Number(integration?.config.forecast_days||100),orders:history?.orders||0,synced_at:history?.synced_at||null,first_order:history?.first_order||null,warning:history?.complete?'Hisob: qoldiq ÷ (davrdagi sof sotuv / kalendar kun). Tanlangan ombor va birlik SalesDoc bilan bir xil bo‘lishi kerak.':'Tarix to‘liq yuklanmagan. Prognoz ishonchli emas — integratsiyani yangilang.'},
      run_rate_factor:`);
 return s;
});
edit('src/types.ts',s=>s.replace('export interface StockRunRateResponse {','export interface StockRunRateResponse {\n  history?: {complete:boolean;days:number;orders:number;synced_at:string|null;first_order:string|null;warning:string};'));
edit('src/components/views/ForecastView.tsx',s=>s.replace("{item.stock_quantity === 0 ? '0 kun' : `${item.days_remaining} kunga`}","{item.stock_quantity === 0 ? '0 kun' : item.effective_daily_sales<=0 ? 'Sotuv yo‘q' : `${item.days_remaining} kunga`}").replace('{item.effective_daily_sales} {item.unit}/kun','{Number(item.effective_daily_sales.toFixed(4))} {item.unit}/kun').replace('        {/* Metric 2:', '        {/* Metric 2:'));
edit('src/components/views/ForecastView.tsx',s=>{
 const marker='      {/*';const idx=s.indexOf(marker,s.indexOf('  return ('));
 return s.slice(0,idx)+`      {runRateData?.history && <div className="rounded-xl border p-4 bg-amber-50 text-sm">
        <strong>{runRateData.history.days} kunlik davr · {runRateData.history.orders} ta buyurtma</strong>
        <p>{runRateData.history.warning}</p><p>Oxirgi yuklash: {runRateData.history.synced_at ? new Date(runRateData.history.synced_at).toLocaleString() : 'Yuklanmagan'}</p>
      </div>}
`+s.slice(idx);
});
