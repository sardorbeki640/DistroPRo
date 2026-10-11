import React, { useState, useEffect, useCallback } from 'react';
import { localToday } from '../../utils/date';
import { 
  FolderOpen, 
  Calendar, 
  Plus, 
  CheckCircle2, 
  Lock, 
  Unlock, 
  ArrowLeft, 
  DollarSign, 
  ShoppingCart, 
  CreditCard, 
  Truck, 
  TrendingDown, 
  RotateCcw, 
  ClipboardList, 
  RefreshCw, 
  AlertTriangle,
  ArrowRight,
  User,
  MapPin,
  FileSpreadsheet,
  Download,
  Search,
  Check,
  X
} from 'lucide-react';
import { api } from '../../services/api.ts';
import { ExportButton, exportTableXlsx, inDateRange } from '../common/TableToolbar.tsx';
import {
  AuthUser, 
  DailyFileItem, 
  DailyDossierData, 
  DailyOrderEntry, 
  CashTransaction, 
  Expense, 
  Customer, 
  Employee 
} from '../../types.ts';

interface DailyFilesViewProps {
  user: AuthUser | null;
  onNavigateToCash?: () => void;
}

type DossierTab = 'orders' | 'collections' | 'trips' | 'expenses' | 'returns' | 'closing';

export const DailyFilesView: React.FC<DailyFilesViewProps> = ({ user }) => {
  const [files, setFiles] = useState<DailyFileItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [activeDossierId, setActiveDossierId] = useState<string | null>(null);
  const [dossierData, setDossierData] = useState<DailyDossierData | null>(null);
  const [dossierLoading, setDossierLoading] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<DossierTab>('orders');

  // Modals & Action States
  const [showOpenDayModal, setShowOpenDayModal] = useState<boolean>(false);
  const [openDate, setOpenDate] = useState<string>(localToday());
  const [openAdjustment, setOpenAdjustment] = useState<string>('');
  const [actionLoading, setActionLoading] = useState<boolean>(false);
  const [feedbackMsg, setFeedbackMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Sub-action Modals
  const [showAddOrderModal, setShowAddOrderModal] = useState<boolean>(false);
  const [showDebtCollectModal, setShowDebtCollectModal] = useState<boolean>(false);
  const [showAddTripModal, setShowAddTripModal] = useState<boolean>(false);
  const [showAddExpenseModal, setShowAddExpenseModal] = useState<boolean>(false);
  const [showReturnModal, setShowReturnModal] = useState<boolean>(false);
  const [showCloseModal, setShowCloseModal] = useState<boolean>(false);

  // Order form state
  const [orderForm, setOrderForm] = useState({
    customer_id: '',
    agent_id: '',
    order_number: '',
    sale_amount: '',
    cash_payment: '',
    terminal_payment: '',
    click_payment: '',
    credit_amount: '',
    carried_forward_amount: '',
    note: ''
  });

  // Debt collection form
  const [debtForm, setDebtForm] = useState({
    customer_id: '',
    amount: '',
    payment_method: 'CASH',
    description: ''
  });

  // Delivery trip form
  // Rate empty = the driver's own trip rate from their pay scheme (Xodimlar → oylik sxemasi).
  const [tripForm, setTripForm] = useState<{ employee_id: string; zone: string; rate_applied: number | ''; units_completed: number; cargo_summary: string; notes: string }>({
    employee_id: '',
    zone: '',
    rate_applied: '',
    units_completed: 1,
    cargo_summary: 'Standart yetkazish',
    notes: ''
  });

  // Expense form
  const [expenseForm, setExpenseForm] = useState({
    category_id: '',
    employee_id: '',
    amount: '',
    payment_method: 'CASH',
    comment: ''
  });

  // Return form
  const [returnForm, setReturnForm] = useState({
    customer_id: '',
    agent_id: '',
    amount: '',
    payment_impact: 'CASH_REFUND',
    reason: ''
  });

  // Close Day form
  const [closeForm, setCloseForm] = useState({
    actual_cash: '',
    reason: '',
    notes: ''
  });

  // Filter search
  const [searchFilter, setSearchFilter] = useState<string>('');
  const [filesFrom, setFilesFrom] = useState<string>('');
  const [filesTo, setFilesTo] = useState<string>('');
  const [filesStatus, setFilesStatus] = useState<string>('');

  const loadFiles = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getDailyFilesList();
      setFiles(res.files || []);
    } catch (err: any) {
      console.error('Error loading daily files:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  const loadDossier = useCallback(async (cashDayId: string) => {
    setDossierLoading(true);
    try {
      const res = await api.getDailyDossier(cashDayId);
      setDossierData(res.dossier);
      setActiveDossierId(cashDayId);
    } catch (err: any) {
      setFeedbackMsg({ type: 'error', text: err.message || 'Faylni ochishda xatolik yuz berdi.' });
    } finally {
      setDossierLoading(false);
    }
  }, []);

  const handleOpenOrCreateDay = async () => {
    if (!openDate) return;
    setActionLoading(true);
    try {
      // Find register ID
      const registers = dossierData?.masterData?.registers || [];
      const regId = registers[0]?.id || 'reg-main-01';

      const res = await api.openCashDay({
        register_id: regId,
        date: openDate,
        manual_opening_adjustment: openAdjustment === '' ? undefined : Number(openAdjustment)
      });

      setShowOpenDayModal(false);
      setOpenAdjustment('');
      setFeedbackMsg({ type: 'success', text: `${openDate} sanasi uchun kunlik fayl muvaffaqiyatli ochildi.` });
      await loadFiles();
      if (res.cashDay?.id) {
        await loadDossier(res.cashDay.id);
      }
    } catch (err: any) {
      setFeedbackMsg({ type: 'error', text: err.message || 'Kunlik faylni ochishda xatolik.' });
    } finally {
      setActionLoading(false);
    }
  };

  const handleReopenDay = async () => {
    if (!activeDossierId) return;
    // Only a director (cash:correct) can reopen; the server checks the role and audits the reason.
    const reason = (prompt('Yopilgan kunlik faylni qayta ochish sababi (audit jurnaliga yoziladi):') || '').trim();
    if (reason.length < 5) {
      if (reason) setFeedbackMsg({ type: 'error', text: 'Sabab kamida 5 belgi bo‘lishi kerak.' });
      return;
    }
    setActionLoading(true);
    try {
      await api.reopenDailyFile(activeDossierId, reason);
      setFeedbackMsg({ type: 'success', text: 'Kunlik fayl qayta ochildi! Endi ma\'lumotlarni tahrirlashingiz mumkin.' });
      await loadDossier(activeDossierId);
      await loadFiles();
    } catch (err: any) {
      setFeedbackMsg({ type: 'error', text: err.message || 'Faylni qayta ochishda xatolik.' });
    } finally {
      setActionLoading(false);
    }
  };

  // Add order directly to this day file
  const handleAddOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dossierData || !activeDossierId) return;
    const sale = Number(orderForm.sale_amount) || 0;
    const cash = Number(orderForm.cash_payment) || 0;
    const term = Number(orderForm.terminal_payment) || 0;
    const clk = Number(orderForm.click_payment) || 0;
    const cred = Number(orderForm.credit_amount) || 0;

    if (sale <= 0) {
      alert('Savdo summasini kiriting!');
      return;
    }
    if (cash + term + clk + cred > sale) {
      alert('To\'lovlar yig\'indisi umumiy savdo summasidan oshib ketishi mumkin emas!');
      return;
    }

    setActionLoading(true);
    try {
      await api.createDailyOrder({
        cash_day_id: activeDossierId,
        customer_id: orderForm.customer_id,
        agent_id: orderForm.agent_id || undefined,
        order_number: orderForm.order_number || `ORD-${Date.now().toString().slice(-6)}`,
        order_date: dossierData.day.date,
        sale_amount: sale,
        cash_payment: cash,
        terminal_payment: term,
        click_payment: clk,
        credit_amount: cred,
        carried_forward_amount: Number(orderForm.carried_forward_amount) || 0,
        note: orderForm.note
      });

      setShowAddOrderModal(false);
      setOrderForm({
        customer_id: '',
        agent_id: '',
        order_number: '',
        sale_amount: '',
        cash_payment: '',
        terminal_payment: '',
        click_payment: '',
        credit_amount: '',
        carried_forward_amount: '',
        note: ''
      });
      setFeedbackMsg({ type: 'success', text: 'Buyurtma va to\'lovlar kunlik faylga muvaffaqiyatli saqlandi!' });
      await loadDossier(activeDossierId);
      await loadFiles();
    } catch (err: any) {
      alert(err.message || 'Xatolik yuz berdi');
    } finally {
      setActionLoading(false);
    }
  };

  // Collect debt into this day file
  const handleCollectDebt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dossierData || !activeDossierId) return;
    const amt = Number(debtForm.amount);
    if (!debtForm.customer_id || amt <= 0) {
      alert('Mijoz va to\'lov summasini kiriting');
      return;
    }

    setActionLoading(true);
    try {
      await api.recordCreditCollection({
        cash_day_id: activeDossierId,
        customer_id: debtForm.customer_id,
        amount: amt,
        payment_method: debtForm.payment_method,
        description: debtForm.description || 'Mijozdan qarz undirish'
      });

      setShowDebtCollectModal(false);
      setDebtForm({ customer_id: '', amount: '', payment_method: 'CASH', description: '' });
      setFeedbackMsg({ type: 'success', text: 'Qarz to\'lovi muvaffaqiyatli qabul qilindi va kassa balansiga qo\'shildi!' });
      await loadDossier(activeDossierId);
      await loadFiles();
    } catch (err: any) {
      alert(err.message || 'Qarz undirishda xatolik');
    } finally {
      setActionLoading(false);
    }
  };

  // Add delivery trip into this day file
  const handleAddTrip = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dossierData || !activeDossierId) return;
    if (!tripForm.employee_id) {
      alert('Dostavchik (haydovchi) tanlang');
      return;
    }

    setActionLoading(true);
    try {
      await api.recordWork({
        employee_id: tripForm.employee_id,
        unit_type: 'TRIP',
        units: Number(tripForm.units_completed) || 1,
        ...(tripForm.rate_applied !== '' && Number(tripForm.rate_applied) > 0 ? { rate: Number(tripForm.rate_applied) } : {}),
        date: dossierData.day.date,
        zone_name: tripForm.zone.trim() || undefined,
        note: `${tripForm.cargo_summary} ${tripForm.notes}`.trim()
      });

      setShowAddTripModal(false);
      setFeedbackMsg({ type: 'success', text: 'Yetkazib berish reysi muvaffaqiyatli saqlandi va haydovchi oyligiga hisoblandi!' });
      await loadDossier(activeDossierId);
      await loadFiles();
    } catch (err: any) {
      alert(err.message || 'Reysni saqlashda xatolik');
    } finally {
      setActionLoading(false);
    }
  };

  // Add expense into this day file
  const handleAddExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dossierData || !activeDossierId) return;
    const amt = Number(expenseForm.amount);
    if (!expenseForm.category_id || amt <= 0) {
      alert('Kategoriya va xarajat summasini kiriting');
      return;
    }

    setActionLoading(true);
    try {
      await api.createExpense({
        category_id: expenseForm.category_id,
        is_company_expense: !expenseForm.employee_id,
        employee_ids: expenseForm.employee_id ? [expenseForm.employee_id] : undefined,
        amount: amt,
        payment_method: expenseForm.payment_method,
        date: dossierData.day.date,
        comment: expenseForm.comment,
        confirm_immediately: true
      });

      setShowAddExpenseModal(false);
      setExpenseForm({ category_id: '', employee_id: '', amount: '', payment_method: 'CASH', comment: '' });
      setFeedbackMsg({ type: 'success', text: 'Kunlik xarajat saqlandi va kassa chiqimiga kiritildi!' });
      await loadDossier(activeDossierId);
      await loadFiles();
    } catch (err: any) {
      alert(err.message || 'Xarajatni saqlashda xatolik');
    } finally {
      setActionLoading(false);
    }
  };

  // Add return into this day file
  const handleAddReturn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dossierData || !activeDossierId) return;
    const amt = Number(returnForm.amount);
    if (!returnForm.customer_id || amt <= 0) {
      alert('Mijoz va vozvrat summasini kiriting');
      return;
    }

    setActionLoading(true);
    try {
      await api.recordReturn({
        cash_day_id: activeDossierId,
        customer_id: returnForm.customer_id,
        agent_id: returnForm.agent_id || undefined,
        amount: amt,
        payment_impact: returnForm.payment_impact as any,
        date: dossierData.day.date,
        reason: returnForm.reason || 'Mahsulot qaytarildi'
      });

      setShowReturnModal(false);
      setReturnForm({ customer_id: '', agent_id: '', amount: '', payment_impact: 'CASH_REFUND', reason: '' });
      setFeedbackMsg({ type: 'success', text: 'Mahsulot vozvrati qayd etildi!' });
      await loadDossier(activeDossierId);
      await loadFiles();
    } catch (err: any) {
      alert(err.message || 'Vozvrat kiritishda xatolik');
    } finally {
      setActionLoading(false);
    }
  };

  // Close this day file
  const handleCloseDay = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dossierData || !activeDossierId) return;
    const actualCash = Number(closeForm.actual_cash);
    if (isNaN(actualCash) || actualCash < 0) {
      alert('Kassadagi faktik naqd pul summasini kiriting');
      return;
    }

    const calculatedBalance = dossierData.summary.calculated_cash_balance;
    const diff = actualCash - calculatedBalance;
    if (diff !== 0 && (!closeForm.reason || closeForm.reason.trim().length < 3)) {
      alert(`Kassa qoldig'ida ${diff > 0 ? '+' : ''}${diff.toLocaleString()} UZS farq bor. Sabab / izohni kiritishingiz shart!`);
      return;
    }

    setActionLoading(true);
    try {
      const closeResult = await api.closeCashDay({
        cash_day_id: activeDossierId,
        actual_cash: actualCash,
        reason: closeForm.reason || 'Kunlik fayl yopildi',
        notes: closeForm.notes
      });

      setShowCloseModal(false);
      setFeedbackMsg({ type: 'success', text: closeResult.message || 'Kassa kuni yopildi' });
      await loadDossier(activeDossierId);
      await loadFiles();
    } catch (err: any) {
      alert(err.message || 'Kunlik faylni yopishda xatolik');
    } finally {
      setActionLoading(false);
    }
  };

  const filteredFiles = files.filter(f => inDateRange(f.date, filesFrom, filesTo) && (!filesStatus || f.status === filesStatus)).filter(f =>
    f.date.includes(searchFilter) ||
    (f.opened_by_name || '').toLowerCase().includes(searchFilter.toLowerCase()) ||
    (f.status === 'OPEN' ? 'ochiq' : 'yopilgan').includes(searchFilter.toLowerCase())
  );

  return (
    <div className="space-y-6 pb-12">
      {/* Toast / Notification Banner */}
      {feedbackMsg && (
        <div className={`p-4 rounded-xl flex items-center justify-between text-sm font-medium shadow-sm transition-all ${
          feedbackMsg.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-rose-50 text-rose-800 border border-rose-200'
        }`}>
          <div className="flex items-center gap-2">
            {feedbackMsg.type === 'success' ? <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" /> : <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0" />}
            <span>{feedbackMsg.text}</span>
          </div>
          <button onClick={() => setFeedbackMsg(null)} className="text-zinc-500 hover:text-zinc-700">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* TOP HEADER */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-zinc-200/80 shadow-sm">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-violet-600 text-white shadow-md shadow-violet-200">
              <FolderOpen className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-zinc-900">
                Kunlik Yagona Fayllar (Barchasi Bittada)
              </h1>
              <p className="text-sm text-zinc-500 mt-0.5">
                Har bir kun uchun bitta yagona fayl — Buyurtmalar, Kassa, Rasxod, Dostavka va Svodka bitta ishchi joyda
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {activeDossierId ? (
            <button
              onClick={() => {
                setActiveDossierId(null);
                setDossierData(null);
                loadFiles();
              }}
              className="px-4 py-2.5 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 rounded-xl font-medium text-sm flex items-center gap-2 transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
              Kunlik Fayllar Ro'yxatiga Qaytish
            </button>
          ) : (
            <>
              <button
                onClick={() => {
                  const today = localToday();
                  const existingToday = files.find(f => f.date === today);
                  if (existingToday) {
                    loadDossier(existingToday.id);
                  } else {
                    setOpenDate(today);
                    setShowOpenDayModal(true);
                  }
                }}
                className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-medium text-sm flex items-center gap-2 transition-colors shadow-sm cursor-pointer"
              >
                <Calendar className="w-4 h-4" />
                Bugungi Faylga O'tish ({localToday()})
              </button>

              <button
                onClick={() => {
                  setOpenDate(localToday());
                  setShowOpenDayModal(true);
                }}
                className="px-4 py-2.5 bg-violet-600 hover:bg-violet-700 text-white rounded-xl font-medium text-sm flex items-center gap-2 transition-colors shadow-sm cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                Kunlik Fayl Ochish / Tanlash
              </button>
            </>
          )}
        </div>
      </div>

      {/* VIEW MODE A: DAILY FILES LIST */}
      {!activeDossierId && (
        <div className="space-y-6">
          {/* Quick Metrics Bar */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white p-4 rounded-xl border border-zinc-200 shadow-sm">
              <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Jami Kunlik Fayllar</span>
              <div className="text-2xl font-bold text-zinc-900 mt-1">{files.length} ta sana</div>
              <span className="text-xs text-zinc-400 mt-1 block">Arxiv va joriy kunlar</span>
            </div>

            <div className="bg-white p-4 rounded-xl border border-zinc-200 shadow-sm">
              <span className="text-xs font-medium text-emerald-600 uppercase tracking-wider">Faol (Ochiq) Kunlar</span>
              <div className="text-2xl font-bold text-emerald-600 mt-1">
                {files.filter(f => f.status === 'OPEN').length} ta
              </div>
              <span className="text-xs text-zinc-400 mt-1 block">Hozirda ish jarayonida</span>
            </div>

            <div className="bg-white p-4 rounded-xl border border-zinc-200 shadow-sm">
              <span className="text-xs font-medium text-violet-600 uppercase tracking-wider">Jami Savdo & Tushum</span>
              <div className="text-xl font-bold text-zinc-900 mt-1 truncate">
                {files.reduce((acc, f) => acc + (f.total_sales || 0), 0).toLocaleString()} <span className="text-xs font-normal text-zinc-500">UZS</span>
              </div>
              <span className="text-xs text-zinc-400 mt-1 block">Kunlik fayllar umumiy savdosi</span>
            </div>

            <div className="bg-white p-4 rounded-xl border border-zinc-200 shadow-sm">
              <span className="text-xs font-medium text-blue-600 uppercase tracking-wider">Jami Bajarilgan Reyslar</span>
              <div className="text-2xl font-bold text-blue-600 mt-1">
                {files.reduce((acc, f) => acc + (f.trips_count || 0), 0)} ta reys
              </div>
              <span className="text-xs text-zinc-400 mt-1 block">Dostavka yetkazishlari</span>
            </div>
          </div>

          {/* Files List Table */}
          <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-zinc-200 flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <ClipboardList className="w-5 h-5 text-zinc-500" />
                <h3 className="font-semibold text-zinc-900">Barcha Kunlik Ishchi Fayllar Ro'yxati</h3>
                <span className="text-xs bg-zinc-100 text-zinc-600 px-2 py-0.5 rounded-full font-medium">
                  {filteredFiles.length} ta
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <select value={filesStatus} onChange={e => setFilesStatus(e.target.value)} className="h-8 px-2 text-xs bg-zinc-50 border border-zinc-200 rounded-lg">
                  <option value="">Barcha holatlar</option>
                  <option value="OPEN">Ochiq</option>
                  <option value="CLOSED">Yopilgan</option>
                </select>
                <input type="date" value={filesFrom} onChange={e => setFilesFrom(e.target.value)} title="dan" className="h-8 px-2 text-xs bg-zinc-50 border border-zinc-200 rounded-lg" />
                <input type="date" value={filesTo} onChange={e => setFilesTo(e.target.value)} title="gacha" className="h-8 px-2 text-xs bg-zinc-50 border border-zinc-200 rounded-lg" />
                <ExportButton className="!h-8" onExport={() => exportTableXlsx({
                  fileName: 'Kunlik_fayllar',
                  title: 'Kunlik ishchi fayllar',
                  columns: [
                    { header: 'Sana', key: 'date', type: 'date' }, { header: 'Holat', key: 'status_label', width: 10 }, { header: 'Kassir', key: 'opened_by_name', width: 20 },
                    { header: 'Boshlang‘ich qoldiq', key: 'opening_balance', type: 'money' }, { header: 'Zakazlar', key: 'orders_count', type: 'number', total: true },
                    { header: 'Savdo', key: 'total_sales', type: 'money', total: true }, { header: 'Naqd', key: 'cash_total', type: 'money', total: true },
                    { header: 'Terminal', key: 'terminal_total', type: 'money', total: true }, { header: 'Click', key: 'click_total', type: 'money', total: true },
                    { header: 'Nasiya', key: 'credit_total', type: 'money', total: true }, { header: 'Nasiyadan kirim', key: 'credit_collections', type: 'money', total: true },
                    { header: 'Xarajat', key: 'expenses_total', type: 'money', total: true }, { header: 'Yopilish qoldig‘i', key: 'closing_balance', type: 'money' }, { header: 'Farq', key: 'difference', type: 'money' }
                  ],
                  rows: filteredFiles.map(f => ({ ...f, status_label: f.status === 'OPEN' ? 'Ochiq' : 'Yopilgan' })),
                  filters: [searchFilter && `qidiruv: "${searchFilter}"`, filesStatus && (filesStatus === 'OPEN' ? 'faqat ochiq' : 'faqat yopilgan'), (filesFrom || filesTo) && `davr: ${filesFrom || '…'} — ${filesTo || '…'}`]
                })} />
                <div className="relative">
                  <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Sana yoki xodim bo'yicha qidiruv..."
                    value={searchFilter}
                    onChange={(e) => setSearchFilter(e.target.value)}
                    className="pl-9 pr-3 py-1.5 text-xs bg-zinc-50 border border-zinc-200 rounded-lg w-64 focus:outline-none focus:ring-1 focus:ring-violet-500"
                  />
                </div>
                <button
                  onClick={loadFiles}
                  className="p-1.5 text-zinc-500 hover:text-zinc-800 bg-zinc-100 rounded-lg transition-colors cursor-pointer"
                  title="Yangilash"
                >
                  <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-zinc-50/80 border-b border-zinc-200 text-zinc-500 font-semibold uppercase tracking-wider">
                    <th className="py-3 px-4">Sana & Fayl Holati</th>
                    <th className="py-3 px-4">Mas'ul Kassir</th>
                    <th className="py-3 px-4 text-right">Boshlang'ich Qoldiq</th>
                    <th className="py-3 px-4 text-right">Kunlik Savdo</th>
                    <th className="py-3 px-4 text-right">Naqd Tushum</th>
                    <th className="py-3 px-4 text-right">Terminal / Click</th>
                    <th className="py-3 px-4 text-right">Rasxodlar</th>
                    <th className="py-3 px-4 text-center">Dostavka (Reys)</th>
                    <th className="py-3 px-4 text-right">Kassa Sof Qoldiq</th>
                    <th className="py-3 px-4 text-center">Amal</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200">
                  {loading ? (
                    <tr>
                      <td colSpan={10} className="py-12 text-center text-zinc-400">
                        <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-violet-500" />
                        Kunlik fayllar yuklanmoqda...
                      </td>
                    </tr>
                  ) : filteredFiles.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="py-12 text-center text-zinc-500">
                        Hozircha hech qanday kunlik fayl ochilmagan.
                        <div className="mt-3">
                          <button
                            onClick={() => {
                              setOpenDate(localToday());
                              setShowOpenDayModal(true);
                            }}
                            className="px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-xs font-medium cursor-pointer"
                          >
                            + Birinchi kunlik faylni ochish
                          </button>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    filteredFiles.map((f) => {
                      const isToday = f.date === localToday();
                      const isOpen = f.status === 'OPEN';
                      return (
                        <tr 
                          key={f.id} 
                          className={`hover:bg-zinc-50/90 transition-colors ${isOpen ? 'bg-emerald-50/15' : ''}`}
                        >
                          <td className="py-3.5 px-4">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-zinc-900 text-sm">{f.date}</span>
                              {isToday && (
                                <span className="px-1.5 py-0.5 text-[10px] font-bold bg-violet-100 text-violet-700 rounded-md">
                                  BUGUN
                                </span>
                              )}
                              {isOpen ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold bg-emerald-100 text-emerald-800 rounded-full">
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                                  OCHIQ
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold bg-zinc-100 text-zinc-600 rounded-full">
                                  <Lock className="w-3 h-3 text-zinc-400" />
                                  YOPILGAN
                                </span>
                              )}
                            </div>
                            <span className="text-[11px] text-zinc-400 block mt-0.5">{f.register_name}</span>
                          </td>

                          <td className="py-3.5 px-4 font-medium text-zinc-700">
                            {f.opened_by_name}
                          </td>

                          <td className="py-3.5 px-4 text-right font-medium text-zinc-800">
                            {f.opening_balance.toLocaleString()} UZS
                          </td>

                          <td className="py-3.5 px-4 text-right">
                            <div className="font-bold text-zinc-900">{f.total_sales.toLocaleString()} UZS</div>
                            <span className="text-[11px] text-zinc-400">{f.orders_count} ta buyurtma</span>
                          </td>

                          <td className="py-3.5 px-4 text-right font-semibold text-emerald-600">
                            +{f.cash_total.toLocaleString()} UZS
                          </td>

                          <td className="py-3.5 px-4 text-right">
                            <div className="text-zinc-800 font-medium">T: {f.terminal_total.toLocaleString()}</div>
                            <div className="text-zinc-500 text-[11px]">C: {f.click_total.toLocaleString()}</div>
                          </td>

                          <td className="py-3.5 px-4 text-right font-semibold text-rose-600">
                            {f.expenses_total > 0 ? `-${f.expenses_total.toLocaleString()} UZS` : '0 UZS'}
                          </td>

                          <td className="py-3.5 px-4 text-center">
                            {f.trips_count > 0 ? (
                              <span className="px-2 py-0.5 bg-blue-50 text-blue-700 font-medium rounded-md text-[11px]">
                                {f.trips_count} ta ({f.trips_total.toLocaleString()} UZS)
                              </span>
                            ) : (
                              <span className="text-zinc-400">—</span>
                            )}
                          </td>

                          <td className="py-3.5 px-4 text-right">
                            <div className="font-bold text-zinc-900 text-sm">
                              {(f.status === 'CLOSED' ? (f.actual_closing_balance ?? f.closing_balance) : f.calculated_closing_balance || f.closing_balance).toLocaleString()} UZS
                            </div>
                            {f.difference !== 0 && f.status === 'CLOSED' && (
                              <span className={`text-[10px] font-bold ${f.difference > 0 ? 'text-blue-600' : 'text-rose-600'}`}>
                                Farq: {f.difference > 0 ? '+' : ''}{f.difference.toLocaleString()}
                              </span>
                            )}
                          </td>

                          <td className="py-3.5 px-4 text-center">
                            <button
                              onClick={() => loadDossier(f.id)}
                              className="px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white rounded-lg font-medium text-xs inline-flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer"
                            >
                              <span>Faylni Ochish</span>
                              <ArrowRight className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* VIEW MODE B: INSIDE THE SINGLE DAILY FILE DOSSIER */}
      {activeDossierId && dossierData && (
        <div className="space-y-6">
          {/* DAY FILE HERO HEADER */}
          <div className="bg-white rounded-2xl border border-zinc-200/90 shadow-sm p-6">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-zinc-100 pb-5">
              <div className="flex items-center gap-4">
                <div className={`p-3.5 rounded-2xl ${
                  dossierData.day.status === 'OPEN' ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-200' : 'bg-zinc-700 text-white shadow-md'
                }`}>
                  {dossierData.day.status === 'OPEN' ? <Unlock className="w-6 h-6" /> : <Lock className="w-6 h-6" />}
                </div>

                <div>
                  <div className="flex items-center gap-3">
                    <h2 className="text-2xl font-black text-zinc-900 tracking-tight">
                      {dossierData.day.date} — Kunlik Ishchi Fayli
                    </h2>
                    {dossierData.day.status === 'OPEN' ? (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                        FAOL KASSA KUNI (OCHIQ)
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-zinc-200 text-zinc-700">
                        <Lock className="w-3.5 h-3.5" />
                        YOPILGAN VA TASDIQLANGAN
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-zinc-500 mt-1">
                    Barcha operatsiyalar ushbu sana uchun bittada birlashtirilgan. Kassa registri: {dossierData.day.register_id}
                  </p>
                </div>
              </div>

              {/* Day Actions */}
              <div className="flex items-center gap-2">
                {dossierData.day.status === 'OPEN' ? (
                  <>
                    <button
                      onClick={() => setShowCloseModal(true)}
                      className="px-4 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-sm transition-colors cursor-pointer"
                    >
                      <Lock className="w-4 h-4" />
                      Kunlik Faylni Yopish (Z-Hisobot)
                    </button>
                  </>
                ) : (
                  <button
                    onClick={handleReopenDay}
                    className="px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-sm transition-colors cursor-pointer"
                  >
                    <Unlock className="w-4 h-4" />
                    Faylni Qayta Ochish (Tahrirlash uchun)
                  </button>
                )}

                <button
                  onClick={() => loadDossier(activeDossierId)}
                  className="p-2.5 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 rounded-xl transition-colors cursor-pointer"
                  title="Faylni yangilash"
                >
                  <RefreshCw className={`w-4 h-4 ${dossierLoading ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </div>

            {/* Quick KPI Strip */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 pt-5 text-xs">
              <div className="bg-zinc-50 p-3 rounded-xl border border-zinc-200/70">
                <span className="text-zinc-500 block font-medium">Boshlang'ich Qoldiq</span>
                <span className="text-sm font-bold text-zinc-900 block mt-0.5">
                  {dossierData.day.opening_balance.toLocaleString()} UZS
                </span>
                <span className="text-[10px] text-zinc-400">Oldingi kundan o'tgan</span>
              </div>

              <div className="bg-zinc-50 p-3 rounded-xl border border-zinc-200/70">
                <span className="text-zinc-500 block font-medium">Jami Savdo (Reestr)</span>
                <span className="text-sm font-bold text-violet-700 block mt-0.5">
                  {dossierData.summary.total_sales.toLocaleString()} UZS
                </span>
                <span className="text-[10px] text-zinc-400">{dossierData.orders.length} ta buyurtma</span>
              </div>

              <div className="bg-zinc-50 p-3 rounded-xl border border-zinc-200/70">
                <span className="text-emerald-700 block font-medium">Kassaga Naqd Tushum</span>
                <span className="text-sm font-bold text-emerald-600 block mt-0.5">
                  +{dossierData.summary.cash.toLocaleString()} UZS
                </span>
                <span className="text-[10px] text-emerald-600/70">Naqd to'lovlar</span>
              </div>

              <div className="bg-zinc-50 p-3 rounded-xl border border-zinc-200/70">
                <span className="text-blue-700 block font-medium">Terminal & Click</span>
                <span className="text-sm font-bold text-blue-600 block mt-0.5">
                  +{(dossierData.summary.terminal + dossierData.summary.click).toLocaleString()} UZS
                </span>
                <span className="text-[10px] text-zinc-400">Bank hisobiga</span>
              </div>

              <div className="bg-zinc-50 p-3 rounded-xl border border-zinc-200/70">
                <span className="text-rose-700 block font-medium">Kunlik Rasxodlar</span>
                <span className="text-sm font-bold text-rose-600 block mt-0.5">
                  -{dossierData.summary.expense.toLocaleString()} UZS
                </span>
                <span className="text-[10px] text-zinc-400">{dossierData.expenses.length} ta xarajat</span>
              </div>

              <div className="bg-violet-50 p-3 rounded-xl border border-violet-200">
                <span className="text-violet-800 block font-bold">Sof Naqd Kassa</span>
                <span className="text-base font-black text-violet-900 block mt-0.5">
                  {dossierData.summary.calculated_cash_balance.toLocaleString()} UZS
                </span>
                <span className="text-[10px] text-violet-600">Kassadagi kutilayotgan pul</span>
              </div>
            </div>
          </div>

          {/* UNIFIED DAY WORKSPACE TABS */}
          <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
            {/* Tabs Header */}
            <div className="flex items-center gap-1 border-b border-zinc-200 px-4 bg-zinc-50/60 overflow-x-auto">
              <button
                onClick={() => setActiveTab('orders')}
                className={`py-3.5 px-4 font-semibold text-xs flex items-center gap-2 border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
                  activeTab === 'orders' 
                    ? 'border-violet-600 text-violet-700 bg-white shadow-xs rounded-t-lg' 
                    : 'border-transparent text-zinc-500 hover:text-zinc-800'
                }`}
              >
                <ShoppingCart className="w-4 h-4" />
                <span>1. Buyurtmalar & Savdo</span>
                <span className="px-1.5 py-0.2 bg-zinc-200 text-zinc-700 rounded-full text-[10px]">
                  {dossierData.orders.length}
                </span>
              </button>

              <button
                onClick={() => setActiveTab('collections')}
                className={`py-3.5 px-4 font-semibold text-xs flex items-center gap-2 border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
                  activeTab === 'collections' 
                    ? 'border-violet-600 text-violet-700 bg-white shadow-xs rounded-t-lg' 
                    : 'border-transparent text-zinc-500 hover:text-zinc-800'
                }`}
              >
                <CreditCard className="w-4 h-4" />
                <span>2. Kassa Tushumlari & Qarz Undirish</span>
                <span className="px-1.5 py-0.2 bg-zinc-200 text-zinc-700 rounded-full text-[10px]">
                  {dossierData.transactions.length}
                </span>
              </button>

              <button
                onClick={() => setActiveTab('trips')}
                className={`py-3.5 px-4 font-semibold text-xs flex items-center gap-2 border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
                  activeTab === 'trips' 
                    ? 'border-violet-600 text-violet-700 bg-white shadow-xs rounded-t-lg' 
                    : 'border-transparent text-zinc-500 hover:text-zinc-800'
                }`}
              >
                <Truck className="w-4 h-4" />
                <span>3. Dostavka & Reyslar</span>
                <span className="px-1.5 py-0.2 bg-zinc-200 text-zinc-700 rounded-full text-[10px]">
                  {dossierData.trips.length}
                </span>
              </button>

              <button
                onClick={() => setActiveTab('expenses')}
                className={`py-3.5 px-4 font-semibold text-xs flex items-center gap-2 border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
                  activeTab === 'expenses' 
                    ? 'border-violet-600 text-violet-700 bg-white shadow-xs rounded-t-lg' 
                    : 'border-transparent text-zinc-500 hover:text-zinc-800'
                }`}
              >
                <TrendingDown className="w-4 h-4" />
                <span>4. Kunlik Rasxodlar</span>
                <span className="px-1.5 py-0.2 bg-zinc-200 text-zinc-700 rounded-full text-[10px]">
                  {dossierData.expenses.length}
                </span>
              </button>

              <button
                onClick={() => setActiveTab('returns')}
                className={`py-3.5 px-4 font-semibold text-xs flex items-center gap-2 border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
                  activeTab === 'returns' 
                    ? 'border-violet-600 text-violet-700 bg-white shadow-xs rounded-t-lg' 
                    : 'border-transparent text-zinc-500 hover:text-zinc-800'
                }`}
              >
                <RotateCcw className="w-4 h-4" />
                <span>5. Vozvrat & Surilgan Yuklar</span>
                <span className="px-1.5 py-0.2 bg-zinc-200 text-zinc-700 rounded-full text-[10px]">
                  {dossierData.returns.length}
                </span>
              </button>

              <button
                onClick={() => setActiveTab('closing')}
                className={`py-3.5 px-4 font-semibold text-xs flex items-center gap-2 border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
                  activeTab === 'closing' 
                    ? 'border-violet-600 text-violet-700 bg-white shadow-xs rounded-t-lg' 
                    : 'border-transparent text-zinc-500 hover:text-zinc-800'
                }`}
              >
                <ClipboardList className="w-4 h-4" />
                <span>6. Kunlik Svodka & Z-Hisobot</span>
              </button>
            </div>

            {/* TAB 1: ORDERS & SALES */}
            {activeTab === 'orders' && (
              <div className="p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-bold text-zinc-900 text-sm">Kunlik Buyurtmalar Reestri</h3>
                    <p className="text-xs text-zinc-500">Mijozlar, savdo summasi va to'lov turlari bo'yicha to'liq hisobot</p>
                  </div>
                  {dossierData.day.status === 'OPEN' && (
                    <button
                      onClick={() => setShowAddOrderModal(true)}
                      className="px-3.5 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-xl text-xs font-semibold flex items-center gap-2 shadow-sm transition-colors cursor-pointer"
                    >
                      <Plus className="w-4 h-4" />
                      Buyurtma Qo'shish
                    </button>
                  )}
                </div>

                <div className="overflow-x-auto border border-zinc-200 rounded-xl">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="bg-zinc-50 border-b border-zinc-200 text-zinc-500 font-semibold uppercase tracking-wider">
                        <th className="py-2.5 px-3"># Buyurtma</th>
                        <th className="py-2.5 px-3">Mijoz / Do'kon</th>
                        <th className="py-2.5 px-3">Agent</th>
                        <th className="py-2.5 px-3 text-right">Savdo Summasi</th>
                        <th className="py-2.5 px-3 text-right">Naqd</th>
                        <th className="py-2.5 px-3 text-right">Terminal</th>
                        <th className="py-2.5 px-3 text-right">Click</th>
                        <th className="py-2.5 px-3 text-right">Nasiya (Qarz)</th>
                        <th className="py-2.5 px-3 text-right">Kun Surildi</th>
                        <th className="py-2.5 px-3">Izoh</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-200">
                      {dossierData.orders.length === 0 ? (
                        <tr>
                          <td colSpan={10} className="py-8 text-center text-zinc-400">
                            Ushbu kunlik faylda hali buyurtmalar kiritilmagan.
                          </td>
                        </tr>
                      ) : (
                        dossierData.orders.map((o) => {
                          const cust = dossierData.masterData.customers.find(c => c.id === o.customer_id);
                          const ag = dossierData.masterData.agents.find(a => a.id === o.agent_id);
                          const cashVal = (o as any).cash_amount ?? o.cash_payment ?? 0;
                          const termVal = (o as any).terminal_amount ?? o.terminal_payment ?? 0;
                          const clickVal = (o as any).click_amount ?? o.click_payment ?? 0;

                          return (
                            <tr key={o.id} className="hover:bg-zinc-50/80">
                              <td className="py-2.5 px-3 font-semibold text-zinc-900">{o.order_number}</td>
                              <td className="py-2.5 px-3">
                                <span className="font-medium text-zinc-800">{cust?.name || o.customer_id}</span>
                                {cust?.code && <span className="text-[10px] text-zinc-400 block">{cust.code}</span>}
                              </td>
                              <td className="py-2.5 px-3 text-zinc-600">{ag?.full_name || '—'}</td>
                              <td className="py-2.5 px-3 text-right font-bold text-zinc-900">{o.sale_amount.toLocaleString()} UZS</td>
                              <td className="py-2.5 px-3 text-right font-medium text-emerald-600">{cashVal > 0 ? cashVal.toLocaleString() : '—'}</td>
                              <td className="py-2.5 px-3 text-right font-medium text-blue-600">{termVal > 0 ? termVal.toLocaleString() : '—'}</td>
                              <td className="py-2.5 px-3 text-right font-medium text-purple-600">{clickVal > 0 ? clickVal.toLocaleString() : '—'}</td>
                              <td className="py-2.5 px-3 text-right font-medium text-amber-600">{o.credit_amount ? o.credit_amount.toLocaleString() : '—'}</td>
                              <td className="py-2.5 px-3 text-right font-medium text-indigo-600">{o.carried_forward_amount ? o.carried_forward_amount.toLocaleString() : '—'}</td>
                              <td className="py-2.5 px-3 text-zinc-500 max-w-[150px] truncate">{o.note || '—'}</td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* TAB 2: COLLECTIONS & TRANSACTIONS */}
            {activeTab === 'collections' && (
              <div className="p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-bold text-zinc-900 text-sm">Kassa Tranzaksiyalari & Inkassatsiya</h3>
                    <p className="text-xs text-zinc-500">Naqd, karta, click tushumlari va mijozlardan qarz yig'ish</p>
                  </div>
                  {dossierData.day.status === 'OPEN' && (
                    <button
                      onClick={() => setShowDebtCollectModal(true)}
                      className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold flex items-center gap-2 shadow-sm transition-colors cursor-pointer"
                    >
                      <Plus className="w-4 h-4" />
                      Mijozdan Qarz Undirish (Inkassatsiya)
                    </button>
                  )}
                </div>

                <div className="overflow-x-auto border border-zinc-200 rounded-xl">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="bg-zinc-50 border-b border-zinc-200 text-zinc-500 font-semibold uppercase tracking-wider">
                        <th className="py-2.5 px-3">Vaqti</th>
                        <th className="py-2.5 px-3">Turi</th>
                        <th className="py-2.5 px-3">Mijoz / Tomon</th>
                        <th className="py-2.5 px-3">To'lov Usuli</th>
                        <th className="py-2.5 px-3 text-right">Summa</th>
                        <th className="py-2.5 px-3">Izoh</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-200">
                      {dossierData.transactions.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="py-8 text-center text-zinc-400">Tranzaksiyalar mavjud emas</td>
                        </tr>
                      ) : (
                        dossierData.transactions.map((tx) => {
                          const cust = dossierData.masterData.customers.find(c => c.id === tx.customer_id);
                          return (
                            <tr key={tx.id} className="hover:bg-zinc-50/80">
                              <td className="py-2.5 px-3 text-zinc-500">{new Date(tx.created_at).toLocaleTimeString()}</td>
                              <td className="py-2.5 px-3">
                                <span className={`px-2 py-0.5 rounded-full font-bold text-[10px] ${
                                  tx.transaction_type === 'CREDIT_COLLECTION' ? 'bg-emerald-100 text-emerald-800' :
                                  tx.transaction_type === 'EXPENSE' ? 'bg-rose-100 text-rose-800' :
                                  tx.transaction_type === 'RETURN' ? 'bg-amber-100 text-amber-800' : 'bg-zinc-100 text-zinc-800'
                                }`}>
                                  {tx.transaction_type}
                                </span>
                              </td>
                              <td className="py-2.5 px-3 font-medium text-zinc-800">{cust?.name || tx.customer_id || '—'}</td>
                              <td className="py-2.5 px-3 font-semibold text-zinc-700">{tx.payment_method}</td>
                              <td className="py-2.5 px-3 text-right font-bold text-zinc-900">{tx.amount.toLocaleString()} UZS</td>
                              <td className="py-2.5 px-3 text-zinc-500">{tx.description}</td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* TAB 3: TRIPS & DELIVERIES */}
            {activeTab === 'trips' && (
              <div className="p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-bold text-zinc-900 text-sm">Dostavka & Reyslar (Haydovchilar Ishbay Maoshi)</h3>
                    <p className="text-xs text-zinc-500">Ushbu sana uchun haydovchilar yetkazib berish reyslari va zonalari</p>
                  </div>
                  {dossierData.day.status === 'OPEN' && (
                    <button
                      onClick={() => setShowAddTripModal(true)}
                      className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold flex items-center gap-2 shadow-sm transition-colors cursor-pointer"
                    >
                      <Plus className="w-4 h-4" />
                      Reys (Dostavka) Kiritish
                    </button>
                  )}
                </div>

                <div className="overflow-x-auto border border-zinc-200 rounded-xl">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="bg-zinc-50 border-b border-zinc-200 text-zinc-500 font-semibold uppercase tracking-wider">
                        <th className="py-2.5 px-3">Haydovchi / Dostavchik</th>
                        <th className="py-2.5 px-3">Hudud / Zona</th>
                        <th className="py-2.5 px-3 text-center">Reyslar Soni</th>
                        <th className="py-2.5 px-3 text-right">Reys Stavkasi</th>
                        <th className="py-2.5 px-3 text-right">Hisoblangan Maosh</th>
                        <th className="py-2.5 px-3">Tavsif & Yuk</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-200">
                      {dossierData.trips.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="py-8 text-center text-zinc-400">Bugungi kun uchun hali reyslar kiritilmagan</td>
                        </tr>
                      ) : (
                        dossierData.trips.map((tr) => {
                          const emp = dossierData.masterData.employees.find(e => e.id === tr.employee_id);
                          const total = (tr.units_completed || 1) * (tr.rate_applied || 0);
                          return (
                            <tr key={tr.id} className="hover:bg-zinc-50/80">
                              <td className="py-2.5 px-3 font-semibold text-zinc-900">{emp?.full_name || tr.employee_id}</td>
                              <td className="py-2.5 px-3">
                                <span className="px-2 py-0.5 bg-blue-50 text-blue-700 font-bold rounded-md text-[10px]">
                                  {tr.zone || 'SHAHAR'}
                                </span>
                              </td>
                              <td className="py-2.5 px-3 text-center font-bold">{tr.units_completed || 1} ta</td>
                              <td className="py-2.5 px-3 text-right text-zinc-600">{(tr.rate_applied || 0).toLocaleString()} UZS</td>
                              <td className="py-2.5 px-3 text-right font-bold text-emerald-600">{total.toLocaleString()} UZS</td>
                              <td className="py-2.5 px-3 text-zinc-500">{tr.cargo_summary || tr.notes || '—'}</td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* TAB 4: EXPENSES & LIMITS */}
            {activeTab === 'expenses' && (
              <div className="p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-bold text-zinc-900 text-sm">Kunlik Xarajatlar & Chiqimlar</h3>
                    <p className="text-xs text-zinc-500">Xodim va korxona xarajatlari, oylikdan ushlab qolinadigan limitlar</p>
                  </div>
                  {dossierData.day.status === 'OPEN' && (
                    <button
                      onClick={() => setShowAddExpenseModal(true)}
                      className="px-3.5 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-semibold flex items-center gap-2 shadow-sm transition-colors cursor-pointer"
                    >
                      <Plus className="w-4 h-4" />
                      Xarajat Kiritish
                    </button>
                  )}
                </div>

                <div className="overflow-x-auto border border-zinc-200 rounded-xl">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="bg-zinc-50 border-b border-zinc-200 text-zinc-500 font-semibold uppercase tracking-wider">
                        <th className="py-2.5 px-3">Kategoriya</th>
                        <th className="py-2.5 px-3">Mas'ul Xodim</th>
                        <th className="py-2.5 px-3">To'lov Usuli</th>
                        <th className="py-2.5 px-3 text-right">Summa</th>
                        <th className="py-2.5 px-3">Izoh</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-200">
                      {dossierData.expenses.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="py-8 text-center text-zinc-400">Kunlik xarajatlar yo'q</td>
                        </tr>
                      ) : (
                        dossierData.expenses.map((exp) => {
                          const cat = dossierData.masterData.categories.find(c => c.id === exp.category_id);
                          const allocEmpId = exp.allocations && exp.allocations.length > 0 ? exp.allocations[0]?.employee_id : null;
                          const emp = allocEmpId ? dossierData.masterData.employees.find(e => e.id === allocEmpId) : null;
                          return (
                            <tr key={exp.id} className="hover:bg-zinc-50/80">
                              <td className="py-2.5 px-3 font-semibold text-zinc-900">{cat?.name || 'Xarajat'}</td>
                              <td className="py-2.5 px-3 text-zinc-700">{emp?.full_name || (exp.is_company_expense ? 'Umumiy korxona' : 'Xodim')}</td>
                              <td className="py-2.5 px-3 font-medium text-zinc-600">{exp.payment_method}</td>
                              <td className="py-2.5 px-3 text-right font-bold text-rose-600">-{exp.amount.toLocaleString()} UZS</td>
                              <td className="py-2.5 px-3 text-zinc-500">{exp.comment || '—'}</td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* TAB 5: RETURNS & CARRIED FORWARD */}
            {activeTab === 'returns' && (
              <div className="p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-bold text-zinc-900 text-sm">Vozvrat & Surilgan Yuklar</h3>
                    <p className="text-xs text-zinc-500">Mijozlardan qaytgan tovarlar va ertangi kunga qoldirilgan buyurtmalar</p>
                  </div>
                  {dossierData.day.status === 'OPEN' && (
                    <button
                      onClick={() => setShowReturnModal(true)}
                      className="px-3.5 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-semibold flex items-center gap-2 shadow-sm transition-colors cursor-pointer"
                    >
                      <Plus className="w-4 h-4" />
                      Vozvrat Kiritish
                    </button>
                  )}
                </div>

                <div className="overflow-x-auto border border-zinc-200 rounded-xl">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="bg-zinc-50 border-b border-zinc-200 text-zinc-500 font-semibold uppercase tracking-wider">
                        <th className="py-2.5 px-3">Mijoz</th>
                        <th className="py-2.5 px-3">Ta'sir Turi</th>
                        <th className="py-2.5 px-3 text-right">Summa</th>
                        <th className="py-2.5 px-3">Sababi / Izoh</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-200">
                      {dossierData.returns.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="py-8 text-center text-zinc-400">Qaytgan tovarlar yo'q</td>
                        </tr>
                      ) : (
                        dossierData.returns.map((ret) => {
                          const cust = dossierData.masterData.customers.find(c => c.id === ret.customer_id);
                          return (
                            <tr key={ret.id} className="hover:bg-zinc-50/80">
                              <td className="py-2.5 px-3 font-semibold text-zinc-900">{cust?.name || ret.customer_id}</td>
                              <td className="py-2.5 px-3">
                                <span className="px-2 py-0.5 bg-amber-100 text-amber-800 rounded-md font-bold text-[10px]">
                                  {ret.payment_impact}
                                </span>
                              </td>
                              <td className="py-2.5 px-3 text-right font-bold text-amber-700">{ret.amount.toLocaleString()} UZS</td>
                              <td className="py-2.5 px-3 text-zinc-500">{ret.reason}</td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* TAB 6: CLOSING & Z-REPORT */}
            {activeTab === 'closing' && (
              <div className="p-6 space-y-6">
                <div>
                  <h3 className="font-bold text-zinc-900 text-base">Kunlik Svodka & Z-Hisobot Yakunlari</h3>
                  <p className="text-xs text-zinc-500">Ushbu kun bo'yicha barcha moliyaviy oqimlar hisob-kitobi va kassa solishtiruvi</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Left Column: Totals Table */}
                  <div className="bg-zinc-50 p-5 rounded-xl border border-zinc-200 space-y-3 text-sm">
                    <h4 className="font-bold text-zinc-800 text-xs uppercase tracking-wider mb-2">Hisoblangan Moliyaviy Oqimlar</h4>
                    
                    <div className="flex justify-between py-1 border-b border-zinc-200">
                      <span className="text-zinc-600">Boshlang'ich kassa qoldig'i:</span>
                      <span className="font-semibold text-zinc-900">{dossierData.day.opening_balance.toLocaleString()} UZS</span>
                    </div>

                    <div className="flex justify-between py-1 border-b border-zinc-200 text-emerald-700">
                      <span>Jami naqd tushum (Savdo + Qarzlar):</span>
                      <span className="font-bold">+{dossierData.summary.cash.toLocaleString()} UZS</span>
                    </div>

                    <div className="flex justify-between py-1 border-b border-zinc-200 text-blue-700">
                      <span>Terminal tushumi:</span>
                      <span className="font-semibold">+{dossierData.summary.terminal.toLocaleString()} UZS</span>
                    </div>

                    <div className="flex justify-between py-1 border-b border-zinc-200 text-purple-700">
                      <span>Click / Payme tushumi:</span>
                      <span className="font-semibold">+{dossierData.summary.click.toLocaleString()} UZS</span>
                    </div>

                    <div className="flex justify-between py-1 border-b border-zinc-200 text-amber-700">
                      <span>Nasiya (Mijoz qarzi bo'lib qolgan):</span>
                      <span className="font-semibold">{dossierData.summary.credit.toLocaleString()} UZS</span>
                    </div>

                    <div className="flex justify-between py-1 border-b border-zinc-200 text-rose-700">
                      <span>Kassadan naqd xarajatlar:</span>
                      <span className="font-bold">-{dossierData.summary.expense.toLocaleString()} UZS</span>
                    </div>

                    <div className="flex justify-between py-2 bg-violet-100 px-3 rounded-lg text-violet-900 font-bold text-base mt-2">
                      <span>Hisoblangan Yakuniy Naqd Kassa:</span>
                      <span>{dossierData.summary.calculated_cash_balance.toLocaleString()} UZS</span>
                    </div>
                  </div>

                  {/* Right Column: Actual Cash & Close Form */}
                  <div className="bg-white p-5 rounded-xl border border-zinc-200 space-y-4">
                    <h4 className="font-bold text-zinc-800 text-xs uppercase tracking-wider">Kassa Sanash va Yopish</h4>

                    {dossierData.day.status === 'CLOSED' ? (
                      <div className="p-4 bg-zinc-100 rounded-xl space-y-3">
                        <div className="flex items-center gap-2 text-zinc-700 font-bold text-sm">
                          <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                          <span>Ushbu kunlik fayl yopilgan va qulflangan</span>
                        </div>
                        <div className="text-xs text-zinc-600 space-y-1">
                          <p><strong>Faktik naqd kassa:</strong> {(dossierData.day.actual_closing_balance ?? dossierData.day.closing_balance).toLocaleString()} UZS</p>
                          <p><strong>Kassa farqi:</strong> {dossierData.day.difference > 0 ? `+${dossierData.day.difference.toLocaleString()}` : `${dossierData.day.difference.toLocaleString()}`} UZS</p>
                          {dossierData.day.note && <p><strong>Izoh:</strong> {dossierData.day.note}</p>}
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <p className="text-xs text-zinc-600">
                          Kassadagi haqiqiy naqd pulni sanab kiriting. Hisoblangan qoldiq bilan farq bo'lsa, sababi ko'rsatiladi.
                        </p>

                        <button
                          onClick={() => setShowCloseModal(true)}
                          className="w-full py-3 bg-rose-600 hover:bg-rose-700 text-white rounded-xl font-bold text-sm shadow-md transition-colors cursor-pointer flex items-center justify-center gap-2"
                        >
                          <Lock className="w-4 h-4" />
                          Kunlik Faylni Yopish va Yakunlash
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL 1: OPEN OR SELECT DAY MODAL */}
      {showOpenDayModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl border border-zinc-200 overflow-hidden">
            <div className="p-5 border-b border-zinc-100 flex items-center justify-between">
              <h3 className="font-bold text-zinc-900 text-base">Kunlik Fayl Tanlash / Ochish</h3>
              <button onClick={() => setShowOpenDayModal(false)} className="text-zinc-400 hover:text-zinc-600 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <p className="text-xs text-zinc-600">
                Har bir sana uchun faqat bitta fayl ochiladi. Agar tanlangan kunda fayl mavjud bo'lsa, o'sha fayl to'g'ridan-to'g'ri ochiladi.
              </p>

              <div>
                <label className="text-xs font-semibold text-zinc-700 block mb-1">Sana</label>
                <input
                  type="date"
                  value={openDate}
                  onChange={(e) => setOpenDate(e.target.value)}
                  className="w-full p-2.5 text-sm bg-zinc-50 border border-zinc-300 rounded-xl focus:ring-2 focus:ring-violet-500"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-zinc-700 block mb-1">
                  Boshlang'ich Qoldiqqa Qo'lda Korreksiya (Ixtiyoriy)
                </label>
                <input
                  type="number"
                  placeholder="Korreksiya bo'lmasa bo'sh qoldiring"
                  value={openAdjustment}
                  onChange={(e) => setOpenAdjustment(e.target.value)}
                  className="w-full p-2.5 text-sm bg-zinc-50 border border-zinc-300 rounded-xl focus:ring-2 focus:ring-violet-500"
                />
                <span className="text-[10px] text-zinc-400 mt-1 block">Standart holda kechagi kassa yopilish qoldig'i avtomatik o'tadi</span>
              </div>
            </div>

            <div className="p-4 bg-zinc-50 border-t border-zinc-100 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowOpenDayModal(false)}
                className="px-4 py-2 text-xs font-medium text-zinc-600 hover:bg-zinc-200 rounded-xl cursor-pointer"
              >
                Bekor qilish
              </button>
              <button
                type="button"
                disabled={actionLoading}
                onClick={handleOpenOrCreateDay}
                className="px-5 py-2 text-xs font-bold bg-violet-600 hover:bg-violet-700 text-white rounded-xl shadow-sm transition-colors cursor-pointer"
              >
                {actionLoading ? 'Ochilmoqda...' : 'Faylni Ochish'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: ADD ORDER MODAL */}
      {showAddOrderModal && dossierData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="bg-white w-full max-w-xl rounded-2xl shadow-2xl border border-zinc-200 overflow-hidden">
            <div className="p-5 border-b border-zinc-100 flex items-center justify-between">
              <h3 className="font-bold text-zinc-900 text-base">Yangi Buyurtma Qo'shish ({dossierData.day.date})</h3>
              <button onClick={() => setShowAddOrderModal(false)} className="text-zinc-400 hover:text-zinc-600 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddOrder}>
              <div className="p-6 space-y-4 max-h-[75vh] overflow-y-auto">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-semibold text-zinc-700 block mb-1">Mijoz / Do'kon *</label>
                    <select
                      required
                      value={orderForm.customer_id}
                      onChange={(e) => setOrderForm({ ...orderForm, customer_id: e.target.value })}
                      className="w-full p-2.5 text-xs bg-zinc-50 border border-zinc-300 rounded-xl"
                    >
                      <option value="">-- Mijozni tanlang --</option>
                      {dossierData.masterData.customers.map(c => (
                        <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-zinc-700 block mb-1">Agent</label>
                    <select
                      value={orderForm.agent_id}
                      onChange={(e) => setOrderForm({ ...orderForm, agent_id: e.target.value })}
                      className="w-full p-2.5 text-xs bg-zinc-50 border border-zinc-300 rounded-xl"
                    >
                      <option value="">-- Agentni tanlang --</option>
                      {dossierData.masterData.agents.map(a => (
                        <option key={a.id} value={a.id}>{a.full_name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-semibold text-zinc-700 block mb-1">Buyurtma Raqami</label>
                    <input
                      type="text"
                      placeholder="ORD-..."
                      value={orderForm.order_number}
                      onChange={(e) => setOrderForm({ ...orderForm, order_number: e.target.value })}
                      className="w-full p-2.5 text-xs bg-zinc-50 border border-zinc-300 rounded-xl"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-zinc-700 block mb-1">Jami Savdo Summasi *</label>
                    <input
                      required
                      type="number"
                      placeholder="0"
                      value={orderForm.sale_amount}
                      onChange={(e) => setOrderForm({ ...orderForm, sale_amount: e.target.value })}
                      className="w-full p-2.5 text-xs bg-zinc-50 border border-zinc-300 rounded-xl font-bold"
                    />
                  </div>
                </div>

                {/* Payments */}
                <div className="p-4 bg-zinc-50 rounded-xl border border-zinc-200/80 space-y-3">
                  <span className="text-xs font-bold text-zinc-800 block">To'lov Taqsimoti</span>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div>
                      <label className="text-[11px] font-medium text-emerald-700 block">Naqd</label>
                      <input
                        type="number"
                        placeholder="0"
                        value={orderForm.cash_payment}
                        onChange={(e) => setOrderForm({ ...orderForm, cash_payment: e.target.value })}
                        className="w-full p-2 text-xs bg-white border border-zinc-300 rounded-lg font-semibold text-emerald-700"
                      />
                    </div>

                    <div>
                      <label className="text-[11px] font-medium text-blue-700 block">Terminal</label>
                      <input
                        type="number"
                        placeholder="0"
                        value={orderForm.terminal_payment}
                        onChange={(e) => setOrderForm({ ...orderForm, terminal_payment: e.target.value })}
                        className="w-full p-2 text-xs bg-white border border-zinc-300 rounded-lg font-semibold text-blue-700"
                      />
                    </div>

                    <div>
                      <label className="text-[11px] font-medium text-purple-700 block">Click</label>
                      <input
                        type="number"
                        placeholder="0"
                        value={orderForm.click_payment}
                        onChange={(e) => setOrderForm({ ...orderForm, click_payment: e.target.value })}
                        className="w-full p-2 text-xs bg-white border border-zinc-300 rounded-lg font-semibold text-purple-700"
                      />
                    </div>

                    <div>
                      <label className="text-[11px] font-medium text-amber-700 block">Nasiya (Qarz)</label>
                      <input
                        type="number"
                        placeholder="0"
                        value={orderForm.credit_amount}
                        onChange={(e) => setOrderForm({ ...orderForm, credit_amount: e.target.value })}
                        className="w-full p-2 text-xs bg-white border border-zinc-300 rounded-lg font-semibold text-amber-700"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-zinc-700 block mb-1">Izoh</label>
                  <input
                    type="text"
                    placeholder="Qo'shimcha ma'lumot..."
                    value={orderForm.note}
                    onChange={(e) => setOrderForm({ ...orderForm, note: e.target.value })}
                    className="w-full p-2.5 text-xs bg-zinc-50 border border-zinc-300 rounded-xl"
                  />
                </div>
              </div>

              <div className="p-4 bg-zinc-50 border-t border-zinc-100 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddOrderModal(false)}
                  className="px-4 py-2 text-xs font-medium text-zinc-600 hover:bg-zinc-200 rounded-xl cursor-pointer"
                >
                  Bekor qilish
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-5 py-2 text-xs font-bold bg-violet-600 hover:bg-violet-700 text-white rounded-xl shadow-sm cursor-pointer"
                >
                  {actionLoading ? 'Saqlanmoqda...' : 'Buyurtmani Saqlash'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: COLLECT DEBT MODAL */}
      {showDebtCollectModal && dossierData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl border border-zinc-200 overflow-hidden">
            <div className="p-5 border-b border-zinc-100 flex items-center justify-between">
              <h3 className="font-bold text-zinc-900 text-base">Mijozdan Qarz Undirish (Inkassatsiya)</h3>
              <button onClick={() => setShowDebtCollectModal(false)} className="text-zinc-400 hover:text-zinc-600 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCollectDebt}>
              <div className="p-6 space-y-4">
                <div>
                  <label className="text-xs font-semibold text-zinc-700 block mb-1">Mijoz *</label>
                  <select
                    required
                    value={debtForm.customer_id}
                    onChange={(e) => setDebtForm({ ...debtForm, customer_id: e.target.value })}
                    className="w-full p-2.5 text-xs bg-zinc-50 border border-zinc-300 rounded-xl"
                  >
                    <option value="">-- Mijozni tanlang --</option>
                    {dossierData.masterData.customers.map(c => (
                      <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-xs font-semibold text-zinc-700 block mb-1">Undirilgan Summa *</label>
                  <input
                    required
                    type="number"
                    placeholder="0"
                    value={debtForm.amount}
                    onChange={(e) => setDebtForm({ ...debtForm, amount: e.target.value })}
                    className="w-full p-2.5 text-xs bg-zinc-50 border border-zinc-300 rounded-xl font-bold text-emerald-700"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-zinc-700 block mb-1">To'lov Usuli</label>
                  <select
                    value={debtForm.payment_method}
                    onChange={(e) => setDebtForm({ ...debtForm, payment_method: e.target.value })}
                    className="w-full p-2.5 text-xs bg-zinc-50 border border-zinc-300 rounded-xl"
                  >
                    <option value="CASH">Naqd pul (Kassaga kiradi)</option>
                    <option value="TERMINAL">Terminal (Karta)</option>
                    <option value="CLICK">Click / Payme</option>
                    <option value="BANK_TRANSFER">Bank o'tkazmasi</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs font-semibold text-zinc-700 block mb-1">Izoh / Kvitansiya raqami</label>
                  <input
                    type="text"
                    placeholder="Oldingi nasiyani so'ndirish..."
                    value={debtForm.description}
                    onChange={(e) => setDebtForm({ ...debtForm, description: e.target.value })}
                    className="w-full p-2.5 text-xs bg-zinc-50 border border-zinc-300 rounded-xl"
                  />
                </div>
              </div>

              <div className="p-4 bg-zinc-50 border-t border-zinc-100 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowDebtCollectModal(false)}
                  className="px-4 py-2 text-xs font-medium text-zinc-600 hover:bg-zinc-200 rounded-xl cursor-pointer"
                >
                  Bekor qilish
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-5 py-2 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl shadow-sm cursor-pointer"
                >
                  {actionLoading ? 'Qabul qilinmoqda...' : 'Qarz To\'lovini Qabul Qilish'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 4: ADD TRIP MODAL */}
      {showAddTripModal && dossierData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl border border-zinc-200 overflow-hidden">
            <div className="p-5 border-b border-zinc-100 flex items-center justify-between">
              <h3 className="font-bold text-zinc-900 text-base">Dostavka Reysi Kiritish ({dossierData.day.date})</h3>
              <button onClick={() => setShowAddTripModal(false)} className="text-zinc-400 hover:text-zinc-600 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddTrip}>
              <div className="p-6 space-y-4">
                <div>
                  <label className="text-xs font-semibold text-zinc-700 block mb-1">Haydovchi / Dostavchik *</label>
                  <select
                    required
                    value={tripForm.employee_id}
                    onChange={(e) => setTripForm({ ...tripForm, employee_id: e.target.value })}
                    className="w-full p-2.5 text-xs bg-zinc-50 border border-zinc-300 rounded-xl"
                  >
                    <option value="">-- Xodimni tanlang --</option>
                    {dossierData.masterData.employees.map(e => (
                      <option key={e.id} value={e.id}>{e.full_name} ({e.position})</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-xs font-semibold text-zinc-700 block mb-1">Yetkazish hududi (ixtiyoriy)</label>
                  <input
                    value={tripForm.zone}
                    onChange={(e) => setTripForm({ ...tripForm, zone: e.target.value })}
                    placeholder="Masalan: Chust, Pop, Kosonsoy"
                    className="w-full p-2.5 text-xs bg-zinc-50 border border-zinc-300 rounded-xl"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-semibold text-zinc-700 block mb-1">Reyslar Soni</label>
                    <input
                      type="number"
                      min={1}
                      value={tripForm.units_completed}
                      onChange={(e) => setTripForm({ ...tripForm, units_completed: Number(e.target.value) })}
                      className="w-full p-2.5 text-xs bg-zinc-50 border border-zinc-300 rounded-xl font-bold"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-zinc-700 block mb-1">Bir reys narxi (UZS)</label>
                    <input
                      type="number"
                      min={0}
                      value={tripForm.rate_applied}
                      placeholder="oylik sxemasidagi tarif"
                      onChange={(e) => setTripForm({ ...tripForm, rate_applied: e.target.value === '' ? '' : Number(e.target.value) })}
                      className="w-full p-2.5 text-xs bg-zinc-50 border border-zinc-300 rounded-xl font-bold text-blue-700"
                    />
                  </div>
                </div>

                <div className="p-3 bg-blue-50 rounded-xl flex items-center justify-between text-xs text-blue-900 font-bold">
                  <span>Jami haydovchiga hisoblanadi:</span>
                  <span>{tripForm.rate_applied !== '' && Number(tripForm.rate_applied) > 0 ? `${(tripForm.units_completed * Number(tripForm.rate_applied)).toLocaleString()} UZS` : 'oylik sxemasidagi reys tarifi bo‘yicha'}</span>
                </div>
              </div>

              <div className="p-4 bg-zinc-50 border-t border-zinc-100 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddTripModal(false)}
                  className="px-4 py-2 text-xs font-medium text-zinc-600 hover:bg-zinc-200 rounded-xl cursor-pointer"
                >
                  Bekor qilish
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-5 py-2 text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-sm cursor-pointer"
                >
                  {actionLoading ? 'Saqlanmoqda...' : 'Reysni Saqlash'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 5: ADD EXPENSE MODAL */}
      {showAddExpenseModal && dossierData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl border border-zinc-200 overflow-hidden">
            <div className="p-5 border-b border-zinc-100 flex items-center justify-between">
              <h3 className="font-bold text-zinc-900 text-base">Kunlik Xarajat Kiritish ({dossierData.day.date})</h3>
              <button onClick={() => setShowAddExpenseModal(false)} className="text-zinc-400 hover:text-zinc-600 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddExpense}>
              <div className="p-6 space-y-4">
                <div>
                  <label className="text-xs font-semibold text-zinc-700 block mb-1">Xarajat Kategoriyasi *</label>
                  <select
                    required
                    value={expenseForm.category_id}
                    onChange={(e) => setExpenseForm({ ...expenseForm, category_id: e.target.value })}
                    className="w-full p-2.5 text-xs bg-zinc-50 border border-zinc-300 rounded-xl"
                  >
                    <option value="">-- Kategoriya tanlang --</option>
                    {dossierData.masterData.categories.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-xs font-semibold text-zinc-700 block mb-1">Xodim (Limit & Oylik hisobi uchun)</label>
                  <select
                    value={expenseForm.employee_id}
                    onChange={(e) => setExpenseForm({ ...expenseForm, employee_id: e.target.value })}
                    className="w-full p-2.5 text-xs bg-zinc-50 border border-zinc-300 rounded-xl"
                  >
                    <option value="">-- Korxona umumiy xarajati --</option>
                    {dossierData.masterData.employees.map(e => (
                      <option key={e.id} value={e.id}>{e.full_name} ({e.position})</option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-semibold text-zinc-700 block mb-1">Summa *</label>
                    <input
                      required
                      type="number"
                      placeholder="0"
                      value={expenseForm.amount}
                      onChange={(e) => setExpenseForm({ ...expenseForm, amount: e.target.value })}
                      className="w-full p-2.5 text-xs bg-zinc-50 border border-zinc-300 rounded-xl font-bold text-rose-600"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-zinc-700 block mb-1">To'lov Usuli</label>
                    <select
                      value={expenseForm.payment_method}
                      onChange={(e) => setExpenseForm({ ...expenseForm, payment_method: e.target.value })}
                      className="w-full p-2.5 text-xs bg-zinc-50 border border-zinc-300 rounded-xl"
                    >
                      <option value="CASH">Naqd kassa</option>
                      <option value="TERMINAL">Karta</option>
                      <option value="CLICK">Click</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-zinc-700 block mb-1">Izoh</label>
                  <input
                    type="text"
                    placeholder="Yoqilg'i, tushlik, xizmat haqi..."
                    value={expenseForm.comment}
                    onChange={(e) => setExpenseForm({ ...expenseForm, comment: e.target.value })}
                    className="w-full p-2.5 text-xs bg-zinc-50 border border-zinc-300 rounded-xl"
                  />
                </div>
              </div>

              <div className="p-4 bg-zinc-50 border-t border-zinc-100 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddExpenseModal(false)}
                  className="px-4 py-2 text-xs font-medium text-zinc-600 hover:bg-zinc-200 rounded-xl cursor-pointer"
                >
                  Bekor qilish
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-5 py-2 text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white rounded-xl shadow-sm cursor-pointer"
                >
                  {actionLoading ? 'Saqlanmoqda...' : 'Xarajatni Kiritish'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 6: ADD RETURN MODAL */}
      {showReturnModal && dossierData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl border border-zinc-200 overflow-hidden">
            <div className="p-5 border-b border-zinc-100 flex items-center justify-between">
              <h3 className="font-bold text-zinc-900 text-base">Mahsulot Vozvrati Kiritish ({dossierData.day.date})</h3>
              <button onClick={() => setShowReturnModal(false)} className="text-zinc-400 hover:text-zinc-600 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddReturn}>
              <div className="p-6 space-y-4">
                <div>
                  <label className="text-xs font-semibold text-zinc-700 block mb-1">Mijoz *</label>
                  <select
                    required
                    value={returnForm.customer_id}
                    onChange={(e) => setReturnForm({ ...returnForm, customer_id: e.target.value })}
                    className="w-full p-2.5 text-xs bg-zinc-50 border border-zinc-300 rounded-xl"
                  >
                    <option value="">-- Mijozni tanlang --</option>
                    {dossierData.masterData.customers.map(c => (
                      <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-semibold text-zinc-700 block mb-1">Summa *</label>
                    <input
                      required
                      type="number"
                      placeholder="0"
                      value={returnForm.amount}
                      onChange={(e) => setReturnForm({ ...returnForm, amount: e.target.value })}
                      className="w-full p-2.5 text-xs bg-zinc-50 border border-zinc-300 rounded-xl font-bold text-amber-700"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-zinc-700 block mb-1">Qaytarish Turi</label>
                    <select
                      value={returnForm.payment_impact}
                      onChange={(e) => setReturnForm({ ...returnForm, payment_impact: e.target.value })}
                      className="w-full p-2.5 text-xs bg-zinc-50 border border-zinc-300 rounded-xl"
                    >
                      <option value="CASH_REFUND">Naqd pul qaytarildi (Kassadan)</option>
                      <option value="BALANCE_CREDIT">Mijoz balansi hisobiga (Qarz kamayadi)</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-zinc-700 block mb-1">Vozvrat Sababi</label>
                  <input
                    type="text"
                    placeholder="Yaroqsiz tovar, ortiqcha yuk..."
                    value={returnForm.reason}
                    onChange={(e) => setReturnForm({ ...returnForm, reason: e.target.value })}
                    className="w-full p-2.5 text-xs bg-zinc-50 border border-zinc-300 rounded-xl"
                  />
                </div>
              </div>

              <div className="p-4 bg-zinc-50 border-t border-zinc-100 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowReturnModal(false)}
                  className="px-4 py-2 text-xs font-medium text-zinc-600 hover:bg-zinc-200 rounded-xl cursor-pointer"
                >
                  Bekor qilish
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-5 py-2 text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white rounded-xl shadow-sm cursor-pointer"
                >
                  {actionLoading ? 'Saqlanmoqda...' : 'Vozvratni Saqlash'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 7: CLOSE DAY FILE MODAL */}
      {showCloseModal && dossierData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl border border-zinc-200 overflow-hidden">
            <div className="p-5 border-b border-zinc-100 flex items-center justify-between">
              <h3 className="font-bold text-zinc-900 text-base">Kunlik Faylni Yopish ({dossierData.day.date})</h3>
              <button onClick={() => setShowCloseModal(false)} className="text-zinc-400 hover:text-zinc-600 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCloseDay}>
              <div className="p-6 space-y-4">
                <div className="p-4 bg-violet-50 rounded-xl text-xs space-y-1 text-violet-900">
                  <div className="flex justify-between font-medium">
                    <span>Kassa bo'yicha hisoblangan qoldiq:</span>
                    <span className="font-bold">{dossierData.summary.calculated_cash_balance.toLocaleString()} UZS</span>
                  </div>
                  <p className="text-[11px] text-violet-700 pt-1">
                    Kassadagi faktik naqd pulni sanab kiriting. Farq aniqlansa, sabab ko'rsatish majburiy.
                  </p>
                </div>

                <div>
                  <label className="text-xs font-semibold text-zinc-700 block mb-1">Faktik Naqd Pul (Kassadagi haqiqiy summa) *</label>
                  <input
                    required
                    type="number"
                    placeholder="0"
                    value={closeForm.actual_cash}
                    onChange={(e) => setCloseForm({ ...closeForm, actual_cash: e.target.value })}
                    className="w-full p-2.5 text-sm bg-zinc-50 border border-zinc-300 rounded-xl font-bold"
                  />
                </div>

                {closeForm.actual_cash !== '' && Number(closeForm.actual_cash) !== dossierData.summary.calculated_cash_balance && (
                  <div>
                    <label className="text-xs font-semibold text-rose-700 block mb-1">
                      Kassa Farqi Sababi (Kamomad yoki Ortiqcha) *
                    </label>
                    <input
                      required
                      type="text"
                      placeholder="Sababni batafsil yozing..."
                      value={closeForm.reason}
                      onChange={(e) => setCloseForm({ ...closeForm, reason: e.target.value })}
                      className="w-full p-2.5 text-xs bg-rose-50 border border-rose-300 rounded-xl text-rose-800"
                    />
                  </div>
                )}

                <div>
                  <label className="text-xs font-semibold text-zinc-700 block mb-1">Yakuniy Izoh / Smena Eslatmasi</label>
                  <textarea
                    rows={2}
                    placeholder="Kun bo'yicha qo'shimcha eslatmalar..."
                    value={closeForm.notes}
                    onChange={(e) => setCloseForm({ ...closeForm, notes: e.target.value })}
                    className="w-full p-2 text-xs bg-zinc-50 border border-zinc-300 rounded-xl"
                  />
                </div>
              </div>

              <div className="p-4 bg-zinc-50 border-t border-zinc-100 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowCloseModal(false)}
                  className="px-4 py-2 text-xs font-medium text-zinc-600 hover:bg-zinc-200 rounded-xl cursor-pointer"
                >
                  Bekor qilish
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-5 py-2 text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white rounded-xl shadow-sm cursor-pointer"
                >
                  {actionLoading ? 'Yopilmoqda...' : 'Kunlik Faylni Yopish'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
