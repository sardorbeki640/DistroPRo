import type { Product, SalesOrder, SalesOrderItem } from '../db/schema.ts';

type ImportedLine = { sku: string; name: string; quantity: number; price: number; total: number };

/**
 * One customer code whatever the import wrote: an early importer stored "SD-CUST-a0_1004",
 * order imports use "a0_1004". Both must point to the same customer.
 */
export function canonicalCustomerCode(code: unknown): string {
  return String(code ?? '').trim().replace(/^SD-CUST-/i, '');
}

/**
 * A purchase cost is usable only if it looks real: above 1 so'm and at least 5% of the selling price.
 * Price lists often hold placeholders (1 so'm) that would otherwise show ~100% margin.
 */
export function isPlausibleCost(cost: number, sellingPrice: number): boolean {
  if (!(cost > 1)) return false;
  return !(sellingPrice > 0) || cost >= sellingPrice * 0.05;
}

/**
 * Cost of goods from the product's purchase cost. A line without a positive cost is "unknown" —
 * it is never replaced by a percentage of the price, so reports can say "not calculated" instead of inventing profit.
 */
export function computeOrderCogs(items: ImportedLine[], productBySku: Map<string, Product>): {
  total: number;
  status: NonNullable<SalesOrder['cogs_status']>;
  lines: Omit<SalesOrderItem, 'id' | 'sales_order_id'>[];
} {
  let total = 0;
  let known = 0;
  const lines = items.map(item => {
    const product = productBySku.get(String(item.sku));
    const unitCost = product && isPlausibleCost(product.purchase_cost, product.selling_price || Number(item.price) || 0) ? product.purchase_cost : 0;
    const lineCogs = Math.round(unitCost * (Number(item.quantity) || 0));
    if (unitCost > 0) { known++; total += lineCogs; }
    return {
      product_id: product?.id || String(item.sku),
      sku: String(item.sku),
      product_name: item.name,
      quantity: Number(item.quantity) || 0,
      unit_price: Number(item.price) || 0,
      unit_cost: unitCost,
      total_amount: Number(item.total) || 0,
      total_cogs: lineCogs
    };
  });
  const status = !lines.length || known === 0 ? 'UNKNOWN' : known === lines.length ? 'KNOWN' : 'PARTIAL';
  return { total, status, lines };
}
