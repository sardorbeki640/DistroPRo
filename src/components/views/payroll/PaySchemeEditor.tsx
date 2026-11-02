import React, { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '../../../services/api.ts';

export type WorkUnit = 'DAY' | 'TRIP' | 'PIECE' | 'HOUR' | 'OTHER';
export type PayComponent =
  | { type: 'MONTHLY'; amount: number; label?: string }
  | { type: 'DAILY'; rate: number; label?: string }
  | { type: 'PER_UNIT'; unit: Exclude<WorkUnit, 'DAY'>; rate: number; label?: string }
  | { type: 'PERCENT'; percent: number; base: 'OWN_SALES' | 'COMPANY_SALES' | 'OWN_DELIVERIES'; source?: 'INTEGRATION' | 'SHEETS'; agent_id?: string | null; expeditor_name?: string | null; label?: string }
  | { type: 'KPI'; base: 'OWN_SALES'; source: 'INTEGRATION' | 'SHEETS'; metric?: 'SALES_AMOUNT' | 'SALES_VOLUME' | 'ORDER_COUNT' | 'SUCCESSFUL_VISITS' | 'ACTIVE_CUSTOMER_BASE' | 'TOTAL_CUSTOMER_BASE' | 'CUSTOMER_ACTIVATIONS' | 'RETURN_COUNT' | 'RETURN_AMOUNT' | 'ACTIVE_CUSTOMERS_BY_CATEGORY' | 'ACTIVE_CUSTOMERS_BY_SKU' | 'CUSTOMER_PAYMENTS'; target_amount: number; agent_id?: string | null; integration_id?: string | null; reward_type?: 'FIXED' | 'PERCENT_OF_SALES' | 'PERCENT_OF_RECEIPTS' | 'PERCENT_OF_BASE_PAY' | 'PER_UNIT'; reward_value?: number; max_reward?: number | null; share_percent?: number; criteria?: { territory_ids?: string[]; product_categories?: string[]; product_brands?: string[]; product_ids?: string[]; payment_types?: string[]; order_statuses?: ('DELIVERED' | 'PENDING')[]; only_new_customers?: boolean }; tiers: { achievement_percent: number; bonus_percent: number }[]; label?: string; comment?: string };

export const WORK_UNIT_LABEL: Record<WorkUnit, string> = { DAY: 'Ish kuni', TRIP: 'Reys', PIECE: 'Dona', HOUR: 'Soat', OTHER: 'Boshqa ish' };
const PERCENT_BASE_LABEL = { OWN_SALES: 'agentning o‘z savdosidan', COMPANY_SALES: 'butun korxona savdosidan', OWN_DELIVERIES: 'o‘zi yetkazib bergan buyurtmalardan' };
const money = (n: number) => Math.round(n || 0).toLocaleString('ru-RU');
const KPI_METRICS = [
  ['SALES_AMOUNT', 'Sotuv summasi'], ['SALES_VOLUME', 'Sotuv hajmi'], ['ORDER_COUNT', 'Sotuvlar soni'],
  ['SUCCESSFUL_VISITS', 'Muvaffaqiyatli vizitlar'], ['ACTIVE_CUSTOMER_BASE', 'Faol mijozlar bazasi'],
  ['TOTAL_CUSTOMER_BASE', 'Umumiy mijozlar bazasi'], ['NEW_CUSTOMERS', 'Yangi mijozlar (TT)'], ['CUSTOMER_ACTIVATIONS', 'Yangi faollashgan mijozlar'],
  ['RETURN_COUNT', 'Qaytgan buyurtmalar soni'], ['RETURN_AMOUNT', 'Qaytarish summasi'],
  ['ACTIVE_CUSTOMERS_BY_CATEGORY', 'Kategoriya bo‘yicha faol mijozlar'], ['ACTIVE_CUSTOMERS_BY_SKU', 'SKU bo‘yicha faol mijozlar'],
  ['CUSTOMER_PAYMENTS', 'Mijozlardan tushgan to‘lov']
] as const;

/** One line of the scheme in plain words ("Kunbay: 100 000 so‘m × ishlagan kun"). */
export function describePayComponent(c: PayComponent): string {
  switch (c.type) {
    case 'MONTHLY': return `Oylik: ${money(c.amount)} so‘m`;
    case 'DAILY': return `Kunbay: ${money(c.rate)} so‘m × ishlagan kun`;
    case 'PER_UNIT': return `Ishbay: ${money(c.rate)} so‘m × ${WORK_UNIT_LABEL[c.unit].toLowerCase()}`;
    case 'PERCENT': return `Foiz: ${c.percent}% ${PERCENT_BASE_LABEL[c.base]}`;
    case 'KPI': return `KPI: ${KPI_METRICS.find(([id]) => id === (c.metric || 'SALES_AMOUNT'))?.[1] || 'vazifa'} · reja ${money(c.target_amount)} · ${c.source === 'SHEETS' ? 'Sheets' : 'ulangan tizim'}`;
  }
}

const input = 'w-full rounded-lg border border-neutral-300 px-2 py-1.5 text-xs focus:border-neutral-900 focus:outline-hidden';

/** Builds an employee's pay from any mix of parts: monthly, per day, per trip / piece / hour, and percent of sales. */
export const PaySchemeEditor: React.FC<{ value: PayComponent[]; onChange: (v: PayComponent[]) => void; employeeName?: string }> = ({ value, onChange, employeeName }) => {
  const [options, setOptions] = useState<{ agents: { id: string; name: string; code: string }[]; expeditors: string[]; productCategories: string[]; productBrands: string[]; products: { id: string; sku: string; name: string; category: string }[]; territories: { id: string; name: string }[]; integrations: { id: string; name: string }[] }>({ agents: [], expeditors: [], productCategories: [], productBrands: [], products: [], territories: [], integrations: [] });
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
            {c.type === 'MONTHLY' ? 'Oylik (fiks)' : c.type === 'DAILY' ? 'Kunbay' : c.type === 'PER_UNIT' ? 'Ishbay' : c.type === 'KPI' ? 'Agent KPI' : 'Foiz'}
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
                <>
                <select className="col-span-3 w-full rounded-lg border border-neutral-300 px-2 py-1.5 text-xs" value={c.source || 'INTEGRATION'} onChange={e => set(i, { source: e.target.value as any })}>
                  <option value="INTEGRATION">Savdo manbai: ulangan dasturlar (SalesDoctor / Linko)</option>
                  <option value="SHEETS">Savdo manbai: Google Sheets</option>
                </select>
                <select className={`${input} col-span-3`} value={c.agent_id || ''} onChange={e => set(i, { agent_id: e.target.value || null })}>
                  <option value="">Xodimga bog‘langan agent</option>
                  {options.agents.map(a => <option key={a.id} value={a.id}>{a.name}{a.code ? ` · ${a.code}` : ''}</option>)}
                </select>
                </>
              )}
              {c.base === 'OWN_DELIVERIES' && (
                <select className={`${input} col-span-3`} value={c.expeditor_name || ''} onChange={e => set(i, { expeditor_name: e.target.value || null })}>
                  <option value="">Ism bo‘yicha: {employeeName || 'xodim F.I.SH'}</option>
                  {options.expeditors.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              )}
            </div>
          )}
          {c.type === 'KPI' && (
            <div className="col-span-8 grid grid-cols-2 gap-1.5">
              <label className="col-span-2 text-[10px] text-neutral-500">Vazifa nomi
                <input className={input} value={c.label || ''} onChange={e => set(i, { label: e.target.value })} placeholder="Masalan: Oylik sotuv rejasi" />
              </label>
              <label className="col-span-2 text-[10px] text-neutral-500">Izoh / vazifa sharti
                <input className={input} value={c.comment || ''} onChange={e => set(i, { comment: e.target.value })} placeholder="Xodimga ko‘rinadigan qisqa izoh" />
              </label>
              <label className="text-[10px] text-neutral-500">KPI vazifasi
                <select className={input} value={c.metric || 'SALES_AMOUNT'} onChange={e => set(i, { metric: e.target.value as any, ...(e.target.value !== 'SALES_AMOUNT' ? { source: 'INTEGRATION' } : {}) })}>
                  {KPI_METRICS.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                  <option disabled>Reja tashrifi / возврат hajmi / yangi TT — manbada ma’lumot bo‘lsa qo‘shiladi</option>
                </select>
              </label>
              <label className="text-[10px] text-neutral-500">Davr rejasi
                <input type="number" min="1" className={input} value={c.target_amount || ''} onChange={e => set(i, { target_amount: Number(e.target.value) })} placeholder="Miqdor / summa" />
              </label>
              <label className="text-[10px] text-neutral-500">Manba
                <select className={input} value={c.source} onChange={e => set(i, { source: e.target.value as any })}>
                  <option value="INTEGRATION">Ulangan tizim</option><option value="SHEETS" disabled={(c.metric || 'SALES_AMOUNT') !== 'SALES_AMOUNT'}>Google Sheets (faqat sotuv summasi)</option>
                </select>
              </label>
              {c.source === 'INTEGRATION' && <label className="text-[10px] text-neutral-500">Ulangan server
                <select className={input} value={c.integration_id || ''} onChange={e => set(i, { integration_id: e.target.value || null })}>
                  <option value="">Barcha ulangan serverlar</option>{options.integrations.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
              </label>}
              <select className={`${input} col-span-2`} value={c.agent_id || ''} onChange={e => set(i, { agent_id: e.target.value || null })}>
                <option value="">Xodimga bog‘langan agent</option>{options.agents.map(a => <option key={a.id} value={a.id}>{a.name}{a.code ? ` · ${a.code}` : ''}</option>)}
              </select>
              {c.source === 'INTEGRATION' ? <details className="col-span-2 rounded-lg border border-neutral-200 p-2">
                <summary className="cursor-pointer text-[10px] font-semibold text-neutral-700">SalesDoctor mezonlari (ixtiyoriy filtrlash)</summary>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <label className="text-[10px] text-neutral-500">Hududlar
                    <select multiple className={`${input} h-20`} value={c.criteria?.territory_ids || []} onChange={e => set(i, { criteria: { ...c.criteria, territory_ids: Array.from(e.target.selectedOptions, o => o.value) } })}>{options.territories.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
                  </label>
                  <label className="text-[10px] text-neutral-500">Mahsulot kategoriyalari
                    <select multiple className={`${input} h-20`} value={c.criteria?.product_categories || []} onChange={e => set(i, { criteria: { ...c.criteria, product_categories: Array.from(e.target.selectedOptions, o => o.value) } })}>{options.productCategories.map(x => <option key={x} value={x}>{x}</option>)}</select>
                  </label>
                  <label className="text-[10px] text-neutral-500">Brendlar
                    <select multiple className={`${input} h-20`} value={c.criteria?.product_brands || []} onChange={e => set(i, { criteria: { ...c.criteria, product_brands: Array.from(e.target.selectedOptions, o => o.value) } })}>{options.productBrands.map(x => <option key={x} value={x}>{x}</option>)}</select>
                  </label>
                  {(c.metric === 'SALES_VOLUME' || c.metric === 'SALES_AMOUNT' || c.metric === 'ACTIVE_CUSTOMERS_BY_SKU') && <label className="col-span-2 text-[10px] text-neutral-500">Mahsulotlar / SKU
                    <select multiple className={`${input} h-24`} value={c.criteria?.product_ids || []} onChange={e => set(i, { criteria: { ...c.criteria, product_ids: Array.from(e.target.selectedOptions, o => o.value) } })}>{options.products.map(x => <option key={x.id} value={x.id}>{x.name}{x.sku ? ` · ${x.sku}` : ''}</option>)}</select>
                  </label>}
                  <label className="text-[10px] text-neutral-500">Buyurtma holati
                    <select multiple className={`${input} h-14`} value={c.criteria?.order_statuses || ['DELIVERED']} onChange={e => set(i, { criteria: { ...c.criteria, order_statuses: Array.from(e.target.selectedOptions, o => o.value as any) } })}><option value="DELIVERED">Yetkazilgan</option><option value="PENDING">Kutilmoqda</option></select>
                  </label>
                  <label className="text-[10px] text-neutral-500">To‘lov turi
                    <select multiple className={`${input} h-20`} value={c.criteria?.payment_types || []} onChange={e => set(i, { criteria: { ...c.criteria, payment_types: Array.from(e.target.selectedOptions, o => o.value) } })}><option value="CASH">Naqd</option><option value="TERMINAL">Terminal</option><option value="CLICK">Click</option><option value="BANK_TRANSFER">Bank o‘tkazmasi</option><option value="CREDIT">Qarz</option><option value="SPLIT">Aralash</option></select>
                  </label>
                  <label className="flex items-center gap-1 self-end pb-2 text-[10px] text-neutral-600"><input type="checkbox" checked={!!c.criteria?.only_new_customers} onChange={e => set(i, { criteria: { ...c.criteria, only_new_customers: e.target.checked } })} />Faqat yangi mijozlar</label>
                </div>
              </details> : <p className="col-span-2 rounded-lg bg-amber-50 p-2 text-[10px] text-amber-800">Sheets faqat agent va oy bo‘yicha jami sotuv summasini beradi. Hudud, mahsulot, to‘lov turi kabi batafsil mezonlar bu manbada mavjud emas.</p>}
              <label className="text-[10px] text-neutral-500">Mukofot usuli
                <select className={input} value={c.reward_type || 'PERCENT_OF_SALES'} onChange={e => set(i, { reward_type: e.target.value as any })}>
                  <option value="FIXED">Belgilangan summa</option><option value="PERCENT_OF_SALES">Sotuv summasidan foiz</option><option value="PERCENT_OF_RECEIPTS">Tushumdan foiz</option><option value="PERCENT_OF_BASE_PAY">Asosiy oylikdan foiz</option><option value="PER_UNIT">Har KPI birligi uchun summa</option>
                </select>
              </label>
              <label className="text-[10px] text-neutral-500">Mukofot qiymati
                <input type="number" min="0.01" step="0.01" className={input} value={c.reward_value ?? 1} onChange={e => set(i, { reward_value: Number(e.target.value) })} />
              </label>
              <label className="text-[10px] text-neutral-500">Mukofotning eng yuqori chegarasi (ixtiyoriy)
                <input type="number" min="0" className={input} value={c.max_reward ?? ''} onChange={e => set(i, { max_reward: e.target.value ? Number(e.target.value) : null })} />
              </label>
              <label className="text-[10px] text-neutral-500">Umumiy KPI dagi ulushi, %
                <input type="number" min="0.01" max="100" step="0.01" className={input} value={c.share_percent ?? 100} onChange={e => set(i, { share_percent: Number(e.target.value) })} />
              </label>
              <div className="col-span-2 space-y-1 rounded-lg bg-neutral-50 p-2">
                <div className="flex items-center justify-between text-[10px] font-semibold text-neutral-600"><span>Reja bajarilish bosqichlari — mukofotning to‘lanadigan foizi</span><button type="button" onClick={() => set(i, { tiers: [...c.tiers, { achievement_percent: 100, bonus_percent: 100 }] })} className="text-emerald-700">+ Bosqich</button></div>
                {c.tiers.map((tier, ti) => <div key={ti} className="grid grid-cols-[1fr_1fr_auto] items-center gap-1">
                  <label className="text-[10px] text-neutral-500"><input type="number" min="1" max="1000" className={input} value={tier.achievement_percent || ''} onChange={e => set(i, { tiers: c.tiers.map((t, j) => j === ti ? { ...t, achievement_percent: Number(e.target.value) } : t) })} />% reja bajarildi</label>
                  <label className="text-[10px] text-neutral-500"><input type="number" min="0.01" max="100" step="0.01" className={input} value={tier.bonus_percent || ''} onChange={e => set(i, { tiers: c.tiers.map((t, j) => j === ti ? { ...t, bonus_percent: Number(e.target.value) } : t) })} />% mukofot</label>
                  <button type="button" disabled={c.tiers.length <= 1} onClick={() => set(i, { tiers: c.tiers.filter((_, j) => j !== ti) })} className="text-neutral-400 disabled:opacity-30" title="Bosqichni o‘chirish"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>)}
              </div>
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
          ,['KPI vazifasi qo‘shish', { type: 'KPI', base: 'OWN_SALES', source: 'INTEGRATION', metric: 'SALES_AMOUNT', target_amount: 0, reward_type: 'PERCENT_OF_SALES', reward_value: 1, tiers: [{ achievement_percent: 100, bonus_percent: 100 }] }]
        ].map(([label, c]) => (
          <button key={label as string} type="button" onClick={() => add(c as PayComponent)} className="inline-flex items-center gap-1 rounded-lg border border-neutral-300 bg-white px-2 py-1 text-[11px] font-semibold text-neutral-700 hover:bg-neutral-100">
            <Plus className="h-3 w-3" />{label as string}
          </button>
        ))}
      </div>
      <p className="text-[10px] text-neutral-500">Har agentga vazifa turi, server/manba, reja, mezonlar, mukofot usuli, yuqori chegara va pog‘onalarni alohida belgilang. Sheets faqat sotuv summasi vazifasiga ishlaydi; SalesDoctor va Linko esa ulangan serverdagi buyurtmalar orqali olinadi.</p>
    </div>
  );
};
