import { db } from '../database.ts';
import type { Migration } from '../migrator.ts';
import type { Permission, RolePermission } from '../schema.ts';

export const cashCoreExtensionsMigration: Migration = {
  id: '003_cash_core_extensions',
  name: 'Add cash:correct RBAC permission and initialize CashDay Phase 2 tracking fields',
  up: async () => {
    // 1. Add cash:correct permission
    const correctPermId = 'perm-cash-correct';
    const existingPerm = db.findById('permissions', correctPermId);
    if (!existingPerm) {
      const correctPerm: Permission = {
        id: correctPermId,
        module: 'cash',
        action: 'correct',
        code: 'cash:correct',
        description: 'KASSA modulida yopilgan kassa tranzaksiyalarini nazoratli to\'g\'rilash (CORRECT)'
      };
      db.insert('permissions', correctPerm);
    }

    // 2. Grant cash:correct to SUPER_ADMIN
    const rpSuperAdminId = 'rp-superadmin-perm-cash-correct';
    if (!db.findById('role_permissions', rpSuperAdminId)) {
      const rpSuperAdmin: RolePermission = {
        id: rpSuperAdminId,
        role_id: 'role-superadmin',
        permission_id: correctPermId
      };
      db.insert('role_permissions', rpSuperAdmin);
    }

    // 3. Grant cash:correct to ADMIN
    const rpAdminId = 'rp-admin-perm-cash-correct';
    if (!db.findById('role_permissions', rpAdminId)) {
      const rpAdmin: RolePermission = {
        id: rpAdminId,
        role_id: 'role-admin',
        permission_id: correctPermId
      };
      db.insert('role_permissions', rpAdmin);
    }

    // 4. Backfill calculated_closing_balance for existing cash_days if needed
    const cashDays = db.getTable('cash_days');
    for (const cd of cashDays) {
      let needsUpdate = false;
      const updates: any = {};
      if (cd.calculated_closing_balance === undefined) {
        updates.calculated_closing_balance = cd.closing_balance || cd.opening_balance || 0;
        needsUpdate = true;
      }
      if (cd.auto_opening_balance === undefined) {
        updates.auto_opening_balance = cd.opening_balance || 0;
        updates.manual_opening_adjustment = 0;
        needsUpdate = true;
      }
      if (cd.actual_closing_balance === undefined && cd.status === 'CLOSED') {
        updates.actual_closing_balance = cd.closing_balance || 0;
        needsUpdate = true;
      }
      if (needsUpdate) {
        db.update('cash_days', cd.id, updates);
      }
    }
  }
};
