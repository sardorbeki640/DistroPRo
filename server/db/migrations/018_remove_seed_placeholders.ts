import { db } from '../database.ts';
import type { Migration } from '../migrator.ts';
import { AuditService } from '../../services/audit.service.ts';

/** Remove only exact onboarding placeholders. Real values and linked business records are preserved. */
export const removeSeedPlaceholdersMigration: Migration = {
  id: '018_remove_seed_placeholders',
  name: 'Boshlang‘ich namunaviy ma’lumotlarni haqiqiy bo‘lmagan deb belgilash',
  up: () => {
    const companyId = 'comp-apex-001';
    const now = new Date().toISOString();
    db.transaction(() => {
      const company = db.findById('companies', companyId);
      if (company && company.name === 'Apex Distribution LLC' && company.tax_id === '309876541'
        && company.address === "Toshkent sh., Chilonzor tumani, Bunyodkor shoh ko'chasi, 42-uy"
        && company.phone === '+998 71 200 44 88') {
        const before = { name: company.name, tax_id: company.tax_id, address: company.address, phone: company.phone };
        db.update('companies', companyId, { name: 'Korxona nomi sozlanmagan', tax_id: '', address: '', phone: '', updated_at: now });
        AuditService.log({ company_id: companyId, user_id: 'system', user_email: 'system', action: 'UPDATE', entity: 'Company', entity_id: companyId, old_value: before, new_value: { name: 'Korxona nomi sozlanmagan', tax_id: '', address: '', phone: '' }, reason: 'Boshlang‘ich namunaviy kompaniya ma’lumotlari olib tashlandi' });
      }

      // Demo credentials must never remain usable on a real deployment.
      for (const [id, email] of [
        ['usr-superadmin-01', 'superadmin@distro.uz'], ['usr-admin-01', 'admin@distro.uz'],
        ['usr-cashier-01', 'cashier@distro.uz'], ['usr-agent-01', 'agent@distro.uz']
      ]) {
        const user = db.findById('users', id);
        if (user?.email?.toLowerCase() === email && user.status === 'ACTIVE') {
          db.update('users', id, { status: 'INACTIVE' });
          AuditService.log({ company_id: user.company_id, user_id: 'system', user_email: 'system', action: 'UPDATE', entity: 'User', entity_id: id, old_value: { status: 'ACTIVE' }, new_value: { status: 'INACTIVE' }, reason: 'Boshlang‘ich sinov hisobi o‘chirildi' });
        }
      }

      // This endpoint is a fictional seed URL, not a verified external connection.
      const demo1c = db.findById('integrations', 'integ-1c-01');
      if (demo1c?.provider_name === '1C_ENTERPRISE_ERP' && demo1c.status === 'CONNECTED'
        && demo1c.config?.endpoint === 'https://erp.distro-apex.uz/api/v2/finance') {
        db.update('integrations', demo1c.id, { status: 'DISCONNECTED', last_sync_at: null });
        AuditService.log({ company_id: demo1c.company_id, user_id: 'system', user_email: 'system', action: 'UPDATE', entity: 'Integration', entity_id: demo1c.id, old_value: { status: 'CONNECTED', last_sync_at: demo1c.last_sync_at, endpoint: demo1c.config.endpoint }, new_value: { status: 'DISCONNECTED', last_sync_at: null }, reason: 'Tekshirilmagan boshlang‘ich 1C namunasi uzildi' });
      }

      // Seeded budgets are invented thresholds; keep the categories, clear only those exact defaults.
      const defaultBudgets: Record<string, number> = {
        'exp-cat-logistics': 15_000_000, 'exp-cat-office': 8_000_000, 'exp-cat-marketing': 10_000_000,
        'exp-cat-salary': 50_000_000, 'exp-cat-misc': 5_000_000
      };
      const clearedBudgets: string[] = [];
      for (const [id, limit] of Object.entries(defaultBudgets)) {
        const category = db.findById('expense_categories', id);
        if (category?.company_id === companyId && category.monthly_limit === limit) {
          db.update('expense_categories', id, { monthly_limit: 0, updated_at: now });
          clearedBudgets.push(category.name);
        }
      }
      if (clearedBudgets.length) AuditService.log({ company_id: companyId, user_id: 'system', user_email: 'system', action: 'UPDATE', entity: 'ExpenseCategory', entity_id: 'seeded-budgets', old_value: { categories: clearedBudgets }, new_value: { monthly_limit: 0 }, reason: 'Boshlang‘ich taxminiy xarajat limitlari tozalandi' });
    });
  }
};
