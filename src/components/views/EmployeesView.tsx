import React, { useState, useEffect, useMemo } from 'react';
import { localToday } from '../../utils/date';
import { 
  UserCheck, 
  DollarSign, 
  Calculator, 
  CheckCircle, 
  AlertCircle, 
  Layers, 
  Plus, 
  Calendar, 
  CreditCard, 
  FileSpreadsheet, 
  RefreshCw,
  X,
  Truck,
  MapPin,
  Eye,
  User,
  Edit2,
  Trash2,
  UserPlus,
  Shield,
  Percent,
  Coins,
  Search,
  Briefcase,
  Phone,
  ScanFace
} from 'lucide-react';
import { api } from '../../services/api.ts';
import { AuthUser } from '../../types.ts';
import { TableToolbar, matchesSearch, exportTableXlsx, isPicked, picked, pickedLabels } from '../common/TableToolbar.tsx';
import { PaySchemeEditor, PayComponent, describePayComponent, WORK_UNIT_LABEL } from './payroll/PaySchemeEditor.tsx';
import { WorkEntryModal } from './payroll/WorkEntryModal.tsx';
import { AttendanceManager } from '../faceid/AttendanceManager.tsx';

interface EmployeesViewProps {
  user: AuthUser | null;
}

export const EmployeesView: React.FC<EmployeesViewProps> = ({ user }) => {
  const [employees, setEmployees] = useState<any[]>([]);
  const [salaries, setSalaries] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [currentMonth, setCurrentMonth] = useState<string>(
    new Date().toISOString().slice(0, 7)
  );
  const [activeTab, setActiveTab] = useState<'PAYROLL' | 'EMPLOYEES' | 'PIECEWORK' | 'ATTENDANCE'>('PAYROLL');

  // Employee Management Modal State
  const [showEmployeeModal, setShowEmployeeModal] = useState<boolean>(false);
  const [editingEmployee, setEditingEmployee] = useState<any | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState<boolean>(false);
  const [employeeToDelete, setEmployeeToDelete] = useState<any | null>(null);
  const [isSavingEmployee, setIsSavingEmployee] = useState<boolean>(false);
  const [isDeletingEmployee, setIsDeletingEmployee] = useState<boolean>(false);
  const [employeeSearch, setEmployeeSearch] = useState<string>('');

  const [employeeForm, setEmployeeForm] = useState({
    full_name: '',
    position: 'Savdo Agenti',
    phone: '',
    pay_components: [] as PayComponent[],
    daily_expense_limit: 20000,
    is_agent: false,
    agent_code: '',
    status: 'ACTIVE' as 'ACTIVE' | 'INACTIVE'
  });

  // Modals
  const [showCalculateModal, setShowCalculateModal] = useState<boolean>(false);
  const [showWorkModal, setShowWorkModal] = useState<boolean>(false);
  const [showCabinetModal, setShowCabinetModal] = useState<boolean>(false);
  const [showPayModal, setShowPayModal] = useState<boolean>(false);

  // Forms
  const [calcForm, setCalcForm] = useState({
    employee_id: '',
    period_month: currentMonth
  });
  const [selectedPayrollIds, setSelectedPayrollIds] = useState<string[]>([]);
  const [calcBreakdown, setCalcBreakdown] = useState<any>(null);
  const [isCalculating, setIsCalculating] = useState<boolean>(false);

  // Personal Cabinet State
  const [cabinetEmployee, setCabinetEmployee] = useState<any>(null);
  const [cabinetData, setCabinetData] = useState<any>(null);
  const [cabinetLoading, setCabinetLoading] = useState<boolean>(false);

  const [payForm, setPayForm] = useState({
    salary_id: '',
    cash_day_id: '',
    payment_method: 'CASH' as 'CASH' | 'BANK_TRANSFER'
  });
  const [selectedSalaryToPay, setSelectedSalaryToPay] = useState<any>(null);

  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [empRes, salRes] = await Promise.all([
        api.getEmployees(),
        api.getSalaries(currentMonth)
      ]);
      setEmployees(empRes.employees || []);
      setSalaries(salRes.salaries || []);
    } catch (err: any) {
      console.error('Error fetching employees/salaries:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [currentMonth]);

  // Employee CRUD handlers
  const handleOpenAddEmployee = () => {
    setEditingEmployee(null);
    setEmployeeForm({
      full_name: '',
      position: 'Savdo Agenti',
      phone: '+998 ',
      pay_components: [],
      daily_expense_limit: 20000,
      is_agent: true,
      agent_code: '', // empty = the server gives the next free code (AG-001, AG-002 …)
      status: 'ACTIVE'
    });
    setActionError(null);
    setShowEmployeeModal(true);
  };

  const handleOpenEditEmployee = (emp: any) => {
    setEditingEmployee(emp);
    setEmployeeForm({
      full_name: emp.full_name || '',
      position: emp.position || '',
      phone: emp.phone || '',
      pay_components: emp.pay_components || [],
      daily_expense_limit: emp.daily_expense_limit ?? 20000,
      is_agent: Boolean(emp.is_agent || emp.position?.toLowerCase().includes('agent')),
      agent_code: emp.agent_code || '',
      status: emp.status || 'ACTIVE'
    });
    setActionError(null);
    setShowEmployeeModal(true);
  };

  const handleSaveEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!employeeForm.full_name.trim()) {
      setActionError("Iltimos, xodimning to'liq F.I.SH (ism-familiyasi)ni kiriting!");
      return;
    }
    if (!employeeForm.position.trim()) {
      setActionError("Iltimos, xodimning lavozimini kiriting!");
      return;
    }
    const emptyPart = employeeForm.pay_components.find(c =>
      (c.type === 'MONTHLY' && !(c.amount > 0)) || ((c.type === 'DAILY' || c.type === 'PER_UNIT') && !(c.rate > 0)) || (c.type === 'PERCENT' && !(c.percent > 0)));
    if (emptyPart) {
      setActionError(`Maosh tarkibida summa yoki foiz kiritilmagan qism bor: ${describePayComponent(emptyPart)}`);
      return;
    }

    setIsSavingEmployee(true);
    setActionError(null);
    try {
      if (editingEmployee) {
        const res = await api.updateEmployee(editingEmployee.id, employeeForm);
        setActionSuccess(res.message || "Xodim muvaffaqiyatli yangilandi");
      } else {
        const res = await api.createEmployee(employeeForm);
        setActionSuccess(res.message || "Yangi xodim muvaffaqiyatli qo'shildi");
      }
      setShowEmployeeModal(false);
      await loadData();
    } catch (err: any) {
      setActionError(err.message || "Xodimni saqlashda xatolik yuz berdi");
    } finally {
      setIsSavingEmployee(false);
    }
  };

  const handleOpenDeleteEmployee = (emp: any) => {
    setEmployeeToDelete(emp);
    setShowDeleteModal(true);
  };

  const handleConfirmDeleteEmployee = async () => {
    if (!employeeToDelete) return;
    setIsDeletingEmployee(true);
    setActionError(null);
    try {
      const res = await api.deleteEmployee(employeeToDelete.id);
      setActionSuccess(res.message || "Xodim muvaffaqiyatli o'chirildi");
      setShowDeleteModal(false);
      setEmployeeToDelete(null);
      await loadData();
    } catch (err: any) {
      setActionError(err.message || "Xodimni o'chirishda xatolik yuz berdi");
    } finally {
      setIsDeletingEmployee(false);
    }
  };

  const [positionFilter, setPositionFilter] = useState('');
  const [salaryTypeFilter, setSalaryTypeFilter] = useState('');
  const [employeeStatusFilter, setEmployeeStatusFilter] = useState('');
  // Filter by a part of the pay scheme (an employee with monthly + percent matches both).
  const payPartLabels: Record<string, string> = { MONTHLY: 'Oylik (fiks) bor', DAILY: 'Kunbay bor', PER_UNIT: 'Ishbay bor', PERCENT: 'Foiz bor', NONE: 'Maosh tarkibi kiritilmagan' };
  const salaryTypeLabel = (t?: string) => payPartLabels[t || ''] || '';
  const hasPayPart = (e: any, part: string) => part === 'NONE' ? !(e.pay_components || []).length : (e.pay_components || []).some((c: any) => c.type === part);
  const positions = useMemo(() => Array.from(new Set(employees.map(e => e.position).filter(Boolean))).sort() as string[], [employees]);

  const filteredEmployees = useMemo(() => employees.filter(e =>
    matchesSearch(e, employeeSearch, ['full_name', 'position', 'phone', 'agent_code']) &&
    isPicked(positionFilter, e.position) &&
    (!salaryTypeFilter || picked(salaryTypeFilter).some(t => hasPayPart(e, t))) &&
    isPicked(employeeStatusFilter, e.status && e.status !== 'ACTIVE' ? 'INACTIVE' : 'ACTIVE')
  ), [employees, employeeSearch, positionFilter, salaryTypeFilter, employeeStatusFilter]);

  const exportEmployees = () => exportTableXlsx({
    fileName: 'Xodimlar',
    title: 'Xodimlar ro‘yxati',
    columns: [
      { header: 'F.I.SH', key: 'full_name', width: 28 },
      { header: 'Lavozim', key: 'position', width: 18 },
      { header: 'Telefon', key: 'phone', width: 15 },
      { header: 'Agent kodi', key: 'agent_code', width: 12 },
      { header: 'Maosh tarkibi', key: 'pay_scheme', width: 48 },
      { header: 'Oylik (fiks)', key: 'base_salary', type: 'money', total: true },
      { header: 'Kunlik limit', key: 'daily_expense_limit', type: 'money' },
      { header: 'Holat', key: 'status_label', width: 10 }
    ],
    rows: filteredEmployees.map(e => ({
      ...e,
      pay_scheme: (e.pay_components || []).map((c: PayComponent) => describePayComponent(c)).join('; ') || 'kiritilmagan',
      base_salary: Number(e.base_salary || 0),
      status_label: e.status === 'ACTIVE' || !e.status ? 'Faol' : 'Nofaol'
    })),
    filters: [
      employeeSearch && `qidiruv: "${employeeSearch}"`,
      positionFilter && `lavozim: ${pickedLabels(positionFilter)}`,
      salaryTypeFilter && picked(salaryTypeFilter).map(t => salaryTypeLabel(t).toLowerCase()).join(', '),
      employeeStatusFilter && picked(employeeStatusFilter).map(s => s === 'ACTIVE' ? 'faol' : 'nofaol').join(', ')
    ]
  });

  // Payroll of the month: search and status on screen, the same rows go to Excel.
  const [payrollSearch, setPayrollSearch] = useState('');
  const [payrollStatus, setPayrollStatus] = useState('');
  const payrollStatusLabel = (s?: string) => s === 'PAID' ? 'To‘langan' : s === 'APPROVED' ? 'Tasdiqlangan' : 'Loyiha';
  const filteredSalaries = useMemo(() => salaries.filter(s =>
    matchesSearch(s, payrollSearch, ['employee_name', 'position']) && isPicked(payrollStatus, s.status)
  ), [salaries, payrollSearch, payrollStatus]);

  const exportPayroll = () => exportTableXlsx({
    fileName: `Oylik_vedomost_${currentMonth}`,
    title: `Oylik maosh vedomosti — ${currentMonth}`,
    columns: [
      { header: 'Xodim', key: 'employee_name', width: 28 },
      { header: 'Lavozim', key: 'position', width: 18 },
      { header: 'Asosiy oylik', key: 'base_amount', type: 'money', total: true },
      { header: 'KPI bonusi', key: 'bonus_amount', type: 'money', total: true },
      { header: 'Ishbay', key: 'piecework_amount', type: 'money', total: true },
      { header: 'Jami summa', key: 'final_amount', type: 'money', total: true },
      { header: 'Holat', key: 'status_label', width: 13 }
    ],
    rows: filteredSalaries.map(s => ({ ...s, status_label: payrollStatusLabel(s.status) })),
    filters: [payrollSearch && `qidiruv: "${payrollSearch}"`, payrollStatus && picked(payrollStatus).map(payrollStatusLabel).join(', ')]
  });

  // Metrics
  const metrics = useMemo(() => {
    let totalPayroll = 0;
    let paidAmount = 0;
    let pendingApproval = 0;

    for (const s of salaries) {
      totalPayroll += s.final_amount;
      if (s.status === 'PAID') {
        paidAmount += s.final_amount;
      } else if (s.status === 'DRAFT') {
        pendingApproval++;
      }
    }

    return {
      employeeCount: employees.length,
      totalPayroll,
      paidAmount,
      pendingApproval
    };
  }, [employees, salaries]);

  // Handle Calculate Preview
  const handleCalculatePreview = async () => {
    if (!calcForm.employee_id) return;
    setIsCalculating(true);
    setActionError(null);
    try {
      const res = await api.calculateSalary({
        employee_id: calcForm.employee_id,
        period_month: calcForm.period_month
      });
      setCalcBreakdown(res.breakdown);
    } catch (err: any) {
      setActionError(err.message);
    } finally {
      setIsCalculating(false);
    }
  };

  const handleGenerateSalary = async () => {
    setActionError(null);
    try {
      await api.generateSalary({
        employee_id: calcForm.employee_id,
        period_month: calcForm.period_month
      });
      setActionSuccess('Maosh vedomosti muvaffaqiyatli shakllantirildi');
      setShowCalculateModal(false);
      setCalcBreakdown(null);
      loadData();
    } catch (err: any) {
      setActionError(err.message);
    }
  };

  const handleGenerateSelected = async (employeeIds: string[]) => {
    const targets = employees.filter(e => employeeIds.includes(e.id) && e.status !== 'INACTIVE');
    if (!targets.length) { setActionError('Faol xodimlarni tanlang.'); return; }
    setIsCalculating(true);
    setActionError(null);
    try {
      const response = await api.generateSalariesBulk({ employee_ids: targets.map(e => e.id), period_month: calcForm.period_month });
      const failed = response.results.filter(r => r.error).map(r => `${employees.find(e => e.id === r.employee_id)?.full_name || r.employee_id}: ${r.error}`);
      const done = response.results.filter(r => r.salary && !r.skipped).length;
      const skipped = response.results.filter(r => r.skipped).length;
      if (failed.length) setActionError(`Hisoblanmagan xodimlar: ${failed.join('; ')}`);
      setActionSuccess(`${calcForm.period_month}: ${done} ta vedomost tuzildi${skipped ? `, ${skipped} ta avval to‘langanligi uchun o‘zgartirilmadi` : ''}.`);
      setShowCalculateModal(false);
      setCalcBreakdown(null);
      setSelectedPayrollIds([]);
      loadData();
    } catch (err: any) { setActionError(err.message); }
    finally { setIsCalculating(false); }
  };

  const handleGenerateAll = () => handleGenerateSelected(employees.filter(e => e.status !== 'INACTIVE').map(e => e.id));

  const handleApprove = async (salaryId: string) => {
    setActionError(null);
    try {
      await api.approveSalary(salaryId);
      setActionSuccess('Oylik maosh tasdiqlandi');
      loadData();
    } catch (err: any) {
      setActionError(err.message);
    }
  };

  const handleOpenPay = (salary: any) => {
    setSelectedSalaryToPay(salary);
    setPayForm({
      salary_id: salary.id,
      cash_day_id: '',
      payment_method: 'CASH'
    });
    setShowPayModal(true);
  };

  const handleConfirmPay = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionError(null);
    try {
      await api.paySalary({
        salary_id: payForm.salary_id,
        cash_day_id: payForm.cash_day_id || undefined,
        payment_method: payForm.payment_method
      });
      setActionSuccess('Oylik maosh to\'landi va kassa chiqimiga yozildi');
      setShowPayModal(false);
      loadData();
    } catch (err: any) {
      setActionError(err.message);
    }
  };

  const handleOpenCabinet = async (emp: any) => {
    setCabinetEmployee(emp);
    setShowCabinetModal(true);
    setCabinetLoading(true);
    try {
      const res = await api.getEmployeePersonalCabinet(emp.id, currentMonth);
      setCabinetData(res);
    } catch (err: any) {
      setActionError(err.message || 'Xodim shaxsiy kabinetini yuklashda xatolik');
    } finally {
      setCabinetLoading(false);
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
            <AlertCircle className="h-5 w-5 text-red-600" />
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
            Xodimlar & Oylik Maosh (Payroll)
          </h1>
          <p className="text-xs text-neutral-500">
            Fiks maosh, Savdo KPI bonusi, Ishbay vedomosti va Kassa orqali oylik to'lash
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 shadow-xs">
            <Calendar className="h-4 w-4 text-neutral-400" />
            <input
              type="month"
              value={currentMonth}
              onChange={(e) => setCurrentMonth(e.target.value)}
              className="text-xs font-semibold text-neutral-700 focus:outline-hidden"
            />
          </div>

          <button
            onClick={() => setShowWorkModal(true)}
            className="flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800 shadow-xs hover:bg-emerald-100"
            title="Istalgan xodim uchun ishlagan kunlar, reyslar, dona yoki soatlarni kiritish"
          >
            <Layers className="h-4 w-4 text-emerald-600" />
            <span>Ish qayd etish (kun / reys / dona / soat)</span>
          </button>

          <button
            onClick={() => {
              setCalcForm({ employee_id: '', period_month: currentMonth });
              setSelectedPayrollIds([]);
              setCalcBreakdown(null);
              setShowCalculateModal(true);
            }}
            className="flex items-center gap-1.5 rounded-lg bg-neutral-900 px-3 py-2 text-xs font-semibold text-white shadow-xs hover:bg-neutral-800"
          >
            <Calculator className="h-4 w-4" />
            <span>Maosh hisoblash</span>
          </button>

          <button
            onClick={handleOpenAddEmployee}
            className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white shadow-xs hover:bg-emerald-700 transition"
          >
            <UserPlus className="h-4 w-4" />
            <span>+ Yangi Xodim</span>
          </button>
        </div>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between text-neutral-500">
            <span className="text-xs font-medium uppercase tracking-wider">Jami Xodimlar</span>
            <UserCheck className="h-4 w-4" />
          </div>
          <p className="mt-2 text-2xl font-bold text-neutral-900">{metrics.employeeCount}</p>
          <p className="text-[11px] text-neutral-500">Shtatdagi barcha xodimlar</p>
        </div>

        <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between text-neutral-500">
            <span className="text-xs font-medium uppercase tracking-wider">Oylik Fondi ({currentMonth})</span>
            <DollarSign className="h-4 w-4 text-emerald-600" />
          </div>
          <p className="mt-2 text-2xl font-bold text-neutral-900">
            {metrics.totalPayroll.toLocaleString()} UZS
          </p>
          <p className="text-[11px] text-neutral-500">Hisoblangan jami maosh</p>
        </div>

        <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between text-neutral-500">
            <span className="text-xs font-medium uppercase tracking-wider">To'langan Maosh</span>
            <CheckCircle className="h-4 w-4 text-emerald-600" />
          </div>
          <p className="mt-2 text-2xl font-bold text-emerald-600">
            {metrics.paidAmount.toLocaleString()} UZS
          </p>
          <p className="text-[11px] text-neutral-500">Kassadan to'langan summa</p>
        </div>

        <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between text-neutral-500">
            <span className="text-xs font-medium uppercase tracking-wider">Tasdiq Kutilayotgan</span>
            <AlertCircle className="h-4 w-4 text-amber-500" />
          </div>
          <p className="mt-2 text-2xl font-bold text-amber-600">{metrics.pendingApproval}</p>
          <p className="text-[11px] text-neutral-500">Draft holatidagi vedomostlar</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-neutral-200">
        <button
          onClick={() => setActiveTab('PAYROLL')}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-xs font-semibold transition ${
            activeTab === 'PAYROLL'
              ? 'border-neutral-900 text-neutral-900'
              : 'border-transparent text-neutral-500 hover:text-neutral-700'
          }`}
        >
          <FileSpreadsheet className="h-4 w-4" />
          <span>Oylik Maosh Vedomosti ({currentMonth})</span>
        </button>

        <button
          onClick={() => setActiveTab('EMPLOYEES')}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-xs font-semibold transition ${
            activeTab === 'EMPLOYEES'
              ? 'border-neutral-900 text-neutral-900'
              : 'border-transparent text-neutral-500 hover:text-neutral-700'
          }`}
        >
          <UserCheck className="h-4 w-4" />
          <span>Xodimlar Ro'yxati</span>
        </button>

        <button
          onClick={() => setActiveTab('ATTENDANCE')}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-xs font-semibold transition ${
            activeTab === 'ATTENDANCE'
              ? 'border-neutral-900 text-neutral-900'
              : 'border-transparent text-neutral-500 hover:text-neutral-700'
          }`}
        >
          <ScanFace className="h-4 w-4" />
          <span>Davomat (Face ID)</span>
        </button>
      </div>

      {activeTab === 'ATTENDANCE' && <AttendanceManager employees={employees} />}

      {/* Table: Monthly Payroll */}
      {activeTab === 'PAYROLL' && (
        <TableToolbar
          search={payrollSearch}
          onSearch={setPayrollSearch}
          searchPlaceholder="Xodim yoki lavozim…"
          selects={[{ label: 'Holat', value: payrollStatus, onChange: setPayrollStatus, allLabel: 'Barcha holatlar', options: [
            { value: 'DRAFT', label: 'Loyiha (Draft)' }, { value: 'APPROVED', label: 'Tasdiqlangan' }, { value: 'PAID', label: 'To‘langan' }
          ] }]}
          count={filteredSalaries.length}
          onReset={() => { setPayrollSearch(''); setPayrollStatus(''); }}
          onExport={exportPayroll}
        />
      )}
      {activeTab === 'PAYROLL' && (
        <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-xs">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-neutral-200 text-left text-xs">
              <thead className="bg-neutral-50 text-neutral-500">
                <tr>
                  <th className="px-4 py-3 font-semibold uppercase">Xodim</th>
                  <th className="px-4 py-3 font-semibold uppercase">Lavozim</th>
                  <th className="px-4 py-3 font-semibold uppercase text-right">Asosiy Oylik</th>
                  <th className="px-4 py-3 font-semibold uppercase text-right">KPI Bonusi</th>
                  <th className="px-4 py-3 font-semibold uppercase text-right">Ishbay</th>
                  <th className="px-4 py-3 font-semibold uppercase text-right">Jami Summa</th>
                  <th className="px-4 py-3 font-semibold uppercase text-center">Holat</th>
                  <th className="px-4 py-3 font-semibold uppercase text-right">Amallar</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200 bg-white">
                {filteredSalaries.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-neutral-400">
                      {salaries.length ? 'Filtrga mos qator yo‘q.' : 'Ushbu oy uchun maosh vedomosti shakllantirilmagan. "Maosh hisoblash" tugmasini bosing.'}
                    </td>
                  </tr>
                ) : (
                  filteredSalaries.map((sal) => (
                    <tr key={sal.id} className="hover:bg-neutral-50/80 transition">
                      <td className="px-4 py-3 font-semibold text-neutral-900">
                        {sal.employee_name}
                      </td>
                      <td className="px-4 py-3 text-neutral-600">{sal.position || '-'}</td>
                      <td className="px-4 py-3 text-right font-medium text-neutral-700">
                        {sal.base_amount.toLocaleString()} UZS
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-emerald-600">
                        {sal.bonus_amount > 0 ? `+${sal.bonus_amount.toLocaleString()}` : '0'}
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-blue-600">
                        {sal.piecework_amount > 0 ? `+${sal.piecework_amount.toLocaleString()}` : '0'}
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-neutral-900">
                        {sal.final_amount.toLocaleString()} UZS
                      </td>
                      <td className="px-4 py-3 text-center">
                        {sal.status === 'PAID' ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
                            <CheckCircle className="h-3 w-3" />
                            To'langan
                          </span>
                        ) : sal.status === 'APPROVED' ? (
                          <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-800">
                            Tasdiqlangan
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-semibold text-neutral-600">
                            Loyiha (Draft)
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => {
                              const emp = employees.find(e => e.id === sal.employee_id) || { id: sal.employee_id, full_name: sal.employee_name, position: sal.position };
                              handleOpenCabinet(emp);
                            }}
                            className="flex items-center gap-1 rounded-md bg-indigo-50 px-2 py-1 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-100"
                            title="Xodim shaxsiy kabinetini ko'rish"
                          >
                            <Eye className="h-3 w-3" />
                            <span>Kabinet</span>
                          </button>
                          {sal.status === 'DRAFT' && (
                            <button
                              onClick={() => handleApprove(sal.id)}
                              className="rounded-md bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-700 hover:bg-blue-100"
                            >
                              Tasdiqlash
                            </button>
                          )}
                          {sal.status === 'APPROVED' && (
                            <button
                              onClick={() => handleOpenPay(sal)}
                              className="flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700"
                            >
                              <CreditCard className="h-3 w-3" />
                              <span>To'lash</span>
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
      )}

      {/* Table: Employees List */}
      {activeTab === 'EMPLOYEES' && (
        <div className="space-y-3">
          {/* Subheader bar with Search and Add button */}
          <TableToolbar
            search={employeeSearch}
            onSearch={setEmployeeSearch}
            searchPlaceholder="F.I.SH, lavozim, telefon yoki agent kodi…"
            selects={[
              { label: 'Lavozim', value: positionFilter, onChange: setPositionFilter, allLabel: 'Barcha lavozimlar', options: positions.map(p => ({ value: p, label: p })) },
              { label: 'Maosh', value: salaryTypeFilter, onChange: setSalaryTypeFilter, allLabel: 'Maosh turi: barchasi', options: Object.entries(payPartLabels).map(([value, label]) => ({ value, label })) },
              { label: 'Holat', value: employeeStatusFilter, onChange: setEmployeeStatusFilter, allLabel: 'Barcha holatlar', options: [{ value: 'ACTIVE', label: 'Faol' }, { value: 'INACTIVE', label: 'Nofaol' }] }
            ]}
            count={filteredEmployees.length}
            onReset={() => { setEmployeeSearch(''); setPositionFilter(''); setSalaryTypeFilter(''); setEmployeeStatusFilter(''); }}
            onExport={exportEmployees}
          >
            <button
              onClick={handleOpenAddEmployee}
              className="flex h-9 items-center gap-1.5 rounded-xl bg-neutral-900 px-3.5 text-xs font-semibold text-white shadow-xs hover:bg-neutral-800 transition"
            >
              <Plus className="h-4 w-4" />
              <span>Yangi Xodim Qo'shish</span>
            </button>
          </TableToolbar>

          <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-xs">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-neutral-200 text-left text-xs">
                <thead className="bg-neutral-50 text-neutral-500">
                  <tr>
                    <th className="px-4 py-3 font-semibold uppercase">Xodim (F.I.SH)</th>
                    <th className="px-4 py-3 font-semibold uppercase">Lavozim</th>
                    <th className="px-4 py-3 font-semibold uppercase">Telefon</th>
                    <th className="px-4 py-3 font-semibold uppercase">Maosh Tarkibi</th>
                    <th className="px-4 py-3 font-semibold uppercase text-right">Oylik (fiks)</th>
                    <th className="px-4 py-3 font-semibold uppercase text-right">Kunlik Limit</th>
                    <th className="px-4 py-3 font-semibold uppercase text-center">Holat</th>
                    <th className="px-4 py-3 font-semibold uppercase text-right">Amallar</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200 bg-white">
                  {filteredEmployees.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-10 text-center text-neutral-400">
                        <div className="flex flex-col items-center justify-center gap-2">
                          <UserCheck className="h-8 w-8 text-neutral-300" />
                          <p className="font-medium text-neutral-600">Xodimlar topilmadi</p>
                          <p className="text-[11px] text-neutral-400">Yangi xodim qo'shish uchun yuqoridagi "+ Yangi Xodim Qo'shish" tugmasini bosing</p>
                          <button
                            onClick={handleOpenAddEmployee}
                            className="mt-2 flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                          >
                            <Plus className="h-3.5 w-3.5" />
                            <span>Xodim qo'shish</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    filteredEmployees.map((emp) => {
                      const isAgent = emp.is_agent || emp.position?.toLowerCase().includes('agent');
                      return (
                        <tr key={emp.id} className="hover:bg-neutral-50/80 transition">
                          <td className="px-4 py-3 font-medium text-neutral-900">
                            <div className="flex items-center gap-2.5">
                              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-neutral-900 text-[11px] font-bold text-white shadow-xs">
                                {emp.full_name ? emp.full_name.charAt(0).toUpperCase() : 'X'}
                              </div>
                              <div>
                                <div className="font-semibold text-neutral-900">{emp.full_name}</div>
                                {isAgent && (
                                  <div className="flex items-center gap-1 text-[10px] text-indigo-700 font-medium">
                                    <span className="inline-block rounded bg-indigo-50 px-1.5 py-0.2 border border-indigo-200">
                                      Agent: {emp.agent_code || 'AG-KOD'} • {emp.commission_rate ?? emp.kpi_bonus_percent ?? 2}% KPI
                                    </span>
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <span className="inline-flex items-center rounded-md bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-700">
                              {emp.position}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-neutral-600 font-mono text-[11px]">
                            {emp.phone || '-'}
                          </td>
                          <td className="px-4 py-3">
                            {(emp.pay_components || []).length === 0 ? (
                              <span className="inline-flex rounded-md bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-800 border border-amber-200">Maosh tarkibi kiritilmagan</span>
                            ) : (
                              <div className="space-y-0.5">
                                {(emp.pay_components as PayComponent[]).map((c, i) => (
                                  <div key={i} className="text-[11px] text-neutral-700">{describePayComponent(c)}</div>
                                ))}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right font-semibold text-neutral-900">
                            {Number(emp.base_salary || 0).toLocaleString()} UZS
                          </td>
                          <td className="px-4 py-3 text-right font-medium text-neutral-700">
                            {Number(emp.daily_expense_limit ?? 20000).toLocaleString()} UZS
                          </td>
                          <td className="px-4 py-3 text-center">
                            {emp.status === 'ACTIVE' || !emp.status ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
                                <CheckCircle className="h-3 w-3" />
                                Faol
                              </span>
                            ) : (
                              <span className="inline-flex items-center rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-semibold text-neutral-600">
                                Nofaol
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                onClick={() => handleOpenCabinet(emp)}
                                className="flex items-center gap-1 rounded-md bg-indigo-50 px-2 py-1 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-100"
                                title="Shaxsiy kabinetini ko'rish"
                              >
                                <Eye className="h-3 w-3" />
                                <span>Kabinet</span>
                              </button>
                              <button
                                onClick={() => handleOpenEditEmployee(emp)}
                                className="flex items-center gap-1 rounded-md bg-neutral-100 px-2 py-1 text-[11px] font-semibold text-neutral-700 hover:bg-neutral-200"
                                title="Tahrirlash"
                              >
                                <Edit2 className="h-3 w-3" />
                                <span>Tahrirlash</span>
                              </button>
                              <button
                                onClick={() => handleOpenDeleteEmployee(emp)}
                                className="flex items-center gap-1 rounded-md bg-red-50 px-2 py-1 text-[11px] font-semibold text-red-700 hover:bg-red-100"
                                title="O'chirish"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </div>
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

      {/* Calculate Salary Modal */}
      {showCalculateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-neutral-200 pb-3">
              <h2 className="text-base font-bold text-neutral-900">Oylik Maoshni Hisoblash</h2>
              <button onClick={() => setShowCalculateModal(false)} className="text-neutral-400 hover:text-neutral-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-neutral-700">Xodim</label>
                <select
                  value={calcForm.employee_id}
                  onChange={(e) => setCalcForm(prev => ({ ...prev, employee_id: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-neutral-300 p-2 text-xs focus:border-neutral-900 focus:outline-hidden"
                >
                  <option value="">Xodimni tanlang...</option>
                  {employees.map((emp, idx) => (
                    <option key={emp.id || `emp-calc-${idx}`} value={emp.id}>
                      {emp.full_name} ({emp.position})
                    </option>
                  ))}
                </select>
              </div>

              <div className="rounded-xl border border-neutral-200 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <label className="text-xs font-semibold text-neutral-700">Bir nechta xodimni tanlang</label>
                  <button type="button" className="text-[11px] font-semibold text-emerald-700" onClick={() => {
                    const eligible = employees.filter(e => e.status !== 'INACTIVE').map(e => e.id);
                    setSelectedPayrollIds(selectedPayrollIds.length === eligible.length ? [] : eligible);
                  }}>{selectedPayrollIds.length ? 'Tanlovni tozalash' : 'Barcha faol xodimlar'}</button>
                </div>
                <div className="max-h-32 space-y-1 overflow-y-auto">
                  {employees.filter(e => e.status !== 'INACTIVE').map(emp => <label key={emp.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-neutral-50">
                    <input type="checkbox" checked={selectedPayrollIds.includes(emp.id)} onChange={e => setSelectedPayrollIds(current => e.target.checked ? [...current, emp.id] : current.filter(id => id !== emp.id))} />
                    <span>{emp.full_name}</span><span className="ml-auto text-neutral-400">{emp.position}</span>
                  </label>)}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-700">Hisobot Oyi</label>
                <input
                  type="month"
                  value={calcForm.period_month}
                  onChange={(e) => setCalcForm(prev => ({ ...prev, period_month: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-neutral-300 p-2 text-xs focus:border-neutral-900 focus:outline-hidden"
                />
              </div>

              <div className="flex justify-start">
                <button
                  type="button"
                  onClick={handleCalculatePreview}
                  disabled={!calcForm.employee_id || isCalculating}
                  className="rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-neutral-800 disabled:opacity-50"
                >
                  {isCalculating ? 'Hisoblanmoqda...' : 'Hisoblab ko\'rish'}
                </button>
              </div>

              {calcBreakdown && (
                <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4 space-y-2 text-xs">
                  <div className="text-[11px] text-neutral-500">
                    Maosh tarkibi: {(calcBreakdown.components || []).length ? calcBreakdown.components.map((c: PayComponent) => describePayComponent(c)).join(' · ') : 'kiritilmagan — xodimni tahrirlab qo‘shing'}
                  </div>
                  <div className="flex justify-between font-medium">
                    <span className="text-neutral-600">Oylik (fiks):</span>
                    <span>{calcBreakdown.base_amount.toLocaleString()} UZS</span>
                  </div>

                  {calcBreakdown.bonus_breakdown.map((b: any, idx: number) => (
                    <div key={idx} className="flex justify-between gap-3 text-emerald-700">
                      <span>{b.description}</span>
                      <span className="whitespace-nowrap">+{b.amount.toLocaleString()} UZS</span>
                    </div>
                  ))}

                  {/* Recorded work grouped by kind: days, trips, pieces, hours */}
                  {Object.entries((calcBreakdown.piecework_breakdown as any[]).reduce((by: Record<string, { units: number; amount: number }>, p: any) => {
                    const k = p.unit_type || 'TRIP';
                    by[k] = { units: (by[k]?.units || 0) + p.units, amount: (by[k]?.amount || 0) + p.amount };
                    return by;
                  }, {})).map(([unit, t]: [string, any]) => (
                    <div key={unit} className="flex justify-between text-blue-700">
                      <span>{unit === 'DAY' ? 'Kunbay' : 'Ishbay'}: {t.units} × {(WORK_UNIT_LABEL as any)[unit]?.toLowerCase()}</span>
                      <span>+{t.amount.toLocaleString()} UZS</span>
                    </div>
                  ))}

                  {calcBreakdown.deduction_breakdown.map((d: any, idx: number) => (
                    <div key={`d-${idx}`} className="flex justify-between gap-3 text-red-600">
                      <span>Ushlanma: {d.description}</span>
                      <span className="whitespace-nowrap">−{d.amount.toLocaleString()} UZS</span>
                    </div>
                  ))}

                  <div className="border-t border-neutral-200 pt-2 flex justify-between font-bold text-neutral-900 text-sm">
                    <span>Jami yakuniy maosh:</span>
                    <span>{calcBreakdown.final_amount.toLocaleString()} UZS</span>
                  </div>
                </div>
              )}

              <div className="flex flex-wrap justify-end gap-2 pt-2 border-t border-neutral-200">
                <button
                  type="button"
                  onClick={() => handleGenerateSelected(selectedPayrollIds)}
                  disabled={isCalculating || selectedPayrollIds.length === 0}
                  className="rounded-lg border border-neutral-300 px-3 py-2 text-xs font-semibold text-neutral-800 hover:bg-neutral-50 disabled:opacity-50"
                  title="Faqat tanlangan xodimlar uchun vedomost tuzish"
                >
                  Tanlanganlar uchun ({selectedPayrollIds.length})
                </button>
                <button
                  type="button"
                  onClick={handleGenerateAll}
                  disabled={isCalculating}
                  className="mr-auto rounded-lg border border-neutral-300 px-3 py-2 text-xs font-semibold text-neutral-800 hover:bg-neutral-50 disabled:opacity-50"
                  title="Barcha faol xodimlar uchun shu oy vedomostini tuzish"
                >
                  Barcha faol xodimlar uchun
                </button>
                <button
                  type="button"
                  onClick={() => setShowCalculateModal(false)}
                  className="rounded-lg border border-neutral-300 px-3 py-2 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
                >
                  Bekor qilish
                </button>
                <button
                  type="button"
                  onClick={handleGenerateSalary}
                  disabled={!calcBreakdown}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  Vedomostga saqlash
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showWorkModal && (
        <WorkEntryModal
          employees={employees}
          month={currentMonth}
          onClose={() => { setShowWorkModal(false); loadData(); }}
          onSaved={(message) => setActionSuccess(message)}
        />
      )}

      {/* Pay Salary Modal */}
      {showPayModal && selectedSalaryToPay && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-neutral-200 pb-3">
              <h2 className="text-base font-bold text-neutral-900">Maoshni To'lash</h2>
              <button onClick={() => setShowPayModal(false)} className="text-neutral-400 hover:text-neutral-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleConfirmPay} className="mt-4 space-y-4">
              <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-xs">
                <p className="font-semibold text-neutral-900">{selectedSalaryToPay.employee_name}</p>
                <p className="text-neutral-500">Davr: {selectedSalaryToPay.period_month}</p>
                <p className="mt-1 font-bold text-emerald-600 text-sm">
                  To'lanadigan summa: {selectedSalaryToPay.final_amount.toLocaleString()} UZS
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-700">To'lov usuli</label>
                <select
                  value={payForm.payment_method}
                  onChange={(e: any) => setPayForm(prev => ({ ...prev, payment_method: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-neutral-300 p-2 text-xs focus:border-neutral-900 focus:outline-hidden"
                >
                  <option value="CASH">Naqd pul (Kassadan chiqim)</option>
                  <option value="BANK_TRANSFER">Bank orqali o'tkazma (Karta)</option>
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowPayModal(false)}
                  className="rounded-lg border border-neutral-300 px-3 py-2 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
                >
                  Bekor qilish
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
                >
                  To'lovni tasdiqlash
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* MODAL: XODIM SHAXSIY KABINETI (DOSTAVCHIK / AGENT KABINETI)    */}
      {/* ============================================================ */}
      {showCabinetModal && cabinetEmployee && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-neutral-200 pb-3">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-indigo-50 text-indigo-700 rounded-xl">
                  <User className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-neutral-900">
                    {cabinetEmployee.full_name} — Shaxsiy Kabinet
                  </h3>
                  <p className="text-xs text-neutral-500">
                    Lavozimi: <span className="font-semibold text-neutral-700">{cabinetEmployee.position || 'Xodim'}</span> | 
                    Telefon: <span className="font-mono text-neutral-700">{cabinetEmployee.phone || '—'}</span> | 
                    Holati: Faol
                  </p>
                </div>
              </div>
              <button onClick={() => setShowCabinetModal(false)} className="text-neutral-400 hover:text-neutral-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Quick Month Switcher */}
            <div className="flex items-center justify-between bg-neutral-50 p-3 rounded-xl border border-neutral-200">
              <span className="text-xs font-bold text-neutral-700 uppercase tracking-wider">
                Hisob-kitob davri:
              </span>
              <div className="flex items-center space-x-2">
                <input
                  type="month"
                  value={currentMonth}
                  onChange={async (e) => {
                    const m = e.target.value;
                    setCurrentMonth(m);
                    setCabinetLoading(true);
                    try {
                      const res = await api.getEmployeePersonalCabinet(cabinetEmployee.id, m);
                      setCabinetData(res);
                    } catch (err: any) {
                      setActionError(err.message);
                    } finally {
                      setCabinetLoading(false);
                    }
                  }}
                  className="px-2.5 py-1 text-xs font-semibold bg-white border border-neutral-300 rounded-lg focus:outline-hidden"
                />
              </div>
            </div>

            {cabinetLoading ? (
              <div className="py-12 text-center text-xs text-neutral-400">
                Kabinet ma'lumotlari yuklanmoqda...
              </div>
            ) : !cabinetData ? (
              <div className="py-12 text-center text-xs text-neutral-400">
                Ma'lumot topilmadi.
              </div>
            ) : (
              <div className="space-y-5">
                {/* Cabinet KPI Metrics Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                  <div className="bg-neutral-50 p-3.5 rounded-xl border border-neutral-200">
                    <span className="text-[11px] font-bold text-neutral-500 uppercase block mb-1">
                      Asosiy Maosh (Fiks)
                    </span>
                    <span className="text-base font-extrabold text-neutral-900">
                      {(cabinetData.breakdown?.base_salary || 0).toLocaleString()} UZS
                    </span>
                  </div>

                  <div className="bg-emerald-50/60 p-3.5 rounded-xl border border-emerald-200">
                    <span className="text-[11px] font-bold text-emerald-800 uppercase block mb-1">
                      Reyslar & Ishbay ({cabinetData.breakdown?.trips_count || 0} ta reys)
                    </span>
                    <span className="text-base font-extrabold text-emerald-700">
                      +{(cabinetData.breakdown?.trips_total || 0).toLocaleString()} UZS
                    </span>
                  </div>

                  <div className="bg-blue-50/60 p-3.5 rounded-xl border border-blue-200">
                    <span className="text-[11px] font-bold text-blue-800 uppercase block mb-1">
                      Savdo KPI Bonusi
                    </span>
                    <span className="text-base font-extrabold text-blue-700">
                      +{(cabinetData.breakdown?.bonus_amount || 0).toLocaleString()} UZS
                    </span>
                  </div>

                  <div className="bg-indigo-50 p-3.5 rounded-xl border border-indigo-200">
                    <span className="text-[11px] font-bold text-indigo-900 uppercase block mb-1">
                      Jami Hisoblangan
                    </span>
                    <span className="text-base font-black text-indigo-900">
                      {(cabinetData.breakdown?.total_earnings || 0).toLocaleString()} UZS
                    </span>
                  </div>
                </div>

                {/* Advances and Net Balance */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="p-3.5 rounded-xl bg-amber-50/70 border border-amber-200 flex justify-between items-center">
                    <div>
                      <span className="text-xs font-bold text-amber-900 block">Oldindan berilgan avanslar:</span>
                      <span className="text-[11px] text-amber-700">Kassadan olingan avans chiqimlari</span>
                    </div>
                    <span className="text-base font-extrabold text-amber-800">
                      -{(cabinetData.breakdown?.advances_total || 0).toLocaleString()} UZS
                    </span>
                  </div>

                  <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-300 flex justify-between items-center">
                    <div>
                      <span className="text-xs font-black text-emerald-950 block">Qolgan to'lanishi kerak:</span>
                      <span className="text-[11px] text-emerald-700">Oylik yakuni bo'yicha toza qo'lga tegadigan summa</span>
                    </div>
                    <span className="text-lg font-black text-emerald-700">
                      {(cabinetData.breakdown?.net_payout || 0).toLocaleString()} UZS
                    </span>
                  </div>
                </div>

                {/* Delivery Trips / Operations Table */}
                <div className="border border-neutral-200 rounded-xl overflow-hidden">
                  <div className="bg-neutral-100 p-3 border-b border-neutral-200 flex items-center justify-between text-xs font-bold text-neutral-700">
                    <span>🚚 Yetkazib berish reyslari va ishbay amallar ({cabinetData.trips?.length || 0} ta qayd)</span>
                  </div>
                  <table className="w-full text-left text-xs">
                    <thead className="bg-neutral-50 text-neutral-500 font-semibold border-b border-neutral-200 uppercase">
                      <tr>
                        <th className="px-3.5 py-2.5">Sana</th>
                        <th className="px-3.5 py-2.5">Hudud / Zona / Izoh</th>
                        <th className="px-3.5 py-2.5 text-center">Reyslar Soni</th>
                        <th className="px-3.5 py-2.5 text-right">Reys Stavkasi</th>
                        <th className="px-3.5 py-2.5 text-right">Jami Summa</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-200">
                      {!cabinetData.trips || cabinetData.trips.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="px-4 py-8 text-center text-neutral-400">
                            Ushbu oy uchun reys yoki ishbay yozuvlari topilmadi
                          </td>
                        </tr>
                      ) : (
                        cabinetData.trips.map((tr: any, idx: number) => (
                          <tr key={idx} className="hover:bg-neutral-50 transition">
                            <td className="px-3.5 py-2.5 font-mono text-neutral-600 whitespace-nowrap">
                              {tr.date}
                            </td>
                            <td className="px-3.5 py-2.5 font-semibold text-neutral-900">
                              {tr.zone_name || tr.description || 'Yetkazib berish reysi'}
                            </td>
                            <td className="px-3.5 py-2.5 text-center font-bold text-neutral-800">
                              {tr.units_completed || 1}
                            </td>
                            <td className="px-3.5 py-2.5 text-right font-medium text-neutral-700">
                              {(tr.rate_applied || 0).toLocaleString()} UZS
                            </td>
                            <td className="px-3.5 py-2.5 text-right font-bold text-emerald-700">
                              {((tr.units_completed || 1) * (tr.rate_applied || 0)).toLocaleString()} UZS
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="pt-2 flex justify-end">
              <button
                type="button"
                onClick={() => setShowCabinetModal(false)}
                className="px-4 py-2 text-xs font-semibold text-neutral-700 bg-neutral-100 hover:bg-neutral-200 rounded-xl transition"
              >
                Yopish
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add / Edit Employee Modal */}
      {showEmployeeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-neutral-200 pb-3">
              <div className="flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-100 text-emerald-800">
                  {editingEmployee ? <Edit2 className="h-5 w-5" /> : <UserPlus className="h-5 w-5" />}
                </div>
                <div>
                  <h2 className="text-base font-bold text-neutral-900">
                    {editingEmployee ? "Xodim Ma'lumotlarini Tahrirlash" : "Yangi Xodim Qo'shish"}
                  </h2>
                  <p className="text-[11px] text-neutral-500">
                    Shtatdagi xodim, maosh shartlari va agentlik parametrlarini belgilang
                  </p>
                </div>
              </div>
              <button 
                onClick={() => setShowEmployeeModal(false)} 
                className="rounded-lg p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEmployee} className="mt-4 space-y-4">
              {/* Full Name */}
              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1">
                  Xodimning to'liq F.I.SH <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="Masalan: Rustam Karimov"
                  value={employeeForm.full_name}
                  onChange={(e) => setEmployeeForm(prev => ({ ...prev, full_name: e.target.value }))}
                  className="w-full rounded-lg border border-neutral-300 p-2.5 text-xs focus:border-neutral-900 focus:outline-hidden"
                />
              </div>

              {/* Position with quick tags */}
              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1">
                  Lavozimi <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="Masalan: Savdo Agenti"
                  value={employeeForm.position}
                  onChange={(e) => {
                    const pos = e.target.value;
                    const isAg = pos.toLowerCase().includes('agent');
                    setEmployeeForm(prev => ({ 
                      ...prev, 
                      position: pos,
                      is_agent: isAg || prev.is_agent
                    }));
                  }}
                  className="w-full rounded-lg border border-neutral-300 p-2.5 text-xs focus:border-neutral-900 focus:outline-hidden"
                />
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {['Savdo Agenti', 'Haydovchi (Dostavka)', 'Kassir', 'Ombordor', 'Buxgalter', 'Boshqaruvchi'].map((quickPos) => (
                    <button
                      key={quickPos}
                      type="button"
                      onClick={() => {
                        const isAg = quickPos.toLowerCase().includes('agent');
                        setEmployeeForm(prev => ({
                          ...prev,
                          position: quickPos,
                          is_agent: isAg || prev.is_agent,
                          salary_type: quickPos.includes('Agent') ? 'HYBRID' : quickPos.includes('Haydovchi') ? 'PIECEWORK' : 'FIXED'
                        }));
                      }}
                      className="rounded-md bg-neutral-100 hover:bg-neutral-200 px-2 py-0.5 text-[10px] font-medium text-neutral-700 transition"
                    >
                      + {quickPos}
                    </button>
                  ))}
                </div>
              </div>

              {/* Phone */}
              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1">
                  Telefon raqami
                </label>
                <input
                  type="text"
                  placeholder="+998 90 123 45 67"
                  value={employeeForm.phone}
                  onChange={(e) => setEmployeeForm(prev => ({ ...prev, phone: e.target.value }))}
                  className="w-full rounded-lg border border-neutral-300 p-2.5 text-xs font-mono focus:border-neutral-900 focus:outline-hidden"
                />
              </div>

              {/* Pay scheme: any mix of monthly, per day, per trip / piece / hour and percent of sales */}
              <PaySchemeEditor
                value={employeeForm.pay_components}
                onChange={(pay_components) => setEmployeeForm(prev => ({ ...prev, pay_components }))}
                employeeName={employeeForm.full_name}
              />

              {/* Daily Expense Limit */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">
                    Kunlik Xarajat Limiti (UZS)
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      min="0"
                      step="50000"
                      value={employeeForm.daily_expense_limit}
                      onChange={(e) => setEmployeeForm(prev => ({ ...prev, daily_expense_limit: Number(e.target.value) }))}
                      className="w-full rounded-lg border border-neutral-300 p-2.5 text-xs font-semibold focus:border-neutral-900 focus:outline-hidden"
                    />
                    <span className="absolute right-3 top-2.5 text-[10px] text-neutral-400 font-bold">UZS</span>
                  </div>
                  <span className="text-[10px] text-neutral-400">Kassadan bir kunda berilishi mumkin bo'lgan limit</span>
                </div>
              </div>

              {/* Agent Settings Box */}
              <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-3.5 space-y-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={employeeForm.is_agent}
                    onChange={(e) => setEmployeeForm(prev => ({ ...prev, is_agent: e.target.checked }))}
                    className="h-4 w-4 rounded border-neutral-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span className="text-xs font-bold text-indigo-900">
                    Savdo Agenti sifatida ro'yxatga olish (SFA / Reestr buyurtmalari uchun)
                  </span>
                </label>

                {employeeForm.is_agent && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                    <div>
                      <label className="block text-[11px] font-semibold text-neutral-700 mb-1">
                        Agent Kodi (SFA tizimidagi kodi)
                      </label>
                      <input
                        type="text"
                        placeholder="AG-101"
                        value={employeeForm.agent_code}
                        onChange={(e) => setEmployeeForm(prev => ({ ...prev, agent_code: e.target.value }))}
                        className="w-full rounded-lg border border-neutral-300 bg-white p-2 text-xs font-mono uppercase focus:border-indigo-600 focus:outline-hidden"
                      />
                    </div>

                    <p className="self-end text-[11px] text-indigo-800">
                      Savdodan foiz yuqoridagi “Maosh tarkibi”da beriladi: “Foiz (savdodan)” → “agent sifatida o‘z savdosidan”.
                    </p>
                  </div>
                )}
              </div>

              {/* Status */}
              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1">
                  Xodim holati
                </label>
                <select
                  value={employeeForm.status}
                  onChange={(e) => setEmployeeForm(prev => ({ ...prev, status: e.target.value as any }))}
                  className="w-full rounded-lg border border-neutral-300 p-2.5 text-xs focus:border-neutral-900 focus:outline-hidden"
                >
                  <option value="ACTIVE">Faol (Ishlamoqda)</option>
                  <option value="INACTIVE">Nofaol (Tashqarida / Ta'tilda)</option>
                </select>
              </div>

              {/* Action Buttons */}
              <div className="flex justify-end gap-2 pt-3 border-t border-neutral-200">
                <button
                  type="button"
                  onClick={() => setShowEmployeeModal(false)}
                  className="rounded-lg border border-neutral-300 px-4 py-2 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 transition"
                >
                  Bekor qilish
                </button>
                <button
                  type="submit"
                  disabled={isSavingEmployee}
                  className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-5 py-2 text-xs font-semibold text-white shadow-xs hover:bg-emerald-700 disabled:opacity-50 transition"
                >
                  {isSavingEmployee ? (
                    <>
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                      <span>Saqlanmoqda...</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle className="h-3.5 w-3.5" />
                      <span>{editingEmployee ? "Yangilash" : "Xodimni Qo'shish"}</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete / Inactivate Employee Confirmation Modal */}
      {showDeleteModal && employeeToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-center gap-3 text-red-600">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100">
                <Trash2 className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-neutral-900">Xodimni o'chirish</h3>
                <p className="text-xs text-neutral-500">Ushbu amalni tasdiqlaysizmi?</p>
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-neutral-200 bg-neutral-50 p-3.5 text-xs text-neutral-700 space-y-1.5">
              <div><strong>F.I.SH:</strong> {employeeToDelete.full_name}</div>
              <div><strong>Lavozim:</strong> {employeeToDelete.position}</div>
              {employeeToDelete.phone && <div><strong>Telefon:</strong> {employeeToDelete.phone}</div>}
            </div>

            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-800">
              <strong>Xavfsizlik eslatmasi:</strong> Agar ushbu xodim nomiga oldingi oylarda yopilgan maoshlar yoki kassa xarajatlari bog'langan bo'lsa, audit va buxgalteriya yaxlitligini buzmaslik uchun xodim o'chirilmaydi, balki arxivlanib <strong>NOFAOL (INACTIVE)</strong> holatga o'tkaziladi.
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowDeleteModal(false);
                  setEmployeeToDelete(null);
                }}
                disabled={isDeletingEmployee}
                className="rounded-lg border border-neutral-300 px-4 py-2 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
              >
                Bekor qilish
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteEmployee}
                disabled={isDeletingEmployee}
                className="flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {isDeletingEmployee ? (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    <span>O'chirilmoqda...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>Ha, o'chirish / arxivlash</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
