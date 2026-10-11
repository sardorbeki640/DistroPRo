import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { CashService } from '../services/cash.service.ts';
import { CustomerBalanceService } from '../services/customer_balance.service.ts';
import { AuthService } from '../services/auth.service.ts';
import { migrator } from '../db/migrator.ts';
import { initialSchemaMigration } from '../db/migrations/001_initial_schema.ts';
import { seedInitialDataMigration } from '../db/migrations/002_seed_initial_data.ts';
import { cashCoreExtensionsMigration } from '../db/migrations/003_cash_core_extensions.ts';
import { db } from '../db/database.ts';

describe('Phase 2 — Cash Register Core (21 Mandated Business Tests)', () => {
  const companyId = 'comp-apex-001';
  const registerId = 'reg-main-01';
  const cashierId = 'usr-cashier-01';
  const cashierEmail = 'cashier@distro.uz';
  const adminId = 'usr-admin-01';
  const adminEmail = 'admin@distro.uz';
  const customerId = 'cust-01'; // 'Sharq Savdo MCHJ'
  const agentId = 'agent-01'; // 'Jasur Valiyev'

  const runTag = Date.now().toString().slice(-4);
  const makeDate = (n: number) => `209${runTag.slice(0, 1)}-${runTag.slice(1, 3)}-${String(n).padStart(2, '0')}`;

  before(async () => {
    migrator.register(initialSchemaMigration);
    migrator.register(seedInitialDataMigration);
    migrator.register(cashCoreExtensionsMigration);
    await migrator.run();

    if (!db.findById('customers', customerId)) {
      db.insert('customers', {
        id: customerId,
        company_id: companyId,
        code: 'TEST-CUST-01',
        name: 'Sharq Savdo MCHJ (Test)',
        phone: '+998 90 111 22 33',
        current_balance: 0,
        credit_limit: 10_000_000,
        credit_limit_enabled: true,
        status: 'ACTIVE',
        is_active: true,
        created_at: new Date().toISOString()
      });
    }

    if (!db.findById('agents', agentId)) {
      db.insert('agents', {
        id: agentId,
        company_id: companyId,
        code: 'AG-01',
        full_name: 'Jasur Valiyev (Test Agent)',
        phone: '+998 90 222 33 44',
        commission_rate: 2.5,
        status: 'ACTIVE',
        created_at: new Date().toISOString()
      });
    }
  });

  after(() => {
    // Teardown test fixtures so database remains pristine
    db.delete('customers', customerId);
    db.delete('agents', agentId);
    const testDays = db.find('cash_days', d => d.date.startsWith(`209${runTag.slice(0, 1)}`));
    for (const d of testDays) {
      db.delete('cash_days', d.id);
    }
    const testTxs = db.find('cash_transactions', t => t.created_at?.includes(`209${runTag.slice(0, 1)}`) || t.description?.includes(runTag));
    for (const t of testTxs) {
      db.delete('cash_transactions', t.id);
    }
  });

  // 1. One cash day per date
  test('1. One cash day per date: allows creating one CashDay for a date', () => {
    const date = makeDate(1);
    const day = CashService.openCashDay({
      company_id: companyId,
      register_id: registerId,
      date,
      opening_balance: 1_000_000,
      user_id: cashierId,
      user_email: cashierEmail,
      user_role: 'ADMIN' // fixture sets a known opening balance
    });
    assert.equal(day.date, date);
    assert.equal(day.status, 'OPEN');
  });

  // 2. Open cash
  test('2. Open cash: successfully opens cash day with auto opening balance', () => {
    const date = makeDate(2);
    const day = CashService.openCashDay({
      company_id: companyId,
      register_id: registerId,
      date,
      user_id: cashierId,
      user_email: cashierEmail,
      user_role: 'CASHIER'
    });
    assert.equal(day.status, 'OPEN');
    assert.ok(day.id.includes(date));
    assert.equal(day.difference, 0);
  });

  // 3. Cannot create duplicate cash day
  test('3. Cannot create duplicate cash day: rejects second CashDay on same date', () => {
    const date = makeDate(3);
    // First creation
    CashService.openCashDay({
      company_id: companyId,
      register_id: registerId,
      date,
      opening_balance: 500_000,
      user_id: cashierId,
      user_email: cashierEmail,
      user_role: 'ADMIN' // fixture sets a known opening balance
    });

    // Close it
    const day = db.findOne('cash_days', cd => cd.company_id === companyId && cd.date === date)!;
    CashService.closeCashDay({
      cash_day_id: day.id,
      actual_cash: 500_000,
      reason: 'Regular closing',
      user_id: cashierId,
      user_email: cashierEmail
    });

    // Attempt duplicate creation on same date -> MUST THROW
    assert.throws(
      () => {
        CashService.openCashDay({
          company_id: companyId,
          register_id: registerId,
          date,
          opening_balance: 700_000,
          user_id: cashierId,
          user_email: cashierEmail,
          user_role: 'ADMIN' // fixture sets a known opening balance
        });
      },
      /allaqachon mavjud va yopilgan/
    );
  });

  // 4. Sale payment calculation
  test('4. Sale payment calculation: splits cash, terminal, and click correctly and validates limit', () => {
    const date = makeDate(4);
    const day = CashService.openCashDay({
      company_id: companyId,
      register_id: registerId,
      date,
      opening_balance: 0,
      user_id: cashierId,
      user_email: cashierEmail,
      user_role: 'ADMIN' // fixture sets a known opening balance
    });

    const result = CashService.createDailyOrder({
      company_id: companyId,
      cash_day_id: day.id,
      order_number: `ORD-TEST-${runTag}-004`,
      order_date: date,
      customer_id: customerId,
      agent_id: agentId,
      sale_amount: 1_000_000,
      cash_payment: 300_000,
      terminal_payment: 200_000,
      click_payment: 100_000,
      credit_amount: 400_000,
      note: 'Normal payment split',
      user_id: cashierId,
      user_email: cashierEmail
    });

    assert.equal(result.remaining_amount, 0);
    assert.equal(result.transactions.length, 4);

    // Overpayment check (cash + terminal + click + credit > sale_amount MUST FAIL)
    assert.throws(
      () => {
        CashService.createDailyOrder({
          company_id: companyId,
          cash_day_id: day.id,
          order_number: `ORD-INVALID-${runTag}-004`,
          order_date: date,
          customer_id: customerId,
          sale_amount: 1_000_000,
          cash_payment: 600_000,
          terminal_payment: 300_000,
          click_payment: 200_000, // Total 1.1M > 1.0M
          credit_amount: 0,
          user_id: cashierId,
          user_email: cashierEmail
        });
      },
      /To'lov summasi noto'g'ri/
    );
  });

  // 5. Credit calculation
  test('5. Credit calculation: credit portion directly updates customer debt balance', () => {
    const date = makeDate(5);
    const day = CashService.openCashDay({
      company_id: companyId,
      register_id: registerId,
      date,
      opening_balance: 0,
      user_id: cashierId,
      user_email: cashierEmail,
      user_role: 'ADMIN' // fixture sets a known opening balance
    });

    const customerBefore = db.findById('customers', customerId)!;
    const initialDebt = customerBefore.current_balance;

    CashService.createDailyOrder({
      company_id: companyId,
      cash_day_id: day.id,
      order_number: `ORD-CREDIT-${runTag}-005`,
      order_date: date,
      customer_id: customerId,
      sale_amount: 1_000_000,
      cash_payment: 600_000,
      terminal_payment: 0,
      click_payment: 0,
      credit_amount: 400_000,
      user_id: cashierId,
      user_email: cashierEmail
    });

    const customerAfter = db.findById('customers', customerId)!;
    assert.equal(customerAfter.current_balance, initialDebt + 400_000);
  });

  // 6. Credit collection
  test('6. Credit collection: paying previous debt reduces customer balance and records cash inflow', () => {
    const date = makeDate(6);
    const day = CashService.openCashDay({
      company_id: companyId,
      register_id: registerId,
      date,
      opening_balance: 0,
      user_id: cashierId,
      user_email: cashierEmail,
      user_role: 'ADMIN' // fixture sets a known opening balance
    });

    const customerBefore = db.findById('customers', customerId)!;
    const debtBefore = customerBefore.current_balance;

    const collectionTx = CashService.recordCreditCollection({
      company_id: companyId,
      cash_day_id: day.id,
      customer_id: customerId,
      amount: 250_000,
      payment_method: 'CASH',
      description: 'Mijoz qarzining bir qismini to\'ladi',
      user_id: cashierId,
      user_email: cashierEmail
    });

    assert.equal(collectionTx.amount, 250_000);
    const customerAfter = db.findById('customers', customerId)!;
    assert.equal(customerAfter.current_balance, debtBefore - 250_000);

    const summary = CashService.getDaySummary(day.id);
    assert.equal(summary.credit_collection, 250_000);
  });

  // 7. Return
  test('7. Return: records product return with reason and payment impact', () => {
    const date = makeDate(7);
    const day = CashService.openCashDay({
      company_id: companyId,
      register_id: registerId,
      date,
      opening_balance: 1_000_000,
      user_id: cashierId,
      user_email: cashierEmail,
      user_role: 'ADMIN' // fixture sets a known opening balance
    });

    // 7a. Cash refund return
    const resCash = CashService.recordReturn({
      company_id: companyId,
      cash_day_id: day.id,
      customer_id: customerId,
      amount: 150_000,
      date,
      reason: 'Yaroqlilik muddati tugagan tovar',
      payment_impact: 'CASH_REFUND',
      user_id: cashierId,
      user_email: cashierEmail
    });

    assert.equal(resCash.returnRecord.amount, 150_000);
    assert.equal(resCash.transaction.payment_method, 'CASH');

    const summary = CashService.getDaySummary(day.id);
    assert.equal(summary.return_amount, 150_000);
    assert.equal(summary.calculated_cash_balance, 850_000); // 1,000,000 - 150,000

    // Missing reason must throw
    assert.throws(
      () => {
        CashService.recordReturn({
          company_id: companyId,
          cash_day_id: day.id,
          customer_id: customerId,
          amount: 50_000,
          date,
          reason: '  ',
          payment_impact: 'CASH_REFUND',
          user_id: cashierId,
          user_email: cashierEmail
        });
      },
      /sababi .* kiritilishi shart/
    );
  });

  // 8. Carried forward
  test('8. Carried forward: records carried forward transaction for a customer with comment', () => {
    const date = makeDate(8);
    const day = CashService.openCashDay({
      company_id: companyId,
      register_id: registerId,
      date,
      opening_balance: 500_000,
      user_id: cashierId,
      user_email: cashierEmail,
      user_role: 'ADMIN' // fixture sets a known opening balance
    });

    const tx = CashService.recordCarriedForward({
      company_id: companyId,
      cash_day_id: day.id,
      customer_id: customerId,
      amount: 350_000,
      source_transaction_id: `SRC-TX-${runTag}-008`,
      description: 'Do\'kon egasi joyida yo\'qligi sababli pul ertaga olinadi',
      user_id: cashierId,
      user_email: cashierEmail
    });

    assert.equal(tx.transaction_type, 'CARRIED_FORWARD');
    assert.equal(tx.amount, 350_000);
    assert.equal(tx.source_transaction_id, `SRC-TX-${runTag}-008`);
  });

  // 9. Carried forward appears next day
  test('9. Carried forward appears next day: pending amounts from previous day are surfaced', () => {
    const nextDate = makeDate(9);
    const pending = CashService.getPendingCarriedForwards(companyId, nextDate);
    assert.ok(pending.length > 0);
    const found = pending.find(p => p.customer_id === customerId && p.amount === 350_000);
    assert.ok(found, 'Carried forward from previous day must appear in next day pending list');
  });

  // 10. No duplicate carried forward
  test('10. No duplicate carried forward: prevents duplicate carry forward entry for same source and amount', () => {
    const date = makeDate(8); // same day as test 8
    const day = db.findOne('cash_days', cd => cd.company_id === companyId && cd.date === date)!;

    assert.throws(
      () => {
        CashService.recordCarriedForward({
          company_id: companyId,
          cash_day_id: day.id,
          customer_id: customerId,
          amount: 350_000,
          source_transaction_id: `SRC-TX-${runTag}-008`,
          description: 'Takroriy kiritish urinishi',
          user_id: cashierId,
          user_email: cashierEmail
        });
      },
      /allaqachon mavjud/
    );
  });

  // 11. Cash balance calculation
  test('11. Cash balance calculation: opening + cash inflows - cash outflows = calculated balance', () => {
    const date = makeDate(11);
    const day = CashService.openCashDay({
      company_id: companyId,
      register_id: registerId,
      date,
      opening_balance: 2_000_000,
      user_id: cashierId,
      user_email: cashierEmail,
      user_role: 'ADMIN' // fixture sets a known opening balance
    });

    // Cash sale inflow: +500,000
    CashService.addTransaction({
      company_id: companyId,
      cash_day_id: day.id,
      transaction_type: 'SALE_PAYMENT',
      amount: 500_000,
      payment_method: 'CASH',
      description: 'Naqd savdo',
      user_id: cashierId,
      user_email: cashierEmail
    });

    // Credit collection inflow: +200,000
    CashService.addTransaction({
      company_id: companyId,
      cash_day_id: day.id,
      transaction_type: 'CREDIT_COLLECTION',
      amount: 200_000,
      payment_method: 'CASH',
      description: 'Nasiya to\'lovi',
      user_id: cashierId,
      user_email: cashierEmail
    });

    // Expense outflow: -100,000
    CashService.addTransaction({
      company_id: companyId,
      cash_day_id: day.id,
      transaction_type: 'EXPENSE',
      amount: 100_000,
      payment_method: 'CASH',
      description: 'Ofis mayda xarajati',
      user_id: cashierId,
      user_email: cashierEmail
    });

    // Expected: 2,000,000 + 500,000 + 200,000 - 100,000 = 2,600,000
    const summary = CashService.getDaySummary(day.id);
    assert.equal(summary.calculated_cash_balance, 2_600_000);
  });

  // 12. Terminal excluded from cash balance
  test('12. Terminal excluded from cash balance: POS payments do NOT alter physical cash balance', () => {
    const date = makeDate(12);
    const day = CashService.openCashDay({
      company_id: companyId,
      register_id: registerId,
      date,
      opening_balance: 1_000_000,
      user_id: cashierId,
      user_email: cashierEmail,
      user_role: 'ADMIN' // fixture sets a known opening balance
    });

    CashService.addTransaction({
      company_id: companyId,
      cash_day_id: day.id,
      transaction_type: 'SALE_PAYMENT',
      amount: 750_000,
      payment_method: 'TERMINAL',
      description: 'Karta orqali to\'lov',
      user_id: cashierId,
      user_email: cashierEmail
    });

    const summary = CashService.getDaySummary(day.id);
    assert.equal(summary.terminal, 750_000);
    assert.equal(summary.calculated_cash_balance, 1_000_000, 'Terminal payment must NOT increase calculated physical cash balance');
  });

  // 13. Click excluded from cash balance
  test('13. Click excluded from cash balance: online payments do NOT alter physical cash balance', () => {
    const date = makeDate(13);
    const day = CashService.openCashDay({
      company_id: companyId,
      register_id: registerId,
      date,
      opening_balance: 1_000_000,
      user_id: cashierId,
      user_email: cashierEmail,
      user_role: 'ADMIN' // fixture sets a known opening balance
    });

    CashService.addTransaction({
      company_id: companyId,
      cash_day_id: day.id,
      transaction_type: 'SALE_PAYMENT',
      amount: 450_000,
      payment_method: 'CLICK',
      description: 'Click ilovasi orqali to\'lov',
      user_id: cashierId,
      user_email: cashierEmail
    });

    const summary = CashService.getDaySummary(day.id);
    assert.equal(summary.click, 450_000);
    assert.equal(summary.calculated_cash_balance, 1_000_000, 'Click payment must NOT increase calculated physical cash balance');
  });

  // 14. Closing calculation
  test('14. Closing calculation: zero difference closes smoothly', () => {
    const date = makeDate(14);
    const day = CashService.openCashDay({
      company_id: companyId,
      register_id: registerId,
      date,
      opening_balance: 1_500_000,
      user_id: cashierId,
      user_email: cashierEmail,
      user_role: 'ADMIN' // fixture sets a known opening balance
    });

    const closed = CashService.closeCashDay({
      cash_day_id: day.id,
      actual_cash: 1_500_000,
      reason: 'Sanash to\'g\'ri chiqdi',
      user_id: cashierId,
      user_email: cashierEmail
    });

    assert.equal(closed.status, 'CLOSED');
    assert.equal(closed.difference, 0);
    assert.equal(closed.actual_closing_balance, 1_500_000);
  });

  // 15. Closing difference
  test('15. Closing difference: accurately computes positive and negative discrepancy', () => {
    const date = makeDate(15);
    const day = CashService.openCashDay({
      company_id: companyId,
      register_id: registerId,
      date,
      opening_balance: 2_000_000,
      user_id: cashierId,
      user_email: cashierEmail,
      user_role: 'ADMIN' // fixture sets a known opening balance
    });

    // Actual cash is 2,050,000 (+50,000 excess)
    const closed = CashService.closeCashDay({
      cash_day_id: day.id,
      actual_cash: 2_050_000,
      reason: 'Ortiqcha 50,000 so\'m mayda qaytim sifatida topildi',
      user_id: cashierId,
      user_email: cashierEmail
    });

    assert.equal(closed.difference, 50_000);
  });

  // 16. Difference requires reason
  test('16. Difference requires reason: fails to close without explanation if difference !== 0', () => {
    const date = makeDate(16);
    const day = CashService.openCashDay({
      company_id: companyId,
      register_id: registerId,
      date,
      opening_balance: 1_000_000,
      user_id: cashierId,
      user_email: cashierEmail,
      user_role: 'ADMIN' // fixture sets a known opening balance
    });

    assert.throws(
      () => {
        CashService.closeCashDay({
          cash_day_id: day.id,
          actual_cash: 950_000, // -50,000 difference
          reason: '  ', // empty reason -> MUST THROW
          user_id: cashierId,
          user_email: cashierEmail
        });
      },
      /farq aniqlandi.*Sabab/i
    );
  });

  // 17. Closed cash cannot be edited by cashier
  test('17. Closed cash cannot be edited by cashier: throws for cashier, allows admin with correction reason', () => {
    const date = makeDate(17);
    const day = CashService.openCashDay({
      company_id: companyId,
      register_id: registerId,
      date,
      opening_balance: 1_000_000,
      user_id: cashierId,
      user_email: cashierEmail,
      user_role: 'ADMIN' // fixture sets a known opening balance
    });

    const tx = CashService.addTransaction({
      company_id: companyId,
      cash_day_id: day.id,
      transaction_type: 'SALE_PAYMENT',
      amount: 100_000,
      payment_method: 'CASH',
      description: 'Savdo',
      user_id: cashierId,
      user_email: cashierEmail
    });

    // Close the day
    CashService.closeCashDay({
      cash_day_id: day.id,
      actual_cash: 1_100_000,
      reason: 'Yakuniy sanash',
      user_id: cashierId,
      user_email: cashierEmail
    });

    // 17a. Cashier tries to add transaction to closed day -> MUST THROW
    assert.throws(
      () => {
        CashService.addTransaction({
          company_id: companyId,
          cash_day_id: day.id,
          transaction_type: 'SALE_PAYMENT',
          amount: 50_000,
          payment_method: 'CASH',
          description: 'Kechikkan savdo',
          user_id: cashierId,
          user_email: cashierEmail,
          user_role: 'CASHIER'
        });
      },
      /Yopiq kassa kuniga oddiy kassir/
    );

    // 17b. Admin performs controlled correction with reason -> SUCCEEDS
    const corrected = CashService.correctTransaction({
      transaction_id: tx.id,
      amount: 120_000,
      reason: 'Mijoz 20,000 so\'m qo\'shimcha to\'lagani chekda aniqlandi',
      user_id: adminId,
      user_email: adminEmail,
      user_role: 'ADMIN',
      has_correction_permission: true
    });

    assert.equal(corrected.amount, 120_000);
  });

  // 18. Agent filtering
  test('18. Agent filtering: returns only transactions assigned to specific agent', () => {
    const date = makeDate(18);
    const day = CashService.openCashDay({
      company_id: companyId,
      register_id: registerId,
      date,
      opening_balance: 0,
      user_id: cashierId,
      user_email: cashierEmail,
      user_role: 'ADMIN' // fixture sets a known opening balance
    });

    // Tx for agentId
    CashService.addTransaction({
      company_id: companyId,
      cash_day_id: day.id,
      transaction_type: 'SALE_PAYMENT',
      amount: 200_000,
      payment_method: 'CASH',
      agent_id: agentId,
      description: 'Agent Jasur savdosi',
      user_id: cashierId,
      user_email: cashierEmail
    });

    // Tx without agent
    CashService.addTransaction({
      company_id: companyId,
      cash_day_id: day.id,
      transaction_type: 'SALE_PAYMENT',
      amount: 300_000,
      payment_method: 'CASH',
      agent_id: null,
      description: 'To\'g\'ridan-to\'g\'ri savdo',
      user_id: cashierId,
      user_email: cashierEmail
    });

    const filtered = CashService.getFilteredTransactions(day.id, { agent_id: agentId });
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].agent_id, agentId);
  });

  // 19. Customer filtering
  test('19. Customer filtering: returns full statement of orders, payments, credits for selected customer', () => {
    const date = makeDate(19);
    const day = CashService.openCashDay({
      company_id: companyId,
      register_id: registerId,
      date,
      opening_balance: 0,
      user_id: cashierId,
      user_email: cashierEmail,
      user_role: 'ADMIN' // fixture sets a known opening balance
    });

    CashService.addTransaction({
      company_id: companyId,
      cash_day_id: day.id,
      transaction_type: 'SALE_PAYMENT',
      amount: 150_000,
      payment_method: 'CASH',
      customer_id: customerId,
      description: 'Mijoz to\'lovi',
      user_id: cashierId,
      user_email: cashierEmail
    });

    const filtered = CashService.getFilteredTransactions(day.id, { customer_id: customerId });
    assert.ok(filtered.every(t => t.customer_id === customerId));

    const history = CustomerBalanceService.getCustomerHistory(companyId, customerId);
    assert.ok(history.customer.id === customerId);
    assert.ok(Array.isArray(history.balance_transactions));
  });

  // 20. Audit log creation
  test('20. Audit log creation: every critical action generates an immutable audit log entry', () => {
    const auditLogs = db.find('audit_logs', l => l.company_id === companyId);
    assert.ok(auditLogs.length > 0);

    const hasCashDayCreate = auditLogs.some(l => l.entity === 'CashDay' && l.action === 'CREATE');
    const hasCashDayClose = auditLogs.some(l => l.entity === 'CashDay' && l.action === 'CLOSE');
    const hasTxCreate = auditLogs.some(l => l.entity === 'CashTransaction');

    assert.ok(hasCashDayCreate, 'Audit logs must record CashDay creation');
    assert.ok(hasCashDayClose, 'Audit logs must record CashDay closure');
    assert.ok(hasTxCreate, 'Audit logs must record transactions');
  });

  // 21. Permission enforcement
  test('21. Permission enforcement: verifies Cashier, Admin, SuperAdmin permission boundaries', () => {
    // CASHIER permissions
    assert.equal(AuthService.hasPermission(cashierId, 'cash', 'view'), true);
    assert.equal(AuthService.hasPermission(cashierId, 'cash', 'create'), true);
    assert.equal(AuthService.hasPermission(cashierId, 'cash', 'update'), true);
    assert.equal(AuthService.hasPermission(cashierId, 'cash', 'close'), true);
    assert.equal(AuthService.hasPermission(cashierId, 'cash', 'delete'), false); // cashier cannot delete
    assert.equal(AuthService.hasPermission(cashierId, 'cash', 'correct'), false); // cashier cannot correct closed

    // ADMIN permissions
    assert.equal(AuthService.hasPermission(adminId, 'cash', 'view'), true);
    assert.equal(AuthService.hasPermission(adminId, 'cash', 'close'), true);
    assert.equal(AuthService.hasPermission(adminId, 'cash', 'correct'), true); // admin has cash:correct

    // SUPER_ADMIN permissions
    const superAdminId = 'usr-superadmin-01';
    assert.equal(AuthService.hasPermission(superAdminId, 'cash', 'view'), true);
    assert.equal(AuthService.hasPermission(superAdminId, 'cash', 'correct'), true);
    assert.equal(AuthService.hasPermission(superAdminId, 'cash', 'delete'), true);
  });

  test('22. Cashier cannot type a different opening balance; carry-over is automatic', () => {
    const previous = makeDate(26);
    const day = CashService.openCashDay({ company_id: companyId, register_id: registerId, date: previous, opening_balance: 300_000, user_id: adminId, user_email: adminEmail, user_role: 'ADMIN' });
    CashService.closeCashDay({ cash_day_id: day.id, actual_cash: 300_000, reason: 'Yopish', user_id: cashierId, user_email: cashierEmail });
    const next = makeDate(27);
    assert.throws(() => CashService.openCashDay({ company_id: companyId, register_id: registerId, date: next, opening_balance: 0, user_id: cashierId, user_email: cashierEmail, user_role: 'CASHIER' }), /rahbar/);
    const opened = CashService.openCashDay({ company_id: companyId, register_id: registerId, date: next, user_id: cashierId, user_email: cashierEmail, user_role: 'CASHIER' });
    assert.equal(opened.opening_balance, 300_000);
    assert.equal(AuthService.isCashSupervisor(cashierId), false);
    assert.equal(AuthService.isCashSupervisor(adminId), true);
  });

  test('23. Reopening a closed day needs a reason and is audited', () => {
    const date = makeDate(28);
    const day = CashService.openCashDay({ company_id: companyId, register_id: registerId, date, user_id: adminId, user_email: adminEmail, user_role: 'ADMIN' });
    CashService.closeCashDay({ cash_day_id: day.id, actual_cash: day.opening_balance, reason: 'Yopish', user_id: adminId, user_email: adminEmail });
    assert.throws(() => CashService.reopenCashDay(companyId, day.id, adminId, adminEmail, ''), /sababi/);
    assert.throws(() => CashService.reopenCashDay('other-company', day.id, adminId, adminEmail, 'Qolib ketgan to‘lov'), /topilmadi/);
    const reopened = CashService.reopenCashDay(companyId, day.id, adminId, adminEmail, 'Qolib ketgan to‘lov');
    assert.equal(reopened.status, 'OPEN');
    assert.ok(db.find('audit_logs', l => l.entity_id === day.id && String(l.reason).includes('Qolib ketgan')).length > 0);
  });
});
