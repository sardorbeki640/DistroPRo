import { Router } from 'express';
import { z } from 'zod';
import type { Request, Response } from 'express';
import { requireAuth, requireOwner, requirePermission } from '../middleware/auth.middleware.ts';
import { db } from '../db/database.ts';
import { AuditService } from '../services/audit.service.ts';
import type { LoyaltyProgram, SalesOrderItem } from '../db/schema.ts';
import type { ExternalSyncOrder } from '../integrations/interfaces.ts';
import { activeDistribution } from '../integrations/distribution.ts';
import { matchesIntegrationSource } from '../services/source-tagging.service.ts';

const router = Router();
const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Sana YYYY-MM-DD formatida bo‘lishi kerak.')
  .refine(value => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, 'Kalendar sanasini to‘g‘ri kiriting.');
const ProgramInput = z.object({
  name: z.string().trim().min(2).max(120),
  metric: z.enum(['QUANTITY', 'AMOUNT']),
  unit: z.string().trim().max(24).default(''),
  product_ids: z.array(z.string().min(1)).max(100).default([]),
  group_by_agent: z.boolean().default(true),
  start_date: DateSchema,
  end_date: DateSchema,
  tiers: z.array(z.object({ id: z.string().optional(), threshold: z.number().positive().finite(), reward: z.string().trim().min(1).max(120) })).min(1).max(50),
  terms: z.array(z.string().trim().min(1).max(500)).max(50).default([]),
  is_active: z.boolean().default(true)
});

function normalizeUnit(value: string): string {
  const unit = value.trim().toLowerCase().replace(/\s+/g, '');
  if (['кг', 'килограмм', 'килограмма', 'килограм'].includes(unit)) return 'kg';
  if (['дона', 'шт', 'штук', 'pcs', 'pc'].includes(unit)) return 'dona';
  if (['л', 'литр', 'литра'].includes(unit)) return 'l';
  return unit;
}

function validateAndNormalize(input: z.infer<typeof ProgramInput>, companyId: string) {
  if (input.start_date > input.end_date) throw new Error('Aksiya boshlanish sanasi tugash sanasidan keyin bo‘lishi mumkin emas.');
  const tiers = [...input.tiers].sort((a, b) => a.threshold - b.threshold);
  if (tiers.some((tier, index) => index > 0 && tier.threshold === tiers[index - 1].threshold)) {
    throw new Error('Har bir sovg‘a uchun chegara miqdori boshqacha bo‘lishi kerak.');
  }
  const productIds = [...new Set(input.product_ids)];
  let unit = '';
  if (input.metric === 'QUANTITY') {
    if (!productIds.length) throw new Error('Miqdor aksiyasi uchun hisoblanadigan mahsulot(lar)ni tanlang.');
    const products = productIds.map(id => db.findById('products', id));
    if (products.some(product => !product || product.company_id !== companyId || !product.is_active)) {
      throw new Error('Tanlangan mahsulotlardan biri faol ro‘yxatda topilmadi. Mahsulotlar ro‘yxatini yangilang.');
    }
    const units = [...new Set(products.map(product => normalizeUnit(product!.unit)))];
    if (units.length !== 1 || !units[0]) throw new Error('Miqdor sharti uchun bir xil o‘lchov birligidagi mahsulotlarni tanlang.');
    if (input.unit && normalizeUnit(input.unit) !== units[0]) {
      throw new Error(`Aksiya birligi (${input.unit}) tanlangan mahsulot birligiga (${products[0]!.unit}) mos emas. Kilogramm va donani aralashtirib hisoblash uchun aniq mahsulot konversiyasi kerak.`);
    }
    unit = products[0]!.unit;
  }
  return {
    ...input,
    unit: input.metric === 'AMOUNT' ? 'UZS' : unit,
    product_ids: input.metric === 'AMOUNT' ? [] : productIds,
    tiers: tiers.map(tier => ({ id: tier.id || `tier-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, threshold: tier.threshold, reward: tier.reward.trim() })),
    terms: input.terms.map(term => term.trim()).filter(Boolean)
  };
}

export function buildResults(program: LoyaltyProgram, liveOrders?: ExternalSyncOrder[], sourceName?: string, integrationId?: string | null) {
  const companyId = program.company_id;
  const start = program.start_date;
  const end = program.end_date;
  const excludedLoyaltyStatuses = new Set(['CANCELLED', 'CANCELED', 'CANCEL', 'RETURNED', 'RETURN', 'REFUNDED', 'REFUND']);
  const isEligibleOrder = (status: string | null | undefined) => {
    const normalized = String(status || '').trim().toUpperCase();
    // Providers may send localized or extended status labels (for example,
    // "Отменён", "Возврат оформлен", or "CANCELLED_BY_CLIENT"). Exclude those
    // consistently while retaining every other status, including pending ones.
    const localizedOrExtendedExclusion = /CANCEL|RETURN|REFUND|QAYTAR|BEKOR|ВОЗВРАТ|ВОЗВРАЩ|ОТМЕН/.test(normalized);
    return !excludedLoyaltyStatuses.has(normalized) && !localizedOrExtendedExclusion;
  };
  const orders = liveOrders
    ? liveOrders.filter(order => isEligibleOrder(order.status)
      && order.orderDate.slice(0, 10) >= start
      && order.orderDate.slice(0, 10) <= end)
      .map(order => ({ id: order.externalId, customer_id: order.customerCode, customer_name: order.customerName,
        agent_id: order.agentCode || '', agent_name: order.agentName || '', expeditor_name: order.expeditorName || '', net_sales: order.totalAmount,
        status: order.status, order_date: order.orderDate }))
    : db.find('sales_orders', order => order.company_id === companyId
      && order.status !== 'CANCELLED'
      && isEligibleOrder(order.external_status || order.status)
      && order.order_date.slice(0, 10) >= start
      && order.order_date.slice(0, 10) <= end
      && matchesIntegrationSource(order, integrationId)).map(order => ({ ...order, agent_name: '' }));
  const orderIds = new Set(orders.map(order => order.id));
  const itemsByOrder = new Map<string, SalesOrderItem[]>();
  let productUnitsMismatch = false;
  if (program.metric === 'QUANTITY') {
    // Campaigns refer to internal product ids. When the connected server changes, resolve those ids to
    // stable external SKUs from hidden historical records, then match the same products in the new catalog.
    const linkedProducts = (db.getTableIncludingHidden('products') as any[]).filter(product => product.company_id === companyId && program.product_ids.includes(product.id));
    const selectedSkus = new Set(linkedProducts.flatMap(product => [product.sku, product.external_id, product.code].filter((value): value is string => !!value).map(String)));
    const selectedProducts = db.find('products', product => product.company_id === companyId && matchesIntegrationSource(product, integrationId)
      && (program.product_ids.includes(product.id) || [product.sku, product.external_id, product.code].some(value => !!value && selectedSkus.has(String(value)))));
    productUnitsMismatch = selectedProducts.some(product => normalizeUnit(product.unit) !== normalizeUnit(program.unit));
    for (const product of selectedProducts) for (const code of [product.sku, product.external_id, product.code]) if (code) selectedSkus.add(String(code));
    const items = liveOrders
      ? liveOrders.filter(order => orderIds.has(order.externalId)).flatMap(order => (order.items || []).map(item => ({
        sales_order_id: order.externalId, product_id: item.sku, sku: item.sku, product_name: item.name, quantity: item.quantity
      } as SalesOrderItem)))
      : db.find('sales_order_items', row => orderIds.has(row.sales_order_id) && matchesIntegrationSource(row, integrationId));
    for (const item of items.filter(row => selectedSkus.has(String(row.sku || ''))
      || selectedSkus.has(String(row.product_id || ''))
      || selectedProducts.some(product => product.id === row.product_id)
      || (!liveOrders && program.product_ids.includes(row.product_id)))) {
      if (!itemsByOrder.has(item.sales_order_id)) itemsByOrder.set(item.sales_order_id, []);
      itemsByOrder.get(item.sales_order_id)!.push(item);
    }
  }

  const customerById = new Map(db.find('customers', customer => customer.company_id === companyId && matchesIntegrationSource(customer, integrationId)).map(customer => [customer.id, customer]));
  const agents = new Map(db.find('agents', agent => agent.company_id === companyId && matchesIntegrationSource(agent, integrationId)).map(agent => [agent.id, agent.full_name]));
  const groups = new Map<string, { customer_id: string; customer: string; customer_code: string; customer_phone: string; customer_address: string; agent_id: string; agent: string; value: number; order_count: number; last_order_date: string }>();
  for (const order of orders) {
    const value = program.metric === 'AMOUNT'
      ? Math.max(0, Number(order.net_sales) || 0)
      : (itemsByOrder.get(order.id) || []).reduce((sum, item) => sum + Math.max(0, Number(item.quantity) || 0), 0);
    if (!value) continue;
    const customerId = order.customer_id || `name:${order.customer_name}`;
    const agentId = order.agent_id || '';
    const key = `${customerId}|${program.group_by_agent ? agentId : 'all'}`;
    const customerRecord = customerById.get(order.customer_id);
    const row = groups.get(key) || {
      customer_id: customerId,
      customer: order.customer_name || customerRecord?.name || 'Mijoz nomi yo‘q',
      customer_code: customerRecord?.code || '',
      customer_phone: customerRecord?.phone || '',
      customer_address: customerRecord?.address || '',
      agent_id: program.group_by_agent ? agentId : '',
      agent: program.group_by_agent ? (agents.get(agentId) || order.agent_name || order.expeditor_name || 'Agent ko‘rsatilmagan') : 'Barcha agentlar',
      value: 0,
      order_count: 0,
      last_order_date: ''
    };
    row.value += value;
    row.order_count++;
    if (order.order_date > row.last_order_date) row.last_order_date = order.order_date;
    groups.set(key, row);
  }

  const tiers = [...program.tiers].sort((a, b) => a.threshold - b.threshold);
  const rows = [...groups.values()].map(row => {
    const earned = [...tiers].reverse().find(tier => row.value >= tier.threshold) || null;
    const next = tiers.find(tier => row.value < tier.threshold) || null;
    return {
      ...row,
      earned_reward: earned?.reward || null,
      next_reward: next?.reward || null,
      next_threshold: next?.threshold || null,
      remaining: next ? Math.max(0, next.threshold - row.value) : null
    };
  }).sort((a, b) => b.value - a.value || a.customer.localeCompare(b.customer, 'uz'));
  const totalValue = rows.reduce((sum, row) => sum + row.value, 0);
  const expectsKilograms = program.metric === 'QUANTITY' && program.terms.some(term => /kilogram|kilogramm|\bkg\b/i.test(term));
  const calculationWarning = productUnitsMismatch ? 'Aksiya o‘lchov birligi tanlangan mahsulot birligiga mos emas. Sovg‘a shartlari birliklar moslanguncha hisoblanmaydi.' : null;
  const calculationNote = expectsKilograms && normalizeUnit(program.unit) === 'dona'
    ? 'Ushbu aksiya uchun 1 dona = 1 kg deb olinadi. Shuning uchun kg chegaralari dona miqdoriga 1:1 mos hisoblanadi.'
    : null;
  if (calculationWarning) for (const row of rows) {
    row.earned_reward = null; row.next_reward = null; row.next_threshold = null; row.remaining = null;
  }
  const earned = calculationWarning ? [] : rows.filter(row => row.earned_reward);
  const rewardCounts = [...new Set(tiers.map(tier => tier.reward))]
    .map(reward => ({ reward, count: earned.filter(row => row.earned_reward === reward).length }));
  return { rows, summary: { customers: rows.length, qualified: earned.length, orders: rows.reduce((sum, row) => sum + row.order_count, 0), total_value: totalValue, reward_counts: rewardCounts }, calculation_warning: calculationWarning, calculation_note: calculationNote, computed_from: liveOrders ? `${sourceName || 'Ulangan tizim'}dan olingan (bekor/qaytarilganlardan tashqari) savdolar` : `${sourceName || 'DistroPro'} bazasidagi (bekor/qaytarilganlardan tashqari) savdolar` };
}

router.use(requireAuth);

router.get('/programs', requirePermission('reports', 'view'), (req: Request, res: Response, next) => {
  try {
    const programs = db.find('loyalty_programs', row => row.company_id === req.user!.companyId)
      .sort((a, b) => b.updated_at?.localeCompare(a.updated_at || '') || b.created_at.localeCompare(a.created_at));
    res.json({ programs });
  } catch (error) { next(error); }
});

router.get('/programs/:id/results', requirePermission('reports', 'view'), async (req: Request, res: Response, next) => {
  try {
    const program = db.findById('loyalty_programs', req.params.id);
    if (!program || program.company_id !== req.user!.companyId) { res.status(404).json({ success: false, error: 'Aksiya topilmadi.' }); return; }
    const connected = activeDistribution(req.user!.companyId);
    // Use the completed, deduplicated history import. A live range query is incomplete on some providers,
    // bypasses the user's full-history setting and can omit older orders from an otherwise completed campaign.
    const integrationId = connected?.integration.id || null;
    res.json({ ...buildResults(program, undefined, connected?.name || 'DistroPro', integrationId), program_id: program.id, start_date: program.start_date, end_date: program.end_date });
  } catch (error) { next(error); }
});

router.get('/agents/:agentId/results', requirePermission('reports', 'view'), (req: Request, res: Response, next) => {
  try {
    const companyId = req.user!.companyId;
    const agent = db.findById('agents', req.params.agentId);
    if (!agent || agent.company_id !== companyId) { res.status(404).json({ success: false, error: 'Agent topilmadi.' }); return; }
    const connected = activeDistribution(companyId);
    const integrationId = connected?.integration.id || null;
    const programs = db.find('loyalty_programs', row => row.company_id === companyId);
    const rows = programs.flatMap(program => {
      // Always group by agent for the profile, even when the campaign overview is grouped by customer only.
      const result = buildResults({ ...program, group_by_agent: true }, undefined, connected?.name || 'DistroPro', integrationId);
      return result.rows.filter(row => row.agent_id === agent.id).map(row => ({
        ...row, calculation_warning: result.calculation_warning, calculation_note: result.calculation_note, program_id: program.id, program_name: program.name, metric: program.metric, unit: program.unit,
        start_date: program.start_date, end_date: program.end_date, is_active: program.is_active
      }));
    }).sort((a, b) => Number(b.is_active) - Number(a.is_active) || b.value - a.value || a.customer.localeCompare(b.customer, 'uz'));
    res.json({ agent: { id: agent.id, name: agent.full_name, code: agent.code }, rows, programs: programs.length, computed_from: `${connected?.name || 'DistroPro'} bazasidagi (bekor/qaytarilganlardan tashqari) barcha statusdagi savdolar` });
  } catch (error) { next(error); }
});

router.post('/programs', requireOwner, requirePermission('reports', 'view'), (req: Request, res: Response, next) => {
  try {
    const normalized = validateAndNormalize(ProgramInput.parse(req.body), req.user!.companyId);
    const now = new Date().toISOString();
    const program: LoyaltyProgram = { ...normalized, id: `loyalty-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, company_id: req.user!.companyId,
      created_by: req.user!.userId, created_at: now, updated_at: now, archived_at: null };
    db.insert('loyalty_programs', program);
    AuditService.log({ company_id: program.company_id, user_id: req.user!.userId, user_email: req.user!.email, action: 'CREATE', entity: 'LoyaltyProgram', entity_id: program.id, new_value: program });
    res.status(201).json({ program });
  } catch (error) { next(error); }
});

router.put('/programs/:id', requireOwner, requirePermission('reports', 'view'), (req: Request, res: Response, next) => {
  try {
    const current = db.findById('loyalty_programs', req.params.id);
    if (!current || current.company_id !== req.user!.companyId) { res.status(404).json({ success: false, error: 'Aksiya topilmadi.' }); return; }
    const normalized = validateAndNormalize(ProgramInput.parse(req.body), req.user!.companyId);
    const program = db.update('loyalty_programs', current.id, { ...normalized, archived_at: normalized.is_active ? null : current.archived_at });
    AuditService.log({ company_id: current.company_id, user_id: req.user!.userId, user_email: req.user!.email, action: 'UPDATE', entity: 'LoyaltyProgram', entity_id: current.id, old_value: current, new_value: program });
    res.json({ program });
  } catch (error) { next(error); }
});

router.post('/programs/:id/archive', requireOwner, requirePermission('reports', 'view'), (req: Request, res: Response, next) => {
  try {
    const current = db.findById('loyalty_programs', req.params.id);
    if (!current || current.company_id !== req.user!.companyId) { res.status(404).json({ success: false, error: 'Aksiya topilmadi.' }); return; }
    const archived = current.is_active ? new Date().toISOString() : null;
    const program = db.update('loyalty_programs', current.id, { is_active: !current.is_active, archived_at: archived });
    AuditService.log({ company_id: current.company_id, user_id: req.user!.userId, user_email: req.user!.email, action: 'UPDATE', entity: 'LoyaltyProgram', entity_id: current.id,
      old_value: { is_active: current.is_active }, new_value: { is_active: program?.is_active }, reason: program?.is_active ? 'Sodiqlik aksiyasi qayta faollashtirildi' : 'Sodiqlik aksiyasi arxivlandi' });
    res.json({ program });
  } catch (error) { next(error); }
});

export default router;
