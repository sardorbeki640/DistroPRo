import { randomUUID } from 'node:crypto';
import { db } from '../db/database.ts';
import type { CrmActivity, CrmDeal, CrmStage, CrmTask, Customer } from '../db/schema.ts';
import { AuthService } from './auth.service.ts';
import { AuditService } from './audit.service.ts';
import { openDebtLots, lotAge } from './debt-aging.ts';
import { addDays, businessToday, isValidIsoDate } from '../utils/date.ts';
import { StaffBotService } from './staff-bot.service.ts';
import { escapeHtml } from './telegram.service.ts';

/** The assignee hears about a task someone else gave them, in their own Telegram. */
function tellAssignee(task: CrmTask, by: string) {
  if (task.assignee_user_id === by) return;
  const giver = db.findById('users', by)?.full_name || 'Rahbar';
  const customer = task.customer_id ? db.findById('customers', task.customer_id)?.name : null;
  StaffBotService.notify(task.company_id, { user_id: task.assignee_user_id }, 'TASK_ASSIGNED', `📌 Yangi vazifa${task.priority === 'HIGH' ? ' (muhim)' : ''}`,
    [`<b>${escapeHtml(task.title)}</b>`, task.description ? escapeHtml(task.description) : '', customer ? `Mijoz: ${escapeHtml(customer)}` : '',
      task.due_date ? `Muddat: ${task.due_date.split('-').reverse().join('.')}` : '', `Bergan: ${escapeHtml(giver)}`].filter(Boolean).join('\n'));
}

export interface Actor { userId: string; email: string; companyId: string }

const fail = (message: string, status = 400) => Object.assign(new Error(message), { status });
const now = () => new Date().toISOString();

/**
 * CRM for any business. Visibility rule everywhere: owners/admins (and crm:manage) see everything;
 * other staff see only what they own, were assigned, or wrote themselves.
 */
export class CrmService {
  static seesAll(actor: Actor) { return AuthService.canSeeAll(actor.userId); }

  private static agentIdOf(actor: Actor): string | null {
    const user = db.findById('users', actor.userId);
    const agent = db.findOne('agents', a => a.company_id === actor.companyId && (a.user_id === actor.userId || (!!user?.employee_id && a.employee_id === user.employee_id)));
    return agent?.id || null;
  }

  /** Customers a staff member works with: assigned as agent or as responsible person. */
  static canSeeCustomer(actor: Actor, customer: Customer | null): boolean {
    if (!customer || customer.company_id !== actor.companyId) return false;
    if (this.seesAll(actor)) return true;
    const agentId = this.agentIdOf(actor);
    return customer.owner_user_id === actor.userId || (!!agentId && customer.agent_id === agentId);
  }

  static users(actor: Actor) {
    return db.find('users', u => u.company_id === actor.companyId && u.status === 'ACTIVE')
      .map(u => ({ id: u.id, full_name: u.full_name, login: u.login || u.email }));
  }

  static searchCustomers(actor: Actor, q: string) {
    const needle = q.trim().toLowerCase();
    return db.find('customers', c => c.company_id === actor.companyId && (!needle || c.name.toLowerCase().includes(needle) || (c.phone || '').includes(needle) || (c.code || '').toLowerCase().includes(needle)))
      .filter(c => this.canSeeCustomer(actor, c))
      .slice(0, 30)
      .map(c => ({ id: c.id, name: c.name, phone: c.phone, code: c.code, debt: Math.max(0, c.current_balance || 0) }));
  }

  // ---------- Tasks ----------
  static listTasks(actor: Actor, f: { scope?: string; status?: string; customer_id?: string; deal_id?: string; due?: string; assignee?: string }) {
    const today = businessToday();
    const all = this.seesAll(actor) && f.scope === 'all';
    return db.find('crm_tasks', t => t.company_id === actor.companyId)
      .filter(t => all ? (!f.assignee || t.assignee_user_id === f.assignee) : (t.assignee_user_id === actor.userId || t.created_by === actor.userId))
      .filter(t => !f.status || f.status === 'ACTIVE' ? (f.status !== 'ACTIVE' || t.status === 'OPEN' || t.status === 'IN_PROGRESS') : t.status === f.status)
      .filter(t => !f.customer_id || t.customer_id === f.customer_id)
      .filter(t => !f.deal_id || t.deal_id === f.deal_id)
      .filter(t => f.due === 'overdue' ? (!!t.due_date && t.due_date < today && t.status !== 'DONE' && t.status !== 'CANCELLED')
        : f.due === 'today' ? t.due_date === today : true)
      .sort((a, b) => (a.status === 'DONE') === (b.status === 'DONE') ? (a.due_date || '9999').localeCompare(b.due_date || '9999') : a.status === 'DONE' ? 1 : -1)
      .map(t => this.decorateTask(t));
  }

  private static decorateTask(t: CrmTask) {
    return {
      ...t,
      assignee_name: db.findById('users', t.assignee_user_id)?.full_name || '—',
      customer_name: t.customer_id ? db.findById('customers', t.customer_id)?.name || null : null,
      deal_title: t.deal_id ? db.findById('crm_deals', t.deal_id)?.title || null : null,
      overdue: !!t.due_date && t.due_date < businessToday() && t.status !== 'DONE' && t.status !== 'CANCELLED'
    };
  }

  static createTask(actor: Actor, input: { title: string; description?: string; assignee_user_id?: string; customer_id?: string | null; deal_id?: string | null; due_date?: string | null; priority?: CrmTask['priority'] }) {
    const assignee = input.assignee_user_id || actor.userId;
    if (assignee !== actor.userId && !this.seesAll(actor)) throw fail('Boshqa xodimga vazifani faqat rahbar beradi.', 403);
    const user = db.findById('users', assignee);
    if (!user || user.company_id !== actor.companyId || user.status !== 'ACTIVE') throw fail('Mas’ul xodim topilmadi.');
    this.assertLinks(actor, input.customer_id, input.deal_id);
    if (input.due_date && !isValidIsoDate(input.due_date)) throw fail('Muddat sanasi noto‘g‘ri.');
    const task: CrmTask = {
      id: randomUUID(), company_id: actor.companyId, title: input.title.trim(), description: input.description?.trim() || null,
      assignee_user_id: assignee, created_by: actor.userId, customer_id: input.customer_id || null, deal_id: input.deal_id || null,
      due_date: input.due_date || null, priority: input.priority || 'NORMAL', status: 'OPEN', completed_at: null, created_at: now(), updated_at: now()
    };
    db.insert('crm_tasks', task);
    tellAssignee(task, actor.userId);
    return this.decorateTask(task);
  }

  static updateTask(actor: Actor, id: string, patch: Partial<Pick<CrmTask, 'title' | 'description' | 'due_date' | 'priority' | 'status' | 'assignee_user_id'>>) {
    const task = db.findById('crm_tasks', id);
    if (!task || task.company_id !== actor.companyId) throw fail('Vazifa topilmadi.', 404);
    const manager = this.seesAll(actor);
    if (!manager && task.assignee_user_id !== actor.userId && task.created_by !== actor.userId) throw fail('Bu vazifa sizga tegishli emas.', 403);
    if (patch.assignee_user_id && patch.assignee_user_id !== task.assignee_user_id && !manager) throw fail('Mas’ulni faqat rahbar almashtiradi.', 403);
    if (patch.due_date && !isValidIsoDate(patch.due_date)) throw fail('Muddat sanasi noto‘g‘ri.');
    const status = patch.status || task.status;
    const updated = db.update('crm_tasks', id, {
      ...patch,
      completed_at: status === 'DONE' ? (task.completed_at || now()) : null,
      updated_at: now()
    })!;
    if (patch.assignee_user_id && patch.assignee_user_id !== task.assignee_user_id) tellAssignee(updated, actor.userId);
    return this.decorateTask(updated);
  }

  static deleteTask(actor: Actor, id: string) {
    const task = db.findById('crm_tasks', id);
    if (!task || task.company_id !== actor.companyId) throw fail('Vazifa topilmadi.', 404);
    if (!this.seesAll(actor) && task.created_by !== actor.userId) throw fail('Vazifani faqat uni yaratgan yoki rahbar o‘chiradi.', 403);
    db.delete('crm_tasks', id);
  }

  // ---------- Contact log ----------
  static listActivities(actor: Actor, f: { customer_id?: string; deal_id?: string; user_id?: string; from?: string; to?: string; scope?: string }) {
    if (f.customer_id && !this.canSeeCustomer(actor, db.findById('customers', f.customer_id))) throw fail('Mijoz topilmadi.', 404);
    // Whole team's log: managers (scope=all), or anyone looking at a customer they work with. Otherwise own entries.
    const team = (this.seesAll(actor) && f.scope === 'all') || !!f.customer_id;
    return db.find('crm_activities', a => a.company_id === actor.companyId)
      .filter(a => team ? (!f.user_id || a.user_id === f.user_id) : a.user_id === actor.userId)
      .filter(a => !f.customer_id || a.customer_id === f.customer_id)
      .filter(a => !f.deal_id || a.deal_id === f.deal_id)
      .filter(a => !f.from || a.created_at.slice(0, 10) >= f.from)
      .filter(a => !f.to || a.created_at.slice(0, 10) <= f.to)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 500)
      .map(a => ({
        ...a,
        user_name: db.findById('users', a.user_id)?.full_name || '—',
        customer_name: a.customer_id ? db.findById('customers', a.customer_id)?.name || null : null,
        deal_title: a.deal_id ? db.findById('crm_deals', a.deal_id)?.title || null : null
      }));
  }

  static logActivity(actor: Actor, input: { customer_id?: string | null; deal_id?: string | null; type: CrmActivity['type']; result: CrmActivity['result']; note: string; next_step?: string | null; next_action_date?: string | null }) {
    this.assertLinks(actor, input.customer_id, input.deal_id);
    if (!input.customer_id && !input.deal_id) throw fail('Mijoz yoki bitimni tanlang.');
    if (input.next_action_date && (!isValidIsoDate(input.next_action_date) || input.next_action_date < businessToday())) throw fail('Keyingi qadam sanasi bugundan oldin bo‘lmasin.');
    const activity: CrmActivity = {
      id: randomUUID(), company_id: actor.companyId, customer_id: input.customer_id || null, deal_id: input.deal_id || null,
      type: input.type, result: input.result, note: input.note.trim(), next_step: input.next_step?.trim() || null,
      next_action_date: input.next_action_date || null, follow_up_task_id: null, user_id: actor.userId, created_at: now()
    };
    db.transaction(() => {
      // A planned next step becomes a task, so it cannot be forgotten.
      if (activity.next_action_date) {
        const task = this.createTask(actor, {
          title: activity.next_step || 'Mijoz bilan qayta bog‘lanish',
          description: `Aloqa jurnalidan: ${activity.note}`.slice(0, 500),
          customer_id: activity.customer_id, deal_id: activity.deal_id, due_date: activity.next_action_date, priority: 'NORMAL'
        });
        activity.follow_up_task_id = task.id;
      }
      db.insert('crm_activities', activity);
    });
    return activity;
  }

  // ---------- Pipeline ----------
  static stages(companyId: string) {
    return db.find('crm_stages', s => s.company_id === companyId).sort((a, b) => a.sort_order - b.sort_order);
  }

  static saveStage(actor: Actor, input: { id?: string; name: string; probability: number; kind: CrmStage['kind']; sort_order?: number }) {
    if (!this.seesAll(actor)) throw fail('Bosqichlarni faqat rahbar sozlaydi.', 403);
    if (input.probability < 0 || input.probability > 100) throw fail('Ehtimol 0–100 oralig‘ida bo‘lsin.');
    if (input.id) {
      const stage = db.findById('crm_stages', input.id);
      if (!stage || stage.company_id !== actor.companyId) throw fail('Bosqich topilmadi.', 404);
      return db.update('crm_stages', stage.id, { name: input.name.trim(), probability: input.probability, kind: input.kind, sort_order: input.sort_order ?? stage.sort_order });
    }
    const max = Math.max(0, ...this.stages(actor.companyId).map(s => s.sort_order));
    return db.insert('crm_stages', { id: randomUUID(), company_id: actor.companyId, name: input.name.trim(), probability: input.probability, kind: input.kind, sort_order: input.sort_order ?? max + 1, created_at: now() });
  }

  static deleteStage(actor: Actor, id: string) {
    if (!this.seesAll(actor)) throw fail('Bosqichlarni faqat rahbar sozlaydi.', 403);
    const stage = db.findById('crm_stages', id);
    if (!stage || stage.company_id !== actor.companyId) throw fail('Bosqich topilmadi.', 404);
    if (db.findOne('crm_deals', d => d.stage_id === id)) throw fail('Bu bosqichda bitimlar bor. Avval ularni boshqa bosqichga o‘tkazing.');
    db.delete('crm_stages', id);
  }

  static listDeals(actor: Actor, f: { scope?: string; status?: string; owner?: string; customer_id?: string }) {
    const all = this.seesAll(actor) && f.scope === 'all';
    const stages = new Map(this.stages(actor.companyId).map(s => [s.id, s]));
    const deals = db.find('crm_deals', d => d.company_id === actor.companyId)
      .filter(d => all ? (!f.owner || d.owner_user_id === f.owner) : d.owner_user_id === actor.userId)
      .filter(d => !f.status || d.status === f.status)
      .filter(d => !f.customer_id || d.customer_id === f.customer_id)
      .map(d => ({
        ...d,
        stage_name: stages.get(d.stage_id)?.name || '—',
        probability: stages.get(d.stage_id)?.probability ?? 0,
        owner_name: db.findById('users', d.owner_user_id)?.full_name || '—',
        customer_name: d.customer_id ? db.findById('customers', d.customer_id)?.name || null : null
      }));
    const summary = [...stages.values()].map(s => {
      const inStage = deals.filter(d => d.stage_id === s.id);
      const amount = inStage.reduce((sum, d) => sum + d.amount, 0);
      return { stage_id: s.id, name: s.name, kind: s.kind, count: inStage.length, amount, weighted: Math.round(amount * s.probability / 100) };
    });
    return { deals, summary };
  }

  static saveDeal(actor: Actor, input: Partial<CrmDeal> & { title?: string }, id?: string) {
    const stages = this.stages(actor.companyId);
    const manager = this.seesAll(actor);
    const existing = id ? db.findById('crm_deals', id) : null;
    if (id && (!existing || existing.company_id !== actor.companyId)) throw fail('Bitim topilmadi.', 404);
    if (existing && !manager && existing.owner_user_id !== actor.userId) throw fail('Bu bitim sizga tegishli emas.', 403);
    const stageId = input.stage_id || existing?.stage_id || stages.find(s => s.kind === 'OPEN')?.id;
    const stage = stages.find(s => s.id === stageId);
    if (!stage) throw fail('Bosqich topilmadi.');
    if (stage.kind === 'LOST' && !(input.lost_reason || existing?.lost_reason)) throw fail('Yutqazish sababini yozing.');
    const owner = input.owner_user_id || existing?.owner_user_id || actor.userId;
    if (owner !== actor.userId && owner !== existing?.owner_user_id && !manager) throw fail('Mas’ulni faqat rahbar almashtiradi.', 403);
    if (input.customer_id !== undefined) this.assertLinks(actor, input.customer_id, null);
    const amount = input.amount ?? existing?.amount ?? 0;
    if (!Number.isFinite(amount) || amount < 0) throw fail('Summa noto‘g‘ri.');
    const title = (input.title ?? existing?.title ?? '').trim();
    if (!title) throw fail('Bitim nomini yozing.');
    if (!existing && !input.customer_id && !input.contact_name && !input.company_name) throw fail('Mijozni tanlang yoki yangi kontakt ismini yozing.');
    const status: CrmDeal['status'] = stage.kind === 'WON' ? 'WON' : stage.kind === 'LOST' ? 'LOST' : 'OPEN';
    const values = {
      title, amount, stage_id: stage.id, status, owner_user_id: owner,
      customer_id: input.customer_id !== undefined ? input.customer_id || null : existing?.customer_id || null,
      contact_name: input.contact_name ?? existing?.contact_name ?? null,
      contact_phone: input.contact_phone ?? existing?.contact_phone ?? null,
      company_name: input.company_name ?? existing?.company_name ?? null,
      source: input.source ?? existing?.source ?? null,
      expected_close_date: input.expected_close_date ?? existing?.expected_close_date ?? null,
      lost_reason: stage.kind === 'LOST' ? (input.lost_reason || existing?.lost_reason || null) : null,
      note: input.note ?? existing?.note ?? null,
      closed_at: status === 'OPEN' ? null : (existing?.status === status ? existing.closed_at : now()),
      updated_at: now()
    };
    if (values.expected_close_date && !isValidIsoDate(values.expected_close_date)) throw fail('Yopilish sanasi noto‘g‘ri.');
    const deal = existing
      ? db.update('crm_deals', existing.id, values)!
      : db.insert('crm_deals', { ...values, id: randomUUID(), company_id: actor.companyId, created_by: actor.userId, created_at: now() } as CrmDeal);
    if (existing && existing.stage_id !== deal.stage_id) {
      AuditService.log({ company_id: actor.companyId, user_id: actor.userId, user_email: actor.email, action: 'UPDATE', entity: 'CrmDeal', entity_id: deal.id, old_value: { stage: existing.stage_id }, new_value: { stage: deal.stage_id }, reason: `Bitim bosqichi: ${stage.name}` });
    }
    return deal;
  }

  static deleteDeal(actor: Actor, id: string) {
    const deal = db.findById('crm_deals', id);
    if (!deal || deal.company_id !== actor.companyId) throw fail('Bitim topilmadi.', 404);
    if (!this.seesAll(actor)) throw fail('Bitimni faqat rahbar o‘chiradi.', 403);
    db.delete('crm_deals', id);
  }

  // ---------- Customer 360 ----------
  static customerOverview(actor: Actor, customerId: string) {
    const customer = db.findById('customers', customerId);
    if (!this.canSeeCustomer(actor, customer)) throw fail('Mijoz topilmadi.', 404);
    const c = customer!;
    const today = businessToday();
    const orders = db.find('sales_orders', o => o.company_id === actor.companyId && o.customer_id === c.id)
      .sort((a, b) => b.order_date.localeCompare(a.order_date));
    const delivered = orders.filter(o => o.status === 'DELIVERED');
    const since90 = addDays(today, -89);
    const last90 = delivered.filter(o => o.order_date >= since90);
    const { lots, debt, prepaid } = openDebtLots(actor.companyId, c.id, today);
    const aging = { d0_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0, unknown: 0 };
    for (const lot of lots) {
      const age = lotAge(lot, today);
      if (age === null) aging.unknown += lot.amount;
      else if (age <= 30) aging.d0_30 += lot.amount;
      else if (age <= 60) aging.d31_60 += lot.amount;
      else if (age <= 90) aging.d61_90 += lot.amount;
      else aging.d90_plus += lot.amount;
    }
    const ledger = db.find('customer_balance_transactions', t => t.company_id === actor.companyId && t.customer_id === c.id && t.status !== 'REVERSED')
      .sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.created_at.localeCompare(a.created_at)).slice(0, 30);
    const agent = c.agent_id ? db.findById('agents', c.agent_id) : null;
    const owner = c.owner_user_id ? db.findById('users', c.owner_user_id) : null;
    const firstOrder = orders.length ? orders[orders.length - 1].order_date : null;
    return {
      customer: { ...c, agent_name: agent?.full_name || null, owner_name: owner?.full_name || null },
      stats: {
        orders_total: delivered.length,
        sales_total: delivered.reduce((s, o) => s + o.total_sales, 0),
        sales_90d: last90.reduce((s, o) => s + o.total_sales, 0),
        orders_90d: last90.length,
        avg_order: delivered.length ? Math.round(delivered.reduce((s, o) => s + o.total_sales, 0) / delivered.length) : 0,
        last_order_date: delivered[0]?.order_date || null,
        days_since_last_order: delivered[0] ? Math.max(0, Math.round((Date.parse(today) - Date.parse(delivered[0].order_date)) / 86400000)) : null,
        first_order_date: firstOrder,
        pending_orders: orders.filter(o => o.status === 'PENDING').length
      },
      debt: { total: debt, prepaid, credit_limit: c.credit_limit || 0, over_limit: !!c.credit_limit && debt > c.credit_limit, aging },
      orders: orders.slice(0, 20).map(o => ({ id: o.id, order_number: o.order_number, order_date: o.order_date, total_sales: o.total_sales, status: o.status })),
      ledger,
      activities: this.listActivities(actor, { customer_id: c.id }).slice(0, 50),
      tasks: db.find('crm_tasks', t => t.company_id === actor.companyId && t.customer_id === c.id && (this.seesAll(actor) || t.assignee_user_id === actor.userId || t.created_by === actor.userId)).map(t => this.decorateTask(t)),
      deals: this.listDeals(actor, { scope: 'all', customer_id: c.id }).deals.filter(d => this.seesAll(actor) || d.owner_user_id === actor.userId)
    };
  }

  static updateCustomerCrm(actor: Actor, customerId: string, patch: { tags?: string[]; owner_user_id?: string | null; contacts?: Customer['contacts']; comment?: string | null }) {
    const customer = db.findById('customers', customerId);
    if (!this.canSeeCustomer(actor, customer)) throw fail('Mijoz topilmadi.', 404);
    if (patch.owner_user_id !== undefined && !this.seesAll(actor)) throw fail('Mas’ul xodimni faqat rahbar belgilaydi.', 403);
    if (patch.owner_user_id) {
      const u = db.findById('users', patch.owner_user_id);
      if (!u || u.company_id !== actor.companyId) throw fail('Xodim topilmadi.');
    }
    const values: Partial<Customer> = { updated_at: now() };
    if (patch.tags) values.tags = [...new Set(patch.tags.map(t => t.trim()).filter(Boolean))].slice(0, 20);
    if (patch.contacts) values.contacts = patch.contacts.slice(0, 20);
    if (patch.comment !== undefined) values.comment = patch.comment;
    if (patch.owner_user_id !== undefined) values.owner_user_id = patch.owner_user_id;
    return db.update('customers', customerId, values);
  }

  /** Dashboard: today's work of the signed-in person (or the whole team for managers). */
  static summary(actor: Actor) {
    const today = businessToday();
    const all = this.seesAll(actor);
    const tasks = db.find('crm_tasks', t => t.company_id === actor.companyId && (all || t.assignee_user_id === actor.userId) && t.status !== 'DONE' && t.status !== 'CANCELLED');
    const deals = db.find('crm_deals', d => d.company_id === actor.companyId && d.status === 'OPEN' && (all || d.owner_user_id === actor.userId));
    const stages = new Map(this.stages(actor.companyId).map(s => [s.id, s]));
    return {
      scope: all ? 'all' : 'mine',
      open_tasks: tasks.length,
      due_today: tasks.filter(t => t.due_date === today).length,
      overdue: tasks.filter(t => t.due_date && t.due_date < today).length,
      open_deals: deals.length,
      pipeline_amount: deals.reduce((s, d) => s + d.amount, 0),
      pipeline_weighted: Math.round(deals.reduce((s, d) => s + d.amount * (stages.get(d.stage_id)?.probability ?? 0) / 100, 0)),
      activities_today: db.find('crm_activities', a => a.company_id === actor.companyId && (all || a.user_id === actor.userId) && a.created_at.slice(0, 10) === today).length
    };
  }

  private static assertLinks(actor: Actor, customerId?: string | null, dealId?: string | null) {
    if (customerId && !this.canSeeCustomer(actor, db.findById('customers', customerId))) throw fail('Mijoz topilmadi.', 404);
    if (dealId) {
      const deal = db.findById('crm_deals', dealId);
      if (!deal || deal.company_id !== actor.companyId || (!this.seesAll(actor) && deal.owner_user_id !== actor.userId)) throw fail('Bitim topilmadi.', 404);
    }
  }
}
