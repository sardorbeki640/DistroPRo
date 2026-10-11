// Runs all migrations against the database in FINANCE_DATA_DIR (use a COPY) and prints what changed.
// Usage: FINANCE_DATA_DIR=<folder with a copy of finance_db.json> npx tsx scripts/migrate-copy-check.ts
import { migrator } from '../server/db/migrator.ts';
import { initialSchemaMigration } from '../server/db/migrations/001_initial_schema.ts';
import { seedInitialDataMigration } from '../server/db/migrations/002_seed_initial_data.ts';
import { cashCoreExtensionsMigration } from '../server/db/migrations/003_cash_core_extensions.ts';
import { expensesPhase3Migration } from '../server/db/migrations/004_expenses_phase3.ts';
import { customerBalanceSalaryAnalyticsMigration } from '../server/db/migrations/005_customer_balance_salary_analytics.ts';
import { dataIntegrityRepairMigration } from '../server/db/migrations/006_data_integrity_repair.ts';
import { crmAndStaffAccountsMigration } from '../server/db/migrations/007_crm_and_staff_accounts.ts';
import { mergeDuplicateCustomersMigration } from '../server/db/migrations/008_merge_duplicate_customers.ts';
import { db } from '../server/db/database.ts';
import { AnalyticsService } from '../server/services/analytics.service.ts';
import { NotificationService } from '../server/services/notification.service.ts';
import { canonicalCustomerCode as canonical } from '../server/services/cogs.ts';

if (!process.env.FINANCE_DATA_DIR) throw new Error('FINANCE_DATA_DIR ga nusxa papkasini bering; asosiy baza bilan ishlatmang.');
for (const m of [initialSchemaMigration, seedInitialDataMigration, cashCoreExtensionsMigration, expensesPhase3Migration, customerBalanceSalaryAnalyticsMigration, dataIntegrityRepairMigration, crmAndStaffAccountsMigration, mergeDuplicateCustomersMigration]) migrator.register(m);
const t0 = Date.now();
console.log(await migrator.run(), `${Date.now() - t0} ms`);
const d = db.getData();
const company = d.companies[0]?.id || 'comp-apex-001';
console.log('quarantine', d._quarantine.length, JSON.stringify(d._quarantine.reduce((m: any, q) => (m[q.table] = (m[q.table] || 0) + 1, m), {})));
console.log('placeholder phones left', d.customers.filter(c => c.phone === '+998 90 000 00 00').length);
console.log('opening ledger rows', d.customer_balance_transactions.filter(t => t.reference_type === 'OPENING').length);
const aging = AnalyticsService.getAgingReport(company);
console.log('aging rows', aging.length, 'unknown-age total', aging.reduce((s, r) => s + r.bucket_unknown, 0), 'debt total', aging.reduce((s, r) => s + r.current_debt, 0));
console.log('overdue customers (>=10 days or over limit)', NotificationService.getOverdueCustomerDebtsSummary(company, 10).customers_count);
const pnl = AnalyticsService.getProfitAndLoss(company, '2026-06-01', '2026-09-30');
console.log('pnl', JSON.stringify({ net_revenue: pnl.net_revenue, pending: pnl.pending_sales, coverage: pnl.cogs_coverage_percent, net_profit: pnl.net_profit, note: pnl.profit_note }));
console.log('integrations', d.integrations.map(i => `${i.provider_name}:${i.status}`).join(', '));
const names = new Map<string, number>(); for (const c of d.customers) names.set(canonical(c.code), (names.get(canonical(c.code)) || 0) + 1);
console.log('customers', d.customers.length, 'duplicate codes left', [...names.values()].filter(n => n > 1).length);
const sev = d.customers.filter(c => /Sevetafor Tagi 2/.test(c.name));
console.log('Sevetafor', JSON.stringify(sev.map(c => ({ code: c.code, balance: c.current_balance, orders: d.sales_orders.filter(o => o.customer_id === c.id).length }))));
console.log('orders without customer', d.sales_orders.filter(o => !d.customers.some(c => c.id === o.customer_id)).length);
