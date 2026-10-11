import React from 'react';
import { 
  Building2, 
  Shield, 
  User, 
  LogOut, 
  CircleDot, 
  RefreshCw,
  Menu,
  ChevronDown,
  Calculator
} from 'lucide-react';
import { AuthUser, CashDay } from '../types.ts';
import { ProfileModal } from './common/ProfileModal.tsx';

interface HeaderProps {
  user: AuthUser | null;
  activeCashDay: CashDay | null;
  onLogout: () => void;
  onSwitchUser: (email: string) => void;
  onToggleMobileMenu: () => void;
  onRefresh: () => void;
  isLoading: boolean;
  onOpenQuickTools?: (tab?: 'DENOMINATIONS' | 'CURRENCY' | 'RECEIPT' | 'Z_REPORT') => void;
  onProfileChanged?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  user,
  activeCashDay,
  onLogout,
  onSwitchUser,
  onToggleMobileMenu,
  onRefresh,
  isLoading,
  onOpenQuickTools,
  onProfileChanged
}) => {
  const [dropdownOpen, setDropdownOpen] = React.useState(false);
  const [profileOpen, setProfileOpen] = React.useState(false);

  return (
    <header className="sticky top-0 z-30 flex h-16 w-full items-center justify-between border-b border-neutral-200 bg-white/95 px-4 backdrop-blur md:px-6">
      <div className="flex items-center gap-3">
        <button
          onClick={onToggleMobileMenu}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-neutral-200 text-neutral-600 hover:bg-neutral-50 md:hidden"
          title="Menyu"
        >
          <Menu className="h-5 w-5" />
        </button>

        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-600 text-white shadow-sm">
            <Building2 className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold tracking-tight text-neutral-900">{user?.company_name || 'Distro Pro'}</span>
              <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 uppercase">Faol</span>
            </div>
            <p className="hidden text-xs text-neutral-500 sm:block">Moliyaviy Boshqaruv Tizimi</p>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2.5 md:gap-3">
        {/* Cash Day Status Indicator */}
        <div className="hidden items-center gap-2 rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1 text-xs sm:flex">
          <span className="text-neutral-500">Kassa kuni:</span>
          {activeCashDay ? (
            <span className={`inline-flex items-center gap-1.5 font-medium ${activeCashDay.status === 'OPEN' ? 'text-emerald-700' : 'text-amber-700'}`}>
              <CircleDot className="h-3 w-3 animate-pulse" />
              {activeCashDay.status === 'OPEN' ? 'OCHIQ' : 'YOPIQ'} ({activeCashDay.date})
            </span>
          ) : (
            <span className="text-neutral-400">Ochilmagan</span>
          )}
        </div>

        {/* Quick Tools Button */}
        <button
          onClick={() => onOpenQuickTools?.('DENOMINATIONS')}
          className="flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-1.5 text-xs font-bold text-emerald-800 hover:bg-emerald-100 transition shadow-2xs cursor-pointer"
          title="Kupuralar sanash, valyuta kursi va to'lov kvitansiyasi kalkulyatori"
        >
          <Calculator className="h-3.5 w-3.5 text-emerald-600" />
          <span className="hidden sm:inline">Kassa Asboblari</span>
        </button>

        {/* Global Refresh Button */}
        <button
          onClick={onRefresh}
          disabled={isLoading}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-neutral-200 text-neutral-600 hover:bg-neutral-50 disabled:opacity-50"
          title="Ma'lumotlarni yangilash"
        >
          <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin text-emerald-600' : ''}`} />
        </button>

        {/* Role Switcher & User Profile Dropdown */}
        <div className="relative">
          <button
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
          >
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-neutral-900 text-white">
              <User className="h-3.5 w-3.5" />
            </div>
            <div className="hidden text-left sm:block">
              <p className="line-clamp-1 text-xs font-medium leading-none text-neutral-900">{user?.full_name || 'Foydalanuvchi'}</p>
              <p className="text-[10px] text-neutral-500">{user?.roles?.[0]?.name || 'ROL'}</p>
            </div>
            <ChevronDown className="h-3.5 w-3.5 text-neutral-400" />
          </button>

          {dropdownOpen && (
            <div className="absolute right-0 mt-2 w-72 origin-top-right rounded-xl border border-neutral-200 bg-white p-2 shadow-lg ring-1 ring-black/5">
              <div className="border-b border-neutral-100 p-2.5">
                <p className="text-xs font-semibold text-neutral-900">{user?.full_name}</p>
                <p className="text-[11px] text-neutral-500">{user?.email}</p>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {user?.roles?.map(r => (
                    <span key={r.id} className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium text-neutral-700">
                      {r.name}
                    </span>
                  ))}
                  {user?.is_super_admin && (
                    <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                      To'liq RBAC
                    </span>
                  )}
                </div>
              </div>

              <div className="border-t border-neutral-100 pt-1">
                <button
                  onClick={() => { setDropdownOpen(false); setProfileOpen(true); }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-neutral-700 hover:bg-neutral-50"
                >
                  <User className="h-4 w-4" />
                  <span>Profilim (ism, telefon, login, parol)</span>
                </button>
                <button
                  onClick={() => {
                    setDropdownOpen(false);
                    onLogout();
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-rose-600 hover:bg-rose-50"
                >
                  <LogOut className="h-4 w-4" />
                  <span>Chiqish</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      {profileOpen && <ProfileModal onClose={() => setProfileOpen(false)} onSaved={() => onProfileChanged?.()} />}
    </header>
  );
};
