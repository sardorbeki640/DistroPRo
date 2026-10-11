import type {
  IntegrationAdapter,
  ExternalSyncOrder,
  ExternalSyncCustomer,
  ExternalSyncPayment,
  ExternalSyncEmployee,
  ExternalLedgerEntry,
  ExportDataPayload
} from '../interfaces.ts';

/**
 * Linko.uz SFA adapter.
 *
 * Linko has no public read API, so this uses the same REST API as the app.linko.uz web cabinet:
 *   base      https://<server>.linko.uz/ru/api/v1   (server = the "Сервер" field of the Linko sign-in form)
 *   sign in   POST /main/user/auth/ { username, password, can_handle_2fa } -> { token } or { verify_by_sms, id }
 *   requests  Authorization: Token <token>; lists are paginated { count, next, results }
 */
export class LinkoAdapter implements IntegrationAdapter {
  public readonly providerName = 'LINKO';
  public readonly providerType = 'DISTRIBUTION' as const;
  public readonly displayName = 'Linko';

  private static readonly sessionCache = new Map<string, string>();

  /** Sections of the Linko cabinet the connection test samples to learn their record shape. */
  static readonly PROBE_PATHS: Record<string, string> = {
    orders: '/sales/order/',
    order_returns: '/sales/order_return/',
    order_products: '/sales/order_product/',
    customers: '/market/market/',
    client_transactions: '/sales/client_transaction/',
    debts: '/sales/debt_transactions/',
    order_payments: '/sales/order_payment/',
    products: '/main/product/',
    stock: '/stock/stock/get_product_balances/',
    users: '/main/user/'
  };

  /** Accepts "biolife", "biolife.linko.uz" or a full URL and returns the API base. */
  public normalizeEndpoint(raw?: string): string {
    const value = String(raw || '').trim().replace(/\/+$/, '');
    if (!value) throw new Error('Linko server nomi kiritilmagan (kirish oynasidagi "Сервер" maydoni, masalan: biolife).');
    if (/^https?:\/\//i.test(value)) {
      const url = new URL(value);
      return `${url.protocol}//${url.host}/ru/api/v1`;
    }
    const host = value.includes('.') ? value : `${value}.linko.uz`;
    return `https://${host}/ru/api/v1`;
  }

  private cacheKey(config: Record<string, any>) {
    return `${this.normalizeEndpoint(config.server_url)}::${config.username || ''}`;
  }

  private async login(config: Record<string, any>): Promise<string> {
    if (config.auth_type === 'API_TOKEN') {
      if (!config.api_token) throw new Error('Linko tokeni kiritilmagan.');
      return String(config.api_token).replace(/^Token\s+/i, '');
    }
    const key = this.cacheKey(config);
    const cached = LinkoAdapter.sessionCache.get(key);
    if (cached) return cached;
    if (!config.username || !config.password) throw new Error('Linko login va paroli kiritilmagan.');
    const res = await fetch(`${this.normalizeEndpoint(config.server_url)}/main/user/auth/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ username: config.username, password: config.password, can_handle_2fa: true })
    }).catch((e: any) => { throw new Error(`Linko serveriga ulanib bo'lmadi: ${e.message}`); });
    const data: any = await res.json().catch(() => ({}));
    if (res.status === 404) throw new Error('Linko serveri topilmadi. Server nomini tekshiring.');
    if (!res.ok) throw new Error(`Linko kirish rad etildi: ${this.describeError(data) || res.status}`);
    if (data?.verify_by_sms) throw new Error("Linko kirishda SMS kod so'rayapti. Bu hisob uchun SMS tasdiq hali qo'llab-quvvatlanmaydi.");
    if (!data?.token) throw new Error('Linko token qaytarmadi.');
    LinkoAdapter.sessionCache.set(key, data.token);
    return data.token;
  }

  private describeError(data: any): string {
    if (!data || typeof data !== 'object') return '';
    if (data.detail) return String(data.detail);
    return Object.entries(data).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`).join('; ');
  }

  /** GET relative to the API base; signs in again once when the session expired. */
  public async get(config: Record<string, any>, path: string, params: Record<string, any> = {}, retried = false): Promise<any> {
    const token = await this.login(config);
    const base = this.normalizeEndpoint(config.server_url);
    const url = /^https?:\/\//.test(path) ? new URL(path) : new URL(base + path);
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    const res = await fetch(url, { headers: { Authorization: `Token ${token}`, Accept: 'application/json' } })
      .catch((e: any) => { throw new Error(`Linko serveriga ulanib bo'lmadi: ${e.message}`); });
    if (res.status === 401 && !retried && config.auth_type !== 'API_TOKEN') {
      LinkoAdapter.sessionCache.delete(this.cacheKey(config));
      return this.get(config, path, params, true);
    }
    const data: any = await res.json().catch(() => null);
    if (res.status === 402) throw new Error("Linko: obuna to'lovi talab qilinmoqda (402).");
    if (!res.ok) throw new Error(`Linko ${path}: ${this.describeError(data) || `HTTP ${res.status}`}`);
    return data;
  }

  /** Linko sections where a customer payment could be created (checked by describeWrite before anything is sent). */
  static readonly WRITE_PROBE_PATHS = ['/sales/client_transaction/', '/sales/order_payment/', '/sales/payment/', '/sales/debt_transactions/'];

  /**
   * The create form of a Linko section as the server describes it (Django REST "OPTIONS": allowed methods and the
   * POST fields with type, required flag and choices). Read-only: nothing is created. Field values are never logged.
   */
  public async describeWrite(config: Record<string, any>, path: string): Promise<{ allow: string; fields: string[] }> {
    const token = await this.login(config);
    const res = await fetch(this.normalizeEndpoint(config.server_url) + path, { method: 'OPTIONS', headers: { Authorization: `Token ${token}`, Accept: 'application/json' } })
      .catch((e: any) => { throw new Error(`Linko serveriga ulanib bo'lmadi: ${e.message}`); });
    const data: any = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`HTTP ${res.status} ${this.describeError(data)}`);
    const post = data?.actions?.POST || {};
    const fields = Object.entries(post).map(([name, f]: [string, any]) => {
      const choices = Array.isArray(f?.choices) ? `{${f.choices.slice(0, 12).map((c: any) => `${c.value}=${c.display_name}`).join('|')}}` : '';
      return `${name}:${f?.type || '?'}${f?.required ? '!' : ''}${f?.read_only ? '(ro)' : ''}${choices}`;
    });
    return { allow: res.headers.get('allow') || '?', fields };
  }

  /** Every page of a paginated list, following `next`. */
  public async readAll(config: Record<string, any>, path: string, params: Record<string, any> = {}): Promise<any[]> {
    const rows: any[] = [];
    let page = await this.get(config, path, { page_size: 200, ...params });
    for (;;) {
      if (Array.isArray(page)) return rows.concat(page);
      rows.push(...(page?.results || []));
      if (!page?.next) return rows;
      page = await this.get(config, page.next);
    }
  }

  /** Field paths of a record (names and types only, never values) so the mapping can be written against the real shape. */
  static shapeOf(value: any, prefix = '', depth = 0, out: string[] = []): string[] {
    if (Array.isArray(value)) {
      out.push(`${prefix}[]`);
      if (value.length && depth < 4) LinkoAdapter.shapeOf(value[0], `${prefix}[]`, depth + 1, out);
    } else if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) {
        const p = prefix ? `${prefix}.${k}` : k;
        if (v && typeof v === 'object' && depth < 4) LinkoAdapter.shapeOf(v, p, depth + 1, out);
        else out.push(`${p}:${v === null ? 'null' : typeof v}`);
      }
    }
    return out;
  }

  public async testConnection(config: Record<string, any>): Promise<{ ok: boolean; message: string; latencyMs?: number; details?: any }> {
    const t0 = Date.now();
    try {
      await this.login(config);
      const me = await this.get(config, '/main/user/auth-confirm/');
      const counts: Record<string, number | string> = {};
      for (const [name, path] of Object.entries(LinkoAdapter.PROBE_PATHS)) {
        try {
          const page = await this.get(config, path, { page_size: 1 });
          const first = Array.isArray(page) ? page[0] : page?.results?.[0] ?? page;
          counts[name] = Array.isArray(page) ? page.length : page?.count ?? '?';
          console.log(`[LinkoProbe] ${name} ${path} count=${counts[name]} shape=${LinkoAdapter.shapeOf(first).join(' ')}`);
        } catch (e: any) {
          counts[name] = `xato: ${e.message}`;
          console.log(`[LinkoProbe] ${name} ${path} ERROR ${e.message}`);
        }
      }
      console.log(`[LinkoProbe] user shape=${LinkoAdapter.shapeOf(me).join(' ')}`);
      // Which fields Linko wants to create a payment (read-only OPTIONS; nothing is written).
      for (const path of LinkoAdapter.WRITE_PROBE_PATHS) {
        try {
          const schema = await this.describeWrite(config, path);
          console.log(`[LinkoWriteProbe] ${path} allow=${schema.allow} POST=${schema.fields.join(' ') || '(yo‘q)'}`);
        } catch (e: any) {
          console.log(`[LinkoWriteProbe] ${path} ERROR ${e.message}`);
        }
      }
      const who = me?.full_name || me?.username || config.username;
      return {
        ok: true,
        message: `Linko'ga ulandi (${who}). Buyurtmalar: ${counts.orders}, mijozlar: ${counts.customers}. Ma'lumotlarni import qilish keyingi bosqichda yoqiladi.`,
        latencyMs: Date.now() - t0,
        details: { counts }
      };
    } catch (e: any) {
      return { ok: false, message: e.message, latencyMs: Date.now() - t0 };
    }
  }

  // ---- Import. Linko ids are prefixed "lk-" so they never collide with SalesDoc ids or hand-made codes. ----

  static orderStatus(raw: any): string {
    const s = String(raw ?? '').toLowerCase();
    // Lists return numeric codes; the status filter takes names (3 = delivered, 4 = cancelled, verified on live data).
    if (s === '3' || s === 'delivered') return 'DELIVERED';
    if (s === '4' || s === 'cancelled' || s === 'canceled') return 'CANCELLED';
    return 'PENDING';
  }

  static personName(p: any): string {
    return [p?.first_name, p?.second_name].filter(Boolean).join(' ').trim();
  }

  /** Order lines of orders created in [from, to], grouped by Linko order id. Net quantity = remain_amount (after returns). */
  public async importOrderLines(config: Record<string, any>, from: string, to: string): Promise<Map<string, NonNullable<ExternalSyncOrder['items']>>> {
    const lines = await this.readAll(config, '/sales/order_product/', { begin_date: from, end_date: to, page_size: 1000 });
    const byOrder = new Map<string, NonNullable<ExternalSyncOrder['items']>>();
    for (const l of lines) {
      const key = `lk-${l.order_id}`;
      const quantity = Math.max(0, Number(l.remain_amount ?? l.amount) || 0);
      const price = Number(l.price) || 0;
      const list = byOrder.get(key) || [];
      list.push({ sku: `lk-${l.product_id ?? l.product?.id}`, name: l.product_name || l.product?.name || 'Tovar', quantity, price, total: quantity * price });
      byOrder.set(key, list);
    }
    return byOrder;
  }

  public async importOrders(config: Record<string, any>, options?: { dateFrom?: string; dateTo?: string; withItems?: boolean; byDelivery?: boolean }): Promise<ExternalSyncOrder[]> {
    const from = options?.dateFrom || config.history_start_date || '2000-01-01';
    const to = options?.dateTo || from;
    // begin/end filter by creation date; a cash day wants the orders delivered that day.
    const params = options?.byDelivery && from === to ? { date_delivery: from } : { begin_date: from, end_date: to };
    const orders = await this.readAll(config, '/sales/order/', { ...params, page_size: 1000 });
    const lines = options?.withItems === false ? null : await this.importOrderLines(config, from, to);
    return orders.map((o: any): ExternalSyncOrder => {
      const externalId = `lk-${o.id}`;
      const items = lines ? lines.get(externalId) || [] : undefined;
      return {
        externalId,
        orderNumber: String(o.order_number ?? o.id),
        customerCode: o.market?.id ? `lk-${o.market.id}` : 'UNKNOWN',
        customerName: o.market?.name || o.client?.name || 'Mijoz',
        customerRef: o.market?.id ? { id: String(o.market.id) } : undefined,
        orderRef: { id: String(o.id) },
        // fact_price = total after returns and discount (total_price = lines before returns).
        totalAmount: Number(o.fact_price ?? o.total_price) || 0,
        returnAmount: Math.max(0, Number(o.total_return_price) || 0),
        status: LinkoAdapter.orderStatus(o.status),
        orderDate: String(o.created_date || '').slice(0, 10),
        deliveryDate: String(o.date_delivery || '').slice(0, 10) || undefined,
        itemsCount: items ? items.reduce((s, i) => s + i.quantity, 0) : 0,
        agentName: LinkoAdapter.personName(o.user) || undefined,
        agentCode: o.user?.id ? `lk-u${o.user.id}` : undefined,
        expeditorName: LinkoAdapter.personName(o.delivery_man) || undefined,
        items
      };
    });
  }

  public async importCustomers(config: Record<string, any>): Promise<ExternalSyncCustomer[]> {
    const markets = await this.readAll(config, '/market/market/', { page_size: 1000 });
    return markets.map((m: any) => ({
      externalCode: `lk-${m.id}`,
      name: m.name || 'Mijoz',
      phone: m.market_options?.find((o: any) => /tel|phone/i.test(o.option_name || ''))?.text_value || '',
      address: m.address || '',
      balance: 0,
      agentCode: m.responsible_agent?.id ? `lk-u${m.responsible_agent.id}` : undefined,
      agentName: LinkoAdapter.personName(m.responsible_agent) || undefined,
      isActive: m.is_active !== false && !m.is_closed
    } as ExternalSyncCustomer));
  }

  /** Customer ledger: sale debts (type 4, negative), payments (type 1), returns and corrections, with their dates. */
  public async importLedger(config: Record<string, any>, from?: string, to?: string): Promise<ExternalLedgerEntry[]> {
    const rows = await this.readAll(config, '/sales/client_transaction/', { ...(from ? { begin_date: from, end_date: to || from } : {}), page_size: 1000 });
    return rows.filter((t: any) => t.market?.id).map((t: any): ExternalLedgerEntry => {
      const amount = Number(t.amount) || 0;
      const type = Number(t.type);
      return {
        externalId: `lk-tx-${t.id}`,
        customerCode: `lk-${t.market.id}`,
        customerName: t.market.name || 'Mijoz',
        date: String(t.created_date || '').slice(0, 10),
        amount,
        kind: type === 4 ? 'SALE' : type === 1 ? 'PAYMENT' : t.order_return ? 'RETURN' : 'OTHER',
        paymentMethod: t.payment_type || undefined,
        orderExternalId: t.order ? `lk-${t.order}` : null,
        comment: t.comment || null
      };
    });
  }

  public async importPayments(config: Record<string, any>): Promise<ExternalSyncPayment[]> {
    const ledger = await this.importLedger(config);
    return ledger.filter(l => l.kind === 'PAYMENT').map(l => ({ externalPaymentId: l.externalId, customerCode: l.customerCode, amount: l.amount, paymentMethod: l.paymentMethod || 'cash', paymentDate: l.date }));
  }

  /** Products with their Linko category (type) and brand. Linko lists no price here; prices come from order lines. */
  public async importProducts(config: Record<string, any>): Promise<any[]> {
    const products = await this.readAll(config, '/main/product/', { page_size: 1000 });
    return products.filter((p: any) => !p.is_delete).map((p: any) => ({
      sku: `lk-${p.id}`,
      code: p.code || p.vendor_code || '',
      name: p.full_name || p.name || 'Tovar',
      category: p.type?.name || 'Boshqa',
      brand: p.brand?.name || undefined,
      unit: p.measurement?.name || 'dona',
      purchase_cost: 0,
      ...(Number(p.price) > 0 ? { selling_price: Number(p.price) } : {})
    }));
  }

  public async importEmployees(config: Record<string, any>): Promise<ExternalSyncEmployee[]> {
    const users = await this.readAll(config, '/main/user/crud/', { page_size: 1000 });
    return users.map((u: any) => ({
      externalId: `lk-u${u.id}`,
      name: LinkoAdapter.personName(u) || u.username || 'Xodim',
      role: /экспед|yetkaz|dostav|достав/i.test(u.position?.name || '') ? 'EXPEDITOR' as const : /супервай|supervis/i.test(u.position?.name || '') ? 'SUPERVISOR' as const : 'AGENT' as const,
      phone: u.phone_number || '',
      login: u.username || undefined
    }));
  }

  public async exportData(_payload: ExportDataPayload, _config: Record<string, any>): Promise<{ downloadUrl?: string; message: string }> {
    throw new Error("Linko'ga ma'lumot yuborish hali yoqilmagan.");
  }
}
