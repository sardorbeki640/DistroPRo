/**
 * Integration Architecture - Adapter Pattern Interfaces
 * 
 * Isolates core domain logic from external distribution systems (1C, Smartup, Jowi, Excel, etc.)
 */

export interface ExternalSyncOrder {
  externalId: string;
  orderNumber: string;
  customerRef?: Record<string, string>;
  orderRef?: Record<string, string>;
  paymentTypeRef?: Record<string, string>;
  customerCode: string;
  customerName: string;
  totalAmount: number;     // net of returns (SalesDoc totals already exclude returned goods)
  returnAmount?: number;   // goods returned against this order (SalesDoc totalReturnsSumma)
  status: string;
  orderDate: string;
  deliveryDate?: string;
  itemsCount: number;
  agentName?: string;
  agentCode?: string;
  expeditorName?: string;
  items?: Array<{              // undefined = lines not loaded (kept as stored); [] = order has no lines
    sku: string;
    name: string;
    quantity: number;
    price: number;
    total: number;
  }>;
}

/** A customer ledger movement read from the distribution system (sale debt, payment, return). */
export interface ExternalLedgerEntry {
  externalId: string;
  customerCode: string;
  customerName: string;
  date: string;              // YYYY-MM-DD
  amount: number;            // > 0 lowers the debt (payment, return), < 0 raises it (sale)
  kind: 'SALE' | 'PAYMENT' | 'RETURN' | 'OTHER';
  paymentMethod?: string;
  orderExternalId?: string | null;
  comment?: string | null;
}

export interface ExternalSyncCustomer {
  externalCode: string;
  name: string;
  phone?: string;
  address?: string;
  balance: number;
  agentCode?: string;
  agentName?: string;
  isActive?: boolean;
  territory?: string;   // territory / region name as the distribution system calls it
}

export interface ExternalSyncEmployee {
  externalId: string;
  name: string;
  role: 'AGENT' | 'EXPEDITOR' | 'SUPERVISOR' | 'OPERATOR' | 'MANAGER';
  phone?: string;
  address?: string;
  login?: string;
  code_1C?: string;
  commissionRate?: number;
}

export interface ExternalSyncPayment {
  externalPaymentId: string;
  customerCode: string;
  amount: number;
  paymentMethod: string;
  paymentDate: string;
}

export interface SyncResult {
  provider: string;
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED';
  recordsImported: number;
  recordsFailed: number;
  errors?: string[];
  syncedAt: string;
  details?: Record<string, any>;
}

export interface ExportDataPayload {
  companyId: string;
  startDate: string;
  endDate: string;
  type: 'CASH_REPORT' | 'TRANSACTIONS' | 'CUSTOMER_BALANCES' | 'EXPENSES' | 'PRICE_UPDATE' | 'PAYMENT_PUSH' | 'BALANCE_SYNC';
  data: any[];
}

/**
 * A customer payment sent from the cash register to the distribution system. `ref` is ours and stable for the same
 * cash row and method: sending it again must update that payment there, never add a second one.
 */
export interface OutgoingPayment {
  code_1C: string;                       // our stable reference (named after SalesDoc's field; any system maps it)
  amount: number;
  paymentDate: string;                   // 'YYYY-MM-DD HH:MM:SS'
  client: Record<string, string>;        // the customer's reference in that system
  paymentType: Record<string, string>;   // the payment type chosen in the integration settings
  order?: Record<string, string>;
  comment: string;
}
/** A payment as read back from the distribution system (to confirm, detect copies and deletions). */
export interface RemotePayment { code_1C?: string; amount: number; comment?: string; client?: Record<string, string> }

/** One visit of an agent at a customer (start of work = the first of the day). */
export interface ExternalVisit { agentCode: string; start: string } // start 'YYYY-MM-DD HH:MM'

export interface ExternalPriceType { id: string; name: string; kind: 'sale' | 'purchase'; active: boolean; currency?: string | null }
export interface ExternalPaymentType { id: string; name: string; active: boolean }

/** What a connected system can do beyond importing; the rest of the program asks for these, never for a system by name. */
export interface DistributionCapabilities {
  payments: boolean;      // postPayment + listDayPayments
  visits: boolean;        // importVisits
  priceTypes: boolean;    // listPriceTypes (selling / purchase price chosen in settings)
  paymentTypes: boolean;  // listPaymentTypes
  history: boolean;       // order history month by month (SalesDocHistoryService)
  historicalStock: boolean; // dated inventory snapshots for exact stock-out dating
}

export interface IntegrationAdapter {
  readonly providerName: string;
  readonly providerType: 'DISTRIBUTION' | 'EXCEL' | 'MANUAL';
  /** Name shown to people (e.g. "SalesDoctor", "Linko"). */
  readonly displayName?: string;

  /** The customer's reference in this system from our stored customer code, or null if the customer is not from it. */
  customerRef?(code: string): Record<string, string> | null;
  /** Creates the payment, or updates it when `code_1C` was sent before. Throws with `rejected: true` when refused. */
  postPayment?(config: Record<string, any>, payment: OutgoingPayment): Promise<void>;
  /** Customer payments recorded in the system on that day. */
  listDayPayments?(config: Record<string, any>, date: string): Promise<RemotePayment[]>;
  importVisits?(config: Record<string, any>, from: string, to: string): Promise<ExternalVisit[]>;
  listPriceTypes?(config: Record<string, any>): Promise<ExternalPriceType[]>;
  listPaymentTypes?(config: Record<string, any>): Promise<ExternalPaymentType[]>;
  listWarehouses?(config: Record<string, any>): Promise<Array<{ id: string; name: string }>>;
  importStockForDate?(config: Record<string, any>, date: string, warehouseId: string): Promise<Array<{ sku: string; quantity: number }>>;

  testConnection(config: Record<string, any>): Promise<{ 
    ok: boolean; 
    message: string; 
    latencyMs?: number; 
    syncCoefficient?: number;
    details?: any;
  }>;
  // withItems:false skips order lines (slow on some systems); byDelivery filters by delivery date (cash register day).
  importOrders(config: Record<string, any>, options?: { dateFrom?: string; dateTo?: string; status?: number[]; withItems?: boolean; byDelivery?: boolean }): Promise<ExternalSyncOrder[]>;
  importCustomers(config: Record<string, any>): Promise<ExternalSyncCustomer[]>;
  importPayments(config: Record<string, any>): Promise<ExternalSyncPayment[]>;
  importProducts?(config: Record<string, any>): Promise<any[]>;
  importEmployees?(config: Record<string, any>): Promise<ExternalSyncEmployee[]>;
  exportData(payload: ExportDataPayload, config: Record<string, any>): Promise<{ downloadUrl?: string; fileBuffer?: Buffer; message: string }>;
}
