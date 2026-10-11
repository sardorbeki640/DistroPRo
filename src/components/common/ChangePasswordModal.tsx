import React, { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { api } from '../../services/api.ts';

interface Props {
  forced?: boolean;          // first sign-in with a password issued by the owner
  onDone: () => void;
  onCancel?: () => void;
}

export const ChangePasswordModal: React.FC<Props> = ({ forced, onDone, onCancel }) => {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (next !== repeat) { setError('Yangi parollar bir xil emas.'); return; }
    if (next.length < 6) { setError('Kamida 6 belgi bo‘lsin.'); return; }
    setSaving(true);
    try {
      await api.changePassword(current, next);
      onDone();
    } catch (err: any) {
      setError(err.message || 'Parol almashtirilmadi');
    } finally {
      setSaving(false);
    }
  };

  const input = 'w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-hidden';
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-3 rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex items-center gap-2">
          <KeyRound className="h-5 w-5 text-emerald-600" />
          <h2 className="text-base font-bold text-neutral-900">{forced ? 'Yangi parol o‘rnating' : 'Parolni almashtirish'}</h2>
        </div>
        {forced && <p className="text-xs text-neutral-600">Sizga vaqtinchalik parol berilgan. Davom etish uchun o‘zingiz biladigan yangi parol o‘rnating. Uni hech kimga aytmang.</p>}
        {error && <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">{error}</div>}
        <label className="block text-xs font-semibold text-neutral-700">{forced ? 'Vaqtinchalik parol' : 'Joriy parol'}
          <input type="password" autoFocus required value={current} onChange={e => setCurrent(e.target.value)} className={input} autoComplete="current-password" />
        </label>
        <label className="block text-xs font-semibold text-neutral-700">Yangi parol (kamida 6 belgi)
          <input type="password" required value={next} onChange={e => setNext(e.target.value)} className={input} autoComplete="off" data-lpignore="true" />
        </label>
        <label className="block text-xs font-semibold text-neutral-700">Yangi parol (takror)
          <input type="password" required value={repeat} onChange={e => setRepeat(e.target.value)} className={input} autoComplete="off" data-lpignore="true" />
        </label>
        <div className="flex justify-end gap-2 pt-1">
          {!forced && onCancel && <button type="button" onClick={onCancel} className="rounded-lg px-3 py-2 text-xs text-neutral-600 hover:bg-neutral-100">Bekor qilish</button>}
          <button type="submit" disabled={saving} className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
            {saving ? 'Saqlanmoqda...' : 'Saqlash'}
          </button>
        </div>
      </form>
    </div>
  );
};
