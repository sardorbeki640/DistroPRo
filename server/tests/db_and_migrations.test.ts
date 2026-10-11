import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../db/database.ts';
import { migrator } from '../db/migrator.ts';
import { initialSchemaMigration } from '../db/migrations/001_initial_schema.ts';
import { seedInitialDataMigration } from '../db/migrations/002_seed_initial_data.ts';

describe('Database & Migrations Architecture', () => {
  before(async () => {
    migrator.register(initialSchemaMigration);
    migrator.register(seedInitialDataMigration);
    await migrator.run();
  });

  test('Migration records are persisted and idempotent', async () => {
    const migrations = db.getTable('_migrations');
    assert.ok(migrations.length >= 2, 'Should have executed at least 2 migrations');
    
    // Running second time should not re-apply
    const secondRun = await migrator.run();
    assert.equal(secondRun.executed.length, 0, 'No migrations should re-execute');
    assert.ok(secondRun.alreadyApplied.length >= 2);
  });

  test('Master company and registers are initialized', () => {
    const companies = db.getTable('companies');
    assert.ok(companies.length > 0, 'Companies should be initialized');
    assert.equal(companies[0].id, 'comp-apex-001');

    const registers = db.getTable('cash_registers');
    assert.ok(registers.length > 0, 'Cash registers should exist');
  });

  test('Audit logs cannot be deleted (Immutability check)', () => {
    db.insert('audit_logs', { id: 'audit-test', company_id: 'comp-apex-001' } as any);
    const logs = db.getTable('audit_logs');
    assert.ok(logs.length > 0, 'Audit logs should exist');
    const firstLogId = logs[0].id;

    assert.throws(
      () => {
        db.delete('audit_logs', firstLogId);
      },
      /Security Violation/
    );
  });
});
