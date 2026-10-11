import React, { useState, useEffect } from 'react';
import { 
  Settings, 
  ShieldCheck, 
  UserCheck, 
  Lock, 
  AlertCircle, 
  CheckCircle2, 
  RefreshCw,
  KeyRound,
  ShieldAlert,
  CheckSquare,
  Square,
  Save,
  Users
} from 'lucide-react';
import { api } from '../../services/api.ts';
import { AuthUser } from '../../types.ts';
import { StaffAccountsPanel } from './StaffAccountsPanel.tsx';
import { BackupsPanel } from './BackupsPanel.tsx';
import { BotsPanel } from './BotsPanel.tsx';
import { CompanyPanel } from './CompanyPanel.tsx';
import { isOwner } from '../../utils/permissions.ts';

interface SettingsViewProps {
  currentUser: AuthUser | null;
}

export const SettingsView: React.FC<SettingsViewProps> = ({ currentUser }) => {
  const [users, setUsers] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [permissions, setPermissions] = useState<any[]>([]);
  const [roleMatrix, setRoleMatrix] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [savingPermissions, setSavingPermissions] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Assign user role form
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedRoleId, setSelectedRoleId] = useState('');
  const [reason, setReason] = useState('');

  // Role permissions editor
  const [editorRoleId, setEditorRoleId] = useState('');
  const [selectedPermissions, setSelectedPermissions] = useState<Set<string>>(new Set());
  const [permissionChangeReason, setPermissionChangeReason] = useState('Lavozim vazifalariga muvofiq huquqlar qayta sozlandi');

  const fetchUsersAndRoles = async () => {
    setLoading(true);
    setError(null);
    try {
      const [uRes, rbacRes] = await Promise.all([
        api.getUsers(),
        api.getRolesPermissions()
      ]);

      setUsers(uRes.users || []);
      setRoles(rbacRes.roles || uRes.availableRoles || []);
      setPermissions(rbacRes.permissions || []);
      setRoleMatrix(rbacRes.matrix || {});

      if (uRes.users?.length > 0 && !selectedUserId) {
        setSelectedUserId(uRes.users[0].id);
      }
      if (rbacRes.roles?.length > 0) {
        const nonSuper = rbacRes.roles.find((r: any) => r.name !== 'SUPER_ADMIN') || rbacRes.roles[0];
        setEditorRoleId(nonSuper.id);
        setSelectedPermissions(new Set(rbacRes.matrix[nonSuper.id] || []));
        if (!selectedRoleId) setSelectedRoleId(nonSuper.id);
      }
    } catch (err: any) {
      setError(err.message || 'Foydalanuvchilar va rollarni yuklashda xatolik yuz berdi');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsersAndRoles();
  }, []);

  // When changing editor role
  const handleEditorRoleChange = (roleId: string) => {
    setEditorRoleId(roleId);
    setSelectedPermissions(new Set(roleMatrix[roleId] || []));
  };

  // Toggle single permission code
  const togglePermission = (code: string) => {
    const updated = new Set(selectedPermissions);
    if (updated.has(code)) {
      updated.delete(code);
    } else {
      updated.add(code);
    }
    setSelectedPermissions(updated);
  };

  // Toggle all permissions in a module
  const toggleModuleAll = (moduleName: string, shouldSelect: boolean) => {
    const updated = new Set(selectedPermissions);
    const modPerms = permissions.filter(p => p.module === moduleName);
    for (const mp of modPerms) {
      if (shouldSelect) {
        updated.add(mp.code);
      } else {
        updated.delete(mp.code);
      }
    }
    setSelectedPermissions(updated);
  };

  // Save updated permissions for the role
  const handleSaveRolePermissions = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editorRoleId) return;
    setSavingPermissions(true);
    setError(null);
    setSuccessMsg(null);

    try {
      const res = await api.updateRolePermissions(
        editorRoleId,
        Array.from(selectedPermissions),
        permissionChangeReason
      );

      setRoleMatrix(prev => ({
        ...prev,
        [editorRoleId]: Array.from(selectedPermissions)
      }));

      setSuccessMsg(`"${res.role.name}" roli uchun huquqlar muvaffaqiyatli saqlandi va auditga yozildi!`);
    } catch (err: any) {
      setError(err.message || 'Rol huquqlarini saqlashda xatolik yuz berdi');
    } finally {
      setSavingPermissions(false);
    }
  };

  // Handle Assign user role
  const handleAssignRole = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);

    try {
      const res = await api.assignRole(selectedUserId, selectedRoleId, reason);
      setSuccessMsg(res.message);
      setReason('');
      fetchUsersAndRoles();
    } catch (err: any) {
      setError(err.message || 'Rolni tayinlashda xatolik');
    }
  };

  const modules = ['cash', 'expense', 'customer', 'balance', 'employee', 'salary', 'reports', 'integration', 'settings', 'crm'];
  const actions = ['view', 'create', 'update', 'delete', 'close', 'export', 'import', 'manage'];

  const currentEditorRole = roles.find(r => r.id === editorRoleId);

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 rounded-2xl border border-neutral-200 bg-white p-5 shadow-xs sm:flex-row sm:items-center">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 bg-emerald-50 text-emerald-700 rounded-xl border border-emerald-100">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-neutral-900">RBAC Xavfsizlik va Rollar Boshqaruvi</h1>
            <p className="text-xs text-neutral-500 mt-0.5">
              Foydalanuvchilar rollari va har bir rol uchun modul + amal (action) huquqlarini to'liq sozlash
            </p>
          </div>
        </div>

        <button
          onClick={fetchUsersAndRoles}
          disabled={loading}
          className="inline-flex items-center px-3.5 py-2 text-xs font-semibold text-neutral-700 bg-neutral-100 hover:bg-neutral-200 rounded-xl transition"
        >
          <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
          Yangilash
        </button>
      </div>

      {isOwner(currentUser) && <CompanyPanel />}
      <StaffAccountsPanel />
      {isOwner(currentUser) && <BackupsPanel />}

      {isOwner(currentUser) && <BotsPanel />}

      {error && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-800 flex items-center justify-between text-xs">
          <div className="flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
            <span>{error}</span>
          </div>
          <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700">✕</button>
        </div>
      )}

      {successMsg && (
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 flex items-center justify-between text-xs">
          <div className="flex items-center space-x-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{successMsg}</span>
          </div>
          <button onClick={() => setSuccessMsg(null)} className="text-emerald-500 hover:text-emerald-700">✕</button>
        </div>
      )}

      {/* TOP SECTION: USERS & ROLES ASSIGNMENT */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Users List */}
        <div className="lg:col-span-2 rounded-2xl border border-neutral-200 bg-white p-5 shadow-xs">
          <h2 className="text-sm font-bold text-neutral-900 border-b border-neutral-100 pb-3 flex items-center space-x-2">
            <Users className="w-4 h-4 text-neutral-600" />
            <span>Tizim Foydalanuvchilari va Biriktirilgan Rollar</span>
          </h2>

          <div className="mt-4 divide-y divide-neutral-100">
            {users.map(u => (
              <div key={u.id} className="py-3 flex items-center justify-between">
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="text-xs font-bold text-neutral-900">{u.full_name}</span>
                    {u.is_super_admin && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-100 text-purple-800 border border-purple-200">
                        SUPER ADMIN
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-neutral-400 mt-0.5">{u.email}</p>
                </div>

                <div className="flex flex-wrap gap-1 items-center justify-end">
                  {u.roles?.map((r: any) => (
                    <span key={r.id || r.name} className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-neutral-100 text-neutral-800 border border-neutral-200">
                      {r.name}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Assign Role to User Form */}
        <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-xs">
          <h2 className="text-sm font-bold text-neutral-900 border-b border-neutral-100 pb-3 flex items-center space-x-2">
            <UserCheck className="w-4 h-4 text-emerald-600" />
            <span>Foydalanuvchiga Rol Biriktirish</span>
          </h2>

          <form onSubmit={handleAssignRole} className="mt-4 space-y-3">
            <div>
              <label className="block text-xs font-semibold text-neutral-600 mb-1">Foydalanuvchi</label>
              <select
                value={selectedUserId}
                onChange={e => setSelectedUserId(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-xl border border-neutral-200 bg-neutral-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                {users.map(u => (
                  <option key={u.id} value={u.id}>{u.full_name} ({u.email})</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-neutral-600 mb-1">Biriktiriladigan Rol</label>
              <select
                value={selectedRoleId}
                onChange={e => setSelectedRoleId(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-xl border border-neutral-200 bg-neutral-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                {roles.map(r => (
                  <option key={r.id} value={r.id}>{r.name} - {r.description}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-neutral-600 mb-1">
                Tayinlash Asosi / Sababi (Audit majburiy)
              </label>
              <input
                type="text"
                required
                value={reason}
                onChange={e => setReason(e.target.value)}
                placeholder="Masalan: Lavozim o'zgarishi munosabati bilan"
                className="w-full px-3 py-2 text-xs rounded-xl border border-neutral-200 bg-neutral-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            <button
              type="submit"
              className="w-full mt-2 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl transition shadow-xs"
            >
              Rolni Biriktirish & Auditga Yozish
            </button>
          </form>
        </div>
      </div>

      {/* DYNAMIC ROLE PERMISSIONS (RBAC) EDITOR */}
      <div className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-xs space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-neutral-100 pb-4">
          <div>
            <div className="flex items-center space-x-2">
              <KeyRound className="w-5 h-5 text-indigo-600" />
              <h2 className="text-base font-bold text-neutral-900">
                Rol Huquqlarini O'zgartirish va Sozlash (Permissions Editor)
              </h2>
            </div>
            <p className="text-xs text-neutral-500 mt-0.5">
              Har bir rol uchun tizim modullari va ruxsat etilgan amallarni to'g'ridan-to'g'ri belgilash imkoniyati
            </p>
          </div>

          {/* Role selector for editing */}
          <div className="flex items-center space-x-2">
            <span className="text-xs font-bold text-neutral-600">Tahrirlanadigan Rol:</span>
            <select
              value={editorRoleId}
              onChange={e => handleEditorRoleChange(e.target.value)}
              className="px-3 py-1.5 text-xs font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-xl focus:outline-none"
            >
              {roles.map(r => (
                <option key={r.id} value={r.id} disabled={r.name === 'SUPER_ADMIN'}>
                  {r.name} {r.name === 'SUPER_ADMIN' ? '(Cheklab bo\'lmaydi)' : ''}
                </option>
              ))}
            </select>
          </div>
        </div>

        {currentEditorRole?.name === 'SUPER_ADMIN' ? (
          <div className="p-4 bg-purple-50 border border-purple-200 rounded-xl text-xs text-purple-900">
            SUPER_ADMIN roli barcha tizim huquqlariga to'liq ega va uning huquqlari xavfsizlik nuqtai nazaridan cheklanmaydi.
          </div>
        ) : (
          <form onSubmit={handleSaveRolePermissions} className="space-y-6">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-neutral-800 text-white font-semibold">
                    <th className="py-2.5 px-4 rounded-l-xl">Modul</th>
                    {actions.map(a => (
                      <th key={a} className="py-2.5 px-3 text-center uppercase text-[10px] tracking-wider">{a}</th>
                    ))}
                    <th className="py-2.5 px-4 text-center rounded-r-xl">Barchasini Tanlash</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {modules.map(mod => {
                    const modPerms = permissions.filter(p => p.module === mod);
                    const allSelected = modPerms.length > 0 && modPerms.every(p => selectedPermissions.has(p.code));

                    return (
                      <tr key={mod} className="hover:bg-neutral-50/60 transition">
                        <td className="py-3 px-4 font-bold text-neutral-900 font-mono capitalize">
                          {mod}
                        </td>

                        {actions.map(act => {
                          const code = `${mod}:${act}`;
                          const permExists = permissions.some(p => p.code === code);
                          const isChecked = selectedPermissions.has(code);

                          if (!permExists) {
                            return (
                              <td key={act} className="py-3 px-3 text-center text-neutral-300">
                                —
                              </td>
                            );
                          }

                          return (
                            <td key={act} className="py-3 px-3 text-center">
                              <button
                                type="button"
                                onClick={() => togglePermission(code)}
                                className="inline-flex items-center justify-center p-1 rounded hover:bg-neutral-100 transition"
                              >
                                {isChecked ? (
                                  <CheckSquare className="w-4 h-4 text-emerald-600" />
                                ) : (
                                  <Square className="w-4 h-4 text-neutral-300" />
                                )}
                              </button>
                            </td>
                          );
                        })}

                        <td className="py-3 px-4 text-center">
                          <button
                            type="button"
                            onClick={() => toggleModuleAll(mod, !allSelected)}
                            className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-800"
                          >
                            {allSelected ? 'Olib tashlash' : 'Barchasi'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Reason input & Save button */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pt-4 border-t border-neutral-100">
              <div className="flex-1 max-w-lg">
                <label className="block text-xs font-semibold text-neutral-600 mb-1">
                  Huquqlar o'zgartirish sababi (Audit jurnali uchun majburiy)
                </label>
                <input
                  type="text"
                  required
                  value={permissionChangeReason}
                  onChange={e => setPermissionChangeReason(e.target.value)}
                  placeholder="Masalan: Kassir roli uchun eksport huquqi berildi"
                  className="w-full px-3 py-2 text-xs rounded-xl border border-neutral-200 bg-neutral-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <button
                type="submit"
                disabled={savingPermissions}
                className="px-5 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl transition shadow-xs flex items-center shrink-0"
              >
                {savingPermissions ? (
                  <RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                ) : (
                  <Save className="w-3.5 h-3.5 mr-1.5" />
                )}
                Rol Huquqlarini Saqlash (Update)
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
