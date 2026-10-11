import { db } from '../database.ts';
import type { Migration } from '../migrator.ts';
import { AuditService } from '../../services/audit.service.ts';

/**
 * Test runs that once wrote to the real database (before tests got their own) left expense categories such as
 * “Sinov Toifasi 1-3072” and “Audit Sinovi Toifasi”. They are taken out of the list: moved to `_quarantine` (kept,
 * not deleted). Only categories with exactly those test names, created in September 2026 and with no expense or
 * limit pointing at them, are moved; anything ever used stays.
 */
const TEST_NAME = /^(Sinov Toifasi 1|Audit Sinovi Toifasi|Kichik Limit Toifasi|Eski Toifa)(-\d{4})?$/;

export const removeTestExpenseCategoriesMigration: Migration = {
  id: '015_remove_test_expense_categories',
  name: 'Testdan qolgan xarajat toifalarini olib tashlash',
  up: () => {
    db.transaction(() => {
      const used = new Set(db.getTable('expenses').map(e => e.category_id));
      const limited = new Set((db.getTable('expense_limits') as any[]).map(l => l.category_id));
      const now = new Date().toISOString();
      const moved = db.find('expense_categories', c =>
        TEST_NAME.test(String(c.name || '').trim()) && String(c.created_at || '').startsWith('2026-09') && !used.has(c.id) && !limited.has(c.id));
      if (!moved.length) return;
      db.upsertMany('_quarantine', moved.map(c => ({ id: `q-expcat-${c.id}`, table: 'expense_categories', reason: 'Testdan qolgan toifa (015)', row: c, moved_at: now })));
      for (const c of moved) db.delete('expense_categories', c.id);
      const byCompany = new Map<string, string[]>();
      for (const c of moved) byCompany.set(c.company_id, [...(byCompany.get(c.company_id) || []), c.name]);
      for (const [company_id, names] of byCompany) {
        AuditService.log({ company_id, user_id: 'system', user_email: 'system', action: 'DELETE', entity: 'ExpenseCategory', entity_id: 'test-leftovers', old_value: { count: names.length, names }, new_value: null, reason: `Testdan qolgan ${names.length} ta xarajat toifasi olib tashlandi (_quarantine'da saqlanadi)` });
      }
    });
  }
};
