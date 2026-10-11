import React, { useEffect, useMemo, useState } from 'react';
import { Download, Phone, RefreshCw, X } from 'lucide-react';
import { api } from '../../../services/api.ts';
import { localToday } from '../../../utils/date';
import { AgentStrategy } from './AgentStrategy.tsx';

type Period = { from: string; to: string };
// Two series, validated for colour-blind separation and contrast (light and dark surfaces).
const COLOR_A = '#8b5cf6';
const COLOR_B = '#0d9488';
const money = (v: number | null | undefined) => v === null || v === undefined ? '—' : Math.round(v).toLocaleString('uz-UZ');
const mln = (v: number) => Math.abs(v) >= 1_000_000 ? `${(v / 1_000_000).toFixed(1).replace('.0', '')} mln` : money(v);
const dm = (s: string) => `${s.slice(8, 10)}.${s.slice(5, 7)}`;
const span = (p: Period) => `${dm(p.from)} — ${dm(p.to)}`;

/** Change in percent; null when there is no base to compare with. */
function change(a: number, b: number) {
  if (!a) return b ? null : 0;
  return Math.round(((b - a) / Math.abs(a)) * 100);
}

/**
 * The change badge. good: 'up' (growth is good), 'down' (growth is bad), 'neutral' (depends on timing, e.g. delivered
 * orders of a period that has just ended): neutral changes are shown in gray, never as an alarm.
 */
const Delta: React.FC<{ a: number; b: number; good: 'up' | 'down' | 'neutral' }> = ({ a, b, good }) => {
  if (a === b) return <span className="text-[11px] text-neutral-400">o‘zgarmagan</span>;
  const pct = change(a, b);
  const text = `${b > a ? '▲' : '▼'} ${pct === null ? 'yangi' : `${pct > 0 ? '+' : ''}${pct}%`}`;
  if (good === 'neutral') return <span className="inline-flex rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-semibold text-neutral-600">{text}</span>;
  const better = (good === 'up') === b > a;
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold ring-1 ${better ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-rose-50 text-rose-700 ring-rose-200'}`}>{text}</span>;
};

type Row = { label: string; hint?: string; a: number; b: number; good: 'up' | 'down' | 'neutral'; money?: boolean; only?: boolean }; // only: a count of period 2, nothing to compare

/** Sales by day of both periods: the n-th day of each side by side; weeks when the periods are long. */
const DailyChart: React.FC<{ daily: any[] }> = ({ daily }) => {
  const [hover, setHover] = useState<number | null>(null);
  const weekly = daily.length > 45;
  const buckets = useMemo(() => {
    if (!weekly) return daily;
    const out: any[] = [];
    for (let i = 0; i < daily.length; i += 7) {
      const part = daily.slice(i, i + 7);
      const sum = (k: 'a' | 'b') => part.some(p => p[k] !== null) ? part.reduce((s, p) => s + (p[k] || 0), 0) : null;
      out.push({ a: sum('a'), b: sum('b'), a_date: part[0].a_date, b_date: part[0].b_date, a_to: part[part.length - 1].a_date, b_to: part[part.length - 1].b_date });
    }
    return out;
  }, [daily, weekly]);
  const today = localToday();
  const max = Math.max(1, ...buckets.flatMap(d => [d.a || 0, d.b || 0]));
  const W = 720, H = 200, padL = 8, padB = 34, plotH = H - padB - 8;
  const slot = (W - padL) / buckets.length;
  const bar = Math.max(2, Math.min(18, (slot - 8) / 2));
  const y = (v: number) => 8 + plotH - (v / max) * plotH;
  const labelEvery = Math.ceil(buckets.length / 10);
  const h = hover !== null ? buckets[hover] : null;
  const range = (from: string | null, to?: string | null) => from ? `${dm(from)}${weekly && to ? `–${dm(to)}` : ''}` : '—';
  return (
    <div className="relative">
      <div className="mb-1 flex flex-wrap items-center gap-4 text-[11px] text-neutral-600">
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: COLOR_A }} />1-davr</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: COLOR_B }} />2-davr</span>
        <span className="text-neutral-400">{weekly ? 'har ustun — 1 hafta' : 'har juftlik — davrlarning bir xil kuni'} · ustiga olib boring</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-48 w-full" onMouseLeave={() => setHover(null)} role="img" aria-label="Kunlik savdo, ikki davr">
        {[0.5, 1].map(f => <line key={f} x1={padL} x2={W} y1={y(max * f)} y2={y(max * f)} stroke="currentColor" className="text-neutral-200" strokeDasharray="3 3" />)}
        <line x1={padL} x2={W} y1={8 + plotH} y2={8 + plotH} stroke="currentColor" className="text-neutral-300" />
        {buckets.map((d, i) => {
          const x = padL + i * slot + (slot - (bar * 2 + 2)) / 2;
          const bars: [number | null, string, number][] = [[d.a, COLOR_A, x], [d.b, COLOR_B, x + bar + 2]];
          return (
            <g key={i} onMouseEnter={() => setHover(i)}>
              <rect x={padL + i * slot} y={0} width={slot} height={H - padB} fill={hover === i ? 'rgba(0,0,0,0.04)' : 'transparent'} />
              {bars.map(([v, color, bx], k) => v ? <path key={k} fill={color} d={`M${bx},${8 + plotH} V${y(v) + 3} a3,3 0 0 1 3,-3 h${Math.max(0, bar - 6)} a3,3 0 0 1 3,3 V${8 + plotH} Z`} /> : null)}
              {/* A day of period 2 that has not come yet is marked, so an empty place is not read as "no sales". */}
              {!weekly && d.b_date && d.b_date > today && <text x={x + bar + 2 + bar / 2} y={8 + plotH - 4} textAnchor="middle" fontSize="9" className="fill-neutral-300">…</text>}
              {i % labelEvery === 0 && (
                <>
                  <text x={padL + i * slot + slot / 2} y={H - 20} textAnchor="middle" fontSize="10" fill={COLOR_A}>{d.a_date ? dm(d.a_date) : ''}</text>
                  <text x={padL + i * slot + slot / 2} y={H - 7} textAnchor="middle" fontSize="10" fill={COLOR_B}>{d.b_date ? dm(d.b_date) : ''}</text>
                </>
              )}
            </g>
          );
        })}
      </svg>
      {h && (
        <div className="pointer-events-none absolute top-6 z-10 min-w-[170px] rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-[11px] shadow-lg" style={{ left: `${Math.min(75, ((hover! + 0.5) / buckets.length) * 100)}%` }}>
          <div className="flex items-center justify-between gap-3"><span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: COLOR_A }} />{range(h.a_date, h.a_to)}</span><b>{money(h.a)}</b></div>
          <div className="flex items-center justify-between gap-3"><span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: COLOR_B }} />{range(h.b_date, h.b_to)}</span><b>{h.b_date && h.b_date > today ? 'hali kelmagan' : money(h.b)}</b></div>
          {h.a !== null && h.b !== null && <div className="mt-0.5 text-right"><Delta a={h.a || 0} b={h.b || 0} good="up" /></div>}
        </div>
      )}
    </div>
  );
};

const CUSTOMER_TABS: [string, string][] = [['stopped', 'Xarid qilmay qo‘ygan'], ['declining', 'Kamroq olgan'], ['started', 'Yangi / qaytgan'], ['growing', 'Ko‘proq olgan']];

/** One agent of the period comparison in depth, opened by clicking the agent's row. */
/**
 * embedded: shown inside a page (the agent's own cabinet) instead of a window; data and strategy then come from the
 * caller, and the strategy is read-only (it is kept up to date automatically).
 */
export const AgentDetail: React.FC<{ agentId: string; a: Period; b: Period; onClose?: () => void; embedded?: boolean; data?: any; strategy?: any }> = ({ agentId, a, b, onClose = () => {}, embedded = false, data, strategy }) => {
  const [d, setD] = useState<any>(data || null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState('stopped');
  useEffect(() => {
    if (data) { setD(data); return; }
    setD(null); setError(null);
    api.getCompareAgent(agentId, a, b).then(setD).catch(e => setError(e.message));
  }, [agentId, a.from, a.to, b.from, b.to, data]);
  useEffect(() => {
    if (embedded) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose, embedded]);

  // The comparison, grouped: what was sold, how, to whom, and what was lost on the way.
  const sections: [string, Row[]][] = d ? (() => {
    const A = d.totals.a, B = d.totals.b;
    return [
      ['Savdo', [
        { label: 'Savdo (jami)', hint: 'bekor qilinmagan barcha buyurtmalar', a: A.sales, b: B.sales, good: 'up', money: true },
        { label: 'Kunlik o‘rtacha savdo', a: A.per_day, b: B.per_day, good: 'up', money: true },
        { label: 'O‘rtacha buyurtma summasi', a: A.avg_order, b: B.avg_order, good: 'up', money: true },
        { label: 'shundan yetkazilgan', hint: 'yangi buyurtmalar bir necha kundan keyin yetkaziladi', a: A.delivered, b: B.delivered, good: 'neutral', money: true },
        { label: 'shundan hali yo‘lda', a: A.pending, b: B.pending, good: 'neutral', money: true }
      ]],
      ['Buyurtmalar', [
        { label: 'Buyurtmalar soni', a: A.orders, b: B.orders, good: 'up' },
        { label: 'Savdo bo‘lgan kunlar', a: A.active_days, b: B.active_days, good: 'neutral' },
        { label: 'Bekor qilingan buyurtmalar', a: A.cancelled_count, b: B.cancelled_count, good: 'down' }
      ]],
      ['Mijozlar', [
        { label: 'Xarid qilgan mijozlar', a: A.customers, b: B.customers, good: 'up' },
        { label: 'Yangi mijozlar (birinchi xarid)', a: A.new_customers, b: B.new_customers, good: 'up' },
        { label: 'Xarid qilmay qo‘ygan mijozlar', hint: '1-davrda olgan, 2-davrda olmagan', a: 0, b: d.customers.counts.stopped, good: 'down', only: true }
      ]],
      ['Mahsulot', [
        { label: 'Sotilgan miqdor', a: A.qty, b: B.qty, good: 'up' },
        { label: 'Mahsulot turlari', a: d.products.count_a, b: d.products.count_b, good: 'up' }
      ]],
      ['Yo‘qotishlar', [
        { label: 'Qaytarishlar', a: A.returns, b: B.returns, good: 'down', money: true },
        { label: 'Chegirmalar', a: A.discounts, b: B.discounts, good: 'down', money: true }
      ]]
    ];
  })() : [];

  // One-line conclusion in words, so the main point is read first.
  const summary = useMemo(() => {
    if (!d) return [];
    const A = d.totals.a, B = d.totals.b;
    const pct = change(A.sales, B.sales);
    const out: { text: string; tone: 'good' | 'bad' | 'info' }[] = [];
    out.push({ text: `Savdo ${mln(A.sales)} → ${mln(B.sales)} so‘m (${pct === null ? 'yangi' : `${pct > 0 ? '+' : ''}${pct}%`})`, tone: B.sales >= A.sales ? 'good' : 'bad' });
    out.push({ text: `buyurtmalar ${A.orders} → ${B.orders}, mijozlar ${A.customers} → ${B.customers}`, tone: B.orders >= A.orders ? 'good' : 'bad' });
    if (d.customers.counts.stopped) out.push({ text: `${d.customers.counts.stopped} ta mijoz xarid qilmay qo‘ygan`, tone: 'bad' });
    if (B.pending > 0) out.push({ text: `2-davrdan ${mln(B.pending)} so‘m hali yetkazilmagan`, tone: 'info' });
    if (d.periods.b.to >= localToday()) out.push({ text: '2-davr hali tugamagan (bugun ham kiradi)', tone: 'info' });
    return out;
  }, [d]);

  const exportExcel = async () => {
    if (!d) return;
    const line = `1-davr: ${span(d.periods.a)} · 2-davr: ${span(d.periods.b)}`;
    const m = (header: string, key: string, total = false) => ({ header, key, type: 'money' as const, total });
    const custCols = [{ header: 'Mijoz', key: 'name', width: 30 }, { header: 'Telefon', key: 'phone', width: 15 }, { header: 'Manzil', key: 'address', width: 28 }, m('Savdo 1', 'sales_a', true), m('Savdo 2', 'sales_b', true), m('Farq', 'diff', true), { header: 'Buyurtma 1', key: 'orders_a', type: 'number' as const }, { header: 'Buyurtma 2', key: 'orders_b', type: 'number' as const }, { header: 'Oxirgi buyurtma', key: 'last_order', type: 'date' as const }, m('Qarzi', 'debt', true)];
    try {
      await api.downloadXlsx(`Agent_${d.agent.name.replace(/[^\p{L}\p{N}]+/gu, '_').slice(0, 30)}_${d.periods.b.from}.xlsx`, [
        { name: 'Solishtirma', title: `${d.agent.name} — davrlarni solishtirish`, subtitle: [line, summary.map(s => s.text).join(' · ')],
          columns: [{ header: 'Bo‘lim', key: 'section', width: 14 }, { header: 'Ko‘rsatkich', key: 'label', width: 32 }, { header: `1-davr ${span(d.periods.a)}`, key: 'a', type: 'number', width: 18 }, { header: `2-davr ${span(d.periods.b)}`, key: 'b', type: 'number', width: 18 }, { header: 'Farq', key: 'diff', type: 'number', width: 16 }, { header: 'O‘zgarish', key: 'pct', type: 'percent', width: 11 }],
          rows: sections.flatMap(([section, rows]) => rows.map(r => ({ section, label: r.label, a: r.a, b: r.b, diff: r.b - r.a, pct: r.a ? (r.b - r.a) / Math.abs(r.a) : null }))) },
        { name: 'Kunlar', title: 'Kunlik savdo', subtitle: [line], columns: [{ header: '1-davr sana', key: 'a_date', type: 'date' }, m('1-davr savdo', 'a', true), { header: '2-davr sana', key: 'b_date', type: 'date' }, m('2-davr savdo', 'b', true)], rows: d.daily, totalsLabel: 'JAMI' },
        { name: 'Kategoriyalar', title: 'Kategoriyalar bo‘yicha', subtitle: [line], columns: [{ header: 'Kategoriya', key: 'name', width: 28 }, m('1-davr', 'sales_a', true), m('2-davr', 'sales_b', true), m('Farq', 'diff', true)], rows: d.categories, totalsLabel: 'JAMI' },
        { name: 'Mahsulotlar', title: 'Eng ko‘p o‘sgan va tushgan mahsulotlar', subtitle: [line], columns: [{ header: 'Yo‘nalish', key: 'dir', width: 10 }, { header: 'Mahsulot', key: 'name', width: 32 }, { header: 'Kategoriya', key: 'category', width: 18 }, { header: 'Miqdor 1', key: 'qty_a', type: 'number' }, { header: 'Miqdor 2', key: 'qty_b', type: 'number' }, m('Savdo 1', 'sales_a'), m('Savdo 2', 'sales_b'), m('Farq', 'diff')],
          rows: [...d.products.gainers.map((p: any) => ({ ...p, dir: 'O‘sgan' })), ...d.products.losers.map((p: any) => ({ ...p, dir: 'Tushgan' }))] },
        ...CUSTOMER_TABS.map(([k, label]) => ({ name: label.slice(0, 31), title: `Mijozlar: ${label}`, subtitle: [line], columns: custCols, rows: d.customers[k], totalsLabel: 'JAMI' }))
      ]);
    } catch (e: any) { setError(e.message || 'Excel faylini yuklab bo‘lmadi'); }
  };

  const th = 'px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-neutral-500';
  const colA = <span style={{ color: COLOR_A }}>1-davr</span>;
  const colB = <span style={{ color: COLOR_B }}>2-davr</span>;
  const customers = d ? d.customers[tab] || [] : [];
  return (
    <div className={embedded ? '' : 'fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-2 sm:p-6'} onClick={embedded ? undefined : onClose}>
      <div className={embedded ? 'space-y-4' : 'w-full max-w-5xl space-y-4 rounded-2xl bg-neutral-50 p-4 shadow-2xl sm:p-5'} onClick={e => e.stopPropagation()}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-base font-bold text-neutral-900">{embedded ? 'Mening natijalarim' : d?.agent.name || 'Agent'}</h2>
            <p className="text-[11px] text-neutral-500">
              {d?.agent.code && <>Kod {d.agent.code} · </>}
              {d?.agent.phone && <><Phone className="inline h-3 w-3" /> {d.agent.phone} · </>}
              <span style={{ color: COLOR_A }} className="font-semibold">1-davr {span(a)}</span> bilan <span style={{ color: COLOR_B }} className="font-semibold">2-davr {span(b)}</span> solishtirilmoqda
            </p>
          </div>
          <div className="flex gap-2">
            {d && <button onClick={exportExcel} className="inline-flex items-center gap-1 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold hover:bg-neutral-50"><Download className="h-3.5 w-3.5" />Excel</button>}
            {!embedded && <button onClick={onClose} className="rounded-lg p-1.5 text-neutral-500 hover:bg-neutral-200" title="Yopish"><X className="h-5 w-5" /></button>}
          </div>
        </div>
        {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</div>}
        {!d && !error && <p className="flex items-center gap-2 text-xs text-neutral-500"><RefreshCw className="h-3.5 w-3.5 animate-spin" />Yuklanmoqda…</p>}
        {d && (
          <>
            {/* 1. The conclusion first */}
            <div className="flex flex-wrap gap-2 rounded-xl border border-neutral-200 bg-white p-3 text-xs">
              <span className="font-bold text-neutral-900">Xulosa:</span>
              {summary.map((s, i) => (
                <span key={i} className={s.tone === 'good' ? 'font-semibold text-emerald-700' : s.tone === 'bad' ? 'font-semibold text-rose-700' : 'text-neutral-600'}>{s.text}{i < summary.length - 1 ? ' ·' : ''}</span>
              ))}
            </div>

            {/* AI growth plan from these numbers */}
            <AgentStrategy agentId={agentId} a={d.periods.a} b={d.periods.b} initial={strategy} readOnly={embedded} />

            {/* 2. Side-by-side comparison */}
            <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
              <table className="min-w-full text-xs">
                <thead className="bg-neutral-50"><tr>
                  <th className={`${th} text-left`}>Ko‘rsatkich</th>
                  <th className={`${th} text-right`}>{colA}<br /><span className="font-normal normal-case text-neutral-400">{span(d.periods.a)}</span></th>
                  <th className={`${th} text-right`}>{colB}<br /><span className="font-normal normal-case text-neutral-400">{span(d.periods.b)}</span></th>
                  <th className={`${th} text-right`}>Farq</th>
                  <th className={`${th} text-center`}>O‘zgarish</th>
                </tr></thead>
                <tbody className="divide-y divide-neutral-100">
                  {sections.map(([section, rows]) => (
                    <React.Fragment key={section}>
                      <tr className="bg-neutral-100/70"><td colSpan={5} className="px-3 py-1 text-[10px] font-black uppercase tracking-wider text-neutral-600">{section}</td></tr>
                      {rows.map(r => {
                        const diff = r.b - r.a;
                        const sub = r.label.startsWith('shundan');
                        return (
                          <tr key={r.label} className="hover:bg-neutral-50">
                            <td className={`px-3 py-1.5 ${sub ? 'pl-7 text-neutral-500' : 'font-semibold text-neutral-900'}`}>{r.label}{r.hint && <div className="text-[10px] font-normal text-neutral-400">{r.hint}</div>}</td>
                            <td className="px-3 py-1.5 text-right text-neutral-700">{r.only ? '' : money(r.a)}</td>
                            <td className="px-3 py-1.5 text-right font-semibold text-neutral-900">{money(r.b)}</td>
                            <td className="px-3 py-1.5 text-right text-neutral-500">{r.only || diff === 0 ? '—' : `${diff > 0 ? '+' : ''}${money(diff)}`}</td>
                            <td className="px-3 py-1.5 text-center">{r.only ? (r.b ? <span className="inline-flex rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-bold text-rose-700 ring-1 ring-rose-200">e’tibor bering</span> : null) : <Delta a={r.a} b={r.b} good={r.good} />}</td>
                          </tr>
                        );
                      })}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="-mt-2 text-[11px] text-neutral-500">
              Agentga biriktirilgan mijozlar: <b>{d.debt.customers}</b> · ulardan qarzdor: <b>{d.debt.debtors}</b> · qarz jami: <b className="text-rose-700">{money(d.debt.total)} so‘m</b>
              {d.days.a !== d.days.b && <span className="text-amber-700"> · davrlar uzunligi har xil: {d.days.a} va {d.days.b} kun</span>}
            </p>

            {/* The people sharing this agent profile: each team's own categories, compared. */}
            {d.teams?.length > 0 && (
              <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
                <h3 className="px-3 pt-3 text-sm font-bold">Komandalar bo‘yicha</h3>
                <p className="px-3 text-[11px] text-neutral-500">Bu profilni ishlatadigan har bir kishining savdosi — o‘z komandasining mahsulot kategoriyalaridan.</p>
                <table className="min-w-full text-xs">
                  <thead><tr>
                    <th className={`${th} text-left`}>Komanda</th><th className={`${th} text-right`}>{colA}</th><th className={`${th} text-right`}>{colB}</th>
                    <th className={`${th} text-right`}>Farq</th><th className={`${th} text-center`}>O‘zgarish</th><th className={`${th} text-right`}>Buyurtma</th><th className={`${th} text-right`}>Mijoz</th><th className={`${th} text-right`}>Ulushi (2-davr)</th>
                  </tr></thead>
                  <tbody className="divide-y divide-neutral-100">
                    {d.teams.map((t: any) => (
                      <tr key={t.team_id}>
                        <td className="px-3 py-1.5 font-semibold">{t.team_name}{t.person && <span className="font-normal text-neutral-500"> · {t.person}</span>}</td>
                        <td className="px-3 py-1.5 text-right text-neutral-700">{money(t.sales_a)}</td>
                        <td className="px-3 py-1.5 text-right font-semibold">{money(t.sales_b)}</td>
                        <td className="px-3 py-1.5 text-right text-neutral-500">{t.sales_b === t.sales_a ? '—' : `${t.sales_b > t.sales_a ? '+' : ''}${money(t.sales_b - t.sales_a)}`}</td>
                        <td className="px-3 py-1.5 text-center"><Delta a={t.sales_a} b={t.sales_b} good="up" /></td>
                        <td className="px-3 py-1.5 text-right">{t.orders_a} → {t.orders_b}</td>
                        <td className="px-3 py-1.5 text-right">{t.customers_a} → {t.customers_b}</td>
                        <td className="px-3 py-1.5 text-right text-neutral-500">{d.totals.b.sales ? `${Math.round((t.sales_b / d.totals.b.sales) * 100)}%` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* 3. By day */}
            <div className="rounded-xl border border-neutral-200 bg-white p-3">
              <h3 className="mb-1 text-sm font-bold">Kunma-kun savdo</h3>
              <DailyChart daily={d.daily} />
            </div>

            {/* 4. What changed: categories and products */}
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <div className="rounded-xl border border-neutral-200 bg-white p-3">
                <h3 className="mb-1 text-sm font-bold">Kategoriyalar bo‘yicha</h3>
                <table className="min-w-full text-xs">
                  <thead><tr><th className="py-1 text-left text-[10px] uppercase text-neutral-500">Kategoriya</th><th className="py-1 text-right text-[10px] uppercase">{colA}</th><th className="py-1 text-right text-[10px] uppercase">{colB}</th><th className="py-1 pl-2 text-center text-[10px] uppercase text-neutral-500">O‘zgarish</th></tr></thead>
                  <tbody className="divide-y divide-neutral-100">
                    {d.categories.slice(0, 12).map((c: any) => (
                      <tr key={c.name}><td className="py-1.5 pr-2">{c.name}</td><td className="py-1.5 text-right text-neutral-500">{money(c.sales_a)}</td><td className="py-1.5 text-right font-semibold">{money(c.sales_b)}</td><td className="py-1.5 pl-2 text-center"><Delta a={c.sales_a} b={c.sales_b} good="up" /></td></tr>
                    ))}
                    {!d.categories.length && <tr><td colSpan={4} className="py-2 text-neutral-400">Mahsulot qatorlari yo‘q</td></tr>}
                  </tbody>
                </table>
              </div>
              <div className="rounded-xl border border-neutral-200 bg-white p-3">
                <h3 className="mb-1 text-sm font-bold">Mahsulotlar: eng ko‘p o‘zgarganlar</h3>
                <table className="min-w-full text-xs">
                  <thead><tr><th className="py-1 text-left text-[10px] uppercase text-neutral-500">Mahsulot</th><th className="py-1 text-right text-[10px] uppercase">{colA}</th><th className="py-1 text-right text-[10px] uppercase">{colB}</th><th className="py-1 pl-2 text-right text-[10px] uppercase text-neutral-500">Farq</th></tr></thead>
                  <tbody className="divide-y divide-neutral-100">
                    {[['O‘sganlar', d.products.gainers.slice(0, 5)], ['Tushganlar', d.products.losers.slice(0, 5)]].map(([title, list]: any) => list.length > 0 && (
                      <React.Fragment key={title}>
                        <tr><td colSpan={4} className="pt-2 text-[10px] font-bold uppercase text-neutral-400">{title}</td></tr>
                        {list.map((p: any) => (
                          <tr key={p.sku}>
                            <td className="py-1.5 pr-2">{p.name}<div className="text-[10px] text-neutral-400">{p.category} · miqdor {Math.round(p.qty_a)} → {Math.round(p.qty_b)}</div></td>
                            <td className="py-1.5 text-right text-neutral-500">{money(p.sales_a)}</td>
                            <td className="py-1.5 text-right font-semibold">{money(p.sales_b)}</td>
                            <td className={`py-1.5 pl-2 text-right font-bold ${p.diff > 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{p.diff > 0 ? '+' : ''}{money(p.diff)}</td>
                          </tr>
                        ))}
                      </React.Fragment>
                    ))}
                    {!d.products.gainers.length && !d.products.losers.length && <tr><td colSpan={4} className="py-2 text-neutral-400">O‘zgarish yo‘q</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 5. Customers to act on */}
            <div className="rounded-xl border border-neutral-200 bg-white p-3">
              <h3 className="mb-2 text-sm font-bold">Mijozlar</h3>
              <div className="mb-2 flex flex-wrap gap-1">
                {CUSTOMER_TABS.map(([k, label]) => (
                  <button key={k} onClick={() => setTab(k)} className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${tab === k ? 'bg-neutral-900 text-white' : 'bg-neutral-100 hover:bg-neutral-200'}`}>
                    {label}{k === 'stopped' ? ` (${d.customers.counts.stopped})` : k === 'started' ? ` (${d.customers.counts.started})` : ''}
                  </button>
                ))}
              </div>
              <div className="max-h-80 overflow-y-auto">
                <table className="min-w-full text-xs">
                  <thead className="sticky top-0 bg-white text-left text-[10px] uppercase text-neutral-500"><tr><th className="py-1">Mijoz</th><th className="py-1 text-right">{colA}</th><th className="py-1 text-right">{colB}</th><th className="py-1 text-right">Farq</th><th className="py-1 text-right">Oxirgi buyurtma</th><th className="py-1 text-right">Qarzi</th></tr></thead>
                  <tbody className="divide-y divide-neutral-100">
                    {customers.map((c: any) => (
                      <tr key={c.customer_id}>
                        <td className="py-1.5">{c.name}<div className="text-[10px] text-neutral-400">{[c.phone, c.address, `buyurtma ${c.orders_a} → ${c.orders_b}`].filter(Boolean).join(' · ')}</div></td>
                        <td className="py-1.5 text-right">{money(c.sales_a)}</td>
                        <td className="py-1.5 text-right font-semibold">{money(c.sales_b)}</td>
                        <td className={`py-1.5 text-right font-bold ${c.diff > 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{c.diff > 0 ? '+' : ''}{money(c.diff)}</td>
                        <td className="py-1.5 text-right text-neutral-500">{c.last_order ? c.last_order.split('-').reverse().join('.') : '—'}</td>
                        <td className="py-1.5 text-right">{c.debt ? money(c.debt) : '—'}</td>
                      </tr>
                    ))}
                    {!customers.length && <tr><td colSpan={6} className="py-3 text-neutral-400">Bunday mijoz yo‘q.</td></tr>}
                  </tbody>
                </table>
              </div>
              {tab === 'stopped' && d.customers.counts.stopped > 0 && <p className="mt-2 text-[11px] text-neutral-500">1-davrda xarid qilib, 2-davrda umuman olmagan mijozlar — agent bilan birga ularga qo‘ng‘iroq qiling yoki CRM’da vazifa bering.</p>}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
