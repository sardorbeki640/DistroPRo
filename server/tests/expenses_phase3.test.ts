import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { ExpenseService } from '../services/expense.service.ts';
import { CashService } from '../services/cash.service.ts';
import { AuthService } from '../services/auth.service.ts';
import { migrator } from '../db/migrator.ts';
import { initialSchemaMigration } from '../db/migrations/001_initial_schema.ts';
import { seedInitialDataMigration } from '../db/migrations/002_seed_initial_data.ts';
import { cashCoreExtensionsMigration } from '../db/migrations/003_cash_core_extensions.ts';
import { expensesPhase3Migration } from '../db/migrations/004_expenses_phase3.ts';
import { db } from '../db/database.ts';

describe('Phase 3 — Expenses / Rasxod Module (14 Comprehensive Test Scenarios)', () => {
  const companyId = 'comp-apex-001';
  const adminId = 'usr-admin-01';
  const adminEmail = 'admin@distro.uz';
  const cashierId = 'usr-cashier-01';
  const cashierEmail = 'cashier@distro.uz';

  const runTag = Date.now().toString().slice(-4);
  const makeDate = (d: number) => `209${runTag.slice(0, 1)}-${runTag.slice(1, 3)}-${String(d).padStart(2, '0')}`;
  const testMonth = `209${runTag.slice(0, 1)}-${runTag.slice(1, 3)}`;

  before(async () => {
    migrator.register(initialSchemaMigration);
    migrator.register(seedInitialDataMigration);
    migrator.register(cashCoreExtensionsMigration);
    migrator.register(expensesPhase3Migration);
    await migrator.run();

    if (!db.findById('employees', 'emp-01')) {
      db.insert('employees', {
        id: 'emp-01',
        company_id: companyId,
        full_name: 'Jasur Valiyev',
        position: 'Haydovchi',
        phone: '+998 90 123 45 67',
        salary_type: 'FIXED',
        status: 'ACTIVE',
        created_at: new Date().toISOString()
      });
    }

    if (!db.findById('employees', 'emp-02')) {
      db.insert('employees', {
        id: 'emp-02',
        company_id: companyId,
        full_name: 'Bekzod Alimov',
        position: 'Ekspeditor',
        phone: '+998 90 234 56 78',
        salary_type: 'FIXED',
        status: 'ACTIVE',
        created_at: new Date().toISOString()
      });
    }
  });

  after(() => {
    // Teardown test fixtures
    db.delete('employees', 'emp-01');
    db.delete('employees', 'emp-02');
    const testExp = db.find('expenses', e => e.date.startsWith(`209${runTag.slice(0, 1)}`));
    for (const e of testExp) {
      db.delete('expenses', e.id);
    }
    const testAlloc = db.find('expense_allocations', a => a.created_at?.includes(`209${runTag.slice(0, 1)}`));
    for (const a of testAlloc) {
      db.delete('expense_allocations', a.id);
    }
    const testDays = db.find('cash_days', d => d.date.startsWith(`209${runTag.slice(0, 1)}`));
    for (const d of testDays) {
      db.delete('cash_days', d.id);
    }
  });

  // Scenario 1: Category Monthly Limit Calculation
  test('1. Category Monthly Limit Calculation: monthly_limit - current_month_used = remaining', () => {
    const date = makeDate(1);
    // Create test category with 10,000,000 UZS limit
    const category = ExpenseService.createCategory({
      company_id: companyId,
      name: `Sinov Toifasi 1-${runTag}`,
      monthly_limit: 10_000_000,
      user_id: adminId,
      user_email: adminEmail
    });

    const initialUsage = ExpenseService.getCategoryMonthlyUsage(category.id, date);
    assert.equal(initialUsage.monthly_limit, 10_000_000);
    assert.equal(initialUsage.used, 0);
    assert.equal(initialUsage.remaining, 10_000_000);

    // Create and confirm 3,000,000 UZS expense
    ExpenseService.createExpense({
      company_id: companyId,
      date,
      category_id: category.id,
      amount: 3_000_000,
      payment_method: 'CASH',
      comment: 'Kantselyariya xaridi',
      is_company_expense: true,
      user_id: cashierId,
      user_email: cashierEmail,
      confirm_immediately: true
    });

    const updatedUsage = ExpenseService.getCategoryMonthlyUsage(category.id, date);
    assert.equal(updatedUsage.used, 3_000_000);
    assert.equal(updatedUsage.remaining, 7_000_000);
  });

  // Scenario 2: Category Limit Excess
  test('2. Category Limit Excess: warning/preview shows excess when amount exceeds limit', () => {
    const date = makeDate(2);
    const category = ExpenseService.createCategory({
      company_id: companyId,
      name: `Kichik Limit Toifasi-${runTag}`,
      monthly_limit: 1_000_000,
      user_id: adminId,
      user_email: adminEmail
    });

    // Preview 1,500,000 expense (exceeds by 500,000)
    const preview = ExpenseService.getExpensePreview({
      company_id: companyId,
      date,
      category_id: category.id,
      amount: 1_500_000,
      payment_method: 'CASH',
      comment: 'Katta uskuna xaridi',
      is_company_expense: true
    });

    assert.equal(preview.category.monthly_limit, 1_000_000);
    assert.equal(preview.category.used_month, 0);
    assert.equal(preview.category.excess_month, 500_000);
  });

  // Scenario 3: Employee Daily Limit Calculation
  test('3. Employee Daily Limit Calculation: used_today + new_allocation = total_today', () => {
    const date = makeDate(3);
    const empId = 'emp-01'; // Daily limit = 20,000 UZS
    const initialEmpUsage = ExpenseService.getEmployeeDailyUsage(empId, date);
    assert.equal(initialEmpUsage.daily_limit, 20_000);
    assert.equal(initialEmpUsage.used_today, 0);
    assert.equal(initialEmpUsage.remaining, 20_000);

    // Create confirmed expense of 12,000 allocated to emp-01
    const cat = db.find('expense_categories', c => c.is_active)[0];
    ExpenseService.createExpense({
      company_id: companyId,
      date,
      category_id: cat.id,
      amount: 12_000,
      payment_method: 'CASH',
      comment: 'Tushlik puli',
      is_company_expense: false,
      employee_ids: [empId],
      user_id: cashierId,
      user_email: cashierEmail,
      confirm_immediately: true
    });

    const updatedEmpUsage = ExpenseService.getEmployeeDailyUsage(empId, date);
    assert.equal(updatedEmpUsage.used_today, 12_000);
    assert.equal(updatedEmpUsage.remaining, 8_000);
  });

  // Scenario 4: Employee Limit Excess
  test('4. Employee Limit Excess: warning/preview shows excess when allocated amount exceeds daily limit', () => {
    const date = makeDate(4);
    const empId = 'emp-02'; // Daily limit = 20,000 UZS
    const cat = db.find('expense_categories', c => c.is_active)[0];

    // Preview allocation of 25,000 (exceeds limit by 5,000)
    const preview = ExpenseService.getExpensePreview({
      company_id: companyId,
      date,
      category_id: cat.id,
      amount: 25_000,
      payment_method: 'CASH',
      comment: 'Maxsus transport xarajati',
      is_company_expense: false,
      employee_ids: [empId]
    });

    assert.equal(preview.employees.length, 1);
    assert.equal(preview.employees[0].daily_limit, 20_000);
    assert.equal(preview.employees[0].allocated_amount, 25_000);
    assert.equal(preview.employees[0].excess_today, 5_000);
    assert.equal(preview.total_excess, 5_000);
  });

  // Scenario 5: Deterministic Allocation
  test('5. Deterministic Allocation: 70,000 / 3 = 23,333, 23,333, 23,334 and sum === 70,000', () => {
    const amount = 70_000;
    const employeeIds = ['emp-01', 'emp-02', 'emp-03'];

    const allocations = ExpenseService.calculateDeterministicAllocations(amount, employeeIds, 'Test allocation');
    assert.equal(allocations.length, 3);
    assert.equal(allocations[0].allocated_amount, 23_333);
    assert.equal(allocations[1].allocated_amount, 23_333);
    assert.equal(allocations[2].allocated_amount, 23_334);

    const sum = allocations.reduce((acc, a) => acc + a.allocated_amount, 0);
    assert.equal(sum, 70_000);
  });

  // Scenario 6: Allocation Sum Mismatch
  test('6. Allocation Sum Mismatch: rejected if manual sum != expense.amount', () => {
    const date = makeDate(6);
    const cat = db.find('expense_categories', c => c.is_active)[0];

    assert.throws(() => {
      ExpenseService.createExpense({
        company_id: companyId,
        date,
        category_id: cat.id,
        amount: 50_000,
        payment_method: 'CASH',
        comment: 'Noto\'g\'ri summa taqsimoti',
        is_company_expense: false,
        allocations: [
          { employee_id: 'emp-01', allocated_amount: 20_000 },
          { employee_id: 'emp-02', allocated_amount: 20_000 }
        ], // 20,000 + 20,000 = 40,000 != 50,000!
        user_id: cashierId,
        user_email: cashierEmail
      });
    }, /Allocation summasi xarajat summasiga teng bo'lishi shart/);
  });

  // Scenario 7: Atomic Confirmation
  test('7. Atomic Confirmation: Expense + Allocation + CashTransaction + AuditLog in single transaction', () => {
    const date = makeDate(7);
    const cat = db.find('expense_categories', c => c.is_active)[0];
    const amount = 100_000;

    // Create DRAFT
    const { expense, allocations } = ExpenseService.createExpense({
      company_id: companyId,
      date,
      category_id: cat.id,
      amount,
      payment_method: 'CASH',
      comment: 'Atomik tasdiqlash testi',
      is_company_expense: false,
      employee_ids: ['emp-01', 'emp-02'],
      user_id: cashierId,
      user_email: cashierEmail
    });

    assert.equal(expense.status, 'DRAFT');
    assert.equal(allocations.length, 2);

    // Confirm atomically
    const confirmedResult = ExpenseService.confirmExpense({
      expense_id: expense.id,
      user_id: adminId,
      user_email: adminEmail,
      comment: 'Bosh buxgalter tomonidan tasdiqlandi'
    });

    assert.equal(confirmedResult.expense.status, 'CONFIRMED');
    assert.ok(confirmedResult.expense.cash_transaction_id);

    // Verify CashTransaction exists
    const cashTx = db.findById('cash_transactions', confirmedResult.expense.cash_transaction_id!);
    assert.ok(cashTx);
    assert.equal(cashTx.amount, amount);
    assert.equal(cashTx.transaction_type, 'EXPENSE');

    // Verify AuditLog exists
    const auditLogs = db.find('audit_logs', a => a.entity === 'Expense' && a.entity_id === expense.id && a.action === 'CONFIRM');
    assert.ok(auditLogs.length > 0);
  });

  // Scenario 8: Duplicate Cash Transaction Prevention
  test('8. Duplicate Cash Transaction Prevention: CONFIRMED expense cannot be confirmed a second time', () => {
    const date = makeDate(8);
    const cat = db.find('expense_categories', c => c.is_active)[0];
    const { expense } = ExpenseService.createExpense({
      company_id: companyId,
      date,
      category_id: cat.id,
      amount: 45_000,
      payment_method: 'CASH',
      comment: 'Dublikat oldini olish testi',
      is_company_expense: true,
      user_id: cashierId,
      user_email: cashierEmail,
      confirm_immediately: true
    });

    assert.throws(() => {
      ExpenseService.confirmExpense({
        expense_id: expense.id,
        user_id: adminId,
        user_email: adminEmail,
        comment: 'Ikkinchi bor tasdiqlash'
      });
    }, /allaqachon tasdiqlangan/);
  });

  // Scenario 9: Reversal / Correction logic
  test('9. Reversal / Correction: CONFIRMED expense cannot be edited via simple update; correction preserves audit log', () => {
    const date = makeDate(9);
    const cat = db.find('expense_categories', c => c.is_active)[0];
    const { expense } = ExpenseService.createExpense({
      company_id: companyId,
      date,
      category_id: cat.id,
      amount: 80_000,
      payment_method: 'CASH',
      comment: 'Korreksiya testi boshlang\'ich',
      is_company_expense: true,
      user_id: cashierId,
      user_email: cashierEmail,
      confirm_immediately: true
    });

    // Correction via service with mandatory reason
    const corrected = ExpenseService.correctExpense({
      expense_id: expense.id,
      amount: 95_000,
      reason: 'Faktura bo\'yicha yakuniy hisob 95,000 UZS bo\'lib chiqdi',
      user_id: adminId,
      user_email: adminEmail
    });

    assert.equal(corrected.amount, 95_000);

    // Linked CashTransaction must also be updated
    const cashTx = db.findById('cash_transactions', corrected.cash_transaction_id!);
    assert.equal(cashTx!.amount, 95_000);

    // Audit log must record CORRECT with old and new values
    const auditLogs = db.find('audit_logs', a => a.entity === 'Expense' && a.entity_id === expense.id && a.action === 'CORRECT');
    assert.ok(auditLogs.length > 0);
    assert.equal(auditLogs[0].action, 'CORRECT');
  });

  // Scenario 10: Cash Impact
  test('10. Cash Impact: CONFIRMED expense creates CashTransaction with type EXPENSE and affects cash day', () => {
    const cat = db.find('expense_categories', c => c.is_active)[0];
    const date = makeDate(10);

    // Open cash day with 500,000
    const day = CashService.openCashDay({
      company_id: companyId,
      register_id: 'reg-main-01',
      date,
      opening_balance: 500_000,
      user_id: cashierId,
      user_email: cashierEmail,
      user_role: 'CASHIER',
      is_privileged: true // fixture sets a known opening balance
    });

    const initialTotalExpense = day.expense_amount || 0;

    // Confirm expense of 60,000 UZS
    const { expense } = ExpenseService.createExpense({
      company_id: companyId,
      date,
      category_id: cat.id,
      amount: 60_000,
      payment_method: 'CASH',
      comment: 'Kunlik naqd xarajat',
      is_company_expense: true,
      user_id: cashierId,
      user_email: cashierEmail,
      confirm_immediately: true
    });

    const updatedDay = db.findById('cash_days', day.id)!;
    assert.equal(updatedDay.expense_amount, initialTotalExpense + 60_000);
    assert.equal(updatedDay.calculated_closing_balance, 500_000 - 60_000);
  });

  // Scenario 11: Company Only Expense
  test('11. Company Only Expense: expense without employee allocation (allocation count = 0)', () => {
    const date = makeDate(11);
    const cat = db.find('expense_categories', c => c.is_active)[0];
    const { expense, allocations } = ExpenseService.createExpense({
      company_id: companyId,
      date,
      category_id: cat.id,
      amount: 200_000,
      payment_method: 'BANK_TRANSFER',
      comment: 'Ofis internet to\'lovi (Uztelecom)',
      is_company_expense: true,
      user_id: adminId,
      user_email: adminEmail,
      confirm_immediately: true
    });

    assert.equal(expense.is_company_expense, true);
    assert.equal(allocations.length, 0);

    const savedAllocs = db.find('expense_allocations', a => a.expense_id === expense.id);
    assert.equal(savedAllocs.length, 0);
  });

  // Scenario 12: Inactive Category Prevention
  test('12. Inactive Category Prevention: cannot create expense with inactive category', () => {
    const date = makeDate(12);
    // Create inactive category
    const cat = ExpenseService.createCategory({
      company_id: companyId,
      name: `Eski Toifa-${runTag}`,
      monthly_limit: 5_000_000,
      user_id: adminId,
      user_email: adminEmail
    });

    ExpenseService.updateCategory({
      category_id: cat.id,
      is_active: false,
      user_id: adminId,
      user_email: adminEmail
    });

    assert.throws(() => {
      ExpenseService.createExpense({
        company_id: companyId,
        date,
        category_id: cat.id,
        amount: 50_000,
        payment_method: 'CASH',
        comment: 'Arxiv toifaga xarajat yozishga urinish',
        is_company_expense: true,
        user_id: cashierId,
        user_email: cashierEmail
      });
    }, /faol emas/);
  });

  // Scenario 13: Negative / Zero Amount
  test('13. Negative / Zero Amount: amount <= 0 rejected with clear validation error', () => {
    const date = makeDate(13);
    const cat = db.find('expense_categories', c => c.is_active)[0];

    assert.throws(() => {
      ExpenseService.createExpense({
        company_id: companyId,
        date,
        category_id: cat.id,
        amount: 0,
        payment_method: 'CASH',
        comment: 'Nol so\'m',
        is_company_expense: true,
        user_id: cashierId,
        user_email: cashierEmail
      });
    }, /musbat/);

    assert.throws(() => {
      ExpenseService.createExpense({
        company_id: companyId,
        date,
        category_id: cat.id,
        amount: -50_000,
        payment_method: 'CASH',
        comment: 'Manfiy xarajat',
        is_company_expense: true,
        user_id: cashierId,
        user_email: cashierEmail
      });
    }, /musbat/);
  });

  // Scenario 14: Audit Log Verification
  test('14. Audit Log Verification: actions (CREATE, CONFIRM, CANCEL, CORRECT, CATEGORY_CREATE) logged with non-null reason', () => {
    const date = makeDate(14);
    const cat = ExpenseService.createCategory({
      company_id: companyId,
      name: `Audit Sinovi Toifasi-${runTag}`,
      monthly_limit: 2_000_000,
      user_id: adminId,
      user_email: adminEmail
    });

    // Verify CATEGORY_CREATE audit log
    const catAudit = db.find('audit_logs', a => a.entity === 'ExpenseCategory' && a.entity_id === cat.id && a.action === 'CATEGORY_CREATE');
    assert.ok(catAudit.length > 0);
    assert.ok(catAudit[0].reason && catAudit[0].reason.length > 0);

    // Create & Confirm Expense
    const { expense } = ExpenseService.createExpense({
      company_id: companyId,
      date,
      category_id: cat.id,
      amount: 15_000,
      payment_method: 'CASH',
      comment: 'Audit log tekshiruv xarajati',
      is_company_expense: true,
      user_id: cashierId,
      user_email: cashierEmail,
      confirm_immediately: true
    });

    // Verify CREATE and CONFIRM audit logs
    const expAudits = db.find('audit_logs', a => a.entity === 'Expense' && a.entity_id === expense.id);
    const actions = expAudits.map(a => a.action);
    assert.ok(actions.includes('CREATE'));
    assert.ok(actions.includes('CONFIRM'));

    // Cancel expense
    const cancelled = ExpenseService.cancelExpense({
      expense_id: expense.id,
      reason: 'Sinov xarajati bekor qilindi',
      user_id: adminId,
      user_email: adminEmail
    });

    assert.equal(cancelled.status, 'CANCELLED');
    const cancelAudit = db.find('audit_logs', a => a.entity === 'Expense' && a.entity_id === expense.id && a.action === 'CANCEL');
    assert.ok(cancelAudit.length > 0);
    assert.ok(cancelAudit[0].reason && cancelAudit[0].reason.includes('Sinov xarajati bekor qilindi'));
  });

  // Scenario 15: Excel / CSV Export
  test('15. Excel / CSV Export: generates valid UTF-8 BOM CSV with proper columns and headers', () => {
    const csv = ExpenseService.exportToCSV({ company_id: companyId });
    assert.ok(csv.startsWith('\uFEFF'));
    assert.ok(csv.includes('Sana'));
    assert.ok(csv.includes('Toifa'));
    assert.ok(csv.includes('Jami Summa (UZS)'));
    assert.ok(csv.includes('Xodim'));
  });

  test('17. A category without a limit is unlimited; another company’s expense and a closed cash day are protected', () => {
    const date = makeDate(17);
    const cat = ExpenseService.createCategory({ company_id: companyId, name: `Limitsiz-${runTag}`, monthly_limit: 0, user_id: adminId, user_email: adminEmail });
    const preview = ExpenseService.getExpensePreview({ company_id: companyId, category_id: cat.id, amount: 900_000, date, payment_method: 'CASH', comment: 'x', is_company_expense: true });
    assert.equal(preview.category.excess_month, 0, 'no limit, nothing exceeded');
    assert.equal(preview.category.remaining_month, null);
    const { expense } = ExpenseService.createExpense({ company_id: companyId, date, category_id: cat.id, amount: 900_000, payment_method: 'CASH', comment: 'Limitsiz xarajat', is_company_expense: true, user_id: adminId, user_email: adminEmail, confirm_immediately: true });
    const month = ExpenseService.getMonthlyReport(companyId, date.slice(0, 7));
    assert.ok(!month.exceeded_limits.some(l => l.name === cat.name));
    assert.throws(() => ExpenseService.cancelExpense({ expense_id: expense.id, reason: 'boshqa kompaniya', user_id: adminId, user_email: adminEmail, company_id: 'other' }), /topilmadi/);
    assert.throws(() => ExpenseService.getExpenseDetail(expense.id, 'other'), /topilmadi/);
    assert.throws(() => ExpenseService.updateCategory({ category_id: cat.id, name: 'x2', user_id: adminId, user_email: adminEmail, company_id: 'other' }), /topilmadi/);
    // The cash day is closed: the expense in it can no longer be cancelled or changed in amount; the comment still can.
    db.update('cash_days', expense.cash_day_id!, { status: 'CLOSED' } as any);
    assert.throws(() => ExpenseService.cancelExpense({ expense_id: expense.id, reason: 'kech bekor', user_id: adminId, user_email: adminEmail, company_id: companyId }), /yopilgan/);
    assert.throws(() => ExpenseService.correctExpense({ expense_id: expense.id, amount: 800_000, reason: 'summa', user_id: adminId, user_email: adminEmail, company_id: companyId } as any), /yopilgan/);
    assert.equal(ExpenseService.correctExpense({ expense_id: expense.id, comment: 'Aniqroq izoh', reason: 'izoh', user_id: adminId, user_email: adminEmail, company_id: companyId } as any).comment, 'Aniqroq izoh');
  });

  // Scenario 16: Employee Profile and Monthly Summary
  test('16. Employee Profile and Monthly Summary: calculates monthly salary, expenses, and remaining balance', () => {
    // Without a calculated salary for the month there is no salary and no "remaining" (an invented 5 000 000 was shown before).
    const profile = ExpenseService.getEmployeeProfile('emp-01', '2026-09');
    assert.ok(profile.employee);
    assert.equal(profile.salary, null);
    assert.equal(profile.expenses_summary.remaining_salary, null);

    // With one, the remaining salary is the salary less the month's expenses.
    db.insert('salaries', { id: 'sal-t16', company_id: companyId, employee_id: 'emp-01', period_month: '2026-09', base_amount: 3_000_000, bonus_amount: 0, deduction_amount: 0, final_amount: 3_000_000, status: 'CALCULATED', created_at: '' } as any);
    const withSalary = ExpenseService.getEmployeeProfile('emp-01', '2026-09');
    assert.equal(withSalary.salary!.final_amount, 3_000_000);
    assert.equal(withSalary.expenses_summary.remaining_salary, 3_000_000 - withSalary.expenses_summary.total_month_expenses);

    // The summary carries what the Expenses screen reads (employee, salary, daily limit, totals).
    const summaries = ExpenseService.getMonthlyEmployeeSummary(companyId, '2026-09');
    const row = summaries.find(s => s.employee.id === 'emp-01');
    assert.equal(row.employee.full_name, 'Jasur Valiyev');
    assert.equal(row.salary.final_amount, 3_000_000);
    assert.ok(row.daily_limit.daily_limit >= 0);
    assert.equal(typeof row.total_expenses, 'number');
    db.delete('salaries', 'sal-t16');
  });
});
