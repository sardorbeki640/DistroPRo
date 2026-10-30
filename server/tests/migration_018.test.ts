import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../db/database.ts';
import { initialSchemaMigration } from '../db/migrations/001_initial_schema.ts';
import { seedInitialDataMigration } from '../db/migrations/002_seed_initial_data.ts';
import { removeSeedPlaceholdersMigration } from '../db/migrations/018_remove_seed_placeholders.ts';

beforeEach(() => { db.init(); db.reset(); });

test('placeholder cleanup clears only untouched onboarding defaults and disables demo credentials', async () => {
  await initialSchemaMigration.up();
  await seedInitialDataMigration.up();
  await removeSeedPlaceholdersMigration.up();
  const company = db.findById('companies', 'comp-apex-001');
  assert.equal(company?.name, 'Korxona nomi sozlanmagan');
  assert.equal(company?.tax_id, '');
  assert.equal(db.findById('users', 'usr-superadmin-01')?.status, 'INACTIVE');
  assert.equal(db.findById('users', 'usr-admin-01')?.status, 'INACTIVE');
  assert.equal(db.findById('integrations', 'integ-1c-01')?.status, 'DISCONNECTED');
  assert.equal(db.findById('integrations', 'integ-1c-01')?.last_sync_at, null);
  assert.equal(db.findById('expense_categories', 'exp-cat-logistics')?.monthly_limit, 0);
});

test('placeholder cleanup preserves company, integration and budget values changed by the owner', async () => {
  await initialSchemaMigration.up();
  await seedInitialDataMigration.up();
  db.update('companies', 'comp-apex-001', { name: 'Haqiqiy korxona', tax_id: '123456789' });
  db.update('integrations', 'integ-1c-01', { config: { endpoint: 'https://erp.example.com/api' } as any });
  db.update('expense_categories', 'exp-cat-logistics', { monthly_limit: 23_000_000 });
  await removeSeedPlaceholdersMigration.up();
  assert.equal(db.findById('companies', 'comp-apex-001')?.name, 'Haqiqiy korxona');
  assert.equal(db.findById('companies', 'comp-apex-001')?.tax_id, '123456789');
  assert.equal(db.findById('integrations', 'integ-1c-01')?.status, 'CONNECTED');
  assert.equal(db.findById('expense_categories', 'exp-cat-logistics')?.monthly_limit, 23_000_000);
});
