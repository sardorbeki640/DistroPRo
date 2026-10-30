import type { Product } from '../db/schema.ts';

/** Store only dates confirmed by an inventory observation; sales dates cannot prove when stock ran out. */
export function inventoryObservation(product: Pick<Product, 'stock_quantity' | 'last_in_stock_at' | 'last_sale_date' | 'zero_stock_observed_at'>, nextQuantity: number, observedOn: string) {
  if (nextQuantity > 0) {
    return { last_in_stock_at: observedOn, zero_stock_observed_at: null, stock_observed_at: observedOn };
  }

  // We cannot infer the physical depletion date from a sale or the previous positive snapshot. We can, however,
  // record when this app first verified zero stock. This provides a reliable lower bound for its duration.
  return {
    stock_observed_at: observedOn,
    zero_stock_observed_at: product.zero_stock_observed_at || observedOn
  };
}
