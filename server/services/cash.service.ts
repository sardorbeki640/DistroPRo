import { db } from '../db/database.ts';
import { businessToday } from '../utils/date.ts';
import type { 
  CashDay, 
  CashTransaction, 
  DailyOrderEntry,
  Return,
  TransactionType, 
  PaymentMethod 
} from '../db/schema.ts';
import { AuditService } from './audit.service.ts';
import { CustomerBalanceService } from './customer_balance.service.ts';
import { canonicalCustomerCode } from './cogs.ts';
import { NotificationService } from './notification.service.ts';
import { ExpenseService } from './expense.service.ts';
import { activeDistribution } from '../integrations/distribution.ts';
import { escapeHtml } from './telegram.service.ts';
import type { XlsxSheet } from '../utils/xlsx.ts';

export interface OpenCashDayDTO {
  company_id: string;
  register_id: string;
  date: string; // YYYY-MM-DD
  opening_balance?: number;
  manual_opening_adjustment?: number;
  user_id: string;
  user_email: string;
  user_role?: string;
  is_privileged?: boolean;
}

export interface CloseCashDayDTO {
  cash_day_id: string;
  actual_cash: number;
  notes?: string;
  reason: string;
  user_id: string;
  user_email: string;
}

export interface CreateTransactionDTO {
  company_id: string;
  cash_day_id: string;
  transaction_type: TransactionType;
  amount: number;
  payment_method: PaymentMethod;
  customer_id?: string | null;
  employee_id?: string | null;
  agent_id?: string | null;
  order_number?: string | null;
  order_id?: string | null;
  source_transaction_id?: string | null;
  external_reference?: string | null;
  description: string;
  user_id: string;
  user_email: string;
  user_role?: string;
  has_correction_permission?: boolean;
  correction_reason?: string;
}

export interface CreateOrderEntryDTO {
  company_id: string;
  cash_day_id: string;
  order_number: string;
  order_date: string;
  agent_id?: string | null;
  customer_id: string;
  sale_amount: number;
  cash_payment: number;
  terminal_payment: number;
  click_payment: number;
  credit_amount: number;
  note?: string;
  user_id: string;
  user_email: string;
}

export interface CreateCreditCollectionDTO {
  company_id: string;
  cash_day_id: string;
  customer_id: string;
  agent_id?: string | null;
  amount: number;
  payment_method: PaymentMethod;
  external_reference?: string | null;
  description: string;
  user_id: string;
  user_email: string;
}

export interface CreateReturnDTO {
  company_id: string;
  cash_day_id: string;
  customer_id: string;
  agent_id?: string | null;
  order_reference?: string | null;
  amount: number;
  date: string;
  reason: string;
  payment_impact: 'CASH_REFUND' | 'BALANCE_CREDIT';
  external_reference?: string | null;
  user_id: string;
  user_email: string;
}

export interface CreateCarriedForwardDTO {
  company_id: string;
  cash_day_id: string;
  customer_id: string;
  agent_id?: string | null;
  amount: number;
  source_transaction_id?: string | null;
  description: string;
  user_id: string;
  user_email: string;
}

export interface CorrectTransactionDTO {
  transaction_id: string;
  amount?: number;
  payment_method?: PaymentMethod;
  description?: string;
  reason: string;
  user_id: string;
  user_email: string;
  user_role?: string;
  has_correction_permission: boolean;
  company_id?: string;
}

export interface CashDaySummary {
  cash_day_id: string;
  date: string;
  status: 'OPEN' | 'CLOSED';
  opening_balance: number;
  auto_opening_balance: number;
  manual_opening_adjustment: number;
  
  // Payment Breakdown
  cash: number;
  terminal: number;
  click: number;
  credit: number;
  credit_collection: number;
  return_amount: number;
  expense: number;
  total_sales: number;
  carried_forward: number;

  // Flow & Balances
  cash_inflow: number;
  cash_outflow: number;
  calculated_cash_balance: number;
  actual_closing_balance: number | null;
  difference: number;
  
  orders_count: number;
  transactions_count: number;
}

export interface TransactionFilterOptions {
  agent_id?: string;
  customer_id?: string;
  transaction_type?: TransactionType;
  payment_method?: PaymentMethod;
  search?: string;
}

export class CashService {
  /**
   * Retrieves active or latest CashDay for register
   */
  public static getCurrentCashDay(company_id: string, register_id?: string): CashDay | null {
    const days = db.find('cash_days', cd => {
      const matchCompany = cd.company_id === company_id;
      const matchRegister = register_id ? cd.register_id === register_id : true;
      return matchCompany && matchRegister;
    });

    if (days.length === 0) return null;

    // Check if there is an OPEN day
    const openDay = days.find(d => d.status === 'OPEN');
    if (openDay) return openDay;

    // Otherwise return most recent day
    days.sort((a, b) => b.date.localeCompare(a.date));
    return days[0];
  }

  /**
   * Retrieves a CashDay by ID
   */
  public static getCashDayById(id: string): CashDay | null {
    return db.findById('cash_days', id);
  }

  /**
   * Lists CashDays with optional status or date filtering
   */
  public static listCashDays(company_id: string, status?: 'OPEN' | 'CLOSED', limit = 30): CashDay[] {
    const days = db.find('cash_days', cd => {
      if (cd.company_id !== company_id) return false;
      if (status && cd.status !== status) return false;
      return true;
    });
    days.sort((a, b) => b.date.localeCompare(a.date));
    return days.slice(0, limit);
  }

  /**
   * Opens or retrieves CashDay for specified date.
   * Enforces UNIQUE constraint: company_id + date = UNIQUE
   * Only 1 CashDay per date per company.
   */
  public static openCashDay(dto: OpenCashDayDTO): CashDay {
    // 1. Verify register
    const register = db.findById('cash_registers', dto.register_id);
    if (!register || register.company_id !== dto.company_id) {
      throw new Error('Kassa apparati topilmadi yoki ushbu kompaniyaga tegishli emas.');
    }

    // 2. One cash day per register and date
    const existing = db.findOne('cash_days', cd =>
      cd.company_id === dto.company_id && cd.register_id === dto.register_id && cd.date === dto.date
    );

    if (existing) {
      if (existing.status === 'CLOSED') {
        throw new Error(`Ushbu sana (${dto.date}) uchun kassa kuni allaqachon mavjud va yopilgan. Qayta ochish taqiqlanadi.`);
      }
      return existing;
    }

    // 3. Opening balance = previous closing of the same register. Only the very first day may start from a typed amount.
    let autoOpeningBalance = 0;
    const prevDays = db.find('cash_days', cd => cd.company_id === dto.company_id && cd.register_id === dto.register_id && cd.date < dto.date);
    const isFirstDay = prevDays.length === 0;
    if (!isFirstDay) {
      prevDays.sort((a, b) => b.date.localeCompare(a.date));
      const lastDay = prevDays[0];
      autoOpeningBalance = (lastDay.actual_closing_balance !== undefined && lastDay.actual_closing_balance !== null)
        ? lastDay.actual_closing_balance
        : (lastDay.closing_balance || lastDay.opening_balance || 0);
    } else {
      autoOpeningBalance = dto.opening_balance || 0;
    }

    // Any deviation from the carried-over balance needs a privileged user (ADMIN, SUPER_ADMIN or cash:correct).
    const isPrivileged = dto.is_privileged === true || dto.user_role === 'ADMIN' || dto.user_role === 'SUPER_ADMIN';
    let manualAdjustment = 0;
    let finalOpeningBalance = autoOpeningBalance;

    if (dto.manual_opening_adjustment !== undefined && dto.manual_opening_adjustment !== 0) {
      if (!isPrivileged) {
        throw new Error('Oddiy kassir boshlang\'ich qoldiqni qo\'lda o\'zgartirishi taqiqlangan. Faqat avtomatik hisoblangan qoldiq qabul qilinadi.');
      }
      manualAdjustment = dto.manual_opening_adjustment;
      finalOpeningBalance = autoOpeningBalance + manualAdjustment;
    } else if (dto.opening_balance !== undefined && !isFirstDay && dto.opening_balance !== autoOpeningBalance) {
      if (!isPrivileged) {
        throw new Error(`Boshlang'ich qoldiq oldingi kun qoldig'i (${autoOpeningBalance.toLocaleString()} UZS) bilan bir xil bo'lishi kerak. O'zgartirishni faqat rahbar bajaradi.`);
      }
      finalOpeningBalance = dto.opening_balance;
      manualAdjustment = finalOpeningBalance - autoOpeningBalance;
    }
    const registerCode = (register.code || register.id || 'main').toLowerCase();
    const cashDayId = `cday-${dto.date}-${registerCode}`;
    const now = new Date().toISOString();

    const newCashDay: CashDay = {
      id: cashDayId,
      company_id: dto.company_id,
      register_id: dto.register_id,
      date: dto.date,
      status: 'OPEN',
      opening_balance: finalOpeningBalance,
      auto_opening_balance: autoOpeningBalance,
      manual_opening_adjustment: manualAdjustment,
      cash_inflow: 0,
      cash_outflow: 0,
      cash_payment: 0,
      terminal_payment: 0,
      click_payment: 0,
      credit_sale: 0,
      credit_collection: 0,
      return_amount: 0,
      carried_forward_amount: 0,
      expense_amount: 0,
      total_sales: 0,
      calculated_closing_balance: finalOpeningBalance,
      actual_closing_balance: null,
      closing_balance: finalOpeningBalance,
      difference: 0,
      opened_by: dto.user_id,
      closed_by: null,
      opened_at: now,
      closed_at: null,
      note: null,
      closing_notes: null,
      created_at: now,
      updated_at: now
    };

    db.insert('cash_days', newCashDay);

    // If opening balance > 0, record a system CARRIED_FORWARD transaction for tracking
    if (finalOpeningBalance > 0) {
      const carryTx: CashTransaction = {
        id: `tx-carry-${Date.now()}`,
        company_id: dto.company_id,
        cash_day_id: cashDayId,
        transaction_type: 'CARRIED_FORWARD',
        amount: finalOpeningBalance,
        payment_method: 'CASH',
        customer_id: null,
        employee_id: null,
        agent_id: null,
        order_number: null,
        order_id: null,
        source_transaction_id: 'PREVIOUS_DAY_CLOSING',
        external_reference: 'AUTO-CARRY-OVER',
        description: `Oldingi kundan o'tkazilgan boshlang'ich kassa qoldig'i (Auto: ${autoOpeningBalance.toLocaleString()} + Korreksiya: ${manualAdjustment.toLocaleString()})`,
        created_by: dto.user_id,
        created_at: now,
        updated_at: now
      };
      db.insert('cash_transactions', carryTx);
    }

    // Automatically carry forward customer orders from previous day:
    // "biror klientni osha qismiga summa yozilsa osha yuk keyingi ertangi kassada ozi avtomatik chiqishi lozim"
    const pendingCarry = this.getPendingCarriedForwards(dto.company_id, dto.date);
    for (const pc of pendingCarry) {
      const orderEntryId = `ord-carry-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      const newEntry: DailyOrderEntry = {
        id: orderEntryId,
        company_id: dto.company_id,
        cash_day_id: cashDayId,
        order_date: dto.date,
        customer_id: pc.customer_id!,
        agent_id: (pc as any).agent_id || null,
        order_number: `SURILGAN-${pc.source_date.replace(/-/g, '')}`,
        sale_amount: pc.amount,
        cash_amount: 0,
        terminal_amount: 0,
        click_amount: 0,
        credit_amount: 0,
        carried_forward_amount: 0,
        return_amount: 0,
        status: 'PENDING_DELIVERY',
        note: `[KUN SURILGAN YUK] ${pc.source_date} sanasidan surilgan (${pc.description || 'Ertangi kunga qoldirilgan'})`,
        created_at: now,
        updated_at: now
      };
      db.insert('daily_order_entries', newEntry);
    }

    AuditService.log({
      company_id: dto.company_id,
      user_id: dto.user_id,
      user_email: dto.user_email,
      action: 'CREATE',
      entity: 'CashDay',
      entity_id: cashDayId,
      old_value: null,
      new_value: newCashDay,
      reason: `${dto.date} sanasi uchun kassa kuni ochildi. Boshlang'ich qoldiq: ${finalOpeningBalance.toLocaleString()} UZS`
    });

    return newCashDay;
  }

  /**
   * Adds an atomic transaction to CashDay with strict validation and closed day protection
   */
  public static addTransaction(dto: CreateTransactionDTO): CashTransaction {
    if (dto.amount <= 0) {
      throw new Error('Tranzaksiya summasi 0 dan katta bo\'lishi shart.');
    }

    const cashDay = db.findById('cash_days', dto.cash_day_id);
    if (!cashDay || cashDay.company_id !== dto.company_id) {
      throw new Error('Kassa kuni topilmadi.');
    }

    // Closed day protection: CASHIER cannot add transactions to a CLOSED cash day
    if (cashDay.status === 'CLOSED') {
      const canCorrect = dto.has_correction_permission || dto.user_role === 'ADMIN' || dto.user_role === 'SUPER_ADMIN';
      if (!canCorrect) {
        throw new Error('Yopiq kassa kuniga oddiy kassir tomonidan tranzaksiya kiritish taqiqlangan.');
      }
      if (!dto.correction_reason || dto.correction_reason.trim().length < 3) {
        throw new Error('Yopiq kassaga tranzaksiya kiritishda sabab / izoh ko\'rsatilishi shart.');
      }
    }

    // Comment/note validation for sensitive operations
    if (['RETURN', 'ADJUSTMENT', 'CARRIED_FORWARD'].includes(dto.transaction_type)) {
      if (!dto.description || dto.description.trim().length < 3) {
        throw new Error(`"${dto.transaction_type}" operatsiyasi uchun izoh (comment) kiritilishi shart.`);
      }
    }

    const now = new Date().toISOString();
    const txId = `tx-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

    const transaction: CashTransaction = {
      id: txId,
      company_id: dto.company_id,
      cash_day_id: dto.cash_day_id,
      transaction_type: dto.transaction_type,
      amount: dto.amount,
      payment_method: dto.payment_method,
      customer_id: dto.customer_id || null,
      employee_id: dto.employee_id || null,
      agent_id: dto.agent_id || null,
      order_number: dto.order_number || null,
      order_id: dto.order_id || null,
      source_transaction_id: dto.source_transaction_id || null,
      external_reference: dto.external_reference || null,
      description: dto.description,
      created_by: dto.user_id,
      created_at: now,
      updated_at: now
    };

    // Update balances and summary fields
    db.transaction(database => {
      database.insert('cash_transactions', transaction);
      this.recalculateCashDayTotals(cashDay.id);
    });

    const refreshedDay = db.findById('cash_days', cashDay.id)!;

    AuditService.log({
      company_id: dto.company_id,
      user_id: dto.user_id,
      user_email: dto.user_email,
      action: cashDay.status === 'CLOSED' ? 'UPDATE' : 'CREATE',
      entity: 'CashTransaction',
      entity_id: txId,
      old_value: null,
      new_value: transaction,
      reason: cashDay.status === 'CLOSED'
        ? `Yopiq kassaga korreksiya: ${dto.correction_reason || dto.description}`
        : `Tranzaksiya: ${dto.transaction_type} (${dto.payment_method} - ${dto.amount.toLocaleString()} UZS)`
    });

    return transaction;
  }

  /**
   * Daily Order / Sale Entry Composite Action
   * Enforces Rule 6: cash + terminal + click + credit <= sale_amount.
   * If > sale_amount, throws an Error.
   * Dispatches atomic sub-transactions and updates customer balance if credit_amount > 0.
   */
  public static createDailyOrder(dto: CreateOrderEntryDTO): {
    order: DailyOrderEntry;
    remaining_amount: number;
    transactions: CashTransaction[];
  } {
    if (dto.sale_amount <= 0) {
      throw new Error('Savdo summasi (sale amount) 0 dan katta bo\'lishi shart.');
    }

    const cashDay = db.findById('cash_days', dto.cash_day_id);
    if (!cashDay || cashDay.company_id !== dto.company_id) {
      throw new Error('Kassa kuni topilmadi.');
    }

    if (cashDay.status === 'CLOSED') {
      throw new Error('Yopiq kassa kuniga yangi buyurtma kiritish taqiqlangan.');
    }

    const cash = Math.max(0, dto.cash_payment || 0);
    const terminal = Math.max(0, dto.terminal_payment || 0);
    const click = Math.max(0, dto.click_payment || 0);
    const credit = Math.max(0, dto.credit_amount || 0);

    const totalAllocated = cash + terminal + click + credit;

    // Strict Rule 6 Check
    if (totalAllocated > dto.sale_amount) {
      throw new Error(
        `To'lov summasi noto'g'ri: Naqd (${cash.toLocaleString()}) + Terminal (${terminal.toLocaleString()}) + Click (${click.toLocaleString()}) + Nasiya (${credit.toLocaleString()}) = ${totalAllocated.toLocaleString()} UZS. Bu jami savdo summasidan (${dto.sale_amount.toLocaleString()} UZS) oshib ketdi.`
      );
    }

    const remainingAmount = dto.sale_amount - totalAllocated;
    const now = new Date().toISOString();
    const orderId = `ord-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

    const orderEntry: DailyOrderEntry = {
      id: orderId,
      company_id: dto.company_id,
      cash_day_id: dto.cash_day_id,
      order_number: dto.order_number || `ORD-${Date.now().toString().slice(-6)}`,
      order_date: dto.order_date || cashDay.date,
      agent_id: dto.agent_id || null,
      customer_id: dto.customer_id,
      sale_amount: dto.sale_amount,
      cash_payment: cash,
      terminal_payment: terminal,
      click_payment: click,
      credit_amount: credit,
      credit_collection: 0,
      return_amount: 0,
      carried_forward_amount: 0,
      note: dto.note || null,
      created_by: dto.user_id,
      created_at: now,
      updated_at: now
    };

    const createdTransactions: CashTransaction[] = [];

    db.transaction(database => {
      database.insert('daily_order_entries', orderEntry);

      // 1. Cash Payment
      if (cash > 0) {
        const txCash = this.addTransaction({
          company_id: dto.company_id,
          cash_day_id: dto.cash_day_id,
          transaction_type: 'SALE_PAYMENT',
          amount: cash,
          payment_method: 'CASH',
          customer_id: dto.customer_id,
          agent_id: dto.agent_id,
          order_number: orderEntry.order_number,
          order_id: orderId,
          description: `Savdo to'lovi (Naqd) - Buyurtma #${orderEntry.order_number}`,
          user_id: dto.user_id,
          user_email: dto.user_email
        });
        createdTransactions.push(txCash);
      }

      // 2. Terminal Payment (POS card)
      if (terminal > 0) {
        const txTerminal = this.addTransaction({
          company_id: dto.company_id,
          cash_day_id: dto.cash_day_id,
          transaction_type: 'SALE_PAYMENT',
          amount: terminal,
          payment_method: 'TERMINAL',
          customer_id: dto.customer_id,
          agent_id: dto.agent_id,
          order_number: orderEntry.order_number,
          order_id: orderId,
          description: `Savdo to'lovi (Terminal) - Buyurtma #${orderEntry.order_number}`,
          user_id: dto.user_id,
          user_email: dto.user_email
        });
        createdTransactions.push(txTerminal);
      }

      // 3. Click Payment
      if (click > 0) {
        const txClick = this.addTransaction({
          company_id: dto.company_id,
          cash_day_id: dto.cash_day_id,
          transaction_type: 'SALE_PAYMENT',
          amount: click,
          payment_method: 'CLICK',
          customer_id: dto.customer_id,
          agent_id: dto.agent_id,
          order_number: orderEntry.order_number,
          order_id: orderId,
          description: `Savdo to'lovi (Click) - Buyurtma #${orderEntry.order_number}`,
          user_id: dto.user_id,
          user_email: dto.user_email
        });
        createdTransactions.push(txClick);
      }

      // 4. Credit / Nasiya (Updates customer balance via CustomerBalanceService)
      if (credit > 0) {
        const txCredit = this.addTransaction({
          company_id: dto.company_id,
          cash_day_id: dto.cash_day_id,
          transaction_type: 'CREDIT_SALE',
          amount: credit,
          payment_method: 'OTHER',
          customer_id: dto.customer_id,
          agent_id: dto.agent_id,
          order_number: orderEntry.order_number,
          order_id: orderId,
          description: `Nasiya savdo - Buyurtma #${orderEntry.order_number}`,
          user_id: dto.user_id,
          user_email: dto.user_email
        });
        createdTransactions.push(txCredit);

        // Update customer balance engine
        CustomerBalanceService.recordDebit({
          company_id: dto.company_id,
          customer_id: dto.customer_id,
          amount: credit,
          reference_type: 'SALE',
          reference_id: orderId,
          date: orderEntry.order_date,
          description: `Buyurtma #${orderEntry.order_number} bo'yicha nasiya`,
          user_id: dto.user_id,
          user_email: dto.user_email
        });
      }

      this.recalculateCashDayTotals(dto.cash_day_id);
    });

    return {
      order: orderEntry,
      remaining_amount: remainingAmount,
      transactions: createdTransactions
    };
  }

  /**
   * Credit Collection (Qarz yopish)
   * Decreases customer debt and increases cash inflow if paid in cash
   */
  public static recordCreditCollection(dto: CreateCreditCollectionDTO): CashTransaction {
    if (dto.amount <= 0) {
      throw new Error('Qarz yopish summasi 0 dan katta bo\'lishi shart.');
    }
    if (!dto.customer_id) {
      throw new Error('Mijoz tanlanishi shart.');
    }

    const tx = this.addTransaction({
      company_id: dto.company_id,
      cash_day_id: dto.cash_day_id,
      transaction_type: 'CREDIT_COLLECTION',
      amount: dto.amount,
      payment_method: dto.payment_method,
      customer_id: dto.customer_id,
      agent_id: dto.agent_id,
      external_reference: dto.external_reference,
      description: dto.description || `Mijozdan qarz undirildi (${dto.payment_method})`,
      user_id: dto.user_id,
      user_email: dto.user_email
    });

    // Reduce customer debt
    CustomerBalanceService.recordCredit({
      company_id: dto.company_id,
      customer_id: dto.customer_id,
      amount: dto.amount,
      reference_type: 'PAYMENT',
      reference_id: tx.id,
      date: businessToday(),
      description: `Kassada qarz to'lovi qabul qilindi (#${tx.id})`,
      user_id: dto.user_id,
      user_email: dto.user_email
    });

    return tx;
  }

  /**
   * Return / Vozvrat recording
   * Supports CASH_REFUND (reduces cash balance) or BALANCE_CREDIT (reduces customer debt)
   */
  public static recordReturn(dto: CreateReturnDTO): { returnRecord: Return; transaction: CashTransaction } {
    if (dto.amount <= 0) {
      throw new Error('Qaytarish summasi 0 dan katta bo\'lishi shart.');
    }
    if (!dto.reason || dto.reason.trim().length < 3) {
      throw new Error('Mahsulot qaytarish sababi (reason) kiritilishi shart.');
    }

    const now = new Date().toISOString();
    const returnId = `ret-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

    const returnRecord: Return = {
      id: returnId,
      company_id: dto.company_id,
      customer_id: dto.customer_id,
      agent_id: dto.agent_id || null,
      cash_day_id: dto.cash_day_id,
      order_id: null,
      order_reference: dto.order_reference || null,
      amount: dto.amount,
      date: dto.date || now.split('T')[0],
      status: 'APPROVED',
      reason: dto.reason,
      payment_impact: dto.payment_impact,
      external_reference: dto.external_reference || null,
      created_by: dto.user_id,
      created_at: now
    };

    let paymentMethod: PaymentMethod = 'OTHER';
    if (dto.payment_impact === 'CASH_REFUND') {
      paymentMethod = 'CASH';
    }

    const tx = this.addTransaction({
      company_id: dto.company_id,
      cash_day_id: dto.cash_day_id,
      transaction_type: 'RETURN',
      amount: dto.amount,
      payment_method: paymentMethod,
      customer_id: dto.customer_id,
      agent_id: dto.agent_id,
      external_reference: dto.external_reference || returnId,
      description: `Mahsulot qaytarish (${dto.payment_impact}): ${dto.reason}`,
      user_id: dto.user_id,
      user_email: dto.user_email
    });

    db.transaction(database => {
      database.insert('returns', returnRecord);

      // If credit to customer balance, decrease debt
      if (dto.payment_impact === 'BALANCE_CREDIT') {
        CustomerBalanceService.recordCredit({
          company_id: dto.company_id,
          customer_id: dto.customer_id,
          amount: dto.amount,
          reference_type: 'RETURN',
          reference_id: returnId,
          date: dto.date,
          description: `Vozvrat balansi hisobiga qabul qilindi: ${dto.reason}`,
          user_id: dto.user_id,
          user_email: dto.user_email
        });
      }
    });

    return { returnRecord, transaction: tx };
  }

  /**
   * Carried Forward (Kun surildi)
   * Carries forward an unresolved transaction/amount for a customer to the next date.
   * Prevents duplicates for the same customer/source in the same CashDay.
   */
  public static recordCarriedForward(dto: CreateCarriedForwardDTO): CashTransaction {
    if (dto.amount <= 0) {
      throw new Error('Kun surish summasi 0 dan katta bo\'lishi shart.');
    }
    if (!dto.customer_id) {
      throw new Error('Kun surishda mijoz tanlanishi shart.');
    }
    if (!dto.description || dto.description.trim().length < 3) {
      throw new Error('Kun surish sababi / izoh kiritilishi majburiy.');
    }

    // Check duplicate carried forward
    const existing = db.findOne('cash_transactions', tx => 
      tx.cash_day_id === dto.cash_day_id &&
      tx.transaction_type === 'CARRIED_FORWARD' &&
      tx.customer_id === dto.customer_id &&
      (dto.source_transaction_id ? tx.source_transaction_id === dto.source_transaction_id : true) &&
      tx.amount === dto.amount
    );

    if (existing) {
      throw new Error(`Ushbu mijoz uchun aynan shu summa (${dto.amount.toLocaleString()} UZS) bo'yicha "Kun surildi" tranzaksiyasi allaqachon mavjud.`);
    }

    const tx = this.addTransaction({
      company_id: dto.company_id,
      cash_day_id: dto.cash_day_id,
      transaction_type: 'CARRIED_FORWARD',
      amount: dto.amount,
      payment_method: 'OTHER',
      customer_id: dto.customer_id,
      agent_id: dto.agent_id,
      source_transaction_id: dto.source_transaction_id || `MANUAL-${Date.now()}`,
      description: dto.description,
      user_id: dto.user_id,
      user_email: dto.user_email
    });

    return tx;
  }

  /**
   * Gets pending carried forwards from previous CashDays for customers
   */
  public static getPendingCarriedForwards(company_id: string, currentDate: string) {
    const prevDays = db.find('cash_days', cd => cd.company_id === company_id && cd.date < currentDate);
    if (prevDays.length === 0) return [];

    prevDays.sort((a, b) => b.date.localeCompare(a.date));
    const lastDay = prevDays[0];

    const carryTxs = db.find('cash_transactions', tx => 
      tx.cash_day_id === lastDay.id &&
      tx.transaction_type === 'CARRIED_FORWARD' &&
      tx.customer_id !== null
    );

    return carryTxs.map(tx => {
      const customer = db.findById('customers', tx.customer_id!);
      return {
        transaction_id: tx.id,
        customer_id: tx.customer_id,
        customer_name: customer?.name || 'Noma\'lum mijoz',
        customer_code: customer?.code || '',
        amount: tx.amount,
        description: tx.description,
        source_date: lastDay.date
      };
    });
  }

  /**
   * Closes an OPEN CashDay and validates physical cash vs calculated cash
   */
  public static closeCashDay(dto: CloseCashDayDTO): CashDay {
    const cashDay = db.findById('cash_days', dto.cash_day_id);
    if (!cashDay) {
      throw new Error('Kassa kuni topilmadi.');
    }

    if (cashDay.status === 'CLOSED') {
      throw new Error('Ushbu kassa kuni allaqachon yopilgan.');
    }

    // Refresh totals to ensure pristine accuracy
    this.recalculateCashDayTotals(cashDay.id);
    const refreshed = db.findById('cash_days', cashDay.id)!;

    const calculatedBalance = refreshed.calculated_closing_balance;
    const difference = dto.actual_cash - calculatedBalance;

    // Rule 16: If difference != 0, reason is strictly required (min 3 chars)
    if (difference !== 0) {
      if (!dto.reason || dto.reason.trim().length < 3) {
        throw new Error(
          `Kassa qoldig'ida farq aniqlandi (Farq: ${difference > 0 ? '+' : ''}${difference.toLocaleString()} UZS). Sabab / izoh kiritilishi shart.`
        );
      }
    }

    const now = new Date().toISOString();

    const updated = db.update('cash_days', cashDay.id, {
      status: 'CLOSED',
      actual_closing_balance: dto.actual_cash,
      closing_balance: dto.actual_cash,
      difference,
      closed_by: dto.user_id,
      closed_at: now,
      note: dto.reason || dto.notes,
      closing_notes: dto.notes || `Faktik naqd pul: ${dto.actual_cash.toLocaleString()} UZS. Hisoblangan: ${calculatedBalance.toLocaleString()} UZS. Farq: ${difference.toLocaleString()} UZS. Sabab: ${dto.reason}`,
      updated_at: now
    });

    AuditService.log({
      company_id: cashDay.company_id,
      user_id: dto.user_id,
      user_email: dto.user_email,
      action: 'CLOSE',
      entity: 'CashDay',
      entity_id: cashDay.id,
      old_value: { status: 'OPEN', calculated_balance: calculatedBalance },
      new_value: updated,
      reason: dto.reason || 'Kassa kuni muvaffaqiyatli yopildi'
    });

    // Bots subscribed to these events get the closing totals (HTML for Telegram; user text escaped).
    const fmt = (n: number) => Math.round(n || 0).toLocaleString('ru-RU');
    const closedBy = escapeHtml(dto.user_email);
    NotificationService.dispatchEvent(cashDay.company_id, 'CASH_DAY_CLOSED', `🔒 Kassa yopildi: ${cashDay.date}`,
      [`Hisoblangan qoldiq: ${fmt(calculatedBalance)} so‘m`, `Sanalgan naqd: ${fmt(dto.actual_cash)} so‘m`, `Farq: <b>${difference > 0 ? '+' : ''}${fmt(difference)} so‘m</b>`, `Savdo: ${fmt(updated?.total_sales || 0)} so‘m`, `Yopdi: ${closedBy}`].join('\n'));
    if (difference !== 0) {
      NotificationService.dispatchEvent(cashDay.company_id, 'CASH_CLOSING_DISCREPANCY', `⚠️ Kassada farq: ${cashDay.date}`,
        [`Farq: <b>${difference > 0 ? '+' : ''}${fmt(difference)} so‘m</b> (hisoblangan ${fmt(calculatedBalance)}, sanalgan ${fmt(dto.actual_cash)})`, `Sabab: ${escapeHtml(dto.reason || '—')}`, `Yopdi: ${closedBy}`].join('\n'));
    }

    return updated!;
  }

  /**
   * Controlled Correction of a transaction on a CLOSED CashDay
   * Available only to ADMIN / SUPER_ADMIN (or with cash:correct permission)
   */
  public static correctTransaction(dto: CorrectTransactionDTO): CashTransaction {
    if (!dto.has_correction_permission && dto.user_role !== 'ADMIN' && dto.user_role !== 'SUPER_ADMIN') {
      throw new Error('Yopiq kassani to\'g\'rilash uchun sizda ruxsat ("cash:correct") yetarli emas.');
    }

    if (!dto.reason || dto.reason.trim().length < 3) {
      throw new Error('Korreksiya sababi (reason) kiritilishi shart.');
    }

    const tx = db.findById('cash_transactions', dto.transaction_id);
    if (!tx || (dto.company_id !== undefined && tx.company_id !== dto.company_id)) {
      throw new Error('Tranzaksiya topilmadi.');
    }

    const cashDay = db.findById('cash_days', tx.cash_day_id);
    if (!cashDay) {
      throw new Error('Kassa kuni topilmadi.');
    }

    const oldTx = { ...tx };
    const updates: Partial<CashTransaction> = {};

    if (dto.amount !== undefined) {
      if (dto.amount <= 0) throw new Error('Summa 0 dan katta bo\'lishi kerak.');
      updates.amount = dto.amount;
    }
    if (dto.payment_method) {
      updates.payment_method = dto.payment_method;
    }
    if (dto.description) {
      updates.description = `${dto.description} [Korreksiya: ${dto.reason}]`;
    }

    let updatedTx: CashTransaction;
    db.transaction(database => {
      updatedTx = database.update('cash_transactions', tx.id, updates)!;
      this.recalculateCashDayTotals(cashDay.id);

      // If closed, update difference based on new calculated balance vs recorded actual closing balance
      const refreshedDay = database.findById('cash_days', cashDay.id)!;
      if (refreshedDay.status === 'CLOSED' && refreshedDay.actual_closing_balance !== null && refreshedDay.actual_closing_balance !== undefined) {
        const newDiff = refreshedDay.actual_closing_balance - (refreshedDay.calculated_closing_balance || 0);
        database.update('cash_days', cashDay.id, {
          difference: newDiff
        });
      }
    });

    AuditService.log({
      company_id: tx.company_id,
      user_id: dto.user_id,
      user_email: dto.user_email,
      action: 'UPDATE',
      entity: 'CashTransaction',
      entity_id: tx.id,
      old_value: oldTx,
      new_value: updatedTx!,
      reason: `Tranzaksiya korreksiyasi: ${dto.reason}`
    });

    return updatedTx!;
  }

  /**
   * Recalculates all aggregates for a CashDay strictly adhering to:
   * Rule 11:
   * Opening balance
   * + Cash inflow (Sale CASH payments + other CASH inflows)
   * + Credit collections (CASH payment method)
   * + Other cash inflows (TRANSFER_IN CASH)
   * - Cash expenses (EXPENSE CASH)
   * - Cash returns (RETURN CASH / CASH_REFUND)
   * - Cash transfers out (TRANSFER_OUT CASH)
   * = Calculated cash balance
   * 
   * NOTE: Terminal and Click payments are strictly EXCLUDED from cash balance!
   */
  public static recalculateCashDayTotals(cash_day_id: string): void {
    const cashDay = db.findById('cash_days', cash_day_id);
    if (!cashDay) return;

    const txs = db.find('cash_transactions', t => t.cash_day_id === cash_day_id);
    const orders = db.find('daily_order_entries', o => o.cash_day_id === cash_day_id);

    let cashPayment = 0;
    let terminalPayment = 0;
    let clickPayment = 0;
    let creditSale = 0;
    let creditCollection = 0;
    let creditCollectionCash = 0;
    let returnAmount = 0;
    let returnCash = 0;
    let expenseAmount = 0;
    let expenseCash = 0;
    let transferInCash = 0;
    let transferOutCash = 0;
    let carriedForward = 0;

    for (const t of txs) {
      switch (t.transaction_type) {
        case 'SALE_PAYMENT':
          if (t.payment_method === 'CASH') {
            cashPayment += t.amount;
          } else if (t.payment_method === 'TERMINAL') {
            terminalPayment += t.amount;
          } else if (t.payment_method === 'CLICK') {
            clickPayment += t.amount;
          }
          break;

        case 'CREDIT_SALE':
          creditSale += t.amount;
          break;

        case 'CREDIT_COLLECTION':
          creditCollection += t.amount;
          if (t.payment_method === 'CASH') {
            creditCollectionCash += t.amount;
          }
          break;

        case 'RETURN':
          returnAmount += t.amount;
          if (t.payment_method === 'CASH') {
            returnCash += t.amount;
          }
          break;

        case 'EXPENSE':
          expenseAmount += t.amount;
          if (t.payment_method === 'CASH') {
            expenseCash += t.amount;
          }
          break;

        case 'TRANSFER_IN':
          if (t.payment_method === 'CASH') {
            transferInCash += t.amount;
          }
          break;

        case 'TRANSFER_OUT':
          if (t.payment_method === 'CASH') {
            transferOutCash += t.amount;
          }
          break;

        case 'CARRIED_FORWARD':
          carriedForward += t.amount;
          break;
      }
    }

    const totalCashInflow = cashPayment + creditCollectionCash + transferInCash;
    const totalCashOutflow = expenseCash + returnCash + transferOutCash;
    const calculatedCashBalance = cashDay.opening_balance + totalCashInflow - totalCashOutflow;

    let totalSales = 0;
    for (const o of orders) {
      totalSales += o.sale_amount;
    }
    // Also add standalone sale transactions if any
    const standaloneSales = cashPayment + terminalPayment + clickPayment + creditSale;
    if (totalSales < standaloneSales) {
      totalSales = standaloneSales;
    }

    db.update('cash_days', cashDay.id, {
      cash_payment: cashPayment,
      terminal_payment: terminalPayment,
      click_payment: clickPayment,
      credit_sale: creditSale,
      credit_collection: creditCollection,
      return_amount: returnAmount,
      expense_amount: expenseAmount,
      carried_forward_amount: carriedForward,
      total_sales: totalSales,
      cash_inflow: totalCashInflow,
      cash_outflow: totalCashOutflow,
      calculated_closing_balance: calculatedCashBalance,
      closing_balance: cashDay.status === 'CLOSED' && cashDay.actual_closing_balance !== null
        ? cashDay.actual_closing_balance
        : calculatedCashBalance
    });
  }

  /**
   * Generates compact Payment Summary for top cards
   */
  public static getDaySummary(cash_day_id: string): CashDaySummary {
    const cashDay = db.findById('cash_days', cash_day_id);
    if (!cashDay) {
      throw new Error('Kassa kuni topilmadi.');
    }

    this.recalculateCashDayTotals(cash_day_id);
    const refreshed = db.findById('cash_days', cash_day_id)!;

    const txs = db.find('cash_transactions', t => t.cash_day_id === cash_day_id);
    const orders = db.find('daily_order_entries', o => o.cash_day_id === cash_day_id);

    return {
      cash_day_id: refreshed.id,
      date: refreshed.date,
      status: refreshed.status,
      opening_balance: refreshed.opening_balance,
      auto_opening_balance: refreshed.auto_opening_balance || refreshed.opening_balance,
      manual_opening_adjustment: refreshed.manual_opening_adjustment || 0,
      
      cash: refreshed.cash_payment,
      terminal: refreshed.terminal_payment,
      click: refreshed.click_payment,
      credit: refreshed.credit_sale,
      credit_collection: refreshed.credit_collection,
      return_amount: refreshed.return_amount,
      expense: refreshed.expense_amount || 0,
      total_sales: refreshed.total_sales || 0,
      carried_forward: refreshed.carried_forward_amount,

      cash_inflow: refreshed.cash_inflow,
      cash_outflow: refreshed.cash_outflow,
      calculated_cash_balance: refreshed.calculated_closing_balance,
      actual_closing_balance: refreshed.actual_closing_balance ?? null,
      difference: refreshed.difference,

      orders_count: orders.length,
      transactions_count: txs.length
    };
  }

  /**
   * Returns filtered transactions supporting agent, customer, type, search
   */
  public static getFilteredTransactions(cash_day_id: string, options: TransactionFilterOptions = {}): CashTransaction[] {
    let txs = db.find('cash_transactions', t => t.cash_day_id === cash_day_id);

    if (options.agent_id) {
      txs = txs.filter(t => options.agent_id!.split(',').includes(String(t.agent_id)));
    }

    if (options.customer_id) {
      txs = txs.filter(t => options.customer_id!.split(',').includes(String(t.customer_id)));
    }

    if (options.transaction_type) {
      txs = txs.filter(t => t.transaction_type === options.transaction_type);
    }

    if (options.payment_method) {
      txs = txs.filter(t => t.payment_method === options.payment_method);
    }

    if (options.search && options.search.trim().length > 0) {
      const q = options.search.toLowerCase().trim();
      txs = txs.filter(t => {
        const descMatch = t.description?.toLowerCase().includes(q);
        const orderMatch = t.order_number?.toLowerCase().includes(q);
        const refMatch = t.external_reference?.toLowerCase().includes(q);

        let customerMatch = false;
        if (t.customer_id) {
          const cust = db.findById('customers', t.customer_id);
          if (cust && (cust.name.toLowerCase().includes(q) || cust.code.toLowerCase().includes(q))) {
            customerMatch = true;
          }
        }

        let agentMatch = false;
        if (t.agent_id) {
          const agent = db.findById('agents', t.agent_id);
          if (agent && (agent.full_name.toLowerCase().includes(q) || agent.code.toLowerCase().includes(q))) {
            agentMatch = true;
          }
        }

        return descMatch || orderMatch || refMatch || customerMatch || agentMatch;
      });
    }

    txs.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    return txs;
  }

  /**
   * Returns Daily Order Entries for cash day with filters
   */
  public static getDailyOrders(cash_day_id: string, options: TransactionFilterOptions = {}): DailyOrderEntry[] {
    let orders = db.find('daily_order_entries', o => o.cash_day_id === cash_day_id);

    if (options.agent_id) {
      orders = orders.filter(o => options.agent_id!.split(',').includes(String(o.agent_id))); // several ids: comma-separated
    }

    if (options.customer_id) {
      orders = orders.filter(o => options.customer_id!.split(',').includes(String(o.customer_id)));
    }

    if (options.search && options.search.trim().length > 0) {
      const q = options.search.toLowerCase().trim();
      orders = orders.filter(o => {
        const orderNumMatch = o.order_number.toLowerCase().includes(q);
        const noteMatch = o.note?.toLowerCase().includes(q);

        let customerMatch = false;
        const cust = db.findById('customers', o.customer_id);
        if (cust && (cust.name.toLowerCase().includes(q) || cust.code.toLowerCase().includes(q))) {
          customerMatch = true;
        }

        let agentMatch = false;
        if (o.agent_id) {
          const agent = db.findById('agents', o.agent_id);
          if (agent && (agent.full_name.toLowerCase().includes(q) || agent.code.toLowerCase().includes(q))) {
            agentMatch = true;
          }
        }

        return orderNumMatch || noteMatch || customerMatch || agentMatch;
      });
    }

    orders.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    return orders;
  }

  /**
   * Retrieves all transactions for a specific CashDay
   */
  public static getDayTransactions(cash_day_id: string): CashTransaction[] {
    return this.getFilteredTransactions(cash_day_id);
  }

  /**
   * Pulls delivery orders for specified date from integrated Distribution ERP (Smartup/1C)
   * and populates daily_order_entries matching user's daily cash template.
   */
  public static syncDailyOrdersFromDistribution(dto: {
    company_id: string;
    cash_day_id: string;
    date: string;
    user_id: string;
    user_email: string;
  }): { count: number; total_amount: number; orders: DailyOrderEntry[] } {
    const cashDay = db.findById('cash_days', dto.cash_day_id);
    if (!cashDay || cashDay.company_id !== dto.company_id) {
      throw new Error('Kassa kuni topilmadi.');
    }

    // Only real, already imported orders. An empty source means zero orders, never sample data.
    const salesOrders = db.find('sales_orders', o => o.company_id === dto.company_id && o.delivery_date === dto.date && o.status !== 'CANCELLED');

    const inserted: DailyOrderEntry[] = [];
    const now = new Date().toISOString();

    for (const so of salesOrders) {
      // Check if already in daily_order_entries for this cash day
      const existing = db.findOne('daily_order_entries', e => 
        e.cash_day_id === dto.cash_day_id && e.order_number === so.order_number
      );

      if (!existing) {
        const entryId = `doe-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
        const entry: DailyOrderEntry = {
          id: entryId,
          company_id: dto.company_id,
          cash_day_id: dto.cash_day_id,
          order_date: dto.date,
          customer_id: so.customer_id,
          agent_id: so.agent_id || null,
          order_number: so.order_number,
          sale_amount: so.total_sales,
          cash_amount: 0,
          terminal_amount: 0,
          click_amount: 0,
          credit_amount: 0,
          carried_forward_amount: 0,
          return_amount: 0,
          status: 'PENDING_DELIVERY',
          note: `Distributsiya tizimidan import qilindi (Tashqi ID: ${so.order_number})`,
          created_at: now,
          updated_at: now
        };
        db.insert('daily_order_entries', entry);
        inserted.push(entry);
      }
    }

    AuditService.log({
      company_id: dto.company_id,
      user_id: dto.user_id,
      user_email: dto.user_email,
      action: 'SYNC',
      entity: 'DailyOrderEntry',
      entity_id: dto.cash_day_id,
      old_value: null,
      new_value: { imported_count: inserted.length },
      reason: `Distributsiya dasturidan ${inserted.length} ta yetkazib berish buyurtmasi kassa shabloniga yuklandi.`
    });

    return {
      count: inserted.length,
      total_amount: inserted.reduce((sum, o) => sum + o.sale_amount, 0),
      orders: inserted
    };
  }

  /**
   * Reconciles returns entered by Cashier vs Returns recorded in Distribution ERP
   * "kassadagi vozvrat summa bilan distributsiya dasturidagi vozvrat summa hisoboti korinib turishi kerak umumiyda.
   * Agar vozvrat summasi distributsiya dastur bilan bir xil kelmasa farq berayotgan klient zakazini korish imkoniyati bolishi kerak"
   */
  public static getReturnsReconciliation(company_id: string, cash_day_id: string) {
    const cashDay = db.findById('cash_days', cash_day_id);
    if (!cashDay || cashDay.company_id !== company_id) {
      throw new Error('Kassa kuni topilmadi.');
    }

    const customers = db.find('customers', c => c.company_id === company_id);
    const customerMap = new Map(customers.map(c => [c.id, c]));
    const agents = db.find('agents', a => a.company_id === company_id);
    const agentMap = new Map(agents.map(a => [a.id, a]));

    // 1. Cashier's return transactions for this cash day
    const cashReturns = db.find('cash_transactions', tx => 
      tx.cash_day_id === cash_day_id && tx.transaction_type === 'RETURN'
    );

    // 2. Distribution software returns for this day's date
    const distroOrdersWithReturns = db.find('sales_orders', so => 
      so.company_id === company_id && 
      so.delivery_date === cashDay.date && 
      (so.return_amount || 0) > 0
    );

    const kassaTotalReturns = cashReturns.reduce((sum, tx) => sum + tx.amount, 0);
    const distroTotalReturns = distroOrdersWithReturns.reduce((sum, so) => sum + (so.return_amount || 0), 0);
    const discrepancy = kassaTotalReturns - distroTotalReturns;

    // Build unified map per customer or order to detect exact mismatches
    const reconciliationRows: any[] = [];
    const processedCustKeys = new Set<string>();

    // Process from Distribution orders first
    for (const so of distroOrdersWithReturns) {
      const cust = customerMap.get(so.customer_id);
      const agent = agentMap.get(so.agent_id || '');

      // Find matching return in cash
      const matchedCashTx = cashReturns.find(tx => 
        tx.customer_id === so.customer_id || 
        (tx.order_number && tx.order_number === so.order_number)
      );

      const cashAmt = matchedCashTx ? matchedCashTx.amount : 0;
      const distroAmt = so.return_amount || 0;
      const diff = cashAmt - distroAmt;

      reconciliationRows.push({
        id: `rec-${so.id}`,
        customer_id: so.customer_id,
        customer_name: cust ? cust.name : so.customer_name,
        customer_code: cust ? cust.code : '',
        agent_id: so.agent_id,
        agent_name: agent ? agent.full_name : 'Biriktirilmagan',
        order_number: so.order_number,
        cash_return_amount: cashAmt,
        distro_return_amount: distroAmt,
        difference: diff,
        status: diff === 0 ? 'MATCHED' : (cashAmt === 0 ? 'MISSING_IN_CASH' : 'MISMATCH'),
        reason: matchedCashTx ? matchedCashTx.description : 'Distributsiya dasturida kiritilgan'
      });

      processedCustKeys.add(so.customer_id);
    }

    // Process cash returns that had no distribution counterpart
    for (const tx of cashReturns) {
      if (tx.customer_id && !processedCustKeys.has(tx.customer_id)) {
        const cust = customerMap.get(tx.customer_id);
        const agent = agentMap.get(tx.agent_id || '');

        reconciliationRows.push({
          id: `rec-cash-${tx.id}`,
          customer_id: tx.customer_id,
          customer_name: cust ? cust.name : 'Mijoz',
          customer_code: cust ? cust.code : '',
          agent_id: tx.agent_id,
          agent_name: agent ? agent.full_name : 'Kassir',
          order_number: tx.order_number || 'Noma\'lum',
          cash_return_amount: tx.amount,
          distro_return_amount: 0,
          difference: tx.amount,
          status: 'MISSING_IN_DISTRO',
          reason: tx.description || 'Kassada qayd etilgan'
        });
      }
    }

    const mismatchCount = reconciliationRows.filter(r => r.status !== 'MATCHED').length;

    return {
      cash_day_id,
      date: cashDay.date,
      summary: {
        kassa_total_returns: kassaTotalReturns,
        distro_total_returns: distroTotalReturns,
        discrepancy,
        is_balanced: discrepancy === 0 && mismatchCount === 0,
        mismatch_count: mismatchCount
      },
      rows: reconciliationRows
    };
  }

  /**
   * Generates clean Excel / CSV export matching user's daily register columns
   */
  public static exportCashDayCsv(company_id: string, cash_day_id: string): string {
    const cashDay = db.findById('cash_days', cash_day_id);
    if (!cashDay || cashDay.company_id !== company_id) {
      throw new Error('Kassa kuni topilmadi.');
    }

    const orders = this.getDailyOrders(cash_day_id);
    const customers = db.find('customers', c => c.company_id === company_id);
    const custMap = new Map(customers.map(c => [c.id, c]));
    const agents = db.find('agents', a => a.company_id === company_id);
    const agentMap = new Map(agents.map(a => [a.id, a]));

    const headers = [
      'Agent',
      'Dokon / Mijoz',
      'Mijoz Kodi',
      'Zakaz #',
      'Sana',
      'Zakaz Summasi',
      'Naqd',
      'Terminal',
      'Click',
      'Nasiya (Qarz)',
      'Perechisleniye',
      'Kun surildi',
      'Qaytarish (Vozvrat)',
      'Izoh'
    ];

    const lines: string[] = [headers.join(',')];

    for (const o of orders) {
      const cust = custMap.get(o.customer_id);
      const agent = agentMap.get(o.agent_id || '');

      const row = [
        `"${agent ? agent.full_name : ''}"`,
        `"${cust ? cust.name : ''}"`,
        `"${cust ? cust.code : ''}"`,
        `"${o.order_number}"`,
        `"${o.order_date}"`,
        o.sale_amount || 0,
        o.cash_amount || 0,
        o.terminal_amount || 0,
        o.click_amount || 0,
        o.credit_amount || 0,
        0, // Perechisleniye
        o.carried_forward_amount || 0,
        o.return_amount || 0,
        `"${(o.note || '').replace(/"/g, '""')}"`
      ];
      lines.push(row.join(','));
    }

    return '\uFEFF' + lines.join('\r\n');
  }

  /**
   * The cash day as an .xlsx workbook: the register with the same columns as the cash screen (with totals),
   * and every cash movement of the day with the balance summary.
   */
  public static exportCashDaySheets(company_id: string, cash_day_id: string): XlsxSheet[] {
    const cashDay = db.findById('cash_days', cash_day_id);
    if (!cashDay || cashDay.company_id !== company_id) throw new Error('Kassa kuni topilmadi.');
    const day = cashDay;
    const company = db.findById('companies', company_id);
    const custMap = new Map(db.find('customers', c => c.company_id === company_id).map(c => [c.id, c]));
    const agentMap = new Map(db.find('agents', a => a.company_id === company_id).map(a => [a.id, a]));
    const orders = this.getDailyOrders(cash_day_id).filter(o => o.status !== 'CANCELLED');
    const dateLabel = day.date.split('-').reverse().join('.');
    const subtitle = [
      company?.name || '',
      `Kassa kuni: ${dateLabel} \u00B7 Holati: ${day.status === 'CLOSED' ? 'yopilgan' : 'ochiq'}`,
      `Tayyorlandi: ${new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Tashkent' })}`
    ].filter(Boolean);
    const register: XlsxSheet = {
      name: 'Reestr',
      title: `Kassa reestri \u2014 ${dateLabel}`,
      subtitle,
      columns: [
        { header: '\u2116', key: 'n', type: 'number', width: 5 },
        { header: 'Buyurtma', key: 'order_number', width: 13 },
        { header: 'Agent', key: 'agent' },
        { header: 'Mijoz (kontragent)', key: 'customer', width: 30 },
        { header: 'Mijoz kodi', key: 'code', width: 12 },
        { header: 'Summa', key: 'sale_amount', type: 'money', total: true },
        { header: 'Oplata (naqd)', key: 'cash_payment', type: 'money', total: true },
        { header: 'Uy oplata', key: 'uy_oplata', type: 'money', total: true },
        { header: 'Nasiya va perech', key: 'nasiya_perech', type: 'money', total: true },
        { header: 'Nasiyadan kirim', key: 'nasiyadan_kirim', type: 'money', total: true },
        { header: 'Vozvrat', key: 'return_amount', type: 'money', total: true },
        { header: 'Kun surildi', key: 'carried_forward_amount', type: 'money', total: true },
        { header: 'Terminal va click', key: 'terminal_click', type: 'money', total: true },
        { header: 'Qoldiq', key: 'remaining_debt', type: 'money', total: true },
        { header: 'Izoh', key: 'note', width: 32 }
      ],
      rows: orders.map((o, i) => {
        const cust = custMap.get(o.customer_id);
        const terminal = o.terminal_click ?? ((o.terminal_amount || 0) + (o.click_amount || 0));
        const paid = (o.cash_payment || 0) + (o.uy_oplata || 0) + (terminal || 0) + (o.return_amount || 0);
        return {
          n: i + 1,
          order_number: o.order_number,
          agent: o.agent_name || agentMap.get(o.agent_id || '')?.full_name || '',
          customer: o.customer_name || cust?.name || '',
          code: cust?.code || '',
          sale_amount: o.sale_amount || 0,
          cash_payment: o.cash_payment ?? o.cash_amount ?? 0,
          uy_oplata: o.uy_oplata || 0,
          nasiya_perech: o.nasiya_perech ?? o.credit_amount ?? 0,
          nasiyadan_kirim: o.nasiyadan_kirim ?? o.credit_collection ?? 0,
          return_amount: o.return_amount || 0,
          carried_forward_amount: o.carried_forward_amount || 0,
          terminal_click: terminal || 0,
          remaining_debt: o.remaining_debt ?? Math.max(0, (o.sale_amount || 0) - paid),
          note: o.note || ''
        };
      }),
      totalsLabel: 'JAMI'
    };
    const typeLabel: Record<string, string> = {
      SALE_PAYMENT: 'Savdo to\u2018lovi', CREDIT_SALE: 'Nasiya savdo', CREDIT_COLLECTION: 'Qarzdan tushum', RETURN: 'Qaytarish',
      CARRIED_FORWARD: 'Kun surildi', EXPENSE: 'Xarajat', SALARY_PAYMENT: 'Maosh', TRANSFER_IN: 'Kirim (o\u2018tkazma)', TRANSFER_OUT: 'Chiqim (o\u2018tkazma)', ADJUSTMENT: 'Tuzatish'
    };
    const methodLabel: Record<string, string> = { CASH: 'Naqd', TERMINAL: 'Terminal', CLICK: 'Click', BANK_TRANSFER: 'Bank', OTHER: 'Boshqa' };
    const outflow = new Set(['EXPENSE', 'SALARY_PAYMENT', 'TRANSFER_OUT', 'RETURN']);
    const txs = db.find('cash_transactions', t => t.cash_day_id === cash_day_id).sort((a, b) => a.created_at.localeCompare(b.created_at));
    const movements: XlsxSheet = {
      name: 'Kassa harakatlari',
      title: `Kassa harakatlari \u2014 ${dateLabel}`,
      subtitle,
      columns: [
        { header: 'Vaqt', key: 'time', width: 8 },
        { header: 'Turi', key: 'type', width: 18 },
        { header: 'To\u2018lov usuli', key: 'method', width: 12 },
        { header: 'Kirim', key: 'in', type: 'money', total: true },
        { header: 'Chiqim', key: 'out', type: 'money', total: true },
        { header: 'Mijoz', key: 'customer', width: 28 },
        { header: 'Buyurtma', key: 'order', width: 13 },
        { header: 'Izoh', key: 'description', width: 40 }
      ],
      rows: txs.map(t => ({
        time: new Date(t.created_at).toLocaleTimeString('ru-RU', { timeZone: 'Asia/Tashkent', hour: '2-digit', minute: '2-digit' }),
        type: typeLabel[t.transaction_type] || t.transaction_type,
        method: methodLabel[t.payment_method] || t.payment_method,
        in: outflow.has(t.transaction_type) || t.transaction_type === 'CREDIT_SALE' ? null : t.amount,
        out: outflow.has(t.transaction_type) ? t.amount : null,
        customer: custMap.get(t.customer_id || '')?.name || '',
        order: t.order_number || '',
        description: t.description || ''
      })),
      totalsLabel: 'JAMI',
      summary: [
        { label: 'Boshlang\u2018ich qoldiq', value: day.opening_balance },
        { label: 'Naqd tushum', value: day.cash_payment },
        { label: 'Qarzdan tushum', value: day.credit_collection },
        { label: 'Terminal', value: day.terminal_payment },
        { label: 'Click', value: day.click_payment },
        { label: 'Xarajatlar', value: day.expense_amount || 0 },
        { label: 'Hisoblangan qoldiq', value: day.calculated_closing_balance },
        ...(day.actual_closing_balance !== undefined && day.actual_closing_balance !== null
          ? [{ label: 'Haqiqiy qoldiq (sanalgan)', value: day.actual_closing_balance }, { label: 'Farq', value: day.difference }]
          : [])
      ]
    };
    return [register, movements];
  }

  /**
   * Imports Excel / CSV rows into Cash Day
   */
  public static importCashDayOrders(dto: {
    company_id: string;
    cash_day_id: string;
    rows: {
      customer_id?: string;
      customer_name?: string;
      agent_id?: string;
      agent_name?: string;
      order_number?: string;
      sale_amount: number;
      cash_amount?: number;
      terminal_amount?: number;
      click_amount?: number;
      credit_amount?: number;
      carried_forward_amount?: number;
      return_amount?: number;
      note?: string;
    }[];
    user_id: string;
    user_email: string;
  }) {
    const cashDay = db.findById('cash_days', dto.cash_day_id);
    if (!cashDay || cashDay.company_id !== dto.company_id) {
      throw new Error('Kassa kuni topilmadi.');
    }

    const customers = db.find('customers', c => c.company_id === dto.company_id);
    const agents = db.find('agents', a => a.company_id === dto.company_id);

    const inserted: DailyOrderEntry[] = [];
    const now = new Date().toISOString();

    for (const row of dto.rows) {
      let custId = row.customer_id;
      if (!custId && row.customer_name) {
        const found = customers.find(c => c.name.toLowerCase().includes(row.customer_name!.toLowerCase()));
        if (found) custId = found.id;
      }
      if (!custId && customers.length > 0) custId = customers[0].id;

      let agId = row.agent_id;
      if (!agId && row.agent_name) {
        const foundAg = agents.find(a => a.full_name.toLowerCase().includes(row.agent_name!.toLowerCase()));
        if (foundAg) agId = foundAg.id;
      }

      const orderNumber = row.order_number || `IMP-${Date.now().toString().slice(-6)}`;
      const entryId = `imp-ord-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

      const newEntry: DailyOrderEntry = {
        id: entryId,
        company_id: dto.company_id,
        cash_day_id: dto.cash_day_id,
        order_date: cashDay.date,
        customer_id: custId || 'cust-01',
        agent_id: agId || null,
        order_number: orderNumber,
        sale_amount: row.sale_amount || 0,
        cash_amount: row.cash_amount || 0,
        terminal_amount: row.terminal_amount || 0,
        click_amount: row.click_amount || 0,
        credit_amount: row.credit_amount || 0,
        carried_forward_amount: row.carried_forward_amount || 0,
        return_amount: row.return_amount || 0,
        status: 'PENDING_DELIVERY',
        note: row.note || 'Excel fayldan import qilindi',
        created_at: now,
        updated_at: now
      };

      db.insert('daily_order_entries', newEntry);
      inserted.push(newEntry);
    }

    AuditService.log({
      company_id: dto.company_id,
      user_id: dto.user_id,
      user_email: dto.user_email,
      action: 'IMPORT',
      entity: 'DailyOrderEntry',
      entity_id: dto.cash_day_id,
      old_value: null,
      new_value: { imported_count: inserted.length },
      reason: `Excel fayldan ${inserted.length} ta kassa buyurtma yozuvi yuklandi.`
    });

    return {
      count: inserted.length,
      orders: inserted
    };
  }

  /**
   * Universal Registry query matching user's spreadsheet:
   * Columns: Agent, Kontragent, Summa, Oplata, Uy oplata, Nasiya va perech, Nasiyadan kirim, Vozvrat, Kun surildi, Terminal va click, Qoldiq
   * Summary: Umumiy sotuv, Kirim, Qarzdorlik
   */
  public static getRegistry(company_id: string, options: {
    from_date?: string;
    to_date?: string;
    agent_id?: string;
    customer_id?: string;
    search?: string;
  } = {}) {
    let orders = db.find('daily_order_entries', o => o.company_id === company_id);

    if (options.from_date) {
      orders = orders.filter(o => o.order_date >= options.from_date!);
    }
    if (options.to_date) {
      orders = orders.filter(o => o.order_date <= options.to_date!);
    }
    if (options.agent_id) {
      orders = orders.filter(o => options.agent_id!.split(',').includes(String(o.agent_id))); // several ids: comma-separated
    }
    if (options.customer_id) {
      orders = orders.filter(o => options.customer_id!.split(',').includes(String(o.customer_id)));
    }

    const customers = db.find('customers', c => c.company_id === company_id);
    const custMap = new Map(customers.map(c => [c.id, c]));
    const agents = db.find('agents', a => a.company_id === company_id);
    const agentMap = new Map(agents.map(a => [a.id, a]));

    if (options.search && options.search.trim().length > 0) {
      const q = options.search.toLowerCase().trim();
      orders = orders.filter(o => {
        const ordMatch = o.order_number.toLowerCase().includes(q);
        const cust = custMap.get(o.customer_id);
        const custMatch = cust ? (cust.name.toLowerCase().includes(q) || cust.code.toLowerCase().includes(q)) : false;
        const ag = o.agent_id ? agentMap.get(o.agent_id) : null;
        const agMatch = ag ? (ag.full_name.toLowerCase().includes(q) || ag.code.toLowerCase().includes(q)) : false;
        return ordMatch || custMatch || agMatch;
      });
    }

    // Map rows with hydrated customer and agent info and columns matching image.png
    const rows = orders.map(o => {
      const cust = custMap.get(o.customer_id);
      const ag = o.agent_id ? agentMap.get(o.agent_id) : null;

      const sale_amount = o.sale_amount || 0; // Сумма
      const cash_payment = o.cash_payment ?? (o.cash_amount || 0); // Оплата
      const uy_oplata = o.uy_oplata || 0; // Уй оплата
      const nasiya_perech = o.nasiya_perech ?? (o.credit_amount || 0); // Насия ва переч
      const nasiyadan_kirim = o.nasiyadan_kirim ?? (o.credit_collection || 0); // Насиядан кирим
      const return_amount = o.return_amount || 0; // Возврать
      const carried_forward_amount = o.carried_forward_amount || 0; // Кун сурилди
      const terminal_click = o.terminal_click ?? ((o.terminal_payment || 0) + (o.click_payment || 0) + (o.terminal_amount || 0) + (o.click_amount || 0)); // Терминал ва клик
      const remaining_debt = o.remaining_debt ?? Math.max(0, sale_amount - cash_payment - uy_oplata - terminal_click - return_amount); // Колдик

      return {
        ...o,
        agent_name: ag ? ag.full_name : (o.agent_name || 'Umumiy Savdo'),
        agent_code: ag ? ag.code : '',
        customer_name: cust ? cust.name : (o.customer_name || 'Noma\'lum mijoz'),
        customer_code: cust ? cust.code : '',
        sale_amount,
        cash_payment,
        uy_oplata,
        nasiya_perech,
        nasiyadan_kirim,
        return_amount,
        carried_forward_amount,
        terminal_click,
        remaining_debt
      };
    });

    // Summary calculations
    let total_sales = 0; // Umumiy sotuv
    let total_inflow = 0; // Kirim: Oplata + Uy oplata + Nasiyadan kirim + Terminal va click
    let total_debt = 0; // Qarzdorlik: Nasiya / Qoldiq

    let sum_sale_amount = 0;
    let sum_cash_payment = 0;
    let sum_uy_oplata = 0;
    let sum_nasiya_perech = 0;
    let sum_nasiyadan_kirim = 0;
    let sum_return_amount = 0;
    let sum_carried_forward = 0;
    let sum_terminal_click = 0;
    let sum_remaining_debt = 0;

    for (const r of rows) {
      total_sales += r.sale_amount;
      const inflow = r.cash_payment + r.uy_oplata + r.nasiyadan_kirim + r.terminal_click;
      total_inflow += inflow;
      total_debt += r.remaining_debt;

      sum_sale_amount += r.sale_amount;
      sum_cash_payment += r.cash_payment;
      sum_uy_oplata += r.uy_oplata;
      sum_nasiya_perech += r.nasiya_perech;
      sum_nasiyadan_kirim += r.nasiyadan_kirim;
      sum_return_amount += r.return_amount;
      sum_carried_forward += r.carried_forward_amount;
      sum_terminal_click += r.terminal_click;
      sum_remaining_debt += r.remaining_debt;
    }

    return {
      total_sales,
      total_inflow,
      total_debt,
      totals: {
        sum_sale_amount,
        sum_cash_payment,
        sum_uy_oplata,
        sum_nasiya_perech,
        sum_nasiyadan_kirim,
        sum_return_amount,
        sum_carried_forward,
        sum_terminal_click,
        sum_remaining_debt,
        count: rows.length
      },
      items: rows.sort((a, b) => b.order_date.localeCompare(a.order_date) || b.created_at.localeCompare(a.created_at))
    };
  }

  /**
   * Creates a registry order entry
   */
  /**
   * A debt payment accepted in the Customers section. It becomes a row of today's cash register ("nasiyadan kirim" for cash,
   * terminal otherwise), so it is counted in the day's cash and reports, lowers the customer's debt, and is sent to SalesDoc
   * with the day like any other payment.
   */
  public static recordDebtCollection(dto: {
    company_id: string;
    customer_id: string;
    amount: number;
    payment_method: 'CASH' | 'TERMINAL' | 'CLICK';
    comment?: string;
    user_id: string;
    user_email: string;
  }) {
    const amount = Number(dto.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('To‘lov summasi 0 dan katta bo‘lishi shart.');
    const customer = db.findOne('customers', c => c.id === dto.customer_id && c.company_id === dto.company_id);
    if (!customer) throw new Error('Mijoz topilmadi');
    return db.transaction(() => {
      const today = businessToday();
      let cashDay = db.findOne('cash_days', cd => cd.company_id === dto.company_id && cd.date === today && cd.status === 'OPEN');
      if (!cashDay) {
        if (db.findOne('cash_days', cd => cd.company_id === dto.company_id && cd.date === today)) {
          throw new Error(`Bugungi (${today}) kassa kuni yopilgan. To‘lovni kassaga yozish uchun kunni qayta ochish kerak.`);
        }
        const registers = db.find('cash_registers', r => r.company_id === dto.company_id);
        cashDay = this.openCashDay({ company_id: dto.company_id, register_id: registers[0]?.id || 'cr-default-01', date: today, user_id: dto.user_id, user_email: dto.user_email });
      }
      // Only customers of the connected distribution system can have the payment sent there (with the day's cash).
      const dist = activeDistribution(dto.company_id);
      const customerRef = dist && typeof dist.adapter.customerRef === 'function' && typeof dist.adapter.postPayment === 'function'
        ? dist.adapter.customerRef(canonicalCustomerCode(customer.code || ''))
        : null;
      const isCash = dto.payment_method === 'CASH';
      const id = `ord-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      const now = new Date().toISOString();
      const entry: DailyOrderEntry = {
        id, company_id: dto.company_id, cash_day_id: cashDay.id,
        order_number: `TOLOV-${Date.now().toString().slice(-6)}`, order_date: today,
        agent_id: customer.agent_id || null, customer_id: customer.id, customer_name: customer.name,
        sale_amount: 0, cash_payment: 0, uy_oplata: 0, nasiya_perech: 0,
        nasiyadan_kirim: isCash ? amount : 0, terminal_click: isCash ? 0 : amount,
        return_amount: 0, carried_forward_amount: 0, remaining_debt: 0,
        cash_amount: 0, terminal_amount: isCash ? 0 : amount, click_amount: 0, credit_amount: 0, credit_collection: amount,
        entry_kind: 'DEBT_COLLECTION',
        ...(dist && customerRef ? { integration_id: dist.integration.id, customer_ref: customerRef } : {}),
        note: dto.comment || `Mijozlar bo‘limida qabul qilingan to‘lov (${dto.payment_method})`,
        created_by: dto.user_id, created_at: now, updated_at: now
      };
      db.insert('daily_order_entries', entry);
      CustomerBalanceService.recordCredit({
        company_id: dto.company_id, customer_id: customer.id, amount, reference_type: 'PAYMENT', reference_id: id, date: today,
        description: `${entry.note} · ${entry.order_number}`, user_id: dto.user_id, user_email: dto.user_email
      });
      this.addTransaction({
        company_id: dto.company_id, cash_day_id: cashDay.id,
        transaction_type: isCash ? 'CREDIT_COLLECTION' : 'SALE_PAYMENT', amount, payment_method: isCash ? 'CASH' : 'TERMINAL',
        customer_id: customer.id, agent_id: customer.agent_id || null, order_number: entry.order_number, order_id: id,
        description: `Qarz to‘lovi (${customer.name}) - #${entry.order_number}`, user_id: dto.user_id, user_email: dto.user_email
      });
      this.recalculateCashDayTotals(cashDay.id);
      AuditService.log({
        company_id: dto.company_id, user_id: dto.user_id, user_email: dto.user_email, action: 'CREATE', entity: 'DailyOrderEntry',
        entity_id: id, old_value: null, new_value: entry, reason: `Mijoz qarz to‘lovi kassaga yozildi (${customer.name}, ${amount})`
      });
      return { entry, cash_day: db.findById('cash_days', cashDay.id)!, sent_to_salesdoc_with_day: !!customerRef, system: dist?.name || null };
    });
  }

  public static createRegistryOrder(dto: {
    company_id: string;
    cash_day_id?: string;
    order_date?: string;
    agent_id?: string | null;
    customer_id: string;
    order_number?: string;
    sale_amount: number;
    cash_payment?: number;
    uy_oplata?: number;
    nasiya_perech?: number;
    nasiyadan_kirim?: number;
    return_amount?: number;
    carried_forward_amount?: number;
    terminal_click?: number;
    remaining_debt?: number;
    note?: string | null;
    user_id: string;
    user_email: string;
  }) {
    if(!db.findOne('customers',c=>c.id===dto.customer_id && c.company_id===dto.company_id)) throw new Error('Mijoz topilmadi');
    return db.transaction(()=>{
    const today = dto.order_date || businessToday();
    
    // Find or get cash day for date
    let cashDay = db.findOne('cash_days', cd => cd.company_id === dto.company_id && (dto.cash_day_id ? cd.id===dto.cash_day_id : cd.date === today));
    if(dto.cash_day_id && !cashDay) throw new Error('Kassa kuni topilmadi');

    if (!cashDay) {
      const registers = db.find('cash_registers', r => r.company_id === dto.company_id);
      const regId = registers.length > 0 ? registers[0].id : 'cr-default-01';
      cashDay = this.openCashDay({
        company_id: dto.company_id,
        register_id: regId,
        date: today,
        user_id: dto.user_id,
        user_email: dto.user_email
      });
    }

    if(cashDay.status!=='OPEN' || cashDay.date!==today) throw new Error('Tanlangan kassa kuni yopiq yoki sana mos emas');
    const orderId = `ord-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const now = new Date().toISOString();

    const sale_amount = Number(dto.sale_amount) || 0;
    const cash_payment = Number(dto.cash_payment) || 0;
    const uy_oplata = Number(dto.uy_oplata) || 0;
    const nasiya_perech = Number(dto.nasiya_perech) || 0;
    const nasiyadan_kirim = Number(dto.nasiyadan_kirim) || 0;
    const return_amount = Number(dto.return_amount) || 0;
    const carried_forward_amount = Number(dto.carried_forward_amount) || 0;
    const terminal_click = Number(dto.terminal_click) || 0;
    const remaining_debt = dto.remaining_debt !== undefined 
      ? Number(dto.remaining_debt) 
      : Math.max(0, sale_amount - cash_payment - uy_oplata - terminal_click - return_amount);

    const orderEntry: DailyOrderEntry = {
      id: orderId,
      company_id: dto.company_id,
      cash_day_id: cashDay.id,
      order_number: dto.order_number || `ORD-${Date.now().toString().slice(-6)}`,
      order_date: today,
      agent_id: dto.agent_id || null,
      customer_id: dto.customer_id,
      sale_amount,
      cash_payment,
      uy_oplata,
      nasiya_perech,
      nasiyadan_kirim,
      return_amount,
      carried_forward_amount,
      terminal_click,
      remaining_debt,
      cash_amount: cash_payment,
      terminal_amount: terminal_click,
      click_amount: 0,
      credit_amount: nasiya_perech,
      credit_collection: nasiyadan_kirim,
      note: dto.note || null,
      created_by: dto.user_id,
      created_at: now,
      updated_at: now
    };

    db.transaction(database => {
      database.insert('daily_order_entries', orderEntry);

      // Day totals are built from cash transactions, so every received amount needs one — the same set the edit path writes.
      for (const [amount, method, type] of [[cash_payment, 'CASH', 'SALE_PAYMENT'], [terminal_click, 'TERMINAL', 'SALE_PAYMENT'], [nasiyadan_kirim, 'CASH', 'CREDIT_COLLECTION']] as const) {
        if (amount > 0) this.addTransaction({
          company_id: dto.company_id,
          cash_day_id: cashDay!.id,
          transaction_type: type,
          amount,
          payment_method: method,
          customer_id: dto.customer_id,
          agent_id: dto.agent_id,
          order_number: orderEntry.order_number,
          order_id: orderId,
          description: `Kassa reestri - #${orderEntry.order_number}`,
          user_id: dto.user_id,
          user_email: dto.user_email
        });
      }

      // Add debt collection if nasiyadan_kirim
      if (nasiyadan_kirim > 0) {
        CustomerBalanceService.recordCredit({
          company_id: dto.company_id,
          customer_id: dto.customer_id,
          amount: nasiyadan_kirim,
          reference_type: 'PAYMENT',
          reference_id: orderId,
          date: today,
          description: `Reestr orqali qarz undirildi (#${orderEntry.order_number})`,
          user_id: dto.user_id,
          user_email: dto.user_email
        });
      }

      // Record credit sale (debt increase) to Customer Balance
      if (nasiya_perech > 0) {
        CustomerBalanceService.recordDebit({
          company_id: dto.company_id,
          customer_id: dto.customer_id,
          amount: nasiya_perech,
          reference_type: 'SALE',
          reference_id: orderId,
          date: today,
          description: `Reestr orqali nasiya savdo (#${orderEntry.order_number})`,
          user_id: dto.user_id,
          user_email: dto.user_email
        });
      }

      this.recalculateCashDayTotals(cashDay!.id);
    });

    AuditService.log({
      company_id: dto.company_id,
      user_id: dto.user_id,
      user_email: dto.user_email,
      action: 'CREATE',
      entity: 'DailyOrderEntry',
      entity_id: orderId,
      old_value: null,
      new_value: orderEntry,
      reason: `Reestrga yangi buyurtma kiritildi (#${orderEntry.order_number})`
    });

    return this.updateRegistryOrder(orderEntry.id,dto.company_id,{...orderEntry},dto.user_id,dto.user_email);
    });
  }

  /**
   * Updates an existing registry order
   */
  public static updateRegistryOrder(id: string, company_id: string, dto: Partial<DailyOrderEntry>, user_id: string, user_email: string) {
    const existing = db.findOne('daily_order_entries', o => o.id === id && o.company_id === company_id);
    if (!existing) {
      throw new Error('Buyurtma topilmadi.');
    }

    const day=db.findById('cash_days',existing.cash_day_id);
    if(day?.status!=='OPEN') throw new Error('Yopiq kun yozuvini tahrirlab bo‘lmaydi.');
    if(db.findOne('integration_transactions',t=>t.company_id===company_id && t.payload?.direction==='OUTBOUND' && t.payload?.rowId===id && ['PROCESSED','SENDING','UNCERTAIN'].includes(t.status))) throw new Error('Distribyutor tizimiga yuborilgan to‘lov qulflangan. Avval to‘lovni solishtiring.');
    const allowed=['order_number','agent_id','customer_id','sale_amount','cash_payment','uy_oplata','terminal_click','nasiyadan_kirim','return_amount','carried_forward_amount','note'];
    dto=Object.fromEntries(Object.entries(dto).filter(([key])=>allowed.includes(key)));
    for(const key of ['sale_amount','cash_payment','uy_oplata','terminal_click','nasiyadan_kirim','return_amount','carried_forward_amount']) {
      const value=(dto as any)[key];
      if(value!==undefined && (typeof value!=='number'||!Number.isFinite(value)||value<0)) throw new Error('Summalar manfiy bo‘lmagan son bo‘lsin.');
    }
    if(existing.external_order_id && (dto.customer_id && dto.customer_id!==existing.customer_id || dto.sale_amount!==undefined && dto.sale_amount!==existing.sale_amount)) throw new Error('Tizimdan kelgan buyurtmaning mijozi yoki summasini o‘sha tizimning o‘zida o‘zgartiring.');
    const merged={...existing,...dto};
    if(!db.findOne('customers',c=>c.id===merged.customer_id && c.company_id===company_id)) throw new Error('Mijoz topilmadi');
    const paid=(merged.cash_payment||0)+(merged.uy_oplata||0)+(merged.terminal_click||0)+(merged.return_amount||0);
    if(paid>merged.sale_amount) throw new Error('To‘lov va qaytarish savdo summasidan oshdi.');
    dto.remaining_debt=merged.sale_amount-paid;
    dto.nasiya_perech=dto.remaining_debt;
    dto.credit_amount=dto.remaining_debt;
    dto.cash_amount=merged.cash_payment||0;
    dto.terminal_amount=merged.terminal_click||0;
    return db.transaction(()=>{
    // Update associated transactions
    const updated = db.update('daily_order_entries', id, {
      ...dto,
      updated_at: new Date().toISOString()
    });

    if (!updated) {
      throw new Error('Buyurtmani yangilab bo\'lmadi.');
    }

    // Update customer balance if customer or amounts changed
    if (!existing.external_order_id && (dto.customer_id || dto.nasiya_perech !== undefined || dto.nasiyadan_kirim !== undefined)) {
      // Clean up previous transactions for this order
      const prevCbTxs = db.find('customer_balance_transactions', t => t.reference_id === id);
      for (const t of prevCbTxs) {
        db.delete('customer_balance_transactions', t.id);
      }

      const targetCustId = updated.customer_id;
      const targetDate = updated.order_date || businessToday();

      if (updated.nasiya_perech && updated.nasiya_perech > 0) {
        CustomerBalanceService.recordDebit({
          company_id,
          customer_id: targetCustId,
          amount: updated.nasiya_perech,
          reference_type: 'SALE',
          reference_id: id,
          date: targetDate,
          description: `Reestr orqali nasiya savdo (#${updated.order_number})`,
          user_id,
          user_email
        });
      }

      if (updated.nasiyadan_kirim && updated.nasiyadan_kirim > 0) {
        CustomerBalanceService.recordCredit({
          company_id,
          customer_id: targetCustId,
          amount: updated.nasiyadan_kirim,
          reference_type: 'PAYMENT',
          reference_id: id,
          date: targetDate,
          description: `Reestr orqali qarz undirildi (#${updated.order_number})`,
          user_id,
          user_email
        });
      }

      CustomerBalanceService.calculateLedgerBalance(company_id, targetCustId);
      if (existing.customer_id !== targetCustId) {
        CustomerBalanceService.calculateLedgerBalance(company_id, existing.customer_id);
      }
    }

    for(const tx of db.find('cash_transactions',t=>t.company_id===company_id && t.order_id===id)) {
      if(tx.external_reference) throw new Error('Bog‘langan to‘lovni o‘zgartirib bo‘lmaydi.');
      db.delete('cash_transactions',tx.id);
    }
    for(const [amount,method,type] of [[updated.cash_payment||0,'CASH','SALE_PAYMENT'],[updated.terminal_click||0,'TERMINAL','SALE_PAYMENT'],[updated.nasiyadan_kirim||0,'CASH','CREDIT_COLLECTION']] as const) {
      if(amount>0) this.addTransaction({company_id,cash_day_id:existing.cash_day_id,transaction_type:type,amount,payment_method:method,customer_id:updated.customer_id,order_id:id,order_number:updated.order_number,description:'Reestr to‘lovi',user_id,user_email});
    }
    this.recalculateCashDayTotals(existing.cash_day_id);

    AuditService.log({
      company_id,
      user_id,
      user_email,
      action: 'UPDATE',
      entity: 'DailyOrderEntry',
      entity_id: id,
      old_value: existing,
      new_value: updated,
      reason: `Reestr yozuvi o'zgartirildi (#${existing.order_number})`
    });

    return updated;
    });
  }

  /**
   * Deletes an existing registry order
   */
  public static deleteRegistryOrder(id: string, company_id: string, user_id: string, user_email: string) {
    const existing = db.findOne('daily_order_entries', o => o.id === id && o.company_id === company_id);
    if (!existing) {
      throw new Error('Buyurtma topilmadi.');
    }

    if(db.findById('cash_days',existing.cash_day_id)?.status!=='OPEN' || db.findOne('integration_transactions',t=>t.payload?.rowId===id && ['PROCESSED','SENDING','UNCERTAIN'].includes(t.status))) throw new Error('Yopiq yoki yuborilgan yozuvni o‘chirish taqiqlangan.');
    // Remove associated transactions
    const txs = db.find('cash_transactions', t => t.order_id === id);
    for (const tx of txs) {
      db.delete('cash_transactions', tx.id);
    }

    // Remove associated customer balance transactions and recalculate customer ledger
    const cbTxs = db.find('customer_balance_transactions', t => t.reference_id === id);
    for (const cbTx of cbTxs) {
      db.delete('customer_balance_transactions', cbTx.id);
    }
    CustomerBalanceService.calculateLedgerBalance(company_id, existing.customer_id);

    db.delete('daily_order_entries', id);
    this.recalculateCashDayTotals(existing.cash_day_id);

    AuditService.log({
      company_id,
      user_id,
      user_email,
      action: 'DELETE',
      entity: 'DailyOrderEntry',
      entity_id: id,
      old_value: existing,
      new_value: null,
      reason: `Reestr yozuvi o'chirildi (#${existing.order_number})`
    });

    return { success: true };
  }

  /**
   * Syncs a cash payment or credit entry to connected Distribution ERP
   */
  public static syncPaymentToDistribution(dto: {
    company_id: string;
    transaction_id: string;
    user_id: string;
    user_email: string;
  }) {
    throw new Error('Bu eski yuborish usuli o‘chirildi. Kassa reestridagi “Saqlash va yuborish” tugmasidan foydalaning.');
  }

  /**
   * Bitta kun uchun bitta fayl: Barcha kunlik fayllar ro'yxatini to'liq metrikalari bilan olish
   */
  /**
   * Inkassa: cash taken from the register to the bank. The register's cash goes down (TRANSFER_OUT CASH),
   * profit does not: moving money is not spending it. Only the bank's commission, if any, is a real cost and is
   * booked as a confirmed company expense paid from the bank (it does not touch the register).
   */
  public static recordBankDeposit(dto: {
    company_id: string; cash_day_id: string; amount: number; bank_name: string; receipt_no?: string; fee?: number; note?: string;
    user_id: string; user_email: string;
  }) {
    const day = db.findById('cash_days', dto.cash_day_id);
    if (!day || day.company_id !== dto.company_id) throw new Error('Kassa kuni topilmadi.');
    if (day.status !== 'OPEN') throw new Error('Inkassa faqat ochiq kassa kuniga yoziladi.');
    const amount = Math.round(Number(dto.amount));
    if (!(amount > 0)) throw new Error('Topshirilgan summa musbat bo‘lishi kerak.');
    const bank = (dto.bank_name || '').trim();
    if (bank.length < 2) throw new Error('Bank nomini yozing.');
    const fee = Math.round(Number(dto.fee || 0));
    if (fee < 0 || fee >= amount) throw new Error('Bank komissiyasi 0 dan katta va topshirilgan summadan kichik bo‘lsin.');

    const now = new Date().toISOString();
    const receipt = (dto.receipt_no || '').trim() || null;
    const id = `ctx-bank-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    let feeExpenseId: string | null = null;
    if (fee > 0) {
      let category = db.findOne('expense_categories', c => c.company_id === dto.company_id && c.code === 'BANK_FEE');
      if (!category) {
        category = db.insert('expense_categories', { id: `cat-bankfee-${dto.company_id}`, company_id: dto.company_id, name: 'Bank xizmatlari (inkassa komissiyasi)', code: 'BANK_FEE', monthly_limit: 0, is_active: true, created_at: now, updated_at: now });
      } else if (!category.is_active) {
        db.update('expense_categories', category.id, { is_active: true, updated_at: now });
      }
      const { expense } = ExpenseService.createExpense({
        company_id: dto.company_id, date: day.date, category_id: category.id, amount: fee, payment_method: 'BANK_TRANSFER',
        comment: `Inkassa komissiyasi: ${bank}${receipt ? `, kv. №${receipt}` : ''}`, is_company_expense: true, confirm_immediately: true,
        user_id: dto.user_id, user_email: dto.user_email
      });
      feeExpenseId = expense.id;
    }
    db.insert('cash_transactions', {
      id, company_id: dto.company_id, cash_day_id: day.id, transaction_type: 'TRANSFER_OUT', amount, payment_method: 'CASH',
      transfer_kind: 'BANK_DEPOSIT', bank_name: bank, bank_fee_expense_id: feeExpenseId, external_reference: receipt,
      description: `Inkassa: bankka topshirildi (${bank})${receipt ? `, kvitansiya №${receipt}` : ''}${dto.note?.trim() ? ` — ${dto.note.trim()}` : ''}`,
      created_by: dto.user_id, created_at: now, updated_at: now
    });
    this.recalculateCashDayTotals(day.id);
    AuditService.log({
      company_id: dto.company_id, user_id: dto.user_id, user_email: dto.user_email, action: 'CREATE', entity: 'BankDeposit', entity_id: id,
      old_value: null, new_value: { date: day.date, amount, bank, receipt, fee },
      reason: `Inkassa: ${amount.toLocaleString('ru-RU')} so‘m bankka topshirildi (${bank})`
    });
    return db.findById('cash_transactions', id)!;
  }

  public static listBankDeposits(company_id: string, cash_day_id?: string) {
    return db.find('cash_transactions', t => t.company_id === company_id && t.transfer_kind === 'BANK_DEPOSIT' && (!cash_day_id || t.cash_day_id === cash_day_id))
      .map(t => ({ ...t, fee: t.bank_fee_expense_id ? db.findById('expenses', t.bank_fee_expense_id)?.amount || 0 : 0, date: db.findById('cash_days', t.cash_day_id)?.date }))
      .sort((a, b) => String(b.date).localeCompare(String(a.date)) || b.created_at.localeCompare(a.created_at));
  }

  /** A mistaken inkassa is removed while its day is open; its commission expense is cancelled with it. */
  public static deleteBankDeposit(company_id: string, id: string, user_id: string, user_email: string) {
    const t = db.findById('cash_transactions', id);
    if (!t || t.company_id !== company_id || t.transfer_kind !== 'BANK_DEPOSIT') throw new Error('Inkassa yozuvi topilmadi.');
    const day = db.findById('cash_days', t.cash_day_id);
    if (day?.status !== 'OPEN') throw new Error('Kassa kuni yopilgan — avval qayta oching.');
    db.transaction(() => {
      const fee = t.bank_fee_expense_id ? db.findById('expenses', t.bank_fee_expense_id) : null;
      if (fee && fee.status !== 'CANCELLED') ExpenseService.cancelExpense({ expense_id: fee.id, reason: 'Inkassa yozuvi o‘chirildi', user_id, user_email });
      db.delete('cash_transactions', id);
      AuditService.log({ company_id, user_id, user_email, action: 'DELETE', entity: 'BankDeposit', entity_id: id, old_value: t, new_value: null, reason: 'Inkassa yozuvi o‘chirildi' });
    });
    this.recalculateCashDayTotals(t.cash_day_id);
  }

  /**
   * Deletes an open cash day (e.g. opened by mistake or for the wrong date) with everything entered in it.
   * Refused when it would leave other systems or records out of step: payments already in SalesDoc,
   * salaries paid from this cash, or confirmed expenses tied to it. Customer ledger rows the day created are
   * marked REVERSED (kept for the audit), and a database backup is taken first.
   */
  public static deleteCashDay(company_id: string, cash_day_id: string, user_id: string, user_email: string, reason: string) {
    const day = db.findById('cash_days', cash_day_id);
    if (!day || day.company_id !== company_id) throw new Error('Kassa kuni topilmadi.');
    if (day.status !== 'OPEN') throw new Error('Faqat ochiq kassa kunini o‘chirish mumkin. Yopilgan kunni avval qayta oching.');
    if (!reason || reason.trim().length < 3) throw new Error('O‘chirish sababini yozing.');

    const sent = db.find('integration_transactions', t => t.company_id === company_id && (t.payload as any)?.dayId === cash_day_id && ['PROCESSED', 'SENDING', 'UNCERTAIN', 'CANCEL_REQUIRED'].includes(t.status));
    if (sent.length) throw new Error(`Bu kundan ${sent.length} ta to‘lov distribyutor tizimiga yuborilgan. O‘chirilsa u bilan mos kelmay qoladi — avval o‘sha tizimda bekor qiling.`);
    const txs = db.find('cash_transactions', t => t.cash_day_id === cash_day_id);
    const salaries = txs.filter(t => t.transaction_type === 'SALARY_PAYMENT');
    if (salaries.length) throw new Error(`Bu kassadan ${salaries.length} ta maosh to‘langan. O‘chirilsa maosh “to‘langan” bo‘lib qoladi-yu, pul chiqimi yo‘qoladi.`);
    const expenses = db.find('expenses', e => e.company_id === company_id && e.cash_day_id === cash_day_id && e.status === 'CONFIRMED');
    if (expenses.length) throw new Error(`Bu kunga ${expenses.length} ta tasdiqlangan xarajat bog‘langan. Avval Xarajatlar bo‘limida ularni bekor qiling.`);

    const entries = db.find('daily_order_entries', o => o.cash_day_id === cash_day_id);
    const returns = db.find('returns', r => r.company_id === company_id && r.cash_day_id === cash_day_id);
    const refIds = new Set<string>([...entries.map(e => e.id), ...txs.map(t => t.id), ...returns.map(r => r.id)]);
    const ledger = db.find('customer_balance_transactions', t => t.company_id === company_id && refIds.has(t.reference_id) && t.status !== 'REVERSED');
    const backup = db.backup(`before-delete-${day.date}-${Date.now()}`);
    const now = new Date().toISOString();

    db.transaction(() => {
      for (const t of ledger) db.update('customer_balance_transactions', t.id, { status: 'REVERSED', comment: `${t.comment || ''} [kassa kuni ${day.date} o‘chirildi]`.trim(), updated_at: now });
      db.removeWhere('daily_order_entries', o => o.cash_day_id === cash_day_id);
      db.removeWhere('cash_transactions', t => t.cash_day_id === cash_day_id);
      db.removeWhere('returns', r => r.company_id === company_id && r.cash_day_id === cash_day_id);
      db.removeWhere('integration_transactions', t => t.company_id === company_id && (t.payload as any)?.dayId === cash_day_id);
      db.delete('cash_days', cash_day_id);
      AuditService.log({
        company_id, user_id, user_email, action: 'DELETE', entity: 'CashDay', entity_id: cash_day_id,
        old_value: { date: day.date, register_id: day.register_id, orders: entries.length, transactions: txs.length, returns: returns.length, ledger_reversed: ledger.length },
        new_value: null,
        reason: `Kassa kuni o‘chirildi (${day.date}): ${reason.trim()}`
      });
    });
    for (const customerId of new Set(ledger.map(t => t.customer_id))) CustomerBalanceService.syncCustomerCachedBalance(company_id, customerId);

    return { date: day.date, orders: entries.length, transactions: txs.length, returns: returns.length, ledger_reversed: ledger.length, backup };
  }

  public static getDailyFilesList(company_id: string) {
    const days = db.find('cash_days', cd => cd.company_id === company_id);
    days.sort((a, b) => b.date.localeCompare(a.date));

    return days.map(day => {
      const orders = db.find('daily_order_entries', o => o.cash_day_id === day.id);
      const txs = db.find('cash_transactions', t => t.cash_day_id === day.id);
      const expenses = db.find('expenses', e => e.company_id === company_id && (e.cash_day_id === day.id || e.date === day.date));
      const trips = db.find('piecework_transactions', p => p.company_id === company_id && p.date === day.date);
      const returns = db.find('returns', r => r.company_id === company_id && r.date === day.date);

      let totalSales = 0;
      let cashTotal = 0;
      let terminalTotal = 0;
      let clickTotal = 0;
      let creditTotal = 0;
      let carriedForwardTotal = 0;

      for (const o of orders) {
        totalSales += o.sale_amount || 0;
        cashTotal += (o.cash_amount ?? o.cash_payment ?? 0);
        terminalTotal += (o.terminal_amount ?? o.terminal_payment ?? 0);
        clickTotal += (o.click_amount ?? o.click_payment ?? 0);
        creditTotal += (o.credit_amount || 0);
        carriedForwardTotal += (o.carried_forward_amount || 0);
      }

      let creditCollections = 0;
      let bankDeposits = 0;
      for (const t of txs) {
        if (t.transfer_kind === 'BANK_DEPOSIT') {
          bankDeposits += t.amount;
        } else if (t.transaction_type === 'CREDIT_COLLECTION') {
          creditCollections += t.amount;
        } else if (t.transaction_type === 'TRANSFER_IN' || t.transaction_type === 'SALE_PAYMENT') {
          if (!orders.some(o => o.order_number === t.order_number)) {
            if (t.payment_method === 'CASH') cashTotal += t.amount;
            else if (t.payment_method === 'TERMINAL') terminalTotal += t.amount;
            else if (t.payment_method === 'CLICK') clickTotal += t.amount;
          }
        }
      }

      let expensesTotal = 0;
      for (const exp of expenses) {
        if (exp.status === 'CONFIRMED') {
          expensesTotal += exp.amount;
        }
      }

      let tripsCount = 0;
      let tripsTotal = 0;
      for (const tr of trips) {
        tripsCount += (tr.units_completed || 1);
        tripsTotal += (tr.units_completed || 1) * (tr.rate_applied || 0);
      }

      let returnsTotal = 0;
      for (const ret of returns) {
        returnsTotal += ret.amount;
      }

      const opener = db.findById('users', day.opened_by);
      const register = db.findById('cash_registers', day.register_id);

      return {
        id: day.id,
        date: day.date,
        status: day.status,
        register_name: register?.name || 'Asosiy Kassa',
        opened_by_name: opener?.full_name || opener?.email || 'Kassir',
        opening_balance: day.opening_balance,
        calculated_closing_balance: day.calculated_closing_balance,
        actual_closing_balance: day.actual_closing_balance,
        closing_balance: day.closing_balance,
        difference: day.difference,
        total_sales: totalSales,
        orders_count: orders.length,
        cash_total: cashTotal,
        terminal_total: terminalTotal,
        click_total: clickTotal,
        credit_total: creditTotal,
        credit_collections: creditCollections,
        expenses_total: expensesTotal,
        trips_count: tripsCount,
        trips_total: tripsTotal,
        carried_forward_total: carriedForwardTotal,
        returns_total: returnsTotal,
        bank_deposits_total: bankDeposits,
        note: day.note,
        opened_at: day.opened_at,
        closed_at: day.closed_at
      };
    });
  }

  /**
   * Bitta kunlik fayl: Kunlik barcha operatsiyalarni bittada olish (Orders, Kassa, Rasxod, Dostavka, Vozvrat)
   */
  public static getFullDailyDossier(company_id: string, cash_day_id: string) {
    const day = db.findById('cash_days', cash_day_id);
    if (!day || day.company_id !== company_id) {
      throw new Error('Kunlik fayl topilmadi.');
    }

    this.recalculateCashDayTotals(day.id);
    const refreshedDay = db.findById('cash_days', day.id)!;
    const summary = this.getDaySummary(day.id);

    const orders = db.find('daily_order_entries', o => o.cash_day_id === day.id);
    const transactions = db.find('cash_transactions', t => t.cash_day_id === day.id);
    transactions.sort((a, b) => b.created_at.localeCompare(a.created_at));

    const expenses = db.find('expenses', e => e.company_id === company_id && (e.cash_day_id === day.id || e.date === day.date));
    const trips = db.find('piecework_transactions', p => p.company_id === company_id && p.date === day.date);
    const returns = db.find('returns', r => r.company_id === company_id && r.date === day.date);

    const customers = db.find('customers', c => c.company_id === company_id);
    const employees = db.find('employees', e => e.company_id === company_id);
    const agents = db.find('agents', a => a.company_id === company_id);
    const categories = db.find('expense_categories', c => c.company_id === company_id);
    const registers = db.find('cash_registers', r => r.company_id === company_id);

    return {
      day: refreshedDay,
      summary,
      orders,
      transactions,
      expenses,
      trips,
      returns,
      masterData: {
        customers,
        employees,
        agents,
        categories,
        registers
      }
    };
  }

  /**
   * Kunlik faylni qayta ochish (Reopen) - Masalan, qolib ketgan operatsiyani kiritish uchun
   */
  public static reopenCashDay(company_id: string, cash_day_id: string, user_id: string, user_email: string, reason: string) {
    const day = db.findById('cash_days', cash_day_id);
    if (!day || day.company_id !== company_id) {
      throw new Error('Kunlik fayl topilmadi.');
    }
    if (day.status !== 'CLOSED') throw new Error('Kunlik fayl allaqachon ochiq.');
    if (!reason || reason.trim().length < 5) throw new Error('Qayta ochish sababi kiritilishi shart.');

    const updated = db.update('cash_days', day.id, {
      status: 'OPEN',
      closed_at: null,
      closed_by: null,
      updated_at: new Date().toISOString()
    });

    AuditService.log({
      company_id,
      user_id,
      user_email,
      action: 'UPDATE',
      entity: 'CashDay',
      entity_id: day.id,
      old_value: { status: 'CLOSED' },
      new_value: { status: 'OPEN' },
      reason: `${day.date} sanasidagi kunlik fayl qayta ochildi. Sabab: ${reason.trim()}`
    });

    return updated!;
  }
}
