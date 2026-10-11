import fs from 'node:fs';
const edit=(p,f)=>fs.writeFileSync(p,f(fs.readFileSync(p,'utf8').replaceAll('\r\n','\n')));
edit('server/routes/cash.routes.ts',s=>{
 s="import { CashPostingService } from '../services/cash-posting.service.ts';\n"+s;
 s=s.replace("const router = Router();",`const router = Router();
router.post('/days/:id/save', requireAuth, requirePermission('cash', 'create'), async (req, res, next) => {
  try { res.json({success:true,...await CashPostingService.save(req.user!.companyId,req.params.id)}); }
  catch(err){ next(err); }
});`);
 for(const path of ['/days/:id/close','/day/close']) s=s.replace(`router.post('${path}', requireAuth, requirePermission('cash', 'close'), (req:`, `router.post('${path}', requireAuth, requirePermission('cash', 'close'), async (req:`);
 s=s.replaceAll('    const closedDay = CashService.closeCashDay({',`    const ownedDay=db.findOne('cash_days',d=>d.id===validated.cash_day_id && d.company_id===req.user!.companyId);
    if(!ownedDay) throw new Error('Kassa kuni topilmadi');
    const closedDay = CashService.closeCashDay({`);
 s=s.replaceAll("      message: 'Kassa kuni muvaffaqiyatli yopildi va hisobot qilindi.',", "      message: 'Kassa kuni yopildi. ' + posting.message,\n      posting,");
 s=s.replaceAll("      message: 'Kassa kuni muvaffaqiyatli yopildi va audit qilindi.',", "      message: 'Kassa kuni yopildi. ' + posting.message,\n      posting,");
 s=s.replaceAll('      cashDay: closedDay','      cashDay: closedDay');
 // Insert posting only immediately before the close response blocks.
 s=s.replaceAll("    res.json({\n      success: true,\n      message: 'Kassa kuni yopildi.", `    const posting=await CashPostingService.save(req.user!.companyId,closedDay.id).catch((err:any)=>({pending:true,message:err.message}));
    res.json({
      success: true,
      message: 'Kassa kuni yopildi.`);
 s=s.replace('    let syncStats = null;', '    let syncStats = null;\n    let syncError = null;');
 s=s.replace("      console.warn('[CashRoutes] Automatic day orders sync note:', syncErr.message);", '      syncError=syncErr.message;');
 s=s.replace('      syncStats\n', '      syncStats,\n      syncError\n');
 s=s.replace('      message: syncStats &&', '      message: syncError ? `Kassa ochildi, lekin buyurtmalar olinmadi: ${syncError}` : syncStats &&');
 return s;
});
edit('server/services/cash.service.ts',s=>{
 const a=s.indexOf('    const tx = db.findById',s.indexOf('  public static syncPaymentToDistribution'));
 const b=s.indexOf('\n  }',a);
 s=s.slice(0,a)+`    throw new Error('Bu eski yuborish usuli o‘chirildi. Kassa reestridagi “Saqlash va SalesDoc’ga yuborish” tugmasidan foydalaning.');`+s.slice(b);
 const marker='    // Update associated transactions\n';
 const i=s.indexOf(marker,s.indexOf('  public static updateRegistryOrder'));
 s=s.slice(0,i)+`    const day=db.findById('cash_days',existing.cash_day_id);
    if(day?.status!=='OPEN') throw new Error('Yopiq kun yozuvini tahrirlab bo‘lmaydi.');
    if(db.findOne('integration_transactions',t=>t.company_id===company_id && t.payload?.direction==='OUTBOUND' && t.payload?.rowId===id && ['PROCESSED','SENDING','UNCERTAIN'].includes(t.status))) throw new Error('SalesDoc’ga yuborilgan to‘lov qulflangan. Avval to‘lovni solishtiring.');
    const allowed=['order_number','agent_id','customer_id','sale_amount','cash_payment','uy_oplata','terminal_click','nasiyadan_kirim','return_amount','carried_forward_amount','note'];
    dto=Object.fromEntries(Object.entries(dto).filter(([key])=>allowed.includes(key)));
    for(const key of ['sale_amount','cash_payment','uy_oplata','terminal_click','nasiyadan_kirim','return_amount','carried_forward_amount']) {
      const value=(dto as any)[key];
      if(value!==undefined && (typeof value!=='number'||!Number.isFinite(value)||value<0)) throw new Error('Summalar manfiy bo‘lmagan son bo‘lsin.');
    }
    if(existing.external_order_id && (dto.customer_id && dto.customer_id!==existing.customer_id || dto.sale_amount!==undefined && dto.sale_amount!==existing.sale_amount)) throw new Error('SalesDoc buyurtmasining mijozi yoki summasini manbada o‘zgartiring.');
    const merged={...existing,...dto};
    const paid=(merged.cash_payment||0)+(merged.uy_oplata||0)+(merged.terminal_click||0)+(merged.return_amount||0);
    if(paid>merged.sale_amount) throw new Error('To‘lov va qaytarish savdo summasidan oshdi.');
    dto.remaining_debt=merged.sale_amount-paid;
    dto.nasiya_perech=dto.remaining_debt;
    dto.credit_amount=dto.remaining_debt;
    dto.cash_amount=merged.cash_payment||0;
    dto.terminal_amount=merged.terminal_click||0;
    return db.transaction(()=>{
`+s.slice(i);
 s=s.replace('    return updated;\n  }\n\n  /**\n   * Deletes an existing registry order', '    return updated;\n    });\n  }\n\n  /**\n   * Deletes an existing registry order');
 s=s.replace('    if (dto.customer_id || dto.nasiya_perech !== undefined || dto.nasiyadan_kirim !== undefined) {','    if (!existing.external_order_id && (dto.customer_id || dto.nasiya_perech !== undefined || dto.nasiyadan_kirim !== undefined)) {');
 const point=s.indexOf('    this.recalculateCashDayTotals(existing.cash_day_id);',s.indexOf('  public static updateRegistryOrder'));
 s=s.slice(0,point)+`    for(const tx of db.find('cash_transactions',t=>t.company_id===company_id && t.order_id===id)) {
      if(tx.external_reference) throw new Error('Bog‘langan to‘lovni o‘zgartirib bo‘lmaydi.');
      db.delete('cash_transactions',tx.id);
    }
    for(const [amount,method,type] of [[updated.cash_payment||0,'CASH','SALE_PAYMENT'],[updated.terminal_click||0,'TERMINAL','SALE_PAYMENT'],[updated.nasiyadan_kirim||0,'CASH','CREDIT_COLLECTION']] as const) {
      if(amount>0) this.addTransaction({company_id,cash_day_id:existing.cash_day_id,transaction_type:type,amount,payment_method:method,customer_id:updated.customer_id,order_id:id,order_number:updated.order_number,description:'Reestr to‘lovi',user_id,user_email});
    }
`+s.slice(point);
 const deleteAt=s.indexOf('    // Remove associated transactions',s.indexOf('  public static deleteRegistryOrder'));
 s=s.slice(0,deleteAt)+`    if(db.findById('cash_days',existing.cash_day_id)?.status!=='OPEN' || db.findOne('integration_transactions',t=>t.payload?.rowId===id && ['PROCESSED','SENDING','UNCERTAIN'].includes(t.status))) throw new Error('Yopiq yoki yuborilgan yozuvni o‘chirish taqiqlangan.');
`+s.slice(deleteAt);
 return s;
});
edit('server/integrations/provider.ts',s=>{
 s=s.replace('    const now = new Date().toISOString();\n    // 1. Find active integration',`    const day=db.findOne('cash_days',d=>d.id===cashDayId && d.company_id===companyId);
    if(!day || day.status!=='OPEN') throw new Error('Faqat ochiq kassa kuni yangilanadi.');
    const now = new Date().toISOString();
    // 1. Find active integration`);
 s=s.replace('        console.warn(`[IntegrationProvider] syncDayOrders fetch note (${date}):`, err.message);','        throw err;');
 s=s.replace('let cust = customerMap.get(ord.customerCode) || customerMap.get(ord.customerName.toLowerCase());','let cust = customerMap.get(ord.customerCode);');
 s=s.replace('          sale_amount: ord.totalAmount,\n          nasiya_perech:',`          integration_id:activeIntegration?.id,
          external_order_id:ord.externalId,
          customer_ref:ord.customerRef,
          order_ref:ord.orderRef,
          payment_type_ref:ord.paymentTypeRef,
          sale_amount: ord.totalAmount,
          nasiya_perech:`);
 s=s.replace("        db.update('daily_order_entries', entry.id, {\n          sale_amount: ord.totalAmount,",`        const debt=Math.max(0,ord.totalAmount-(entry.cash_payment||0)-(entry.uy_oplata||0)-(entry.terminal_click||0)-(entry.return_amount||0));
        db.update('daily_order_entries', entry.id, {
          integration_id:activeIntegration?.id,external_order_id:ord.externalId,customer_ref:ord.customerRef,order_ref:ord.orderRef,payment_type_ref:ord.paymentTypeRef,
          remaining_debt:debt,nasiya_perech:debt,credit_amount:debt,
          sale_amount: ord.totalAmount,`);
 return s;
});
edit('src/services/api.ts',s=>s.replace('export const api = {',`export const api = {
  saveCashRegistry: (id:string):Promise<any> => fetchApi('/api/cash/days/'+id+'/save',{method:'POST'}),
  refreshCashOrders: (id:string):Promise<any> => fetchApi('/api/cash/days/'+id+'/sync-orders',{method:'POST'}),`));
edit('src/components/views/CashView.tsx',s=>s.replace('  // Click a file from list to open detail',`  const saveDay = async () => {
    if(!selectedFile) return;
    setLoading(true);setError(null);setSuccessMsg(null);
    try { const result=await api.saveCashRegistry(selectedFile.id); if(result.pending) setError(result.message); else setSuccessMsg(result.message); await fetchRegistry(); }
    catch(err:any){setError(err.message);}finally{setLoading(false);}
  };
  const refreshOrders = async () => {
    if(!selectedFile) return;
    setLoading(true);setError(null);
    try{const result=await api.refreshCashOrders(selectedFile.id);setSuccessMsg(result.message);await fetchRegistry();}
    catch(err:any){setError(err.message);}finally{setLoading(false);}
  };
  // Click a file from list to open detail`).replace('              {/* If day is closed, allow reopen with Director PIN */}',`              {selectedFile && <button disabled={loading} onClick={saveDay} className="px-4 py-2 text-xs font-bold text-white bg-blue-700 rounded-xl">Saqlash va SalesDoc’ga yuborish</button>}
              {selectedFile?.status==='OPEN' && <button disabled={loading} onClick={refreshOrders} className="px-4 py-2 text-xs font-bold bg-blue-50 rounded-xl">Buyurtmalarni yangilash</button>}
              {/* If day is closed, allow reopen with Director PIN */}`));
edit('src/components/views/DailyFilesView.tsx',s=>s.replace('      await api.closeCashDay({','      const closeResult = await api.closeCashDay({').replace("text: `${dossierData.day.date} sanasidagi kunlik fayl muvaffaqiyatli yopildi va qulflanadi!`", "text: closeResult.message || 'Kassa kuni yopildi'"));
