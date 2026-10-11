import { randomUUID } from 'node:crypto';
import { db } from '../database.ts';
import type { Migration } from '../migrator.ts';
import { CustomerBalanceService } from '../../services/customer_balance.service.ts';
import { businessDateOf, businessToday, isValidIsoDate } from '../../utils/date.ts';
import { isPlausibleCost } from '../../services/cogs.ts';

const PLACEHOLDER_PHONE = '+998 90 000 00 00';
const UNIMPLEMENTED_ADAPTERS = new Set(['1C_ENTERPRISE_ERP', 'SMARTUP', 'LINKO']);

/**
 * Repairs data written by earlier versions. Nothing is deleted: removed rows go to `_quarantine`,
 * and the whole file is copied first (finance_db.json.backup-006).
 */
export const dataIntegrityRepairMigration: Migration = {
  id: '006_data_integrity_repair',
  name: 'Test qoldiqlarini ajratish, soxta qiymatlarni tozalash, boshlang‘ich qarzni daftarga yozish',
  up: () => {
    db.backup('006');
    const now = new Date().toISOString();
    db.transaction(() => {
      const quarantine: { id: string; table: string; reason: string; row: any; moved_at: string }[] = [];
      const move = (table: string, reason: string, rows: any[]) => {
        for (const row of rows) quarantine.push({ id: randomUUID(), table, reason, row, moved_at: now });
      };

      // 1. Test leftovers: cash days with impossible dates (e.g. 2097-42-01) and rows pointing to missing days.
      const badDays = db.find('cash_days', d => !isValidIsoDate(d.date));
      move('cash_days', 'Sana haqiqiy emas (sinov qoldig‘i)', badDays);
      db.removeWhere('cash_days', d => !isValidIsoDate(d.date));
      const dayIds = new Set(db.getTable('cash_days').map(d => d.id));
      for (const table of ['cash_transactions', 'daily_order_entries'] as const) {
        const orphans = (db.getTable(table) as any[]).filter(r => r.cash_day_id && !dayIds.has(r.cash_day_id));
        move(table, 'Mavjud bo‘lmagan kassa kuniga bog‘langan (sinov qoldig‘i)', orphans);
        const ids = new Set(orphans.map(r => r.id));
        db.removeWhere(table, (r: any) => ids.has(r.id));
      }

      // 2. Placeholder phone numbers must not receive reminders.
      for (const c of db.find('customers', c => c.phone === PLACEHOLDER_PHONE)) db.update('customers', c.id, { phone: '' });
      for (const e of db.find('employees', e => e.phone === PLACEHOLDER_PHONE)) db.update('employees', e.id, { phone: '' });

      // 3. Purchase cost that is exactly 78% of the price was a guess; 1 so'm and similar are placeholders.
      for (const p of db.find('products', p => p.purchase_cost > 0 && ((p.selling_price > 0 && p.purchase_cost === Math.round(p.selling_price * 0.78)) || !isPlausibleCost(p.purchase_cost, p.selling_price)))) {
        db.update('products', p.id, { purchase_cost: 0, current_cost: 0 });
      }

      // 4. Adapters without a real client were marked "connected".
      for (const i of db.find('integrations', i => UNIMPLEMENTED_ADAPTERS.has(i.provider_name.toUpperCase()) && i.status === 'CONNECTED')) {
        db.update('integrations', i.id, { status: 'DISCONNECTED' });
      }

      // 5. Balances imported without ledger rows: record the difference as an opening balance of unknown age,
      //    so the ledger explains every balance and later postings do not wipe it.
      for (const c of db.getTable('customers')) {
        const ledger = CustomerBalanceService.calculateLedgerBalance(c.company_id, c.id);
        const diff = Math.round((c.current_balance || 0) - ledger);
        if (!diff) continue;
        db.insert('customer_balance_transactions', {
          id: randomUUID(),
          company_id: c.company_id,
          customer_id: c.id,
          transaction_type: diff > 0 ? 'DEBIT' : 'CREDIT',
          reference_type: 'OPENING',
          reference_id: 'OPENING-006',
          amount: Math.abs(diff),
          balance_after: c.current_balance || 0,
          date: businessDateOf(c.created_at) || businessToday(),
          age_unknown: true,
          source_system: 'IMPORT',
          comment: 'Boshlang‘ich qoldiq (import qilingan, paydo bo‘lgan sanasi noma’lum)',
          status: 'CONFIRMED',
          created_by: 'migration-006',
          created_at: now
        });
      }

      if (quarantine.length) db.upsertMany('_quarantine', quarantine);
    });
  }
};
