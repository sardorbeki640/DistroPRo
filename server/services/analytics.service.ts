import { db } from '../db/database.ts';
import { openDebtLots, lotAge, ledgerByCustomer } from './debt-aging.ts';
import { businessToday } from '../utils/date.ts';
import { matchesIntegrationSource } from './source-tagging.service.ts';
import type { 
  SalesOrder, 
  SalesOrderItem, 
  Product, 
  Customer, 
  Agent, 
  Territory, 
  Expense, 
  Salary,
  CustomerBalanceTransaction
} from '../db/schema.ts';

export interface GrossProfitReportRow {
  group_id: string;
  group_name: string;
  order_count: number;
  total_sales: number;
  discount_amount: number;
  return_amount: number;
  net_sales: number;
  total_cogs: number;
  gross_profit: number;
  gross_margin_percent: number;
  cogs_coverage_percent: number;
}

export interface ProfitAndLossReport {
  company_id: string;
  period_from: string;
  period_to: string;
  // Revenue
  gross_sales: number;
  sales_discounts: number;
  returns: number;
  net_revenue: number;
  // COGS
  cost_of_goods_sold: number;
  gross_profit: number;
  gross_margin_percent: number;
  // Operating Expenses (OPEX)
  operating_expenses: {
    category_id: string;
    category_name: string;
    amount: number;
  }[];
  total_operating_expenses: number;
  // Payroll (Salaries & Piecework)
  total_payroll: number;
  // Operating Profit (EBIT) — null while the cost of some sales is unknown
  operating_profit: number | null;
  operating_margin_percent: number | null;
  // Net Profit
  net_profit: number | null;
  net_margin_percent: number | null;
  // Data quality: profit is only as good as the known cost of goods
  cogs_complete: boolean;
  cogs_coverage_percent: number;   // share of net revenue whose cost is known
  unknown_cost_sales: number;      // net revenue whose cost is not loaded
  pending_sales: number;           // ordered but not delivered: not revenue yet
  revenue_source: 'SALES_ORDERS' | 'CASH_REGISTRY' | 'NONE';
  profit_note: string;
}

export interface AgingBucketItem {
  customer_id: string;
  customer_name: string;
  customer_code: string;
  agent_name?: string | null;
  territory_name?: string | null;
  credit_limit: number;
  current_debt: number;
  bucket_0_30: number;
  bucket_31_60: number;
  bucket_61_90: number;
  bucket_90_plus: number;
  bucket_unknown: number; // imported opening debt whose origin date is unknown
  oldest_debt_date?: string;
  oldest_debt_days: number;
}

export class AnalyticsService {
  /**
   * Generates Executive Profit & Loss (P&L) Statement
   */
  public static getProfitAndLoss(company_id: string, fromDate: string, toDate: string, integrationId?: string | null): ProfitAndLossReport {
    // 1. Revenue is recognised on delivery. Pending orders are reported separately, cancelled ones ignored.
    const inPeriod = db.find('sales_orders', o =>
      o.company_id === company_id &&
      o.order_date >= fromDate &&
      o.order_date <= toDate && matchesIntegrationSource(o, integrationId)
    );
    const orders = inPeriod.filter(o => o.status === 'DELIVERED');
    const pendingSales = inPeriod.filter(o => o.status === 'PENDING').reduce((s, o) => s + (o.total_sales || 0), 0);

    let grossSales = 0;
    let discounts = 0;
    let returnsSum = 0;
    let knownCogs = 0;
    let knownNetSales = 0;
    let revenueSource: ProfitAndLossReport['revenue_source'] = orders.length ? 'SALES_ORDERS' : 'NONE';

    for (const o of orders) {
      const net = (o.total_sales || 0) - (o.discount_amount || 0) - (o.return_amount || 0);
      grossSales += o.total_sales;
      discounts += (o.discount_amount || 0);
      returnsSum += (o.return_amount || 0);
      // Orders without cogs_status carry an old percentage estimate and count as unknown.
      if (o.cogs_status === 'KNOWN') { knownCogs += o.total_cogs || 0; knownNetSales += net; }
    }

    // Without imported orders, the cash registry still gives revenue — but no cost.
    if (orders.length === 0) {
      const dailyOrders = db.find('daily_order_entries', o =>
        o.company_id === company_id && o.order_date >= fromDate && o.order_date <= toDate && o.status !== 'CANCELLED' && (integrationId === undefined || o.integration_id === integrationId || (!o.integration_id && !o.external_order_id && !o.order_ref))
      );
      for (const d of dailyOrders) {
        grossSales += (d.sale_amount || 0);
        returnsSum += (d.return_amount || 0);
      }
      if (dailyOrders.length) revenueSource = 'CASH_REGISTRY';
    }

    const netRevenue = grossSales - discounts - returnsSum;
    const unknownCostSales = Math.max(0, netRevenue - knownNetSales);
    const cogsComplete = netRevenue <= 0 || unknownCostSales === 0;
    const coverage = netRevenue > 0 ? Number(((knownNetSales / netRevenue) * 100).toFixed(1)) : 100;
    const totalCogs = knownCogs;
    // Gross profit only for the part with a known cost; the rest is not guessed.
    const grossProfit = knownNetSales - knownCogs;
    const grossMarginPercent = knownNetSales > 0 ? Number(((grossProfit / knownNetSales) * 100).toFixed(2)) : 0;

    // 2. Operating Expenses (OPEX) confirmed in range
    const expenses = db.find('expenses', e => 
      e.company_id === company_id && 
      e.date >= fromDate && 
      e.date <= toDate && 
      e.status === 'CONFIRMED'
    );

    const categories = db.find('expense_categories', c => c.company_id === company_id);
    const categoryMap = new Map(categories.map(c => [c.id, c.name]));

    const expByCategory = new Map<string, number>();
    let totalOperatingExpenses = 0;

    for (const e of expenses) {
      const catId = e.category_id;
      const cur = expByCategory.get(catId) || 0;
      expByCategory.set(catId, cur + e.amount);
      totalOperatingExpenses += e.amount;
    }

    const operatingExpenseList = Array.from(expByCategory.entries()).map(([catId, amount]) => ({
      category_id: catId,
      category_name: categoryMap.get(catId) || 'Boshqa xarajat',
      amount
    }));

    // 3. Payroll: a monthly salary counts only for the days of that month inside the period.
    const monthPrefix = fromDate.slice(0, 7);
    const salaries = db.find('salaries', s =>
      s.company_id === company_id &&
      s.period_month >= monthPrefix &&
      s.period_month <= toDate.slice(0, 7) &&
      s.status !== 'DRAFT'
    );
    const totalPayroll = Math.round(salaries.reduce((sum, s) => {
      const [y, m] = s.period_month.split('-').map(Number);
      const monthFirst = `${s.period_month}-01`;
      const monthLast = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
      const overlapFrom = fromDate > monthFirst ? fromDate : monthFirst;
      const overlapTo = toDate < monthLast ? toDate : monthLast;
      const overlap = Math.max(0, (Date.parse(overlapTo) - Date.parse(overlapFrom)) / 86400000 + 1);
      return sum + s.final_amount * overlap / new Date(Date.UTC(y, m, 0)).getUTCDate();
    }, 0));

    // 4. Operating & net profit only when every sale has a known cost; otherwise "not calculated".
    const operatingProfit = cogsComplete ? grossProfit - totalOperatingExpenses - totalPayroll : null;
    const operatingMarginPercent = operatingProfit !== null && netRevenue > 0 ? Number(((operatingProfit / netRevenue) * 100).toFixed(2)) : null;
    const netProfit = operatingProfit;
    const netMarginPercent = operatingMarginPercent;
    const profitNote = revenueSource === 'NONE' ? 'Davrda yetkazilgan savdo yo‘q.'
      : cogsComplete ? 'Foyda yetkazilgan savdo va mahsulotlarning kirim narxidan hisoblandi.'
      : `Sof foyda hisoblanmadi: ${unknownCostSales.toLocaleString()} UZS savdoning tannarxi noma’lum (qamrov ${coverage}%). Mahsulotlarga kirim narxini kiriting yoki SalesDoc'dan yuklang.`;

    return {
      company_id,
      period_from: fromDate,
      period_to: toDate,
      gross_sales: grossSales,
      sales_discounts: discounts,
      returns: returnsSum,
      net_revenue: netRevenue,
      cost_of_goods_sold: totalCogs,
      gross_profit: grossProfit,
      gross_margin_percent: grossMarginPercent,
      operating_expenses: operatingExpenseList,
      total_operating_expenses: totalOperatingExpenses,
      total_payroll: totalPayroll,
      operating_profit: operatingProfit,
      operating_margin_percent: operatingMarginPercent,
      net_profit: netProfit,
      net_margin_percent: netMarginPercent,
      cogs_complete: cogsComplete,
      cogs_coverage_percent: coverage,
      unknown_cost_sales: unknownCostSales,
      pending_sales: pendingSales,
      revenue_source: revenueSource,
      profit_note: profitNote
    };
  }

  /**
   * Gross Profit Breakdown by Agent / Territory / Customer / Product
   */
  public static getGrossProfitBreakdown(
    company_id: string,
    groupBy: 'AGENT' | 'TERRITORY' | 'CUSTOMER',
    fromDate: string,
    toDate: string,
    integrationId?: string
  ): GrossProfitReportRow[] {
    const orders = db.find('sales_orders', o =>
      o.company_id === company_id &&
      o.order_date >= fromDate &&
      o.order_date <= toDate &&
      o.status === 'DELIVERED' && (!integrationId || o.source_integration_id === integrationId)
    );

    const groupMap = new Map<string, {
      name: string;
      orderCount: number;
      totalSales: number;
      discount: number;
      returns: number;
      cogs: number;
      knownNet: number;
    }>();

    for (const o of orders) {
      let key = 'UNKNOWN';
      let name = 'Noma\'lum';

      if (groupBy === 'AGENT') {
        key = o.agent_id || 'no-agent';
        const agent = o.agent_id ? db.findById('agents', o.agent_id) : null;
        name = agent ? agent.full_name : 'Biriktirilmagan';
      } else if (groupBy === 'TERRITORY') {
        key = o.territory_id || 'no-terr';
        const terr = o.territory_id ? db.findById('territories', o.territory_id) : null;
        name = terr ? terr.name : 'Hududsiz';
      } else if (groupBy === 'CUSTOMER') {
        key = o.customer_id;
        name = o.customer_name;
      }

      const existing = groupMap.get(key) || {
        name,
        orderCount: 0,
        totalSales: 0,
        discount: 0,
        returns: 0,
        cogs: 0,
        knownNet: 0
      };

      existing.orderCount++;
      existing.totalSales += o.total_sales;
      existing.discount += (o.discount_amount || 0);
      existing.returns += (o.return_amount || 0);
      if (o.cogs_status === 'KNOWN') {
        existing.cogs += (o.total_cogs || 0);
        existing.knownNet += o.total_sales - (o.discount_amount || 0) - (o.return_amount || 0);
      }
      groupMap.set(key, existing);
    }

    const rows: GrossProfitReportRow[] = [];
    for (const [key, g] of groupMap.entries()) {
      const netSales = g.totalSales - g.discount - g.returns;
      // Profit and margin only over sales whose cost is known.
      const grossProfit = g.knownNet - g.cogs;
      const margin = g.knownNet > 0 ? Number(((grossProfit / g.knownNet) * 100).toFixed(2)) : 0;

      rows.push({
        group_id: key,
        group_name: g.name,
        order_count: g.orderCount,
        total_sales: g.totalSales,
        discount_amount: g.discount,
        return_amount: g.returns,
        net_sales: netSales,
        total_cogs: g.cogs,
        gross_profit: grossProfit,
        gross_margin_percent: margin,
        cogs_coverage_percent: netSales > 0 ? Number(((g.knownNet / netSales) * 100).toFixed(1)) : 100
      });
    }

    return rows.sort((a, b) => b.gross_profit - a.gross_profit);
  }

  /**
   * Accounts Receivable (AR) Aging Analysis: 0-30, 31-60, 61-90, 90+ days
   */
  public static getAgingReport(company_id: string, asOfDate: string = businessToday()): AgingBucketItem[] {
    const customers = db.find('customers', c => c.company_id === company_id);
    const results: AgingBucketItem[] = [];
    const ledger = ledgerByCustomer(company_id);

    for (const cust of customers) {
      // Payments close the oldest debts first, so the buckets add up to what is actually owed.
      const { lots, debt } = openDebtLots(company_id, cust.id, asOfDate, ledger);
      if (debt <= 0) continue;

      let b0_30 = 0;
      let b31_60 = 0;
      let b61_90 = 0;
      let b90_plus = 0;
      let unknown = 0;
      let oldestDate: string | undefined;
      let maxDays = 0;

      for (const lot of lots) {
        const days = lotAge(lot, asOfDate);
        if (days === null) { unknown += lot.amount; continue; }
        if (!oldestDate || lot.date! < oldestDate) { oldestDate = lot.date!; maxDays = days; }
        if (days <= 30) b0_30 += lot.amount;
        else if (days <= 60) b31_60 += lot.amount;
        else if (days <= 90) b61_90 += lot.amount;
        else b90_plus += lot.amount;
      }

      const agent = cust.agent_id ? db.findById('agents', cust.agent_id) : null;
      const territory = cust.territory_id ? db.findById('territories', cust.territory_id) : null;

      results.push({
        customer_id: cust.id,
        customer_name: cust.name,
        customer_code: cust.code,
        agent_name: agent ? agent.full_name : null,
        territory_name: territory ? territory.name : null,
        credit_limit: cust.credit_limit || 0,
        current_debt: debt,
        bucket_0_30: b0_30,
        bucket_31_60: b31_60,
        bucket_61_90: b61_90,
        bucket_90_plus: b90_plus,
        bucket_unknown: unknown,
        oldest_debt_date: oldestDate,
        oldest_debt_days: maxDays
      });
    }

    return results.sort((a, b) => b.current_debt - a.current_debt);
  }
  /**
   * Generates Executive Financial Balance Sheet (Balans Hisoboti)
   * Provides transparent, exact balance indicators for the business
   */
  public static getBalanceSheet(company_id: string, asOfDate?: string): any {
    const today = asOfDate || businessToday();

    if (today !== businessToday()) throw new Error('Tarixiy balans uchun ombor va bank tarixi hali mavjud emas. Faqat bugungi qisman hisobot ochiladi.');
    const latestByRegister = new Map<string, any>();
    for (const day of db.find('cash_days', d => d.company_id === company_id && d.date <= today)) {
      const previous = latestByRegister.get(day.register_id);
      if (!previous || day.date > previous.date) latestByRegister.set(day.register_id, day);
    }
    let cashInRegisters = 0;
    for (const day of latestByRegister.values()) {
      cashInRegisters += day.status === 'CLOSED'
        ? (day.actual_closing_balance ?? day.closing_balance ?? 0)
        : (day.calculated_closing_balance ?? (day.opening_balance + (day.cash_inflow ?? 0) - (day.cash_outflow ?? 0)));
    }
    // Unknown balances must not be inferred from turnover.
    const bankBalances: number | null = null;

    // 3. Accounts Receivable (Mijozlar qarzdorligi - Debitorlik)
    const customers = db.find('customers', c => c.company_id === company_id);
    let accountsReceivable = 0;
    let customerPrepayments = 0;
    for (const c of customers) {
      if (c.current_balance > 0) {
        accountsReceivable += c.current_balance;
      } else if (c.current_balance < 0) {
        customerPrepayments += Math.abs(c.current_balance);
      }
    }

    // 4. Inventory Value (Ombor tovar zaxirasi tan narx bo'yicha)
    const products = db.find('products', p => p.company_id === company_id && p.is_active);
    let inventoryValue = 0;
    if (products.length > 0) {
      for (const p of products) {
        const qty = p.stock_quantity ?? 0;
        inventoryValue += (p.purchase_cost || p.current_cost || 0) * qty;
      }
    } else {
      inventoryValue = 0;
    }

    const totalAssets: number | null = null;

    // 5. Liabilities (Passivlar & Majburiyatlar)
    const accountsPayable: number | null = null;

    // Xodimlarga oylik qarzdorlik (Payroll liabilities)
    const salaries = db.find('salaries', s => s.company_id === company_id && s.status === 'APPROVED');
    let payrollLiabilities = 0;
    for (const s of salaries) {
      payrollLiabilities += (s.final_amount || s.base_amount || 0);
    }

    const totalLiabilities: number | null = null;
    const netEquity: number | null = null;

    const workingCapital = null, currentRatio = null, debtToEquityRatio = null, cashRatio = null;
    // 7. Cashflow (Kirim, Chiqim va Naqd Qoldiq)
    const allCashDays = db.find('cash_days', d => d.company_id === company_id);
    const targetDays = asOfDate ? allCashDays.filter(d => d.date <= today) : allCashDays;

    let totalInflow = 0;
    let totalOutflow = 0;
    let salesCash = 0;
    let creditCollected = 0;
    let operatingExpenses = 0;
    let salariesPaid = 0;
    let returnsSum = 0;

    // Inkassa (cash handed to the bank) leaves the register but is not spent: it is shown apart, not as an outflow.
    const targetIds = new Set(targetDays.map(d => d.id));
    let bankDeposits = 0;
    const depositsByDay = new Map<string, number>();
    for (const t of db.find('cash_transactions', t => t.company_id === company_id && t.transfer_kind === 'BANK_DEPOSIT' && targetIds.has(t.cash_day_id))) {
      bankDeposits += t.amount;
      depositsByDay.set(t.cash_day_id, (depositsByDay.get(t.cash_day_id) || 0) + t.amount);
    }

    for (const d of targetDays) {
      const inflow = d.cash_inflow || ((d.cash_payment || 0) + (d.credit_collection || 0));
      const outflow = (d.cash_outflow || ((d.expense_amount || 0) + (d.return_amount || 0))) - (d.cash_outflow ? depositsByDay.get(d.id) || 0 : 0);
      totalInflow += inflow;
      totalOutflow += outflow;
      salesCash += (d.cash_payment || 0);
      creditCollected += (d.credit_collection || 0);
      operatingExpenses += (d.expense_amount || 0);
      returnsSum += (d.return_amount || 0);
    }

    const expensesList = db.find('expenses', e => e.company_id === company_id && e.status === 'CONFIRMED' && (!asOfDate || e.date <= today));
    const paidExpensesTotal = expensesList.reduce((sum, e) => sum + (e.amount || 0), 0);
    if (operatingExpenses === 0 && paidExpensesTotal > 0) {
      operatingExpenses = paidExpensesTotal;
      totalOutflow += operatingExpenses;
    }

    const paidSalaries = db.find('salaries', s => s.company_id === company_id && s.status === 'PAID');
    const salariesSum = paidSalaries.reduce((sum, s) => sum + (s.final_amount || 0), 0);
    if (salariesSum > 0) {
      salariesPaid = salariesSum;
      // Salary cash transactions are already included in cash-day outflow.
    }

    const netCashFlow = totalInflow - totalOutflow;

    return {
      company_id,
      as_of_date: today,
      complete: false,
      warnings: ['Bank qoldig‘i va ta’minotchi qarzi ulanmagan. Jami balans va kapital hisoblanmadi.'],
      cashflow: {
        total_inflow: totalInflow,
        total_outflow: totalOutflow,
        net_flow: netCashFlow,
        cash_balance: cashInRegisters,
        bank_balance: bankBalances,
        total_liquid: null,
        breakdown: {
          sales_cash: salesCash,
          credit_collected: creditCollected,
          operating_expenses: operatingExpenses,
          salaries_paid: salariesPaid,
          returns: returnsSum,
          bank_deposits: bankDeposits
        }
      },
      assets: {
        cash_in_registers: cashInRegisters,
        bank_balances: bankBalances,
        accounts_receivable: accountsReceivable,
        inventory_value: inventoryValue,
        total_assets: totalAssets
      },
      liabilities: {
        accounts_payable: accountsPayable,
        payroll_liabilities: payrollLiabilities,
        customer_prepayments: customerPrepayments,
        total_liabilities: totalLiabilities
      },
      net_equity: netEquity,
      indicators: {
        working_capital: workingCapital,
        current_ratio: currentRatio,
        debt_to_equity_ratio: debtToEquityRatio,
        cash_ratio: cashRatio
      }
    };
  }
}
