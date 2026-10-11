import { db } from '../db/database.ts';
import { businessToday } from '../utils/date.ts';
import type { 
  Salary, 
  SalaryRule, 
  PieceworkRule, 
  PieceworkTransaction, 
  Employee,
  DailyOrderEntry,
  CashTransaction,
  CashDay,
  PayComponent,
  WorkUnit
} from '../db/schema.ts';

export const WORK_UNIT_LABEL: Record<WorkUnit, string> = { DAY: 'Ish kuni', TRIP: 'Reys', PIECE: 'Dona', HOUR: 'Soat', OTHER: 'Boshqa ish' };
const PERCENT_BASE_LABEL = { OWN_SALES: 'O‘z savdosidan foiz', COMPANY_SALES: 'Korxona savdosidan foiz', OWN_DELIVERIES: 'Yetkazib bergan buyurtmalaridan foiz' };

/** Checks and normalizes a pay scheme sent by the browser; throws an Uzbek message on the first bad part. */
export function cleanPayComponents(raw: unknown): PayComponent[] {
  if (!Array.isArray(raw)) throw new Error('Maosh tarkibi ro‘yxat bo‘lishi kerak.');
  if (raw.length > 20) throw new Error('Maosh tarkibida 20 tadan ortiq qism bo‘lmasin.');
  const num = (v: any, what: string, max = 1e12) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0 || n > max) throw new Error(`${what} musbat son bo‘lishi kerak.`);
    return n;
  };
  const label = (v: any) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 80) : undefined);
  return raw.map((c: any) => {
    switch (c?.type) {
      case 'MONTHLY': return { type: 'MONTHLY', amount: num(c.amount, 'Oylik summa'), label: label(c.label) };
      case 'DAILY': return { type: 'DAILY', rate: num(c.rate, 'Kunlik stavka'), label: label(c.label) };
      case 'PER_UNIT': {
        if (!['TRIP', 'PIECE', 'HOUR', 'OTHER'].includes(c.unit)) throw new Error('Ishbay birligi: reys, dona, soat yoki boshqa.');
        return { type: 'PER_UNIT', unit: c.unit, rate: num(c.rate, 'Ishbay stavkasi'), label: label(c.label) };
      }
      case 'PERCENT': {
        if (!['OWN_SALES', 'COMPANY_SALES', 'OWN_DELIVERIES'].includes(c.base)) throw new Error('Foiz qaysi summadan olinishi tanlanmagan.');
        return {
          type: 'PERCENT', percent: num(c.percent, 'Foiz', 100), base: c.base, label: label(c.label),
          agent_id: c.base === 'OWN_SALES' && c.agent_id ? String(c.agent_id) : null,
          expeditor_name: c.base === 'OWN_DELIVERIES' && c.expeditor_name ? String(c.expeditor_name).trim() : null
        };
      }
      default: throw new Error('Maosh qismi turi noto‘g‘ri.');
    }
  }) as PayComponent[];
}
import { AuditService } from './audit.service.ts';
import { CashService } from './cash.service.ts';
import { AttendanceService, VIOLATION_LABEL } from './attendance.service.ts';
import { StaffBotService } from './staff-bot.service.ts';
import { TeamsService } from './teams.service.ts';
import { teamMemberSales } from './compare.service.ts';
import { ExpenseService } from './expense.service.ts';

export interface CalculateSalaryInput {
  company_id: string;
  employee_id: string;
  period_month: string; // YYYY-MM
  user_id: string;
  user_email: string;
}

export interface CalculatedSalaryBreakdown {
  employee: Employee;
  period_month: string;
  components: PayComponent[];
  base_amount: number;
  bonus_amount: number;
  bonus_breakdown: {
    rule_id?: string;
    description: string;
    amount: number;
  }[];
  deduction_amount: number;
  deduction_breakdown: {
    description: string;
    amount: number;
  }[];
  piecework_amount: number;
  piecework_breakdown: {
    product_category: string;
    units: number;
    rate: number;
    amount: number;
  }[];
  final_amount: number;
  status: 'DRAFT' | 'APPROVED' | 'PAID';
}

/** Next free agent code (AG-001, AG-002 …): codes are unique, not random. */
export function nextAgentCode(companyId: string): string {
  const used = new Set(db.getTableIncludingHidden('agents').filter(a => a.company_id === companyId).map(a => String(a.code)));
  let n = 1 + db.getTableIncludingHidden('agents').filter(a => a.company_id === companyId && /^AG-\d+$/.test(String(a.code))).reduce((max, a) => Math.max(max, Number(String(a.code).slice(3))), 0);
  while (used.has(`AG-${String(n).padStart(3, '0')}`)) n++;
  return `AG-${String(n).padStart(3, '0')}`;
}

export class SalaryService {
  /**
   * The employee's pay scheme. Rules saved before pay parts existed are read as their monthly sum plus,
   * for a linked agent with a commission, a percent of own sales.
   */
  public static payComponentsOf(company_id: string, employee_id: string): PayComponent[] {
    const rule = db.findOne('salary_rules', r => r.company_id === company_id && r.employee_id === employee_id && r.is_active);
    if (rule?.components) return rule.components;
    const list: PayComponent[] = [];
    if (rule && rule.base_salary > 0) list.push({ type: 'MONTHLY', amount: rule.base_salary });
    const agent = db.findOne('agents', a => a.company_id === company_id && a.employee_id === employee_id);
    if (agent && agent.commission_rate > 0) list.push({ type: 'PERCENT', percent: agent.commission_rate, base: 'OWN_SALES', agent_id: agent.id });
    return list;
  }

  /** Delivered sales of the month the percent is taken from (net of returns). */
  public static percentBase(company_id: string, employee: Employee, c: Extract<PayComponent, { type: 'PERCENT' }>, month: string): { base: number; label: string } {
    const inMonth = (o: any) => o.company_id === company_id && o.status === 'DELIVERED' && String(o.order_date).startsWith(month);
    const net = (o: any) => Number(o.net_sales ?? ((o.total_sales || 0) - (o.return_amount || 0))) || 0;
    if (c.base === 'COMPANY_SALES') {
      return { base: db.find('sales_orders', inMonth).reduce((s, o) => s + net(o), 0), label: PERCENT_BASE_LABEL.COMPANY_SALES };
    }
    if (c.base === 'OWN_DELIVERIES') {
      const name = (c.expeditor_name || employee.full_name).trim().toLowerCase();
      return { base: db.find('sales_orders', o => inMonth(o) && String(o.expeditor_name || '').trim().toLowerCase() === name).reduce((s, o) => s + net(o), 0), label: PERCENT_BASE_LABEL.OWN_DELIVERIES };
    }
    // A person on a shared agent profile earns from their own team's categories on it, not the whole profile.
    const places = c.agent_id ? [] : TeamsService.placesOf(company_id, employee.id);
    if (places.length) {
      const last = `${month}-${String(new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate()).padStart(2, '0')}`;
      const base = places.reduce((s, p) => s + teamMemberSales(company_id, p.agent_id, p.team_id, `${month}-01`, last).sales, 0);
      return { base, label: `O‘z komandasi savdosi (${places.map(p => p.team_name).join(', ')})` };
    }
    const agentIds = new Set(c.agent_id ? [c.agent_id] : db.find('agents', a => a.company_id === company_id && a.employee_id === employee.id).map(a => a.id));
    return { base: db.find('sales_orders', o => inMonth(o) && !!o.agent_id && agentIds.has(o.agent_id)).reduce((s, o) => s + net(o), 0), label: PERCENT_BASE_LABEL.OWN_SALES };
  }

  /** Saves the pay scheme; base_salary and salary_type follow it so older screens and reports stay right. */
  public static setPayComponents(company_id: string, employee_id: string, components: PayComponent[]) {
    const monthly = components.filter(c => c.type === 'MONTHLY').reduce((s, c) => s + (c as any).amount, 0);
    const others = components.some(c => c.type !== 'MONTHLY');
    const salary_type: Employee['salary_type'] = monthly > 0 && others ? 'HYBRID' : monthly > 0 ? 'FIXED' : 'PIECEWORK';
    const rule = db.findOne('salary_rules', r => r.company_id === company_id && r.employee_id === employee_id && r.is_active);
    const fields = { components, base_salary: monthly, salary_type, rule_type: (salary_type === 'FIXED' ? 'FIXED' : salary_type === 'HYBRID' ? 'KPI_TIERED' : 'HOURLY') as SalaryRule['rule_type'] };
    if (rule) db.update('salary_rules', rule.id, fields);
    else db.insert('salary_rules', { id: `salrule-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, company_id, employee_id, ...fields, is_active: true, created_at: new Date().toISOString() });
    db.update('employees', employee_id, { salary_type });
    // An agent's commission follows the percent of own sales (SalesDoc-side screens show it).
    const own = components.find(c => c.type === 'PERCENT' && c.base === 'OWN_SALES') as any;
    const agent = db.findOne('agents', a => a.company_id === company_id && a.employee_id === employee_id);
    if (agent) db.update('agents', agent.id, { commission_rate: own ? own.percent : 0 });
  }

  /**
   * Records work for any employee: days worked (kunbay), trips, pieces or hours (ishbay).
   * Without a rate the one in the employee's pay scheme for that unit is used.
   */
  public static recordWork(dto: {
    company_id: string; employee_id: string; unit_type: WorkUnit; units: number; rate?: number;
    date: string; note?: string; zone_name?: string; user_id: string; user_email: string;
  }): PieceworkTransaction {
    const employee = db.findById('employees', dto.employee_id);
    if (!employee || employee.company_id !== dto.company_id) throw new Error('Xodim topilmadi.');
    if (!(dto.units > 0) || dto.units > 100000) throw new Error('Miqdor musbat son bo‘lishi kerak.');
    const paid = db.findOne('salaries', s => s.company_id === dto.company_id && s.employee_id === dto.employee_id && s.period_month === dto.date.slice(0, 7) && s.status === 'PAID');
    if (paid) throw new Error(`${dto.date.slice(0, 7)} oyi maoshi to‘langan — bu oyga ish qo‘shib bo‘lmaydi.`);
    const components = this.payComponentsOf(dto.company_id, dto.employee_id);
    const configured = dto.unit_type === 'DAY'
      ? components.find(c => c.type === 'DAILY') as any
      : components.find(c => c.type === 'PER_UNIT' && c.unit === dto.unit_type) as any;
    const rate = dto.rate !== undefined && dto.rate !== null && String(dto.rate) !== '' ? Number(dto.rate) : configured?.rate;
    if (!(rate > 0)) throw new Error(`${WORK_UNIT_LABEL[dto.unit_type]} uchun stavka kiritilmagan: stavkani yozing yoki xodimning maosh tarkibiga qo‘shing.`);

    const record: PieceworkTransaction = {
      id: `work-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      company_id: dto.company_id,
      employee_id: dto.employee_id,
      unit_type: dto.unit_type,
      units_completed: dto.units,
      rate_applied: rate,
      total_amount: Math.round(dto.units * rate),
      date: dto.date,
      zone_name: dto.zone_name?.trim() || undefined,
      description: dto.note?.trim() || undefined,
      created_by: dto.user_id,
      status: 'VERIFIED',
      created_at: new Date().toISOString()
    };
    db.insert('piecework_transactions', record);
    AuditService.log({
      company_id: dto.company_id, user_id: dto.user_id, user_email: dto.user_email, action: 'CREATE', entity: 'PieceworkTransaction', entity_id: record.id,
      old_value: null, new_value: { unit: dto.unit_type, units: dto.units, rate, total: record.total_amount },
      reason: `Ish qayd etildi: ${employee.full_name} — ${dto.units} × ${WORK_UNIT_LABEL[dto.unit_type].toLowerCase()} (${record.total_amount.toLocaleString('ru-RU')} so‘m)`
    });
    return record;
  }

  public static listWork(company_id: string, month: string, employee_id?: string) {
    const names = new Map(db.find('employees', e => e.company_id === company_id).map(e => [e.id, e.full_name]));
    return db.find('piecework_transactions', p => p.company_id === company_id && p.date.startsWith(month) && (!employee_id || p.employee_id === employee_id))
      .map(p => ({ ...p, unit_type: p.unit_type || 'TRIP', employee_name: names.get(p.employee_id) || p.employee_id }))
      .sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at));
  }

  /** A mistaken entry can be removed while that month's salary is not paid yet. */
  public static deleteWork(company_id: string, id: string, user_id: string, user_email: string) {
    const entry = db.findById('piecework_transactions', id);
    if (!entry || entry.company_id !== company_id) throw new Error('Yozuv topilmadi.');
    const paid = db.findOne('salaries', s => s.company_id === company_id && s.employee_id === entry.employee_id && s.period_month === entry.date.slice(0, 7) && s.status === 'PAID');
    if (paid) throw new Error('Bu oy maoshi to‘langan — yozuvni o‘chirib bo‘lmaydi.');
    db.delete('piecework_transactions', id);
    AuditService.log({ company_id, user_id, user_email, action: 'DELETE', entity: 'PieceworkTransaction', entity_id: id, old_value: entry, new_value: null, reason: 'Ish yozuvi o‘chirildi' });
  }

  /**
   * Calculates monthly payroll for an employee with KPI/Piecework/Fixed rules
   */
  public static calculateMonthlySalary(input: CalculateSalaryInput): CalculatedSalaryBreakdown {
    const employee = db.findById('employees', input.employee_id);
    if (!employee || employee.company_id !== input.company_id) {
      throw new Error(`Xodim topilmadi: ${input.employee_id}`);
    }

    const components = this.payComponentsOf(input.company_id, employee.id);
    const month = input.period_month;

    // 1. Fixed monthly part (no rule = no fixed pay; nothing is assumed).
    let baseAmount = 0;
    for (const c of components) if (c.type === 'MONTHLY') baseAmount += Math.round(c.amount);

    // 2. Percent parts: a share of the month's delivered sales (own as agent, whole company, or delivered by this expeditor).
    let bonusAmount = 0;
    const bonusBreakdown: { rule_id?: string; description: string; amount: number }[] = [];
    for (const c of components) {
      if (c.type !== 'PERCENT') continue;
      const { base, label } = this.percentBase(input.company_id, employee, c, month);
      const amount = Math.round(base * c.percent / 100);
      bonusAmount += amount;
      bonusBreakdown.push({ description: `${c.label || label}: ${c.percent}% × ${Math.round(base).toLocaleString('ru-RU')} so‘m`, amount });
    }

    // 3. Recorded work: days (kunbay), trips, pieces, hours (ishbay) at the rate saved with each entry.
    const pieceworkTxs = db.find('piecework_transactions', p =>
      p.company_id === input.company_id && p.employee_id === input.employee_id && p.date.startsWith(month)
    );

    const pieceworkBreakdown: { product_category: string; units: number; rate: number; amount: number; date?: string; note?: string; unit_type?: WorkUnit }[] = [];
    let pieceworkAmount = 0;

    for (const p of pieceworkTxs.sort((a, b) => a.date.localeCompare(b.date))) {
      const unit = p.unit_type || 'TRIP';
      pieceworkAmount += p.total_amount;
      pieceworkBreakdown.push({
        product_category: p.zone_name || WORK_UNIT_LABEL[unit],
        units: p.units_completed,
        rate: p.rate_applied,
        amount: p.total_amount,
        date: p.date,
        note: p.description || WORK_UNIT_LABEL[unit],
        unit_type: unit
      });
    }

    // 4. Deductions: Fetch confirmed employee expense allocations for this month
    // As per user specification: If expense exceeded limit, excess/allocation is charged to salary
    const expenseAllocations = db.find('expense_allocations', a => {
      if (a.employee_id !== input.employee_id) return false;
      const expense = db.findById('expenses', a.expense_id);
      if (!expense || expense.status !== 'CONFIRMED') return false;
      return expense.date.startsWith(input.period_month);
    });

    let deductionAmount = 0;
    const deductionBreakdown: { description: string; amount: number; date?: string; reason?: string }[] = [];

    for (const alloc of expenseAllocations) {
      const expense = db.findById('expenses', alloc.expense_id);
      const cat = expense ? db.findById('expense_categories', expense.category_id) : null;
      const amountToDeduct = alloc.allocated_amount;
      deductionAmount += amountToDeduct;
      const excess = alloc.excess_amount ?? 0;
      deductionBreakdown.push({
        description: `${cat?.name || 'Xarajat'}: ${expense?.comment || 'Kunlik rasxod'} (${excess > 0 ? `Limitdan oshgan: ${excess.toLocaleString()} UZS` : 'Oylik hisobidan'})`,
        amount: amountToDeduct,
        date: expense?.date,
        reason: expense?.comment || 'Xarajat'
      });
    }

    // Lateness / early-leave penalties from Face ID attendance (rule and monthly cap in the attendance settings).
    const attendance = AttendanceService.monthPenalty(input.company_id, input.employee_id, input.period_month);
    // Rule book: a percent of the month's earned salary (fixed + percents + piecework), each violation listed.
    if (attendance.mode === 'RULES' && attendance.percent > 0) {
      const earned = baseAmount + bonusAmount + pieceworkAmount;
      const amount = Math.round(earned * attendance.percent / 100);
      deductionAmount += amount;
      deductionBreakdown.push({
        description: `Intizom jarimasi ${attendance.percent}% (oylikdan ${earned.toLocaleString('ru-RU')} so‘m): ${attendance.items.map(o => `${o.date.slice(8)}.${o.date.slice(5, 7)} ${VIOLATION_LABEL[o.type].toLowerCase()}${o.minutes ? ` ${o.minutes} daq` : ''} ${o.percent}%`).join('; ')}`,
        amount,
        reason: 'Kompaniya qoidalari bo‘yicha'
      });
    }
    if (attendance.total > 0) {
      deductionAmount += attendance.total;
      deductionBreakdown.push({
        description: `Davomat jarimasi: ${attendance.days.length} kun (${attendance.days.map(d => `${d.date.slice(8)}: ${d.late ? `${d.late} daq kech` : ''}${d.late && d.early ? ', ' : ''}${d.early ? `${d.early} daq erta` : ''}`).join('; ')})`,
        amount: attendance.total,
        reason: 'Kechikish / erta ketish'
      });
    }

    const finalAmount = Math.max(0, baseAmount + bonusAmount + pieceworkAmount - deductionAmount);

    return {
      employee,
      period_month: input.period_month,
      components,
      base_amount: baseAmount,
      bonus_amount: bonusAmount,
      bonus_breakdown: bonusBreakdown,
      deduction_amount: deductionAmount,
      deduction_breakdown: deductionBreakdown,
      piecework_amount: pieceworkAmount,
      piecework_breakdown: pieceworkBreakdown,
      final_amount: finalAmount,
      status: 'DRAFT'
    };
  }

  /**
   * Generates or saves calculated salary statement in db
   */
  public static generateSalaryRecord(input: CalculateSalaryInput): Salary {
    const breakdown = this.calculateMonthlySalary(input);
    const existing = db.findOne('salaries', s => 
      s.company_id === input.company_id && 
      s.employee_id === input.employee_id && 
      s.period_month === input.period_month
    );

    const now = new Date().toISOString();
    const salaryId = existing ? existing.id : `sal-${input.employee_id}-${input.period_month}`;

    const record: Salary = {
      id: salaryId,
      company_id: input.company_id,
      employee_id: input.employee_id,
      period_month: input.period_month,
      base_amount: breakdown.base_amount,
      bonus_amount: breakdown.bonus_amount,
      deduction_amount: breakdown.deduction_amount,
      piecework_amount: breakdown.piecework_amount,
      final_amount: breakdown.final_amount,
      status: existing ? existing.status : 'DRAFT',
      created_at: existing ? existing.created_at : now
    };

    if (existing) {
      db.update('salaries', salaryId, record);
    } else {
      db.insert('salaries', record);
    }

    AuditService.log({
      company_id: input.company_id,
      user_id: input.user_id,
      user_email: input.user_email,
      action: existing ? 'UPDATE' : 'CREATE',
      entity: 'Salary',
      entity_id: salaryId,
      old_value: existing ? { final_amount: existing.final_amount } : null,
      new_value: { final_amount: breakdown.final_amount, status: record.status },
      reason: `Oylik maosh vedomosti shakllantirildi: ${input.period_month}`
    });

    return db.findById('salaries', salaryId)!;
  }

  /**
   * Approves salary statement
   */
  public static approveSalary(salaryId: string, user_id: string, user_email: string, company_id?: string): Salary {
    const sal = db.findById('salaries', salaryId);
    if (!sal || (company_id && sal.company_id !== company_id)) throw new Error('Maosh yozuvi topilmadi.');
    if (sal.status === 'PAID') throw new Error('To\'langan maoshni qayta tasdiqlab bo\'lmaydi.');

    db.update('salaries', salaryId, { status: 'APPROVED' });

    AuditService.log({
      company_id: sal.company_id,
      user_id,
      user_email,
      action: 'APPROVE',
      entity: 'Salary',
      entity_id: salaryId,
      old_value: { status: sal.status },
      new_value: { status: 'APPROVED' },
      reason: `Maosh tasdiqlandi (#${salaryId})`
    });

    return db.findById('salaries', salaryId)!;
  }

  /**
   * Pays salary: Integrates with Kassa Cash Outflow
   */
  public static paySalary(
    salaryId: string, 
    cashDayId: string, 
    paymentMethod: 'CASH' | 'BANK_TRANSFER', 
    user_id: string, 
    user_email: string
  ): { salary: Salary; cash_transaction?: CashTransaction } {
    const sal = db.findById('salaries', salaryId);
    if (!sal) throw new Error('Maosh yozuvi topilmadi.');
    if (sal.status === 'PAID') throw new Error('Ushbu maosh allaqachon to\'langan.');

    const employee = db.findById('employees', sal.employee_id);
    const empName = employee ? employee.full_name : sal.employee_id;
    const now = new Date().toISOString();

    let cashTx: CashTransaction | undefined;

    db.transaction(database => {
      // 1. Mark as PAID
      database.update('salaries', salaryId, {
        status: 'PAID',
        paid_at: now
      });

      // 2. If Cash Day provided, record cash outflow
      if (paymentMethod === 'CASH' && cashDayId) {
        const cashDay = database.findById('cash_days', cashDayId);
        if (cashDay && cashDay.status === 'OPEN') {
          const newCashTx: CashTransaction = {
            id: `ctx-sal-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            company_id: sal.company_id,
            cash_day_id: cashDayId,
            transaction_type: 'SALARY_PAYMENT',
            amount: sal.final_amount,
            payment_method: 'CASH',
            external_reference: salaryId,
            description: `Xodimga maosh to'landi: ${empName} (${sal.period_month})`,
            created_by: user_id,
            created_at: now,
            updated_at: now
          };
          database.insert('cash_transactions', newCashTx);
          cashTx = newCashTx;
        }
      }

      // 3. Audit Log
      AuditService.log({
        company_id: sal.company_id,
        user_id,
        user_email,
        action: 'PAY',
        entity: 'Salary',
        entity_id: salaryId,
        old_value: { status: sal.status },
        new_value: { status: 'PAID', amount: sal.final_amount, method: paymentMethod },
        reason: `Xodimga maosh to'lovi amalga oshirildi (${empName})`
      });
    });

    if (cashDayId) {
      CashService.recalculateCashDayTotals(cashDayId);
    }
    StaffBotService.notify(sal.company_id, { employee_id: sal.employee_id }, 'SALARY_PAID', '💵 Oylik to‘landi',
      `${sal.period_month} oyi uchun <b>${Math.round(sal.final_amount).toLocaleString('ru-RU')} so‘m</b> ${paymentMethod === 'CASH' ? 'naqd' : 'bank orqali'} to‘landi.`);

    return {
      salary: db.findById('salaries', salaryId)!,
      cash_transaction: cashTx
    };
  }

  /**
   * Records completed piecework units
   */
  public static recordPiecework(dto: {
    company_id: string;
    employee_id: string;
    units_completed: number;
    rate_applied: number;
    date: string;
    user_id: string;
    user_email: string;
  }): PieceworkTransaction {
    if (dto.units_completed <= 0 || dto.rate_applied <= 0) {
      throw new Error('Bajarilgan hajm va stavka 0 dan katta bo\'lishi shart.');
    }

    const txId = `pwt-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const totalAmount = dto.units_completed * dto.rate_applied;

    const record: PieceworkTransaction = {
      id: txId,
      company_id: dto.company_id,
      employee_id: dto.employee_id,
      unit_type: 'PIECE',
      units_completed: dto.units_completed,
      rate_applied: dto.rate_applied,
      total_amount: totalAmount,
      date: dto.date,
      status: 'VERIFIED',
      created_at: new Date().toISOString()
    };

    db.insert('piecework_transactions', record);

    AuditService.log({
      company_id: dto.company_id,
      user_id: dto.user_id,
      user_email: dto.user_email,
      action: 'CREATE',
      entity: 'PieceworkTransaction',
      entity_id: txId,
      old_value: null,
      new_value: { units: dto.units_completed, amount: totalAmount },
      reason: 'Ishbay bajarilgan ish qayd etildi'
    });

    return record;
  }

  /**
   * Records a delivery trip for an employee with custom zone and unit rate
   * (e.g. Dostavchik bir kunda 3 xil joyga 3 ta reys qildi, 3 xil stavka)
   */
  public static recordTripPiecework(dto: {
    company_id: string;
    employee_id: string;
    zone_name: string;
    rate_per_trip: number;
    trips_count?: number;
    date: string;
    description?: string;
    user_id: string;
    user_email: string;
  }): PieceworkTransaction {
    const trips = dto.trips_count && dto.trips_count > 0 ? dto.trips_count : 1;
    if (dto.rate_per_trip <= 0) {
      throw new Error('Reys stavkasi 0 dan katta bo\'lishi kerak.');
    }

    const txId = `trip-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const totalAmount = trips * dto.rate_per_trip;

    const record: any = {
      id: txId,
      company_id: dto.company_id,
      employee_id: dto.employee_id,
      unit_type: 'TRIP',
      zone_name: dto.zone_name,
      units_completed: trips,
      rate_applied: dto.rate_per_trip,
      total_amount: totalAmount,
      date: dto.date,
      description: dto.description || `${dto.zone_name} bo'yicha ${trips} ta reys`,
      status: 'VERIFIED',
      created_at: new Date().toISOString()
    };

    db.insert('piecework_transactions', record);

    AuditService.log({
      company_id: dto.company_id,
      user_id: dto.user_id,
      user_email: dto.user_email,
      action: 'CREATE',
      entity: 'PieceworkTransaction',
      entity_id: txId,
      old_value: null,
      new_value: { zone: dto.zone_name, trips, rate: dto.rate_per_trip, total: totalAmount },
      reason: `Yetkazib beruvchi reysi qayd etildi: ${dto.zone_name} (${trips} ta reys, ${totalAmount.toLocaleString()} UZS)`
    });

    return record;
  }

  /**
   * Retrieves personal financial cabinet for an employee (Dostavchik / Agent / Cashier):
   * Earned base, trips/commissions, itemized expense deductions with dates & reasons, and remaining balance.
   */
  public static getEmployeePersonalCabinet(company_id: string, employee_id: string, period_month?: string) {
    const employee = db.findById('employees', employee_id);
    if (!employee || employee.company_id !== company_id) {
      throw new Error('Xodim topilmadi.');
    }

    const month = period_month || new Date().toISOString().slice(0, 7);
    const breakdown = this.calculateMonthlySalary({
      company_id,
      employee_id,
      period_month: month,
      user_id: 'system',
      user_email: 'system@distro.uz'
    });

    // Recent trips / piecework for this month
    const trips = db.find('piecework_transactions', p => 
      p.company_id === company_id && p.employee_id === employee_id && p.date.startsWith(month)
    );

    // Recent expense allocations for this month
    const expenseAllocations = db.find('expense_allocations', a => {
      if (a.employee_id !== employee_id) return false;
      const expense = db.findById('expenses', a.expense_id);
      return Boolean(expense && expense.status === 'CONFIRMED' && expense.date.startsWith(month));
    });

    const itemizedExpenses = expenseAllocations.map(a => {
      const exp = db.findById('expenses', a.expense_id);
      const cat = exp ? db.findById('expense_categories', exp.category_id) : null;
      return {
        id: a.id,
        expense_id: a.expense_id,
        category_name: cat ? cat.name : 'Xarajat',
        amount: a.allocated_amount,
        excess_amount: a.excess_amount ?? 0,
        date: exp?.date,
        payment_method: exp?.payment_method,
        reason: exp?.comment || 'Kunlik rasxod'
      };
    });

    // Payout status if a finalized salary record exists
    const salaryRecord = db.findOne('salaries', s => 
      s.company_id === company_id && s.employee_id === employee_id && s.period_month === month
    );

    return {
      employee: {
        id: employee.id,
        full_name: employee.full_name,
        position: employee.position,
        phone: employee.phone,
        salary_type: employee.salary_type
      },
      period_month: month,
      summary: {
        base_salary: breakdown.base_amount,
        bonus_amount: breakdown.bonus_amount,
        piecework_amount: breakdown.piecework_amount,
        total_earned: breakdown.base_amount + breakdown.bonus_amount + breakdown.piecework_amount,
        total_deductions: breakdown.deduction_amount,
        net_remaining_balance: breakdown.final_amount,
        status: salaryRecord ? salaryRecord.status : 'DRAFT'
      },
      trips,
      expenses: itemizedExpenses,
      bonus_breakdown: breakdown.bonus_breakdown,
      is_readonly: true
    };
  }

  /**
   * Get all employees for company with enriched salary rule, daily limit, and agent info
   */
  public static getEnrichedEmployees(company_id: string) {
    const employees = db.find('employees', e => e.company_id === company_id);
    const rules = db.find('salary_rules', r => r.company_id === company_id && r.is_active);
    const agents = db.find('agents', a => a.company_id === company_id);

    return employees.map(emp => {
      const rule = rules.find(r => r.employee_id === emp.id);
      const agent = agents.find(a => a.employee_id === emp.id);

      return {
        ...emp,
        base_salary: rule ? rule.base_salary : 0,
        pay_components: this.payComponentsOf(company_id, emp.id),
        kpi_bonus_percent: rule?.kpi_bonus_percent ?? agent?.commission_rate ?? 0,
        daily_expense_limit: ExpenseService.dailyLimitOf(emp.id),   // the limit in force today (same rule as Expenses)
        is_agent: Boolean(agent),
        agent_id: agent?.id ?? null,
        agent_code: agent?.code ?? null,
        commission_rate: agent?.commission_rate ?? 0
      };
    });
  }

  /**
   * Create new employee with salary rule, optional daily expense limit and agent binding
   */
  public static createEmployee(input: {
    company_id: string;
    full_name: string;
    position: string;
    phone: string;
    salary_type: 'FIXED' | 'PIECEWORK' | 'HYBRID';
    base_salary: number;
    daily_expense_limit?: number;
    status?: 'ACTIVE' | 'INACTIVE';
    is_agent?: boolean;
    agent_code?: string;
    commission_rate?: number;
    territory_id?: string;
    pay_components?: PayComponent[];
    user_id: string;
    user_email: string;
  }): Employee {
    const employeeId = `emp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const newEmp: Employee = {
      id: employeeId,
      company_id: input.company_id,
      full_name: input.full_name.trim(),
      position: input.position.trim(),
      phone: input.phone.trim(),
      salary_type: input.salary_type,
      status: input.status || 'ACTIVE',
      created_at: new Date().toISOString()
    };
    db.insert('employees', newEmp);

    // Create salary rule
    const ruleId = `salrule-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const salaryRule: SalaryRule = {
      id: ruleId,
      company_id: input.company_id,
      employee_id: employeeId,
      rule_type: input.salary_type === 'FIXED' ? 'FIXED' : input.salary_type === 'HYBRID' ? 'KPI_TIERED' : 'HOURLY',
      salary_type: input.salary_type,
      base_salary: Number(input.base_salary) || 0,
      kpi_bonus_percent: Number(input.commission_rate) || 0,
      is_active: true,
      created_at: new Date().toISOString()
    };
    db.insert('salary_rules', salaryRule);

    // Set daily expense limit if provided
    if (input.daily_expense_limit && Number(input.daily_expense_limit) > 0) {
      db.insert('employee_daily_limits', {
        id: `edl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        company_id: input.company_id,
        employee_id: employeeId,
        daily_limit: Number(input.daily_expense_limit),
        effective_from: businessToday(),
        effective_to: null,
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
    }

    // If marked as agent or position includes "Agent", register in agents collection
    if (input.is_agent || input.position.toLowerCase().includes('agent')) {
      const code = input.agent_code || nextAgentCode(input.company_id);
      db.insert('agents', {
        id: `ag-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        company_id: input.company_id,
        employee_id: employeeId,
        code,
        full_name: input.full_name.trim(),
        phone: input.phone.trim(),
        territory_id: input.territory_id || null,
        commission_rate: Number(input.commission_rate) || 0,
        status: 'ACTIVE',
        created_at: new Date().toISOString()
      });
    }

    if (input.pay_components) this.setPayComponents(input.company_id, employeeId, input.pay_components);

    AuditService.log({
      company_id: input.company_id,
      user_id: input.user_id,
      user_email: input.user_email,
      action: 'CREATE',
      entity: 'Employee',
      entity_id: employeeId,
      old_value: null,
      new_value: newEmp,
      reason: `Yangi xodim qo'shildi: ${newEmp.full_name} (${newEmp.position})`
    });

    return newEmp;
  }

  /**
   * Update existing employee details, salary rule and daily limits
   */
  public static updateEmployee(
    id: string,
    company_id: string,
    input: {
      full_name?: string;
      position?: string;
      phone?: string;
      salary_type?: 'FIXED' | 'PIECEWORK' | 'HYBRID';
      base_salary?: number;
      daily_expense_limit?: number;
      status?: 'ACTIVE' | 'INACTIVE';
      is_agent?: boolean;
      agent_code?: string;
      commission_rate?: number;
      territory_id?: string;
      pay_components?: PayComponent[];
    },
    user_id: string,
    user_email: string
  ): Employee {
    const existing = db.findById('employees', id);
    if (!existing || existing.company_id !== company_id) {
      throw new Error(`Xodim topilmadi: ${id}`);
    }

    const updates: Partial<Employee> = {};
    if (input.full_name) updates.full_name = input.full_name.trim();
    if (input.position) updates.position = input.position.trim();
    if (input.phone) updates.phone = input.phone.trim();
    if (input.salary_type) updates.salary_type = input.salary_type;
    if (input.status) updates.status = input.status;

    const updated = db.update('employees', id, updates);

    // Update SalaryRule base_salary
    if (input.base_salary !== undefined || input.salary_type !== undefined) {
      const rule = db.findOne('salary_rules', r => r.company_id === company_id && r.employee_id === id && r.is_active);
      if (rule) {
        db.update('salary_rules', rule.id, {
          base_salary: input.base_salary !== undefined ? Number(input.base_salary) : rule.base_salary,
          salary_type: input.salary_type || rule.salary_type,
          rule_type: input.salary_type === 'FIXED' ? 'FIXED' : input.salary_type === 'HYBRID' ? 'KPI_TIERED' : rule.rule_type
        });
      } else if (input.base_salary !== undefined) {
        db.insert('salary_rules', {
          id: `salrule-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          company_id,
          employee_id: id,
          rule_type: 'FIXED',
          base_salary: Number(input.base_salary),
          is_active: true,
          created_at: new Date().toISOString()
        });
      }
    }

    // Update daily expense limit: a new limit from today (the old one stays as history), only when it changed.
    if (input.daily_expense_limit !== undefined && Number.isFinite(Number(input.daily_expense_limit)) && Number(input.daily_expense_limit) >= 0
      && Number(input.daily_expense_limit) !== ExpenseService.dailyLimitOf(id)) {
      {
        db.insert('employee_daily_limits', {
          id: `edl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          company_id,
          employee_id: id,
          daily_limit: Math.round(Number(input.daily_expense_limit)),
          effective_from: businessToday(),
          effective_to: null,
          is_active: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });
      }
    }

    // Update linked agent if exists
    const linkedAgent = db.findOne('agents', a => a.company_id === company_id && a.employee_id === id);
    if (linkedAgent) {
      const agentUpdates: Partial<any> = {};
      if (input.full_name) agentUpdates.full_name = input.full_name.trim();
      if (input.phone) agentUpdates.phone = input.phone.trim();
      if (input.commission_rate !== undefined) agentUpdates.commission_rate = Number(input.commission_rate);
      if (input.agent_code) agentUpdates.code = input.agent_code;
      if (input.territory_id !== undefined) agentUpdates.territory_id = input.territory_id;
      db.update('agents', linkedAgent.id, agentUpdates);
    } else if (input.is_agent) {
      db.insert('agents', {
        id: `ag-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        company_id,
        employee_id: id,
        code: input.agent_code || nextAgentCode(company_id),
        full_name: (input.full_name || existing.full_name).trim(),
        phone: (input.phone || existing.phone).trim(),
        territory_id: input.territory_id || null,
        commission_rate: Number(input.commission_rate) || 0,
        status: 'ACTIVE',
        created_at: new Date().toISOString()
      });
    }

    // The pay scheme, when sent, is the whole truth: it overrides base_salary / commission fields above.
    if (input.pay_components) this.setPayComponents(company_id, id, input.pay_components);

    AuditService.log({
      company_id,
      user_id,
      user_email,
      action: 'UPDATE',
      entity: 'Employee',
      entity_id: id,
      old_value: existing,
      new_value: updated,
      reason: `Xodim ma'lumotlari yangilandi: ${existing.full_name}`
    });

    return updated!;
  }

  /**
   * Delete or archive employee safely
   */
  public static deleteEmployee(
    id: string,
    company_id: string,
    user_id: string,
    user_email: string
  ): { message: string; deleted: boolean } {
    const existing = db.findById('employees', id);
    if (!existing || existing.company_id !== company_id) {
      throw new Error(`Xodim topilmadi: ${id}`);
    }

    // Check if employee has paid salary or transactions
    const hasPaidSalary = db.findOne('salaries', s => s.employee_id === id && s.status === 'PAID');
    const hasAllocations = db.findOne('expense_allocations', a => a.employee_id === id);

    if (hasPaidSalary || hasAllocations) {
      // Soft-delete / deactivate to preserve historical ledger integrity
      db.update('employees', id, { status: 'INACTIVE' });
      AuditService.log({
        company_id,
        user_id,
        user_email,
        action: 'UPDATE',
        entity: 'Employee',
        entity_id: id,
        old_value: existing,
        new_value: { ...existing, status: 'INACTIVE' },
        reason: `Xodim o'chirilishi o'rniga nofaol (INACTIVE) holatiga o'tkazildi, chunki moliyaviy tarixi mavjud.`
      });
      return { message: "Xodim arxivlandi va nofaol holatga o'tkazildi (moliyaviy hisobotlar yaxlitligi saqlandi).", deleted: false };
    }

    // Hard delete safely
    db.delete('employees', id);
    const rules = db.find('salary_rules', r => r.employee_id === id);
    rules.forEach(r => db.delete('salary_rules', r.id));
    const limits = db.find('employee_daily_limits', l => l.employee_id === id);
    limits.forEach(l => db.delete('employee_daily_limits', l.id));

    AuditService.log({
      company_id,
      user_id,
      user_email,
      action: 'DELETE',
      entity: 'Employee',
      entity_id: id,
      old_value: existing,
      new_value: null,
      reason: `Xodim tizimdan o'chirildi: ${existing.full_name}`
    });

    return { message: "Xodim muvaffaqiyatli o'chirildi.", deleted: true };
  }
}
