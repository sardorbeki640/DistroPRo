import React, { useState, useEffect } from 'react';
import { localToday } from '../../utils/date';
import { 
  Wallet, 
  ArrowUpRight, 
  ArrowDownLeft, 
  Users, 
  CircleDot, 
  Receipt, 
  PlusCircle,
  Building2,
  Calendar,
  CheckCircle2,
  ArrowRight,
  TrendingUp,
  AlertTriangle,
  Sparkles,
  RefreshCw,
  Smartphone,
  Send,
  Package,
  Clock,
  ShieldAlert,
  DollarSign,
  X,
  BadgePercent,
  Sliders
} from 'lucide-react';
import { NavView, stockOutLabel } from '../../types.ts';
import { api } from '../../services/api.ts';
import { useDistribution } from '../../hooks/useDistribution.ts';
import { StockoutTable } from '../common/StockoutTable.tsx';
import { DebtReminderModal } from '../common/DebtReminderModal.tsx';
import { ExportButton } from '../common/TableToolbar.tsx';

interface DashboardViewProps {
  stats: any;
  onNavigate: (view: NavView) => void;
  onOpenAIAgent?: () => void;
  onRefresh?: () => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({ 
  stats, 
  onNavigate, 
  onOpenAIAgent,
  onRefresh 
}) => {
  const cashDay = stats?.cashDay;
  const isDayOpen = cashDay?.status === 'OPEN';
  const distribution = useDistribution();

  // Live forecast and stockout metrics
  const [runRateFactor, setRunRateFactor] = useState<number>(1.0);
  const [runRateData, setRunRateData] = useState<any | null>(null);
  const [outOfStockData, setOutOfStockData] = useState<any | null>(null);
  const [aiAnalysis, setAiAnalysis] = useState<any | null>(null);
  const [loadingForecast, setLoadingForecast] = useState<boolean>(false);
  const [forecastError, setForecastError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState<boolean>(false);

  // SMS Modal State
  const [showSmsModal, setShowSmsModal] = useState<boolean>(false);
  const [smsSending, setSmsSending] = useState<boolean>(false);
  const [smsSuccessMessage, setSmsSuccessMessage] = useState<string | null>(null);

  // Debt Reminder modal state for debtor rows
  const [selectedReminderCustomer, setSelectedReminderCustomer] = useState<any | null>(null);
  const [showReminderModal, setShowReminderModal] = useState<boolean>(false);

  const formatUZS = (val: number = 0) => {
    return new Intl.NumberFormat('uz-UZ').format(val) + ' UZS';
  };

  const loadForecastAndAI = async (factor: number = runRateFactor) => {
    setLoadingForecast(true);
    try {
      const [rrRes, outRes, aiRes] = await Promise.allSettled([
        api.getForecastRunRate(factor), api.getOutOfStockLostProfit(), api.getAIAnalysis()
      ]);
      const errors: string[] = [];
      if (rrRes.status === 'fulfilled') setRunRateData(rrRes.value); else errors.push(`Zaxira prognozi: ${rrRes.reason?.message || 'olinmadi'}`);
      if (outRes.status === 'fulfilled') setOutOfStockData(outRes.value); else errors.push(`Tugagan mahsulotlar: ${outRes.reason?.message || 'olinmadi'}`);
      if (aiRes.status === 'fulfilled' && aiRes.value?.analysis) setAiAnalysis(aiRes.value.analysis);
      setForecastError(errors.length ? errors.join('; ') : null);
    } catch (err) {
      console.error('Error fetching dashboard forecast:', err);
      setForecastError((err as Error)?.message || 'Prognoz ma’lumoti olinmadi.');
    } finally {
      setLoadingForecast(false);
    }
  };

  useEffect(() => {
    if (!distribution.loaded) return;
    let current = true;
    setRunRateData(null);
    setOutOfStockData(null);
    setAiAnalysis(null);
    setLoadingForecast(true);
    Promise.allSettled([
      api.getForecastRunRate(runRateFactor), api.getOutOfStockLostProfit(), api.getAIAnalysis()
    ]).then(([rrRes, outRes, aiRes]) => {
      if (!current) return;
      const errors: string[] = [];
      if (rrRes.status === 'fulfilled') setRunRateData(rrRes.value); else errors.push(`Zaxira prognozi: ${rrRes.reason?.message || 'olinmadi'}`);
      if (outRes.status === 'fulfilled') setOutOfStockData(outRes.value); else errors.push(`Tugagan mahsulotlar: ${outRes.reason?.message || 'olinmadi'}`);
      if (aiRes.status === 'fulfilled' && aiRes.value?.analysis) setAiAnalysis(aiRes.value.analysis);
      setForecastError(errors.length ? errors.join('; ') : null);
    }).finally(() => { if (current) setLoadingForecast(false); });
    return () => { current = false; };
  }, [runRateFactor, distribution.loaded, distribution.system?.id]);

  const handleSyncAll = async () => {
    setSyncing(true);
    try {
      await api.syncForecastWarehouse();
      if (onRefresh) onRefresh();
      await loadForecastAndAI(runRateFactor);
    } catch (err) {
      console.error('Sync failed:', err);
    } finally {
      setSyncing(false);
    }
  };

  const handleSendAdminSms = async () => {
    setSmsSending(true);
    setSmsSuccessMessage(null);
    try {
      const res = await api.sendAdminStockAlertSMS();
      // Shown until closed: when no bot takes this message, the text says where to switch it on.
      setSmsSuccessMessage(res.message || 'Ogohlantirish yuborildi.');
    } catch (err: any) {
      setSmsSuccessMessage(`Yuborilmadi: ${err.message || 'xatolik'}`);
    } finally {
      setSmsSending(false);
    }
  };

  // Data references with robust fallbacks
  const inventorySummary = runRateData?.summary || stats?.inventory || null;

  const stockOutItems = outOfStockData?.items || stats?.inventory?.top_out_of_stock || [];
  const totalLostProfit = outOfStockData?.summary?.total_lost_profit_uzs ?? stats?.inventory?.total_lost_profit_uzs ?? null;
  const totalLostSales = outOfStockData?.summary?.total_lost_sales_uzs ?? stats?.inventory?.total_lost_sales_uzs ?? null;

  /** The dashboard figures on two sheets: key indicators and the out-of-stock products. */
  const exportDashboard = async () => {
    const day = cashDay?.date || localToday();
    await api.downloadXlsx(`Dashboard_${day}.xlsx`, [
      {
        name: 'Ko‘rsatkichlar', title: `Asosiy ko‘rsatkichlar — ${day.split('-').reverse().join('.')}`,
        subtitle: [isDayOpen ? 'Kassa kuni ochiq' : 'Kassa kuni yopiq'],
        columns: [{ header: 'Ko‘rsatkich', key: 'name', width: 40 }, { header: 'Qiymat', key: 'value', type: 'money' }, { header: 'Soni / %', key: 'count', type: 'number' }],
        rows: [
          { name: 'Kunlik savdo', value: stats?.dailySales || 0 },
          { name: 'Kassaga kirim', value: stats?.cashInflow || 0 },
          { name: 'Operatsion xarajatlar', value: stats?.operatingExpenses || 0 },
          { name: 'Tranzaksiyalar soni', value: null, count: stats?.activeTransactionsCount ?? null },
          { name: 'Sof foyda', value: stats?.netProfit ?? null },
          { name: 'Sof marja, %', value: null, count: stats?.netMarginPct ?? null },
          { name: 'Kassa qoldig‘i', value: stats?.closingBalance || 0 },
          { name: 'Mijozlar umumiy qarzi', value: stats?.totalCustomerDebt || 0 },
          { name: 'Mijozlar soni', value: null, count: stats?.customersCount ?? null },
          { name: 'Muddati o‘tgan qarzdorlar', value: null, count: stats?.overdueCount ?? null },
          { name: 'Tugagan mahsulotlar', value: null, count: inventorySummary.out_of_stock_count ?? null },
          { name: 'Boy berilgan savdo', value: totalLostSales },
          { name: 'Boy berilgan sof foyda', value: totalLostProfit }
        ]
      },
      {
        name: 'Tugagan mahsulotlar', title: 'Tugagan mahsulotlar va boy berilgan foyda',
        columns: [
          { header: 'Mahsulot', key: 'name', width: 34 }, { header: 'Kategoriya', key: 'category', width: 20 },
          { header: 'Necha kundan beri', key: 'days_out_of_stock', type: 'number' }, { header: 'Kunlik o‘rtacha sotuv', key: 'daily_sales_avg', type: 'number' },
          { header: 'Sotilmagan miqdor', key: 'lost_units', type: 'number', total: true }, { header: 'Boy berilgan foyda', key: 'lost_profit_uzs', type: 'money', total: true }
        ],
        rows: stockOutItems.map((i: any) => ({ ...i })),
        totalsLabel: 'JAMI'
      }
    ]);
  };

  return (
    <div className="space-y-6 pb-12">
      {/* TOP HEADER: Cash Status + Live Auto-Sync + AI Assistant Quick Action */}
      <div className={`flex flex-col lg:flex-row lg:items-center justify-between gap-4 rounded-2xl border p-4 sm:p-5 shadow-xs transition-all ${
        isDayOpen 
          ? 'border-emerald-200 bg-emerald-50/70 text-emerald-950' 
          : 'border-neutral-200 bg-white text-neutral-800'
      }`}>
        <div className="flex items-center gap-3.5">
          <div className={`flex h-11 w-11 items-center justify-center rounded-xl shadow-xs shrink-0 ${
            isDayOpen ? 'bg-emerald-600 text-white' : 'bg-neutral-800 text-white'
          }`}>
            <CircleDot className={`h-5 w-5 ${isDayOpen ? 'animate-pulse' : ''}`} />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-bold tracking-tight">
                {isDayOpen ? 'Kassa Kuni Ochiq' : 'Kassa Kuni Yopiq'}
              </h2>
              <span className="rounded-md bg-white/95 px-2 py-0.5 text-xs font-mono font-bold text-neutral-700 border border-neutral-200">
                {cashDay?.date || localToday()}
              </span>
              {distribution.loaded && (distribution.system ? (
                <span className="inline-flex items-center gap-1 rounded-md bg-emerald-100/90 text-emerald-800 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-ping"></span>
                  {distribution.name} ulangan
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-md bg-amber-100/90 text-amber-800 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide">
                  Distribyutor tizimi ulanmagan
                </span>
              ))}
            </div>
            <p className="text-xs text-neutral-600 mt-0.5">
              {isDayOpen 
                ? `Kassa ochilgan: ${cashDay?.opened_at ? new Date(cashDay.opened_at).toLocaleTimeString().slice(0, 5) : 'Bugun'} | Boshlang'ich qoldiq: ${formatUZS(cashDay?.opening_balance || 0)}`
                : 'Kassa kutilmagan to\'xtashlarsiz ishlashi uchun kassa kunini oching.'}
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          {/* SFA & 1C Auto-Sync button */}
          <button
            onClick={handleSyncAll}
            disabled={syncing}
            className="rounded-xl px-3.5 py-2 text-xs font-bold bg-white border border-neutral-300 hover:bg-neutral-50 text-neutral-800 shadow-2xs cursor-pointer flex items-center gap-1.5 transition"
            title="Ulangan distribyutor tizimidan ma'lumotlarni yangilash"
          >
            <RefreshCw className={`h-3.5 w-3.5 text-indigo-600 ${syncing ? 'animate-spin' : ''}`} />
            <span>{syncing ? 'Sinxronlanmoqda...' : 'Avto-Sinxronlash'}</span>
          </button>

          {/* Admin SMS Alert Button */}
          <button
            onClick={() => setShowSmsModal(true)}
            className="rounded-xl px-3.5 py-2 text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white shadow-2xs cursor-pointer flex items-center gap-1.5 transition"
            title="Tugagan tovarlar bo'yicha Telegram botlarga ogohlantirish"
          >
            <Smartphone className="h-3.5 w-3.5" />
            <span>Telegram ogohlantirish</span>
          </button>

          {/* AI Agent Button */}
          <button
            onClick={onOpenAIAgent}
            className="rounded-xl px-3.5 py-2 text-xs font-bold bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white shadow-2xs cursor-pointer flex items-center gap-1.5 transition"
          >
            <Sparkles className="h-3.5 w-3.5 animate-pulse text-amber-300" />
            <span>AI Maslahatchi</span>
          </button>

          {/* Full Forecast module jump */}
          <button
            onClick={() => onNavigate('forecast')}
            className="rounded-xl px-3.5 py-2 text-xs font-bold bg-neutral-900 hover:bg-neutral-800 text-white shadow-2xs cursor-pointer flex items-center gap-1.5 transition"
          >
            <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />
            <span>Prognoz Bo'limi</span>
          </button>

          <ExportButton onExport={exportDashboard} />
        </div>
      </div>

      {/* 4 CORE REAL FINANCIAL METRICS (Savdo, Kirim, Rasxodlar, Sof Foyda) */}
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
        {/* Metric 1: Kunlik Savdo */}
        <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-2xs relative overflow-hidden group hover:border-indigo-300 transition">
          <div className="flex items-center justify-between text-neutral-500">
            <span className="text-[11px] font-bold uppercase tracking-wider text-neutral-600">Kunlik Savdo</span>
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
              <Package className="h-4 w-4" />
            </div>
          </div>
          <p className="mt-2 text-xl font-black tracking-tight text-neutral-900">
            {formatUZS(stats?.dailySales || 0)}
          </p>
          <div className="mt-1 flex flex-col gap-0.5 text-[11px] text-neutral-500">
            <span>Yetkazilgan savdo</span>
            {(stats?.pendingSales || 0) > 0 && (
              <span className="font-medium text-amber-700">Kutilayotgan buyurtmalar (hisobga olinmagan): {formatUZS(stats.pendingSales)}</span>
            )}
          </div>
        </div>

        {/* Metric 2: Kunlik Kirim (Inflow) */}
        <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-2xs relative overflow-hidden group hover:border-emerald-300 transition">
          <div className="flex items-center justify-between text-neutral-500">
            <span className="text-[11px] font-bold uppercase tracking-wider text-neutral-600">Kassaga Kirim</span>
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
              <ArrowDownLeft className="h-4 w-4" />
            </div>
          </div>
          <p className="mt-2 text-xl font-black tracking-tight text-emerald-600">
            +{formatUZS(stats?.cashInflow || 0)}
          </p>
          <div className="mt-1 flex items-center justify-between text-[11px] text-neutral-500">
            <span>Tushumlar va qarz yig'ish</span>
            <span className="font-semibold text-emerald-700">Naqd & Bank</span>
          </div>
        </div>

        {/* Metric 3: Kunlik Chiqim ya'ni Rasxodlar */}
        <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-2xs relative overflow-hidden group hover:border-rose-300 transition">
          <div className="flex items-center justify-between text-neutral-500">
            <span className="text-[11px] font-bold uppercase tracking-wider text-neutral-600">Chiqim / Rasxodlar</span>
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-rose-50 text-rose-600">
              <ArrowUpRight className="h-4 w-4" />
            </div>
          </div>
          <p className="mt-2 text-xl font-black tracking-tight text-rose-600">
            {stats?.operatingExpenses ? '-' : ''}{formatUZS(stats?.operatingExpenses || 0)}
          </p>
          <div className="mt-1 flex items-center justify-between text-[11px] text-neutral-500">
            <span>Tasdiqlangan xarajatlar</span>
            <span className="font-semibold text-neutral-700">{stats?.activeTransactionsCount || 0} ta amal</span>
          </div>
        </div>

        {/* Metric 4: SOF FOYDA (Net Profit) */}
        <div className="rounded-2xl border border-emerald-300 bg-gradient-to-br from-emerald-500 to-teal-700 text-white p-4 shadow-xs relative overflow-hidden">
          <div className="flex items-center justify-between text-emerald-100">
            <span className="text-[11px] font-bold uppercase tracking-wider">Kunlik Sof Foyda</span>
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/20 text-white backdrop-blur-xs">
              <DollarSign className="h-4 w-4" />
            </div>
          </div>
          <p className="mt-2 text-2xl font-black tracking-tight text-white">
            {stats?.netProfit === null || stats?.netProfit === undefined ? 'Hisoblanmadi' : formatUZS(stats.netProfit)}
          </p>
          <div className="mt-1 flex items-center justify-between text-[11px] text-emerald-100">
            <span>{stats?.netProfit === null ? 'Tannarx noma’lum — Mahsulotlarda kirim narxini kiriting' : 'Savdo - Tan Narx - Rasxod'}</span>
            <span className="rounded-full bg-white/20 px-2 py-0.5 font-bold text-white text-[10px]">
              {stats?.netMarginPct === null || stats?.netMarginPct === undefined ? '—' : `${stats.netMarginPct}% Rentabellik`}
            </span>
          </div>
        </div>
      </div>

      {/* SECONDARY LIQUIDITY & DEBT BANNER */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
        <div className="flex items-center justify-between p-4 rounded-2xl border border-neutral-200 bg-white shadow-2xs">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-amber-50 text-amber-700">
              <Wallet className="h-5 w-5" />
            </div>
            <div>
              <span className="text-xs text-neutral-500 font-medium">Kassadagi Amaldagi Naqd Qoldiq</span>
              <p className="text-lg font-black text-neutral-900 leading-tight">
                {formatUZS(stats?.closingBalance || cashDay?.opening_balance || 0)}
              </p>
            </div>
          </div>
          <button
            onClick={() => onNavigate('cash')}
            className="text-xs font-bold text-amber-800 hover:text-amber-900 bg-amber-50 hover:bg-amber-100 px-3 py-1.5 rounded-xl transition cursor-pointer"
          >
            Kassa Reestri
          </button>
        </div>

        <div className="flex items-center justify-between p-4 rounded-2xl border border-neutral-200 bg-white shadow-2xs">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-blue-50 text-blue-700">
              <Users className="h-5 w-5" />
            </div>
            <div>
              <span className="text-xs text-neutral-500 font-medium">Jami Nasiyalar (Mijozlar Qarzdorligi)</span>
              <p className="text-lg font-black text-blue-700 leading-tight">
                {formatUZS(stats?.totalCustomerDebt || 0)}
              </p>
            </div>
          </div>
          <button
            onClick={() => onNavigate('customers')}
            className="text-xs font-bold text-blue-700 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-xl transition cursor-pointer"
          >
            Qattiq Nazorat & Sverka
          </button>
        </div>
      </div>

      {/* SECTION 1: INTEGRATSIYALASHGAN DASTUR OMBOR HOLATI & RUNWAY (Qoldiq Necha Kunga Yetishi) */}
      <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-2xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-neutral-100 pb-3">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 bg-indigo-50 text-indigo-700 rounded-xl">
              <TrendingUp className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-neutral-900">
                Integratsiyalashgan Ombor Holati & Qoldiq Necha Kunga Yetishi
              </h3>
              <p className="text-xs text-neutral-500">
                Ulangan tizimdan olingan tovarlar va joriy sotuv sur'atiga qarab qoldiq hisob-kitobi
              </p>
            </div>
          </div>

          {/* Interactive Daily Sales Factor Selector */}
          <div className="flex items-center gap-1.5 bg-neutral-100 p-1 rounded-xl">
            <span className="text-[11px] font-bold text-neutral-500 px-2 flex items-center gap-1">
              <Sliders className="h-3 w-3" />
              <span>Savdo sur'ati:</span>
            </span>
            {[
              { factor: 0.8, label: '0.8x Tinch' },
              { factor: 1.0, label: '1.0x O\'rtacha' },
              { factor: 1.25, label: '1.25x Faol' },
              { factor: 1.5, label: '1.5x Qizg\'in' },
              { factor: 2.0, label: '2.0x Mavsumiy' }
            ].map(f => (
              <button
                key={f.factor}
                onClick={() => setRunRateFactor(f.factor)}
                className={`px-2 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                  runRateFactor === f.factor
                    ? 'bg-white text-indigo-700 shadow-2xs border border-neutral-200'
                    : 'text-neutral-600 hover:text-neutral-900'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Visual Runway Metrics */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <div className="p-3.5 rounded-xl bg-neutral-50 border border-neutral-200 text-center">
            <span className="text-[11px] text-neutral-500 block font-medium">O'rtacha Qoldiq Muddati</span>
            <p className="text-2xl font-black text-indigo-700 mt-1">
              {inventorySummary?.avg_days_remaining ?? '—'} <span className="text-sm font-bold">{inventorySummary ? 'kun' : ''}</span>
            </p>
            <span className="text-[10px] text-neutral-500">Joriy tezlikda yetishi</span>
          </div>

          <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-center">
            <span className="text-[11px] text-rose-700 block font-bold">🔴 Tugagan (0 kun)</span>
            <p className="text-2xl font-black text-rose-700 mt-1">
              {inventorySummary?.out_of_stock_count ?? '—'} <span className="text-sm font-bold">{inventorySummary ? 'ta tovar' : ''}</span>
            </p>
            <span className="text-[10px] text-rose-600">Zudlik bilan zakaz zarur</span>
          </div>

          <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-center">
            <span className="text-[11px] text-amber-800 block font-bold">🟠 Kritik (≤3 kun)</span>
            <p className="text-2xl font-black text-amber-700 mt-1">
              {inventorySummary?.critical_count ?? '—'} <span className="text-sm font-bold">{inventorySummary ? 'ta tovar' : ''}</span>
            </p>
            <span className="text-[10px] text-amber-600">1-3 kunda tugaydi</span>
          </div>

          <div className="p-3.5 rounded-xl bg-yellow-50 border border-yellow-200 text-center">
            <span className="text-[11px] text-yellow-800 block font-bold">🟡 Kam qoldiq (4-7 kun)</span>
            <p className="text-2xl font-black text-yellow-700 mt-1">
              {inventorySummary?.low_count ?? '—'} <span className="text-sm font-bold">{inventorySummary ? 'ta tovar' : ''}</span>
            </p>
            <span className="text-[10px] text-yellow-600">Zaxirani to'ldirish kerak</span>
          </div>

          <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-center">
            <span className="text-[11px] text-emerald-800 block font-bold">🟢 Yetarli / Barqaror</span>
            <p className="text-2xl font-black text-emerald-700 mt-1">
              {inventorySummary?.in_stock_count ?? '—'} <span className="text-sm font-bold">{inventorySummary ? 'ta tovar' : ''}</span>
            </p>
            <span className="text-[10px] text-emerald-600">Xavfsiz darajada</span>
          </div>
        </div>
      </div>

      {/* SECTION 2: TUGAGAN MAHSULOTLAR & BOY BERILGAN SOF FOYDA (SODDA LEKIN ANIQ!) */}
      <div className="rounded-2xl border-2 border-rose-300 bg-white p-5 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-rose-100 pb-3">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-rose-600 text-white rounded-xl shadow-xs">
              <ShieldAlert className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-black text-rose-900">
                  Tugagan Mahsulotlar va Boy Berilgan Sof Foyda Tahlili
                </h3>
                <span className="px-2 py-0.5 rounded-md bg-rose-100 text-rose-800 text-[10px] font-black uppercase">
                  Diqqat Talab Qiladi
                </span>
              </div>
              <p className="text-xs text-rose-700 mt-0.5">
                0 qoldiq sanasi va avvalgi sotuv tezligiga asoslangan taxminiy talab hamda foyda tahlili
              </p>
            </div>
          </div>

          <button
            onClick={() => setShowSmsModal(true)}
            className="rounded-xl px-4 py-2.5 text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white shadow-2xs flex items-center gap-1.5 cursor-pointer shrink-0 transition"
          >
            <Smartphone className="h-4 w-4" />
            <span>Telegram ogohlantirish yuborish</span>
          </button>
        </div>

        {/* Highlights: Jami boy berilgan foyda va savdo */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          <div className="p-4 rounded-xl bg-rose-50 border border-rose-200">
            <span className="text-xs font-bold uppercase tracking-wider text-rose-800">
              Jami Boy Berilgan Sof Foyda:
            </span>
            <p className="text-2xl font-black text-rose-700 mt-1">
              {outOfStockData?.summary?.profit_unknown_count ? 'Hisoblanmadi' : totalLostProfit === null ? '—' : formatUZS(totalLostProfit)}
            </p>
            <p className="text-xs text-rose-600 mt-1">
              {outOfStockData?.summary?.profit_unknown_count
                ? `${outOfStockData.summary.profit_unknown_count} ta tovarning kirim narxi yo‘q (ulangan tizimda kirim narxi kiritilmagan yoki 1 so‘m) — narx kiritilgach hisoblanadi.`
                : 'Taxminiy hisob: nol qoldiq davrida avvalgi o‘rtacha sotuv davom etadi deb olinadi. Bu tasdiqlangan buyurtma yoki real yo‘qotish emas.'}
            </p>
          </div>

          <div className="p-4 rounded-xl bg-neutral-50 border border-neutral-200">
            <span className="text-xs font-bold uppercase tracking-wider text-neutral-600">
              Boy Berilgan Yalpi Savdo Tushumi:
            </span>
            <p className="text-2xl font-black text-neutral-900 mt-1">
              {totalLostSales === null ? '—' : formatUZS(totalLostSales)}
            </p>
            <p className="text-xs text-neutral-600 mt-1">
              Avvalgi sotuv sur’atidan hisoblangan taxminiy tushum; amalga oshmagan buyurtmalarning bevosita summasi emas.
            </p>
          </div>
        </div>

        {/* Per-product lost sales and profit: filters, sorting, totals and Excel */}
        <StockoutTable items={stockOutItems} loading={loadingForecast} error={forecastError} />
      </div>

      {/* SECTION 3: QAT'IY NASIYA NAZORATI & KREDIT LIMITLARI */}
      <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-2xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-neutral-100 pb-3">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 bg-blue-50 text-blue-700 rounded-xl">
              <Users className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-neutral-900">
                Qat'iy Nasiya Nazorati & Muddati O'tgan Qarzdorlar
              </h3>
              <p className="text-xs text-neutral-500">
                Mijozlar limiti, to'lov muddatlari va avtomatlashtirilgan SMS qarzdorlik eslatmalari
              </p>
            </div>
          </div>

          <button
            onClick={() => onNavigate('customers')}
            className="text-xs font-bold text-blue-700 hover:text-blue-800 flex items-center gap-1 cursor-pointer"
          >
            <span>Mijozlar bo'limi va Akt Sverka</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <div className="p-3 rounded-xl bg-neutral-50 border border-neutral-200">
            <span className="text-neutral-500 font-medium">Jami Nasiya Balansi:</span>
            <p className="text-lg font-black text-neutral-900 mt-0.5">
              {formatUZS(stats?.totalCustomerDebt || 0)}
            </p>
            <span className="text-[10px] text-neutral-500">{stats?.customersCount || 0} ta faol mijoz</span>
          </div>

          <div className="p-3 rounded-xl bg-amber-50 border border-amber-200">
            <span className="text-amber-800 font-bold">Kredit Limitidan Oshganlar:</span>
            <p className="text-lg font-black text-amber-700 mt-0.5">
              {stats?.overdueCount || 0} ta do'kon
            </p>
            <span className="text-[10px] text-amber-700">Yangi yuk berish to'xtatiladi</span>
          </div>

          <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200">
            <span className="text-emerald-800 font-bold">Qarz Undirish Rejimi:</span>
            <p className="text-lg font-black text-emerald-700 mt-0.5">
              Faol (SMS & Sverka)
            </p>
            <span className="text-[10px] text-emerald-700">Akt Sverka tayyor</span>
          </div>
        </div>
      </div>

      {/* SECTION 4: GEMINI AI BOSHQARUV TAHLILI VA TAVSIYALARI */}
      {aiAnalysis && (
        <div className="rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-50/70 to-purple-50/70 p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-indigo-100 pb-3">
            <div className="flex items-center space-x-2.5">
              <div className="p-2 bg-gradient-to-br from-indigo-600 to-purple-600 text-white rounded-xl shadow-xs">
                <Sparkles className="h-5 w-5 animate-pulse text-amber-300" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-neutral-900">
                    {aiAnalysis.is_live_ai ? `AI tahlili (${aiAnalysis.model})` : 'Mahalliy hisob-kitob (AI ulanmagan)'}
                  </h3>
                  <span className="px-2 py-0.5 rounded-md bg-indigo-100 text-indigo-800 text-[10px] font-extrabold font-mono">
                    {aiAnalysis.is_live_ai ? 'AI javobi' : 'Qoidalar asosida'}
                  </span>
                </div>
                <p className="text-xs text-neutral-500">
                  Integratsiyalangan kassa, ombor va nasiyalar tahlilidan kelib chiqqan xulosalar
                </p>
              </div>
            </div>

            <button
              onClick={onOpenAIAgent}
              className="text-xs font-bold text-indigo-700 hover:text-indigo-900 bg-white border border-indigo-200 px-3 py-1.5 rounded-xl shadow-2xs flex items-center gap-1.5 cursor-pointer transition"
            >
              <Sparkles className="h-3.5 w-3.5 text-indigo-600" />
              <span>AI Agentga Savol Berish</span>
            </button>
          </div>

          <div className="p-4 rounded-xl bg-white border border-indigo-100 text-xs text-neutral-800 leading-relaxed font-medium">
            <p className="text-sm font-bold text-indigo-950 mb-1">Xulosa:</p>
            {aiAnalysis.executive_summary}
          </div>

          {/* AI Findings Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {(aiAnalysis.key_findings || []).map((finding: any, idx: number) => {
              const isCrit = finding.severity === 'CRITICAL';
              const isWarn = finding.severity === 'WARNING';
              return (
                <div
                  key={idx}
                  className={`p-3.5 rounded-xl border text-xs ${
                    isCrit 
                      ? 'bg-rose-50 border-rose-200 text-rose-900' 
                      : isWarn 
                        ? 'bg-amber-50 border-amber-200 text-amber-900' 
                        : 'bg-emerald-50 border-emerald-200 text-emerald-900'
                  }`}
                >
                  <span className="font-bold block text-[11px] uppercase tracking-wide mb-1">
                    {finding.title}
                  </span>
                  <p className="text-neutral-700 text-[11px] leading-relaxed">
                    {finding.description}
                  </p>
                </div>
              );
            })}
          </div>

          {/* Recommendations List */}
          {aiAnalysis.actionable_recommendations && (
            <div className="p-3.5 rounded-xl bg-white/90 border border-indigo-100">
              <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-900 block mb-2">
                Amaliy Tavsiyalar:
              </span>
              <ul className="space-y-1.5 text-xs text-neutral-700">
                {aiAnalysis.actionable_recommendations.map((rec: string, i: number) => (
                  <li key={i} className="flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                    <span>{rec}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* ADMIN SMS DISPATCH MODAL */}
      {showSmsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl border border-neutral-200 space-y-4">
            <div className="flex items-center justify-between border-b border-neutral-100 pb-3">
              <div className="flex items-center space-x-2">
                <Smartphone className="h-5 w-5 text-rose-600" />
                <h3 className="text-base font-bold text-neutral-900">
                  Tugagan tovarlar — Telegram ogohlantirish
                </h3>
              </div>
              <button
                onClick={() => setShowSmsModal(false)}
                className="text-neutral-400 hover:text-neutral-600 cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <p className="text-neutral-600">Xabar “Tovar tugashi” turini oladigan Telegram botlarga yuboriladi (Sozlamalar → Botlar). SMS xizmati ulanmagan.</p>
              <div>
                <label className="block text-neutral-600 font-bold mb-1">Xabar matni:</label>
                <div className="rounded-xl bg-neutral-50 p-3 border border-neutral-200 text-neutral-800 font-mono text-[11px] leading-relaxed whitespace-pre-line max-h-48 overflow-y-auto">
                  {`Omborda ${inventorySummary.out_of_stock_count} ta tovar tugagan.\n` +
                   [...stockOutItems].sort((a: any, b: any) => b.lost_sales_uzs - a.lost_sales_uzs).slice(0, 5).map((it: any) => `• ${it.name}: ${stockOutLabel(it)}, taxminiy boy berilgan savdo ${formatUZS(it.lost_sales_uzs)}`).join('\n') +
                   `\n\nBoy berilgan foyda: ${outOfStockData?.summary?.profit_unknown_count ? `hisoblanmadi (${outOfStockData.summary.profit_unknown_count} ta tovarda kirim narxi yo‘q)` : formatUZS(totalLostProfit)}.\n` +
                   `Ta’minotchiga buyurtma bering.`}
                </div>
              </div>

              {smsSuccessMessage && (
                <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  <span>{smsSuccessMessage}</span>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                onClick={() => setShowSmsModal(false)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-neutral-600 hover:bg-neutral-100 transition cursor-pointer"
              >
                Bekor qilish
              </button>
              <button
                onClick={handleSendAdminSms}
                disabled={smsSending}
                className="px-5 py-2.5 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white shadow-xs flex items-center gap-1.5 transition cursor-pointer"
              >
                <Send className="h-3.5 w-3.5" />
                <span>{smsSending ? 'Yuborilmoqda...' : 'Telegram’ga yuborish'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Customer Debt Reminder Modal */}
      {showReminderModal && selectedReminderCustomer && (
        <DebtReminderModal
          isOpen={showReminderModal}
          onClose={() => {
            setShowReminderModal(false);
            setSelectedReminderCustomer(null);
          }}
          customer={selectedReminderCustomer}
        />
      )}
    </div>
  );
};
