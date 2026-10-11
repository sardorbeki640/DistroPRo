import React, { useState, useEffect } from 'react';
import { localToday } from '../../utils/date';
import { 
  Scale, 
  CheckCircle2, 
  AlertTriangle, 
  TrendingUp, 
  Calendar, 
  Download, 
  RefreshCw, 
  ShieldCheck, 
  Briefcase, 
  Building, 
  PieChart,
  Wallet,
  Banknote,
  ArrowDownLeft,
  ArrowUpRight,
  CreditCard,
  ChevronDown,
  ChevronUp,
  Sparkles
} from 'lucide-react';
import { api } from '../../services/api.ts';
import { BalanceSheetReport } from '../../types.ts';
import { ExportButton, exportTableXlsx } from '../common/TableToolbar.tsx';

export const BalanceView: React.FC = () => {
  const todayStr = localToday();
  const [asOfDate, setAsOfDate] = useState<string>(todayStr);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [balanceData, setBalanceData] = useState<BalanceSheetReport | null>(null);
  const [showCashflowDetails, setShowCashflowDetails] = useState<boolean>(false);

  const fetchBalanceSheet = async (dateStr?: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getBalanceSheet(dateStr || asOfDate);
      setBalanceData(res.balance);
    } catch (err: any) {
      setError(err.message || 'Balans hisobotini yuklashda xatolik yuz berdi');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBalanceSheet(asOfDate);
  }, [asOfDate]);

  const handlePrint = () => {
    window.print();
  };

  const exportBalance = async () => {
    if (!balanceData) throw new Error('Balans hali yuklanmadi.');
    const a = balanceData.assets, l = balanceData.liabilities, c = balanceData.cashflow, b = c?.breakdown, i = balanceData.indicators;
    const row = (group: string, name: string, amount: number | null | undefined, type: 'money' | 'number' = 'money') => ({ group, name, [type === 'money' ? 'amount' : 'ratio']: amount ?? null });
    await exportTableXlsx({
      fileName: `Balans_${asOfDate}`,
      title: `Korxona balansi — ${asOfDate.split('-').reverse().join('.')} holatiga`,
      columns: [{ header: 'Bo‘lim', key: 'group', width: 16 }, { header: 'Ko‘rsatkich', key: 'name', width: 40 }, { header: 'Summa', key: 'amount', type: 'money' }, { header: 'Koeffitsient', key: 'ratio', type: 'number' }],
      rows: [
        row('Pul oqimi', 'Jami kirim', c?.total_inflow),
        ...(b ? [row('Pul oqimi', '  naqd savdo', b.sales_cash), row('Pul oqimi', '  nasiyadan kirim', b.credit_collected)] : []),
        row('Pul oqimi', 'Jami chiqim', c?.total_outflow),
        ...(b ? [row('Pul oqimi', '  operatsion xarajatlar', b.operating_expenses), row('Pul oqimi', '  to‘langan oyliklar', b.salaries_paid), row('Pul oqimi', '  qaytarishlar', b.returns)] : []),
        row('Pul oqimi', 'Sof pul oqimi', c?.net_flow),
        row('Pul oqimi', 'Inkassa — bankka topshirilgan (xarajat emas)', b?.bank_deposits || 0),
        row('Aktivlar', 'Kassadagi naqd pul', a.cash_in_registers),
        row('Aktivlar', 'Bank va terminal', a.bank_balances),
        row('Aktivlar', 'Mijozlar qarzdorligi (nasiya)', a.accounts_receivable),
        row('Aktivlar', 'Ombor tovar zaxirasi', a.inventory_value),
        row('Aktivlar', 'JAMI AKTIVLAR', a.total_assets),
        row('Majburiyatlar', 'Yetkazib beruvchilardan qarz', l.accounts_payable),
        row('Majburiyatlar', 'Xodimlar oylik majburiyati', l.payroll_liabilities),
        row('Majburiyatlar', 'Mijozlar avanslari', l.customer_prepayments),
        row('Majburiyatlar', 'JAMI MAJBURIYATLAR', l.total_liabilities),
        row('Kapital', 'Xususiy kapital', balanceData.net_equity),
        row('Ko‘rsatkichlar', 'Aylanma kapital', i.working_capital),
        row('Ko‘rsatkichlar', 'Joriy likvidlik (current ratio)', i.current_ratio, 'number'),
        row('Ko‘rsatkichlar', 'Pul vositalari nisbati (cash ratio)', i.cash_ratio, 'number'),
        row('Ko‘rsatkichlar', 'Qarz / kapital', i.debt_to_equity_ratio, 'number')
      ],
      filters: ['qisman hisobot: bank qoldig‘i va ta’minotchi qarzi hali ulanmagan']
    });
  };

  const isBalanced = balanceData && balanceData.assets.total_assets != null 
    ? Math.abs(balanceData.assets.total_assets - (balanceData.liabilities.total_liabilities + balanceData.net_equity)) < 100
    : true;

  return (
    <div className="space-y-6 pb-12">
      <div role="status" className="rounded-xl bg-amber-50 p-4 text-amber-900">Qisman hisobot. Bank qoldig‘i va ta’minotchi qarzi hali ulanmagan; jami balans va kapital tasdiqlanmagan.</div>
      {/* Top Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-neutral-200 shadow-xs">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 bg-indigo-50 text-indigo-700 rounded-xl border border-indigo-100">
            <Scale className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-neutral-900">Buxgalteriya va Korxona Balansi</h1>
            <p className="text-xs text-neutral-500 mt-0.5">
              Mavjud ma’lumotlar bo‘yicha qisman hisob-kitob
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* As-of Date picker */}
          <div className="flex items-center space-x-2 bg-neutral-50 px-3 py-1.5 rounded-xl border border-neutral-200">
            <Calendar className="w-4 h-4 text-neutral-500" />
            <span className="text-xs font-medium text-neutral-600">Sana:</span>
            <input
              type="date"
              value={asOfDate}
              onChange={e => setAsOfDate(e.target.value)}
              className="bg-transparent text-xs font-semibold text-neutral-800 focus:outline-none"
            />
          </div>

          <button
            onClick={() => fetchBalanceSheet(asOfDate)}
            disabled={loading}
            className="inline-flex items-center px-3.5 py-2 text-xs font-semibold text-neutral-700 bg-neutral-100 hover:bg-neutral-200 rounded-xl transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
            Yangilash
          </button>

          <button
            onClick={handlePrint}
            className="inline-flex items-center px-3.5 py-2 text-xs font-semibold text-neutral-700 bg-white border border-neutral-300 hover:bg-neutral-50 rounded-xl transition shadow-xs"
          >
            <Download className="w-3.5 h-3.5 mr-1.5 text-neutral-500" />
            Chop etish / PDF
          </button>

          <ExportButton onExport={exportBalance} />
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-800 flex items-center space-x-3 text-xs">
          <AlertTriangle className="w-5 h-5 text-red-600 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {balanceData && (
        <>
          {/* BALANCE VERIFICATION BANNER */}
          <div className={`p-4 rounded-2xl border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xs ${
            isBalanced 
              ? 'bg-emerald-50/80 border-emerald-200 text-emerald-900' 
              : 'bg-amber-50/80 border-amber-200 text-amber-900'
          }`}>
            <div className="flex items-center space-x-3">
              {isBalanced ? (
                <div className="p-2 bg-emerald-100 text-emerald-700 rounded-xl shrink-0">
                  <ShieldCheck className="w-5 h-5" />
                </div>
              ) : (
                <div className="p-2 bg-amber-100 text-amber-700 rounded-xl shrink-0">
                  <AlertTriangle className="w-5 h-5" />
                </div>
              )}
              <div>
                <h3 className="text-sm font-bold">
                  {isBalanced 
                    ? 'Buxgalteriya Balansi Mukammal (Aktivlar = Majburiyatlar + Sof Kapital)' 
                    : 'To‘liq balans uchun ma’lumot yetishmaydi'}
                </h3>
                <p className="text-xs opacity-90 mt-0.5">
                  Jami Aktivlar: <strong>{(balanceData.assets.total_assets == null ? 'Ma’lumot yo‘q' : balanceData.assets.total_assets.toLocaleString())} UZS</strong> | Majburiyatlar + Kapital: <strong>{(balanceData.net_equity == null ? 'Ma’lumot yo‘q' : (balanceData.liabilities.total_liabilities + balanceData.net_equity).toLocaleString())} UZS</strong>
                </p>
              </div>
            </div>

            <span className={`px-3 py-1 rounded-full text-xs font-bold shrink-0 ${
              isBalanced ? 'bg-emerald-200 text-emerald-900' : 'bg-amber-200 text-amber-900'
            }`}>
              {isBalanced ? 'BALANS MUVOZANATDA' : 'HISOBOT TO‘LIQ EMAS'}
            </span>
          </div>

          {/* ========================================================================= */}
          {/* PRIMARY CASH FLOW & CASH BALANCE CARDS (KIRIM, CHIQIM VA NAQD QOLDIQ)    */}
          {/* ========================================================================= */}
          <div className="bg-white rounded-2xl border border-neutral-200 p-5 shadow-xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-neutral-100 pb-3">
              <div className="flex items-center space-x-2.5">
                <div className="p-2 bg-emerald-100 text-emerald-800 rounded-xl">
                  <Wallet className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center space-x-2">
                    <h2 className="text-base font-black text-neutral-900">
                      Pul Mablag'lari Harakati va Naqd Qoldiq
                    </h2>
                    <span className="flex h-2 w-2 relative">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                    </span>
                  </div>
                  <p className="text-xs text-neutral-500">
                    Kassadagi amaldagi naqd qoldiq, tushgan kirimlar va xarajat chiqimlari tahlili
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowCashflowDetails(prev => !prev)}
                className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-xl border border-neutral-200 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 transition"
              >
                <span>{showCashflowDetails ? "Tafsilotlarni yashirish" : "Kirim-chiqim tafsiloti"}</span>
                {showCashflowDetails ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>
            </div>

            {/* 5 Core Visual Stat Cards: Kirim, Chiqim, Naqd Qoldiq, Bank, Sof Oqim */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
              {/* 1. JAMI KIRIM */}
              <div className="relative overflow-hidden rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50/70 via-white to-emerald-50/30 p-4 shadow-2xs">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-black uppercase tracking-wider text-emerald-800">
                    Jami Kirim
                  </span>
                  <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
                    <ArrowDownLeft className="h-4 w-4" />
                  </div>
                </div>
                <div className="mt-2.5">
                  <div className="text-xl font-black text-emerald-950">
                    {(balanceData.cashflow?.total_inflow || 0).toLocaleString()} <span className="text-xs font-normal text-emerald-700">UZS</span>
                  </div>
                  <p className="text-[10px] text-emerald-700 mt-1 font-medium">
                    Savdo tushumi + Nasiya undiruvlari
                  </p>
                </div>
              </div>

              {/* 2. JAMI CHIQIM */}
              <div className="relative overflow-hidden rounded-2xl border border-rose-200 bg-gradient-to-br from-rose-50/70 via-white to-rose-50/30 p-4 shadow-2xs">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-black uppercase tracking-wider text-rose-800">
                    Jami Chiqim
                  </span>
                  <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-rose-100 text-rose-700">
                    <ArrowUpRight className="h-4 w-4" />
                  </div>
                </div>
                <div className="mt-2.5">
                  <div className="text-xl font-black text-rose-950">
                    {(balanceData.cashflow?.total_outflow || 0).toLocaleString()} <span className="text-xs font-normal text-rose-700">UZS</span>
                  </div>
                  <p className="text-[10px] text-rose-700 mt-1 font-medium">
                    Xarajatlar + Maoshlar + Qaytarishlar
                  </p>
                </div>
              </div>

              {/* 3. NAQD QOLDIQ (KASSA NAQD PULI) - Prominent Hero Card */}
              <div className="relative overflow-hidden rounded-2xl border-2 border-amber-300 bg-gradient-to-br from-amber-50 via-white to-amber-50/40 p-4 shadow-xs">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-1.5">
                    <span className="text-[11px] font-black uppercase tracking-wider text-amber-900">
                      Naqd Qoldiq
                    </span>
                    <span className="px-1.5 py-0.2 rounded-full bg-amber-200 text-amber-950 text-[9px] font-extrabold">
                      KASSA
                    </span>
                  </div>
                  <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-100 text-amber-800">
                    <Banknote className="h-4 w-4" />
                  </div>
                </div>
                <div className="mt-2.5">
                  <div className="text-xl font-black text-amber-950">
                    {(balanceData.assets.cash_in_registers == null ? 'Ma’lumot yo‘q' : balanceData.assets.cash_in_registers.toLocaleString())} <span className="text-xs font-normal text-amber-800">UZS</span>
                  </div>
                  <p className="text-[10px] text-amber-800 mt-1 font-semibold">
                    Kassalarda amaldagi fizik naqd pul
                  </p>
                </div>
              </div>

              {/* 4. BANK VA TERMINAL */}
              <div className="relative overflow-hidden rounded-2xl border border-blue-200 bg-gradient-to-br from-blue-50/70 via-white to-blue-50/30 p-4 shadow-2xs">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-black uppercase tracking-wider text-blue-800">
                    Bank & Terminal
                  </span>
                  <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
                    <CreditCard className="h-4 w-4" />
                  </div>
                </div>
                <div className="mt-2.5">
                  <div className="text-xl font-black text-blue-950">
                    {(balanceData.assets.bank_balances == null ? 'Ma’lumot yo‘q' : balanceData.assets.bank_balances.toLocaleString())} <span className="text-xs font-normal text-blue-700">UZS</span>
                  </div>
                  <p className="text-[10px] text-blue-700 mt-1 font-medium">
                    Terminal, Click & Hisobraqam
                  </p>
                </div>
              </div>

              {/* 5. SOF PUL OQIMI */}
              <div className="relative overflow-hidden rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-50/70 via-white to-indigo-50/30 p-4 shadow-2xs">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-black uppercase tracking-wider text-indigo-800">
                    Sof Pul Oqimi
                  </span>
                  <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-100 text-indigo-700">
                    <TrendingUp className="h-4 w-4" />
                  </div>
                </div>
                <div className="mt-2.5">
                  <div className={`text-xl font-black ${(balanceData.cashflow?.net_flow || 0) >= 0 ? 'text-indigo-950' : 'text-rose-700'}`}>
                    {((balanceData.cashflow?.net_flow || 0) >= 0 ? '+' : '') + (balanceData.cashflow?.net_flow || 0).toLocaleString()} <span className="text-xs font-normal text-indigo-700">UZS</span>
                  </div>
                  <p className="text-[10px] text-indigo-700 mt-1 font-medium">
                    Kirim minus chiqim saldosi
                  </p>
                </div>
              </div>
            </div>

            {/* Optional Collapsible Detailed Breakdown */}
            {showCashflowDetails && (
              <div className="mt-3 p-4 rounded-xl bg-neutral-50/90 border border-neutral-200">
                <h4 className="text-xs font-bold text-neutral-800 uppercase tracking-wider mb-3">
                  Kirim va Chiqim Bo'yicha Batafsil Tafsilot:
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                  {/* Kirimlar */}
                  <div className="bg-white p-3.5 rounded-xl border border-emerald-100 shadow-2xs space-y-2">
                    <div className="flex items-center justify-between font-bold text-emerald-900 border-b border-neutral-100 pb-1.5">
                      <span className="flex items-center space-x-1.5">
                        <ArrowDownLeft className="w-3.5 h-3.5 text-emerald-600" />
                        <span>Kirim Tarkibi (Pul Tushumi)</span>
                      </span>
                      <span>{(balanceData.cashflow?.total_inflow || 0).toLocaleString()} UZS</span>
                    </div>
                    <div className="space-y-1.5 pt-1 text-neutral-600">
                      <div className="flex justify-between">
                        <span>Savdo naqd to'lovlari:</span>
                        <span className="font-semibold text-neutral-900">{(balanceData.cashflow?.breakdown?.sales_cash || 0).toLocaleString()} UZS</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Nasiyadan undirilgan qarzlar:</span>
                        <span className="font-semibold text-neutral-900">{(balanceData.cashflow?.breakdown?.credit_collected || 0).toLocaleString()} UZS</span>
                      </div>
                      <div className="flex justify-between border-t border-neutral-100 pt-1 font-bold text-emerald-700">
                        <span>Jami Kirim:</span>
                        <span>{(balanceData.cashflow?.total_inflow || 0).toLocaleString()} UZS</span>
                      </div>
                    </div>
                  </div>

                  {/* Chiqimlar */}
                  <div className="bg-white p-3.5 rounded-xl border border-rose-100 shadow-2xs space-y-2">
                    <div className="flex items-center justify-between font-bold text-rose-900 border-b border-neutral-100 pb-1.5">
                      <span className="flex items-center space-x-1.5">
                        <ArrowUpRight className="w-3.5 h-3.5 text-rose-600" />
                        <span>Chiqim Tarkibi (Xarajatlar & To'lovlar)</span>
                      </span>
                      <span>{(balanceData.cashflow?.total_outflow || 0).toLocaleString()} UZS</span>
                    </div>
                    <div className="space-y-1.5 pt-1 text-neutral-600">
                      <div className="flex justify-between">
                        <span>Kundalik & operatsion xarajatlar:</span>
                        <span className="font-semibold text-neutral-900">{(balanceData.cashflow?.breakdown?.operating_expenses || 0).toLocaleString()} UZS</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Xodimlarga to'langan oyliklar:</span>
                        <span className="font-semibold text-neutral-900">{(balanceData.cashflow?.breakdown?.salaries_paid || 0).toLocaleString()} UZS</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Tovar qaytarishlari (Vozvrat):</span>
                        <span className="font-semibold text-neutral-900">{(balanceData.cashflow?.breakdown?.returns || 0).toLocaleString()} UZS</span>
                      </div>
                      <div className="flex justify-between border-t border-neutral-100 pt-1 font-bold text-rose-700">
                        <span>Jami Chiqim:</span>
                        <span>{(balanceData.cashflow?.total_outflow || 0).toLocaleString()} UZS</span>
                      </div>
                    </div>
                  </div>
                </div>
                {/* Inkassa: money moved from the register to the bank — neither an outflow nor an expense */}
                <div className="mt-3 flex items-center justify-between rounded-xl border border-blue-100 bg-blue-50/60 px-3.5 py-2.5 text-xs">
                  <span className="text-blue-900"><b>Inkassa (bankka topshirilgan naqd):</b> kassadan bankka o‘tgan pul. Xarajat emas, foydaga ta’sir qilmaydi.</span>
                  <span className="font-bold text-blue-950 whitespace-nowrap">{(balanceData.cashflow?.breakdown?.bank_deposits || 0).toLocaleString()} UZS</span>
                </div>
              </div>
            )}
          </div>

          {/* MAIN 3 BALANCES: ASSETS, LIABILITIES, EQUITY */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* 1. AKTIVLAR (ASSETS) */}
            <div className="bg-white rounded-2xl border border-neutral-200 shadow-xs overflow-hidden flex flex-col">
              <div className="p-4 bg-gradient-to-r from-blue-50 to-indigo-50 border-b border-indigo-100 flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Briefcase className="w-5 h-5 text-indigo-700" />
                  <h2 className="text-sm font-bold text-indigo-950 uppercase tracking-wider">Aktivlar (Assets)</h2>
                </div>
                <span className="text-xs font-semibold text-indigo-700 bg-indigo-100 px-2 py-0.5 rounded-md">
                  Mablag'lar
                </span>
              </div>

              <div className="p-5 flex-1 divide-y divide-neutral-100 space-y-4">
                <div className="flex items-center justify-between pt-2 bg-amber-50/70 p-2.5 rounded-xl border border-amber-200/80">
                  <div>
                    <div className="flex items-center space-x-1.5">
                      <p className="text-xs font-black text-neutral-900">Kassa Qoldiqlari</p>
                      <span className="px-1.5 py-0.5 rounded bg-amber-200 text-amber-900 font-extrabold text-[9px]">
                        NAQD QOLDIQ
                      </span>
                    </div>
                    <p className="text-[11px] text-neutral-500">Kassalardagi amaldagi naqd pullar</p>
                  </div>
                  <span className="text-sm font-black text-amber-950">
                    {(balanceData.assets.cash_in_registers == null ? 'Ma’lumot yo‘q' : balanceData.assets.cash_in_registers.toLocaleString())} <span className="text-[10px] text-neutral-500 font-normal">UZS</span>
                  </span>
                </div>

                <div className="flex items-center justify-between pt-4">
                  <div>
                    <p className="text-xs font-bold text-neutral-800">Bank va Hisobraqamlar</p>
                    <p className="text-[11px] text-neutral-400">Terminal va Click tushumlari</p>
                  </div>
                  <span className="text-sm font-bold text-neutral-900">
                    {(balanceData.assets.bank_balances == null ? 'Ma’lumot yo‘q' : balanceData.assets.bank_balances.toLocaleString())} <span className="text-[10px] text-neutral-400 font-normal">UZS</span>
                  </span>
                </div>

                <div className="flex items-center justify-between pt-4">
                  <div>
                    <p className="text-xs font-bold text-neutral-800">Debitorlik Qarzdorligi (Nasiya)</p>
                    <p className="text-[11px] text-neutral-400">Mijozlardan undiriladigan savdo qarzlar</p>
                  </div>
                  <span className="text-sm font-bold text-indigo-600">
                    {(balanceData.assets.accounts_receivable == null ? 'Ma’lumot yo‘q' : balanceData.assets.accounts_receivable.toLocaleString())} <span className="text-[10px] text-neutral-400 font-normal">UZS</span>
                  </span>
                </div>

                <div className="flex items-center justify-between pt-4">
                  <div>
                    <p className="text-xs font-bold text-neutral-800">Ombor Tovar Zaxirasi</p>
                    <p className="text-[11px] text-neutral-400">Tannarx bo'yicha mahsulotlar qoldig'i</p>
                  </div>
                  <span className="text-sm font-bold text-emerald-600">
                    {(balanceData.assets.inventory_value == null ? 'Ma’lumot yo‘q' : balanceData.assets.inventory_value.toLocaleString())} <span className="text-[10px] text-neutral-400 font-normal">UZS</span>
                  </span>
                </div>
              </div>

              <div className="p-4 bg-indigo-50/50 border-t border-indigo-100 flex items-center justify-between">
                <span className="text-xs font-black text-indigo-950 uppercase">Jami Aktivlar</span>
                <span className="text-base font-black text-indigo-700">
                  {(balanceData.assets.total_assets == null ? 'Ma’lumot yo‘q' : balanceData.assets.total_assets.toLocaleString())} UZS
                </span>
              </div>
            </div>

            {/* 2. MAJBURIYATLAR (LIABILITIES) */}
            <div className="bg-white rounded-2xl border border-neutral-200 shadow-xs overflow-hidden flex flex-col">
              <div className="p-4 bg-gradient-to-r from-rose-50 to-amber-50 border-b border-rose-100 flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Building className="w-5 h-5 text-rose-700" />
                  <h2 className="text-sm font-bold text-rose-950 uppercase tracking-wider">Majburiyatlar (Liabilities)</h2>
                </div>
                <span className="text-xs font-semibold text-rose-700 bg-rose-100 px-2 py-0.5 rounded-md">
                  Qarzlar
                </span>
              </div>

              <div className="p-5 flex-1 divide-y divide-neutral-100 space-y-4">
                <div className="flex items-center justify-between pt-2">
                  <div>
                    <p className="text-xs font-bold text-neutral-800">Kreditorlik Qarzdorligi</p>
                    <p className="text-[11px] text-neutral-400">Yetkazib beruvchilarga to'lanadigan qarz</p>
                  </div>
                  <span className="text-sm font-bold text-rose-600">
                    {(balanceData.liabilities.accounts_payable == null ? 'Ma’lumot yo‘q' : balanceData.liabilities.accounts_payable.toLocaleString())} <span className="text-[10px] text-neutral-400 font-normal">UZS</span>
                  </span>
                </div>

                <div className="flex items-center justify-between pt-4">
                  <div>
                    <p className="text-xs font-bold text-neutral-800">Ish Haqi Bo'yicha Majburiyat</p>
                    <p className="text-[11px] text-neutral-400">Xodimlar oylik maoshlari majburiyati</p>
                  </div>
                  <span className="text-sm font-bold text-amber-600">
                    {(balanceData.liabilities.payroll_liabilities == null ? 'Ma’lumot yo‘q' : balanceData.liabilities.payroll_liabilities.toLocaleString())} <span className="text-[10px] text-neutral-400 font-normal">UZS</span>
                  </span>
                </div>

                <div className="flex items-center justify-between pt-4">
                  <div>
                    <p className="text-xs font-bold text-neutral-800">Mijozlar Avansi</p>
                    <p className="text-[11px] text-neutral-400">Mijozlardan olingan oldindan to'lovlar</p>
                  </div>
                  <span className="text-sm font-bold text-neutral-700">
                    {(balanceData.liabilities.customer_prepayments == null ? 'Ma’lumot yo‘q' : balanceData.liabilities.customer_prepayments.toLocaleString())} <span className="text-[10px] text-neutral-400 font-normal">UZS</span>
                  </span>
                </div>
              </div>

              <div className="p-4 bg-rose-50/50 border-t border-rose-100 flex items-center justify-between">
                <span className="text-xs font-black text-rose-950 uppercase">Jami Majburiyatlar</span>
                <span className="text-base font-black text-rose-700">
                  {(balanceData.liabilities.total_liabilities == null ? 'Ma’lumot yo‘q' : balanceData.liabilities.total_liabilities.toLocaleString())} UZS
                </span>
              </div>
            </div>

            {/* 3. XUSUSIY KAPITAL (EQUITY) */}
            <div className="bg-white rounded-2xl border border-neutral-200 shadow-xs overflow-hidden flex flex-col">
              <div className="p-4 bg-gradient-to-r from-emerald-50 to-teal-50 border-b border-emerald-100 flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <PieChart className="w-5 h-5 text-emerald-700" />
                  <h2 className="text-sm font-bold text-emerald-950 uppercase tracking-wider">Xususiy Kapital (Equity)</h2>
                </div>
                <span className="text-xs font-semibold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-md">
                  Sof Mulk
                </span>
              </div>

              <div className="p-5 flex-1 divide-y divide-neutral-100 space-y-4">
                <div className="flex items-center justify-between pt-2">
                  <div>
                    <p className="text-xs font-bold text-neutral-800">Sof Kapital (Net Equity)</p>
                    <p className="text-[11px] text-neutral-400">Aktivlar minus barcha majburiyatlar</p>
                  </div>
                  <span className="text-sm font-bold text-emerald-600">
                    {(balanceData.net_equity == null ? 'Ma’lumot yo‘q' : balanceData.net_equity.toLocaleString())} <span className="text-[10px] text-neutral-400 font-normal">UZS</span>
                  </span>
                </div>

                <div className="flex items-center justify-between pt-4">
                  <div>
                    <p className="text-xs font-bold text-neutral-800">Korxona Moliyaviy Holati</p>
                    <p className="text-[11px] text-neutral-400">Mustaqillik darajasi</p>
                  </div>
                  <span className="text-xs font-bold text-emerald-700 bg-emerald-50 px-2 py-1 rounded-lg">
                    Barqaror
                  </span>
                </div>
              </div>

              <div className="p-4 bg-emerald-50/50 border-t border-emerald-100 flex items-center justify-between">
                <span className="text-xs font-black text-emerald-950 uppercase">Jami Sof Kapital</span>
                <span className="text-base font-black text-emerald-700">
                  {(balanceData.net_equity == null ? 'Ma’lumot yo‘q' : balanceData.net_equity.toLocaleString())} UZS
                </span>
              </div>
            </div>
          </div>

          {/* FINANCIAL RATIOS & INDICATORS */}
          <div className="bg-white rounded-2xl border border-neutral-200 p-5 shadow-xs">
            <h3 className="text-sm font-bold text-neutral-900 mb-4 flex items-center space-x-2">
              <TrendingUp className="w-4 h-4 text-emerald-600" />
              <span>Aniq Moliyaviy Ko'rsatkichlar va Likvidlik Koeffitsientlari</span>
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Working Capital */}
              <div className="p-4 rounded-xl bg-neutral-50 border border-neutral-100">
                <span className="text-[11px] font-semibold text-neutral-500 uppercase">Sof Aylanma Mablag'</span>
                <h4 className="text-lg font-extrabold text-neutral-900 mt-1">
                  {(balanceData.indicators.working_capital == null ? 'Ma’lumot yo‘q' : balanceData.indicators.working_capital.toLocaleString())} <span className="text-xs font-normal text-neutral-400">UZS</span>
                </h4>
                <p className="text-[10px] text-neutral-500 mt-1">Aktivlar minus joriy majburiyatlar</p>
              </div>

              {/* Current Ratio */}
              <div className="p-4 rounded-xl bg-neutral-50 border border-neutral-100">
                <span className="text-[11px] font-semibold text-neutral-500 uppercase">Joriy Likvidlik (Current Ratio)</span>
                <h4 className="text-lg font-extrabold text-indigo-700 mt-1">
                  {balanceData.indicators.current_ratio == null ? "Ma’lumot yo‘q" : balanceData.indicators.current_ratio + "x"}
                </h4>
                <p className="text-[10px] text-neutral-500 mt-1">Ideal ko'rsatkich: &gt; 1.5x (Qarz to'lash qobiliyati)</p>
              </div>

              {/* Cash Ratio */}
              <div className="p-4 rounded-xl bg-neutral-50 border border-neutral-100">
                <span className="text-[11px] font-semibold text-neutral-500 uppercase">Pul Mablag'lari Nisbati (Cash Ratio)</span>
                <h4 className="text-lg font-extrabold text-emerald-700 mt-1">
                  {balanceData.indicators.cash_ratio == null ? "Ma’lumot yo‘q" : balanceData.indicators.cash_ratio + "x"}
                </h4>
                <p className="text-[10px] text-neutral-500 mt-1">Tezkor naqd pul bilan to'lash koeffitsienti</p>
              </div>

              {/* Debt-to-Equity */}
              <div className="p-4 rounded-xl bg-neutral-50 border border-neutral-100">
                <span className="text-[11px] font-semibold text-neutral-500 uppercase">Qarz va Kapital Nisbati (D/E)</span>
                <h4 className="text-lg font-extrabold text-rose-700 mt-1">
                  {balanceData.indicators.debt_to_equity_ratio == null ? "Ma’lumot yo‘q" : balanceData.indicators.debt_to_equity_ratio + "x"}
                </h4>
                <p className="text-[10px] text-neutral-500 mt-1">Tashqi qarzlar ulushi kapitalga nisbatan</p>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
