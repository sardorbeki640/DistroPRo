import React, { useEffect, useMemo, useState } from 'react';
import { Check, MapPin, Plus, ScanFace, Trash2, X } from 'lucide-react';
import { api, type PenaltyPostsView, type TelegramAccountsView } from '../../services/api.ts';
import { localToday } from '../../utils/date';
import { TableToolbar, matchesSearch, exportTableXlsx, isPicked, picked } from '../common/TableToolbar.tsx';
import { FaceCapture } from './FaceCapture.tsx';
import { loadFaceApi, samplesFromPhotos } from './faceEngine.ts';
import { useDistribution } from '../../hooks/useDistribution.ts';
import { ZoneMap } from './ZoneMap.tsx';
import { MultiSelect, joinPicked } from '../common/MultiSelect.tsx';

type Tab = 'report' | 'violations' | 'review' | 'enroll' | 'settings';
const DAY_STATUS: Record<string, { label: string; cls: string }> = {
  PRESENT: { label: 'Keldi', cls: 'bg-emerald-100 text-emerald-800' },
  ABSENT: { label: 'Kelmadi', cls: 'bg-rose-100 text-rose-800' },
  REVIEW: { label: 'Tekshiruvda', cls: 'bg-amber-100 text-amber-800' },
  EXCUSED: { label: 'Uzrli', cls: 'bg-blue-100 text-blue-800' },
  WAITING: { label: 'Hali boshlamadi', cls: 'bg-neutral-100 text-neutral-600' },
  OFF: { label: 'Dam olish', cls: 'bg-neutral-100 text-neutral-600' }
};
const VIOLATION_TYPES: [string, string][] = [['LATE', 'Kech qolish'], ['ABSENT', 'Ishga chiqmaslik'], ['NASIYA_MISUSE', 'Nasiya pulini ishlatish'], ['TASK_LATE', 'Vazifa bajarilmadi'], ['OTHER', 'Boshqa']];
const WEEKDAYS = ['Du', 'Se', 'Ch', 'Pa', 'Ju', 'Sh', 'Ya'];

/** Coordinates from what Google Maps gives: "41.0012, 71.6721", a link with @lat,lng / q=lat,lng / !3dlat!4dlng. */
export function parseCoords(text: string): { lat: number; lng: number } | null {
  let t = text || '';
  try { t = decodeURIComponent(t); } catch { /* not encoded */ }
  const m = /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/.exec(t) || /@(-?\d+\.\d+),\s*(-?\d+\.\d+)/.exec(t) || /(-?\d{1,2}\.\d{3,})\s*[,; ]\s*(-?\d{1,3}\.\d{3,})/.exec(t);
  if (!m) return null;
  const lat = Number(m[1]), lng = Number(m[2]);
  if (!(Math.abs(lat) <= 90 && Math.abs(lng) <= 180)) return null;
  return { lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)) };
}
const SOURCE_LABEL: Record<string, string> = { FACE_ID: 'Face ID', TELEGRAM_VIDEO: 'dumaloq video', SALESDOC_VISIT: 'birinchi vizit' };
const money = (n: number) => Math.round(n || 0).toLocaleString('ru-RU');
const input = 'mt-1 w-full rounded-lg border border-neutral-300 px-2.5 py-1.5 text-xs focus:border-neutral-900 focus:outline-hidden';

/** Managers: Face ID attendance report, review of doubtful checks, enrollment and settings. */
export const AttendanceManager: React.FC<{ employees: any[] }> = ({ employees }) => {
  const [tab, setTab] = useState<Tab>('report');
  const [isAdmin, setIsAdmin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const flash = (t: string) => { setNotice(t); setTimeout(() => setNotice(null), 5000); };
  useEffect(() => { api.getMe().then(r => setIsAdmin(!!r.user?.is_super_admin || !!r.user?.roles?.some((role: any) => role.name === 'ADMIN'))).catch(() => setIsAdmin(false)); }, []);
  const tabs: [Tab, string][] = [['report', 'Hisobot'], ['violations', 'Qoidabuzarliklar'], ['review', 'Tekshirish'], ['enroll', 'Ro‘yxatga olish'], ...(isAdmin ? [['settings', 'Admin sozlamalari']] as [Tab, string][] : [])];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1">
        {tabs.map(([id, label]) => <button key={id} onClick={() => { setTab(id); setError(null); }} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${tab === id ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-700'}`}>{label}</button>)}
      </div>
      {error && <div className="flex justify-between rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700"><span>{error}</span><button onClick={() => setError(null)}><X className="h-3.5 w-3.5" /></button></div>}
      {notice && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">{notice}</div>}
      {tab === 'report' && <ReportTab employees={employees} isAdmin={isAdmin} onError={setError} onFlash={flash} />}
      {tab === 'violations' && <ViolationsTab employees={employees} isAdmin={isAdmin} onError={setError} onFlash={flash} />}
      {tab === 'review' && <ReviewTab onError={setError} onFlash={flash} />}
      {tab === 'enroll' && <EnrollTab employees={employees} onError={setError} onFlash={flash} />}
      {tab === 'settings' && isAdmin && <SettingsTab employees={employees} onError={setError} onFlash={flash} />}
    </div>
  );
};

const ReportTab: React.FC<{ employees: any[]; isAdmin: boolean; onError: (e: string) => void; onFlash: (t: string) => void }> = ({ isAdmin, onError, onFlash }) => {
  const [from, setFrom] = useState(localToday().slice(0, 8) + '01');
  const [to, setTo] = useState(localToday());
  const [rows, setRows] = useState<any[]>([]);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [mode, setMode] = useState('RULES');
  const [excuseTarget, setExcuseTarget] = useState<any | null>(null);
  const [excuseReason, setExcuseReason] = useState('');
  const [excuseBusy, setExcuseBusy] = useState(false);
  const load = () => api.attendance.report(from, to).then(r => { setRows(r.rows); setMode(r.mode); }).catch(e => onError(e.message));
  useEffect(() => { load(); }, [from, to]);
  const visible = rows.filter(r => matchesSearch(r, q, ['employee_name', 'position']) && (!status || picked(status).some(s => r.status === s || (s === 'LATE' && r.late_minutes > 0))));
  const totals = useMemo(() => ({
    late: visible.filter(r => r.late_minutes > 0).length, absent: visible.filter(r => r.status === 'ABSENT').length, penalty: visible.reduce((s, r) => s + r.penalty, 0),
    percent: Math.round(visible.reduce((s, r) => s + (r.penalty_percent || 0), 0) * 100) / 100
  }), [visible]);
  const rulesMode = mode === 'RULES';
  const excuse = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!excuseTarget || excuseReason.trim().length < 3) { onError('Sababni kamida 3 ta belgi bilan yozing.'); return; }
    setExcuseBusy(true);
    try {
      await api.attendance.excuse(excuseTarget.employee_id, excuseTarget.date, excuseTarget.status !== 'EXCUSED', excuseReason.trim());
      onFlash(excuseTarget.status === 'EXCUSED' ? 'Uzr bekor qilindi.' : 'Xodim sababli qilindi.');
      setExcuseTarget(null); setExcuseReason(''); load();
    } catch (e: any) { onError(e.message); } finally { setExcuseBusy(false); }
  };
  return (
    <div className="space-y-3">
      <TableToolbar
        search={q} onSearch={setQ} searchPlaceholder="Xodim…"
        selects={[{ label: 'Holat', value: status, onChange: setStatus, allLabel: 'Barcha holatlar', options: [{ value: 'LATE', label: 'Kechikkanlar' }, ...Object.entries(DAY_STATUS).map(([value, s]) => ({ value, label: s.label }))] }]}
        dateFrom={from} dateTo={to} onDateFrom={setFrom} onDateTo={setTo}
        count={visible.length}
        onReset={() => { setQ(''); setStatus(''); }}
        onExport={() => exportTableXlsx({
          fileName: 'Davomat', title: 'Davomat (Face ID)',
          columns: [
            { header: 'Sana', key: 'date', type: 'date' }, { header: 'Xodim', key: 'employee_name', width: 26 }, { header: 'Lavozim', key: 'position', width: 16 },
            { header: 'Holat', key: 'status_label', width: 12 }, { header: 'Keldi', key: 'first_in', width: 8 }, { header: 'Ketdi', key: 'last_out', width: 8 },
            { header: 'Kechikish, daq', key: 'late_minutes', type: 'number', total: true }, { header: 'Erta ketish, daq', key: 'early_minutes', type: 'number', total: true },
            { header: 'Ishlagan, soat', key: 'hours', type: 'number', total: true },
            ...(rulesMode ? [{ header: 'Jarima, % oylikdan', key: 'penalty_percent', type: 'number' as const, total: true }, { header: 'Qoidabuzarlik', key: 'violation_text', width: 26 }] : [{ header: 'Jarima', key: 'penalty', type: 'money' as const, total: true }])
          ],
          rows: visible.map(r => ({ ...r, status_label: DAY_STATUS[r.status]?.label || r.status, hours: r.worked_minutes ? Number((r.worked_minutes / 60).toFixed(1)) : null, violation_text: (r.violations || []).join(', ') })),
          filters: [`davr: ${from} — ${to}`, q && `qidiruv: "${q}"`, status && picked(status).map(s => s === 'LATE' ? 'kechikkanlar' : DAY_STATUS[s]?.label).join(', ')]
        })}
      />
      <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-3 sm:gap-3">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3"><b className="text-lg text-amber-900">{totals.late}</b><div className="text-amber-800">kechikish</div></div>
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3"><b className="text-lg text-rose-900">{totals.absent}</b><div className="text-rose-800">kelmagan kun</div></div>
        {rulesMode
          ? <div className="rounded-xl border border-neutral-200 bg-white p-3"><b className="text-lg">{totals.percent}%</b><div className="text-neutral-600">jarima (oylikdan, jami)</div></div>
          : <div className="rounded-xl border border-neutral-200 bg-white p-3"><b className="text-lg">{money(totals.penalty)}</b><div className="text-neutral-600">jarima, so‘m</div></div>}
      </div>
      <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
        <table className="min-w-full text-xs">
          <thead className="bg-neutral-50 text-left text-neutral-500"><tr><th className="px-3 py-2">Sana</th><th className="px-3">Xodim</th><th className="px-3">Holat</th><th className="px-3">Keldi</th><th className="px-3">Ketdi</th><th className="px-3 text-right">Kechikish</th><th className="px-3 text-right">Erta</th><th className="px-3 text-right">Jarima</th><th /></tr></thead>
          <tbody className="divide-y divide-neutral-100">
            {visible.length === 0 ? <tr><td colSpan={9} className="px-3 py-6 text-center text-neutral-400">Ma’lumot yo‘q. Xodimlar Face ID ro‘yxatidan o‘tib, kabinetidan “Ishga keldim” qilganda shu yerda ko‘rinadi.</td></tr> : visible.map(r => (
              <tr key={r.date + r.employee_id}>
                <td className="px-3 py-1.5 font-mono">{r.date}</td>
                <td className="px-3 font-semibold">{r.employee_name}{r.group_name && <div className="text-[10px] font-normal text-neutral-400">{r.group_name}{r.source === 'SALESDOC_VISIT' ? ` · ${r.visits ?? 0} vizit` : ''}</div>}</td>
                <td className="px-3"><span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${DAY_STATUS[r.status]?.cls}`}>{DAY_STATUS[r.status]?.label}</span></td>
                <td className="px-3">{r.first_in || '—'}</td>
                <td className="px-3">{r.last_out || '—'}</td>
                <td className={`px-3 text-right ${r.late_minutes ? 'font-bold text-amber-700' : ''}`}>{r.late_minutes ? `${r.late_minutes} daq` : '—'}</td>
                <td className={`px-3 text-right ${r.early_minutes ? 'font-bold text-amber-700' : ''}`}>{r.early_minutes ? `${r.early_minutes} daq` : '—'}</td>
                <td className="px-3 text-right">{rulesMode ? (r.penalty_percent ? <span title={(r.violations || []).join(', ')} className="font-bold text-rose-700">{r.penalty_percent}%</span> : '—') : (r.penalty ? money(r.penalty) : '—')}</td>
                <td className="px-3 text-right">{isAdmin && (rulesMode ? (r.status === 'ABSENT' || r.status === 'EXCUSED' || r.late_minutes > 0) : (r.late_minutes || r.early_minutes || r.status === 'ABSENT' || r.status === 'EXCUSED')) && <button onClick={() => { setExcuseTarget(r); setExcuseReason(''); }} className="whitespace-nowrap text-[11px] font-semibold text-blue-700 hover:underline">{r.status === 'EXCUSED' ? 'Uzrni olish' : r.late_minutes > 0 && r.status !== 'ABSENT' ? 'Jarimani sababli qilish' : 'Sababli qilish'}</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {excuseTarget && <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-3 sm:p-4" role="dialog" aria-modal="true" aria-labelledby="excuse-title">
        <form onSubmit={excuse} className="w-full max-w-md space-y-3 rounded-2xl bg-white p-4 shadow-2xl sm:p-5">
          <div><h3 id="excuse-title" className="text-sm font-bold text-neutral-900">{excuseTarget.status === 'EXCUSED' ? 'Uzrli holatni bekor qilish' : 'Xodimni sababli deb belgilash'}</h3><p className="mt-1 text-xs text-neutral-500">{excuseTarget.employee_name} · {excuseTarget.date}</p></div>
          <label className="block text-xs font-semibold text-neutral-700">Sabab
            <textarea autoFocus required minLength={3} maxLength={300} rows={3} className="mt-1 w-full rounded-lg border border-neutral-300 p-2.5 text-sm focus:border-blue-500 focus:outline-none" value={excuseReason} onChange={e => setExcuseReason(e.target.value)} placeholder="Masalan: shifokor ko‘rigida bo‘ldi" />
          </label>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" disabled={excuseBusy} onClick={() => setExcuseTarget(null)} className="rounded-lg border border-neutral-300 px-4 py-2 text-xs font-semibold text-neutral-700">Bekor qilish</button>
            <button type="submit" disabled={excuseBusy || excuseReason.trim().length < 3} className="rounded-lg bg-blue-700 px-4 py-2 text-xs font-bold text-white disabled:opacity-50">{excuseBusy ? 'Saqlanmoqda…' : 'Saqlash'}</button>
          </div>
        </form>
      </div>}
    </div>
  );
};

/** The month's violations by the rule book: automatic (lateness, absence) and entered by hand, with their percent. */
const ViolationsTab: React.FC<{ employees: any[]; isAdmin: boolean; onError: (e: string) => void; onFlash: (t: string) => void }> = ({ employees, isAdmin, onError, onFlash }) => {
  const [month, setMonth] = useState(localToday().slice(0, 7));
  const [list, setList] = useState<any[]>([]);
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [form, setForm] = useState({ employee_id: '', date: localToday(), type: 'NASIYA_MISUSE', note: '' });
  const load = () => api.attendance.violations(month).then(r => setList(r.violations)).catch(e => onError(e.message));
  useEffect(() => { load(); }, [month]);
  const visible = list.filter(v => matchesSearch(v, q, ['employee_name', 'note', 'label']) && isPicked(type, v.type));
  const byEmployee = useMemo(() => {
    const m = new Map<string, { name: string; percent: number; count: number }>();
    for (const v of list) { if (v.cancelled) continue; const x = m.get(v.employee_id) || { name: v.employee_name, percent: 0, count: 0 }; x.percent = Math.round((x.percent + v.percent) * 100) / 100; x.count++; m.set(v.employee_id, x); }
    return Array.from(m.values()).sort((a, b) => b.percent - a.percent);
  }, [list]);
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    try { await api.attendance.addViolation(form); onFlash('Qoidabuzarlik yozildi.'); setForm({ ...form, note: '' }); load(); } catch (err: any) { onError(err.message); }
  };
  const cancel = async (v: any) => {
    const reason = prompt(v.source === 'AUTO' ? 'Bu kun uchun jarima nima sababdan bekor qilinadi?' : 'Jarima nima sababdan bekor qilinadi?');
    if (!reason) return;
    try {
      if (v.source === 'AUTO') await api.attendance.excuse(v.employee_id, v.date, true, reason);
      else await api.attendance.cancelViolation(v.id, reason);
      onFlash('Jarima bekor qilindi.'); load();
    } catch (err: any) { onError(err.message); }
  };
  return (
    <div className="space-y-3">
      {isAdmin && <form onSubmit={add} className="grid grid-cols-1 gap-2 rounded-2xl border border-neutral-200 bg-white p-3 text-xs md:grid-cols-6">
        <select required className={`${input} md:col-span-2`} value={form.employee_id} onChange={e => setForm({ ...form, employee_id: e.target.value })}>
          <option value="">Xodim…</option>
          {employees.filter(e => e.status !== 'INACTIVE').map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
        </select>
        <select className={input} value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>{VIOLATION_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <input type="date" className={input} value={form.date} max={localToday()} onChange={e => setForm({ ...form, date: e.target.value })} />
        <input required className={`${input} md:col-span-2`} placeholder="Nima bo‘ldi (masalan: 300 000 so‘m nasiya pulini so‘ramay ishlatdi)" value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} />
        <button className="rounded-lg bg-rose-600 px-3 py-2 font-bold text-white hover:bg-rose-700 md:col-span-6 md:justify-self-end"><Plus className="mr-1 inline h-3.5 w-3.5" />Qoidabuzarlikni yozish</button>
      </form>}
      <p className="text-[11px] text-neutral-500">Kech qolish va ishga chiqmaslik davomatdan (Face ID / ulangan tizimdagi vizitlar) avtomatik topiladi. Nasiya pulini ishlatish va vazifa bajarilmasligini shu yerdan yozasiz.</p>
      {byEmployee.length > 0 && (
        <div className="flex flex-wrap gap-2 text-xs">{byEmployee.map(x => <span key={x.name} className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1"><b>{x.name}</b>: {x.count} ta · <b className="text-rose-700">{x.percent}%</b></span>)}</div>
      )}
      <TableToolbar
        search={q} onSearch={setQ} searchPlaceholder="Xodim yoki izoh…"
        selects={[{ label: 'Turi', value: type, onChange: setType, allLabel: 'Barcha turlar', options: VIOLATION_TYPES.map(([value, label]) => ({ value, label })) }]}
        count={visible.length}
        onReset={() => { setQ(''); setType(''); }}
        onExport={() => exportTableXlsx({
          fileName: `Qoidabuzarliklar_${month}`, title: `Qoidabuzarliklar — ${month}`,
          columns: [{ header: 'Sana', key: 'date', type: 'date' }, { header: 'Xodim', key: 'employee_name', width: 26 }, { header: 'Turi', key: 'label', width: 22 }, { header: 'Daqiqa', key: 'minutes', type: 'number' }, { header: 'Foiz', key: 'percent', type: 'number', total: true }, { header: 'Manba', key: 'src', width: 12 }, { header: 'Izoh', key: 'note', width: 40 }],
          rows: visible.filter(v => !v.cancelled).map(v => ({ ...v, src: v.source === 'AUTO' ? 'avtomatik' : 'qo‘lda' })),
          filters: [q && `qidiruv: "${q}"`, type && picked(type).map(x => VIOLATION_TYPES.find(t => t[0] === x)?.[1]).join(', ')]
        })}
      >
        <input type="month" className="h-9 rounded-xl border border-neutral-200 bg-neutral-50 px-3 text-xs" value={month} onChange={e => setMonth(e.target.value)} />
      </TableToolbar>
      <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
        <table className="min-w-full text-xs">
          <thead className="bg-neutral-50 text-left text-neutral-500"><tr><th className="px-3 py-2">Sana</th><th className="px-3">Xodim</th><th className="px-3">Qoidabuzarlik</th><th className="px-3 text-right">Foiz</th><th className="px-3">Manba</th><th className="px-3">Izoh</th><th /></tr></thead>
          <tbody className="divide-y divide-neutral-100">
            {visible.length === 0 ? <tr><td colSpan={7} className="px-3 py-6 text-center text-neutral-400">Bu oyda qoidabuzarlik yo‘q.</td></tr> : visible.map((v, i) => (
              <tr key={(v.id || '') + v.date + v.type + i} className={v.cancelled ? 'text-neutral-400 line-through' : ''}>
                <td className="px-3 py-1.5 font-mono">{v.date}</td>
                <td className="px-3 font-semibold">{v.employee_name}</td>
                <td className="px-3">{v.label}{v.minutes ? ` (${v.minutes} daq)` : ''}</td>
                <td className="px-3 text-right font-bold text-rose-700">{v.cancelled ? '—' : `${v.percent}%`}</td>
                <td className="px-3">{v.source === 'AUTO' ? 'avtomatik' : 'qo‘lda'}</td>
                <td className="px-3 max-w-xs truncate" title={v.note || v.cancel_reason || ''}>{v.cancelled ? `bekor: ${v.cancel_reason}` : v.note || ''}</td>
                <td className="px-3 text-right">{isAdmin && !v.cancelled && (v.source === 'MANUAL' || v.type === 'LATE' || v.type === 'ABSENT') && <button onClick={() => cancel(v)} className="whitespace-nowrap text-[11px] font-semibold text-neutral-500 hover:text-red-600">Jarimani bekor qilish</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const Photo: React.FC<{ id: string }> = ({ id }) => {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { let u: string | null = null; api.attendance.photoUrl(id).then(x => { u = x; setUrl(x); }).catch(() => {}); return () => { if (u) URL.revokeObjectURL(u); }; }, [id]);
  return url ? <img src={url} alt="" className="h-20 w-16 rounded-lg object-cover" /> : <div className="h-20 w-16 rounded-lg bg-neutral-100" />;
};

const ReviewTab: React.FC<{ onError: (e: string) => void; onFlash: (t: string) => void }> = ({ onError, onFlash }) => {
  const [status, setStatus] = useState('REVIEW');
  const [events, setEvents] = useState<any[]>([]);
  const load = () => api.attendance.events({ status, from: status === 'REVIEW' ? undefined : localToday().slice(0, 8) + '01' }).then(r => setEvents(r.events.slice(0, 200))).catch(e => onError(e.message));
  useEffect(() => { load(); }, [status]);
  const decide = async (e: any, decision: 'ACCEPTED' | 'REJECTED') => {
    const reason = prompt(decision === 'ACCEPTED' ? 'Nega tasdiqlaysiz?' : 'Nega rad etasiz?');
    if (!reason) return;
    try { await api.attendance.review(e.id, decision, reason); onFlash('Qaror saqlandi.'); load(); } catch (err: any) { onError(err.message); }
  };
  return (
    <div className="space-y-3">
      <div className="flex gap-1 text-xs">
        {[['REVIEW', 'Tekshirilishi kerak'], ['REJECTED', 'Rad etilganlar (shu oy)'], ['ACCEPTED', 'Qabul qilinganlar (shu oy)']].map(([v, l]) => <button key={v} onClick={() => setStatus(v)} className={`rounded-md px-2.5 py-1 font-semibold ${status === v ? 'bg-neutral-900 text-white' : 'bg-neutral-100'}`}>{l}</button>)}
      </div>
      {events.length === 0 ? <p className="rounded-xl border border-neutral-200 bg-white p-6 text-center text-xs text-neutral-400">Qayd yo‘q.</p> : (
        <div className="grid gap-2 md:grid-cols-2">
          {events.map(e => (
            <div key={e.id} className="flex gap-3 rounded-xl border border-neutral-200 bg-white p-3 text-xs">
              {e.has_photo ? <Photo id={e.id} /> : <div className="flex h-20 w-16 items-center justify-center rounded-lg bg-neutral-100 text-[10px] text-neutral-400">rasm yo‘q</div>}
              <div className="flex-1 space-y-0.5">
                <div className="font-semibold">{e.employee_name} · {e.type === 'IN' ? 'kelish' : 'ketish'} · {e.date} {e.time}</div>
                <div className="text-neutral-600">Yuz mosligi: {e.face_distance ?? '—'} · tiriklik: {e.liveness_passed ? 'o‘tdi' : 'o‘tmadi'}</div>
                <div className="text-neutral-600">{e.lat != null ? <a className="text-blue-700 hover:underline" target="_blank" rel="noreferrer" href={`https://maps.google.com/?q=${e.lat},${e.lng}`}><MapPin className="inline h-3 w-3" /> xaritada (±{e.accuracy_m ?? '?'} m)</a> : 'GPS yo‘q'}{e.zone_name ? ` · ${e.zone_name}` : ''}</div>
                {e.review_reason && <div className="text-amber-800">{e.review_reason}</div>}
                {e.status === 'REVIEW' && (
                  <div className="flex gap-1.5 pt-1">
                    <button onClick={() => decide(e, 'ACCEPTED')} className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1 font-semibold text-white"><Check className="h-3 w-3" />Tasdiqlash</button>
                    <button onClick={() => decide(e, 'REJECTED')} className="inline-flex items-center gap-1 rounded-lg bg-rose-600 px-2.5 py-1 font-semibold text-white"><X className="h-3 w-3" />Rad etish</button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

/** The employee's reference portrait (kept until the super admin replaces it). */
const Portrait: React.FC<{ employeeId: string; version: string }> = ({ employeeId, version }) => {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { let u: string | null = null; api.attendance.profilePhotoUrl(employeeId).then(x => { u = x; setUrl(x); }).catch(() => setUrl(null)); return () => { if (u) URL.revokeObjectURL(u); }; }, [employeeId, version]);
  return url ? <img src={url} alt="" className="h-12 w-12 rounded-lg object-cover" /> : <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-neutral-100 text-neutral-300"><ScanFace className="h-5 w-5" /></div>;
};

/**
 * Faces are entered by the super admin only: from photos (uploaded) or with the camera. The profile and its portrait
 * stay until the super admin replaces them; nothing expires.
 */
const EnrollTab: React.FC<{ employees: any[]; onError: (e: string) => void; onFlash: (t: string) => void }> = ({ employees, onError, onFlash }) => {
  const [profiles, setProfiles] = useState<Record<string, any>>({});
  const [superAdmin, setSuperAdmin] = useState<boolean | null>(null);
  const [target, setTarget] = useState<any | null>(null);
  const [consent, setConsent] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const load = () => api.attendance.profiles().then(r => setProfiles(Object.fromEntries(r.profiles.map(p => [p.employee_id, p])))).catch(e => onError(e.message));
  useEffect(() => { load(); api.getMe().then(r => setSuperAdmin(!!r.user?.is_super_admin)).catch(() => setSuperAdmin(false)); }, []);
  const active = employees.filter(e => e.status !== 'INACTIVE');
  const [photoError, setPhotoError] = useState<string | null>(null);
  const close = () => { setTarget(null); setFiles([]); setCapturing(false); setPhotoError(null); };

  const enrollFromPhotos = async () => {
    setBusy(true); setPhotoError(null);
    try {
      const faceapi = await loadFaceApi();
      const { samples, photo } = await samplesFromPhotos(faceapi, files);
      const res = await api.attendance.enroll(target.id, samples, consent, { photo, source: 'PHOTO' });
      onFlash(`${target.full_name}: ${res.message}`);
      close(); load();
    } catch (e: any) { setPhotoError(e?.message || 'Rasmni saqlab bo‘lmadi.'); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-3">
      <p className="rounded-xl border border-blue-100 bg-blue-50 p-3 text-[11px] text-blue-900">
        Xodimlarning yuzi va rasmini <b>faqat super admin</b> kiritadi: rasm yuklab (yuz aniq, oldindan, yorug‘ joyda, bitta odam) yoki kamera bilan.
        Kiritilgan profil va rasm <b>almashtirilmaguncha o‘chmaydi</b>. Avval xodimdan biometrik ma’lumotga yozma rozilik oling.
        {superAdmin === false && <b className="mt-1 block text-amber-800">Siz super admin emassiz — ro‘yxatni ko‘rasiz, lekin kiritish va o‘zgartirish super admin orqali.</b>}
      </p>
      <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
        <table className="min-w-full text-xs">
          <thead className="bg-neutral-50 text-left text-neutral-500"><tr><th className="px-3 py-2">Rasm</th><th className="px-3">Xodim</th><th className="px-3">Lavozim</th><th className="px-3">Face ID</th><th /></tr></thead>
          <tbody className="divide-y divide-neutral-100">
            {active.map(e => {
              const p = profiles[e.id];
              return (
                <tr key={e.id}>
                  <td className="px-3 py-1.5">{p?.has_photo ? <Portrait employeeId={e.id} version={p.enrolled_at} /> : <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-neutral-100 text-neutral-300"><ScanFace className="h-5 w-5" /></div>}</td>
                  <td className="px-3 font-semibold">{e.full_name}</td>
                  <td className="px-3">{e.position}</td>
                  <td className="px-3">{p ? <span className="text-emerald-700">ro‘yxatda · {new Date(p.enrolled_at).toLocaleDateString('ru-RU')} · {p.source === 'PHOTO' ? 'rasmdan' : 'kameradan'}</span> : <span className="text-neutral-400">yo‘q</span>}</td>
                  <td className="px-3 text-right">
                    {superAdmin && <>
                      <button onClick={() => { setTarget(e); setConsent(!!p); setFiles([]); }} className="inline-flex items-center gap-1 rounded-lg bg-neutral-900 px-2.5 py-1 font-semibold text-white"><ScanFace className="h-3.5 w-3.5" />{p ? 'Almashtirish' : 'Kiritish'}</button>
                      {p && <button onClick={async () => { if (!confirm(`${e.full_name}ning Face ID profili va rasmi butunlay o‘chirilsinmi?`)) return; try { await api.attendance.removeProfile(e.id); onFlash('Profil o‘chirildi.'); load(); } catch (err: any) { onError(err.message); } }} className="ml-1 rounded-lg p-1 text-neutral-400 hover:text-red-600" title="O‘chirish"><Trash2 className="h-3.5 w-3.5" /></button>}
                    </>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {target && !capturing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md space-y-3 rounded-2xl bg-white p-5 text-xs shadow-2xl">
            <h3 className="text-sm font-bold">{target.full_name} — Face ID {profiles[target.id] ? '(almashtirish)' : ''}</h3>
            <label className="flex items-start gap-2"><input type="checkbox" className="mt-0.5" checked={consent} onChange={e => setConsent(e.target.checked)} />Xodim biometrik ma’lumotini (yuz belgisi va rasm) davomat uchun ishlatishga yozma rozilik berdi.</label>
            <div className="space-y-2 rounded-xl border border-neutral-200 p-3">
              <p className="font-semibold">1-usul: rasm yuklash (1–3 ta)</p>
              <input type="file" accept="image/*,.heic,.heif" multiple onChange={e => { setFiles(Array.from(e.target.files || []).slice(0, 3)); setPhotoError(null); }} className="block w-full text-xs" />
              {!!files.length && <p className="text-[10px] text-neutral-600">Tanlandi: {files.map(f => f.name).join(', ')}</p>}
              {photoError && <p className="rounded-lg bg-red-50 p-2 text-[11px] font-semibold text-red-700">{photoError}</p>}
              <p className="text-[10px] text-neutral-500">Yuz to‘liq ko‘ringan, oldindan olingan, ko‘zoynaksiz, yorug‘ rasm. Pasport uslubidagi rasm eng yaxshisi. Bir nechta rasm aniqlikni oshiradi.</p>
              <button disabled={!consent || !files.length || busy} onClick={enrollFromPhotos} className="rounded-lg bg-emerald-600 px-3 py-1.5 font-bold text-white disabled:opacity-50">{busy ? 'Yuz tahlil qilinmoqda…' : 'Rasmdan saqlash'}</button>
            </div>
            <div className="space-y-2 rounded-xl border border-neutral-200 p-3">
              <p className="font-semibold">2-usul: xodim yoningizda — kamera bilan</p>
              <button disabled={!consent || busy} onClick={() => setCapturing(true)} className="rounded-lg border border-neutral-300 px-3 py-1.5 font-semibold hover:bg-neutral-50 disabled:opacity-50">Kamerani ochish</button>
            </div>
            <div className="flex justify-end"><button onClick={close} className="rounded-lg px-3 py-1.5 font-semibold text-neutral-600 hover:bg-neutral-100">Yopish</button></div>
          </div>
        </div>
      )}
      {target && capturing && (
        <FaceCapture mode="enroll" title={`${target.full_name}: yuzni ro‘yxatga olish`}
          onCancel={close}
          onEnroll={async r => {
            setCapturing(false);
            try { const res = await api.attendance.enroll(target.id, r.samples, consent, { photo: r.photo, source: 'CAMERA' }); onFlash(`${target.full_name}: ${res.message}`); load(); }
            catch (e: any) { onError(e.message); }
            finally { close(); }
          }} />
      )}
    </div>
  );
};

/** Google Sheets: every start of work (Face ID, round video, first visit) appended to the company's own sheet. */
const SheetsCard: React.FC<{ onError: (e: string) => void; onFlash: (t: string) => void }> = ({ onError, onFlash }) => {
  const [v, setV] = useState<any>(null);
  const [url, setUrl] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [showScript, setShowScript] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = () => api.attendance.sheets().then(r => { setV(r); setUrl(r.url); setEnabled(r.enabled); }).catch(e => onError(e.message));
  useEffect(() => { load(); }, []);
  const run = async (fn: () => Promise<any>) => { setBusy(true); try { await fn(); } catch (e: any) { onError(e.message); } finally { setBusy(false); } };
  if (!v) return null;
  return (
    <div className="lg:col-span-2 space-y-2 rounded-2xl border border-emerald-200 bg-white p-4 text-xs">
      <h3 className="text-sm font-bold">Google Sheets — ish boshlash va jarimalar avtomatik</h3>
      <p className="text-[11px] text-neutral-500">Jadvalga o‘zi yoziladi: <b>“Davomat YYYY-MM”</b> — har xodimning har kungi ish boshlashi (Face ID, dumaloq video yoki birinchi vizit); <b>“Jarimalar”</b> — barcha sanalardagi qoidabuzarliklar (kechikish, kelmay qolish, rahbar kiritgani) bitta varaqda, shu oy yig‘indisi bilan (har 10 daqiqada). Bekor qilingan jarima ostiga “BEKOR QILINDI” qatori qo‘shiladi.</p>
      <ol className="list-decimal space-y-0.5 rounded-xl bg-neutral-50 p-3 pl-7 text-[11px] text-neutral-600">
        <li>Google Sheets’da yangi jadval oching → <b>Kengaytmalar → Apps Script</b>.</li>
        <li>U yerdagi kodni o‘chirib, pastdagi <b>skript kodini</b> joylang va saqlang.</li>
        <li><b>Deploy → New deployment → Web app</b>: “Execute as: <b>Me</b>”, “Who has access: <b>Anyone</b>” → Deploy → ruxsat bering.</li>
        <li>Chiqqan <b>Web app URL</b>ni (…/exec) shu yerga qo‘ying, “Yoqilgan”ni belgilab saqlang va “Sinash”ni bosing.</li>
      </ol>
      <button onClick={() => setShowScript(x => !x)} className="font-semibold text-emerald-700 hover:underline">{showScript ? 'Skript kodini yashirish' : 'Skript kodini ko‘rsatish'}</button>
      {showScript && (
        <div className="space-y-1">
          <textarea readOnly value={v.script} className="h-48 w-full rounded-lg border border-neutral-300 bg-neutral-50 p-2 font-mono text-[10px]" />
          <button onClick={() => navigator.clipboard.writeText(v.script).then(() => onFlash('Skript nusxalandi.')).catch(() => onError('Nusxalab bo‘lmadi — qo‘lda belgilab oling.'))} className="rounded-lg border border-neutral-300 px-2.5 py-1 font-semibold hover:bg-neutral-50">Nusxalash</button>
          <p className="text-[10px] text-amber-700">Kod ichida maxfiy kalit bor — uni boshqalarga bermang.</p>
        </div>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-[280px] flex-1 font-semibold">Web app URL
          <input className={input} value={url} onChange={e => setUrl(e.target.value)} placeholder="https://script.google.com/macros/s/…/exec" />
        </label>
        <label className="flex items-center gap-2 pb-1.5"><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />Yoqilgan</label>
        <button disabled={busy} onClick={() => run(async () => { const r = await api.attendance.saveSheets({ enabled, url }); setV(r); onFlash('Saqlandi.'); })} className="rounded-lg bg-neutral-900 px-3 py-1.5 font-semibold text-white disabled:opacity-50">Saqlash</button>
        <button disabled={busy || !v.url} onClick={() => run(async () => { const r = await api.attendance.testSheets(); onFlash(r.message); load(); })} className="rounded-lg border border-neutral-300 px-3 py-1.5 font-semibold hover:bg-neutral-50 disabled:opacity-50">Sinash</button>
      </div>
      <p className="text-[11px] text-neutral-500">
        Yozilgan: {v.sent}{v.pending ? ` · navbatda: ${v.pending}` : ''}{v.failed ? ` · yuborilmadi: ${v.failed}` : ''}{v.last_sent_at ? ` · oxirgisi ${new Date(v.last_sent_at).toLocaleString('ru-RU')}` : ''}
      </p>
      {v.last_error && <p className="rounded-lg bg-red-50 p-2 text-[11px] text-red-700">Oxirgi xato: {v.last_error}</p>}
    </div>
  );
};

/**
 * Employees' Telegram accounts, set by the admin: a round video in the couriers' group then counts without the person
 * ever opening the bot. People who posted but are not assigned yet are listed by name, to pick their employee.
 */
const TelegramAccountsCard: React.FC<{ onError: (e: string) => void; onFlash: (t: string) => void }> = ({ onError, onFlash }) => {
  const [v, setV] = useState<TelegramAccountsView | null>(null);
  const [ids, setIds] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const load = () => api.attendance.telegramAccounts().then(r => { setV(r); setIds(Object.fromEntries(r.employees.map(e => [e.id, e.telegram_user_id || '']))); }).catch(e => onError(e.message));
  useEffect(() => { load(); }, []);
  if (!v) return null;
  const assign = async (employee_id: string, tg: string | null) => {
    setBusy(true);
    try {
      const r = await api.attendance.assignTelegram(employee_id, tg);
      setV(r); setIds(Object.fromEntries(r.employees.map(e => [e.id, e.telegram_user_id || ''])));
      onFlash(tg ? `Biriktirildi.${r.counted ? ` Uning ${r.counted} ta oldingi videosi hisobga olindi.` : ''}` : 'Olib tashlandi.');
    } catch (e: any) { onError(e.message); } finally { setBusy(false); }
  };
  const ago = (iso: string) => new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  return (
    <div className="lg:col-span-2 space-y-3 rounded-2xl border border-violet-200 bg-white p-4 text-xs">
      <h3 className="text-sm font-bold">Xodimlarning Telegram hisoblari (dumaloq video uchun)</h3>
      <p className="text-[11px] text-neutral-500">Ulash tartibi: <b>1)</b> botni saqlang va davomatni yoqing; <b>2)</b> guruh ID ni xodim qatoriga yozing; <b>3)</b> botni guruhga admin qiling; <b>4)</b> xodim Telegram ID sini biriktiring. “Ish boshlash”da Telegram video tanlangan bo‘lsin.</p>
      {!v.poller_enabled && <p className="rounded-lg bg-red-50 p-2 text-[11px] font-semibold text-red-800">Bu serverda Telegram tinglash o‘chirilgan. Bot sozlamalari saqlanadi, lekin yangi xabarlar olinmaydi. Server ishga tushishida bot scheduler yoqilishi kerak.</p>}
      {!v.bot_username && <p className="rounded-lg bg-amber-50 p-2 text-[11px] text-amber-900">Bu serverda ishlaydigan Telegram bot tokeni topilmadi. Sozlamalar → Telegram botlar → “Sozlash”da tokenni qayta kiriting, davomatni yoqing va saqlang. Keyin botni faqat bitta ishga tushgan server tinglasin.</p>}
      {v.polling_error && <p className="rounded-lg bg-red-50 p-2 text-[11px] text-red-800">Bot Telegram guruhlarini o‘qiy olmayapti: {v.polling_error}. Botni guruhga admin qiling yoki @BotFather → /setprivacy → Disable qiling. Bot sozlamasidagi “Sinov xabari” ham polling/webhook holatini aniqlaydi.</p>}
      {v.bot_username && !v.checkin_group && <p className="rounded-lg bg-amber-50 p-2 text-[11px] text-amber-900">Admin sozlamalarida ish guruhi uchun Telegram ID kiriting va botni shu guruhga admin qilib qo‘shing.</p>}
      {v.poller_enabled && v.last_poll_at && <p className="rounded-lg bg-emerald-50 p-2 text-[11px] text-emerald-800">Bot serverda ishlayapti · oxirgi ulanish tekshiruvi {ago(v.last_poll_at)}.</p>}
      {v.last_update && <p className={`rounded-lg p-2 text-[11px] ${v.last_update.checkin_group ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-900'}`}><b>Telegram’dan oxirgi kelgan xabar:</b> {v.last_update.kind} · {v.last_update.sender} · {v.last_update.chat} · {ago(v.last_update.at)}{v.last_update.checkin_result ? ` · ${v.last_update.checkin_result}` : ''}</p>}
      <div className="rounded-xl bg-violet-50/60 p-3">
        <div className="flex items-center justify-between">
          <p className="font-semibold">Guruhda video tashlagan, hali biriktirilmaganlar</p>
          <button onClick={load} className="rounded-lg border border-neutral-300 bg-white px-2 py-0.5 font-semibold hover:bg-neutral-50">Yangilash</button>
        </div>
        {!v.senders.length && <p className="mt-1 text-[11px] text-neutral-500">Hozircha yo‘q. Dostavchi guruhga dumaloq video tashlasa, shu yerda ismi chiqadi.</p>}
        {v.senders.map(s => (
          <div key={s.id} className="mt-1.5 flex flex-wrap items-center gap-2">
            <span className="min-w-[180px] font-semibold">{s.name}{s.username ? <span className="font-normal text-neutral-500"> @{s.username}</span> : ''}<span className="block text-[10px] font-normal text-neutral-400">ID {s.id} · {s.videos} ta video · oxirgisi {ago(s.last_at)}</span></span>
            <select disabled={busy} defaultValue="" onChange={e => e.target.value && assign(e.target.value, s.id)} className={`${input} max-w-xs`}>
              <option value="">— qaysi xodim? —</option>
              {v.employees.filter(e => !e.telegram_user_id).map(e => <option key={e.id} value={e.id}>{e.name}{e.position ? ` · ${e.position}` : ''}</option>)}
            </select>
          </div>
        ))}
      </div>
      <div className="max-h-72 overflow-auto rounded-xl border border-neutral-100">
        <table className="min-w-full">
          <thead className="sticky top-0 bg-white text-left text-[10px] uppercase text-neutral-500"><tr><th className="px-2 py-1">Xodim</th><th className="px-2">Telegram ID</th><th /></tr></thead>
          <tbody className="divide-y divide-neutral-100">
            {v.employees.map(e => (
              <tr key={e.id}>
                <td className="px-2 py-1.5 font-semibold">{e.name}<div className="text-[10px] font-normal text-neutral-400">{e.position}{e.telegram_name ? ` · ${e.telegram_name}` : ''}{e.bot_linked ? ' · botga ulangan' : ''}</div></td>
                <td className="px-2"><input className={`${input} w-40 font-mono`} inputMode="numeric" value={ids[e.id] || ''} onChange={x => setIds(m => ({ ...m, [e.id]: x.target.value.replace(/\D/g, '') }))} placeholder="123456789" /></td>
                <td className="px-2 text-right">
                  {(ids[e.id] || '') !== (e.telegram_user_id || '') && <button disabled={busy} onClick={() => assign(e.id, ids[e.id] || null)} className="rounded-lg bg-neutral-900 px-2.5 py-1 font-semibold text-white disabled:opacity-50">Saqlash</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[10px] text-neutral-500">ID’ni bilmasangiz shart emas — xodim guruhga bitta video tashlasa, yuqoridagi ro‘yxatda ismi chiqadi. Yoki xodim @userinfobot’ga yozib o‘z ID’sini bilib oladi.</p>
    </div>
  );
};

/** Violations posted to Telegram groups: every agent to their own group, the couriers to their common one. */
const PenaltyPostsCard: React.FC<{ onError: (e: string) => void; onFlash: (t: string) => void }> = ({ onError, onFlash }) => {
  const [v, setV] = useState<PenaltyPostsView | null>(null);
  const [form, setForm] = useState<{ enabled: boolean; groups: Record<string, string>; employees: Record<string, string> }>({ enabled: false, groups: {}, employees: {} });
  const [busy, setBusy] = useState(false);
  const load = () => api.attendance.penaltyPosts().then(r => { setV(r); setForm({ enabled: r.config.enabled, groups: r.config.groups || {}, employees: r.config.employees || {} }); }).catch(e => onError(e.message));
  useEffect(() => { load(); }, []);
  if (!v) return null;
  const chatSelect = (value: string, onChange: (x: string) => void, empty: string) => (
    <select className={input} value={value || ''} onChange={e => onChange(e.target.value)}>
      <option value="">{empty}</option>
      {v.chats.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
      {value && !v.chats.some(c => c.id === value) && <option value={value}>Chat {value}</option>}
    </select>
  );
  const save = async () => {
    setBusy(true);
    try { const r = await api.attendance.savePenaltyPosts(form); setV(r); onFlash(form.enabled ? 'Saqlandi. Bugundan boshlab har bir jarima guruhga yoziladi.' : 'Saqlandi. Guruhlarga yuborish o‘chiq.'); } catch (e: any) { onError(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="lg:col-span-2 space-y-3 rounded-2xl border border-sky-200 bg-white p-4 text-xs">
      <h3 className="text-sm font-bold">Jarimalarni Telegram guruhlarga yuborish</h3>
      <p className="text-[11px] text-neutral-500">Har bir qoidabuzarlik (kechikish, kelmay qolish, rahbar yozgani) bot orqali guruhga yoziladi: nima bo‘ldi, necha foiz va shu oy jami. Agentning o‘z guruhi bo‘lsa — o‘sha guruhga, aks holda ish guruhining umumiy guruhiga (masalan dostavchiklar).</p>
      {!v.bot_username && <p className="rounded-lg bg-amber-50 p-2 text-[11px] text-amber-900">Avval xodimlar botini ulang: Sozlamalar → Telegram botlar → botni sozlash → “Xodimlarga shaxsiy eslatmalar”.</p>}
      {!v.rules_mode && <p className="rounded-lg bg-amber-50 p-2 text-[11px] text-amber-900">Jarima turi “Kompaniya qoidalari (% oylikdan)” bo‘lganda yuboriladi.</p>}
      <ol className="list-decimal space-y-0.5 rounded-xl bg-neutral-50 p-3 pl-7 text-[11px] text-neutral-600">
        <li>Botni{v.bot_username ? <> (<b>@{v.bot_username}</b>)</> : ''} har bir guruhga a’zo qilib qo‘shing: dostavchiklar guruhiga va har bir agentning guruhiga.</li>
        <li>Guruhda biror xabar yozing — bot guruhni 20 soniyada ko‘radi. So‘ng “Ro‘yxatni yangilash”.</li>
        <li>Pastda jarima xabari boradigan Telegram guruhlarni tanlang, “Yoqilgan”ni belgilab saqlang.</li>
      </ol>
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={load} className="rounded-lg border border-neutral-300 px-2.5 py-1 font-semibold hover:bg-neutral-50">Ro‘yxatni yangilash</button>
        <span className="text-neutral-500">Bot ko‘rgan guruhlar: {v.chats.length ? v.chats.map(c => c.title).join(', ') : 'hali yo‘q'}</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {v.groups.map(g => (
          <label key={g.id} className="font-semibold">“{g.name}” ish guruhi — umumiy Telegram guruhi
            {chatSelect(form.groups[g.id], x => setForm(f => ({ ...f, groups: { ...f.groups, [g.id]: x } })), '— yuborilmaydi —')}
          </label>
        ))}
      </div>
      {!!v.employees.length && (
        <div>
          <p className="font-semibold">Xodimning o‘z guruhi <span className="font-normal text-neutral-500">(har bir agent alohida; tanlanmasa — ish guruhining umumiy guruhiga)</span></p>
          <div className="mt-1 max-h-72 overflow-auto rounded-xl border border-neutral-100">
            <table className="min-w-full">
              <tbody className="divide-y divide-neutral-100">
                {v.employees.map(e => (
                  <tr key={e.id}>
                    <td className="py-1.5 pl-2 pr-2 font-semibold">{e.name}<div className="text-[10px] font-normal text-neutral-400">{e.position}{e.group ? ` · ${e.group}` : ''}</div></td>
                    <td className="py-1 pr-2">{chatSelect(form.employees[e.id], x => setForm(f => ({ ...f, employees: { ...f.employees, [e.id]: x } })), 'ish guruhidagidek')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 font-semibold"><input type="checkbox" checked={form.enabled} onChange={e => setForm(f => ({ ...f, enabled: e.target.checked }))} />Yoqilgan</label>
        <button disabled={busy} onClick={save} className="rounded-lg bg-neutral-900 px-4 py-1.5 font-semibold text-white disabled:opacity-50">{busy ? 'Saqlanmoqda…' : 'Saqlash'}</button>
        {v.config.enabled && v.config.since && <span className="text-[11px] text-neutral-500">{v.config.since.split('-').reverse().join('.')} dan boshlab yuborilmoqda</span>}
      </div>
    </div>
  );
};

const SettingsTab: React.FC<{ employees: any[]; onError: (e: string) => void; onFlash: (t: string) => void }> = ({ employees, onError, onFlash }) => {
  const [s, setS] = useState<any>(null);
  const [agents, setAgents] = useState<{ id: string; name: string; code: string }[]>([]);
  const [syncing, setSyncing] = useState(false);
  const { name: systemName, system } = useDistribution();
  const visitsAvailable = !system || system.capabilities.visits;
  const [superAdmin, setSuperAdmin] = useState(false);
  const [zoneBusy, setZoneBusy] = useState(false);
  const [checkinBusy, setCheckinBusy] = useState(false);
  const [workBusy, setWorkBusy] = useState(false);
  const [dayStartEmployee, setDayStartEmployee] = useState('');
  const [dayStartDate, setDayStartDate] = useState(localToday());
  const [dayStartTime, setDayStartTime] = useState('10:00');
  const [zoneMsg, setZoneMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    api.attendance.settings().then(r => setS(r.settings)).catch(e => onError(e.message));
    api.getMe().then(r => setSuperAdmin(!!r.user?.is_super_admin)).catch(() => {});
    api.attendance.agents().then(r => setAgents(r.agents)).catch(() => {});
  }, []);
  if (!s) return null;
  const rules: any[] = s.rules || [];
  const groups: any[] = s.groups || [];
  const setRule = (i: number, patch: any) => setS({ ...s, rules: rules.map((r, j) => j === i ? { ...r, ...patch } : r) });
  const setGroup = (i: number, patch: any) => setS({ ...s, groups: groups.map((g, j) => j === i ? { ...g, ...patch } : g) });
  const syncMonth = async () => {
    setSyncing(true);
    try { const r = await api.attendance.syncVisits(localToday().slice(0, 8) + '01', localToday()); onFlash(r.message); } catch (e: any) { onError(e.message); } finally { setSyncing(false); }
  };
  const sch = s.default_schedule;
  const setSch = (patch: any) => setS({ ...s, default_schedule: { ...sch, ...patch } });
  const save = async () => {
    setWorkBusy(true);
    try {
      const r = await api.attendance.saveSettings({ ...s, groups: groups.map(g => ({ ...g, end: g.end || '18:00' })) });
      setS(r.settings); onFlash('Sozlamalar saqlandi.');
    } catch (e: any) { onError(e.message); } finally { setWorkBusy(false); }
  };
  const saveWorkSettings = async () => {
    setWorkBusy(true);
    try {
      const r = await api.attendance.saveSettings({
        groups: groups.map(g => ({ ...g, end: g.end || '18:00' })),
        employee_groups: s.employee_groups || {}, employee_methods: s.employee_methods || {},
        checkin_employee_groups: s.checkin_employee_groups || {}, employee_start_times: s.employee_start_times || {},
        employee_day_start_times: s.employee_day_start_times || {}, agent_links: s.agent_links || {}
      });
      setS(r.settings); onFlash('Ish guruhlari va agent vaqtlari saqlandi.');
    } catch (e: any) { onError(e.message); } finally { setWorkBusy(false); }
  };
  const setEmployeeDayStart = (employeeId: string, date: string, start: string) => {
    const all = { ...(s.employee_day_start_times || {}) };
    const dates = { ...(all[employeeId] || {}) };
    if (start) dates[date] = start; else delete dates[date];
    if (Object.keys(dates).length) all[employeeId] = dates; else delete all[employeeId];
    setS({ ...s, employee_day_start_times: all });
  };
  const saveCheckinGroups = async () => {
    setCheckinBusy(true);
    try {
      const r = await api.attendance.saveSettings({ checkin_groups: s.checkin_groups || {} });
      setS((cur: any) => ({ ...cur, checkin_groups: r.settings.checkin_groups || {} }));
      onFlash('Dumaloq video guruhlari saqlandi.');
    } catch (e: any) { onError(e.message); } finally { setCheckinBusy(false); }
  };
  // Work places are saved on their own (no need to look for the page's save button).
  const saveZones = async (zones: any[], require_zone: boolean) => {
    const bad = zones.find(z => !z.name?.trim() || !Number.isFinite(z.lat) || !Number.isFinite(z.lng) || (z.lat === 0 && z.lng === 0));
    if (bad) { setZoneMsg({ ok: false, text: `“${bad.name || 'Nomsiz joy'}”: koordinata kiritilmagan — Google Maps’dan nusxa olib qo‘ying.` }); return; }
    setZoneBusy(true); setZoneMsg(null);
    try {
      const r = await api.attendance.saveSettings({ zones, require_zone } as any);
      setS((cur: any) => ({ ...cur, zones: r.settings.zones, require_zone: r.settings.require_zone }));
      setZoneMsg({ ok: true, text: zones.length ? `Saqlandi: ${zones.length} ta joy.${require_zone ? ' Face ID faqat shu joylar ichida.' : ''}` : 'Saqlandi: joylar yo‘q.' });
    } catch (e: any) { setZoneMsg({ ok: false, text: e.message }); } finally { setZoneBusy(false); }
  };
  const addZone = (lat = 0, lng = 0) => setS((cur: any) => ({ ...cur, zones: [...cur.zones, { name: `Ish joyi ${cur.zones.length + 1}`, lat, lng, radius_m: 100 }], require_zone: cur.zones.length ? cur.require_zone : true }));
  const hereZone = () => {
    setZoneMsg(null);
    if (!navigator.geolocation) { setZoneMsg({ ok: false, text: 'Bu qurilma joylashuvni bermaydi. “Google Maps’dan qo‘shish” tugmasidan foydalaning.' }); return; }
    setZoneBusy(true);
    navigator.geolocation.getCurrentPosition(
      p => {
        setZoneBusy(false);
        addZone(Number(p.coords.latitude.toFixed(6)), Number(p.coords.longitude.toFixed(6)));
        const acc = Math.round(p.coords.accuracy);
        setZoneMsg({ ok: acc <= 100, text: acc <= 100 ? `Joy olindi (aniqlik ±${acc} m). Nomini yozib “Joylarni saqlash”ni bosing.` : `Joy olindi, lekin aniqligi past (±${acc} m) — kompyuterda GPS yo‘q. Telefondan qo‘shing yoki Google Maps’dagi aniq nuqtani qo‘ying.` });
      },
      err => {
        setZoneBusy(false);
        setZoneMsg({ ok: false, text: err.code === 1
          ? 'Joylashuvga ruxsat berilmadi. Manzil satridagi qulf belgisi → “Joylashuv → Ruxsat berish”, yoki “Google Maps’dan qo‘shish”dan foydalaning.'
          : 'Joylashuvni aniqlab bo‘lmadi (kompyuterda GPS yo‘q bo‘lishi mumkin). “Google Maps’dan qo‘shish”dan foydalaning.' });
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
  };
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-3 rounded-2xl border border-neutral-200 bg-white p-4 text-xs">
        <h3 className="text-sm font-bold">Umumiy ish vaqti <span className="font-normal text-neutral-500">(guruhga biriktirilmagan xodimlar uchun)</span></h3>
        <div className="grid grid-cols-3 gap-2">
          <label className="font-semibold">Boshlanishi<input type="time" className={input} value={sch.start} onChange={e => setSch({ start: e.target.value })} /></label>
          <label className="font-semibold">Tugashi<input type="time" className={input} value={sch.end} onChange={e => setSch({ end: e.target.value })} /></label>
          <label className="font-semibold">Ruxsat, daq<input type="number" min="0" max="120" className={input} value={sch.grace_minutes} onChange={e => setSch({ grace_minutes: Number(e.target.value) })} /></label>
        </div>
        <div className="flex flex-wrap gap-1">{WEEKDAYS.map((d, i) => { const n = i + 1; const on = sch.workdays.includes(n); return <button key={d} onClick={() => setSch({ workdays: on ? sch.workdays.filter((x: number) => x !== n) : [...sch.workdays, n].sort() })} className={`rounded-md px-2.5 py-1 font-semibold ${on ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-500'}`}>{d}</button>; })}</div>
        <p className="text-[11px] text-neutral-500">Ruxsat ichida kelgan xodim kech hisoblanmaydi; undan oshsa kechikish ish boshlanishidan hisoblanadi.</p>

        <h3 className="pt-2 text-sm font-bold">Jarima</h3>
        <div className="grid grid-cols-2 gap-2">
          <label className="font-semibold">Turi
            <select className={input} value={s.penalty.mode} onChange={e => setS({ ...s, penalty: { ...s.penalty, mode: e.target.value } })}>
              <option value="RULES">Kompaniya qoidalari (% oylikdan)</option><option value="NONE">Jarima yo‘q</option><option value="FIXED">Har kechikish uchun summa</option><option value="PER_MINUTE">Har daqiqa uchun summa</option>
            </select>
          </label>
          {s.penalty.mode !== 'RULES' && s.penalty.mode !== 'NONE' && <>
            <label className="font-semibold">Summa, so‘m<input type="number" min="0" className={input} value={s.penalty.amount} onChange={e => setS({ ...s, penalty: { ...s.penalty, amount: Number(e.target.value) } })} /></label>
            <label className="font-semibold">Oylik chegara, so‘m (0 = yo‘q)<input type="number" min="0" className={input} value={s.penalty.monthly_cap} onChange={e => setS({ ...s, penalty: { ...s.penalty, monthly_cap: Number(e.target.value) } })} /></label>
            <label className="flex items-end gap-2 pb-1.5"><input type="checkbox" checked={s.penalty.early_leave} onChange={e => setS({ ...s, penalty: { ...s.penalty, early_leave: e.target.checked } })} />Erta ketish ham jarimalanadi</label>
          </>}
        </div>
        <p className="text-[11px] text-neutral-500">Jarima oylik hisoblanganda “Ushlanma” bo‘lib tushadi.{s.penalty.mode === 'RULES' ? ' Foiz shu oy jami chiqqan oylikdan olinadi (masalan 5 000 000 × 2% = 100 000).' : ' Uzrli deb belgilangan kunlar jarimasiz.'}</p>
      </div>

      {s.penalty.mode === 'RULES' && (
        <div className="lg:col-span-2 space-y-2 rounded-2xl border border-neutral-200 bg-white p-4 text-xs">
          <h3 className="text-sm font-bold">Qoidalar (foizlar)</h3>
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead className="text-left text-neutral-500"><tr><th className="py-1">Qoidabuzarlik</th><th>Har safar, %</th><th>Masalan, 3 marta</th><th>Uzr qabul qilinadi</th><th>Yoqilgan</th></tr></thead>
              <tbody className="divide-y divide-neutral-100">
                {rules.map((r, i) => (
                  <tr key={r.type}>
                    <td className="py-1.5 pr-2"><input className={input} value={r.label} onChange={e => setRule(i, { label: e.target.value })} /><div className="text-[10px] text-neutral-400">{r.type === 'LATE' || r.type === 'ABSENT' ? 'davomatdan avtomatik' : 'rahbar qo‘lda yozadi'}</div></td>
                    <td className="pr-2"><input type="number" step="0.1" min="0" max="100" className={`${input} w-20`} value={r.percent} onChange={e => setRule(i, { percent: Number(e.target.value) })} /></td>
                    <td className="pr-2 text-neutral-500">{Math.round((Number(r.percent) || 0) * 3 * 100) / 100}% oylikdan</td>
                    <td className="text-center"><input type="checkbox" checked={r.excuses_allowed} onChange={e => setRule(i, { excuses_allowed: e.target.checked })} /></td>
                    <td className="text-center"><input type="checkbox" checked={r.active} onChange={e => setRule(i, { active: e.target.checked })} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-neutral-500">Har bir qoidabuzarlik o‘z foizini oladi va oy davomida qo‘shilib boradi. Masalan, kech qolish 0,5%: 1 marta — 0,5%, 3 marta — 1,5%, 4 marta — 2%. Jami foiz shu oy hisoblangan oylikdan ushlanadi.</p>
        </div>
      )}

      <div className="lg:col-span-2 space-y-3 rounded-2xl border border-neutral-200 bg-white p-4 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold">Ish guruhlari va ish boshlash vaqti</h3>
          <button onClick={syncMonth} disabled={syncing} className="rounded-lg border border-neutral-300 px-2.5 py-1 font-semibold hover:bg-neutral-50 disabled:opacity-50">{syncing ? 'Olinmoqda…' : `${systemName} vizitlarini hozir olish (shu oy)`}</button>
        </div>
        {groups.map((g, i) => (
          <div key={g.id || i} className="grid grid-cols-2 items-end gap-2 rounded-xl border border-neutral-100 p-2 md:grid-cols-12">
            <label className="col-span-2 md:col-span-3">Guruh<input className={input} value={g.name} onChange={e => setGroup(i, { name: e.target.value })} /></label>
            <label className="md:col-span-2">Start dan<input type="time" className={input} value={g.start_from} onChange={e => setGroup(i, { start_from: e.target.value })} /></label>
            <label className="md:col-span-2">… gacha (kech emas)<input type="time" className={input} value={g.start_to} onChange={e => setGroup(i, { start_to: e.target.value })} /></label>
            <label className="md:col-span-1">Tugashi<input type="time" className={input} value={g.end || '18:00'} onChange={e => setGroup(i, { end: e.target.value })} /></label>
            <label className="col-span-2 md:col-span-3">Ish boshlash qayerdan
              <select className={input} value={g.source} onChange={e => setGroup(i, { source: e.target.value })}>
                <option value="FACE_ID">Face ID bilan kelish</option><option value="TELEGRAM_VIDEO">Telegram guruhiga dumaloq video</option><option value="SALESDOC_VISIT">Ulangan tizimdagi birinchi vizit ({systemName})</option>
              </select>
            </label>
            <button onClick={() => setS({ ...s, groups: groups.filter((_, j) => j !== i) })} className="pb-1.5 text-neutral-400 hover:text-red-600 md:col-span-1"><Trash2 className="h-4 w-4" /></button>
            <div className="col-span-2 flex flex-wrap gap-1 md:col-span-12">{WEEKDAYS.map((d, k) => { const n = k + 1; const on = g.workdays.includes(n); return <button key={d} onClick={() => setGroup(i, { workdays: on ? g.workdays.filter((x: number) => x !== n) : [...g.workdays, n].sort() })} className={`rounded-md px-2 py-0.5 font-semibold ${on ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-500'}`}>{d}</button>; })}</div>
          </div>
        ))}
        <button onClick={() => setS({ ...s, groups: [...groups, { name: 'Yangi guruh', start_from: '08:00', start_to: '09:00', end: '18:00', workdays: [1, 2, 3, 4, 5, 6], source: 'FACE_ID' }] })} className="inline-flex items-center gap-1 rounded-lg border border-neutral-300 px-2.5 py-1 font-semibold hover:bg-neutral-50"><Plus className="h-3.5 w-3.5" />Guruh qo‘shish</button>

        <h4 className="pt-2 font-bold">Xodimlar qaysi guruhda</h4>
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead className="text-left text-neutral-500"><tr><th className="py-1">Xodim</th><th>Ish guruhi</th><th>Ish boshlashi</th><th>Telegram guruhi ID (alohida bo‘lsa)</th><th>Shaxsiy vaqt</th><th>{systemName}dagi agenti</th></tr></thead>
            <tbody className="divide-y divide-neutral-100">
              {employees.filter(e => e.status !== 'INACTIVE').map(e => {
                const gid = s.employee_groups?.[e.id] || '';
                const g = groups.find(x => x.id === gid);
                const method = s.employee_methods?.[e.id] || '';
                const source = method || g?.source || (s.checkin_employee_groups?.[e.id] ? 'TELEGRAM_VIDEO' : 'FACE_ID');
                return (
                  <tr key={e.id}>
                    <td className="py-1.5 pr-2 font-semibold">{e.full_name}<div className="text-[10px] font-normal text-neutral-400">{e.position}</div></td>
                    <td className="pr-2">
                      <select className={input} value={gid} onChange={ev => setS({ ...s, employee_groups: { ...(s.employee_groups || {}), [e.id]: ev.target.value } })}>
                        <option value="">— kuzatilmaydi (yoki umumiy jadval) —</option>
                        {groups.filter(x => x.id).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
                      </select>
                    </td>
                    <td className="pr-2">
                      {/* The admin chooses each person's way; "as the group" follows the group's setting. */}
                      <select className={input} value={method} onChange={ev => setS({ ...s, employee_methods: { ...(s.employee_methods || {}), [e.id]: ev.target.value } })}>
                        <option value="">Guruhdagidek ({SOURCE_LABEL[g?.source || 'FACE_ID']})</option>
                        <option value="FACE_ID">Face ID</option>
                        <option value="TELEGRAM_VIDEO">Telegram guruhiga dumaloq video</option>
                        <option value="SALESDOC_VISIT">Birinchi vizit ({systemName})</option>
                      </select>
                    </td>
                    <td className="pr-2"><input className={`${input} min-w-36 font-mono`} value={s.checkin_employee_groups?.[e.id] || ''} placeholder="-100… (ixtiyoriy)" onChange={ev => setS({ ...s, checkin_employee_groups: { ...(s.checkin_employee_groups || {}), [e.id]: ev.target.value.trim() }, ...(!method && ev.target.value.trim() ? { employee_methods: { ...(s.employee_methods || {}), [e.id]: 'TELEGRAM_VIDEO' } } : {}) })} /></td>
                    <td className="pr-2"><input type="time" className={input} title="Bo‘sh qoldirilsa, ish guruhi vaqti ishlaydi" value={s.employee_start_times?.[e.id] || ''} onChange={ev => {
                      const starts = { ...(s.employee_start_times || {}) };
                      if (ev.target.value) starts[e.id] = ev.target.value; else delete starts[e.id];
                      setS({ ...s, employee_start_times: starts });
                    }} /></td>
                    <td>
                      {source === 'SALESDOC_VISIT' ? (
                        <select className={input} value={s.agent_links?.[e.id] || ''} onChange={ev => setS({ ...s, agent_links: { ...(s.agent_links || {}), [e.id]: ev.target.value } })}>
                          <option value="">Tanlang…</option>
                          {agents.map(a => <option key={a.id} value={a.id}>{a.name} · {a.code}</option>)}
                        </select>
                      ) : <span className="text-neutral-400">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="space-y-2 rounded-xl border border-blue-100 bg-blue-50/40 p-3">
          <h4 className="font-bold">Agent uchun ayrim kunlarda kechroq boshlash</h4>
          <p className="text-[11px] text-neutral-600">Tanlangan sanada faqat shu xodimning kechikish muddati o‘zgaradi. Boshqa kunlar va guruh jadvali o‘z holida qoladi. Faqat admin saqlay oladi.</p>
          <div className="grid gap-2 sm:grid-cols-[1fr_180px_130px_auto] sm:items-end">
            <label>Xodim / agent
              <select className={input} value={dayStartEmployee} onChange={e => setDayStartEmployee(e.target.value)}>
                <option value="">Xodimni tanlang…</option>
                {employees.filter(e => e.status !== 'INACTIVE').map(e => <option key={e.id} value={e.id}>{e.full_name}{e.position ? ` · ${e.position}` : ''}</option>)}
              </select>
            </label>
            <label>Sana<input type="date" className={input} value={dayStartDate} onChange={e => setDayStartDate(e.target.value)} /></label>
            <label>Ish boshlashi<input type="time" className={input} value={dayStartTime} onChange={e => setDayStartTime(e.target.value)} /></label>
            <button type="button" disabled={!dayStartEmployee || !dayStartDate || !dayStartTime} onClick={() => setEmployeeDayStart(dayStartEmployee, dayStartDate, dayStartTime)} className="rounded-lg border border-neutral-300 px-3 py-1.5 font-semibold hover:bg-white disabled:opacity-50">Kunga qo‘shish</button>
          </div>
          {Object.entries(s.employee_day_start_times || {}).flatMap(([employeeId, dates]: [string, any]) => Object.entries(dates || {}).map(([date, start]: [string, any]) => ({ employeeId, date, start }))).sort((a, b) => a.date.localeCompare(b.date)).map(row => (
            <div key={`${row.employeeId}-${row.date}`} className="grid gap-2 rounded-lg border border-neutral-100 bg-white p-2 sm:grid-cols-[1fr_180px_130px_auto] sm:items-end">
              <span className="font-semibold">{employees.find(e => e.id === row.employeeId)?.full_name || 'Xodim'}</span>
              <label className="text-[10px] text-neutral-500">Sana<input type="date" className={input} value={row.date} onChange={e => {
                const all = { ...(s.employee_day_start_times || {}) };
                const dates = { ...(all[row.employeeId] || {}) };
                delete dates[row.date];
                if (e.target.value) dates[e.target.value] = row.start;
                if (Object.keys(dates).length) all[row.employeeId] = dates; else delete all[row.employeeId];
                setS({ ...s, employee_day_start_times: all });
              }} /></label>
              <label className="text-[10px] text-neutral-500">Boshlanishi<input type="time" className={input} value={row.start} onChange={e => setEmployeeDayStart(row.employeeId, row.date, e.target.value)} /></label>
              <button type="button" onClick={() => setEmployeeDayStart(row.employeeId, row.date, '')} className="rounded-lg p-2 text-neutral-400 hover:bg-red-50 hover:text-red-600" title="Kunlik o‘zgarishni olib tashlash"><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-neutral-500">Yangi guruh avval saqlanadi, keyin xodimlarga biriktiriladi. Agentlarning vizitlari har 10 daqiqada ulangan tizimdan ({systemName}) olinadi.</p>
        <p className="text-[11px] text-amber-800">Shaxsiy boshlanish vaqti doimiy; yuqoridagi kunlik sozlama esa faqat ko‘rsatilgan sanaga tegishli.</p>
        {!visitsAvailable && <p className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-900">{systemName} hozircha agent vizitlarini bermaydi — “birinchi vizit” guruhidagi agentlar uchun ish boshlanishi olinmaydi. Ularni Face ID guruhiga o‘tkazing.</p>}
        <div className="flex justify-end border-t border-neutral-100 pt-3">
          <button type="button" disabled={workBusy} onClick={saveWorkSettings} className="rounded-lg bg-emerald-600 px-4 py-2 font-bold text-white hover:bg-emerald-700 disabled:opacity-50">{workBusy ? 'Saqlanmoqda…' : 'Ish jadvalini saqlash'}</button>
        </div>
      </div>

      <details className="lg:col-span-2 rounded-2xl border border-violet-200 bg-white p-4 text-xs">
        <summary className="cursor-pointer text-sm font-bold">Dostavchi/ombor umumiy guruhi sozlamasi (ixtiyoriy)</summary>
        <div className="mt-3 space-y-3">
        <p className="text-[11px] text-neutral-600">Har bir ish guruhiga o‘z Telegram guruhining ID sini kiriting (odatda <b>-100…</b> bilan boshlanadi). Botni o‘sha guruhga admin qilib qo‘shing. Video faqat xodim biriktirilgan ish guruhining ID sidan yuborilsa qabul qilinadi. Yangi ish guruhini avval yuqoridagi umumiy “Saqlash” tugmasi bilan saqlang.</p>
        {!groups.some(g => g.id) && <p className="rounded-lg bg-amber-50 p-2 text-[11px] text-amber-900">Avval ish guruhini qo‘shib, saqlang.</p>}
        <div className="grid gap-2 sm:grid-cols-2">
          {groups.filter(g => g.id).map(g => <label key={g.id} className="font-semibold">{g.name} · Telegram ID
            <input className={`${input} font-mono`} value={s.checkin_groups?.[g.id] || ''} placeholder="-1001234567890" onChange={e => setS({ ...s, checkin_groups: { ...(s.checkin_groups || {}), [g.id]: e.target.value.trim() } })} />
          </label>)}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button disabled={checkinBusy || !groups.some(g => g.id)} onClick={saveCheckinGroups} className="rounded-lg bg-neutral-900 px-3 py-1.5 font-semibold text-white disabled:opacity-50">{checkinBusy ? 'Saqlanmoqda…' : 'Video guruhlarini saqlash'}</button>
          <span className="text-[10px] text-neutral-500">ID ni Telegram guruhini admin ko‘radigan botga qo‘shib, bot yozuvlarini qabul qilgach olish mumkin.</span>
        </div>
        </div>
      </details>

      <SheetsCard onError={onError} onFlash={onFlash} />
      <TelegramAccountsCard onError={onError} onFlash={onFlash} />
      <PenaltyPostsCard onError={onError} onFlash={onFlash} />

      <div className="space-y-3 rounded-2xl border border-neutral-200 bg-white p-4 text-xs">
        <h3 className="flex items-center gap-1.5 text-sm font-bold"><MapPin className="h-4 w-4 text-emerald-600" />Face ID qilinadigan joylar (lokatsiya)</h3>
        <p className="text-[11px] text-neutral-500">Ish joyining lokatsiyasi va undan qancha masofada Face ID qilish mumkinligi. Joy bir nechta bo‘lishi mumkin (sklad, ofis…) — xodim istalganining ichida bo‘lsa yetarli.{!superAdmin && <b className="block text-amber-800">Lokatsiya va masofani faqat super admin o‘zgartiradi — siz faqat ko‘rasiz.</b>}</p>
        {s.zones.length === 0 && <p className="text-neutral-400">Joy kiritilmagan — Face ID istalgan joydan qilinadi, joylashuv faqat yozib qo‘yiladi.</p>}
        {s.zones.map((z: any, i: number) => {
          const set = (patch: any) => setS({ ...s, zones: s.zones.map((x: any, j: number) => j === i ? { ...x, ...patch } : x) });
          return (
            <div key={z.id || i} className={`space-y-2 rounded-xl border p-3 ${z.active === false ? 'border-neutral-200 bg-neutral-50 opacity-70' : 'border-emerald-100'}`}>
              <div className="flex flex-wrap items-end gap-2">
                <label className="min-w-[180px] flex-1">Nomi<input disabled={!superAdmin} className={input} value={z.name} onChange={e => set({ name: e.target.value })} placeholder="Sklad, Ofis, Chust filiali…" /></label>
                <label className="flex items-center gap-1.5 pb-2 font-semibold"><input disabled={!superAdmin} type="checkbox" checked={z.active !== false} onChange={e => set({ active: e.target.checked })} />Faol</label>
                {superAdmin && <button onClick={() => { if (confirm(`“${z.name}” joyi o‘chirilsinmi?`)) setS({ ...s, zones: s.zones.filter((_: any, j: number) => j !== i) }); }} className="pb-2 text-neutral-400 hover:text-red-600" title="O‘chirish"><Trash2 className="h-4 w-4" /></button>}
              </div>
              <ZoneMap lat={z.lat} lng={z.lng} radius={z.radius_m} editable={!!superAdmin} onChange={p => set({ lat: p.lat, lng: p.lng, ...(p.address ? { address: p.address } : {}) })} />
              {z.address && <p className="text-[11px] text-neutral-500">📍 {z.address}</p>}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <label>Kenglik (lat)<input disabled={!superAdmin} type="number" step="0.000001" className={input} value={z.lat} onChange={e => set({ lat: Number(e.target.value) })} /></label>
                <label>Uzunlik (lng)<input disabled={!superAdmin} type="number" step="0.000001" className={input} value={z.lng} onChange={e => set({ lng: Number(e.target.value) })} /></label>
                <label className="col-span-2">Google Maps’dan nusxa yoki havola
                  <input disabled={!superAdmin} className={input} placeholder="41.0012, 71.6721 yoki https://maps.google.com/…" onChange={e => { const c = parseCoords(e.target.value); if (c) set(c); }} />
                </label>
              </div>
              <div>
                <div className="flex items-center justify-between font-semibold"><span>Masofa (radius)</span><span className="text-emerald-700">{z.radius_m} m</span></div>
                <input disabled={!superAdmin} type="range" min={30} max={2000} step={10} value={Math.min(2000, z.radius_m)} onChange={e => set({ radius_m: Number(e.target.value) })} className="w-full accent-emerald-600" />
                <div className="flex flex-wrap gap-1">
                  {[50, 100, 200, 300, 500, 1000].map(r => <button key={r} type="button" disabled={!superAdmin} onClick={() => set({ radius_m: r })} className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${z.radius_m === r ? 'bg-emerald-600 text-white' : 'bg-neutral-100 hover:bg-neutral-200'} disabled:opacity-60`}>{r} m</button>)}
                  <input disabled={!superAdmin} type="number" min={30} max={50000} className="w-24 rounded-md border border-neutral-300 px-2 py-0.5 text-[11px]" value={z.radius_m} onChange={e => set({ radius_m: Number(e.target.value) })} title="Boshqa qiymat (30 m – 50 km)" />
                </div>
              </div>
              <div>
                <p className="font-semibold">Kim bu yerda Face ID qila oladi</p>
                <MultiSelect label="Xodimlar" allLabel="Barcha xodimlar" value={joinPicked(z.employee_ids || [])} onChange={v => superAdmin && set({ employee_ids: picked(v) })}
                  options={employees.filter(e => e.status !== 'INACTIVE').map(e => ({ value: e.id, label: e.full_name }))} />
                <p className="mt-0.5 text-[10px] text-neutral-500">Hech kim tanlanmasa — hamma xodim. Tanlansa — faqat ular (masalan, skladchilar faqat skladda, agentlar filialda).</p>
              </div>
            </div>
          );
        })}
        {superAdmin && (
          <div className="flex flex-wrap gap-2">
            <button disabled={zoneBusy} onClick={hereZone} className="inline-flex items-center gap-1 rounded-lg border border-neutral-300 px-2.5 py-1 font-semibold hover:bg-neutral-50 disabled:opacity-50"><MapPin className="h-3.5 w-3.5" />{zoneBusy ? 'Aniqlanmoqda…' : 'Hozir turgan joyimni qo‘shish'}</button>
            <button disabled={zoneBusy} onClick={() => { addZone(); setZoneMsg({ ok: true, text: 'Yangi joy qo‘shildi: xaritada bosing, manzilni qidiring yoki Google Maps koordinatasini qo‘ying, so‘ng “Joylarni saqlash”.' }); }} className="inline-flex items-center gap-1 rounded-lg border border-neutral-300 px-2.5 py-1 font-semibold hover:bg-neutral-50 disabled:opacity-50"><Plus className="h-3.5 w-3.5" />Xaritadan joy qo‘shish</button>
          </div>
        )}
        <label className="flex items-start gap-2"><input disabled={!superAdmin} type="checkbox" className="mt-0.5" checked={s.require_zone} onChange={e => setS({ ...s, require_zone: e.target.checked })} /><span><b>Face ID faqat shu joylar ichida</b> — masofadan tashqarida kamera ochilmaydi va qayd rad etiladi (urinish rahbarga ko‘rinadi). O‘chirilsa, joylashuv faqat yozib qo‘yiladi.</span></label>
        {superAdmin && <button disabled={zoneBusy} onClick={() => saveZones(s.zones, s.require_zone)} className="rounded-lg bg-emerald-600 px-4 py-1.5 font-bold text-white hover:bg-emerald-700 disabled:opacity-50">{zoneBusy ? 'Saqlanmoqda…' : 'Joylarni saqlash'}</button>}
        {zoneMsg && <p className={`rounded-lg p-2 text-[11px] font-semibold ${zoneMsg.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`}>{zoneMsg.text}</p>}

        <h3 className="pt-2 text-sm font-bold">Xavfsizlik</h3>
        <label className="font-semibold">Yuz mosligi qat’iyligi
          <select className={input} value={s.match_threshold} onChange={e => setS({ ...s, match_threshold: Number(e.target.value) })}>
            <option value={0.4}>Qat’iy (0.40)</option><option value={0.45}>Tavsiya (0.45)</option><option value={0.5}>Yumshoq (0.50)</option>
          </select>
        </label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={s.store_photos} onChange={e => setS({ ...s, store_photos: e.target.checked })} />Har qaydning kichik suratini saqlash (nizolar uchun)</label>
      </div>
      <div className="lg:col-span-2 flex justify-end"><button disabled={workBusy} onClick={save} className="rounded-xl bg-emerald-600 px-5 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50">{workBusy ? 'Saqlanmoqda…' : 'Barcha sozlamalarni saqlash'}</button></div>
    </div>
  );
};
