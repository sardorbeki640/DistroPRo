import { db } from '../db/database.ts';
import { businessToday } from '../utils/date.ts';
import type { Customer, CustomerBalanceTransaction, CustomerLedgerType, PaymentMethod, CashTransaction } from '../db/schema.ts';
import { AuditService } from './audit.service.ts';
import { CashService } from './cash.service.ts';

export type DebtStatus = 'NO_DEBT' | 'DEBT' | 'OVER_LIMIT' | 'CREDIT_BALANCE';

export interface CustomerStatementItem {
  id: string;
  date: string;
  reference_type: string;
  reference_id: string;
  external_id?: string | null;
  ledger_type: string;
  payment_method?: string;
  comment?: string | null;
  debit: number; // debt increase
  credit: number; // debt decrease / payment / return
  running_balance: number;
}

export interface AktSverkaResult {
  company: {
    id: string;
    name: string;
    tax_id?: string;
    phone?: string;
    address?: string;
  };
  customer: Customer;
  territory?: { id: string; name: string } | null;
  agent?: { id: string; full_name: string; code: string; phone?: string } | null;
  from_date: string;
  to_date: string;
  opening_balance: number;
  total_debit: number;
  total_credit: number;
  closing_balance: number;
  debt_status: DebtStatus;
  transactions: CustomerStatementItem[];
}

export interface CustomerReportItem {
  id: string;
  name: string;
  code: string;
  current_balance: number;
  customer_id: string;
  customer_name: string;
  customer_code: string;
  phone?: string;
  address?: string;
  agent_id?: string | null;
  agent_name?: string | null;
  territory_id?: string | null;
  territory_name?: string | null;
  credit_limit: number;
  opening_balance: number;
  sales: number;
  payments: number;
  returns: number;
  adjustments: number;
  closing_balance: number;
  debt_status: DebtStatus;
  is_over_limit: boolean;
  is_threshold_exceeded: boolean;
}

export interface AgentDebtSummaryItem {
  agent_id: string;
  agent_name: string;
  agent_code: string;
  customer_count: number;
  debt_customer_count: number;
  total_debt: number;
  total_sales: number;
  total_payments: number;
  total_returns: number;
  over_limit_count: number;
  threshold_exceeded_count: number;
}

export interface TerritoryDebtSummaryItem {
  territory_id: string;
  territory_name: string;
  customer_count: number;
  debt_customer_count: number;
  total_debt: number;
  total_sales: number;
  total_payments: number;
  total_returns: number;
  over_limit_count: number;
}

export interface RecordCustomerPaymentDTO {
  company_id: string;
  customer_id: string;
  amount: number;
  payment_method: PaymentMethod;
  date?: string;
  agent_id?: string | null;
  cash_day_id?: string | null;
  comment?: string;
  external_id?: string;
  source_system?: string;
  user_id: string;
  user_email: string;
}

export interface RecordCustomerAdjustmentDTO {
  company_id: string;
  customer_id: string;
  amount: number;
  direction: 'INCREASE_DEBT' | 'DECREASE_DEBT';
  date?: string;
  reason: string;
  user_id: string;
  user_email: string;
}

export interface RecordCarriedForwardDTO {
  company_id: string;
  customer_id: string;
  source_transaction_id?: string;
  source_date: string;
  target_date: string;
  amount: number;
  comment?: string;
  user_id: string;
  user_email: string;
}

export class CustomerBalanceService {
  /**
   * Calculates the exact running balance of a customer up to an optional date (inclusive).
   * Truth is derived from the immutable customer_balance_transactions ledger.
   */
  public static calculateLedgerBalance(company_id: string, customer_id: string, upToDate?: string): number {
    const txs = db.find('customer_balance_transactions', t => {
      if (t.company_id !== company_id || t.customer_id !== customer_id) return false;
      if (t.status === 'REVERSED') return false;
      const txDate = t.date || t.transaction_date || t.created_at.slice(0, 10);
      if (upToDate && txDate > upToDate) return false;
      return true;
    });

    let balance = 0;
    for (const t of txs) {
      if (t.transaction_type === 'DEBIT') {
        balance += t.amount;
      } else {
        balance -= t.amount;
      }
    }
    return Math.round(balance);
  }

  /**
   * Synchronizes and updates the cached current_balance on the customer model.
   */
  public static syncCustomerCachedBalance(company_id: string, customer_id: string): number {
    const balance = this.calculateLedgerBalance(company_id, customer_id);
    const customer = db.findById('customers', customer_id);
    if (customer && customer.company_id === company_id) {
      db.update('customers', customer.id, {
        current_balance: balance,
        updated_at: new Date().toISOString()
      });
      // Check debt threshold event trigger
      this.checkDebtThresholdAlert(customer, balance);
    }
    return balance;
  }

  /**
   * Internal alert dispatcher if customer debt exceeds configured debt_alert_threshold
   */
  private static checkDebtThresholdAlert(customer: Customer, currentDebt: number): void {
    if (customer.debt_alert_threshold && customer.debt_alert_threshold > 0) {
      if (currentDebt >= customer.debt_alert_threshold) {
        const eventId = `evt-thresh-${customer.id}-${businessToday()}`;
        const existing = db.findById('notification_events', eventId);
        if (!existing) {
          const agent = customer.agent_id ? db.findById('agents', customer.agent_id) : null;
          const territory = customer.territory_id ? db.findById('territories', customer.territory_id) : null;
          db.insert('notification_events', {
            id: eventId,
            company_id: customer.company_id,
            event_type: 'DEBT_THRESHOLD_EXCEEDED',
            title: `Mijoz qarzdorlik chegarasidan oshdi: ${customer.name}`,
            message: `Mijoz: ${customer.name} (STIR/Kod: ${customer.code}). Joriy qarz: ${currentDebt.toLocaleString()} UZS. Chegara: ${customer.debt_alert_threshold.toLocaleString()} UZS.`,
            data: {
              customer_id: customer.id,
              customer_name: customer.name,
              current_debt: currentDebt,
              threshold: customer.debt_alert_threshold,
              exceeded_amount: currentDebt - customer.debt_alert_threshold,
              agent_id: customer.agent_id,
              agent_name: agent ? agent.full_name : null,
              territory_id: customer.territory_id,
              territory_name: territory ? territory.name : null,
              date: businessToday()
            },
            agent_id: customer.agent_id,
            customer_id: customer.id,
            created_at: new Date().toISOString()
          });
        }
      }
    }
  }

  public static determineDebtStatus(balance: number, creditLimit: number): DebtStatus {
    if (balance <= 0) {
      return balance < 0 ? 'CREDIT_BALANCE' : 'NO_DEBT';
    }
    if (creditLimit > 0 && balance > creditLimit) {
      return 'OVER_LIMIT';
    }
    return 'DEBT';
  }

  /**
   * Central Service Methods mandated by requirements
   */
  public static getCurrentBalance(customerId: string): number {
    const customer = db.findById('customers', customerId);
    if (!customer) throw new Error(`Mijoz topilmadi: ${customerId}`);
    return this.calculateLedgerBalance(customer.company_id, customerId);
  }

  public static getBalanceAtDate(customerId: string, date: string): number {
    const customer = db.findById('customers', customerId);
    if (!customer) throw new Error(`Mijoz topilmadi: ${customerId}`);
    return this.calculateLedgerBalance(customer.company_id, customerId, date);
  }

  public static getOpeningBalance(customerId: string, fromDate: string): number {
    const customer = db.findById('customers', customerId);
    if (!customer) throw new Error(`Mijoz topilmadi: ${customerId}`);
    
    // Balance strictly BEFORE fromDate (i.e. up to the day before fromDate)
    const prevDateObj = new Date(fromDate);
    prevDateObj.setDate(prevDateObj.getDate() - 1);
    const dayBefore = prevDateObj.toISOString().slice(0, 10);
    return this.calculateLedgerBalance(customer.company_id, customerId, dayBefore);
  }

  public static getPeriodSummary(customerId: string, fromDate: string, toDate: string) {
    const customer = db.findById('customers', customerId);
    if (!customer) throw new Error(`Mijoz topilmadi: ${customerId}`);

    const openingBalance = this.getOpeningBalance(customerId, fromDate);
    const txs = db.find('customer_balance_transactions', t => {
      if (t.company_id !== customer.company_id || t.customer_id !== customerId) return false;
      if (t.status === 'REVERSED') return false;
      const d = t.date || t.transaction_date || t.created_at.slice(0, 10);
      return d >= fromDate && d <= toDate;
    });

    let debitSum = 0;
    let creditSum = 0;
    for (const t of txs) {
      if (t.transaction_type === 'DEBIT') {
        debitSum += t.amount;
      } else {
        creditSum += t.amount;
      }
    }

    const closingBalance = openingBalance + debitSum - creditSum;
    return {
      customer_id: customerId,
      customer_name: customer.name,
      from_date: fromDate,
      to_date: toDate,
      opening_balance: openingBalance,
      total_debit: debitSum,
      total_credit: creditSum,
      closing_balance: closingBalance,
      transactions_count: txs.length
    };
  }

  /**
   * Complete Akt Sverka generation with deterministic running balances per row
   */
  public static getStatement(customerId: string, fromDate: string, toDate: string): AktSverkaResult {
    const customer = db.findById('customers', customerId);
    if (!customer) throw new Error(`Mijoz topilmadi: ${customerId}`);

    // A legal document: never an invented name or tax number when the company card is missing.
    const company = db.findById('companies', customer.company_id) || {
      id: customer.company_id,
      name: 'Korxona',
      tax_id: undefined as string | undefined,
      phone: undefined as string | undefined,
      address: undefined as string | undefined,
      currency: 'UZS',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    const territory = customer.territory_id ? db.findById('territories', customer.territory_id) : null;
    const agent = customer.agent_id ? db.findById('agents', customer.agent_id) : null;

    const openingBalance = this.getOpeningBalance(customerId, fromDate);

    const txs = db.find('customer_balance_transactions', t => {
      if (t.company_id !== customer.company_id || t.customer_id !== customerId) return false;
      if (t.status === 'REVERSED') return false;
      const d = t.date || t.transaction_date || t.created_at.slice(0, 10);
      return d >= fromDate && d <= toDate;
    });

    // Chronological order for statement
    txs.sort((a, b) => {
      const dateA = a.date || a.transaction_date || a.created_at;
      const dateB = b.date || b.transaction_date || b.created_at;
      if (dateA !== dateB) return dateA.localeCompare(dateB);
      return a.created_at.localeCompare(b.created_at);
    });

    let running = openingBalance;
    let totalDebit = 0;
    let totalCredit = 0;

    const items: CustomerStatementItem[] = [];
    for (const t of txs) {
      const isDebit = t.transaction_type === 'DEBIT';
      const debit = isDebit ? t.amount : 0;
      const credit = !isDebit ? t.amount : 0;

      running += debit - credit;
      totalDebit += debit;
      totalCredit += credit;

      items.push({
        id: t.id,
        date: t.date || t.transaction_date || t.created_at.slice(0, 10),
        reference_type: t.reference_type,
        reference_id: t.reference_id,
        external_id: t.external_id,
        ledger_type: t.ledger_type || (isDebit ? 'SALE' : 'PAYMENT'),
        payment_method: t.payment_method,
        comment: t.comment,
        debit,
        credit,
        running_balance: running
      });
    }

    const closingBalance = running;

    return {
      company: {
        id: company.id,
        name: company.name,
        tax_id: company.tax_id,
        phone: company.phone,
        address: company.address
      },
      customer,
      territory: territory ? { id: territory.id, name: territory.name } : null,
      agent: agent ? { id: agent.id, full_name: agent.full_name, code: agent.code, phone: agent.phone } : null,
      from_date: fromDate,
      to_date: toDate,
      opening_balance: openingBalance,
      total_debit: totalDebit,
      total_credit: totalCredit,
      closing_balance: closingBalance,
      debt_status: this.determineDebtStatus(closingBalance, customer.credit_limit || 0),
      transactions: items
    };
  }

  public static getCustomerHistory(companyId: string, customerId: string) {
    const today = businessToday();
    const startOfMonth = today.slice(0, 7) + '-01';
    const statement = this.getStatement(customerId, startOfMonth, today);
    return {
      ...statement,
      balance_transactions: statement.transactions
    };
  }

  /**
   * Atomic Payment Entry: connects Customer Ledger + Cash Core + Audit Log
   */
  public static recordPayment(dto: RecordCustomerPaymentDTO): {
    balance_transaction: CustomerBalanceTransaction;
    cash_transaction?: CashTransaction;
  } {
    if (dto.amount <= 0) {
      throw new Error('To\'lov summasi 0 dan katta bo\'lishi shart.');
    }
    const customer = db.findById('customers', dto.customer_id);
    if (!customer || customer.company_id !== dto.company_id) {
      throw new Error(`Mijoz topilmadi: ${dto.customer_id}`);
    }

    const date = dto.date || businessToday();
    const now = new Date().toISOString();
    const balanceTxId = `cbt-pay-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    // Ledger type based on method
    let ledgerType: CustomerLedgerType = 'PAYMENT';
    if (dto.payment_method === 'CASH') ledgerType = 'CASH_PAYMENT';
    else if (dto.payment_method === 'TERMINAL') ledgerType = 'TERMINAL_PAYMENT';
    else if (dto.payment_method === 'CLICK') ledgerType = 'CLICK_PAYMENT';
    else if (dto.payment_method === 'BANK_TRANSFER') ledgerType = 'BANK_TRANSFER_PAYMENT';

    let cashTx: CashTransaction | undefined;

    db.transaction(database => {
      // 1. Calculate new balance
      const currentBal = CustomerBalanceService.calculateLedgerBalance(dto.company_id, customer.id);
      const newBal = currentBal - dto.amount;

      // 2. Insert Customer Balance Transaction
      const balanceTx: CustomerBalanceTransaction = {
        id: balanceTxId,
        company_id: dto.company_id,
        customer_id: customer.id,
        transaction_type: 'CREDIT', // credit reduces customer debt
        ledger_type: ledgerType,
        credit_amount: dto.amount,
        debit_amount: 0,
        amount: dto.amount,
        currency: 'UZS',
        payment_method: dto.payment_method,
        balance_after: newBal,
        reference_type: 'PAYMENT',
        reference_id: balanceTxId,
        external_id: dto.external_id || null,
        source_system: dto.source_system || 'INTERNAL',
        comment: dto.comment || `Mijoz to'lovi (${dto.payment_method})`,
        date,
        transaction_date: date,
        status: 'CONFIRMED',
        created_by: dto.user_id,
        created_at: now,
        updated_at: now
      };
      database.insert('customer_balance_transactions', balanceTx);

      // 3. Connect to Cash Core if cash_day is provided or active
      let targetCashDayId = dto.cash_day_id;
      if (!targetCashDayId) {
        const openDay = database.findOne('cash_days', cd => cd.company_id === dto.company_id && cd.date === date && cd.status === 'OPEN');
        if (openDay) {
          targetCashDayId = openDay.id;
        }
      }

      if (targetCashDayId) {
        const cashDay = database.findById('cash_days', targetCashDayId);
        if (cashDay) {
          const newTx: CashTransaction = {
            id: `ctx-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            company_id: dto.company_id,
            cash_day_id: targetCashDayId,
            transaction_type: 'CREDIT_COLLECTION',
            amount: dto.amount,
            payment_method: dto.payment_method,
            customer_id: customer.id,
            agent_id: dto.agent_id || customer.agent_id || null,
            external_reference: balanceTxId,
            description: dto.comment || `Mijozdan to'lov qabul qilindi (#${customer.name})`,
            created_by: dto.user_id,
            created_at: now,
            updated_at: now
          };
          database.insert('cash_transactions', newTx);
          cashTx = newTx;
        }
      }

      // 4. Update cached balance on customer
      database.update('customers', customer.id, {
        current_balance: newBal,
        updated_at: now
      });

      // 5. Audit Log
      AuditService.log({
        company_id: dto.company_id,
        user_id: dto.user_id,
        user_email: dto.user_email,
        action: 'CREATE',
        entity: 'CustomerPayment',
        entity_id: balanceTxId,
        old_value: { balance: currentBal },
        new_value: { balance: newBal, payment_amount: dto.amount, method: dto.payment_method },
        reason: dto.comment || `To'lov qabul qilindi: ${dto.amount.toLocaleString()} UZS (${dto.payment_method})`
      });
    });

    if (dto.cash_day_id) {
      CashService.recalculateCashDayTotals(dto.cash_day_id);
    }

    const insertedBalanceTx = db.findById('customer_balance_transactions', balanceTxId)!;
    return {
      balance_transaction: insertedBalanceTx,
      cash_transaction: cashTx
    };
  }

  /**
   * Controlled Adjustment with Reversal / Correction pattern
   */
  public static recordAdjustment(dto: RecordCustomerAdjustmentDTO): CustomerBalanceTransaction {
    if (dto.amount <= 0) {
      throw new Error('Tuzatish summasi 0 dan katta bo\'lishi kerak.');
    }
    if (!dto.reason || dto.reason.trim().length < 3) {
      throw new Error('Tuzatish sababi (reason) kiritilishi shart.');
    }

    const customer = db.findById('customers', dto.customer_id);
    if (!customer || customer.company_id !== dto.company_id) {
      throw new Error(`Mijoz topilmadi: ${dto.customer_id}`);
    }

    const date = dto.date || businessToday();
    const now = new Date().toISOString();
    const isDebit = dto.direction === 'INCREASE_DEBT';
    const txId = `cbt-adj-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    let balanceTx: CustomerBalanceTransaction;

    db.transaction(database => {
      const currentBal = CustomerBalanceService.calculateLedgerBalance(dto.company_id, customer.id);
      const newBal = isDebit ? (currentBal + dto.amount) : (currentBal - dto.amount);

      balanceTx = {
        id: txId,
        company_id: dto.company_id,
        customer_id: customer.id,
        transaction_type: isDebit ? 'DEBIT' : 'CREDIT',
        ledger_type: isDebit ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT',
        debit_amount: isDebit ? dto.amount : 0,
        credit_amount: !isDebit ? dto.amount : 0,
        amount: dto.amount,
        balance_after: newBal,
        reference_type: 'ADJUSTMENT',
        reference_id: txId,
        source_system: 'INTERNAL',
        comment: `Tuzatish: ${dto.reason}`,
        date,
        transaction_date: date,
        status: 'CONFIRMED',
        created_by: dto.user_id,
        created_at: now,
        updated_at: now
      };

      database.insert('customer_balance_transactions', balanceTx);
      database.update('customers', customer.id, {
        current_balance: newBal,
        updated_at: now
      });

      AuditService.log({
        company_id: dto.company_id,
        user_id: dto.user_id,
        user_email: dto.user_email,
        action: 'CORRECT',
        entity: 'CustomerBalance',
        entity_id: customer.id,
        old_value: { balance: currentBal },
        new_value: { balance: newBal, adjustment: dto.amount, direction: dto.direction },
        reason: dto.reason
      });
    });

    return db.findById('customer_balance_transactions', txId)!;
  }

  /**
   * Carried Forward ("kun surildi") implementation with idempotency key
   */
  public static recordCarriedForward(dto: RecordCarriedForwardDTO): CustomerBalanceTransaction {
    if (dto.amount <= 0) {
      throw new Error('Kun surish summasi 0 dan katta bo\'lishi shart.');
    }
    const customer = db.findById('customers', dto.customer_id);
    if (!customer || customer.company_id !== dto.company_id) {
      throw new Error(`Mijoz topilmadi: ${dto.customer_id}`);
    }

    // Idempotency: prevent duplicating carried forward record for same customer, source date, target date
    const idempotencyRef = `CF-${customer.id}-${dto.source_date}-${dto.target_date}`;
    const existing = db.findOne('customer_balance_transactions', t => 
      t.company_id === dto.company_id && t.reference_id === idempotencyRef
    );
    if (existing) {
      return existing;
    }

    const now = new Date().toISOString();
    const txId = `cbt-cf-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    let balanceTx: CustomerBalanceTransaction;
    db.transaction(database => {
      const currentBal = CustomerBalanceService.calculateLedgerBalance(dto.company_id, customer.id);
      const newBal = currentBal; // Carried forward retains debt balance on target date

      balanceTx = {
        id: txId,
        company_id: dto.company_id,
        customer_id: customer.id,
        transaction_type: 'DEBIT',
        ledger_type: 'CARRIED_FORWARD',
        debit_amount: dto.amount,
        credit_amount: 0,
        amount: dto.amount,
        balance_after: newBal,
        reference_type: 'CARRIED_FORWARD',
        reference_id: idempotencyRef,
        source_system: 'INTERNAL',
        comment: dto.comment || `Kun surildi: ${dto.source_date} sanasidan ${dto.target_date} sanasiga o'tkazildi`,
        date: dto.target_date,
        transaction_date: dto.target_date,
        status: 'CONFIRMED',
        created_by: dto.user_id,
        created_at: now,
        updated_at: now
      };

      database.insert('customer_balance_transactions', balanceTx);

      AuditService.log({
        company_id: dto.company_id,
        user_id: dto.user_id,
        user_email: dto.user_email,
        action: 'CREATE',
        entity: 'CarriedForward',
        entity_id: txId,
        old_value: { source_date: dto.source_date },
        new_value: { target_date: dto.target_date, amount: dto.amount },
        reason: dto.comment || 'Nasiya summasi keyingi kunga surildi'
      });
    });

    return db.findById('customer_balance_transactions', txId)!;
  }

  /**
   * Reports: Customer Balance Report across company
   */
  public static getCustomerBalanceReport(
    company_id: string, 
    filter: { fromDate?: string; toDate?: string; agentId?: string; territoryId?: string; search?: string }
  ): CustomerReportItem[] {
    const fromDate = filter.fromDate || '2020-01-01';
    const toDate = filter.toDate || '2099-12-31';

    const customers = db.find('customers', c => {
      if (c.company_id !== company_id) return false;
      if (filter.agentId && c.agent_id !== filter.agentId) return false;
      if (filter.territoryId && c.territory_id !== filter.territoryId) return false;
      if (filter.search) {
        const s = filter.search.toLowerCase();
        const matches = c.name.toLowerCase().includes(s) || 
                        c.code.toLowerCase().includes(s) || 
                        (c.phone && c.phone.includes(s));
        if (!matches) return false;
      }
      return true;
    });

    const report: CustomerReportItem[] = [];

    // One pass over the ledger for all customers. Scanning it once per customer (getPeriodSummary) took minutes
    // on 5k customers × 70k rows and froze the whole server, so every other page loaded empty meanwhile.
    // Same rules as getOpeningBalance / getPeriodSummary: opening = up to the day before fromDate.
    const dayBeforeObj = new Date(fromDate);
    dayBeforeObj.setDate(dayBeforeObj.getDate() - 1);
    const dayBefore = dayBeforeObj.toISOString().slice(0, 10);
    const wanted = new Set(customers.map(c => c.id));
    const totals = new Map<string, { opening: number; debit: number; credit: number; sales: number; payments: number; returns: number; adjustments: number }>();
    for (const t of db.find('customer_balance_transactions', t => t.company_id === company_id && t.status !== 'REVERSED' && wanted.has(t.customer_id))) {
      let s = totals.get(t.customer_id);
      if (!s) { s = { opening: 0, debit: 0, credit: 0, sales: 0, payments: 0, returns: 0, adjustments: 0 }; totals.set(t.customer_id, s); }
      const signed = t.transaction_type === 'DEBIT' ? t.amount : -t.amount;
      const ledgerDate = t.date || t.transaction_date || t.created_at.slice(0, 10);
      if (ledgerDate <= dayBefore) s.opening += signed;
      if (ledgerDate >= fromDate && ledgerDate <= toDate) {
        if (t.transaction_type === 'DEBIT') s.debit += t.amount; else s.credit += t.amount;
      }
      // Payments, returns, adjustments
      const d = t.date || t.created_at.slice(0, 10);
      if (d >= fromDate && d <= toDate) {
        if (t.reference_type === 'SALE') s.sales += t.amount;
        else if (t.reference_type === 'PAYMENT') s.payments += t.amount;
        else if (t.reference_type === 'RETURN') s.returns += t.amount;
        else if (t.reference_type === 'ADJUSTMENT') s.adjustments += t.amount;
      }
    }
    const agentsById = new Map(db.find('agents', a => a.company_id === company_id).map(a => [a.id, a]));
    const territoriesById = new Map(db.getTable('territories').map((t: any) => [t.id, t]));

    for (const cust of customers) {
      const s = totals.get(cust.id);
      const openingBalance = Math.round(s?.opening || 0);
      const summary = { opening_balance: openingBalance, closing_balance: openingBalance + (s?.debit || 0) - (s?.credit || 0) };
      const agent = cust.agent_id ? agentsById.get(cust.agent_id) || db.findById('agents', cust.agent_id) : null;
      const territory = cust.territory_id ? territoriesById.get(cust.territory_id) || null : null;
      const status = this.determineDebtStatus(summary.closing_balance, cust.credit_limit || 0);
      const payments = s?.payments || 0;
      const returns = s?.returns || 0;
      const adjustments = s?.adjustments || 0;
      const sales = s?.sales || 0;

      report.push({
        id: cust.id,
        name: cust.name,
        code: cust.code,
        current_balance: summary.closing_balance,
        customer_id: cust.id,
        customer_name: cust.name,
        customer_code: cust.code,
        phone: cust.phone,
        address: cust.address,
        agent_id: cust.agent_id,
        agent_name: agent ? agent.full_name : null,
        territory_id: cust.territory_id,
        territory_name: territory ? territory.name : null,
        credit_limit: cust.credit_limit || 0,
        opening_balance: summary.opening_balance,
        sales,
        payments,
        returns,
        adjustments,
        closing_balance: summary.closing_balance,
        debt_status: status,
        is_over_limit: (cust.credit_limit > 0) && (summary.closing_balance > cust.credit_limit),
        is_threshold_exceeded: !!(cust.debt_alert_threshold && summary.closing_balance >= cust.debt_alert_threshold)
      });
    }

    return report;
  }

  /**
   * Reports: Agent Debt Summary Report
   */
  /**
   * Balance up to toDate (as calculateLedgerBalance) and period sales/payments/returns for every customer, in one pass
   * over the ledger. Keyed by `${company_id}|${customer_id}`. Per-customer scans made the debt summaries take minutes.
   */
  private static ledgerTotalsByCustomer(fromDate?: string, toDate?: string) {
    const totals = new Map<string, { balance: number; sales: number; payments: number; returns: number }>();
    for (const t of db.find('customer_balance_transactions', t => t.status !== 'REVERSED')) {
      const key = `${t.company_id}|${t.customer_id}`;
      let s = totals.get(key);
      if (!s) { s = { balance: 0, sales: 0, payments: 0, returns: 0 }; totals.set(key, s); }
      const ledgerDate = t.date || t.transaction_date || t.created_at.slice(0, 10);
      if (!toDate || ledgerDate <= toDate) s.balance += t.transaction_type === 'DEBIT' ? t.amount : -t.amount;
      const d = t.date || t.created_at.slice(0, 10);
      if ((fromDate && d < fromDate) || (toDate && d > toDate)) continue;
      if (t.reference_type === 'SALE') s.sales += t.amount;
      else if (t.reference_type === 'PAYMENT') s.payments += t.amount;
      else if (t.reference_type === 'RETURN') s.returns += t.amount;
    }
    return totals;
  }

  public static getAgentDebtSummary(agentId?: string, fromDate?: string, toDate?: string, companyId?: string): AgentDebtSummaryItem[] {
    const agents = db.find('agents', a => (agentId ? a.id === agentId : true) && (!companyId || a.company_id === companyId));
    const results: AgentDebtSummaryItem[] = [];
    const ledger = this.ledgerTotalsByCustomer(fromDate, toDate);

    for (const ag of agents) {
      const custs = db.find('customers', c => c.agent_id === ag.id);
      let totalDebt = 0;
      let debtCustCount = 0;
      let totalSales = 0;
      let totalPayments = 0;
      let totalReturns = 0;
      let overLimitCount = 0;
      let thresholdExceededCount = 0;

      for (const c of custs) {
        const s = ledger.get(`${ag.company_id}|${c.id}`);
        const bal = Math.round(s?.balance || 0);
        if (bal > 0) {
          totalDebt += bal;
          debtCustCount++;
        }
        if (c.credit_limit > 0 && bal > c.credit_limit) {
          overLimitCount++;
        }
        if (c.debt_alert_threshold && bal >= c.debt_alert_threshold) {
          thresholdExceededCount++;
        }

        // Transactions in period
        totalSales += s?.sales || 0;
        totalPayments += s?.payments || 0;
        totalReturns += s?.returns || 0;
      }

      results.push({
        agent_id: ag.id,
        agent_name: ag.full_name,
        agent_code: ag.code,
        customer_count: custs.length,
        debt_customer_count: debtCustCount,
        total_debt: totalDebt,
        total_sales: totalSales,
        total_payments: totalPayments,
        total_returns: totalReturns,
        over_limit_count: overLimitCount,
        threshold_exceeded_count: thresholdExceededCount
      });
    }

    return results;
  }

  /**
   * Reports: Territory Debt Summary Report
   */
  public static getTerritoryDebtSummary(territoryId?: string, fromDate?: string, toDate?: string, companyId?: string): TerritoryDebtSummaryItem[] {
    const territories = db.find('territories', t => (territoryId ? t.id === territoryId : true) && (!companyId || t.company_id === companyId));
    const results: TerritoryDebtSummaryItem[] = [];
    const ledger = this.ledgerTotalsByCustomer(fromDate, toDate);

    for (const terr of territories) {
      const custs = db.find('customers', c => c.territory_id === terr.id);
      let totalDebt = 0;
      let debtCustCount = 0;
      let totalSales = 0;
      let totalPayments = 0;
      let totalReturns = 0;
      let overLimitCount = 0;

      for (const c of custs) {
        const s = ledger.get(`${terr.company_id}|${c.id}`);
        const bal = Math.round(s?.balance || 0);
        if (bal > 0) {
          totalDebt += bal;
          debtCustCount++;
        }
        if (c.credit_limit > 0 && bal > c.credit_limit) {
          overLimitCount++;
        }

        totalSales += s?.sales || 0;
        totalPayments += s?.payments || 0;
        totalReturns += s?.returns || 0;
      }

      results.push({
        territory_id: terr.id,
        territory_name: terr.name,
        customer_count: custs.length,
        debt_customer_count: debtCustCount,
        total_debt: totalDebt,
        total_sales: totalSales,
        total_payments: totalPayments,
        total_returns: totalReturns,
        over_limit_count: overLimitCount
      });
    }

    return results;
  }

  /**
   * Helper: Legacy methods compatibility for existing code
   */
  public static recordDebit(dto: {
    company_id: string;
    customer_id: string;
    amount: number;
    reference_type: 'SALE' | 'PAYMENT' | 'RETURN' | 'ADJUSTMENT';
    reference_id: string;
    date: string;
    description?: string;
    user_id: string;
    user_email: string;
  }): CustomerBalanceTransaction {
    const customer = db.findById('customers', dto.customer_id);
    if (!customer || customer.company_id !== dto.company_id) {
      throw new Error(`Mijoz topilmadi: ${dto.customer_id}`);
    }

    const currentBal = this.calculateLedgerBalance(dto.company_id, customer.id);
    const newBal = currentBal + dto.amount;
    const now = new Date().toISOString();
    const txId = `cbt-deb-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    const balanceTx: CustomerBalanceTransaction = {
      id: txId,
      company_id: dto.company_id,
      customer_id: dto.customer_id,
      transaction_type: 'DEBIT',
      ledger_type: 'CREDIT_SALE',
      debit_amount: dto.amount,
      credit_amount: 0,
      amount: dto.amount,
      balance_after: newBal,
      reference_type: dto.reference_type,
      reference_id: dto.reference_id,
      date: dto.date,
      transaction_date: dto.date,
      status: 'CONFIRMED',
      comment: dto.description || 'Nasiya savdo',
      created_by: dto.user_id,
      created_at: now
    };

    db.transaction(database => {
      database.update('customers', customer.id, {
        current_balance: newBal,
        updated_at: now
      });
      database.insert('customer_balance_transactions', balanceTx);
    });

    this.checkDebtThresholdAlert(customer, newBal);

    AuditService.log({
      company_id: dto.company_id,
      user_id: dto.user_id,
      user_email: dto.user_email,
      action: 'UPDATE',
      entity: 'CustomerBalance',
      entity_id: customer.id,
      old_value: { balance: currentBal },
      new_value: { balance: newBal, added_debit: dto.amount },
      reason: dto.description || `Mijozga nasiya yozildi (${dto.amount.toLocaleString()} UZS)`
    });

    return balanceTx;
  }

  public static recordCredit(dto: {
    company_id: string;
    customer_id: string;
    amount: number;
    reference_type: 'SALE' | 'PAYMENT' | 'RETURN' | 'ADJUSTMENT';
    reference_id: string;
    date: string;
    description?: string;
    user_id: string;
    user_email: string;
  }): CustomerBalanceTransaction {
    const customer = db.findById('customers', dto.customer_id);
    if (!customer || customer.company_id !== dto.company_id) {
      throw new Error(`Mijoz topilmadi: ${dto.customer_id}`);
    }

    const currentBal = this.calculateLedgerBalance(dto.company_id, customer.id);
    const newBal = currentBal - dto.amount;
    const now = new Date().toISOString();
    const txId = `cbt-crd-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    const balanceTx: CustomerBalanceTransaction = {
      id: txId,
      company_id: dto.company_id,
      customer_id: dto.customer_id,
      transaction_type: 'CREDIT',
      ledger_type: dto.reference_type === 'RETURN' ? 'RETURN' : 'CREDIT_COLLECTION',
      credit_amount: dto.amount,
      debit_amount: 0,
      amount: dto.amount,
      balance_after: newBal,
      reference_type: dto.reference_type,
      reference_id: dto.reference_id,
      date: dto.date,
      transaction_date: dto.date,
      status: 'CONFIRMED',
      comment: dto.description || 'Qarz to\'lovi yoki qaytarish',
      created_by: dto.user_id,
      created_at: now
    };

    db.transaction(database => {
      database.update('customers', customer.id, {
        current_balance: newBal,
        updated_at: now
      });
      database.insert('customer_balance_transactions', balanceTx);
    });

    AuditService.log({
      company_id: dto.company_id,
      user_id: dto.user_id,
      user_email: dto.user_email,
      action: 'UPDATE',
      entity: 'CustomerBalance',
      entity_id: customer.id,
      old_value: { balance: currentBal },
      new_value: { balance: newBal, subtracted_credit: dto.amount },
      reason: dto.description || `Mijoz qarzidan to'lov yechildi (${dto.amount.toLocaleString()} UZS)`
    });

    return balanceTx;
  }

  public static getBalanceSummary(company_id: string, customer_id: string) {
    const customer = db.findById('customers', customer_id);
    if (!customer || customer.company_id !== company_id) {
      throw new Error('Mijoz topilmadi.');
    }
    const currentBalance = this.calculateLedgerBalance(company_id, customer_id);
    const txs = db.find('customer_balance_transactions', t => 
      t.company_id === company_id && t.customer_id === customer_id && t.status !== 'REVERSED'
    );
    let totalDebit = 0;
    let totalCredit = 0;
    for (const t of txs) {
      if (t.transaction_type === 'DEBIT') totalDebit += t.amount;
      else totalCredit += t.amount;
    }
    txs.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    const availableCredit = Math.max(0, (customer.credit_limit || 0) - currentBalance);

    return {
      customer,
      current_balance: currentBalance,
      credit_limit: customer.credit_limit || 0,
      available_credit: availableCredit,
      total_debit: totalDebit,
      total_credit: totalCredit,
      transactions_count: txs.length,
      recent_transactions: txs.slice(0, 20)
    };
  }

  public static listCustomers(company_id: string): Customer[] {
    return db.find('customers', c => c.company_id === company_id);
  }
}
