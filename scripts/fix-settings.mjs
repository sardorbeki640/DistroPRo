import fs from 'node:fs';
const edit=(p,f)=>fs.writeFileSync(p,f(fs.readFileSync(p,'utf8').replaceAll('\r\n','\n')));
edit('server/tests/integrations.test.ts',s=>s.replace('returns empty arrays without fake data when offline','rejects incomplete imports when offline').replace(/    const products = await adapter.importProducts\(dummyConfig\);\n    assert.deepEqual\(products, \[\]\);/,'    await assert.rejects(()=>adapter.importProducts(dummyConfig));').replace(/    const customers = await adapter.importCustomers\(dummyConfig\);\n    assert.deepEqual\(customers, \[\]\);/,'    await assert.rejects(()=>adapter.importCustomers(dummyConfig));').replace(/    const orders = await adapter.importOrders\(dummyConfig\);\n    assert.deepEqual\(orders, \[\]\);/,'    await assert.rejects(()=>adapter.importOrders(dummyConfig));'));
edit('server/routes/integration.routes.ts',s=>s.replace('        auth_type: cfg.auth_type',`        forecast_days:cfg.forecast_days||100,
        order_date_field:cfg.order_date_field||'date',
        uy_oplata_mode:cfg.uy_oplata_mode||'',
        payment_cash_id:cfg.payment_types?.CASH?.SD_id||'',
        payment_terminal_id:cfg.payment_types?.TERMINAL?.SD_id||'',
        auth_type: cfg.auth_type`).replace('    const configPayload: Record<string, any> = {',`    const forecastDays=Number(req.body.forecast_days||existing?.config.forecast_days||100);
    if(!Number.isInteger(forecastDays)||forecastDays<1||forecastDays>3660) throw new Error('Prognoz davri 1–3660 kun bo‘lsin');
    const configPayload: Record<string, any> = {
      ...existing?.config,
      forecast_days:forecastDays,
      order_date_field:req.body.order_date_field==='dateLoad'?'dateLoad':'date',
      uy_oplata_mode:['EXISTING','NEW'].includes(req.body.uy_oplata_mode)?req.body.uy_oplata_mode:existing?.config.uy_oplata_mode,
      payment_types:{...existing?.config.payment_types,...(req.body.payment_cash_id?{CASH:{SD_id:req.body.payment_cash_id},OLD_DEBT:{SD_id:req.body.payment_cash_id}}:{}),...(req.body.payment_terminal_id?{TERMINAL:{SD_id:req.body.payment_terminal_id}}:{})},`));
edit('src/components/views/IntegrationsView.tsx',s=>s.replace('interface IntegrationConfigState {',`interface IntegrationConfigState {
  forecast_days?:number;
  order_date_field?:string;
  uy_oplata_mode?:string;
  payment_cash_id?:string;
  payment_terminal_id?:string;`).replace('          provider_name: sys.provider_name,\n          auth_type: c.auth_type',`          forecast_days:c.forecast_days||100,order_date_field:c.order_date_field||'date',uy_oplata_mode:c.uy_oplata_mode||'',payment_cash_id:c.payment_cash_id||'',payment_terminal_id:c.payment_terminal_id||'',
          provider_name: sys.provider_name,
          auth_type: c.auth_type`).replace('              {/* Sync Options */}',`              {configForm.provider_name==='SALESDOC' && <div className="grid gap-3 rounded-xl border p-4">
                <label>Prognoz davri (kalendar kun)<input type="number" min="1" max="3660" className="border rounded p-2 ml-2" value={configForm.forecast_days||100} onChange={e=>setConfigForm(p=>({...p,forecast_days:Number(e.target.value)}))}/></label>
                <label>Kassa buyurtmasi sanasi<select className="border rounded p-2 ml-2" value={configForm.order_date_field||'date'} onChange={e=>setConfigForm(p=>({...p,order_date_field:e.target.value}))}><option value="date">Buyurtma sanasi</option><option value="dateLoad">Hujjat sanasi</option></select></label>
                <label>Uy oplata<select className="border rounded p-2 ml-2" value={configForm.uy_oplata_mode||''} onChange={e=>setConfigForm(p=>({...p,uy_oplata_mode:e.target.value}))}><option value="">Ma’nosini tanlang</option><option value="EXISTING">SalesDoc’da oldin qayd qilingan</option><option value="NEW">Yangi to‘lov — yuborilsin</option></select></label>
                <label>SalesDoc naqd to‘lov turi (SD_id)<input className="border rounded p-2 ml-2" value={configForm.payment_cash_id||''} onChange={e=>setConfigForm(p=>({...p,payment_cash_id:e.target.value}))}/></label>
                <label>SalesDoc terminal to‘lov turi (SD_id)<input className="border rounded p-2 ml-2" value={configForm.payment_terminal_id||''} onChange={e=>setConfigForm(p=>({...p,payment_terminal_id:e.target.value}))}/></label>
                <p className="text-xs">To‘lov turi tanlanmasa buyurtmaning SalesDoc’dagi turi ishlatiladi. Faqat SalesDoc qabul qilgan to‘lov “tasdiqlandi” deb belgilanadi.</p>
              </div>}
              {/* Sync Options */}`));
