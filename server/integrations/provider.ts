import type { IntegrationAdapter, SyncResult } from './interfaces.ts';
import { DistributionAdapter } from './adapters/distribution.adapter.ts';
import { SalesDocAdapter } from './adapters/salesdoc.adapter.ts';
import { SmartUpAdapter } from './adapters/smartup.adapter.ts';
import { LinkoAdapter } from './adapters/linko.adapter.ts';
import { CustomServerAdapter } from './adapters/custom_server.adapter.ts';
import { ExcelAdapter } from './adapters/excel.adapter.ts';
import { ManualAdapter } from './adapters/manual.adapter.ts';
import { db } from '../db/database.ts';
import { randomUUID } from 'node:crypto';
import type {
  ExternalOrder,
  ExternalCustomer,
  Customer,
  Agent,
  SalesOrder,
  DailyOrderEntry,
  CustomerBalanceTransaction,
  Product
} from '../db/schema.ts';
import { AuditService } from '../services/audit.service.ts';
import { ForecastService } from '../services/forecast.service.ts';
import { inventoryObservation } from '../services/inventory-observation.ts';
import { SalesDocHistoryService } from '../services/salesdoc-history.service.ts';
import { tagIntegrationRows } from '../services/source-tagging.service.ts';
import { CustomerBalanceService } from '../services/customer_balance.service.ts';
import { canonicalCustomerCode, computeOrderCogs, isPlausibleCost } from '../services/cogs.ts';
import { businessToday } from '../utils/date.ts';
import { capabilitiesOf } from './capabilities.ts';
import { territoryIdFor } from '../services/territory.ts';

/** Ledger row plus cached balance, derived from the ledger itself (never clamped at zero: overpayment is a credit). */
function postLedger(
  companyId: string, customerId: string, type: 'DEBIT' | 'CREDIT', referenceType: CustomerBalanceTransaction['reference_type'],
  amount: number, date: string, referenceId: string, externalId: string, source: string, comment: string, userId: string, now: string
): void {
  const balanceAfter = CustomerBalanceService.calculateLedgerBalance(companyId, customerId) + (type === 'DEBIT' ? amount : -amount);
  db.insert('customer_balance_transactions', {
    id: randomUUID(),
    company_id: companyId,
    customer_id: customerId,
    transaction_type: type,
    reference_type: referenceType,
    reference_id: referenceId,
    external_id: externalId,
    amount,
    balance_after: balanceAfter,
    date,
    source_system: source,
    comment,
    status: 'CONFIRMED',
    created_by: userId,
    created_at: now
  });
  db.update('customers', customerId, { current_balance: balanceAfter });
}

function adjustBalance(customerId: string, _delta: number): void {
  const customer = db.findById('customers', customerId);
  if (customer) CustomerBalanceService.syncCustomerCachedBalance(customer.company_id, customerId);
}

export class IntegrationProvider {
  private adapters: Map<string, IntegrationAdapter> = new Map();

  constructor() {
    const salesDoc = new SalesDocAdapter();
    this.registerAdapter(salesDoc);
    // Aliases for SalesDoctor
    this.adapters.set('SALESDOCTOR', salesDoc);
    this.adapters.set('SALES_DOCTOR', salesDoc);

    this.registerAdapter(new SmartUpAdapter());
    this.registerAdapter(new LinkoAdapter());
    this.registerAdapter(new CustomServerAdapter());
    this.registerAdapter(new DistributionAdapter());
    this.registerAdapter(new ExcelAdapter());
    this.registerAdapter(new ManualAdapter());
  }

  public registerAdapter(adapter: IntegrationAdapter): void {
    this.adapters.set(adapter.providerName.toUpperCase(), adapter);
  }

  public getAdapter(providerName: string): IntegrationAdapter {
    const key = providerName.toUpperCase();
    const adapter = this.adapters.get(key);
    if (!adapter) {
      throw new Error(`Integratsiya adapteri topilmadi: ${providerName}`);
    }
    return adapter;
  }

  public listAdapters(): { name: string; type: string }[] {
    return Array.from(this.adapters.values()).map(a => ({
      name: a.providerName,
      type: a.providerType
    }));
  }

  /**
   * Executes a full synchronization pipeline with an external provider
   * Transforms external data into core business records (Sales Orders, Customer Balances, Cash Inflows, Products)
   */
  public async syncProvider(
    companyId: string, 
    providerName: string, 
    userId: string,
    userEmail: string,
    integrationId?: string
  ): Promise<SyncResult> {
    const upperProvider = providerName.toUpperCase();
    const adapter = this.getAdapter(upperProvider);
    const integrationRecord = db.findOne('integrations', i => 
      i.company_id === companyId && 
      (i.provider_name.toUpperCase() === upperProvider || (upperProvider.includes('SALESDOC') && i.provider_name.toUpperCase().includes('SALESDOC'))) &&
      (!integrationId || i.id === integrationId)
    );
    const config = integrationRecord?.config || {};
    if (integrationRecord?.disabled) throw new Error(`${upperProvider} o‘chirilgan. Sinxronlash uchun avval integratsiyani yoqing.`);
    // Any system that can give its order history month by month (SalesDoctor, Linko, …) loads it that way.
    if (capabilitiesOf(adapter).history && integrationRecord) {
      // Full history can take many minutes, so it runs in the background and reports progress per month.
      const alreadyRunning = SalesDocHistoryService.isRunning(integrationRecord.id);
      if (!alreadyRunning) SalesDocHistoryService.start(companyId, integrationRecord.id, userId, 'full', adapter as any);
      return {
        provider: adapter.providerName,
        status: 'PARTIAL',
        recordsImported: 0,
        recordsFailed: 0,
        syncedAt: new Date().toISOString(),
        details: { background: true, message: alreadyRunning ? 'Tarix allaqachon yuklanmoqda.' : 'To‘liq tarix fonda yuklanmoqda. Holati integratsiya sahifasida ko‘rinadi.' }
      };
    }

    let recordsImported = 0;
    let recordsFailed = 0;
    const errors: string[] = [];
    const now = new Date().toISOString();
    const today = businessToday();
    const syncIntegrationId = integrationRecord?.id || 'manual';

    // Rules for every non-SalesDoc provider:
    // - records are matched by external code only; nothing is ever attached to a "first" customer;
    // - repeated syncs update the same rows (no duplicate payments or debts);
    // - agent collections update the customer ledger but never the cash register — cash is counted by the cashier;
    // - unknown cost stays unknown instead of a percentage guess.
    try {
      // 1. Products
      if (typeof adapter.importProducts === 'function') {
        const products = await adapter.importProducts(config);
        for (const p of products) {
          if (!p?.sku) { recordsFailed++; continue; }
          const existingProd = db.findOne('products', prod => prod.company_id === companyId && prod.sku === String(p.sku)
            && (!integrationRecord || !prod.source_integration_id || prod.source_integration_id === integrationRecord.id));
          const stockQty = Number.isFinite(Number(p.stock_quantity)) ? Number(p.stock_quantity) : 0;
          const cost = Number(p.purchase_cost) > 0 ? Number(p.purchase_cost) : 0;
          if (!existingProd) {
            const newProd: Product = {
              id: randomUUID(),
              company_id: companyId,
              sku: String(p.sku),
              name: p.name || String(p.sku),
              unit: p.unit || 'dona',
              category: p.category || 'Asosiy',
              ...(p.brand ? { brand: p.brand } : {}),
              purchase_cost: cost,
              current_cost: cost,
              selling_price: Number(p.selling_price) || 0,
              ...(Array.isArray(p.prices) ? { prices: p.prices } : {}),
              stock_quantity: stockQty,
              daily_sales_avg: 0,
              out_of_stock_days: 0,
              last_in_stock_at: stockQty > 0 ? businessToday() : null,
              zero_stock_observed_at: null,
              stock_observed_at: businessToday(),
              source: upperProvider === 'LINKO' ? 'LINKO' : upperProvider.includes('SALES') ? 'SALESDOC' : '1C',
              ...(integrationRecord ? { source_integration_id: integrationRecord.id } : {}),
              is_active: true,
              created_at: now
            };
            db.insert('products', newProd);
          } else {
            db.update('products', existingProd.id, {
              stock_quantity: stockQty,
              ...inventoryObservation(existingProd, stockQty, businessToday()),
              selling_price: Number(p.selling_price) || existingProd.selling_price,
              // A placeholder cost (1 so'm) from the system never erases a real cost entered by hand.
              purchase_cost: isPlausibleCost(cost, Number(p.selling_price) || existingProd.selling_price) || !isPlausibleCost(existingProd.purchase_cost, existingProd.selling_price) ? (cost || existingProd.purchase_cost) : existingProd.purchase_cost,
              current_cost: isPlausibleCost(cost, Number(p.selling_price) || existingProd.selling_price) || !isPlausibleCost(existingProd.current_cost, existingProd.selling_price) ? (cost || existingProd.current_cost) : existingProd.current_cost,
              ...(Array.isArray(p.prices) ? { prices: p.prices } : {}),
              // The system's real category replaces the 'Asosiy' placeholder; a hand-made one stays when it sends none.
              ...(p.category && p.category !== 'Asosiy' ? { category: p.category } : {}),
              ...(p.brand ? { brand: p.brand } : {})
              , ...(integrationRecord ? { source_integration_id: integrationRecord.id } : {})
            });
          }
          recordsImported++;
        }
      }

      // 2. Employees and agents (matched by external code, then by exact name)
      if (typeof adapter.importEmployees === 'function') {
        const employees = await adapter.importEmployees(config);
        for (const emp of employees) {
          let coreEmp = db.findOne('employees', e => e.company_id === companyId && e.full_name.toLowerCase() === emp.name.toLowerCase());
          if (!coreEmp) {
            const pos = emp.role === 'AGENT' ? 'Savdo Agenti' : (emp.role === 'EXPEDITOR' ? 'Ekspeditor' : (emp.role === 'SUPERVISOR' ? 'Supervayzer' : 'Xodim'));
            coreEmp = db.insert('employees', {
              id: randomUUID(),
              company_id: companyId,
              full_name: emp.name,
              position: pos,
              phone: emp.phone || '',
              salary_type: emp.role === 'AGENT' ? 'HYBRID' : 'FIXED',
              status: 'ACTIVE',
              created_at: now
            });
            recordsImported++;
          }
          if (emp.role === 'AGENT' || emp.role === 'SUPERVISOR') {
            const code = emp.code_1C || emp.externalId;
            const coreAgent = db.findOne('agents', a => a.company_id === companyId && (!integrationRecord || !a.source_integration_id || a.source_integration_id === integrationRecord.id) && (a.code === code || a.full_name.toLowerCase() === emp.name.toLowerCase()));
            if (!coreAgent) {
              db.insert('agents', {
                id: randomUUID(),
                company_id: companyId,
                employee_id: coreEmp.id,
                code,
                full_name: emp.name,
                phone: emp.phone || coreEmp.phone,
                commission_rate: emp.commissionRate || 0,
                status: 'ACTIVE',
                ...(integrationRecord ? { source_integration_id: integrationRecord.id } : {}),
                created_at: now
              });
              recordsImported++;
            }
          }
        }
      }

      // 3. Customers: one external record and one core customer per external code
      const customers = await adapter.importCustomers(config);
      const customerMap = new Map<string, Customer>();
      for (const c of db.find('customers', c => c.company_id === companyId && (!integrationRecord || !c.source_integration_id || c.source_integration_id === integrationRecord.id))) if (c.code) customerMap.set(canonicalCustomerCode(c.code), c);
      const extCustomerIndex = new Map(db.find('external_customers', e => e.company_id === companyId && e.integration_id === syncIntegrationId).map(e => [e.external_code, e]));
      for (const cust of customers) {
        if (!cust.externalCode) { recordsFailed++; continue; }
        const oldExt = extCustomerIndex.get(cust.externalCode);
        const extCust: ExternalCustomer = {
          id: oldExt?.id || randomUUID(),
          company_id: companyId,
          integration_id: syncIntegrationId,
          external_code: cust.externalCode,
          name: cust.name,
          phone: cust.phone,
          balance: cust.balance,
          synced_at: now
        };
        if (oldExt) db.update('external_customers', oldExt.id, extCust); else db.insert('external_customers', extCust);

        let coreCust = customerMap.get(canonicalCustomerCode(cust.externalCode));
        const territory_id = territoryIdFor(companyId, cust.territory);
        if (!coreCust) {
          coreCust = db.insert('customers', {
            id: randomUUID(),
            company_id: companyId,
            code: cust.externalCode,
            name: cust.name,
            phone: cust.phone || '',
            address: cust.address || '',
            territory_id,
            credit_limit: 0,
            credit_limit_enabled: false,
            current_balance: 0,
            status: 'ACTIVE',
            is_active: true,
            created_at: now
            , ...(integrationRecord ? { source_integration_id: integrationRecord.id } : {})
          });
          customerMap.set(canonicalCustomerCode(cust.externalCode), coreCust);
        } else {
          db.update('customers', coreCust.id, { name: cust.name || coreCust.name, phone: cust.phone || coreCust.phone, address: cust.address || coreCust.address, territory_id: territory_id || coreCust.territory_id || null, ...(integrationRecord ? { source_integration_id: integrationRecord.id } : {}) });
        }
        recordsImported++;
      }
      const findCustomer = (code?: string) => (code ? customerMap.get(canonicalCustomerCode(code)) || null : null);

      // 4. Orders: upsert by external id; the debt is booked once, when the order is delivered
      const orders = await adapter.importOrders(config);
      const products = db.find('products', p => p.company_id === companyId && (!integrationRecord || !p.source_integration_id || p.source_integration_id === integrationRecord.id));
      const productBySku = new Map(products.map(p => [p.sku, p]));
      for (const ord of orders) {
        const coreCustomer = findCustomer(ord.customerCode);
        if (!ord.externalId || !coreCustomer) {
          recordsFailed++;
          errors.push(`Buyurtma ${ord.orderNumber || ord.externalId || '?'}: mijoz kodi (${ord.customerCode || 'yo‘q'}) topilmadi, o‘tkazib yuborildi.`);
          continue;
        }
        const oldExt = db.findOne('external_orders', o => o.company_id === companyId && o.integration_id === syncIntegrationId && o.external_order_id === ord.externalId);
        const extOrder: ExternalOrder = {
          id: oldExt?.id || randomUUID(),
          company_id: companyId,
          integration_id: syncIntegrationId,
          external_order_id: ord.externalId,
          customer_external_id: ord.customerCode,
          total_amount: ord.totalAmount,
          status: ord.status,
          order_date: ord.orderDate,
          synced_at: now
        };
        if (oldExt) db.update('external_orders', oldExt.id, extOrder); else db.insert('external_orders', extOrder);

        const status: SalesOrder['status'] = ord.status === 'CANCELLED' ? 'CANCELLED' : (ord.status === 'DELIVERED' || ord.status === 'CLOSED') ? 'DELIVERED' : 'PENDING';
        const cogs = computeOrderCogs(ord.items || [], productBySku);
        const existingOrder = db.findOne('sales_orders', o => o.company_id === companyId && o.external_id === ord.externalId
          && (!integrationRecord || !o.source_integration_id || o.source_integration_id === integrationRecord.id));
        const orderId = existingOrder?.id || randomUUID();
        const values = {
          company_id: companyId,
          external_id: ord.externalId,
          order_number: ord.orderNumber,
          order_date: ord.orderDate || today,
          delivery_date: ord.orderDate || today,
          customer_id: coreCustomer.id,
          customer_name: coreCustomer.name,
          total_sales: ord.totalAmount,
          discount_amount: 0,
          return_amount: 0,
          net_sales: ord.totalAmount,
          total_cogs: cogs.total,
          cogs_status: cogs.status,
          gross_profit: cogs.status === 'KNOWN' ? ord.totalAmount - cogs.total : 0,
          payment_type: 'CREDIT' as const,
          status,
          source: 'DISTRIBUTION' as const,
          ...(integrationRecord ? { source_integration_id: integrationRecord.id } : {}),
          updated_at: now
        };
        if (existingOrder) db.update('sales_orders', orderId, values);
        else db.insert('sales_orders', { ...values, id: orderId, created_by: userId, created_at: now });
        db.removeWhere('sales_order_items', i => i.sales_order_id === orderId);
        for (const line of cogs.lines) db.insert('sales_order_items', { ...line, id: randomUUID(), sales_order_id: orderId });

        // Debt: exactly one DEBIT per delivered order; cancelled orders are reversed.
        const debit = db.findOne('customer_balance_transactions', t => t.company_id === companyId && t.customer_id === coreCustomer.id && t.reference_type === 'SALE' && t.external_id === ord.externalId && t.status !== 'REVERSED');
        if (status === 'DELIVERED' && !debit) {
          postLedger(companyId, coreCustomer.id, 'DEBIT', 'SALE', ord.totalAmount, ord.orderDate || today, ord.orderNumber, ord.externalId, upperProvider, `${upperProvider}: yetkazilgan buyurtma #${ord.orderNumber}`, userId, now);
        } else if (status === 'CANCELLED' && debit) {
          db.update('customer_balance_transactions', debit.id, { status: 'REVERSED' });
          adjustBalance(coreCustomer.id, -debit.amount);
        }
        recordsImported++;
      }

      try {
        ForecastService.calculateHistoricalSalesVelocity(companyId);
      } catch (err: any) {
        errors.push(`Prognoz tezligi hisoblanmadi: ${err.message}`);
      }

      // 5. Payments: ledger only, once per external payment id
      const payments = await adapter.importPayments(config);
      for (const p of payments) {
        const coreCustomer = findCustomer(p.customerCode);
        if (!p.externalPaymentId || !coreCustomer || !(p.amount > 0)) {
          recordsFailed++;
          errors.push(`To‘lov ${p.externalPaymentId || '?'}: mijoz yoki summa aniqlanmadi, o‘tkazib yuborildi.`);
          continue;
        }
        const seen = db.findOne('external_payments', e => e.company_id === companyId && e.integration_id === syncIntegrationId && e.external_payment_id === p.externalPaymentId);
        if (seen) continue;
        db.insert('external_payments', {
          id: randomUUID(),
          company_id: companyId,
          integration_id: syncIntegrationId,
          external_payment_id: p.externalPaymentId,
          amount: p.amount,
          payment_date: p.paymentDate,
          status: 'SUCCESS',
          synced_at: now
        });
        postLedger(companyId, coreCustomer.id, 'CREDIT', 'PAYMENT', p.amount, p.paymentDate || today, p.externalPaymentId, p.externalPaymentId, upperProvider, `${upperProvider}: agent orqali to‘lov (${p.paymentMethod})`, userId, now);
        recordsImported++;
      }

      if (integrationRecord) {
        db.update('integrations', integrationRecord.id, { last_sync_at: now, status: db.findById('integrations', integrationRecord.id)?.disabled ? 'DISCONNECTED' : 'CONNECTED' });
      }

      AuditService.log({
        company_id: companyId,
        user_id: userId,
        user_email: userEmail,
        action: 'SYNC',
        entity: 'Integration',
        entity_id: upperProvider,
        old_value: null,
        new_value: { recordsImported, recordsFailed, ordersCount: orders.length, customersCount: customers.length, paymentsCount: payments.length, timestamp: now },
        reason: `${upperProvider} sinxronlash: ${recordsImported} ta yozuv, ${recordsFailed} ta o‘tkazib yuborildi`
      });

      if (integrationRecord) tagIntegrationRows(integrationRecord.id);

      return {
        provider: upperProvider,
        status: recordsFailed ? 'PARTIAL' : 'SUCCESS',
        recordsImported,
        recordsFailed,
        errors: errors.slice(0, 50),
        syncedAt: now,
        details: { ordersCount: orders.length, customersCount: customers.length, paymentsCount: payments.length }
      };
    } catch (err: any) {
      errors.push(err.message || String(err));
      if (integrationRecord) db.update('integrations', integrationRecord.id, { status: 'ERROR' });
      return {
        provider: upperProvider,
        status: 'FAILED',
        recordsImported,
        recordsFailed: recordsFailed + 1,
        errors,
        syncedAt: now
      };
    }
  }

  /**
   * Synchronizes or pulls orders for a specific Cash Day date from integrated systems
   * Automatically calculates total sales, delivered ("yetkazildi") vs to-deliver ("yetkaziladi") sums
   */
  public async syncDayOrders(
    companyId: string, 
    date: string, 
    cashDayId: string, 
    userId: string = 'system'
  ): Promise<{
    syncedCount: number;
    totalSales: number;
    deliveredCount: number;
    deliveredSales: number;
    pendingCount: number;
    pendingSales: number;
    orders: DailyOrderEntry[];
  }> {
    const day=db.findOne('cash_days',d=>d.id===cashDayId && d.company_id===companyId);
    if(!day || day.status!=='OPEN') throw new Error('Faqat ochiq kassa kuni yangilanadi.');
    const now = new Date().toISOString();
    // Cash and reports must follow the connection selected as primary in settings,
    // regardless of whether that server is Linko, SalesDoc, or another adapter.
    const integrations = db.find('integrations', i => i.company_id === companyId && i.status === 'CONNECTED' && !i.disabled && i.provider_type === 'DISTRIBUTION');
    const activeIntegration = integrations.find(i => i.config?.primary === true)
      || integrations.slice().sort((a, b) => String(b.last_sync_at || '').localeCompare(String(a.last_sync_at || '')))[0];
    const systemLabel = activeIntegration?.provider_name || 'Distribyutor tizimi';

    let integratedOrders: any[] = [];
    if (activeIntegration && this.adapters.has(activeIntegration.provider_name.toUpperCase())) {
      const adapter = this.adapters.get(activeIntegration.provider_name.toUpperCase())!;
      const config = activeIntegration.config || {};
      try {
        integratedOrders = await adapter.importOrders(config, {
          dateFrom: date,
          dateTo: date,
          // 5 = cancelled: needed so a cancellation in SalesDoc removes the row from the cash day.
          status: [1, 2, 3, 4, 5],
          // Lines are not needed for the cash register; Linko's cash day is the delivery day.
          withItems: false,
          byDelivery: true
        });
      } catch (err: any) {
        throw err;
      }
    }

    return db.transaction(()=>{
    // Also look at existing sales_orders for this date
    const existingSalesOrders = db.find('sales_orders', o => o.company_id === companyId && o.order_date === date);

    let syncedCount = 0;
    let totalSales = 0;
    let deliveredCount = 0;
    let deliveredSales = 0;
    let pendingCount = 0;
    let pendingSales = 0;

    // Index agents and customers
    const coreCustomers = db.find('customers', c => c.company_id === companyId);
    const customerMap = new Map<string, Customer>();
    for (const c of coreCustomers) {
      customerMap.set(c.id, c);
      if (c.code) customerMap.set(canonicalCustomerCode(c.code), c);
    }

    const coreAgents = db.find('agents', a => a.company_id === companyId);
    const agentMap = new Map<string, Agent>();
    for (const a of coreAgents) {
      agentMap.set(a.id, a);
      if (a.code) agentMap.set(a.code, a);
      agentMap.set(a.full_name.toLowerCase(), a);
    }

    // Process integrated orders first
    let cancelledCount = 0;
    for (const ord of integratedOrders) {
      if (ord.status === 'CANCELLED') {
        const entry = db.findOne('daily_order_entries', e => e.cash_day_id === cashDayId && e.external_order_id === ord.externalId);
        if (entry && entry.status !== 'CANCELLED') {
          const posted = db.findOne('integration_transactions', t => t.payload?.rowId === entry.id && ['PROCESSED', 'SENDING', 'UNCERTAIN'].includes(t.status));
          const hasCash = (entry.cash_payment || 0) + (entry.terminal_click || 0) + (entry.nasiyadan_kirim || 0) > 0;
          db.update('daily_order_entries', entry.id, posted || hasCash
            ? { note: `${systemLabel}'da bekor qilingan, lekin kassada to'lov bor — tekshiring. ${entry.note || ''}`.trim() }
            : { status: 'CANCELLED', sale_amount: 0, remaining_debt: 0, nasiya_perech: 0, credit_amount: 0, note: `${systemLabel}'da bekor qilingan` });
          cancelledCount++;
        }
        continue;
      }
      let cust = customerMap.get(canonicalCustomerCode(ord.customerCode));
      if (!cust) {
        cust = db.insert('customers', {
          id: randomUUID(),
          company_id: companyId,
          code: ord.customerCode,
          name: ord.customerName,
          phone: '',
          address: '',
          credit_limit: 0,
          credit_limit_enabled: false,
          current_balance: 0,
          status: 'ACTIVE',
          is_active: true,
          created_at: now,
          source_integration_id: activeIntegration?.id || null
        });
        customerMap.set(cust.id, cust);
        if (cust.code) customerMap.set(canonicalCustomerCode(cust.code), cust);
      }

      const matchedAgent = (ord.agentCode && agentMap.get(ord.agentCode)) || 
                           (ord.agentName && agentMap.get(ord.agentName.toLowerCase())) || 
                           null;

      const isDelivered = ord.status === 'DELIVERED' || ord.status === 'CLOSED';
      const statusStr = isDelivered ? 'DELIVERED' : 'PENDING';
      const noteStr = isDelivered ? `Yetkazildi (${ord.agentName || systemLabel})` : `Yetkaziladi (${ord.agentName || systemLabel})`;

      let entry = db.findOne('daily_order_entries', e => 
        e.cash_day_id === cashDayId && (e.external_order_id===ord.externalId || !e.external_order_id && e.order_number === ord.orderNumber)
      );

      if (!entry) {
        entry = db.insert('daily_order_entries', {
          id: `entry-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          company_id: companyId,
          cash_day_id: cashDayId,
          order_number: ord.orderNumber,
          order_date: date,
          customer_id: cust.id,
          customer_name: cust.name,
          agent_id: matchedAgent?.id || null,
          agent_name: matchedAgent?.full_name || ord.agentName || undefined,
          integration_id:activeIntegration?.id,
          external_order_id:ord.externalId,
          customer_ref:ord.customerRef,
          order_ref:ord.orderRef,
          payment_type_ref:ord.paymentTypeRef,
          sale_amount: ord.totalAmount,
          nasiya_perech: ord.totalAmount,
          credit_amount: ord.totalAmount,
          remaining_debt: ord.totalAmount,
          status: statusStr,
          note: noteStr,
          created_at: now
        });
      } else {
        if(db.findOne('integration_transactions',t=>t.payload?.rowId===entry!.id && ['PROCESSED','SENDING','UNCERTAIN'].includes(t.status))) continue;
        const debt=Math.max(0,ord.totalAmount-(entry.cash_payment||0)-(entry.terminal_click||0)-(entry.return_amount||0));
        db.update('daily_order_entries', entry.id, {
          integration_id:activeIntegration?.id,external_order_id:ord.externalId,customer_ref:ord.customerRef,order_ref:ord.orderRef,payment_type_ref:ord.paymentTypeRef,
          customer_id:cust.id,customer_name:cust.name,remaining_debt:debt,nasiya_perech:debt,credit_amount:debt,
          sale_amount: ord.totalAmount,
          status: statusStr,
          note: noteStr,
          agent_id: matchedAgent?.id || entry.agent_id,
          agent_name: matchedAgent?.full_name || ord.agentName || entry.agent_name
        });
      }

      syncedCount++;
      totalSales += ord.totalAmount;
      if (isDelivered) {
        deliveredCount++;
        deliveredSales += ord.totalAmount;
      } else {
        pendingCount++;
        pendingSales += ord.totalAmount;
      }
    }

    // If no integrated orders were returned, make sure any local sales_orders for this date are present
    if (!activeIntegration && existingSalesOrders.length > 0) {
      for (const so of existingSalesOrders) {
        let entry = db.findOne('daily_order_entries', e => 
          e.cash_day_id === cashDayId && e.order_number === so.order_number
        );
        const isDelivered = so.status === 'DELIVERED';
        const statusStr = isDelivered ? 'DELIVERED' : 'PENDING';
        const noteStr = isDelivered ? 'Yetkazildi' : 'Yetkaziladi';

        if (!entry) {
          entry = db.insert('daily_order_entries', {
            id: `entry-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            company_id: companyId,
            cash_day_id: cashDayId,
            order_number: so.order_number,
            order_date: date,
            customer_id: so.customer_id,
            customer_name: so.customer_name,
            sale_amount: so.total_sales,
            nasiya_perech: so.total_sales,
            credit_amount: so.total_sales,
            remaining_debt: so.total_sales,
            status: statusStr,
            note: noteStr,
            created_at: now
          });
        }
        syncedCount++;
        totalSales += so.total_sales;
        if (isDelivered) {
          deliveredCount++;
          deliveredSales += so.total_sales;
        } else {
          pendingCount++;
          pendingSales += so.total_sales;
        }
      }
    }

    // Update cash_day total_sales
    if (totalSales > 0) {
      db.update('cash_days', cashDayId, {
        total_sales: totalSales
      });
    }

    const currentEntries = db.find('daily_order_entries', e => e.cash_day_id === cashDayId);

    return {
      syncedCount,
      totalSales,
      deliveredCount,
      deliveredSales,
      pendingCount,
      pendingSales,
      orders: currentEntries
    };
    });
  }
}

export const integrationProvider = new IntegrationProvider();
