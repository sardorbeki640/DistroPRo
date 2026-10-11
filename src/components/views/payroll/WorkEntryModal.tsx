import React, { useEffect, useMemo, useState } from 'react';
import { Trash2, X } from 'lucide-react';
import { api } from '../../../services/api.ts';
import { localToday } from '../../../utils/date';
import { PayComponent, WORK_UNIT_LABEL, WorkUnit, describePayComponent } from './PaySchemeEditor.tsx';

const input = 'mt-1 w-full rounded-lg border border-neutral-300 p-2 text-xs focus:border-neutral-900 focus:outline-hidden';
const money = (n: number) => Math.round(n || 0).toLocaleString('ru-RU');

/** Rate the employee's scheme gives for a unit (days → DAILY, others → PER_UNIT of that unit). */
function schemeRate(components: PayComponent[] | undefined, unit: WorkUnit): number | null {
  const c = (components || []).find(c => (unit === 'DAY' ? c.type === 'DAILY' : c.type === 'PER_UNIT' && c.unit === unit)) as any;
  return c?.rate ?? null;
}

/**
 * Records work for any employee — days worked, trips, pieces, hours — and lists the month's entries
 * (a mistake can be deleted until that month's salary is paid).
 */
export const WorkEntryModal: React.FC<{ employees: any[]; month: string; initialEmployeeId?: string; onClose: () => void; onSaved: (message: string) => void }> = ({ employees, month, initialEmployeeId, onClose, onSaved }) => {
  const active = employees.filter(e => e.status !== 'INACTIVE');
  const [employeeId, setEmployeeId] = useState(initialEmployeeId || '');
  const employee = active.find(e => e.id === employeeId);
  // The unit the employee is paid by comes first.
  const defaultUnit = (emp: any): WorkUnit => {
    const c = (emp?.pay_components || []).find((c: any) => c.type === 'DAILY' || c.type === 'PER_UNIT');
    return c ? (c.type === 'DAILY' ? 'DAY' : c.unit) : 'DAY';
  };
  const [unit, setUnit] = useState<WorkUnit>('DAY');
  const [units, setUnits] = useState('1');
  const [rate, setRate] = useState('');
  const [date, setDate] = useState(localToday().slice(0, 7) === month ? localToday() : `${month}-01`);
  const [zone, setZone] = useState('');
  const [note, setNote] = useState('');
  const [entries, setEntries] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (employee) setUnit(defaultUnit(employee)); }, [employeeId]);
  const configured = schemeRate(employee?.pay_components, unit);
  const effectiveRate = rate !== '' ? Number(rate) : configured;
  const total = effectiveRate && Number(units) > 0 ? effectiveRate * Number(units) : null;

  const loadEntries = () => {
    if (!employeeId) { setEntries([]); return; }
    api.getWorkEntries(month, employeeId).then(r => setEntries(r.entries || [])).catch(e => setError(e.message));
  };
  useEffect(loadEntries, [employeeId, month]);

  const monthTotals = useMemo(() => {
    const by: Record<string, { units: number; amount: number }> = {};
    for (const e of entries) { const t = (by[e.unit_type] ||= { units: 0, amount: 0 }); t.units += e.units_completed; t.amount += e.total_amount; }
    return by;
  }, [entries]);

  const save = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.recordWork({
        employee_id: employeeId, unit_type: unit, units: Number(units), date,
        ...(rate !== '' ? { rate: Number(rate) } : {}),
        ...(zone.trim() ? { zone_name: zone.trim() } : {}),
        ...(note.trim() ? { note: note.trim() } : {})
      });
      onSaved(`${employee?.full_name}: ${units} × ${WORK_UNIT_LABEL[unit].toLowerCase()} qayd etildi.`);
      setUnits('1'); setNote(''); setZone('');
      loadEntries();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm('Bu yozuv o‘chirilsinmi?')) return;
    try { await api.deleteWorkEntry(id); loadEntries(); onSaved('Yozuv o‘chirildi.'); } catch (err: any) { setError(err.message); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex items-center justify-between border-b border-neutral-200 pb-3">
          <div>
            <h2 className="text-base font-bold text-neutral-900">Ish qayd etish</h2>
            <p className="text-[11px] text-neutral-500">Ishlagan kunlar (kunbay), reyslar, dona yoki soatlar (ishbay) — istalgan xodim uchun</p>
          </div>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-600"><X className="h-5 w-5" /></button>
        </div>

        {error && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">{error}</div>}

        <form onSubmit={save} className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="text-xs font-semibold text-neutral-700 sm:col-span-2">Xodim
            <select required className={input} value={employeeId} onChange={e => setEmployeeId(e.target.value)}>
              <option value="">Xodimni tanlang…</option>
              {active.map(e => <option key={e.id} value={e.id}>{e.full_name} ({e.position})</option>)}
            </select>
          </label>
          {employee && (
            <div className="sm:col-span-2 rounded-lg bg-neutral-50 p-2 text-[11px] text-neutral-600">
              Maosh tarkibi: {(employee.pay_components || []).length ? employee.pay_components.map((c: PayComponent) => describePayComponent(c)).join(' · ') : 'kiritilmagan (xodimni tahrirlab qo‘shing)'}
            </div>
          )}
          <label className="text-xs font-semibold text-neutral-700">Nima qayd etiladi
            <select className={input} value={unit} onChange={e => { setUnit(e.target.value as WorkUnit); setRate(''); }}>
              {(Object.keys(WORK_UNIT_LABEL) as WorkUnit[]).map(u => <option key={u} value={u}>{WORK_UNIT_LABEL[u]}</option>)}
            </select>
          </label>
          <label className="text-xs font-semibold text-neutral-700">Miqdor ({WORK_UNIT_LABEL[unit].toLowerCase()})
            <input required type="number" min="0.01" step="0.01" className={input} value={units} onChange={e => setUnits(e.target.value)} />
          </label>
          <label className="text-xs font-semibold text-neutral-700">Stavka, so‘m
            <input type="number" min="0" className={input} value={rate} onChange={e => setRate(e.target.value)} placeholder={configured ? `Maosh tarkibidan: ${money(configured)}` : 'Kiritilishi shart'} />
          </label>
          <label className="text-xs font-semibold text-neutral-700">Sana
            <input required type="date" className={input} value={date} onChange={e => setDate(e.target.value)} />
          </label>
          {unit === 'TRIP' && (
            <label className="text-xs font-semibold text-neutral-700 sm:col-span-2">Hudud / yo‘nalish (ixtiyoriy)
              <input className={input} value={zone} onChange={e => setZone(e.target.value)} placeholder="Masalan: Chilonzor" />
            </label>
          )}
          <label className="text-xs font-semibold text-neutral-700 sm:col-span-2">Izoh (ixtiyoriy)
            <input className={input} value={note} onChange={e => setNote(e.target.value)} />
          </label>
          <div className="flex items-center justify-between sm:col-span-2">
            <span className="text-xs text-neutral-600">{total !== null ? <>Summa: <b>{money(total)} so‘m</b></> : 'Stavkani kiriting'}</span>
            <button disabled={busy || !employeeId} className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">{busy ? 'Saqlanmoqda…' : 'Qayd etish'}</button>
          </div>
        </form>

        {employeeId && (
          <div className="mt-5 border-t border-neutral-200 pt-3">
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
              <b>{month} oyi yozuvlari</b>
              {Object.entries(monthTotals).map(([u, t]) => <span key={u} className="rounded bg-neutral-100 px-2 py-0.5">{WORK_UNIT_LABEL[u as WorkUnit]}: {t.units} · {money(t.amount)} so‘m</span>)}
            </div>
            {entries.length === 0 ? <p className="text-xs text-neutral-400">Bu oyda yozuv yo‘q.</p> : (
              <table className="min-w-full text-xs">
                <thead className="text-left text-neutral-500"><tr><th className="py-1">Sana</th><th>Turi</th><th className="text-right">Miqdor</th><th className="text-right">Stavka</th><th className="text-right">Summa</th><th>Izoh</th><th /></tr></thead>
                <tbody className="divide-y divide-neutral-100">
                  {entries.map(e => (
                    <tr key={e.id}>
                      <td className="py-1">{e.date}</td>
                      <td>{WORK_UNIT_LABEL[e.unit_type as WorkUnit]}{e.zone_name ? ` · ${e.zone_name}` : ''}</td>
                      <td className="text-right">{e.units_completed}</td>
                      <td className="text-right">{money(e.rate_applied)}</td>
                      <td className="text-right font-semibold">{money(e.total_amount)}</td>
                      <td className="max-w-[160px] truncate text-neutral-500">{e.description || ''}</td>
                      <td className="text-right"><button onClick={() => remove(e.id)} className="text-neutral-300 hover:text-red-600" title="O‘chirish"><Trash2 className="h-3.5 w-3.5" /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
