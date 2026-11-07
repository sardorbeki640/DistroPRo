import React, { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Check, ChevronDown, Gift, LoaderCircle, Plus, RefreshCw, Save, Search, Settings2, Trophy, Users, X } from 'lucide-react';
import { api } from '../../services/api.ts';
import type { AuthUser, LoyaltyProgram } from '../../types.ts';
import { isOwner } from '../../utils/permissions.ts';

type Product = { id: string; name: string; unit: string; external_id?: string | null; source?: string; is_active: boolean };
type Tier = { id: string; threshold: number; reward: string };
type Draft = Omit<LoyaltyProgram, 'id' | 'company_id' | 'created_at' | 'updated_at' | 'archived_at'>;
type ResultRow = { customer_id: string; customer: string; agent: string; value: number; order_count: number; earned_reward: string | null; next_reward: string | null; next_threshold: number | null; remaining: number | null };
type ResultData = { rows: ResultRow[]; summary: { customers: number; qualified: number; orders: number; total_value: number; reward_counts: { reward: string; count: number }[] }; computed_from: string };

const sheetTiers: Tier[] = [
  ['TEFAL', 40], ['CHOPPER', 55], ['QUYOSH ISITGICH', 65], ['TAROZI 30 KG', 85], ['DAZMOL', 110], ['TAROZI 200 KG', 140],
  ['PELISOS', 180], ['KULLER SUV', 210], ['POL AVTOMAT', 300], ['TELEVIZOR 32', 400], ['SAMSUNG A08', 550], ['MUZLATGICH', 650]
].map(([reward, threshold], i) => ({ id: `sheet-${i + 1}`, reward: String(reward), threshold: Number(threshold) }));

const sheetTerms = [
  'Olingan mahsulot kilogrammi yozilishi shart.',
  'Yetkazib beruvchi qayd etgan kilogramm yozilishi shart.',
  'Sovg‘alar aksiya davomida yetkazib beriladi.',
  'Aksiya muddati tugagach sovg‘a beriladi.',
  'Player o‘q o‘qi yo‘qolib qolsa — firma javob bermaydi.'
];

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(new Date());
const money = (value: number) => `${new Intl.NumberFormat('uz-UZ', { maximumFractionDigits: 0 }).format(value)} so‘m`;
const number = (value: number) => new Intl.NumberFormat('uz-UZ', { maximumFractionDigits: 2 }).format(value);
const normalizeUnit = (value: string) => ['кг', 'kilogram', 'kilogramma', 'kilogramm'].includes(value.trim().toLowerCase()) ? 'kg' : value.trim().toLowerCase();

function emptyDraft(): Draft {
  const from = today();
  const end = new Date(`${from}T12:00:00`);
  end.setMonth(end.getMonth() + 1);
  return { name: 'Yangi sodiqlik aksiyasi', metric: 'AMOUNT', unit: 'UZS', product_ids: [], group_by_agent: true, start_date: from,
    end_date: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(end), tiers: [{ id: `tier-${Date.now()}`, threshold: 1_000_000, reward: 'Yangi sovg‘a' }], terms: [], is_active: true };
}

function sheetDraft(products: Product[]): Draft {
  const draft = emptyDraft();
  const productIds = products.filter(p => ['d0_5', 'd0_6'].includes(String(p.external_id || ''))).map(p => p.id);
  return { ...draft, name: 'Semichka Premium — aksiya shabloni', metric: 'QUANTITY', unit: 'kg', product_ids: productIds, group_by_agent: true,
    start_date: '2026-11-03', end_date: '2026-11-30', tiers: sheetTiers.map(t => ({ ...t, id: `tier-${Date.now()}-${t.id}` })), terms: [...sheetTerms] };
}

function programDraft(program: LoyaltyProgram): Draft {
  return { name: program.name, metric: program.metric, unit: program.unit, product_ids: [...program.product_ids], group_by_agent: program.group_by_agent,
    start_date: program.start_date, end_date: program.end_date, tiers: program.tiers.map(t => ({ ...t })), terms: [...program.terms], is_active: program.is_active };
}

export const LoyaltyView: React.FC<{ user: AuthUser | null }> = ({ user }) => {
  const owner = isOwner(user);
  const [programs, setPrograms] = useState<LoyaltyProgram[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [results, setResults] = useState<ResultData | null>(null);
  const [loading, setLoading] = useState(true);
  const [resultsLoading, setResultsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const load = async (preserveId = selectedId) => {
    setLoading(true); setError('');
    try {
      const [p, list] = await Promise.all([api.loyalty.programs(), api.getProducts()]);
      setPrograms(p.programs || []);
      setProducts((list.products || []).filter((row: Product) => row.is_active));
      const nextId = (p.programs || []).some(row => row.id === preserveId) ? preserveId : (p.programs || []).find(row => row.is_active)?.id || '';
      setSelectedId(nextId);
    } catch (e: any) { setError(e.message || 'Sodiqlik dasturi yuklanmadi.'); }
    finally { setLoading(false); }
  };

  useEffect(() => { void load(''); }, []);
  useEffect(() => {
    let alive = true;
    if (!selectedId || draft) { setResults(null); return () => { alive = false; }; }
    setResultsLoading(true); setError('');
    api.loyalty.results(selectedId).then(value => { if (alive) setResults(value); })
      .catch((e: any) => { if (alive) { setResults(null); setError(e.message || 'Hisobot olinmadi.'); } })
      .finally(() => { if (alive) setResultsLoading(false); });
    return () => { alive = false; };
  }, [selectedId, draft, programs]);

  const visiblePrograms = useMemo(() => programs.filter(p => (includeArchived || p.is_active) && p.name.toLowerCase().includes(search.toLowerCase())), [programs, includeArchived, search]);
  const selected = programs.find(p => p.id === selectedId) || null;
  const selectedProducts = products.filter(p => draft?.product_ids.includes(p.id));
  const unitMismatch = draft?.metric === 'QUANTITY' && selectedProducts.some(p => normalizeUnit(p.unit) !== normalizeUnit(selectedProducts[0]?.unit || ''));
  const isEditing = !!draft;

  const startNew = (fromSheet = false) => {
    setError(''); setNotice(''); setEditingId(null); setDraft(fromSheet ? sheetDraft(products) : emptyDraft());
  };
  const editProgram = (program: LoyaltyProgram) => { setError(''); setNotice(''); setEditingId(program.id); setDraft(programDraft(program)); };
  const closeEditor = () => { setDraft(null); setEditingId(null); setError(''); };

  const saveProgram = async () => {
    if (!draft) return;
    setError(''); setNotice('');
    if (draft.metric === 'QUANTITY' && !draft.product_ids.length) { setError('Miqdor aksiyasi uchun hisoblanadigan mahsulotlarni tanlang.'); return; }
    if (unitMismatch) { setError('Miqdor sharti uchun bir xil birlikdagi mahsulotlarni tanlang.'); return; }
    if (!draft.tiers.length || draft.tiers.some(t => !t.reward.trim() || !(Number(t.threshold) > 0))) { setError('Har bir sovg‘aga 0 dan katta chegara va nom kiriting.'); return; }
    if (draft.start_date > draft.end_date) { setError('Aksiya sanalari oralig‘i noto‘g‘ri.'); return; }
    const body = { ...draft, unit: draft.metric === 'AMOUNT' ? 'UZS' : selectedProducts[0]?.unit || draft.unit,
      tiers: draft.tiers.map(t => ({ ...t, threshold: Number(t.threshold), reward: t.reward.trim() })),
      terms: draft.terms.map(t => t.trim()).filter(Boolean) };
    setSaving(true);
    try {
      const saved = editingId ? await api.loyalty.update(editingId, body) : await api.loyalty.create(body);
      const newId = saved.program.id;
      setDraft(null); setEditingId(null); setNotice('Aksiya shartlari saqlandi. Hisobot haqiqiy yetkazilgan savdolardan hisoblandi.');
      await load(newId); setSelectedId(newId);
    } catch (e: any) { setError(e.message || 'Aksiya saqlanmadi.'); }
    finally { setSaving(false); }
  };

  const toggleArchive = async (program: LoyaltyProgram) => {
    setError(''); setNotice(''); setSaving(true);
    try {
      await api.loyalty.toggleArchive(program.id);
      setNotice(program.is_active ? 'Aksiya arxivlandi. Savdo ma’lumotlari o‘zgarmadi.' : 'Aksiya qayta faollashtirildi.');
      await load(program.is_active ? '' : program.id);
      if (program.is_active && selectedId === program.id) setResults(null);
    } catch (e: any) { setError(e.message || 'Aksiya holati o‘zgarmadi.'); }
    finally { setSaving(false); }
  };

  const setField = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft(old => old ? { ...old, [key]: value } : old);
  const updateTier = (index: number, field: keyof Tier, value: string) => setDraft(old => old ? ({ ...old, tiers: old.tiers.map((tier, i) => i === index ? ({ ...tier, [field]: field === 'threshold' ? Number(value) : value }) : tier) }) : old);
  const removeTier = (index: number) => setDraft(old => old ? ({ ...old, tiers: old.tiers.filter((_, i) => i !== index) }) : old);
  const updateTerm = (index: number, value: string) => setDraft(old => old ? ({ ...old, terms: old.terms.map((term, i) => i === index ? value : term) }) : old);

  const formatValue = (value: number) => selected?.metric === 'AMOUNT' ? money(value) : `${number(value)} ${selected?.unit || ''}`;

  return <div className="space-y-5">
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Mijozlar bilan ishlash</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-neutral-900">Sodiqlik dasturi</h1>
        <p className="mt-1 max-w-3xl text-sm text-neutral-500">SalesDoc’dan sinxronlangan yetkazilgan savdolar asosida mijozlar progressi, sovg‘a bosqichlari va aksiya muddatlarini hisoblang.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button onClick={() => void load()} disabled={loading || saving} className="inline-flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"><RefreshCw size={15} className={loading ? 'animate-spin' : ''}/> Yangilash</button>
        {owner && <>
          <button onClick={() => startNew(true)} disabled={loading || saving} className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"><Gift size={15}/> Sheet shablonidan</button>
          <button onClick={() => startNew(false)} disabled={loading || saving} className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-800 disabled:opacity-50"><Plus size={15}/> Yangi aksiya</button>
        </>}
      </div>
    </header>

    {error && <div role="alert" className="flex items-start justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"><span>{error}</span><button onClick={() => setError('')} aria-label="Yopish"><X size={16}/></button></div>}
    {notice && <div role="status" className="flex items-start justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"><span>{notice}</span><button onClick={() => setNotice('')} aria-label="Yopish"><X size={16}/></button></div>}

    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {[
        { label: 'AKSIYALAR', value: String(programs.filter(p => p.is_active).length), icon: Gift },
        { label: 'QATNASHAYOTGAN MIJOZLAR', value: resultsLoading ? '…' : String(results?.summary.customers ?? '—'), icon: Users },
        { label: 'SOVG‘A OLISH SHARTINI BAJARGAN', value: resultsLoading ? '…' : String(results?.summary.qualified ?? '—'), icon: Trophy },
        { label: 'HISOBLANGAN SAVDOLAR', value: resultsLoading ? '…' : String(results?.summary.orders ?? '—'), icon: CalendarDays }
      ].map(card => { const Icon = card.icon; return <div key={card.label} className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm"><div className="flex items-center justify-between gap-3"><span className="text-[10px] font-semibold tracking-[0.14em] text-neutral-500">{card.label}</span><Icon size={17} className="text-emerald-700"/></div><div className="mt-3 text-2xl font-bold tabular-nums text-neutral-900">{card.value}</div></div>; })}
    </section>

    {isEditing && draft ? <section className="rounded-2xl border border-neutral-200 bg-white shadow-sm">
      <div className="flex items-start justify-between gap-3 border-b border-neutral-100 px-5 py-4">
        <div><h2 className="font-bold text-neutral-900">{editingId ? 'Aksiya shartlarini tahrirlash' : 'Yangi sodiqlik aksiyasi'}</h2><p className="mt-1 text-xs text-neutral-500">Saqlagandan keyin mijoz natijalari mavjud savdo yozuvlaridan qayta hisoblanadi.</p></div>
        <button onClick={closeEditor} aria-label="Formani yopish" className="rounded-lg p-2 text-neutral-500 hover:bg-neutral-100"><X size={18}/></button>
      </div>
      <div className="grid gap-5 p-5 xl:grid-cols-[1fr_1fr]">
        <div className="space-y-4">
          <label className="block text-xs font-semibold text-neutral-600">Aksiya nomi<input value={draft.name} onChange={e => setField('name', e.target.value)} maxLength={120} className="mt-1.5 w-full rounded-lg border border-neutral-200 px-3 py-2.5 text-sm font-normal text-neutral-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"/></label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-semibold text-neutral-600">Hisoblash turi<select value={draft.metric} onChange={e => setDraft(old => old ? ({ ...old, metric: e.target.value as Draft['metric'], unit: e.target.value === 'AMOUNT' ? 'UZS' : '', product_ids: e.target.value === 'AMOUNT' ? [] : old.product_ids }) : old)} className="mt-1.5 w-full rounded-lg border border-neutral-200 bg-white px-3 py-2.5 text-sm font-normal text-neutral-900 outline-none focus:border-emerald-500"><option value="QUANTITY">Mahsulot miqdori</option><option value="AMOUNT">Sotuv summasi</option></select></label>
            <label className="block text-xs font-semibold text-neutral-600">Guruhlash<select value={draft.group_by_agent ? 'agent' : 'customer'} onChange={e => setField('group_by_agent', e.target.value === 'agent')} className="mt-1.5 w-full rounded-lg border border-neutral-200 bg-white px-3 py-2.5 text-sm font-normal text-neutral-900 outline-none focus:border-emerald-500"><option value="agent">Mijoz + agent (Sheet kabi)</option><option value="customer">Mijoz bo‘yicha jami</option></select></label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-semibold text-neutral-600">Boshlanish sanasi<input type="date" value={draft.start_date} onChange={e => setField('start_date', e.target.value)} className="mt-1.5 w-full rounded-lg border border-neutral-200 px-3 py-2.5 text-sm font-normal text-neutral-900 outline-none focus:border-emerald-500"/></label>
            <label className="block text-xs font-semibold text-neutral-600">Tugash sanasi<input type="date" value={draft.end_date} onChange={e => setField('end_date', e.target.value)} className="mt-1.5 w-full rounded-lg border border-neutral-200 px-3 py-2.5 text-sm font-normal text-neutral-900 outline-none focus:border-emerald-500"/></label>
          </div>
          {draft.metric === 'QUANTITY' ? <div className="rounded-xl border border-neutral-200 p-3">
            <div className="mb-2 flex items-center justify-between"><div><p className="text-xs font-semibold text-neutral-700">Hisoblanadigan mahsulotlar</p><p className="mt-0.5 text-[11px] text-neutral-500">Bir xil o‘lchov birligidagi mahsulotlarni tanlang.</p></div><span className="rounded-full bg-neutral-100 px-2 py-1 text-[11px] text-neutral-600">{selectedProducts.length} ta</span></div>
            <div className="max-h-48 space-y-1 overflow-auto">
              {products.length ? products.map(product => <label key={product.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-neutral-50">
                <input type="checkbox" checked={draft.product_ids.includes(product.id)} onChange={e => setField('product_ids', e.target.checked ? [...draft.product_ids, product.id] : draft.product_ids.filter(id => id !== product.id))} className="accent-emerald-700"/>
                <span className="min-w-0 flex-1 truncate text-neutral-800">{product.name}</span><span className="text-[11px] text-neutral-500">{product.unit}{product.external_id ? ` · ${product.external_id}` : ''}</span>
              </label>) : <p className="px-2 py-4 text-center text-xs text-neutral-500">Mahsulotlar hali yuklanmagan. SalesDoc integratsiyasini va sinxronlashni tekshiring.</p>}
            </div>
            {unitMismatch && <p className="mt-2 text-xs text-rose-700">Tanlangan mahsulotlar birliklari turlicha.</p>}
          </div> : <p className="rounded-xl bg-blue-50 px-3 py-2.5 text-xs leading-5 text-blue-800">Sotuv summasi yetkazilgan buyurtmaning chegirma va qaytarishlar hisobga olingan sof savdo summasidan olinadi; qarzning to‘langan/to‘lanmaganligi natijaga ta’sir qilmaydi.</p>}
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border border-neutral-200">
            <div className="flex items-center justify-between gap-2 border-b border-neutral-100 px-3 py-2.5"><div><p className="text-sm font-semibold text-neutral-800">Sovg‘a bosqichlari</p><p className="text-[11px] text-neutral-500">Shartga yetganda eng yuqori mos sovg‘a ko‘rsatiladi.</p></div><button onClick={() => setDraft(old => old ? ({ ...old, tiers: [...old.tiers, { id: `tier-${Date.now()}`, threshold: Math.max(1, ...old.tiers.map(t => Number(t.threshold) || 0)) + 1, reward: 'Yangi sovg‘a' }] }) : old)} className="inline-flex items-center gap-1 rounded-lg border border-neutral-200 px-2.5 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"><Plus size={13}/> Bosqich</button></div>
            <div className="space-y-2 p-3">
              {draft.tiers.map((tier, index) => <div key={tier.id} className="grid grid-cols-[minmax(0,1fr)_minmax(110px,0.7fr)_auto] items-end gap-2 rounded-lg bg-neutral-50 p-2">
                <label className="text-[10px] font-semibold text-neutral-500">Sovg‘a nomi<input value={tier.reward} onChange={e => updateTier(index, 'reward', e.target.value)} className="mt-1 w-full rounded-md border border-neutral-200 bg-white px-2.5 py-2 text-sm font-normal text-neutral-900"/></label>
                <label className="text-[10px] font-semibold text-neutral-500">Chegara ({draft.metric === 'AMOUNT' ? 'so‘m' : draft.unit || selectedProducts[0]?.unit || 'birlik'})<input type="number" min="0.01" step={draft.metric === 'AMOUNT' ? '1000' : '0.1'} value={tier.threshold} onChange={e => updateTier(index, 'threshold', e.target.value)} className="mt-1 w-full rounded-md border border-neutral-200 bg-white px-2.5 py-2 text-sm font-normal text-neutral-900"/></label>
                <button onClick={() => removeTier(index)} title="Sovg‘a bosqichini olib tashlash" className="mb-0.5 rounded-md p-2 text-neutral-500 hover:bg-rose-50 hover:text-rose-700"><X size={16}/></button>
              </div>)}
              {!draft.tiers.length && <p className="py-3 text-center text-xs text-rose-700">Saqlash uchun kamida bitta sovg‘a bosqichi kerak.</p>}
            </div>
          </div>
          <div className="rounded-xl border border-neutral-200">
            <div className="flex items-center justify-between gap-2 border-b border-neutral-100 px-3 py-2.5"><div><p className="text-sm font-semibold text-neutral-800">Aksiya shartlari</p><p className="text-[11px] text-neutral-500">Matnlarni o‘zgartiring yoki olib tashlang.</p></div><button onClick={() => setField('terms', [...draft.terms, 'Yangi shart'])} className="inline-flex items-center gap-1 rounded-lg border border-neutral-200 px-2.5 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"><Plus size={13}/> Shart</button></div>
            <div className="space-y-2 p-3">
              {draft.terms.map((term, index) => <div key={`term-${index}`} className="flex gap-2"><textarea rows={2} value={term} onChange={e => updateTerm(index, e.target.value)} className="min-w-0 flex-1 resize-y rounded-lg border border-neutral-200 px-2.5 py-2 text-xs text-neutral-800"/><button onClick={() => setField('terms', draft.terms.filter((_, i) => i !== index))} aria-label="Shartni olib tashlash" className="self-start rounded-md p-2 text-neutral-500 hover:bg-rose-50 hover:text-rose-700"><X size={16}/></button></div>)}
              {!draft.terms.length && <p className="py-2 text-center text-xs text-neutral-500">Shartlar qo‘shilmagan.</p>}
            </div>
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-neutral-700"><input type="checkbox" checked={draft.is_active} onChange={e => setField('is_active', e.target.checked)} className="accent-emerald-700"/> Saqlangach aksiya faol bo‘lsin</label>
        </div>
      </div>
      <div className="flex justify-end gap-2 border-t border-neutral-100 px-5 py-4"><button onClick={closeEditor} disabled={saving} className="rounded-lg border border-neutral-200 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50">Bekor qilish</button><button onClick={() => void saveProgram()} disabled={saving || unitMismatch || !draft.tiers.length} className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">{saving ? <LoaderCircle size={15} className="animate-spin"/> : <Save size={15}/>} Saqlash</button></div>
    </section> : <div className="grid gap-5 xl:grid-cols-[300px_minmax(0,1fr)]">
      <aside className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
        <div className="border-b border-neutral-100 p-3.5">
          <div className="mb-3 flex items-center justify-between gap-2"><h2 className="text-sm font-bold text-neutral-800">Aksiyalar</h2><label className="flex items-center gap-1.5 text-[11px] text-neutral-500"><input type="checkbox" checked={includeArchived} onChange={e => setIncludeArchived(e.target.checked)} className="accent-emerald-700"/> Arxiv</label></div>
          <label className="flex items-center gap-2 rounded-lg border border-neutral-200 px-2.5 py-2"><Search size={14} className="text-neutral-400"/><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Aksiya qidirish" className="w-full text-xs outline-none"/></label>
        </div>
        {loading ? <div className="flex justify-center py-10 text-neutral-400"><LoaderCircle className="animate-spin" size={19}/></div> : visiblePrograms.length ? <div className="max-h-[540px] overflow-auto p-2">
          {visiblePrograms.map(program => <button key={program.id} onClick={() => { setSelectedId(program.id); setNotice(''); }} className={`mb-1 w-full rounded-xl border px-3 py-3 text-left transition ${selectedId === program.id ? 'border-emerald-200 bg-emerald-50' : 'border-transparent hover:bg-neutral-50'}`}>
            <span className="flex items-center justify-between gap-2"><span className="truncate text-sm font-semibold text-neutral-800">{program.name}</span><span className={`h-2 w-2 shrink-0 rounded-full ${program.is_active ? 'bg-emerald-500' : 'bg-neutral-300'}`}/></span>
            <span className="mt-1.5 block text-[11px] text-neutral-500">{program.metric === 'AMOUNT' ? 'Sotuv summasi' : `Miqdor · ${program.unit}`} · {program.start_date} — {program.end_date}</span>
            <span className="mt-1 block text-[10px] font-medium text-neutral-400">{program.tiers.length} sovg‘a · {program.terms.length} shart</span>
          </button>)}
        </div> : <div className="p-5 text-center"><Gift size={22} className="mx-auto text-neutral-300"/><p className="mt-2 text-sm font-semibold text-neutral-700">Aksiya hozircha yo‘q</p><p className="mt-1 text-xs leading-5 text-neutral-500">Sheetdagi namuna asosida yangi aksiya boshlang. Hech qanday sinov savdosi yoki mijoz kiritilmaydi.</p>{owner && <button onClick={() => startNew(true)} className="mt-3 text-xs font-semibold text-emerald-700 hover:underline">Sheet shablonini ochish</button>}</div>}
      </aside>

      <section className="min-w-0 space-y-4">
        {selected ? <>
          <div className="flex flex-col gap-3 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm sm:flex-row sm:items-start sm:justify-between sm:p-5">
            <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-bold text-neutral-900">{selected.name}</h2><span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${selected.is_active ? 'bg-emerald-100 text-emerald-800' : 'bg-neutral-100 text-neutral-600'}`}>{selected.is_active ? 'Faol' : 'Arxivlangan'}</span></div>
              <p className="mt-1.5 flex items-center gap-1.5 text-xs text-neutral-500"><CalendarDays size={13}/> {selected.start_date} — {selected.end_date} <span className="mx-1">·</span>{selected.metric === 'AMOUNT' ? 'Sof sotuv summasi · UZS' : `Mahsulot miqdori · ${selected.unit}`}</p>
              <p className="mt-1 text-[11px] text-neutral-500">Guruhlash: {selected.group_by_agent ? 'mijoz + agent (Sheetdagi kabi)' : 'mijoz bo‘yicha jami'} · Manba: sinxronlangan, yetkazilgan buyurtmalar</p>
            </div>
            {owner && <div className="flex shrink-0 flex-wrap gap-2"><button onClick={() => editProgram(selected)} className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 px-3 py-2 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"><Settings2 size={14}/> Shartlarni tahrirlash</button><button onClick={() => void toggleArchive(selected)} disabled={saving} className="rounded-lg border border-neutral-200 px-3 py-2 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-50">{selected.is_active ? 'Arxivlash' : 'Qayta faollashtirish'}</button></div>}
          </div>

          {selected.terms.length > 0 && <details className="group rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3"><summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-xs font-semibold text-amber-900"><span className="flex items-center gap-2"><Settings2 size={14}/> Aksiya shartlari ({selected.terms.length})</span><ChevronDown size={15} className="transition group-open:rotate-180"/></summary><ol className="mt-3 list-decimal space-y-1.5 pl-5 text-xs leading-5 text-amber-950">{selected.terms.map((term, index) => <li key={`${selected.id}-term-${index}`}>{term}</li>)}</ol></details>}

          <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
            <div className="flex flex-col gap-2 border-b border-neutral-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"><div><h3 className="text-sm font-bold text-neutral-800">Mijozlar natijasi</h3><p className="mt-0.5 text-[11px] text-neutral-500">Hisoblash oralig‘i aksiya sanalari bilan bir xil. Faqat “Yetkazilgan” buyurtmalar kiradi.</p></div><div className="flex items-center gap-2"><span className="text-xs text-neutral-500">{results?.summary.qualified ?? 0} ta shartni bajargan</span><button onClick={() => void load()} title="Hisobotni yangilash" className="rounded-lg border border-neutral-200 p-2 text-neutral-600 hover:bg-neutral-50"><RefreshCw size={14}/></button></div></div>
            {resultsLoading ? <div className="flex items-center justify-center gap-2 py-12 text-sm text-neutral-500"><LoaderCircle size={17} className="animate-spin"/> Hisobot hisoblanmoqda…</div> : results?.rows.length ? <div className="max-h-[580px] overflow-auto">
              <table className="w-full min-w-[830px] border-collapse text-left text-xs"><thead className="sticky top-0 z-10 bg-neutral-50 text-[10px] uppercase tracking-wide text-neutral-500"><tr><th className="px-3 py-3">#</th><th className="px-3 py-3">Do‘kon / mijoz</th><th className="px-3 py-3">Agent</th><th className="px-3 py-3 text-right">Sotuv</th><th className="px-3 py-3">Olgan sovg‘a</th><th className="px-3 py-3">Keyingi sovg‘a</th><th className="px-3 py-3 text-right">Qolgan</th></tr></thead><tbody className="divide-y divide-neutral-100">{results.rows.filter(row => !search || row.customer.toLowerCase().includes(search.toLowerCase()) || row.agent.toLowerCase().includes(search.toLowerCase())).map((row, index) => <tr key={`${row.customer_id}-${row.agent}`} className="hover:bg-neutral-50/70"><td className="px-3 py-3 text-neutral-400">{index + 1}</td><td className="max-w-[220px] truncate px-3 py-3 font-semibold text-neutral-800" title={row.customer}>{row.customer}<span className="mt-0.5 block text-[10px] font-normal text-neutral-400">{row.order_count} ta buyurtma</span></td><td className="px-3 py-3 text-neutral-600">{row.agent}</td><td className="px-3 py-3 text-right font-semibold tabular-nums text-neutral-800">{formatValue(row.value)}</td><td className="px-3 py-3">{row.earned_reward ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-1 font-semibold text-emerald-800"><Check size={11}/>{row.earned_reward}</span> : <span className="text-neutral-400">—</span>}</td><td className="px-3 py-3 text-neutral-700">{row.next_reward || (row.earned_reward ? 'Barcha bosqich bajarildi' : 'Mos bosqich yo‘q')}</td><td className="px-3 py-3 text-right tabular-nums text-neutral-700">{row.remaining === null ? '—' : formatValue(row.remaining)}</td></tr>)}</tbody></table>
            </div> : <div className="px-5 py-12 text-center"><Users size={24} className="mx-auto text-neutral-300"/><p className="mt-2 text-sm font-semibold text-neutral-700">Bu davrda mos yetkazilgan savdo topilmadi</p><p className="mx-auto mt-1 max-w-lg text-xs leading-5 text-neutral-500">Hisobot uydirma yoki jadvaldan ko‘chirilgan mijozlarni qo‘shmaydi. SalesDoc sinxronizatsiyasi va aksiya sanalari oralig‘ini tekshiring.</p></div>}
            <div className="border-t border-neutral-100 bg-neutral-50/70 px-4 py-2.5 text-[10px] text-neutral-500">{results?.computed_from || 'Hisobot bazadagi buyurtmalardan olinadi'} · Miqdor: tanlangan mahsulot qatorlaridagi dona/kg · Summa: qaytarishlar ayrilgan sof sotuv summasi.</div>
          </div>
          {results?.summary.reward_counts.some(r => r.count) && <div className="flex flex-wrap gap-2">{results.summary.reward_counts.filter(r => r.count).map(r => <span key={r.reward} className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs text-emerald-900"><b>{r.count}</b> × {r.reward}</span>)}</div>}
        </> : <div className="flex min-h-60 flex-col items-center justify-center rounded-2xl border border-dashed border-neutral-300 bg-white px-5 text-center"><Gift size={28} className="text-neutral-300"/><h2 className="mt-3 text-base font-bold text-neutral-800">Sodiqlik aksiya shablonini yarating</h2><p className="mt-1 max-w-md text-xs leading-5 text-neutral-500">Sheet’dagi sovg‘alar va shartlar boshlang‘ich namuna sifatida ochiladi. Saqlamaguningizcha dasturga hech qanday aksiya yoki ma’lumot yozilmaydi.</p>{owner && <button onClick={() => startNew(true)} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800"><Gift size={15}/> Sheet shablonini ochish</button>}</div>}
      </section>
    </div>}
  </div>;
};
