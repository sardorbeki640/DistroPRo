import type { 
  IntegrationAdapter, 
  ExternalSyncOrder, 
  ExternalSyncCustomer, 
  ExternalSyncPayment, 
  ExternalSyncEmployee,
  ExportDataPayload,
  OutgoingPayment,
  RemotePayment,
  ExternalVisit,
  ExternalPriceType,
  ExternalPaymentType
} from '../interfaces.ts';
import { businessToday } from '../../utils/date.ts';

/** A SalesDoc price type (9.8). kind: 'purchase' for purchase / incoming prices ("Келиш нарх", "Закуп"), else 'sale'. */
export interface SalesDocPriceType {
  id: string;
  name: string;
  kind: 'sale' | 'purchase';
  active: boolean;
  currency: string | null;
  ref: { SD_id?: string; CS_id?: string; code_1C?: string };
}
const PURCHASE_PRICE_NAME = /закуп|келиш|kelish|kirim|tannarx|cost|приход|себест|входн|purchase/i;

/**
 * SalesDoctor / SalesDoc API V2 Adapter
 * Based on official specification: https://github.com/Clever91/salesdoc-api-doc
 * 
 * Core Principles (from 01-general.md):
 * - Single endpoint: POST <server_url>/api/v2
 * - Method in request body: { method: "...", auth: { userId, token }, filial?: { filial_id }, params?: { ... }, data?: { ... } }
 * - Authentication:
 *     1. method: "login" with { login, password } -> returns { userId, token }
 *     2. Subsequent requests use { userId, token } in the "auth" block
 * - Filial support: { filial: { filial_id: ... } } (optional, omitted or 0 if single branch)
 * - GET References:
 *     - getProduct (9.4) & getStock (9.24) & getPrice (9.9)
 *     - getClient (9.10) & getBalance (9.29)
 *     - getOrder (9.26)
 *     - getPayment (9.15) & getConsumption (9.30)
 * - SET Methods:
 *     - setPrice (10.13): { product: [ { code_1C, priceType: { code_1C, price } } ] }
 *     - setPayment (13.1): { payment: [ { code_1C, amount, paymentDate, client: { code_1C }, paymentType: { code_1C }, comment } ] }
 *     - setCurrentBalance (13.3): { currentBalance: [ { code_1C, balance, paymentType: { code_1C } } ] }
 * 
 * Note: No fake or mock data fallback. Only authentic data received from SalesDoc API is processed.
 */

interface SalesDocSession {
  userId: string;
  token: string;
  endpoint: string;
  expiresAt: number;
}

export class SalesDocAdapter implements IntegrationAdapter {
  public readonly providerName = 'SALESDOC';
  public readonly providerType = 'DISTRIBUTION' as const;
  public readonly displayName = 'SalesDoctor';

  // ---- Common distribution capabilities (see integrations/distribution.ts) ----

  /** Customers imported from SalesDoc carry its client id (d0_123) as their code. */
  public customerRef(code: string): Record<string, string> | null {
    return /^[a-z]\d+_\d+$/i.test(code) ? { SD_id: code } : null;
  }

  /** 13.1 setPayment. SET methods find the record by code_1C and update it, so a resend with the same code edits it. */
  public async postPayment(config: Record<string, any>, payment: OutgoingPayment): Promise<void> {
    const result = await this.executeSalesDocMethod(config, 'setPayment', {}, { payment: [payment] });
    if (Number(result?.completed) !== 1 || Number(result?.error) !== 0) throw Object.assign(new Error('SalesDoctor to‘lov qabul qilinganini tasdiqlamadi'), { rejected: Number(result?.completed) === 0 });
  }

  /** 9.15 getPayment: customer payments (transactionType 3) of one day. */
  public async listDayPayments(config: Record<string, any>, date: string): Promise<RemotePayment[]> {
    const rows = await this.readAll(config, 'getPayment', 'payment', { filter: { transactionType: 3, period: { date: { from: date, to: date } } } });
    return rows.map((p: any) => ({ code_1C: p.code_1C, amount: Number(p.amount ?? p.summa) || 0, comment: p.comment, client: p.client }));
  }

  /** 9.21 getVisit: each visit with the agent and when it started. */
  public async importVisits(config: Record<string, any>, from: string, to: string): Promise<ExternalVisit[]> {
    const rows = await this.readAll(config, 'getVisit', 'visit', { filter: { period: { date: { from, to } } } });
    return rows.filter((v: any) => v.agent_id && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(String(v.start_date || ''))).map((v: any) => ({ agentCode: String(v.agent_id), start: String(v.start_date).slice(0, 16) }));
  }

  public async listPriceTypes(config: Record<string, any>): Promise<ExternalPriceType[]> {
    return this.toPriceTypes(await this.readAll(config, 'getPriceType', 'priceType')).map(({ ref, ...t }) => t);
  }

  /** 9.14 getPaymentType (SalesDoc returns them under "currency"). */
  public async listPaymentTypes(config: Record<string, any>): Promise<ExternalPaymentType[]> {
    const result = await this.executeSalesDocMethod(config, 'getPaymentType', {});
    const list = result?.currency || result?.paymentType || (Array.isArray(result) ? result : []);
    return list.map((t: any) => ({ id: String(t.SD_id || ''), name: t.name || t.short || t.SD_id, active: t.active !== 'N' }));
  }

  // One login per account for the whole server: every new SalesDoc login revokes the previous token,
  // so separate caches per adapter instance (posting, history, sync) would keep logging each other out.
  private static sessionCache = new Map<string, SalesDocSession>();

  /**
   * Normalizes the API base URL to ensure it points to /api/v2
   */
  public normalizeEndpoint(rawUrl?: string): string {
    let url = (rawUrl || 'https://server.salesdoctor.uz').trim();
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }
    url = url.replace(/\/+$/, '');
    if (!url.endsWith('/api/v2')) {
      if (url.endsWith('/v1') || url.endsWith('/v2')) {
        url = url.replace(/\/v[12]$/, '/api/v2');
      } else if (url.endsWith('/api')) {
        url = url + '/v2';
      } else {
        url = url + '/api/v2';
      }
    }
    return url;
  }

  /**
   * Low-level POST dispatcher for SalesDoc API V2 protocol
   */
  public async postSalesDocApi(
    endpoint: string, 
    payload: Record<string, any>, 
    timeoutMs = 10000
  ): Promise<{ status: boolean; result?: any; error?: { code: number; message: string; data?: any }; pagination?: any; transport?: boolean }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'User-Agent': 'SalesDoc-Adapter/2.0 (Distro-ERP; https://github.com/Clever91/salesdoc-api-doc)'
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      clearTimeout(timer);

      let data: any;
      try {
        data = await response.json();
      } catch {
        return {
          status: false,
          // A gateway error page (5xx) says nothing about whether SalesDoc applied the request.
          transport: response.status >= 500,
          error: {
            code: response.status,
            message: `SalesDoc server javobi JSON formatida emas (HTTP ${response.status}: ${response.statusText})`
          }
        };
      }

      if (!response.ok && data?.status !== false) {
        return {
          status: false,
          transport: response.status >= 500,
          error: {
            code: response.status,
            message: data?.error?.message || `HTTP ${response.status}: ${response.statusText}`
          }
        };
      }

      return data;
    } catch (err: any) {
      clearTimeout(timer);
      // transport: no answer from SalesDoc, so a write may or may not have been applied.
      if (err.name === 'AbortError') {
        return {
          status: false,
          transport: true,
          error: {
            code: 408, 
            message: `SalesDoctor serveriga ulanish vaqti tugadi (timeout > ${timeoutMs}ms). Server manzili: ${endpoint}` 
          }
        };
      }
      return {
        status: false,
        transport: true,
        error: {
          code: 500,
          message: `SalesDoctor serveri bilan bog'lanishda tarmoq xatosi: ${err.message || 'Server mavjud emas'}` 
        }
      };
    }
  }

  /**
   * Authenticates with SalesDoc API using login/password or pre-existing API token
   */
  public async getAuthCredentials(config: Record<string, any>): Promise<{ userId: string; token: string; endpoint: string }> {
    const endpoint = this.normalizeEndpoint(config?.server_url || config?.endpoint);
    const authType = config?.auth_type || (config?.api_token ? 'API_TOKEN' : 'SERVER_CREDENTIALS');

    // Check existing session cache
    const cacheKey = `${endpoint}::${config?.username || config?.api_token || 'default'}`;
    const cached = SalesDocAdapter.sessionCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return { userId: cached.userId, token: cached.token, endpoint };
    }

    if (authType === 'API_TOKEN') {
      const token = config?.api_token || config?.apiKey || config?.token;
      const userId = config?.userId || config?.user_id || config?.company_account_id || 'd0_1';
      if (!token) {
        throw Object.assign(new Error("SalesDoctor API Token kiritilmagan. Sozlamalardan API tokenni kiriting."), { rejected: true });
      }
      return { userId, token, endpoint };
    }

    // SERVER_CREDENTIALS flow: call method: "login"
    const login = config?.username || config?.login;
    const password = config?.password;

    if (!login || !password) {
      throw Object.assign(new Error("SalesDoctor server login yoki paroli kiritilmagan. Sozlamalardan login va parolni kiriting."), { rejected: true });
    }

    // SalesDoc keeps one live token per account: every login revokes the previous one. Requests running at the same
    // time therefore share a single login instead of each logging in (and revoking each other's token).
    let pending = SalesDocAdapter.loginInFlight.get(cacheKey);
    if (!pending) {
      pending = (async () => {
        const loginRes = await this.postSalesDocApi(endpoint, { method: 'login', auth: { login, password } }, 20000);
        if (!loginRes.status || !loginRes.result?.token) {
          const errMsg = loginRes.error?.message || 'SalesDoctor login autentifikatsiyasi amalga oshmadi';
          // Login failed, so nothing was sent: a payment attempt counts as refused, not uncertain.
          throw Object.assign(new Error(`SalesDoctor Login Xatosi: ${errMsg} (Server: ${endpoint})`), { rejected: !loginRes.transport });
        }
        const session: SalesDocSession = {
          userId: loginRes.result.userId || loginRes.result.user_id || 'd0_1',
          token: loginRes.result.token,
          endpoint,
          expiresAt: Date.now() + 1000 * 60 * 60 * 12 // 12 hours validity
        };
        SalesDocAdapter.sessionCache.set(cacheKey, session);
        return session;
      })().finally(() => SalesDocAdapter.loginInFlight.delete(cacheKey));
      SalesDocAdapter.loginInFlight.set(cacheKey, pending);
    }
    const session = await pending;
    return { userId: session.userId, token: session.token, endpoint };
  }

  private static loginInFlight = new Map<string, Promise<SalesDocSession>>();

  /**
   * Helper to make authenticated SalesDoc API call
   */
  public async executeSalesDocMethod(
    config: Record<string, any>,
    methodName: string,
    params: Record<string, any> = {},
    dataPayload?: any,
    envelope = false
  ): Promise<any> {
    const { userId, token, endpoint } = await this.getAuthCredentials(config);
    const filialId = config?.branch_code || config?.filial_id;

    const requestBody: Record<string, any> = {
      method: methodName,
      auth: { userId, token },
      params
    };

    if (filialId && filialId !== '0') {
      requestBody.filial = { filial_id: filialId };
    }
    if (dataPayload !== undefined) {
      requestBody.data = dataPayload;
    }

    const isRead = methodName.startsWith('get');
    let res = await this.postSalesDocApi(endpoint, requestBody, isRead ? 60000 : 20000);
    // A login elsewhere (another request of ours, the SalesDoc web cabinet, another program) revokes the token.
    // If another request already logged in again, its new token is used; otherwise this request logs in once.
    // Writes are retried only on an explicit 401: SalesDoc refused the request before doing anything.
    for (let attempt = 0; attempt < 2 && !res.status && !res.transport && (isRead ? this.isAuthError(res.error) : res.error?.code === 401); attempt++) {
      if (!this.canRelogin(config)) break;
      const usedToken = requestBody.auth.token;
      const current = this.cachedSession(config);
      if (!current || current.token === usedToken) this.dropSession(config);
      const fresh = await this.getAuthCredentials(config);
      requestBody.auth = { userId: fresh.userId, token: fresh.token };
      res = await this.postSalesDocApi(endpoint, requestBody, isRead ? 60000 : 20000);
    }
    if (!res.status) {
      const err: any = new Error(`SalesDoctor [${methodName}] xatosi: ${this.describeError(res.error)}`);
      // SalesDoc answered: the request was definitely not accepted. Without an answer the outcome is unknown.
      err.rejected = !res.transport;
      throw err;
    }
    return envelope ? res : res.result;
  }

  /** SalesDoc puts the real reason in error.data.<group>[].errors; the top-level message is just "Error". */
  private describeError(error?: { code: number; message: string; data?: any }): string {
    if (!error) return 'Noma\'lum xatolik';
    const details: string[] = [];
    if (error.data && typeof error.data === 'object') {
      for (const group of Object.values(error.data)) {
        for (const row of Array.isArray(group) ? group : []) {
          for (const e of Array.isArray((row as any)?.errors) ? (row as any).errors : []) details.push(String(e));
        }
      }
    }
    return [error.message, ...details].filter(Boolean).join(': ') + (error.code ? ` (kod ${error.code})` : '');
  }

  private isAuthError(error?: { code: number; message: string }): boolean {
    return !!error && (error.code === 401 || error.code === 403 || /token|auth|avtoriz|авториз|login/i.test(error.message || ''));
  }

  private sessionKey(config: Record<string, any>) {
    return `${this.normalizeEndpoint(config?.server_url || config?.endpoint)}::${config?.username || config?.api_token || 'default'}`;
  }

  /** API-token configs cannot log in again. */
  private canRelogin(config: Record<string, any>): boolean {
    return (config?.auth_type || (config?.api_token ? 'API_TOKEN' : 'SERVER_CREDENTIALS')) !== 'API_TOKEN';
  }

  private cachedSession(config: Record<string, any>) {
    return SalesDocAdapter.sessionCache.get(this.sessionKey(config)) || null;
  }

  /** Forgets a cached login session; returns false for API-token configs, which cannot re-login. */
  private dropSession(config: Record<string, any>): boolean {
    if (!this.canRelogin(config)) return false;
    return SalesDocAdapter.sessionCache.delete(this.sessionKey(config));
  }

  /**
   * All price types (active or not) and, per product SD_id/CS_id, its price in each type: { [typeId]: price }.
   * A type whose prices cannot be read is listed with no prices; the import goes on.
   */
  public async readPriceLists(config: Record<string, any>): Promise<{ types: SalesDocPriceType[]; prices: Map<string, Record<string, number>> }> {
    const prices = new Map<string, Record<string, number>>();
    let raw: any[] = [];
    try {
      raw = await this.readAll(config, 'getPriceType', 'priceType');
    } catch (err: any) {
      console.warn('[SalesDocAdapter] getPriceType:', err.message);
    }
    const types = this.toPriceTypes(raw);
    for (const type of types) {
      // SD_id identifies the type in SalesDoc; code_1C is tried only if SD_id gives nothing (older setups).
      const attempts = [type.ref.SD_id ? { SD_id: type.ref.SD_id } : null, type.ref.CS_id ? { CS_id: type.ref.CS_id } : null, type.ref.code_1C ? { code_1C: type.ref.code_1C } : null].filter(Boolean);
      for (const priceType of attempts) {
        let rows: any[] = [];
        try {
          const result = await this.executeSalesDocMethod(config, 'getPrice', { priceType });
          rows = Array.isArray(result) ? result : (result?.price || result?.prices || []);
        } catch (err: any) {
          console.warn(`[SalesDocAdapter] getPrice ${type.name}:`, err.message);
          continue;
        }
        let found = 0;
        for (const row of rows) {
          const value = Number(row?.price ?? row?.cost ?? row?.sum ?? row?.amount);
          if (!Number.isFinite(value)) continue;
          for (const key of [row.product?.SD_id, row.product?.CS_id, row.SD_id, row.CS_id, row.product_id].filter(Boolean)) {
            const own = prices.get(String(key)) || {};
            own[type.id] = value;
            prices.set(String(key), own);
          }
          found++;
        }
        if (found) break;
      }
    }
    return { types, prices };
  }

  public toPriceTypes(raw: any[]): SalesDocPriceType[] {
    return raw.filter(t => t?.SD_id || t?.CS_id).map(t => ({
      id: String(t.SD_id || t.CS_id),
      name: String(t.name || t.SD_id || t.CS_id).trim(),
      kind: t.type === 'purchase' || PURCHASE_PRICE_NAME.test(String(t.name || '')) ? 'purchase' : 'sale',
      active: t.active !== 'N',
      currency: t.valyutaType?.code_1C || t.valyutaType?.name || null,
      ref: { SD_id: t.SD_id, CS_id: t.CS_id, code_1C: t.code_1C }
    }));
  }

  /** The price type used as selling price ('sale') or purchase cost ('purchase'): the chosen one, else the first active of that kind. */
  public pickPriceType(types: SalesDocPriceType[], kind: 'sale' | 'purchase', chosenId?: string): SalesDocPriceType | null {
    if (chosenId) {
      const chosen = types.find(t => t.id === chosenId);
      if (chosen) return chosen;
    }
    return types.find(t => t.kind === kind && t.active) || types.find(t => t.kind === kind) || null;
  }

  /** Names of a reference list (categories, brands) by SD_id, CS_id and code_1C. A failed read only loses the names. */
  private async readReferenceNames(config: Record<string, any>, method: string, key: string): Promise<Map<string, string>> {
    const names = new Map<string, string>();
    try {
      for (const row of await this.readAll(config, method, key)) {
        const name = String(row?.name || '').trim();
        if (!name) continue;
        for (const id of [row.SD_id, row.CS_id, row.code_1C]) if (id && !names.has(`${id}`)) names.set(`${id}`, name);
      }
    } catch (err: any) {
      console.warn(`[SalesDocAdapter] ${method}:`, err.message);
    }
    return names;
  }

  private referenceName(names: Map<string, string>, ref: any): string | null {
    if (!ref) return null;
    for (const id of [ref.SD_id, ref.CS_id, ref.code_1C]) if (id && names.has(`${id}`)) return names.get(`${id}`)!;
    return null;
  }

  public async readAll(config: Record<string, any>, method: string, key: string, params: Record<string, any> = {}): Promise<any[]> {
    const rows: any[] = [];
    const seen = new Set<string>();
    for (let page = 1; page <= 10000; page++) {
      const res = await this.executeSalesDocMethod(config, method, { ...params, limit: 500, page }, undefined, true);
      const batch = res.result?.[key] ?? (Array.isArray(res.result) ? res.result : null);
      if (!Array.isArray(batch)) throw new Error(`${method}: javob formati noto‘g‘ri`);
      const signature = JSON.stringify(batch);
      if (batch.length && seen.has(signature)) throw new Error(`${method}: server bir sahifani takrorladi; tarix to‘liq olinmadi`);
      seen.add(signature);
      rows.push(...batch);
      const total = Number(res.pagination?.total);
      if (Number.isFinite(total)) {
        if (rows.length >= total) return rows;
        if (!batch.length) throw new Error(`${method}: tarix uzilib qoldi`);
      } else if (batch.length < 500) return rows;
    }
    throw new Error(`${method}: sahifalar chegarasi; tarix to‘liq olinmadi`);
  }

  /**
   * Test Connection: Ping & Validate SalesDoctor API V2 Endpoint
   */
  public async testConnection(config: Record<string, any>): Promise<{ 
    ok: boolean; 
    message: string; 
    latencyMs?: number; 
    syncCoefficient?: number;
    details?: any;
  }> {
    const startTime = Date.now();
    const endpoint = this.normalizeEndpoint(config?.server_url || config?.endpoint);
    const authType = config?.auth_type || (config?.api_token ? 'API_TOKEN' : 'SERVER_CREDENTIALS');

    // 1. Validate mandatory fields
    if (authType === 'API_TOKEN' && !config?.api_token) {
      return {
        ok: false,
        message: "SalesDoctor API Token kiritilmagan. Shaxsiy kabinetingizdan olingan API tokenni kiriting.",
        latencyMs: 0
      };
    }
    if (authType === 'SERVER_CREDENTIALS' && (!config?.username || !config?.password)) {
      return {
        ok: false,
        message: "SalesDoctor login yoki paroli kiritilmagan. Shaxsiy kabinet yoki agent foydalanuvchi ma'lumotlarini kiriting.",
        latencyMs: 0
      };
    }

    try {
      if (authType === 'SERVER_CREDENTIALS') {
        const login = config?.username || config?.login;
        const password = config?.password;

        const res = await this.postSalesDocApi(endpoint, {
          method: 'login',
          auth: { login, password }
        }, 8000);

        const latency = Date.now() - startTime;

        if (res.status && res.result?.token) {
          // Cache successful session
          const cacheKey = `${endpoint}::${login}`;
          SalesDocAdapter.sessionCache.set(cacheKey, {
            userId: res.result.userId || 'd0_1',
            token: res.result.token,
            endpoint,
            expiresAt: Date.now() + 1000 * 60 * 60 * 12
          });

          return {
            ok: true,
            message: `SalesDoctor API V2 ga muvaffaqiyatli ulandi! Foydalanuvchi: ${res.result.userId || login}. Endpoint: ${endpoint}.`,
            latencyMs: latency,
            syncCoefficient: 100,
            details: {
              server_mode: 'SalesDoc API V2 (Clever91/salesdoc-api-doc)',
              endpoint,
              userId: res.result.userId
            }
          };
        } else {
          return {
            ok: false,
            message: `SalesDoctor autentifikatsiya xatosi: ${res.error?.message || 'Login yoki parol noto\'g\'ri'}. Server: ${endpoint}`,
            latencyMs: latency
          };
        }
      } else {
        // API Token flow: test with getValyutaType or getProduct limit 1
        const token = config?.api_token;
        const userId = config?.userId || config?.user_id || 'd0_1';

        const res = await this.postSalesDocApi(endpoint, {
          method: 'getValyutaType',
          auth: { userId, token },
          params: { limit: 1 }
        }, 8000);

        const latency = Date.now() - startTime;

        if (res.status) {
          return {
            ok: true,
            message: `SalesDoctor API V2 token tasdiqlandi. Endpoint: ${endpoint}.`,
            latencyMs: latency,
            syncCoefficient: 100,
            details: {
              server_mode: 'SalesDoc API V2 Token Auth',
              endpoint
            }
          };
        } else {
          return {
            ok: false,
            message: `SalesDoctor API Token rad etildi: ${res.error?.message || 'Token yaroqsiz'}. Server: ${endpoint}`,
            latencyMs: latency
          };
        }
      }
    } catch (e: any) {
      const latency = Date.now() - startTime;
      return {
        ok: false,
        message: `SalesDoctor serveriga ulanishda xatolik yuz berdi: ${e.message} (Server: ${endpoint})`,
        latencyMs: latency
      };
    }
  }

  /**
   * Import Products & Warehouse Stock (getProduct + getStock + getPriceType + getPrice)
   * Follows SalesDoc API V2 methods: 9.4 getProduct, 9.8 getPriceType, 9.9 getPrice, 9.24 getStock
   */
  public async importProducts(config: Record<string, any>): Promise<any[]> {
    try {
      const rawProducts = { product: await this.readAll(config, 'getProduct', 'product') };
      // getProduct gives only the ids of a product's category and brand (9.4); their names come from 9.5 and 9.17.
      const categoryNames = await this.readReferenceNames(config, 'getProductCategory', 'productCategory');
      const brandNames = await this.readReferenceNames(config, 'getBrand', 'brand');
      const warehouse: any[]=[];
      let received=0;
      const stockPages=new Set<string>();
      for(let page=1;page<=10000;page++) {
        const r=await this.executeSalesDocMethod(config,'getStock',{limit:500,page},undefined,true);
        const batch=r.result?.warehouse;
        if(!Array.isArray(batch)) throw new Error('Ombor qoldig‘i formati noto‘g‘ri');
        const count=batch.reduce((n:number,w:any)=>n+(w.products?.length||0),0);
        const key=JSON.stringify(batch);
        if(count && stockPages.has(key)) throw new Error('Ombor sahifasi takrorlandi');
        stockPages.add(key);warehouse.push(...batch);received+=count;
        const total=Number(r.pagination?.total);
        if(Number.isFinite(total)?received>=total:count<500) break;
        if(!count || page===10000) throw new Error('Ombor qoldig‘i to‘liq olinmadi');
      }
      const rawStocks = {warehouse};
      
      const productList = rawProducts?.product || (Array.isArray(rawProducts) ? rawProducts : []);
      const warehouseList = rawStocks?.warehouse || [];

      // Create a map of stock by product identifier (code_1C, SD_id, CS_id)
      const stockMap = new Map<string, number>();
      for (const wh of warehouseList) {
        if (Array.isArray(wh.products)) {
          for (const item of wh.products) {
            // code_1C is shared between products; summing by it would give one product the stock of many.
            const keys = [item.SD_id, item.CS_id].filter(Boolean);
            const qty = Number(item.quantity) || 0;
            for (const key of keys) {
              const current = stockMap.get(key) || 0;
              stockMap.set(key, current + qty);
            }
          }
        }
      }

      // Every price type of SalesDoc with its prices, exactly as listed there (9.8 getPriceType, 9.9 getPrice).
      const { types: priceTypes, prices: priceLists } = await this.readPriceLists(config);
      const saleType = this.pickPriceType(priceTypes, 'sale', config.sale_price_type_id);
      const costType = this.pickPriceType(priceTypes, 'purchase', config.purchase_price_type_id);

      if (productList.length > 0) {
        return productList.map((p: any) => {
          const key = p.code_1C || p.SD_id || p.CS_id || `SD-${Math.random().toString(36).slice(2, 7)}`;
          const stock = stockMap.get(p.SD_id) ?? stockMap.get(p.CS_id) ?? 0;
          
          // code_1C is shared between products in practice, so prices are matched by SD_id / CS_id only.
          const own = priceLists.get(String(p.SD_id)) || priceLists.get(String(p.CS_id)) || {};
          // The prices as SalesDoc has them (a 1 so'm placeholder stays 1; profit reports skip such costs themselves).
          const sellingPrice = (saleType && own[saleType.id]) || 0;
          const purchaseCost = (costType && own[costType.id]) || 0;
          const prices = priceTypes.filter(t => own[t.id] !== undefined).map(t => ({ type_id: t.id, name: t.name, kind: t.kind, currency: t.currency, price: own[t.id] }));

          const dailySalesAvg = 0;

          return {
            sku: String(p.SD_id || p.CS_id || key),
            name: p.name || 'SalesDoctor Mahsuloti',
            purchase_cost: purchaseCost,
            selling_price: sellingPrice,
            prices,
            stock_quantity: stock,
            daily_sales_avg: dailySalesAvg,
            unit: p.unit?.name || p.unit?.short || 'dona',
            category: p.category?.name || this.referenceName(categoryNames, p.category) || 'Asosiy',
            brand: p.brand?.name || this.referenceName(brandNames, p.brand) || undefined
          };
        });
      }
    } catch (err: any) {
      throw err;
    }

    // Return empty array when live API returns no data or fails. No fake mock products!
    return [];
  }

  /**
   * Import Staff & Field Force: Agents, Expeditors, Supervisors
   * Follows SalesDoc API V2 methods:
   * 9.11 getAgent (Savdo agentlari)
   * 9.12 getExpeditor (Ekspeditorlar va yetkazib beruvchilar)
   * 9.13 getSupervisor (Supervayzerlar)
   */


  /**
   * Import Customers & Contragents with Debts & Balances
   * Follows SalesDoc API V2: 9.10 getClient & 9.29 getBalance (Negative balance = client debt)
   */
  public async importCustomers(config: Record<string, any>): Promise<ExternalSyncCustomer[]> {
    try {
      const clientRes = { client: await this.readAll(config, 'getClient', 'client') };
      // All pages: the old single request with limit 1000 silently dropped balances of later customers.
      const balances = await this.readAll(config, 'getBalance', 'balance');

      const clients = clientRes?.client || [];
      // Which fields SalesDoc gives for a client (names only, no data) — to see where the territory comes from.
      if (clients[0]) console.log(`[SalesDocAdapter] getClient maydonlari: ${Object.keys(clients[0]).join(', ')}`);
      // The client's territory: SalesDoc gives it as "city" (a reference {SD_id} to its city/territory directory);
      // other installations may use territory/region. A reference without a name is resolved by its directory.
      const refs: [string, string][] = [['city', 'getCity'], ['territory', 'getTerritory'], ['region', 'getRegion']];
      const directories = new Map<string, Map<string, string>>();
      for (const [key, method] of refs) {
        if (clients.some((c: any) => c?.[key] && typeof c[key] === 'object' && !c[key].name)) directories.set(key, await this.readReferenceNames(config, method, key));
      }
      const territoryOf = (c: any): string => {
        for (const [key] of refs) {
          const v = c?.[key];
          if (!v) continue;
          if (typeof v === 'string' && v.trim()) return v.trim();
          if (typeof v === 'object') {
            const names = directories.get(key);
            const name = v.name || names?.get(String(v.SD_id)) || names?.get(String(v.CS_id)) || names?.get(String(v.code_1C));
            if (name) return String(name).trim();
          }
        }
        return '';
      };

      // Map balances: in SalesDoc API, negative balance means debt (nasiya qarzdorlik)
      const debtMap = new Map<string, number>();
      for (const b of balances) {
        const balNum = Number(b.balance) || 0;
        const debt = balNum < 0 ? Math.abs(balNum) : 0;
        for (const key of [b.SD_id, b.CS_id, b.code_1C, b.client?.SD_id, b.client?.CS_id, b.client?.code_1C]) {
          if (key) debtMap.set(String(key), debt);
        }
      }

      if (clients.length > 0) {
        return clients.map((c: any) => {
          const debt = debtMap.get(c.SD_id) ?? debtMap.get(c.CS_id) ?? debtMap.get(c.code_1C) ?? 0;
          return {
            // Same key order as orders (SD_id first) so orders, payments and customers match.
            externalCode: String(c.SD_id || c.CS_id || c.code_1C),
            name: c.name || c.firmName || c.clientName || 'SalesDoc Mijoz',
            phone: c.tel || c.phone || '',
            address: c.address || '',
            balance: debt,
            territory: territoryOf(c) || undefined
          };
        });
      }
    } catch (err: any) {
      throw err;
    }

    // Return empty array when live API returns no data or fails. No fake mock customers!
    return [];
  }

  /**
   * Import Employees, Sales Agents, Expeditors and Supervisors
   * Follows SalesDoc API V2: 9.11 getAgent, 9.12 getExpeditor, 9.13 getSupervisor
   */
   public async importEmployees(config: Record<string, any>): Promise<ExternalSyncEmployee[]> {
    const employeesList: ExternalSyncEmployee[] = [];
    const seenIds = new Set<string>();

    try {
      // 1. getAgent (Sales Agents / Savdo vakillari)
      const agentRes = await this.executeSalesDocMethod(config, 'getAgent', { limit: 1000 }).catch(() => null);
      const rawAgents = agentRes?.agent || (Array.isArray(agentRes) ? agentRes : []);
      for (const a of rawAgents) {
        const extId = a.SD_id || a.CS_id || a.code_1C || `SD-AG-${Math.random().toString(36).slice(2, 6)}`;
        if (!seenIds.has(extId)) {
          seenIds.add(extId);
          employeesList.push({
            externalId: extId,
            name: a.name || 'SalesDoc Agenti',
            role: 'AGENT',
            phone: a.phone || a.tel || '',
            login: a.user?.[0]?.login,
            code_1C: a.code_1C || undefined,
            commissionRate: 3.0
          });
        }
      }

      // 2. getExpeditor (Delivery Expeditors / Ekspeditorlar)
      const expRes = await this.executeSalesDocMethod(config, 'getExpeditor', { limit: 1000 }).catch(() => null);
      const rawExpeditors = expRes?.expeditor || (Array.isArray(expRes) ? expRes : []);
      for (const e of rawExpeditors) {
        const extId = e.SD_id || e.CS_id || e.code_1C || `SD-EXP-${Math.random().toString(36).slice(2, 6)}`;
        if (!seenIds.has(extId)) {
          seenIds.add(extId);
          employeesList.push({
            externalId: extId,
            name: e.name || 'SalesDoc Ekspeditori',
            role: 'EXPEDITOR',
            phone: e.tel || e.phone || '',
            address: e.address || '',
            login: e.user?.[0]?.login,
            code_1C: e.code_1C || undefined
          });
        }
      }

      // 3. getSupervisor (Supervisors / Supervayzerlar)
      const supRes = await this.executeSalesDocMethod(config, 'getSupervisor', {}).catch(() => null);
      const rawSupervisors = supRes?.supervisor || (Array.isArray(supRes) ? supRes : []);
      for (const s of rawSupervisors) {
        const extId = s.SD_id || s.CS_id || s.code_1C || `SD-SUP-${Math.random().toString(36).slice(2, 6)}`;
        if (!seenIds.has(extId)) {
          seenIds.add(extId);
          employeesList.push({
            externalId: extId,
            name: s.name || 'SalesDoc Supervayzeri',
            role: 'SUPERVISOR',
            code_1C: s.code_1C || undefined
          });
        }
      }
    } catch (err: any) {
      console.warn('[SalesDocAdapter] importEmployees failed:', err.message);
    }

    return employeesList;
  }

  /**
   * Import Sales Orders (Recent & Historical)
   * Follows SalesDoc API V2: 9.26 getOrder (order statuses: 1-New, 2-Sent, 3-Delivered, 4-Closed, 5-Cancelled)
   * Supports custom date range for historical sales analysis (past 90-180 days)
   */
  public async importOrders(
    config: Record<string, any>, 
    options?: { dateFrom?: string; dateTo?: string; status?: number[] }
  ): Promise<ExternalSyncOrder[]> {
    const period = {
      [config.order_date_field === 'dateLoad' ? 'dateLoad' : 'date']: {
        from: options?.dateFrom || config.history_start_date || '2000-01-01',
        to: options?.dateTo || businessToday()
      }
    };
    const orders = await this.readAll(config, 'getOrder', 'order', {
      promotions: true,
      filter: { include: 'all', agent: 'all', status: options?.status || [1,2,3,4,5], ...(period ? {period} : {}) }
    });
      if (orders.length > 0) {
        const statusMap: Record<number, string> = {
          1: 'NEW', // Yetkaziladi
          2: 'SENT', // Yetkaziladi / Yetkazilmoqda
          3: 'DELIVERED', // Yetkazildi
          4: 'CLOSED', // Yetkazildi / Yopilgan
          5: 'CANCELLED'
        };

        return orders.map((o: any): ExternalSyncOrder => {
          const rawStatus = Number(o.status);
          const status = statusMap[rawStatus] || 'UNKNOWN';
          const total = Number(o.totalSummaAfterDiscount ?? o.totalSumma) || 0;
          const customerCode = o.client?.SD_id || o.client?.CS_id || o.client?.code_1C || 'UNKNOWN';
          const customerName = o.client?.clientName || o.client?.firmName || o.client?.name || 'Mijoz';

          const agentName = o.agent?.name || '';
          const agentCode = o.agent?.code_1C || o.agent?.SD_id || o.agent?.CS_id || '';
          const expeditorName = o.expeditor?.name || '';

          // Parse order items for velocity and basket analysis
          const items: Array<{ sku: string; name: string; quantity: number; price: number; total: number }> = [];
          if (Array.isArray(o.orderProducts)) {
            for (const item of o.orderProducts) {
              const p = item.product || {};
              const sku = String(p.SD_id || p.CS_id || p.code_1C || 'PROD');
              const name = p.name || 'Tovar';
              // SalesDoc already nets returns out of quantity and summa; `returned` is informational only.
              const quantity = Math.max(0, Number(item.quantity ?? item.count ?? 0));
              const price = Number(item.price) || 0;
              const itemTotal = Number(item.summa ?? item.totalSumma ?? (quantity * price));
              items.push({ sku, name, quantity, price, total: itemTotal });
            }
          }

          return {
            externalId: String(o.SD_id || o.CS_id || o.code_1C || (() => { throw new Error('Buyurtma ID yo‘q'); })()),
            orderNumber: o.code_1C || o.CS_id || `SD-${o.SD_id}`,
            customerCode: String(customerCode),
            customerRef: o.client?.SD_id ? {SD_id: String(o.client.SD_id)} : o.client?.code_1C ? {code_1C: String(o.client.code_1C)} : {CS_id: String(o.client?.CS_id)},
            orderRef: o.SD_id ? {SD_id: String(o.SD_id)} : {code_1C: String(o.code_1C)},
            paymentTypeRef: o.paymentType?.SD_id ? {SD_id: String(o.paymentType.SD_id)} : o.paymentType?.code_1C ? {code_1C: String(o.paymentType.code_1C)} : undefined,
            customerName,
            totalAmount: total,
            returnAmount: Math.max(0, Number(o.totalReturnsSumma) || 0),
            status,
            // Same field the period filter uses, so every order lands inside the date chunk it was requested for.
            orderDate: String((config.order_date_field === 'dateLoad' ? o.dateLoad : o.date) || o.dateDocument || o.dateCreate || o.orderCreated || '').slice(0, 10),
            itemsCount: items.length > 0 ? items.reduce((s, i) => s + i.quantity, 0) : (Array.isArray(o.orderProducts) ? o.orderProducts.length : 1),
            agentName,
            agentCode,
            expeditorName,
            items
          };
        });
      }


    // Return empty array when live API returns no data or fails. No fake mock orders!
    return [];
  }

  /**
   * Import Cash Receipts & Field Collections
   * Follows SalesDoc API V2: 9.15 getPayment (transactionType 3 = Оплата)
   */
  public async importPayments(config: Record<string, any>): Promise<ExternalSyncPayment[]> {
    const today = businessToday();
    // A failed request throws: "0 payments" must never be reported when the server simply did not answer.
    const payments = await this.readAll(config, 'getPayment', 'payment', {
      filter: { transactionType: 3, period: { date: { from: today, to: today } } }
    });
    return payments
      .filter((p: any) => p.SD_id || p.CS_id || p.code_1C) // without a stable id a payment could be imported twice
      .map((p: any) => {
        const pName = p.paymentType?.name?.toLowerCase() || '';
        let method: 'CASH' | 'TERMINAL' | 'TRANSFER' = 'CASH';
        if (pName.includes('bank') || pName.includes('перечисл') || pName.includes('o\'tkazma')) {
          method = 'TRANSFER';
        } else if (pName.includes('kart') || pName.includes('terminal') || pName.includes('karta')) {
          method = 'TERMINAL';
        }
        return {
          externalPaymentId: String(p.SD_id || p.CS_id || p.code_1C),
          // Same key order as orders use for customerCode, so both point to one customer.
          customerCode: String(p.client?.SD_id || p.client?.CS_id || p.client?.code_1C || ''),
          amount: Number(p.amount || p.summa) || 0,
          paymentMethod: method,
          paymentDate: String(p.paymentDate || p.date || today).slice(0, 10)
        };
      });
  }

  /**
   * Export Data to SalesDoctor
   * Follows SalesDoc API V2: 10.13 setPrice, 13.1 setPayment, 13.3 setCurrentBalance
   */
  public async exportData(
    payload: ExportDataPayload, 
    config: Record<string, any>
  ): Promise<{ downloadUrl?: string; message: string }> {
    if (!payload.data || payload.data.length === 0) {
      return { message: "Eksport qilish uchun ma'lumot mavjud emas." };
    }

    try {
      if (payload.type === 'PRICE_UPDATE') {
        // Method 10.13: setPrice
        // Schema: { data: { product: [ { code_1C, priceType: { code_1C, price } } ] } }
        await this.executeSalesDocMethod(config, 'setPrice', {}, {
          product: payload.data.map(d => ({
            code_1C: d.sku,
            priceType: {
              code_1C: config?.price_type_1c || '000000001',
              price: Number(d.selling_price) || 0
            }
          }))
        });
        return {
          message: `SalesDoctor API V2 [setPrice]: ${payload.data.length} ta mahsulot narxi muvaffaqiyatli uzatildi.`
        };
      }

      if (payload.type === 'PAYMENT_PUSH') {
        // Method 13.1: setPayment
        // Schema: { data: { payment: [ { code_1C, amount, paymentDate, client: { code_1C }, paymentType: { code_1C }, comment } ] } }
        await this.executeSalesDocMethod(config, 'setPayment', {}, {
          payment: payload.data.map(p => ({
            code_1C: p.externalPaymentId || `PAY-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            amount: Number(p.amount) || 0,
            paymentDate: p.paymentDate || new Date().toISOString().slice(0, 19).replace('T', ' '),
            client: { code_1C: p.customerCode },
            paymentType: { code_1C: config?.payment_type_1c || '000000001' },
            comment: p.comment || "Kassadan qabul qilingan to'lov"
          }))
        });
        return {
          message: `SalesDoctor API V2 [setPayment]: ${payload.data.length} ta kassa to'lovi serverga uzatildi.`
        };
      }

      if (payload.type === 'BALANCE_SYNC') {
        // Method 13.3: setCurrentBalance
        // Schema: { data: { currentBalance: [ { code_1C, balance, paymentType: { code_1C } } ] } }
        await this.executeSalesDocMethod(config, 'setCurrentBalance', {}, {
          currentBalance: payload.data.map(b => ({
            code_1C: b.customerCode,
            balance: Number(b.balance) || 0,
            paymentType: { code_1C: config?.payment_type_1c || '000000001' }
          }))
        });
        return {
          message: `SalesDoctor API V2 [setCurrentBalance]: ${payload.data.length} ta mijoz balansi yangilandi.`
        };
      }
    } catch (e: any) {
      throw new Error(`SalesDoctor eksport xatosi: ${e.message}`);
    }

    return {
      message: `SalesDoctor API V2: ${payload.type} bo'yicha ${payload.data.length} ta yozuv uzatildi.`
    };
  }
}
