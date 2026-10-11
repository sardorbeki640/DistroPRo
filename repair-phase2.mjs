import fs from 'node:fs';
const edit=(f,fn)=>fs.writeFileSync(f,fn(fs.readFileSync(f,'utf8')));
edit('server/services/analytics.service.ts',s=>{
 const start=s.indexOf('    // 1. Cash in Registers',s.indexOf('public static getBalanceSheet'));
 const end=s.indexOf('    // 3. Accounts Receivable',start);
 s=s.slice(0,start)+`    if (today !== new Date().toISOString().slice(0,10)) throw new Error('Tarixiy balans uchun ombor va bank tarixi hali mavjud emas. Faqat bugungi qisman hisobot ochiladi.');
    const latestByRegister = new Map<string, any>();
    for (const day of db.find('cash_days', d => d.company_id === company_id && d.date <= today)) {
      const previous = latestByRegister.get(day.register_id);
      if (!previous || day.date > previous.date) latestByRegister.set(day.register_id, day);
    }
    let cashInRegisters = 0;
    for (const day of latestByRegister.values()) {
      cashInRegisters += day.status === 'CLOSED'
        ? (day.actual_closing_balance ?? day.closing_balance ?? 0)
        : (day.calculated_closing_balance ?? (day.opening_balance + (day.cash_inflow ?? 0) - (day.cash_outflow ?? 0)));
    }
    // Unknown balances must not be inferred from turnover.
    const bankBalances: number | null = null;

`+s.slice(end);
 s=s.replace('const totalAssets = cashInRegisters + bankBalances + accountsReceivable + inventoryValue;','const totalAssets: number | null = null;').replace('const accountsPayable = 0;','const accountsPayable: number | null = null;').replace("s.status !== 'PAID'","s.status === 'APPROVED'").replace('const totalLiabilities = accountsPayable + payrollLiabilities + customerPrepayments;','const totalLiabilities: number | null = null;').replace('const netEquity = totalAssets - totalLiabilities;','const netEquity: number | null = null;');
 const a=s.indexOf('    // 6. Indicators',s.indexOf('public static getBalanceSheet'));const b=s.indexOf('    // 7. Cashflow',a);
 s=s.slice(0,a)+`    const workingCapital = null, currentRatio = null, debtToEquityRatio = null, cashRatio = null;
`+s.slice(b);
 s=s.replace('      totalOutflow += salariesPaid;','      // Salary cash transactions are already included in cash-day outflow.');
 s=s.replace('      as_of_date: today,',"      as_of_date: today,\n      complete: false,\n      warnings: ['Bank qoldig‘i va ta’minotchi qarzi ulanmagan. Jami balans va kapital hisoblanmadi.'],");
 return s.replace('total_liquid: cashInRegisters + bankBalances','total_liquid: null');
});
edit('src/components/views/BalanceView.tsx',s=>s.replace('  const isBalanced = balanceData','  const isBalanced = balanceData && balanceData.assets.total_assets != null').replace(/(balanceData\.[a-z_]+(?:\.[a-z_]+)?)\.toLocaleString\(\)/g,"($1 == null ? 'Ma’lumot yo‘q' : $1.toLocaleString())").replace("'KORREKTSIYA TALAB'","'HISOBOT TO‘LIQ EMAS'").replace('    <div className="space-y-6 pb-12">','    <div className="space-y-6 pb-12">\n      <div role="status" className="rounded-xl bg-amber-50 p-4 text-amber-900">Qisman hisobot. Bank qoldig‘i va ta’minotchi qarzi hali ulanmagan; jami balans va kapital tasdiqlanmagan.</div>').replace('Aktivlar, majburiyatlar va xususiy kapital bo\'yicha aniq moliyaviy hisobot','Mavjud ma’lumotlar bo‘yicha qisman hisob-kitob'));
edit('server/services/ai.service.ts',s=>{
 const a=s.indexOf('      executive_summary: `Bugungi operatsion',s.indexOf('// Deterministic, truthful'));const b=s.indexOf('      metrics_snapshot:',a);
 s=s.slice(0,a)+`      executive_summary: \`Mahalliy hisob-kitob: savdo \${ctx.daily_sales.toLocaleString()} UZS, operatsion natija \${netProfitUzs} UZS. AI javobi olinmadi. Ma’lumot to‘liqligini tekshiring.\`,
      key_findings: [{category: 'CASH_FLOW', title: 'Hisobdagi naqd qoldiq', description: \`\${ctx.cash_in_hand.toLocaleString()} UZS. Kelajak majburiyatlari kiritilmagan bo‘lsa, mablag‘ yetarliligini baholab bo‘lmaydi.\`, severity: 'WARNING'}],
      actionable_recommendations: ['Kassa, bank, savdo va qarzdorlik yozuvlarini manba hujjatlar bilan solishtiring.'],
`+s.slice(b);
 return s.replace(/stock_summary: \{[\s\S]*?\n      \},/,"stock_summary: ForecastService.getStockRunRate(companyId).summary,").replaceAll('${0} ta','${ctx.stock_summary.critical_count} ta');
});
edit('server/integrations/adapters/distribution.adapter.ts',s=>s.replace('ok: true','ok: false').replace(/message: `Distributsiya ERP[\s\S]*?`,/,"message: '1C adapteri ulanmagan. Haqiqiy API sozlanishi kerak.',").replace(/return \{\n      message: `\$\{payload.type\}[\s\S]*?\n    \};/,"throw new Error('1C eksporti ulanmagan. Ma’lumot yuborilmadi.');"));
for(const f of ['product','forecast','ai']) edit(`server/routes/${f}.routes.ts`,s=>s.replace("{ requireAuth }","{ requireAuth, requirePermission }").replace(/(router\.get\([^\n]*?), requireAuth, /g,"$1, requireAuth, requirePermission('reports', 'view'), ").replace(/(router\.(?:post|put|delete)\([^\n]*?), requireAuth, /g,`$1, requireAuth, requirePermission('${f==='product'?'settings':f==='forecast'?'integration':'reports'}', '${f==='ai'?'view':'update'}'), `));
edit('server/routes/report.routes.ts',s=>s.replace("'/balance-sheet', requireAuth,","'/balance-sheet', requireAuth, requirePermission('reports', 'view'),"));
edit('server/routes/salary.routes.ts',s=>s.replace("'/cabinet/:employeeId', requireAuth,","'/cabinet/:employeeId', requireAuth, requirePermission('salary', 'view'),"));
edit('server/tests/db_and_migrations.test.ts',s=>s.replace("    const logs = db.getTable('audit_logs');","    db.insert('audit_logs', { id: 'audit-test', company_id: 'comp-apex-001' } as any);\n    const logs = db.getTable('audit_logs');"));
