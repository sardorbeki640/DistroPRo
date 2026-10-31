import React, { useMemo, useState } from 'react';
import { TableToolbar, matchesSearch, exportTableXlsx, isPicked, picked, pickedLabels } from './TableToolbar.tsx';
import { OutOfStockLostProfitItem, stockOutLabel } from '../../types.ts';

const money = (n: number) => `${Math.round(n || 0).toLocaleString('uz-UZ')} UZS`;
const AGE: [string, string, (d: number | null) => boolean][] = [
  ['0-7', '7 kungacha', d => d !== null && d <= 7],
  ['8-30', '8–30 kun', d => d !== null && d >= 8 && d <= 30],
  ['31-90', '31–90 kun', d => d !== null && d >= 31 && d <= 90],
  ['90+', '90 kundan ko‘p', d => d !== null && d > 90],
  ['unknown', 'Sanasi noma’lum', d => d === null]
];
const SORTS: [string, string, (a: OutOfStockLostProfitItem, b: OutOfStockLostProfitItem) => number][] = [
  ['sales', 'Boy berilgan sotuv (ko‘pi)', (a, b) => b.lost_sales_uzs - a.lost_sales_uzs],
  ['profit', 'Boy berilgan foyda (ko‘pi)', (a, b) => b.lost_profit_uzs - a.lost_profit_uzs],
  ['days', 'Eng uzoq tugagan', (a, b) => (b.days_out_of_stock ?? -1) - (a.days_out_of_stock ?? -1)],
  ['daily', 'Eng tez sotiladigan', (a, b) => b.daily_sales_avg - a.daily_sales_avg],
  ['name', 'Nomi bo‘yicha', (a, b) => a.name.localeCompare(b.name)]
];
/** A purchase cost of 0 or 1 so‘m is a placeholder: the profit of that product is unknown, not zero. */
const profitKnown = (i: OutOfStockLostProfitItem) => (i.purchase_cost || 0) > 1;

/**
 * Out-of-stock products with lost sales and profit: search, filters (category, how long out, system, unknown cost),
 * sorting, totals of what is shown, and Excel of exactly those rows. Used on the dashboard and in the forecast.
 */
export const StockoutTable: React.FC<{ items: OutOfStockLostProfitItem[]; fileName?: string; loading?: boolean; error?: string | null }> = ({ items, fileName = 'Tugagan_mahsulotlar', loading = false, error = null }) => {
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [age, setAge] = useState('');
  const [source, setSource] = useState('');
  const [cost, setCost] = useState('');
  const [sort, setSort] = useState('sales');

  const categories = useMemo(() => Array.from(new Set(items.map(i => i.category || 'Kategoriyasiz'))).sort((a, b) => a.localeCompare(b)), [items]);
  const sources = useMemo(() => Array.from(new Set(items.map(i => i.source).filter(Boolean))).sort(), [items]);
  const visible = useMemo(() => items
    .filter(i => matchesSearch(i, q, ['name', 'sku', 'category'])
      && isPicked(category, i.category || 'Kategoriyasiz')
      && (!age || picked(age).some(k => AGE.find(x => x[0] === k)?.[2](i.days_out_of_stock)))
      && isPicked(source, i.source)
      && (!cost || (cost === 'known' ? profitKnown(i) : !profitKnown(i))))
    .sort(SORTS.find(s => s[0] === sort)?.[2] || SORTS[0][2]), [items, q, category, age, source, cost, sort]);

const total = (k: 'lost_sales_uzs' | 'lost_profit_uzs' | 'lost_units') => visible.reduce((s, i) => s + (i.estimate_status && i.estimate_status !== 'ESTIMATED' ? 0 : k === 'lost_profit_uzs' && !profitKnown(i) ? 0 : i[k] || 0), 0);
  const unknownShown = visible.filter(i => !profitKnown(i)).length;
const estimateLabel = (i: OutOfStockLostProfitItem) => ({
  STOCKOUT_DATE_UNKNOWN: '0 qoldiq qachondan boshlanganini aniqlab bo‘lmadi',
  NO_DEMAND_DATA: 'Sotuv tarixi yetarli emas',
  PRICE_UNKNOWN: 'Sotuv narxi aniqlanmagan',
} as Record<string, string>)[i.estimate_status || ''] || '';

  const exportExcel = () => exportTableXlsx({
    fileName,
    title: 'Tugagan mahsulotlar va boy berilgan savdo',
    columns: [
      { header: 'Mahsulot', key: 'name', width: 34 }, { header: 'SKU', key: 'sku', width: 12 }, { header: 'Kategoriya', key: 'category', width: 22 },
      { header: '0 qoldiq birinchi tasdiqlangan sana', key: 'out_of_stock_since', type: 'date' }, { header: '0 qoldiq tasdiqlanganidan o‘tgan kun', key: 'days_out_of_stock', type: 'number' },
      { header: 'Oxirgi ombor tekshiruvi', key: 'stock_observed_at', type: 'date' }, { header: 'Hisob holati', key: 'estimate_status', width: 24 },
      { header: 'Oxirgi sotuv', key: 'last_sale_date', type: 'date' }, { header: 'Kunlik o‘rtacha sotuv', key: 'daily_sales_avg', type: 'number' },
      { header: 'Sotilmagan miqdor', key: 'lost_units', type: 'number', total: true }, { header: 'Boy berilgan sotuv', key: 'lost_sales_uzs', type: 'money', total: true },
      { header: 'Foyda / dona', key: 'unit_profit_x', type: 'money' }, { header: 'Boy berilgan foyda', key: 'lost_profit_x', type: 'money', total: true },
      { header: 'Tavsiya zaxira (30 kun)', key: 'reorder', type: 'number' }, { header: 'Tizim', key: 'source', width: 12 }
    ],
    rows: visible.map(i => ({
      ...i, days_out_of_stock: i.days_out_of_stock, daily_sales_avg: Number((i.daily_sales_avg || 0).toFixed(2)), lost_units: Number((i.lost_units || 0).toFixed(1)),
      unit_profit_x: profitKnown(i) ? i.unit_profit : null, lost_profit_x: profitKnown(i) ? i.lost_profit_uzs : null, reorder: Math.round((i.daily_sales_avg || 0) * 30)
    })),
    filters: [
      q && `qidiruv: "${q}"`, category && `kategoriya: ${pickedLabels(category)}`,
      age && `tugagan: ${picked(age).map(k => AGE.find(x => x[0] === k)?.[1]).join(', ')}`,
      source && `tizim: ${pickedLabels(source)}`, cost && (cost === 'known' ? 'kirim narxi bor' : 'kirim narxi yo‘q'),
      `saralash: ${SORTS.find(s => s[0] === sort)?.[1]}`,
      unknownShown ? `${unknownShown} ta mahsulotning kirim narxi yo‘q — foydasi bo‘sh` : ''
    ]
  });

  return (
    <div className="space-y-3">
      <TableToolbar
        search={q} onSearch={setQ} searchPlaceholder="Mahsulot yoki SKU…"
        selects={[
          { label: 'Kategoriya', value: category, onChange: setCategory, allLabel: 'Barcha kategoriyalar', options: categories.map(c => ({ value: c, label: `${c} (${items.filter(i => (i.category || 'Kategoriyasiz') === c).length})` })) },
          { label: 'Tugagan', value: age, onChange: setAge, allLabel: 'Tugagan vaqti: barchasi', options: AGE.map(([value, label]) => ({ value, label })) },
          ...(sources.length > 1 ? [{ label: 'Tizim', value: source, onChange: setSource, allLabel: 'Barcha tizimlar', options: sources.map(s => ({ value: s, label: s })) }] : []),
          { label: 'Kirim narxi', single: true, value: cost, onChange: setCost, allLabel: 'Kirim narxi: hammasi', options: [{ value: 'known', label: 'Kirim narxi bor' }, { value: 'unknown', label: 'Kirim narxi yo‘q' }] },
          { label: 'Saralash', single: true, value: sort, onChange: v => setSort(v || 'sales'), allLabel: 'Saralash', options: SORTS.map(([value, label]) => ({ value, label })) }
        ]}
        count={visible.length}
        onReset={() => { setQ(''); setCategory(''); setAge(''); setSource(''); setCost(''); setSort('sales'); }}
        onExport={exportExcel}
      />
      <div className="overflow-x-auto rounded-xl border border-neutral-200">
        <table className="w-full text-left text-xs">
          <thead className="bg-neutral-50 text-[10px] font-bold uppercase tracking-wider text-neutral-600">
            <tr>
              <th className="px-3 py-2.5">Mahsulot</th>
              <th className="px-3 py-2.5">Kategoriya</th>
              <th className="px-3 py-2.5 text-center">0 qoldiq tekshiruvi</th>
              <th className="px-3 py-2.5 text-right">Kunlik sotuv</th>
              <th className="px-3 py-2.5 text-right">Boy berilgan sotuv</th>
              <th className="px-3 py-2.5 text-right">Foyda / dona</th>
              <th className="px-3 py-2.5 text-right text-rose-700">Boy berilgan foyda</th>
              <th className="px-3 py-2.5 text-center">Tavsiya zaxira</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {visible.map(i => (
              <tr key={i.id} className="hover:bg-rose-50/30">
                <td className="px-3 py-2.5"><div className="font-bold text-neutral-900">{i.name}</div><div className="font-mono text-[10px] text-neutral-400">{i.sku}{i.source ? ` · ${i.source}` : ''}</div></td>
                <td className="px-3 py-2.5 text-neutral-600">{i.category}</td>
                <td className="px-3 py-2.5 text-center">
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-extrabold ${i.days_out_of_stock === null ? 'bg-neutral-100 text-neutral-600' : 'bg-rose-100 text-rose-900'}`}>
                    {i.days_out_of_stock !== null && i.out_of_stock_since
                      ? `0 qoldiq ${i.days_out_of_stock === 0 ? 'bugun' : `${i.days_out_of_stock} kun`} · ${i.out_of_stock_since.split('-').reverse().join('.')}`
                      : stockOutLabel(i)}
                  </span>
                  {i.stock_observed_at && <div className="mt-0.5 text-[10px] text-neutral-400">Oxirgi tekshiruv: {i.stock_observed_at.split('-').reverse().join('.')}</div>}
                </td>
                <td className="px-3 py-2.5 text-right font-semibold text-neutral-800">{Number((i.daily_sales_avg || 0).toFixed(2))} {i.unit || 'dona'}/kun</td>
                <td className="px-3 py-2.5 text-right">{estimateLabel(i) ? <span className="text-[10px] text-amber-700">{estimateLabel(i)}</span> : <><div className="font-bold text-neutral-900">{money(i.lost_sales_uzs)}</div><div className="text-[10px] text-neutral-500">taxminan {Number((i.lost_units || 0).toFixed(1))} {i.unit || 'dona'}</div></>}</td>
                <td className="px-3 py-2.5 text-right">{profitKnown(i) ? <><div className="font-semibold text-neutral-700">{money(i.unit_profit)}</div><div className="text-[10px] font-bold text-emerald-600">{i.profit_margin_pct}% marja</div></> : <span className="text-[10px] text-neutral-400">kirim narxi yo‘q</span>}</td>
                <td className="px-3 py-2.5 text-right">{profitKnown(i) ? <span className="text-sm font-black text-rose-600">{money(i.lost_profit_uzs)}</span> : <span className="text-[10px] text-neutral-400">hisoblanmadi</span>}</td>
                <td className="px-3 py-2.5 text-center"><span className="rounded-md bg-indigo-50 px-2 py-0.5 font-bold text-indigo-700">{Math.round((i.daily_sales_avg || 0) * 30)} {i.unit || 'dona'}</span></td>
              </tr>
            ))}
            {!visible.length && <tr><td colSpan={8} className="py-8 text-center text-neutral-500">{loading ? 'Tugagan mahsulotlar yuklanmoqda…' : error ? `Ma’lumot olinmadi: ${error}` : items.length ? 'Filtr bo‘yicha mahsulot topilmadi.' : 'Ulangan ombor ma’lumotida tugagan mahsulot topilmadi.'}</td></tr>}
          </tbody>
          {visible.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-rose-200 bg-rose-50/70 font-bold">
                <td colSpan={4} className="px-3 py-2.5 text-rose-950">JAMI ({visible.length} ta mahsulot)</td>
                <td className="px-3 py-2.5 text-right"><div className="font-black">{money(total('lost_sales_uzs'))}</div><div className="text-[10px] font-normal text-neutral-500">{Number(total('lost_units').toFixed(1))} dona</div></td>
                <td />
                <td className="px-3 py-2.5 text-right"><div className="font-black text-rose-700">{money(total('lost_profit_uzs'))}</div>{unknownShown > 0 && <div className="text-[10px] font-normal text-neutral-500">{unknownShown} tasi kirmagan (kirim narxi yo‘q)</div>}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
};
