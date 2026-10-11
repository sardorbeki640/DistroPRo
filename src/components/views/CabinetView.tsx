import React, { useEffect, useState } from 'react';
import { BarChart3, CalendarCheck, CheckCircle2, Circle, KeyRound, ListTodo, Receipt, RefreshCw, Users, Wallet } from 'lucide-react';
import { api } from '../../services/api.ts';
import { AuthUser } from '../../types.ts';
import { ChangePasswordModal } from '../common/ChangePasswordModal.tsx';
import { localToday } from '../../utils/date';
import { TableToolbar, matchesSearch, exportTableXlsx } from '../common/TableToolbar.tsx';
import { AttendanceCard } from '../faceid/AttendanceCard.tsx';
import { TelegramCard } from './TelegramCard.tsx';
import { AgentDetail } from './compare/AgentDetail.tsx';

const money = (n?: number | null) => `${Math.round(n || 0).toLocaleString('uz-UZ')} so‘m`;
type Tab = 'today' | 'results' | 'tasks' | 'customers' | 'salary';

/**
 * Personal cabinet, in sections: today (attendance, Telegram), my results (for agents: this month against last month
 * with the AI strategy), tasks, customers, salary and expenses.
 */
export const CabinetView: React.FC<{ user: AuthUser | null }> = ({ user }) => {
  const [month, setMonth] = useState(localToday().slice(0, 7));
  const [data, setData] = useState<any>(null);
  const [perf, setPerf] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try { setData(await api.getMyCabinet(month)); } catch (err: any) { setError(err.message); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [month]);
  useEffect(() => { api.getMyPerformance().then(setPerf).catch(() => setPerf({ agent: null })); }, []);
  // An agent opens on their results; everyone else on today.
  useEffect(() => { if (tab === null && perf) setTab(perf.agent ? 'results' : 'today'); }, [perf, tab]);

  const toggleTask = async (task: any) => {
    try {
      await api.crm.updateTask(task.id, { status: task.status === 'DONE' ? 'OPEN' : 'DONE' });
      load();
    } catch (err: any) { setError(err.message); }
  };

  const [customerSearch, setCustomerSearch] = useState('');
  const [debtOnly, setDebtOnly] = useState('');
  const myCustomers = (data?.customers || []).filter((c: any) =>
    matchesSearch(c, customerSearch, ['name', 'phone', 'address', 'code']) && (!debtOnly || c.debt > 0)
  );
  const exportCustomers = () => exportTableXlsx({
    fileName: 'Mening_mijozlarim',
    title: `Mijozlarim va qarzlari — ${user?.full_name || ''}`,
    columns: [
      { header: 'Mijoz', key: 'name', width: 32 }, { header: 'Telefon', key: 'phone', width: 15 },
      { header: 'Manzil', key: 'address', width: 34 }, { header: 'Qarz', key: 'debt', type: 'money', total: true }
    ],
    rows: myCustomers,
    filters: [customerSearch && `qidiruv: "${customerSearch}"`, debtOnly && 'faqat qarzdorlar']
  });

  const card = 'rounded-2xl border border-neutral-200 bg-white p-4 shadow-xs';
  const s = data?.salary?.summary;
  const openTasks = data ? data.tasks.filter((t: any) => t.status !== 'DONE' && t.status !== 'CANCELLED').length : 0;
  const initials = (user?.full_name || '?').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
  const tabs: [Tab, string, React.ElementType, string?][] = [
    ['today', 'Bugun', CalendarCheck],
    ...(perf?.agent ? [['results', 'Natijalarim', BarChart3] as [Tab, string, React.ElementType]] : []),
    ['tasks', 'Vazifalar', ListTodo, openTasks ? String(openTasks) : undefined],
    ['customers', 'Mijozlarim', Users, data ? String(data.customers.length) : undefined],
    ['salary', 'Oylik va xarajatlar', Wallet]
  ];
  const current = tab || 'today';

  return (
    <div className="space-y-4 pb-12">
      {/* Who I am, and the few numbers that matter */}
      <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-emerald-600 text-sm font-bold text-white">{initials}</div>
            <div>
              <h1 className="text-lg font-bold leading-tight text-neutral-900">{user?.full_name}</h1>
              <p className="text-xs text-neutral-500">{[data?.employee?.position, perf?.agent?.name && `agent: ${perf.agent.name}`, user?.login || user?.email].filter(Boolean).join(' · ')}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => { load(); api.getMyPerformance().then(setPerf).catch(() => {}); }} className="inline-flex items-center gap-1 rounded-lg bg-neutral-100 px-3 py-1.5 text-xs font-semibold hover:bg-neutral-200"><RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />Yangilash</button>
            <button onClick={() => setShowPassword(true)} className="inline-flex items-center gap-1 rounded-lg bg-neutral-100 px-3 py-1.5 text-xs font-semibold hover:bg-neutral-200"><KeyRound className="h-3.5 w-3.5" />Parol</button>
          </div>
        </div>
        {data && (
          <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
            <button onClick={() => setTab('salary')} className="rounded-xl bg-neutral-50 p-3 text-left hover:bg-neutral-100"><div className="flex items-center gap-1.5 text-[10px] font-bold uppercase text-neutral-500"><Wallet className="h-3.5 w-3.5" />Oylik qoldig‘i</div><p className="mt-1 text-base font-black text-neutral-900">{s ? money(s.net_remaining_balance) : '—'}</p></button>
            <button onClick={() => setTab('tasks')} className="rounded-xl bg-neutral-50 p-3 text-left hover:bg-neutral-100"><div className="flex items-center gap-1.5 text-[10px] font-bold uppercase text-neutral-500"><ListTodo className="h-3.5 w-3.5" />Ochiq vazifalar</div><p className="mt-1 text-base font-black text-neutral-900">{openTasks} ta{data.overdue_tasks ? <span className="ml-1 text-xs font-bold text-red-600">· {data.overdue_tasks} kechikkan</span> : null}</p></button>
            <button onClick={() => setTab('customers')} className="rounded-xl bg-neutral-50 p-3 text-left hover:bg-neutral-100"><div className="flex items-center gap-1.5 text-[10px] font-bold uppercase text-neutral-500"><Users className="h-3.5 w-3.5" />Mijozlar qarzi</div><p className="mt-1 text-base font-black text-neutral-900">{money(data.customers_debt_total)}</p></button>
            <button onClick={() => setTab('salary')} className="rounded-xl bg-neutral-50 p-3 text-left hover:bg-neutral-100"><div className="flex items-center gap-1.5 text-[10px] font-bold uppercase text-neutral-500"><Receipt className="h-3.5 w-3.5" />Xarajatlarim</div><p className="mt-1 text-base font-black text-neutral-900">{money(data.expenses_total)}</p></button>
          </div>
        )}
      </div>

      {notice && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">{notice}</div>}
      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</div>}
      {data && !data.employee_linked && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">Hisobingiz xodim kartasiga bog‘lanmagan. Oylik va mijozlar ko‘rinishi uchun rahbar Sozlamalar → Xodimlarga kirish bo‘limida hisob bersin.</div>
      )}

      {/* Sections */}
      <div className="flex gap-1 overflow-x-auto rounded-xl border border-neutral-200 bg-white p-1">
        {tabs.map(([id, label, Icon, badge]) => (
          <button key={id} onClick={() => setTab(id)} className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold ${current === id ? 'bg-neutral-900 text-white' : 'text-neutral-600 hover:bg-neutral-100'}`}>
            <Icon className="h-4 w-4" />{label}{badge && <span className={`rounded-full px-1.5 text-[10px] ${current === id ? 'bg-white/20' : 'bg-neutral-200'}`}>{badge}</span>}
          </button>
        ))}
      </div>

      {current === 'today' && (
        <div className="space-y-4">
          <AttendanceCard />
          <TelegramCard />
        </div>
      )}

      {current === 'results' && perf?.team && (
        // A shared profile: the person's own part is their team's categories; the rest below is the whole profile.
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-[11px] font-bold uppercase tracking-wide text-emerald-800">Mening ulushim — {perf.team.name}</p>
          <div className="mt-2 grid grid-cols-3 gap-3 text-sm">
            {([['Savdo', 'sales', true], ['Buyurtmalar', 'orders', false], ['Mijozlar', 'customers', false]] as const).map(([label, k, money]) => {
              const a = perf.team.a[k] || 0, b = perf.team.b[k] || 0;
              const pct = a ? Math.round((b / a - 1) * 100) : null;
              return (
                <div key={k} className="rounded-xl bg-white p-3">
                  <p className="text-[10px] font-semibold uppercase text-neutral-500">{label}</p>
                  <p className="font-black text-neutral-900">{money ? `${b.toLocaleString('ru-RU')} so‘m` : b}</p>
                  <p className="text-[11px] text-neutral-500">o‘tgan oy: {money ? a.toLocaleString('ru-RU') : a}{pct !== null && <b className={pct >= 0 ? ' text-emerald-700' : ' text-rose-700'}> {pct > 0 ? '+' : ''}{pct}%</b>}</p>
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-[11px] text-emerald-900">Kategoriyalarim: {perf.team.categories.slice(0, 12).join(', ')}{perf.team.categories.length > 12 ? ` va yana ${perf.team.categories.length - 12} ta` : ''}. Pastda — butun “{perf.agent.name}” profilining natijasi.</p>
        </div>
      )}

      {current === 'results' && perf?.agent && perf.data && (
        <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
          <AgentDetail embedded agentId={perf.agent.id} a={perf.data.periods.a} b={perf.data.periods.b} data={perf.data} strategy={perf.strategy} />
        </div>
      )}

      {current === 'tasks' && data && (
        <div className={card}>
          <h2 className="mb-2 text-sm font-bold text-neutral-900">Vazifalarim</h2>
          {data.tasks.length === 0 ? <p className="text-xs text-neutral-400">Vazifa yo‘q.</p> : (
            <ul className="divide-y divide-neutral-100">
              {data.tasks.map((t: any) => {
                const overdue = t.due_date && t.due_date < localToday() && t.status !== 'DONE';
                return (
                  <li key={t.id} className="flex items-start gap-3 py-2.5">
                    <button onClick={() => toggleTask(t)} title={t.status === 'DONE' ? 'Qayta ochish' : 'Bajarildi'} className="mt-0.5">
                      {t.status === 'DONE' ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <Circle className="h-5 w-5 text-neutral-400 hover:text-emerald-600" />}
                    </button>
                    <div className="min-w-0 flex-1">
                      <p className={`text-sm ${t.status === 'DONE' ? 'text-neutral-400 line-through' : 'text-neutral-900'}`}>{t.title}</p>
                      {t.description && <p className="text-[11px] text-neutral-500">{t.description}</p>}
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${overdue ? 'bg-red-50 font-bold text-red-600' : 'bg-neutral-100 text-neutral-500'}`}>{t.due_date ? t.due_date.split('-').reverse().join('.') : 'muddatsiz'}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {current === 'customers' && data && (
        <div className={card}>
          <h2 className="mb-2 text-sm font-bold text-neutral-900">Mijozlarim va qarzlari</h2>
          {data.customers.length === 0 ? <p className="text-xs text-neutral-400">Sizga biriktirilgan mijoz yo‘q.</p> : (
            <>
              <div className="mb-3">
                <TableToolbar
                  search={customerSearch} onSearch={setCustomerSearch} searchPlaceholder="Mijoz, telefon yoki manzil…"
                  selects={[{ label: 'Qarz', single: true, value: debtOnly, onChange: setDebtOnly, allLabel: 'Barcha mijozlar', options: [{ value: '1', label: 'Faqat qarzdorlar' }] }]}
                  count={myCustomers.length}
                  onReset={() => { setCustomerSearch(''); setDebtOnly(''); }}
                  onExport={exportCustomers}
                />
              </div>
              <div className="max-h-[32rem] overflow-y-auto">
                <table className="min-w-full text-xs">
                  <thead className="sticky top-0 bg-white text-left text-[10px] uppercase text-neutral-500"><tr><th className="py-1.5">Mijoz</th><th className="py-1.5">Telefon</th><th className="py-1.5 text-right">Qarz</th></tr></thead>
                  <tbody className="divide-y divide-neutral-100">
                    {myCustomers.map((c: any) => (
                      <tr key={c.id}><td className="py-2 font-medium text-neutral-900">{c.name}{c.address && <div className="text-[10px] font-normal text-neutral-400">{c.address}</div>}</td><td className="py-2">{c.phone ? <a className="text-blue-700" href={`tel:${c.phone}`}>{c.phone}</a> : '—'}</td><td className={`py-2 text-right font-semibold ${c.debt > 0 ? 'text-red-600' : 'text-neutral-400'}`}>{c.debt > 0 ? money(c.debt) : '—'}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {current === 'salary' && data && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className={card}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="text-sm font-bold text-neutral-900">Oylik ({data.month})</h2>
              <input type="month" value={month} onChange={e => setMonth(e.target.value)} className="rounded-lg border border-neutral-300 px-2 py-1 text-xs" />
            </div>
            {s ? (
              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between"><span className="text-neutral-600">Asosiy oylik</span><span>{money(s.base_salary)}</span></div>
                <div className="flex justify-between"><span className="text-neutral-600">Bonus / KPI</span><span>{money(s.bonus_amount)}</span></div>
                <div className="flex justify-between"><span className="text-neutral-600">Ishbay / reyslar</span><span>{money(s.piecework_amount)}</span></div>
                <div className="flex justify-between text-red-600"><span>Ushlanmalar</span><span>−{money(s.total_deductions)}</span></div>
                <div className="flex justify-between border-t pt-1.5 text-sm font-bold"><span>Qoldiq</span><span>{money(s.net_remaining_balance)}</span></div>
                <p className="pt-1 text-[11px] text-neutral-500">Holati: {s.status === 'PAID' ? 'to‘langan' : s.status === 'APPROVED' ? 'tasdiqlangan' : 'hisob-kitob qilinmoqda'}</p>
                {(data.salary.expenses || []).length > 0 && <p className="pt-2 text-[11px] font-semibold text-neutral-600">Ushlangan xarajatlar:</p>}
                {(data.salary.expenses || []).map((e: any) => <div key={e.id} className="flex justify-between gap-2 text-[11px] text-neutral-500"><span>{e.date} · {e.category_name} · {e.reason}</span><span className="shrink-0">{money(e.amount)}</span></div>)}
              </div>
            ) : <p className="text-xs text-neutral-400">{data.salary_error || 'Oylik ma’lumoti yo‘q.'}</p>}
          </div>
          <div className={card}>
            <h2 className="mb-2 text-sm font-bold text-neutral-900">Men kiritgan xarajatlar</h2>
            <p className="mb-2 text-[11px] text-neutral-500">{data.daily_expense_limit != null ? `Kunlik limit: ${money(data.daily_expense_limit)}` : 'Kunlik limit belgilanmagan'}</p>
            {data.expenses.length === 0 ? <p className="text-xs text-neutral-400">Xarajat yo‘q.</p> : (
              <div className="divide-y divide-neutral-100">
                {data.expenses.map((e: any) => (
                  <div key={e.id} className="flex justify-between gap-2 py-1.5 text-xs">
                    <span className="text-neutral-700">{e.date} · {e.category}{e.comment && <span className="text-neutral-400"> · {e.comment}</span>}</span>
                    <span className="shrink-0 text-right">{money(e.amount)}<div className={`text-[10px] ${e.status === 'CONFIRMED' ? 'text-emerald-600' : e.status === 'CANCELLED' ? 'text-neutral-400' : 'text-amber-600'}`}>{e.status === 'CONFIRMED' ? 'tasdiqlangan' : e.status === 'CANCELLED' ? 'bekor' : 'kutilmoqda'}</div></span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {showPassword && <ChangePasswordModal onCancel={() => setShowPassword(false)} onDone={() => { setShowPassword(false); setNotice('Parol almashtirildi.'); }} />}
    </div>
  );
};
