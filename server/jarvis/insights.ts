import { db } from '../db/database.ts';
import { addDays, businessToday } from '../utils/date.ts';
import { listBackups } from '../services/backup.service.ts';

/**
 * What needs the owner's attention right now, computed from the books without AI (free, instant).
 * Shown on the Jarvis screen and given to the AI as context. Cached for a few minutes per company.
 */
export interface Insight { id: string; level: 'critical' | 'warning' | 'info'; title: string; detail: string; page?: string }

const cache = new Map<string, { at: number; list: Insight[] }>();
const TTL = 5 * 60_000;
// Plain spaces as thousand separators (locale formatting inserts U+202F, which speech and search trip over).
const fmt = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

/** Debt older than `days`, per customer, in one pass over the ledger (payments close the oldest debts first). */
function oldDebts(companyId: string, days: number) {
  const cutoff = addDays(businessToday(), -days);
  const byCustomer = new Map<string, { date: string; debit: number; credit: number }[]>();
  for (const t of db.getTable('customer_balance_transactions')) {
    if (t.company_id !== companyId || t.status === 'REVERSED') continue;
    const debit = t.debit_amount ?? (t.transaction_type === 'DEBIT' ? t.amount : 0);
    const credit = t.credit_amount ?? (t.transaction_type === 'CREDIT' ? t.amount : 0);
    const list = byCustomer.get(t.customer_id) || [];
    list.push({ date: t.age_unknown ? '' : t.date || '', debit: debit || 0, credit: credit || 0 });
    byCustomer.set(t.customer_id, list);
  }
  const rows: { customer_id: string; amount: number }[] = [];
  for (const [customerId, list] of byCustomer) {
    let paid = list.reduce((s, r) => s + r.credit, 0);
    let old = 0;
    for (const r of list.filter(r => r.debit > 0).sort((a, b) => a.date.localeCompare(b.date))) {
      const open = Math.max(0, r.debit - paid);
      paid = Math.max(0, paid - r.debit);
      if (open > 0 && r.date && r.date < cutoff) old += open;
    }
    if (old > 0) rows.push({ customer_id: customerId, amount: old });
  }
  return rows.sort((a, b) => b.amount - a.amount);
}

export function computeInsights(companyId: string, force = false): Insight[] {
  const hit = cache.get(companyId);
  if (!force && hit && Date.now() - hit.at < TTL) return hit.list;
  const today = businessToday();
  const hour = Number(new Date().toLocaleString('en-GB', { timeZone: 'Asia/Tashkent', hour: '2-digit', hour12: false }));
  const out: Insight[] = [];
  const name = (id: string) => db.findById('customers', id)?.name || '—';

  // Integrations that stopped working
  for (const i of db.find('integrations', i => i.company_id === companyId && i.provider_type === 'DISTRIBUTION' && !i.disabled)) {
    if (i.status === 'ERROR') out.push({ id: `integ-${i.id}`, level: 'critical', title: `${i.provider_name} ulanmagan`, detail: 'Ulanish xato bilan. Integratsiyalar bo‘limida sozlamani tekshiring.', page: 'integrations' });
    else if (i.config?.history?.status === 'FAILED') out.push({ id: `hist-${i.id}`, level: 'warning', title: `${i.provider_name} tarixi to‘xtagan`, detail: String(i.config.history.error || '').slice(0, 160), page: 'integrations' });
  }

  // Old debts
  const debts60 = oldDebts(companyId, 60);
  if (debts60.length) {
    const total = debts60.reduce((s, r) => s + r.amount, 0);
    out.push({
      id: 'debt-60', level: total > 50_000_000 ? 'critical' : 'warning', title: `60 kundan eski qarz: ${fmt(total)} so‘m`,
      detail: `${debts60.length} ta mijoz. Eng kattalari: ${debts60.slice(0, 3).map(r => `${name(r.customer_id)} (${fmt(r.amount)})`).join(', ')}.`, page: 'customers'
    });
  }

  // Stock (products that sell): already gone, and gone within three days
  const selling = db.find('products', p => p.company_id === companyId && p.is_active && (p.daily_sales_avg || 0) > 0);
  const gone = selling.filter(p => (p.stock_quantity || 0) <= 0).sort((a, b) => (b.daily_sales_avg || 0) - (a.daily_sales_avg || 0));
  const running = selling.filter(p => (p.stock_quantity || 0) > 0 && (p.stock_quantity || 0) / (p.daily_sales_avg || 1) <= 3);
  if (gone.length) out.push({ id: 'stock-out', level: 'critical', title: `${gone.length} ta sotiladigan tovar omborda tugagan`, detail: gone.slice(0, 4).map(p => `${p.name} (kuniga ~${Math.round(p.daily_sales_avg || 0)} ${p.unit || 'dona'})`).join(', '), page: 'forecast' });
  if (running.length) out.push({ id: 'stock', level: 'critical', title: `${running.length} ta tovar 3 kunda tugaydi`, detail: running.slice(0, 4).map(p => `${p.name} (${Math.max(1, Math.round((p.stock_quantity || 0) / (p.daily_sales_avg || 1)))} kun)`).join(', '), page: 'forecast' });

  // Cash register not opened
  if (hour >= 10 && !db.findOne('cash_days', d => d.company_id === companyId && d.date === today)) {
    out.push({ id: 'cash-closed', level: 'warning', title: 'Bugungi kassa ochilmagan', detail: `Soat ${hour}:00 bo‘ldi, kassa kuni hali ochilmagan.`, page: 'cash' });
  }

  // Overdue tasks
  const overdue = db.find('crm_tasks', t => t.company_id === companyId && (t.status === 'OPEN' || t.status === 'IN_PROGRESS') && !!t.due_date && t.due_date < today);
  if (overdue.length) out.push({ id: 'tasks', level: overdue.length > 10 ? 'warning' : 'info', title: `${overdue.length} ta vazifa muddati o‘tgan`, detail: overdue.slice(0, 3).map(t => t.title).join('; '), page: 'crm' });

  // Today's sales against the same weekday of the last four weeks
  const salesOn = (d: string) => db.find('sales_orders', o => o.company_id === companyId && o.order_date === d && o.status !== 'CANCELLED').reduce((s, o) => s + (o.net_sales ?? o.total_sales ?? 0), 0);
  const past = [7, 14, 21, 28].map(n => salesOn(addDays(today, -n)));
  const avg = past.reduce((s, v) => s + v, 0) / past.length;
  const now = salesOn(today);
  if (avg > 0 && hour >= 15 && now < avg * 0.5) out.push({ id: 'sales-low', level: 'warning', title: 'Bugungi savdo past', detail: `Bugun ${fmt(now)} so‘m — o‘tgan 4 haftaning shu kunidagi o‘rtachadan (${fmt(avg)}) ikki baravar kam.`, page: 'reports' });
  else if (avg > 0) out.push({ id: 'sales-today', level: 'info', title: `Bugungi savdo: ${fmt(now)} so‘m`, detail: `O‘rtacha (shu hafta kuni): ${fmt(avg)} so‘m.`, page: 'reports' });

  // Regular customers who stopped buying
  const since = addDays(today, -21);
  const lookback = addDays(today, -111);
  const stats = new Map<string, { before: number; last: string }>();
  for (const o of db.find('sales_orders', o => o.company_id === companyId && o.status === 'DELIVERED' && o.order_date >= lookback)) {
    const r = stats.get(o.customer_id) || { before: 0, last: '' };
    if (o.order_date < since) r.before++;
    if (o.order_date > r.last) r.last = o.order_date;
    stats.set(o.customer_id, r);
  }
  const stopped = [...stats].filter(([, r]) => r.before >= 3 && r.last < since);
  if (stopped.length) out.push({ id: 'stopped', level: stopped.length > 30 ? 'warning' : 'info', title: `${stopped.length} ta doimiy mijoz 3 haftadan beri olmayapti`, detail: stopped.slice(0, 3).map(([id]) => name(id)).join(', '), page: 'crm' });

  // Unknown purchase cost
  const noCost = db.find('products', p => p.company_id === companyId && p.is_active && !(p.purchase_cost > 0) && (p.daily_sales_avg || 0) > 0).length;
  if (noCost) out.push({ id: 'cost', level: 'info', title: `${noCost} ta sotilayotgan tovarning tannarxi kiritilmagan`, detail: 'Foyda hisoblanishi uchun Mahsulotlar bo‘limida kirim narxini kiriting.', page: 'products' });

  // Backups
  try {
    const last = listBackups().find(b => b.kind === 'daily');
    if (!last || Date.now() - Date.parse(last.created_at) > 2 * 86_400_000) out.push({ id: 'backup', level: 'warning', title: 'Zaxira nusxa eski', detail: last ? `Oxirgisi: ${last.created_at.slice(0, 10)}` : 'Hali zaxira nusxa olinmagan.', page: 'settings' });
  } catch { /* backups folder unreadable */ }

  const order = { critical: 0, warning: 1, info: 2 };
  out.sort((a, b) => order[a.level] - order[b.level]);
  cache.set(companyId, { at: Date.now(), list: out });
  return out;
}
