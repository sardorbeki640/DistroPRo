import { 
  AuthUser, 
  CashDay, 
  CashTransaction, 
  AuditLog, 
  IntegrationRecord, 
  DailyOrderEntry, 
  Customer, 
  Agent, 
  CashDaySummary,
  DailyFileItem,
  DailyDossierData
} from '../types.ts';

const TOKEN_KEY = 'distro_finance_jwt_token';

/** Employees' Telegram accounts (set by the admin) and group video posters not assigned yet. */
export interface TelegramAccountsView {
  bot_username: string | null; checkin_group: boolean; polling_error?: string | null; last_poll_at?: string | null; poller_enabled?: boolean;
  last_update?: { at: string; chat: string; sender: string; kind: string; checkin_group: boolean; checkin_result: string | null } | null;
  senders: { id: string; name: string; username: string | null; last_at: string; videos: number }[];
  employees: { id: string; name: string; position: string; telegram_user_id: string | null; telegram_name: string | null; bot_linked: boolean }[];
}

/** Where violations are posted in Telegram: each work group's chat and an employee's own chat. */
export interface PenaltyPostsView {
  config: { enabled: boolean; since: string; groups: Record<string, string>; employees: Record<string, string> };
  rules_mode: boolean; bot_username: string | null;
  chats: { id: string; title: string; type: string }[];
  groups: { id: string; name: string }[];
  employees: { id: string; name: string; position: string; group: string | null }[];
}

/** The Obsidian vault Jarvis fills (a folder on the computer running the server). */
export interface ObsidianView { vault: string | null; default_vault: string; auto: boolean; last_sync: string | null; last_error: string | null; exists: boolean }

export const getStoredToken = (): string | null => {
  return localStorage.getItem(TOKEN_KEY);
};

export const setStoredToken = (token: string): void => {
  localStorage.setItem(TOKEN_KEY, token);
};

export const removeStoredToken = (): void => {
  localStorage.removeItem(TOKEN_KEY);
};

let databaseReadyWait: Promise<void> | null = null;

function waitForDatabaseReady(): Promise<void> {
  if (!databaseReadyWait) {
    const wait = (async () => {
      const deadline = Date.now() + 5 * 60_000;
      while (Date.now() < deadline) {
        try {
          const response = await fetch('/api/health', { cache: 'no-store' });
          const health = await response.json();
          if (health.status === 'ok') return;
        } catch { /* Render may still be waking the instance. */ }
        await new Promise(resolve => window.setTimeout(resolve, 5_000));
      }
      throw new Error('Server hali tayyor emas. Bir ozdan keyin sahifani yangilang.');
    })();
    let wrapped: Promise<void>;
    wrapped = wait.finally(() => { if (databaseReadyWait === wrapped) databaseReadyWait = null; });
    databaseReadyWait = wrapped;
  }
  return databaseReadyWait;
}

async function fetchApi<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = getStoredToken();
  const headers = new Headers(options.headers || {});

  headers.set('Content-Type', 'application/json');
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  let response: Response;
  try {
    response = await fetch(endpoint, { ...options, headers });
  } catch {
    throw new Error('Server bilan aloqa yo‘q (server qayta ishga tushayotgan bo‘lishi mumkin). Bir necha soniyadan keyin qayta urinib ko‘ring.');
  }

  let data: any;
  try {
    data = await response.json();
  } catch {
    throw new Error(`Server noto‘g‘ri javob qaytardi (${response.status}). Sahifani yangilang.`);
  }

  // Expired or missing session (e.g. server restarted, or another tab logged out): go back to the login screen.
  if (response.status === 401) {
    removeStoredToken();
    window.dispatchEvent(new Event('distro-auth-expired'));
    throw new Error('Sessiya tugagan. Qaytadan kiring.');
  }

  if (!response.ok || data.success === false) {
    const errorMsg = data.error || data.message || `Server xatoligi: ${response.status}`;
    if (response.status === 503 && String(errorMsg).includes('Tizim bazadagi ma’lumotlarni yuklamoqda')) {
      await waitForDatabaseReady();
      return fetchApi<T>(endpoint, options);
    }
    // The status lets a screen tell "no permission" (403) from a real failure.
    throw Object.assign(new Error(errorMsg), { status: response.status });
  }

  return data;
}

export type XlsxColumnSpec = { header: string; key: string; type?: 'text' | 'money' | 'number' | 'percent' | 'date'; width?: number; total?: boolean };
export type XlsxSheetSpec = {
  name: string;
  title: string;
  subtitle?: string[];
  columns: XlsxColumnSpec[];
  rows: Record<string, unknown>[];
  totalsLabel?: string;
  summary?: { label: string; value: unknown; type?: XlsxColumnSpec['type'] }[];
};

/** Downloads a file from an authenticated endpoint (a plain link or window.open would not carry the login token). */
async function downloadWithAuth(endpoint: string, fallbackName: string, init: RequestInit = {}): Promise<void> {
  const token = getStoredToken();
  const headers = new Headers(init.headers || {});
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init.body) headers.set('Content-Type', 'application/json');
  const response = await fetch(endpoint, { ...init, headers });
  if (response.status === 401) {
    removeStoredToken();
    window.dispatchEvent(new Event('distro-auth-expired'));
    throw new Error('Sessiya tugagan. Qaytadan kiring.');
  }
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.error || data?.message || `Server xatoligi: ${response.status}`);
  }
  const blob = await response.blob();
  const disposition = response.headers.get('Content-Disposition') || '';
  const match = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  const name = match ? decodeURIComponent(match[1]) : fallbackName;
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export type BotView = {
  id: string; name: string; is_active: boolean; bot_username: string | null; token_masked: string | null;
  chat_id: string; chat_title: string; topic_id: string; daily_report_hour: number; events: string[];
  sent: number; pending: number; failed: number; last_sent_at: string | null; last_error: string | null; created_at: string;
  personal: boolean; personal_events: string[]; remind_before_min: number; missed_after_min: number; morning_hour: number; linked_people: number; checkin_enabled: boolean; poll_error: string | null; last_poll_at: string | null; last_update?: TelegramAccountsView['last_update']; poller_enabled?: boolean; checkin_chat_id: string; checkin_chat_title: string;
};
export type StaffKey = { employee_id?: string; user_id?: string };
export type StaffTelegramPerson = { key: StaffKey; name: string; position: string; linked: boolean; blocked: boolean; chat_name: string | null; linked_at: string | null };
export type MyTelegram = {
  available: boolean; bot_username: string | null; linked: boolean; blocked: boolean; chat_name: string | null; linked_at: string | null;
  reminders: { type: string; label: string; hint: string; muted: boolean }[];
};

export type DistributionSystem = { id: string; provider: string; name: string; capabilities: { payments: boolean; visits: boolean; priceTypes: boolean; paymentTypes: boolean; history: boolean }; last_sync_at?: string | null };
export type JarvisItem ={ role: 'user' | 'assistant' | 'tool'; text: string; status?: string };
export type JarvisConversationView = { id: string; title: string; items: JarvisItem[]; client_actions?: { type: 'navigate'; page: string }[] };
export type JarvisInsight = { id: string; level: 'critical' | 'warning' | 'info'; title: string; detail: string; page?: string };
export type JarvisSettingsView = {
  configured: boolean; provider: string; model: string; base_url: string; has_key: boolean;
  providers: { id: string; name: string; default_model: string; base_url?: string; key_hint: string }[];
  claude_models: string[];
  voice: { provider: 'browser' | 'azure' | 'openai'; configured: boolean; region: string; gender: 'female' | 'male' };
  auto_briefing: boolean;
  last_briefing_date: string | null;
};

export const api = {
  jarvis: {
    settings: (): Promise<{ settings: JarvisSettingsView }> => fetchApi('/api/jarvis/settings'),
    saveSettings: (body: Partial<{ provider: string; api_key: string; model: string; base_url: string; voice_provider: string; voice_key: string; voice_region: string; voice_gender: string; auto_briefing: boolean }>): Promise<{ settings: JarvisSettingsView }> =>
      fetchApi('/api/jarvis/settings', { method: 'PUT', body: JSON.stringify(body) }),
    transcribe: (audio: string, language: 'uz' | 'ru'): Promise<{ text: string }> =>
      fetchApi('/api/jarvis/voice/transcribe', { method: 'POST', body: JSON.stringify({ audio, language }) }),
    /** MP3 of the text in the configured voice. */
    speak: async (text: string): Promise<Blob> => {
      const token = getStoredToken();
      const res = await fetch('/api/jarvis/voice/speak', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ text }) });
      if (!res.ok) { const d = await res.json().catch(() => null); throw new Error(d?.error || `Ovoz xatosi: ${res.status}`); }
      return res.blob();
    },
    conversations: (): Promise<{ conversations: { id: string; title: string; updated_at: string }[] }> => fetchApi('/api/jarvis/conversations'),
    conversation: (id: string): Promise<{ conversation: JarvisConversationView }> => fetchApi(`/api/jarvis/conversations/${id}`),
    deleteConversation: (id: string): Promise<any> => fetchApi(`/api/jarvis/conversations/${id}`, { method: 'DELETE' }),
    ask: (text: string, conversation_id?: string | null): Promise<{ conversation: JarvisConversationView }> =>
      fetchApi('/api/jarvis/ask', { method: 'POST', body: JSON.stringify({ text, conversation_id: conversation_id || null }) }),
    actions: (): Promise<{ actions: { id: string; created_at: string; user: string; tool: string; risk: string; summary: string; status: string; error?: string | null }[] }> => fetchApi('/api/jarvis/actions'),
    models: (): Promise<{ models: string[] }> => fetchApi('/api/jarvis/models'),
    insights: (fresh = false): Promise<{ insights: JarvisInsight[] }> => fetchApi(`/api/jarvis/insights${fresh ? '?fresh=1' : ''}`),
    memories: (): Promise<{ memories: { id: string; text: string; created_at: string }[] }> => fetchApi('/api/jarvis/memories'),
    deleteMemory: (id: string): Promise<any> => fetchApi(`/api/jarvis/memories/${id}`, { method: 'DELETE' }),
    obsidian: (): Promise<{ obsidian: ObsidianView }> => fetchApi('/api/jarvis/obsidian'),
    saveObsidian: (body: { vault?: string | null; auto?: boolean }): Promise<{ obsidian: ObsidianView }> => fetchApi('/api/jarvis/obsidian', { method: 'PUT', body: JSON.stringify(body) }),
    syncObsidian: (): Promise<{ obsidian: ObsidianView & { written: number; skipped: string[] } }> => fetchApi('/api/jarvis/obsidian/sync', { method: 'POST' })
  },
  /** A styled .xlsx of a table on screen (company name and time are added by the server). */
  downloadXlsx: (fileName: string, sheets: XlsxSheetSpec[]): Promise<void> =>
    downloadWithAuth('/api/exports/xlsx', fileName, { method: 'POST', body: JSON.stringify({ fileName, sheets }) }),
  downloadCashDayXlsx: (cashDayId: string): Promise<void> => downloadWithAuth(`/api/cash/day/${cashDayId}/export-excel`, 'Kassa.xlsx'),
  downloadExpensesXlsx: (filters: Record<string, string | undefined>): Promise<void> => {
    const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => !!v) as [string, string][]).toString();
    return downloadWithAuth(`/api/expenses/export${qs ? `?${qs}` : ''}`, 'Xarajatlar.xlsx');
  },
  saveCashRegistry: (id:string):Promise<any> => fetchApi('/api/cash/days/'+id+'/save',{method:'POST'}),
  /** After deleting by hand in SalesDoc the payments set to 0 in the cash register: checks they are gone. */
  verifyCashCancellations: (id: string): Promise<{ cancelled: number; still: string[]; message: string }> => fetchApi('/api/cash/days/' + id + '/verify-cancellations', { method: 'POST' }),
  refreshCashOrders: (id:string):Promise<any> => fetchApi('/api/cash/days/'+id+'/sync-orders',{method:'POST'}),
  getExchangeRate: (date?: string): Promise<{ rate: number | null; date: string; error?: string }> => fetchApi('/api/cash/exchange-rate' + (date ? '?date=' + encodeURIComponent(date) : '')),
  getSalesDocHistoryStatus: (provider?: string, integrationId?: string): Promise<{ configured: boolean; running?: boolean; history: any; system?: string }> => fetchApi(`/api/integrations/${encodeURIComponent(provider || 'active')}/history-status${integrationId ? `?integration_id=${encodeURIComponent(integrationId)}` : ''}`),
  /** The connected distribution system (any: SalesDoctor, Linko, …): its name and what it can do. */
  getActiveDistribution: (): Promise<{ active: DistributionSystem | null; systems: (DistributionSystem & { status: string; disabled: boolean })[] }> => fetchApi('/api/integrations/active'),
  getSalesDocPriceTypes: (provider = 'active', integrationId?: string): Promise<{ system?: string; priceTypes: { id: string; name: string; kind: 'sale' | 'purchase'; active: boolean; currency?: string | null }[]; selected: { sale: string[]; purchase: string }; used: { sale: string | null; purchase: string | null } }> => fetchApi(`/api/integrations/${encodeURIComponent(provider)}/price-types${integrationId ? `?integration_id=${encodeURIComponent(integrationId)}` : ''}`),
  getSalesDocPaymentTypes: (provider = 'active', integrationId?: string): Promise<{ system?: string; paymentTypes: { SD_id: string; name: string; active: boolean }[]; selected: { cash: string; terminal: string } }> => fetchApi(`/api/integrations/${encodeURIComponent(provider)}/payment-types${integrationId ? `?integration_id=${encodeURIComponent(integrationId)}` : ''}`),
  changePassword: (current_password: string, new_password: string): Promise<any> => fetchApi('/api/auth/change-password', { method: 'POST', body: JSON.stringify({ current_password, new_password }) }),
  getMyProfile: (): Promise<{ profile: { full_name: string; phone: string; email: string; login: string; position: string; last_login_at: string | null } }> => fetchApi('/api/staff/me/profile'),
  updateMyProfile: (body: { full_name?: string; phone?: string; email?: string; login?: string }): Promise<{ profile: { full_name: string; phone: string; email: string; login: string; position: string; last_login_at: string | null } }> =>
    fetchApi('/api/staff/me/profile', { method: 'PUT', body: JSON.stringify(body) }),
  updateStaffProfile: (employeeId: string, body: { full_name?: string; phone?: string; position?: string; email?: string; login?: string }): Promise<any> =>
    fetchApi(`/api/staff/${employeeId}/profile`, { method: 'PUT', body: JSON.stringify(body) }),
  getCompany: (): Promise<{ company: { name: string; tax_id: string; address: string; phone: string } }> => fetchApi('/api/system/company'),
  saveCompany: (body: { name: string; tax_id: string; address: string; phone: string }): Promise<any> => fetchApi('/api/system/company', { method: 'PUT', body: JSON.stringify(body) }),
  getBackups: (): Promise<{ backups: { name: string; kind: string; size_mb: number; created_at: string }[]; extra_copy_dir: string | null }> => fetchApi('/api/system/backups'),
  runBackup: (): Promise<{ file: string; copied_to: string | null; backups: { name: string; kind: string; size_mb: number; created_at: string }[] }> => fetchApi('/api/system/backups', { method: 'POST' }),

  // Staff accounts and personal cabinet
  getMyCabinet: (month?: string): Promise<any> => fetchApi('/api/staff/me/cabinet' + (month ? '?month=' + month : '')),
  getStaff: (): Promise<{ staff: any[]; roles: { id: string; name: string; description: string }[] }> => fetchApi('/api/staff'),
  createStaffAccount: (employeeId: string, login: string, role_id: string, extra: { password?: string; must_change?: boolean } = {}): Promise<{ user_id: string; login: string; temporary_password: string }> =>
    fetchApi(`/api/staff/${employeeId}/account`, { method: 'POST', body: JSON.stringify({ login, role_id, ...extra }) }),
  resetStaffPassword: (userId: string, extra: { password?: string; must_change?: boolean } = {}): Promise<{ login: string; temporary_password: string }> =>
    fetchApi(`/api/staff/users/${userId}/reset-password`, { method: 'POST', body: JSON.stringify(extra) }),
  setStaffStatus: (userId: string, status: 'ACTIVE' | 'INACTIVE'): Promise<any> => fetchApi(`/api/staff/users/${userId}/status`, { method: 'POST', body: JSON.stringify({ status }) }),
  setStaffRole: (userId: string, role_id: string): Promise<any> => fetchApi(`/api/staff/users/${userId}/role`, { method: 'POST', body: JSON.stringify({ role_id }) }),

  // CRM
  crm: {
    summary: (): Promise<{ summary: any; sees_all: boolean }> => fetchApi('/api/crm/summary'),
    users: (): Promise<{ users: { id: string; full_name: string; login: string }[] }> => fetchApi('/api/crm/users'),
    customers: (q: string): Promise<{ customers: any[] }> => fetchApi('/api/crm/customers?q=' + encodeURIComponent(q)),
    overview: (id: string): Promise<any> => fetchApi(`/api/crm/customers/${id}/overview`),
    updateCustomer: (id: string, patch: any): Promise<any> => fetchApi(`/api/crm/customers/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    tasks: (params: Record<string, string> = {}): Promise<{ tasks: any[] }> => fetchApi('/api/crm/tasks?' + new URLSearchParams(params).toString()),
    createTask: (task: any): Promise<{ task: any }> => fetchApi('/api/crm/tasks', { method: 'POST', body: JSON.stringify(task) }),
    updateTask: (id: string, patch: any): Promise<{ task: any }> => fetchApi(`/api/crm/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    deleteTask: (id: string): Promise<any> => fetchApi(`/api/crm/tasks/${id}`, { method: 'DELETE' }),
    activities: (params: Record<string, string> = {}): Promise<{ activities: any[] }> => fetchApi('/api/crm/activities?' + new URLSearchParams(params).toString()),
    logActivity: (a: any): Promise<{ activity: any }> => fetchApi('/api/crm/activities', { method: 'POST', body: JSON.stringify(a) }),
    stages: (): Promise<{ stages: any[] }> => fetchApi('/api/crm/stages'),
    saveStage: (s: any): Promise<any> => fetchApi('/api/crm/stages', { method: 'POST', body: JSON.stringify(s) }),
    deleteStage: (id: string): Promise<any> => fetchApi(`/api/crm/stages/${id}`, { method: 'DELETE' }),
    deals: (params: Record<string, string> = {}): Promise<{ deals: any[]; summary: any[] }> => fetchApi('/api/crm/deals?' + new URLSearchParams(params).toString()),
    createDeal: (d: any): Promise<{ deal: any }> => fetchApi('/api/crm/deals', { method: 'POST', body: JSON.stringify(d) }),
    updateDeal: (id: string, d: any): Promise<{ deal: any }> => fetchApi(`/api/crm/deals/${id}`, { method: 'PATCH', body: JSON.stringify(d) }),
    deleteDeal: (id: string): Promise<any> => fetchApi(`/api/crm/deals/${id}`, { method: 'DELETE' })
  },

  // Auth
  login: async (email: string, password: string): Promise<{ token: string; user: AuthUser }> => {
    const res = await fetchApi<{ token: string; user: AuthUser }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });
    setStoredToken(res.token);
    return res;
  },

  getMe: async (): Promise<{ user: AuthUser }> => {
    return fetchApi<{ user: AuthUser }>('/api/auth/me');
  },

  getUsers: async (): Promise<{ users: any[]; availableRoles: any[] }> => {
    return fetchApi('/api/auth/users');
  },

  assignRole: async (target_user_id: string, target_role_id: string, reason: string): Promise<any> => {
    return fetchApi('/api/auth/assign-role', {
      method: 'POST',
      body: JSON.stringify({ target_user_id, target_role_id, reason })
    });
  },

  // Dashboard
  getDashboardStats: async (): Promise<{ stats: any }> => {
    return fetchApi('/api/dashboard/stats');
  },

  // Cash Day & Core Endpoints
  getCashStatus: async (register_id?: string): Promise<{
    register: any;
    availableRegisters: any[];
    currentDay: CashDay | null;
    transactions: CashTransaction[];
  }> => {
    const query = register_id ? `?register_id=${encodeURIComponent(register_id)}` : '';
    return fetchApi(`/api/cash/status${query}`);
  },

  listCashDays: async (status?: 'OPEN' | 'CLOSED'): Promise<{ days: CashDay[] }> => {
    const q = status ? `?status=${status}` : '';
    return fetchApi(`/api/cash/days${q}`);
  },

  getCashDayById: async (id: string): Promise<{ cashDay: CashDay }> => {
    return fetchApi(`/api/cash/days/${id}`);
  },

  getCashSummary: async (cashDayId: string): Promise<{ summary: CashDaySummary }> => {
    return fetchApi(`/api/cash/days/${cashDayId}/summary`);
  },

  bots: {
    list: (): Promise<{ bots: BotView[]; events: { type: string; label: string; hint: string }[]; staff_reminders: { type: string; label: string; hint: string }[] }> => fetchApi('/api/system/bots'),
    save: (bot: { id?: string; name: string; bot_token?: string; chat_id: string; chat_title?: string; topic_id?: string; events: string[]; is_active?: boolean; daily_report_hour?: number; personal?: boolean; checkin_enabled?: boolean; personal_events?: string[]; remind_before_min?: number; missed_after_min?: number; morning_hour?: number; checkin_chat_id?: string; checkin_chat_title?: string }): Promise<{ bot: BotView }> =>
      fetchApi('/api/system/bots', { method: 'POST', body: JSON.stringify(bot) }),
    remove: (id: string): Promise<any> => fetchApi(`/api/system/bots/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    findChats: (ref: { id?: string; bot_token?: string }): Promise<{ bot: { username: string; name: string }; chats: { id: string; title: string; type: string }[] }> =>
      fetchApi('/api/system/bots/find-chats', { method: 'POST', body: JSON.stringify(ref) }),
    test: (ref: { id?: string; bot_token?: string; chat_id?: string; topic_id?: string }): Promise<{ message: string }> =>
      fetchApi('/api/system/bots/test', { method: 'POST', body: JSON.stringify(ref) }),
    reportNow: (id: string): Promise<{ message: string }> => fetchApi(`/api/system/bots/${encodeURIComponent(id)}/report-now`, { method: 'POST' }),
    staff: (): Promise<{ people: StaffTelegramPerson[]; bot: string | null }> => fetchApi('/api/system/bots/staff'),
    staffLink: (key: StaffKey): Promise<{ url: string; linked: boolean }> => fetchApi('/api/system/bots/staff/link', { method: 'POST', body: JSON.stringify(key) }),
    staffUnlink: (key: StaffKey): Promise<any> => fetchApi('/api/system/bots/staff/unlink', { method: 'POST', body: JSON.stringify(key) }),
    staffTest: (key: StaffKey): Promise<{ message: string }> => fetchApi('/api/system/bots/staff/test', { method: 'POST', body: JSON.stringify(key) })
  },
  /** The signed-in person's own Telegram for reminders. */
  myTelegram: {
    get: (): Promise<MyTelegram> => fetchApi('/api/me/telegram'),
    link: (): Promise<{ url: string }> => fetchApi('/api/me/telegram/link', { method: 'POST' }),
    mute: (muted: string[]): Promise<MyTelegram> => fetchApi('/api/me/telegram/mute', { method: 'POST', body: JSON.stringify({ muted }) }),
    unlink: (): Promise<MyTelegram> => fetchApi('/api/me/telegram/unlink', { method: 'POST' })
  },
  attendance: {
    me: (): Promise<any> => fetchApi('/api/attendance/me'),
    check: (body: { type: 'IN' | 'OUT'; descriptor: number[]; liveness_passed: boolean; liveness_steps?: string[]; lat?: number | null; lng?: number | null; accuracy_m?: number | null; photo?: string | null; device?: string | null }): Promise<{ status: string; message: string }> =>
      fetchApi('/api/attendance/check', { method: 'POST', body: JSON.stringify(body) }),
    settings: (): Promise<{ settings: any }> => fetchApi('/api/attendance/settings'),
    saveSettings: (s: any): Promise<{ settings: any }> => fetchApi('/api/attendance/settings', { method: 'PUT', body: JSON.stringify(s) }),
    profiles: (): Promise<{ profiles: { employee_id: string; samples: number; enrolled_at: string; consent_at: string; has_photo: boolean; source: 'CAMERA' | 'PHOTO' }[] }> => fetchApi('/api/attendance/profiles'),
    enroll: (employeeId: string, samples: number[][], consent: boolean, extra: { photo?: string | null; source?: 'CAMERA' | 'PHOTO' } = {}): Promise<{ message: string }> =>
      fetchApi(`/api/attendance/enroll/${encodeURIComponent(employeeId)}`, { method: 'POST', body: JSON.stringify({ samples, consent, ...extra }) }),
    zoneCheck: (gps: { lat: number | null; lng: number | null; accuracy_m: number | null }): Promise<{ ok: boolean; strict: boolean; distance_m: number | null; message: string }> =>
      fetchApi('/api/attendance/zone-check', { method: 'POST', body: JSON.stringify(gps) }),
    sheets: (): Promise<{ enabled: boolean; url: string; script: string; pending: number; failed: number; sent: number; last_sent_at: string | null; last_error: string | null }> => fetchApi('/api/attendance/sheets'),
    saveSheets: (s: { enabled: boolean; url: string }): Promise<any> => fetchApi('/api/attendance/sheets', { method: 'PUT', body: JSON.stringify(s) }),
    testSheets: (): Promise<{ message: string }> => fetchApi('/api/attendance/sheets/test', { method: 'POST' }),
    telegramAccounts: (): Promise<TelegramAccountsView> => fetchApi('/api/attendance/telegram-accounts'),
    assignTelegram: (employee_id: string, telegram_user_id: string | null): Promise<TelegramAccountsView & { counted: number }> =>
      fetchApi('/api/attendance/telegram-accounts', { method: 'PUT', body: JSON.stringify({ employee_id, telegram_user_id }) }),
    penaltyPosts: (): Promise<PenaltyPostsView> => fetchApi('/api/attendance/penalty-posts'),
    savePenaltyPosts: (body: { enabled: boolean; groups: Record<string, string>; employees: Record<string, string> }): Promise<PenaltyPostsView> =>
      fetchApi('/api/attendance/penalty-posts', { method: 'PUT', body: JSON.stringify(body) }),
    /** The employee's reference portrait (Face ID profile). */
    profilePhotoUrl: async (employeeId: string): Promise<string> => {
      const token = getStoredToken();
      const res = await fetch(`/api/attendance/profiles/${encodeURIComponent(employeeId)}/photo`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!res.ok) throw new Error('Rasm yuklanmadi');
      return URL.createObjectURL(await res.blob());
    },
    removeProfile: (employeeId: string): Promise<{ message: string }> => fetchApi(`/api/attendance/enroll/${encodeURIComponent(employeeId)}`, { method: 'DELETE' }),
    report: (from: string, to: string, employeeId?: string): Promise<{ rows: any[]; from: string; to: string; mode: string }> =>
      fetchApi(`/api/attendance/report?from=${from}&to=${to}${employeeId ? `&employee_id=${encodeURIComponent(employeeId)}` : ''}`),
    events: (q: { from?: string; to?: string; employee_id?: string; status?: string }): Promise<{ events: any[] }> =>
      fetchApi(`/api/attendance/events?${new URLSearchParams(Object.entries(q).filter(([, v]) => !!v) as [string, string][]).toString()}`),
    review: (id: string, decision: 'ACCEPTED' | 'REJECTED', reason: string): Promise<any> =>
      fetchApi(`/api/attendance/events/${encodeURIComponent(id)}/review`, { method: 'POST', body: JSON.stringify({ decision, reason }) }),
    excuse: (employee_id: string, date: string, excused: boolean, reason: string): Promise<any> =>
      fetchApi('/api/attendance/excuse', { method: 'POST', body: JSON.stringify({ employee_id, date, excused, reason }) }),
    violations: (month: string): Promise<{ violations: any[]; month: string }> => fetchApi(`/api/attendance/violations?month=${month}`),
    addViolation: (v: { employee_id: string; date: string; type: string; note: string }): Promise<any> =>
      fetchApi('/api/attendance/violations', { method: 'POST', body: JSON.stringify(v) }),
    cancelViolation: (id: string, reason: string): Promise<any> =>
      fetchApi(`/api/attendance/violations/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) }),
    syncVisits: (from: string, to: string): Promise<{ message: string }> => fetchApi('/api/attendance/sync-visits', { method: 'POST', body: JSON.stringify({ from, to }) }),
    agents: (): Promise<{ agents: { id: string; name: string; code: string }[] }> => fetchApi('/api/attendance/agents'),
    /** The selfie of a check, fetched with the login token (an <img src> could not send it). */
    photoUrl: async (id: string): Promise<string> => {
      const token = getStoredToken();
      const res = await fetch(`/api/attendance/events/${encodeURIComponent(id)}/photo`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!res.ok) throw new Error('Rasm yuklanmadi');
      return URL.createObjectURL(await res.blob());
    }
  },
  /** Inkassa: cash handed to the bank (not an expense; only the bank's commission is). */
  recordBankDeposit: (cashDayId: string, data: { amount: number; bank_name: string; receipt_no?: string; fee?: number; note?: string }): Promise<{ message: string; transaction: any }> =>
    fetchApi(`/api/cash/days/${encodeURIComponent(cashDayId)}/bank-deposits`, { method: 'POST', body: JSON.stringify(data) }),
  getBankDeposits: (cashDayId?: string): Promise<{ deposits: any[] }> =>
    fetchApi(`/api/cash/bank-deposits${cashDayId ? `?cash_day_id=${encodeURIComponent(cashDayId)}` : ''}`),
  deleteBankDeposit: (id: string): Promise<{ message: string }> => fetchApi(`/api/cash/bank-deposits/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  /** Deletes an open cash day with its entries (refused if payments were already sent to SalesDoc). */
  deleteCashDay: (id: string, reason: string): Promise<{ message: string }> =>
    fetchApi(`/api/cash/daily-files/${encodeURIComponent(id)}`, { method: 'DELETE', body: JSON.stringify({ reason }) }),
  getDailyFilesList: async (): Promise<{ files: DailyFileItem[] }> => {
    return fetchApi('/api/cash/daily-files');
  },

  getDailyDossier: async (cashDayId: string): Promise<{ dossier: DailyDossierData }> => {
    return fetchApi(`/api/cash/daily-files/${cashDayId}`);
  },

  reopenDailyFile: async (cashDayId: string, reason: string): Promise<{ message: string; cashDay: CashDay }> => {
    return fetchApi(`/api/cash/daily-files/${cashDayId}/reopen`, {
      method: 'POST',
      body: JSON.stringify({ reason })
    });
  },

  openCashDay: async (data: {
    register_id: string;
    date: string;
    opening_balance?: number;
    manual_opening_adjustment?: number;
  }): Promise<{ message: string; cashDay: CashDay }> => {
    return fetchApi('/api/cash/days/open', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  closeCashDay: async (data: {
    cash_day_id: string;
    actual_cash: number;
    reason: string;
    notes?: string;
  }): Promise<{ message: string; cashDay: CashDay }> => {
    return fetchApi(`/api/cash/days/${data.cash_day_id}/close`, {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  createTransaction: async (data: {
    cash_day_id: string;
    transaction_type: string;
    amount: number;
    payment_method: string;
    customer_id?: string | null;
    employee_id?: string | null;
    agent_id?: string | null;
    order_number?: string | null;
    order_id?: string | null;
    source_transaction_id?: string | null;
    external_reference?: string | null;
    description: string;
    correction_reason?: string;
  }): Promise<{ message: string; transaction: CashTransaction }> => {
    return fetchApi(`/api/cash/days/${data.cash_day_id}/transactions`, {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  getFilteredTransactions: async (cashDayId: string, filters?: {
    agent_id?: string;
    customer_id?: string;
    transaction_type?: string;
    payment_method?: string;
    search?: string;
  }): Promise<{ transactions: CashTransaction[] }> => {
    const params = new URLSearchParams();
    if (filters?.agent_id) params.set('agent_id', filters.agent_id);
    if (filters?.customer_id) params.set('customer_id', filters.customer_id);
    if (filters?.transaction_type) params.set('transaction_type', filters.transaction_type);
    if (filters?.payment_method) params.set('payment_method', filters.payment_method);
    if (filters?.search) params.set('search', filters.search);
    const query = params.toString() ? `?${params.toString()}` : '';
    return fetchApi(`/api/cash/days/${cashDayId}/transactions${query}`);
  },

  createDailyOrder: async (data: {
    cash_day_id: string;
    order_number?: string;
    order_date?: string;
    agent_id?: string | null;
    customer_id: string;
    sale_amount: number;
    cash_payment: number;
    terminal_payment: number;
    click_payment: number;
    credit_amount: number;
    carried_forward_amount?: number;
    note?: string;
  }): Promise<{ message: string; order: DailyOrderEntry; remaining_amount: number; transactions: CashTransaction[] }> => {
    return fetchApi(`/api/cash/days/${data.cash_day_id}/orders`, {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  getDailyOrders: async (cashDayId: string, filters?: {
    agent_id?: string;
    customer_id?: string;
    search?: string;
  }): Promise<{ orders: DailyOrderEntry[] }> => {
    const params = new URLSearchParams();
    if (filters?.agent_id) params.set('agent_id', filters.agent_id);
    if (filters?.customer_id) params.set('customer_id', filters.customer_id);
    if (filters?.search) params.set('search', filters.search);
    const query = params.toString() ? `?${params.toString()}` : '';
    return fetchApi(`/api/cash/days/${cashDayId}/orders${query}`);
  },

  recordCreditCollection: async (data: {
    cash_day_id: string;
    customer_id: string;
    agent_id?: string | null;
    amount: number;
    payment_method: string;
    external_reference?: string | null;
    description: string;
  }): Promise<{ message: string; transaction: CashTransaction }> => {
    return fetchApi(`/api/cash/days/${data.cash_day_id}/collections`, {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  recordReturn: async (data: {
    cash_day_id: string;
    customer_id: string;
    agent_id?: string | null;
    order_reference?: string | null;
    amount: number;
    date?: string;
    reason: string;
    payment_impact: 'CASH_REFUND' | 'BALANCE_CREDIT';
    external_reference?: string | null;
  }): Promise<{ message: string; returnRecord: any; transaction: CashTransaction }> => {
    return fetchApi(`/api/cash/days/${data.cash_day_id}/returns`, {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  recordCarriedForward: async (data: {
    cash_day_id: string;
    customer_id: string;
    agent_id?: string | null;
    amount: number;
    source_transaction_id?: string | null;
    description: string;
  }): Promise<{ message: string; transaction: CashTransaction }> => {
    return fetchApi(`/api/cash/days/${data.cash_day_id}/carried-forward`, {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  correctTransaction: async (transactionId: string, data: {
    amount?: number;
    payment_method?: string;
    description?: string;
    reason: string;
  }): Promise<{ message: string; transaction: CashTransaction }> => {
    return fetchApi(`/api/cash/transactions/${transactionId}`, {
      method: 'PATCH',
      body: JSON.stringify(data)
    });
  },

  getCustomerHistory: async (customerId: string): Promise<any> => {
    return fetchApi(`/api/cash/customers/${customerId}/history`);
  },

  getAgents: async (): Promise<{ agents: Agent[] }> => {
    return fetchApi('/api/cash/agents');
  },

  getPendingCarriedForwards: async (date?: string): Promise<{ pending: any[] }> => {
    const q = date ? `?date=${encodeURIComponent(date)}` : '';
    return fetchApi(`/api/cash/carried-forward/pending${q}`);
  },

  // Audit
  getAuditLogs: async (filters?: { entity?: string; action?: string; limit?: number }): Promise<{ logs: AuditLog[] }> => {
    const params = new URLSearchParams();
    if (filters?.entity) params.set('entity', filters.entity);
    if (filters?.action) params.set('action', filters.action);
    if (filters?.limit) params.set('limit', filters.limit.toString());
    const query = params.toString() ? `?${params.toString()}` : '';
    return fetchApi(`/api/audit/logs${query}`);
  },

  // Phase 3 — Expenses / Rasxod
  getExpenses: async (filters?: {
    date?: string;
    from_date?: string;
    to_date?: string;
    category_id?: string;
    employee_id?: string;
    payment_method?: string;
    status?: string;
    search?: string;
  }): Promise<{ expenses: any[]; total: number; total_amount: number }> => {
    const params = new URLSearchParams();
    if (filters?.date) params.set('date', filters.date);
    if (filters?.from_date) params.set('from_date', filters.from_date);
    if (filters?.to_date) params.set('to_date', filters.to_date);
    if (filters?.category_id) params.set('category_id', filters.category_id);
    if (filters?.employee_id) params.set('employee_id', filters.employee_id);
    if (filters?.payment_method) params.set('payment_method', filters.payment_method);
    if (filters?.status) params.set('status', filters.status);
    if (filters?.search) params.set('search', filters.search);
    const q = params.toString() ? `?${params.toString()}` : '';
    return fetchApi(`/api/expenses${q}`);
  },

  getExpensePreview: async (params: {
    category_id: string;
    amount: number;
    date?: string;
    is_company_expense?: boolean;
    employee_ids?: string[];
    payment_method?: string;
    comment?: string;
  }): Promise<{ preview: any }> => {
    const q = new URLSearchParams();
    q.set('category_id', params.category_id);
    q.set('amount', params.amount.toString());
    if (params.date) q.set('date', params.date);
    if (params.is_company_expense !== undefined) q.set('is_company_expense', String(params.is_company_expense));
    if (params.employee_ids && params.employee_ids.length > 0) {
      q.set('employee_ids', JSON.stringify(params.employee_ids));
    }
    if (params.payment_method) q.set('payment_method', params.payment_method);
    if (params.comment) q.set('comment', params.comment);
    return fetchApi(`/api/expenses/preview?${q.toString()}`);
  },

  getExpenseCategories: async (): Promise<{ categories: any[] }> => {
    return fetchApi('/api/expenses/categories');
  },

  createExpenseCategory: async (data: { name: string; description?: string; monthly_limit: number }): Promise<{ category: any }> => {
    return fetchApi('/api/expenses/categories', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  updateExpenseCategory: async (id: string, data: { name?: string; description?: string; monthly_limit?: number; is_active?: boolean }): Promise<{ category: any }> => {
    return fetchApi(`/api/expenses/categories/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    });
  },

  createExpense: async (data: {
    date: string;
    category_id: string;
    amount: number;
    payment_method: string;
    comment: string;
    is_company_expense: boolean;
    employee_ids?: string[];
    allocations?: any[];
    confirm_immediately?: boolean;
  }): Promise<{ expense: any; allocations: any[] }> => {
    return fetchApi('/api/expenses', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  getExpenseDetail: async (id: string): Promise<{ detail: any }> => {
    return fetchApi(`/api/expenses/${id}`);
  },

  confirmExpense: async (id: string, comment?: string): Promise<{ expense: any; allocations: any[] }> => {
    return fetchApi(`/api/expenses/${id}/confirm`, {
      method: 'POST',
      body: JSON.stringify({ comment })
    });
  },

  cancelExpense: async (id: string, reason: string): Promise<{ expense: any }> => {
    return fetchApi(`/api/expenses/${id}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason })
    });
  },

  correctExpense: async (id: string, data: { amount?: number; payment_method?: string; comment?: string; category_id?: string; reason: string }): Promise<{ expense: any }> => {
    return fetchApi(`/api/expenses/${id}/correct`, {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  getDailyExpenseReport: async (date?: string): Promise<{ report: any }> => {
    const q = date ? `?date=${encodeURIComponent(date)}` : '';
    return fetchApi(`/api/expenses/reports/daily${q}`);
  },

  getMonthlyExpenseReport: async (month?: string): Promise<{ report: any }> => {
    const q = month ? `?month=${encodeURIComponent(month)}` : '';
    return fetchApi(`/api/expenses/reports/monthly${q}`);
  },

  getEmployeeExpenseSummary: async (month?: string): Promise<{ summary: any[] }> => {
    const q = month ? `?month=${encodeURIComponent(month)}` : '';
    return fetchApi(`/api/expenses/reports/employee-summary${q}`);
  },

  getEmployeeExpenseProfile: async (employeeId: string, month?: string): Promise<{ profile: any }> => {
    const q = month ? `?month=${encodeURIComponent(month)}` : '';
    return fetchApi(`/api/expenses/employees/${employeeId}/profile${q}`);
  },

  setEmployeeDailyLimit: async (employeeId: string, data: { daily_limit: number; effective_from?: string; effective_to?: string | null }): Promise<{ limit: any }> => {
    return fetchApi(`/api/expenses/employees/${employeeId}/daily-limit`, {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  exportExpensesCSVUrl: (filters?: {
    date?: string;
    from_date?: string;
    to_date?: string;
    category_id?: string;
    employee_id?: string;
    payment_method?: string;
    status?: string;
    search?: string;
  }): string => {
    const params = new URLSearchParams();
    if (filters?.date) params.set('date', filters.date);
    if (filters?.from_date) params.set('from_date', filters.from_date);
    if (filters?.to_date) params.set('to_date', filters.to_date);
    if (filters?.category_id) params.set('category_id', filters.category_id);
    if (filters?.employee_id) params.set('employee_id', filters.employee_id);
    if (filters?.payment_method) params.set('payment_method', filters.payment_method);
    if (filters?.status) params.set('status', filters.status);
    if (filters?.search) params.set('search', filters.search);
    const q = params.toString() ? `?${params.toString()}` : '';
    return `/api/expenses/export${q}`;
  },

  // Customers & Customer Balances
  getCustomers: async (params?: { agent_id?: string; territory_id?: string; search?: string }): Promise<{ customers: any[] }> => {
    const q = new URLSearchParams();
    if (params?.agent_id) q.set('agent_id', params.agent_id);
    if (params?.territory_id) q.set('territory_id', params.territory_id);
    if (params?.search) q.set('search', params.search);
    const qs = q.toString() ? `?${q.toString()}` : '';
    return fetchApi(`/api/customers${qs}`);
  },

  createCustomer: async (data: any): Promise<{ customer: any }> => {
    return fetchApi('/api/customers', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  getCustomerById: async (id: string): Promise<any> => {
    return fetchApi(`/api/customers/${id}`);
  },

  getCustomerStatement: async (id: string, from_date?: string, to_date?: string): Promise<{ statement: any }> => {
    const q = new URLSearchParams();
    if (from_date) q.set('from_date', from_date);
    if (to_date) q.set('to_date', to_date);
    const qs = q.toString() ? `?${q.toString()}` : '';
    return fetchApi(`/api/customers/${id}/statement${qs}`);
  },

  recordCustomerPayment: async (data: {
    customer_id: string;
    amount: number;
    payment_method: string;
    date?: string;
    agent_id?: string | null;
    cash_day_id?: string | null;
    comment?: string;
  }): Promise<any> => {
    return fetchApi('/api/customers/payments', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  recordCustomerAdjustment: async (data: {
    customer_id: string;
    amount: number;
    direction: 'INCREASE_DEBT' | 'DECREASE_DEBT';
    date?: string;
    reason: string;
  }): Promise<any> => {
    return fetchApi('/api/customers/adjustments', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  recordCustomerCarriedForward: async (data: {
    customer_id: string;
    source_date: string;
    target_date: string;
    amount: number;
    comment?: string;
  }): Promise<any> => {
    return fetchApi('/api/customers/carried-forward', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  getAgentDebtSummary: async (params?: { agent_id?: string; from_date?: string; to_date?: string }): Promise<{ summary: any[] }> => {
    const q = new URLSearchParams();
    if (params?.agent_id) q.set('agent_id', params.agent_id);
    if (params?.from_date) q.set('from_date', params.from_date);
    if (params?.to_date) q.set('to_date', params.to_date);
    const qs = q.toString() ? `?${q.toString()}` : '';
    return fetchApi(`/api/customers/reports/agents${qs}`);
  },

  getTerritoryDebtSummary: async (params?: { territory_id?: string; from_date?: string; to_date?: string }): Promise<{ summary: any[] }> => {
    const q = new URLSearchParams();
    if (params?.territory_id) q.set('territory_id', params.territory_id);
    if (params?.from_date) q.set('from_date', params.from_date);
    if (params?.to_date) q.set('to_date', params.to_date);
    const qs = q.toString() ? `?${q.toString()}` : '';
    return fetchApi(`/api/customers/reports/territories${qs}`);
  },

  // Salaries & Piecework
  getEmployees: async (): Promise<{ employees: any[] }> => {
    return fetchApi('/api/salaries/employees');
  },

  createEmployee: async (data: {
    full_name: string;
    position: string;
    phone: string;
    salary_type?: 'FIXED' | 'PIECEWORK' | 'HYBRID';
    base_salary?: number;
    daily_expense_limit?: number;
    status?: 'ACTIVE' | 'INACTIVE';
    is_agent?: boolean;
    agent_code?: string;
    commission_rate?: number;
    territory_id?: string;
    pay_components?: any[];
  }): Promise<{ success: boolean; message: string; employee: any }> => {
    return fetchApi('/api/salaries/employees', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  updateEmployee: async (id: string, data: {
    full_name?: string;
    position?: string;
    phone?: string;
    salary_type?: 'FIXED' | 'PIECEWORK' | 'HYBRID';
    base_salary?: number;
    daily_expense_limit?: number;
    status?: 'ACTIVE' | 'INACTIVE';
    is_agent?: boolean;
    agent_code?: string;
    commission_rate?: number;
    territory_id?: string;
    pay_components?: any[];
  }): Promise<{ success: boolean; message: string; employee: any }> => {
    return fetchApi(`/api/salaries/employees/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    });
  },

  deleteEmployee: async (id: string): Promise<{ success: boolean; message: string; deleted: boolean }> => {
    return fetchApi(`/api/salaries/employees/${id}`, {
      method: 'DELETE'
    });
  },

  getSalaries: async (period?: string): Promise<{ salaries: any[] }> => {
    const qs = period ? `?period=${encodeURIComponent(period)}` : '';
    return fetchApi(`/api/salaries${qs}`);
  },

  calculateSalary: async (data: { employee_id: string; period_month: string }): Promise<{ breakdown: any }> => {
    return fetchApi('/api/salaries/calculate', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  generateSalary: async (data: { employee_id: string; period_month: string }): Promise<{ salary: any }> => {
    return fetchApi('/api/salaries/generate', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  generateSalariesBulk: async (data: { employee_ids: string[]; period_month: string }): Promise<{ results: { employee_id: string; salary?: any; error?: string; skipped?: boolean }[] }> => {
    return fetchApi('/api/salaries/generate-bulk', { method: 'POST', body: JSON.stringify(data) });
  },

  approveSalary: async (salaryId: string): Promise<{ salary: any }> => {
    return fetchApi(`/api/salaries/${salaryId}/approve`, {
      method: 'POST'
    });
  },

  paySalary: async (data: { salary_id: string; cash_day_id?: string; payment_method: 'CASH' | 'BANK_TRANSFER' }): Promise<any> => {
    return fetchApi('/api/salaries/pay', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  /** Days (kunbay), trips, pieces or hours (ishbay) for any employee; without rate the one in the pay scheme is used. */
  recordWork: (data: { employee_id: string; unit_type: 'DAY' | 'TRIP' | 'PIECE' | 'HOUR' | 'OTHER'; units: number; rate?: number; date?: string; note?: string; zone_name?: string }): Promise<any> =>
    fetchApi('/api/salaries/work', { method: 'POST', body: JSON.stringify(data) }),
  getWorkEntries: (month: string, employeeId?: string): Promise<{ entries: any[] }> =>
    fetchApi(`/api/salaries/work?month=${encodeURIComponent(month)}${employeeId ? `&employee_id=${encodeURIComponent(employeeId)}` : ''}`),
  deleteWorkEntry: (id: string): Promise<any> => fetchApi(`/api/salaries/work/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  getPayOptions: (): Promise<{ agents: { id: string; name: string; code: string }[]; expeditors: string[] }> => fetchApi('/api/salaries/pay-options'),
  recordPiecework: async (data: { employee_id: string; units_completed: number; rate_applied: number; date?: string }): Promise<any> => {
    return fetchApi('/api/salaries/piecework', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  recordTripPiecework: async (data: {
    employee_id: string;
    zone_name: string;
    rate_per_trip: number;
    trips_count?: number;
    date?: string;
    description?: string;
  }): Promise<any> => {
    return fetchApi('/api/salaries/trip-piecework', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  getEmployeePersonalCabinet: async (employeeId: string, month?: string): Promise<any> => {
    const q = month ? `?month=${encodeURIComponent(month)}` : '';
    return fetchApi(`/api/salaries/cabinet/${employeeId}${q}`);
  },

  // Overdue Debts and Telegram Alert
  getOverdueDebtsSummary: async (minDays = 10): Promise<any> => {
    return fetchApi(`/api/customers/overdue-debts-summary?min_days=${minDays}`);
  },

  dispatchOverdueDebtsAlert: async (minDays = 10): Promise<any> => {
    return fetchApi('/api/customers/dispatch-overdue-debts-alert', {
      method: 'POST',
      body: JSON.stringify({ min_days: minDays })
    });
  },

  // Cash Day Excel & Distribution Methods
  syncDistributionOrders: async (cashDayId: string): Promise<any> => {
    return fetchApi(`/api/cash/day/${cashDayId}/sync-distribution-orders`, {
      method: 'POST'
    });
  },

  getReturnsReconciliation: async (cashDayId: string): Promise<any> => {
    return fetchApi(`/api/cash/day/${cashDayId}/returns-reconciliation`);
  },

  exportCashDayExcelUrl: (cashDayId: string): string => {
    return `/api/cash/day/${cashDayId}/export-excel`;
  },

  importCashDayExcel: async (cashDayId: string, rows: any[]): Promise<any> => {
    return fetchApi(`/api/cash/day/${cashDayId}/import-excel`, {
      method: 'POST',
      body: JSON.stringify({ rows })
    });
  },

  syncPaymentToDistribution: async (transactionId: string): Promise<any> => {
    return fetchApi('/api/cash/sync-payment-to-distribution', {
      method: 'POST',
      body: JSON.stringify({ transaction_id: transactionId })
    });
  },

  // Reports & Analytics
  getProfitAndLossReport: async (from_date?: string, to_date?: string, integration_id?: string): Promise<{ report: any }> => {
    const q = new URLSearchParams();
    if (from_date) q.set('from_date', from_date);
    if (to_date) q.set('to_date', to_date);
    if (integration_id) q.set('integration_id', integration_id);
    const qs = q.toString() ? `?${q.toString()}` : '';
    return fetchApi(`/api/reports/pnl${qs}`);
  },

  getGrossProfitReport: async (params?: { from_date?: string; to_date?: string; group_by?: 'AGENT' | 'TERRITORY' | 'CUSTOMER'; integration_id?: string }): Promise<{ rows: any[] }> => {
    const q = new URLSearchParams();
    if (params?.from_date) q.set('from_date', params.from_date);
    if (params?.to_date) q.set('to_date', params.to_date);
    if (params?.group_by) q.set('group_by', params.group_by);
    if (params?.integration_id) q.set('integration_id', params.integration_id);
    const qs = q.toString() ? `?${q.toString()}` : '';
    return fetchApi(`/api/reports/gross-profit${qs}`);
  },

  getCompareReport: (a: { from: string; to: string }, b: { from: string; to: string }, integrationId?: string | null): Promise<any> => {
    const q = new URLSearchParams({ a_from: a.from, a_to: a.to, b_from: b.from, b_to: b.to });
    if (integrationId !== undefined) q.set('integration_id', integrationId || 'all');
    return fetchApi('/api/reports/compare?' + q.toString());
  },
  /** Sales teams: product categories of each team, and the person of each agent profile in it. */
  getTeams: (): Promise<{ teams: { id: string; name: string; categories: string[]; members: Record<string, string>; member_employees?: Record<string, string> }[]; categories: { name: string; team_id: string | null }[]; agents: { id: string; name: string; code: string }[]; employees: { id: string; name: string; position: string }[] }> =>
    fetchApi('/api/reports/teams'),
  saveTeams: (teams: { id?: string; name: string; categories: string[]; members: Record<string, string>; member_employees?: Record<string, string> }[]): Promise<{ created?: string[] }> =>
    fetchApi('/api/reports/teams', { method: 'PUT', body: JSON.stringify({ teams }) }),
  /** The signed-in agent's own results (this month against last month) and the current AI strategy. */
  getMyPerformance: (): Promise<{ agent: { id: string; name: string } | null; data?: any; strategy?: any }> => fetchApi('/api/staff/me/performance'),
  /** A growth strategy for one agent, written by the company's AI from the agent's numbers. */
  getAgentStrategy: (agentId: string, a: { from: string; to: string }, b: { from: string; to: string }, force = false, integrationId?: string | null): Promise<{ strategy: any; model: string; generated_at: string; cached: boolean }> =>
    fetchApi(`/api/reports/compare/agent/${encodeURIComponent(agentId)}/strategy`, { method: 'POST', body: JSON.stringify({ a, b, force, ...(integrationId !== undefined ? { integration_id: integrationId || 'all' } : {}) }) }),
  /** One agent of the comparison in depth. */
  getCompareAgent: (agentId: string, a: { from: string; to: string }, b: { from: string; to: string }, integrationId?: string | null): Promise<any> => {
    const q = new URLSearchParams({ a_from: a.from, a_to: a.to, b_from: b.from, b_to: b.to });
    if (integrationId !== undefined) q.set('integration_id', integrationId || 'all');
    return fetchApi(`/api/reports/compare/agent/${encodeURIComponent(agentId)}?` + q.toString());
  },

  getAgingReport: async (as_of_date?: string): Promise<{ as_of_date: string; rows: any[] }> => {
    const qs = as_of_date ? `?as_of_date=${encodeURIComponent(as_of_date)}` : '';
    return fetchApi(`/api/reports/aging${qs}`);
  },

  getNotifications: async (): Promise<{ notifications: any[] }> => {
    return fetchApi('/api/reports/notifications');
  },

  // Summary of the connected distribution system (SalesDoctor, Linko, …)
  getSalesDoctorSummary: async (): Promise<{
    system?: string | null;
    connected: boolean;
    integration: any;
    stats: {
      totalOrdersCount: number;
      totalSalesAmount: number;
      totalPaymentsCount: number;
      totalPaymentsAmount: number;
      customersCount: number;
      lastSyncAt: string | null;
    };
    recentOrders: any[];
    recentPayments: any[];
    customers: any[];
  }> => {
    return fetchApi('/api/integrations/active/summary');
  },

  // Dedicated Balance Sheet
  getBalanceSheet: async (as_of_date?: string): Promise<{ balance: any }> => {
    const qs = as_of_date ? `?as_of_date=${encodeURIComponent(as_of_date)}` : '';
    return fetchApi(`/api/reports/balance-sheet${qs}`);
  },

  // Kassa Reestri (Daily Registry with Date Range Filter & Top KPIs)
  getRegistry: async (filters: {
    from_date?: string;
    to_date?: string;
    agent_id?: string;
    customer_id?: string;
    search?: string;
    integration_id?: string;
  } = {}): Promise<{
    total_sales: number;
    total_inflow: number;
    total_debt: number;
    totals: any;
    items: any[];
  }> => {
    const q = new URLSearchParams();
    if (filters.from_date) q.set('from_date', filters.from_date);
    if (filters.to_date) q.set('to_date', filters.to_date);
    if (filters.agent_id) q.set('agent_id', filters.agent_id);
    if (filters.customer_id) q.set('customer_id', filters.customer_id);
    if (filters.search) q.set('search', filters.search);
    if (filters.integration_id) q.set('integration_id', filters.integration_id);
    const qs = q.toString() ? `?${q.toString()}` : '';
    return fetchApi(`/api/cash/registry${qs}`);
  },

  createRegistryOrder: async (order: any): Promise<any> => {
    return fetchApi('/api/cash/registry/orders', {
      method: 'POST',
      body: JSON.stringify(order)
    });
  },

  updateRegistryOrder: async (id: string, order: any): Promise<any> => {
    return fetchApi(`/api/cash/registry/orders/${id}`, {
      method: 'PUT',
      body: JSON.stringify(order)
    });
  },

  deleteRegistryOrder: async (id: string): Promise<any> => {
    return fetchApi(`/api/cash/registry/orders/${id}`, {
      method: 'DELETE'
    });
  },

  // Products & Prices (Tan narx va sotuv narxi)
  getProducts: async (params?: { search?: string; category?: string }): Promise<{ products: any[] }> => {
    const q = new URLSearchParams();
    if (params?.search) q.set('search', params.search);
    if (params?.category) q.set('category', params.category);
    const qs = q.toString() ? `?${q.toString()}` : '';
    return fetchApi(`/api/products${qs}`);
  },

  createProduct: async (product: any): Promise<any> => {
    return fetchApi('/api/products', {
      method: 'POST',
      body: JSON.stringify(product)
    });
  },

  updateProduct: async (id: string, product: any): Promise<any> => {
    return fetchApi(`/api/products/${id}`, {
      method: 'PUT',
      body: JSON.stringify(product)
    });
  },

  syncPushPrices: async (provider_name: string, product_ids?: string[]): Promise<any> => {
    return fetchApi('/api/products/sync-push-prices', {
      method: 'POST',
      body: JSON.stringify({ provider_name, product_ids })
    });
  },

  // Roles & Permissions Matrix
  getRolesPermissions: async (): Promise<{
    roles: any[];
    permissions: any[];
    matrix: Record<string, string[]>;
  }> => {
    return fetchApi('/api/auth/roles-permissions');
  },

  updateRolePermissions: async (roleId: string, permissions: string[], reason?: string): Promise<any> => {
    return fetchApi(`/api/auth/roles-permissions/${roleId}`, {
      method: 'PUT',
      body: JSON.stringify({ permissions, reason })
    });
  },

  // Integrations & Server Cabinet Settings
  getIntegrations: async (): Promise<{
    integrations: any[];
    availableAdapters: any[];
  }> => {
    return fetchApi('/api/integrations/list');
  },

  getIntegrationConfig: async (providerName: string, integration_id?: string): Promise<{
    configured: boolean;
    config: any;
  }> => {
    return fetchApi(`/api/integrations/config/${encodeURIComponent(providerName)}${integration_id ? `?integration_id=${encodeURIComponent(integration_id)}` : ''}`);
  },

  saveIntegrationConfig: async (data: {
    provider_name: string;
    integration_id?: string;
    connection_name?: string;
    auth_type: 'API_TOKEN' | 'SERVER_CREDENTIALS';
    server_url: string;
    api_token?: string;
    username?: string;
    password?: string;
    company_account_id?: string;
    branch_code?: string;
    database_name?: string;
    sync_interval?: string;
    auto_sync?: boolean;
    history_start_date?: string;
    forecast_days?: number;
  }): Promise<{ success: boolean; connected?: boolean; message: string; integration_id: string }> => {
    return fetchApi('/api/integrations/config', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  testIntegrationConnection: async (providerName: string, config?: any, integration_id?: string): Promise<{
    result: { ok: boolean; message: string; latencyMs?: number; syncCoefficient?: number; details?: any };
  }> => {
    return fetchApi('/api/integrations/test-connection', {
      method: 'POST',
      body: JSON.stringify({ provider_name: providerName, config, integration_id })
    });
  },

  setIntegrationEnabled: async (providerName: string, enabled: boolean, integrationId?: string): Promise<{ success: boolean; message: string }> => {
    return fetchApi(`/api/integrations/${encodeURIComponent(providerName)}/enabled`, {
      method: 'POST',
      body: JSON.stringify({ enabled, integration_id: integrationId })
    });
  },

  deleteIntegration: async (integrationId: string): Promise<{ success: boolean; message: string }> => {
    return fetchApi(`/api/integrations/connection/${encodeURIComponent(integrationId)}`, { method: 'DELETE' });
  },

  setPrimaryIntegration: async (providerName: string, integrationId: string): Promise<{ success: boolean; message: string }> => {
    return fetchApi(`/api/integrations/${encodeURIComponent(providerName)}/primary`, {
      method: 'POST',
      body: JSON.stringify({ integration_id: integrationId })
    });
  },

  syncIntegration: async (providerName: string, integration_id?: string): Promise<{
    result: { provider: string; status: string; recordsImported: number; recordsFailed: number };
  }> => {
    return fetchApi('/api/integrations/sync', {
      method: 'POST',
      body: JSON.stringify({ provider_name: providerName, integration_id })
    });
  },

  // Forecast & Inventory Run-rate
  getForecastRunRate: async (factor: number = 1.0, customDemand?: Record<string, number>): Promise<any> => {
    const query = new URLSearchParams({ factor: factor.toString() });
    if (customDemand) {
      query.set('customDemand', JSON.stringify(customDemand));
    }
    return fetchApi(`/api/forecast/run-rate?${query.toString()}`);
  },

  getOutOfStockLostProfit: async (): Promise<any> => {
    return fetchApi('/api/forecast/out-of-stock');
  },

  sendAdminStockAlertSMS: async (phone?: string): Promise<any> => {
    return fetchApi('/api/forecast/send-admin-sms', {
      method: 'POST',
      body: JSON.stringify({ phone })
    });
  },

  syncForecastWarehouse: async (provider?: string): Promise<any> => {
    return fetchApi('/api/forecast/sync', {
      method: 'POST',
      body: JSON.stringify({ provider })
    });
  },

  // AI Analytics & Interactive Agent
  getAIAnalysis: async (): Promise<{ success: boolean; analysis: any }> => {
    return fetchApi('/api/ai/analysis');
  },

  syncDayOrders: async (cashDayId: string): Promise<{ success: boolean; message: string; syncedCount: number; totalSales: number; deliveredCount: number; pendingCount: number; cashDay: CashDay }> => {
    return fetchApi(`/api/cash/days/${cashDayId}/sync-orders`, {
      method: 'POST'
    });
  },

  getAIBusinessProfile: async (): Promise<{ success: boolean; profile: any }> => {
    return fetchApi('/api/ai/business-profile');
  },

  chatWithAIAgent: async (message: string, history?: any[]): Promise<any> => {
    return fetchApi('/api/ai/chat', {
      method: 'POST',
      body: JSON.stringify({ message, history })
    });
  }
};
