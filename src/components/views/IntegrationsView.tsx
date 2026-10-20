import React, { useState, useEffect } from 'react';
import { 
  Network, 
  RefreshCw, 
  CheckCircle2, 
  AlertCircle, 
  ExternalLink, 
  Activity, 
  Layers, 
  Zap, 
  ShieldCheck, 
  Server, 
  Key, 
  Check, 
  Cpu,
  Eye,
  EyeOff,
  Settings,
  Lock,
  User,
  Clock,
  Database,
  Globe,
  Radio,
  X,
  BookOpen,
  FileCode
} from 'lucide-react';
import { api } from '../../services/api.ts';
import { refreshDistribution } from '../../hooks/useDistribution.ts';
import { SecretInput } from '../common/SecretInput.tsx';
import { IntegrationRecord, NavView } from '../../types.ts';

interface IntegrationConfigState {
  forecast_days?:number;
  order_date_field?:string;
  payment_cash_id?:string;
  payment_terminal_id?:string;
  sale_price_type_id?:string;
  sale_price_type_ids?:string[];
  purchase_price_type_id?:string;
  provider_name: string;
  integration_id?: string;
  connection_name?: string;
  auth_type: 'API_TOKEN' | 'SERVER_CREDENTIALS';
  server_url: string;
  api_token: string;
  username: string;
  password: string;
  company_account_id: string;
  branch_code: string;
  database_name: string;
  sync_interval: string;
  auto_sync: boolean;
  history_start_date?: string;
  has_token?: boolean;     // a secret is stored on the server; it is never sent back to the browser
  has_password?: boolean;
}

interface IntegrationsViewProps {
  onNavigate?: (view: NavView) => void;
  onRefresh?: () => void;
}

export const IntegrationsView: React.FC<IntegrationsViewProps> = ({ onNavigate, onRefresh }) => {
  const [integrations, setIntegrations] = useState<IntegrationRecord[]>([]);
  const [adapters, setAdapters] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncingProvider, setSyncingProvider] = useState<string | null>(null);
  const [testingProvider, setTestingProvider] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string; showReportsLink?: boolean } | null>(null);

  // SalesDoctor API Doc Modal State
  const [showSalesDocDocModal, setShowSalesDocDocModal] = useState<boolean>(false);

  // Configuration Modal State
  const [showConfigModal, setShowConfigModal] = useState<boolean>(false);
  const [selectedSystem, setSelectedSystem] = useState<any | null>(null);
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [showToken, setShowToken] = useState<boolean>(false);
  const [isSavingConfig, setIsSavingConfig] = useState<boolean>(false);
  const [isModalTesting, setIsModalTesting] = useState<boolean>(false);
  const [paymentTypes, setPaymentTypes] = useState<{ SD_id: string; name: string; active: boolean }[]>([]);
  const [paymentTypesError, setPaymentTypesError] = useState<string | null>(null);
  const [priceTypes, setPriceTypes] = useState<{ id: string; name: string; kind: string; active: boolean }[]>([]);
  const [priceTypesUsed, setPriceTypesUsed] = useState<{ sale?: string | null; purchase?: string | null }>({});
  const [priceTypesError, setPriceTypesError] = useState<string | null>(null);
  const [modalTestResult, setModalTestResult] = useState<{
    ok: boolean;
    message: string;
    latencyMs?: number;
    syncCoefficient?: number;
  } | null>(null);

  const [configForm, setConfigForm] = useState<IntegrationConfigState>({
    provider_name: 'CUSTOM_SERVER',
    auth_type: 'API_TOKEN',
    server_url: '',
    api_token: '',
    username: '',
    password: '',
    company_account_id: '',
    branch_code: '',
    database_name: '',
    sync_interval: '1h',
    auto_sync: true
  });

  // Target SFA & Server Systems
  const systems = [
    {
      id: 'salesdoc',
      provider_name: 'SALESDOC',
      name: 'SalesDoctor (SalesDoc.io API V2)',
      url: 'https://github.com/Clever91/salesdoc-api-doc',
      defaultUrl: 'https://server.salesdoctor.uz/api/v2',
      description: 'Clever91/salesdoc-api-doc rasmiy spetsifikatsiyasi bo\'yicha to\'liq integratsiya. POST /api/v2 yagona endpoint, avtomatik login/token, ombor qoldiqlari (getStock), agent buyurtmalari (getOrder) va nasiya balansi (getBalance).',
      syncFeatures: [
        'POST /api/v2: Yagona endpoint & JSON so\'rov protokoli',
        'Avtomatik login (token olish) yoki API Token & userId',
        'Ombor qoldiqlari: getStock & tovarlar getProduct importi',
        'Savdo buyurtmalari: getOrder (holati, tovarlari, summa)',
        'Mijozlar nasiyasi: getBalance (manfiy balans = qarz)',
        'Kassa tushumlari: getPayment & kassa kirimiga bog\'lash'
      ],
      badge: 'SalesDoc API V2',
      badgeColor: 'bg-blue-100 text-blue-800 border-blue-200'
    },
    {
      id: 'custom_server',
      provider_name: 'CUSTOM_SERVER',
      name: 'Shaxsiy Server (Maxsus Server / ERP / 1C / API)',
      url: 'https://server.domain.uz',
      defaultUrl: 'https://my-server.uz/api/v1',
      description: 'Korxonaning o\'z shaxsiy server kabineti, ichki ERP, 1C shlyuzi yoki REST API orqali to\'liq avtomatlashtirilgan integratsiya.',
      syncFeatures: [
        'Shaxsiy server kabinetidan API token yoki login/parol',
        'Kunlik reestr buyurtmalarini import qilish',
        'Mijozlar balansi va qarzlarini 2-tomonlama yangilash',
        'Kassa to\'lovlarini server kabinetiga uzatish'
      ],
      badge: 'Shaxsiy Server',
      badgeColor: 'bg-purple-100 text-purple-800 border-purple-200'
    },
    {
      id: 'smartup',
      provider_name: 'SMARTUP',
      name: 'SmartUp.Online',
      url: 'https://smartup.online',
      defaultUrl: 'https://api.smartup.online/v3',
      description: 'SFA & ERP distributsiya platformasi. Buyurtmalar, ekspeditsiya marshrutlari va to\'lovlar to\'liq integratsiyalangan.',
      syncFeatures: [
        'Shaxsiy kabinet API tokeni yoki server foydalanuvchisi',
        'Buyurtmalar importi va statuslar nazorati',
        'Vozvratlar solishtiruvi va qarzlar rekonsilyatsiyasi',
        'Narxlar 2-tomonlama yangilanishi'
      ],
      badge: 'Adapter hali yozilmagan',
      badgeColor: 'bg-neutral-100 text-neutral-600 border-neutral-200'
    },
    {
      id: 'linko',
      provider_name: 'LINKO',
      name: 'Linko.uz',
      url: 'https://linko.uz',
      defaultUrl: '',
      description: 'Linko SFA kabinetiga app.linko.uz dagi server nomi, login va parol bilan ulanadi (token kerak emas).',
      syncFeatures: [
        'Server nomi + login + parol (app.linko.uz kirish oynasidagidek)',
        'Buyurtmalar tarixi, mijozlar, agentlar, kategoriyali tovarlar',
        'Qarz/to‘lov daftari va kunlik kassa buyurtmalari'
      ],
      badge: 'Linko (login/parol)',
      badgeColor: 'bg-neutral-100 text-neutral-600 border-neutral-200'
    }
  ];

  // Without this the cards fall back to "Sozlanmagan" when the list did not load, which looks like lost settings.
  const [loadError, setLoadError] = useState<string | null>(null);
  const fetchIntegrations = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await api.getIntegrations();
      setIntegrations(res.integrations || []);
      setAdapters(res.availableAdapters || []);
    } catch (err: any) {
      console.error('Failed to load integrations:', err);
      setLoadError(err.message || 'Integratsiyalar ro‘yxatini yuklab bo‘lmadi.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchIntegrations();
  }, []);

  // Order history of the active distribution system (whichever gives its history; a switched-on one first): coverage and live progress.
  const [history, setHistory] = useState<any>(null);
  const [historyRunning, setHistoryRunning] = useState(false);
  const [historyPoll, setHistoryPoll] = useState(false);
  const withHistory = integrations.filter(i => i.capabilities?.history);
  const historyRecord = withHistory.find(i => i.status === 'CONNECTED' && !i.disabled) || withHistory.find(i => !i.disabled) || withHistory[0];
  const historyProvider: string | null = historyRecord?.provider_name.toUpperCase() || null;
  const historyName = historyRecord?.system_name || historyProvider || '';
  const loadHistory = async (): Promise<boolean> => {
    if (!historyProvider) return false;
    try {
      const r = await api.getSalesDocHistoryStatus(historyProvider);
      setHistory(r.history);
      setHistoryRunning(!!r.running);
      return !!r.running;
    } catch {
      return false;
    }
  };
  useEffect(() => {
    setHistory(null);
    loadHistory().then(running => { if (running) setHistoryPoll(true); });
  }, [historyProvider]);
  useEffect(() => {
    if (!historyPoll) return;
    const timer = setInterval(async () => {
      const running = await loadHistory();
      if (!running) { setHistoryPoll(false); fetchIntegrations(); }
    }, 4000);
    return () => clearInterval(timer);
  }, [historyPoll]);

  const getSavedRecord = (providerName: string): IntegrationRecord | undefined => {
    return integrations.find(
      i => i.provider_name.toUpperCase() === providerName.toUpperCase()
    );
  };

  // Open Configuration Modal
  const handleOpenConfig = async (sys: any, record?: IntegrationRecord, createNew = false) => {
    setSelectedSystem(sys);
    // Lists come from whichever system is being set up, if it can give them.
    const caps = record?.capabilities || getSavedRecord(sys.provider_name)?.capabilities;
    setPaymentTypes([]);
    setPaymentTypesError(null);
    if (caps?.paymentTypes) api.getSalesDocPaymentTypes(sys.provider_name, record?.id)
      .then(r => setPaymentTypes(r.paymentTypes || []))
      .catch(err => setPaymentTypesError(err.message || 'xato'));
    setPriceTypes([]);
    setPriceTypesError(null);
    if (caps?.priceTypes) api.getSalesDocPriceTypes(sys.provider_name, record?.id)
      .then(r => { setPriceTypes(r.priceTypes || []); setPriceTypesUsed(r.used || {}); })
      .catch(err => setPriceTypesError(err.message || 'xato'));
    setModalTestResult(null);
    setShowPassword(false);
    setShowToken(false);

    try {
      const res = createNew ? null : await api.getIntegrationConfig(sys.provider_name, record?.id);
      if (res && res.configured && res.config) {
        const c = res.config;
        setConfigForm({
          forecast_days:c.forecast_days||100,order_date_field:c.order_date_field||'date',payment_cash_id:c.payment_cash_id||'',payment_terminal_id:c.payment_terminal_id||'',
          sale_price_type_id:c.sale_price_type_id||'',sale_price_type_ids:c.sale_price_type_ids||(c.sale_price_type_id?[c.sale_price_type_id]:[]),purchase_price_type_id:c.purchase_price_type_id||'',
          provider_name: sys.provider_name,
          integration_id: record?.id,
          connection_name: c.connection_name || '',
          auth_type: c.auth_type || 'API_TOKEN',
          server_url: c.server_url || sys.defaultUrl,
          api_token: '',
          username: c.username || '',
          password: '',
          has_token: !!c.has_token,
          has_password: !!c.has_password,
          history_start_date: c.history_start_date || '',
          company_account_id: c.company_account_id || '',
          branch_code: c.branch_code || '',
          database_name: c.database_name || '',
          sync_interval: c.sync_interval || '1h',
          auto_sync: c.auto_sync !== false
        });
      } else {
        setConfigForm({
          provider_name: sys.provider_name,
          connection_name: '',
          // Linko hands out no API token; its cabinet signs in with server + login + password.
          auth_type: sys.provider_name === 'LINKO' ? 'SERVER_CREDENTIALS' : 'API_TOKEN',
          server_url: sys.defaultUrl,
          api_token: '',
          username: '',
          password: '',
          company_account_id: '',
          branch_code: '',
          database_name: '',
          sync_interval: '1h',
          auto_sync: true
        });
      }
    } catch {
      setConfigForm({
        provider_name: sys.provider_name,
        connection_name: '',
        auth_type: 'API_TOKEN',
        server_url: sys.defaultUrl,
        api_token: '',
        username: '',
        password: '',
        company_account_id: '',
        branch_code: '',
        database_name: '',
        sync_interval: '1h',
        auto_sync: true
      });
    }

    setShowConfigModal(true);
  };

  // Test connection directly from the modal using current form state
  const handleModalTestConnection = async () => {
    setIsModalTesting(true);
    setModalTestResult(null);
    try {
      const res = await api.testIntegrationConnection(configForm.provider_name, configForm, configForm.integration_id);
      setModalTestResult(res.result);
    } catch (err: any) {
      setModalTestResult({
        ok: false,
        message: err.message || "Ulanish sinovida xatolik yuz berdi"
      });
    } finally {
      setIsModalTesting(false);
    }
  };

  // Save configuration
  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingConfig(true);
    setStatusMessage(null);
    try {
      const res = await api.saveIntegrationConfig(configForm);
      setStatusMessage({
        type: 'success',
        text: `${configForm.provider_name === 'SALESDOC' ? 'SalesDoctor' : configForm.provider_name}: ${res.message || "Shaxsiy server kabineti ulanish parametrlari muvaffaqiyatli saqlandi!"}`,
        showReportsLink: true
      });
      setShowConfigModal(false);
      await fetchIntegrations();
      if (onRefresh) onRefresh();
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: err.message || "Sozlamalarni saqlashda xatolik yuz berdi"
      });
    } finally {
      setIsSavingConfig(false);
    }
  };

  const [togglingProvider, setTogglingProvider] = useState<string | null>(null);
  const handleToggleEnabled = async (providerName: string, enable: boolean, integrationId?: string) => {
    if (!enable && !window.confirm(`${providerName} o‘chirilsinmi? Undan ma’lumot olinmaydi va unga to‘lov yuborilmaydi. Sozlamalar saqlanib qoladi.`)) return;
    setTogglingProvider(providerName);
    setStatusMessage(null);
    try {
      const res = await api.setIntegrationEnabled(providerName, enable, integrationId);
      setStatusMessage({ type: 'success', text: res.message });
      refreshDistribution();
      await fetchIntegrations();
      if (onRefresh) onRefresh();
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Holatni o‘zgartirib bo‘lmadi' });
    } finally {
      setTogglingProvider(null);
    }
  };

  const handleTestConnection = async (providerName: string) => {
    setTestingProvider(providerName);
    setStatusMessage(null);
    try {
      const res = await api.testIntegrationConnection(providerName);
      const label = getSavedRecord(providerName)?.system_name || providerName;
      setStatusMessage({
        type: res.result?.ok ? 'success' : 'error',
        text: `${label}: ${res.result?.message || "Aloqa muvaffaqiyatli sinovdan o'tdi (Status: 200 OK)"}`
      });
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: err.message || "Aloqa tekshirishda xatolik yuz berdi"
      });
    } finally {
      setTestingProvider(null);
    }
  };

  const handleSync = async (providerName: string, integrationId?: string) => {
    setSyncingProvider(providerName);
    setStatusMessage(null);
    try {
      const res: any = await api.syncIntegration(providerName, integrationId);
      const saved = getSavedRecord(providerName);
      const label = saved?.system_name || providerName;
      const r = res.result || {};
      setStatusMessage({
        type: r.status === 'FAILED' ? 'error' : 'success',
        text: r.details?.background
          ? `${label}: ${r.details.message}`
          : r.status === 'FAILED'
            ? `${label}: sinxronlanmadi. ${(r.errors || []).join('; ')}`
            : `${label}: ${r.recordsImported || 0} ta yozuv yangilandi, ${r.recordsFailed || 0} ta o'tkazib yuborildi.`,
        showReportsLink: !r.details?.background
      });
      if (saved?.capabilities?.history) setHistoryPoll(true);
      refreshDistribution();
      await fetchIntegrations();
      if (onRefresh) onRefresh();
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: err.message || 'Sinxronizatsiyada xatolik yuz berdi'
      });
    } finally {
      setSyncingProvider(null);
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Top Banner */}
      <div className="flex flex-col justify-between gap-4 rounded-2xl border border-neutral-200 bg-white p-5 shadow-xs sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-emerald-50 text-emerald-700 rounded-xl border border-emerald-100">
              <Network className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-neutral-900">Shaxsiy Server & SFA Integratsiya Markazi</h1>
              <p className="text-xs text-neutral-500 mt-0.5">
                Shaxsiy server kabinetidan <strong>API Token</strong> yoki <strong>Server Login/Paroli</strong> orqali 2 tomonlama sinxronizatsiya
              </p>
            </div>
          </div>
        </div>

        <button
          onClick={fetchIntegrations}
          disabled={loading}
          className="inline-flex items-center px-3.5 py-2 text-xs font-semibold text-neutral-700 bg-neutral-100 hover:bg-neutral-200 rounded-xl transition"
        >
          <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
          Yangilash
        </button>
      </div>

      {loading && integrations.length === 0 && (
        <div className="p-4 rounded-xl border border-sky-200 bg-sky-50 text-xs text-sky-800 flex items-center gap-2">
          <RefreshCw className="w-4 h-4 animate-spin shrink-0" />
          <span className="font-medium">Integratsiya sozlamalari yuklanmoqda… (tarix yuklanayotgan bo‘lsa biroz kutish kerak bo‘ladi)</span>
        </div>
      )}

      {loadError && (
        <div className="p-4 rounded-xl border border-red-200 bg-red-50 text-xs text-red-800 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
            <span className="font-medium">Sozlamalar yuklanmadi: {loadError} Quyidagi "Sozlanmagan" belgilari haqiqiy holat emas.</span>
          </div>
          <button onClick={fetchIntegrations} className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white font-bold rounded-lg shrink-0">Qayta urinish</button>
        </div>
      )}

      {statusMessage && (
        <div className={`p-4 rounded-xl border text-xs flex items-center justify-between ${
          statusMessage.type === 'success' 
            ? 'bg-emerald-50 border-emerald-200 text-emerald-800' 
            : 'bg-red-50 border-red-200 text-red-800'
        }`}>
          <div className="flex items-center space-x-2">
            {statusMessage.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
            )}
            <span className="font-medium">{statusMessage.text}</span>
          </div>
          <div className="flex items-center space-x-2">
            {statusMessage.showReportsLink && onNavigate && (
              <button
                type="button"
                onClick={() => onNavigate('reports')}
                className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white font-bold rounded-lg text-xs transition shadow-xs cursor-pointer flex items-center gap-1"
              >
                <span>Hisobotlarni ko'rish &rarr;</span>
              </button>
            )}
            <button onClick={() => setStatusMessage(null)} className="opacity-70 hover:opacity-100 font-bold p-1">✕</button>
          </div>
        </div>
      )}

      {/* SALESDOC HISTORY COVERAGE — forecasts depend on it */}
      {historyProvider && (
        <div className={`rounded-2xl border p-5 shadow-xs ${history?.complete ? 'border-emerald-200 bg-emerald-50/50' : 'border-amber-300 bg-amber-50'}`}>
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="text-xs space-y-1">
              <h2 className="text-sm font-bold text-neutral-900">{historyName} buyurtmalar tarixi (hisobot va prognoz shu tarixdan hisoblanadi)</h2>
              {historyRunning || history?.status === 'RUNNING' ? (
                <p className="font-semibold text-amber-900">
                  Yuklanmoqda: {history?.current || '...'} oyi · {history?.months_done || 0} oy tayyor · {history?.orders || 0} ta buyurtma
                  {!historyRunning && ' (server to‘xtagan — qayta ishga tushganda davom etadi)'}
                </p>
              ) : history?.complete ? (
                <p className="font-semibold text-emerald-800">To‘liq: {history.start || history.from} — {history.to} · {history.orders} ta buyurtma</p>
              ) : history?.status === 'FAILED' ? (
                <p className="font-semibold text-red-700">To‘xtadi: {history.error}. Yuklangan oylar saqlangan; qayta bosing — qolgan joydan davom etadi.</p>
              ) : history ? (
                <p className="font-semibold text-amber-900">To‘liq emas: {history.from ? `${history.from} dan boshlab yuklangan` : 'hali yuklanmagan'}. Prognoz ishonchsiz.</p>
              ) : (
                <p className="font-semibold text-amber-900">Tarix hali yuklanmagan. Prognoz hisoblanmaydi.</p>
              )}
              {history && (
                <p className="text-neutral-600">
                  Birinchi buyurtma: {history.first_order || '—'} · O‘tkazib yuborilgan (mijoz yoki sanasi yo‘q): {history.skipped || 0}
                  {history.ledger_synced_to && ` · Qarz/to‘lov daftari: ${history.ledger_synced_to} gacha`}
                  {history.synced_at && ` · Oxirgi yuklash: ${new Date(history.synced_at).toLocaleString('uz-UZ')}`}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => { handleSync(historyProvider); setTimeout(() => setHistoryPoll(true), 1500); }}
              disabled={historyRunning || syncingProvider === historyProvider}
              className="px-4 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 rounded-xl shadow-xs flex items-center gap-1.5 shrink-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${historyRunning ? 'animate-spin' : ''}`} />
              <span>{history?.complete ? 'Tarixni yangilash' : 'To‘liq tarixni yuklash'}</span>
            </button>
          </div>
        </div>
      )}

      {/* SALESDOCTOR API V2 GUIDE CALLOUT BANNER */}
      <div className="rounded-2xl border border-blue-200 bg-gradient-to-r from-blue-50 via-indigo-50/40 to-white p-5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-start gap-3.5">
          <div className="p-2.5 bg-blue-600 text-white rounded-xl shadow-xs shrink-0 mt-0.5">
            <BookOpen className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-neutral-900">
                SalesDoctor API V2 Integratsiya Standarti (Clever91/salesdoc-api-doc)
              </h2>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-blue-100 text-blue-800 border border-blue-200">
                POST /api/v2
              </span>
            </div>
            <p className="text-xs text-neutral-600 mt-1 max-w-2xl leading-relaxed">
              SalesDoctor platformasi bilan rasmiy spetsifikatsiya bo'yicha to'liq integratsiya: yagona <code className="px-1.5 py-0.5 bg-white border border-neutral-300 rounded font-mono text-[11px] text-blue-700">/api/v2</code> endpointi, <code className="font-mono text-neutral-800">login</code> autentifikatsiyasi, ombor qoldiqlari (<code className="font-mono text-neutral-800">getStock</code>), buyurtmalar (<code className="font-mono text-neutral-800">getOrder</code>) va nasiyalar (<code className="font-mono text-neutral-800">getBalance</code>).
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => setShowSalesDocDocModal(true)}
            className="px-3.5 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition shadow-xs flex items-center gap-1.5 cursor-pointer"
          >
            <BookOpen className="w-4 h-4" />
            <span>Integratsiya Qo'llanmasi</span>
          </button>

          <a
            href="https://github.com/Clever91/salesdoc-api-doc"
            target="_blank"
            rel="noreferrer"
            className="px-3.5 py-2 text-xs font-semibold text-neutral-700 bg-white border border-neutral-300 hover:bg-neutral-50 rounded-xl transition flex items-center gap-1.5"
          >
            <FileCode className="w-4 h-4 text-neutral-500" />
            <span>GitHub Doc &rarr;</span>
          </a>
        </div>
      </div>

      {/* SYSTEMS INTEGRATION CARDS */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {systems.map(sys => {
          const isSyncing = syncingProvider === sys.provider_name;
          const isTesting = testingProvider === sys.provider_name;
          const saved = getSavedRecord(sys.provider_name);
          const serverRecords = integrations.filter(i => i.provider_name.toUpperCase() === sys.provider_name.toUpperCase());
          const isConnected = saved?.status === 'CONNECTED';
          const authType = saved?.config?.auth_type || 'API_TOKEN';

          return (
            <div 
              key={sys.id} 
              className={`bg-white rounded-2xl border shadow-xs p-5 flex flex-col justify-between space-y-4 transition ${
                isConnected ? 'border-emerald-300 ring-1 ring-emerald-100' : 'border-neutral-200 hover:border-neutral-300'
              }`}
            >
              <div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider border ${sys.badgeColor}`}>
                      {sys.badge}
                    </span>
                    {saved?.disabled ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">
                        O‘chirilgan
                      </span>
                    ) : isConnected ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                        <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                        Ulangan ({authType === 'API_TOKEN' ? 'API Token' : 'Login/Parol'})
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-neutral-100 text-neutral-600">
                        Sozlanmagan
                      </span>
                    )}
                  </div>

                  <a 
                    href={sys.url} 
                    target="_blank" 
                    rel="noreferrer"
                    className="text-xs text-neutral-400 hover:text-emerald-600 flex items-center"
                  >
                    {sys.id}.* <ExternalLink className="w-3 h-3 ml-1" />
                  </a>
                </div>

                {serverRecords.length > 0 && <div className="mt-3 rounded-xl border border-indigo-100 bg-indigo-50/60 p-3 text-xs">
                  <div className="mb-1 font-bold text-indigo-900">Ulangan serverlar ({serverRecords.length})</div>
                  {serverRecords.map((record: any) => <div key={record.id} className="flex items-center justify-between gap-2 border-t border-indigo-100 py-1.5">
                    <span className="truncate">{record.config?.connection_name || record.system_name || record.provider_name} · {record.config?.server_url || 'server manzili'}</span>
                    <span className="flex shrink-0 gap-2"><button type="button" className="font-semibold text-indigo-700 hover:underline" onClick={() => handleOpenConfig(sys, record)}>Tahrirlash</button>
                    <button type="button" className="font-semibold text-amber-700 hover:underline" onClick={() => handleToggleEnabled(sys.provider_name, !!record.disabled, record.id)}>{record.disabled ? 'Yoqish' : 'O‘chirish'}</button>
                    <button type="button" className="font-semibold text-emerald-700 hover:underline" onClick={() => handleSync(sys.provider_name, record.id)}>Sinxronlash</button></span>
                  </div>)}
                </div>}

                <div className="mt-3">
                  <h3 className="text-base font-bold text-neutral-900 flex items-center gap-2">
                    {sys.id === 'custom_server' ? <Server className="w-4 h-4 text-purple-600" /> : <Globe className="w-4 h-4 text-emerald-600" />}
                    {sys.name}
                  </h3>
                  <p className="text-xs text-neutral-500 mt-1 leading-relaxed">
                    {sys.description}
                  </p>
                </div>

                {/* Connection Status & Config Details */}
                <div className="mt-4 rounded-xl border border-neutral-100 bg-neutral-50 p-3 text-xs space-y-1.5">
                  <div className="flex items-center justify-between text-neutral-600">
                    <span className="flex items-center gap-1.5 font-medium">
                      <Radio className="w-3.5 h-3.5 text-neutral-400" />
                      Server Manzili:
                    </span>
                    <span className="font-mono font-semibold text-neutral-900 truncate max-w-[200px]">
                      {saved?.config?.server_url || sys.defaultUrl}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-neutral-600">
                    <span className="flex items-center gap-1.5 font-medium">
                      {authType === 'API_TOKEN' ? <Key className="w-3.5 h-3.5 text-emerald-600" /> : <Lock className="w-3.5 h-3.5 text-blue-600" />}
                      Ulanish usuli:
                    </span>
                    <span className="font-semibold text-neutral-800">
                      {authType === 'API_TOKEN' ? (
                        saved?.config?.api_token_masked ? (
                          <span className="font-mono text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                            Token: {saved.config.api_token_masked}
                          </span>
                        ) : 'API Token (Shaxsiy Kabinet)'
                      ) : (
                        <span className="font-mono text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-200">
                          Login: {saved?.config?.username || 'Kassir'}
                        </span>
                      )}
                    </span>
                  </div>

                  {saved?.last_sync_at && (
                    <div className="flex items-center justify-between text-[11px] text-neutral-500 pt-1 border-t border-neutral-200/60">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3 text-neutral-400" />
                        Oxirgi sinxronizatsiya:
                      </span>
                      <span className="font-medium text-neutral-700">
                        {new Date(saved.last_sync_at).toLocaleString('uz-UZ')}
                      </span>
                    </div>
                  )}
                </div>

                {/* Features Checklist */}
                <div className="mt-3 space-y-1">
                  {sys.syncFeatures.slice(0, 3).map((feat, idx) => (
                    <div key={idx} className="flex items-center space-x-1.5 text-[11px] text-neutral-600">
                      <Check className="w-3 h-3 text-emerald-600 shrink-0" />
                      <span>{feat}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="pt-3 border-t border-neutral-100 flex items-center gap-2">
                <button type="button" onClick={() => handleOpenConfig(sys, undefined, true)} className="py-2 px-3 text-xs font-semibold text-indigo-700 border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 rounded-xl">+ Server qo‘shish</button>
                <button
                  type="button"
                  onClick={() => handleOpenConfig(sys)}
                  className="flex-1 py-2 px-3 text-xs font-semibold text-neutral-800 bg-neutral-100 hover:bg-neutral-200 rounded-xl transition flex items-center justify-center gap-1"
                >
                  <Settings className="w-3.5 h-3.5 text-neutral-600" />
                  <span>Kabinet Sozlamalari</span>
                </button>

                {saved && (
                  <button
                    type="button"
                    onClick={() => handleToggleEnabled(sys.provider_name, !!saved.disabled, saved.id)}
                    disabled={togglingProvider === sys.provider_name}
                    className={`py-2 px-3 text-xs font-semibold rounded-xl transition border ${saved.disabled ? 'text-emerald-700 border-emerald-300 bg-emerald-50 hover:bg-emerald-100' : 'text-amber-700 border-amber-300 bg-white hover:bg-amber-50'}`}
                    title={saved.disabled ? 'Integratsiyani qayta yoqish' : 'Integratsiyani vaqtincha o‘chirish (sozlamalar saqlanadi)'}
                  >
                    {togglingProvider === sys.provider_name ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <span>{saved.disabled ? 'Yoqish' : 'O‘chirish'}</span>}
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => handleTestConnection(sys.provider_name)}
                  disabled={isTesting}
                  className="py-2 px-3 text-xs font-semibold text-neutral-700 bg-white border border-neutral-300 hover:bg-neutral-50 rounded-xl transition flex items-center justify-center gap-1"
                  title="Server aloqasini tekshirish"
                >
                  {isTesting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Activity className="w-3.5 h-3.5 text-neutral-500" />}
                  <span>Ping</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleSync(sys.provider_name)}
                  disabled={isSyncing}
                  className="py-2 px-3.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl transition shadow-xs flex items-center justify-center gap-1"
                  title="Ma'lumotlarni sinxronlash"
                >
                  {isSyncing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                  <span>Sinxronlash</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* ARCHITECTURE EXPLANATION */}
      <div className="bg-white rounded-2xl border border-neutral-200 p-6 shadow-xs">
        <h3 className="text-sm font-bold text-neutral-900 mb-2 flex items-center space-x-2">
          <ShieldCheck className="w-4 h-4 text-emerald-600" />
          <span>Shaxsiy Server Kabineti va SFA Adapter Arxitekturasi</span>
        </h3>
        <p className="text-xs text-neutral-600 leading-relaxed">
          Tizimimiz <strong>Shaxsiy Server</strong>, <strong>SalesDoc.io</strong>, <strong>SmartUp.online</strong> va <strong>Linko.uz</strong> tizimlari bilan adapter pattern arxitekturasi asosida ishlaydi. 
          Shaxsiy serveringiz kabinetidan olingan <strong>API Token</strong> yoki <strong>Server Login/Paroli</strong> orqali ulanish o'rnatiladi. 
          Savdo buyurtmalari, agentlar, mijozlar va kassa tushumlari bir bosishda import va eksport qilinadi. Barcha ulanish va sinxronizatsiya amallari audit logida to'liq xavfsiz qayd etiladi.
        </p>
      </div>

      {/* MODAL: Integration Settings & Server Cabinet Credentials */}
      {showConfigModal && selectedSystem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-neutral-200 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-neutral-900 text-white shadow-xs">
                  <Server className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-neutral-900">
                    {selectedSystem.name}
                  </h2>
                  <p className="text-[11px] text-neutral-500">
                    Shaxsiy server kabineti ulanish parametrlari va autentifikatsiyasi
                  </p>
                </div>
              </div>
              <button 
                onClick={() => setShowConfigModal(false)} 
                className="rounded-lg p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSaveConfig} className="mt-4 space-y-4">
              <label className="block text-xs font-semibold text-neutral-700">Server nomi (masalan: Toshkent, 2-server)
                <input type="text" className="mt-1 w-full rounded-lg border border-neutral-300 p-2" placeholder="Ulanish nomi" value={configForm.connection_name || ''} onChange={e => setConfigForm(p => ({...p, connection_name: e.target.value}))} />
              </label>
              {/* Authentication Type Switcher (2 Tabs) */}
              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1.5">
                  Autentifikatsiya Usuli (Shaxsiy Server Kabineti)
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setConfigForm(prev => ({ ...prev, auth_type: 'API_TOKEN' }));
                      setModalTestResult(null);
                    }}
                    className={`flex items-center justify-center gap-2 p-3 rounded-xl border text-xs font-bold transition ${
                      configForm.auth_type === 'API_TOKEN'
                        ? 'border-emerald-600 bg-emerald-50 text-emerald-900 ring-1 ring-emerald-500'
                        : 'border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300'
                    }`}
                  >
                    <Key className="w-4 h-4 text-emerald-600" />
                    <span>1. API Token orqali (Tavsiya etiladi)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setConfigForm(prev => ({ ...prev, auth_type: 'SERVER_CREDENTIALS' }));
                      setModalTestResult(null);
                    }}
                    className={`flex items-center justify-center gap-2 p-3 rounded-xl border text-xs font-bold transition ${
                      configForm.auth_type === 'SERVER_CREDENTIALS'
                        ? 'border-blue-600 bg-blue-50 text-blue-900 ring-1 ring-blue-500'
                        : 'border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300'
                    }`}
                  >
                    <User className="w-4 h-4 text-blue-600" />
                    <span>2. Server Login va Paroli</span>
                  </button>
                </div>
              </div>

              {/* Server URL Endpoint */}
              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1">
                  {configForm.provider_name === 'LINKO' ? 'Linko server nomi' : 'Server URL / API Manzili'} <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <Globe className="absolute left-3 top-2.5 h-4 w-4 text-neutral-400" />
                  <input
                    type="text"
                    required
                    placeholder={configForm.provider_name === 'LINKO' ? 'masalan: biolife' : 'https://my-server.uz/api/v1 yoki http://192.168.1.50:8080'}
                    value={configForm.server_url}
                    onChange={(e) => setConfigForm(prev => ({ ...prev, server_url: e.target.value }))}
                    className="w-full pl-9 pr-3 py-2 text-xs font-mono rounded-lg border border-neutral-300 focus:border-neutral-900 focus:outline-hidden"
                  />
                </div>
                <span className="text-[10px] text-neutral-400">{configForm.provider_name === 'LINKO' ? 'app.linko.uz kirish oynasidagi "Сервер" maydoniga yoziladigan nom. Login va parol ham o‘sha oynadagidek.' : 'Shaxsiy server kabineti yoki SFA tizimi REST API host manzili'}</span>
              </div>

              {/* Option 1: API Token Inputs */}
              {configForm.auth_type === 'API_TOKEN' && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4 space-y-3">
                  <div className="flex items-center gap-2 text-emerald-900 font-bold text-xs">
                    <Key className="w-4 h-4 text-emerald-700" />
                    <span>Shaxsiy Server Kabineti API Tokeni</span>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-neutral-700 mb-1">
                      API Token (Bearer Kalit / Maxfiy Token) <span className="text-red-500">*</span>
                    </label>
                    <div className="relative">
                      <SecretInput
                        reveal={showToken}
                        placeholder={configForm.has_token ? 'Saqlangan — o‘zgartirish uchun yangisini kiriting' : 'API token'}
                        value={configForm.api_token}
                        onChange={(e) => setConfigForm(prev => ({ ...prev, api_token: e.target.value }))}
                        className="w-full pl-3 pr-10 py-2 text-xs font-mono bg-white rounded-lg border border-neutral-300 focus:border-emerald-600 focus:outline-hidden"
                      />
                      <button
                        type="button"
                        onClick={() => setShowToken(!showToken)}
                        className="absolute right-2.5 top-2 text-neutral-400 hover:text-neutral-600"
                      >
                        {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    <span className="text-[10px] text-neutral-500">
                      Ushbu tokenni shaxsiy server kabinetingiz Sozlamalar &rarr; API / Token bo'limidan nusxalashingiz mumkin.
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                    <div>
                      <label className="block text-[11px] font-semibold text-neutral-700 mb-1">
                        Kompaniya / Kabinet ID (ixtiyoriy)
                      </label>
                      <input
                        type="text"
                        placeholder="CMP-1002"
                        value={configForm.company_account_id}
                        onChange={(e) => setConfigForm(prev => ({ ...prev, company_account_id: e.target.value }))}
                        className="w-full p-2 text-xs font-mono bg-white rounded-lg border border-neutral-300 focus:border-emerald-600 focus:outline-hidden"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-neutral-700 mb-1">
                        Filial / Sklad Kodi (ixtiyoriy)
                      </label>
                      <input
                        type="text"
                        placeholder="BRANCH-MAIN"
                        value={configForm.branch_code}
                        onChange={(e) => setConfigForm(prev => ({ ...prev, branch_code: e.target.value }))}
                        className="w-full p-2 text-xs font-mono bg-white rounded-lg border border-emerald-600 focus:outline-hidden"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Option 2: Server Login & Password Inputs */}
              {configForm.auth_type === 'SERVER_CREDENTIALS' && (
                <div className="rounded-xl border border-blue-200 bg-blue-50/40 p-4 space-y-3">
                  <div className="flex items-center gap-2 text-blue-900 font-bold text-xs">
                    <User className="w-4 h-4 text-blue-700" />
                    <span>Server Foydalanuvchi Logini va Maxfiy Paroli</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-neutral-700 mb-1">
                        Server Logini (Foydalanuvchi nomi) <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        placeholder="kassir_asosiy yoki admin"
                        value={configForm.username}
                        onChange={(e) => setConfigForm(prev => ({ ...prev, username: e.target.value }))}
                        className="w-full p-2 text-xs bg-white rounded-lg border border-neutral-300 focus:border-blue-600 focus:outline-hidden"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-neutral-700 mb-1">
                        Server Paroli <span className="text-red-500">*</span>
                      </label>
                      <div className="relative">
                        <SecretInput
                          reveal={showPassword}
                          placeholder={configForm.has_password ? 'Saqlangan — o‘zgartirish uchun yangisini kiriting' : 'Parol'}
                          value={configForm.password}
                          onChange={(e) => setConfigForm(prev => ({ ...prev, password: e.target.value }))}
                          className="w-full pl-3 pr-9 py-2 text-xs bg-white rounded-lg border border-neutral-300 focus:border-blue-600 focus:outline-hidden"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-2.5 top-2 text-neutral-400 hover:text-neutral-600"
                        >
                          {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-neutral-700 mb-1">
                      Baza / Sxema Nomi (InfoBase / Schema)
                    </label>
                    <div className="relative">
                      <Database className="absolute left-2.5 top-2 h-4 w-4 text-neutral-400" />
                      <input
                        type="text"
                        placeholder="trade_distrib_2026"
                        value={configForm.database_name}
                        onChange={(e) => setConfigForm(prev => ({ ...prev, database_name: e.target.value }))}
                        className="w-full pl-8 pr-3 py-1.5 text-xs font-mono bg-white rounded-lg border border-neutral-300 focus:border-blue-600 focus:outline-hidden"
                      />
                    </div>
                  </div>
                </div>
              )}

              {(() => {
                // The same settings for any distribution system; each part appears only if that system can do it.
                const rec = getSavedRecord(configForm.provider_name);
                const caps = rec?.capabilities;
                const sysName = rec?.system_name || (configForm.provider_name === 'SALESDOC' ? 'SalesDoctor' : configForm.provider_name);
                if (!caps && configForm.provider_name !== 'SALESDOC') return null;
                const showPayments = !caps || caps.paymentTypes;
                const showPrices = !caps || caps.priceTypes;
                return <div className="grid gap-3 rounded-xl border p-4">
                {(!caps || caps.history) && <label>Tarix boshlanish sanasi (bo'sh = avtomatik topiladi)<input type="date" className="border rounded p-2 ml-2" value={configForm.history_start_date||''} onChange={e=>setConfigForm(p=>({...p,history_start_date:e.target.value}))}/></label>}
                <label>Prognoz davri (kalendar kun)<input type="number" min="1" max="3660" className="border rounded p-2 ml-2" value={configForm.forecast_days||100} onChange={e=>setConfigForm(p=>({...p,forecast_days:Number(e.target.value)}))}/></label>
                <label>Kassa buyurtmasi sanasi<select className="border rounded p-2 ml-2" value={configForm.order_date_field||'date'} onChange={e=>setConfigForm(p=>({...p,order_date_field:e.target.value}))}><option value="date">Buyurtma sanasi</option><option value="dateLoad">Hujjat sanasi</option></select></label>
                {showPayments && <>
                {/* Sending a payment needs the system's own payment type; the list comes from the system. */}
                <label>Kassadagi naqd pul qaysi {sysName} to‘lov turiga yozilsin
                  <select className="border rounded p-2 ml-2" value={configForm.payment_cash_id||''} onChange={e=>setConfigForm(p=>({...p,payment_cash_id:e.target.value}))}>
                    <option value="">{paymentTypes.length ? '— tanlang —' : 'Ro‘yxat yuklanmoqda...'}</option>
                    {paymentTypes.map(t => <option key={t.SD_id} value={t.SD_id}>{t.name}{t.active ? '' : ' (nofaol)'} · {t.SD_id}</option>)}
                  </select>
                </label>
                <label>Terminal/Click qaysi {sysName} to‘lov turiga yozilsin
                  <select className="border rounded p-2 ml-2" value={configForm.payment_terminal_id||''} onChange={e=>setConfigForm(p=>({...p,payment_terminal_id:e.target.value}))}>
                    <option value="">{paymentTypes.length ? '— tanlang —' : 'Ro‘yxat yuklanmoqda...'}</option>
                    {paymentTypes.map(t => <option key={t.SD_id} value={t.SD_id}>{t.name}{t.active ? '' : ' (nofaol)'} · {t.SD_id}</option>)}
                  </select>
                </label>
                {paymentTypesError && <p className="text-xs text-red-600">To‘lov turlari olinmadi: {paymentTypesError}</p>}
                <p className="text-xs">To‘lov turi tanlanmasa buyurtmaning {sysName}dagi turi ishlatiladi. Faqat {sysName} qabul qilgan to‘lov “tasdiqlandi” deb belgilanadi.</p>
                </>}
                {caps && !caps.payments && <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900">{sysName} hozircha kassadan to‘lov qabul qilmaydi — kassa to‘lovlari faqat shu dasturda saqlanadi.</p>}
                {/* Prices: every price type is imported as is; these two say which is "sotuv narxi" and which "tannarx". */}
                {showPrices && <>
                <fieldset className="rounded-lg border border-neutral-200 p-3">
                  <legend className="px-1 text-sm font-semibold">Sotuv narxlari — bir nechta tur tanlash mumkin</legend>
                  <p className="mb-2 text-xs text-neutral-500">Tanlangan narx turlari mahsulotlarda alohida ko‘rinadi. Birinchi tanlangan tur asosiy sotuv narxi bo‘ladi.</p>
                  {priceTypes.filter(t => t.kind === 'sale').map(t => <label key={t.id} className="flex items-center gap-2 py-1 text-sm"><input type="checkbox" checked={(configForm.sale_price_type_ids || (configForm.sale_price_type_id ? [configForm.sale_price_type_id] : [])).includes(t.id)} onChange={e => setConfigForm(p => { const old = p.sale_price_type_ids || (p.sale_price_type_id ? [p.sale_price_type_id] : []); const next = e.target.checked ? [...old, t.id] : old.filter(id => id !== t.id); return { ...p, sale_price_type_ids: next, sale_price_type_id: next[0] || '' }; })} />{t.name}{t.active ? '' : ' (nofaol)'} · {t.id}</label>)}
                  {!priceTypes.some(t => t.kind === 'sale') && <p className="text-xs text-neutral-500">{priceTypes.length ? 'Sotuv narxi turi topilmadi.' : 'Narx turlari yuklanmoqda...'}</p>}
                </fieldset>
                <label>Kirim narxi (tannarx) — {sysName} narx turi
                  <select className="border rounded p-2 ml-2" value={configForm.purchase_price_type_id||''} onChange={e=>setConfigForm(p=>({...p,purchase_price_type_id:e.target.value}))}>
                    <option value="">{priceTypes.length ? `Avtomatik${priceTypesUsed.purchase ? ` (${priceTypes.find(t => t.id === priceTypesUsed.purchase)?.name})` : ' — topilmadi'}` : 'Ro‘yxat yuklanmoqda...'}</option>
                    {priceTypes.map(t => <option key={t.id} value={t.id}>{t.name}{t.active ? '' : ' (nofaol)'} · {t.id}</option>)}
                  </select>
                </label>
                {priceTypesError && <p className="text-xs text-red-600">Narx turlari olinmadi: {priceTypesError}</p>}
                <p className="text-xs">Barcha narx turlari {sysName}dagidek olinadi va Mahsulotlar bo‘limida ko‘rinadi. Bu ikkisi faqat qaysi biri “sotuv narxi” va qaysi biri “tannarx” ekanini belgilaydi. O‘zgarish keyingi sinxronlashda qo‘llanadi.</p>
                </>}
              </div>;
              })()}
              {/* Sync Options */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">
                    Sinxronizatsiya Davriyligi
                  </label>
                  <select
                    value={configForm.sync_interval}
                    onChange={(e) => setConfigForm(prev => ({ ...prev, sync_interval: e.target.value }))}
                    className="w-full p-2 text-xs bg-white rounded-lg border border-neutral-300 focus:border-neutral-900 focus:outline-hidden"
                  >
                    <option value="15m">Har 15 daqiqada (Tezkor)</option>
                    <option value="1h">Har 1 soatda (Tavsiya etiladi)</option>
                    <option value="6h">Har 6 soatda</option>
                    <option value="24h">Kuniga 1 marta (Kechasi)</option>
                  </select>
                </div>

                <div className="flex items-center pt-5">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={configForm.auto_sync}
                      onChange={(e) => setConfigForm(prev => ({ ...prev, auto_sync: e.target.checked }))}
                      className="h-4 w-4 rounded border-neutral-300 text-emerald-600 focus:ring-emerald-500"
                    />
                    <span className="text-xs font-semibold text-neutral-800">
                      Avtomatik fonda sinxronlashni yoqish
                    </span>
                  </label>
                </div>
              </div>

              {/* Diagnostic Box from Live Test */}
              {modalTestResult && (
                <div className={`p-3.5 rounded-xl border text-xs space-y-1.5 ${
                  modalTestResult.ok 
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-900' 
                    : 'bg-red-50 border-red-200 text-red-900'
                }`}>
                  <div className="flex items-center gap-2 font-bold">
                    {modalTestResult.ok ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                    )}
                    <span>{modalTestResult.ok ? "Ulanish Muvaffaqiyatli O'rnatildi!" : "Ulanishda Xatolik Aniqlondi"}</span>
                  </div>
                  <p className="text-[11px] leading-relaxed opacity-90 pl-6">
                    {modalTestResult.message}
                  </p>
                  {modalTestResult.latencyMs !== undefined && (
                    <div className="pl-6 pt-1 text-[10px] font-mono opacity-80 flex items-center gap-3">
                      <span>Javob tezligi (Ping): {modalTestResult.latencyMs} ms</span>
                      {modalTestResult.syncCoefficient && (
                        <span>Ishlash koeffitsiyenti: {modalTestResult.syncCoefficient}%</span>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Modal Buttons */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-2 pt-3 border-t border-neutral-200">
                <button
                  type="button"
                  onClick={handleModalTestConnection}
                  disabled={isModalTesting || !configForm.server_url}
                  className="w-full sm:w-auto px-4 py-2 text-xs font-semibold text-neutral-800 bg-neutral-100 hover:bg-neutral-200 rounded-xl transition flex items-center justify-center gap-1.5 disabled:opacity-50"
                >
                  {isModalTesting ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Ulanish tekshirilmoqda...</span>
                    </>
                  ) : (
                    <>
                      <Activity className="w-3.5 h-3.5 text-neutral-600" />
                      <span>Aloqani Tekshirish (Test Ping)</span>
                    </>
                  )}
                </button>

                <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                  <button
                    type="button"
                    onClick={() => setShowConfigModal(false)}
                    className="px-4 py-2 text-xs font-semibold text-neutral-700 border border-neutral-300 rounded-xl hover:bg-neutral-50 transition"
                  >
                    Bekor qilish
                  </button>
                  <button
                    type="submit"
                    disabled={isSavingConfig}
                    className="flex items-center gap-1.5 px-5 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl transition shadow-xs disabled:opacity-50"
                  >
                    {isSavingConfig ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>Saqlanmoqda...</span>
                      </>
                    ) : (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        <span>Saqlash va Ulanish</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* SALESDOCTOR API V2 DOCUMENTATION & INTEGRATION GUIDE MODAL */}
      {showSalesDocDocModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-3xl max-h-[92vh] overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl space-y-5">
            {/* Modal Header */}
            <div className="flex items-start justify-between border-b border-neutral-200 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-blue-600 text-white rounded-xl shadow-xs">
                  <BookOpen className="w-6 h-6" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-bold text-neutral-900">
                      SalesDoctor API V2 Integratsiya Hujjatlari
                    </h2>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-blue-100 text-blue-800 border border-blue-200">
                      POST /api/v2
                    </span>
                  </div>
                  <p className="text-xs text-neutral-500 mt-0.5">
                    Rasmiy spetsifikatsiya: <a href="https://github.com/Clever91/salesdoc-api-doc" target="_blank" rel="noreferrer" className="text-blue-600 font-semibold underline">github.com/Clever91/salesdoc-api-doc</a>
                  </p>
                </div>
              </div>
              <button 
                onClick={() => setShowSalesDocDocModal(false)}
                className="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Content Body */}
            <div className="space-y-4 text-xs text-neutral-700 leading-relaxed">
              {/* Architecture Principles */}
              <div className="bg-neutral-50 p-4 rounded-xl border border-neutral-200 space-y-2">
                <h3 className="font-bold text-neutral-900 text-sm flex items-center gap-2">
                  <Server className="w-4 h-4 text-blue-600" />
                  1. SalesDoc API V2 Asosiy Prinsiplari
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs pt-1">
                  <div className="p-2.5 bg-white rounded-lg border border-neutral-200">
                    <span className="font-bold text-neutral-900 block">Yagona Endpoint (/api/v2)</span>
                    <span className="text-neutral-500 text-[11px]">Barcha amallar faqat <code className="font-mono text-blue-600">POST https://server.domain.uz/api/v2</code> manziliga yuboriladi. Barcha so'rovlar HTTP POST va JSON formatida.</span>
                  </div>
                  <div className="p-2.5 bg-white rounded-lg border border-neutral-200">
                    <span className="font-bold text-neutral-900 block">Metod Tanada Belgilanadi</span>
                    <span className="text-neutral-500 text-[11px]">URL o'zgarmaydi. Amaliyot turi so'rov tanasidagi <code className="font-mono text-neutral-800">"method": "..."</code> maydoni orqali aniqlanadi.</span>
                  </div>
                </div>
              </div>

              {/* Authentication Flow */}
              <div className="bg-blue-50/50 p-4 rounded-xl border border-blue-200 space-y-2">
                <h3 className="font-bold text-blue-950 text-sm flex items-center gap-2">
                  <Key className="w-4 h-4 text-blue-600" />
                  2. Autentifikatsiya (2 ta Ulanish Usuli)
                </h3>
                <div className="space-y-2 text-xs">
                  <div className="p-3 bg-white rounded-lg border border-blue-100">
                    <div className="flex items-center justify-between font-bold text-neutral-900">
                      <span>Usul 1: Login va Parol (Avtomatik token olish — Tavsiya etiladi)</span>
                      <span className="text-[10px] bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded font-mono">method: "login"</span>
                    </div>
                    <p className="text-neutral-600 text-[11px] mt-1">
                      Kabinetingiz login va parolini kiritasiz. Tizimimiz avtomatik <code className="font-mono text-blue-700">login</code> metodini chaqirib, <code className="font-mono text-blue-700">userId</code> va <code className="font-mono text-blue-700">token</code> oladi va ularni keshda saqlaydi.
                    </p>
                    <pre className="mt-2 p-2 bg-neutral-900 text-emerald-400 rounded text-[11px] font-mono overflow-x-auto">
{`{
  "method": "login",
  "auth": {
    "login": "sd_user",
    "password": "your_password"
  }
}`}
                    </pre>
                  </div>

                  <div className="p-3 bg-white rounded-lg border border-blue-100">
                    <div className="flex items-center justify-between font-bold text-neutral-900">
                      <span>Usul 2: To'g'ridan-to'g'ri API Token va User ID</span>
                      <span className="text-[10px] bg-blue-100 text-blue-800 px-2 py-0.5 rounded font-mono">auth: &#123; userId, token &#125;</span>
                    </div>
                    <p className="text-neutral-600 text-[11px] mt-1">
                      Agar SalesDoctor shaxsiy kabinetidan avvaldan token olgan bo'lsangiz, har bir so'rovda <code className="font-mono text-neutral-800">"auth": &#123; "userId": "d0_1", "token": "..." &#125;</code> uzatiladi.
                    </p>
                  </div>
                </div>
              </div>

              {/* Supported Sync Methods */}
              <div className="bg-neutral-50 p-4 rounded-xl border border-neutral-200 space-y-2">
                <h3 className="font-bold text-neutral-900 text-sm flex items-center gap-2">
                  <Database className="w-4 h-4 text-emerald-600" />
                  3. Integratsiya Qilinadigan SalesDoctor Metodlari
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  <div className="p-2.5 bg-white rounded-lg border border-neutral-200">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-neutral-900">getProduct & getStock</span>
                      <span className="text-[10px] text-blue-600 font-mono">Ombor qoldiqlari</span>
                    </div>
                    <p className="text-neutral-500 text-[11px] mt-1">
                      Mahsulotlar katalogi, 1C kodlari va ombordagi real zaxiralar. Qoldiq 0 bo'lsa, zaxira prognozi va boy berilgan foyda avtomatik hisoblanadi.
                    </p>
                  </div>

                  <div className="p-2.5 bg-white rounded-lg border border-neutral-200">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-neutral-900">getOrder</span>
                      <span className="text-[10px] text-emerald-600 font-mono">Savdo buyurtmalari</span>
                    </div>
                    <p className="text-neutral-500 text-[11px] mt-1">
                      Savdo agentlarining buyurtmalari, statuslar (1-Yangi, 2-Jo'natilgan, 3-Yetkazilgan, 4-Yopilgan), tovarlar ro'yxati va sotuv summasi.
                    </p>
                  </div>

                  <div className="p-2.5 bg-white rounded-lg border border-neutral-200">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-neutral-900">getBalance</span>
                      <span className="text-[10px] text-amber-600 font-mono">Nasiya & Qarzlar</span>
                    </div>
                    <p className="text-neutral-500 text-[11px] mt-1">
                      Mijozlar balansi. SalesDoctorda <strong>manfiy balans (-2,500,000 UZS)</strong> mijozning nasiya qarzini anglatadi. Tizimimiz uni qat'iy nazoratga oladi.
                    </p>
                  </div>

                  <div className="p-2.5 bg-white rounded-lg border border-neutral-200">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-neutral-900">getPayment</span>
                      <span className="text-[10px] text-purple-600 font-mono">Kassa tushumlari</span>
                    </div>
                    <p className="text-neutral-500 text-[11px] mt-1">
                      Agentlar yig'gan naqd pul va to'lovlar. Kassa moduliga kirim sifatida bog'lanadi va kunlik hisobotda aks etadi.
                    </p>
                  </div>
                </div>
              </div>

              {/* Contragent Server Support Note */}
              <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-amber-900 text-xs">
                <span className="font-bold">2 xil server rejimi (Ordinary & Contragent):</span>
                <p className="text-[11px] text-amber-800 mt-0.5">
                  SalesDoctor ikki rejimda ishlaydi: oddiy rejim (har bir savdo nuqtasi alohida mijoz) va kontragent rejimi (yuridik shaxs/kontragent pullarni, uning do'konlari esa buyurtmalarni ushlaydi). Adapterimiz ikkala rejimni avtomatik taniydi va hisoblaydi.
                </p>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 border-t border-neutral-200">
              <a
                href="https://github.com/Clever91/salesdoc-api-doc"
                target="_blank"
                rel="noreferrer"
                className="text-xs text-blue-600 font-semibold hover:underline flex items-center gap-1"
              >
                <span>GitHub omborida to'liq hujjatlarni o'qish (Clever91/salesdoc-api-doc) &rarr;</span>
              </a>

              <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                <button
                  type="button"
                  onClick={() => setShowSalesDocDocModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-neutral-700 border border-neutral-300 rounded-xl hover:bg-neutral-50 transition"
                >
                  Yopish
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowSalesDocDocModal(false);
                    const salesDocSystem = systems.find(s => s.provider_name === 'SALESDOC');
                    if (salesDocSystem) {
                      handleOpenConfig(salesDocSystem);
                    }
                  }}
                  className="px-4 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition shadow-xs flex items-center gap-1.5 cursor-pointer"
                >
                  <Settings className="w-3.5 h-3.5" />
                  <span>SalesDoctor-ni Sozlash</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
