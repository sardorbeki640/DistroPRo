import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { db } from '../db/database.ts';
import { addDays, businessToday } from '../utils/date.ts';
import { computeInsights } from './insights.ts';
import { findTool, type JarvisContext } from './tools.ts';

/**
 * The company's Obsidian vault: a folder of Markdown notes on this computer that Jarvis keeps filled from the books
 * (daily note, agents, debtors, stock, memory) and that it searches and writes its own conclusions into.
 *
 * Safety: Jarvis only overwrites notes it created itself (they carry `jarvis_auto: true` in their header). The owner's
 * own notes are read, never changed or deleted. Nothing is written outside the vault folder.
 */
export const AUTO_MARK = 'jarvis_auto: true';
const MAX_SEARCH_FILES = 3000;
const MAX_NOTE_CHARS = 60_000;

const fail = (message: string, status = 400) => { throw Object.assign(new Error(message), { status }); };

/** A file or folder name Windows and Obsidian accept. */
export function safeName(name: string) {
  const clean = String(name || '').replace(/[<>:"/\\|?*\u0000-\u001f#^[\]]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '');
  return clean.slice(0, 90) || 'Nomsiz';
}

export function defaultVault(companyId: string) {
  const company = db.findById('companies', companyId);
  return path.join(os.homedir(), 'Documents', 'Obsidian', `${safeName(company?.name || 'Biznes')} - Jarvis`);
}

/** Checks a vault folder the owner typed: absolute, not a drive root or a system folder. */
export function checkVaultPath(input: string) {
  const p = String(input || '').trim().replace(/^"|"$/g, '');
  if (!p) fail('Papka manzilini kiriting.');
  if (!path.isAbsolute(p)) fail('To‘liq manzil kiriting (masalan C:\\Users\\...\\Documents\\Obsidian\\Biznes).');
  const full = path.resolve(p);
  if (path.parse(full).root === full) fail('Diskning o‘zini emas, alohida papkani tanlang.');
  const low = full.toLowerCase();
  const blocked = [process.env.SystemRoot, process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.ProgramData].filter(Boolean).map(x => path.resolve(String(x)).toLowerCase());
  if (blocked.some(b => low === b || low.startsWith(b + path.sep))) fail('Tizim papkasiga yozib bo‘lmaydi. Hujjatlar ichidagi papkani tanlang.');
  return full;
}

/** A path inside the vault (never outside, always .md). */
export function inside(vault: string, rel: string) {
  let r = String(rel || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!r.toLowerCase().endsWith('.md')) r += '.md';
  const full = path.resolve(vault, r);
  if (!full.toLowerCase().startsWith(path.resolve(vault).toLowerCase() + path.sep)) fail('Vault tashqarisidagi fayl.');
  if (/[\\/]\.obsidian[\\/]/i.test(full)) fail('Obsidian sozlama papkasi.');
  return full;
}

const frontmatter = (fields: Record<string, string>) => ['---', ...Object.entries(fields).map(([k, v]) => `${k}: ${v}`), AUTO_MARK, '---', ''].join('\n');

/** Writes a note Jarvis owns; a note the owner wrote at that path is left as it is. Returns false when skipped. */
export function writeOwned(vault: string, rel: string, body: string, meta: Record<string, string> = {}) {
  const file = inside(vault, rel);
  if (fs.existsSync(file) && !fs.readFileSync(file, 'utf8').includes(AUTO_MARK)) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, frontmatter({ yangilandi: new Date().toISOString().slice(0, 16).replace('T', ' '), ...meta }) + body.trim() + '\n', 'utf8');
  fs.renameSync(tmp, file);
  return true;
}

// ---------------- reading the vault (Jarvis tools) ----------------
function* notes(dir: string, root = dir, depth = 0): Generator<string> {
  if (depth > 8) return;
  let entries: fs.Dirent[] = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue; // .obsidian, .trash, .git
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* notes(full, root, depth + 1);
    else if (e.name.toLowerCase().endsWith('.md')) yield full;
  }
}

export function searchVault(vault: string, query: string, limit = 10) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(w => w.length > 1).slice(0, 8);
  if (!words.length) fail('Qidiruv so‘zi kerak.');
  const hits: { note: string; score: number; snippet: string; mine: boolean }[] = [];
  let n = 0;
  for (const file of notes(vault)) {
    if (++n > MAX_SEARCH_FILES) break;
    let text = '';
    try { text = fs.readFileSync(file, 'utf8').slice(0, MAX_NOTE_CHARS); } catch { continue; }
    const rel = path.relative(vault, file).replace(/\\/g, '/');
    const low = text.toLowerCase();
    // A note with every word wins over one that repeats a single word; a word in the note's name counts extra.
    const matched = words.filter(w => low.includes(w) || rel.toLowerCase().includes(w)).length;
    const score = matched * 20 + words.reduce((s, w) => s + Math.min(10, low.split(w).length - 1) + (rel.toLowerCase().includes(w) ? 5 : 0), 0);
    if (!matched) continue;
    const first = words.map(w => low.indexOf(w)).filter(i => i >= 0).sort((a, b) => a - b)[0] ?? 0;
    const at = Math.max(0, first - 120);
    hits.push({ note: rel.replace(/\.md$/i, ''), score, snippet: text.slice(at, at + 320).replace(/\s+/g, ' ').trim(), mine: !text.includes(AUTO_MARK) });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, Math.min(20, limit));
}

export function readNote(vault: string, rel: string) {
  const file = inside(vault, rel);
  if (!fs.existsSync(file)) fail(`“${rel}” eslatmasi topilmadi.`);
  const text = fs.readFileSync(file, 'utf8');
  return { note: path.relative(vault, file).replace(/\\/g, '/').replace(/\.md$/i, ''), text: text.length > 14_000 ? `${text.slice(0, 14_000)}… (qisqartirildi)` : text, written_by: text.includes(AUTO_MARK) ? 'Jarvis' : 'egasi' };
}

/** Jarvis's own note (conclusions, plans, meeting results) in the Jarvis folder; append adds a dated section. */
export function writeJarvisNote(vault: string, title: string, content: string, append = false) {
  const body = String(content || '').trim();
  if (body.length < 3) fail('Eslatma matni bo‘sh.');
  if (body.length > 20_000) fail('Eslatma juda uzun (20 000 belgidan oshmasin).');
  const rel = `Jarvis/${safeName(title)}`;
  const file = inside(vault, rel);
  let text = body;
  if (append && fs.existsSync(file)) {
    const old = fs.readFileSync(file, 'utf8');
    if (!old.includes(AUTO_MARK)) fail('Bu eslatmani egasi yozgan — Jarvis uni o‘zgartirmaydi.');
    text = `${old.replace(/^---[\s\S]*?---\n/, '').trim()}\n\n## ${businessToday()}\n${body}`;
  }
  if (!writeOwned(vault, rel, text, { turi: 'jarvis-xulosa' })) fail('Shu nomli eslatmani egasi yozgan — boshqa nom tanlang.');
  return { saved: rel, append };
}

// ---------------- filling the vault from the books ----------------
const som = (n: number | null | undefined) => (n === null || n === undefined ? 'noma’lum' : `${Math.round(n).toLocaleString('ru-RU').replace(/,/g, ' ')} so‘m`);
const link = (rel: string, label?: string) => `[[${rel}${label ? `|${label}` : ''}]]`;

/** Runs a business tool for the vault; a section that fails says so instead of stopping the whole sync. */
function tool(ctx: JarvisContext, name: string, input: any = {}): any {
  try { return findTool(name)!.run(ctx, input); } catch (e: any) { return { error: e?.message || String(e) }; }
}

function ownerContext(companyId: string): JarvisContext {
  const roles = db.find('roles', r => r.company_id === companyId && ['SUPER_ADMIN', 'ADMIN'].includes(r.name)).map(r => r.id);
  const owner = db.find('user_roles', ur => roles.includes(ur.role_id)).map(ur => db.findById('users', ur.user_id)).find(u => u?.status === 'ACTIVE');
  return { companyId, userId: owner?.id || 'jarvis', email: owner?.email || 'jarvis@local' };
}

function agentNote(companyId: string, agent: any, today: string) {
  const from = today.slice(0, 8) + '01';
  const day = Number(today.slice(8, 10));
  const prevStart = addDays(from, -1).slice(0, 8) + '01';
  const prevSame = addDays(prevStart, day - 1);
  const orders = (f: string, t: string) => db.find('sales_orders', o => o.company_id === companyId && o.agent_id === agent.id && o.status === 'DELIVERED' && o.order_date >= f && o.order_date <= t);
  const cur = orders(from, today), prev = orders(prevStart, prevSame);
  const sum = (rows: any[]) => rows.reduce((s, o) => s + (o.net_sales || 0), 0);
  const debt = db.find('customers', c => c.company_id === companyId && c.agent_id === agent.id && (c.current_balance || 0) > 0);
  const change = sum(prev) ? Math.round((sum(cur) / sum(prev) - 1) * 100) : null;
  const st: any = db.findById('agent_strategies', `${companyId}|${agent.id}`);
  const lines = [
    `# ${agent.full_name}`, '',
    `Kodi: ${agent.code || '—'} · Telefon: ${agent.phone || '—'}`, '',
    '## Shu oy', '',
    `| Ko‘rsatkich | ${from.slice(5)}…${today.slice(5)} | O‘tgan oy shu kungacha |`, '|---|---|---|',
    `| Savdo | ${som(sum(cur))} | ${som(sum(prev))} |`,
    `| Buyurtmalar | ${cur.length} | ${prev.length} |`,
    `| Mijozlar | ${new Set(cur.map(o => o.customer_id)).size} | ${new Set(prev.map(o => o.customer_id)).size} |`, '',
    change === null ? '' : `O‘zgarish: **${change > 0 ? '+' : ''}${change}%**`, '',
    `Mijozlaridagi qarz: **${som(debt.reduce((s, c) => s + c.current_balance, 0))}** (${debt.length} ta mijoz) — ${link('Mijozlar/Qarzdorlar', 'qarzdorlar')}`, ''
  ];
  if (st?.strategy) {
    const s = st.strategy;
    lines.push(`## AI strategiyasi (${String(st.generated_at).slice(0, 10)})`, '', s.verdict ? `> ${s.verdict}` : '', '');
    if (s.score !== null && s.score !== undefined) lines.push(`Baho: ${s.score}/10`, '');
    if (s.actions?.length) lines.push('### Nima qilish kerak', ...s.actions.map((a: any) => `- [ ] **${a.title}** — ${a.how}${a.target ? ` (maqsad: ${a.target})` : ''}${a.deadline ? `, muddat: ${a.deadline}` : ''}`), '');
    if (s.problems?.length) lines.push('### Muammolar', ...s.problems.map((p: any) => `- ${p.title}: ${p.evidence}`), '');
    if (s.call_list?.length) lines.push('### Qo‘ng‘iroq ro‘yxati', ...s.call_list.map((c: any) => `- ${c.customer} — ${c.reason}${c.offer ? `; taklif: ${c.offer}` : ''}`), '');
  } else lines.push('AI strategiyasi hali tuzilmagan (Jarvis’ga AI kaliti ulangach avtomatik tuziladi).', '');
  lines.push('', `${link('Bosh sahifa', '← Bosh sahifa')} · ${link('Agentlar/Agentlar', 'barcha agentlar')}`);
  return { body: lines.filter(l => l !== undefined).join('\n'), sales: sum(cur), change };
}

/** Writes the business notes; returns how many were written and what was skipped. */
export function syncVault(companyId: string, vault: string) {
  fs.mkdirSync(vault, { recursive: true });
  const ctx = ownerContext(companyId);
  const today = businessToday();
  const company = db.findById('companies', companyId);
  let written = 0;
  const skipped: string[] = [];
  const put = (rel: string, body: string, meta: Record<string, string> = {}) => { if (writeOwned(vault, rel, body, meta)) written++; else skipped.push(rel); };

  // Agents: one note each (active, or sold in the last 60 days), plus the ranking.
  const recent = new Set(db.find('sales_orders', o => o.company_id === companyId && o.order_date >= addDays(today, -60)).map(o => o.agent_id));
  const agents = db.find('agents', a => a.company_id === companyId && (a.status === 'ACTIVE' || recent.has(a.id))).slice(0, 80);
  const rank: { name: string; sales: number; change: number | null }[] = [];
  for (const a of agents) {
    const n = agentNote(companyId, a, today);
    put(`Agentlar/${safeName(a.full_name)}`, n.body, { turi: 'agent', kod: safeName(a.code || '') });
    rank.push({ name: safeName(a.full_name), sales: n.sales, change: n.change });
  }
  rank.sort((a, b) => b.sales - a.sales);
  put('Agentlar/Agentlar', ['# Agentlar reytingi (shu oy)', '', '| # | Agent | Savdo | O‘tgan oyga |', '|---|---|---|---|',
    ...rank.map((r, i) => `| ${i + 1} | ${link(`Agentlar/${r.name}`, r.name)} | ${som(r.sales)} | ${r.change === null ? '—' : `${r.change > 0 ? '+' : ''}${r.change}%`} |`)].join('\n'), { turi: 'reyting' });

  // Debtors and customers that stopped buying.
  const aging = tool(ctx, 'debt_aging', { limit: 40 });
  put('Mijozlar/Qarzdorlar', aging.error ? `Hisoblanmadi: ${aging.error}` : ['# Qarzdorlar', '',
    `Jami qarz: **${som(aging.total_debt)}**, ${aging.debtors} ta mijoz. 90 kundan eski: **${som(aging.buckets?.d90_plus)}**.`, '',
    '| Mijoz | Agent | Qarz | 90+ kun | Eng eski (kun) | Telefon |', '|---|---|---|---|---|---|',
    ...(aging.top || []).map((r: any) => `| ${r.customer} (${r.code || '—'}) | ${r.agent ? link(`Agentlar/${safeName(r.agent)}`, r.agent) : '—'} | ${som(r.debt)} | ${som(r.over_90)} | ${r.oldest_days ?? '—'} | ${r.phone || '—'} |`)].join('\n'), { turi: 'qarzlar' });
  const stopped = tool(ctx, 'stopped_customers', { days: 21, limit: 40 });
  put('Mijozlar/Xaridni to‘xtatganlar', stopped.error ? `Hisoblanmadi: ${stopped.error}` : ['# 21 kundan beri xarid qilmagan doimiy mijozlar', '',
    `${stopped.count} ta mijoz. Agent bilan birga qo‘ng‘iroq rejasiga qo‘shing.`, '',
    '| Mijoz | Agent | Oxirgi buyurtma | Avvalgi 90 kun savdosi | Qarz | Telefon |', '|---|---|---|---|---|---|',
    ...(stopped.customers || []).map((c: any) => `| ${c.customer} | ${c.agent ? link(`Agentlar/${safeName(c.agent)}`, c.agent) : '—'} | ${c.last_order} | ${som(c.sales_90d_before)} | ${som(c.debt)} | ${c.phone || '—'} |`)].join('\n'), { turi: 'mijozlar' });

  // Stock.
  const stock = tool(ctx, 'stock_forecast', { limit: 30 });
  put('Ombor/Tovar holati', stock.error ? `Hisoblanmadi: ${stock.error}` : ['# Ombor holati', '', stock.history_note ? `> ${stock.history_note}` : '',
    '## Tugab qolayotgan va tugagan', '', '| Mahsulot | Qoldiq | Kunlik sotuv | Necha kunga | Buyurtma qilish |', '|---|---|---|---|---|',
    ...(stock.running_out || []).map((p: any) => `| ${p.product} | ${p.stock} | ${p.daily_sales} | ${p.days_left ?? '—'} | ${p.reorder_qty ?? '—'} |`), '',
    '## Ortiqcha zaxira', '', ...(stock.overstocked || []).map((p: any) => `- ${p.product}: ${p.stock} dona, ~${p.days_left} kunga yetadi`)].join('\n'), { turi: 'ombor' });

  // What the owner told Jarvis to remember.
  const memories = db.find('jarvis_memories', m => m.company_id === companyId).sort((a, b) => a.created_at.localeCompare(b.created_at));
  put('Jarvis/Xotira', ['# Jarvis xotirasi', '', 'Siz Jarvis’ga “eslab qol” degan qoidalar va faktlar. O‘zgartirish uchun Jarvis’ga ayting (“…ni unut”).', '',
    ...(memories.length ? memories.map(m => `- ${m.text} _(${m.created_at.slice(0, 10)})_`) : ['Hozircha bo‘sh.'])].join('\n'), { turi: 'xotira' });

  // Today's note: the numbers, warnings, overdue tasks and the morning briefing when there is one.
  const ov = tool(ctx, 'business_overview', { from: today.slice(0, 8) + '01', to: today });
  const day = tool(ctx, 'cash_day_summary', { date: today });
  const tasks = tool(ctx, 'crm_tasks', { due: 'overdue' });
  let insights: any[] = [];
  try { insights = computeInsights(companyId, true).filter(i => i.level !== 'info'); } catch { /* none */ }
  const briefing = db.find('jarvis_conversations', c => c.company_id === companyId && c.title === `Ertalabki brifing — ${today.split('-').reverse().join('.')}`)[0];
  // The briefing's answer: the last assistant text of today's briefing conversation.
  const briefText = (briefing?.messages || []).filter(msg => msg.role === 'assistant').map(msg => (typeof msg.content === 'string' ? msg.content : msg.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n')).trim()).filter(t => t.length > 40).pop() || '';
  put(`Kundalik/${today}`, [`# ${today.split('-').reverse().join('.')} — kun holati`, '',
    '## Raqamlar (oy boshidan)', '',
    ov.error ? `Hisoblanmadi: ${ov.error}` : [
      `- Sof tushum: **${som(ov.sales?.net_revenue)}** (yetkazilmagan: ${som(ov.sales?.pending_not_delivered)})`,
      `- Yalpi foyda: ${som(ov.profit?.gross_profit)}${ov.profit?.gross_margin_percent !== null && ov.profit?.gross_margin_percent !== undefined ? ` (${ov.profit.gross_margin_percent}%)` : ''} · Sof foyda: ${som(ov.profit?.net_profit)}`,
      `- Xarajatlar: ${som(ov.profit?.operating_expenses)} · Oylik: ${som(ov.profit?.payroll)}`,
      `- Debitorlik: **${som(ov.receivables?.total_debt)}** (${ov.receivables?.debtors ?? 0} ta mijoz) — ${link('Mijozlar/Qarzdorlar', 'qarzdorlar')}`,
      ov.profit?.note ? `- Izoh: ${ov.profit.note}` : ''
    ].filter(Boolean).join('\n'), '',
    '## Bugungi kassa', '',
    day.error ? `Hisoblanmadi: ${day.error}` : day.opened ? `Buyurtmalar: ${day.orders} · Savdo: ${som(day.sales)} · Naqd: ${som(day.cash)} · Nasiyadan kirim: ${som(day.debt_collected)} · Qarzga qoldi: ${som(day.left_as_debt)} · Xarajat: ${som(day.expenses)}` : 'Bugun kassa kuni ochilmagan.', '',
    '## Diqqat talab qiladi', '',
    ...(insights.length ? insights.slice(0, 10).map(i => `- ${i.level === 'critical' ? '🔴' : '🟠'} **${i.title}** — ${i.detail}`) : ['Ogohlantirish yo‘q.']), '',
    '## Muddati o‘tgan vazifalar', '',
    ...(Array.isArray(tasks) && tasks.length ? tasks.slice(0, 15).map((t: any) => `- [ ] ${t.title} — ${t.assignee || '—'}${t.customer ? `, ${t.customer}` : ''} (muddat ${t.due})`) : ['Yo‘q.']), '',
    ...(briefText ? ['## Ertalabki brifing (Jarvis)', '', briefText, ''] : []),
    `${link(`Kundalik/${addDays(today, -1)}`, '← kecha')} · ${link('Bosh sahifa')} · ${link('Agentlar/Agentlar', 'agentlar')} · ${link('Ombor/Tovar holati', 'ombor')}`
  ].join('\n'), { turi: 'kundalik', sana: today });

  put('Bosh sahifa', [`# ${company?.name || 'Biznes'} — Jarvis bilim bazasi`, '',
    'Bu vault’ni Jarvis Distro Pro ma’lumotlaridan o‘zi to‘ldirib boradi. `jarvis_auto: true` belgili eslatmalarni Jarvis yangilaydi —',
    'ularni tahrir qilmang (keyingi yangilanishda qayta yoziladi). O‘z eslatmalaringizni istalgan boshqa papkada yozing: Jarvis ularni o‘qiydi, lekin o‘zgartirmaydi.', '',
    `- Bugun: ${link(`Kundalik/${today}`)}`, `- ${link('Agentlar/Agentlar', 'Agentlar reytingi')}`, `- ${link('Mijozlar/Qarzdorlar')}`, `- ${link('Mijozlar/Xaridni to‘xtatganlar')}`,
    `- ${link('Ombor/Tovar holati')}`, `- ${link('Jarvis/Xotira', 'Jarvis xotirasi')}`, '- Jarvis xulosalari: `Jarvis/` papkasi'].join('\n'), { turi: 'bosh' });

  return { vault, written, skipped, at: new Date().toISOString() };
}
