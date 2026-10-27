import React, { useState, useEffect } from 'react';
import { Lock, Mail, Building2, AlertCircle, ArrowRight, ShieldCheck, Eye, EyeOff, X } from 'lucide-react';
import { api } from '../services/api.ts';
import { AuthUser } from '../types.ts';

interface LoginModalProps {
  isOpen: boolean;
  onSuccess: (user: AuthUser) => void;
}

export const LoginModal: React.FC<LoginModalProps> = ({ isOpen, onSuccess }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [setupRequired, setSetupRequired] = useState(false);
  const [setupMode, setSetupMode] = useState<'local' | 'token' | 'environment'>('local');
  const [setupToken, setSetupToken] = useState('');
  useEffect(() => {if(isOpen) fetch('/api/auth/setup').then(r=>r.json()).then(r=>{setSetupRequired(r.required);setSetupMode(r.mode || 'local');}).catch(()=>setError('Serverga ulanib bo‘lmadi'));},[isOpen]);

  if (!isOpen) return null;

  const handleLogin = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (setupRequired) {
        const response = await fetch('/api/auth/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password,setup_token:setupToken})});
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || body.message || 'Hisob yaratilmadi');
        setSetupRequired(false);
      }
      const res = await api.login(email, password);
      onSuccess(res.user);
    } catch (err: any) {
      setError(err.message || 'Kirishda xatolik yuz berdi');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-2xl">
        <div className="border-b border-neutral-100 bg-neutral-900 p-6 text-white">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500 text-white">
              <Building2 className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-base font-semibold">Distribution Finance System</h2>
              <p className="text-xs text-neutral-400">Yagona Moliyaviy Boshqaruv Platformasi</p>
            </div>
          </div>
        </div>

        <div className="p-6">
          {setupRequired && <p className="mb-4 text-sm text-amber-800">Birinchi sozlash: o‘zingizning emailingiz va kamida 12 belgili yangi parolni kiriting. Sinov hisoblari o‘chiriladi. Biznes yozuvlari saqlanadi.</p>}
          {setupRequired && setupMode === 'environment' && <div className="mb-4 rounded-lg bg-rose-50 p-3 text-xs text-rose-700">Serverda egasi hisobini yaratish bloklangan. Render Environment bo‘limida OWNER_EMAIL va OWNER_PASSWORD ni sozlang yoki OWNER_SETUP_TOKEN qo‘shib, serverni qayta ishga tushiring.</div>}
          <div className="mb-5 flex items-center gap-2 rounded-lg bg-emerald-50 p-3 text-xs text-emerald-800">
            <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-600" />
            <span>Tizim RBAC va audit xavfsizlik protokollari bilan himoyalangan.</span>
          </div>

          {error && (
            <div className="mb-4 flex items-center gap-2 rounded-lg bg-rose-50 p-3 text-xs text-rose-700">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            {setupRequired && setupMode === 'token' && <div>
              <label className="mb-1 block text-xs font-medium text-neutral-700">Bir martalik sozlash kaliti</label>
              <input type="password" autoComplete="off" value={setupToken} onChange={e=>setSetupToken(e.target.value)} required className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-xs focus:border-emerald-600 focus:outline-none" />
            </div>}
            <div>
              <label className="mb-1 block text-xs font-medium text-neutral-700">{setupRequired ? 'Elektron pochta' : 'Email yoki login'}</label>
              <div className="relative">
                <Mail className="absolute top-2.5 left-3 h-4 w-4 text-neutral-400" />
                <input
                  type={setupRequired ? "email" : "text"}
                  name="username"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  placeholder={setupRequired ? "nomi@distro.uz" : "nomi@distro.uz yoki 901234567"}
                  className="w-full rounded-lg border border-neutral-200 py-2 pr-3 pl-9 text-xs focus:border-emerald-600 focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-neutral-700">Parol</label>
              <div className="relative">
                <Lock className="absolute top-2.5 left-3 h-4 w-4 text-neutral-400" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  // Sign-in, not sign-up: the browser fills the saved password instead of offering a long new one.
                  autoComplete={setupRequired ? 'new-password' : 'current-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  placeholder="••••••••"
                  className="w-full rounded-lg border border-neutral-200 py-2 pr-16 pl-9 text-xs focus:border-emerald-600 focus:outline-none"
                />
                {/* A password the browser filled in is visible and can be cleared with one click. */}
                <div className="absolute top-1.5 right-1.5 flex gap-0.5">
                  {password && <button type="button" onClick={() => setPassword('')} title="Tozalash" className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"><X className="h-3.5 w-3.5" /></button>}
                  <button type="button" onClick={() => setShowPassword(s => !s)} title={showPassword ? 'Yashirish' : 'Parolni ko‘rsatish'} className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700">{showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}</button>
                </div>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || (setupRequired && setupMode === 'environment')}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
            >
              <span>{loading ? 'Tekshirilmoqda...' : setupRequired ? 'Egasi hisobini yaratish' : 'Tizimga kirish'}</span>
              <ArrowRight className="h-4 w-4" />
            </button>
          </form>

        </div>
      </div>
    </div>
  );
};
