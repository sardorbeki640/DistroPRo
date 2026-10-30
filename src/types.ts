export type RoleName = 'SUPER_ADMIN' | 'ADMIN' | 'CASHIER' | 'AGENT' | 'DELIVERY';

export interface Role {
  id: string;
  name: RoleName;
  description: string;
}

export interface AuthUser {
  id: string;
  company_id: string;
  email: string;
  full_name: string;
  phone?: string;
  status: string;
  roles: Role[];
  permissions: string[];
  is_super_admin: boolean;
  login?: string;
  employee_id?: string | null;
  must_change_password?: boolean;
  company_name?: string;
}

export interface Company {
  id: string;
  name: string;
  tax_id: string;
  currency: string;
  address?: string;
  phone?: string;
}

export interface CashDay {
  id: string;
  company_id: string;
  register_id: string;
  date: string;
  status: 'OPEN' | 'CLOSED';
  opening_balance: number;
  auto_opening_balance?: number;
  manual_opening_adjustment?: number;
  cash_inflow: number;
  cash_outflow: number;
  cash_payment: number;
  terminal_payment: number;
  click_payment: number;
  credit_sale: number;
  credit_collection: number;
  return_amount: number;
  carried_forward_amount: number;
  expense_amount?: number;
  total_sales?: number;
  calculated_closing_balance?: number;
  actual_closing_balance?: number | null;
  current_cash_balance?: number;
  actual_cash_counted?: number;
  closing_balance: number;
  difference: number;
  opened_by: string;
  closed_by?: string | null;
  opened_at: string;
  closed_at?: string | null;
  note?: string | null;
  closing_notes?: string | null;
}

export interface CashDaySummary {
  cash_day_id: string;
  date: string;
  status: 'OPEN' | 'CLOSED';
  opening_balance: number;
  auto_opening_balance: number;
  manual_opening_adjustment: number;
  
  cash: number;
  terminal: number;
  click: number;
  credit: number;
  credit_collection: number;
  return_amount: number;
  expense: number;
  total_sales: number;
  carried_forward: number;

  cash_inflow: number;
  cash_outflow: number;
  calculated_cash_balance: number;
  actual_closing_balance: number | null;
  difference: number;
  
  orders_count: number;
  transactions_count: number;
}

export interface CashTransaction {
  id: string;
  company_id: string;
  cash_day_id: string;
  transaction_type: string;
  amount: number;
  payment_method: string;
  customer_id?: string | null;
  employee_id?: string | null;
  agent_id?: string | null;
  order_number?: string | null;
  order_id?: string | null;
  source_transaction_id?: string | null;
  external_reference?: string | null;
  description: string;
  created_by: string;
  created_at: string;
  updated_at?: string;
}

export interface DailyOrderEntry {
  id: string;
  company_id: string;
  cash_day_id: string;
  order_number: string;
  order_date: string;
  agent_id?: string | null;
  agent_name?: string;
  customer_id: string;
  customer_name?: string;
  sale_amount: number; // Сумма
  cash_payment?: number; // Оплата (Naqd)
  nasiya_perech?: number; // Насия ва переч (Qarz & perechisleniye)
  nasiyadan_kirim?: number; // Насиядан кирим (Eski qarzdan tushum)
  credit_amount?: number;
  credit_collection?: number;
  return_amount?: number; // Возврать
  carried_forward_amount?: number; // Кун сурилди
  terminal_payment?: number;
  click_payment?: number;
  terminal_click?: number; // Терминал ва клик
  remaining_debt?: number; // Колдик
  cash_amount?: number;
  terminal_amount?: number;
  click_amount?: number;
  status?: string;
  note?: string | null;
  created_by?: string;
  created_at: string;
  updated_at?: string;
}

export interface Product {
  id: string;
  company_id: string;
  external_id?: string | null;
  sku: string;
  code?: string;
  name: string;
  category?: string;
  brand?: string;
  unit: string;
  purchase_cost: number; // Tan narxi
  current_cost: number;
  selling_price: number; // Sotuv narxi
  min_selling_price?: number;
  // Every price of the product in the distribution system (one per price type), as listed there.
  prices?: { type_id: string; name: string; kind: 'sale' | 'purchase'; currency: string | null; price: number }[];
  source?: 'SALESDOC' | 'SMARTUP' | 'LINKO' | '1C' | 'MANUAL';
  stock_quantity?: number;
  is_active: boolean;
  created_at: string;
  updated_at?: string;
}

export interface BalanceSheetReport {
  company_id: string;
  as_of_date: string;
  complete: boolean;
  warnings: string[];
  cashflow?: {
    total_inflow: number;
    total_outflow: number;
    net_flow: number;
    cash_balance: number;
    bank_balance: number | null;
    total_liquid: number | null;
    breakdown?: {
      sales_cash: number;
      credit_collected: number;
      operating_expenses: number;
      salaries_paid: number;
      returns: number;
      bank_deposits?: number; // inkassa: cash handed to the bank (not an outflow, not an expense)
    };
  };
  assets: {
    cash_in_registers: number;
    bank_balances: number | null;
    accounts_receivable: number;
    inventory_value: number;
    total_assets: number | null;
  };
  liabilities: {
    accounts_payable: number | null;
    payroll_liabilities: number;
    customer_prepayments: number;
    total_liabilities: number | null;
  };
  net_equity: number | null;
  indicators: {
    working_capital: number | null;
    current_ratio: number | null;
    debt_to_equity_ratio: number | null;
    cash_ratio: number | null;
  };
}

export interface Customer {
  id: string;
  company_id: string;
  territory_id?: string;
  agent_id?: string;
  name: string;
  code: string;
  phone?: string;
  address?: string;
  credit_limit: number;
  current_balance: number; // positive = qarz
  status: 'ACTIVE' | 'BLOCKED';
  created_at: string;
}

export interface Agent {
  id: string;
  company_id: string;
  full_name: string;
  code: string;
  phone?: string;
  commission_rate: number;
  status: 'ACTIVE' | 'INACTIVE';
  created_at: string;
}

export interface AuditLog {
  id: string;
  company_id: string;
  user_id: string;
  user_email: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'CLOSE' | 'LOGIN' | 'EXPORT' | 'IMPORT' | 'SYNC';
  entity: string;
  entity_id: string;
  old_value: any;
  new_value: any;
  reason: string | null;
  timestamp: string;
}

export interface IntegrationRecord {
  id: string;
  company_id: string;
  provider_type: 'DISTRIBUTION' | 'EXCEL' | 'MANUAL';
  provider_name: string;
  status: 'CONNECTED' | 'DISCONNECTED' | 'ERROR';
  disabled?: boolean;
  config: Record<string, any>;
  last_sync_at?: string | null;
  /** Shown name of the system (SalesDoctor, Linko, …) and what it can do; null for non-distribution integrations. */
  system_name?: string;
  capabilities?: { payments: boolean; visits: boolean; priceTypes: boolean; paymentTypes: boolean; history: boolean } | null;
}

export interface Employee {
  id: string;
  company_id: string;
  user_id?: string | null;
  full_name: string;
  position: string;
  phone?: string;
  salary_type: 'FIXED' | 'PIECEWORK' | 'HYBRID' | 'COMMISSION';
  status: 'ACTIVE' | 'INACTIVE';
  created_at: string;
}

export interface ExpenseCategory {
  id: string;
  company_id: string;
  name: string;
  code?: string;
  description?: string;
  monthly_limit: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type ExpenseStatus = 'DRAFT' | 'CONFIRMED' | 'CANCELLED';

export interface ExpenseAllocation {
  id: string;
  expense_id: string;
  employee_id: string;
  employee_name?: string;
  allocated_amount: number;
  excess_amount?: number;
  allocation_reason?: string;
  created_at: string;
  updated_at: string;
}

export interface EmployeeDailyLimit {
  id: string;
  company_id?: string;
  employee_id: string;
  daily_limit: number;
  effective_from: string;
  effective_to?: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Expense {
  id: string;
  company_id: string;
  date: string;
  category_id: string;
  category_name?: string;
  amount: number;
  payment_method: 'CASH' | 'TERMINAL' | 'CLICK' | 'BANK_TRANSFER' | 'OTHER';
  comment: string;
  description?: string;
  created_by: string;
  creator_name?: string;
  status: ExpenseStatus;
  is_company_expense: boolean;
  cash_day_id?: string | null;
  cash_transaction_id?: string | null;
  allocations?: ExpenseAllocation[];
  created_at: string;
  updated_at: string;
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
  payment_method: string;
}

export interface Salary {
  id: string;
  company_id: string;
  employee_id: string;
  period_month: string;
  base_amount: number;
  bonus_amount?: number;
  deduction_amount?: number;
  piecework_amount?: number;
  final_amount: number;
  status: string;
  created_at: string;
}

export interface DailyFileItem {
  id: string;
  date: string;
  status: 'OPEN' | 'CLOSED';
  register_name: string;
  opened_by_name: string;
  opening_balance: number;
  calculated_closing_balance?: number;
  actual_closing_balance?: number | null;
  closing_balance: number;
  difference: number;
  total_sales: number;
  orders_count: number;
  cash_total: number;
  terminal_total: number;
  click_total: number;
  credit_total: number;
  credit_collections: number;
  expenses_total: number;
  trips_count: number;
  trips_total: number;
  carried_forward_total: number;
  returns_total: number;
  bank_deposits_total?: number;
  note?: string | null;
  opened_at: string;
  closed_at?: string | null;
}

export interface DailyDossierData {
  day: CashDay;
  summary: CashDaySummary;
  orders: DailyOrderEntry[];
  transactions: CashTransaction[];
  expenses: Expense[];
  trips: any[];
  returns: any[];
  masterData: {
    customers: Customer[];
    employees: Employee[];
    agents: any[];
    categories: any[];
    registers: any[];
  };
}

export type NavView = 
  | 'dashboard'
  | 'forecast'
  | 'daily_files'
  | 'cash'
  | 'balance'
  | 'products'
  | 'customers'
  | 'expenses'
  | 'employees'
  | 'reports'
  | 'integrations'
  | 'settings'
  | 'audit'
  | 'crm'
  | 'cabinet'
  | 'attendance'
  | 'jarvis';

export interface StockRunRateItem {
  id: string;
  sku: string;
  name: string;
  category: string;
  unit: string;
  stock_quantity: number;
  purchase_cost: number;
  selling_price: number;
  daily_sales_avg: number;
  effective_daily_sales: number;
  days_remaining: number;
  velocity_days?: number;
  velocity_quantity?: number;
  velocity_sale_days?: number;
  last_sale_date?: string | null;
  confidence?: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
  status: 'OUT_OF_STOCK' | 'CRITICAL' | 'LOW' | 'OPTIMAL' | 'OVERSTOCKED';
  safety_stock: number;
  reorder_quantity: number;
  reorder_cost: number;
  source: string;
}

export interface OutOfStockLostProfitItem {
  id: string;
  sku: string;
  name: string;
  category: string;
  unit: string;
  purchase_cost: number;
  selling_price: number;
  unit_profit: number;
  profit_margin_pct: number;
  daily_sales_avg: number;            // daily sales while the product was in stock
  days_out_of_stock: number | null;   // null: date unknown (never sold, never seen in stock)
  out_of_stock_since: string | null;
  zero_stock_observed_at?: string | null;
  stock_observed_at?: string | null;
  estimate_status?: 'ESTIMATED' | 'STOCKOUT_DATE_UNKNOWN' | 'NO_DEMAND_DATA' | 'PRICE_UNKNOWN';
  last_sale_date: string | null;
  lost_units: number;
  lost_sales_uzs: number;
  lost_profit_uzs: number;
  source: string;
}

/** Elapsed calendar days since the first confirmed zero-stock snapshot. */
export function stockOutLabel(item: { days_out_of_stock: number | null }): string {
  if (item.days_out_of_stock === null || item.days_out_of_stock === undefined) return '0 qoldiq sanasi aniqlanmagan';
  if (item.days_out_of_stock === 0) return '0 qoldiq bugun qayd etildi';
  return `0 qoldiq ${item.days_out_of_stock} kundan beri qayd etilgan`;
}

export interface StockRunRateResponse {
  history?: {complete:boolean;covered:boolean;days:number;covered_days:number;window_from:string;window_to:string;history_from:string|null;status:string|null;orders:number;synced_at:string|null;first_order:string|null;warning:string};
  success: boolean;
  run_rate_factor: number;
  summary: {
    total_products: number;
    in_stock_count: number;
    out_of_stock_count: number;
    critical_count: number;
    low_count: number;
    optimal_count: number;
    avg_days_remaining: number;
    total_stock_value_uzs: number;
    total_reorder_cost_uzs: number;
  };
  items: StockRunRateItem[];
}

export interface OutOfStockResponse {
  success: boolean;
  summary: {
    out_of_stock_count: number;
    total_lost_units: number;
    total_lost_sales_uzs: number;
    total_lost_profit_uzs: number;
    profit_unknown_count?: number; // products whose purchase cost is unknown: their lost profit is not counted
    since_unknown_count?: number;
    estimate_unknown_count?: number;
    window_days?: number;
  };
  items: OutOfStockLostProfitItem[];
}

export interface AIAnalysisResult {
  generated_at: string;
  is_live_ai: boolean;
  model: string;
  executive_summary: string;
  key_findings: {
    category: 'CASH_FLOW' | 'INVENTORY_STOCKOUT' | 'DEBT_RISK' | 'PROFITABILITY';
    title: string;
    description: string;
    severity: 'CRITICAL' | 'WARNING' | 'HEALTHY';
  }[];
  actionable_recommendations: string[];
  metrics_snapshot: {
    daily_sales: number;
    daily_inflow: number;
    daily_outflow: number;
    operating_expenses: number;
    net_profit: number | null;
    net_margin_pct: number | null;
    cash_in_hand: number;
    out_of_stock_count: number;
    total_lost_profit_uzs: number;
    total_lost_sales_uzs: number;
    avg_inventory_days: number;
    total_customer_debt: number;
  };
}

export interface AIAgentChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  actionTriggered?: {
    type: string;
    details?: any;
  };
  actionResult?: any;
}
