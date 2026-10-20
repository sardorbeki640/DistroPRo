import { JarvisService } from '../jarvis/jarvis.service.ts';
import { compareAgent, comparePeriods, teamMemberSales, type Period } from './compare.service.ts';
import { TeamsService } from './teams.service.ts';
import { businessToday } from '../utils/date.ts';
import { db } from '../db/database.ts';

export interface AgentStrategy {
  verdict: string;
  score: number | null;
  strengths: string[];
  problems: { title: string; evidence: string }[];
  actions: { title: string; why: string; how: string; target: string; deadline: string }[];
  watch: string[];
  call_list: { customer: string; reason: string; offer: string }[];
  team_notes: { team: string; advice: string }[];
}

const CACHE_MS = 6 * 3600_000;
const cache = new Map<string, { at: number; result: any }>();

const SYSTEM = `Siz distribyutsiya kompaniyasining tajribali savdo direktorisiz. Sizga bitta savdo agentining ikki davrdagi HAQIQIY ko‘rsatkichlari beriladi.
Vazifa: agent savdosi O‘SISHI uchun aniq strategiya tuzish — nima qilish kerak, nimaga e’tibor berish kerak.
Qoidalar:
- Faqat berilgan raqamlarga tayaning, raqam o‘ylab topmang. Har bir xulosani raqam bilan asoslang.
- "hali yo‘lda" (yetkazilmagan) summa agentning kamchiligi emas — u savdo hisoblanadi.
- 2-davr hali tugamagan bo‘lsa, buni hisobga oling (kunlik o‘rtacha bilan solishtiring).
- Harakatlar aniq bo‘lsin: kim, nima, qaysi mijoz/kategoriya, qancha (summa yoki %), qachongacha.
- Xarid qilmay qo‘ygan va kamroq olgan mijozlardan qo‘ng‘iroq ro‘yxatini tuzing (nomi aynan berilganidek).
- Komandalar bo‘lsa, har biriga alohida maslahat bering.
- O‘zbek tilida (lotin), qisqa va lo‘nda: har bir maydon 1–2 gap.
- Matn ichida qo‘shtirnoq (") ishlatmang.
Javob FAQAT quyidagi JSON (markdown va izohsiz):
{"verdict":"1-2 gapda umumiy baho","score":1-10,
"strengths":["..."],
"problems":[{"title":"...","evidence":"raqam bilan"}],
"actions":[{"title":"...","why":"...","how":"qadamlar","target":"o‘lchanadigan maqsad","deadline":"muddat"}],
"watch":["har hafta kuzatiladigan ko‘rsatkich va chegarasi"],
"call_list":[{"customer":"nomi","reason":"...","offer":"nima taklif qilish"}],
"team_notes":[{"team":"...","advice":"..."}]}
actions 5–7 ta, call_list 10 tagacha.`;

function parseJson(text: string): any {
  const clean = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = clean.indexOf('{'), end = clean.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('AI javobi tushunarsiz formatda keldi. Qayta urinib ko‘ring.');
  return JSON.parse(clean.slice(start, end + 1));
}

const arr = (v: any) => (Array.isArray(v) ? v : []);
const str = (v: any) => String(v ?? '').trim();

/** The facts the AI gets: compact, only what matters for a growth plan. */
export function strategyFacts(companyId: string, agentId: string, a: Period, b: Period, integrationId?: string) {
  const d: any = compareAgent(companyId, agentId, a, b, integrationId);
  const all: any = comparePeriods(companyId, a, b, integrationId);
  const ranked = [...all.agents].sort((p: any, q: any) => q.sales_b - p.sales_b);
  const avgB = ranked.length ? Math.round(ranked.reduce((s: number, r: any) => s + r.sales_b, 0) / ranked.length) : 0;
  const round = (x: number) => Math.round(x || 0);
  return {
    agent: d.agent.name,
    periods: { first: d.periods.a, second: d.periods.b, days: d.days, second_period_not_finished: d.periods.b.to >= businessToday() },
    totals: { first: d.totals.a, second: d.totals.b },
    rank_among_agents: { place: ranked.findIndex((r: any) => r.agent_id === agentId) + 1, of: ranked.length, average_agent_sales_second: avgB },
    teams: d.teams.map((t: any) => ({ team: t.team_name, person: t.person || null, sales_first: t.sales_a, sales_second: t.sales_b, orders: `${t.orders_a}→${t.orders_b}`, customers: `${t.customers_a}→${t.customers_b}` })),
    categories: d.categories.slice(0, 15).map((c: any) => ({ category: c.name, first: round(c.sales_a), second: round(c.sales_b) })),
    products_up: d.products.gainers.slice(0, 8).map((p: any) => ({ product: p.name, category: p.category, first: round(p.sales_a), second: round(p.sales_b) })),
    products_down: d.products.losers.slice(0, 8).map((p: any) => ({ product: p.name, category: p.category, first: round(p.sales_a), second: round(p.sales_b) })),
    customers_stopped: { count: d.customers.counts.stopped, top: d.customers.stopped.slice(0, 15).map((c: any) => ({ customer: c.name, bought_first: round(c.sales_a), last_order: c.last_order, debt: round(c.debt) })) },
    customers_declining: d.customers.declining.slice(0, 10).map((c: any) => ({ customer: c.name, first: round(c.sales_a), second: round(c.sales_b), debt: round(c.debt) })),
    customers_new_or_back: d.customers.counts.started,
    debt: d.debt
  };
}

/**
 * The periods the automatic strategy is about: this month so far against the same days of last month (equal lengths,
 * so a half month is not judged against a full one).
 */
export function defaultPeriods(today = businessToday()): { a: Period; b: Period } {
  const [y, m, d] = today.split('-').map(Number);
  const prev = new Date(Date.UTC(y, m - 2, 1));
  const lastOfPrev = new Date(Date.UTC(y, m - 1, 0)).getUTCDate();
  const pm = prev.toISOString().slice(0, 7);
  return { a: { from: `${pm}-01`, to: `${pm}-${String(Math.min(d, lastOfPrev)).padStart(2, '0')}` }, b: { from: today.slice(0, 8) + '01', to: today } };
}

/** The numbers a strategy depends on; when they change noticeably, the strategy is written again. */
function signatureOf(facts: ReturnType<typeof strategyFacts>) {
  const t = facts.totals.second as any;
  const step = (v: number) => Math.round(Math.log1p(Math.max(0, v || 0)) / Math.log(1.03)); // one step per ~3% of sales
  return JSON.stringify([facts.periods.second.to, step(t.sales), t.orders, t.customers, facts.customers_stopped.count]);
}

/** The stored (automatic) strategy of an agent, or null. */
export function storedStrategy(companyId: string, agentId: string) {
  return db.findById('agent_strategies', `${companyId}|${agentId}`) || null;
}

function store(companyId: string, agentId: string, periods: { a: Period; b: Period }, result: { strategy: AgentStrategy; model: string; generated_at: string }, signature: string, salesB: number) {
  const id = `${companyId}|${agentId}`;
  const old = db.findById('agent_strategies', id);
  const history = [{ generated_at: result.generated_at, verdict: result.strategy.verdict, score: result.strategy.score, sales_b: salesB }, ...(old?.history || [])].slice(0, 20);
  const row = { id, company_id: companyId, agent_id: agentId, periods, strategy: result.strategy, model: result.model, signature, generated_at: result.generated_at, history };
  if (old) db.update('agent_strategies', id, row); else db.insert('agent_strategies', row);
}

/**
 * Keeps every active agent's strategy current: for this month against last month, a new one is written when its numbers
 * changed (a new day, sales, orders, customers who stopped), at most every MIN_GAP per agent and a few agents per run.
 */
const MIN_GAP_MS = 6 * 3600_000;
let refreshing = false;
export async function refreshStrategies(now = Date.now(), perRun = 3) {
  if (refreshing) return { written: 0 };
  refreshing = true;
  let written = 0;
  try {
    const periods = defaultPeriods(businessToday(new Date(now)));
    for (const company of db.find('companies', () => true)) {
      if (!JarvisService.ready(company.id)) continue;
      const agents = db.find('agents', a => a.company_id === company.id && a.status !== 'INACTIVE');
      const active = new Set(db.find('sales_orders', o => o.company_id === company.id && o.order_date >= periods.a.from && o.status !== 'CANCELLED').map(o => o.agent_id));
      for (const agent of agents.filter(a => active.has(a.id))) {
        if (written >= perRun) return { written };
        const old = storedStrategy(company.id, agent.id);
        if (old && now - Date.parse(old.generated_at) < MIN_GAP_MS) continue;
        const facts = strategyFacts(company.id, agent.id, periods.a, periods.b);
        const signature = signatureOf(facts);
        if (old && old.signature === signature && old.periods.b.from === periods.b.from) continue;
        try {
          const r = await agentStrategy(company.id, agent.id, periods.a, periods.b, true, facts);
          store(company.id, agent.id, periods, { ...r, generated_at: new Date(now).toISOString() }, signature, (facts.totals.second as any).sales);
          written++;
        } catch (err: any) {
          console.warn('[AgentStrategy]', agent.full_name, err.message);
          return { written }; // AI unavailable or limit reached: try again next run
        }
      }
    }
    return { written };
  } finally {
    refreshing = false;
  }
}

/** Every 30 minutes while the server runs (only for companies with an AI set up). */
export function startStrategyScheduler() {
  const run = () => refreshStrategies().catch(err => console.warn('[AgentStrategy]', err.message));
  setTimeout(run, 90_000).unref();
  setInterval(run, 30 * 60_000).unref();
}

/** The agent profile of a signed-in person: by login, employee card, or the attendance link. */
export function agentOfUser(companyId: string, userId: string) {
  const employee = db.findOne('employees', e => e.company_id === companyId && e.user_id === userId);
  const byUser = db.findOne('agents', a => a.company_id === companyId && a.user_id === userId);
  if (byUser) return byUser;
  if (!employee) return null;
  const byEmployee = db.findOne('agents', a => a.company_id === companyId && a.employee_id === employee.id);
  if (byEmployee) return byEmployee;
  // A person on a shared profile (a team member).
  const place = TeamsService.placesOf(companyId, employee.id)[0];
  if (place) return db.findById('agents', place.agent_id);
  const linked = db.findOne('attendance_settings', s => s.company_id === companyId)?.agent_links?.[employee.id];
  return linked ? db.findById('agents', linked) : null;
}

/** "My results" for the agent's own cabinet: this month against last month, and the current strategy. */
export function myPerformance(companyId: string, userId: string) {
  const agent = agentOfUser(companyId, userId);
  if (!agent) return { agent: null };
  const periods = defaultPeriods();
  const data = compareAgent(companyId, agent.id, periods.a, periods.b);
  const st = storedStrategy(companyId, agent.id);
  // On a shared profile the person also sees their own team's part (their categories) of the profile's sales.
  const employee = db.findOne('employees', e => e.company_id === companyId && e.user_id === userId);
  const place = employee ? TeamsService.placesOf(companyId, employee.id).find(p => p.agent_id === agent.id) : undefined;
  const team = place ? {
    name: place.team_name, categories: place.categories,
    a: teamMemberSales(companyId, agent.id, place.team_id, periods.a.from, periods.a.to, false),
    b: teamMemberSales(companyId, agent.id, place.team_id, periods.b.from, periods.b.to, false)
  } : null;
  return { agent: { id: agent.id, name: agent.full_name }, data, team, strategy: st ? { strategy: st.strategy, model: st.model, generated_at: st.generated_at, periods: st.periods, history: st.history } : null };
}

/**
 * A growth strategy for one agent written by the company's AI (the one set up in Jarvis) from the agent's real numbers.
 * Kept for a few hours per agent and periods; "force" writes a new one. For this month's periods it is also stored
 * as the agent's current strategy.
 */
export async function agentStrategy(companyId: string, agentId: string, a: Period, b: Period, force = false, known?: ReturnType<typeof strategyFacts>, integrationId?: string) {
  const key = `${companyId}|${agentId}|${integrationId || 'all'}|${a.from}|${a.to}|${b.from}|${b.to}`;
  const hit = cache.get(key);
  if (!force && hit && Date.now() - hit.at < CACHE_MS) return { ...hit.result, cached: true };
  // This month's strategy kept by the automatic refresh is reused as long as the numbers did not change.
  const stored = integrationId ? null : storedStrategy(companyId, agentId);
  if (!force && stored && stored.periods.a.from === a.from && stored.periods.a.to === a.to && stored.periods.b.from === b.from && stored.periods.b.to === b.to) {
    return { strategy: stored.strategy, model: stored.model, generated_at: stored.generated_at, cached: true, automatic: true, history: stored.history };
  }
  if (!JarvisService.ready(companyId)) throw Object.assign(new Error('AI ulanmagan. Jarvis → Sozlamalar bo‘limida AI xizmati, model va kalitni kiriting.'), { status: 400 });
  const facts = known || strategyFacts(companyId, agentId, a, b, integrationId);
  const prompt = `Agent ma’lumotlari (JSON, summalar so‘mda):\n${JSON.stringify(facts)}`;
  let { text, model } = await JarvisService.complete(companyId, SYSTEM, prompt, 8000, true);
  let raw: any;
  try { raw = parseJson(text); } catch {
    // A long answer can be cut off or malformed: ask once more for a shorter one.
    ({ text, model } = await JarvisService.complete(companyId, SYSTEM, `${prompt}\n\nMuhim: javob to‘liq va to‘g‘ri JSON bo‘lsin; har bir maydon 1–2 qisqa gap, actions 5 ta, call_list 8 tagacha.`, 8000, true));
    raw = parseJson(text);
  }
  const strategy: AgentStrategy = {
    verdict: str(raw.verdict),
    score: Number.isFinite(Number(raw.score)) ? Math.max(1, Math.min(10, Math.round(Number(raw.score)))) : null,
    strengths: arr(raw.strengths).map(str).filter(Boolean).slice(0, 6),
    problems: arr(raw.problems).map((p: any) => ({ title: str(p?.title), evidence: str(p?.evidence) })).filter(p => p.title).slice(0, 6),
    actions: arr(raw.actions).map((x: any) => ({ title: str(x?.title), why: str(x?.why), how: str(x?.how), target: str(x?.target), deadline: str(x?.deadline) })).filter(x => x.title).slice(0, 8),
    watch: arr(raw.watch).map(str).filter(Boolean).slice(0, 8),
    call_list: arr(raw.call_list).map((c: any) => ({ customer: str(c?.customer), reason: str(c?.reason), offer: str(c?.offer) })).filter(c => c.customer).slice(0, 12),
    team_notes: arr(raw.team_notes).map((t: any) => ({ team: str(t?.team), advice: str(t?.advice) })).filter(t => t.team && t.advice).slice(0, 6)
  };
  if (!strategy.verdict && !strategy.actions.length) throw new Error('AI strategiya qaytarmadi. Qayta urinib ko‘ring.');
  const result = { strategy, model, generated_at: new Date().toISOString(), cached: false };
  cache.set(key, { at: Date.now(), result });
  // Written by hand for this month's periods: it becomes the agent's current strategy too.
  const def = defaultPeriods();
  if (!known && !integrationId && def.a.from === a.from && def.a.to === a.to && def.b.from === b.from && def.b.to === b.to) store(companyId, agentId, def, result, signatureOf(facts), (facts.totals.second as any).sales);
  return result;
}
