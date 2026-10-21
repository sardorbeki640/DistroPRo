import React, { useState, useEffect, useRef } from 'react';
import { CompareReport } from './CompareReport.tsx';
import { localToday } from '../../utils/date';
import { 
  BarChart3, 
  TrendingUp, 
  DollarSign, 
  PieChart, 
  Clock, 
  Bell, 
  Calendar, 
  ArrowUpRight, 
  ArrowDownLeft, 
  AlertTriangle, 
  CheckCircle2,
  Users,
  MapPin,
  RefreshCw,
  Printer,
  Scale,
  Network,
  Wallet,
  Zap,
  Check,
  CreditCard,
  Banknote,
  Briefcase,
  Building,
  ExternalLink,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { api } from '../../services/api.ts';
import { useDistribution } from '../../hooks/useDistribution.ts';
import { AuthUser, NavView } from '../../types.ts';
import { TableToolbar, ExportButton, matchesSearch, exportTableXlsx, picked } from '../common/TableToolbar.tsx';

/** A deduction in the P&L: "-1 200 000", plain "0" when nothing (not "-0"), "—" when unknown. */
/** An amount the server may not know (bank balance, equity): "noma’lum" instead of a crash or an invented 0. */
const amt = (v: number | null | undefined) => (v === null || v === undefined ? 'noma’lum' : `${v.toLocaleString()} UZS`);
const minus = (v: number | null | undefined) => (v === null || v === undefined ? '—' : v ? `-${v.toLocaleString()}` : '0');

interface ReportsViewProps {
  user: AuthUser | null;
  onNavigate?: (view: NavView) => void;
  onRefresh?: () => void;
}

export const ReportsView: React.FC<ReportsViewProps> = ({ user, onNavigate, onRefresh }) => {
  const [activeTab, setActiveTab] = useState<'PNL' | 'COMPARE' | 'GROSS_PROFIT' | 'AGING' | 'BALANCE' | 'SALESDOCTOR' | 'NOTIFICATIONS'>('PNL');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [syncMessage, setSyncMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isSyncingSalesDoctor, setIsSyncingSalesDoctor] = useState<boolean>(false);
  const [reportServer, setReportServer] = useState<string | null>(null);
  const [serverOptions, setServerOptions] = useState<any[]>([]);
  const reportRequestSequence = useRef(0);
  useEffect(() => {
    let alive = true;
    const loadServers = () => api.getIntegrations()
      .then(r => { if (alive) setServerOptions((r.integrations || []).filter((i: any) => !i.disabled)); })
      .catch(() => {});
    loadServers();
    window.addEventListener('distribution:refresh', loadServers);
    return () => { alive = false; window.removeEventListener('distribution:refresh', loadServers); };
  }, []);
  // The connected distribution system (SalesDoctor, Linko, …): the "SFA" tab and sync follow it.
  const distribution = useDistribution();
  const dName = distribution.name;
  useEffect(() => {
    if (distribution.loaded) setReportServer(distribution.system?.id || null);
  }, [distribution.loaded, distribution.system?.id]);

  // Date filters
  const [fromDate, setFromDate] = useState<string>(
    new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10)
  );
  const [toDate, setToDate] = useState<string>(
    localToday()
  );

  // Group By for Gross Profit
  const [groupBy, setGroupBy] = useState<'AGENT' | 'TERRITORY' | 'CUSTOMER'>('AGENT');

  // Report Data States
  const [pnlData, setPnlData] = useState<any>(null);
  const [grossProfitRows, setGrossProfitRows] = useState<any[]>([]);
  const [agingRows, setAgingRows] = useState<any[]>([]);
  const [balanceData, setBalanceData] = useState<any>(null);
  const [salesDoctorData, setSalesDoctorData] = useState<any>(null);
  const [notifications, setNotifications] = useState<any[]>([]);

  const loadActiveReport = async () => {
    if ((activeTab === 'PNL' || activeTab === 'GROSS_PROFIT') && reportServer === null) return;
    const requestId = ++reportRequestSequence.current;
    setIsLoading(true);
    try {
      if (activeTab === 'PNL') {
        const res = await api.getProfitAndLossReport(fromDate, toDate, reportServer || undefined);
        if (requestId === reportRequestSequence.current) setPnlData(res.report);
      } else if (activeTab === 'GROSS_PROFIT') {
        const res = await api.getGrossProfitReport({ from_date: fromDate, to_date: toDate, group_by: groupBy, integration_id: reportServer || undefined });
        if (requestId === reportRequestSequence.current) setGrossProfitRows(res.rows || []);
      } else if (activeTab === 'AGING') {
        const res = await api.getAgingReport(toDate);
        setAgingRows(res.rows || []);
      } else if (activeTab === 'BALANCE') {
        const res = await api.getBalanceSheet(toDate);
        setBalanceData(res.balance);
      } else if (activeTab === 'SALESDOCTOR') {
        const res = await api.getSalesDoctorSummary();
        setSalesDoctorData(res);
      } else if (activeTab === 'NOTIFICATIONS') {
        const res = await api.getNotifications();
        setNotifications(res.notifications || []);
      }
    } catch (err: any) {
      if (requestId === reportRequestSequence.current) console.error('Error loading report:', err);
    } finally {
      if (requestId === reportRequestSequence.current) setIsLoading(false);
    }
  };

  useEffect(() => {
    loadActiveReport();
  }, [activeTab, fromDate, toDate, groupBy, reportServer]);

  // Filters of the table reports; the same rows go to Excel.
  const [reportSearch, setReportSearch] = useState('');
  const [agingAgent, setAgingAgent] = useState('');
  const [agingBucket, setAgingBucket] = useState('');
  const visibleGross = grossProfitRows.filter(r => matchesSearch(r, reportSearch, ['group_name']));
  const agingAgents = Array.from(new Set(agingRows.map(r => r.agent_name).filter(Boolean))).sort() as string[];
  const visibleAging = agingRows.filter(r =>
    matchesSearch(r, reportSearch, ['customer_name', 'agent_name']) &&
    (!agingAgent || picked(agingAgent).some(a => a === '__none' ? !r.agent_name : r.agent_name === a)) &&
    (!agingBucket || picked(agingBucket).some(b => (r[b] || 0) > 0))
  );
  const agingBucketLabels: Record<string, string> = { bucket_0_30: '0–30 kun', bucket_31_60: '31–60 kun', bucket_61_90: '61–90 kun', bucket_90_plus: '90+ kun', bucket_unknown: 'Sanasi noma’lum' };
  const period = `davr: ${fromDate} — ${toDate}`;
  const groupLabel = groupBy === 'AGENT' ? 'agentlar' : groupBy === 'TERRITORY' ? 'hududlar' : 'mijozlar';

  /** Excel of the report on screen (the active tab), with the period and filters in the header. */
  const exportActiveReport = async () => {
    if (activeTab === 'PNL' && pnlData) {
      const line = (name: string, amount: number | null, level = 1) => ({ name: `${'   '.repeat(level - 1)}${name}`, amount });
      await exportTableXlsx({
        fileName: `Foyda_zarar_${fromDate}_${toDate}`,
        title: 'Foyda va zararlar hisoboti (P&L)',
        columns: [{ header: 'Ko‘rsatkich', key: 'name', width: 52 }, { header: 'Summa', key: 'amount', type: 'money' }],
        rows: [
          line('1. Yalpi savdo', pnlData.gross_sales),
          line('Chegirmalar', -pnlData.sales_discounts, 2),
          line('Qaytarilgan tovarlar', -pnlData.returns, 2),
          line('Sof tushum', pnlData.net_revenue),
          line('2. Tannarx (COGS)', -pnlData.cost_of_goods_sold),
          line(`Yalpi foyda (marja ${pnlData.gross_margin_percent}%)`, pnlData.gross_profit),
          line('3. Operatsion xarajatlar', -pnlData.total_operating_expenses),
          ...(pnlData.operating_expenses || []).map((e: any) => line(e.category_name, -e.amount, 2)),
          line('4. Oylik fondi', -pnlData.total_payroll),
          line('SOF FOYDA', pnlData.net_profit)
        ],
        filters: [period, pnlData.cogs_complete ? 'tannarx to‘liq' : `tannarx qamrovi ${pnlData.cogs_coverage_percent}%`]
      });
    } else if (activeTab === 'GROSS_PROFIT') {
      await exportTableXlsx({
        fileName: `Yalpi_marja_${groupBy.toLowerCase()}_${fromDate}_${toDate}`,
        title: `Yalpi marja — ${groupLabel} kesimida`,
        columns: [
          { header: groupBy === 'AGENT' ? 'Agent' : groupBy === 'TERRITORY' ? 'Hudud' : 'Mijoz', key: 'group_name', width: 32 },
          { header: 'Buyurtmalar', key: 'order_count', type: 'number', total: true },
          { header: 'Savdo hajmi', key: 'total_sales', type: 'money', total: true },
          { header: 'Chegirma', key: 'discount_amount', type: 'money', total: true },
          { header: 'Sof savdo', key: 'net_sales', type: 'money', total: true },
          { header: 'Tannarx', key: 'total_cogs', type: 'money', total: true },
          { header: 'Yalpi foyda', key: 'gross_profit', type: 'money', total: true },
          { header: 'Marja', key: 'margin', type: 'percent' },
          { header: 'Tannarx ma’lum', key: 'coverage', type: 'percent' }
        ],
        rows: visibleGross.map(r => ({ ...r, margin: (r.gross_margin_percent || 0) / 100, coverage: (r.cogs_coverage_percent || 0) / 100 })),
        filters: [period, reportSearch && `qidiruv: "${reportSearch}"`]
      });
    } else if (activeTab === 'AGING') {
      await exportTableXlsx({
        fileName: 'Qarz_muddati',
        title: 'Qarzdorlik muddati bo‘yicha tahlil (AR aging)',
        columns: [
          { header: 'Mijoz', key: 'customer_name', width: 32 },
          { header: 'Agent', key: 'agent_name', width: 22 },
          { header: 'Joriy qarz', key: 'current_debt', type: 'money', total: true },
          { header: '0–30 kun', key: 'bucket_0_30', type: 'money', total: true },
          { header: '31–60 kun', key: 'bucket_31_60', type: 'money', total: true },
          { header: '61–90 kun', key: 'bucket_61_90', type: 'money', total: true },
          { header: '90+ kun', key: 'bucket_90_plus', type: 'money', total: true },
          { header: 'Sanasi noma’lum', key: 'bucket_unknown', type: 'money', total: true },
          { header: 'Eng eski qarz sanasi', key: 'oldest_debt_date', type: 'date' },
          { header: 'Kun', key: 'oldest_debt_days', type: 'number' }
        ],
        rows: visibleAging,
        filters: [
          reportSearch && `qidiruv: "${reportSearch}"`,
          agingAgent && `agent: ${picked(agingAgent).map(a => a === '__none' ? 'biriktirilmagan' : a).join(', ')}`,
          agingBucket && `faqat ${picked(agingBucket).map(b => agingBucketLabels[b]).join(' yoki ')} qarzi borlar`
        ]
      });
    } else if (activeTab === 'BALANCE' && balanceData) {
      const a = balanceData.assets, l = balanceData.liabilities, c = balanceData.cashflow || {};
      await exportTableXlsx({
        fileName: `Balans_${toDate}`,
        title: 'Balans va pul oqimi',
        columns: [{ header: 'Bo‘lim', key: 'group', width: 16 }, { header: 'Ko‘rsatkich', key: 'name', width: 40 }, { header: 'Summa', key: 'amount', type: 'money' }],
        rows: [
          { group: 'Pul oqimi', name: 'Jami kirim', amount: c.total_inflow || 0 },
          { group: 'Pul oqimi', name: 'Jami chiqim', amount: c.total_outflow || 0 },
          { group: 'Pul oqimi', name: 'Sof pul oqimi', amount: c.net_flow || 0 },
          { group: 'Aktivlar', name: 'Kassadagi naqd pul', amount: a.cash_in_registers },
          { group: 'Aktivlar', name: 'Bank va terminal', amount: a.bank_balances },
          { group: 'Aktivlar', name: 'Mijozlar qarzdorligi (nasiya)', amount: a.accounts_receivable },
          { group: 'Aktivlar', name: 'Ombor tovar zaxirasi', amount: a.inventory_value },
          { group: 'Aktivlar', name: 'JAMI AKTIVLAR', amount: a.total_assets },
          { group: 'Majburiyatlar', name: 'Yetkazib beruvchilardan qarz', amount: l.accounts_payable },
          { group: 'Majburiyatlar', name: 'Xodimlar oylik majburiyati', amount: l.payroll_liabilities },
          { group: 'Majburiyatlar', name: 'Mijozlar avanslari', amount: l.customer_prepayments },
          { group: 'Majburiyatlar', name: 'JAMI MAJBURIYATLAR', amount: l.total_liabilities },
          { group: 'Kapital', name: 'Xususiy kapital (sof aktivlar)', amount: balanceData.net_equity }
        ],
        filters: [period]
      });
    } else if (activeTab === 'SALESDOCTOR' && salesDoctorData) {
      await api.downloadXlsx(`${dName}_tahlili_${fromDate}_${toDate}.xlsx`, [
        {
          name: 'Buyurtmalar', title: `${dName} orqali kelgan buyurtmalar`, subtitle: [period],
          columns: [
            { header: 'Buyurtma', key: 'number', width: 16 }, { header: 'Mijoz', key: 'customer', width: 32 },
            { header: 'Sana', key: 'date', type: 'date' }, { header: 'Summa', key: 'amount', type: 'money', total: true }, { header: 'Holat', key: 'status', width: 12 }
          ],
          rows: (salesDoctorData.recentOrders || []).map((o: any) => ({ number: o.order_number || o.external_order_id || o.id, customer: o.customer_name || o.customer_external_id, date: o.order_date || o.synced_at?.slice(0, 10), amount: o.total_sales || o.total_amount || 0, status: o.status || 'DELIVERED' })),
          totalsLabel: 'JAMI'
        },
        {
          name: 'To‘lovlar', title: 'Agentlar qabul qilgan to‘lovlar', subtitle: [period],
          columns: [
            { header: 'Kvitansiya', key: 'id', width: 18 }, { header: 'Mijoz kodi', key: 'customer', width: 18 },
            { header: 'Sana', key: 'date', type: 'date' }, { header: 'Summa', key: 'amount', type: 'money', total: true }
          ],
          rows: (salesDoctorData.recentPayments || []).map((p: any) => ({ id: p.external_payment_id || p.id, customer: p.customer_code || p.customer_id, date: p.payment_date || p.synced_at?.slice(0, 10), amount: p.amount || 0 })),
          totalsLabel: 'JAMI'
        }
      ]);
    } else if (activeTab === 'NOTIFICATIONS') {
      await exportTableXlsx({
        fileName: 'Xabarnomalar',
        title: 'Xabarnomalar',
        columns: [{ header: 'Vaqt', key: 'time', width: 20 }, { header: 'Turi', key: 'type', width: 16 }, { header: 'Xabar', key: 'text', width: 70 }],
        rows: notifications.map((n: any) => ({ time: n.created_at ? new Date(n.created_at).toLocaleString('ru-RU') : '', type: n.type || n.channel || '', text: n.message || n.title || n.text || '' }))
      });
    } else {
      throw new Error('Bu hisobot uchun avval ma’lumot yuklansin.');
    }
  };

  const handleSyncSalesDoctor = async () => {
    setIsSyncingSalesDoctor(true);
    setSyncMessage(null);
    try {
      if (!distribution.system) throw new Error('Distribyutor tizimi ulanmagan — Integratsiyalar bo‘limida ulang.');
      const res: any = await api.syncIntegration(distribution.system.provider);
      setSyncMessage({
        type: 'success',
        text: res.result?.details?.background
          ? `${dName}: ${res.result.details.message}`
          : `${dName} ma'lumotlari sinxronlandi: ${res.result?.recordsImported || 0} ta yozuv (buyurtmalar, mijozlar, kassa tushumi) yangilandi.`
      });
      await loadActiveReport();
      if (onRefresh) onRefresh();
    } catch (err: any) {
      setSyncMessage({
        type: 'error',
        text: err.message || `${dName} sinxronizatsiyasida xatolik yuz berdi`
      });
    } finally {
      setIsSyncingSalesDoctor(false);
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Header & Date Controls */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-neutral-900">
            Moliya & Boshqaruv Hisobotlari (Financial Analytics)
          </h1>
          <p className="text-xs text-neutral-500">
            Foyda va zararlar (P&L), Yalpi marja, Qarz muddati (Aging), Korxona Balansi va {dName} tahlili
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 shadow-xs">
            <Calendar className="h-4 w-4 text-neutral-400" />
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="text-xs font-semibold text-neutral-700 focus:outline-hidden"
            />
            <span className="text-xs text-neutral-400">—</span>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="text-xs font-semibold text-neutral-700 focus:outline-hidden"
            />
          </div>
          {(activeTab === 'PNL' || activeTab === 'GROSS_PROFIT') && <select aria-label="Server bo‘yicha hisobot" className="rounded-lg border border-neutral-300 bg-white px-2.5 py-2 text-xs" value={reportServer || ''} onChange={e => { reportRequestSequence.current++; setPnlData(null); setGrossProfitRows([]); setReportServer(e.target.value); }}>
            <option value="">Barcha serverlar</option>
            {serverOptions.map((i: any) => <option key={i.id} value={i.id}>{i.config?.connection_name || i.system_name || i.provider_name}</option>)}
          </select>}

          <button
            onClick={loadActiveReport}
            disabled={isLoading}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-50 disabled:opacity-50"
            title="Yangilash"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          </button>

          <button
            onClick={() => window.print()}
            className="flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-xs font-semibold text-neutral-700 shadow-xs hover:bg-neutral-50"
          >
            <Printer className="h-4 w-4 text-neutral-500" />
            <span>Chop etish</span>
          </button>

          {/* The comparison tab has its own Excel button. */}
          {activeTab !== 'COMPARE' && <ExportButton onExport={exportActiveReport} label="Excel" className="!h-8" />}
        </div>
      </div>

      {syncMessage && (
        <div className={`p-4 rounded-xl border text-xs flex items-center justify-between ${
          syncMessage.type === 'success' 
            ? 'bg-emerald-50 border-emerald-200 text-emerald-800' 
            : 'bg-red-50 border-red-200 text-red-800'
        }`}>
          <div className="flex items-center space-x-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span className="font-medium">{syncMessage.text}</span>
          </div>
          <button onClick={() => setSyncMessage(null)} className="opacity-70 hover:opacity-100 font-bold p-1">✕</button>
        </div>
      )}

      {/* Tabs - All Core Sections Available */}
      <div className="flex flex-wrap border-b border-neutral-200 gap-1 sm:gap-2">
        <button
          onClick={() => setActiveTab('PNL')}
          className={`flex items-center gap-2 border-b-2 px-3.5 py-2.5 text-xs font-semibold transition cursor-pointer ${
            activeTab === 'PNL'
              ? 'border-neutral-900 text-neutral-900 font-bold'
              : 'border-transparent text-neutral-500 hover:text-neutral-700'
          }`}
        >
          <TrendingUp className="h-4 w-4 text-emerald-600" />
          <span>Foyda & Zararlar (P&L)</span>
        </button>

        <button
          onClick={() => setActiveTab('COMPARE')}
          className={`flex items-center gap-2 border-b-2 px-3.5 py-2.5 text-xs font-semibold transition cursor-pointer ${
            activeTab === 'COMPARE'
              ? 'border-neutral-900 text-neutral-900 font-bold'
              : 'border-transparent text-neutral-500 hover:text-neutral-700'
          }`}
        >
          <TrendingUp className="h-4 w-4 text-indigo-600" />
          <span>Davrlarni solishtirish</span>
        </button>

        <button
          onClick={() => setActiveTab('GROSS_PROFIT')}
          className={`flex items-center gap-2 border-b-2 px-3.5 py-2.5 text-xs font-semibold transition cursor-pointer ${
            activeTab === 'GROSS_PROFIT'
              ? 'border-neutral-900 text-neutral-900 font-bold'
              : 'border-transparent text-neutral-500 hover:text-neutral-700'
          }`}
        >
          <BarChart3 className="h-4 w-4 text-blue-600" />
          <span>Yalpi Marja (Gross Profit)</span>
        </button>

        <button
          onClick={() => setActiveTab('AGING')}
          className={`flex items-center gap-2 border-b-2 px-3.5 py-2.5 text-xs font-semibold transition cursor-pointer ${
            activeTab === 'AGING'
              ? 'border-neutral-900 text-neutral-900 font-bold'
              : 'border-transparent text-neutral-500 hover:text-neutral-700'
          }`}
        >
          <Clock className="h-4 w-4 text-amber-600" />
          <span>Qarz Muddati (AR Aging)</span>
        </button>

        <button
          onClick={() => setActiveTab('BALANCE')}
          className={`flex items-center gap-2 border-b-2 px-3.5 py-2.5 text-xs font-semibold transition cursor-pointer ${
            activeTab === 'BALANCE'
              ? 'border-neutral-900 text-neutral-900 font-bold'
              : 'border-transparent text-neutral-500 hover:text-neutral-700'
          }`}
        >
          <Scale className="h-4 w-4 text-indigo-600" />
          <span>Balans & Pul Oqimi</span>
        </button>

        <button
          onClick={() => setActiveTab('SALESDOCTOR')}
          className={`flex items-center gap-2 border-b-2 px-3.5 py-2.5 text-xs font-semibold transition cursor-pointer ${
            activeTab === 'SALESDOCTOR'
              ? 'border-neutral-900 text-neutral-900 font-bold'
              : 'border-transparent text-neutral-500 hover:text-neutral-700'
          }`}
        >
          <Network className="h-4 w-4 text-purple-600" />
          <span>{dName} & SFA Tahlili</span>
        </button>

        <button
          onClick={() => setActiveTab('NOTIFICATIONS')}
          className={`flex items-center gap-2 border-b-2 px-3.5 py-2.5 text-xs font-semibold transition cursor-pointer ${
            activeTab === 'NOTIFICATIONS'
              ? 'border-neutral-900 text-neutral-900 font-bold'
              : 'border-transparent text-neutral-500 hover:text-neutral-700'
          }`}
        >
          <Bell className="h-4 w-4 text-neutral-500" />
          <span>Xabarnomalar</span>
        </button>
      </div>

      {isLoading && (
        <div className="p-12 text-center text-xs text-neutral-500 flex flex-col items-center justify-center gap-2">
          <RefreshCw className="w-6 h-6 animate-spin text-emerald-600" />
          <span>Hisobotlar tayyorlanmoqda...</span>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 1: P&L Statement                                                      */}
      {/* ========================================================================= */}
      {!isLoading && activeTab === 'PNL' && pnlData && (
        <div className="space-y-6">
          {/* Quick SalesDoctor Prompt if sales are 0 */}
          {pnlData.gross_sales === 0 && (
            <div className="p-4 rounded-2xl border border-blue-200 bg-blue-50/70 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-xs">
              <div className="flex items-center space-x-3">
                <div className="p-2 bg-blue-100 text-blue-800 rounded-xl shrink-0">
                  <Network className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-blue-950">
                    {dName} buyurtmalari bilan P&L hisobotini to'ldirish
                  </h4>
                  <p className="text-[11px] text-blue-800 mt-0.5">
                    Hozirda tanlangan muddatda savdo buyurtmalari yo'q. {dName} orqali agent buyurtmalarini sinxronlashtirishingiz mumkin.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleSyncSalesDoctor}
                disabled={isSyncingSalesDoctor}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition shadow-xs flex items-center gap-1.5 shrink-0"
              >
                {isSyncingSalesDoctor ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                <span>{dName} bilan sinxronlash</span>
              </button>
            </div>
          )}

          {/* Data quality: profit is shown only when every sale has a known cost */}
          <div className={`rounded-xl border p-3 text-xs ${pnlData.cogs_complete ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-300 bg-amber-50 text-amber-900'}`}>
            <strong>{pnlData.cogs_complete ? 'Tannarx to‘liq ma’lum' : `Tannarx qamrovi: ${pnlData.cogs_coverage_percent}%`}</strong>
            <span> · {pnlData.profit_note}</span>
            {pnlData.pending_sales > 0 && <span> · Yetkazilmagan buyurtmalar ({pnlData.pending_sales.toLocaleString()} UZS) tushumga kiritilmadi.</span>}
          </div>

          {/* Key KPI summary */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-xs">
              <span className="text-xs font-medium uppercase tracking-wider text-neutral-500">Sof Tushum (Net Revenue)</span>
              <p className="mt-2 text-2xl font-bold text-neutral-900">
                {pnlData.net_revenue.toLocaleString()} UZS
              </p>
              <p className="text-[11px] text-neutral-500">Savdo - Chegirmalar - Qaytganlar</p>
            </div>

            <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-xs">
              <span className="text-xs font-medium uppercase tracking-wider text-neutral-500">Yalpi Foyda{pnlData.cogs_complete ? '' : ' (tannarxi ma’lum qism)'}</span>
              <p className="mt-2 text-2xl font-bold text-emerald-600">
                {pnlData.gross_profit.toLocaleString()} UZS
              </p>
              <p className="text-[11px] font-semibold text-emerald-700">
                Marja: {pnlData.gross_margin_percent}%
              </p>
            </div>

            <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-xs">
              <span className="text-xs font-medium uppercase tracking-wider text-neutral-500">Operatsion Xarajatlar</span>
              <p className="mt-2 text-2xl font-bold text-neutral-900">
                {(pnlData.total_operating_expenses + pnlData.total_payroll).toLocaleString()} UZS
              </p>
              <p className="text-[11px] text-neutral-500">OPEX + Oylik Maoshlar</p>
            </div>

            <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-xs">
              <span className="text-xs font-medium uppercase tracking-wider text-neutral-500">Sof Foyda (Net Profit)</span>
              <p className={`mt-2 text-2xl font-bold ${pnlData.net_profit === null ? 'text-neutral-400' : pnlData.net_profit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                {pnlData.net_profit === null ? 'Hisoblanmadi' : `${pnlData.net_profit.toLocaleString()} UZS`}
              </p>
              <p className="text-[11px] font-semibold text-neutral-700">
                {pnlData.net_margin_percent === null ? 'Tannarx to‘liq emas' : `Sof Rentabellik: ${pnlData.net_margin_percent}%`}
              </p>
            </div>
          </div>

          {/* Detailed Financial Waterfall Table */}
          <div className="rounded-xl border border-neutral-200 bg-white p-6 shadow-xs">
            <h2 className="text-base font-bold text-neutral-900 mb-4">
              Foyda va Zararlar To'liq Hisoboti (P&L Waterfall)
            </h2>

            <div className="divide-y divide-neutral-200 text-xs">
              {/* Revenue */}
              <div className="py-2.5 flex justify-between font-semibold text-neutral-900 bg-neutral-50 px-3 rounded-md">
                <span>1. DAROMAD (REVENUE)</span>
                <span>{pnlData.gross_sales.toLocaleString()} UZS</span>
              </div>
              <div className="py-2 flex justify-between pl-6 text-neutral-600">
                <span>Yalpi Savdo Hajmi (Gross Sales)</span>
                <span>+{pnlData.gross_sales.toLocaleString()} UZS</span>
              </div>
              <div className="py-2 flex justify-between pl-6 text-red-600">
                <span>Savdo Chegirmalari (Discounts)</span>
                <span>{minus(pnlData.sales_discounts)} UZS</span>
              </div>
              <div className="py-2 flex justify-between pl-6 text-red-600">
                <span>Mijozlardan Qaytgan Tovarlar (Returns)</span>
                <span>{minus(pnlData.returns)} UZS</span>
              </div>
              <div className="py-2.5 flex justify-between pl-3 font-bold text-neutral-900">
                <span>SOF TUSHUM (NET REVENUE)</span>
                <span>{pnlData.net_revenue.toLocaleString()} UZS</span>
              </div>

              {/* COGS */}
              <div className="py-2.5 flex justify-between font-semibold text-neutral-900 bg-neutral-50 px-3 rounded-md mt-2">
                <span>2. TANNARX (COST OF GOODS SOLD - COGS)</span>
                <span className="text-red-600">{minus(pnlData.cost_of_goods_sold)} UZS</span>
              </div>
              <div className="py-2.5 flex justify-between pl-3 font-bold text-emerald-700 text-sm">
                <span>YALPI FOYDA (GROSS PROFIT) [Marja: {pnlData.gross_margin_percent}%]</span>
                <span>{pnlData.gross_profit.toLocaleString()} UZS</span>
              </div>

              {/* OPEX */}
              <div className="py-2.5 flex justify-between font-semibold text-neutral-900 bg-neutral-50 px-3 rounded-md mt-2">
                <span>3. OPERATSION XARAJATLAR (OPEX)</span>
                <span className="text-red-600">{minus(pnlData.total_operating_expenses)} UZS</span>
              </div>
              {pnlData.operating_expenses.length === 0 ? (
                <div className="py-1.5 pl-6 text-neutral-400 italic">Tasdiqlangan operatsion xarajatlar kiritilmagan</div>
              ) : (
                pnlData.operating_expenses.map((exp: any) => (
                  <div key={exp.category_id} className="py-2 flex justify-between pl-6 text-neutral-600">
                    <span>{exp.category_name}</span>
                    <span>{minus(exp.amount)} UZS</span>
                  </div>
                ))
              )}

              {/* Payroll */}
              <div className="py-2.5 flex justify-between font-semibold text-neutral-900 bg-neutral-50 px-3 rounded-md mt-2">
                <span>4. MEHNAT HAQI VA OYLIK FOND (PAYROLL)</span>
                <span className="text-red-600">{minus(pnlData.total_payroll)} UZS</span>
              </div>

              {/* Net Profit */}
              <div className="py-3 flex justify-between px-3 font-extrabold text-neutral-900 bg-neutral-100 rounded-md mt-4 text-base">
                <span>SOF FOYDA (NET PROFIT)</span>
                <span className={pnlData.net_profit === null ? 'text-neutral-400' : pnlData.net_profit >= 0 ? 'text-emerald-600' : 'text-red-600'}>
                  {pnlData.net_profit === null ? 'Hisoblanmadi' : `${pnlData.net_profit.toLocaleString()} UZS`}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: Gross Profit Breakdown                                             */}
      {/* ========================================================================= */}
      {activeTab === 'COMPARE' && <CompareReport />}

      {!isLoading && activeTab === 'GROSS_PROFIT' && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-neutral-600">Guruhlash kesimi:</span>
            <button
              onClick={() => setGroupBy('AGENT')}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition cursor-pointer ${
                groupBy === 'AGENT' ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-700'
              }`}
            >
              Agentlar kesimida
            </button>
            <button
              onClick={() => setGroupBy('TERRITORY')}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition cursor-pointer ${
                groupBy === 'TERRITORY' ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-700'
              }`}
            >
              Hududlar kesimida
            </button>
            <button
              onClick={() => setGroupBy('CUSTOMER')}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition cursor-pointer ${
                groupBy === 'CUSTOMER' ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-700'
              }`}
            >
              Mijozlar kesimida
            </button>
          </div>

          <TableToolbar
            search={reportSearch}
            onSearch={setReportSearch}
            searchPlaceholder={groupBy === 'AGENT' ? 'Agent nomi…' : groupBy === 'TERRITORY' ? 'Hudud nomi…' : 'Mijoz nomi…'}
            count={visibleGross.length}
            onReset={() => setReportSearch('')}
          />

          <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-xs">
            <table className="min-w-full divide-y divide-neutral-200 text-left text-xs">
              <thead className="bg-neutral-50 text-neutral-500">
                <tr>
                  <th className="px-4 py-3 font-semibold uppercase">Guruh / Mas'ul</th>
                  <th className="px-4 py-3 font-semibold uppercase text-center">Buyurtmalar</th>
                  <th className="px-4 py-3 font-semibold uppercase text-right">Savdo Hajmi</th>
                  <th className="px-4 py-3 font-semibold uppercase text-right">Chegirma</th>
                  <th className="px-4 py-3 font-semibold uppercase text-right">Sof Savdo</th>
                  <th className="px-4 py-3 font-semibold uppercase text-right">Tannarx (COGS)</th>
                  <th className="px-4 py-3 font-semibold uppercase text-right">Yalpi Foyda</th>
                  <th className="px-4 py-3 font-semibold uppercase text-right">Marja %</th>
                  <th className="px-4 py-3 font-semibold uppercase text-right">Tannarx ma’lum</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200 bg-white">
                {visibleGross.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-neutral-400">
                      {grossProfitRows.length ? 'Qidiruvga mos qator yo‘q' : 'Ushbu davrda yetkazilgan savdo qayd etilmagan'}
                    </td>
                  </tr>
                ) : (
                  visibleGross.map((row) => (
                    <tr key={row.group_id} className="hover:bg-neutral-50/80">
                      <td className="px-4 py-3 font-semibold text-neutral-900">{row.group_name}</td>
                      <td className="px-4 py-3 text-center text-neutral-600">{row.order_count}</td>
                      <td className="px-4 py-3 text-right font-medium text-neutral-900">
                        {row.total_sales.toLocaleString()} UZS
                      </td>
                      <td className="px-4 py-3 text-right text-red-600">
                        {row.discount_amount > 0 ? `-${row.discount_amount.toLocaleString()}` : '0'}
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-neutral-900">
                        {row.net_sales.toLocaleString()} UZS
                      </td>
                      <td className="px-4 py-3 text-right text-neutral-500">
                        {row.total_cogs.toLocaleString()} UZS
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-emerald-600">
                        {row.gross_profit.toLocaleString()} UZS
                      </td>
                      <td className="px-4 py-3 text-right font-semibold">
                        <span className="rounded bg-emerald-50 px-2 py-0.5 text-emerald-700">
                          {row.gross_margin_percent}%
                        </span>
                      </td>
                      <td className={`px-4 py-3 text-right ${row.cogs_coverage_percent < 100 ? 'text-amber-700 font-semibold' : 'text-neutral-500'}`}>
                        {row.cogs_coverage_percent}%
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 3: Accounts Receivable (AR) Aging Analysis                            */}
      {/* ========================================================================= */}
      {!isLoading && activeTab === 'AGING' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-xs">
            <h2 className="text-sm font-bold text-neutral-900 mb-1">
              Qarzdorlik Muddati Bo'yicha Tahlil (AR Aging Buckets)
            </h2>
            <p className="text-xs text-neutral-500">
              To'lovlar eng eski qarzni birinchi yopadi (FIFO). Import qilingan, sanasi noma'lum boshlang'ich qarz alohida ustunda — unga kechikish kuni o'ylab topilmaydi.
            </p>
          </div>

          <TableToolbar
            search={reportSearch}
            onSearch={setReportSearch}
            searchPlaceholder="Mijoz yoki agent…"
            selects={[
              { label: 'Agent', value: agingAgent, onChange: setAgingAgent, allLabel: 'Barcha agentlar', options: [...agingAgents.map(a => ({ value: a, label: a })), { value: '__none', label: 'Agent biriktirilmagan' }] },
              { label: 'Muddat', value: agingBucket, onChange: setAgingBucket, allLabel: 'Barcha muddatlar', options: Object.entries(agingBucketLabels).map(([value, label]) => ({ value, label: `${label} qarzi borlar` })) }
            ]}
            count={visibleAging.length}
            onReset={() => { setReportSearch(''); setAgingAgent(''); setAgingBucket(''); }}
          />

          <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-xs">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-neutral-200 text-left text-xs">
                <thead className="bg-neutral-50 text-neutral-500">
                  <tr>
                    <th className="px-4 py-3 font-semibold uppercase">Mijoz / Agent</th>
                    <th className="px-4 py-3 font-semibold uppercase text-right">Joriy Qarz</th>
                    <th className="px-4 py-3 font-semibold uppercase text-right text-emerald-700">0 - 30 kun</th>
                    <th className="px-4 py-3 font-semibold uppercase text-right text-amber-700">31 - 60 kun</th>
                    <th className="px-4 py-3 font-semibold uppercase text-right text-orange-700">61 - 90 kun</th>
                    <th className="px-4 py-3 font-semibold uppercase text-right text-red-700">90+ kun</th>
                    <th className="px-4 py-3 font-semibold uppercase text-right text-neutral-500">Sanasi noma’lum</th>
                    <th className="px-4 py-3 font-semibold uppercase text-center">Eng eski qarz</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200 bg-white">
                  {visibleAging.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-neutral-400">
                        {agingRows.length ? 'Filtrga mos qarzdor yo‘q' : 'Qarzdor mijozlar mavjud emas'}
                      </td>
                    </tr>
                  ) : (
                    visibleAging.map((row) => (
                      <tr key={row.customer_id} className="hover:bg-neutral-50/80">
                        <td className="px-4 py-3 font-medium text-neutral-900">
                          <div>{row.customer_name}</div>
                          <span className="text-[10px] text-neutral-400">{row.agent_name || 'Agent biriktirilmagan'}</span>
                        </td>
                        <td className="px-4 py-3 text-right font-bold text-red-600">
                          {row.current_debt.toLocaleString()} UZS
                        </td>
                        <td className="px-4 py-3 text-right text-neutral-800">
                          {row.bucket_0_30 > 0 ? row.bucket_0_30.toLocaleString() : '-'}
                        </td>
                        <td className="px-4 py-3 text-right text-amber-700 font-medium">
                          {row.bucket_31_60 > 0 ? row.bucket_31_60.toLocaleString() : '-'}
                        </td>
                        <td className="px-4 py-3 text-right text-orange-700 font-medium">
                          {row.bucket_61_90 > 0 ? row.bucket_61_90.toLocaleString() : '-'}
                        </td>
                        <td className="px-4 py-3 text-right text-red-700 font-bold">
                          {row.bucket_90_plus > 0 ? row.bucket_90_plus.toLocaleString() : '-'}
                        </td>
                        <td className="px-4 py-3 text-right text-neutral-500">
                          {row.bucket_unknown > 0 ? row.bucket_unknown.toLocaleString() : '-'}
                        </td>
                        <td className="px-4 py-3 text-center text-neutral-500 font-mono text-[11px]">
                          {row.oldest_debt_date ? `${row.oldest_debt_date} (${row.oldest_debt_days} kun)` : '-'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 4: Balance Sheet & Cashflow                                           */}
      {/* ========================================================================= */}
      {!isLoading && activeTab === 'BALANCE' && balanceData && (
        <div className="space-y-6">
          {/* Quick summary cards: Kirim, Chiqim, Naqd Qoldiq, Bank, Sof Pul Oqimi */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-4 shadow-xs">
              <span className="text-[11px] font-black uppercase tracking-wider text-emerald-800">Jami Kirim</span>
              <div className="mt-2 text-lg font-black text-emerald-950">
                {(balanceData.cashflow?.total_inflow || 0).toLocaleString()} UZS
              </div>
              <p className="text-[10px] text-emerald-700 mt-1">Savdo va Nasiya tushumlari</p>
            </div>

            <div className="rounded-2xl border border-rose-200 bg-rose-50/50 p-4 shadow-xs">
              <span className="text-[11px] font-black uppercase tracking-wider text-rose-800">Jami Chiqim</span>
              <div className="mt-2 text-lg font-black text-rose-950">
                {(balanceData.cashflow?.total_outflow || 0).toLocaleString()} UZS
              </div>
              <p className="text-[10px] text-rose-700 mt-1">Xarajatlar va oyliklar</p>
            </div>

            <div className="rounded-2xl border-2 border-amber-300 bg-amber-50/70 p-4 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-black uppercase tracking-wider text-amber-900">Naqd Qoldiq</span>
                <span className="px-1.5 py-0.5 rounded bg-amber-200 text-amber-950 text-[9px] font-black">KASSA</span>
              </div>
              <div className="mt-2 text-lg font-black text-amber-950">
                {amt(balanceData.assets.cash_in_registers)}
              </div>
              <p className="text-[10px] text-amber-800 mt-1 font-semibold">Kassadagi amaldagi naqd pul</p>
            </div>

            <div className="rounded-2xl border border-blue-200 bg-blue-50/50 p-4 shadow-xs">
              <span className="text-[11px] font-black uppercase tracking-wider text-blue-800">Bank & Terminal</span>
              <div className="mt-2 text-lg font-black text-blue-950">
                {amt(balanceData.assets.bank_balances)}
              </div>
              <p className="text-[10px] text-blue-700 mt-1">Hisobraqam va kartalar</p>
            </div>

            <div className="rounded-2xl border border-indigo-200 bg-indigo-50/50 p-4 shadow-xs">
              <span className="text-[11px] font-black uppercase tracking-wider text-indigo-800">Sof Pul Oqimi</span>
              <div className={`mt-2 text-lg font-black ${(balanceData.cashflow?.net_flow || 0) >= 0 ? 'text-indigo-950' : 'text-rose-700'}`}>
                {((balanceData.cashflow?.net_flow || 0) >= 0 ? '+' : '') + (balanceData.cashflow?.net_flow || 0).toLocaleString()} UZS
              </div>
              <p className="text-[10px] text-indigo-700 mt-1">Kirim minus chiqim</p>
            </div>
          </div>

          {/* Core Balance Triplets: Assets, Liabilities, Equity */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* Assets */}
            <div className="bg-white rounded-2xl border border-neutral-200 shadow-xs overflow-hidden flex flex-col">
              <div className="p-4 bg-indigo-50 border-b border-indigo-100 flex items-center justify-between">
                <span className="text-xs font-bold text-indigo-950 uppercase tracking-wider">Aktivlar (Mablag'lar)</span>
                <span className="text-xs font-semibold text-indigo-700 bg-indigo-100 px-2 py-0.5 rounded-md">
                  {amt(balanceData.assets.total_assets)}
                </span>
              </div>
              <div className="p-4 space-y-3 text-xs flex-1">
                <div className="flex justify-between py-1 border-b border-neutral-100">
                  <span className="text-neutral-600">Kassadagi naqd pullar:</span>
                  <span className="font-bold text-neutral-900">{amt(balanceData.assets.cash_in_registers)}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-neutral-100">
                  <span className="text-neutral-600">Bank va terminal:</span>
                  <span className="font-bold text-neutral-900">{amt(balanceData.assets.bank_balances)}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-neutral-100">
                  <span className="text-neutral-600">Mijozlar qarzdorligi (Nasiya):</span>
                  <span className="font-bold text-indigo-600">{amt(balanceData.assets.accounts_receivable)}</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-neutral-600">Ombor tovar zaxirasi:</span>
                  <span className="font-bold text-emerald-600">{amt(balanceData.assets.inventory_value)}</span>
                </div>
              </div>
            </div>

            {/* Liabilities */}
            <div className="bg-white rounded-2xl border border-neutral-200 shadow-xs overflow-hidden flex flex-col">
              <div className="p-4 bg-rose-50 border-b border-rose-100 flex items-center justify-between">
                <span className="text-xs font-bold text-rose-950 uppercase tracking-wider">Majburiyatlar (Qarzlar)</span>
                <span className="text-xs font-semibold text-rose-700 bg-rose-100 px-2 py-0.5 rounded-md">
                  {amt(balanceData.liabilities.total_liabilities)}
                </span>
              </div>
              <div className="p-4 space-y-3 text-xs flex-1">
                <div className="flex justify-between py-1 border-b border-neutral-100">
                  <span className="text-neutral-600">Yetkazib beruvchilardan qarz:</span>
                  <span className="font-bold text-rose-600">{amt(balanceData.liabilities.accounts_payable)}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-neutral-100">
                  <span className="text-neutral-600">Xodimlar oylik majburiyati:</span>
                  <span className="font-bold text-amber-600">{amt(balanceData.liabilities.payroll_liabilities)}</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-neutral-600">Mijozlar avanslari:</span>
                  <span className="font-bold text-neutral-700">{amt(balanceData.liabilities.customer_prepayments)}</span>
                </div>
              </div>
            </div>

            {/* Net Equity */}
            <div className="bg-white rounded-2xl border border-neutral-200 shadow-xs overflow-hidden flex flex-col">
              <div className="p-4 bg-emerald-50 border-b border-emerald-100 flex items-center justify-between">
                <span className="text-xs font-bold text-emerald-950 uppercase tracking-wider">Xususiy Kapital (Sof Mulk)</span>
                <span className="text-xs font-semibold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-md">
                  {amt(balanceData.net_equity)}
                </span>
              </div>
              <div className="p-4 space-y-3 text-xs flex-1">
                <div className="flex justify-between py-1 border-b border-neutral-100">
                  <span className="text-neutral-600">Sof aktivlar (Aktiv - Majburiyat):</span>
                  <span className="font-bold text-emerald-700">{amt(balanceData.net_equity)}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-neutral-100">
                  <span className="text-neutral-600">Joriy likvidlik (Current Ratio):</span>
                  <span className="font-bold text-indigo-700">{balanceData.indicators?.current_ratio == null ? 'noma’lum' : `${balanceData.indicators.current_ratio}x`}</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-neutral-600">Pul vositalari nisbati (Cash Ratio):</span>
                  <span className="font-bold text-emerald-700">{balanceData.indicators?.cash_ratio == null ? 'noma’lum' : `${balanceData.indicators.cash_ratio}x`}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 5: SalesDoctor & SFA Integration Live View                            */}
      {/* ========================================================================= */}
      {!isLoading && activeTab === 'SALESDOCTOR' && salesDoctorData && (
        <div className="space-y-6">
          {/* Header Banner */}
          <div className="rounded-2xl border border-blue-200 bg-white p-5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center space-x-3.5">
              <div className="p-3 bg-blue-50 text-blue-700 rounded-2xl border border-blue-100">
                <Network className="w-6 h-6" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold text-neutral-900">
                    {dName} SFA & Mobil Buyurtmalar Tahlili
                  </h2>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                    salesDoctorData.connected ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                  }`}>
                    {salesDoctorData.connected ? 'Faol / Ulangan' : 'Ulanmagan'}
                  </span>
                </div>
                <p className="text-xs text-neutral-500 mt-0.5">
                  Mobil savdo agentlari tomonidan yig'ilgan buyurtmalar, kassa tushumi va mijozlar balansi
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSyncSalesDoctor}
                disabled={isSyncingSalesDoctor}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition shadow-xs flex items-center gap-1.5 cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isSyncingSalesDoctor ? 'animate-spin' : ''}`} />
                <span>Hozir sinxronlash (Sync)</span>
              </button>

              {onNavigate && (
                <button
                  type="button"
                  onClick={() => onNavigate('integrations')}
                  className="px-3.5 py-2 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 rounded-xl text-xs font-semibold transition"
                >
                  Ulanish sozlamalari
                </button>
              )}
            </div>
          </div>

          {/* 4 Core Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-xs">
              <span className="text-[11px] font-medium uppercase tracking-wider text-neutral-500">{dName} Buyurtmalari</span>
              <p className="mt-2 text-2xl font-bold text-neutral-900">
                {salesDoctorData.stats.totalSalesAmount.toLocaleString()} UZS
              </p>
              <p className="text-[11px] text-neutral-500 mt-0.5">{salesDoctorData.stats.totalOrdersCount} ta savdo hujjati</p>
            </div>

            <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-xs">
              <span className="text-[11px] font-medium uppercase tracking-wider text-neutral-500">Agent Kassa Tushumlari</span>
              <p className="mt-2 text-2xl font-bold text-emerald-600">
                {salesDoctorData.stats.totalPaymentsAmount.toLocaleString()} UZS
              </p>
              <p className="text-[11px] text-emerald-700 mt-0.5">{salesDoctorData.stats.totalPaymentsCount} ta naqd to'lov qabul qilingan</p>
            </div>

            <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-xs">
              <span className="text-[11px] font-medium uppercase tracking-wider text-neutral-500">Sinxronlashgan Mijozlar</span>
              <p className="mt-2 text-2xl font-bold text-blue-600">
                {salesDoctorData.stats.customersCount} ta
              </p>
              <p className="text-[11px] text-neutral-500 mt-0.5">Savdo nuqtalari va do'konlar</p>
            </div>

            <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-xs">
              <span className="text-[11px] font-medium uppercase tracking-wider text-neutral-500">Oxirgi Sinxronizatsiya</span>
              <p className="mt-2 text-sm font-bold font-mono text-neutral-900">
                {salesDoctorData.stats.lastSyncAt ? new Date(salesDoctorData.stats.lastSyncAt).toLocaleTimeString('uz-UZ') : 'Hozir'}
              </p>
              <p className="text-[11px] text-neutral-500 mt-0.5">
                {salesDoctorData.stats.lastSyncAt ? new Date(salesDoctorData.stats.lastSyncAt).toLocaleDateString('uz-UZ') : 'Bugun'}
              </p>
            </div>
          </div>

          {/* Orders Table from SalesDoctor */}
          <div className="rounded-2xl border border-neutral-200 bg-white shadow-xs overflow-hidden">
            <div className="p-4 border-b border-neutral-100 flex items-center justify-between">
              <h3 className="text-xs font-bold text-neutral-900 uppercase tracking-wider">
                {dName} Orqali Kelgan Agent Buyurtmalari
              </h3>
              <span className="text-[11px] text-neutral-500 font-medium">
                {salesDoctorData.recentOrders?.length || 0} ta yozuv
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-neutral-200 text-left text-xs">
                <thead className="bg-neutral-50 text-neutral-500">
                  <tr>
                    <th className="px-4 py-3 font-semibold uppercase">Buyurtma ID</th>
                    <th className="px-4 py-3 font-semibold uppercase">Mijoz / Savdo Nuqtasi</th>
                    <th className="px-4 py-3 font-semibold uppercase">Sana</th>
                    <th className="px-4 py-3 font-semibold uppercase text-right">Summa</th>
                    <th className="px-4 py-3 font-semibold uppercase text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200 bg-white">
                  {(!salesDoctorData.recentOrders || salesDoctorData.recentOrders.length === 0) ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-center text-neutral-400">
                        Hozircha buyurtmalar sinxronizatsiya qilinmagan. "Hozir sinxronlash" tugmasini bosing.
                      </td>
                    </tr>
                  ) : (
                    salesDoctorData.recentOrders.map((ord: any, idx: number) => (
                      <tr key={idx} className="hover:bg-neutral-50/80">
                        <td className="px-4 py-3 font-mono font-bold text-neutral-900">
                          {ord.order_number || ord.external_order_id || ord.id}
                        </td>
                        <td className="px-4 py-3 font-medium text-neutral-800">
                          {ord.customer_name || ord.customer_external_id || 'Mijoz'}
                        </td>
                        <td className="px-4 py-3 font-mono text-neutral-500">
                          {ord.order_date || ord.synced_at?.slice(0, 10)}
                        </td>
                        <td className="px-4 py-3 text-right font-bold text-emerald-600">
                          {(ord.total_sales || ord.total_amount || 0).toLocaleString()} UZS
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className="rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                            {ord.status || 'DELIVERED'}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Payments Table from SalesDoctor */}
          <div className="rounded-2xl border border-neutral-200 bg-white shadow-xs overflow-hidden">
            <div className="p-4 border-b border-neutral-100 flex items-center justify-between">
              <h3 className="text-xs font-bold text-neutral-900 uppercase tracking-wider">
                Agentlar Tomonidan Qabul Qilingan Kassa To'lovlari ({dName} Field Collections)
              </h3>
              <span className="text-[11px] text-neutral-500 font-medium">
                {salesDoctorData.recentPayments?.length || 0} ta to'lov
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-neutral-200 text-left text-xs">
                <thead className="bg-neutral-50 text-neutral-500">
                  <tr>
                    <th className="px-4 py-3 font-semibold uppercase">Kvitansiya ID</th>
                    <th className="px-4 py-3 font-semibold uppercase">Mijoz Kodi</th>
                    <th className="px-4 py-3 font-semibold uppercase">Sana</th>
                    <th className="px-4 py-3 font-semibold uppercase text-right">Summa</th>
                    <th className="px-4 py-3 font-semibold uppercase text-center">Kassa Kirimi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200 bg-white">
                  {(!salesDoctorData.recentPayments || salesDoctorData.recentPayments.length === 0) ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-center text-neutral-400">
                        To'lovlar qayd etilmagan
                      </td>
                    </tr>
                  ) : (
                    salesDoctorData.recentPayments.map((p: any, idx: number) => (
                      <tr key={idx} className="hover:bg-neutral-50/80">
                        <td className="px-4 py-3 font-mono font-bold text-neutral-900">
                          {p.external_payment_id || p.id}
                        </td>
                        <td className="px-4 py-3 font-medium text-neutral-800">
                          {p.customer_code || p.customer_id || 'CUST'}
                        </td>
                        <td className="px-4 py-3 font-mono text-neutral-500">
                          {p.payment_date || p.synced_at?.slice(0, 10)}
                        </td>
                        <td className="px-4 py-3 text-right font-bold text-emerald-600">
                          {(p.amount || 0).toLocaleString()} UZS
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className="rounded bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 border border-emerald-200">
                            Kassaga kirim qilindi
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 6: Notifications & Alerts Log                                         */}
      {/* ========================================================================= */}
      {!isLoading && activeTab === 'NOTIFICATIONS' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-xs flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-neutral-900">
                Telegram & Tizim Bildirishnomalari Jurnali
              </h2>
              <p className="text-xs text-neutral-500">
                Qarzdorlik chegarasi oshishi, kassa tafovutlari va limit buzilishlari xabarnomalari
              </p>
            </div>
            <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">
              Kanal: Telegram Bot (@apex_finance_alerts)
            </span>
          </div>

          <div className="divide-y divide-neutral-200 rounded-xl border border-neutral-200 bg-white shadow-xs">
            {notifications.length === 0 ? (
              <div className="p-8 text-center text-xs text-neutral-400">
                Hech qanday yangi xabarnomalar mavjud emas
              </div>
            ) : (
              notifications.map((n) => (
                <div key={n.id} className="p-4 hover:bg-neutral-50/80 transition flex items-start gap-3">
                  <div className="rounded-lg bg-amber-50 p-2 text-amber-600">
                    <AlertTriangle className="h-4 w-4" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-neutral-900">{n.title}</span>
                      <span className="text-[10px] text-neutral-400 font-mono">
                        {new Date(n.created_at).toLocaleString()}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-neutral-600">{n.content}</p>
                    <div className="mt-2 flex items-center gap-2">
                      <span className="rounded bg-neutral-100 px-2 py-0.5 text-[10px] font-semibold text-neutral-600">
                        {n.channel_type}
                      </span>
                      <span className="rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
                        Yuborilgan ({n.recipient})
                      </span>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};
