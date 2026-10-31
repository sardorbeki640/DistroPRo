import type { DistributionCapabilities, IntegrationAdapter } from './interfaces.ts';

/** What an adapter can do, from the methods it has (no system names). Kept import-free so any module can use it. */
export function capabilitiesOf(adapter: IntegrationAdapter): DistributionCapabilities {
  const a = adapter as any;
  return {
    payments: typeof a.postPayment === 'function' && typeof a.listDayPayments === 'function',
    visits: typeof a.importVisits === 'function',
    priceTypes: typeof a.listPriceTypes === 'function',
    paymentTypes: typeof a.listPaymentTypes === 'function',
    history: typeof a.importOrders === 'function' && typeof a.importProducts === 'function' && typeof a.readAll === 'function',
    historicalStock: typeof a.listWarehouses === 'function' && typeof a.importStockForDate === 'function'
  };
}
