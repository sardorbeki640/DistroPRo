import { db } from '../db/database.ts';
import { AnalyticsService } from './analytics.service.ts';
import { isValidIsoDate } from '../utils/date.ts';
import { OTHER_TEAM, TeamsService } from './teams.service.ts';
import type { SalesOrderItem } from '../db/schema.ts';
import { matchesIntegrationSource } from './source-tagging.service.ts';

export interface Period { from: string; to: string }
/** up = growth is good (sales, profit); down = growth is bad (costs, expenses); neutral = no judgement. */
export type Direction = 'up' | 'down' | 'neutral';
export interface CompareLine { key: string; label: string; section: string; a: number | null; b: number | null; good: Direction; unit: 'money' | 'count' | 'percent'; indent?: boolean }

function assertPeriod(p: Period, name: string) {
  if (!isValidIsoDate(p.from) || !isValidIsoDate(p.to) || p.from > p.to) throw Object.assign(new Error(`${name}: sanalar noto‘g‘ri`), { status: 400 });
}

/**
 * Facts of one period for the breakdowns (agents, customers, products, counts). They count every order that was not
 * cancelled: the distribution system marks orders delivered days later, so counting delivered ones only makes the
 * latest days look like a fall. Delivered and still-on-the-way parts are kept apart.
 */
function periodFacts(companyId: string, p: Period, integrationId?: string) {
  const orders = db.find('sales_orders', o => o.company_id === companyId && o.status !== 'CANCELLED' && o.order_date >= p.from && o.order_date <= p.to && matchesIntegrationSource(o, integrationId));
  const pending = orders.filter(o => o.status !== 'DELIVERED');
  const net = (o: any) => (o.total_sales || 0) - (o.discount_amount || 0) - (o.return_amount || 0);
  const byCustomer = new Map<string, { sales: number; orders: number }>();
  const byAgent = new Map<string, { sales: number; orders: number; customers: Set<string>; pending: number }>();
  for (const o of orders) {
    const c = byCustomer.get(o.customer_id) || { sales: 0, orders: 0 };
    c.sales += net(o); c.orders++;
    byCustomer.set(o.customer_id, c);
    const key = o.agent_id || 'none';
    const a = byAgent.get(key) || { sales: 0, orders: 0, customers: new Set<string>(), pending: 0 };
    a.sales += net(o); a.orders++; a.customers.add(o.customer_id);
    if (o.status !== 'DELIVERED') a.pending += net(o);
    byAgent.set(key, a);
  }
  const orderIds = new Set(orders.map(o => o.id));
  const byProduct = new Map<string, { name: string; qty: number; sales: number }>();
  for (const item of db.getTable('sales_order_items')) {
    if (!orderIds.has(item.sales_order_id)) continue;
    const key = item.sku || item.product_id;
    const row = byProduct.get(key) || { name: item.product_name, qty: 0, sales: 0 };
    row.qty += item.quantity || 0;
    row.sales += item.total_amount || 0;
    byProduct.set(key, row);
  }
  const cashReturns = db.find('returns', r => r.company_id === companyId && r.date >= p.from && r.date <= p.to).reduce((s, r) => s + (r.amount || 0), 0);
  const sales = orders.reduce((s, o) => s + net(o), 0);
  return {
    orders, byCustomer, byAgent, byProduct, cashReturns, sales,
    pendingSales: pending.reduce((s, o) => s + net(o), 0),
    pendingCount: pending.length,
    avgOrder: orders.length ? Math.round(sales / orders.length) : 0,
    qty: [...byProduct.values()].reduce((s, r) => s + r.qty, 0)
  };
}

/**
 * Sales split by team (product category -> team) per agent profile. An order's discounts and returns are shared
 * among its lines by amount; an order without lines (its products unknown) counts in "other".
 */
function teamSplit(companyId: string, orders: any[], teamOf: Map<string, string>, integrationId?: string) {
  const net = (o: any) => (o.total_sales || 0) - (o.discount_amount || 0) - (o.return_amount || 0);
  const categoryBySku = new Map(db.find('products', p => p.company_id === companyId && matchesIntegrationSource(p, integrationId)).map(p => [p.sku, String(p.category || '').replace(/\s+/g, ' ').trim()]));
  const byOrder = new Map(orders.map(o => [o.id, o]));
  const out = new Map<string, { sales: number; orders: Set<string>; customers: Set<string> }>();
  const add = (o: any, team: string, amount: number) => {
    const key = `${o.agent_id || 'none'}|${team}`;
    const r = out.get(key) || { sales: 0, orders: new Set<string>(), customers: new Set<string>() };
    r.sales += amount; r.orders.add(o.id); r.customers.add(o.customer_id);
    out.set(key, r);
  };
  const linesByOrder = new Map<string, SalesOrderItem[]>();
  for (const item of db.getTable('sales_order_items')) {
    if (!byOrder.has(item.sales_order_id)) continue;
    const rows = linesByOrder.get(item.sales_order_id) || [];
    rows.push(item);
    linesByOrder.set(item.sales_order_id, rows);
  }
  for (const o of orders) {
    const lines = linesByOrder.get(o.id) || [];
    const validLines = lines.map(line => ({ line, amount: Number(line.total_amount) }))
      .filter(row => Number.isFinite(row.amount) && row.amount > 0);
    const sourceTotal = validLines.reduce((sum, row) => sum + row.amount, 0);
    const orderNet = Math.round(net(o));
    if (!validLines.length || sourceTotal <= 0) {
      // An order without usable product amounts still belongs in agent totals; keep it visible as unclassified.
      add(o, OTHER_TEAM, orderNet);
      continue;
    }
    // Source line totals often exclude/round discounts or omit a line. Normalize by the line total so teams always
    // reconcile exactly to the order's net total; put any integer-rounding remainder on the last line.
    let allocated = 0;
    validLines.forEach(({ line, amount }, index) => {
      const share = amount / sourceTotal;
      const allocatedAmount = index === validLines.length - 1
        ? orderNet - allocated
        : Math.round(orderNet * share);
      allocated += allocatedAmount;
      add(o, teamOf.get(categoryBySku.get(line.sku || line.product_id) || '') || OTHER_TEAM, allocatedAmount);
    });
  }
  return out;
}

/**
 * Net sales of one person on a shared profile: the profile's delivered orders in the period, only the lines of their
 * team's categories. Orders without lines (products unknown) are not counted for anyone's team. Pay counts delivered
 * orders only; the cabinet counts every order not cancelled, like the comparison it sits next to.
 */
export function teamMemberSales(companyId: string, agentId: string, teamId: string, from: string, to: string, deliveredOnly = true) {
  const orders = db.find('sales_orders', o => o.company_id === companyId && o.agent_id === agentId && (deliveredOnly ? o.status === 'DELIVERED' : o.status !== 'CANCELLED') && o.order_date >= from && o.order_date <= to);
  const r = teamSplit(companyId, orders, TeamsService.teamOfCategory(companyId)).get(`${agentId}|${teamId}`);
  return { sales: Math.round(r?.sales || 0), orders: r?.orders.size || 0, customers: r?.customers.size || 0 };
}

/** Rows "agent × team" for both periods (only when the company has teams). */
function agentTeamRows(companyId: string, ordersA: any[], ordersB: any[], agentId?: string, integrationId?: string) {
  const teams = TeamsService.list(companyId);
  if (!teams.length) return [];
  const teamOf = TeamsService.teamOfCategory(companyId);
  const sa = teamSplit(companyId, ordersA, teamOf, integrationId), sb = teamSplit(companyId, ordersB, teamOf, integrationId);
  const keys = new Set([...sa.keys(), ...sb.keys()]);
  const order = new Map(teams.map((t, i) => [t.id, i]));
  return [...keys].filter(k => !agentId || k.startsWith(`${agentId}|`)).map(k => {
    const [agent_id, team_id] = k.split('|');
    const t = teams.find(x => x.id === team_id);
    const x = sa.get(k), y = sb.get(k);
    return {
      agent_id, team_id, team_name: t?.name || 'Boshqa (komandasiz)', person: t?.members?.[agent_id] || '',
      sales_a: Math.round(x?.sales || 0), sales_b: Math.round(y?.sales || 0),
      orders_a: x?.orders.size || 0, orders_b: y?.orders.size || 0, customers_a: x?.customers.size || 0, customers_b: y?.customers.size || 0
    };
  }).filter(r => r.sales_a || r.sales_b)
    .sort((p, q) => p.agent_id.localeCompare(q.agent_id) || (order.get(p.team_id) ?? 99) - (order.get(q.team_id) ?? 99));
}

/**
 * Side-by-side comparison of two periods: P&L lines, expenses by category, agents, products and customers.
 * Period A is the earlier/base one, B the one being judged (like "first period / second period").
 */
export function comparePeriods(companyId: string, a: Period, b: Period, integrationId?: string) {
  assertPeriod(a, 'Birinchi davr');
  assertPeriod(b, 'Ikkinchi davr');
  const pa = AnalyticsService.getProfitAndLoss(companyId, a.from, a.to, integrationId);
  const pb = AnalyticsService.getProfitAndLoss(companyId, b.from, b.to, integrationId);
  const fa = periodFacts(companyId, a, integrationId);
  const fb = periodFacts(companyId, b, integrationId);

  // Customers who bought before period A: anyone without earlier delivered orders counts as new.
  const firstOrder = new Map<string, string>();
  for (const o of db.find('sales_orders', o => o.company_id === companyId && o.status !== 'CANCELLED' && matchesIntegrationSource(o, integrationId))) {
    const prev = firstOrder.get(o.customer_id);
    if (!prev || o.order_date < prev) firstOrder.set(o.customer_id, o.order_date);
  }
  const newCustomers = (f: ReturnType<typeof periodFacts>, p: Period) => [...f.byCustomer.keys()].filter(id => (firstOrder.get(id) || '') >= p.from).length;

  const lines: CompareLine[] = [
    { key: 'gross_sales', label: 'Yalpi savdo (yetkazilgan)', section: 'Savdo', a: pa.gross_sales, b: pb.gross_sales, good: 'up', unit: 'money' },
    { key: 'discounts', label: 'Chegirmalar', section: 'Savdo', a: pa.sales_discounts, b: pb.sales_discounts, good: 'down', unit: 'money', indent: true },
    { key: 'returns', label: 'Qaytarishlar', section: 'Savdo', a: pa.returns, b: pb.returns, good: 'down', unit: 'money', indent: true },
    { key: 'cash_returns', label: 'Kassadagi qaytarishlar', section: 'Savdo', a: fa.cashReturns, b: fb.cashReturns, good: 'down', unit: 'money', indent: true },
    { key: 'net_revenue', label: 'Sof tushum', section: 'Savdo', a: pa.net_revenue, b: pb.net_revenue, good: 'up', unit: 'money' },
    { key: 'pending', label: 'Yetkazilmagan buyurtmalar (yo‘lda)', section: 'Savdo', a: fa.pendingSales, b: fb.pendingSales, good: 'neutral', unit: 'money' },
    { key: 'taken', label: 'Olingan buyurtmalar (bekor qilinmagan, jami)', section: 'Savdo', a: fa.sales, b: fb.sales, good: 'up', unit: 'money' },
    { key: 'orders', label: 'Buyurtmalar soni', section: 'Savdo', a: fa.orders.length, b: fb.orders.length, good: 'up', unit: 'count' },
    { key: 'avg_order', label: 'O‘rtacha buyurtma', section: 'Savdo', a: fa.avgOrder, b: fb.avgOrder, good: 'up', unit: 'money' },
    { key: 'qty', label: 'Sotilgan miqdor (dona)', section: 'Savdo', a: fa.qty, b: fb.qty, good: 'up', unit: 'count' },
    { key: 'customers', label: 'Xarid qilgan mijozlar', section: 'Mijozlar', a: fa.byCustomer.size, b: fb.byCustomer.size, good: 'up', unit: 'count' },
    { key: 'new_customers', label: 'Yangi mijozlar (birinchi xarid)', section: 'Mijozlar', a: newCustomers(fa, a), b: newCustomers(fb, b), good: 'up', unit: 'count' },
    { key: 'cogs', label: 'Tannarx (ma’lum qism)', section: 'Foyda', a: pa.cost_of_goods_sold, b: pb.cost_of_goods_sold, good: 'down', unit: 'money' },
    { key: 'gross_profit', label: 'Yalpi foyda', section: 'Foyda', a: pa.cogs_complete ? pa.gross_profit : null, b: pb.cogs_complete ? pb.gross_profit : null, good: 'up', unit: 'money' },
    { key: 'gross_margin', label: 'Yalpi foyda rentabelligi', section: 'Foyda', a: pa.cogs_complete ? pa.gross_margin_percent : null, b: pb.cogs_complete ? pb.gross_margin_percent : null, good: 'up', unit: 'percent' },
    { key: 'cogs_coverage', label: 'Tannarx ma’lum savdo ulushi', section: 'Foyda', a: pa.cogs_coverage_percent, b: pb.cogs_coverage_percent, good: 'up', unit: 'percent' }
  ];

  // Expenses: every category that appears in either period.
  const categories = new Map<string, string>();
  for (const e of [...pa.operating_expenses, ...pb.operating_expenses]) categories.set(e.category_id, e.category_name);
  lines.push({ key: 'opex', label: 'Xarajatlar jami', section: 'Xarajatlar', a: pa.total_operating_expenses + pa.total_payroll, b: pb.total_operating_expenses + pb.total_payroll, good: 'down', unit: 'money' });
  lines.push({ key: 'payroll', label: 'Ish haqi', section: 'Xarajatlar', a: pa.total_payroll, b: pb.total_payroll, good: 'down', unit: 'money', indent: true });
  for (const [id, name] of [...categories].sort((x, y) => x[1].localeCompare(y[1]))) {
    lines.push({
      key: `exp:${id}`, label: name, section: 'Xarajatlar',
      a: pa.operating_expenses.find(e => e.category_id === id)?.amount || 0,
      b: pb.operating_expenses.find(e => e.category_id === id)?.amount || 0,
      good: 'down', unit: 'money', indent: true
    });
  }
  lines.push({ key: 'net_profit', label: 'Sof foyda', section: 'Natija', a: pa.net_profit, b: pb.net_profit, good: 'up', unit: 'money' });
  lines.push({ key: 'net_margin', label: 'Sof rentabellik', section: 'Natija', a: pa.net_margin_percent, b: pb.net_margin_percent, good: 'up', unit: 'percent' });

  // Agents
  const agentIds = new Set([...fa.byAgent.keys(), ...fb.byAgent.keys()]);
  const agents = [...agentIds].map(id => {
    const x = fa.byAgent.get(id), y = fb.byAgent.get(id);
    return {
      agent_id: id, name: id === 'none' ? 'Agentsiz' : db.findById('agents', id)?.full_name || id,
      sales_a: x?.sales || 0, sales_b: y?.sales || 0, orders_a: x?.orders || 0, orders_b: y?.orders || 0,
      pending_a: x?.pending || 0, pending_b: y?.pending || 0,
      customers_a: x?.customers.size || 0, customers_b: y?.customers.size || 0
    };
  }).sort((p, q) => q.sales_b - p.sales_b);

  // Products: biggest gains and losses in revenue
  const skus = new Set([...fa.byProduct.keys(), ...fb.byProduct.keys()]);
  const products = [...skus].map(sku => {
    const x = fa.byProduct.get(sku), y = fb.byProduct.get(sku);
    return { sku, name: y?.name || x?.name || sku, qty_a: x?.qty || 0, qty_b: y?.qty || 0, sales_a: x?.sales || 0, sales_b: y?.sales || 0, diff: (y?.sales || 0) - (x?.sales || 0) };
  });
  const byDiff = [...products].sort((p, q) => q.diff - p.diff);

  // Customers who bought in A and bought much less (or nothing) in B: a call list for CRM, with who serves them and where.
  const territoryName = new Map(db.find('territories', t => t.company_id === companyId).map(t => [t.id, t.name]));
  const agentName = (id?: string | null) => (id ? db.findById('agents', id)?.full_name || null : null);
  // The agent who took the customer's last order in period A, when the card has none.
  const lastAgent = new Map<string, string>();
  for (const o of [...fa.orders].sort((p, q) => p.order_date.localeCompare(q.order_date))) if (o.agent_id) lastAgent.set(o.customer_id, o.agent_id);
  const declining = [...fa.byCustomer].map(([id, x]) => {
    const y = fb.byCustomer.get(id);
    const c = db.findById('customers', id);
    return {
      customer_id: id, name: c?.name || id, phone: c?.phone || '', debt: Math.max(0, c?.current_balance || 0),
      agent_name: agentName(c?.agent_id) || agentName(lastAgent.get(id)) || '', territory: (c?.territory_id && territoryName.get(c.territory_id)) || '',
      sales_a: x.sales, sales_b: y?.sales || 0, orders_a: x.orders, orders_b: y?.orders || 0, diff: (y?.sales || 0) - x.sales
    };
  }).filter(r => r.diff < 0).sort((p, q) => p.diff - q.diff);

  return {
    periods: { a, b },
    days: { a: dayCount(a), b: dayCount(b) },
    cogs_complete: pa.cogs_complete && pb.cogs_complete,
    // Orders not yet marked delivered in the distribution system (usually the last few days).
    pending: { a: { count: fa.pendingCount, sum: fa.pendingSales }, b: { count: fb.pendingCount, sum: fb.pendingSales } },
    lines,
    agents,
    // One agent profile shared by several people: its sales by team (product categories of each team).
    agent_teams: agentTeamRows(companyId, fa.orders, fb.orders, undefined, integrationId),
    products: { gainers: byDiff.filter(p => p.diff > 0).slice(0, 15), losers: byDiff.filter(p => p.diff < 0).reverse().slice(0, 15) },
    customers: {
      stopped: declining.filter(r => r.sales_b === 0).length,
      declining: declining.slice(0, 30)
    }
  };
}

/**
 * One agent in two periods, in depth: totals (taken, delivered, on the way, cancelled, returns, discounts), sales by day,
 * by category and product, and the customers who stopped, started, bought less or more. Same rule as the agents table:
 * every order that was not cancelled counts as sales.
 */
export function compareAgent(companyId: string, agentId: string, a: Period, b: Period, integrationId?: string) {
  assertPeriod(a, 'Birinchi davr');
  assertPeriod(b, 'Ikkinchi davr');
  const agent = agentId === 'none' ? null : db.findById('agents', agentId);
  if (agentId !== 'none' && (!agent || agent.company_id !== companyId)) throw Object.assign(new Error('Agent topilmadi'), { status: 404 });
  const net = (o: any) => (o.total_sales || 0) - (o.discount_amount || 0) - (o.return_amount || 0);
  const mine = (o: any) => (agentId === 'none' ? !o.agent_id : o.agent_id === agentId);
  const productBySku = new Map(db.find('products', p => p.company_id === companyId && matchesIntegrationSource(p, integrationId)).map(p => [p.sku, p]));
  const firstOrder = new Map<string, string>();
  for (const o of db.find('sales_orders', o => o.company_id === companyId && o.status !== 'CANCELLED' && mine(o) && matchesIntegrationSource(o, integrationId))) {
    const prev = firstOrder.get(o.customer_id);
    if (!prev || o.order_date < prev) firstOrder.set(o.customer_id, o.order_date);
  }

  const facts = (p: Period) => {
    const all = db.find('sales_orders', o => o.company_id === companyId && mine(o) && o.order_date >= p.from && o.order_date <= p.to && matchesIntegrationSource(o, integrationId));
    const orders = all.filter(o => o.status !== 'CANCELLED');
    const cancelled = all.filter(o => o.status === 'CANCELLED');
    const delivered = orders.filter(o => o.status === 'DELIVERED');
    const sum = (list: any[], f: (o: any) => number) => list.reduce((s, o) => s + f(o), 0);
    const sales = sum(orders, net);
    const byDay = new Map<string, number>();
    const byCustomer = new Map<string, { sales: number; orders: number; last: string }>();
    for (const o of orders) {
      byDay.set(o.order_date, (byDay.get(o.order_date) || 0) + net(o));
      const c = byCustomer.get(o.customer_id) || { sales: 0, orders: 0, last: '' };
      c.sales += net(o); c.orders++; if (o.order_date > c.last) c.last = o.order_date;
      byCustomer.set(o.customer_id, c);
    }
    const ids = new Set(orders.map(o => o.id));
    const byProduct = new Map<string, { name: string; category: string; qty: number; sales: number }>();
    for (const item of db.getTable('sales_order_items')) {
      if (!ids.has(item.sales_order_id)) continue;
      const key = item.sku || item.product_id;
      const prod = productBySku.get(key);
      const row = byProduct.get(key) || { name: item.product_name || prod?.name || key, category: prod?.category || 'Kategoriyasiz', qty: 0, sales: 0 };
      row.qty += item.quantity || 0; row.sales += item.total_amount || 0;
      byProduct.set(key, row);
    }
    const days = dayCount(p);
    return {
      orders, byDay, byCustomer, byProduct,
      totals: {
        sales, delivered: sum(delivered, net), pending: sales - sum(delivered, net),
        orders: orders.length, customers: byCustomer.size,
        new_customers: [...byCustomer.keys()].filter(id => (firstOrder.get(id) || '') >= p.from).length,
        avg_order: orders.length ? Math.round(sales / orders.length) : 0,
        per_day: Math.round(sales / days),
        active_days: byDay.size,
        returns: sum(orders, o => o.return_amount || 0),
        discounts: sum(orders, o => o.discount_amount || 0),
        cancelled_count: cancelled.length, cancelled_sum: sum(cancelled, o => o.total_sales || 0),
        qty: [...byProduct.values()].reduce((s, r) => s + r.qty, 0)
      }
    };
  };
  const fa = facts(a), fb = facts(b);

  // Days side by side: the n-th day of period A next to the n-th day of period B.
  const daysOf = (p: Period) => Array.from({ length: dayCount(p) }, (_, i) => new Date(Date.parse(`${p.from}T12:00:00Z`) + i * 86400000).toISOString().slice(0, 10));
  const da = daysOf(a), db_ = daysOf(b);
  const daily = Array.from({ length: Math.max(da.length, db_.length) }, (_, i) => ({
    a_date: da[i] || null, a: da[i] ? Math.round(fa.byDay.get(da[i]) || 0) : null,
    b_date: db_[i] || null, b: db_[i] ? Math.round(fb.byDay.get(db_[i]) || 0) : null
  }));

  const categories = new Map<string, { a: number; b: number }>();
  for (const [f, side] of [[fa, 'a'], [fb, 'b']] as const) for (const r of f.byProduct.values()) {
    const c = categories.get(r.category) || { a: 0, b: 0 };
    c[side] += r.sales; categories.set(r.category, c);
  }
  const skus = new Set([...fa.byProduct.keys(), ...fb.byProduct.keys()]);
  const products = [...skus].map(sku => {
    const x = fa.byProduct.get(sku), y = fb.byProduct.get(sku);
    return { sku, name: y?.name || x?.name || sku, category: y?.category || x?.category || '', qty_a: x?.qty || 0, qty_b: y?.qty || 0, sales_a: x?.sales || 0, sales_b: y?.sales || 0, diff: (y?.sales || 0) - (x?.sales || 0) };
  }).sort((p, q) => q.diff - p.diff);

  const customerIds = new Set([...fa.byCustomer.keys(), ...fb.byCustomer.keys()]);
  const customers = [...customerIds].map(id => {
    const x = fa.byCustomer.get(id), y = fb.byCustomer.get(id);
    const c = db.findById('customers', id);
    return {
      customer_id: id, name: c?.name || id, phone: c?.phone || '', address: c?.address || '', debt: Math.max(0, c?.current_balance || 0),
      sales_a: x?.sales || 0, sales_b: y?.sales || 0, orders_a: x?.orders || 0, orders_b: y?.orders || 0,
      last_order: y?.last || x?.last || null, diff: (y?.sales || 0) - (x?.sales || 0)
    };
  });
  const assigned = agentId === 'none' ? [] : db.find('customers', c => c.company_id === companyId && c.agent_id === agentId);
  const debtors = assigned.filter(c => (c.current_balance || 0) > 0);

  return {
    agent: { id: agentId, name: agent?.full_name || 'Agentsiz', code: agent?.code || null, phone: agent?.phone || null },
    periods: { a, b }, days: { a: dayCount(a), b: dayCount(b) },
    totals: { a: fa.totals, b: fb.totals },
    teams: agentTeamRows(companyId, fa.orders, fb.orders, agentId, integrationId),
    daily,
    categories: [...categories].map(([name, v]) => ({ name, sales_a: v.a, sales_b: v.b, diff: v.b - v.a })).sort((p, q) => q.sales_b - p.sales_b),
    products: { gainers: products.filter(p => p.diff > 0).slice(0, 10), losers: products.filter(p => p.diff < 0).reverse().slice(0, 10), count_a: fa.byProduct.size, count_b: fb.byProduct.size },
    customers: {
      stopped: customers.filter(c => c.sales_a > 0 && c.sales_b === 0).sort((p, q) => q.sales_a - p.sales_a).slice(0, 30),
      started: customers.filter(c => c.sales_a === 0 && c.sales_b > 0).sort((p, q) => q.sales_b - p.sales_b).slice(0, 30),
      declining: customers.filter(c => c.sales_a > 0 && c.sales_b > 0 && c.diff < 0).sort((p, q) => p.diff - q.diff).slice(0, 20),
      growing: customers.filter(c => c.sales_a > 0 && c.diff > 0).sort((p, q) => q.diff - p.diff).slice(0, 20),
      counts: {
        stopped: customers.filter(c => c.sales_a > 0 && c.sales_b === 0).length,
        started: customers.filter(c => c.sales_a === 0 && c.sales_b > 0).length
      }
    },
    debt: { customers: assigned.length, debtors: debtors.length, total: debtors.reduce((s, c) => s + (c.current_balance || 0), 0) }
  };
}

function dayCount(p: Period) {
  return Math.round((Date.parse(p.to) - Date.parse(p.from)) / 86400000) + 1;
}
