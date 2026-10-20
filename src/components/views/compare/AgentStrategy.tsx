import React, { useEffect, useState } from 'react';
import { CheckCircle2, Eye, Phone, RefreshCw, Sparkles, Target, TriangleAlert, Users } from 'lucide-react';
import { api } from '../../../services/api.ts';

type Period = { from: string; to: string };

/** The AI's growth plan for an agent: verdict, strengths, problems, concrete actions, what to watch, whom to call. */
/**
 * Opens by itself: the strategy kept up to date by the server (this month against last month) or, for other periods,
 * written when the window opens. initial + readOnly: the agent's own cabinet, which only shows the current strategy.
 */
export const AgentStrategy: React.FC<{ agentId: string; a: Period; b: Period; integrationId?: string | null; initial?: any; readOnly?: boolean }> = ({ agentId, a, b, integrationId, initial, readOnly = false }) => {
  const [res, setRes] = useState<any>(initial || null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (force = false) => {
    setBusy(true); setError(null);
    try { setRes(await api.getAgentStrategy(agentId, a, b, force, integrationId)); } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  useEffect(() => {
    if (initial) { setRes(initial); return; }
    if (!readOnly) run(false);
  }, [agentId, a.from, a.to, b.from, b.to, integrationId, initial]);
  const s = res?.strategy;
  const card = 'rounded-lg border border-neutral-200 bg-white p-3';
  return (
    <div className="rounded-xl border border-violet-200 bg-gradient-to-b from-violet-50/70 to-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-bold text-violet-900"><Sparkles className="h-4 w-4" />AI strategiya: o‘sish uchun nima qilish kerak</h3>
        <div className="flex items-center gap-2">
          {res && <span className="text-[10px] text-neutral-400">yangilangan: {new Date(res.generated_at).toLocaleString('ru-RU')} · {res.model}</span>}
          {!readOnly && (
            <button onClick={() => run(true)} disabled={busy} title="Raqamlar o‘zgarganda o‘zi yangilanadi; hozir qayta tuzish uchun bosing" className="inline-flex items-center gap-1 rounded-lg border border-violet-300 bg-white px-2.5 py-1 text-xs font-semibold text-violet-800 hover:bg-violet-50 disabled:opacity-60">
              <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />{busy ? 'AI tahlil qilmoqda…' : 'Hozir yangilash'}
            </button>
          )}
        </div>
      </div>
      <p className="mt-1 text-[11px] text-neutral-500">Strategiya AI tomonidan agentning haqiqiy raqamlaridan tuziladi va raqamlar o‘zgarganda (yangi kun, savdo, buyurtma, to‘xtagan mijozlar) o‘zi yangilanadi.</p>
      {busy && !res && <p className="mt-2 flex items-center gap-2 text-xs text-violet-700"><RefreshCw className="h-3.5 w-3.5 animate-spin" />AI raqamlarni o‘qib, reja tuzmoqda…</p>}
      {readOnly && !res && <p className="mt-2 text-xs text-neutral-500">Strategiya hali tuzilmagan — AI uni tez orada avtomatik tuzadi.</p>}
      {res?.history?.length > 1 && (
        <p className="mt-1 text-[11px] text-neutral-500">Baho tarixi: {res.history.slice(0, 6).reverse().map((h: any) => h.score ?? '—').join(' → ')}</p>
      )}
      {error && <p className="mt-2 rounded-lg bg-red-50 p-2 text-xs text-red-700">{error}</p>}
      {s && (
        <div className="mt-3 space-y-3 text-xs">
          <div className="flex items-start gap-3 rounded-lg bg-white p-3 ring-1 ring-violet-200">
            {s.score !== null && <div className={`flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-full text-white ${s.score >= 7 ? 'bg-emerald-600' : s.score >= 4 ? 'bg-amber-500' : 'bg-rose-600'}`}><b className="text-base leading-none">{s.score}</b><span className="text-[9px]">/10</span></div>}
            <p className="text-sm text-neutral-800">{s.verdict}</p>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {s.strengths.length > 0 && (
              <div className={card}>
                <p className="mb-1 flex items-center gap-1 font-bold text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" />Kuchli tomonlari</p>
                <ul className="list-disc space-y-0.5 pl-4 text-neutral-700">{s.strengths.map((x: string, i: number) => <li key={i}>{x}</li>)}</ul>
              </div>
            )}
            {s.problems.length > 0 && (
              <div className={card}>
                <p className="mb-1 flex items-center gap-1 font-bold text-rose-700"><TriangleAlert className="h-3.5 w-3.5" />Muammolar</p>
                <ul className="space-y-1">{s.problems.map((p: any, i: number) => <li key={i}><b className="text-neutral-900">{p.title}</b>{p.evidence && <span className="text-neutral-500"> — {p.evidence}</span>}</li>)}</ul>
              </div>
            )}
          </div>

          {s.actions.length > 0 && (
            <div className={card}>
              <p className="mb-2 flex items-center gap-1 font-bold text-violet-800"><Target className="h-3.5 w-3.5" />Harakat rejasi</p>
              <ol className="space-y-2">
                {s.actions.map((x: any, i: number) => (
                  <li key={i} className="flex gap-2">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-violet-600 text-[10px] font-bold text-white">{i + 1}</span>
                    <div>
                      <p className="font-semibold text-neutral-900">{x.title}</p>
                      {x.why && <p className="text-neutral-500">Nega: {x.why}</p>}
                      {x.how && <p className="text-neutral-700">Qanday: {x.how}</p>}
                      <p className="mt-0.5 flex flex-wrap gap-2">
                        {x.target && <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-800">Maqsad: {x.target}</span>}
                        {x.deadline && <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[11px] text-neutral-600">Muddat: {x.deadline}</span>}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {s.watch.length > 0 && (
              <div className={card}>
                <p className="mb-1 flex items-center gap-1 font-bold text-neutral-800"><Eye className="h-3.5 w-3.5" />Har hafta e’tibor bering</p>
                <ul className="list-disc space-y-0.5 pl-4 text-neutral-700">{s.watch.map((x: string, i: number) => <li key={i}>{x}</li>)}</ul>
              </div>
            )}
            {s.team_notes.length > 0 && (
              <div className={card}>
                <p className="mb-1 flex items-center gap-1 font-bold text-neutral-800"><Users className="h-3.5 w-3.5" />Komandalarga</p>
                <ul className="space-y-1">{s.team_notes.map((t: any, i: number) => <li key={i}><b>{t.team}:</b> <span className="text-neutral-700">{t.advice}</span></li>)}</ul>
              </div>
            )}
          </div>

          {s.call_list.length > 0 && (
            <div className={card}>
              <p className="mb-1 flex items-center gap-1 font-bold text-neutral-800"><Phone className="h-3.5 w-3.5" />Qo‘ng‘iroq ro‘yxati</p>
              <table className="min-w-full">
                <thead className="text-left text-[10px] uppercase text-neutral-500"><tr><th className="py-1">Mijoz</th><th className="py-1">Sabab</th><th className="py-1">Nima taklif qilish</th></tr></thead>
                <tbody className="divide-y divide-neutral-100">{s.call_list.map((c: any, i: number) => <tr key={i}><td className="py-1.5 pr-2 font-semibold">{c.customer}</td><td className="py-1.5 pr-2 text-neutral-600">{c.reason}</td><td className="py-1.5 text-neutral-700">{c.offer}</td></tr>)}</tbody>
              </table>
            </div>
          )}
          <p className="text-[10px] text-neutral-400">AI tavsiyasi agentning dasturdagi haqiqiy raqamlariga asoslangan; qaror qabul qilishda o‘z bilimingiz bilan tekshiring.</p>
        </div>
      )}
    </div>
  );
};
