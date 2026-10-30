import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inventoryObservation } from '../services/inventory-observation.ts';

test('inventory zero date is based on the first confirmed zero snapshot, not sale recency', () => {
  assert.deepEqual(inventoryObservation({ stock_quantity: 8, last_in_stock_at: '2026-10-01' } as any, 0, '2026-10-05'), {
    stock_observed_at: '2026-10-05', zero_stock_observed_at: '2026-10-05'
  });
  assert.deepEqual(inventoryObservation({ stock_quantity: 0, zero_stock_observed_at: '2026-10-05' } as any, 0, '2026-10-08'), {
    stock_observed_at: '2026-10-08', zero_stock_observed_at: '2026-10-05'
  });
  assert.deepEqual(inventoryObservation({ stock_quantity: 0, last_sale_date: '2026-10-01' } as any, 5, '2026-10-09'), {
    last_in_stock_at: '2026-10-09', zero_stock_observed_at: null, stock_observed_at: '2026-10-09'
  });
  assert.deepEqual(inventoryObservation({ stock_quantity: 0 } as any, 0, '2026-10-09'), {
    stock_observed_at: '2026-10-09', zero_stock_observed_at: '2026-10-09'
  }, 'the first zero snapshot is recorded even when the app has no earlier sales or positive stock snapshot');
});
