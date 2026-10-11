import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';

/**
 * Several values of one filter at once (e.g. three categories). The selection is kept as one string
 * (values joined by an invisible separator) so filter state stays a plain string everywhere; read it with
 * `picked()` / `isPicked()`. An empty string means "all".
 */
const SEP = '\u001f';
export const picked = (filter: string | null | undefined): string[] => (filter ? filter.split(SEP).filter(Boolean) : []);
export const joinPicked = (values: string[]) => values.filter(Boolean).join(SEP);
/** True when nothing is selected or the value is one of the selected. */
export const isPicked = (filter: string | null | undefined, value: unknown): boolean => {
  const list = picked(filter);
  return !list.length || list.includes(String(value ?? ''));
};
/** Selected labels for an Excel header or a caption. */
export const pickedLabels = (filter: string | null | undefined, options?: { value: string; label: string }[]) =>
  picked(filter).map(v => options?.find(o => o.value === v)?.label || v).join(', ');

export const MultiSelect: React.FC<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  allLabel?: string;
  className?: string;
}> = ({ label, value, onChange, options, allLabel, className = '' }) => {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const selected = picked(value);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);

  const toggle = (v: string) => onChange(joinPicked(selected.includes(v) ? selected.filter(x => x !== v) : [...selected, v]));
  const shown = options.filter(o => !q.trim() || o.label.toLowerCase().includes(q.trim().toLowerCase()));
  const caption = !selected.length ? (allLabel || `${label}: barchasi`)
    : selected.length === 1 ? `${label}: ${options.find(o => o.value === selected[0])?.label || selected[0]}`
    : `${label}: ${selected.length} ta`;

  return (
    <div ref={box} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        title={selected.length ? pickedLabels(value, options) : label}
        className={`inline-flex h-9 max-w-[240px] items-center gap-1.5 rounded-xl border px-3 text-xs ${selected.length ? 'border-emerald-400 bg-emerald-50 font-semibold text-emerald-900' : 'border-neutral-200 bg-neutral-50 text-neutral-700'} hover:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500`}
      >
        <span className="truncate">{caption}</span>
        {selected.length > 0
          ? <X className="h-3.5 w-3.5 shrink-0 opacity-60 hover:opacity-100" onClick={e => { e.stopPropagation(); onChange(''); }} />
          : <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" />}
      </button>
      {open && (
        <div className="absolute left-0 z-40 mt-1 w-64 rounded-xl border border-neutral-200 bg-white p-2 shadow-lg">
          {options.length > 8 && (
            <div className="relative mb-1.5">
              <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-neutral-400" />
              <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Qidirish…" className="h-8 w-full rounded-lg border border-neutral-200 pl-7 pr-2 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500" />
            </div>
          )}
          <div className="max-h-64 overflow-y-auto">
            {shown.map(o => {
              const on = selected.includes(o.value);
              return (
                <button key={o.value} type="button" onClick={() => toggle(o.value)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-neutral-50">
                  <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${on ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-neutral-300'}`}>{on && <Check className="h-3 w-3" />}</span>
                  <span className="truncate">{o.label}</span>
                </button>
              );
            })}
            {!shown.length && <p className="px-2 py-1.5 text-xs text-neutral-400">Topilmadi</p>}
          </div>
          <div className="mt-1.5 flex justify-between border-t border-neutral-100 pt-1.5 text-[11px]">
            <button type="button" onClick={() => onChange(joinPicked(shown.map(o => o.value)))} className="rounded px-2 py-1 font-semibold text-emerald-700 hover:bg-emerald-50">Hammasini belgilash</button>
            <button type="button" onClick={() => onChange('')} className="rounded px-2 py-1 font-semibold text-neutral-500 hover:bg-neutral-100">Tozalash</button>
          </div>
        </div>
      )}
    </div>
  );
};
