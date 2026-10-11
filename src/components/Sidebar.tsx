import React, { useState } from 'react';
import { 
  LayoutDashboard, 
  TrendingUp,
  Wallet, 
  Users, 
  Receipt, 
  UserCheck, 
  Package,
  BarChart3, 
  Settings, 
  FolderOpen,
  Scale,
  Network, 
  ShieldAlert,
  Smartphone,
  ChevronDown,
  ChevronRight,
  X,
  Contact,
  UserCircle,
  ScanFace,
  Bot
} from 'lucide-react';
import { NavView, AuthUser } from '../types.ts';
import { canOpen } from '../utils/permissions.ts';

interface SidebarProps {
  currentView: NavView;
  onNavigate: (view: NavView) => void;
  isOpenMobile: boolean;
  onCloseMobile: () => void;
  user: AuthUser | null;
  onOpenApkModal?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentView,
  onNavigate,
  isOpenMobile,
  onCloseMobile,
  user,
  onOpenApkModal
}) => {
  const [showAdvanced, setShowAdvanced] = useState<boolean>(false);

  // Core essential navigation items
  const mainNavItems = [
    { id: 'dashboard' as NavView, label: 'Dashboard', icon: LayoutDashboard },
    { id: 'cabinet' as NavView, label: 'Mening kabinetim', icon: UserCircle },
    { id: 'crm' as NavView, label: 'CRM (mijozlar, vazifalar)', icon: Contact },
    { id: 'forecast' as NavView, label: 'Prognozlar & Zaxira Tahlili', icon: TrendingUp },
    { id: 'cash' as NavView, label: 'Kassa Reestri', icon: Wallet },
    { id: 'customers' as NavView, label: 'Mijozlar & Nasiya', icon: Users },
    { id: 'expenses' as NavView, label: 'Xarajatlar', icon: Receipt },
    { id: 'employees' as NavView, label: 'Xodimlar & Oylik', icon: UserCheck },
    { id: 'attendance' as NavView, label: 'Davomat & Face ID', icon: ScanFace },
    { id: 'products' as NavView, label: 'Mahsulotlar', icon: Package },
    { id: 'reports' as NavView, label: 'Hisobotlar (P&L & Tahlil)', icon: BarChart3 },
    { id: 'balance' as NavView, label: 'Balans & Pul Oqimi', icon: Scale },
    { id: 'integrations' as NavView, label: 'Integratsiyalar', icon: Network },
    { id: 'jarvis' as NavView, label: 'Jarvis (AI + Obsidian)', icon: Bot },
    { id: 'settings' as NavView, label: 'Sozlamalar', icon: Settings },
  ].filter(item => canOpen(user, item.id));

  // Secondary tools (compacted)
  const advancedNavItems = [
    { id: 'daily_files' as NavView, label: 'Kunlik Fayllar', icon: FolderOpen },
    { id: 'audit' as NavView, label: 'Audit Jurnali', icon: ShieldAlert },
  ].filter(item => canOpen(user, item.id));

  const handleSelect = (view: NavView) => {
    onNavigate(view);
    onCloseMobile();
  };

  return (
    <>
      {/* Mobile backdrop */}
      {isOpenMobile && (
        <div 
          onClick={onCloseMobile} 
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-xs md:hidden"
        />
      )}

      {/* Sidebar container */}
      <aside 
        className={`fixed inset-y-0 left-0 z-50 flex w-60 flex-col border-r border-neutral-800 bg-neutral-900 text-neutral-300 transition-transform duration-200 ease-in-out md:static md:translate-x-0 ${
          isOpenMobile ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-16 items-center justify-between px-5 border-b border-neutral-800">
          <div className="flex items-center gap-2.5">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-400"></span>
            <div>
              <span className="text-xs font-bold tracking-wider text-white uppercase block leading-tight">Distro Finance</span>
              <span className="text-[10px] text-neutral-400">Moliya tizimi</span>
            </div>
          </div>
          <button 
            onClick={onCloseMobile}
            className="flex h-7 w-7 items-center justify-center rounded text-neutral-400 hover:text-white md:hidden"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
          <nav className="space-y-1">
            {mainNavItems.map((item) => {
              const Icon = item.icon;
              const isActive = currentView === item.id;

              return (
                <button
                  key={item.id}
                  onClick={() => handleSelect(item.id)}
                  className={`group flex w-full items-center justify-between rounded-xl px-3 py-2 text-xs font-medium transition cursor-pointer ${
                    isActive
                      ? 'bg-neutral-800 text-white font-semibold shadow-xs'
                      : 'text-neutral-400 hover:bg-neutral-800/60 hover:text-neutral-200'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <Icon className={`h-4 w-4 ${isActive ? 'text-emerald-400' : 'text-neutral-400 group-hover:text-neutral-200'}`} />
                    <span>{item.label}</span>
                  </div>
                </button>
              );
            })}
          </nav>

          {/* Collapsible Secondary Tools */}
          {advancedNavItems.length > 0 && <div className="pt-2 border-t border-neutral-800/80">
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex w-full items-center justify-between px-3 py-1.5 text-[11px] font-medium text-neutral-500 hover:text-neutral-300 transition cursor-pointer"
            >
              <span>Qo'shimcha modullar</span>
              {showAdvanced ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </button>

            {showAdvanced && (
              <div className="mt-1 space-y-1">
                {advancedNavItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = currentView === item.id;

                  return (
                    <button
                      key={item.id}
                      onClick={() => handleSelect(item.id)}
                      className={`group flex w-full items-center justify-between rounded-xl px-3 py-1.5 text-xs font-medium transition cursor-pointer ${
                        isActive
                          ? 'bg-neutral-800 text-white font-semibold'
                          : 'text-neutral-400 hover:bg-neutral-800/60 hover:text-neutral-200'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <Icon className={`h-3.5 w-3.5 ${isActive ? 'text-emerald-400' : 'text-neutral-400'}`} />
                        <span>{item.label}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>}
        </div>

        {/* Footer info & APK button in sidebar */}
        <div className="border-t border-neutral-800 p-3 space-y-2">
          {onOpenApkModal && (
            <button
              onClick={onOpenApkModal}
              className="w-full py-1.5 px-3 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-white text-xs font-medium transition flex items-center justify-center space-x-1.5 cursor-pointer"
            >
              <Smartphone className="w-3.5 h-3.5 text-emerald-400" />
              <span>Mobil Ilova</span>
            </button>
          )}

          <div className="rounded-xl bg-neutral-800/40 px-3 py-2 flex items-center justify-between">
            <span className="text-[11px] text-neutral-400 font-medium">Foydalanuvchi:</span>
            <span className="rounded bg-emerald-950/80 px-1.5 py-0.5 text-[10px] font-bold text-emerald-400">
              {user?.roles?.[0]?.name || 'SUPER_ADMIN'}
            </span>
          </div>
        </div>
      </aside>
    </>
  );
};
