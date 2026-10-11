import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Circle, Phone, Plus, RefreshCw, Search, Trash2, X } from 'lucide-react';
import { api } from '../../services/api.ts';
import { AuthUser } from '../../types.ts';
import { can } from '../../utils/permissions.ts';
import { localToday } from '../../utils/date';
import { TableToolbar, matchesSearch, inDateRange, exportTableXlsx, isPicked, picked, pickedLabels } from '../common/TableToolbar.tsx';

type Tab = 'today' | 'tasks' | 'log' | 'pipeline' | 'customers';
const money = (n?: number | null) => `${Math.round(n || 0).toLocaleString('uz-UZ')} so‘m`;
const input = 'w-full rounded-lg border border-neutral-300 px-2.5 py-1.5 text-xs focus:border-neutral-900 focus:outline-hidden';
const card = 'rounded-2xl border border-neutral-200 bg-white p-4 shadow-xs';
const btn = 'inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition';

const TYPE_LABEL: Record<string, string> = { CALL: 'Qo‘ng‘iroq', VISIT: 'Tashrif', MEETING: 'Uchrashuv', MESSAGE: 'Xabar', NOTE: 'Izoh' };
const RESULT_LABEL: Record<string, string> = {
  REACHED: 'Gaplashildi', NO_ANSWER: 'Javob bermadi', INTERESTED: 'Qiziqdi', NOT_INTERESTED: 'Qiziqmadi',
  ORDER: 'Buyurtma berdi', PAYMENT_PROMISE: 'To‘lashga va’da berdi', COMPLAINT: 'Shikoyat', OTHER: 'Boshqa'
};
const PRIORITY_LABEL: Record<string, string> = { LOW: 'Past', NORMAL: 'O‘rta', HIGH: 'Yuqori' };

/** Picks a customer the signed-in person may work with (server applies the same visibility rules). */
const CustomerPicker: React.FC<{ value: { id: string; name: string } | null; onChange: (c: { id: string; name: string } | null) => void }> = ({ value, onChange }) => {
  const [q, setQ] = useState('');
  const [list, setList] = useState<any[]>([]);
  useEffect(() => {
    if (value) return;
    const t = setTimeout(() => api.crm.customers(q).then(r => setList(r.customers)).catch(() => setList([])), 250);
    return () => clearTimeout(t);
  }, [q, value]);
  if (value) return (
    <div className="flex items-center justify-between rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-1.5 text-xs">
      <span className="font-semibold">{value.name}</span>
      <button type="button" onClick={() => onChange(null)}><X className="h-3.5 w-3.5" /></button>
    </div>
  );
  return (
    <div>
      <input className={input} placeholder="Mijoz nomi, telefoni yoki kodi" value={q} onChange={e => setQ(e.target.value)} />
      {list.length > 0 && (
        <div className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-neutral-200">
          {list.map(c => <button type="button" key={c.id} onClick={() => onChange({ id: c.id, name: c.name })} className="block w-full px-2.5 py-1.5 text-left text-xs hover:bg-neutral-50">{c.name} <span className="text-neutral-400">{c.phone}</span></button>)}
        </div>
      )}
    </div>
  );
};

export const CRMView: React.FC<{ user: AuthUser | null }> = ({ user }) => {
  const [tab, setTab] = useState<Tab>('today');
  const [seesAll, setSeesAll] = useState(false);
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const [summary, setSummary] = useState<any>(null);
  const [users, setUsers] = useState<{ id: string; full_name: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [openCustomer, setOpenCustomer] = useState<string | null>(null);
  const canCreateDeal = can(user, 'crm:create');

  const flash = (text: string) => { setNotice(text); setTimeout(() => setNotice(null), 4000); };
  const loadSummary = () => api.crm.summary().then(r => { setSummary(r.summary); setSeesAll(r.sees_all); }).catch(e => setError(e.message));
  useEffect(() => { loadSummary(); api.crm.users().then(r => setUsers(r.users)).catch(() => {}); }, []);

  const tabs: { id: Tab; label: string }[] = [
    { id: 'today', label: 'Bugun' }, { id: 'tasks', label: 'Vazifalar' }, { id: 'log', label: 'Aloqa jurnali' },
    { id: 'pipeline', label: 'Sotuv voronkasi' }, { id: 'customers', label: 'Mijoz kartasi 360°' }
  ];

  return (
    <div className="space-y-4 pb-12">
      <div className="flex flex-col gap-3 rounded-2xl border border-neutral-200 bg-white p-5 shadow-xs md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-xl font-bold text-neutral-900">CRM</h1>
          <p className="text-xs text-neutral-500">Mijozlar bilan ish: vazifalar, qo‘ng‘iroq va tashriflar, bitimlar. {seesAll ? 'Siz butun jamoani ko‘rasiz.' : 'Siz o‘zingizga tegishli yozuvlarni ko‘rasiz.'}</p>
        </div>
        {seesAll && (
          <div className="flex rounded-lg bg-neutral-100 p-0.5 text-xs">
            {(['mine', 'all'] as const).map(s => <button key={s} onClick={() => setScope(s)} className={`rounded-md px-3 py-1 font-semibold ${scope === s ? 'bg-white shadow-xs' : 'text-neutral-500'}`}>{s === 'mine' ? 'Meniki' : 'Butun jamoa'}</button>)}
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-1 border-b border-neutral-200">
        {tabs.map(t => <button key={t.id} onClick={() => { setTab(t.id); setOpenCustomer(null); }} className={`-mb-px border-b-2 px-3 py-2 text-xs font-semibold ${tab === t.id ? 'border-emerald-600 text-emerald-700' : 'border-transparent text-neutral-500 hover:text-neutral-800'}`}>{t.label}</button>)}
      </div>

      {notice && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">{notice}</div>}
      {error && <div className="flex justify-between rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700"><span>{error}</span><button onClick={() => setError(null)}><X className="h-3.5 w-3.5" /></button></div>}

      {tab === 'today' && <TodayTab summary={summary} scope={scope} onError={setError} onChanged={loadSummary} />}
      {tab === 'tasks' && <TasksTab scope={scope} users={users} seesAll={seesAll} onError={setError} onSaved={() => { flash('Vazifa saqlandi.'); loadSummary(); }} />}
      {tab === 'log' && <LogTab scope={scope} onError={setError} onSaved={() => { flash('Aloqa yozildi.'); loadSummary(); }} />}
      {tab === 'pipeline' && <PipelineTab scope={scope} users={users} seesAll={seesAll} canCreate={canCreateDeal} onError={setError} onSaved={() => { flash('Bitim saqlandi.'); loadSummary(); }} />}
      {tab === 'customers' && (openCustomer
        ? <Customer360 id={openCustomer} users={users} seesAll={seesAll} onBack={() => setOpenCustomer(null)} onError={setError} onFlash={flash} />
        : <CustomerSearch onOpen={setOpenCustomer} />)}
    </div>
  );
};

// ---------------- Today ----------------
const TodayTab: React.FC<{ summary: any; scope: string; onError: (e: string) => void; onChanged: () => void }> = ({ summary, scope, onError, onChanged }) => {
  const [tasks, setTasks] = useState<any[]>([]);
  const load = () => api.crm.tasks({ scope, status: 'ACTIVE' }).then(r => setTasks(r.tasks)).catch(e => onError(e.message));
  useEffect(() => { load(); }, [scope]);
  const today = localToday();
  const urgent = tasks.filter(t => !t.due_date || t.due_date <= today);
  return (
    <div className="space-y-4">
      {summary && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {[
            ['Ochiq vazifalar', summary.open_tasks], ['Bugun muddati', summary.due_today], ['Muddati o‘tgan', summary.overdue],
            ['Ochiq bitimlar', `${summary.open_deals} · ${money(summary.pipeline_amount)}`], ['Bugungi aloqalar', summary.activities_today]
          ].map(([label, value]) => (
            <div key={label as string} className={card}><p className="text-[11px] font-bold uppercase text-neutral-500">{label}</p><p className={`mt-1 text-lg font-black ${label === 'Muddati o‘tgan' && Number(value) > 0 ? 'text-red-600' : 'text-neutral-900'}`}>{value}</p></div>
          ))}
        </div>
      )}
      <div className={card}>
        <h2 className="mb-2 text-sm font-bold">Bugungi va kechikkan vazifalar</h2>
        <TaskList tasks={urgent} onChanged={() => { load(); onChanged(); }} onError={onError} />
      </div>
    </div>
  );
};

const TaskList: React.FC<{ tasks: any[]; onChanged: () => void; onError: (e: string) => void; showAssignee?: boolean }> = ({ tasks, onChanged, onError, showAssignee }) => {
  const toggle = async (t: any) => {
    try { await api.crm.updateTask(t.id, { status: t.status === 'DONE' ? 'OPEN' : 'DONE' }); onChanged(); } catch (e: any) { onError(e.message); }
  };
  const remove = async (t: any) => {
    if (!confirm(`"${t.title}" vazifasi o‘chirilsinmi?`)) return;
    try { await api.crm.deleteTask(t.id); onChanged(); } catch (e: any) { onError(e.message); }
  };
  if (!tasks.length) return <p className="text-xs text-neutral-400">Vazifa yo‘q.</p>;
  return (
    <ul className="divide-y divide-neutral-100">
      {tasks.map(t => (
        <li key={t.id} className="flex items-start gap-3 py-2">
          <button onClick={() => toggle(t)} className="mt-0.5" title={t.status === 'DONE' ? 'Qayta ochish' : 'Bajarildi'}>
            {t.status === 'DONE' ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <Circle className="h-5 w-5 text-neutral-400 hover:text-emerald-600" />}
          </button>
          <div className="flex-1">
            <p className={`text-sm ${t.status === 'DONE' ? 'text-neutral-400 line-through' : 'text-neutral-900'}`}>{t.title} {t.priority === 'HIGH' && <span className="ml-1 rounded bg-red-100 px-1.5 text-[10px] font-bold text-red-700">muhim</span>}</p>
            <p className="text-[11px] text-neutral-500">{[t.customer_name, t.deal_title, showAssignee ? `mas’ul: ${t.assignee_name}` : null, t.description].filter(Boolean).join(' · ')}</p>
          </div>
          <span className={`whitespace-nowrap text-[11px] ${t.overdue ? 'font-bold text-red-600' : 'text-neutral-500'}`}>{t.due_date || 'muddatsiz'}</span>
          <button onClick={() => remove(t)} title="O‘chirish" className="text-neutral-300 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
        </li>
      ))}
    </ul>
  );
};

// ---------------- Tasks ----------------
const TaskForm: React.FC<{ users: { id: string; full_name: string }[]; seesAll: boolean; customer?: { id: string; name: string } | null; onSaved: () => void; onError: (e: string) => void }> = ({ users, seesAll, customer, onSaved, onError }) => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [due, setDue] = useState(localToday());
  const [priority, setPriority] = useState('NORMAL');
  const [assignee, setAssignee] = useState('');
  const [cust, setCust] = useState<{ id: string; name: string } | null>(customer || null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.crm.createTask({ title, description, due_date: due || null, priority, assignee_user_id: assignee || undefined, customer_id: cust?.id || null });
      setTitle(''); setDescription(''); onSaved();
    } catch (err: any) { onError(err.message); }
  };
  return (
    <form onSubmit={submit} className="grid grid-cols-1 gap-2 md:grid-cols-6">
      <input required className={`${input} md:col-span-2`} placeholder="Vazifa (masalan: qarzni eslatish)" value={title} onChange={e => setTitle(e.target.value)} />
      <input type="date" className={input} value={due} onChange={e => setDue(e.target.value)} />
      <select className={input} value={priority} onChange={e => setPriority(e.target.value)}>{Object.entries(PRIORITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      {seesAll ? (
        <select className={input} value={assignee} onChange={e => setAssignee(e.target.value)}><option value="">Mas’ul: o‘zim</option>{users.map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}</select>
      ) : <div />}
      <button className={`${btn} justify-center bg-emerald-600 text-white hover:bg-emerald-700`}><Plus className="h-3.5 w-3.5" />Qo‘shish</button>
      {!customer && <div className="md:col-span-3"><CustomerPicker value={cust} onChange={setCust} /></div>}
      <input className={`${input} ${customer ? 'md:col-span-6' : 'md:col-span-3'}`} placeholder="Izoh (ixtiyoriy)" value={description} onChange={e => setDescription(e.target.value)} />
    </form>
  );
};

const TasksTab: React.FC<{ scope: string; users: any[]; seesAll: boolean; onError: (e: string) => void; onSaved: () => void }> = ({ scope, users, seesAll, onError, onSaved }) => {
  const [filter, setFilter] = useState('ACTIVE');
  const [tasks, setTasks] = useState<any[]>([]);
  const [q, setQ] = useState('');
  const [priority, setPriority] = useState('');
  const [assignee, setAssignee] = useState('');
  const [dueFrom, setDueFrom] = useState('');
  const [dueTo, setDueTo] = useState('');
  const load = () => api.crm.tasks({ scope, ...(filter === 'overdue' ? { due: 'overdue' } : filter === 'ALL' ? {} : { status: filter }) }).then(r => setTasks(r.tasks)).catch(e => onError(e.message));
  useEffect(() => { load(); }, [scope, filter]);
  const assignees = Array.from(new Set(tasks.map(t => t.assignee_name).filter(Boolean))).sort() as string[];
  const visible = tasks.filter(t =>
    matchesSearch(t, q, ['title', 'description', 'customer_name', 'deal_title', 'assignee_name']) &&
    isPicked(priority, t.priority) && isPicked(assignee, t.assignee_name) && inDateRange(t.due_date, dueFrom, dueTo)
  );
  const filterLabel: Record<string, string> = { ACTIVE: 'ochiq', overdue: 'kechikkan', DONE: 'bajarilgan', ALL: 'hammasi' };
  const exportTasks = () => exportTableXlsx({
    fileName: 'CRM_vazifalar',
    title: 'CRM vazifalari',
    columns: [
      { header: 'Vazifa', key: 'title', width: 36 }, { header: 'Mijoz', key: 'customer_name', width: 26 }, { header: 'Bitim', key: 'deal_title', width: 20 },
      { header: 'Mas’ul', key: 'assignee_name', width: 20 }, { header: 'Muhimlik', key: 'priority_label', width: 10 }, { header: 'Muddat', key: 'due_date', type: 'date' },
      { header: 'Holat', key: 'status_label', width: 12 }, { header: 'Izoh', key: 'description', width: 40 }
    ],
    rows: visible.map(t => ({ ...t, priority_label: PRIORITY_LABEL[t.priority] || t.priority, status_label: t.status === 'DONE' ? 'Bajarilgan' : t.overdue ? 'Kechikkan' : 'Ochiq' })),
    filters: [filterLabel[filter], q && `qidiruv: "${q}"`, priority && `muhimlik: ${picked(priority).map(p => PRIORITY_LABEL[p]).join(', ')}`, assignee && `mas’ul: ${pickedLabels(assignee)}`, (dueFrom || dueTo) && `muddat: ${dueFrom || '…'} — ${dueTo || '…'}`]
  });
  return (
    <div className="space-y-4">
      <div className={card}><h2 className="mb-2 text-sm font-bold">Yangi vazifa</h2><TaskForm users={users} seesAll={seesAll} onSaved={() => { load(); onSaved(); }} onError={onError} /></div>
      <div className={card}>
        <div className="mb-2 flex flex-wrap gap-1 text-xs">
          {[['ACTIVE', 'Ochiq'], ['overdue', 'Kechikkan'], ['DONE', 'Bajarilgan'], ['ALL', 'Hammasi']].map(([k, v]) => <button key={k} onClick={() => setFilter(k)} className={`rounded-md px-2.5 py-1 font-semibold ${filter === k ? 'bg-neutral-900 text-white' : 'bg-neutral-100'}`}>{v}</button>)}
        </div>
        <div className="mb-3">
          <TableToolbar
            search={q} onSearch={setQ} searchPlaceholder="Vazifa, mijoz yoki mas’ul…"
            selects={[
              { label: 'Muhimlik', value: priority, onChange: setPriority, allLabel: 'Barcha muhimlik', options: Object.entries(PRIORITY_LABEL).map(([value, label]) => ({ value, label })) },
              ...(assignees.length > 1 ? [{ label: 'Mas’ul', value: assignee, onChange: setAssignee, allLabel: 'Barcha mas’ullar', options: assignees.map(a => ({ value: a, label: a })) }] : [])
            ]}
            dateFrom={dueFrom} dateTo={dueTo} onDateFrom={setDueFrom} onDateTo={setDueTo}
            count={visible.length}
            onReset={() => { setQ(''); setPriority(''); setAssignee(''); setDueFrom(''); setDueTo(''); }}
            onExport={exportTasks}
          />
        </div>
        <TaskList tasks={visible} onChanged={load} onError={onError} showAssignee={scope === 'all'} />
      </div>
    </div>
  );
};

// ---------------- Contact log ----------------
const ActivityForm: React.FC<{ customer?: { id: string; name: string } | null; dealId?: string; onSaved: () => void; onError: (e: string) => void }> = ({ customer, dealId, onSaved, onError }) => {
  const [cust, setCust] = useState<{ id: string; name: string } | null>(customer || null);
  const [type, setType] = useState('CALL');
  const [result, setResult] = useState('REACHED');
  const [note, setNote] = useState('');
  const [nextStep, setNextStep] = useState('');
  const [nextDate, setNextDate] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.crm.logActivity({ customer_id: cust?.id || null, deal_id: dealId || null, type, result, note, next_step: nextStep || null, next_action_date: nextDate || null });
      setNote(''); setNextStep(''); setNextDate(''); onSaved();
    } catch (err: any) { onError(err.message); }
  };
  return (
    <form onSubmit={submit} className="grid grid-cols-1 gap-2 md:grid-cols-6">
      {!customer && !dealId && <div className="md:col-span-2"><CustomerPicker value={cust} onChange={setCust} /></div>}
      <select className={input} value={type} onChange={e => setType(e.target.value)}>{Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      <select className={input} value={result} onChange={e => setResult(e.target.value)}>{Object.entries(RESULT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      <input required className={`${input} ${customer || dealId ? 'md:col-span-4' : 'md:col-span-2'}`} placeholder="Nima gaplashildi, natija" value={note} onChange={e => setNote(e.target.value)} />
      <input className={`${input} md:col-span-3`} placeholder="Keyingi qadam (ixtiyoriy) — sana bersangiz vazifa bo‘ladi" value={nextStep} onChange={e => setNextStep(e.target.value)} />
      <input type="date" min={localToday()} className={input} value={nextDate} onChange={e => setNextDate(e.target.value)} />
      <button className={`${btn} justify-center bg-emerald-600 text-white hover:bg-emerald-700 md:col-span-2`}><Phone className="h-3.5 w-3.5" />Yozib qo‘yish</button>
    </form>
  );
};

const ActivityList: React.FC<{ items: any[] }> = ({ items }) => {
  if (!items.length) return <p className="text-xs text-neutral-400">Hali yozuv yo‘q.</p>;
  return (
    <ul className="divide-y divide-neutral-100">
      {items.map(a => (
        <li key={a.id} className="py-2 text-xs">
          <div className="flex justify-between gap-2">
            <span className="font-semibold text-neutral-900">{TYPE_LABEL[a.type]} · {RESULT_LABEL[a.result]}{a.customer_name ? ` · ${a.customer_name}` : ''}{a.deal_title ? ` · ${a.deal_title}` : ''}</span>
            <span className="whitespace-nowrap text-neutral-400">{new Date(a.created_at).toLocaleString('uz-UZ')} · {a.user_name}</span>
          </div>
          <p className="text-neutral-700">{a.note}</p>
          {a.next_step && <p className="text-[11px] text-emerald-700">Keyingi qadam: {a.next_step}{a.next_action_date ? ` (${a.next_action_date})` : ''}</p>}
        </li>
      ))}
    </ul>
  );
};

const LogTab: React.FC<{ scope: string; onError: (e: string) => void; onSaved: () => void }> = ({ scope, onError, onSaved }) => {
  const [items, setItems] = useState<any[]>([]);
  const [from, setFrom] = useState(localToday().slice(0, 8) + '01');
  const [to, setTo] = useState('');
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [result, setResult] = useState('');
  const load = () => api.crm.activities({ scope, from }).then(r => setItems(r.activities)).catch(e => onError(e.message));
  useEffect(() => { load(); }, [scope, from]);
  const visible = items.filter(a =>
    matchesSearch(a, q, ['note', 'customer_name', 'deal_title', 'user_name', 'next_step']) &&
    isPicked(type, a.type) && isPicked(result, a.result) && inDateRange(a.created_at, undefined, to)
  );
  const exportLog = () => exportTableXlsx({
    fileName: 'CRM_aloqa_jurnali',
    title: 'CRM aloqa jurnali',
    columns: [
      { header: 'Vaqt', key: 'time', width: 18 }, { header: 'Turi', key: 'type_label', width: 12 }, { header: 'Natija', key: 'result_label', width: 18 },
      { header: 'Mijoz', key: 'customer_name', width: 26 }, { header: 'Bitim', key: 'deal_title', width: 20 }, { header: 'Xodim', key: 'user_name', width: 20 },
      { header: 'Izoh', key: 'note', width: 44 }, { header: 'Keyingi qadam', key: 'next_step', width: 30 }, { header: 'Keyingi sana', key: 'next_action_date', type: 'date' }
    ],
    rows: visible.map(a => ({ ...a, time: new Date(a.created_at).toLocaleString('ru-RU'), type_label: TYPE_LABEL[a.type] || a.type, result_label: RESULT_LABEL[a.result] || a.result })),
    filters: [`davr: ${from || '…'} — ${to || '…'}`, q && `qidiruv: "${q}"`, type && picked(type).map(x => TYPE_LABEL[x]).join(', '), result && picked(result).map(x => RESULT_LABEL[x]).join(', ')]
  });
  return (
    <div className="space-y-4">
      <div className={card}><h2 className="mb-2 text-sm font-bold">Qo‘ng‘iroq yoki tashrifni yozish</h2><ActivityForm onSaved={() => { load(); onSaved(); }} onError={onError} /></div>
      <div className={card}>
        <div className="mb-3">
          <TableToolbar
            search={q} onSearch={setQ} searchPlaceholder="Izoh, mijoz yoki xodim…"
            selects={[
              { label: 'Turi', value: type, onChange: setType, allLabel: 'Barcha turlar', options: Object.entries(TYPE_LABEL).map(([value, label]) => ({ value, label })) },
              { label: 'Natija', value: result, onChange: setResult, allLabel: 'Barcha natijalar', options: Object.entries(RESULT_LABEL).map(([value, label]) => ({ value, label })) }
            ]}
            dateFrom={from} dateTo={to} onDateFrom={setFrom} onDateTo={setTo}
            count={visible.length}
            onReset={() => { setQ(''); setType(''); setResult(''); setTo(''); }}
            onExport={exportLog}
          />
        </div>
        <ActivityList items={visible} />
      </div>
    </div>
  );
};

// ---------------- Pipeline ----------------
const PipelineTab: React.FC<{ scope: string; users: any[]; seesAll: boolean; canCreate: boolean; onError: (e: string) => void; onSaved: () => void }> = ({ scope, users, seesAll, canCreate, onError, onSaved }) => {
  const [stages, setStages] = useState<any[]>([]);
  const [deals, setDeals] = useState<any[]>([]);
  const [summary, setSummary] = useState<any[]>([]);
  const [editing, setEditing] = useState<any | null>(null);
  const [showStages, setShowStages] = useState(false);
  const load = () => {
    api.crm.stages().then(r => setStages(r.stages)).catch(e => onError(e.message));
    api.crm.deals({ scope }).then(r => { setDeals(r.deals); setSummary(r.summary); }).catch(e => onError(e.message));
  };
  useEffect(() => { load(); }, [scope]);

  const move = async (deal: any, stageId: string) => {
    const stage = stages.find(s => s.id === stageId);
    let lost_reason: string | undefined;
    if (stage?.kind === 'LOST') {
      lost_reason = (prompt('Nega yutqazildi? (sabab)') || '').trim();
      if (!lost_reason) return;
    }
    try { await api.crm.updateDeal(deal.id, { stage_id: stageId, ...(lost_reason ? { lost_reason } : {}) }); load(); onSaved(); } catch (e: any) { onError(e.message); }
  };

  const [q, setQ] = useState('');
  const [owner, setOwner] = useState('');
  const owners = Array.from(new Set(deals.map(d => d.owner_name).filter(Boolean))).sort() as string[];
  // The board shows filtered deals; stage totals stay the server's (all deals in scope).
  const visibleDeals = deals.filter(d => matchesSearch(d, q, ['title', 'customer_name', 'company_name', 'contact_name', 'contact_phone']) && isPicked(owner, d.owner_name));
  const exportDeals = () => exportTableXlsx({
    fileName: 'CRM_bitimlar',
    title: 'CRM bitimlari (sotuv voronkasi)',
    columns: [
      { header: 'Bitim', key: 'title', width: 30 }, { header: 'Mijoz / kompaniya', key: 'client', width: 28 }, { header: 'Telefon', key: 'contact_phone', width: 15 },
      { header: 'Bosqich', key: 'stage_name', width: 16 }, { header: 'Holat', key: 'status_label', width: 11 }, { header: 'Summa', key: 'amount', type: 'money', total: true },
      { header: 'Mas’ul', key: 'owner_name', width: 20 }, { header: 'Kutilgan yopilish', key: 'expected_close_date', type: 'date' }, { header: 'Yutqazish sababi', key: 'lost_reason', width: 30 }
    ],
    rows: visibleDeals.map(d => ({
      ...d, client: d.customer_name || d.company_name || d.contact_name,
      stage_name: d.stage_name || stages.find(s => s.id === d.stage_id)?.name,
      status_label: d.status === 'WON' ? 'Yutildi' : d.status === 'LOST' ? 'Yutqazildi' : 'Ochiq'
    })),
    filters: [q && `qidiruv: "${q}"`, owner && `mas’ul: ${pickedLabels(owner)}`]
  });

  const openStages = stages.filter(s => s.kind === 'OPEN');
  const closed = stages.filter(s => s.kind !== 'OPEN');
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {canCreate && <button onClick={() => setEditing({})} className={`${btn} bg-emerald-600 text-white hover:bg-emerald-700`}><Plus className="h-3.5 w-3.5" />Yangi bitim / lid</button>}
        {seesAll && <button onClick={() => setShowStages(s => !s)} className={`${btn} bg-neutral-100 hover:bg-neutral-200`}>Bosqichlarni sozlash</button>}
      </div>
      <TableToolbar
        search={q} onSearch={setQ} searchPlaceholder="Bitim, mijoz yoki telefon…"
        selects={owners.length > 1 ? [{ label: 'Mas’ul', value: owner, onChange: setOwner, allLabel: 'Barcha mas’ullar', options: owners.map(o => ({ value: o, label: o })) }] : []}
        count={visibleDeals.length}
        onReset={() => { setQ(''); setOwner(''); }}
        onExport={exportDeals}
      />
      {showStages && <StageEditor stages={stages} onChanged={load} onError={onError} />}
      <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.max(1, openStages.length)}, minmax(200px, 1fr))`, overflowX: 'auto' }}>
        {openStages.map(stage => {
          const s = summary.find(x => x.stage_id === stage.id);
          return (
            <div key={stage.id} className="min-w-[200px] rounded-2xl border border-neutral-200 bg-neutral-50 p-3">
              <div className="mb-2"><p className="text-xs font-bold">{stage.name} <span className="font-normal text-neutral-400">{stage.probability}%</span></p><p className="text-[11px] text-neutral-500">{s?.count || 0} ta · {money(s?.amount)}</p></div>
              <div className="space-y-2">
                {visibleDeals.filter(d => d.stage_id === stage.id).map(d => <DealCard key={d.id} deal={d} stages={stages} onMove={move} onEdit={() => setEditing(d)} />)}
              </div>
            </div>
          );
        })}
      </div>
      <div className={card}>
        <h3 className="mb-2 text-sm font-bold">Yopilgan bitimlar</h3>
        <div className="flex flex-wrap gap-4 text-xs">{closed.map(stage => { const s = summary.find(x => x.stage_id === stage.id); return <span key={stage.id}><b>{stage.name}:</b> {s?.count || 0} ta · {money(s?.amount)}</span>; })}</div>
        <ul className="mt-2 divide-y divide-neutral-100 text-xs">
          {visibleDeals.filter(d => d.status !== 'OPEN').slice(0, 30).map(d => <li key={d.id} className="flex justify-between py-1.5"><span>{d.title} · {d.customer_name || d.company_name || d.contact_name}{d.lost_reason ? ` — ${d.lost_reason}` : ''}</span><span className={d.status === 'WON' ? 'text-emerald-700' : 'text-red-600'}>{d.stage_name} · {money(d.amount)}</span></li>)}
        </ul>
      </div>
      {editing && <DealModal deal={editing} stages={stages} users={users} seesAll={seesAll} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); onSaved(); }} onError={onError} />}
    </div>
  );
};

const DealCard: React.FC<{ deal: any; stages: any[]; onMove: (d: any, s: string) => void; onEdit: () => void }> = ({ deal, stages, onMove, onEdit }) => (
  <div className="rounded-xl border border-neutral-200 bg-white p-2.5 text-xs shadow-2xs">
    <button onClick={onEdit} className="block w-full text-left">
      <p className="font-semibold text-neutral-900">{deal.title}</p>
      <p className="text-[11px] text-neutral-500">{deal.customer_name || deal.company_name || deal.contact_name || '—'}{deal.contact_phone ? ` · ${deal.contact_phone}` : ''}</p>
      <p className="mt-1 font-bold text-emerald-700">{money(deal.amount)}</p>
      <p className="text-[10px] text-neutral-400">{deal.owner_name}{deal.expected_close_date ? ` · ${deal.expected_close_date}` : ''}</p>
    </button>
    <select className="mt-1.5 w-full rounded border border-neutral-200 px-1 py-0.5 text-[11px]" value={deal.stage_id} onChange={e => onMove(deal, e.target.value)}>
      {stages.map(s => <option key={s.id} value={s.id}>→ {s.name}</option>)}
    </select>
  </div>
);

const DealModal: React.FC<{ deal: any; stages: any[]; users: any[]; seesAll: boolean; onClose: () => void; onSaved: () => void; onError: (e: string) => void }> = ({ deal, stages, users, seesAll, onClose, onSaved, onError }) => {
  const [form, setForm] = useState<any>({ title: '', amount: 0, stage_id: stages.find(s => s.kind === 'OPEN')?.id, ...deal });
  const [cust, setCust] = useState<{ id: string; name: string } | null>(deal.customer_id ? { id: deal.customer_id, name: deal.customer_name } : null);
  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = { title: form.title, amount: Number(form.amount) || 0, stage_id: form.stage_id, customer_id: cust?.id || null, contact_name: form.contact_name || null, contact_phone: form.contact_phone || null, company_name: form.company_name || null, source: form.source || null, expected_close_date: form.expected_close_date || null, note: form.note || null, lost_reason: form.lost_reason || null, ...(seesAll && form.owner_user_id ? { owner_user_id: form.owner_user_id } : {}) };
    try { deal.id ? await api.crm.updateDeal(deal.id, body) : await api.crm.createDeal(body); onSaved(); } catch (err: any) { onError(err.message); }
  };
  const remove = async () => {
    if (!confirm('Bitim o‘chirilsinmi?')) return;
    try { await api.crm.deleteDeal(deal.id); onSaved(); } catch (err: any) { onError(err.message); }
  };
  const stage = stages.find(s => s.id === form.stage_id);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <form onSubmit={save} className="max-h-[90vh] w-full max-w-lg space-y-2 overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl">
        <div className="flex items-center justify-between"><h2 className="text-sm font-bold">{deal.id ? 'Bitim' : 'Yangi bitim / lid'}</h2><button type="button" onClick={onClose}><X className="h-4 w-4" /></button></div>
        <input required className={input} placeholder="Nomi (masalan: Chilonzor do‘koni — oylik ta’minot)" value={form.title} onChange={e => set('title', e.target.value)} />
        <p className="text-[11px] font-semibold text-neutral-600">Mavjud mijoz</p>
        <CustomerPicker value={cust} onChange={setCust} />
        {!cust && (
          <div className="grid grid-cols-2 gap-2">
            <input className={input} placeholder="Kontakt ismi" value={form.contact_name || ''} onChange={e => set('contact_name', e.target.value)} />
            <input className={input} placeholder="Telefon" value={form.contact_phone || ''} onChange={e => set('contact_phone', e.target.value)} />
            <input className={`${input} col-span-2`} placeholder="Tashkilot / do‘kon nomi" value={form.company_name || ''} onChange={e => set('company_name', e.target.value)} />
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <label className="text-[11px] font-semibold">Summa<input type="number" min={0} className={input} value={form.amount} onChange={e => set('amount', e.target.value)} /></label>
          <label className="text-[11px] font-semibold">Bosqich<select className={input} value={form.stage_id} onChange={e => set('stage_id', e.target.value)}>{stages.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
          <label className="text-[11px] font-semibold">Kutilgan yopilish<input type="date" className={input} value={form.expected_close_date || ''} onChange={e => set('expected_close_date', e.target.value)} /></label>
          <label className="text-[11px] font-semibold">Manba<input className={input} placeholder="Tavsiya, Instagram, agent..." value={form.source || ''} onChange={e => set('source', e.target.value)} /></label>
          {seesAll && <label className="col-span-2 text-[11px] font-semibold">Mas’ul<select className={input} value={form.owner_user_id || ''} onChange={e => set('owner_user_id', e.target.value)}><option value="">{deal.owner_name || 'O‘zim'}</option>{users.map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}</select></label>}
        </div>
        {stage?.kind === 'LOST' && <input required className={input} placeholder="Yutqazish sababi" value={form.lost_reason || ''} onChange={e => set('lost_reason', e.target.value)} />}
        <textarea className={input} rows={2} placeholder="Izoh" value={form.note || ''} onChange={e => set('note', e.target.value)} />
        <div className="flex justify-between pt-1">
          {deal.id && seesAll ? <button type="button" onClick={remove} className={`${btn} text-red-600 hover:bg-red-50`}><Trash2 className="h-3.5 w-3.5" />O‘chirish</button> : <span />}
          <button className={`${btn} bg-emerald-600 text-white hover:bg-emerald-700`}>Saqlash</button>
        </div>
        {deal.id && <div className="border-t pt-2"><p className="mb-1 text-[11px] font-semibold">Bu bitim bo‘yicha aloqa</p><ActivityForm dealId={deal.id} onSaved={onSaved} onError={onError} /></div>}
      </form>
    </div>
  );
};

const StageEditor: React.FC<{ stages: any[]; onChanged: () => void; onError: (e: string) => void }> = ({ stages, onChanged, onError }) => {
  const [draft, setDraft] = useState({ name: '', probability: 50, kind: 'OPEN' });
  const save = async (s: any) => { try { await api.crm.saveStage(s); onChanged(); } catch (e: any) { onError(e.message); } };
  const remove = async (id: string) => { try { await api.crm.deleteStage(id); onChanged(); } catch (e: any) { onError(e.message); } };
  return (
    <div className={card}>
      <h3 className="mb-2 text-sm font-bold">Voronka bosqichlari</h3>
      <p className="mb-2 text-[11px] text-neutral-500">Biznesingizga mos nomlar va ehtimollarni kiriting. "Yutildi" va "Yutqazildi" turidagi bosqichlar bitimni yopadi.</p>
      <div className="space-y-1.5">
        {stages.map(s => (
          <div key={s.id} className="grid grid-cols-12 items-center gap-2 text-xs">
            <input className={`${input} col-span-1`} type="number" defaultValue={s.sort_order} onBlur={e => Number(e.target.value) !== s.sort_order && save({ ...s, sort_order: Number(e.target.value) })} title="Tartib" />
            <input className={`${input} col-span-5`} defaultValue={s.name} onBlur={e => e.target.value !== s.name && save({ ...s, name: e.target.value })} />
            <input className={`${input} col-span-2`} type="number" min={0} max={100} defaultValue={s.probability} onBlur={e => Number(e.target.value) !== s.probability && save({ ...s, probability: Number(e.target.value) })} />
            <select className={`${input} col-span-3`} value={s.kind} onChange={e => save({ ...s, kind: e.target.value })}><option value="OPEN">Jarayonda</option><option value="WON">Yutildi</option><option value="LOST">Yutqazildi</option></select>
            <button onClick={() => remove(s.id)} className="col-span-1 text-neutral-400 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
          </div>
        ))}
        <div className="grid grid-cols-12 items-center gap-2 border-t pt-2 text-xs">
          <input className={`${input} col-span-6`} placeholder="Yangi bosqich nomi" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} />
          <input className={`${input} col-span-2`} type="number" min={0} max={100} value={draft.probability} onChange={e => setDraft({ ...draft, probability: Number(e.target.value) })} />
          <select className={`${input} col-span-3`} value={draft.kind} onChange={e => setDraft({ ...draft, kind: e.target.value })}><option value="OPEN">Jarayonda</option><option value="WON">Yutildi</option><option value="LOST">Yutqazildi</option></select>
          <button onClick={() => draft.name && save(draft).then(() => setDraft({ name: '', probability: 50, kind: 'OPEN' }))} className="col-span-1 text-emerald-600"><Plus className="h-4 w-4" /></button>
        </div>
      </div>
    </div>
  );
};

// ---------------- Customer 360 ----------------
const CustomerSearch: React.FC<{ onOpen: (id: string) => void }> = ({ onOpen }) => {
  const [q, setQ] = useState('');
  const [list, setList] = useState<any[]>([]);
  useEffect(() => { const t = setTimeout(() => api.crm.customers(q).then(r => setList(r.customers)).catch(() => setList([])), 250); return () => clearTimeout(t); }, [q]);
  return (
    <div className={card}>
      <div className="relative mb-3"><Search className="absolute left-2.5 top-2 h-4 w-4 text-neutral-400" /><input autoFocus className={`${input} pl-8`} placeholder="Mijoz nomi, telefoni yoki kodi" value={q} onChange={e => setQ(e.target.value)} /></div>
      <ul className="divide-y divide-neutral-100">
        {list.map(c => <li key={c.id}><button onClick={() => onOpen(c.id)} className="flex w-full justify-between py-2 text-left text-xs hover:bg-neutral-50"><span className="font-semibold">{c.name} <span className="font-normal text-neutral-400">{c.code} · {c.phone}</span></span><span className={c.debt > 0 ? 'font-semibold text-red-600' : 'text-neutral-400'}>{money(c.debt)}</span></button></li>)}
        {!list.length && <li className="py-2 text-xs text-neutral-400">Topilmadi.</li>}
      </ul>
    </div>
  );
};

const Customer360: React.FC<{ id: string; users: any[]; seesAll: boolean; onBack: () => void; onError: (e: string) => void; onFlash: (t: string) => void }> = ({ id, users, seesAll, onBack, onError, onFlash }) => {
  const [data, setData] = useState<any>(null);
  const [tags, setTags] = useState('');
  const load = () => api.crm.overview(id).then(r => { setData(r); setTags((r.customer.tags || []).join(', ')); }).catch(e => onError(e.message));
  useEffect(() => { load(); }, [id]);
  const saveCrm = async (patch: any) => { try { await api.crm.updateCustomer(id, patch); onFlash('Saqlandi.'); load(); } catch (e: any) { onError(e.message); } };
  const ref = useMemo(() => data ? { id: data.customer.id, name: data.customer.name } : null, [data]);
  if (!data) return <div className={card}><RefreshCw className="h-4 w-4 animate-spin" /></div>;
  const c = data.customer, s = data.stats, d = data.debt;
  return (
    <div className="space-y-4">
      <button onClick={onBack} className={`${btn} bg-neutral-100 hover:bg-neutral-200`}>← Qidiruvga qaytish</button>
      <div className={card}>
        <div className="flex flex-col justify-between gap-2 md:flex-row">
          <div>
            <h2 className="text-lg font-bold text-neutral-900">{c.name}</h2>
            <p className="text-xs text-neutral-500">{c.code} · {c.phone ? <a href={`tel:${c.phone}`} className="text-blue-700">{c.phone}</a> : 'telefon yo‘q'} · {c.address || 'manzil yo‘q'}</p>
            <p className="text-xs text-neutral-500">Agent: {c.agent_name || '—'} · Mas’ul: {c.owner_name || '—'}</p>
          </div>
          <div className="text-right">
            <p className={`text-xl font-black ${d.total > 0 ? 'text-red-600' : 'text-emerald-600'}`}>{money(d.total)}</p>
            <p className="text-[11px] text-neutral-500">qarz{d.credit_limit ? ` · limit ${money(d.credit_limit)}` : ''}{d.over_limit ? ' · LIMITDAN OSHGAN' : ''}{d.prepaid ? ` · avans ${money(d.prepaid)}` : ''}</p>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs md:grid-cols-5">
          <div><p className="text-neutral-500">90 kunlik savdo</p><p className="font-bold">{money(s.sales_90d)} · {s.orders_90d} ta</p></div>
          <div><p className="text-neutral-500">Jami savdo</p><p className="font-bold">{money(s.sales_total)} · {s.orders_total} ta</p></div>
          <div><p className="text-neutral-500">O‘rtacha buyurtma</p><p className="font-bold">{money(s.avg_order)}</p></div>
          <div><p className="text-neutral-500">Oxirgi buyurtma</p><p className={`font-bold ${s.days_since_last_order > 30 ? 'text-red-600' : ''}`}>{s.last_order_date || '—'}{s.days_since_last_order != null ? ` (${s.days_since_last_order} kun)` : ''}</p></div>
          <div><p className="text-neutral-500">Qarz yoshi</p><p className="font-bold">0–30: {money(d.aging.d0_30)} · 90+: {money(d.aging.d90_plus)}{d.aging.unknown ? ` · noma’lum: ${money(d.aging.unknown)}` : ''}</p></div>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
          <label className="text-[11px] font-semibold md:col-span-2">Teglar (vergul bilan: VIP, ulgurji, muammoli)
            <div className="flex gap-2"><input className={input} value={tags} onChange={e => setTags(e.target.value)} /><button onClick={() => saveCrm({ tags: tags.split(',').map(t => t.trim()).filter(Boolean) })} className={`${btn} bg-neutral-900 text-white`}>Saqlash</button></div>
          </label>
          {seesAll && <label className="text-[11px] font-semibold">Mas’ul xodim
            <select className={input} value={c.owner_user_id || ''} onChange={e => saveCrm({ owner_user_id: e.target.value || null })}><option value="">— belgilanmagan —</option>{users.map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}</select>
          </label>}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className={card}><h3 className="mb-2 text-sm font-bold">Aloqa yozish</h3><ActivityForm customer={ref} onSaved={() => { onFlash('Aloqa yozildi.'); load(); }} onError={onError} />
          <h3 className="mb-1 mt-4 text-sm font-bold">Aloqa tarixi</h3><ActivityList items={data.activities} /></div>
        <div className="space-y-4">
          <div className={card}><h3 className="mb-2 text-sm font-bold">Vazifalar</h3><TaskForm users={users} seesAll={seesAll} customer={ref} onSaved={() => { onFlash('Vazifa saqlandi.'); load(); }} onError={onError} /><div className="mt-2"><TaskList tasks={data.tasks} onChanged={load} onError={onError} showAssignee /></div></div>
          <div className={card}><h3 className="mb-2 text-sm font-bold">Bitimlar</h3>{data.deals.length ? <ul className="text-xs">{data.deals.map((x: any) => <li key={x.id} className="flex justify-between py-1"><span>{x.title}</span><span>{x.stage_name} · {money(x.amount)}</span></li>)}</ul> : <p className="text-xs text-neutral-400">Bitim yo‘q.</p>}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className={card}><h3 className="mb-2 text-sm font-bold">Oxirgi buyurtmalar</h3>
          <table className="min-w-full text-xs"><tbody className="divide-y divide-neutral-100">{data.orders.map((o: any) => <tr key={o.id}><td className="py-1">{o.order_date}</td><td className="py-1">{o.order_number}</td><td className="py-1">{o.status === 'DELIVERED' ? 'yetkazildi' : o.status === 'PENDING' ? 'kutilmoqda' : 'bekor'}</td><td className="py-1 text-right">{money(o.total_sales)}</td></tr>)}</tbody></table>
        </div>
        <div className={card}><h3 className="mb-2 text-sm font-bold">Qarz daftari (oxirgi 30)</h3>
          <table className="min-w-full text-xs"><tbody className="divide-y divide-neutral-100">{data.ledger.map((t: any) => <tr key={t.id}><td className="py-1">{t.date}</td><td className="py-1">{t.comment || t.reference_type}</td><td className={`py-1 text-right ${t.transaction_type === 'DEBIT' ? 'text-red-600' : 'text-emerald-700'}`}>{t.transaction_type === 'DEBIT' ? '+' : '−'}{money(t.amount)}</td></tr>)}</tbody></table>
        </div>
      </div>
    </div>
  );
};
