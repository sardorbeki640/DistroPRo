import type {
  IntegrationAdapter,
  ExternalSyncOrder,
  ExternalSyncCustomer,
  ExternalSyncPayment,
  ExternalSyncEmployee,
  ExportDataPayload
} from '../interfaces.ts';

/**
 * Custom Private Server Adapter (Shaxsiy Server Kabineti & Maxsus ERP/SFA)
 *
 * Supports connecting to company's private server / self-hosted system via:
 * 1. API Token (Bearer Token / API Key from private cabinet)
 * 2. Server URL + Login + Password (Server autentifikatsiyasi)
 *
 * The server must expose GET /orders, /customers, /payments, /products, /employees returning JSON
 * in the ExternalSync* shapes. A failed request throws; it is never reported as "0 records".
 */
export class CustomServerAdapter implements IntegrationAdapter {
  public readonly providerName = 'CUSTOM_SERVER';
  public readonly providerType = 'DISTRIBUTION' as const;

  private baseUrl(config: Record<string, any>): string {
    const url = String(config?.server_url || config?.endpoint || '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(url)) throw new Error('Server manzili http:// yoki https:// bilan boshlanishi kerak.');
    return url;
  }

  private headers(config: Record<string, any>): Record<string, string> {
    if (config?.auth_type === 'SERVER_CREDENTIALS' && config?.username) {
      return { Authorization: 'Basic ' + Buffer.from(`${config.username}:${config.password || ''}`).toString('base64') };
    }
    return config?.api_token ? { Authorization: `Bearer ${config.api_token}` } : {};
  }

  private async getJson(config: Record<string, any>, path: string, key: string): Promise<any[]> {
    const url = `${this.baseUrl(config)}/${path}`;
    const res = await fetch(url, { headers: this.headers(config), redirect: 'error', signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`Shaxsiy server ${path}: HTTP ${res.status}`);
    const data = await res.json();
    const rows = Array.isArray(data) ? data : data?.[key];
    if (!Array.isArray(rows)) throw new Error(`Shaxsiy server ${path}: javob formati noto‘g‘ri`);
    return rows;
  }

  public async testConnection(config: Record<string, any>): Promise<{
    ok: boolean;
    message: string;
    latencyMs?: number;
  }> {
    const startTime = Date.now();
    try {
      const url = this.baseUrl(config);
      if (!Object.keys(this.headers(config)).length) {
        return { ok: false, message: 'API token yoki login/parol kiritilmagan.', latencyMs: 0 };
      }
      const res = await fetch(url, { headers: this.headers(config), redirect: 'error', signal: AbortSignal.timeout(10000) });
      const latencyMs = Date.now() - startTime;
      if (res.status === 401 || res.status === 403) return { ok: false, message: `Server kirishni rad etdi (HTTP ${res.status}).`, latencyMs };
      if (!res.ok) return { ok: false, message: `Server javobi: HTTP ${res.status}.`, latencyMs };
      return { ok: true, message: `Server javob berdi (${latencyMs} ms). Ma'lumot formati birinchi sinxronlashda tekshiriladi.`, latencyMs };
    } catch (err: any) {
      return { ok: false, message: `Serverga ulanib bo'lmadi: ${err.message}`, latencyMs: Date.now() - startTime };
    }
  }

  public async importOrders(config: Record<string, any>): Promise<ExternalSyncOrder[]> {
    return this.getJson(config, 'orders', 'orders');
  }

  public async importCustomers(config: Record<string, any>): Promise<ExternalSyncCustomer[]> {
    return this.getJson(config, 'customers', 'customers');
  }

  public async importPayments(config: Record<string, any>): Promise<ExternalSyncPayment[]> {
    return this.getJson(config, 'payments', 'payments');
  }

  public async importProducts(config: Record<string, any>): Promise<any[]> {
    return this.getJson(config, 'products', 'products');
  }

  public async importEmployees(config: Record<string, any>): Promise<ExternalSyncEmployee[]> {
    return this.getJson(config, 'employees', 'employees');
  }

  public async exportData(_payload: ExportDataPayload, _config: Record<string, any>): Promise<{ downloadUrl?: string; message: string }> {
    throw new Error("Shaxsiy serverga yuborish hali yozilmagan. Ma'lumot yuborilmadi.");
  }
}
