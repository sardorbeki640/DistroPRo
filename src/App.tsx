import React, { useState, useEffect, useCallback } from 'react';
import { Header } from './components/Header.tsx';
import { Sidebar } from './components/Sidebar.tsx';
import { LoginModal } from './components/LoginModal.tsx';
import { DashboardView } from './components/views/DashboardView.tsx';
import { DailyFilesView } from './components/views/DailyFilesView.tsx';
import { CashView } from './components/views/CashView.tsx';
import { AuditView } from './components/views/AuditView.tsx';
import { IntegrationsView } from './components/views/IntegrationsView.tsx';
import { SettingsView } from './components/views/SettingsView.tsx';
import { ExpensesView } from './components/views/ExpensesView.tsx';
import { CustomersView } from './components/views/CustomersView.tsx';
import { EmployeesView } from './components/views/EmployeesView.tsx';
import { ReportsView } from './components/views/ReportsView.tsx';
import { BalanceView } from './components/views/BalanceView.tsx';
import { ProductsView } from './components/views/ProductsView.tsx';
import { ForecastView } from './components/views/ForecastView.tsx';
import { ApkInstallModal } from './components/common/ApkInstallModal.tsx';
import { QuickToolsModal } from './components/common/QuickToolsModal.tsx';
import { AIAgentDrawer } from './components/common/AIAgentDrawer.tsx';
import { ErrorBoundary } from './components/common/ErrorBoundary.tsx';
import { JarvisView } from './components/views/JarvisView.tsx';
import { PlaceholderView } from './components/views/PlaceholderView.tsx';
import { CRMView } from './components/views/CRMView.tsx';
import { CabinetView } from './components/views/CabinetView.tsx';
import { AttendanceView } from './components/views/AttendanceView.tsx';
import { ChangePasswordModal } from './components/common/ChangePasswordModal.tsx';
import { canOpen, homeView } from './utils/permissions.ts';
import { api, getStoredToken, removeStoredToken } from './services/api.ts';
import { AuthUser, CashDay, CashTransaction, NavView } from './types.ts';
import { Sparkles } from 'lucide-react';

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
      // 1. Dashboard stats
      const statsRes = await api.getDashboardStats().catch(() => null);
      if (statsRes?.stats) {
        setStats(statsRes.stats);
      }

      // 2. Cash status
      const cashRes = await api.getCashStatus().catch(() => null);
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
        } catch {
          removeStoredToken();
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
      <ChangePasswordModal forced onDone={async () => { const res = await api.getMe(); setUser(res.user); setCurrentView(homeView(res.user)); loadData(); }} />
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
            <ErrorBoundary resetKey={currentView}>{renderCurrentView()}</ErrorBoundary>
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
      <AIAgentDrawer
        isOpen={isAIAgentOpen}
        onClose={() => setIsAIAgentOpen(false)}
        onNavigateToForecast={() => {
          setIsAIAgentOpen(false);
          setCurrentView('forecast');
        }}
      />

      {/* Quick Cashier Tools (Denomination Counter, Currency Converter, Receipt Slip, Z-Report) */}
      <QuickToolsModal
        isOpen={isQuickToolsOpen}
        onClose={() => setIsQuickToolsOpen(false)}
        activeCashDay={cashDay}
        transactions={transactions}
        defaultTab={quickToolsTab}
      />

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
      <ApkInstallModal
        isOpen={isApkModalOpen}
        onClose={() => setIsApkModalOpen(false)}
      />
    </div>
  );
}
