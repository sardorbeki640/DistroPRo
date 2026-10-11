import { db } from '../db/database.ts';
import { businessToday } from '../utils/date.ts';
import type { 
  Expense, 
  ExpenseCategory, 
  ExpenseAllocation, 
  EmployeeDailyLimit,
  PaymentMethod, 
  ExpenseStatus, 
  CashTransaction, 
  CashDay,
  Employee,
  Salary
} from '../db/schema.ts';
import { CashService } from './cash.service.ts';
import type { XlsxSheet } from '../utils/xlsx.ts';
import { AuditService } from './audit.service.ts';
import { AuthService } from './auth.service.ts';

export interface CreateExpenseDTO {
  company_id: string;
  date: string; // YYYY-MM-DD
  category_id: string;
  amount: number;
  payment_method: PaymentMethod;
  comment: string;
  is_company_expense: boolean;
  employee_ids?: string[];
  allocations?: { employee_id: string; allocated_amount: number; allocation_reason?: string }[];
  user_id: string;
  user_email: string;
  confirm_immediately?: boolean;
}

export interface CorrectExpenseDTO {
  expense_id: string;
  amount?: number;
  payment_method?: PaymentMethod;
  comment?: string;
  category_id?: string;
  reason: string;
  user_id: string;
  user_email: string;
  has_permission?: boolean;
}

export interface ExpenseFilterOptions {
  company_id: string;
  date?: string;
  from_date?: string;
  to_date?: string;
  category_id?: string;
  employee_id?: string;
  payment_method?: PaymentMethod;
  status?: ExpenseStatus;
  created_by?: string;
  search?: string;
}

export interface ExpensePreviewResult {
  total_expense: number;
  category: {
    id: string;
    name: string;
    monthly_limit: number;
    used_month: number;
    remaining_month: number;
    excess_month: number;
  };
  is_company_expense: boolean;
  employees: {
    employee_id: string;
    employee_name: string;
    allocated_amount: number;
    daily_limit: number;
    used_today: number;
    total_today: number;
    remaining_today: number;
    excess_today: number;
  }[];
  total_excess: number;
  company_cash_impact: number;
  payment_method: PaymentMethod;
}

/** An employee's daily expense limit when none was set. */
export const DEFAULT_DAILY_LIMIT = 20_000;

export class ExpenseService {

  /**
   * Deterministic allocation algorithm:
   * Rule 5:
   * Given Expense = A, N employees:
   * Base = Math.floor(A / N)
   * Remainder = A - (Base * N)
   * Last `Remainder` employees get Base + 1.
   * SUM(employee allocations) === A (100% exact, no 1-som difference).
   */
  public static calculateDeterministicAllocations(
    amount: number,
    employeeIds: string[],
    reason?: string
  ): { employee_id: string; allocated_amount: number; allocation_reason?: string }[] {
    if (amount <= 0) {
      throw new Error('Xarajat summasi noldan katta bo\'lishi shart.');
    }
    if (!employeeIds || employeeIds.length === 0) {
      return [];
    }

    const n = employeeIds.length;
    const base = Math.floor(amount / n);
    const remainder = amount - (base * n);

    // Give base to all; distribute remainder to the last `remainder` employees
    const allocations = employeeIds.map((empId, index) => {
      // index from 0 to n-1. If remainder > 0 and index >= n - remainder, get +1
      const extra = (index >= n - remainder) ? 1 : 0;
      return {
        employee_id: empId,
        allocated_amount: base + extra,
        allocation_reason: reason || undefined
      };
    });

    // Verification check
    const sum = allocations.reduce((acc, curr) => acc + curr.allocated_amount, 0);
    if (sum !== amount) {
      throw new Error(`Deterministic allocation error: sum (${sum}) !== amount (${amount})`);
    }

    return allocations;
  }

  /**
   * Category Monthly Usage Calculation:
   * monthly_limit - current_month_used = remaining
   */
  public static getCategoryMonthlyUsage(categoryId: string, dateStr: string): {
    category: ExpenseCategory;
    monthly_limit: number;
    used: number;
    remaining: number;
  } {
    const category = db.findById('expense_categories', categoryId);
    if (!category) {
      throw new Error('Xarajat toifasi topilmadi.');
    }

    const monthPrefix = dateStr.slice(0, 7); // YYYY-MM
    const expenses = db.find('expenses', exp => 
      exp.category_id === categoryId && 
      exp.status === 'CONFIRMED' && 
      exp.date.startsWith(monthPrefix)
    );

    const used = expenses.reduce((acc, e) => acc + e.amount, 0);
    // A category without a limit (0 or none, e.g. imported) is unlimited: nothing "remains" and nothing is exceeded.
    const limit = Number(category.monthly_limit) || 0;
    const remaining = limit > 0 ? Math.max(0, limit - used) : Number.POSITIVE_INFINITY;

    return {
      category,
      monthly_limit: limit,
      used,
      remaining
    };
  }

  /**
   * Employee Daily Limit & Usage Calculation:
   * used_today + new_allocation = total_today
   */
  /**
   * The employee's daily expense limit on a date: the newest record in force (by start date, then by when it was
   * set), else the default. One rule for the Expenses and the Employees pages, so a change on either takes effect.
   */
  public static dailyLimitOf(employeeId: string, dateStr: string = businessToday()): number {
    const inForce = db.find('employee_daily_limits', l => l.employee_id === employeeId && l.is_active && l.effective_from <= dateStr && (!l.effective_to || l.effective_to >= dateStr))
      .sort((a, b) => a.effective_from.localeCompare(b.effective_from) || String(a.created_at).localeCompare(String(b.created_at)));
    return inForce.length ? inForce[inForce.length - 1].daily_limit : DEFAULT_DAILY_LIMIT;
  }

  public static getEmployeeDailyUsage(employeeId: string, dateStr: string): {
    employee: Employee;
    daily_limit: number;
    used_today: number;
    remaining: number;
  } {
    const employee = db.findById('employees', employeeId);
    if (!employee) {
      throw new Error(`Xodim topilmadi: ${employeeId}`);
    }

    const dailyLimit = this.dailyLimitOf(employeeId, dateStr);

    // Find all confirmed allocations for this employee on dateStr
    const confirmedExpenses = db.find('expenses', e => e.date === dateStr && e.status === 'CONFIRMED');
    const expenseIds = new Set(confirmedExpenses.map(e => e.id));

    const allocations = db.find('expense_allocations', a => 
      a.employee_id === employeeId && expenseIds.has(a.expense_id)
    );

    const usedToday = allocations.reduce((acc, a) => acc + a.allocated_amount, 0);
    const remaining = Math.max(0, dailyLimit - usedToday);

    return {
      employee,
      daily_limit: dailyLimit,
      used_today: usedToday,
      remaining
    };
  }

  /**
   * Generates confirmation preview showing limits, usages, excesses, and cash impact
   */
  public static getExpensePreview(dto: {
    company_id: string;
    date: string;
    category_id: string;
    amount: number;
    payment_method: PaymentMethod;
    comment: string;
    is_company_expense: boolean;
    employee_ids?: string[];
    allocations?: { employee_id: string; allocated_amount: number }[];
  }): ExpensePreviewResult {
    const amount = Math.round(Number(dto.amount));
    if (amount <= 0) {
      throw new Error('Xarajat summasi musbat butun son bo\'lishi shart.');
    }

    const catUsage = this.getCategoryMonthlyUsage(dto.category_id, dto.date);
    if (catUsage.category.company_id !== dto.company_id) throw new Error('Xarajat toifasi topilmadi.');
    const categoryExcess = catUsage.monthly_limit > 0 ? Math.max(0, (catUsage.used + amount) - catUsage.monthly_limit) : 0;

    let employeeResults: ExpensePreviewResult['employees'] = [];
    let totalEmployeeExcess = 0;

    if (!dto.is_company_expense) {
      let finalAllocations: { employee_id: string; allocated_amount: number }[] = [];
      if (dto.allocations && dto.allocations.length > 0) {
        finalAllocations = dto.allocations;
      } else if (dto.employee_ids && dto.employee_ids.length > 0) {
        finalAllocations = this.calculateDeterministicAllocations(amount, dto.employee_ids);
      } else {
        throw new Error('Xodim xarajati uchun kamida 1 nafar xodim tanlanishi shart.');
      }

      for (const alloc of finalAllocations) {
        const empUsage = this.getEmployeeDailyUsage(alloc.employee_id, dto.date);
        const totalToday = empUsage.used_today + alloc.allocated_amount;
        const excessToday = Math.max(0, totalToday - empUsage.daily_limit);
        const remainingToday = Math.max(0, empUsage.daily_limit - totalToday);
        totalEmployeeExcess += excessToday;

        employeeResults.push({
          employee_id: alloc.employee_id,
          employee_name: empUsage.employee.full_name,
          allocated_amount: alloc.allocated_amount,
          daily_limit: empUsage.daily_limit,
          used_today: empUsage.used_today,
          total_today: totalToday,
          remaining_today: remainingToday,
          excess_today: excessToday
        });
      }
    }

    return {
      total_expense: amount,
      category: {
        id: catUsage.category.id,
        name: catUsage.category.name,
        monthly_limit: catUsage.monthly_limit,
        used_month: catUsage.used,
        remaining_month: Number.isFinite(catUsage.remaining) ? catUsage.remaining : null as any, // null = no limit
        excess_month: categoryExcess
      },
      is_company_expense: dto.is_company_expense,
      employees: employeeResults,
      total_excess: totalEmployeeExcess,
      company_cash_impact: dto.payment_method === 'CASH' ? -amount : 0,
      payment_method: dto.payment_method
    };
  }

  /**
   * Creates a new Expense (either DRAFT or directly CONFIRMED)
   */
  public static createExpense(dto: CreateExpenseDTO): { expense: Expense; allocations: ExpenseAllocation[] } {
    // 1. Validation
    const amount = Math.round(Number(dto.amount));
    if (isNaN(amount) || amount <= 0) {
      throw new Error('Xarajat summasi musbat bo\'lishi shart (0 yoki manfiy summalar taqiqlangan).');
    }

    if (!dto.comment || dto.comment.trim().length < 3) {
      throw new Error('Xarajat izohi (comment / reason) kiritilishi shart (kamida 3 ta belgi).');
    }

    if (!dto.payment_method) {
      throw new Error('To\'lov turi (payment_method) tanlanishi shart.');
    }

    const category = db.findById('expense_categories', dto.category_id);
    if (!category || category.company_id !== dto.company_id) {
      throw new Error('Tanlangan toifa topilmadi.');
    }
    if (!category.is_active) {
      throw new Error(`"${category.name}" toifasi faol emas (INACTIVE). Faol bo'lmagan toifada xarajat yaratish taqiqlangan.`);
    }

    // Determine allocations
    let finalAllocations: { employee_id: string; allocated_amount: number; allocation_reason?: string }[] = [];
    if (dto.is_company_expense) {
      finalAllocations = [];
    } else {
      if (dto.allocations && dto.allocations.length > 0) {
        finalAllocations = dto.allocations;
      } else if (dto.employee_ids && dto.employee_ids.length > 0) {
        finalAllocations = this.calculateDeterministicAllocations(amount, dto.employee_ids, dto.comment);
      } else {
        throw new Error('Xodim xarajati uchun kamida 1 nafar xodim tanlanishi shart.');
      }

      // Validate allocations
      let sumAlloc = 0;
      for (const a of finalAllocations) {
        if (a.allocated_amount < 0) {
          throw new Error('Manfiy allocation taqiqlanadi.');
        }
        sumAlloc += a.allocated_amount;

        const emp = db.findById('employees', a.employee_id);
        if (!emp) {
          throw new Error(`Xodim topilmadi: ${a.employee_id}`);
        }
        if (emp.company_id !== dto.company_id) {
          throw new Error(`Xodim (${emp.full_name}) boshqa kompaniyaga tegishli.`);
        }
      }

      if (sumAlloc !== amount) {
        throw new Error(`Allocation summasi xarajat summasiga teng bo'lishi shart: SUM(${sumAlloc}) !== Jami(${amount})`);
      }
    }

    const now = new Date().toISOString();
    const expenseId = `exp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    // Prepare Draft Expense
    const expense: Expense = {
      id: expenseId,
      company_id: dto.company_id,
      date: dto.date,
      category_id: dto.category_id,
      amount,
      payment_method: dto.payment_method,
      comment: dto.comment,
      description: dto.comment,
      created_by: dto.user_id,
      status: 'DRAFT',
      is_company_expense: Boolean(dto.is_company_expense),
      cash_day_id: null,
      cash_transaction_id: null,
      created_at: now,
      updated_at: now
    };

    // Save Draft
    db.insert('expenses', expense);

    const savedAllocations: ExpenseAllocation[] = [];
    for (let i = 0; i < finalAllocations.length; i++) {
      const a = finalAllocations[i];
      const allocRecord: ExpenseAllocation = {
        id: `alloc-${expenseId}-${i + 1}`,
        expense_id: expenseId,
        employee_id: a.employee_id,
        allocated_amount: a.allocated_amount,
        allocation_reason: a.allocation_reason || dto.comment,
        created_at: now,
        updated_at: now
      };
      db.insert('expense_allocations', allocRecord);
      savedAllocations.push(allocRecord);
    }

    AuditService.log({
      company_id: dto.company_id,
      user_id: dto.user_id,
      user_email: dto.user_email,
      action: 'CREATE',
      entity: 'Expense',
      entity_id: expenseId,
      old_value: null,
      new_value: expense,
      reason: `Yangi xarajat yaratildi (Draft): ${amount.toLocaleString()} UZS`
    });

    // If immediate confirmation requested, confirm atomically
    if (dto.confirm_immediately) {
      return this.confirmExpense({
        expense_id: expenseId,
        user_id: dto.user_id,
        user_email: dto.user_email,
        comment: dto.comment
      });
    }

    return { expense, allocations: savedAllocations };
  }

  /**
   * Atomic Expense Confirmation:
   * Rule 10:
   * Confirms Expense, persists Allocations, integrates with Cash Core (CashTransaction + CashDay),
   * logs AuditLog. If any step fails -> ROLLBACK EVERYTHING.
   */
  /** An expense of the company (another company's id is "not found"). */
  private static own(expenseId: string, companyId?: string) {
    const expense = db.findById('expenses', expenseId);
    if (!expense || (companyId && expense.company_id !== companyId)) throw new Error('Xarajat topilmadi.');
    return expense;
  }

  /** A confirmed expense sits in a cash day; once that day is closed its books are final. */
  private static assertDayOpen(expense: Expense, action: string) {
    if (expense.status !== 'CONFIRMED' || !expense.cash_day_id) return;
    const day = db.findById('cash_days', expense.cash_day_id);
    if (day?.status === 'CLOSED') {
      throw new Error(`${day.date} kassa kuni yopilgan — undagi xarajatni ${action} bo‘lmaydi. Farqni ochiq kassa kunida yangi xarajat (yoki kirim) bilan to‘g‘rilang.`);
    }
  }

  public static confirmExpense(dto: {
    expense_id: string;
    user_id: string;
    user_email: string;
    comment?: string;
    company_id?: string;
  }): { expense: Expense; allocations: ExpenseAllocation[] } {
    return db.transaction((tx) => {
      const expense = this.own(dto.expense_id, dto.company_id);

      // Duplicate confirmation prevention
      if (expense.status === 'CONFIRMED') {
        throw new Error('Ushbu xarajat allaqachon tasdiqlangan (Duplicate confirmation taqiqlanadi).');
      }

      if (expense.status === 'CANCELLED') {
        throw new Error('Bekor qilingan xarajatni tasdiqlab bo\'lmaydi.');
      }

      const comment = dto.comment || expense.comment;
      if (!comment || comment.trim().length < 3) {
        throw new Error('Tasdiqlash uchun izoh / sabab kiritilishi shart.');
      }

      // Check category is active
      const category = tx.findById('expense_categories', expense.category_id);
      if (!category || !category.is_active) {
        throw new Error('Faol bo\'lmagan toifadagi xarajatni tasdiqlash taqiqlanadi.');
      }

      // Duplicate CashTransaction check
      const existingTx = tx.findOne('cash_transactions', t => 
        t.external_reference === expense.id || t.id === `ctx-exp-${expense.id}`
      );
      if (existingTx) {
        throw new Error('Ushbu xarajat bo\'yicha kassa tranzaksiyasi allaqachon mavjud.');
      }

      // Get or create CashDay for the expense date
      let cashDay = tx.findOne('cash_days', cd => 
        cd.company_id === expense.company_id && cd.date === expense.date
      );

      if (!cashDay) {
        // Automatically open or create cash day for this date if not existing
        const register = tx.getTable('cash_registers').find(r => r.company_id === expense.company_id);
        const registerId = register ? register.id : 'reg-main-01';
        cashDay = CashService.openCashDay({
          company_id: expense.company_id,
          register_id: registerId,
          date: expense.date,
          user_id: dto.user_id,
          user_email: dto.user_email,
          user_role: 'ADMIN'
        });
      }

      const now = new Date().toISOString();
      const cashTxId = `ctx-exp-${expense.id}`;

      // Create CashTransaction
      const cashTx: CashTransaction = {
        id: cashTxId,
        company_id: expense.company_id,
        cash_day_id: cashDay.id,
        transaction_type: 'EXPENSE',
        amount: expense.amount,
        payment_method: expense.payment_method,
        customer_id: null,
        employee_id: null,
        agent_id: null,
        external_reference: expense.id,
        description: `Xarajat: ${category.name} — ${comment}`,
        created_by: dto.user_id,
        created_at: now,
        updated_at: now
      };
      tx.insert('cash_transactions', cashTx);

      // Recalculate CashDay Totals
      CashService.recalculateCashDayTotals(cashDay.id);

      // Update Expense
      const updatedExpense = tx.update('expenses', expense.id, {
        status: 'CONFIRMED',
        comment,
        cash_day_id: cashDay.id,
        cash_transaction_id: cashTxId,
        updated_at: now
      })!;

      const allocations = tx.find('expense_allocations', a => a.expense_id === expense.id);

      // Audit Log
      AuditService.log({
        company_id: expense.company_id,
        user_id: dto.user_id,
        user_email: dto.user_email,
        action: 'CONFIRM',
        entity: 'Expense',
        entity_id: expense.id,
        old_value: { status: 'DRAFT', amount: expense.amount },
        new_value: updatedExpense,
        reason: `Xarajat tasdiqlandi: ${expense.amount.toLocaleString()} UZS (${category.name})`
      });

      return { expense: updatedExpense, allocations };
    });
  }

  /**
   * Cancels an Expense (DRAFT or CONFIRMED)
   */
  public static cancelExpense(dto: {
    expense_id: string;
    reason: string;
    user_id: string;
    user_email: string;
    company_id?: string;
  }): Expense {
    return db.transaction((tx) => {
      const expense = this.own(dto.expense_id, dto.company_id);

      if (expense.status === 'CANCELLED') {
        throw new Error('Bu xarajat allaqachon bekor qilingan.');
      }
      this.assertDayOpen(expense, 'bekor qilib');

      if (!dto.reason || dto.reason.trim().length < 3) {
        throw new Error('Bekor qilish sababi (reason) kiritilishi shart.');
      }

      const now = new Date().toISOString();

      // If it was confirmed, remove or reverse cash transaction and recalculate cash
      if (expense.status === 'CONFIRMED' && expense.cash_transaction_id) {
        const cashTx = tx.findById('cash_transactions', expense.cash_transaction_id);
        if (cashTx) {
          tx.delete('cash_transactions', cashTx.id);
          if (cashTx.cash_day_id) {
            CashService.recalculateCashDayTotals(cashTx.cash_day_id);
          }
        }
      }

      const updated = tx.update('expenses', expense.id, {
        status: 'CANCELLED',
        updated_at: now
      })!;

      AuditService.log({
        company_id: expense.company_id,
        user_id: dto.user_id,
        user_email: dto.user_email,
        action: 'CANCEL',
        entity: 'Expense',
        entity_id: expense.id,
        old_value: expense,
        new_value: updated,
        reason: `Xarajat bekor qilindi: ${dto.reason}`
      });

      return updated;
    });
  }

  /**
   * Controlled Correction of a CONFIRMED Expense:
   * Rule 11:
   * DRAFT can be updated directly. CONFIRMED cannot be edited with simple update.
   * Correction checks permissions, preserves history in audit log, and adjusts cash ledger.
   */
  public static correctExpense(dto: CorrectExpenseDTO & { company_id?: string }): Expense {
    return db.transaction((tx) => {
      const expense = this.own(dto.expense_id, dto.company_id);
      if (expense.status === 'CANCELLED') throw new Error('Bekor qilingan xarajatni tuzatib bo‘lmaydi.');
      // The amount and the way it was paid are in the cash day; the comment can be fixed any time.
      if (dto.amount !== undefined || dto.payment_method || dto.category_id) this.assertDayOpen(expense, 'o‘zgartirib');

      if (!dto.reason || dto.reason.trim().length < 3) {
        throw new Error('Korreksiya sababi (reason) kiritilishi shart.');
      }

      const now = new Date().toISOString();
      const oldSnapshot = JSON.parse(JSON.stringify(expense));

      const updates: Partial<Expense> = {};
      if (dto.comment) updates.comment = dto.comment;
      if (dto.category_id) {
        const cat = tx.findById('expense_categories', dto.category_id);
        if (!cat || !cat.is_active) {
          throw new Error('Yaroqsiz toifa.');
        }
        updates.category_id = dto.category_id;
      }
      if (dto.amount !== undefined) {
        const newAmount = Math.round(Number(dto.amount));
        if (newAmount <= 0) {
          throw new Error('Summa noldan katta bo\'lishi shart.');
        }
        updates.amount = newAmount;
      }
      if (dto.payment_method) {
        updates.payment_method = dto.payment_method;
      }

      // If CONFIRMED, update linked CashTransaction and recalculate
      if (expense.status === 'CONFIRMED' && expense.cash_transaction_id) {
        const cashTx = tx.findById('cash_transactions', expense.cash_transaction_id);
        if (cashTx) {
          tx.update('cash_transactions', cashTx.id, {
            amount: updates.amount !== undefined ? updates.amount : cashTx.amount,
            payment_method: updates.payment_method || cashTx.payment_method,
            description: `Korreksiya: ${updates.comment || expense.comment}`
          });
          if (cashTx.cash_day_id) {
            CashService.recalculateCashDayTotals(cashTx.cash_day_id);
          }
        }
      }

      updates.updated_at = now;
      const updatedExpense = tx.update('expenses', expense.id, updates)!;

      AuditService.log({
        company_id: expense.company_id,
        user_id: dto.user_id,
        user_email: dto.user_email,
        action: 'CORRECT',
        entity: 'Expense',
        entity_id: expense.id,
        old_value: oldSnapshot,
        new_value: updatedExpense,
        reason: `Xarajat korreksiyasi: ${dto.reason}`
      });

      return updatedExpense;
    });
  }

  /**
   * Filtered Expense List
   */
  public static getExpenses(filters: ExpenseFilterOptions): {
    expenses: (Expense & { 
      category_name: string; 
      allocations: (ExpenseAllocation & { employee_name: string })[];
      creator_name: string;
    })[];
    total: number;
    total_amount: number;
  } {
    const allExpenses = db.find('expenses', e => {
      if (filters.company_id && e.company_id !== filters.company_id) return false;
      if (filters.date && e.date !== filters.date) return false;
      if (filters.from_date && e.date < filters.from_date) return false;
      if (filters.to_date && e.date > filters.to_date) return false;
      // Each filter may hold several values separated by commas ("CASH,TERMINAL").
      const oneOf = (filter: unknown, value: unknown) => !filter || String(filter).split(',').includes(String(value));
      if (!oneOf(filters.category_id, e.category_id)) return false;
      if (!oneOf(filters.payment_method, e.payment_method)) return false;
      if (!oneOf(filters.status, e.status)) return false;
      if (filters.created_by && e.created_by !== filters.created_by) return false;

      // Filter by employee
      if (filters.employee_id) {
        const allocs = db.find('expense_allocations', a => a.expense_id === e.id && a.employee_id === filters.employee_id);
        if (allocs.length === 0) return false;
      }

      if (filters.search) {
        const q = filters.search.toLowerCase();
        const cat = db.findById('expense_categories', e.category_id);
        const matchComment = e.comment?.toLowerCase().includes(q);
        const matchCat = cat?.name?.toLowerCase().includes(q);
        if (!matchComment && !matchCat) return false;
      }

      return true;
    });

    // Sort descending by date, then created_at
    allExpenses.sort((a, b) => {
      if (a.date !== b.date) return b.date.localeCompare(a.date);
      return b.created_at.localeCompare(a.created_at);
    });

    let totalAmount = 0;
    const enriched = allExpenses.map(e => {
      totalAmount += e.amount;
      const cat = db.findById('expense_categories', e.category_id);
      const user = db.findById('users', e.created_by);
      const allocs = db.find('expense_allocations', a => a.expense_id === e.id);
      const enrichedAllocs = allocs.map(a => {
        const emp = db.findById('employees', a.employee_id);
        return {
          ...a,
          employee_name: emp ? emp.full_name : a.employee_id
        };
      });

      return {
        ...e,
        category_name: cat ? cat.name : 'Noma\'lum toifa',
        allocations: enrichedAllocs,
        creator_name: user ? user.full_name : e.created_by
      };
    });

    return {
      expenses: enriched,
      total: enriched.length,
      total_amount: totalAmount
    };
  }

  /**
   * Detailed Expense Information
   */
  public static getExpenseDetail(expenseId: string, companyId?: string): any {
    const expense = this.own(expenseId, companyId);

    const category = db.findById('expense_categories', expense.category_id);
    const creator = db.findById('users', expense.created_by);
    const allocations = db.find('expense_allocations', a => a.expense_id === expense.id);

    // Enriched allocations with limits
    const enrichedAllocs = allocations.map(a => {
      const empUsage = this.getEmployeeDailyUsage(a.employee_id, expense.date);
      return {
        id: a.id,
        employee_id: a.employee_id,
        employee_name: empUsage.employee.full_name,
        allocated_amount: a.allocated_amount,
        allocation_reason: a.allocation_reason,
        daily_limit: empUsage.daily_limit,
        used_today: empUsage.used_today,
        remaining: empUsage.remaining,
        excess: Math.max(0, empUsage.used_today - empUsage.daily_limit)
      };
    });

    // Cash Impact
    let cashImpact: any = null;
    if (expense.cash_transaction_id) {
      const ctx = db.findById('cash_transactions', expense.cash_transaction_id);
      if (ctx) {
        cashImpact = {
          cash_transaction_id: ctx.id,
          cash_day_id: ctx.cash_day_id,
          payment_method: ctx.payment_method,
          amount: ctx.amount,
          description: ctx.description
        };
      }
    }

    // Audit logs for this expense
    const audits = db.find('audit_logs', a => a.entity === 'Expense' && a.entity_id === expense.id);
    audits.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    return {
      expense: {
        ...expense,
        category_name: category ? category.name : 'Noma\'lum'
      },
      category,
      creator: creator ? { id: creator.id, name: creator.full_name, email: creator.email } : null,
      allocations: enrichedAllocs,
      cash_impact: cashImpact,
      audits
    };
  }

  /**
   * Category Management
   */
  public static createCategory(dto: {
    company_id: string;
    name: string;
    description?: string;
    monthly_limit: number;
    user_id: string;
    user_email: string;
  }): ExpenseCategory {
    if (!dto.name || dto.name.trim().length < 2) {
      throw new Error('Toifa nomi kiritilishi shart.');
    }
    const limit = Math.max(0, Math.round(Number(dto.monthly_limit || 0)));
    const now = new Date().toISOString();
    const id = `cat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    const category: ExpenseCategory = {
      id,
      company_id: dto.company_id,
      name: dto.name.trim(),
      description: dto.description?.trim(),
      monthly_limit: limit,
      is_active: true,
      created_at: now,
      updated_at: now
    };

    db.insert('expense_categories', category);

    AuditService.log({
      company_id: dto.company_id,
      user_id: dto.user_id,
      user_email: dto.user_email,
      action: 'CATEGORY_CREATE',
      entity: 'ExpenseCategory',
      entity_id: id,
      old_value: null,
      new_value: category,
      reason: `Yangi toifa yaratildi: ${category.name}, Oylik limit: ${limit.toLocaleString()} UZS`
    });

    return category;
  }

  public static updateCategory(dto: {
    category_id: string;
    name?: string;
    description?: string;
    monthly_limit?: number;
    is_active?: boolean;
    user_id: string;
    user_email: string;
    company_id?: string;
  }): ExpenseCategory {
    const cat = db.findById('expense_categories', dto.category_id);
    if (!cat || (dto.company_id && cat.company_id !== dto.company_id)) {
      throw new Error('Toifa topilmadi.');
    }
    if (dto.name !== undefined && dto.name.trim().length < 2) throw new Error('Toifa nomi kiritilishi shart.');

    const updates: Partial<ExpenseCategory> = {};
    if (dto.name !== undefined) updates.name = dto.name.trim();
    if (dto.description !== undefined) updates.description = dto.description.trim();
    if (dto.monthly_limit !== undefined) updates.monthly_limit = Math.max(0, Math.round(Number(dto.monthly_limit)));
    if (dto.is_active !== undefined) updates.is_active = Boolean(dto.is_active);
    updates.updated_at = new Date().toISOString();

    const updated = db.update('expense_categories', cat.id, updates)!;

    AuditService.log({
      company_id: cat.company_id,
      user_id: dto.user_id,
      user_email: dto.user_email,
      action: 'CATEGORY_UPDATE',
      entity: 'ExpenseCategory',
      entity_id: cat.id,
      old_value: cat,
      new_value: updated,
      reason: `Toifa o'zgartirildi: ${updated.name}`
    });

    return updated;
  }

  /**
   * Employee Daily Limit Update
   */
  public static setEmployeeDailyLimit(dto: {
    employee_id: string;
    daily_limit: number;
    effective_from?: string;
    effective_to?: string | null;
    user_id: string;
    user_email: string;
    company_id: string;
  }): EmployeeDailyLimit {
    const employee = db.findById('employees', dto.employee_id);
    if (!employee || employee.company_id !== dto.company_id) throw new Error('Xodim topilmadi.');
    if (!Number.isFinite(Number(dto.daily_limit)) || Number(dto.daily_limit) < 0) throw new Error('Kunlik limit 0 yoki musbat son bo‘lsin.');
    const limit = Math.max(0, Math.round(Number(dto.daily_limit)));
    const now = new Date().toISOString();
    const effectiveFrom = dto.effective_from || businessToday();

    const id = `edl-${dto.employee_id}-${Date.now()}`;
    const newLimit: EmployeeDailyLimit = {
      id,
      employee_id: dto.employee_id,
      daily_limit: limit,
      effective_from: effectiveFrom,
      effective_to: dto.effective_to || null,
      is_active: true,
      created_at: now,
      updated_at: now
    };

    db.insert('employee_daily_limits', newLimit);

    AuditService.log({
      company_id: dto.company_id,
      user_id: dto.user_id,
      user_email: dto.user_email,
      action: 'LIMIT_UPDATE',
      entity: 'EmployeeDailyLimit',
      entity_id: id,
      old_value: null,
      new_value: newLimit,
      reason: `Xodim kunlik limiti yangilandi: ${limit.toLocaleString()} UZS`
    });

    return newLimit;
  }

  /**
   * Daily Expense Report
   */
  public static getDailyReport(company_id: string, date: string): {
    date: string;
    total: number;
    by_payment_method: {
      CASH: number;
      TERMINAL: number;
      CLICK: number;
      BANK_TRANSFER: number;
      OTHER: number;
    };
    expenses_count: number;
  } {
    const expenses = db.find('expenses', e => 
      e.company_id === company_id && 
      e.date === date && 
      e.status === 'CONFIRMED'
    );

    const byMethod = {
      CASH: 0,
      TERMINAL: 0,
      CLICK: 0,
      BANK_TRANSFER: 0,
      OTHER: 0
    };

    let total = 0;
    for (const exp of expenses) {
      total += exp.amount;
      if (byMethod[exp.payment_method] !== undefined) {
        byMethod[exp.payment_method] += exp.amount;
      } else {
        byMethod.OTHER += exp.amount;
      }
    }

    return {
      date,
      total,
      by_payment_method: byMethod,
      expenses_count: expenses.length
    };
  }

  /**
   * Monthly Expense Report
   */
  public static getMonthlyReport(company_id: string, month: string): {
    month: string;
    total_expense: number;
    category_totals: { category_id: string; category_name: string; amount: number; monthly_limit: number; excess: number }[];
    employee_totals: { employee_id: string; employee_name: string; amount: number }[];
    company_only_total: number;
    exceeded_limits: { type: string; name: string; limit: number; used: number; excess: number }[];
  } {
    const expenses = db.find('expenses', e => 
      e.company_id === company_id && 
      e.date.startsWith(month) && 
      e.status === 'CONFIRMED'
    );

    let totalExpense = 0;
    let companyOnlyTotal = 0;
    const catMap = new Map<string, number>();
    const empMap = new Map<string, number>();

    for (const exp of expenses) {
      totalExpense += exp.amount;
      catMap.set(exp.category_id, (catMap.get(exp.category_id) || 0) + exp.amount);

      if (exp.is_company_expense) {
        companyOnlyTotal += exp.amount;
      }
    }

    // Employee allocations
    const expenseIds = new Set(expenses.map(e => e.id));
    const allocations = db.find('expense_allocations', a => expenseIds.has(a.expense_id));
    for (const alloc of allocations) {
      empMap.set(alloc.employee_id, (empMap.get(alloc.employee_id) || 0) + alloc.allocated_amount);
    }

    // Category Totals & Exceeded Limits
    const categories = db.find('expense_categories', c => c.company_id === company_id);
    const categoryTotals: any[] = [];
    const exceededLimits: any[] = [];

    for (const cat of categories) {
      const amount = catMap.get(cat.id) || 0;
      const limit = Number(cat.monthly_limit) || 0;
      const excess = limit > 0 ? Math.max(0, amount - limit) : 0;
      categoryTotals.push({
        category_id: cat.id,
        category_name: cat.name,
        amount,
        monthly_limit: limit,
        excess
      });

      if (excess > 0) {
        exceededLimits.push({
          type: 'CATEGORY_MONTHLY',
          name: cat.name,
          limit,
          used: amount,
          excess
        });
      }
    }

    // Employee Totals
    const employeeTotals: any[] = [];
    empMap.forEach((amount, empId) => {
      const emp = db.findById('employees', empId);
      employeeTotals.push({
        employee_id: empId,
        employee_name: emp ? emp.full_name : empId,
        amount
      });
    });

    return {
      month,
      total_expense: totalExpense,
      category_totals: categoryTotals,
      employee_totals: employeeTotals,
      company_only_total: companyOnlyTotal,
      exceeded_limits: exceededLimits
    };
  }

  /**
   * Employee Profile View:
   * Rule 15:
   * - Salary: current month salary
   * - Expenses: current month employee expenses (by date, by category, reasons, daily limit, used today, remaining today)
   */
  public static getEmployeeProfile(employee_id: string, month: string): {
    employee: Employee;
    salary: {
      period_month: string;
      base_amount: number;
      bonus_amount: number;
      deduction_amount: number;
      final_amount: number;
    } | null;
    expenses_summary: {
      total_month_expenses: number;
      remaining_salary: number | null;
      expenses: any[];
    };
    limits: {
      daily_limit: number;
      used_today: number;
      remaining_today: number;
    };
  } {
    const employee = db.findById('employees', employee_id);
    if (!employee) {
      throw new Error('Xodim topilmadi.');
    }

    // Salary for month: only a calculated one; none means "not calculated yet", never an invented amount.
    const salaries = db.find('salaries', s => s.employee_id === employee_id && s.period_month === month);
    const salary = salaries.length > 0 ? salaries[0] : null;

    // Month expenses
    const monthExpenses = db.find('expenses', e => e.company_id === employee.company_id && e.date.startsWith(month) && e.status === 'CONFIRMED');
    const expenseIds = new Set(monthExpenses.map(e => e.id));

    const allocs = db.find('expense_allocations', a => a.employee_id === employee_id && expenseIds.has(a.expense_id));

    let totalMonthExpenses = 0;
    const enrichedExpenses = allocs.map(a => {
      const exp = monthExpenses.find(e => e.id === a.expense_id)!;
      const cat = db.findById('expense_categories', exp.category_id);
      totalMonthExpenses += a.allocated_amount;
      return {
        date: exp.date,
        category_name: cat ? cat.name : 'Noma\'lum',
        allocated_amount: a.allocated_amount,
        total_expense_amount: exp.amount,
        payment_method: exp.payment_method,
        reason: a.allocation_reason || exp.comment,
        status: exp.status
      };
    });

    enrichedExpenses.sort((a, b) => b.date.localeCompare(a.date));

    // Today's limits
    const today = businessToday();
    const todayUsage = this.getEmployeeDailyUsage(employee_id, today);

    return {
      employee,
      salary: salary ? {
        period_month: salary.period_month,
        base_amount: salary.base_amount,
        bonus_amount: salary.bonus_amount || 0,
        deduction_amount: salary.deduction_amount || 0,
        final_amount: salary.final_amount
      } : null,
      expenses_summary: {
        total_month_expenses: totalMonthExpenses,
        remaining_salary: salary ? salary.final_amount - totalMonthExpenses : null,
        expenses: enrichedExpenses
      },
      limits: {
        daily_limit: todayUsage.daily_limit,
        used_today: todayUsage.used_today,
        remaining_today: todayUsage.remaining
      }
    };
  }

  /**
   * Monthly Employee Summary Report:
   * Rule 16:
   * - Employee, Month, Salary, Expenses, Remaining salary
   */
  public static getMonthlyEmployeeSummary(company_id: string, month: string): any[] {
    const employees = db.find('employees', e => e.company_id === company_id && e.status === 'ACTIVE');
    const result: any[] = [];

    for (const emp of employees) {
      const prof = this.getEmployeeProfile(emp.id, month);
      result.push({
        employee: { id: emp.id, full_name: emp.full_name, position: emp.position },
        employee_id: emp.id,
        employee_name: emp.full_name,
        position: emp.position,
        month,
        salary: prof.salary,                       // null = not calculated for the month yet
        daily_limit: { daily_limit: prof.limits.daily_limit },
        total_expenses: prof.expenses_summary.total_month_expenses,
        employee_expenses: prof.expenses_summary.total_month_expenses,
        remaining_salary: prof.expenses_summary.remaining_salary
      });
    }

    return result;
  }

  /**
   * Excel / CSV Export Generator:
   * Rule 19:
   * Date, Category, Amount, Payment method, Employee, Allocated amount, Comment, Created by, Status
   */
  public static exportToCSV(filters: ExpenseFilterOptions): string {
    const { expenses } = this.getExpenses(filters);

    // CSV Headers
    const headers = [
      'Sana',
      'Toifa',
      'Jami Summa (UZS)',
      'To\'lov Turi',
      'Xodim',
      'Taqsimlangan Summa (UZS)',
      'Izoh / Sabab',
      'Yaratgan Foydalanuvchi',
      'Holat'
    ];

    const rows: string[][] = [headers];

    for (const exp of expenses) {
      if (exp.allocations && exp.allocations.length > 0) {
        // One row per allocation with proper attribution
        for (const a of exp.allocations) {
          rows.push([
            exp.date,
            `"${(exp.category_name || '').replace(/"/g, '""')}"`,
            String(exp.amount),
            exp.payment_method,
            `"${(a.employee_name || '').replace(/"/g, '""')}"`,
            String(a.allocated_amount),
            `"${(exp.comment || '').replace(/"/g, '""')}"`,
            `"${(exp.creator_name || '').replace(/"/g, '""')}"`,
            exp.status
          ]);
        }
      } else {
        rows.push([
          exp.date,
          `"${(exp.category_name || '').replace(/"/g, '""')}"`,
          String(exp.amount),
          exp.payment_method,
          'Kompaniya Xarajati (Umumiy)',
          '0',
          `"${(exp.comment || '').replace(/"/g, '""')}"`,
          `"${(exp.creator_name || '').replace(/"/g, '""')}"`,
          exp.status
        ]);
      }
    }

    // Prepend UTF-8 BOM for Microsoft Excel compatibility
    return '\uFEFF' + rows.map(r => r.join(',')).join('\r\n');
  }

  /** Expenses as a formatted .xlsx: one row per expense (allocations to staff listed), totals, and a per-category summary. */
  public static exportSheets(filters: ExpenseFilterOptions, periodLabel: string): XlsxSheet[] {
    const { expenses } = this.getExpenses(filters);
    const company = db.findById('companies', filters.company_id);
    const methodLabel: Record<string, string> = { CASH: 'Naqd', TERMINAL: 'Terminal', CLICK: 'Click', BANK_TRANSFER: 'Bank', OTHER: 'Boshqa' };
    const statusLabel: Record<string, string> = { CONFIRMED: 'Tasdiqlangan', DRAFT: 'Qoralama', CANCELLED: 'Bekor qilingan' };
    // Cancelled expenses would inflate the totals; they are exported only when that status is asked for.
    const sorted = [...expenses]
      .filter((e: any) => String(filters.status || '').split(',').includes('CANCELLED') || e.status !== 'CANCELLED')
      .sort((a: any, b: any) => String(a.date).localeCompare(String(b.date)));
    const subtitle = [company?.name || '', `Davr: ${periodLabel}${String(filters.status || '').split(',').includes('CANCELLED') ? '' : ' · bekor qilinganlar kiritilmagan'}`, `Tayyorlandi: ${new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Tashkent' })}`].filter(Boolean);
    const byCategory = new Map<string, { amount: number; count: number }>();
    for (const e of sorted as any[]) {
      const c = byCategory.get(e.category_name || 'Boshqa') || { amount: 0, count: 0 };
      c.amount += Number(e.amount) || 0; c.count++;
      byCategory.set(e.category_name || 'Boshqa', c);
    }
    const total = [...byCategory.values()].reduce((s, c) => s + c.amount, 0);
    return [
      {
        name: 'Xarajatlar',
        title: 'Xarajatlar hisoboti',
        subtitle,
        columns: [
          { header: 'Sana', key: 'date', type: 'date', width: 11 },
          { header: 'Toifa', key: 'category', width: 22 },
          { header: 'Summa', key: 'amount', type: 'money', total: true },
          { header: 'To\u2018lov turi', key: 'method', width: 11 },
          { header: 'Xodimga taqsimlangan', key: 'allocations', width: 30 },
          { header: 'Izoh / sabab', key: 'comment', width: 36 },
          { header: 'Kiritgan', key: 'creator', width: 18 },
          { header: 'Holat', key: 'status', width: 13 }
        ],
        rows: sorted.map((e: any) => ({
          date: e.date,
          category: e.category_name || '',
          amount: Number(e.amount) || 0,
          method: methodLabel[e.payment_method] || e.payment_method || '',
          allocations: (e.allocations || []).map((a: any) => `${a.employee_name}: ${Number(a.allocated_amount || 0).toLocaleString('ru-RU')}`).join('; ') || 'Kompaniya (umumiy)',
          comment: e.comment || '',
          creator: e.creator_name || '',
          status: statusLabel[e.status] || e.status || ''
        })),
        totalsLabel: 'JAMI'
      },
      {
        name: 'Toifalar bo\u2018yicha',
        title: 'Xarajatlar toifalar bo\u2018yicha',
        subtitle: subtitle.slice(0, 2),
        columns: [
          { header: 'Toifa', key: 'category', width: 28 },
          { header: 'Soni', key: 'count', type: 'number', total: true, width: 8 },
          { header: 'Summa', key: 'amount', type: 'money', total: true },
          { header: 'Ulushi', key: 'share', type: 'percent', width: 9 }
        ],
        rows: [...byCategory].sort((a, b) => b[1].amount - a[1].amount).map(([category, c]) => ({ category, count: c.count, amount: c.amount, share: total ? c.amount / total : 0 })),
        totalsLabel: 'JAMI'
      }
    ];
  }
}
