/**
 * Distribution Finance System - Core Database Schema & Type Definitions
 * Phase 1: Foundation Layer
 * 
 * Supports 25+ domain entities with relational integrity, multi-tenancy,
 * strict auditability, and distribution software integration adapters.
 */

// Multi-tenant Company
export interface Company {
  id: string;
  name: string;
  tax_id: string; // STIR / INN
  currency: string; // e.g. UZS, USD
  address?: string;
  phone?: string;
  created_at: string;
  updated_at: string;
}

// RBAC: Roles & Permissions
export type RoleName = 'SUPER_ADMIN' | 'ADMIN' | 'CASHIER' | 'AGENT' | 'DELIVERY' | 'EMPLOYEE';

export interface Role {
  id: string;
  company_id: string;
  name: RoleName;
  description: string;
  is_system: boolean;
  created_at: string;
}

export type PermissionModule = 
  | 'cash'
  | 'expense'
  | 'expenses'
  | 'customer'
  | 'balance'
  | 'employee'
  | 'salary'
  | 'piecework'
  | 'sales'
  | 'profit'
  | 'notifications'
  | 'reports'
  | 'integration'
  | 'settings'
  | 'crm';

export type PermissionAction = 
  | 'view'
  | 'create'
  | 'update'
  | 'delete'
  | 'close'
  | 'correct'
  | 'export'
  | 'import'
  | 'confirm'
  | 'cancel'
  | 'approve'
  | 'pay'
  | 'reverse'
  | 'reconcile'
  | 'manage_categories'
  | 'manage_limits'
  | 'manage'
  | 'view_employee_expenses';

export interface Permission {
  id: string;
  module: PermissionModule;
  action: PermissionAction;
  code: string; // e.g. 'cash:view', 'cash:close'
  description: string;
}

export interface RolePermission {
  id: string;
  role_id: string;
  permission_id: string;
}

export interface User {
  id: string;
  company_id: string;
  email: string;
  password_hash: string;
  full_name: string;
  phone?: string;
  status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
  login?: string;                 // staff sign in with a short login (e.g. phone) instead of an email
  employee_id?: string | null;    // the staff card this account belongs to (personal cabinet)
  must_change_password?: boolean; // set for passwords issued by the owner
  last_login_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserRole {
  id: string;
  user_id: string;
  role_id: string;
}

// Territory & Master Records
export interface Territory {
  id: string;
  company_id: string;
  name: string;
  code: string;
  description?: string;
  created_at: string;
}

export interface Employee {
  id: string;
  company_id: string;
  user_id?: string | null;
  full_name: string;
  position: string;
  phone: string;
  salary_type: 'FIXED' | 'PIECEWORK' | 'HYBRID';
  status: 'ACTIVE' | 'INACTIVE';
  created_at: string;
  // Their Telegram account (numeric user id), set by the admin: a round video they post in the couriers' group counts
  // even if they never opened the bot.
  telegram_user_id?: string | null;
  telegram_name?: string | null;
}

export interface Agent {
  source_integration_id?: string | null; // integration the row came from; hidden while that integration is switched off
  external_codes?: string[]; // all provider ids for this agent (SalesDoc may expose SD_id and code_1C separately)
  id: string;
  company_id: string;
  user_id?: string | null;
  employee_id?: string | null;
  code: string;
  full_name: string;
  phone: string;
  territory_id?: string | null;
  commission_rate: number; // percentage
  status: 'ACTIVE' | 'INACTIVE';
  created_at: string;
}

export interface Customer {
  source_integration_id?: string | null; // integration the row came from; hidden while that integration is switched off
  id: string;
  company_id: string;
  external_id?: string | null;
  territory_id?: string | null;
  agent_id?: string | null;
  delivery_id?: string | null;
  name: string;
  code: string;
  phone: string;
  address?: string;
  credit_limit: number;
  credit_limit_enabled?: boolean;
  debt_alert_threshold?: number;
  current_balance: number; // Derived/cached: Positive = customer owes us (debt), Negative = advance
  status: 'ACTIVE' | 'BLOCKED';
  comment?: string | null;
  is_active: boolean;
  // CRM
  tags?: string[];
  owner_user_id?: string | null;  // responsible staff member
  contacts?: { name: string; phone?: string; role?: string }[];
  created_at: string;
  updated_at?: string;
}

// CRM: tasks, contact log, sales pipeline. Generic for any business: stages are configured per company.
export interface CrmTask {
  id: string;
  company_id: string;
  title: string;
  description?: string | null;
  assignee_user_id: string;
  created_by: string;
  customer_id?: string | null;
  deal_id?: string | null;
  due_date?: string | null;       // YYYY-MM-DD
  priority: 'LOW' | 'NORMAL' | 'HIGH';
  status: 'OPEN' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';
  completed_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CrmActivity {
  id: string;
  company_id: string;
  customer_id?: string | null;
  deal_id?: string | null;
  type: 'CALL' | 'VISIT' | 'MEETING' | 'MESSAGE' | 'NOTE';
  result: 'REACHED' | 'NO_ANSWER' | 'INTERESTED' | 'NOT_INTERESTED' | 'ORDER' | 'PAYMENT_PROMISE' | 'COMPLAINT' | 'OTHER';
  note: string;
  next_step?: string | null;
  next_action_date?: string | null; // creates a follow-up task
  follow_up_task_id?: string | null;
  user_id: string;
  created_at: string;
}

export interface CrmStage {
  id: string;
  company_id: string;
  name: string;
  sort_order: number;
  probability: number;            // 0–100, for the weighted pipeline value
  kind: 'OPEN' | 'WON' | 'LOST';
  created_at: string;
}

export interface CrmDeal {
  id: string;
  company_id: string;
  title: string;
  customer_id?: string | null;
  // A lead that is not a customer yet
  contact_name?: string | null;
  contact_phone?: string | null;
  company_name?: string | null;
  source?: string | null;
  amount: number;
  stage_id: string;
  status: 'OPEN' | 'WON' | 'LOST';
  owner_user_id: string;
  expected_close_date?: string | null;
  lost_reason?: string | null;
  note?: string | null;
  closed_at?: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

// Cash Management (Kassa)
export interface CashRegister {
  id: string;
  company_id: string;
  name: string;
  code: string;
  currency: string;
  status: 'ACTIVE' | 'INACTIVE';
  created_at: string;
}

export type CashDayStatus = 'OPEN' | 'CLOSED';

export interface CashDay {
  id: string;
  company_id: string;
  register_id: string;
  date: string; // YYYY-MM-DD - Unique with company_id
  status: CashDayStatus;
  
  // Balances and financial flow indicators
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
  calculated_closing_balance: number;
  actual_closing_balance?: number | null;
  closing_balance: number;
  difference: number; // Expected vs Actual cash at closing

  opened_by: string; // user_id
  closed_by?: string | null;
  opened_at: string;
  closed_at?: string | null;
  note?: string | null;
  closing_notes?: string | null;
  created_at: string;
  updated_at: string;
}

export type TransactionType =
  | 'SALE_PAYMENT'
  | 'CREDIT_SALE'
  | 'CREDIT_COLLECTION'
  | 'RETURN'
  | 'CARRIED_FORWARD'
  | 'EXPENSE'
  | 'SALARY_PAYMENT'
  | 'TRANSFER_IN'
  | 'TRANSFER_OUT'
  | 'ADJUSTMENT';

export type PaymentMethod =
  | 'CASH'
  | 'TERMINAL'
  | 'CLICK'
  | 'BANK_TRANSFER'
  | 'OTHER';

export interface CashTransaction {
  id: string;
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
  source_transaction_id?: string | null; // For CARRIED_FORWARD origin tracking
  external_reference?: string | null;
  // BANK_DEPOSIT: cash handed to the bank (inkassa). Money changes place, it is not spent: never an expense.
  transfer_kind?: 'BANK_DEPOSIT' | null;
  bank_name?: string | null;
  bank_fee_expense_id?: string | null; // the bank's commission, booked as a company expense
  description: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

// Daily Order / Sale Entry Composite Model (Aligned with Distribution Reestr)
export interface DailyOrderEntry {
  integration_id?: string;
  external_order_id?: string;
  customer_ref?: Record<string, string>;
  order_ref?: Record<string, string>;
  payment_type_ref?: Record<string, string>;
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
  uy_oplata?: number; // Legacy storage only; the app no longer accepts or counts this unsupported payment type.
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
  entry_kind?: 'DEBT_COLLECTION';   // debt payment accepted in the Customers section (no sale, no order)
  note?: string | null;
  created_by?: string;
  created_at: string;
  updated_at?: string;
}

// Customer Balances & Payments
export interface Payment {
  id: string;
  company_id: string;
  customer_id: string;
  amount: number;
  payment_method: PaymentMethod;
  cash_transaction_id?: string | null;
  reference_number?: string | null;
  date: string;
  notes?: string;
  created_by: string;
  created_at: string;
}

export type CustomerLedgerType = 
  | 'SALE'
  | 'CREDIT_SALE'
  | 'PAYMENT'
  | 'CASH_PAYMENT'
  | 'TERMINAL_PAYMENT'
  | 'CLICK_PAYMENT'
  | 'BANK_TRANSFER_PAYMENT'
  | 'RETURN'
  | 'CREDIT_COLLECTION'
  | 'CARRIED_FORWARD'
  | 'ADJUSTMENT_IN'
  | 'ADJUSTMENT_OUT'
  | 'OPENING_BALANCE'
  | 'WRITE_OFF';

export interface CustomerBalanceTransaction {
  source_integration_id?: string | null; // integration the row came from; hidden while that integration is switched off
  id: string;
  company_id: string;
  customer_id: string;
  transaction_type: 'DEBIT' | 'CREDIT'; // DEBIT = increased debt, CREDIT = paid/decreased debt
  ledger_type?: CustomerLedgerType;
  debit_amount?: number;
  credit_amount?: number;
  amount: number;
  currency?: string;
  payment_method?: PaymentMethod | string;
  balance_after: number;
  reference_type: 'SALE' | 'PAYMENT' | 'RETURN' | 'ADJUSTMENT' | 'CARRIED_FORWARD' | 'OPENING';
  reference_id: string;
  external_id?: string | null;
  source_system?: string; // 'INTERNAL', '1C', 'SMARTUP', 'EXCEL'
  comment?: string | null;
  date: string;
  transaction_date?: string;
  age_unknown?: boolean; // opening balance whose real origin date is unknown (excluded from "days overdue")
  status?: 'CONFIRMED' | 'PENDING' | 'REVERSED';
  created_by?: string;
  created_at: string;
  updated_at?: string;
}

export interface Return {
  id: string;
  company_id: string;
  customer_id: string;
  agent_id?: string | null;
  cash_day_id?: string | null;
  order_id?: string | null;
  order_reference?: string | null;
  amount: number;
  date: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  reason: string;
  payment_impact: 'CASH_REFUND' | 'BALANCE_CREDIT';
  external_reference?: string | null;
  created_by: string;
  created_at: string;
}

// Expenses
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

export interface ExpenseLimit {
  id: string;
  company_id: string;
  category_id: string;
  period: 'DAILY' | 'WEEKLY' | 'MONTHLY';
  max_amount: number;
  current_usage: number;
  is_active: boolean;
}

export type ExpenseStatus = 'DRAFT' | 'CONFIRMED' | 'CANCELLED';

export interface Expense {
  id: string;
  company_id: string;
  date: string; // YYYY-MM-DD
  category_id: string;
  amount: number; // positive integer minor unit / sum
  payment_method: PaymentMethod;
  comment: string;
  description?: string; // backwards compatibility alias
  created_by: string; // user_id
  status: ExpenseStatus;
  is_company_expense: boolean;
  cash_day_id?: string | null;
  cash_transaction_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExpenseAllocation {
  id: string;
  expense_id: string;
  employee_id: string;
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
  effective_from: string; // YYYY-MM-DD
  effective_to?: string | null; // YYYY-MM-DD
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// Salary & Piecework (Foundation Schemas)
export interface Salary {
  id: string;
  company_id: string;
  employee_id: string;
  period_month: string; // YYYY-MM
  base_amount: number;
  bonus_amount: number;
  deduction_amount: number;
  piecework_amount: number;
  final_amount: number;
  status: 'DRAFT' | 'APPROVED' | 'PAID';
  paid_at?: string | null;
  created_at: string;
}

/** A unit of recorded work: a day, a delivery trip, a piece, an hour, or anything else the company counts. */
export type WorkUnit = 'DAY' | 'TRIP' | 'PIECE' | 'HOUR' | 'OTHER';

/**
 * One part of an employee's pay; an employee may have any mix of them.
 * MONTHLY: fixed sum. DAILY / PER_UNIT: rate × recorded work (days, trips, pieces, hours).
 * PERCENT: share of a sales base for the month (the agent's own sales, all company sales, or deliveries by the expeditor).
 */
export type PayComponent =
  | { type: 'MONTHLY'; amount: number; label?: string }
  | { type: 'DAILY'; rate: number; label?: string }
  | { type: 'PER_UNIT'; unit: Exclude<WorkUnit, 'DAY'>; rate: number; label?: string }
  | { type: 'PERCENT'; percent: number; base: 'OWN_SALES' | 'COMPANY_SALES' | 'OWN_DELIVERIES'; agent_id?: string | null; expeditor_name?: string | null; label?: string };

export interface SalaryRule {
  id: string;
  company_id: string;
  employee_id: string;
  rule_type?: 'FIXED' | 'HOURLY' | 'KPI_TIERED';
  salary_type?: string;
  base_salary: number;
  components?: PayComponent[]; // when set, the whole pay scheme; base_salary then mirrors the MONTHLY part
  formula_config?: Record<string, any>;
  kpi_target_amount?: number;
  kpi_bonus_percent?: number;
  is_active: boolean;
  created_at?: string;
}

export interface PieceworkRule {
  id: string;
  company_id: string;
  product_category: string;
  rate_per_unit: number;
  rule_type?: string;
  unit_name?: string;
  is_active: boolean;
  created_at?: string;
}

export interface PieceworkTransaction {
  id: string;
  company_id: string;
  employee_id: string;
  unit_type?: WorkUnit;      // missing on older rows: those were delivery trips
  units_completed: number;
  rate_applied: number;
  total_amount: number;
  date: string;
  zone_name?: string;
  description?: string;
  created_by?: string;
  status: 'PENDING' | 'VERIFIED';
  created_at: string;
}

// Audit Trail Infrastructure
export type AuditAction = 
  | 'CREATE' 
  | 'UPDATE' 
  | 'DELETE' 
  | 'CLOSE' 
  | 'LOGIN' 
  | 'EXPORT' 
  | 'IMPORT'
  | 'SYNC'
  | 'CONFIRM'
  | 'CANCEL'
  | 'CORRECT'
  | 'APPROVE'
  | 'PAY'
  | 'CATEGORY_CREATE'
  | 'CATEGORY_UPDATE'
  | 'LIMIT_UPDATE'
  | 'ALLOCATION_UPDATE';

export interface AuditLog {
  id: string;
  company_id: string;
  user_id: string;
  user_email: string;
  action: AuditAction;
  entity: string;
  entity_id: string;
  old_value: string | null; // JSON serialized
  new_value: string | null; // JSON serialized
  reason: string | null;
  timestamp: string;
}

// External Integrations & Adapters
export type IntegrationProviderType = 'DISTRIBUTION' | 'EXCEL' | 'MANUAL';

export interface Integration {
  id: string;
  company_id: string;
  provider_type: IntegrationProviderType;
  provider_name: string; // e.g. '1C_ENTERPRISE', 'SMARTUP', 'EXCEL_CONNECTOR'
  status: 'CONNECTED' | 'DISCONNECTED' | 'ERROR';
  disabled?: boolean;      // switched off by the user: stays DISCONNECTED (settings kept) until switched on again
  config: Record<string, any>;
  last_sync_at?: string | null;
  created_at: string;
}

export interface IntegrationTransaction {
  id: string;
  company_id: string;
  integration_id: string;
  external_id: string;
  entity_type: 'ORDER' | 'PAYMENT' | 'CUSTOMER' | 'RETURN';
  // CANCEL_REQUIRED: sent, then set to 0 or deleted in the cash register; the API cannot delete a payment, so it must be
  // deleted by hand in the distribution system. CANCELLED: confirmed gone there (or never sent).
  status: 'PENDING' | 'PROCESSED' | 'FAILED' | 'SENDING' | 'UNCERTAIN' | 'CANCEL_REQUIRED' | 'CANCELLED';
  payload: Record<string, any>;
  previous_payload?: Record<string, any> | null; // what was in the distribution system before an edit was sent
  refused?: boolean | null;  // the system answered "no" (nothing recorded there), unlike a missing answer
  error_message?: string | null;
  processed_at?: string | null;
  created_at: string;
}

export interface ExternalOrder {
  id: string;
  company_id: string;
  integration_id: string;
  external_order_id: string;
  customer_external_id: string;
  total_amount: number;
  status: string;
  order_date: string;
  synced_at: string;
}

export interface ExternalCustomer {
  id: string;
  company_id: string;
  integration_id: string;
  external_code: string;
  name: string;
  phone?: string;
  balance: number;
  synced_at: string;
}

export interface ExternalPayment {
  id: string;
  company_id: string;
  integration_id: string;
  external_payment_id: string;
  amount: number;
  payment_date: string;
  status: string;
  synced_at: string;
}

export interface ExternalReturn {
  id: string;
  company_id: string;
  integration_id: string;
  external_return_id: string;
  amount: number;
  return_date: string;
  status: string;
  synced_at: string;
}

// Phase 7: Product Master, Sales, COGS & Profit
export interface Product {
  source_integration_id?: string | null; // integration the row came from; hidden while that integration is switched off
  id: string;
  company_id: string;
  external_id?: string | null;
  sku: string;
  code?: string;
  name: string;
  category?: string;
  brand?: string;
  unit: string; // 'dona', 'kg', 'quti', etc.
  purchase_cost: number; // integer minor unit
  current_cost: number; // integer minor unit
  selling_price: number; // integer minor unit
  min_selling_price?: number;
  // Every price of the product in the distribution system, one per price type, as listed there.
  prices?: { type_id: string; name: string; kind: 'sale' | 'purchase'; currency: string | null; price: number }[];
  stock_quantity?: number;
  daily_sales_avg?: number;
  // How daily_sales_avg was derived (see ForecastService.calculateHistoricalSalesVelocity)
  velocity_days?: number;          // calendar days actually covered by loaded history
  velocity_quantity?: number;      // delivered quantity in those days
  velocity_sale_days?: number;     // days with at least one delivery
  first_sale_date?: string | null;
  last_sale_date?: string | null;
  velocity_confidence?: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
  out_of_stock_days?: number;   // legacy, not used: see ForecastService.outOfStockSince
  out_of_stock_date?: string;   // legacy, not used
  last_in_stock_at?: string | null; // last business date an import saw stock > 0
  zero_stock_observed_at?: string | null; // first date an inventory sync confirmed zero after stock was previously positive
  stock_observed_at?: string | null; // last date this stock quantity was confirmed by inventory sync/user entry
  min_stock_level?: number;
  source?: 'SALESDOC' | 'SMARTUP' | 'LINKO' | '1C' | 'MANUAL';
  is_active: boolean;
  created_at: string;
  updated_at?: string;
}

export interface SalesOrderItem {
  source_integration_id?: string | null; // integration the row came from; hidden while that integration is switched off
  id: string;
  sales_order_id: string;
  product_id: string;
  product_name: string;
  sku?: string;
  quantity: number;
  unit_price: number;
  unit_cost: number; // COGS base
  total_amount: number;
  total_cogs: number;
  discount_amount?: number;
}

export interface SalesOrder {
  source_integration_id?: string | null; // integration the row came from; hidden while that integration is switched off
  id: string;
  company_id: string;
  external_id?: string | null;
  order_number: string;
  order_date: string; // YYYY-MM-DD
  delivery_date?: string | null;
  customer_id: string;
  customer_name: string;
  agent_id?: string | null;
  external_agent_code?: string | null; // original distributor agent id, retained so history can be remapped
  expeditor_name?: string | null; // who delivered it, as the distribution system names them (percent-of-deliveries pay)
  territory_id?: string | null;
  delivery_id?: string | null;
  total_sales: number; // Gross sales
  discount_amount: number;
  return_amount: number;
  net_sales: number; // total_sales - discount - return
  total_cogs: number; // Cost of goods sold (only the part with a known cost)
  // KNOWN: every line has a real cost. Missing = legacy estimate, treated as UNKNOWN by reports.
  cogs_status?: 'KNOWN' | 'PARTIAL' | 'UNKNOWN';
  gross_profit: number; // net_sales - total_cogs
  payment_type: 'CASH' | 'TERMINAL' | 'CLICK' | 'BANK_TRANSFER' | 'CREDIT' | 'SPLIT';
  status: 'DELIVERED' | 'PENDING' | 'CANCELLED';
  source: 'MANUAL' | 'EXCEL' | 'DISTRIBUTION';
  created_by?: string;
  created_at: string;
  updated_at?: string;
}

// Phase 8: Notification Architecture & Telegram Bot
export type NotificationEventType = 
  | 'DEBT_THRESHOLD_EXCEEDED'
  | 'CREDIT_LIMIT_EXCEEDED'
  | 'PAYMENT_SYNC_FAILURE'
  | 'DISTRIBUTION_SYNC_FAILURE'
  | 'RETURN_MISMATCH'
  | 'CASH_CLOSING_DISCREPANCY'
  | 'STOCKOUT_WARNING'
  | 'LOST_PROFIT_ALERT'
  | 'SYSTEM_ERROR'
  | 'DAILY_REPORT'      // end-of-day summary at the hour set on the bot
  | 'CASH_DAY_CLOSED'   // a cash day was closed (with its totals)
  | 'ATTENDANCE_LATE';  // an employee checked in late (Face ID)

export interface NotificationEvent {
  id: string;
  company_id: string;
  event_type: NotificationEventType;
  title: string;
  message: string;
  data: Record<string, any>;
  agent_id?: string | null;
  customer_id?: string | null;
  created_at: string;
}

export interface NotificationChannel {
  id: string;
  company_id: string;
  channel_type: 'TELEGRAM' | 'EMAIL' | 'SMS' | 'IN_APP';
  name: string;
  is_active: boolean;
  config: {
    bot_token?: string;
    chat_id?: string;
    topic_id?: string;
    [key: string]: any;
  };
  created_at: string;
  updated_at?: string;
}

export interface NotificationRule {
  id: string;
  company_id: string;
  event_type: NotificationEventType;
  channel_id: string;
  is_active: boolean;
  filter_config?: Record<string, any>;
  created_at: string;
}

export interface Notification {
  id: string;
  company_id: string;
  event_id?: string | null;
  channel_id?: string | null;
  channel_type: 'TELEGRAM' | 'EMAIL' | 'SMS' | 'IN_APP';
  title: string;
  content: string;
  status: 'PENDING' | 'SENT' | 'FAILED';
  error_message?: string | null;
  attempt_count: number;
  last_attempt_at?: string | null;
  recipient?: string;
  created_at: string;
  sent_at?: string | null;
  // A personal reminder: sent to this private chat instead of the bot's group chat.
  personal_chat_id?: string | null;
  personal_type?: StaffReminderType | null;
  staff_key?: string | null;
}

/** Reminders an employee gets in their own Telegram chat. */
export type StaffReminderType =
  | 'CHECKIN_REMINDER'  // shortly before the start deadline, if work has not been started yet
  | 'CHECKIN_MISSED'    // the deadline has passed and work has not been started
  | 'LATE'              // started late: minutes and what it costs by the rules
  | 'VIOLATION'         // a manager recorded a violation (or cancelled one)
  | 'SALARY_PAID'       // salary paid
  | 'TASK_ASSIGNED'     // a task was given to them
  | 'TASK_DUE'          // morning: tasks due today or overdue
  | 'AGENT_DEBTS';      // morning, agents: their customers' debts

/**
 * One person's Telegram for personal reminders: an employee (or a user without an employee card, like the owner).
 * The person opens t.me/<bot>?start=<code>; the code is replaced after every use so a forwarded link is useless.
 */
export interface StaffTelegram {
  id: string;                 // `${company_id}:emp:<employee_id>` or `${company_id}:user:<user_id>`
  company_id: string;
  employee_id?: string | null;
  user_id?: string | null;
  code: string;
  chat_id?: string | null;
  chat_name?: string | null;
  linked_at?: string | null;
  blocked_at?: string | null; // the person blocked the bot: nothing is sent until they press /start again
  muted?: StaffReminderType[];
}

// ---- Face ID attendance (field staff: selfie + liveness + GPS) ----

/** An employee's enrolled face: 128-number face descriptors (no photo). Encrypted on disk (biometric data). */
export interface FaceProfile {
  id: string;
  company_id: string;
  employee_id: string;
  descriptors: number[][];
  consent_at: string;          // written consent recorded (date the employee agreed)
  consent_by: string;          // who recorded it
  enrolled_at: string;
  enrolled_by: string;
  updated_at?: string;
  // Reference portrait (face-photos/<employee>.jpg): kept until the super admin replaces or removes the profile.
  photo_file?: string | null;
  source?: 'CAMERA' | 'PHOTO';
}

export type WorkSchedule = { start: string; end: string; grace_minutes: number; workdays: number[] }; // workdays: 1=Mon … 7=Sun

/**
 * A group of staff with one start window (e.g. warehouse 07:30–10:00, agents 08:00–09:30): starting after `start_to`
 * is late. `source`: where the start time comes from — a Face ID arrival, or the agent's first visit in SalesDoc.
 */
/** Where an employee's start of work comes from: Face ID, the first visit in the distribution system, or a round video in the Telegram group. */
export type StartSource = 'FACE_ID' | 'SALESDOC_VISIT' | 'TELEGRAM_VIDEO';
export interface WorkGroup { id: string; name: string; start_from: string; start_to: string; end: string; workdays: number[]; source: StartSource }

export type ViolationType = 'LATE' | 'ABSENT' | 'NASIYA_MISUSE' | 'TASK_LATE' | 'OTHER';

/**
 * A discipline rule: each occurrence in a month costs `percent` of that month's earned salary, and they add up.
 * `threshold` / `percent_after` are from an earlier step rule and no longer used. LATE and ABSENT are found automatically.
 */
export interface DisciplineRule { type: ViolationType; label: string; percent: number; threshold: number; percent_after: number; active: boolean; excuses_allowed: boolean }

/** A violation entered by a manager (nasiya misuse, task not done, …) or an automatic one cancelled by hand. */
export interface DisciplineViolation {
  id: string;
  company_id: string;
  employee_id: string;
  date: string;
  type: ViolationType;
  note: string;
  created_by: string;
  created_at: string;
  cancelled_at?: string | null;
  cancelled_by?: string | null;
  cancel_reason?: string | null;
}

/** The first SalesDoc visit of an agent on a day: when the agent started work. */
export interface AgentVisitDay { id: string; company_id: string; agent_id: string; date: string; first_visit: string; visits: number; synced_at: string }

export interface AttendanceSettings {
  id: string;
  company_id: string;
  default_schedule: WorkSchedule;
  schedules: Record<string, WorkSchedule>; // per employee_id
  /** Admin-set start-time exception for a specific employee, applied over their group's schedule. */
  employee_start_times?: Record<string, string>;
  /** Admin-set later/alternate start time for one employee on one exact calendar day. */
  employee_day_start_times?: Record<string, Record<string, string>>;
  // RULES: percent of the month's earned salary by the discipline rules below (company rule book).
  penalty: { mode: 'NONE' | 'FIXED' | 'PER_MINUTE' | 'RULES'; amount: number; early_leave: boolean; monthly_cap: number };
  rules?: DisciplineRule[];
  groups?: WorkGroup[];
  /** Telegram group ID that records round-video attendance for each work group. */
  checkin_groups?: Record<string, string>;
  /** Dedicated Telegram group ID for each employee/agent who posts a separate round video. */
  checkin_employee_groups?: Record<string, string>;
  employee_groups?: Record<string, string>;   // employee_id -> group id
  agent_links?: Record<string, string>;       // employee_id -> agents.id (SalesDoc agent) for SALESDOC_VISIT groups
  employee_methods?: Record<string, StartSource>; // per employee: how they mark the start (overrides the group's way)
  // Google Sheets: every start of work is appended to a sheet through the company's Apps Script web app.
  sheets?: { enabled: boolean; url: string; token: string; last_sent_at?: string | null; last_error?: string | null };
  // Each violation posted to a Telegram group by the staff bot: the work group's chat, or an employee's own chat
  // (e.g. every agent has a group of their own, the couriers share one). Only violations from `since` on are posted.
  penalty_posts?: { enabled: boolean; since: string; groups: Record<string, string>; employees: Record<string, string> };
  // active false = switched off for now; employee_ids empty = everyone may check in there, else only those listed.
  zones: { id: string; name: string; lat: number; lng: number; radius_m: number; active?: boolean; employee_ids?: string[]; address?: string }[];
  require_zone: boolean;       // a check outside every zone goes to review
  match_threshold: number;     // max face distance accepted (lower = stricter); 0.45 by default
  store_photos: boolean;       // keep a small selfie of each check for disputes
  updated_at?: string;
}

/**
 * A sales team: one distribution-system agent profile is shared by several people, each selling a set of product
 * categories. The team is defined by its categories; members name the person of each agent profile in this team.
 */
export interface SalesTeam {
  id: string;
  company_id: string;
  name: string;                       // "1-Komanda"
  categories: string[];               // product categories this team sells (each category belongs to one team)
  members: Record<string, string>;    // agent_id -> person's name in this team (optional)
  member_employees?: Record<string, string>; // agent_id -> employee of this team on that profile (a shared profile = several employees)
  sort: number;
  created_at: string;
  updated_at?: string;
}

/** The AI's current growth strategy for an agent (kept up to date automatically), with a short history. */
export interface AgentStrategyRecord {
  id: string;                          // `${company_id}|${agent_id}`
  company_id: string;
  agent_id: string;
  periods: { a: { from: string; to: string }; b: { from: string; to: string } };
  strategy: any;
  model: string;
  signature: string;                   // the numbers it was written from; a change triggers a new one
  generated_at: string;
  history: { generated_at: string; verdict: string; score: number | null; sales_b: number }[];
}

/** A row waiting to be appended to the company's Google Sheet (one per employee per day). */
export interface SheetRow { id: string; company_id: string; sheet: string; values: (string | number)[]; status: 'PENDING' | 'SENT' | 'FAILED'; attempts: number; last_error?: string | null; last_attempt_at?: string | null; created_at: string; sent_at?: string | null }

export interface AttendanceEvent {
  id: string;
  company_id: string;
  employee_id: string;
  type: 'IN' | 'OUT';
  at: string;                  // ISO time on the server when received
  date: string;                // business date (Tashkent)
  lat?: number | null;
  lng?: number | null;
  accuracy_m?: number | null;
  zone_id?: string | null;
  zone_distance_m?: number | null;
  face_distance?: number | null;
  liveness_passed: boolean;
  liveness_steps?: string[];
  photo_file?: string | null;  // relative to the data folder
  status: 'ACCEPTED' | 'REVIEW' | 'REJECTED';
  review_reason?: string | null;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  excused?: boolean;           // the manager excused lateness / early leave for this day
  device?: string | null;
  created_by: string;          // user who checked in
  method?: 'FACE_ID' | 'TELEGRAM_VIDEO';
  telegram?: { chat_id: string; message_id: number; file_id?: string; duration?: number } | null;
}

// Migrations tracking
export interface MigrationRecord {
  id: string;
  name: string;
  applied_at: string;
}

// Full Database Schema Shape
// Jarvis: business assistant (Claude) that reads the books through tools and keeps a log of what it did.
export interface JarvisConversation {
  id: string;
  company_id: string;
  user_id: string;
  title: string;
  messages: any[];                       // Claude message list (user / assistant blocks, tool_use, tool_result)
  created_at: string;
  updated_at: string;
}

export interface JarvisAction {
  id: string;
  company_id: string;
  user_id: string;
  conversation_id: string;
  tool_use_id: string;
  tool: string;
  input: any;
  risk: 'read' | 'write';
  summary: string;
  status: 'DONE' | 'FAILED';
  error?: string | null;
  created_at: string;
}

export interface JarvisSettings {
  id: string;                            // = company_id
  company_id: string;
  provider?: 'anthropic' | 'openai' | 'gemini' | 'openai_compatible'; // missing = anthropic (first version)
  api_key_enc?: string | null;           // AI service key, AES-256-GCM; never sent to the browser
  model: string;
  base_url?: string | null;              // OpenAI-compatible services (DeepSeek, Groq, OpenRouter, Ollama…)
  voice_provider?: 'browser' | 'azure' | 'openai';
  voice_key_enc?: string | null;
  voice_region?: string | null;          // Azure region, e.g. westeurope
  voice_gender?: 'female' | 'male';
  auto_briefing?: boolean;               // prepare the morning briefing at 08:00 by itself
  last_briefing_date?: string | null;
  obsidian_vault?: string | null;        // folder of the Obsidian vault Jarvis fills and searches (on this computer)
  obsidian_auto?: boolean;               // refresh the business notes every hour
  obsidian_last_sync?: string | null;
  obsidian_last_error?: string | null;
  updated_at: string;
}

/** Long-term memory of Jarvis: facts and preferences the owner told it or it learned (shown and editable). */
export interface JarvisMemory {
  id: string;
  company_id: string;
  user_id: string;
  text: string;
  created_at: string;
}

export interface DatabaseSchema {
  companies: Company[];
  roles: Role[];
  permissions: Permission[];
  role_permissions: RolePermission[];
  users: User[];
  user_roles: UserRole[];
  employees: Employee[];
  agents: Agent[];
  customers: Customer[];
  territories: Territory[];
  cash_registers: CashRegister[];
  cash_days: CashDay[];
  cash_transactions: CashTransaction[];
  daily_order_entries: DailyOrderEntry[];
  payments: Payment[];
  customer_balance_transactions: CustomerBalanceTransaction[];
  returns: Return[];
  expenses: Expense[];
  expense_categories: ExpenseCategory[];
  expense_limits: ExpenseLimit[];
  expense_allocations: ExpenseAllocation[];
  employee_daily_limits: EmployeeDailyLimit[];
  salaries: Salary[];
  salary_rules: SalaryRule[];
  piecework_rules: PieceworkRule[];
  piecework_transactions: PieceworkTransaction[];
  products: Product[];
  sales_orders: SalesOrder[];
  sales_order_items: SalesOrderItem[];
  notification_events: NotificationEvent[];
  notification_channels: NotificationChannel[];
  notification_rules: NotificationRule[];
  notifications: Notification[];
  audit_logs: AuditLog[];
  integrations: Integration[];
  integration_transactions: IntegrationTransaction[];
  external_orders: ExternalOrder[];
  external_customers: ExternalCustomer[];
  external_payments: ExternalPayment[];
  external_returns: ExternalReturn[];
  crm_tasks: CrmTask[];
  crm_activities: CrmActivity[];
  crm_stages: CrmStage[];
  crm_deals: CrmDeal[];
  jarvis_conversations: JarvisConversation[];
  jarvis_actions: JarvisAction[];
  jarvis_settings: JarvisSettings[];
  jarvis_memories: JarvisMemory[];
  face_profiles: FaceProfile[];
  attendance_events: AttendanceEvent[];
  attendance_settings: AttendanceSettings[];
  discipline_violations: DisciplineViolation[];
  agent_visit_days: AgentVisitDay[];
  staff_telegram: StaffTelegram[];
  sheet_rows: SheetRow[];
  sales_teams: SalesTeam[];
  agent_strategies: AgentStrategyRecord[];
  // Rows taken out of the books by a repair (kept, never deleted): { id, table, reason, row, moved_at }
  _quarantine: { id: string; table: string; reason: string; row: any; moved_at: string }[];
  _migrations: MigrationRecord[];
}
