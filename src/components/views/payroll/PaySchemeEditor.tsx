import React, { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '../../../services/api.ts';

export type WorkUnit = 'DAY' | 'TRIP' | 'PIECE' | 'HOUR' | 'OTHER';
export type PayComponent =
  | { type: 'MONTHLY'; amount: number; label?: string }
  | { type: 'DAILY'; rate: number; label?: string }
  | { type: 'PER_UNIT'; unit: Exclude<WorkUnit, 'DAY'>; rate: number; label?: string }
  | { type: 'PERCENT'; percent: number; base: 'OWN_SALES' | 'COMPANY_SALES' | 'OWN_DELIVERIES'; agent_id?: string | null; expeditor_name?: string | null; label?: string };

export const WORK_UNIT_LABEL: Record<WorkUnit, string> = { DAY: 'Ish kuni', TRIP: 'Reys', PIECE: 'Dona', HOUR: 'Soat', OTHER: 'Boshqa ish' };
const PERCENT_BASE_LABEL = { OWN_SALES: 'agentning o‘z savdosidan', COMPANY_SALES: 'butun korxona savdosidan', OWN_DELIVERIES: 'o‘zi yetkazib bergan buyurtmalardan' };
const money = (n: number) => Math.round(n || 0).toLocaleString('ru-RU');

/** One line of the scheme in plain words ("Kunbay: 100 000 so‘m × ishlagan kun"). */
export function describePayComponent(c: PayComponent): string {
  switch (c.type) {
    case 'MONTHLY': return `Oylik: ${money(c.amount)} so‘m`;
    case 'DAILY': return `Kunbay: ${money(c.rate)} so‘m × ishlagan kun`;
    case 'PER_UNIT': return `Ishbay: ${money(c.rate)} so‘m × ${WORK_UNIT_LABEL[c.unit].toLowerCase()}`;
    case 'PERCENT': return `Foiz: ${c.percent}% ${PERCENT_BASE_LABEL[c.base]}`;
  }
}

const input = 'w-full rounded-lg border border-neutral-300 px-2 py-1.5 text-xs focus:border-neutral-900 focus:outline-hidden';

/** Builds an employee's pay from any mix of parts: monthly, per day, per trip / piece / hour, and percent of sales. */
export const PaySchemeEditor: React.FC<{ value: PayComponent[]; onChange: (v: PayComponent[]) => void; employeeName?: string }> = ({ value, onChange, employeeName }) => {
  const [options, setOptions] = useState<{ agents: { id: string; name: string; code: string }[]; expeditors: string[] }>({ agents: [], expeditors: [] });
  useEffect(() => { api.getPayOptions().then(setOptions).catch(() => {}); }, []);

  const set = (i: number, patch: Partial<PayComponent>) => onChange(value.map((c, j) => (j === i ? ({ ...c, ...patch } as PayComponent) : c)));
  const remove = (i: number) => onChange(value.filter((_, j) => j !== i));
  const add = (c: PayComponent) => onChange([...value, c]);

  return (
    <div className="space-y-2 rounded-xl border border-neutral-200 bg-neutral-50 p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-neutral-800">Maosh tarkibi</span>
        <span className="text-[10px] text-neutral-500">Bir nechta qismni birga qo‘shish mumkin</span>
      </div>

      {value.length === 0 && <p className="text-[11px] text-amber-700">Hali qism yo‘q — bu xodimga maosh hisoblanmaydi. Quyidan qo‘shing.</p>}

      {value.map((c, i) => (
        <div key={i} className="grid grid-cols-12 items-center gap-2 rounded-lg border border-neutral-200 bg-white p-2">
          <span className="col-span-3 text-[11px] font-semibold text-neutral-700">
            {c.type === 'MONTHLY' ? 'Oylik (fiks)' : c.type === 'DAILY' ? 'Kunbay' : c.type === 'PER_UNIT' ? 'Ishbay' : 'Foiz'}
          </span>
          {c.type === 'MONTHLY' && (
            <label className="col-span-8 flex items-center gap-1 text-[11px] text-neutral-500">
              <input type="number" min="0" className={input} value={c.amount || ''} onChange={e => set(i, { amount: Number(e.target.value) })} placeholder="Oylik summa" /> so‘m/oy
            </label>
          )}
          {c.type === 'DAILY' && (
            <label className="col-span-8 flex items-center gap-1 text-[11px] text-neutral-500">
              <input type="number" min="0" className={input} value={c.rate || ''} onChange={e => set(i, { rate: Number(e.target.value) })} placeholder="1 kun uchun" /> so‘m/kun
            </label>
          )}
          {c.type === 'PER_UNIT' && (
            <div className="col-span-8 grid grid-cols-2 gap-1">
              <input type="number" min="0" className={input} value={c.rate || ''} onChange={e => set(i, { rate: Number(e.target.value) })} placeholder="Stavka, so‘m" />
              <select className={input} value={c.unit} onChange={e => set(i, { unit: e.target.value as any })}>
                <option value="TRIP">har reys uchun</option>
                <option value="PIECE">har dona uchun</option>
                <option value="HOUR">har soat uchun</option>
                <option value="OTHER">boshqa birlik uchun</option>
              </select>
            </div>
          )}
          {c.type === 'PERCENT' && (
            <div className="col-span-8 grid grid-cols-3 gap-1">
              <input type="number" min="0" max="100" step="0.01" className={input} value={c.percent || ''} onChange={e => set(i, { percent: Number(e.target.value) })} placeholder="%" />
              <select className={`${input} col-span-2`} value={c.base} onChange={e => set(i, { base: e.target.value as any, agent_id: null, expeditor_name: null })}>
                <option value="OWN_SALES">agent sifatida o‘z savdosidan</option>
                <option value="OWN_DELIVERIES">yetkazib bergan buyurtmalaridan</option>
                <option value="COMPANY_SALES">butun korxona savdosidan</option>
              </select>
              {c.base === 'OWN_SALES' && (
                <select className={`${input} col-span-3`} value={c.agent_id || ''} onChange={e => set(i, { agent_id: e.target.value || null })}>
                  <option value="">Xodimga bog‘langan agent</option>
                  {options.agents.map(a => <option key={a.id} value={a.id}>{a.name}{a.code ? ` · ${a.code}` : ''}</option>)}
                </select>
              )}
              {c.base === 'OWN_DELIVERIES' && (
                <select className={`${input} col-span-3`} value={c.expeditor_name || ''} onChange={e => set(i, { expeditor_name: e.target.value || null })}>
                  <option value="">Ism bo‘yicha: {employeeName || 'xodim F.I.SH'}</option>
                  {options.expeditors.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              )}
            </div>
          )}
          <button type="button" onClick={() => remove(i)} className="col-span-1 justify-self-end text-neutral-400 hover:text-red-600" title="Olib tashlash">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ))}

      <div className="flex flex-wrap gap-1.5 pt-1">
        {[
          ['Oylik (fiks)', { type: 'MONTHLY', amount: 0 }],
          ['Kunbay', { type: 'DAILY', rate: 0 }],
          ['Reysbay', { type: 'PER_UNIT', unit: 'TRIP', rate: 0 }],
          ['Donabay / soatbay', { type: 'PER_UNIT', unit: 'PIECE', rate: 0 }],
          ['Foiz (savdodan)', { type: 'PERCENT', percent: 0, base: 'OWN_SALES' }]
        ].map(([label, c]) => (
          <button key={label as string} type="button" onClick={() => add(c as PayComponent)} className="inline-flex items-center gap-1 rounded-lg border border-neutral-300 bg-white px-2 py-1 text-[11px] font-semibold text-neutral-700 hover:bg-neutral-100">
            <Plus className="h-3 w-3" />{label as string}
          </button>
        ))}
      </div>
      <p className="text-[10px] text-neutral-500">Kunbay va ishbay “Ish qayd etish” orqali kiritilgan kun, reys, dona va soatlardan hisoblanadi. Foiz ulangan tizimdan kelgan, shu oyda yetkazilgan buyurtmalar (qaytarishsiz) summasidan olinadi.</p>
    </div>
  );
};
