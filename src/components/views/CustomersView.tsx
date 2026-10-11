import React, { useState, useEffect, useMemo } from 'react';
import { localToday } from '../../utils/date';
import { 
  Users, 
  Search, 
  Plus, 
  FileText, 
  CreditCard, 
  AlertTriangle, 
  CheckCircle, 
  ArrowUpRight, 
  ArrowDownLeft, 
  Calendar, 
  Printer, 
  SlidersHorizontal,
  RefreshCw,
  X,
  Send,
  Bell,
  UserCheck,
  MessageSquare,
  Download
} from 'lucide-react';
import { api } from '../../services/api.ts';
import { MultiSelect, picked, pickedLabels } from '../common/MultiSelect.tsx';
import { AuthUser } from '../../types.ts';
import { DebtReminderModal } from '../common/DebtReminderModal.tsx';
import { StatementPrintModal } from '../common/StatementPrintModal.tsx';

interface CustomersViewProps {
  user: AuthUser | null;
}

/** Readable names of customer ledger movements (statement screen and Excel). */
const LEDGER_LABEL: Record<string, string> = {
  SALE: 'Savdo', CREDIT_SALE: 'Nasiya savdo', PAYMENT: 'To‘lov', CASH_PAYMENT: 'Naqd to‘lov', TERMINAL_PAYMENT: 'Terminal to‘lovi',
  CLICK_PAYMENT: 'Click to‘lovi', BANK_TRANSFER_PAYMENT: 'Bank o‘tkazmasi', RETURN: 'Qaytarish', CREDIT_COLLECTION: 'Qarz to‘lovi',
  CARRIED_FORWARD: 'Kun surildi', ADJUSTMENT_IN: 'Tuzatish (+)', ADJUSTMENT_OUT: 'Tuzatish (−)', OPENING_BALANCE: 'Boshlang‘ich qoldiq', WRITE_OFF: 'Hisobdan chiqarish'
};

export const CustomersView: React.FC<CustomersViewProps> = ({ user }) => {
  const [customers, setCustomers] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [search, setSearch] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'DEBT_ONLY' | 'OVER_LIMIT'>('ALL');

  // Modals state
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const [showPaymentModal, setShowPaymentModal] = useState<boolean>(false);
  const [showAdjustmentModal, setShowAdjustmentModal] = useState<boolean>(false);
  const [showCarriedForwardModal, setShowCarriedForwardModal] = useState<boolean>(false);
  const [showStatementModal, setShowStatementModal] = useState<boolean>(false);
  const [showStatementPrintModal, setShowStatementPrintModal] = useState<boolean>(false);
  const [selectedReminderCustomer, setSelectedReminderCustomer] = useState<any>(null);
  const [showReminderModal, setShowReminderModal] = useState<boolean>(false);

  // Selected customer for action
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [statementData, setStatementData] = useState<any>(null);
  const [statementLoading, setStatementLoading] = useState<boolean>(false);
  const [statementFromDate, setStatementFromDate] = useState<string>(
    new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10)
  );
  const [statementToDate, setStatementToDate] = useState<string>(
    localToday()
  );

  // Agent Search & Telegram Overdue Alerts
  const [agentFilter, setAgentFilter] = useState<string>('');
  const [agentsList, setAgentsList] = useState<any[]>([]);
  const [showOverdueModal, setShowOverdueModal] = useState<boolean>(false);
  const [overdueSummary, setOverdueSummary] = useState<any>(null);
  const [overdueLoading, setOverdueLoading] = useState<boolean>(false);
  const [dispatchSuccess, setDispatchSuccess] = useState<string | null>(null);
  const [overdueThresholdDays, setOverdueThresholdDays] = useState<number>(10);

  // Form states
  const [createForm, setCreateForm] = useState({
    name: '',
    code: '',
    phone: '+998 ',
    address: '',
    credit_limit: 0,
    debt_alert_threshold: 0,
    initial_debt: 0
  });

  const [paymentForm, setPaymentForm] = useState({
    customer_id: '',
    amount: 0,
    payment_method: 'CASH',
    comment: ''
  });

  const [adjustmentForm, setAdjustmentForm] = useState({
    customer_id: '',
    amount: 0,
    direction: 'INCREASE_DEBT' as 'INCREASE_DEBT' | 'DECREASE_DEBT',
    reason: ''
  });

  const [carriedForwardForm, setCarriedForwardForm] = useState({
    customer_id: '',
    source_date: localToday(),
    target_date: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
    amount: 0,
    comment: ''
  });

  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const fetchCustomers = async () => {
    setIsLoading(true);
    try {
      const res = await api.getCustomers({ search });
      const custs = res.customers || [];
      setCustomers(custs);

      // Extract unique agents from customers list
      const agMap = new Map();
      for (const c of custs) {
        if (c.agent_id && c.agent_name) {
          agMap.set(c.agent_id, { id: c.agent_id, name: c.agent_name });
        }
      }
      setAgentsList(Array.from(agMap.values()));
    } catch (err: any) {
      console.error('Error fetching customers:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenOverdueModal = async () => {
    setShowOverdueModal(true);
    setOverdueLoading(true);
    setDispatchSuccess(null);
    try {
      const res = await api.getOverdueDebtsSummary(overdueThresholdDays);
      setOverdueSummary(res);
    } catch (err: any) {
      setActionError(err.message || 'Muddati o\'tgan qarzlarni yuklashda xatolik');
    } finally {
      setOverdueLoading(false);
    }
  };

  const handleDispatchTelegram = async () => {
    setOverdueLoading(true);
    try {
      const res = await api.dispatchOverdueDebtsAlert(overdueThresholdDays);
      setDispatchSuccess(res.message || 'Admin Telegram Botiga muvaffaqiyatli xabarnoma yuborildi!');
      const updated = await api.getOverdueDebtsSummary(overdueThresholdDays);
      setOverdueSummary(updated);
    } catch (err: any) {
      setActionError(err.message || 'Telegram botga yuborishda xatolik');
    } finally {
      setOverdueLoading(false);
    }
  };

  useEffect(() => {
    fetchCustomers();
  }, [search]);

  // Summary Metrics
  const metrics = useMemo(() => {
    let totalDebt = 0;
    let debtCustomersCount = 0;
    let overLimitCount = 0;

    for (const c of customers) {
      if (c.closing_balance > 0) {
        totalDebt += c.closing_balance;
        debtCustomersCount++;
      }
      if (c.is_over_limit) {
        overLimitCount++;
      }
    }

    return {
      totalCustomers: customers.length,
      debtCustomersCount,
      totalDebt,
      overLimitCount
    };
  }, [customers]);

  const filteredCustomers = useMemo(() => {
    return customers.filter(c => {
      if (statusFilter === 'DEBT_ONLY' && c.closing_balance <= 0) return false;
      if (statusFilter === 'OVER_LIMIT' && !c.is_over_limit) return false;
      if (agentFilter && !picked(agentFilter).some(a => c.agent_id === a || c.agent_name === a)) return false;
      return true;
    });
  }, [customers, statusFilter, agentFilter]);

  // Thousands of rows at once freeze the page: the table shows a page at a time (Excel still has all).
  const [shown, setShown] = useState(100);
  useEffect(() => { setShown(100); }, [filteredCustomers]);

  // Open statement modal
  const handleOpenStatement = async (customerId: string) => {
    setSelectedCustomerId(customerId);
    setShowStatementModal(true);
    setStatementLoading(true);
    try {
      const res = await api.getCustomerStatement(customerId, statementFromDate, statementToDate);
      setStatementData(res.statement);
    } catch (err: any) {
      setActionError(err.message || 'Akt Sverkani yuklashda xatolik yuz berdi');
    } finally {
      setStatementLoading(false);
    }
  };

  const handleRefreshStatement = async () => {
    if (!selectedCustomerId) return;
    setStatementLoading(true);
    try {
      const res = await api.getCustomerStatement(selectedCustomerId, statementFromDate, statementToDate);
      setStatementData(res.statement);
    } catch (err: any) {
      setActionError(err.message || 'Akt Sverkani yangilashda xatolik');
    } finally {
      setStatementLoading(false);
    }
  };

  const handleOpenReminder = (cust: any) => {
    setSelectedReminderCustomer({
      id: cust.customer_id,
      name: cust.customer_name,
      phone: cust.phone,
      balance: cust.closing_balance,
      daysOverdue: cust.days_overdue || (cust.closing_balance > 0 ? 12 : 0),
      lastPaymentDate: cust.last_payment_date
    });
    setShowReminderModal(true);
  };

  // Submit Handlers
  const handleCreateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionError(null);
    try {
      await api.createCustomer(createForm);
      setActionSuccess('Yangi mijoz muvaffaqiyatli saqlandi');
      setShowCreateModal(false);
      setCreateForm({
        name: '',
        code: '',
        phone: '+998 ',
        address: '',
        credit_limit: 0,
        debt_alert_threshold: 0,
        initial_debt: 0
      });
      fetchCustomers();
    } catch (err: any) {
      setActionError(err.message);
    }
  };

  const fmtDate = (d?: string) => (d ? d.split('-').reverse().join('.') : '');

  /** The customer list exactly as filtered on screen, with debts and totals. */
  const exportCustomersExcel = async () => {
    const statusLabel = (c: any) => c.is_over_limit ? 'Limit oshgan' : c.is_threshold_exceeded ? 'Chegara yaqin' : c.closing_balance > 0 ? 'Nasiya' : c.closing_balance < 0 ? 'Avans' : 'Qarz yo‘q';
    const filters = [
      statusFilter === 'DEBT_ONLY' ? 'faqat qarzdorlar' : statusFilter === 'OVER_LIMIT' ? 'faqat limitdan oshganlar' : 'barcha mijozlar',
      agentFilter ? `agent: ${pickedLabels(agentFilter, agentsList.map(ag => ({ value: ag.id, label: ag.name })))}` : ''
    ].filter(Boolean).join(' · ');
    try {
      await api.downloadXlsx(`Mijozlar_va_nasiya_${localToday()}.xlsx`, [{
        name: 'Mijozlar',
        title: 'Mijozlar va nasiya',
        subtitle: [`Sana: ${fmtDate(localToday())} · ${filters} · ${filteredCustomers.length} ta mijoz`],
        columns: [
          { header: 'Kod', key: 'customer_code', width: 12 },
          { header: 'Mijoz', key: 'customer_name', width: 32 },
          { header: 'Telefon', key: 'phone', width: 15 },
          { header: 'Hudud', key: 'territory_name', width: 16 },
          { header: 'Agent', key: 'agent_name', width: 22 },
          { header: 'Kredit limiti', key: 'credit_limit', type: 'money' },
          { header: 'Qarz (+) / avans (−)', key: 'closing_balance', type: 'money', total: true },
          { header: 'Holat', key: 'status', width: 14 }
        ],
        rows: filteredCustomers.map((c: any) => ({ ...c, credit_limit: c.credit_limit || null, status: statusLabel(c) })),
        totalsLabel: 'JAMI',
        summary: [
          { label: 'Qarzdorlar soni', value: filteredCustomers.filter((c: any) => c.closing_balance > 0).length, type: 'number' },
          { label: 'Jami qarz', value: filteredCustomers.reduce((s: number, c: any) => s + Math.max(0, c.closing_balance || 0), 0) },
          { label: 'Jami avans', value: filteredCustomers.reduce((s: number, c: any) => s + Math.min(0, c.closing_balance || 0), 0) }
        ]
      }]);
    } catch (err: any) {
      setActionError(err.message || 'Excel faylini yuklab bo‘lmadi');
    }
  };

  /** Reconciliation statement (akt sverka) of one customer for the chosen period. */
  const exportStatementExcel = async () => {
    const s = statementData;
    if (!s) return;
    try {
      await api.downloadXlsx(`Akt_sverka_${(s.customer.code || s.customer.name || 'mijoz')}_${statementFromDate}_${statementToDate}.xlsx`, [{
        name: 'Akt sverka',
        title: `Akt sverka: ${s.customer.name}`,
        subtitle: [
          `Davr: ${fmtDate(statementFromDate)} — ${fmtDate(statementToDate)}`,
          `Mijoz: ${s.customer.name}${s.customer.code ? ` · kod ${s.customer.code}` : ''}${s.customer.phone ? ` · tel ${s.customer.phone}` : ''}`,
          ...(s.company?.tax_id ? [`STIR: ${s.company.tax_id}`] : [])
        ],
        columns: [
          { header: 'Sana', key: 'date', type: 'date', width: 11 },
          { header: 'Operatsiya', key: 'type', width: 18 },
          { header: 'Izoh / hujjat', key: 'comment', width: 40 },
          { header: 'Debit (qarz oshdi)', key: 'debit', type: 'money', total: true },
          { header: 'Kredit (qarz kamaydi)', key: 'credit', type: 'money', total: true },
          { header: 'Qoldiq', key: 'running_balance', type: 'money' }
        ],
        rows: s.transactions.map((t: any) => ({
          date: t.date, type: LEDGER_LABEL[t.ledger_type] || t.ledger_type, comment: t.comment || t.reference_id || '',
          debit: t.debit > 0 ? t.debit : null, credit: t.credit > 0 ? t.credit : null, running_balance: t.running_balance
        })),
        totalsLabel: 'Davr aylanmasi',
        summary: [
          { label: 'Boshlang‘ich qoldiq', value: s.opening_balance },
          { label: 'Jami debit (savdo)', value: s.total_debit },
          { label: 'Jami kredit (to‘lov)', value: s.total_credit },
          { label: 'Yakuniy qoldiq', value: s.closing_balance }
        ]
      }]);
    } catch (err: any) {
      setActionError(err.message || 'Excel faylini yuklab bo‘lmadi');
    }
  };

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionError(null);
    try {
      const res: any = await api.recordCustomerPayment({
        customer_id: paymentForm.customer_id,
        amount: Number(paymentForm.amount),
        payment_method: paymentForm.payment_method,
        comment: paymentForm.comment
      });
      setActionSuccess(res?.message || 'To\'lov qabul qilindi');
      setShowPaymentModal(false);
      setPaymentForm({ customer_id: '', amount: 0, payment_method: 'CASH', comment: '' });
      fetchCustomers();
    } catch (err: any) {
      setActionError(err.message);
    }
  };

  const handleRecordAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionError(null);
    try {
      await api.recordCustomerAdjustment({
        customer_id: adjustmentForm.customer_id,
        amount: Number(adjustmentForm.amount),
        direction: adjustmentForm.direction,
        reason: adjustmentForm.reason
      });
      setActionSuccess('Mijoz balansiga rasmiy tuzatish kiritildi');
      setShowAdjustmentModal(false);
      setAdjustmentForm({ customer_id: '', amount: 0, direction: 'INCREASE_DEBT', reason: '' });
      fetchCustomers();
    } catch (err: any) {
      setActionError(err.message);
    }
  };

  const handleRecordCarriedForward = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionError(null);
    try {
      await api.recordCustomerCarriedForward({
        customer_id: carriedForwardForm.customer_id,
        source_date: carriedForwardForm.source_date,
        target_date: carriedForwardForm.target_date,
        amount: Number(carriedForwardForm.amount),
        comment: carriedForwardForm.comment
      });
      setActionSuccess('Kun surish muvaffaqiyatli saqlandi');
      setShowCarriedForwardModal(false);
      fetchCustomers();
    } catch (err: any) {
      setActionError(err.message);
    }
  };

  return (
    <div className="space-y-6">
      {/* Notifications */}
      {actionSuccess && (
        <div className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-emerald-800">
          <div className="flex items-center gap-2">
            <CheckCircle className="h-5 w-5 text-emerald-600" />
            <span className="text-sm font-medium">{actionSuccess}</span>
          </div>
          <button onClick={() => setActionSuccess(null)} className="text-emerald-700 hover:text-emerald-900">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {actionError && (
        <div className="flex items-center justify-between rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-red-600" />
            <span className="text-sm font-medium">{actionError}</span>
          </div>
          <button onClick={() => setActionError(null)} className="text-red-700 hover:text-red-900">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Header & Primary Actions */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-neutral-900">
            Mijozlar & Nasiya Daftari (Akt Sverka)
          </h1>
          <p className="text-xs text-neutral-500">
            Mijozlar balansi, kredit limiti, solishtirma dalolatnomasi va to'lovlar monitoringi
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleOpenOverdueModal}
            className="flex items-center gap-1.5 rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-700 shadow-xs hover:bg-indigo-100"
            title="10 kundan oshgan qarzlar hisoboti va Telegram Botga xabarnoma yuborish"
          >
            <Send className="h-4 w-4 text-indigo-600" />
            <span>Telegram Bot Alert (10+ kun)</span>
          </button>

          <button
            onClick={exportCustomersExcel}
            className="flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-xs font-semibold text-neutral-700 shadow-xs hover:bg-neutral-50"
          >
            <Download className="h-4 w-4 text-neutral-500" />
            <span>Excel</span>
          </button>

          <button
            onClick={() => setShowPaymentModal(true)}
            className="flex items-center gap-1.5 rounded-lg border border-emerald-600 bg-emerald-600 px-3 py-2 text-xs font-semibold text-white shadow-xs hover:bg-emerald-700"
          >
            <CreditCard className="h-4 w-4" />
            <span>To'lov qabul qilish</span>
          </button>

          <button
            onClick={() => setShowCarriedForwardModal(true)}
            className="flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-xs font-semibold text-neutral-700 shadow-xs hover:bg-neutral-50"
          >
            <Calendar className="h-4 w-4 text-neutral-500" />
            <span>Kun surish</span>
          </button>

          <button
            onClick={() => setShowAdjustmentModal(true)}
            className="flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-xs font-semibold text-neutral-700 shadow-xs hover:bg-neutral-50"
          >
            <SlidersHorizontal className="h-4 w-4 text-neutral-500" />
            <span>Tuzatish</span>
          </button>

          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-1.5 rounded-lg bg-neutral-900 px-3 py-2 text-xs font-semibold text-white shadow-xs hover:bg-neutral-800"
          >
            <Plus className="h-4 w-4" />
            <span>Yangi mijoz</span>
          </button>
        </div>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between text-neutral-500">
            <span className="text-xs font-medium uppercase tracking-wider">Jami Mijozlar</span>
            <Users className="h-4 w-4" />
          </div>
          <p className="mt-2 text-2xl font-bold text-neutral-900">{metrics.totalCustomers}</p>
          <p className="text-[11px] text-neutral-500">Barcha savdo nuqtalari</p>
        </div>

        <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between text-neutral-500">
            <span className="text-xs font-medium uppercase tracking-wider">Qarzdor Mijozlar</span>
            <ArrowDownLeft className="h-4 w-4 text-amber-500" />
          </div>
          <p className="mt-2 text-2xl font-bold text-amber-600">{metrics.debtCustomersCount}</p>
          <p className="text-[11px] text-neutral-500">Faol qarzi mavjud mijozlar</p>
        </div>

        <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between text-neutral-500">
            <span className="text-xs font-medium uppercase tracking-wider">Jami Nasiya (Qarz)</span>
            <span className="text-xs font-bold text-red-600">UZS</span>
          </div>
          <p className="mt-2 text-2xl font-bold text-red-600">
            {metrics.totalDebt.toLocaleString()}
          </p>
          <p className="text-[11px] text-neutral-500">Undirilishi kutilayotgan summa</p>
        </div>

        <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between text-neutral-500">
            <span className="text-xs font-medium uppercase tracking-wider">Limitdan Oshgan</span>
            <AlertTriangle className="h-4 w-4 text-red-500" />
          </div>
          <p className="mt-2 text-2xl font-bold text-red-600">{metrics.overLimitCount}</p>
          <p className="text-[11px] text-neutral-500">Kredit limitini buzgan nuqtalar</p>
        </div>
      </div>

      {/* Filters & Search */}
      <div className="flex flex-col gap-3 rounded-xl border border-neutral-200 bg-white p-4 shadow-xs sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Mijoz nomi, kodi (STIR) yoki telefon raqami orqali izlash..."
            className="w-full rounded-lg border border-neutral-300 py-2 pl-9 pr-4 text-xs focus:border-neutral-900 focus:outline-hidden"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Agent Filter */}
          <MultiSelect label="Agent" allLabel="Barcha agentlar" value={agentFilter} onChange={setAgentFilter}
            options={agentsList.map(ag => ({ value: ag.id, label: ag.name }))} />

          <button
            onClick={() => setStatusFilter('ALL')}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              statusFilter === 'ALL'
                ? 'bg-neutral-900 text-white'
                : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
            }`}
          >
            Barchasi
          </button>
          <button
            onClick={() => setStatusFilter('DEBT_ONLY')}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              statusFilter === 'DEBT_ONLY'
                ? 'bg-amber-600 text-white'
                : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
            }`}
          >
            Faqat Qarzdorlar
          </button>
          <button
            onClick={() => setStatusFilter('OVER_LIMIT')}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              statusFilter === 'OVER_LIMIT'
                ? 'bg-red-600 text-white'
                : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
            }`}
          >
            Limitdan Oshganlar
          </button>
          <button
            onClick={fetchCustomers}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-50"
            title="Yangilash"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Customer Ledger Table */}
      <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-xs">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-neutral-200 text-left text-xs">
            <thead className="bg-neutral-50 text-neutral-500">
              <tr>
                <th className="px-4 py-3 font-semibold uppercase tracking-wider">Kod / Nomi</th>
                <th className="px-4 py-3 font-semibold uppercase tracking-wider">Telefon</th>
                <th className="px-4 py-3 font-semibold uppercase tracking-wider">Hudud & Agent</th>
                <th className="px-4 py-3 font-semibold uppercase tracking-wider text-right">Kredit Limiti</th>
                <th className="px-4 py-3 font-semibold uppercase tracking-wider text-right">Joriy Balans (Qarz)</th>
                <th className="px-4 py-3 font-semibold uppercase tracking-wider text-center">Holat</th>
                <th className="px-4 py-3 font-semibold uppercase tracking-wider text-right">Amallar</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200 bg-white">
              {filteredCustomers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-neutral-400">
                    Mijozlar topilmadi
                  </td>
                </tr>
              ) : (
                filteredCustomers.slice(0, shown).map((cust) => (
                  <tr key={cust.customer_id} className="hover:bg-neutral-50/80 transition">
                    <td className="px-4 py-3 font-medium text-neutral-900">
                      <div>{cust.customer_name}</div>
                      <span className="font-mono text-[10px] text-neutral-400">{cust.customer_code}</span>
                    </td>
                    <td className="px-4 py-3 text-neutral-600">{cust.phone || '-'}</td>
                    <td className="px-4 py-3 text-neutral-600">
                      <div>{cust.territory_name || 'Hudud biriktirilmagan'}</div>
                      <div className="text-[10px] text-neutral-400">{cust.agent_name || 'Agent yo\'q'}</div>
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-neutral-700">
                      {cust.credit_limit ? `${cust.credit_limit.toLocaleString()} UZS` : 'Cheksiz'}
                    </td>
                    <td className="px-4 py-3 text-right font-bold">
                      {cust.closing_balance > 0 ? (
                        <span className="text-red-600">+{cust.closing_balance.toLocaleString()} UZS</span>
                      ) : cust.closing_balance < 0 ? (
                        <span className="text-emerald-600">{cust.closing_balance.toLocaleString()} UZS</span>
                      ) : (
                        <span className="text-neutral-400">0 UZS</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {cust.is_over_limit ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700">
                          <AlertTriangle className="h-3 w-3" />
                          Limit oshgan
                        </span>
                      ) : cust.is_threshold_exceeded ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                          Chegara yaqin
                        </span>
                      ) : cust.closing_balance > 0 ? (
                        <span className="inline-flex items-center rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-medium text-neutral-700">
                          Nasiya
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                          Qarz yo'q
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {cust.closing_balance > 0 && (
                          <button
                            onClick={() => handleOpenReminder(cust)}
                            className="flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-800 hover:bg-amber-100 transition shadow-2xs"
                            title="SMS / Telegram qarz eslatmasini tayyorlash"
                          >
                            <MessageSquare className="h-3 w-3 text-amber-600" />
                            <span>Eslatma</span>
                          </button>
                        )}
                        <button
                          onClick={() => handleOpenStatement(cust.customer_id)}
                          className="flex items-center gap-1 rounded-md border border-neutral-300 bg-white px-2 py-1 text-[11px] font-medium text-neutral-700 hover:bg-neutral-100"
                        >
                          <FileText className="h-3 w-3 text-neutral-500" />
                          <span>Akt Sverka</span>
                        </button>
                        <button
                          onClick={() => {
                            setPaymentForm(prev => ({ ...prev, customer_id: cust.customer_id }));
                            setShowPaymentModal(true);
                          }}
                          className="rounded-md bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100"
                        >
                          To'lov
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          {filteredCustomers.length > shown && (
            <div className="flex items-center justify-center gap-3 border-t border-neutral-100 py-3 text-xs">
              <span className="text-neutral-500">{shown} / {filteredCustomers.length} ta ko‘rsatildi</span>
              <button onClick={() => setShown(s => s + 200)} className="rounded-lg border border-neutral-300 px-3 py-1 font-semibold hover:bg-neutral-50">Yana 200 ta</button>
              <button onClick={() => setShown(filteredCustomers.length)} className="rounded-lg px-3 py-1 font-semibold text-neutral-600 hover:bg-neutral-100">Hammasi</button>
            </div>
          )}
        </div>
      </div>

      {/* Akt Sverka Modal */}
      {showStatementModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-2xl bg-white shadow-2xl">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-neutral-200 px-6 py-4">
              <div>
                <h2 className="text-base font-bold text-neutral-900">
                  Solishtirma Dalolatnomasi (Akt Sverka)
                </h2>
                <p className="text-xs text-neutral-500">
                  {statementData?.customer?.name} ({statementData?.customer?.code})
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowStatementPrintModal(true)}
                  className="flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 transition"
                  title="Rasmiy solishtirma dalolatnomasi shaklida ko'rish va chop etish"
                >
                  <Printer className="h-3.5 w-3.5 text-indigo-600" />
                  <span>Rasmiy Shakl (Chop etish)</span>
                </button>
                <button
                  onClick={() => setShowStatementModal(false)}
                  className="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* Date Filters inside Modal */}
            <div className="flex flex-wrap items-center gap-3 border-b border-neutral-200 bg-neutral-50 px-6 py-3">
              <span className="text-xs font-semibold text-neutral-700">Davr:</span>
              <input
                type="date"
                value={statementFromDate}
                onChange={(e) => setStatementFromDate(e.target.value)}
                className="rounded-md border border-neutral-300 bg-white px-2.5 py-1 text-xs"
              />
              <span className="text-xs text-neutral-400">—</span>
              <input
                type="date"
                value={statementToDate}
                onChange={(e) => setStatementToDate(e.target.value)}
                className="rounded-md border border-neutral-300 bg-white px-2.5 py-1 text-xs"
              />
              <button
                onClick={handleRefreshStatement}
                disabled={statementLoading}
                className="rounded-md bg-neutral-900 px-3 py-1 text-xs font-semibold text-white hover:bg-neutral-800 disabled:opacity-50"
              >
                {statementLoading ? 'Yuklanmoqda...' : 'Ko\'rsatish'}
              </button>
              {statementData && (
                <button
                  onClick={exportStatementExcel}
                  className="inline-flex items-center gap-1 rounded-md border border-neutral-300 bg-white px-3 py-1 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
                >
                  <Download className="h-3.5 w-3.5" />
                  Excel
                </button>
              )}
            </div>

            {/* Statement Summary & Transactions */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {statementLoading ? (
                <div className="py-12 text-center text-xs text-neutral-400">
                  Akt Sverka ma'lumotlari hisoblanmoqda...
                </div>
              ) : statementData ? (
                <>
                  {/* Parties Info */}
                  <div className="grid grid-cols-2 gap-4 rounded-xl border border-neutral-200 bg-neutral-50/50 p-4 text-xs">
                    <div>
                      <p className="font-bold text-neutral-900">{statementData.company.name}</p>
                      <p className="text-neutral-500">STIR: {statementData.company.tax_id || '—'}</p>
                      <p className="text-neutral-500">Tel: {statementData.company.phone || '—'}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-neutral-900">{statementData.customer.name}</p>
                      <p className="text-neutral-500">STIR/Kod: {statementData.customer.code}</p>
                      <p className="text-neutral-500">Tel: {statementData.customer.phone}</p>
                    </div>
                  </div>

                  {/* Summary Bar */}
                  <div className="grid grid-cols-4 gap-2 rounded-lg bg-neutral-100 p-3 text-center text-xs">
                    <div>
                      <span className="text-neutral-500 text-[10px] uppercase font-semibold">Boshlang'ich qoldiq</span>
                      <p className="font-bold text-neutral-900 mt-0.5">
                        {statementData.opening_balance.toLocaleString()} UZS
                      </p>
                    </div>
                    <div>
                      <span className="text-neutral-500 text-[10px] uppercase font-semibold">Jami Savdo (Debit)</span>
                      <p className="font-bold text-red-600 mt-0.5">
                        +{statementData.total_debit.toLocaleString()} UZS
                      </p>
                    </div>
                    <div>
                      <span className="text-neutral-500 text-[10px] uppercase font-semibold">Jami To'lov (Kredit)</span>
                      <p className="font-bold text-emerald-600 mt-0.5">
                        -{statementData.total_credit.toLocaleString()} UZS
                      </p>
                    </div>
                    <div>
                      <span className="text-neutral-500 text-[10px] uppercase font-semibold">Yakuniy qoldiq</span>
                      <p className="font-bold text-neutral-900 mt-0.5">
                        {statementData.closing_balance.toLocaleString()} UZS
                      </p>
                    </div>
                  </div>

                  {/* Statement Table */}
                  <div className="overflow-hidden rounded-lg border border-neutral-200">
                    <table className="min-w-full divide-y divide-neutral-200 text-left text-xs">
                      <thead className="bg-neutral-50 text-neutral-500">
                        <tr>
                          <th className="px-3 py-2 font-semibold">Sana</th>
                          <th className="px-3 py-2 font-semibold">Operatsiya turi</th>
                          <th className="px-3 py-2 font-semibold">Izoh / Hujjat</th>
                          <th className="px-3 py-2 font-semibold text-right text-red-600">Debit (Oshdi)</th>
                          <th className="px-3 py-2 font-semibold text-right text-emerald-600">Kredit (Kamaydi)</th>
                          <th className="px-3 py-2 font-semibold text-right">Qoldiq</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-neutral-200 bg-white">
                        {statementData.transactions.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="px-3 py-6 text-center text-neutral-400">
                              Ushbu davrda harakatlar mavjud emas
                            </td>
                          </tr>
                        ) : (
                          statementData.transactions.map((t: any) => (
                            <tr key={t.id} className="hover:bg-neutral-50/60">
                              <td className="px-3 py-2 font-mono text-neutral-600">{t.date}</td>
                              <td className="px-3 py-2 font-medium text-neutral-800">{LEDGER_LABEL[t.ledger_type] || t.ledger_type}</td>
                              <td className="px-3 py-2 text-neutral-500">{t.comment || t.reference_id}</td>
                              <td className="px-3 py-2 text-right font-medium text-red-600">
                                {t.debit > 0 ? `+${t.debit.toLocaleString()}` : '-'}
                              </td>
                              <td className="px-3 py-2 text-right font-medium text-emerald-600">
                                {t.credit > 0 ? `-${t.credit.toLocaleString()}` : '-'}
                              </td>
                              <td className="px-3 py-2 text-right font-bold text-neutral-900">
                                {t.running_balance.toLocaleString()} UZS
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {/* Payment Modal */}
      {showPaymentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-neutral-200 pb-3">
              <h2 className="text-base font-bold text-neutral-900">Mijoz To'lovini Qabul Qilish</h2>
              <button onClick={() => setShowPaymentModal(false)} className="text-neutral-400 hover:text-neutral-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleRecordPayment} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-neutral-700">Mijoz</label>
                <select
                  required
                  value={paymentForm.customer_id}
                  onChange={(e) => setPaymentForm(prev => ({ ...prev, customer_id: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-neutral-300 p-2 text-xs focus:border-neutral-900 focus:outline-hidden"
                >
                  <option value="">Mijozni tanlang...</option>
                  {customers.map((c, idx) => {
                    const id = c.customer_id || (c as any).id || `cust-pay-${idx}`;
                    return (
                      <option key={id} value={c.customer_id || (c as any).id}>
                        {c.customer_name || (c as any).name} (Qarz: {Number(c.closing_balance ?? (c as any).current_balance ?? 0).toLocaleString()} UZS)
                      </option>
                    );
                  })}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-700">To'lov summasi (UZS)</label>
                <input
                  type="number"
                  required
                  min="1"
                  value={paymentForm.amount || ''}
                  onChange={(e) => setPaymentForm(prev => ({ ...prev, amount: Number(e.target.value) }))}
                  className="mt-1 w-full rounded-lg border border-neutral-300 p-2 text-xs font-semibold focus:border-neutral-900 focus:outline-hidden"
                  placeholder="0"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-700">To'lov usuli</label>
                <select
                  value={paymentForm.payment_method}
                  onChange={(e) => setPaymentForm(prev => ({ ...prev, payment_method: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-neutral-300 p-2 text-xs focus:border-neutral-900 focus:outline-hidden"
                >
                  <option value="CASH">Naqd pul (Kassa)</option>
                  <option value="TERMINAL">Bank Terminali (Uzcard / Humo)</option>
                  <option value="CLICK">Click / Payme</option>
                  <option value="BANK_TRANSFER">Bank O'tkazmasi (Perechisleniye)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-700">Izoh</label>
                <input
                  type="text"
                  value={paymentForm.comment}
                  onChange={(e) => setPaymentForm(prev => ({ ...prev, comment: e.target.value }))}
                  placeholder="Hujjat raqami yoki to'lov maqsadi..."
                  className="mt-1 w-full rounded-lg border border-neutral-300 p-2 text-xs focus:border-neutral-900 focus:outline-hidden"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowPaymentModal(false)}
                  className="rounded-lg border border-neutral-300 px-3 py-2 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
                >
                  Bekor qilish
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
                >
                  To'lovni saqlash
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Adjustment Modal */}
      {showAdjustmentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-neutral-200 pb-3">
              <h2 className="text-base font-bold text-neutral-900">Mijoz Balansiga Tuzatish Kiritish</h2>
              <button onClick={() => setShowAdjustmentModal(false)} className="text-neutral-400 hover:text-neutral-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleRecordAdjustment} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-neutral-700">Mijoz</label>
                <select
                  required
                  value={adjustmentForm.customer_id}
                  onChange={(e) => setAdjustmentForm(prev => ({ ...prev, customer_id: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-neutral-300 p-2 text-xs focus:border-neutral-900 focus:outline-hidden"
                >
                  <option value="">Mijozni tanlang...</option>
                  {customers.map((c, idx) => {
                    const id = c.customer_id || (c as any).id || `cust-adj-${idx}`;
                    return (
                      <option key={id} value={c.customer_id || (c as any).id}>
                        {c.customer_name || (c as any).name} (Hozirgi qoldiq: {Number(c.closing_balance ?? (c as any).current_balance ?? 0).toLocaleString()} UZS)
                      </option>
                    );
                  })}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-700">Tuzatish yo'nalishi</label>
                <select
                  value={adjustmentForm.direction}
                  onChange={(e: any) => setAdjustmentForm(prev => ({ ...prev, direction: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-neutral-300 p-2 text-xs focus:border-neutral-900 focus:outline-hidden"
                >
                  <option value="INCREASE_DEBT">Qarzni ko'paytirish (+ Debit)</option>
                  <option value="DECREASE_DEBT">Qarzni kamaytirish (- Kredit)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-700">Tuzatish summasi (UZS)</label>
                <input
                  type="number"
                  required
                  min="1"
                  value={adjustmentForm.amount || ''}
                  onChange={(e) => setAdjustmentForm(prev => ({ ...prev, amount: Number(e.target.value) }))}
                  className="mt-1 w-full rounded-lg border border-neutral-300 p-2 text-xs font-semibold focus:border-neutral-900 focus:outline-hidden"
                  placeholder="0"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-700">Tuzatish sababi (Rasmiy dalolatnoma)</label>
                <textarea
                  required
                  rows={3}
                  value={adjustmentForm.reason}
                  onChange={(e) => setAdjustmentForm(prev => ({ ...prev, reason: e.target.value }))}
                  placeholder="Solishtirma dalolatnomasi yoki hisob-kitobdagi xatolik sababi..."
                  className="mt-1 w-full rounded-lg border border-neutral-300 p-2 text-xs focus:border-neutral-900 focus:outline-hidden"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAdjustmentModal(false)}
                  className="rounded-lg border border-neutral-300 px-3 py-2 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
                >
                  Bekor qilish
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-neutral-900 px-4 py-2 text-xs font-semibold text-white hover:bg-neutral-800"
                >
                  Tuzatishni tasdiqlash
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Carried Forward Modal */}
      {showCarriedForwardModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-neutral-200 pb-3">
              <h2 className="text-base font-bold text-neutral-900">Kun Surish (Carried Forward)</h2>
              <button onClick={() => setShowCarriedForwardModal(false)} className="text-neutral-400 hover:text-neutral-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleRecordCarriedForward} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-neutral-700">Mijoz</label>
                <select
                  required
                  value={carriedForwardForm.customer_id}
                  onChange={(e) => setCarriedForwardForm(prev => ({ ...prev, customer_id: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-neutral-300 p-2 text-xs focus:border-neutral-900 focus:outline-hidden"
                >
                  <option value="">Mijozni tanlang...</option>
                  {customers.map((c, idx) => {
                    const id = c.customer_id || (c as any).id || `cust-cf-${idx}`;
                    return (
                      <option key={id} value={c.customer_id || (c as any).id}>
                        {c.customer_name || (c as any).name} (Qarz: {Number(c.closing_balance ?? (c as any).current_balance ?? 0).toLocaleString()} UZS)
                      </option>
                    );
                  })}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-neutral-700">Qaysi sanadan</label>
                  <input
                    type="date"
                    required
                    value={carriedForwardForm.source_date}
                    onChange={(e) => setCarriedForwardForm(prev => ({ ...prev, source_date: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-neutral-300 p-2 text-xs focus:border-neutral-900 focus:outline-hidden"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-neutral-700">Qaysi sanaga</label>
                  <input
                    type="date"
                    required
                    value={carriedForwardForm.target_date}
                    onChange={(e) => setCarriedForwardForm(prev => ({ ...prev, target_date: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-neutral-300 p-2 text-xs focus:border-neutral-900 focus:outline-hidden"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-700">Ko'chirilayotgan summa (UZS)</label>
                <input
                  type="number"
                  required
                  min="1"
                  value={carriedForwardForm.amount || ''}
                  onChange={(e) => setCarriedForwardForm(prev => ({ ...prev, amount: Number(e.target.value) }))}
                  className="mt-1 w-full rounded-lg border border-neutral-300 p-2 text-xs font-semibold focus:border-neutral-900 focus:outline-hidden"
                  placeholder="0"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-700">Izoh</label>
                <input
                  type="text"
                  value={carriedForwardForm.comment}
                  onChange={(e) => setCarriedForwardForm(prev => ({ ...prev, comment: e.target.value }))}
                  placeholder="Kun surish sababi..."
                  className="mt-1 w-full rounded-lg border border-neutral-300 p-2 text-xs focus:border-neutral-900 focus:outline-hidden"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCarriedForwardModal(false)}
                  className="rounded-lg border border-neutral-300 px-3 py-2 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
                >
                  Bekor qilish
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-neutral-900 px-4 py-2 text-xs font-semibold text-white hover:bg-neutral-800"
                >
                  Kunni ko'chirish
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create Customer Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-neutral-200 pb-3">
              <h2 className="text-base font-bold text-neutral-900">Yangi Mijoz Yaratish</h2>
              <button onClick={() => setShowCreateModal(false)} className="text-neutral-400 hover:text-neutral-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCreateCustomer} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-neutral-700">Mijoz nomi / Savdo nuqtasi</label>
                <input
                  type="text"
                  required
                  value={createForm.name}
                  onChange={(e) => setCreateForm(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="Masalan: 'Oqtepa Market MCHJ'"
                  className="mt-1 w-full rounded-lg border border-neutral-300 p-2 text-xs focus:border-neutral-900 focus:outline-hidden"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-neutral-700">Kodi / STIR</label>
                  <input
                    type="text"
                    required
                    value={createForm.code}
                    onChange={(e) => setCreateForm(prev => ({ ...prev, code: e.target.value }))}
                    placeholder="301829482"
                    className="mt-1 w-full rounded-lg border border-neutral-300 p-2 text-xs focus:border-neutral-900 focus:outline-hidden"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-neutral-700">Telefon</label>
                  <input
                    type="text"
                    required
                    value={createForm.phone}
                    onChange={(e) => setCreateForm(prev => ({ ...prev, phone: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-neutral-300 p-2 text-xs focus:border-neutral-900 focus:outline-hidden"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-700">Manzil</label>
                <input
                  type="text"
                  value={createForm.address}
                  onChange={(e) => setCreateForm(prev => ({ ...prev, address: e.target.value }))}
                  placeholder="Chilonzor 9-mavze, 12-uy"
                  className="mt-1 w-full rounded-lg border border-neutral-300 p-2 text-xs focus:border-neutral-900 focus:outline-hidden"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-neutral-700">Kredit Limiti (UZS)</label>
                  <input
                    type="number"
                    min="0"
                    value={createForm.credit_limit}
                    onChange={(e) => setCreateForm(prev => ({ ...prev, credit_limit: Number(e.target.value) }))}
                    className="mt-1 w-full rounded-lg border border-neutral-300 p-2 text-xs focus:border-neutral-900 focus:outline-hidden"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-neutral-700">Ogohlantirish Chegarasi (UZS)</label>
                  <input
                    type="number"
                    min="0"
                    value={createForm.debt_alert_threshold}
                    onChange={(e) => setCreateForm(prev => ({ ...prev, debt_alert_threshold: Number(e.target.value) }))}
                    className="mt-1 w-full rounded-lg border border-neutral-300 p-2 text-xs focus:border-neutral-900 focus:outline-hidden"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-700">Boshlang'ich qarz (Opening Balance)</label>
                <input
                  type="number"
                  min="0"
                  value={createForm.initial_debt}
                  onChange={(e) => setCreateForm(prev => ({ ...prev, initial_debt: Number(e.target.value) }))}
                  placeholder="0"
                  className="mt-1 w-full rounded-lg border border-neutral-300 p-2 text-xs focus:border-neutral-900 focus:outline-hidden"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="rounded-lg border border-neutral-300 px-3 py-2 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
                >
                  Bekor qilish
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-neutral-900 px-4 py-2 text-xs font-semibold text-white hover:bg-neutral-800"
                >
                  Saqlash
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* MODAL: MUDDATI O'TGAN QARZLAR & TELEGRAM BOT OGOHLANTIRISH    */}
      {/* ============================================================ */}
      {showOverdueModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl space-y-5 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-neutral-200 pb-3">
              <div className="flex items-center gap-3">
                <div className="rounded-xl bg-indigo-50 p-2.5 text-indigo-700">
                  <Send className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-neutral-900">
                    Muddati O'tgan Qarzlar & Telegram Bot Ogohlantirish
                  </h3>
                  <p className="text-xs text-neutral-500">
                    Qarzi 10 kundan oshgan mijozlar agentlar bo'yicha guruhlangan holda admin botiga yuboriladi
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowOverdueModal(false)}
                className="text-neutral-400 hover:text-neutral-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Threshold and Telegram Action Bar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-indigo-50/50 p-4 rounded-xl border border-indigo-100">
              <div className="flex items-center space-x-2 text-xs text-indigo-950 font-medium">
                <span>Minimal kechikish:</span>
                <input
                  type="number"
                  min="1"
                  value={overdueThresholdDays}
                  onChange={(e) => setOverdueThresholdDays(Number(e.target.value) || 10)}
                  className="w-16 px-2 py-1 bg-white border border-indigo-200 rounded-lg text-xs font-bold text-center"
                />
                <span>kundan oshgan qarzlar</span>
                <button
                  onClick={handleOpenOverdueModal}
                  disabled={overdueLoading}
                  className="px-2.5 py-1 bg-indigo-100 hover:bg-indigo-200 text-indigo-800 rounded-lg font-semibold text-xs ml-1"
                >
                  Yangilash
                </button>
              </div>

              <button
                onClick={handleDispatchTelegram}
                disabled={overdueLoading}
                className="flex items-center justify-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs transition shadow-xs disabled:opacity-50"
              >
                <Send className="h-4 w-4" />
                <span>{overdueLoading ? 'Yuborilmoqda...' : 'Admin Telegram Botiga Xabar Yuborish'}</span>
              </button>
            </div>

            {dispatchSuccess && (
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs flex items-center justify-between">
                <span>✓ {dispatchSuccess}</span>
                <button onClick={() => setDispatchSuccess(null)} className="text-emerald-600 font-bold">✕</button>
              </div>
            )}

            {/* Summary KPIs */}
            {overdueSummary && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="bg-neutral-50 p-3.5 rounded-xl border border-neutral-200">
                  <span className="text-[11px] font-bold text-neutral-500 uppercase block mb-1">
                    Jami Muddati O'tgan Qarz
                  </span>
                  <span className="text-lg font-black text-rose-600">
                    {(overdueSummary.total_overdue_amount || 0).toLocaleString()} UZS
                  </span>
                </div>
                <div className="bg-neutral-50 p-3.5 rounded-xl border border-neutral-200">
                  <span className="text-[11px] font-bold text-neutral-500 uppercase block mb-1">
                    Qarzdor Mijozlar Soni
                  </span>
                  <span className="text-lg font-black text-neutral-900">
                    {overdueSummary.total_overdue_customers || 0} ta do'kon
                  </span>
                </div>
                <div className="bg-neutral-50 p-3.5 rounded-xl border border-neutral-200">
                  <span className="text-[11px] font-bold text-neutral-500 uppercase block mb-1">
                    Qarzdor Agentlar Soni
                  </span>
                  <span className="text-lg font-black text-indigo-900">
                    {overdueSummary.agents?.length || 0} ta agent
                  </span>
                </div>
              </div>
            )}

            {/* Agent Groupings */}
            <div className="space-y-4">
              <h4 className="text-xs font-bold text-neutral-700 uppercase tracking-wider">
                Agentlar Bo'yicha Tafsilot:
              </h4>

              {overdueLoading && !overdueSummary ? (
                <div className="py-8 text-center text-xs text-neutral-400">
                  Yuklanmoqda...
                </div>
              ) : !overdueSummary || overdueSummary.agents?.length === 0 ? (
                <div className="py-8 text-center text-xs text-neutral-400 bg-neutral-50 rounded-xl border border-neutral-200">
                  {overdueThresholdDays} kundan oshgan muddati o'tgan qarzlar mavjud emas. Barcha to'lovlar o'z vaqtida!
                </div>
              ) : (
                overdueSummary.agents.map((ag: any, idx: number) => (
                  <div key={idx} className="border border-neutral-200 rounded-xl overflow-hidden shadow-xs">
                    <div className="bg-neutral-100 p-3 flex items-center justify-between text-xs font-bold text-neutral-800">
                      <div className="flex items-center space-x-2">
                        <span className="px-2 py-0.5 rounded bg-indigo-100 text-indigo-800 text-[11px]">
                          Agent
                        </span>
                        <span>{ag.agent_name}</span>
                        <span className="text-neutral-500 font-normal">({ag.customers_count} ta do'kon)</span>
                      </div>
                      <span className="text-rose-700 font-black">
                        {(ag.total_debt || 0).toLocaleString()} UZS
                      </span>
                    </div>

                    <table className="w-full text-left text-xs">
                      <thead className="bg-neutral-50 text-neutral-500 font-semibold border-b border-neutral-200">
                        <tr>
                          <th className="px-3.5 py-2">Do'kon (Mijoz)</th>
                          <th className="px-3.5 py-2">Telefon</th>
                          <th className="px-3.5 py-2 text-right">Qarz Summasi</th>
                          <th className="px-3.5 py-2 text-right">Kechikkan Kunlar</th>
                          <th className="px-3.5 py-2 text-right">So'nggi Harakat</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-neutral-200">
                        {ag.customers?.map((cust: any, cIdx: number) => (
                          <tr key={cIdx} className="hover:bg-neutral-50">
                            <td className="px-3.5 py-2 font-semibold text-neutral-900">
                              {cust.customer_name}
                            </td>
                            <td className="px-3.5 py-2 font-mono text-neutral-600">
                              {cust.phone || '—'}
                            </td>
                            <td className="px-3.5 py-2 text-right font-bold text-rose-600">
                              {(cust.debt_amount || 0).toLocaleString()} UZS
                            </td>
                            <td className="px-3.5 py-2 text-right font-bold text-amber-700">
                              {cust.days_overdue} kun
                            </td>
                            <td className="px-3.5 py-2 text-right font-mono text-neutral-500">
                              {cust.last_activity_date || '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))
              )}
            </div>

            <div className="pt-2 flex justify-end">
              <button
                type="button"
                onClick={() => setShowOverdueModal(false)}
                className="px-4 py-2 text-xs font-semibold text-neutral-700 bg-neutral-100 hover:bg-neutral-200 rounded-xl transition"
              >
                Yopish
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mijozga Qarz Eslatmasi (SMS / Telegram) */}
      <DebtReminderModal
        isOpen={showReminderModal}
        onClose={() => {
          setShowReminderModal(false);
          setSelectedReminderCustomer(null);
        }}
        customer={selectedReminderCustomer}
      />

      {/* Rasmiy Solishtirma Dalolatnomasi Chop Etish Shakli */}
      <StatementPrintModal
        isOpen={showStatementPrintModal}
        onClose={() => setShowStatementPrintModal(false)}
        statementData={statementData}
      />
    </div>
  );
};
