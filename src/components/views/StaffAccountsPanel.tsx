import React, { useEffect, useState } from 'react';
import { Copy, KeyRound, Lock, Pencil, Unlock, UserPlus, X } from 'lucide-react';
import { api } from '../../services/api.ts';

const ROLE_LABEL: Record<string, string> = {
  SUPER_ADMIN: 'Egasi (to‘liq huquq)', ADMIN: 'Administrator', CASHIER: 'Kassir',
  AGENT: 'Savdo agenti', DELIVERY: 'Yetkazib beruvchi', EMPLOYEE: 'Xodim (faqat o‘z kabineti)'
};
const input = 'w-full rounded-lg border border-neutral-300 px-2.5 py-1.5 text-xs focus:border-neutral-900 focus:outline-hidden';

/** Owner gives each employee a login; the temporary password is shown once and changed by the employee. */
export const StaffAccountsPanel: React.FC = () => {
  const [staff, setStaff] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState<any | null>(null);
  const [login, setLogin] = useState('');
  const [roleId, setRoleId] = useState('');
  const [issued, setIssued] = useState<{ name: string; login: string; password: string } | null>(null);
  // The owner types the password (or leaves it empty for 6 digits); changing it at first sign-in is optional.
  const [password, setPassword] = useState('');
  const [mustChange, setMustChange] = useState(false);
  const [resetting, setResetting] = useState<any | null>(null);

  const load = () => api.getStaff().then(r => { setStaff(r.staff); setRoles(r.roles); }).catch(e => setError(e.message));
  useEffect(() => { load(); }, []);

  // Safest default: own cabinet, own customers and CRM only. AGENT/CASHIER roles also open company pages.
  const defaultRole = (_row: any) => roles.find(r => r.name === 'EMPLOYEE')?.id || '';
  const openCreate = (row: any) => {
    setCreating(row);
    setLogin((row.employee.phone || '').replace(/\D/g, '').slice(-9));
    setRoleId(defaultRole(row));
    setPassword(''); setMustChange(false);
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const res = await api.createStaffAccount(creating.employee.id, login, roleId, { password: password.trim(), must_change: mustChange });
      setIssued({ name: creating.employee.full_name, login: res.login, password: res.temporary_password });
      setCreating(null);
      load();
    } catch (err: any) { setError(err.message); }
  };
  const openReset = (row: any) => { setResetting(row); setPassword(''); setMustChange(false); };
  const reset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const res = await api.resetStaffPassword(resetting.account.user_id, { password: password.trim(), must_change: mustChange });
      setIssued({ name: resetting.employee.full_name, login: res.login, password: res.temporary_password });
      setResetting(null);
      load();
    } catch (err: any) { setError(err.message); }
  };
  // Shared by "give login" and "new password": the owner's own password or 6 digits.
  const passwordFields = (
    <>
      <label className="block text-[11px] font-semibold">Parol (ixtiyoriy)
        <input className={`${input} font-mono`} value={password} onChange={e => setPassword(e.target.value.replace(/\s/g, ''))} placeholder="bo‘sh qoldirsangiz 6 xonali raqam beriladi" autoComplete="off" maxLength={64} />
      </label>
      <label className="flex items-start gap-2 text-[11px]"><input type="checkbox" className="mt-0.5" checked={mustChange} onChange={e => setMustChange(e.target.checked)} />Birinchi kirishda xodim parolni o‘zi almashtirsin</label>
    </>
  );
  const toggle = async (row: any) => {
    const next = row.account.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    if (next === 'INACTIVE' && !confirm(`${row.employee.full_name} hisobini bloklaysizmi? U tizimga kira olmaydi.`)) return;
    try { await api.setStaffStatus(row.account.user_id, next); load(); } catch (err: any) { setError(err.message); }
  };
  const changeRole = async (row: any, role: string) => {
    try { await api.setStaffRole(row.account.user_id, role); load(); } catch (err: any) { setError(err.message); }
  };

  // Profile of a staff member: card (name, position, phone) and account (login, email) together.
  const [editing, setEditing] = useState<any | null>(null);
  const [profile, setProfile] = useState({ full_name: '', position: '', phone: '', login: '', email: '' });
  const openEdit = (row: any) => {
    setEditing(row);
    setProfile({ full_name: row.employee.full_name || '', position: row.employee.position || '', phone: row.employee.phone || '', login: row.account?.login || '', email: row.account?.email || '' });
  };
  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await api.updateStaffProfile(editing.employee.id, {
        full_name: profile.full_name, position: profile.position, phone: profile.phone,
        ...(editing.account ? { login: profile.login, email: profile.email } : {})
      });
      setEditing(null);
      load();
    } catch (err: any) { setError(err.message); }
  };

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-xs">
      <h2 className="text-sm font-bold text-neutral-900">Xodimlarga kirish (login va parol)</h2>
      <p className="mb-3 text-xs text-neutral-500">Har bir xodimga login va parol bering: parolni o‘zingiz yozasiz yoki bo‘sh qoldirsangiz 6 xonali raqam beriladi. Xodim faqat roli ruxsat bergan bo‘limlarni va o‘z kabinetini ko‘radi.</p>
      {error && <div className="mb-2 flex justify-between rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700"><span>{error}</span><button onClick={() => setError(null)}><X className="h-3.5 w-3.5" /></button></div>}
      {issued && (
        <div className="mb-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950">
          <p className="font-bold">{issued.name} uchun kirish ma’lumoti (faqat hozir ko‘rinadi):</p>
          <p className="mt-1 font-mono text-sm">Login: <b>{issued.login}</b> · Parol: <b>{issued.password}</b></p>
          <div className="mt-2 flex gap-2">
            <button onClick={() => navigator.clipboard?.writeText(`Login: ${issued.login}\nParol: ${issued.password}`)} className="inline-flex items-center gap-1 rounded-lg bg-amber-200 px-2.5 py-1 font-semibold"><Copy className="h-3.5 w-3.5" />Nusxalash</button>
            <button onClick={() => setIssued(null)} className="rounded-lg px-2.5 py-1 hover:bg-amber-100">Yashirish</button>
          </div>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="min-w-full text-xs">
          <thead className="text-left text-neutral-500"><tr><th className="py-1.5">Xodim</th><th>Login</th><th>Rol</th><th>Holat</th><th>Oxirgi kirish</th><th /></tr></thead>
          <tbody className="divide-y divide-neutral-100">
            {staff.map(row => (
              <tr key={row.employee.id}>
                <td className="py-2"><p className="font-semibold text-neutral-900">{row.employee.full_name}</p><p className="text-[10px] text-neutral-400">{row.employee.position}{row.agent_code ? ` · agent ${row.agent_code} · ${row.customers} mijoz` : ''}</p></td>
                {row.account ? (
                  <>
                    <td className="font-mono">{row.account.login}</td>
                    <td><select className="rounded border border-neutral-200 px-1 py-0.5" value={row.account.roles[0]?.id || ''} onChange={e => changeRole(row, e.target.value)}>{roles.map(r => <option key={r.id} value={r.id}>{ROLE_LABEL[r.name] || r.name}</option>)}</select></td>
                    <td>{row.account.status === 'ACTIVE' ? <span className="text-emerald-700">faol{row.account.must_change_password ? ' · parol almashtirilmagan' : ''}</span> : <span className="text-red-600">bloklangan</span>}</td>
                    <td className="text-neutral-500">{row.account.last_login_at ? new Date(row.account.last_login_at).toLocaleString('uz-UZ') : 'hali kirmagan'}</td>
                    <td className="whitespace-nowrap text-right">
                      <button onClick={() => openEdit(row)} title="Profilni tahrirlash" className="mr-2 text-neutral-500 hover:text-neutral-900"><Pencil className="h-4 w-4" /></button>
                      <button onClick={() => openReset(row)} title="Yangi parol berish" className="mr-2 text-neutral-500 hover:text-neutral-900"><KeyRound className="h-4 w-4" /></button>
                      <button onClick={() => toggle(row)} title={row.account.status === 'ACTIVE' ? 'Bloklash' : 'Faollashtirish'} className="text-neutral-500 hover:text-neutral-900">{row.account.status === 'ACTIVE' ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}</button>
                    </td>
                  </>
                ) : (
                  <>
                    <td colSpan={4} className="text-neutral-400">kirish hisobi yo‘q</td>
                    <td className="whitespace-nowrap text-right"><button onClick={() => openEdit(row)} title="Profilni tahrirlash" className="mr-2 text-neutral-500 hover:text-neutral-900"><Pencil className="h-4 w-4" /></button><button onClick={() => openCreate(row)} className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1 font-semibold text-white hover:bg-emerald-700"><UserPlus className="h-3.5 w-3.5" />Login berish</button></td>
                  </>
                )}
              </tr>
            ))}
            {!staff.length && <tr><td colSpan={6} className="py-3 text-neutral-400">Xodimlar yo‘q. Avval "Xodimlar & Oylik" bo‘limida xodim qo‘shing.</td></tr>}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form onSubmit={saveProfile} className="w-full max-w-sm space-y-3 rounded-2xl bg-white p-5 shadow-2xl">
            <div className="flex items-center justify-between"><h3 className="text-sm font-bold">Profil: {editing.employee.full_name}</h3><button type="button" onClick={() => setEditing(null)}><X className="h-4 w-4" /></button></div>
            <label className="block text-[11px] font-semibold">Ism familiya
              <input required maxLength={120} className={input} value={profile.full_name} onChange={e => setProfile(p => ({ ...p, full_name: e.target.value }))} />
            </label>
            <label className="block text-[11px] font-semibold">Lavozim
              <input maxLength={80} className={input} value={profile.position} onChange={e => setProfile(p => ({ ...p, position: e.target.value }))} placeholder="Savdo agenti" />
            </label>
            <label className="block text-[11px] font-semibold">Telefon
              <input maxLength={30} className={input} value={profile.phone} onChange={e => setProfile(p => ({ ...p, phone: e.target.value }))} placeholder="+998 90 123 45 67" />
            </label>
            {editing.account ? (
              <>
                <label className="block text-[11px] font-semibold">Login
                  <input required maxLength={60} className={input} value={profile.login} onChange={e => setProfile(p => ({ ...p, login: e.target.value.trim() }))} />
                </label>
                <label className="block text-[11px] font-semibold">Email
                  <input required type="email" maxLength={120} className={input} value={profile.email} onChange={e => setProfile(p => ({ ...p, email: e.target.value.trim() }))} />
                </label>
              </>
            ) : <p className="text-[11px] text-neutral-500">Kirish hisobi yo‘q — login va email hisob berilgandan keyin tahrirlanadi.</p>}
            <p className="text-[11px] text-neutral-500">Ism va telefon xodim kartasi, kirish hisobi va agent yozuvida birga yangilanadi. Egasi hisobini faqat egasi o‘zgartiradi.</p>
            <div className="flex justify-end"><button className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700">Saqlash</button></div>
          </form>
        </div>
      )}

      {creating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form onSubmit={create} className="w-full max-w-sm space-y-3 rounded-2xl bg-white p-5 shadow-2xl">
            <div className="flex items-center justify-between"><h3 className="text-sm font-bold">{creating.employee.full_name} — kirish hisobi</h3><button type="button" onClick={() => setCreating(null)}><X className="h-4 w-4" /></button></div>
            <label className="block text-[11px] font-semibold">Login (telefon raqami yoki lotincha nom)
              <input required className={input} value={login} onChange={e => setLogin(e.target.value.trim())} placeholder="901234567" />
            </label>
            <label className="block text-[11px] font-semibold">Rol
              <select required className={input} value={roleId} onChange={e => setRoleId(e.target.value)}>
                <option value="">— tanlang —</option>
                {roles.map(r => <option key={r.id} value={r.id}>{ROLE_LABEL[r.name] || r.name}</option>)}
              </select>
            </label>
            {passwordFields}
            <p className="text-[11px] text-neutral-500">“Xodim” roli faqat o‘z kabineti, o‘z mijozlari va CRM’ni ko‘radi. Agent/Kassir rollari kompaniya bo‘limlarini ham ochadi. Login va parol saqlangandan keyin bir marta ko‘rsatiladi — xodimga ayting.</p>
            <div className="flex justify-end"><button className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700">Hisob yaratish</button></div>
          </form>
        </div>
      )}

      {resetting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form onSubmit={reset} className="w-full max-w-sm space-y-3 rounded-2xl bg-white p-5 shadow-2xl">
            <div className="flex items-center justify-between"><h3 className="text-sm font-bold">{resetting.employee.full_name} — yangi parol</h3><button type="button" onClick={() => setResetting(null)}><X className="h-4 w-4" /></button></div>
            <p className="text-[11px] text-neutral-500">Login: <b className="font-mono">{resetting.account.login}</b>. Eski parol ishlamay qoladi.</p>
            {passwordFields}
            <div className="flex justify-end"><button className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700">Saqlash</button></div>
          </form>
        </div>
      )}
    </div>
  );
};
