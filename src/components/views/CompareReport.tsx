import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Download, RefreshCw, Users } from 'lucide-react';
import { api } from '../../services/api.ts';
import { localToday } from '../../utils/date';
import { AgentDetail } from './compare/AgentDetail.tsx';
import { TeamsEditor } from './compare/TeamsEditor.tsx';

type Period = { from: string; to: string };
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parse = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s: string, n: number) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
const lastDayOf = (y: number, m: number) => new Date(y, m + 1, 0).getDate();

/** Ready-made pairs. "Same days" pairs compare equal lengths so a half month is not judged against a full one. */
function preset(kind: string): { a: Period; b: Period } {
  const today = localToday();
  const t = parse(today);
  if (kind === 'month') {
    const bFrom = iso(new Date(t.getFullYear(), t.getMonth(), 1));
    const pm = new Date(t.getFullYear(), t.getMonth() - 1, 1);
    const aTo = iso(new Date(pm.getFullYear(), pm.getMonth(), Math.min(t.getDate(), lastDayOf(pm.getFullYear(), pm.getMonth()))));
    return { a: { from: iso(pm), to: aTo }, b: { from: bFrom, to: today } };
  }
  if (kind === 'full_month') {
    const last = new Date(t.getFullYear(), t.getMonth(), 0);
    const prev = new Date(t.getFullYear(), t.getMonth() - 1, 0);
    return { a: { from: iso(new Date(prev.getFullYear(), prev.getMonth(), 1)), to: iso(prev) }, b: { from: iso(new Date(last.getFullYear(), last.getMonth(), 1)), to: iso(last) } };
  }
  if (kind === 'week') {
    const dow = (t.getDay() + 6) % 7; // Monday = 0
    const bFrom = addDays(today, -dow);
    return { a: { from: addDays(bFrom, -7), to: addDays(today, -7) }, b: { from: bFrom, to: today } };
  }
  if (kind === 'd30') return { a: { from: addDays(today, -59), to: addDays(today, -30) }, b: { from: addDays(today, -29), to: today } };
  // same period last year
  const bFrom = iso(new Date(t.getFullYear(), t.getMonth(), 1));
  return { a: { from: iso(new Date(t.getFullYear() - 1, t.getMonth(), 1)), to: iso(new Date(t.getFullYear() - 1, t.getMonth(), Math.min(t.getDate(), lastDayOf(t.getFullYear() - 1, t.getMonth())))) }, b: { from: bFrom, to: today } };
}

const PRESETS: [string, string][] = [['month', 'Bu oy / o‘tgan oy (bir xil kunlar)'], ['full_month', 'O‘tgan oy / undan oldingi oy'], ['week', 'Bu hafta / o‘tgan hafta'], ['d30', 'Oxirgi 30 kun / oldingi 30 kun'], ['year', 'Bu oy / o‘tgan yilning shu oyi']];

const short = (p: Period) => `${p.from.slice(8, 10)}.${p.from.slice(5, 7)} — ${p.to.slice(8, 10)}.${p.to.slice(5, 7)}`;
const fmt = (v: number | null, unit: string) => v === null || v === undefined ? 'hisoblanmadi' : unit === 'percent' ? `${v}%` : Math.round(v).toLocaleString('uz-UZ');

/** Change cell: green when the change is good for the business, red when bad (a cost that grows is bad). */
const Change: React.FC<{ a: number | null; b: number | null; good: string; unit: string }> = ({ a, b, good, unit }) => {
  if (a === null || b === null) return <td className="px-3 py-2 text-center text-neutral-400">—</td>;
  const diff = b - a;
  const pct = a === 0 ? (b === 0 ? 0 : null) : Math.round((diff / Math.abs(a)) * 100);
  const better = good === 'neutral' || diff === 0 ? null : (good === 'up') === diff > 0;
  // A soft badge with an arrow: a whole red cell read like an error message.
  const cls = better === null ? 'bg-neutral-100 text-neutral-600' : better ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' : 'bg-rose-50 text-rose-700 ring-1 ring-rose-200';
  const arrow = diff > 0 ? '▲' : diff < 0 ? '▼' : '';
  const label = unit === 'percent' ? `${diff > 0 ? '+' : ''}${Math.round(diff * 10) / 10} p.p.` : pct === null ? 'yangi' : `${pct > 0 ? '+' : ''}${pct}%`;
  return (
    <>
      <td className={`px-3 py-2 text-right ${better === null ? 'text-neutral-600' : better ? 'text-emerald-700' : 'text-rose-700'}`}>{unit === 'percent' ? '' : `${diff > 0 ? '+' : ''}${Math.round(diff).toLocaleString('uz-UZ')}`}</td>
      <td className="px-3 py-2 text-center"><span className={`inline-flex min-w-[64px] justify-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${cls}`}>{arrow && <span className="text-[9px] leading-4">{arrow}</span>}{label}</span></td>
    </>
  );
};

export const CompareReport: React.FC = () => {
  const [kind, setKind] = useState('month');
  const initial = useMemo(() => preset('month'), []);
  const [a, setA] = useState<Period>(initial.a);
  const [b, setB] = useState<Period>(initial.b);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [agent, setAgent] = useState<string | null>(null);
  const [teamsOpen, setTeamsOpen] = useState(false);
  const [serverOptions, setServerOptions] = useState<any[]>([]);
  const [integrationId, setIntegrationId] = useState<string | null>(null);
  const requestSequence = useRef(0);

  useEffect(() => {
    let alive = true;
    let sourceRequest = 0;
    const loadServer = () => {
      const current = ++sourceRequest;
      setData(null);
      setError(null);
      setIntegrationId(null);
      Promise.all([api.getIntegrations().catch(() => ({ integrations: [] })), api.getActiveDistribution()]).then(([list, distribution]) => {
        if (!alive || current !== sourceRequest) return;
        const options = (list.integrations || []).filter((i: any) => !i.disabled);
        if (distribution.active && !options.some((i: any) => i.id === distribution.active!.id)) {
          options.push({ ...distribution.active, provider_name: distribution.active.provider, system_name: distribution.active.name, config: {} });
        }
        setServerOptions(options);
        if (distribution.active?.id) setIntegrationId(distribution.active.id);
        else setError('Faol server aniqlanmadi. Eski serverlar aralashib ketmasligi uchun “Barcha serverlar” ma’lumotlari avtomatik yuklanmadi.');
      }).catch((e: any) => {
        if (!alive || current !== sourceRequest) return;
        setError(e.message || 'Joriy serverni aniqlab bo‘lmadi. Server filtri aniqlanmaguncha ma’lumot yuklanmaydi.');
      });
    };
    loadServer();
    window.addEventListener('distribution:refresh', loadServer);
    return () => { alive = false; sourceRequest++; window.removeEventListener('distribution:refresh', loadServer); };
  }, []);

  const load = async (pa = a, pb = b, server = integrationId) => {
    if (server === null) return;
    const requestId = ++requestSequence.current;
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const result = await api.getCompareReport(pa, pb, server === 'all' ? null : server);
      if (requestId === requestSequence.current) setData(result);
    } catch (e: any) {
      if (requestId === requestSequence.current) setError(e.message);
    } finally {
      if (requestId === requestSequence.current) setLoading(false);
    }
  };
  useEffect(() => { if (integrationId !== null) load(a, b, integrationId); }, [integrationId]);
  const choose = (k: string) => { setKind(k); const p = preset(k); setA(p.a); setB(p.b); load(p.a, p.b); };

  // The territory column appears only when customers have territories at all.
  const hasTerritory = !!data?.customers?.declining?.some((c: any) => c.territory);
  const sections = data ?[...new Set<string>(data.lines.map((l: any) => l.section))] : [];

  /** The whole comparison as one workbook: indicators, agents, products and customers that bought less. */
  const exportExcel = async () => {
    if (!data) return;
    const d = (s: string) => s.split('-').reverse().join('.');
    const pa = `${d(data.periods.a.from)} — ${d(data.periods.a.to)}`;
    const pb = `${d(data.periods.b.from)} — ${d(data.periods.b.to)}`;
    const periodLine = `1-davr: ${pa} · 2-davr: ${pb}`;
    const change = (x: number | null, y: number | null) => (x === null || y === null || x === 0 ? null : (y - x) / Math.abs(x));
    const money = (h: string, key: string, total = false) => ({ header: h, key, type: 'money' as const, total });
    try {
      await api.downloadXlsx(`Solishtirish_${data.periods.b.from}_${data.periods.b.to}.xlsx`, [
        {
          name: 'Ko‘rsatkichlar',
          title: 'Davrlarni solishtirish',
          subtitle: [periodLine, ...(data.cogs_complete ? [] : ['Ayrim sotuvlar tannarxi noma’lum — foyda qatorlari bo‘sh'])],
          columns: [
            { header: 'Bo‘lim', key: 'section', width: 16 },
            { header: 'Ko‘rsatkich', key: 'label', width: 34 },
            { header: `1-davr\n${pa}`, key: 'a', type: 'number', width: 18 },
            { header: `2-davr\n${pb}`, key: 'b', type: 'number', width: 18 },
            { header: 'Farq', key: 'diff', type: 'number', width: 16 },
            { header: 'O‘zgarish', key: 'pct', type: 'percent', width: 11 }
          ],
          rows: data.lines.map((l: any) => ({
            section: l.section,
            label: `${l.indent ? '   ' : ''}${l.label}${l.unit === 'percent' ? ' (%)' : ''}`,
            a: l.a, b: l.b,
            diff: l.a === null || l.b === null ? null : Math.round((l.b - l.a) * 10) / 10,
            pct: l.unit === 'percent' ? null : change(l.a, l.b)
          }))
        },
        {
          name: 'Agentlar',
          title: 'Agentlar bo‘yicha savdo',
          subtitle: [periodLine, 'Savdo — bekor qilinmagan barcha buyurtmalar (yetkazilgan + hali yo‘lda)'],
          columns: [
            { header: 'Agent', key: 'name', width: 28 }, money('Savdo 1', 'sales_a', true), money('Savdo 2', 'sales_b', true), money('Farq', 'diff', true),
            money('Shundan yo‘lda 1', 'pending_a', true), money('Shundan yo‘lda 2', 'pending_b', true),
            { header: 'O‘zgarish', key: 'pct', type: 'percent', width: 11 },
            { header: 'Buyurtma 1', key: 'orders_a', type: 'number', total: true, width: 11 }, { header: 'Buyurtma 2', key: 'orders_b', type: 'number', total: true, width: 11 },
            { header: 'Mijoz 1', key: 'customers_a', type: 'number', width: 9 }, { header: 'Mijoz 2', key: 'customers_b', type: 'number', width: 9 }
          ],
          rows: data.agents.map((r: any) => ({ ...r, diff: (r.sales_b || 0) - (r.sales_a || 0), pct: change(r.sales_a, r.sales_b) })),
          totalsLabel: 'JAMI'
        },
        ...(data.agent_teams?.length ? [{
          name: 'Komandalar',
          title: 'Agent profillari komandalar bo‘yicha (mahsulot kategoriyalari)',
          subtitle: [periodLine],
          columns: [
            { header: 'Agent profili', key: 'agent', width: 28 }, { header: 'Komanda', key: 'team_name', width: 18 }, { header: 'Odam', key: 'person', width: 18 },
            money('Savdo 1', 'sales_a', true), money('Savdo 2', 'sales_b', true), money('Farq', 'diff', true), { header: 'O‘zgarish', key: 'pct', type: 'percent' as const, width: 11 },
            { header: 'Buyurtma 1', key: 'orders_a', type: 'number' as const }, { header: 'Buyurtma 2', key: 'orders_b', type: 'number' as const }
          ],
          rows: data.agent_teams.map((t: any) => ({ ...t, agent: data.agents.find((a: any) => a.agent_id === t.agent_id)?.name || t.agent_id, diff: t.sales_b - t.sales_a, pct: change(t.sales_a, t.sales_b) })),
          totalsLabel: 'JAMI'
        }] : []),
        {
          name: 'Mahsulotlar',
          title: 'Eng ko‘p o‘sgan va tushgan mahsulotlar',
          subtitle: [periodLine],
          columns: [
            { header: 'Yo‘nalish', key: 'dir', width: 11 }, { header: 'Mahsulot', key: 'name', width: 34 },
            { header: 'Miqdor 1', key: 'qty_a', type: 'number', width: 11 }, { header: 'Miqdor 2', key: 'qty_b', type: 'number', width: 11 },
            money('Savdo 1', 'sales_a'), money('Savdo 2', 'sales_b'), money('Farq', 'diff')
          ],
          rows: [...data.products.gainers.map((p: any) => ({ ...p, dir: 'O‘sgan' })), ...data.products.losers.map((p: any) => ({ ...p, dir: 'Tushgan' }))]
        },
        {
          name: 'Kamaygan mijozlar',
          title: 'Xaridi kamaygan mijozlar',
          subtitle: [periodLine, `${data.customers.stopped} ta mijoz 2-davrda umuman xarid qilmagan`],
          columns: [
            { header: 'Mijoz', key: 'name', width: 32 }, { header: 'Telefon', key: 'phone', width: 15 },
            { header: 'Agent', key: 'agent_name', width: 26 }, { header: 'Hudud', key: 'territory', width: 18 },
            { header: 'Buyurtma 1', key: 'orders_a', type: 'number', width: 11 }, { header: 'Buyurtma 2', key: 'orders_b', type: 'number', width: 11 },
            money('Savdo 1', 'sales_a', true), money('Savdo 2', 'sales_b', true), money('Farq', 'diff', true), money('Joriy qarz', 'debt', true)
          ],
          rows: data.customers.declining,
          totalsLabel: 'JAMI'
        }
      ]);
    } catch (e: any) {
      setError(e.message || 'Excel faylini yuklab bo‘lmadi');
    }
  };
  const input = 'rounded-lg border border-neutral-300 px-2 py-1 text-xs';
  const th = 'px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-neutral-500';
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-xs">
        <div className="mb-3 flex flex-wrap gap-1.5">
          {PRESETS.map(([k, label]) => <button key={k} onClick={() => choose(k)} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${kind === k ? 'bg-neutral-900 text-white' : 'bg-neutral-100 hover:bg-neutral-200'}`}>{label}</button>)}
        </div>
        <div className="flex flex-wrap items-end gap-4 text-xs">
          <div><p className="mb-1 font-bold text-neutral-600">Server</p><select aria-label="Taqqoslash serveri" className={input} value={integrationId ?? ''} disabled={integrationId === null} onChange={e => { setData(null); setError(null); setIntegrationId(e.target.value); }}>
            {integrationId === null && <option value="">Yuklanmoqda…</option>}
            <option value="all">Barcha serverlar</option>
            {serverOptions.map((i: any) => <option key={i.id} value={i.id}>{i.config?.connection_name || i.system_name || i.provider_name}</option>)}
          </select></div>
          <div><p className="mb-1 font-bold text-neutral-600">Birinchi davr (asos)</p><input type="date" className={input} value={a.from} onChange={e => { setKind('custom'); setA({ ...a, from: e.target.value }); }} /> — <input type="date" className={input} value={a.to} onChange={e => { setKind('custom'); setA({ ...a, to: e.target.value }); }} /></div>
          <div><p className="mb-1 font-bold text-neutral-600">Ikkinchi davr (solishtiriladi)</p><input type="date" className={input} value={b.from} onChange={e => { setKind('custom'); setB({ ...b, from: e.target.value }); }} /> — <input type="date" className={input} value={b.to} onChange={e => { setKind('custom'); setB({ ...b, to: e.target.value }); }} /></div>
          <button onClick={() => load()} className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 font-semibold text-white hover:bg-emerald-700"><RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />Solishtirish</button>
          {data && <button onClick={exportExcel} className="inline-flex items-center gap-1 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 font-semibold text-neutral-700 hover:bg-neutral-50"><Download className="h-3.5 w-3.5" />Excel yuklab olish</button>}
        </div>
        {data && data.days.a !== data.days.b && <p className="mt-2 text-[11px] text-amber-700">Davrlar uzunligi har xil ({data.days.a} va {data.days.b} kun) — summalarni solishtirishda buni hisobga oling.</p>}
        {data?.pending?.b?.count > 0 && <p className="mt-1 text-[11px] text-amber-700">2-davrda {data.pending.b.count} ta buyurtma ({fmt(data.pending.b.sum, 'money')} so‘m) distribyutor tizimida hali “yetkazildi” deb yopilmagan. “Yalpi savdo (yetkazilgan)” qatoriga ular kirmaydi; agentlar, mijozlar va mahsulotlar esa ularni hisobga oladi.</p>}
        {data && !data.cogs_complete && <p className="mt-1 text-[11px] text-amber-700">Ayrim sotuvlarning tannarxi noma’lum, shuning uchun foyda qatorlari “hisoblanmadi”. Mahsulotlarga kirim narxini kiriting.</p>}
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</div>}
      {/* The periods of the loaded table, not the date inputs being edited. */}
      {agent && data && <AgentDetail agentId={agent} a={data.periods.a} b={data.periods.b} integrationId={integrationId === 'all' ? null : integrationId} onClose={() => setAgent(null)} />}
      {teamsOpen && <TeamsEditor onClose={() => setTeamsOpen(false)} onSaved={() => load()} />}

      {data && (
        <>
          <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white shadow-xs">
            <table className="min-w-full text-xs">
              <thead className="bg-neutral-50"><tr>
                <th className={`${th} text-left`}>Ko‘rsatkich</th>
                <th className={`${th} text-right`}>Birinchi davr<br /><span className="font-normal normal-case">{data.periods.a.from} — {data.periods.a.to}</span></th>
                <th className={`${th} text-right`}>Ikkinchi davr<br /><span className="font-normal normal-case">{data.periods.b.from} — {data.periods.b.to}</span></th>
                <th className={`${th} text-right`}>Farq</th>
                <th className={`${th} text-center`}>O‘zgarish</th>
              </tr></thead>
              <tbody className="divide-y divide-neutral-100">
                {sections.map(section => (
                  <React.Fragment key={section}>
                    <tr className="bg-neutral-100/70"><td colSpan={5} className="px-3 py-1.5 text-[11px] font-black uppercase tracking-wider text-neutral-700">{section}</td></tr>
                    {data.lines.filter((l: any) => l.section === section).map((l: any) => (
                      <tr key={l.key} className="hover:bg-neutral-50">
                        <td className={`px-3 py-2 ${l.indent ? 'pl-8 text-neutral-600' : 'font-semibold text-neutral-900'}`}>{l.label}</td>
                        <td className="px-3 py-2 text-right">{fmt(l.a, l.unit)}</td>
                        <td className="px-3 py-2 text-right font-semibold">{fmt(l.b, l.unit)}</td>
                        <Change a={l.a} b={l.b} good={l.good} unit={l.unit} />
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>

          <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3">
              <h3 className="text-sm font-bold">Agentlar bo‘yicha</h3>
              <button onClick={() => setTeamsOpen(true)} className="inline-flex items-center gap-1 rounded-lg border border-neutral-300 px-2.5 py-1 text-xs font-semibold hover:bg-neutral-50"><Users className="h-3.5 w-3.5" />Komandalar{data.agent_teams?.length ? '' : ' (sozlash)'}</button>
            </div>
            <p className="px-4 text-[11px] text-neutral-500">Savdo — bekor qilinmagan barcha buyurtmalar (yetkazilgan + hali yo‘lda). Yo‘ldagi qismi summa ostida kulrang yozilgan. {data.agent_teams?.length ? 'Agent ostidagi qatorlar — komandalar (mahsulot kategoriyalari bo‘yicha). ' : ''}<b>Agentni bosing — batafsil ma’lumot ochiladi.</b></p>
            <table className="min-w-full text-xs">
              <thead><tr>
                <th className={`${th} text-left`}>Agent</th>
                <th className={`${th} text-right`}>1-davr<br /><span className="font-normal normal-case">{short(data.periods.a)}</span></th>
                <th className={`${th} text-right`}>2-davr<br /><span className="font-normal normal-case">{short(data.periods.b)}</span></th>
                <th className={`${th} text-right`}>Farq</th><th className={`${th} text-center`}>O‘zgarish</th>
                <th className={`${th} text-right`}>Buyurtma 1 → 2</th><th className={`${th} text-right`}>Mijoz 1 → 2</th>
              </tr></thead>
              <tbody className="divide-y divide-neutral-100">
                {data.agents.map((r: any) => (
                  <React.Fragment key={r.agent_id}>
                    <tr onClick={() => setAgent(r.agent_id)} className="cursor-pointer hover:bg-emerald-50/50" title="Batafsil ko‘rish">
                      <td className="px-3 py-2 font-semibold text-emerald-800 underline decoration-dotted underline-offset-2">{r.name}</td>
                      <td className="px-3 py-2 text-right">{fmt(r.sales_a, 'money')}{r.pending_a > 0 && <div className="text-[10px] text-neutral-400">yo‘lda {fmt(r.pending_a, 'money')}</div>}</td>
                      <td className="px-3 py-2 text-right font-semibold">{fmt(r.sales_b, 'money')}{r.pending_b > 0 && <div className="text-[10px] font-normal text-neutral-400">yo‘lda {fmt(r.pending_b, 'money')}</div>}</td>
                      <Change a={r.sales_a} b={r.sales_b} good="up" unit="money" />
                      <td className="px-3 py-2 text-right">{r.orders_a} → {r.orders_b}</td><td className="px-3 py-2 text-right">{r.customers_a} → {r.customers_b}</td>
                    </tr>
                    {/* The people sharing this agent profile: their teams' categories. */}
                    {(data.agent_teams || []).filter((t: any) => t.agent_id === r.agent_id).map((t: any) => (
                      <tr key={`${r.agent_id}|${t.team_id}`} className="bg-neutral-50/60 text-neutral-700">
                        <td className="py-1.5 pl-8 pr-3">↳ {t.team_name}{t.person && <span className="font-semibold text-neutral-900"> · {t.person}</span>}</td>
                        <td className="px-3 py-1.5 text-right">{fmt(t.sales_a, 'money')}</td>
                        <td className="px-3 py-1.5 text-right font-semibold">{fmt(t.sales_b, 'money')}</td>
                        <Change a={t.sales_a} b={t.sales_b} good="up" unit="money" />
                        <td className="px-3 py-1.5 text-right">{t.orders_a} → {t.orders_b}</td><td className="px-3 py-1.5 text-right">{t.customers_a} → {t.customers_b}</td>
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {([['gainers', 'Eng ko‘p o‘sgan mahsulotlar'], ['losers', 'Eng ko‘p tushgan mahsulotlar']] as const).map(([k, title]) => (
              <div key={k} className="rounded-xl border border-neutral-200 bg-white p-3 shadow-xs">
                <h3 className="mb-1 text-sm font-bold">{title}</h3>
                <table className="min-w-full text-xs"><tbody className="divide-y divide-neutral-100">
                  {data.products[k].map((p: any) => <tr key={p.sku}><td className="py-1.5">{p.name}<div className="text-[10px] text-neutral-400">{Math.round(p.qty_a)} → {Math.round(p.qty_b)} dona</div></td><td className="py-1.5 text-right">{fmt(p.sales_a, 'money')} → <b>{fmt(p.sales_b, 'money')}</b></td><td className={`py-1.5 pl-2 text-right font-bold ${p.diff > 0 ? 'text-emerald-600' : 'text-red-600'}`}>{p.diff > 0 ? '+' : ''}{fmt(p.diff, 'money')}</td></tr>)}
                  {!data.products[k].length && <tr><td className="py-2 text-neutral-400">Yo‘q</td></tr>}
                </tbody></table>
              </div>
            ))}
          </div>

          <div className="rounded-xl border border-neutral-200 bg-white p-3 shadow-xs">
            <h3 className="text-sm font-bold">Xaridi kamaygan mijozlar</h3>
            <p className="mb-2 text-[11px] text-neutral-500">Birinchi davrda xarid qilib, ikkinchi davrda kamroq olgan mijozlar. {data.customers.stopped} tasi umuman xarid qilmagan — ularga qo‘ng‘iroq qilish uchun CRM’da vazifa bering.</p>
            <table className="min-w-full text-xs">
              <thead><tr><th className={`${th} text-left`}>Mijoz</th><th className={`${th} text-left`}>Agent</th>{hasTerritory && <th className={`${th} text-left`}>Hudud</th>}<th className={`${th} text-right`}>Savdo 1</th><th className={`${th} text-right`}>Savdo 2</th><th className={`${th} text-right`}>Farq</th><th className={`${th} text-right`}>Qarz</th></tr></thead>
              <tbody className="divide-y divide-neutral-100">
                {data.customers.declining.map((c: any) => <tr key={c.customer_id}><td className="px-3 py-1.5">{c.name}<div className="text-[10px] text-neutral-400">{[c.phone, `buyurtma ${c.orders_a} → ${c.orders_b}`].filter(Boolean).join(' · ')}</div></td><td className="px-3 py-1.5 text-neutral-700">{c.agent_name || <span className="text-neutral-300">—</span>}</td>{hasTerritory && <td className="px-3 py-1.5 text-neutral-700">{c.territory || <span className="text-neutral-300">—</span>}</td>}<td className="px-3 py-1.5 text-right">{fmt(c.sales_a, 'money')}</td><td className="px-3 py-1.5 text-right">{fmt(c.sales_b, 'money')}</td><td className="px-3 py-1.5 text-right font-bold text-red-600">{fmt(c.diff, 'money')}</td><td className="px-3 py-1.5 text-right">{fmt(c.debt, 'money')}</td></tr>)}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
};
