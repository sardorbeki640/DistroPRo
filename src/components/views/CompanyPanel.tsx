import React, { useEffect, useState } from 'react';
import { Building2 } from 'lucide-react';
import { api } from '../../services/api.ts';

/** Company card used on statements, exports and the top bar (owner only). */
export const CompanyPanel: React.FC<{ onSaved?: () => void }> = ({ onSaved }) => {
  const [form, setForm] = useState({ name: '', tax_id: '', address: '', phone: '' });
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.getCompany().then(r => setForm(r.company)).catch(e => setError(e.message)); }, []);

  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setMsg(null); setError(null);
    try { await api.saveCompany(form); setMsg('Saqlandi.'); onSaved?.(); } catch (err: any) { setError(err.message); }
  };
  const input = 'mt-1 block w-full rounded-lg border border-neutral-300 px-3 py-2 text-xs focus:border-neutral-900 focus:outline-hidden';
  return (
    <form onSubmit={save} className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-xs">
      <h2 className="flex items-center gap-2 text-sm font-bold text-neutral-900"><Building2 className="h-4 w-4" />Kompaniya ma’lumotlari</h2>
      <p className="mb-3 text-xs text-neutral-500">Yuqori panelda, akt-sverkada va Excel hisobotlarda shu ma’lumot chiqadi.</p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <label className="block text-xs font-semibold text-neutral-700">Nomi<input required maxLength={160} className={input} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></label>
        <label className="block text-xs font-semibold text-neutral-700">STIR (INN)<input maxLength={20} inputMode="numeric" className={input} value={form.tax_id} onChange={e => setForm(f => ({ ...f, tax_id: e.target.value.replace(/\D/g, '') }))} /></label>
        <label className="block text-xs font-semibold text-neutral-700">Manzil<input maxLength={300} className={input} value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} /></label>
        <label className="block text-xs font-semibold text-neutral-700">Telefon<input maxLength={40} className={input} value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="+998 69 123 45 67" /></label>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700">Saqlash</button>
        {msg && <span className="text-xs text-emerald-700">{msg}</span>}
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
    </form>
  );
};
