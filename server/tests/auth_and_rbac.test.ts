import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { AuthService } from '../services/auth.service.ts';
import { migrator } from '../db/migrator.ts';
import { initialSchemaMigration } from '../db/migrations/001_initial_schema.ts';
import { seedInitialDataMigration } from '../db/migrations/002_seed_initial_data.ts';

describe('Auth & RBAC Matrix Architecture', () => {
  before(async () => {
    migrator.register(initialSchemaMigration);
    migrator.register(seedInitialDataMigration);
    await migrator.run();
  });

  test('SuperAdmin can login and receives full permission set', async () => {
    const res = await AuthService.login('superadmin@distro.uz', 'SuperAdmin123!');
    assert.ok(res.token, 'Token should be returned');
    assert.equal(res.user.email, 'superadmin@distro.uz');
    assert.equal(res.user.is_super_admin, true);
    assert.ok(res.user.permissions.length > 50, 'Super admin should have all permissions');
  });

  test('Cashier has cash permissions but cannot manage settings/users', async () => {
    const res = await AuthService.login('cashier@distro.uz', 'Cashier123!');
    assert.equal(res.user.is_super_admin, false);

    const canViewCash = AuthService.hasPermission(res.user.id, 'cash', 'view');
    const canCreateCash = AuthService.hasPermission(res.user.id, 'cash', 'create');
    const canDeleteSettings = AuthService.hasPermission(res.user.id, 'settings', 'delete');

    assert.equal(canViewCash, true, 'Cashier should view cash');
    assert.equal(canCreateCash, true, 'Cashier should create cash transaction');
    assert.equal(canDeleteSettings, false, 'Cashier should NOT delete settings');
  });

  test('Invalid password fails authentication', async () => {
    await assert.rejects(
      async () => {
        await AuthService.login('superadmin@distro.uz', 'WrongPassword!');
      },
      /noto'g'ri/
    );
  });

  test('Admin cannot grant SUPER_ADMIN role (only SUPER_ADMIN can)', async () => {
    const adminRes = await AuthService.login('admin@distro.uz', 'Admin123!');
    const cashierRes = await AuthService.login('cashier@distro.uz', 'Cashier123!');

    assert.throws(
      () => {
        AuthService.assignRole(adminRes.user.id, cashierRes.user.id, 'role-superadmin', 'Test unauthorized promotion');
      },
      /SUPER_ADMIN rolini faqat SUPER_ADMIN boshqara oladi/
    );
  });
});
