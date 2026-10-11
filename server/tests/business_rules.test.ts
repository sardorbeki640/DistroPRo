import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../db/database.ts';
import { SalesDocAdapter } from '../integrations/adapters/salesdoc.adapter.ts';
import { SalesDocHistoryService } from '../services/salesdoc-history.service.ts';
import { AnalyticsService } from '../services/analytics.service.ts';
import { ForecastService } from '../services/forecast.service.ts';
import { NotificationService } from '../services/notification.service.ts';
import { integrationProvider } from '../integrations/provider.ts';
import { CashService } from '../services/cash.service.ts';
import { CashPostingService } from '../services/cash-posting.service.ts';
import { mergeDuplicateCustomersMigration } from '../db/migrations/008_merge_duplicate_customers.ts';
import { compareAgent, comparePeriods } from '../services/compare.service.ts';
import { TeamsService } from '../services/teams.service.ts';
import { addDays, businessToday, isValidIsoDate } from '../utils/date.ts';
import { computeOrderCogs } from '../services/cogs.ts';

beforeEach(() => { db.init(); db.reset(); });
const today = businessToday();

function order(id: string, date: string, extra: Record<string, any> = {}) {
  return { externalId: id, orderNumber: `N${id}`, customerCode: 'c1', customerName: 'Mijoz 1', totalAmount: 100, status: 'DELIVERED', orderDate: date, itemsCount: 2, items: [{ sku: 'p1', name: 'Tovar', quantity: 2, price: 50, total: 100 }], ...extra };
}

test('calendar dates reject impossible values such as month 42', () => {
  assert.equal(isValidIsoDate('2026-09-30'), true);
  assert.equal(isValidIsoDate('2097-42-01'), false);
  assert.equal(isValidIsoDate('2026-02-30'), false);
});

test('history loads month by month, splits a range when SalesDoc repeats a page, and resumes without re-downloading settled months', async () => {
  const start = addDays(today, -150);
  db.insert('integrations', { id: 'sd', company_id: 'c', provider_name: 'SALESDOC', provider_type: 'DISTRIBUTION', status: 'CONNECTED', config: { history_start_date: start, forecast_days: 100 }, created_at: today } as any);
  const adapter = new SalesDocAdapter();
  const calls: string[] = [];
  adapter.importProducts = async () => [{ sku: 'p1', name: 'Tovar', purchase_cost: 30, selling_price: 50, stock_quantity: 10 }];
  adapter.importOrders = async (_c, o) => {
    calls.push(`${o!.dateFrom}..${o!.dateTo}`);
    // A whole month fails the way SalesDoc did in practice; halves succeed.
    if (o!.dateFrom!.endsWith('-01') && o!.dateTo!.slice(8) >= '28' && calls.filter(c => c.startsWith(o!.dateFrom!)).length === 1) throw new Error('getOrder: server bir sahifani takrorladi; tarix to‘liq olinmadi');
    return [order(`o-${o!.dateFrom}`, o!.dateFrom!), order(`x-${o!.dateTo}`, o!.dateTo!, { status: 'CANCELLED' })];
  };
  const result = await SalesDocHistoryService.sync('c', 'sd', 'u', adapter, 'full');
  const history = SalesDocHistoryService.getState('sd')!;
  assert.equal(history.complete, true, JSON.stringify({ ...history, chunks: undefined }));
  assert.equal(history.from, start);
  assert.equal(result.status, 'SUCCESS');
  assert.ok(calls.some(c => c.slice(0, 10).endsWith('-01') && Number(c.slice(-2)) < 20), 'a failing month was split into halves');
  const delivered = db.find('sales_orders', o => o.status === 'DELIVERED');
  assert.ok(delivered.length > 0);
  assert.ok(delivered.every(o => o.cogs_status === 'KNOWN' && o.total_cogs === 60), 'cost comes from the product, not a percentage');
  assert.ok(db.find('sales_orders', o => o.status === 'CANCELLED').length > 0);

  const before = calls.length;
  const totalBefore = db.find('sales_orders', () => true).length;
  await SalesDocHistoryService.sync('c', 'sd', 'u', adapter, 'full');
  const second = calls.slice(before);
  assert.ok(second.every(c => c.slice(0, 10) >= addDays(today, -80)), `only recent months are fetched again: ${second.join(', ')}`);
  assert.equal(db.find('sales_orders', () => true).length, totalBefore, 'no duplicates after resync');
});

test('a failed month keeps loaded months and marks history as not complete', async () => {
  db.insert('integrations', { id: 'sd', company_id: 'c', provider_name: 'SALESDOC', status: 'CONNECTED', config: { history_start_date: addDays(today, -40) }, created_at: today } as any);
  const adapter = new SalesDocAdapter();
  adapter.importProducts = async () => [];
  let n = 0;
  adapter.importOrders = async () => { if (++n > 1) throw new Error('SalesDoctor [getOrder] xatosi: tarmoq'); return [order('a', today)]; };
  await assert.rejects(() => SalesDocHistoryService.sync('c', 'sd', 'u', adapter, 'full'));
  const history = SalesDocHistoryService.getState('sd')!;
  assert.equal(history.status, 'FAILED');
  assert.equal(history.complete, false);
  assert.equal(db.find('sales_orders', () => true).length, 1);
});

test('P&L: pending is not revenue; unknown cost gives no invented profit', () => {
  db.insert('sales_orders', { id: 'a', company_id: 'c', order_date: today, status: 'DELIVERED', total_sales: 1000, discount_amount: 0, return_amount: 0, total_cogs: 600, cogs_status: 'KNOWN' } as any);
  db.insert('sales_orders', { id: 'b', company_id: 'c', order_date: today, status: 'PENDING', total_sales: 5000, discount_amount: 0, return_amount: 0, total_cogs: 0 } as any);
  let pnl = AnalyticsService.getProfitAndLoss('c', today, today);
  assert.equal(pnl.net_revenue, 1000);
  assert.equal(pnl.pending_sales, 5000);
  assert.equal(pnl.gross_profit, 400);
  assert.equal(pnl.net_profit, 400);
  db.insert('sales_orders', { id: 'legacy', company_id: 'c', order_date: today, status: 'DELIVERED', total_sales: 1000, discount_amount: 0, return_amount: 0, total_cogs: 760 } as any);
  pnl = AnalyticsService.getProfitAndLoss('c', today, today);
  assert.equal(pnl.cogs_complete, false);
  assert.equal(pnl.net_profit, null);
  assert.equal(pnl.unknown_cost_sales, 1000);
  assert.equal(pnl.gross_profit, 400, 'profit only over sales with a known cost');
});

test('aging applies payments to the oldest debt; buckets add up to the debt', () => {
  db.insert('customers', { id: 'k', company_id: 'c', code: 'K', name: 'K', current_balance: 200 } as any);
  db.insert('customer_balance_transactions', { id: 'd1', company_id: 'c', customer_id: 'k', transaction_type: 'DEBIT', amount: 1000, date: addDays(today, -120), created_at: '2026-01-01T00:00:00Z' } as any);
  db.insert('customer_balance_transactions', { id: 'd2', company_id: 'c', customer_id: 'k', transaction_type: 'DEBIT', amount: 100, date: addDays(today, -5), created_at: '2026-01-02T00:00:00Z' } as any);
  db.insert('customer_balance_transactions', { id: 'p', company_id: 'c', customer_id: 'k', transaction_type: 'CREDIT', amount: 900, date: addDays(today, -3), created_at: '2026-01-03T00:00:00Z' } as any);
  const [row] = AnalyticsService.getAgingReport('c', today);
  assert.equal(row.current_debt, 200);
  assert.equal(row.bucket_90_plus, 100);
  assert.equal(row.bucket_0_30, 100);
  assert.equal(row.bucket_0_30 + row.bucket_31_60 + row.bucket_61_90 + row.bucket_90_plus + row.bucket_unknown, row.current_debt);
});

test('imported balance without history is "age unknown", never 14 days overdue', () => {
  db.insert('customers', { id: 'k', company_id: 'c', code: 'K', name: 'K', current_balance: 5000, credit_limit: 0 } as any);
  const [row] = AnalyticsService.getAgingReport('c', today);
  assert.equal(row.bucket_unknown, 5000);
  assert.equal(NotificationService.getOverdueCustomerDebtsSummary('c', 10).customers_count, 0);
});

test('non-SalesDoc sync: repeated payments are booked once, unknown customers are skipped, cash register untouched', async () => {
  db.insert('integrations', { id: 'cs', company_id: 'c', provider_name: 'CUSTOM_SERVER', provider_type: 'DISTRIBUTION', status: 'CONNECTED', config: {}, created_at: today } as any);
  db.insert('customers', { id: 'first', company_id: 'c', code: 'OTHER', name: 'Birinchi mijoz', current_balance: 0 } as any);
  const adapter = integrationProvider.getAdapter('CUSTOM_SERVER') as any;
  adapter.importProducts = async () => [];
  adapter.importEmployees = async () => [];
  adapter.importCustomers = async () => [{ externalCode: 'c1', name: 'Mijoz 1', balance: 0 }];
  adapter.importOrders = async () => [order('o1', today), order('o2', today, { customerCode: 'missing' })];
  adapter.importPayments = async () => [{ externalPaymentId: 'pay1', customerCode: 'c1', amount: 40, paymentMethod: 'CASH', paymentDate: today }, { externalPaymentId: 'pay2', customerCode: 'missing', amount: 99, paymentMethod: 'CASH', paymentDate: today }];
  try {
    const first = await integrationProvider.syncProvider('c', 'CUSTOM_SERVER', 'u', 'u@test');
    await integrationProvider.syncProvider('c', 'CUSTOM_SERVER', 'u', 'u@test');
    assert.equal(first.status, 'PARTIAL');
    const customer = db.findOne('customers', c => c.code === 'c1')!;
    assert.equal(customer.current_balance, 60, '100 delivered - 40 paid, once');
    assert.equal(db.findById('customers', 'first')!.current_balance, 0, 'nothing booked to an unrelated customer');
    assert.equal(db.find('customer_balance_transactions', () => true).length, 2);
    assert.equal(db.find('external_customers', () => true).length, 1);
    assert.equal(db.find('cash_transactions', () => true).length, 0);
    assert.equal(db.find('cash_days', () => true).length, 0);
  } finally { for (const k of ['importProducts', 'importEmployees', 'importCustomers', 'importOrders', 'importPayments']) delete adapter[k]; }
});

test('forecast divides by days of loaded history, not by days with no data', () => {
  db.insert('integrations', { id: 'sd', company_id: 'c', provider_name: 'SALESDOC', status: 'CONNECTED', config: { forecast_days: 100, history: { from: addDays(today, -19), status: 'COMPLETE' } }, created_at: today } as any);
  db.insert('products', { id: 'p', sku: 'p1', company_id: 'c', is_active: true, stock_quantity: 40, purchase_cost: 1, selling_price: 2 } as any);
  db.insert('sales_orders', { id: 'o', company_id: 'c', status: 'DELIVERED', order_date: today } as any);
  db.insert('sales_order_items', { id: 'i', sales_order_id: 'o', product_id: 'p1', sku: 'p1', quantity: 20 } as any);
  ForecastService.calculateHistoricalSalesVelocity('c');
  const result = ForecastService.getStockRunRate('c');
  assert.equal(result.items[0].effective_daily_sales, 1);
  assert.equal(result.items[0].days_remaining, 40);
  assert.equal(result.items[0].confidence, 'LOW');
  assert.equal(result.history.covered, false);
});

test('SalesDoc products: shared code_1C never mixes prices or stock; a 1 so‘m cost is kept as listed but not used as COGS', async () => {
  const adapter = new SalesDocAdapter();
  adapter.executeSalesDocMethod = async (_c: any, method: string, params: any = {}, _d?: any, envelope = false) => {
    const wrap = (result: any, total: number) => (envelope ? { status: true, result, pagination: { total, page: params.page, limit: 500 } } : result);
    if (method === 'getProduct') return wrap({ product: [{ SD_id: 'a', code_1C: 'Команда А', name: 'A' }, { SD_id: 'b', code_1C: 'Команда А', name: 'B' }] }, 2);
    if (method === 'getStock') return wrap({ warehouse: [{ products: [{ SD_id: 'a', code_1C: 'Команда А', quantity: 7 }] }] }, 1);
    if (method === 'getPriceType') return wrap({ priceType: [{ SD_id: 's', type: 'sale', active: 'Y', name: 'Asosiy' }, { SD_id: 'k', type: 'purchase', active: 'Y', name: 'Келиш Нарх' }] }, 2);
    if (method === 'getProductCategory' || method === 'getBrand') return wrap({ productCategory: [], brand: [] }, 0);
    if (method === 'getPrice') return params.priceType.SD_id === 's'
      ? { price: [{ product: { SD_id: 'a', code_1C: 'Команда А' }, price: 1000 }, { product: { SD_id: 'b', code_1C: 'Команда А' }, price: 5000 }] }
      : { price: [{ product: { SD_id: 'a', code_1C: 'Команда А' }, price: 1 }, { product: { SD_id: 'b', code_1C: 'Команда А' }, price: 3000 }] };
    throw new Error('unexpected ' + method);
  };
  const products = await adapter.importProducts({});
  const a = products.find(p => p.sku === 'a');
  const b = products.find(p => p.sku === 'b');
  assert.deepEqual([a.selling_price, b.selling_price], [1000, 5000]);
  assert.deepEqual([a.stock_quantity, b.stock_quantity], [7, 0], 'B has no stock of its own');
  assert.equal(a.purchase_cost, 1, 'the price as SalesDoc lists it');
  assert.equal(b.purchase_cost, 3000);
  // Profit never uses the placeholder: the line's cost stays unknown.
  const cogs = computeOrderCogs([{ sku: 'a', name: 'A', quantity: 2, price: 1000, total: 2000 }], new Map([['a', { sku: 'a', purchase_cost: 1, selling_price: 1000 } as any]]));
  assert.equal(cogs.status, 'UNKNOWN');
});

test('stored orders get their cost again when a real purchase price appears later', () => {
  db.insert('products', { id: 'p', sku: 'p1', company_id: 'c', is_active: true, purchase_cost: 1, selling_price: 50 } as any);
  db.insert('sales_orders', { id: 'o', company_id: 'c', external_id: 'x', source: 'DISTRIBUTION', status: 'DELIVERED', order_date: today, total_sales: 100, net_sales: 100, discount_amount: 0, return_amount: 0, total_cogs: 2, cogs_status: 'KNOWN' } as any);
  db.insert('sales_order_items', { id: 'i', sales_order_id: 'o', product_id: 'p', sku: 'p1', product_name: 'T', quantity: 2, unit_price: 50, total_amount: 100, unit_cost: 1, total_cogs: 2 } as any);
  SalesDocHistoryService.recomputeCogs('c');
  assert.equal(db.findById('sales_orders', 'o')!.cogs_status, 'UNKNOWN');
  db.update('products', 'p', { purchase_cost: 30 });
  SalesDocHistoryService.recomputeCogs('c');
  const order = db.findById('sales_orders', 'o')!;
  assert.equal(order.cogs_status, 'KNOWN');
  assert.equal(order.total_cogs, 60);
  assert.equal(AnalyticsService.getProfitAndLoss('c', today, today).net_profit, 40);
});

function postingFixture() {
  db.insert('integrations', { id: 'i', company_id: 'c', provider_name: 'SALESDOC', status: 'CONNECTED', config: { payment_types: { CASH: { SD_id: 'cash' } } } } as any);
  db.insert('cash_days', { id: 'day', company_id: 'c', status: 'OPEN', date: today, opening_balance: 0 } as any);
  db.insert('daily_order_entries', { id: 'row', company_id: 'c', cash_day_id: 'day', customer_id: 'k', order_number: '1', sale_amount: 100, cash_payment: 83, integration_id: 'i', external_order_id: 'o', customer_ref: { SD_id: 'cl' }, order_ref: { SD_id: 'o' } } as any);
}

test('SalesDoc refusal shows the real reason and the payment can be re-sent after fixing it', async () => {
  postingFixture();
  const adapter = new SalesDocAdapter();
  let calls = 0;
  adapter.postSalesDocApi = async () => {
    calls++;
    return calls === 1
      ? { status: false, error: { code: 400, message: 'Error', data: { payment: [{ index: 0, errors: ['Client mistmatch'] }] } } }
      : { status: true, result: { completed: 1, error: 0 } };
  };
  (adapter as any).getAuthCredentials = async () => ({ userId: 'u', token: 't', endpoint: 'x' });
  adapter.readAll = async () => [];
  const first = await CashPostingService.save('c', 'day', adapter);
  assert.equal(first.confirmed, 0);
  assert.match(first.message, /Client mistmatch/);
  assert.equal(db.getTable('integration_transactions')[0].status, 'FAILED');
  const second = await CashPostingService.save('c', 'day', adapter);
  assert.equal(second.confirmed, 1);
  assert.equal(calls, 2);
  // Like payments entered in SalesDoc by staff: on the client's balance, not linked to a not-yet-delivered order.
  const payment = db.getTable('integration_transactions')[0].payload.payment;
  assert.equal(payment.order, undefined);
  assert.match(payment.comment, /buyurtma 1/);
});

test('an earlier refusal stored as uncertain is released once SalesDoc shows no such payment', async () => {
  postingFixture();
  const adapter = new SalesDocAdapter();
  let sent = 0;
  adapter.executeSalesDocMethod = async () => { sent++; return { completed: 1, error: 0 }; };
  await CashPostingService.save('c', 'day', adapter);
  const job = db.getTable('integration_transactions')[0];
  db.update('integration_transactions', job.id, { status: 'UNCERTAIN', error_message: 'SalesDoctor [setPayment] xatosi: Error' });
  adapter.readAll = async () => [];
  // Checked in SalesDoc (absent) and re-sent in the same save, with the current payment type.
  db.update('integrations', 'i', { config: { payment_types: { CASH: { SD_id: 'active-cash' } } } });
  const check = await CashPostingService.save('c', 'day', adapter);
  assert.equal(check.confirmed, 1);
  assert.equal(sent, 2);
  assert.deepEqual(db.findById('integration_transactions', job.id)!.payload.payment.paymentType, { SD_id: 'active-cash' });
  // A timeout stays uncertain and is never re-sent blindly.
  db.update('integration_transactions', job.id, { status: 'UNCERTAIN', error_message: "SalesDoctor [setPayment] xatosi: SalesDoctor serveri bilan bog'lanishda tarmoq xatosi: fetch failed" });
  await CashPostingService.save('c', 'day', adapter);
  assert.equal(db.findById('integration_transactions', job.id)!.status, 'UNCERTAIN');
  assert.equal(sent, 2);
});

test('a real cost entered by hand is not erased by a 1 so‘m placeholder from SalesDoc; a real SalesDoc cost wins', async () => {
  db.insert('products', { id: 'p', company_id: 'c', sku: 'd0_1', name: 'A', is_active: true, source: 'SALESDOC', purchase_cost: 600, current_cost: 600, selling_price: 1000, source_integration_id: 'i' } as any);
  const adapter: any = { importProducts: async () => [{ sku: 'd0_1', name: 'A', purchase_cost: 1, selling_price: 1000, prices: [{ type_id: 'd0_3', name: 'Келиш Нарх', kind: 'purchase', currency: null, price: 1 }] }] };
  await (SalesDocHistoryService as any).importProducts('c', 'i', adapter, {});
  const p = db.findById('products', 'p')!;
  assert.equal(p.purchase_cost, 600, 'hand-entered cost kept');
  assert.equal(p.prices![0].price, 1, 'the SalesDoc price list itself is shown as it is');
  adapter.importProducts = async () => [{ sku: 'd0_1', name: 'A', purchase_cost: 720, selling_price: 1000 }];
  await (SalesDocHistoryService as any).importProducts('c', 'i', adapter, {});
  assert.equal(db.findById('products', 'p')!.purchase_cost, 720, 'a real cost from SalesDoc replaces it');
});

/** A fake SalesDoc that keeps payments by code_1C and updates on a second SET with the same code (API v2 upsert). */
function fakeSalesDocPayments(opts: { duplicateOnUpdate?: boolean } = {}) {
  const store: any[] = [];
  const adapter = new SalesDocAdapter();
  let sets = 0;
  adapter.executeSalesDocMethod = async (_c: any, method: string, _p: any, data?: any) => {
    if (method !== 'setPayment') throw new Error('unexpected ' + method);
    sets++;
    for (const p of data.payment) {
      const found = store.find(s => s.code_1C === p.code_1C);
      if (found && !opts.duplicateOnUpdate) found.amount = p.amount; else store.push({ ...p });
    }
    return { completed: 1, error: 0 };
  };
  adapter.readAll = async () => store.map(s => ({ ...s }));
  return { adapter, store, sets: () => sets };
}

test('an edited amount after sending is updated in SalesDoc (same code) and checked back', async () => {
  postingFixture();
  const sd = fakeSalesDocPayments();
  await CashPostingService.save('c', 'day', sd.adapter);
  assert.deepEqual(sd.store.map(s => s.amount), [83]);
  db.update('daily_order_entries', 'row', { cash_payment: 70 });
  const r = await CashPostingService.save('c', 'day', sd.adapter);
  assert.equal(r.updated, 1);
  assert.deepEqual(sd.store.map(s => s.amount), [70], 'one payment, new amount — no second payment');
  const job = db.getTable('integration_transactions')[0];
  assert.equal(job.status, 'PROCESSED');
  assert.equal(job.previous_payload!.payment.amount, 83);
  // Saving again with nothing changed sends nothing.
  const before = sd.sets();
  await CashPostingService.save('c', 'day', sd.adapter);
  assert.equal(sd.sets(), before);
});

test('if SalesDoc made a copy instead of updating, the row is held for checking, never sent again', async () => {
  postingFixture();
  const sd = fakeSalesDocPayments({ duplicateOnUpdate: true });
  await CashPostingService.save('c', 'day', sd.adapter);
  db.update('daily_order_entries', 'row', { cash_payment: 70 });
  const r = await CashPostingService.save('c', 'day', sd.adapter);
  assert.equal(r.updated, 0);
  assert.match(r.message, /nusxa/);
  assert.equal(db.getTable('integration_transactions')[0].status, 'UNCERTAIN');
  const sets = sd.sets();
  await CashPostingService.save('c', 'day', sd.adapter);
  assert.equal(sd.sets(), sets, 'not re-sent blindly');
});

test('a sent payment set to 0 or a deleted row is marked for deletion in SalesDoc and verified there', async () => {
  postingFixture();
  db.insert('daily_order_entries', { id: 'row2', company_id: 'c', cash_day_id: 'day', customer_id: 'k', order_number: '2', sale_amount: 50, cash_payment: 50, integration_id: 'i', external_order_id: 'o2', customer_ref: { SD_id: 'cl' }, order_ref: { SD_id: 'o2' } } as any);
  const sd = fakeSalesDocPayments();
  await CashPostingService.save('c', 'day', sd.adapter);
  assert.equal(sd.store.length, 2);
  db.update('daily_order_entries', 'row', { cash_payment: 0 });
  db.delete('daily_order_entries', 'row2');
  const r = await CashPostingService.save('c', 'day', sd.adapter);
  assert.equal(r.cancel_required.length, 2);
  assert.match(r.message, /qo‘lda o‘chiring/);
  assert.equal(db.find('integration_transactions', t => t.status === 'CANCEL_REQUIRED').length, 2);
  assert.throws(() => CashService.deleteCashDay('c', 'day', 'u', 'u@x', 'xato'), /distribyutor tizimiga yuborilgan/, 'the day cannot be deleted while payments remain there');
  // Deleted by hand in SalesDoc (only one of them so far).
  sd.store.splice(0, 1);
  const v1 = await CashPostingService.verifyCancellations('c', 'day', sd.adapter);
  assert.equal(v1.cancelled, 1);
  assert.equal(v1.still.length, 1);
  sd.store.splice(0, 1);
  const v2 = await CashPostingService.verifyCancellations('c', 'day', sd.adapter);
  assert.equal(v2.cancelled, 1);
  assert.equal(db.find('integration_transactions', t => t.status === 'CANCELLED').length, 2);
});

test('one row that cannot be sent does not stop the other payments of the day', async () => {
  postingFixture();
  db.insert('daily_order_entries', { id: 'loose', company_id: 'c', cash_day_id: 'day', customer_id: 'k', order_number: '9', sale_amount: 10, cash_payment: 10 } as any);
  const sd = fakeSalesDocPayments();
  const r = await CashPostingService.save('c', 'day', sd.adapter);
  assert.equal(r.confirmed, 1);
  assert.match(r.message, /№9.*bog‘lanmagan/);
  assert.equal(sd.store.length, 1);
});

test('no payment type chosen: nothing is sent, and the message says where to choose it', async () => {
  postingFixture();
  db.update('integrations', 'i', { config: {} });
  const adapter = new SalesDocAdapter();
  let sent = 0;
  adapter.executeSalesDocMethod = async () => { sent++; return { completed: 1, error: 0 }; };
  await assert.rejects(() => CashPostingService.save('c', 'day', adapter), /tanlanmagan/);
  assert.equal(sent, 0);
});

test('duplicate customer cards (SD-CUST-x and x) are merged into the one with the debt, references follow', () => {
  db.insert('customers', { id: 'old', company_id: 'c', code: 'SD-CUST-a0_1', name: 'Do‘kon', phone: '901', current_balance: 500, created_at: '2026-09-27T00:00:00Z' } as any);
  db.insert('customers', { id: 'dup', company_id: 'c', code: 'a0_1', name: 'Do‘kon', phone: '', agent_id: 'ag', current_balance: 0, created_at: '2026-09-30T00:00:00Z' } as any);
  db.insert('customer_balance_transactions', { id: 't', company_id: 'c', customer_id: 'old', transaction_type: 'DEBIT', amount: 500, date: today, created_at: '2026-09-27T00:00:00Z' } as any);
  db.insert('sales_orders', { id: 'o', company_id: 'c', customer_id: 'dup', status: 'DELIVERED', order_date: today, total_sales: 10 } as any);
  db.insert('crm_tasks', { id: 'task', company_id: 'c', customer_id: 'dup', title: 'x' } as any);
  mergeDuplicateCustomersMigration.up();
  assert.equal(db.findById('customers', 'dup'), null);
  const kept = db.findById('customers', 'old')!;
  assert.equal(kept.code, 'a0_1');
  assert.equal(kept.agent_id, 'ag', 'missing fields taken from the duplicate');
  assert.equal(db.findById('sales_orders', 'o')!.customer_id, 'old');
  assert.equal(db.findById('crm_tasks', 'task')!.customer_id, 'old');
  assert.equal(db.getTable('_quarantine').filter(q => q.table === 'customers').length, 1);
});

test('history import finds a customer stored with the old SD-CUST- prefix instead of creating a copy', async () => {
  db.insert('integrations', { id: 'sd', company_id: 'c', provider_name: 'SALESDOC', status: 'CONNECTED', config: { history_start_date: today } } as any);
  db.insert('customers', { id: 'old', company_id: 'c', code: 'SD-CUST-c1', name: 'Mijoz 1', current_balance: 0, created_at: today } as any);
  const adapter = new SalesDocAdapter();
  adapter.importProducts = async () => [];
  adapter.importOrders = async () => [order('z', today)];
  await SalesDocHistoryService.sync('c', 'sd', 'u', adapter, 'full');
  assert.equal(db.getTable('customers').length, 1);
  assert.equal(db.getTable('sales_orders')[0].customer_id, 'old');
});

test('period comparison: sales, expenses by category, agents, products, new and lost customers', () => {
  const A = { from: '2026-08-01', to: '2026-08-31' }, B = { from: '2026-09-01', to: '2026-09-30' };
  db.insert('agents', { id: 'ag', company_id: 'c', full_name: 'Ali', code: 'd0_1' } as any);
  for (const [id, cust, date, total, status] of [
    ['o1', 'k1', '2026-08-10', 1000, 'DELIVERED'], ['o2', 'k2', '2026-08-12', 500, 'DELIVERED'],
    ['o3', 'k1', '2026-09-05', 1500, 'DELIVERED'], ['o4', 'k3', '2026-09-06', 300, 'DELIVERED'], ['o5', 'k3', '2026-09-07', 999, 'PENDING']
  ] as const) db.insert('sales_orders', { id, company_id: 'c', customer_id: cust, agent_id: 'ag', order_date: date, total_sales: total, discount_amount: 0, return_amount: 0, total_cogs: 0, status } as any);
  db.insert('sales_order_items', { id: 'i1', sales_order_id: 'o1', sku: 'p1', product_name: 'Choy', quantity: 10, total_amount: 1000 } as any);
  db.insert('sales_order_items', { id: 'i3', sales_order_id: 'o3', sku: 'p1', product_name: 'Choy', quantity: 15, total_amount: 1500 } as any);
  db.insert('sales_order_items', { id: 'i2', sales_order_id: 'o2', sku: 'p2', product_name: 'Qahva', quantity: 5, total_amount: 500 } as any);
  db.insert('expense_categories', { id: 'fuel', company_id: 'c', name: 'Yoqilg‘i' } as any);
  db.insert('expenses', { id: 'e1', company_id: 'c', date: '2026-08-15', category_id: 'fuel', amount: 100, status: 'CONFIRMED' } as any);
  db.insert('expenses', { id: 'e2', company_id: 'c', date: '2026-09-15', category_id: 'fuel', amount: 250, status: 'CONFIRMED' } as any);
  db.insert('customers', { id: 'k2', company_id: 'c', name: 'Ketgan mijoz', code: 'K2', phone: '90', current_balance: 0 } as any);
  const r = comparePeriods('c', A, B);
  const line = (k: string) => r.lines.find(l => l.key === k)!;
  assert.deepEqual([line('net_revenue').a, line('net_revenue').b], [1500, 1800], 'revenue: delivered only');
  // Orders still on the way are counted as taken orders (the system closes them as delivered days later).
  assert.deepEqual([line('orders').a, line('orders').b], [2, 3]);
  assert.equal(line('pending').b, 999);
  assert.deepEqual([line('taken').a, line('taken').b], [1500, 2799]);
  assert.deepEqual(r.pending.b, { count: 1, sum: 999 });
  assert.deepEqual([line('new_customers').a, line('new_customers').b], [2, 1]);
  assert.deepEqual([line('exp:fuel').a, line('exp:fuel').b], [100, 250]);
  assert.equal(line('exp:fuel').good, 'down', 'a growing cost is bad');
  assert.equal(line('net_profit').b, null, 'unknown cost: profit not invented');
  assert.deepEqual(r.agents.map(a => [a.name, a.sales_a, a.sales_b, a.pending_b]), [['Ali', 1500, 2799, 999]]);
  assert.equal(r.products.gainers[0].sku, 'p1');
  assert.equal(r.products.losers[0].sku, 'p2');
  assert.equal(r.customers.stopped, 1);
  assert.equal(r.customers.declining[0].name, 'Ketgan mijoz');
  assert.throws(() => comparePeriods('c', { from: '2026-09-30', to: '2026-09-01' }, B), /noto/);

  // One agent in depth: totals, days, categories, and the customers who stopped / started.
  db.insert('products', { id: 'pp1', company_id: 'c', sku: 'p1', name: 'Choy', category: 'Ichimlik', unit: 'dona', purchase_cost: 0, current_cost: 0, selling_price: 0 } as any);
  const g = compareAgent('c', 'ag', A, B);
  assert.equal(g.agent.name, 'Ali');
  assert.deepEqual([g.totals.a.sales, g.totals.b.sales, g.totals.b.delivered, g.totals.b.pending], [1500, 2799, 1800, 999]);
  assert.deepEqual([g.totals.a.orders, g.totals.b.orders, g.totals.b.customers, g.totals.b.new_customers], [2, 3, 2, 1]);
  assert.equal(g.daily.length, 31, 'the longer period sets the days');
  assert.equal(g.daily.find((x: any) => x.b_date === '2026-09-05')!.b, 1500);
  assert.equal(g.daily[30].b, null, 'September has no 31st day');
  assert.deepEqual(g.categories.find((c: any) => c.name === 'Ichimlik'), { name: 'Ichimlik', sales_a: 1000, sales_b: 1500, diff: 500 });
  assert.deepEqual(g.customers.stopped.map((c: any) => c.customer_id), ['k2']);
  assert.deepEqual(g.customers.started.map((c: any) => c.customer_id), ['k3']);
  assert.deepEqual(g.customers.growing.map((c: any) => c.customer_id), ['k1']);
  assert.throws(() => compareAgent('c', 'nobody', A, B), /topilmadi/);
});

test('one agent profile shared by two teams: sales split by the teams’ product categories', () => {
  const A = { from: '2026-08-01', to: '2026-08-31' }, B = { from: '2026-09-01', to: '2026-09-30' };
  const owner = { id: 'u', email: 'u@x' };
  db.insert('agents', { id: 'tp1', company_id: 'c', full_name: 'ТП1', code: 'd0_1' } as any);
  for (const [sku, cat] of [['s1', 'Семичка'], ['b1', 'BRANDO'], ['x1', 'Boshqa narsa']]) db.insert('products', { id: sku, company_id: 'c', sku, name: sku, category: cat, unit: 'dona', purchase_cost: 0, current_cost: 0, selling_price: 0 } as any);
  // August: 1000 of Семичка (team 1). September: one order of 1000 + 1000 with a 200 discount, and an order without lines.
  db.insert('sales_orders', { id: 'o1', company_id: 'c', customer_id: 'k1', agent_id: 'tp1', order_date: '2026-08-05', total_sales: 1000, discount_amount: 0, return_amount: 0, status: 'DELIVERED' } as any);
  db.insert('sales_order_items', { id: 'i1', sales_order_id: 'o1', sku: 's1', product_id: 's1', product_name: 's1', quantity: 1, total_amount: 1000 } as any);
  db.insert('sales_orders', { id: 'o2', company_id: 'c', customer_id: 'k2', agent_id: 'tp1', order_date: '2026-09-05', total_sales: 2000, discount_amount: 200, return_amount: 0, status: 'PENDING' } as any);
  db.insert('sales_order_items', { id: 'i2', sales_order_id: 'o2', sku: 's1', product_id: 's1', product_name: 's1', quantity: 1, total_amount: 1000 } as any);
  db.insert('sales_order_items', { id: 'i3', sales_order_id: 'o2', sku: 'b1', product_id: 'b1', product_name: 'b1', quantity: 1, total_amount: 1000 } as any);
  db.insert('sales_orders', { id: 'o3', company_id: 'c', customer_id: 'k3', agent_id: 'tp1', order_date: '2026-09-06', total_sales: 500, discount_amount: 0, return_amount: 0, status: 'DELIVERED' } as any);

  assert.deepEqual(comparePeriods('c', A, B).agent_teams, [], 'no teams: no split');
  assert.throws(() => TeamsService.save('c', [{ name: '1-Komanda', categories: ['Семичка'] }, { name: '2-Komanda', categories: ['Семичка'] }], owner), /ikkita komandada/);
  TeamsService.save('c', [{ name: '1-Komanda', categories: ['Семичка'], members: { tp1: 'Ali' } }, { name: '2-Komanda', categories: ['BRANDO'], members: { tp1: 'Vali' } }], owner);

  const rows = comparePeriods('c', A, B).agent_teams.map((t: any) => [t.team_name, t.person, t.sales_a, t.sales_b, t.orders_b]);
  assert.deepEqual(rows, [
    ['1-Komanda', 'Ali', 1000, 900, 1],          // 1000 less its half of the 200 discount
    ['2-Komanda', 'Vali', 0, 900, 1],
    ['Boshqa (komandasiz)', '', 0, 500, 1]       // the order without lines
  ]);
  assert.equal(compareAgent('c', 'tp1', A, B).teams.length, 3);
  const view = TeamsService.view('c');
  assert.equal(view.categories.find(c => c.name === 'Boshqa narsa')!.team_id, null);
});

test('customers bought less: their agent and territory are shown; the territory comes from the client directory once a day', async () => {
  const A = { from: '2026-08-01', to: '2026-08-31' }, B = { from: '2026-09-01', to: '2026-09-30' };
  db.insert('agents', { id: 'ag', company_id: 'c', full_name: 'Ali', code: 'd0_1' } as any);
  db.insert('integrations', { id: 'sd', company_id: 'c', provider_name: 'SALESDOC', status: 'CONNECTED', config: {} } as any);
  db.insert('customers', { id: 'k1', company_id: 'c', code: 'd0_77', name: 'Do‘kon', phone: '', current_balance: 0 } as any);
  db.insert('sales_orders', { id: 'o1', company_id: 'c', customer_id: 'k1', agent_id: 'ag', order_date: '2026-08-10', total_sales: 1000, discount_amount: 0, return_amount: 0, total_cogs: 0, status: 'DELIVERED' } as any);

  // The card has no agent: the agent of the last order in period A is shown; no territory yet.
  let r = comparePeriods('c', A, B);
  assert.deepEqual([r.customers.declining[0].agent_name, r.customers.declining[0].territory], ['Ali', '']);

  // Territory as a reference resolved by the territory directory; once a day only.
  const adapter: any = new SalesDocAdapter();
  let calls = 0;
  adapter.readAll = async (_c: any, method: string) => {
    calls++;
    // SalesDoc gives the client's territory as "city": a reference to its city directory.
    if (method === 'getClient') return [{ SD_id: 'd0_77', name: 'Do‘kon', tel: '+998901112233', city: { SD_id: 't5' } }];
    if (method === 'getCity') return [{ SD_id: 't5', name: 'Chust' }];
    return [];
  };
  const t0 = Date.parse('2026-10-03T08:00:00Z');
  assert.deepEqual(await SalesDocHistoryService.refreshCustomerCards('c', 'sd', adapter, {}, t0), { updated: 1, skipped: false });
  assert.equal((await SalesDocHistoryService.refreshCustomerCards('c', 'sd', adapter, {}, t0 + 3600_000)).skipped, true);
  const k1 = db.findById('customers', 'k1')!;
  assert.equal(db.findById('territories', k1.territory_id!)!.name, 'Chust');
  assert.equal(k1.phone, '+998901112233', 'an empty phone is filled');
  r = comparePeriods('c', A, B);
  assert.equal(r.customers.declining[0].territory, 'Chust');
  assert.ok(calls >= 2);
});

test('distribution import never invents sample orders', () => {
  db.insert('cash_registers', { id: 'r', company_id: 'c', code: 'main' } as any);
  db.insert('customers', { id: 'k', company_id: 'c', code: 'K', name: 'K' } as any);
  const day = CashService.openCashDay({ company_id: 'c', register_id: 'r', date: today, user_id: 'u', user_email: 'u@test', user_role: 'ADMIN' });
  const result = CashService.syncDailyOrdersFromDistribution({ company_id: 'c', cash_day_id: day.id, date: today, user_id: 'u', user_email: 'u@test' });
  assert.equal(result.count, 0);
  assert.equal(db.find('sales_orders', () => true).length, 0);
});
