import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { localToday } from '../../utils/date';
import { 
  Receipt, 
  PlusCircle, 
  CheckCircle2, 
  AlertCircle, 
  DollarSign, 
  Download, 
  Search, 
  Filter, 
  Tag, 
  Users, 
  Calendar, 
  ArrowUpRight, 
  Clock, 
  Edit3, 
  Trash2, 
  ShieldCheck, 
  AlertTriangle, 
  Layers, 
  Check, 
  X, 
  TrendingUp, 
  CreditCard, 
  Building2, 
  UserCheck, 
  ChevronRight,
  Info,
  RefreshCw
} from 'lucide-react';
import { 
  AuthUser, 
  Expense, 
  ExpenseCategory, 
  ExpensePreviewResult, 
  Employee 
} from '../../types.ts';
import { api } from '../../services/api.ts';
import { MultiSelect, picked } from '../common/MultiSelect.tsx';

interface ExpensesViewProps {
  user: AuthUser | null;
}

export const ExpensesView: React.FC<ExpensesViewProps> = ({ user }) => {
  const [activeTab, setActiveTab] = useState<'expenses' | 'categories' | 'employees' | 'reports'>('expenses');
  const [loading, setLoading] = useState<boolean>(false);
  const [actionLoading, setActionLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Data
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeeSummaries, setEmployeeSummaries] = useState<any[]>([]);
  const [dailyReport, setDailyReport] = useState<any>(null);
  const [monthlyReport, setMonthlyReport] = useState<any>(null);

  // Filter states
  const [selectedDate, setSelectedDate] = useState<string>(localToday());
  const [selectedMonth, setSelectedMonth] = useState<string>(localToday().slice(0, 7));
  const [filterCategory, setFilterCategory] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [filterPaymentMethod, setFilterPaymentMethod] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  // The list covers a period (this month by default), not every expense ever.
  const [periodFrom, setPeriodFrom] = useState<string>(localToday().slice(0, 8) + '01');
  const [periodTo, setPeriodTo] = useState<string>(localToday());

  // Modals
  const [isCreateExpenseOpen, setIsCreateExpenseOpen] = useState<boolean>(false);
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState<boolean>(false);
  const [editingCategory, setEditingCategory] = useState<ExpenseCategory | null>(null);
  const [selectedExpenseDetail, setSelectedExpenseDetail] = useState<Expense | null>(null);
  const [correctionExpense, setCorrectionExpense] = useState<Expense | null>(null);
  const [cancelModalExpense, setCancelModalExpense] = useState<Expense | null>(null);
  const [cancelReason, setCancelReason] = useState<string>('');
  const [limitModalEmployee, setLimitModalEmployee] = useState<any | null>(null);
  const [newDailyLimit, setNewDailyLimit] = useState<number>(20000);

  // New Expense Form State
  const [expenseForm, setExpenseForm] = useState<{
    date: string;
    category_id: string;
    amount: number | '';
    payment_method: 'CASH' | 'TERMINAL' | 'CLICK' | 'BANK_TRANSFER' | 'OTHER';
    comment: string;
    is_company_expense: boolean;
    selected_employees: string[];
    confirm_immediately: boolean;
  }>({
    date: localToday(),
    category_id: '',
    amount: '',
    payment_method: 'CASH',
    comment: '',
    is_company_expense: true,
    selected_employees: [],
    confirm_immediately: true
  });

  // Live preview state for form
  const [previewData, setPreviewData] = useState<ExpensePreviewResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState<boolean>(false);

  // Category Form State
  const [categoryForm, setCategoryForm] = useState<{
    name: string;
    description: string;
    monthly_limit: number | '';
    is_active: boolean;
  }>({
    name: '',
    description: '',
    monthly_limit: '',
    is_active: true
  });

  // Correction Form State
  const [correctionForm, setCorrectionForm] = useState<{
    amount: number | '';
    comment: string;
    reason: string;
  }>({
    amount: '',
    comment: '',
    reason: ''
  });

  const showNotification = (msg: string, isError = false) => {
    if (isError) {
      setError(msg);
      setTimeout(() => setError(null), 6000);
    } else {
      setSuccessMsg(msg);
      setTimeout(() => setSuccessMsg(null), 5000);
    }
  };

  // Load Data
  const loadAllData = useCallback(async () => {
    setLoading(true);
    // A part that fails is named on screen instead of showing as an empty list (that looked like "no data").
    const failed: string[] = [];
    const soft = <T,>(p: Promise<T>, what: string, empty: T) => p.catch((e: any) => { if (e?.status !== 403) failed.push(`${what}: ${e?.message || 'xato'}`); return empty; });
    try {
      const [expRes, catRes, empSumRes, dRepRes, mRepRes] = await Promise.all([
        soft(api.getExpenses({
          category_id: picked(filterCategory).join(',') || undefined,
          status: picked(filterStatus).join(',') || undefined,
          payment_method: picked(filterPaymentMethod).join(',') || undefined,
          from_date: periodFrom || undefined,
          to_date: periodTo || undefined,
          search: searchQuery || undefined
        }), 'Xarajatlar ro‘yxati', { expenses: [], total: 0, total_amount: 0 } as any),
        soft(api.getExpenseCategories(), 'Toifalar', { categories: [] } as any),
        soft(api.getEmployeeExpenseSummary(selectedMonth), 'Xodimlar', { summary: [] } as any),
        soft(api.getDailyExpenseReport(selectedDate), 'Kunlik hisobot', { report: null } as any),
        soft(api.getMonthlyExpenseReport(selectedMonth), 'Oylik hisobot', { report: null } as any)
      ]);
      if (failed.length) showNotification(`Yuklanmadi — ${failed.join('; ')}`, true);

      setExpenses(expRes.expenses || []);
      setCategories(catRes.categories || []);
      setEmployeeSummaries(empSumRes.summary || []);
      setDailyReport(dRepRes.report);
      setMonthlyReport(mRepRes.report);

      // Employees to share an expense among (the summary lists the active ones).
      if (empSumRes.summary) {
        setEmployees(empSumRes.summary.map((s: any) => s.employee).filter(Boolean));
      }
    } catch (err: any) {
      console.error(err);
      showNotification(err.message || 'Ma\'lumotlarni yuklashda xatolik', true);
    } finally {
      setLoading(false);
    }
  }, [filterCategory, filterStatus, filterPaymentMethod, searchQuery, selectedDate, selectedMonth, periodFrom, periodTo]);

  useEffect(() => {
    loadAllData();
  }, [loadAllData]);

  // Recalculate Live Preview on Form Changes
  useEffect(() => {
    if (!isCreateExpenseOpen || !expenseForm.category_id || !expenseForm.amount || Number(expenseForm.amount) <= 0) {
      setPreviewData(null);
      return;
    }

    const timer = setTimeout(async () => {
      setPreviewLoading(true);
      try {
        const res = await api.getExpensePreview({
          category_id: expenseForm.category_id,
          amount: Number(expenseForm.amount),
          date: expenseForm.date,
          is_company_expense: expenseForm.is_company_expense,
          employee_ids: !expenseForm.is_company_expense ? expenseForm.selected_employees : [],
          payment_method: expenseForm.payment_method,
          comment: expenseForm.comment
        });
        setPreviewData(res.preview);
      } catch (err) {
        console.error('Preview error:', err);
      } finally {
        setPreviewLoading(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [
    isCreateExpenseOpen,
    expenseForm.category_id,
    expenseForm.amount,
    expenseForm.date,
    expenseForm.is_company_expense,
    expenseForm.selected_employees,
    expenseForm.payment_method,
    expenseForm.comment
  ]);

  // Metric Computations
  const metrics = useMemo(() => {
    let total = 0;
    let cashTotal = 0;
    let confirmedCount = 0;
    let draftCount = 0;

    expenses.forEach((e) => {
      // Only confirmed expenses are spent money; drafts are counted separately below.
      if (e.status === 'CONFIRMED') {
        total += e.amount;
        if (e.payment_method === 'CASH') {
          cashTotal += e.amount;
        }
      }
      if (e.status === 'CONFIRMED') confirmedCount++;
      if (e.status === 'DRAFT') draftCount++;
    });

    return { total, cashTotal, confirmedCount, draftCount };
  }, [expenses]);

  // Submit New Expense
  const handleCreateExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!expenseForm.category_id) {
      showNotification('Iltimos, xarajat toifasini tanlang', true);
      return;
    }
    if (!expenseForm.amount || Number(expenseForm.amount) <= 0) {
      showNotification('Iltimos, musbat summa kiriting', true);
      return;
    }
    if (!expenseForm.is_company_expense && expenseForm.selected_employees.length === 0) {
      showNotification('Xodimlar o\'rtasida taqsimlash uchun kamida 1 nafar xodimni tanlang', true);
      return;
    }

    setActionLoading(true);
    try {
      await api.createExpense({
        date: expenseForm.date,
        category_id: expenseForm.category_id,
        amount: Number(expenseForm.amount),
        payment_method: expenseForm.payment_method,
        comment: expenseForm.comment,
        is_company_expense: expenseForm.is_company_expense,
        employee_ids: !expenseForm.is_company_expense ? expenseForm.selected_employees : [],
        confirm_immediately: expenseForm.confirm_immediately
      });

      showNotification('Xarajat muvaffaqiyatli yaratildi');
      setIsCreateExpenseOpen(false);
      setExpenseForm({
        date: localToday(),
        category_id: '',
        amount: '',
        payment_method: 'CASH',
        comment: '',
        is_company_expense: true,
        selected_employees: [],
        confirm_immediately: true
      });
      loadAllData();
    } catch (err: any) {
      showNotification(err.message || 'Xarajatni saqlashda xatolik yuz berdi', true);
    } finally {
      setActionLoading(false);
    }
  };

  // Confirm Expense
  const handleConfirmExpense = async (expenseId: string) => {
    setActionLoading(true);
    try {
      await api.confirmExpense(expenseId, 'Kassir tomonidan tasdiqlandi');
      showNotification('Xarajat tasdiqlandi va kassa balansiga biriktirildi');
      if (selectedExpenseDetail?.id === expenseId) {
        setSelectedExpenseDetail(null);
      }
      loadAllData();
    } catch (err: any) {
      showNotification(err.message || 'Tasdiqlashda xatolik', true);
    } finally {
      setActionLoading(false);
    }
  };

  // Cancel Expense
  const handleCancelExpense = async () => {
    if (!cancelModalExpense) return;
    if (!cancelReason.trim()) {
      showNotification('Iltimos, bekor qilish sababini yozing', true);
      return;
    }

    setActionLoading(true);
    try {
      await api.cancelExpense(cancelModalExpense.id, cancelReason);
      showNotification('Xarajat bekor qilindi');
      setCancelModalExpense(null);
      setCancelReason('');
      if (selectedExpenseDetail?.id === cancelModalExpense.id) {
        setSelectedExpenseDetail(null);
      }
      loadAllData();
    } catch (err: any) {
      showNotification(err.message || 'Bekor qilishda xatolik', true);
    } finally {
      setActionLoading(false);
    }
  };

  // Submit Correction for Confirmed Expense
  const handleCorrectExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!correctionExpense) return;
    if (!correctionForm.reason.trim() || correctionForm.reason.length < 3) {
      showNotification('Korreksiya sababi kiritilishi shart', true);
      return;
    }

    setActionLoading(true);
    try {
      await api.correctExpense(correctionExpense.id, {
        amount: correctionForm.amount ? Number(correctionForm.amount) : undefined,
        comment: correctionForm.comment || undefined,
        reason: correctionForm.reason
      });

      showNotification('Xarajat korreksiyasi muvaffaqiyatli saqlandi va audit qayd qilindi');
      setCorrectionExpense(null);
      if (selectedExpenseDetail?.id === correctionExpense.id) {
        setSelectedExpenseDetail(null);
      }
      loadAllData();
    } catch (err: any) {
      showNotification(err.message || 'Korreksiyada xatolik', true);
    } finally {
      setActionLoading(false);
    }
  };

  // Category Actions
  const handleSaveCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!categoryForm.name.trim()) {
      showNotification('Toifa nomi kiritilishi shart', true);
      return;
    }
    // Empty or 0 = no monthly limit (many categories, e.g. imported ones, have none).
    if (categoryForm.monthly_limit !== '' && Number(categoryForm.monthly_limit) < 0) {
      showNotification('Oylik limit manfiy bo‘lmasin (bo‘sh qoldirsangiz — limitsiz)', true);
      return;
    }

    setActionLoading(true);
    try {
      if (editingCategory) {
        await api.updateExpenseCategory(editingCategory.id, {
          name: categoryForm.name,
          description: categoryForm.description,
          monthly_limit: Number(categoryForm.monthly_limit) || 0,
          is_active: categoryForm.is_active
        });
        showNotification('Toifa yangilandi');
      } else {
        await api.createExpenseCategory({
          name: categoryForm.name,
          description: categoryForm.description,
          monthly_limit: Number(categoryForm.monthly_limit) || 0
        });
        showNotification('Yangi toifa yaratildi');
      }

      setIsCategoryModalOpen(false);
      setEditingCategory(null);
      setCategoryForm({ name: '', description: '', monthly_limit: '', is_active: true });
      loadAllData();
    } catch (err: any) {
      showNotification(err.message || 'Toifani saqlashda xatolik', true);
    } finally {
      setActionLoading(false);
    }
  };

  const handleToggleCategoryActive = async (cat: ExpenseCategory) => {
    setActionLoading(true);
    try {
      await api.updateExpenseCategory(cat.id, {
        is_active: !cat.is_active
      });
      showNotification(`Toifa ${!cat.is_active ? 'aktivlashtirildi' : 'deaktivlashtirildi'}`);
      loadAllData();
    } catch (err: any) {
      showNotification(err.message || 'Holatni o\'zgartirishda xatolik', true);
    } finally {
      setActionLoading(false);
    }
  };

  // Employee Daily Limit Update
  const handleSaveEmployeeDailyLimit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!limitModalEmployee) return;

    setActionLoading(true);
    try {
      await api.setEmployeeDailyLimit(limitModalEmployee.id, {
        daily_limit: Number(newDailyLimit)
      });
      showNotification('Xodimning kunlik limiti yangilandi');
      setLimitModalEmployee(null);
      loadAllData();
    } catch (err: any) {
      showNotification(err.message || 'Limitni saqlashda xatolik', true);
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner / Navigation */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600">
              <Receipt className="h-4 w-4" />
            </span>
            <h1 className="text-xl font-bold tracking-tight text-neutral-900">
              Rasxodlar / Xarajatlar Moduli
            </h1>
            <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
              Phase 3
            </span>
          </div>
          <p className="mt-1 text-sm text-neutral-500">
            Kompaniya va xodimlar xarajatlarini nazorat qilish, oylik/kunlik limitlar va kassa integratsiyasi
          </p>
        </div>

        {/* Global Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-lg border border-neutral-300 bg-white px-2 py-1 text-xs shadow-xs">
            <Calendar className="h-3.5 w-3.5 text-neutral-500" />
            <input type="date" value={periodFrom} max={periodTo} onChange={e => e.target.value && setPeriodFrom(e.target.value)} className="border-0 bg-transparent p-0.5 text-xs focus:outline-none" title="Davr boshi" />
            <span className="text-neutral-400">—</span>
            <input type="date" value={periodTo} min={periodFrom} onChange={e => e.target.value && setPeriodTo(e.target.value)} className="border-0 bg-transparent p-0.5 text-xs focus:outline-none" title="Davr oxiri" />
          </div>
          <button
            onClick={() => {
              // Same filters as the list on screen, so the file shows exactly what the user sees.
              api.downloadExpensesXlsx({
                category_id: picked(filterCategory).join(',') || undefined,
                status: picked(filterStatus).join(',') || undefined,
                payment_method: picked(filterPaymentMethod).join(',') || undefined,
          from_date: periodFrom || undefined,
          to_date: periodTo || undefined,
                search: searchQuery || undefined
              }).catch((err: any) => alert(err.message || 'Excel faylini yuklab bo‘lmadi'));
            }}
            className="flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-xs font-semibold text-neutral-700 shadow-xs hover:bg-neutral-50"
          >
            <Download className="h-4 w-4 text-neutral-500" />
            Excel yuklab olish
          </button>

          <button
            onClick={loadAllData}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-xs font-semibold text-neutral-700 shadow-xs hover:bg-neutral-50"
          >
            <RefreshCw className={`h-4 w-4 text-neutral-500 ${loading ? 'animate-spin' : ''}`} />
            Yangilash
          </button>

          <button
            id="btn-create-expense"
            onClick={() => {
              if (categories.filter(c => c.is_active).length === 0) {
                showNotification('Xarajat yaratishdan avval kamida bitta aktiv toifa bo\'lishi shart', true);
                return;
              }
              setIsCreateExpenseOpen(true);
            }}
            className="flex items-center gap-1.5 rounded-lg bg-neutral-900 px-3.5 py-2 text-xs font-semibold text-white shadow-xs hover:bg-neutral-800"
          >
            <PlusCircle className="h-4 w-4" />
            Yangi xarajat
          </button>
        </div>
      </div>

      {/* Notifications */}
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
          <span>{error}</span>
        </div>
      )}
      {successMsg && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Metrics Row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-neutral-500 uppercase">Jami Xarajatlar</span>
            <span className="rounded-md bg-neutral-100 p-1.5 text-neutral-600">
              <DollarSign className="h-4 w-4" />
            </span>
          </div>
          <p className="mt-2 text-2xl font-bold tracking-tight text-neutral-900">
            {metrics.total.toLocaleString()} <span className="text-sm font-normal text-neutral-500">UZS</span>
          </p>
          <p className="mt-1 text-xs text-neutral-500">Tasdiqlangan · {periodFrom.split('-').reverse().join('.')} – {periodTo.split('-').reverse().join('.')}</p>
        </div>

        <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-neutral-500 uppercase">Naqd Xarajatlar</span>
            <span className="rounded-md bg-emerald-50 p-1.5 text-emerald-600">
              <Building2 className="h-4 w-4" />
            </span>
          </div>
          <p className="mt-2 text-2xl font-bold tracking-tight text-emerald-700">
            {metrics.cashTotal.toLocaleString()} <span className="text-sm font-normal text-neutral-500">UZS</span>
          </p>
          <p className="mt-1 text-xs text-neutral-500">Kassa qoldig'idan to'langan</p>
        </div>

        <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-neutral-500 uppercase">Tasdiqlangan</span>
            <span className="rounded-md bg-sky-50 p-1.5 text-sky-600">
              <CheckCircle2 className="h-4 w-4" />
            </span>
          </div>
          <p className="mt-2 text-2xl font-bold tracking-tight text-neutral-900">
            {metrics.confirmedCount} <span className="text-sm font-normal text-neutral-500">ta</span>
          </p>
          <p className="mt-1 text-xs text-neutral-500">Kassa kuni va buxgalteriyaga kiritilgan</p>
        </div>

        <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-neutral-500 uppercase">Qoralama (Draft)</span>
            <span className="rounded-md bg-amber-50 p-1.5 text-amber-600">
              <Clock className="h-4 w-4" />
            </span>
          </div>
          <p className="mt-2 text-2xl font-bold tracking-tight text-amber-700">
            {metrics.draftCount} <span className="text-sm font-normal text-neutral-500">ta</span>
          </p>
          <p className="mt-1 text-xs text-neutral-500">Tasdiq kutilayotgan xarajatlar</p>
        </div>
      </div>

      {/* Sub-Navigation Tabs */}
      <div className="border-b border-neutral-200">
        <nav className="flex space-x-6">
          <button
            onClick={() => setActiveTab('expenses')}
            className={`pb-3 text-sm font-medium transition-colors ${
              activeTab === 'expenses'
                ? 'border-b-2 border-neutral-900 text-neutral-900 font-semibold'
                : 'text-neutral-500 hover:text-neutral-700'
            }`}
          >
            Barcha xarajatlar ({expenses.length})
          </button>

          <button
            onClick={() => setActiveTab('categories')}
            className={`pb-3 text-sm font-medium transition-colors ${
              activeTab === 'categories'
                ? 'border-b-2 border-neutral-900 text-neutral-900 font-semibold'
                : 'text-neutral-500 hover:text-neutral-700'
            }`}
          >
            Xarajat toifalari va Oylik limitlar ({categories.length})
          </button>

          <button
            onClick={() => setActiveTab('employees')}
            className={`pb-3 text-sm font-medium transition-colors ${
              activeTab === 'employees'
                ? 'border-b-2 border-neutral-900 text-neutral-900 font-semibold'
                : 'text-neutral-500 hover:text-neutral-700'
            }`}
          >
            Xodimlar limitlari va Maosh taqsimoti ({employeeSummaries.length})
          </button>

          <button
            onClick={() => setActiveTab('reports')}
            className={`pb-3 text-sm font-medium transition-colors ${
              activeTab === 'reports'
                ? 'border-b-2 border-neutral-900 text-neutral-900 font-semibold'
                : 'text-neutral-500 hover:text-neutral-700'
            }`}
          >
            Kunlik & Oylik hisobotlar
          </button>
        </nav>
      </div>

      {/* TAB 1: EXPENSES LIST */}
      {activeTab === 'expenses' && (
        <div className="space-y-4">
          {/* Filters Bar */}
          <div className="flex flex-col gap-3 rounded-xl border border-neutral-200 bg-white p-4 shadow-xs lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-1 flex-wrap items-center gap-3">
              {/* Search */}
              <div className="relative min-w-[200px] flex-1 max-w-xs">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-neutral-400" />
                <input
                  type="text"
                  placeholder="Izoh yoki yaratuvchi bo'yicha qidiruv..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full rounded-lg border border-neutral-300 py-1.5 pl-9 pr-3 text-xs focus:border-neutral-900 focus:outline-none"
                />
              </div>

              {/* Category Filter */}
              <MultiSelect label="Toifa" allLabel="Barcha toifalar" value={filterCategory} onChange={setFilterCategory}
                options={categories.map(c => ({ value: c.id, label: c.name }))} />

              {/* Status Filter */}
              <MultiSelect label="Holat" allLabel="Barcha holatlar" value={filterStatus} onChange={setFilterStatus}
                options={[{ value: 'CONFIRMED', label: 'Tasdiqlangan' }, { value: 'DRAFT', label: 'Qoralama' }, { value: 'CANCELLED', label: 'Bekor qilingan' }]} />

              {/* Payment Method Filter */}
              <MultiSelect label="To‘lov usuli" value={filterPaymentMethod} onChange={setFilterPaymentMethod}
                options={[{ value: 'CASH', label: 'Naqd (Kassa)' }, { value: 'TERMINAL', label: 'Terminal' }, { value: 'CLICK', label: 'Click / Payme' }, { value: 'BANK_TRANSFER', label: 'Bank o‘tkazmasi' }, { value: 'OTHER', label: 'Boshqa' }]} />
            </div>
          </div>

          {/* Expenses Table */}
          <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-neutral-700">
                <thead className="border-b border-neutral-200 bg-neutral-50 text-[11px] font-semibold tracking-wider text-neutral-500 uppercase">
                  <tr>
                    <th className="px-4 py-3.5">Sana</th>
                    <th className="px-4 py-3.5">Toifa</th>
                    <th className="px-4 py-3.5">Turi & Taqsimot</th>
                    <th className="px-4 py-3.5">Summa</th>
                    <th className="px-4 py-3.5">To'lov usuli</th>
                    <th className="px-4 py-3.5">Izoh</th>
                    <th className="px-4 py-3.5">Holat</th>
                    <th className="px-4 py-3.5 text-right">Amallar</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {expenses.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-neutral-400">
                        Hozircha xarajatlar mavjud emas yoki tanlangan filtrlar bo'yicha hech narsa topilmadi.
                      </td>
                    </tr>
                  ) : (
                    expenses.map((exp) => (
                      <tr key={exp.id} className="hover:bg-neutral-50/75 transition-colors">
                        <td className="whitespace-nowrap px-4 py-3 font-medium text-neutral-900">
                          {exp.date}
                        </td>
                        <td className="px-4 py-3 font-medium text-neutral-800">
                          <div className="flex items-center gap-1.5">
                            <Tag className="h-3 w-3 text-neutral-400" />
                            <span>{exp.category_name || 'Toifa'}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {exp.is_company_expense ? (
                            <span className="inline-flex items-center gap-1 rounded bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-700">
                              <Building2 className="h-3 w-3 text-neutral-500" />
                              Kompaniya xarajati
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700">
                              <Users className="h-3 w-3 text-indigo-500" />
                              {exp.allocations?.length || 0} nafar xodimga
                            </span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 font-bold text-neutral-900">
                          {exp.amount.toLocaleString()} UZS
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          <span className={`inline-block rounded px-2 py-0.5 text-[11px] font-medium ${
                            exp.payment_method === 'CASH' 
                              ? 'bg-emerald-50 text-emerald-700' 
                              : exp.payment_method === 'TERMINAL' 
                              ? 'bg-blue-50 text-blue-700' 
                              : exp.payment_method === 'CLICK'
                              ? 'bg-purple-50 text-purple-700'
                              : 'bg-neutral-100 text-neutral-700'
                          }`}>
                            {exp.payment_method}
                          </span>
                        </td>
                        <td className="max-w-[220px] truncate px-4 py-3 text-neutral-600">
                          {exp.comment || '—'}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                            exp.status === 'CONFIRMED'
                              ? 'bg-emerald-100 text-emerald-800'
                              : exp.status === 'DRAFT'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-rose-100 text-rose-800'
                          }`}>
                            {exp.status === 'CONFIRMED' && <Check className="h-3 w-3" />}
                            {exp.status === 'DRAFT' && <Clock className="h-3 w-3" />}
                            {exp.status === 'CANCELLED' && <X className="h-3 w-3" />}
                            {exp.status === 'CONFIRMED' ? 'Tasdiqlangan' : exp.status === 'DRAFT' ? 'Qoralama' : 'Bekor qilingan'}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {/* Detail Button */}
                            <button
                              onClick={() => setSelectedExpenseDetail(exp)}
                              className="rounded border border-neutral-200 bg-white p-1 text-neutral-600 hover:bg-neutral-100"
                              title="Tafsilotlar"
                            >
                              <Info className="h-3.5 w-3.5" />
                            </button>

                            {/* Actions for DRAFT */}
                            {exp.status === 'DRAFT' && (
                              <>
                                <button
                                  onClick={() => handleConfirmExpense(exp.id)}
                                  disabled={actionLoading}
                                  className="rounded bg-emerald-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-emerald-700"
                                  title="Tasdiqlash"
                                >
                                  Tasdiqlash
                                </button>

                                <button
                                  onClick={() => setCancelModalExpense(exp)}
                                  className="rounded border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] font-medium text-rose-700 hover:bg-rose-100"
                                  title="Bekor qilish"
                                >
                                  Bekor qilish
                                </button>
                              </>
                            )}

                            {/* Correction for CONFIRMED */}
                            {exp.status === 'CONFIRMED' && (
                              <button
                                onClick={() => {
                                  setCorrectionExpense(exp);
                                  setCorrectionForm({
                                    amount: exp.amount,
                                    comment: exp.comment,
                                    reason: ''
                                  });
                                }}
                                className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-800 hover:bg-amber-100"
                                title="Korreksiya kiritish"
                              >
                                Korreksiya
                              </button>
                            )}
                          </div>
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

      {/* TAB 2: CATEGORIES & MONTHLY LIMITS */}
      {activeTab === 'categories' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-neutral-900">Xarajat toifalari</h2>
              <p className="text-xs text-neutral-500">
                Toifalar bo'yicha oylik limitlar belgilanadi va xarajat summasi limitdan oshsa ogohlantirish beriladi
              </p>
            </div>
            <button
              onClick={() => {
                setEditingCategory(null);
                setCategoryForm({ name: '', description: '', monthly_limit: '', is_active: true });
                setIsCategoryModalOpen(true);
              }}
              className="flex items-center gap-1.5 rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-neutral-800"
            >
              <PlusCircle className="h-4 w-4" />
              Yangi Toifa qo'shish
            </button>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {categories.map((cat) => {
              // Find usage from monthly report if available
              const catReport = monthlyReport?.category_totals?.find((c: any) => c.category_id === cat.id);
              const usedAmount = catReport?.amount || 0;
              const percent = cat.monthly_limit > 0 ? Math.min(100, Math.round((usedAmount / cat.monthly_limit) * 100)) : 0;
              const isOverLimit = cat.monthly_limit > 0 && usedAmount > cat.monthly_limit;

              return (
                <div key={cat.id} className="flex flex-col justify-between rounded-xl border border-neutral-200 bg-white p-5 shadow-xs">
                  <div>
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold text-neutral-900 text-sm">{cat.name}</h3>
                      <button
                        onClick={() => handleToggleCategoryActive(cat)}
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          cat.is_active
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-neutral-100 text-neutral-500'
                        }`}
                      >
                        {cat.is_active ? 'Faol' : 'Nofaol'}
                      </button>
                    </div>

                    <p className="mt-1 text-xs text-neutral-500">{cat.description || 'Ta\'rif kiritilmagan'}</p>

                    <div className="mt-4">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-neutral-500">Oylik limit:</span>
                        <span className="font-semibold text-neutral-800">
                          {/* Categories from the connected system often have no limit at all. */}
                          {cat.monthly_limit ? `${(cat.monthly_limit ?? 0).toLocaleString()} UZS` : 'Limitsiz'}
                        </span>
                      </div>

                      <div className="mt-2 flex items-center justify-between text-xs">
                        <span className="text-neutral-500">Joriy oyda ishlatilgan:</span>
                        <span className={`font-semibold ${isOverLimit ? 'text-rose-600' : 'text-neutral-900'}`}>
                          {usedAmount.toLocaleString()} UZS ({percent}%)
                        </span>
                      </div>

                      {/* Progress Bar */}
                      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-neutral-100">
                        <div
                          className={`h-full transition-all duration-300 ${
                            isOverLimit
                              ? 'bg-rose-500'
                              : percent > 85
                              ? 'bg-amber-500'
                              : 'bg-emerald-500'
                          }`}
                          style={{ width: `${percent}%` }}
                        />
                      </div>

                      {isOverLimit && (
                        <div className="mt-2 flex items-center gap-1 text-[11px] font-medium text-rose-600">
                          <AlertTriangle className="h-3 w-3" />
                          <span>Limit {((usedAmount - cat.monthly_limit)).toLocaleString()} UZS ga oshib ketgan!</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="mt-5 flex items-center justify-end gap-2 border-t border-neutral-100 pt-3">
                    <button
                      onClick={() => {
                        setEditingCategory(cat);
                        setCategoryForm({
                          name: cat.name,
                          description: cat.description || '',
                          monthly_limit: cat.monthly_limit,
                          is_active: cat.is_active
                        });
                        setIsCategoryModalOpen(true);
                      }}
                      className="rounded border border-neutral-200 px-2 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
                    >
                      Tahrirlash
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 3: EMPLOYEES & LIMITS */}
      {activeTab === 'employees' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-neutral-900">Xodimlar xarajatlari va Kunlik limitlar</h2>
              <p className="text-xs text-neutral-500">
                Xodimlarga taqsimlangan tushlik, yo'lkira yoki boshqa xarajatlar oylik maoshidan ushlab qolinishi mumkin
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-neutral-500">Oy:</span>
              <input
                type="month"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="rounded-lg border border-neutral-300 px-2.5 py-1 text-xs focus:border-neutral-900 focus:outline-none"
              />
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-neutral-700">
                <thead className="border-b border-neutral-200 bg-neutral-50 text-[11px] font-semibold tracking-wider text-neutral-500 uppercase">
                  <tr>
                    <th className="px-4 py-3.5">Xodim</th>
                    <th className="px-4 py-3.5">Lavozim</th>
                    <th className="px-4 py-3.5">Oylik maoshi</th>
                    <th className="px-4 py-3.5">Kunlik limit</th>
                    <th className="px-4 py-3.5">Oylik xarajatlari</th>
                    <th className="px-4 py-3.5">Qolgan maosh summasi</th>
                    <th className="px-4 py-3.5 text-right">Amallar</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {employeeSummaries.filter(item => item?.employee).map((item) => (
                    <tr key={item.employee.id} className="hover:bg-neutral-50/75 transition-colors">
                      <td className="px-4 py-3 font-semibold text-neutral-900">
                        {item.employee.full_name}
                      </td>
                      <td className="px-4 py-3 text-neutral-600">{item.employee.position}</td>
                      <td className="px-4 py-3 font-medium text-neutral-800">
                        {item.salary?.final_amount !== undefined ? `${item.salary.final_amount.toLocaleString()} UZS` : <span className="text-neutral-400">shu oy hisoblanmagan</span>}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1 rounded bg-neutral-100 px-2 py-0.5 text-xs font-semibold text-neutral-800">
                          {(item.daily_limit?.daily_limit ?? 20000).toLocaleString()} UZS
                        </span>
                      </td>
                      <td className="px-4 py-3 font-semibold text-rose-700">
                        {(item.total_expenses ?? 0).toLocaleString()} UZS
                      </td>
                      <td className={`px-4 py-3 font-bold ${(item.remaining_salary ?? 0) < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                        {item.remaining_salary === null || item.remaining_salary === undefined ? '—' : `${item.remaining_salary.toLocaleString()} UZS`}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => {
                            setLimitModalEmployee(item.employee);
                            setNewDailyLimit(item.daily_limit?.daily_limit ?? 20000);
                          }}
                          className="rounded border border-neutral-200 bg-white px-2 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
                        >
                          Limitni o'zgartirish
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: REPORTS & ANALYTICS */}
      {activeTab === 'reports' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Daily Report */}
            <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-xs">
              <div className="flex items-center justify-between border-b border-neutral-100 pb-3">
                <div>
                  <h3 className="font-semibold text-neutral-900">Kunlik Xarajatlar Hisoboti</h3>
                  <p className="text-xs text-neutral-500">Sana: {selectedDate}</p>
                </div>
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="rounded-lg border border-neutral-300 px-2.5 py-1 text-xs focus:border-neutral-900 focus:outline-none"
                />
              </div>

              {dailyReport ? (
                <div className="mt-4 space-y-4">
                  <div className="rounded-lg bg-neutral-50 p-4">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-neutral-500">Kunning umumiy xarajati:</span>
                      <span className="font-bold text-neutral-900 text-lg">
                        {(dailyReport.total ?? 0).toLocaleString()} UZS
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-neutral-500">{dailyReport.expenses_count ?? 0} ta xarajat</p>
                  </div>

                  <div>
                    <h4 className="text-xs font-semibold text-neutral-700 uppercase tracking-wider">To‘lov turi kesimida</h4>
                    <div className="mt-2 divide-y divide-neutral-100">
                      {Object.entries(dailyReport.by_payment_method || {}).filter(([, v]) => Number(v) > 0).map(([method, amount]) => (
                        <div key={method} className="flex items-center justify-between py-2 text-xs">
                          <span className="font-medium text-neutral-800">{({ CASH: 'Naqd', TERMINAL: 'Terminal', CLICK: 'Click / Payme', BANK_TRANSFER: 'Bank o‘tkazma', OTHER: 'Boshqa' } as Record<string, string>)[method] || method}</span>
                          <span className="font-semibold text-neutral-900">{Number(amount).toLocaleString()} UZS</span>
                        </div>
                      ))}
                      {!Object.values(dailyReport.by_payment_method || {}).some(v => Number(v) > 0) && <p className="py-2 text-xs text-neutral-400">Bu kunda xarajat yo‘q.</p>}
                    </div>
                  </div>
                </div>
              ) : (
                <p className="mt-4 text-xs text-neutral-400">Kunlik hisobot ma'lumotlari mavjud emas</p>
              )}
            </div>

            {/* Monthly Report */}
            <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-xs">
              <div className="flex items-center justify-between border-b border-neutral-100 pb-3">
                <div>
                  <h3 className="font-semibold text-neutral-900">Oylik Xarajatlar va Limitlar</h3>
                  <p className="text-xs text-neutral-500">Oy: {selectedMonth}</p>
                </div>
                <input
                  type="month"
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  className="rounded-lg border border-neutral-300 px-2.5 py-1 text-xs focus:border-neutral-900 focus:outline-none"
                />
              </div>

              {monthlyReport ? (
                <div className="mt-4 space-y-4">
                  <div className="rounded-lg bg-neutral-50 p-4">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-neutral-500">Oyning umumiy xarajati:</span>
                      <span className="font-bold text-neutral-900 text-lg">
                        {(monthlyReport.total_expense ?? 0).toLocaleString()} UZS
                      </span>
                    </div>
                  </div>

                  <div>
                    <h4 className="text-xs font-semibold text-neutral-700 uppercase tracking-wider">Toifalar va Oylik Limit holati</h4>
                    <div className="mt-2 divide-y divide-neutral-100">
                      {/* Only categories that were used this month or have a limit; 55 empty rows say nothing. */}
                      {(monthlyReport.category_totals || []).filter((c: any) => c.amount > 0 || c.monthly_limit > 0).map((c: any) => (
                        <div key={c.category_id} className="py-2">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-medium text-neutral-800">{c.category_name}</span>
                            <span className="font-semibold text-neutral-900">
                              {(c.amount ?? 0).toLocaleString()} {c.monthly_limit ? `/ ${c.monthly_limit.toLocaleString()} ` : ''}UZS
                            </span>
                          </div>
                          {c.excess > 0 && (
                            <p className="mt-0.5 text-[10px] font-semibold text-rose-600">
                              Limitdan ortiqcha: {c.excess.toLocaleString()} UZS
                            </p>
                          )}
                        </div>
                      ))}
                      {!(monthlyReport.category_totals || []).some((c: any) => c.amount > 0 || c.monthly_limit > 0) && <p className="py-2 text-xs text-neutral-400">Bu oyda xarajat yo‘q.</p>}
                    </div>
                  </div>
                </div>
              ) : (
                <p className="mt-4 text-xs text-neutral-400">Oylik hisobot ma'lumotlari mavjud emas</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* MODAL: CREATE EXPENSE */}
      {isCreateExpenseOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-neutral-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-neutral-100 pb-4">
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-neutral-900 text-white">
                  <PlusCircle className="h-4 w-4" />
                </span>
                <h3 className="font-bold text-neutral-900 text-lg">Yangi Xarajat Yaratish</h3>
              </div>
              <button
                onClick={() => setIsCreateExpenseOpen(false)}
                className="rounded p-1 text-neutral-400 hover:text-neutral-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCreateExpense} className="mt-4 space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold text-neutral-700">Sana</label>
                  <input
                    type="date"
                    required
                    value={expenseForm.date}
                    onChange={(e) => setExpenseForm({ ...expenseForm, date: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-neutral-300 p-2 text-xs focus:border-neutral-900 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-neutral-700">Toifa</label>
                  <select
                    required
                    value={expenseForm.category_id}
                    onChange={(e) => setExpenseForm({ ...expenseForm, category_id: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-neutral-300 p-2 text-xs focus:border-neutral-900 focus:outline-none"
                  >
                    <option value="">Toifani tanlang...</option>
                    {categories.filter(c => c.is_active).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}{c.monthly_limit ? ` (Limit: ${c.monthly_limit.toLocaleString()} UZS)` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold text-neutral-700">Xarajat summasi (UZS)</label>
                  <input
                    type="number"
                    required
                    min={1}
                    placeholder="Masalan: 70000"
                    value={expenseForm.amount}
                    onChange={(e) => setExpenseForm({ ...expenseForm, amount: e.target.value ? Number(e.target.value) : '' })}
                    className="mt-1 w-full rounded-lg border border-neutral-300 p-2 text-xs font-bold text-neutral-900 focus:border-neutral-900 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-neutral-700">To'lov usuli</label>
                  <select
                    value={expenseForm.payment_method}
                    onChange={(e) => setExpenseForm({ ...expenseForm, payment_method: e.target.value as any })}
                    className="mt-1 w-full rounded-lg border border-neutral-300 p-2 text-xs focus:border-neutral-900 focus:outline-none"
                  >
                    <option value="CASH">Naqd (Kassadan chiqim qilinadi)</option>
                    <option value="TERMINAL">Terminal</option>
                    <option value="CLICK">Click / Payme</option>
                    <option value="BANK_TRANSFER">Bank hisobidan o'tkazma</option>
                    <option value="OTHER">Boshqa</option>
                  </select>
                </div>
              </div>

              {/* Company vs Employees selection */}
              <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4">
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-neutral-800">
                    <input
                      type="radio"
                      checked={expenseForm.is_company_expense}
                      onChange={() => setExpenseForm({ ...expenseForm, is_company_expense: true, selected_employees: [] })}
                      className="text-neutral-900"
                    />
                    <span>Kompaniya umumiy xarajati (Xodimga bog'lanmaydi)</span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-neutral-800">
                    <input
                      type="radio"
                      checked={!expenseForm.is_company_expense}
                      onChange={() => setExpenseForm({ ...expenseForm, is_company_expense: false })}
                      className="text-neutral-900"
                    />
                    <span>Xodimlar o'rtasida taqsimlash</span>
                  </label>
                </div>

                {!expenseForm.is_company_expense && (
                  <div className="mt-4 border-t border-neutral-200 pt-3">
                    <p className="text-xs font-semibold text-neutral-700">
                      Taqsimlanadigan xodimlarni tanlang (Deterministic yaxlitlash qo'llaniladi):
                    </p>
                    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 max-h-36 overflow-y-auto">
                      {employees.map((emp) => {
                        const isSelected = expenseForm.selected_employees.includes(emp.id);
                        return (
                          <button
                            key={emp.id}
                            type="button"
                            onClick={() => {
                              const updated = isSelected
                                ? expenseForm.selected_employees.filter(id => id !== emp.id)
                                : [...expenseForm.selected_employees, emp.id];
                              setExpenseForm({ ...expenseForm, selected_employees: updated });
                            }}
                            className={`flex items-center justify-between rounded-lg border p-2 text-left text-xs transition-colors ${
                              isSelected
                                ? 'border-neutral-900 bg-neutral-900 text-white font-medium'
                                : 'border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-100'
                            }`}
                          >
                            <span className="truncate">{emp.full_name}</span>
                            {isSelected && <Check className="h-3 w-3 shrink-0 ml-1" />}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* LIVE PREVIEW & LIMIT VALIDATIONS */}
              {previewLoading && (
                <div className="flex items-center gap-2 rounded-lg bg-neutral-50 p-3 text-xs text-neutral-500">
                  <RefreshCw className="h-3 w-3 animate-spin" />
                  <span>Limitlar va taqsimot hisoblanmoqda...</span>
                </div>
              )}

              {previewData && (
                <div className="rounded-xl border border-neutral-200 bg-neutral-50/75 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold text-neutral-900 uppercase tracking-wider">
                      Jonli Limit va Taqsimot Ko'rinishi
                    </h4>
                    {previewData.payment_method === 'CASH' && (
                      <span className="rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
                        Kassa ta'siri: -{Math.abs(previewData.company_cash_impact || 0).toLocaleString()} UZS
                      </span>
                    )}
                  </div>

                  {/* Category Status */}
                  <div className="text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-neutral-600">Toifa oylik holati:</span>
                      <span className="font-semibold text-neutral-900">
                        {previewData.category.remaining_month === null || previewData.category.remaining_month === undefined
                          ? `Limitsiz · shu oy ${(previewData.category.used_month ?? 0).toLocaleString()} UZS`
                          : `Qoldiq: ${previewData.category.remaining_month.toLocaleString()} UZS`}
                      </span>
                    </div>
                    {previewData.category.excess_month > 0 && (
                      <p className="mt-1 flex items-center gap-1 font-semibold text-rose-600">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        Diqqat: Ushbu toifaning oylik limiti {previewData.category.excess_month.toLocaleString()} UZS ga oshib ketadi!
                      </p>
                    )}
                  </div>

                  {/* Employee Allocations Breakdown */}
                  {previewData.employees.length > 0 && (
                    <div className="border-t border-neutral-200 pt-2 space-y-1">
                      <p className="text-[11px] font-semibold text-neutral-600">Xodimlar taqsimoti:</p>
                      {previewData.employees.map((emp) => (
                        <div key={emp.employee_id} className="flex items-center justify-between text-xs py-1 border-b border-neutral-100 last:border-none">
                          <span className="font-medium text-neutral-800">{emp.employee_name}</span>
                          <div className="text-right">
                            <span className="font-bold text-neutral-900">{emp.allocated_amount.toLocaleString()} UZS</span>
                            {emp.excess_today > 0 ? (
                              <span className="ml-2 text-[10px] font-semibold text-rose-600">
                                (Kunlik limitdan +{emp.excess_today.toLocaleString()} UZS oshiq)
                              </span>
                            ) : (
                              <span className="ml-2 text-[10px] text-emerald-600">
                                (Limit ichida)
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Comment */}
              <div>
                <label className="block text-xs font-semibold text-neutral-700">Izoh / Tafsilot</label>
                <textarea
                  rows={2}
                  placeholder="Masalan: Tushlik yoki ofis materiallari xaridi"
                  value={expenseForm.comment}
                  onChange={(e) => setExpenseForm({ ...expenseForm, comment: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-neutral-300 p-2 text-xs focus:border-neutral-900 focus:outline-none"
                />
              </div>

              {/* Direct confirmation checkbox */}
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="confirmImmediately"
                  checked={expenseForm.confirm_immediately}
                  onChange={(e) => setExpenseForm({ ...expenseForm, confirm_immediately: e.target.checked })}
                  className="rounded border-neutral-300 text-neutral-900 focus:ring-neutral-900"
                />
                <label htmlFor="confirmImmediately" className="text-xs text-neutral-700 cursor-pointer">
                  Darhol tasdiqlash va kassa balansiga kiritish (CONFIRMED)
                </label>
              </div>

              {/* Form Buttons */}
              <div className="flex items-center justify-end gap-2 border-t border-neutral-100 pt-4">
                <button
                  type="button"
                  onClick={() => setIsCreateExpenseOpen(false)}
                  className="rounded-lg border border-neutral-300 px-4 py-2 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
                >
                  Bekor qilish
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="rounded-lg bg-neutral-900 px-4 py-2 text-xs font-semibold text-white hover:bg-neutral-800 disabled:opacity-50"
                >
                  {actionLoading ? 'Saqlanmoqda...' : 'Xarajatni Saqlash'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: CATEGORY CREATE / EDIT */}
      {isCategoryModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl border border-neutral-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-neutral-100 pb-3">
              <h3 className="font-bold text-neutral-900 text-base">
                {editingCategory ? 'Toifani Tahrirlash' : 'Yangi Xarajat Toifasi'}
              </h3>
              <button
                onClick={() => setIsCategoryModalOpen(false)}
                className="rounded p-1 text-neutral-400 hover:text-neutral-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSaveCategory} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-neutral-700">Toifa nomi</label>
                <input
                  type="text"
                  required
                  placeholder="Masalan: Tushlik, Yoqilg'i, Kantselyariya"
                  value={categoryForm.name}
                  onChange={(e) => setCategoryForm({ ...categoryForm, name: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-neutral-300 p-2 text-xs focus:border-neutral-900 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-700">Oylik limit (UZS)</label>
                <input
                  type="number"
                  required
                  min={0}
                  placeholder="Masalan: 5000000"
                  value={categoryForm.monthly_limit}
                  onChange={(e) => setCategoryForm({ ...categoryForm, monthly_limit: e.target.value ? Number(e.target.value) : '' })}
                  className="mt-1 w-full rounded-lg border border-neutral-300 p-2 text-xs font-bold focus:border-neutral-900 focus:outline-none"
                />
                <p className="mt-1 text-[11px] text-neutral-500">0 kiritilsa cheklov belgilanmaydi</p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-700">Ta'rif</label>
                <textarea
                  rows={2}
                  placeholder="Toifa haqida qo'shimcha ma'lumot..."
                  value={categoryForm.description}
                  onChange={(e) => setCategoryForm({ ...categoryForm, description: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-neutral-300 p-2 text-xs focus:border-neutral-900 focus:outline-none"
                />
              </div>

              {editingCategory && (
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="catActive"
                    checked={categoryForm.is_active}
                    onChange={(e) => setCategoryForm({ ...categoryForm, is_active: e.target.checked })}
                    className="rounded border-neutral-300 text-neutral-900 focus:ring-neutral-900"
                  />
                  <label htmlFor="catActive" className="text-xs text-neutral-700 cursor-pointer">
                    Faol toifa (Nofaol qilinsa yangi xarajat kiritish taqiqlanadi)
                  </label>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 border-t border-neutral-100 pt-4">
                <button
                  type="button"
                  onClick={() => setIsCategoryModalOpen(false)}
                  className="rounded-lg border border-neutral-300 px-4 py-2 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
                >
                  Bekor qilish
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="rounded-lg bg-neutral-900 px-4 py-2 text-xs font-semibold text-white hover:bg-neutral-800 disabled:opacity-50"
                >
                  {actionLoading ? 'Saqlanmoqda...' : 'Saqlash'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: EXPENSE DETAIL */}
      {selectedExpenseDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-2xl border border-neutral-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-neutral-100 pb-3">
              <div className="flex items-center gap-2">
                <Receipt className="h-5 w-5 text-neutral-900" />
                <h3 className="font-bold text-neutral-900 text-base">Xarajat Tafsilotlari</h3>
              </div>
              <button
                onClick={() => setSelectedExpenseDetail(null)}
                className="rounded p-1 text-neutral-400 hover:text-neutral-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-4 space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3 rounded-lg bg-neutral-50 p-3">
                <div>
                  <span className="text-neutral-500">ID:</span>
                  <p className="font-mono font-medium text-neutral-800">{selectedExpenseDetail.id}</p>
                </div>
                <div>
                  <span className="text-neutral-500">Sana:</span>
                  <p className="font-semibold text-neutral-900">{selectedExpenseDetail.date}</p>
                </div>
                <div>
                  <span className="text-neutral-500">Toifa:</span>
                  <p className="font-semibold text-neutral-900">{selectedExpenseDetail.category_name}</p>
                </div>
                <div>
                  <span className="text-neutral-500">Summa:</span>
                  <p className="font-bold text-emerald-700 text-sm">{selectedExpenseDetail.amount.toLocaleString()} UZS</p>
                </div>
                <div>
                  <span className="text-neutral-500">To'lov usuli:</span>
                  <p className="font-medium text-neutral-800">{selectedExpenseDetail.payment_method}</p>
                </div>
                <div>
                  <span className="text-neutral-500">Holat:</span>
                  <p className="font-semibold text-neutral-900">{selectedExpenseDetail.status}</p>
                </div>
              </div>

              {selectedExpenseDetail.comment && (
                <div>
                  <span className="text-neutral-500 font-medium">Izoh:</span>
                  <p className="mt-0.5 text-neutral-800 bg-neutral-50 p-2.5 rounded-lg">{selectedExpenseDetail.comment}</p>
                </div>
              )}

              {selectedExpenseDetail.cash_transaction_id && (
                <div className="rounded-lg border border-neutral-200 p-3">
                  <div className="flex items-center gap-2 text-neutral-800 font-medium">
                    <ShieldCheck className="h-4 w-4 text-emerald-600" />
                    <span>Kassa Tranzaksiyasiga bog'langan</span>
                  </div>
                  <p className="mt-1 font-mono text-[11px] text-neutral-500">
                    Tranzaksiya ID: {selectedExpenseDetail.cash_transaction_id}
                  </p>
                </div>
              )}

              {/* Allocations breakdown */}
              {selectedExpenseDetail.allocations && selectedExpenseDetail.allocations.length > 0 && (
                <div>
                  <span className="text-neutral-600 font-semibold uppercase tracking-wider text-[11px]">
                    Xodimlarga taqsimlangan summa:
                  </span>
                  <div className="mt-1 space-y-1 divide-y divide-neutral-100 rounded-lg border border-neutral-200 p-2">
                    {selectedExpenseDetail.allocations.map((a) => (
                      <div key={a.id} className="flex items-center justify-between py-1.5">
                        <span className="font-medium text-neutral-800">{a.employee_name || a.employee_id}</span>
                        <span className="font-bold text-neutral-900">{a.allocated_amount.toLocaleString()} UZS</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="mt-6 flex items-center justify-end gap-2 border-t border-neutral-100 pt-3">
              <button
                onClick={() => setSelectedExpenseDetail(null)}
                className="rounded-lg border border-neutral-300 px-4 py-2 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
              >
                Yopish
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: CORRECTION */}
      {correctionExpense && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl border border-neutral-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-neutral-100 pb-3">
              <div className="flex items-center gap-2">
                <Edit3 className="h-5 w-5 text-amber-600" />
                <h3 className="font-bold text-neutral-900 text-base">Xarajatni Tuzatish (Korreksiya)</h3>
              </div>
              <button
                onClick={() => setCorrectionExpense(null)}
                className="rounded p-1 text-neutral-400 hover:text-neutral-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCorrectExpense} className="mt-4 space-y-4">
              <div className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
                Diqqat: Tasdiqlangan xarajat to'g'ridan-to'g'ri o'zgartirilmaydi. Barcha tuzatishlar audit jurnalida korreksiya sifatida muhrlanadi.
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-700">Yangi Summa (UZS)</label>
                <input
                  type="number"
                  min={1}
                  required
                  value={correctionForm.amount}
                  onChange={(e) => setCorrectionForm({ ...correctionForm, amount: e.target.value ? Number(e.target.value) : '' })}
                  className="mt-1 w-full rounded-lg border border-neutral-300 p-2 text-xs font-bold text-neutral-900 focus:border-neutral-900 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-700">Yangi Izoh</label>
                <input
                  type="text"
                  value={correctionForm.comment}
                  onChange={(e) => setCorrectionForm({ ...correctionForm, comment: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-neutral-300 p-2 text-xs focus:border-neutral-900 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-rose-700">
                  Korreksiya Sababi (Audit jurnali uchun majburiy) *
                </label>
                <textarea
                  rows={2}
                  required
                  placeholder="Nima uchun o'zgartirilayotganini aniq bayon qiling..."
                  value={correctionForm.reason}
                  onChange={(e) => setCorrectionForm({ ...correctionForm, reason: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-rose-300 p-2 text-xs focus:border-rose-600 focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-neutral-100 pt-4">
                <button
                  type="button"
                  onClick={() => setCorrectionExpense(null)}
                  className="rounded-lg border border-neutral-300 px-4 py-2 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
                >
                  Bekor qilish
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="rounded-lg bg-amber-600 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
                >
                  {actionLoading ? 'Saqlanmoqda...' : 'Korreksiyani Tasdiqlash'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: CANCEL EXPENSE */}
      {cancelModalExpense && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl border border-neutral-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-neutral-100 pb-3">
              <div className="flex items-center gap-2 text-rose-600">
                <AlertTriangle className="h-5 w-5" />
                <h3 className="font-bold text-neutral-900 text-base">Xarajatni Bekor Qilish</h3>
              </div>
              <button
                onClick={() => setCancelModalExpense(null)}
                className="rounded p-1 text-neutral-400 hover:text-neutral-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-4 space-y-4">
              <p className="text-xs text-neutral-600">
                Siz <strong>{cancelModalExpense.amount.toLocaleString()} UZS</strong> ({cancelModalExpense.category_name}) xarajatini bekor qilmoqchisiz.
              </p>

              <div>
                <label className="block text-xs font-semibold text-neutral-700">
                  Bekor qilish sababi *
                </label>
                <textarea
                  rows={2}
                  required
                  placeholder="Bekor qilish sababini kiriting..."
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-neutral-300 p-2 text-xs focus:border-neutral-900 focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-neutral-100 pt-3">
                <button
                  type="button"
                  onClick={() => setCancelModalExpense(null)}
                  className="rounded-lg border border-neutral-300 px-4 py-2 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
                >
                  Ortga
                </button>
                <button
                  type="button"
                  onClick={handleCancelExpense}
                  disabled={actionLoading}
                  className="rounded-lg bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
                >
                  {actionLoading ? 'Bekor qilinmoqda...' : 'Bekor Qilishni Tasdiqlash'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: EMPLOYEE DAILY LIMIT */}
      {limitModalEmployee && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl border border-neutral-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-neutral-100 pb-3">
              <h3 className="font-bold text-neutral-900 text-base">Xodim Kunlik Limitini O'rnatish</h3>
              <button
                onClick={() => setLimitModalEmployee(null)}
                className="rounded p-1 text-neutral-400 hover:text-neutral-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEmployeeDailyLimit} className="mt-4 space-y-4">
              <div className="rounded-lg bg-neutral-50 p-3 text-xs">
                <span className="text-neutral-500">Xodim:</span>
                <p className="font-bold text-neutral-900">{limitModalEmployee.full_name}</p>
                <p className="text-neutral-500">{limitModalEmployee.position}</p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-700">Yangi Kunlik Limit (UZS)</label>
                <input
                  type="number"
                  min={0}
                  required
                  value={newDailyLimit}
                  onChange={(e) => setNewDailyLimit(Number(e.target.value))}
                  className="mt-1 w-full rounded-lg border border-neutral-300 p-2 text-xs font-bold text-neutral-900 focus:border-neutral-900 focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-neutral-100 pt-3">
                <button
                  type="button"
                  onClick={() => setLimitModalEmployee(null)}
                  className="rounded-lg border border-neutral-300 px-4 py-2 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
                >
                  Bekor qilish
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="rounded-lg bg-neutral-900 px-4 py-2 text-xs font-semibold text-white hover:bg-neutral-800 disabled:opacity-50"
                >
                  {actionLoading ? 'Saqlanmoqda...' : 'Limitni Saqlash'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
