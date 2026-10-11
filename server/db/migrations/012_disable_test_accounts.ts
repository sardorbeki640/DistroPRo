import { db } from '../database.ts';
import type { Migration } from '../migrator.ts';

/**
 * A SUPER_ADMIN test account from a database copy ("Smoke egasi (nusxa)", owner-smoke@example.test) reached the real
 * database when it was restored on 2026-09-30. It is switched off (kept for the audit trail, cannot sign in).
 */
export const disableTestAccountsMigration: Migration = {
  id: '012_disable_test_accounts',
  name: 'Sinov nusxasidan qolgan ortiqcha administrator hisobini o‘chirish',
  up: () => {
    for (const u of db.find('users', u => /@example\.test$/i.test(u.email || '') && u.status === 'ACTIVE')) {
      db.update('users', u.id, { status: 'INACTIVE' });
      console.log(`[Migration 012] Faolsizlantirildi: ${u.email}`);
    }
  }
};
