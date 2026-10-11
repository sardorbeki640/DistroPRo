import { db } from '../db/database.ts';
import { canonicalCustomerCode } from './cogs.ts';

/** SalesDoc ids look like "d0_20" / "a0_1004". */
export const isSalesDocId = (code?: string | null) => /^[a-z]\d+_\d+$/i.test(canonicalCustomerCode(String(code || '')));

/** Linko ids are stored with an "lk-" prefix (customers lk-<market>, orders lk-<order>, products lk-<product>, agents lk-u<user>). */
export const isLinkoId = (code?: string | null) => /^lk-/i.test(String(code || ''));

/** Tags the rows of whichever distribution system the integration is. */
export function tagIntegrationRows(integrationId: string): Record<string, number> {
  const integration = db.findById('integrations', integrationId);
  if (!integration) return {};
  return /LINKO/.test(integration.provider_name.toUpperCase())
    ? tagRows(integrationId, isLinkoId, 'LINKO')
    : tagRows(integrationId, isSalesDocId, 'SALESDOC');
}

/** Kept for the 011 migration. */
export function tagSalesDocRows(integrationId: string): Record<string, number> {
  return tagRows(integrationId, isSalesDocId, 'SALESDOC');
}

/**
 * Marks rows that came from an integration with its id (source_integration_id), so they can be hidden while it is
 * switched off. Idempotent: only untagged rows are touched. Rows entered by hand stay untagged and always visible.
 */
function tagRows(integrationId: string, belongs: (code?: string | null) => boolean, productSource: string): Record<string, number> {
  const integration = db.findById('integrations', integrationId);
  if (!integration) return {};
  const companyId = integration.company_id;
  const counts: Record<string, number> = { sales_orders: 0, customers: 0, products: 0, agents: 0, sales_order_items: 0, customer_balance_transactions: 0 };
  const untagged = (r: any) => r.company_id === companyId && (r.source_integration_id === undefined || r.source_integration_id === null);
  // Rows are tagged in place, so each changed row is marked for saving.
  const changed: [string, any][] = [];
  db.transaction(() => {
    const orders = new Set<string>();
    const customersWithOrders = new Set<string>();
    for (const o of db.getTableIncludingHidden('sales_orders') as any[]) {
      if (o.source_integration_id === integrationId) { orders.add(o.id); customersWithOrders.add(o.customer_id); continue; }
      if (!untagged(o) || !o.external_id || o.source !== 'DISTRIBUTION' || !belongs(o.external_id)) continue;
      o.source_integration_id = integrationId; changed.push(['sales_orders', o]); orders.add(o.id); customersWithOrders.add(o.customer_id); counts.sales_orders++;
    }
    const customers = new Set<string>();
    for (const c of db.getTableIncludingHidden('customers') as any[]) {
      if (c.source_integration_id === integrationId) { customers.add(c.id); continue; }
      if (!untagged(c) || !(belongs(c.code) || customersWithOrders.has(c.id))) continue;
      c.source_integration_id = integrationId; changed.push(['customers', c]); customers.add(c.id); counts.customers++;
    }
    for (const p of db.getTableIncludingHidden('products') as any[]) {
      if (untagged(p) && p.source === productSource) { p.source_integration_id = integrationId; changed.push(['products', p]); counts.products++; }
    }
    for (const a of db.getTableIncludingHidden('agents') as any[]) {
      if (untagged(a) && belongs(a.code)) { a.source_integration_id = integrationId; changed.push(['agents', a]); counts.agents++; }
    }
    for (const i of db.getTableIncludingHidden('sales_order_items') as any[]) {
      if ((i.source_integration_id === undefined || i.source_integration_id === null) && orders.has(i.sales_order_id)) { i.source_integration_id = integrationId; changed.push(['sales_order_items', i]); counts.sales_order_items++; }
    }
    for (const t of db.getTableIncludingHidden('customer_balance_transactions') as any[]) {
      if (untagged(t) && customers.has(t.customer_id)) { t.source_integration_id = integrationId; changed.push(['customer_balance_transactions', t]); counts.customer_balance_transactions++; }
    }
    const byTable = new Map<string, any[]>();
    for (const [table, row] of changed) byTable.set(table, [...(byTable.get(table) || []), row]);
    for (const [table, rows] of byTable) db.markDirty(table, rows);
  });
  return counts;
}
