import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../db/database.ts';
import { buildResults } from '../routes/loyalty.routes.ts';
import type { LoyaltyProgram } from '../db/schema.ts';
import type { ExternalSyncOrder } from '../integrations/interfaces.ts';

beforeEach(() => { db.init(); db.reset(); });

test('loyalty live results use delivered provider orders and selected product SKUs', () => {
  db.insert('products', { id: 'product-1', company_id: 'company-1', sku: 'd0_5', name: 'Semichka', unit: 'kg', is_active: true } as any);
  const program: LoyaltyProgram = {
    id: 'program-1', company_id: 'company-1', name: 'Semichka bonus', metric: 'QUANTITY', unit: 'kg',
    product_ids: ['product-1'], group_by_agent: true, start_date: '2026-11-01', end_date: '2026-11-30',
    tiers: [{ id: 'tier-1', threshold: 40, reward: 'Tefal' }], terms: [], is_active: true, created_by: 'owner', created_at: '2026-11-01'
  };
  const orders: ExternalSyncOrder[] = [
    { externalId: 'order-1', orderNumber: '1', customerCode: 'customer-1', customerName: 'Do‘kon 1', totalAmount: 900_000, status: 'DELIVERED', orderDate: '2026-11-05', itemsCount: 55, agentCode: 'agent-1', agentName: 'Agent 1', items: [
      { sku: 'd0_5', name: 'Semichka', quantity: 45, price: 1, total: 45 },
      { sku: 'd0_6', name: 'Boshqa', quantity: 10, price: 1, total: 10 }
    ] },
    { externalId: 'order-2', orderNumber: '2', customerCode: 'customer-2', customerName: 'Do‘kon 2', totalAmount: 1_000_000, status: 'PENDING', orderDate: '2026-11-06', itemsCount: 100, items: [{ sku: 'd0_5', name: 'Semichka', quantity: 100, price: 1, total: 100 }] }
  ];

  const result = buildResults(program, orders, 'SalesDoctor');
  assert.equal(result.summary.orders, 1);
  assert.equal(result.summary.customers, 1);
  assert.equal(result.rows[0].value, 45);
  assert.equal(result.rows[0].agent, 'Agent 1');
  assert.equal(result.rows[0].earned_reward, 'Tefal');
  assert.match(result.computed_from, /SalesDoctor/);
});
