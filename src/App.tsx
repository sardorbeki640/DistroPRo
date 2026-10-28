import React, { Suspense, useState, useEffect, useCallback } from 'react';
import { Header } from './components/Header.tsx';
import { Sidebar } from './components/Sidebar.tsx';
import { LoginModal } from './components/LoginModal.tsx';
import { ErrorBoundary } from './components/common/ErrorBoundary.tsx';
import { canOpen, homeView } from './utils/permissions.ts';
import { api, getStoredToken, removeStoredToken } from './services/api.ts';
import { AuthUser, CashDay, CashTransaction, NavView } from './types.ts';
import { Sparkles } from 'lucide-react';

// Keep the first download small: operational pages are loaded only when opened.
const DashboardView = React.lazy(() => import('./components/views/DashboardView.tsx').then(m => ({ default: m.DashboardView })));
const DailyFilesView = React.lazy(() => import('./components/views/DailyFilesView.tsx').then(m => ({ default: m.DailyFilesView })));
const CashView = React.lazy(() => import('./components/views/CashView.tsx').then(m => ({ default: m.CashView })));
const AuditView = React.lazy(() => import('./components/views/AuditView.tsx').then(m => ({ default: m.AuditView })));
const IntegrationsView = React.lazy(() => import('./components/views/IntegrationsView.tsx').then(m => ({ default: m.IntegrationsView })));
const SettingsView = React.lazy(() => import('./components/views/SettingsView.tsx').then(m => ({ default: m.SettingsView })));
const ExpensesView = React.lazy(() => import('./components/views/ExpensesView.tsx').then(m => ({ default: m.ExpensesView })));
const CustomersView = React.lazy(() => import('./components/views/CustomersView.tsx').then(m => ({ default: m.CustomersView })));
const EmployeesView = React.lazy(() => import('./components/views/EmployeesView.tsx').then(m => ({ default: m.EmployeesView })));
const ReportsView = React.lazy(() => import('./components/views/ReportsView.tsx').then(m => ({ default: m.ReportsView })));
const BalanceView = React.lazy(() => import('./components/views/BalanceView.tsx').then(m => ({ default: m.BalanceView })));
const ProductsView = React.lazy(() => import('./components/views/ProductsView.tsx').then(m => ({ default: m.ProductsView })));
const ForecastView = React.lazy(() => import('./components/views/ForecastView.tsx').then(m => ({ default: m.ForecastView })));
const JarvisView = React.lazy(() => import('./components/views/JarvisView.tsx').then(m => ({ default: m.JarvisView })));
const CRMView = React.lazy(() => import('./components/views/CRMView.tsx').then(m => ({ default: m.CRMView })));
const CabinetView = React.lazy(() => import('./components/views/CabinetView.tsx').then(m => ({ default: m.CabinetView })));
const AttendanceView = React.lazy(() => import('./components/views/AttendanceView.tsx').then(m => ({ default: m.AttendanceView })));
const ApkInstallModal = React.lazy(() => import('./components/common/ApkInstallModal.tsx').then(m => ({ default: m.ApkInstallModal })));
const QuickToolsModal = React.lazy(() => import('./components/common/QuickToolsModal.tsx').then(m => ({ default: m.QuickToolsModal })));
const AIAgentDrawer = React.lazy(() => import('./components/common/AIAgentDrawer.tsx').then(m => ({ default: m.AIAgentDrawer })));
const ChangePasswordModal = React.lazy(() => import('./components/common/ChangePasswordModal.tsx').then(m => ({ default: m.ChangePasswordModal })));

function ViewLoading() {
  return <div className="flex min-h-40 items-center justify-center text-sm text-neutral-500">Bo‘lim yuklanmoqda…</div>;
}

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [currentView, setCurrentView] = useState<NavView>('dashboard');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState<boolean>(false);
  const [showLoginModal, setShowLoginModal] = useState<boolean>(false);
  const [isApkModalOpen, setIsApkModalOpen] = useState<boolean>(false);
  const [isQuickToolsOpen, setIsQuickToolsOpen] = useState<boolean>(false);
  const [isAIAgentOpen, setIsAIAgentOpen] = useState<boolean>(false);
  const [quickToolsTab, setQuickToolsTab] = useState<'DENOMINATIONS' | 'CURRENCY' | 'RECEIPT' | 'Z_REPORT'>('DENOMINATIONS');

  const handleOpenQuickTools = (tab: 'DENOMINATIONS' | 'CURRENCY' | 'RECEIPT' | 'Z_REPORT' = 'DENOMINATIONS') => {
    setQuickToolsTab(tab);
    setIsQuickToolsOpen(true);
  };

  // Core Data
  const [stats, setStats] = useState<any>(null);
  const [cashDay, setCashDay] = useState<CashDay | null>(null);
  const [transactions, setTransactions] = useState<CashTransaction[]>([]);
  const [availableRegisters, setAvailableRegisters] = useState<any[]>([]);

  // Load Application Data
  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [statsRes, cashRes] = await Promise.all([
        api.getDashboardStats().catch(() => null),
        api.getCashStatus().catch(() => null),
      ]);
      if (statsRes?.stats) {
        setStats(statsRes.stats);
      }

      if (cashRes) {
        setCashDay(cashRes.currentDay);
        setTransactions(cashRes.transactions || []);
        setAvailableRegisters(cashRes.availableRegisters || []);
      }
    } catch (err) {
      console.error('Error loading data:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Check auth or auto-login default superadmin on initial launch
  useEffect(() => {
    const initAuth = async () => {
      setIsLoading(true);
      const token = getStoredToken();
      if (token) {
        try {
          const res = await api.getMe();
          setUser(res.user);
          setCurrentView(homeView(res.user));
          await loadData();
          return;
        } catch (err) {
          if ((err as any)?.status === 401) removeStoredToken();
        }
      }

      setShowLoginModal(true);
      setIsLoading(false);
    };

    initAuth();
  }, [loadData]);

  // Any API call that finds the session gone returns the user to the login screen.
  useEffect(() => {
    const onExpired = () => { setUser(null); setShowLoginModal(true); };
    window.addEventListener('distro-auth-expired', onExpired);
    return () => window.removeEventListener('distro-auth-expired', onExpired);
  }, []);

  const handleLogout = () => {
    removeStoredToken();
    setUser(null);
    setShowLoginModal(true);
  };

  const handleSwitchUser = async (_email: string) => { handleLogout(); };

  const renderCurrentView = () => {
    // A page the role cannot use falls back to the personal cabinet (the server refuses its data anyway).
    if (!canOpen(user, currentView)) return <CabinetView user={user} />;
    switch (currentView) {
      case 'crm':
        return <CRMView user={user} />;
      case 'cabinet':
        return <CabinetView user={user} />;
      case 'attendance':
        return <AttendanceView />;
      case 'dashboard':
        return (
          <DashboardView 
            stats={stats} 
            onNavigate={setCurrentView} 
            onOpenAIAgent={() => setIsAIAgentOpen(true)} 
            onRefresh={loadData}
          />
        );
      case 'forecast':
        return (
          <ForecastView 
            user={user} 
            onNavigateToProducts={() => setCurrentView('products')} 
          />
        );
      case 'daily_files':
        return <DailyFilesView user={user} onNavigateToCash={() => setCurrentView('cash')} />;
      case 'cash':
        return (
          <CashView
            cashDay={cashDay}
            transactions={transactions}
            availableRegisters={availableRegisters}
            user={user}
            onRefresh={loadData}
          />
        );
      case 'balance':
        return <BalanceView />;
      case 'products':
        return <ProductsView />;
      case 'audit':
        return <AuditView />;
      case 'integrations':
        return <IntegrationsView onNavigate={setCurrentView} onRefresh={loadData} />;
      case 'settings':
        return <SettingsView currentUser={user} />;
      case 'expenses':
        return <ExpensesView user={user} />;
      case 'customers':
        return <CustomersView user={user} />;
      case 'employees':
        return <EmployeesView user={user} />;
      case 'reports':
        return <ReportsView user={user} onNavigate={setCurrentView} onRefresh={loadData} />;
      case 'jarvis':
        return <JarvisView onNavigate={setCurrentView} />;
      default:
        return (
          <DashboardView 
            stats={stats} 
            onNavigate={setCurrentView} 
            onOpenAIAgent={() => setIsAIAgentOpen(true)}
            onRefresh={loadData} 
          />
        );
    }
  };

  if (!user) return <LoginModal isOpen={true} onSuccess={(loggedUser) => {setUser(loggedUser);setCurrentView(homeView(loggedUser));setShowLoginModal(false);loadData();}} />;

  // A password issued by the owner must be replaced before anything else (the server enforces the same).
  if (user.must_change_password) return (
    <div className="min-h-screen bg-neutral-100">
      <Suspense fallback={<ViewLoading />}><ChangePasswordModal forced onDone={async () => { const res = await api.getMe(); setUser(res.user); setCurrentView(homeView(res.user)); loadData(); }} /></Suspense>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-neutral-100 font-sans text-neutral-900 antialiased">
      {/* Sidebar Navigation */}
      <Sidebar
        currentView={currentView}
        onNavigate={setCurrentView}
        isOpenMobile={isMobileMenuOpen}
        onCloseMobile={() => setIsMobileMenuOpen(false)}
        user={user}
        onOpenApkModal={() => setIsApkModalOpen(true)}
      />

      {/* Main Content Area */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Header
          user={user}
          activeCashDay={cashDay}
          onLogout={handleLogout}
          onSwitchUser={handleSwitchUser}
          onToggleMobileMenu={() => setIsMobileMenuOpen(prev => !prev)}
          onRefresh={loadData}
          isLoading={isLoading}
          onOpenQuickTools={handleOpenQuickTools}
          onProfileChanged={async () => { const r = await api.getMe(); setUser(r.user); }}
        />

        <main className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto p-3 sm:p-4 md:p-6 lg:p-8">
          <div className="mx-auto w-full min-w-0 max-w-7xl">
            <ErrorBoundary resetKey={currentView}><Suspense fallback={<ViewLoading />}>{renderCurrentView()}</Suspense></ErrorBoundary>
          </div>
        </main>
      </div>

      {/* Floating AI Agent Trigger Button: it answers from the company's books, so only for people who may see reports. */}
      {(canOpen(user, 'jarvis') || canOpen(user, 'reports')) && <button
        // The owner gets Jarvis (the real agent that reads the books with tools); others the quick assistant.
        onClick={() => canOpen(user, 'jarvis') ? setCurrentView('jarvis') : setIsAIAgentOpen(true)}
        className="fixed bottom-6 right-6 z-40 flex items-center gap-2.5 rounded-full bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 px-4 py-3 text-white shadow-xl hover:shadow-2xl hover:scale-105 transition-all cursor-pointer group border border-white/20"
        title="Distro AI Maslahatchisi"
      >
        <Sparkles className="h-5 w-5 animate-pulse text-amber-300" />
        <span className="text-xs font-bold tracking-wide hidden sm:inline">AI Agent</span>
        <span className="flex h-2 w-2 relative">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400"></span>
        </span>
      </button>}

      {/* Interactive Distro AI Agent Drawer */}
      {isAIAgentOpen && <Suspense fallback={null}><AIAgentDrawer
        isOpen={isAIAgentOpen}
        onClose={() => setIsAIAgentOpen(false)}
        onNavigateToForecast={() => {
          setIsAIAgentOpen(false);
          setCurrentView('forecast');
        }}
      /></Suspense>}

      {/* Quick Cashier Tools (Denomination Counter, Currency Converter, Receipt Slip, Z-Report) */}
      {isQuickToolsOpen && <Suspense fallback={null}><QuickToolsModal
        isOpen={isQuickToolsOpen}
        onClose={() => setIsQuickToolsOpen(false)}
        activeCashDay={cashDay}
        transactions={transactions}
        defaultTab={quickToolsTab}
      /></Suspense>}

      {/* Login Modal for session initiation or manual credentials */}
      <LoginModal
        isOpen={showLoginModal && !user}
        onSuccess={(loggedUser) => {
          setUser(loggedUser);
          setShowLoginModal(false);
          loadData();
        }}
      />

      {/* Android APK / Mobile App Install Modal */}
      {isApkModalOpen && <Suspense fallback={null}><ApkInstallModal
        isOpen={isApkModalOpen}
        onClose={() => setIsApkModalOpen(false)}
      /></Suspense>}
    </div>
  );
}
