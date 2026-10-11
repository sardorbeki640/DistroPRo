import React, { useEffect, useState } from 'react';
import { KeyRound, UserCircle, X } from 'lucide-react';
import { api } from '../../services/api.ts';
import { ChangePasswordModal } from './ChangePasswordModal.tsx';

type Profile = { full_name: string; phone: string; email: string; login: string; position: string; last_login_at: string | null };

/** "Profilim": anyone signed in edits their own name, phone, login and email, and changes the password. */
export const ProfileModal: React.FC<{ onClose: () => void; onSaved: () => void }> = ({ onClose, onSaved }) => {
  const [form, setForm] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState(false);

  useEffect(() => { api.getMyProfile().then(r => setForm(r.profile)).catch(e => setError(e.message)); }, []);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setBusy(true); setError(null); setSaved(false);
    try {
      const r = await api.updateMyProfile({ full_name: form.full_name, phone: form.phone, email: form.email, ...(form.login ? { login: form.login } : {}) });
      setForm(r.profile); setSaved(true); onSaved();
    } catch (err: any) { setError(err.message); } finally { setBusy(false); }
  };

  const field = (key: keyof Profile, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="block text-xs font-semibold text-neutral-700">{label}
      <input {...props} value={(form?.[key] as string) || ''} onChange={e => setForm(f => (f ? { ...f, [key]: e.target.value } : f))}
        className="mt-1 block w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-hidden" />
    </label>
  );

  if (password) return <ChangePasswordModal onCancel={() => setPassword(false)} onDone={() => { setPassword(false); setSaved(true); }} />;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <form onSubmit={save} className="w-full max-w-md space-y-4 rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-base font-bold"><UserCircle className="h-5 w-5" />Profilim</h2>
          <button type="button" onClick={onClose} className="text-neutral-400 hover:text-neutral-700"><X className="h-5 w-5" /></button>
        </div>
        {!form && !error && <p className="text-xs text-neutral-500">Yuklanmoqda…</p>}
        {form && (
          <>
            {field('full_name', 'Ism familiya', { required: true, maxLength: 120 })}
            {field('phone', 'Telefon', { placeholder: '+998 90 123 45 67', maxLength: 30 })}
            {field('login', 'Login (kirish uchun)', { placeholder: 'masalan: ali.karimov', maxLength: 60 })}
            {field('email', 'Email', { type: 'email', required: true, maxLength: 120 })}
            {form.position && <p className="text-xs text-neutral-500">Lavozim: <b>{form.position}</b> (rahbar o‘zgartiradi)</p>}
            {form.last_login_at && <p className="text-[11px] text-neutral-400">Oxirgi kirish: {new Date(form.last_login_at).toLocaleString('ru-RU')}</p>}
          </>
        )}
        {error && <p className="rounded-lg bg-red-50 p-2 text-xs text-red-700">{error}</p>}
        {saved && <p className="rounded-lg bg-emerald-50 p-2 text-xs text-emerald-700">Saqlandi.</p>}
        <div className="flex items-center justify-between gap-2">
          <button type="button" onClick={() => setPassword(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 px-3 py-2 text-xs font-semibold hover:bg-neutral-50"><KeyRound className="h-4 w-4" />Parolni almashtirish</button>
          <button type="submit" disabled={busy || !form} className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50">{busy ? 'Saqlanmoqda…' : 'Saqlash'}</button>
        </div>
      </form>
    </div>
  );
};
