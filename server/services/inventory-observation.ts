import type { Product } from '../db/schema.ts';

/** Store only dates confirmed by an inventory observation; sales dates cannot prove when stock ran out. */
export function inventoryObservation(product: Pick<Product, 'stock_quantity' | 'last_in_stock_at' | 'last_sale_date' | 'zero_stock_observed_at'>, nextQuantity: number, observedOn: string) {
  if (nextQuantity > 0) {
    return { last_in_stock_at: observedOn, zero_stock_observed_at: null, stock_observed_at: observedOn };
  }

  // If this is the first empty snapshot, the exact depletion date is unknown. Record the first verified zero day;
  // if it was already empty before this version, begin the verifiable period now instead of backdating it.
  const hasPriorStockEvidence = Number(product.stock_quantity || 0) > 0 || !!product.last_in_stock_at || !!product.last_sale_date;
  return {
    stock_observed_at: observedOn,
    zero_stock_observed_at: product.zero_stock_observed_at || (hasPriorStockEvidence ? observedOn : null)
  };
}
