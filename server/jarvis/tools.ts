import { db } from '../db/database.ts';
import { AnalyticsService } from '../services/analytics.service.ts';
import { ForecastService } from '../services/forecast.service.ts';
import { comparePeriods } from '../services/compare.service.ts';
import { strategyFacts } from '../services/agent-strategy.service.ts';
import { CrmService } from '../services/crm.service.ts';
import { addDays, businessToday, isValidIsoDate } from '../utils/date.ts';
import type { ClaudeTool } from './claude.ts';
import { readNote, searchVault, syncVault, writeJarvisNote } from './obsidian.ts';

export interface JarvisContext { companyId: string; userId: string; email: string }
export type Risk = 'read' | 'write';

interface ToolDef extends ClaudeTool {
  risk: Risk;
  summary: (input: any) => string;                  // what will happen, in the person's words
  run: (ctx: JarvisContext, input: any) => Promise<unknown> | unknown;
}

const fail = (m: string) => { throw new Error(m); };
const money = (n: number | null | undefined) => (n === null || n === undefined ? null : Math.round(n));
const monthStart = () => businessToday().slice(0, 8) + '01';
const period = (input: any, fallbackFrom = monthStart()) => {
  const from = isValidIsoDate(input?.from) ? input.from : fallbackFrom;
  const to = isValidIsoDate(input?.to) ? input.to : businessToday();
  if (from > to) fail('Davr boshi oxiridan keyin bo‘lmasin.');
  return { from, to };
};
const actor = (ctx: JarvisContext) => ({ userId: ctx.userId, email: ctx.email, companyId: ctx.companyId });
const vaultOf = (ctx: JarvisContext) => db.findById('jarvis_settings', ctx.companyId)?.obsidian_vault || fail('Obsidian ulanmagan: Jarvis → Sozlamalar’da vault papkasini kiriting.');

/** One customer by id, code, phone or name; several matches are listed so the person can choose. */
function findCustomer(ctx: JarvisContext, query: string) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) fail('Mijoz nomi, kodi yoki telefoni kerak.');
  const all = db.find('customers', c => c.company_id === ctx.companyId);
  const digits = q.replace(/\D/g, '');
  // A phone matches by its last 7+ digits; a short number must not pick a random customer.
  const exact = all.find(c => c.id === query || (c.code || '').toLowerCase() === q || (digits.length >= 7 && (c.phone || '').replace(/\D/g, '').endsWith(digits)));
  if (exact) return exact;
  const matches = all.filter(c => c.name.toLowerCase().includes(q));
  if (matches.length === 1) return matches[0];
  if (!matches.length) fail(`“${query}” nomli mijoz topilmadi.`);
  fail(`Bir nechta mijoz mos keldi, aniqlashtiring: ${matches.slice(0, 8).map(c => `${c.name} (kod ${c.code})`).join('; ')}`);
  return null as never;
}

const userByName = (ctx: JarvisContext, name?: string) => {
  if (!name) return ctx.userId;
  const n = name.trim().toLowerCase();
  const u = db.find('users', u => u.company_id === ctx.companyId && u.status === 'ACTIVE' && (u.full_name.toLowerCase().includes(n) || (u.login || '').toLowerCase() === n));
  if (u.length !== 1) fail(u.length ? `Bir nechta xodim mos keldi: ${u.map(x => x.full_name).join(', ')}` : `“${name}” ismli xodim topilmadi.`);
  return u[0].id;
};

const s = (props: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties: props, required, additionalProperties: false });
const str = (description: string, extra: Record<string, unknown> = {}) => ({ type: 'string', description, ...extra });
const num = (description: string) => ({ type: 'number', description });
const dateProp = (d: string) => str(`${d} (YYYY-MM-DD)`);

export const TOOLS: ToolDef[] = [
  // ---------------- Business: reading ----------------
  {
    name: 'business_overview',
    description: 'Biznesning umumiy holati davr uchun: savdo, qaytarish, tannarx, xarajatlar, foyda, debitorlik, bugungi kassa. Brifing va umumiy savollar uchun birinchi navbatda ishlating.',
    input_schema: s({ from: dateProp('Davr boshi, bo‘lmasa oy boshi'), to: dateProp('Davr oxiri, bo‘lmasa bugun') }),
    risk: 'read', summary: () => 'Biznes ko‘rsatkichlarini o‘qish',
    run: (ctx, input) => {
      const { from, to } = period(input);
      const pl = AnalyticsService.getProfitAndLoss(ctx.companyId, from, to);
      const customers = db.find('customers', c => c.company_id === ctx.companyId);
      const debt = customers.reduce((sum, c) => sum + Math.max(0, c.current_balance || 0), 0);
      const debtors = customers.filter(c => (c.current_balance || 0) > 0).length;
      const today = businessToday();
      const day = db.findOne('cash_days', d => d.company_id === ctx.companyId && d.date === today);
      const integrations = db.find('integrations', i => i.company_id === ctx.companyId && i.provider_type === 'DISTRIBUTION' && i.status === 'CONNECTED').map(i => i.provider_name);
      return {
        period: { from, to }, data_sources: integrations,
        sales: { gross: money(pl.gross_sales), returns: money(pl.returns), net_revenue: money(pl.net_revenue), pending_not_delivered: money(pl.pending_sales) },
        profit: { cogs: money(pl.cost_of_goods_sold), gross_profit: money(pl.gross_profit), gross_margin_percent: pl.gross_margin_percent, operating_expenses: money(pl.total_operating_expenses), payroll: money(pl.total_payroll), net_profit: money(pl.net_profit), cost_known_percent: pl.cogs_coverage_percent, note: pl.profit_note },
        top_expenses: pl.operating_expenses.sort((a, b) => b.amount - a.amount).slice(0, 6).map(e => ({ category: e.category_name, amount: money(e.amount) })),
        receivables: { total_debt: money(debt), debtors },
        today_cash: day ? { status: day.status, opening: money(day.opening_balance), cash_in: money(day.cash_payment), debt_collected: money(day.credit_collection), expenses: money(day.expense_amount || 0), expected_closing: money(day.calculated_closing_balance) } : 'Bugun kassa ochilmagan'
      };
    }
  },
  {
    name: 'compare_periods',
    description: 'Ikki davrni solishtirish: savdo, foyda, xarajat, agentlar, o‘sgan/tushgan mahsulotlar, xaridi kamaygan mijozlar.',
    input_schema: s({ a_from: dateProp('1-davr boshi'), a_to: dateProp('1-davr oxiri'), b_from: dateProp('2-davr boshi'), b_to: dateProp('2-davr oxiri') }, ['a_from', 'a_to', 'b_from', 'b_to']),
    risk: 'read', summary: i => `Davrlarni solishtirish ${i.a_from}…${i.a_to} va ${i.b_from}…${i.b_to}`,
    run: (ctx, i) => {
      const r: any = comparePeriods(ctx.companyId, { from: i.a_from, to: i.a_to }, { from: i.b_from, to: i.b_to });
      return {
        periods: r.periods, days: r.days, cost_complete: r.cogs_complete,
        lines: r.lines.map((l: any) => ({ section: l.section, label: l.label, a: l.a, b: l.b })),
        agents: r.agents.slice(0, 15), products_up: r.products.gainers.slice(0, 8), products_down: r.products.losers.slice(0, 8),
        customers_declining: r.customers.declining.slice(0, 15), customers_stopped: r.customers.stopped
      };
    }
  },
  {
    name: 'agent_performance',
    description: 'Bitta savdo agentini ikki davrda chuqur tahlil qilish: savdo, buyurtma, mijozlar, komandalar, kategoriyalar, o‘sgan/tushgan mahsulotlar, xarid qilmay qo‘ygan mijozlar, qarz, agentlar orasidagi o‘rni. Agentga o‘sish strategiyasi tuzish uchun shu vositadan foydalaning. agent — ismi yoki kodi (masalan "ТП1").',
    input_schema: s({ agent: str('Agent ismi yoki kodi'), a_from: dateProp('1-davr boshi'), a_to: dateProp('1-davr oxiri'), b_from: dateProp('2-davr boshi'), b_to: dateProp('2-davr oxiri') }, ['agent', 'a_from', 'a_to', 'b_from', 'b_to']),
    risk: 'read', summary: i => `Agent tahlili: ${i.agent}`,
    run: (ctx, i) => {
      const q = String(i.agent || '').trim().toLowerCase();
      const agents = db.find('agents', a => a.company_id === ctx.companyId);
      const agent = agents.find(a => a.code?.toLowerCase() === q) || agents.find(a => a.full_name.toLowerCase().includes(q));
      if (!agent) return { error: `“${i.agent}” agenti topilmadi`, agents: agents.slice(0, 30).map(a => a.full_name) };
      return strategyFacts(ctx.companyId, agent.id, { from: i.a_from, to: i.a_to }, { from: i.b_from, to: i.b_to });
    }
  },
  {
    name: 'debt_aging',
    description: 'Debitorlik qarzi muddatlari bo‘yicha (0-30, 31-60, 61-90, 90+ kun): eng katta va eng eski qarzdorlar, agent bilan.',
    input_schema: s({ min_days: num('Faqat shu kundan eski qarzi borlar (ixtiyoriy)'), limit: num('Nechta qarzdor (standart 20)') }),
    risk: 'read', summary: () => 'Qarzlar muddatini o‘qish',
    run: (ctx, i) => {
      const rows = AnalyticsService.getAgingReport(ctx.companyId).filter(r => !i.min_days || r.oldest_debt_days >= i.min_days);
      const total = rows.reduce((sum, r) => sum + r.current_debt, 0);
      return {
        total_debt: money(total), debtors: rows.length,
        buckets: { d0_30: money(rows.reduce((s2, r) => s2 + r.bucket_0_30, 0)), d31_60: money(rows.reduce((s2, r) => s2 + r.bucket_31_60, 0)), d61_90: money(rows.reduce((s2, r) => s2 + r.bucket_61_90, 0)), d90_plus: money(rows.reduce((s2, r) => s2 + r.bucket_90_plus, 0)), unknown_age: money(rows.reduce((s2, r) => s2 + r.bucket_unknown, 0)) },
        top: rows.slice(0, Math.min(50, i.limit || 20)).map(r => ({ customer: r.customer_name, code: r.customer_code, agent: r.agent_name, debt: money(r.current_debt), over_90: money(r.bucket_90_plus), oldest_days: r.oldest_debt_days, phone: db.findById('customers', r.customer_id)?.phone || '' }))
      };
    }
  },
  {
    name: 'stopped_customers',
    description: 'Avval muntazam xarid qilib, oxirgi N kunda buyurtma bermagan mijozlar (yo‘qotish xavfi). Agent, qarz va telefon bilan.',
    input_schema: s({ days: num('Necha kundan beri xarid yo‘q (standart 21)'), limit: num('Nechta (standart 25)') }),
    risk: 'read', summary: i => `${i.days || 21} kundan beri xarid qilmagan mijozlar`,
    run: (ctx, i) => {
      const days = Math.max(3, Math.min(365, i.days || 21));
      const since = addDays(businessToday(), -days);
      const lookback = addDays(since, -90);
      const last = new Map<string, { date: string; orders: number; sales: number }>();
      for (const o of db.find('sales_orders', o => o.company_id === ctx.companyId && o.status === 'DELIVERED' && o.order_date >= lookback)) {
        const r = last.get(o.customer_id) || { date: '', orders: 0, sales: 0 };
        if (o.order_date > r.date) r.date = o.order_date;
        if (o.order_date < since) { r.orders++; r.sales += o.net_sales || 0; }
        last.set(o.customer_id, r);
      }
      const rows = [...last].filter(([, r]) => r.date < since && r.orders >= 2).map(([id, r]) => {
        const c = db.findById('customers', id);
        return { customer: c?.name, code: c?.code, phone: c?.phone || '', agent: c?.agent_id ? db.findById('agents', c.agent_id)?.full_name : null, last_order: r.date, orders_before: r.orders, sales_90d_before: money(r.sales), debt: money(Math.max(0, c?.current_balance || 0)) };
      }).sort((a, b) => (b.sales_90d_before || 0) - (a.sales_90d_before || 0));
      return { days, count: rows.length, customers: rows.slice(0, Math.min(60, i.limit || 25)) };
    }
  },
  {
    // A distinct name: the service refuses a tool list with two tools of the same name.
    name: 'agents_ranking',
    description: 'Barcha agentlar reytingi davr uchun: savdo, buyurtmalar soni, mijozlar soni va ularning mijozlaridagi qarz.',
    input_schema: s({ from: dateProp('Davr boshi'), to: dateProp('Davr oxiri') }),
    risk: 'read', summary: () => 'Agentlar natijasini o‘qish',
    run: (ctx, input) => {
      const { from, to } = period(input);
      const map = new Map<string, { sales: number; orders: number; customers: Set<string> }>();
      for (const o of db.find('sales_orders', o => o.company_id === ctx.companyId && o.status === 'DELIVERED' && o.order_date >= from && o.order_date <= to)) {
        const r = map.get(o.agent_id || 'none') || { sales: 0, orders: 0, customers: new Set<string>() };
        r.sales += o.net_sales || 0; r.orders++; r.customers.add(o.customer_id);
        map.set(o.agent_id || 'none', r);
      }
      const debtByAgent = new Map<string, number>();
      for (const c of db.find('customers', c => c.company_id === ctx.companyId && (c.current_balance || 0) > 0)) debtByAgent.set(c.agent_id || 'none', (debtByAgent.get(c.agent_id || 'none') || 0) + (c.current_balance || 0));
      return {
        period: { from, to },
        agents: [...map].map(([id, r]) => ({ agent: id === 'none' ? 'Agentsiz' : db.findById('agents', id)?.full_name || id, sales: money(r.sales), orders: r.orders, customers: r.customers.size, avg_order: money(r.sales / Math.max(1, r.orders)), customers_debt: money(debtByAgent.get(id) || 0) })).sort((a, b) => (b.sales || 0) - (a.sales || 0))
      };
    }
  },
  {
    name: 'stock_forecast',
    description: 'Ombor prognozi: tugab qolayotgan, tugagan va ortiqcha mahsulotlar, kunlik sotuv va buyurtma qilish kerak bo‘lgan miqdor.',
    input_schema: s({ limit: num('Nechta mahsulot (standart 15)') }),
    risk: 'read', summary: () => 'Ombor prognozini o‘qish',
    run: (ctx, i) => {
      const r = ForecastService.getStockRunRate(ctx.companyId);
      const pick = (it: any) => ({ product: it.name, category: it.category, stock: it.stock_quantity, daily_sales: Math.round(it.daily_sales_avg * 10) / 10, days_left: it.days_remaining, status: it.status, reorder_qty: it.reorder_quantity, confidence: it.confidence });
      const n = Math.min(40, i.limit || 15);
      return {
        summary: r.summary, history_note: r.history.warning,
        running_out: r.items.filter(x => ['CRITICAL', 'LOW', 'OUT_OF_STOCK'].includes(x.status) && x.daily_sales_avg > 0).slice(0, n).map(pick),
        overstocked: r.items.filter(x => x.status === 'OVERSTOCKED').sort((a, b) => b.days_remaining - a.days_remaining).slice(0, 8).map(pick)
      };
    }
  },
  {
    name: 'customer_card',
    description: 'Bitta mijozning to‘liq kartasi: qarz, qarz muddati, oxirgi buyurtmalar, CRM vazifalari va suhbatlar tarixi.',
    input_schema: s({ customer: str('Mijoz nomi, kodi yoki telefoni') }, ['customer']),
    risk: 'read', summary: i => `Mijoz kartasi: ${i.customer}`,
    run: (ctx, i) => {
      const c = findCustomer(ctx, i.customer);
      const overview: any = CrmService.customerOverview(actor(ctx), c.id);
      const k = overview.customer;
      return {
        customer: { name: k.name, code: k.code, phone: k.phone, address: k.address, agent: k.agent_name, responsible: k.owner_name, tags: k.tags, credit_limit: k.credit_limit },
        stats: overview.stats, debt: overview.debt,
        orders: overview.orders.slice(0, 10).map((o: any) => ({ number: o.order_number, date: o.order_date, sum: money(o.total_sales), status: o.status })),
        ledger: overview.ledger.slice(0, 10).map((t: any) => ({ date: t.date, type: t.ledger_type || t.transaction_type, debit: money(t.debit_amount || (t.transaction_type === 'DEBIT' ? t.amount : 0)), credit: money(t.credit_amount || (t.transaction_type === 'CREDIT' ? t.amount : 0)), comment: t.comment })),
        activities: overview.activities.slice(0, 10).map((a: any) => ({ date: String(a.created_at).slice(0, 10), type: a.type, result: a.result, note: a.note, by: a.user_name })),
        open_tasks: overview.tasks.filter((t: any) => t.status === 'OPEN' || t.status === 'IN_PROGRESS').map((t: any) => ({ title: t.title, due: t.due_date, assignee: t.assignee_name }))
      };
    }
  },
  {
    name: 'crm_tasks',
    description: 'CRM vazifalari ro‘yxati (ochiq, muddati o‘tgan yoki bugungi), mas’ul xodim bilan.',
    input_schema: s({ due: str('overdue | today | all', { enum: ['overdue', 'today', 'all'] }) }),
    risk: 'read', summary: () => 'CRM vazifalarini o‘qish',
    run: (ctx, i) => CrmService.listTasks(actor(ctx), { scope: 'all', status: 'ACTIVE', due: i.due === 'all' ? undefined : i.due }).slice(0, 40)
      .map((t: any) => ({ title: t.title, assignee: t.assignee_name, customer: t.customer_name, due: t.due_date, priority: t.priority, status: t.status, overdue: t.overdue }))
  },

  // ---------------- Business: safe writes (inside Distro Pro, logged) ----------------
  {
    name: 'create_crm_task',
    description: 'CRM vazifasi yaratish (Distro Pro ichida; tashqariga xabar yubormaydi). Mas’ul xodim ismi berilmasa — foydalanuvchining o‘zi.',
    input_schema: s({ title: str('Vazifa'), due_date: dateProp('Muddat'), assignee: str('Mas’ul xodim ismi (ixtiyoriy)'), customer: str('Bog‘liq mijoz (ixtiyoriy)'), priority: str('LOW | NORMAL | HIGH', { enum: ['LOW', 'NORMAL', 'HIGH'] }), description: str('Izoh (ixtiyoriy)') }, ['title']),
    risk: 'write', summary: i => `CRM vazifa: “${i.title}”${i.assignee ? ` → ${i.assignee}` : ''}${i.due_date ? `, muddat ${i.due_date}` : ''}`,
    run: (ctx, i) => {
      const t: any = CrmService.createTask(actor(ctx), { title: i.title, description: i.description, due_date: i.due_date || null, priority: i.priority || 'NORMAL', assignee_user_id: userByName(ctx, i.assignee), customer_id: i.customer ? findCustomer(ctx, i.customer).id : null });
      return { created: true, title: t.title, assignee: t.assignee_name, due: t.due_date, customer: t.customer_name };
    }
  },
  {
    name: 'log_crm_activity',
    description: 'Mijoz bilan bo‘lgan aloqani CRM jurnaliga yozish (qo‘ng‘iroq, tashrif, uchrashuv, xabar, eslatma) va kerak bo‘lsa keyingi qadam sanasi.',
    input_schema: s({
      customer: str('Mijoz'), type: str('CALL | VISIT | MEETING | MESSAGE | NOTE', { enum: ['CALL', 'VISIT', 'MEETING', 'MESSAGE', 'NOTE'] }),
      result: str('Natija', { enum: ['REACHED', 'NO_ANSWER', 'INTERESTED', 'NOT_INTERESTED', 'ORDER', 'PAYMENT_PROMISE', 'COMPLAINT', 'OTHER'] }),
      note: str('Nima gaplashildi'), next_step: str('Keyingi qadam (ixtiyoriy)'), next_action_date: dateProp('Keyingi aloqa sanasi (ixtiyoriy)')
    }, ['customer', 'type', 'result', 'note']),
    risk: 'write', summary: i => `CRM qayd: ${i.customer} — ${i.note}`,
    run: (ctx, i) => {
      const c = findCustomer(ctx, i.customer);
      CrmService.logActivity(actor(ctx), { customer_id: c.id, type: i.type, result: i.result, note: i.note, next_step: i.next_step || null, next_action_date: i.next_action_date || null });
      return { logged: true, customer: c.name };
    }
  },

  // ---------------- More reading ----------------
  {
    name: 'cash_day_summary',
    description: 'Kassa kuni tafsiloti (standart bugun): buyurtmalar, naqd/terminal tushum, nasiyadan kirim, berilgan nasiya, xarajatlar, qoldiq, eng katta qarzga qolgan buyurtmalar.',
    input_schema: s({ date: dateProp('Sana (standart bugun)') }),
    risk: 'read', summary: i => `Kassa kuni: ${i.date || 'bugun'}`,
    run: (ctx, i) => {
      const date = isValidIsoDate(i.date) ? i.date : businessToday();
      const days = db.find('cash_days', d => d.company_id === ctx.companyId && d.date === date);
      if (!days.length) return { date, opened: false, note: 'Bu sanada kassa kuni ochilmagan.' };
      const ids = new Set(days.map(d => d.id));
      const rows = db.find('daily_order_entries', e => ids.has(e.cash_day_id) && e.status !== 'CANCELLED');
      const sum = (k: string) => money(rows.reduce((s2, r: any) => s2 + (Number(r[k]) || 0), 0));
      return {
        date, opened: true, status: days.map(d => d.status), orders: rows.length,
        sales: sum('sale_amount'), cash: sum('cash_payment'), uy_oplata: sum('uy_oplata'), terminal_click: sum('terminal_click'),
        debt_collected: sum('nasiyadan_kirim'), returns: sum('return_amount'), left_as_debt: sum('remaining_debt'),
        expenses: money(days.reduce((s2, d) => s2 + (d.expense_amount || 0), 0)),
        opening: money(days.reduce((s2, d) => s2 + (d.opening_balance || 0), 0)), expected_closing: money(days.reduce((s2, d) => s2 + (d.calculated_closing_balance || 0), 0)),
        biggest_debts: rows.filter((r: any) => (r.remaining_debt || 0) > 0).sort((a: any, b: any) => b.remaining_debt - a.remaining_debt).slice(0, 10)
          .map((r: any) => ({ order: r.order_number, customer: r.customer_name, agent: r.agent_name, debt: money(r.remaining_debt) }))
      };
    }
  },
  {
    name: 'expenses_analysis',
    description: 'Xarajatlar tahlili davr uchun: toifalar bo‘yicha, eng katta xarajatlar, xodimlarga taqsimlangani, o‘tgan davr bilan solishtirish.',
    input_schema: s({ from: dateProp('Davr boshi'), to: dateProp('Davr oxiri') }),
    risk: 'read', summary: () => 'Xarajatlarni tahlil qilish',
    run: (ctx, input) => {
      const { from, to } = period(input);
      const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
      const prevTo = addDays(from, -1); const prevFrom = addDays(prevTo, -(days - 1));
      const list = (f: string, t: string) => db.find('expenses', e => e.company_id === ctx.companyId && e.status !== 'CANCELLED' && e.date >= f && e.date <= t);
      const cur = list(from, to); const prev = list(prevFrom, prevTo);
      const byCat = (rows: any[]) => { const m = new Map<string, number>(); for (const e of rows) { const n = db.findById('expense_categories', e.category_id)?.name || 'Boshqa'; m.set(n, (m.get(n) || 0) + e.amount); } return m; };
      const c = byCat(cur); const p = byCat(prev);
      return {
        period: { from, to }, previous_period: { from: prevFrom, to: prevTo },
        total: money(cur.reduce((s2, e) => s2 + e.amount, 0)), previous_total: money(prev.reduce((s2, e) => s2 + e.amount, 0)),
        by_category: [...c].sort((a, b) => b[1] - a[1]).map(([category, amount]) => ({ category, amount: money(amount), previous: money(p.get(category) || 0) })),
        biggest: cur.sort((a, b) => b.amount - a.amount).slice(0, 10).map(e => ({ date: e.date, amount: money(e.amount), category: db.findById('expense_categories', e.category_id)?.name, comment: e.comment }))
      };
    }
  },
  {
    name: 'product_sales',
    description: 'Mahsulotlar bo‘yicha sotuv davr uchun: eng ko‘p sotilganlar (summa va miqdor), kategoriya bo‘yicha jamlanma. (Linko buyurtmalarida tovar qatorlari yo‘q — bu SalesDoc va qo‘lda kiritilganlar uchun.)',
    input_schema: s({ from: dateProp('Davr boshi'), to: dateProp('Davr oxiri'), limit: num('Nechta (standart 15)') }),
    risk: 'read', summary: () => 'Mahsulotlar sotuvini o‘qish',
    run: (ctx, input) => {
      const { from, to } = period(input);
      const orders = new Set(db.find('sales_orders', o => o.company_id === ctx.companyId && o.status === 'DELIVERED' && o.order_date >= from && o.order_date <= to).map(o => o.id));
      const products = new Map(db.find('products', p => p.company_id === ctx.companyId).map(p => [p.sku, p]));
      const agg = new Map<string, { name: string; category: string; qty: number; sales: number }>();
      for (const it of db.getTable('sales_order_items')) {
        if (!orders.has(it.sales_order_id)) continue;
        const key = it.sku || it.product_id;
        const r = agg.get(key) || { name: it.product_name, category: products.get(key)?.category || '—', qty: 0, sales: 0 };
        r.qty += it.quantity || 0; r.sales += it.total_amount || 0;
        agg.set(key, r);
      }
      const rows = [...agg.values()].sort((a, b) => b.sales - a.sales);
      const cats = new Map<string, number>();
      for (const r of rows) cats.set(r.category, (cats.get(r.category) || 0) + r.sales);
      return {
        period: { from, to }, products_sold: rows.length, orders_with_lines: orders.size,
        top: rows.slice(0, Math.min(40, input.limit || 15)).map(r => ({ product: r.name, category: r.category, qty: Math.round(r.qty), sales: money(r.sales) })),
        by_category: [...cats].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([category, sales]) => ({ category, sales: money(sales) }))
      };
    }
  },
  {
    name: 'search_customers',
    description: 'Mijozlarni nom, kod yoki telefon bo‘yicha qidirish (qarzi va agenti bilan). Aniq mijoz topish uchun.',
    input_schema: s({ query: str('Qidiruv matni') }, ['query']),
    risk: 'read', summary: i => `Mijoz qidirish: ${i.query}`,
    run: (ctx, i) => CrmService.searchCustomers(actor(ctx), String(i.query || '')).slice(0, 20)
  },
  {
    name: 'crm_pipeline',
    description: 'CRM savdo voronkasi: ochiq bitimlar bosqichlar bo‘yicha, summasi, mas’ul va kutilgan yopilish sanasi.',
    input_schema: s({}), risk: 'read', summary: () => 'Savdo voronkasini o‘qish',
    run: (ctx) => {
      const r: any = CrmService.listDeals(actor(ctx), { scope: 'all', status: 'OPEN' });
      return { deals: (r.deals || []).slice(0, 40).map((d: any) => ({ title: d.title, amount: money(d.amount), stage: d.stage_name, owner: d.owner_name, expected: d.expected_close_date, customer: d.customer_name || d.company_name })), summary: r.summary };
    }
  },

  // ---------------- The app itself ----------------
  {
    name: 'open_page',
    description: 'Distro Pro’da sahifani ochish (foydalanuvchi “kassani och”, “mijozlarga o‘t” desa). Javobdan keyin ekran o‘sha sahifaga o‘tadi.',
    input_schema: s({ page: str('Sahifa', { enum: ['dashboard', 'cash', 'customers', 'crm', 'reports', 'forecast', 'products', 'expenses', 'employees', 'balance', 'integrations', 'settings', 'cabinet'] }) }, ['page']),
    risk: 'read', summary: i => `Sahifani ochish: ${i.page}`,
    run: (_ctx, i) => ({ navigate: i.page })
  },

  // ---------------- Obsidian (the company's notes on this computer; offered only when a vault is set) ----------------
  {
    name: 'obsidian_search',
    description: 'Obsidian bilim bazasidan qidirish: rahbarning o‘z eslatmalari (rejalar, kelishuvlar, g‘oyalar, yig‘ilish qaydlari) va Jarvis yozgan biznes eslatmalari. Rahbar oldin nima yozgan yoki kelishgan bo‘lishi mumkin bo‘lgan savolda avval shu yerdan qidiring.',
    input_schema: s({ query: str('Qidiruv so‘zlari'), limit: num('Nechta natija (standart 8)') }, ['query']),
    risk: 'read', summary: i => `Obsidian’dan qidirish: ${i.query}`,
    run: (ctx, i) => ({ results: searchVault(vaultOf(ctx), i.query, i.limit || 8) })
  },
  {
    name: 'obsidian_read',
    description: 'Obsidian eslatmasini to‘liq o‘qish (nomi qidiruv natijasidagidek, masalan "Kundalik/2026-10-04" yoki "Rejalar/2027").',
    input_schema: s({ note: str('Eslatma yo‘li') }, ['note']),
    risk: 'read', summary: i => `Obsidian eslatmasini o‘qish: ${i.note}`,
    run: (ctx, i) => readNote(vaultOf(ctx), i.note)
  },
  {
    name: 'obsidian_write',
    description: 'Jarvis xulosasini Obsidian’ga yozish (Jarvis/ papkasiga): tahlil natijasi, strategiya, reja, yig‘ilish qarori, rahbar “yozib qo‘y” degan narsa. append=true — mavjud Jarvis eslatmasiga sana bilan qo‘shadi. Rahbarning o‘z eslatmalarini o‘zgartirmaydi.',
    input_schema: s({ title: str('Eslatma nomi (masalan "Qarz yig‘ish rejasi — oktyabr")'), content: str('Markdown matn; agentlar va mijozlarni [[Agentlar/Ism]] ko‘rinishida bog‘lang'), append: { type: 'boolean', description: 'Mavjud eslatmaga qo‘shish' } }, ['title', 'content']),
    risk: 'write', summary: i => `Obsidian’ga yozish: Jarvis/${i.title}`,
    run: (ctx, i) => writeJarvisNote(vaultOf(ctx), i.title, i.content, !!i.append)
  },
  {
    name: 'obsidian_refresh',
    description: 'Obsidian’dagi biznes eslatmalarini (kundalik, agentlar, qarzdorlar, ombor) hozirgi ma’lumot bilan yangilash.',
    input_schema: s({}), risk: 'write', summary: () => 'Obsidian biznes eslatmalarini yangilash',
    run: (ctx) => { const r = syncVault(ctx.companyId, vaultOf(ctx)); return { written: r.written, skipped_owner_notes: r.skipped }; }
  },

  // ---------------- Memory ----------------
  {
    name: 'remember',
    description: 'Muhim narsani doimiy xotiraga yozish (foydalanuvchi “eslab qol” desa yoki doimiy afzallik/qoida aytsa: masalan rejalar, kim nima uchun mas’ul, hisobot qanday bo‘lsin). Har bir suhbatda shu xotira ko‘rinadi.',
    input_schema: s({ text: str('Eslab qolinadigan qisqa va aniq fakt') }, ['text']),
    risk: 'write', summary: i => `Eslab qolish: ${i.text}`,
    run: (ctx, i) => {
      const text = String(i.text || '').trim();
      if (text.length < 3 || text.length > 500) fail('Xotira matni 3–500 belgi bo‘lsin.');
      if (db.find('jarvis_memories', m => m.company_id === ctx.companyId).length >= 200) fail('Xotira to‘lgan (200 ta). Keraksizlarini o‘chiring.');
      db.insert('jarvis_memories', { id: `mem-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, company_id: ctx.companyId, user_id: ctx.userId, text, created_at: new Date().toISOString() });
      return { remembered: text };
    }
  },
  {
    name: 'forget',
    description: 'Xotiradan yozuvni o‘chirish (foydalanuvchi “buni unut” desa). Matnning bir qismi bo‘yicha topadi.',
    input_schema: s({ text: str('O‘chiriladigan xotiradagi matn yoki uning qismi') }, ['text']),
    risk: 'write', summary: i => `Xotiradan o‘chirish: ${i.text}`,
    run: (ctx, i) => {
      const q = String(i.text || '').toLowerCase().trim();
      const hits = db.find('jarvis_memories', m => m.company_id === ctx.companyId && m.text.toLowerCase().includes(q));
      if (!q || !hits.length) fail('Bunday xotira topilmadi.');
      if (hits.length > 3) fail(`Ko‘p yozuv mos keldi (${hits.length}). Aniqroq yozing.`);
      for (const m of hits) db.delete('jarvis_memories', m.id);
      return { forgotten: hits.map(m => m.text) };
    }
  }
];

/** The tools offered to the AI; the Obsidian ones only when the company has a vault. */
export function toolsFor(companyId?: string): ClaudeTool[] {
  const vault = companyId ? !!db.findById('jarvis_settings', companyId)?.obsidian_vault : false;
  return TOOLS.filter(t => vault || !t.name.startsWith('obsidian_')).map(({ name, description, input_schema }) => ({ name, description, input_schema }));
}

export function findTool(name: string) { return TOOLS.find(t => t.name === name) || null; }

/** Runs a tool and returns text for Claude (JSON, clipped). Errors come back as text so Claude can explain them. */
export async function runTool(ctx: JarvisContext, name: string, input: any): Promise<{ ok: boolean; text: string }> {
  const tool = findTool(name);
  if (!tool) return { ok: false, text: `Noma’lum vosita: ${name}` };
  try {
    const result = await tool.run(ctx, input || {});
    const text = typeof result === 'string' ? result : JSON.stringify(result);
    return { ok: true, text: text.length > 14000 ? `${text.slice(0, 14000)}… (qisqartirildi)` : text };
  } catch (e: any) {
    return { ok: false, text: `Xato: ${e?.message || e}` };
  }
}