import type { 
  IntegrationAdapter, 
  ExternalSyncOrder, 
  ExternalSyncCustomer, 
  ExternalSyncPayment, 
  ExternalSyncEmployee,
  ExportDataPayload 
} from '../interfaces.ts';

/**
 * SmartUp.online ERP/SFA Adapter
 * Integrates with SmartUp Cloud SFA & Distribution ERP API
 */
export class SmartUpAdapter implements IntegrationAdapter {
  public readonly providerName = 'SMARTUP';
  public readonly providerType = 'DISTRIBUTION' as const;

  public async testConnection(_config: Record<string, any>): Promise<{ ok: boolean; message: string; latencyMs?: number }> {
    // No real API client is implemented yet; reporting success here would show fake data as live.
    return { ok: false, message: "SmartUp adapteri hali yozilmagan. Ma'lumot olinmaydi va yuborilmaydi.", latencyMs: 0 };
  }

  public async importOrders(config: Record<string, any>): Promise<ExternalSyncOrder[]> {
    return [];
  }

  public async importCustomers(config: Record<string, any>): Promise<ExternalSyncCustomer[]> {
    return [];
  }

  public async importPayments(config: Record<string, any>): Promise<ExternalSyncPayment[]> {
    return [];
  }

  public async importProducts(config: Record<string, any>): Promise<any[]> {
    return [];
  }

  public async importEmployees(config: Record<string, any>): Promise<ExternalSyncEmployee[]> {
    return [];
  }

  public async exportData(_payload: ExportDataPayload, _config: Record<string, any>): Promise<{ downloadUrl?: string; message: string }> {
    throw new Error("SmartUp adapteri ulanmagan. Ma'lumot yuborilmadi.");
  }
}
