import React, { useState, useEffect } from 'react';
import { 
  TrendingUp, 
  AlertTriangle, 
  CheckCircle2, 
  Clock, 
  Send, 
  RefreshCw, 
  Package, 
  Sparkles, 
  DollarSign, 
  Calendar, 
  Layers, 
  Phone, 
  Search, 
  ArrowUpRight, 
  ShieldAlert,
  Zap,
  BarChart2,
  Check,
  ChevronRight,
  Sliders,
  BellRing
} from 'lucide-react';
import { api } from '../../services/api.ts';
import { ExportButton, exportTableXlsx } from '../common/TableToolbar.tsx';
import { useDistribution } from '../../hooks/useDistribution.ts';
import { MultiSelect, isPicked, pickedLabels } from '../common/MultiSelect.tsx';
import { StockoutTable } from '../common/StockoutTable.tsx';
import { 
  StockRunRateResponse, 
  OutOfStockResponse, 
  AIAnalysisResult,
  AuthUser,
  stockOutLabel
} from '../../types.ts';

interface ForecastViewProps {
  user: AuthUser | null;
  onNavigateToProducts?: () => void;
}

export const ForecastView: React.FC<ForecastViewProps> = ({ user, onNavigateToProducts }) => {
  const { name: systemName } = useDistribution();
  const [runRateFactor, setRunRateFactor] = useState<number>(1.0);
  const [runRateData, setRunRateData] = useState<StockRunRateResponse | null>(null);
  const [outOfStockData, setOutOfStockData] = useState<OutOfStockResponse | null>(null);
  const [aiAnalysis, setAiAnalysis] = useState<AIAnalysisResult | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [syncing, setSyncing] = useState<boolean>(false);
  const [syncNote, setSyncNote] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState<boolean>(false);
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<string>('');

  // SMS Modal State
  const [showSmsModal, setShowSmsModal] = useState<boolean>(false);
  const [smsSending, setSmsSending] = useState<boolean>(false);
  const [smsSuccess, setSmsSuccess] = useState<any | null>(null);

  const formatUZS = (val: number = 0) => {
    return new Intl.NumberFormat('uz-UZ').format(val) + ' UZS';
  };

  const loadData = async (factor: number = runRateFactor) => {
    setLoading(true);
    try {
      const [rrRes, outRes] = await Promise.all([
        api.getForecastRunRate(factor),
        api.getOutOfStockLostProfit()
      ]);
      setRunRateData(rrRes);
      setOutOfStockData(outRes);
    } catch (err) {
      console.error('Failed to load forecast data:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadAIAnalysis = async () => {
    setAiLoading(true);
    try {
      const res = await api.getAIAnalysis();
      setAiAnalysis(res.analysis);
    } catch (err) {
      console.error('Failed to load AI analysis:', err);
    } finally {
      setAiLoading(false);
    }
  };

  useEffect(() => {
    loadData(runRateFactor);
    loadAIAnalysis();
  }, [runRateFactor]);

  const handleSyncWarehouse = async () => {
    setSyncing(true);
    try {
      // The server picks the connected distribution system (whichever is connected); stock and recent orders refresh in the background.
      const res = await api.syncForecastWarehouse();
      setSyncNote(res.message || null);
      if (res.runRate) setRunRateData(res.runRate);
      if (res.outOfStock) setOutOfStockData(res.outOfStock);
      // Re-trigger AI analysis on fresh sync
      await loadAIAnalysis();
    } catch (err: any) {
      setSyncNote(err.message || 'Yangilanmadi');
    } finally {
      setSyncing(false);
    }
  };

  const handleSendAdminSms = async () => {
    setSmsSending(true);
    setSmsSuccess(null);
    try {
      const res = await api.sendAdminStockAlertSMS();
      setSmsSuccess(res);
    } catch (err: any) {
      setSmsSuccess({ sent: false, message: `Yuborilmadi: ${err.message || 'xatolik'}` });
    } finally {
      setSmsSending(false);
    }
  };

  const forecastCategories = Array.from(new Set((runRateData?.items || []).map(i => i.category).filter(Boolean))).sort();
  const filteredItems = (runRateData?.items || []).filter(item => {
    const matchesSearch = item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          item.sku.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          item.category.toLowerCase().includes(searchTerm.toLowerCase());
    if (!matchesSearch) return false;
    if (!isPicked(categoryFilter, item.category)) return false;
    if (statusFilter === 'ALL') return true;
    return item.status === statusFilter;
  });

  const statusLabels: Record<string, string> = { OUT_OF_STOCK: 'Tugagan', CRITICAL: 'Kritik (≤3 kun)', LOW: 'Kam (≤7 kun)', OPTIMAL: 'Yetarli', OVERSTOCKED: 'Ortiqcha zaxira' };
  const confidenceLabels: Record<string, string> = { HIGH: 'Yuqori', MEDIUM: 'O‘rta', LOW: 'Past' };

  const exportRunRate = () => exportTableXlsx({
    fileName: 'Zaxira_prognozi',
    title: `Zaxira prognozi (sur'at ${runRateFactor}x)`,
    columns: [
      { header: 'Mahsulot', key: 'name', width: 34 },
      { header: 'SKU', key: 'sku', width: 12 },
      { header: 'Kategoriya', key: 'category', width: 20 },
      { header: 'Qoldiq', key: 'stock_quantity', type: 'number', total: true },
      { header: 'Birlik', key: 'unit', width: 8 },
      { header: 'Kunlik savdo', key: 'effective_daily_sales', type: 'number' },
      { header: 'Ishonchlilik', key: 'confidence_label', width: 12 },
      { header: 'Necha kunga yetadi', key: 'days_remaining', type: 'number' },
      { header: 'Holati', key: 'status_label', width: 16 },
      { header: 'Tavsiya zakaz (30 kun)', key: 'reorder_quantity', type: 'number', total: true },
      { header: 'Zakaz byudjeti', key: 'reorder_cost', type: 'money', total: true }
    ],
    rows: filteredItems.map((i: any) => ({
      ...i,
      effective_daily_sales: Number((i.effective_daily_sales || 0).toFixed(3)),
      days_remaining: i.days_remaining > 900 ? null : i.days_remaining,
      confidence_label: confidenceLabels[i.confidence] || 'Ma’lumot yo‘q',
      status_label: statusLabels[i.status] || i.status
    })),
    filters: [
      statusFilter !== 'ALL' && statusLabels[statusFilter],
      categoryFilter && `kategoriya: ${pickedLabels(categoryFilter)}`,
      searchTerm && `qidiruv: "${searchTerm}"`
    ]
  });

  return (
    <div className="space-y-6 pb-12">
      {syncNote && <div className="rounded-xl border p-3 bg-white text-xs">{syncNote}</div>}
      {runRateData?.history && <div className={`rounded-xl border p-4 text-sm ${runRateData.history.covered && runRateData.history.history_from ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-300'}`}>
        <strong>{runRateData.history.window_from} — {runRateData.history.window_to} ({runRateData.history.days} kunlik davr) · ma'lumot bor: {runRateData.history.covered_days} kun · {runRateData.history.orders} ta buyurtma</strong>
        <p>{runRateData.history.warning}</p><p>Oxirgi yuklash: {runRateData.history.synced_at ? new Date(runRateData.history.synced_at).toLocaleString() : 'Yuklanmagan'}</p>
      </div>}
      {/* Top Banner / Hero Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-neutral-200 shadow-xs">
        <div className="flex items-center space-x-3.5">
          <div className="p-3 bg-gradient-to-br from-indigo-500 to-violet-600 text-white rounded-2xl shadow-sm">
            <TrendingUp className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-neutral-900">
                Ombor Qoldiqlari va Zaxira Prognozi (Run-Rate)
              </h1>
              <span className="px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 text-[10px] font-extrabold uppercase tracking-wide">
                {systemName} tarixi asosida
              </span>
            </div>
            <p className="text-xs text-neutral-500 mt-0.5">
              Istalgan kunlik savdo sur'atiga qarab qoldiq necha kunga yetishi, tugagan mahsulotlar va boy berilgan foyda tahlili
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* SFA / 1C Instant Sync Button */}
          <button
            onClick={handleSyncWarehouse}
            disabled={syncing}
            className="inline-flex items-center px-3.5 py-2 text-xs font-semibold text-neutral-800 bg-neutral-100 hover:bg-neutral-200 border border-neutral-200 rounded-xl transition cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 text-neutral-600 ${syncing ? 'animate-spin' : ''}`} />
            <span>{syncing ? 'Yangilanmoqda...' : `${systemName}dan yangilash`}</span>
          </button>

          {/* SMS Alert Dispatch Button */}
          <button
            onClick={() => {
              setSmsSuccess(null);
              setShowSmsModal(true);
            }}
            className="inline-flex items-center px-4 py-2 text-xs font-semibold text-white bg-gradient-to-r from-rose-600 to-rose-700 hover:from-rose-700 hover:to-rose-800 rounded-xl transition shadow-xs cursor-pointer"
          >
            <BellRing className="w-3.5 h-3.5 mr-1.5 animate-bounce" />
            <span>Telegram ogohlantirish</span>
          </button>
        </div>
      </div>

      {/* 4 Core Forecast KPI Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Metric 1: Tugagan Mahsulotlar */}
        <div className="rounded-2xl border-2 border-rose-200 bg-gradient-to-br from-rose-50/70 via-white to-rose-50/30 p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-black uppercase tracking-wider text-rose-800">
              Tugagan Mahsulotlar
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-rose-100 text-rose-700">
              <AlertTriangle className="h-4 w-4" />
            </div>
          </div>
          <p className="mt-2 text-2xl font-black text-rose-950">
            {outOfStockData?.summary?.out_of_stock_count ?? 0} <span className="text-xs font-bold text-rose-700">ta tovar</span>
          </p>
          <p className="mt-1 text-[11px] font-medium text-rose-700">
            Zudlik bilan zakaz berilishi shart
          </p>
        </div>

        {/* Metric 2: Lost sales (always known from sales history and prices) and lost profit (needs real purchase costs) */}
        <div className="rounded-2xl border-2 border-amber-300 bg-gradient-to-br from-amber-50 via-white to-amber-50/30 p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-black uppercase tracking-wider text-amber-900">
              Boy Berilgan Savdo
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-100 text-amber-800">
              <DollarSign className="h-4 w-4" />
            </div>
          </div>
          <p className="mt-2 text-2xl font-black text-amber-950">
            {formatUZS(Math.round(outOfStockData?.summary?.total_lost_sales_uzs ?? 0))}
          </p>
          <p className="text-[11px] text-amber-800">Tovar bo‘lganda sotilishi mumkin edi (so‘nggi {outOfStockData?.summary?.window_days ?? 100} kun ichida)</p>
          <p className="mt-1 text-[11px] font-semibold text-amber-900">
            Sof foyda: {outOfStockData?.summary?.profit_unknown_count
              ? <>hisoblanmadi — {outOfStockData.summary.profit_unknown_count} ta tovarning kirim narxi yo‘q ({systemName}da kirim narxi kiritilmagan yoki 1 so‘m){outOfStockData.summary.total_lost_profit_uzs ? `; ma’lumi: ${formatUZS(Math.round(outOfStockData.summary.total_lost_profit_uzs))}` : ''}</>
              : formatUZS(Math.round(outOfStockData?.summary?.total_lost_profit_uzs ?? 0))}
          </p>
        </div>

        {/* Metric 3: O'rtacha Qoldiq Necha Kunga Yetishi */}
        <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-black uppercase tracking-wider text-neutral-600">
              O'rtacha Qoldiq Kunlari
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
              <Clock className="h-4 w-4" />
            </div>
          </div>
          <p className="mt-2 text-2xl font-black text-neutral-900">
            {runRateData?.summary?.avg_days_remaining ?? 0} <span className="text-xs font-bold text-neutral-500">kunga</span>
          </p>
          <div className="mt-1 flex items-center justify-between text-[11px] text-neutral-500 font-medium">
            <span>Kritik (≤3 kun): <strong className="text-rose-600">{runRateData?.summary?.critical_count ?? 0} ta</strong></span>
            <span>Kam (≤7 kun): <strong className="text-amber-600">{runRateData?.summary?.low_count ?? 0} ta</strong></span>
          </div>
        </div>

        {/* Metric 4: 30 Kunlik To'ldirish Byudjeti */}
        <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-black uppercase tracking-wider text-neutral-600">
              30 Kunlik Zaxira Byudjeti
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
              <Package className="h-4 w-4" />
            </div>
          </div>
          <p className="mt-2 text-2xl font-black text-emerald-950">
            {formatUZS(runRateData?.summary?.total_reorder_cost_uzs ?? 0)}
          </p>
          <p className="mt-1 text-[11px] font-medium text-emerald-700">
            Ombordagi jami tovar qiymati: {formatUZS(runRateData?.summary?.total_stock_value_uzs ?? 0)}
          </p>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* SECTION 1: TUGAGAN MAHSULOTLAR VA BOY BERILGAN FOYDA JADVALI             */}
      {/* ========================================================================= */}
      <div className="rounded-2xl border border-rose-200 bg-white p-5 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-rose-100 pb-3">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 bg-rose-100 text-rose-700 rounded-xl">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-base font-bold text-neutral-900">
                  Tugagan Mahsulotlar & Boy Berilgan Foyda Nazorati
                </h2>
                <span className="px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 text-[10px] font-extrabold">
                  {outOfStockData?.summary?.out_of_stock_count ?? 0} TA TUGAGAN
                </span>
              </div>
              <p className="text-xs text-neutral-500">
                Necha kundan beri tugaganligi, shu kunlar ichida qancha sotilishi mumkin bo'lgani va yo'qotilgan sof foyda
              </p>
            </div>
          </div>

          <button
            onClick={() => {
              setSmsSuccess(null);
              setShowSmsModal(true);
            }}
            className="inline-flex items-center space-x-1.5 px-3.5 py-1.5 rounded-xl bg-rose-50 text-rose-800 border border-rose-200 hover:bg-rose-100 text-xs font-bold transition cursor-pointer"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Telegram ogohlantirish yuborish</span>
          </button>
        </div>

        {/* Stockout table: filters, sorting, totals and Excel */}
        <StockoutTable items={outOfStockData?.items || []} />
      </div>

      {/* ========================================================================= */}
      {/* SECTION 2: AI EXECUTIVE AUDIT & ADVISOR CARD                              */}
      {/* ========================================================================= */}
      {aiAnalysis && (
        <div className="rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-50/50 via-white to-violet-50/30 p-5 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-indigo-100 pb-3">
            <div className="flex items-center space-x-2.5">
              <div className="p-2 bg-indigo-600 text-white rounded-xl shadow-xs">
                <Sparkles className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center space-x-2">
                  <h2 className="text-base font-bold text-neutral-900">
                    AI Zaxira va Moliya Analitigi Xulosasi
                  </h2>
                  <span className="px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-900 text-[10px] font-mono font-bold">
                    {aiAnalysis.model}
                  </span>
                </div>
                <p className="text-xs text-neutral-500">
                  Haqiqiy integratsiyalashgan ombor va sotuv ma'lumotlari asosida sun'iy intellekt tavsiyalari
                </p>
              </div>
            </div>

            <button
              onClick={loadAIAnalysis}
              disabled={aiLoading}
              className="inline-flex items-center px-3 py-1.5 rounded-xl border border-indigo-200 bg-white hover:bg-indigo-50 text-xs font-semibold text-indigo-700 transition cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${aiLoading ? 'animate-spin' : ''}`} />
              <span>{aiLoading ? 'AI qayta hisoblamoqda...' : 'AI Qayta Tahlil'}</span>
            </button>
          </div>

          <div className="p-3.5 rounded-xl bg-white border border-indigo-100 text-xs leading-relaxed text-neutral-800 font-medium">
            {aiAnalysis.executive_summary}
          </div>

          {/* Key Findings Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {aiAnalysis.key_findings.map((item, idx) => (
              <div 
                key={idx} 
                className={`p-3.5 rounded-xl border ${
                  item.severity === 'CRITICAL' ? 'border-rose-200 bg-rose-50/60' :
                  item.severity === 'WARNING' ? 'border-amber-200 bg-amber-50/60' :
                  'border-emerald-200 bg-emerald-50/60'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold text-neutral-900">{item.title}</span>
                  <span className={`text-[9px] font-black px-1.5 py-0.5 rounded uppercase ${
                    item.severity === 'CRITICAL' ? 'bg-rose-200 text-rose-900' :
                    item.severity === 'WARNING' ? 'bg-amber-200 text-amber-900' :
                    'bg-emerald-200 text-emerald-900'
                  }`}>
                    {item.severity}
                  </span>
                </div>
                <p className="text-xs text-neutral-600 leading-normal">{item.description}</p>
              </div>
            ))}
          </div>

          {/* Actionable recommendations */}
          <div className="pt-2">
            <h4 className="text-xs font-bold text-neutral-800 uppercase tracking-wider mb-2">
              Tavsiya etilgan amaliy choralar:
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {aiAnalysis.actionable_recommendations.map((rec, i) => (
                <div key={i} className="flex items-start space-x-2 text-xs text-neutral-700 bg-white/80 p-2.5 rounded-xl border border-indigo-50">
                  <CheckCircle2 className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
                  <span>{rec}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* SECTION 3: ISTALGAN KUNLIK SAVDODAN KELIB CHIQIB QOLDIQ KUNLARI          */}
      {/* ========================================================================= */}
      <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-xs space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-neutral-100 pb-4">
          <div>
            <h2 className="text-base font-bold text-neutral-900">
              Qoldiq Necha Kunga Yetishi va Zaxira Prognozi
            </h2>
            <p className="text-xs text-neutral-500">
              Kunlik sotuv tezligiga qarab ombor zaxirasining tugash muddatini oldindan bilish va buyurtma berish
            </p>
          </div>

          {/* Run-Rate Factor Selector */}
          <div className="flex items-center space-x-2 bg-neutral-50 p-1 rounded-xl border border-neutral-200">
            <span className="text-xs font-semibold text-neutral-600 px-2 flex items-center gap-1">
              <Sliders className="w-3.5 h-3.5" /> Sotuv Sur'ati:
            </span>
            <button
              onClick={() => setRunRateFactor(1.0)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                runRateFactor === 1.0 ? 'bg-white text-indigo-700 shadow-xs' : 'text-neutral-600 hover:text-neutral-900'
              }`}
            >
              1.0x (Oddiy)
            </button>
            <button
              onClick={() => setRunRateFactor(1.25)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                runRateFactor === 1.25 ? 'bg-white text-indigo-700 shadow-xs' : 'text-neutral-600 hover:text-neutral-900'
              }`}
            >
              1.25x (+25%)
            </button>
            <button
              onClick={() => setRunRateFactor(1.5)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                runRateFactor === 1.5 ? 'bg-white text-indigo-700 shadow-xs' : 'text-neutral-600 hover:text-neutral-900'
              }`}
            >
              1.5x (Kuchaytirilgan)
            </button>
            <button
              onClick={() => setRunRateFactor(2.0)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                runRateFactor === 2.0 ? 'bg-white text-indigo-700 shadow-xs' : 'text-neutral-600 hover:text-neutral-900'
              }`}
            >
              2.0x (Mavsumiy)
            </button>
          </div>
        </div>

        {/* Filter & Search Bar */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center space-x-2 w-full sm:w-auto">
            <button
              onClick={() => setStatusFilter('ALL')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                statusFilter === 'ALL' ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
              }`}
            >
              Barchasi ({runRateData?.items.length ?? 0})
            </button>
            <button
              onClick={() => setStatusFilter('OUT_OF_STOCK')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                statusFilter === 'OUT_OF_STOCK' ? 'bg-rose-600 text-white' : 'bg-rose-50 text-rose-700 hover:bg-rose-100'
              }`}
            >
              Tugagan ({runRateData?.summary.out_of_stock_count ?? 0})
            </button>
            <button
              onClick={() => setStatusFilter('CRITICAL')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                statusFilter === 'CRITICAL' ? 'bg-rose-500 text-white' : 'bg-rose-50 text-rose-600 hover:bg-rose-100'
              }`}
            >
              Kritik ≤3 kun ({runRateData?.summary.critical_count ?? 0})
            </button>
            <button
              onClick={() => setStatusFilter('LOW')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                statusFilter === 'LOW' ? 'bg-amber-500 text-white' : 'bg-amber-50 text-amber-700 hover:bg-amber-100'
              }`}
            >
              Kam ≤7 kun ({runRateData?.summary.low_count ?? 0})
            </button>
            <button
              onClick={() => setStatusFilter('OPTIMAL')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                statusFilter === 'OPTIMAL' ? 'bg-emerald-600 text-white' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
              }`}
            >
              Yetarli
            </button>
          </div>

          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <MultiSelect label="Kategoriya" allLabel="Barcha kategoriyalar" value={categoryFilter} onChange={setCategoryFilter}
              options={forecastCategories.map(c => ({ value: c, label: c }))} />
            <div className="relative w-full sm:w-56">
              <Search className="w-4 h-4 text-neutral-400 absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Mahsulot nomi yoki SKU..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="w-full h-9 pl-9 pr-3 text-xs bg-neutral-50 border border-neutral-200 rounded-xl focus:outline-indigo-500 focus:bg-white"
              />
            </div>
            <ExportButton onExport={exportRunRate} />
          </div>
        </div>

        {/* Main Run-Rate Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-neutral-200 bg-neutral-50/80 text-[11px] font-bold text-neutral-700 uppercase tracking-wider">
                <th className="py-3 px-3">Mahsulot</th>
                <th className="py-3 px-3 text-right">Amaldagi Qoldiq</th>
                <th className="py-3 px-3 text-right">Kunlik Savdo Sur'ati</th>
                <th className="py-3 px-3 text-center">Ishonchlilik</th>
                <th className="py-3 px-3 text-center">Qoldiq Necha Kunga Yetadi?</th>
                <th className="py-3 px-3 text-center">Holati</th>
                <th className="py-3 px-3 text-right">Tavsiya Zakaz (30 kun)</th>
                <th className="py-3 px-3 text-right">Zakaz Byudjeti</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {filteredItems.map(item => {
                let badgeClass = 'bg-emerald-100 text-emerald-800';
                let label = 'Yetarli (8+ kun)';
                let barColor = 'bg-emerald-500';

                if (item.status === 'OUT_OF_STOCK') {
                  badgeClass = 'bg-rose-100 text-rose-900 border border-rose-200';
                  label = 'TUGAGAN (0 KUN)';
                  barColor = 'bg-rose-500';
                } else if (item.status === 'CRITICAL') {
                  badgeClass = 'bg-rose-100 text-rose-800';
                  label = 'KRITIK XAVF (≤3 KUN)';
                  barColor = 'bg-rose-500';
                } else if (item.status === 'LOW') {
                  badgeClass = 'bg-amber-100 text-amber-800';
                  label = 'KAM QOLDIQ (≤7 KUN)';
                  barColor = 'bg-amber-500';
                } else if (item.status === 'OVERSTOCKED') {
                  badgeClass = 'bg-blue-100 text-blue-800';
                  label = "ORTIQCHA ZAXIRA (>35 KUN)";
                  barColor = 'bg-blue-500';
                }

                const progressWidth = item.days_remaining > 0 ? Math.min(100, Math.round((item.days_remaining / 30) * 100)) : 0;

                return (
                  <tr key={item.id} className="hover:bg-neutral-50 transition">
                    <td className="py-3 px-3">
                      <div className="font-bold text-neutral-900">{item.name}</div>
                      <div className="text-[10px] text-neutral-400 font-mono">{item.sku} • {item.category}</div>
                    </td>
                    <td className="py-3 px-3 text-right font-black text-neutral-900">
                      {item.stock_quantity.toLocaleString()} <span className="text-[10px] font-normal text-neutral-500">{item.unit}</span>
                    </td>
                    <td className="py-3 px-3 text-right">
                      <div className="font-bold text-neutral-800">{Number(item.effective_daily_sales.toFixed(4))} {item.unit}/kun</div>
                      <div className="text-[10px] text-neutral-400 font-mono">{item.velocity_quantity ?? 0} {item.unit} / {item.velocity_days ?? 0} kun</div>
                    </td>
                    <td className="py-3 px-3 text-center">
                      {/* How much evidence stands behind the daily rate: a single sale is not a trend. */}
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${item.confidence === 'HIGH' ? 'bg-emerald-100 text-emerald-800' : item.confidence === 'MEDIUM' ? 'bg-amber-100 text-amber-800' : 'bg-neutral-100 text-neutral-600'}`}>
                        {item.confidence === 'HIGH' ? 'Yuqori' : item.confidence === 'MEDIUM' ? 'O‘rta' : item.confidence === 'LOW' ? 'Past' : 'Ma’lumot yo‘q'}
                      </span>
                      <div className="text-[10px] text-neutral-400 mt-0.5">{item.velocity_sale_days ?? 0} kun sotuv{item.last_sale_date ? ` · oxirgi ${item.last_sale_date}` : ''}</div>
                    </td>
                    <td className="py-3 px-3 text-center">
                      <div className="flex flex-col items-center">
                        <span className="text-sm font-black text-neutral-900">
                          {item.stock_quantity === 0 ? '0 kun' : item.effective_daily_sales<=0 ? 'Sotuv yo‘q' : `${item.days_remaining} kunga`}
                        </span>
                        <div className="w-24 bg-neutral-100 h-1.5 rounded-full overflow-hidden mt-1">
                          <div className={`h-full ${barColor}`} style={{ width: `${progressWidth}%` }}></div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-3 text-center">
                      <span className={`inline-flex px-2.5 py-0.5 rounded-full text-[10px] font-black ${badgeClass}`}>
                        {label}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-right font-semibold text-neutral-800">
                      {item.reorder_quantity > 0 ? (
                        <span>+{item.reorder_quantity.toLocaleString()} {item.unit}</span>
                      ) : (
                        <span className="text-neutral-400">Kerak emas</span>
                      )}
                    </td>
                    <td className="py-3 px-3 text-right font-bold text-neutral-900">
                      {item.reorder_cost > 0 ? formatUZS(item.reorder_cost) : '-'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* MODAL: ADMIN SMS ESINI JO'NATISH SIMULATSIYASI                            */}
      {/* ========================================================================= */}
      {showSmsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-neutral-100 pb-3">
              <div className="flex items-center space-x-2.5">
                <div className="p-2 bg-rose-100 text-rose-700 rounded-xl">
                  <Phone className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-neutral-900">
                    Tugagan tovarlar — Telegram ogohlantirish
                  </h3>
                  <p className="text-xs text-neutral-500">
                    Tugagan tovarlar va yo'qotilgan foyda bo'yicha tezkor ogohlantirish
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowSmsModal(false)}
                className="text-neutral-400 hover:text-neutral-700 p-1"
              >
                ✕
              </button>
            </div>

            {smsSuccess ? (
              <div className="space-y-4 py-2">
                <div className={`p-4 rounded-xl border flex items-start space-x-3 ${smsSuccess.sent ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : 'bg-amber-50 border-amber-200 text-amber-900'}`}>
                  <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />
                  <p className="text-xs font-semibold">{smsSuccess.message}</p>
                </div>

                {smsSuccess.preview && (
                  <div className="p-3 bg-neutral-900 text-emerald-300 font-mono text-[11px] rounded-xl leading-relaxed whitespace-pre-line border border-neutral-800">
                    {smsSuccess.preview}
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => setShowSmsModal(false)}
                  className="w-full py-2.5 bg-neutral-900 hover:bg-neutral-800 text-white font-semibold text-xs rounded-xl transition"
                >
                  Yopish
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-xs text-neutral-600">Xabar “Tovar tugashi” turini oladigan Telegram botlarga yuboriladi (Sozlamalar → Botlar). SMS xizmati ulanmagan.</p>

                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">Xabar matni:</label>
                  <div className="p-3 bg-neutral-950 text-neutral-200 font-mono text-[11px] rounded-xl leading-relaxed space-y-1 border border-neutral-800">
                    <p>Omborda {outOfStockData?.summary?.out_of_stock_count ?? 0} ta tovar tugagan.</p>
                    {[...(outOfStockData?.items || [])].sort((a, b) => b.lost_sales_uzs - a.lost_sales_uzs).slice(0, 5).map((it, idx) => (
                      <p key={idx} className="text-rose-300">
                        • {it.name}: {stockOutLabel(it)} yo'q, boy berilgan savdo {formatUZS(it.lost_sales_uzs)}
                      </p>
                    ))}
                    <p className="text-white font-bold pt-1">
                      Boy berilgan foyda: {outOfStockData?.summary?.profit_unknown_count ? `hisoblanmadi (${outOfStockData.summary.profit_unknown_count} ta tovarda kirim narxi yo‘q)` : formatUZS(outOfStockData?.summary?.total_lost_profit_uzs || 0)}.
                    </p>
                    <p className="text-neutral-400">Ta’minotchiga buyurtma bering.</p>
                  </div>
                </div>

                <div className="flex items-center justify-end space-x-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowSmsModal(false)}
                    className="px-4 py-2 text-xs font-semibold text-neutral-600 hover:bg-neutral-100 rounded-xl transition"
                  >
                    Bekor qilish
                  </button>
                  <button
                    type="button"
                    onClick={handleSendAdminSms}
                    disabled={smsSending}
                    className="inline-flex items-center px-4 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-xl transition shadow-xs cursor-pointer"
                  >
                    <Send className={`w-3.5 h-3.5 mr-1.5 ${smsSending ? 'animate-spin' : ''}`} />
                    <span>{smsSending ? 'Yuborilmoqda...' : 'Telegram’ga yuborish'}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
