import { Router } from 'express';
import { z } from 'zod';
import type { Request, Response } from 'express';
import { requireAuth, requireOwner, requirePermission } from '../middleware/auth.middleware.ts';
import { db } from '../db/database.ts';
import { AuditService } from '../services/audit.service.ts';
import type { LoyaltyProgram, SalesOrderItem } from '../db/schema.ts';
import type { ExternalSyncOrder } from '../integrations/interfaces.ts';
import { activeDistribution } from '../integrations/distribution.ts';

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

export function buildResults(program: LoyaltyProgram, liveOrders?: ExternalSyncOrder[], sourceName?: string) {
  const companyId = program.company_id;
  const start = program.start_date;
  const end = program.end_date;
  const orders = liveOrders
    ? liveOrders.filter(order => order.status === 'DELIVERED'
      && order.orderDate.slice(0, 10) >= start
      && order.orderDate.slice(0, 10) <= end)
      .map(order => ({ id: order.externalId, customer_id: order.customerCode, customer_name: order.customerName,
        agent_id: order.agentCode || '', agent_name: order.agentName || '', expeditor_name: order.expeditorName || '', net_sales: order.totalAmount,
        status: 'DELIVERED' as const, order_date: order.orderDate }))
    : db.find('sales_orders', order => order.company_id === companyId
      && order.status === 'DELIVERED'
      && order.order_date.slice(0, 10) >= start
      && order.order_date.slice(0, 10) <= end).map(order => ({ ...order, agent_name: '' }));
  const orderIds = new Set(orders.map(order => order.id));
  const itemsByOrder = new Map<string, SalesOrderItem[]>();
  if (program.metric === 'QUANTITY') {
    const selectedProducts = db.find('products', product => product.company_id === companyId && program.product_ids.includes(product.id));
    const selectedSkus = new Set(selectedProducts.flatMap(product => [product.sku, product.external_id].filter((value): value is string => !!value)));
    const items = liveOrders
      ? liveOrders.filter(order => orderIds.has(order.externalId)).flatMap(order => (order.items || []).map(item => ({
        sales_order_id: order.externalId, product_id: item.sku, sku: item.sku, product_name: item.name, quantity: item.quantity
      } as SalesOrderItem)))
      : db.find('sales_order_items', row => orderIds.has(row.sales_order_id));
    for (const item of items.filter(row => liveOrders
      ? selectedSkus.has(String(row.sku || row.product_id)) || selectedProducts.some(product => product.id === row.product_id)
      : program.product_ids.includes(row.product_id))) {
      if (!itemsByOrder.has(item.sales_order_id)) itemsByOrder.set(item.sales_order_id, []);
      itemsByOrder.get(item.sales_order_id)!.push(item);
    }
  }

  const customerNames = new Map(db.find('customers', customer => customer.company_id === companyId).map(customer => [customer.id, customer.name]));
  const agents = new Map(db.find('agents', agent => agent.company_id === companyId).map(agent => [agent.id, agent.full_name]));
  const groups = new Map<string, { customer_id: string; customer: string; agent_id: string; agent: string; value: number; order_count: number }>();
  for (const order of orders) {
    const value = program.metric === 'AMOUNT'
      ? Math.max(0, Number(order.net_sales) || 0)
      : (itemsByOrder.get(order.id) || []).reduce((sum, item) => sum + Math.max(0, Number(item.quantity) || 0), 0);
    if (!value) continue;
    const customerId = order.customer_id || `name:${order.customer_name}`;
    const agentId = order.agent_id || '';
    const key = `${customerId}|${program.group_by_agent ? agentId : 'all'}`;
    const row = groups.get(key) || {
      customer_id: customerId,
      customer: order.customer_name || customerNames.get(order.customer_id) || 'Mijoz nomi yo‘q',
      agent_id: program.group_by_agent ? agentId : '',
      agent: program.group_by_agent ? (agents.get(agentId) || order.agent_name || order.expeditor_name || 'Agent ko‘rsatilmagan') : 'Barcha agentlar',
      value: 0,
      order_count: 0
    };
    row.value += value;
    row.order_count++;
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
  const earned = rows.filter(row => row.earned_reward);
  const rewardCounts = [...new Set(tiers.map(tier => tier.reward))]
    .map(reward => ({ reward, count: earned.filter(row => row.earned_reward === reward).length }));
  return { rows, summary: { customers: rows.length, qualified: earned.length, orders: rows.reduce((sum, row) => sum + row.order_count, 0), total_value: totalValue, reward_counts: rewardCounts }, computed_from: liveOrders ? `${sourceName || 'Ulangan tizim'}dan jonli olingan yetkazilgan savdolar` : 'DistroPro bazasidagi yetkazilgan savdolar' };
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
    if (connected?.capabilities.history) {
      const orders = await connected.adapter.importOrders(connected.integration.config, {
        dateFrom: program.start_date, dateTo: program.end_date, status: [3], withItems: program.metric === 'QUANTITY'
      });
      res.json({ ...buildResults(program, orders, connected.name), program_id: program.id, start_date: program.start_date, end_date: program.end_date });
      return;
    }
    res.json({ ...buildResults(program), program_id: program.id, start_date: program.start_date, end_date: program.end_date });
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
