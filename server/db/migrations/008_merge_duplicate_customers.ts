import { randomUUID } from 'node:crypto';
import { db } from '../database.ts';
import type { Migration } from '../migrator.ts';
import type { Customer } from '../schema.ts';
import { canonicalCustomerCode } from '../../services/cogs.ts';

/**
 * The order-history import (2026-09-30) looked customers up by "a0_1004" while older imports had stored
 * "SD-CUST-a0_1004", so it created a second card for ~1 000 customers: debt on one, orders on the other.
 * This merges every group with the same canonical code into one card. Nothing is deleted: the extra cards
 * go to _quarantine and every reference (orders, cash rows, ledger, CRM …) is moved to the kept card.
 */
export const mergeDuplicateCustomersMigration: Migration = {
  id: '008_merge_duplicate_customers',
  name: 'Bir mijozning takroriy kartalarini birlashtirish',
  up: () => {
    db.backup('008');
    const now = new Date().toISOString();
    db.transaction(() => {
      const groups = new Map<string, Customer[]>();
      for (const c of db.getTable('customers')) {
        const code = canonicalCustomerCode(c.code);
        if (!code) continue;
        const key = `${c.company_id}|${code}`;
        groups.set(key, [...(groups.get(key) || []), c]);
      }
      const ledgerCount = new Map<string, number>();
      for (const t of db.getTable('customer_balance_transactions')) ledgerCount.set(t.customer_id, (ledgerCount.get(t.customer_id) || 0) + 1);

      const redirect = new Map<string, string>();
      const keepers: Customer[] = [];
      const moved: any[] = [];
      for (const [key, list] of groups) {
        if (list.length < 2) continue;
        // Keep the card that carries money history (ledger/balance); otherwise the oldest.
        const keep = [...list].sort((a, b) =>
          (ledgerCount.get(b.id) || 0) - (ledgerCount.get(a.id) || 0) ||
          Math.abs(b.current_balance || 0) - Math.abs(a.current_balance || 0) ||
          a.created_at.localeCompare(b.created_at))[0];
        const merged: Customer = { ...keep, code: key.split('|')[1] };
        for (const other of list) {
          if (other.id === keep.id) continue;
          redirect.set(other.id, keep.id);
          merged.phone = merged.phone || other.phone;
          merged.address = merged.address || other.address;
          merged.agent_id = merged.agent_id || other.agent_id;
          merged.owner_user_id = merged.owner_user_id || other.owner_user_id;
          merged.tags = [...new Set([...(merged.tags || []), ...(other.tags || [])])];
          moved.push({ id: randomUUID(), table: 'customers', reason: `Takroriy karta, ${keep.id} ga birlashtirildi`, row: other, moved_at: now });
        }
        keepers.push({ ...merged, updated_at: now });
      }
      if (!redirect.size) return;

      // Move every reference to the kept card, in every table that has a customer_id.
      const data = db.getData() as any;
      for (const [table, rows] of Object.entries(data)) {
        if (table === 'customers' || table === '_quarantine' || !Array.isArray(rows)) continue;
        const changed: any[] = [];
        for (const row of rows as any[]) {
          if (row && typeof row === 'object' && row.customer_id && redirect.has(row.customer_id)) { row.customer_id = redirect.get(row.customer_id); changed.push(row); }
        }
        if (changed.length) db.markDirty(table, changed);
      }
      db.removeWhere('customers', c => redirect.has(c.id));
      db.upsertMany('customers', keepers);
      db.upsertMany('_quarantine', moved);
    });
  }
};
