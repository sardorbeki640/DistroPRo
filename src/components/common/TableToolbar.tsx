import React, { useState } from 'react';
import { Search, FileSpreadsheet, RefreshCw, X } from 'lucide-react';
import { api, XlsxColumnSpec } from '../../services/api.ts';
import { localToday } from '../../utils/date';
import { MultiSelect } from './MultiSelect.tsx';
export { picked, isPicked, pickedLabels } from './MultiSelect.tsx';

export type ToolbarSelect = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  /** Label of the empty option ("Barchasi"). */
  allLabel?: string;
  /** One value only (a plain dropdown); by default several can be chosen. */
  single?: boolean;
};

interface TableToolbarProps {
  search?: string;
  onSearch?: (value: string) => void;
  searchPlaceholder?: string;
  selects?: ToolbarSelect[];
  dateFrom?: string;
  dateTo?: string;
  onDateFrom?: (value: string) => void;
  onDateTo?: (value: string) => void;
  /** Rows shown after filtering. */
  count?: number;
  onReset?: () => void;
  onExport?: () => Promise<void> | void;
  exportLabel?: string;
  children?: React.ReactNode;
}

/** The green Excel button with its own busy state and error, for bars that keep their own filters. */
export const ExportButton: React.FC<{ onExport: () => Promise<void> | void; label?: string; className?: string }> = ({ onExport, label = 'Excel', className = '' }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setError(null);
    try { await onExport(); } catch (err: any) { setError(err.message || 'Excel faylini yuklab bo‘lmadi'); } finally { setBusy(false); }
  };
  return (
    <span className="inline-flex flex-col">
      <button
        type="button"
        onClick={run}
        disabled={busy}
        title="Ekrandagi (filtrlangan) ma'lumotni Excel faylga yuklab olish"
        className={`inline-flex h-9 items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 text-xs font-bold text-white shadow-xs transition hover:bg-emerald-700 disabled:opacity-60 ${className}`}
      >
        {busy ? <RefreshCw className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
        {label}
      </button>
      {error && <span className="mt-1 max-w-[220px] text-[10px] text-red-600">{error}</span>}
    </span>
  );
};

/** Search, filters and an Excel button in one bar, the same in every section. */
export const TableToolbar: React.FC<TableToolbarProps> = ({
  search, onSearch, searchPlaceholder = 'Qidirish…', selects = [], dateFrom, dateTo, onDateFrom, onDateTo,
  count, onReset, onExport, exportLabel = 'Excel', children
}) => {
  const active = !!search || selects.some(s => !!s.value) || (!!onDateFrom && !!dateFrom) || (!!onDateTo && !!dateTo);

  const field = 'h-9 rounded-xl border border-neutral-200 bg-neutral-50 px-3 text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500';

  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-2 rounded-2xl border border-neutral-200 bg-white p-3 shadow-xs lg:flex-row lg:items-center">
        {onSearch && (
          <div className="relative w-full lg:w-64">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-neutral-400" />
            <input
              type="text"
              value={search || ''}
              onChange={e => onSearch(e.target.value)}
              placeholder={searchPlaceholder}
              className={`${field} w-full pl-9`}
            />
          </div>
        )}
        <div className="flex flex-1 flex-wrap items-center gap-2">
          {selects.map(s => s.single ? (
            <select key={s.label} value={s.value} onChange={e => s.onChange(e.target.value)} title={s.label} className={`${field} max-w-[220px]`}>
              <option value="">{s.allLabel || `${s.label}: barchasi`}</option>
              {s.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          ) : (
            // Several values can be chosen; read the value with isPicked()/picked().
            <MultiSelect key={s.label} label={s.label} value={s.value} onChange={s.onChange} options={s.options} allLabel={s.allLabel} />
          ))}
          {onDateFrom && (
            <label className="flex items-center gap-1 text-[11px] text-neutral-500">
              dan
              <input type="date" value={dateFrom || ''} onChange={e => onDateFrom(e.target.value)} className={field} />
            </label>
          )}
          {onDateTo && (
            <label className="flex items-center gap-1 text-[11px] text-neutral-500">
              gacha
              <input type="date" value={dateTo || ''} onChange={e => onDateTo(e.target.value)} className={field} />
            </label>
          )}
          {children}
          {onReset && active && (
            <button onClick={onReset} className="inline-flex h-9 items-center gap-1 rounded-xl px-3 text-xs font-semibold text-neutral-500 hover:bg-neutral-100">
              <X className="h-3.5 w-3.5" /> Tozalash
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          {count !== undefined && <span className="text-[11px] font-semibold text-neutral-500 whitespace-nowrap">{count.toLocaleString('ru-RU')} ta</span>}
          {onExport && <ExportButton onExport={onExport} label={exportLabel} />}
        </div>
      </div>
    </div>
  );
};

/** Case-insensitive match of a query against several fields of a row. */
export function matchesSearch(row: any, query: string, keys: string[]): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return keys.some(k => {
    const v = k.split('.').reduce((o: any, p) => (o == null ? o : o[p]), row);
    return v != null && String(v).toLowerCase().includes(q);
  });
}

/** Date (YYYY-MM-DD prefix) inside an optional range. */
export function inDateRange(date: string | null | undefined, from?: string, to?: string): boolean {
  if (!from && !to) return true;
  const d = String(date || '').slice(0, 10);
  if (!d) return false;
  return (!from || d >= from) && (!to || d <= to);
}

const fmtDate = (d: string) => d.split('-').reverse().join('.');

/**
 * One-sheet Excel of the rows exactly as filtered on screen.
 * filters: human-readable active filters, written under the title so the file explains itself.
 */
export async function exportTableXlsx(opts: {
  fileName: string;
  title: string;
  sheetName?: string;
  columns: XlsxColumnSpec[];
  rows: Record<string, unknown>[];
  filters?: (string | false | null | undefined)[];
  summary?: { label: string; value: unknown; type?: XlsxColumnSpec['type'] }[];
}): Promise<void> {
  const filters = (opts.filters || []).filter(Boolean).join(' · ');
  const today = localToday();
  await api.downloadXlsx(`${opts.fileName}_${today}.xlsx`, [{
    name: (opts.sheetName || opts.title).slice(0, 31),
    title: opts.title,
    subtitle: [`Sana: ${fmtDate(today)}${filters ? ` · ${filters}` : ''} · ${opts.rows.length} ta qator`],
    columns: opts.columns,
    rows: opts.rows,
    totalsLabel: opts.columns.some(c => c.total) ? 'JAMI' : undefined,
    summary: opts.summary
  }]);
}
