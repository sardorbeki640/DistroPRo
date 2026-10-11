import React, { useEffect, useMemo, useState } from 'react';
import { Plus, RefreshCw, Search, Trash2, X } from 'lucide-react';
import { api } from '../../../services/api.ts';

type Team = { id?: string; name: string; categories: string[]; members: Record<string, string>; member_employees: Record<string, string> };

/**
 * Sales teams: one agent profile is used by several people, each selling its own product categories. Here each team
 * gets its categories (a category belongs to one team) and, per agent profile, the name of the person in that team.
 */
export const TeamsEditor: React.FC<{ onClose: () => void; onSaved: () => void }> = ({ onClose, onSaved }) => {
  const [teams, setTeams] = useState<Team[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [agents, setAgents] = useState<{ id: string; name: string; code: string }[]>([]);
  const [employees, setEmployees] = useState<{ id: string; name: string; position: string }[]>([]);
  const [active, setActive] = useState(0);
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api.getTeams().then(r => {
      setTeams(r.teams.length ? r.teams.map(t => ({ id: t.id, name: t.name, categories: t.categories, members: t.members || {}, member_employees: t.member_employees || {} })) : [{ name: '1-Komanda', categories: [], members: {}, member_employees: {} }, { name: '2-Komanda', categories: [], members: {}, member_employees: {} }]);
      setCategories(r.categories.map(c => c.name));
      setAgents(r.agents);
      setEmployees(r.employees || []);
      setLoaded(true);
    }).catch(e => setError(e.message));
  }, []);

  const ownerOf = useMemo(() => {
    const m = new Map<string, number>();
    teams.forEach((t, i) => t.categories.forEach(c => m.set(c, i)));
    return m;
  }, [teams]);
  const free = categories.filter(c => !ownerOf.has(c));
  const shown = categories.filter(c => !q.trim() || c.toLowerCase().includes(q.trim().toLowerCase()));
  const team = teams[active];

  const setTeam = (i: number, patch: Partial<Team>) => setTeams(ts => ts.map((t, j) => j === i ? { ...t, ...patch } : t));
  // A category clicked in the open team moves to it (from another team too); clicked again it is removed.
  const toggle = (c: string) => setTeams(ts => ts.map((t, j) => {
    if (j === active) return { ...t, categories: t.categories.includes(c) ? t.categories.filter(x => x !== c) : [...t.categories, c] };
    return t.categories.includes(c) ? { ...t, categories: t.categories.filter(x => x !== c) } : t;
  }));
  const save = async () => {
    setBusy(true); setError(null);
    try {
      const r = await api.saveTeams(teams);
      if (r.created?.length) alert(`Yangi xodim${r.created.length > 1 ? 'lar' : ''} qo‘shildi: ${r.created.join(', ')}.\nXodimlar bo‘limida telefon, oylik sxemasi va kabinet loginini bering.`);
      onSaved(); onClose();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-2 sm:p-6" onClick={onClose}>
      <div className="w-full max-w-4xl space-y-3 rounded-2xl bg-white p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-base font-bold">Savdo komandalari</h2>
            <p className="text-[11px] text-neutral-500">Bitta agent profilini bir necha kishi ishlatsa, har birining savdosi uning komandasidagi mahsulot kategoriyalaridan hisoblanadi. Har bir kategoriya bitta komandada bo‘ladi.</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-neutral-500 hover:bg-neutral-100"><X className="h-5 w-5" /></button>
        </div>
        {error && <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">{error}</div>}
        {!loaded && !error && <p className="flex items-center gap-2 text-xs text-neutral-500"><RefreshCw className="h-3.5 w-3.5 animate-spin" />Yuklanmoqda…</p>}
        {loaded && (
          <>
            <div className="flex flex-wrap items-center gap-1.5">
              {teams.map((t, i) => (
                <button key={i} onClick={() => setActive(i)} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${active === i ? 'bg-neutral-900 text-white' : 'bg-neutral-100 hover:bg-neutral-200'}`}>
                  {t.name || `${i + 1}-komanda`} <span className="opacity-60">({t.categories.length})</span>
                </button>
              ))}
              <button onClick={() => { setTeams(ts => [...ts, { name: `${ts.length + 1}-Komanda`, categories: [], members: {}, member_employees: {} }]); setActive(teams.length); }} className="inline-flex items-center gap-1 rounded-lg border border-dashed border-neutral-300 px-3 py-1.5 text-xs font-semibold text-neutral-600 hover:bg-neutral-50"><Plus className="h-3.5 w-3.5" />Komanda qo‘shish</button>
            </div>

            {team && (
              <div className="space-y-3 rounded-xl border border-neutral-200 p-3">
                <div className="flex flex-wrap items-end gap-2">
                  <label className="text-xs font-semibold">Komanda nomi
                    <input className="mt-1 block w-56 rounded-lg border border-neutral-300 px-2.5 py-1.5 text-xs" value={team.name} onChange={e => setTeam(active, { name: e.target.value })} />
                  </label>
                  <button onClick={() => { if (confirm(`“${team.name}” o‘chirilsinmi?`)) { setTeams(ts => ts.filter((_, j) => j !== active)); setActive(0); } }} className="mb-0.5 inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-neutral-500 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-3.5 w-3.5" />O‘chirish</button>
                </div>

                <div>
                  <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-semibold">Kategoriyalar — bosib belgilang <span className="font-normal text-neutral-500">(boshqa komandadagisini bossangiz, shu komandaga o‘tadi)</span></p>
                    <div className="relative"><Search className="absolute left-2 top-2 h-3.5 w-3.5 text-neutral-400" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Qidirish…" className="h-8 w-48 rounded-lg border border-neutral-300 pl-7 pr-2 text-xs" /></div>
                  </div>
                  <div className="flex max-h-64 flex-wrap gap-1.5 overflow-y-auto rounded-lg bg-neutral-50 p-2">
                    {shown.map(c => {
                      const owner = ownerOf.get(c);
                      const mine = owner === active;
                      return (
                        <button key={c} onClick={() => toggle(c)} title={owner !== undefined && !mine ? `Hozir: ${teams[owner]?.name}` : ''}
                          className={`rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ${mine ? 'bg-emerald-600 text-white ring-emerald-600' : owner !== undefined ? 'bg-white text-neutral-400 ring-neutral-200 line-through decoration-neutral-300' : 'bg-white text-neutral-800 ring-neutral-300 hover:ring-emerald-400'}`}>
                          {c}{owner !== undefined && !mine ? ` · ${teams[owner]?.name}` : ''}
                        </button>
                      );
                    })}
                    {!shown.length && <span className="text-xs text-neutral-400">Kategoriya topilmadi.</span>}
                  </div>
                  <p className="mt-1 text-[11px] text-neutral-500">Hech qaysi komandaga kirmagan: <b>{free.length}</b> ta kategoriya — ularning savdosi “Boshqa (komandasiz)” qatorida chiqadi.</p>
                </div>
              </div>
            )}

            {teams.length > 0 && agents.length > 0 && (
              <div className="rounded-xl border border-neutral-200 p-3">
                <p className="mb-0.5 text-xs font-semibold">Har bir agent profilidagi xodimlar</p>
                <p className="mb-1.5 text-[11px] text-neutral-500">
                  Bitta profilni ikki kishi ishlatsa — bu <b>ikki xodim</b>. Har birini tanlang yoki “＋ Yangi xodim” bilan shu yerda qo‘shing.
                  Har biri alohida xodim bo‘ladi (davomat, oylik, kabinet); “o‘z savdosidan %” faqat o‘z komandasi kategoriyalaridan hisoblanadi.
                </p>
                <div className="max-h-72 overflow-auto">
                  <table className="min-w-full text-xs">
                    <thead className="sticky top-0 bg-white text-left text-[10px] uppercase text-neutral-500"><tr><th className="py-1 pr-2">Agent profili</th>{teams.map((t, i) => <th key={i} className="py-1 pr-2">{t.name}</th>)}</tr></thead>
                    <tbody className="divide-y divide-neutral-100">
                      {agents.map(a => (
                        <tr key={a.id}>
                          <td className="py-1 pr-2 font-semibold">{a.name}</td>
                          {teams.map((t, i) => {
                            const emp = t.member_employees[a.id] || '';
                            const setEmp = (v: string) => setTeam(i, {
                              member_employees: { ...t.member_employees, [a.id]: v },
                              members: { ...t.members, [a.id]: v && v !== 'NEW' ? employees.find(e => e.id === v)?.name || '' : v === 'NEW' ? '' : t.members[a.id] || '' }
                            });
                            return (
                              <td key={i} className="space-y-1 py-1 pr-2 align-top">
                                <select className="w-full min-w-[150px] rounded border border-neutral-200 px-1.5 py-1 text-xs" value={emp} onChange={e => setEmp(e.target.value)}>
                                  <option value="">{t.members[a.id] && !emp ? `${t.members[a.id]} (xodim emas)` : '— tanlanmagan —'}</option>
                                  {employees.map(e => <option key={e.id} value={e.id}>{e.name}{e.position ? ` · ${e.position}` : ''}</option>)}
                                  <option value="NEW">＋ Yangi xodim…</option>
                                </select>
                                {emp === 'NEW' && <input autoFocus className="w-full rounded border border-emerald-300 px-2 py-1 text-xs" placeholder="Yangi xodim ismi" value={t.members[a.id] || ''} onChange={e => setTeam(i, { members: { ...t.members, [a.id]: e.target.value } })} />}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button onClick={onClose} className="rounded-lg px-3 py-2 text-xs font-semibold text-neutral-600 hover:bg-neutral-100">Bekor qilish</button>
              <button onClick={save} disabled={busy} className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50">{busy ? 'Saqlanmoqda…' : 'Saqlash'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
