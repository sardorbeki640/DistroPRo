import type { 
  IntegrationAdapter, 
  ExternalSyncOrder, 
  ExternalSyncCustomer, 
  ExternalSyncPayment, 
  ExternalSyncEmployee,
  ExportDataPayload 
} from '../interfaces.ts';

/**
 * Distribution ERP Adapter (e.g., 1C:Enterprise, Smartup, Jowi, Billz)
 * Standardizes API communication and data transformations.
 */
export class DistributionAdapter implements IntegrationAdapter {
  public readonly providerName = '1C_ENTERPRISE_ERP';
  public readonly providerType = 'DISTRIBUTION' as const;

  public async testConnection(config: Record<string, any>): Promise<{ ok: boolean; message: string; latencyMs?: number }> {
    const startTime = Date.now();
    // Simulate connection ping / heartbeat to distribution API endpoint
    await new Promise(r => setTimeout(r, 60));
    const latency = Date.now() - startTime;

    return {
      ok: false,
      message: '1C adapteri ulanmagan. Haqiqiy API sozlanishi kerak.',
      latencyMs: latency
    };
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

  public async exportData(payload: ExportDataPayload, config: Record<string, any>): Promise<{ downloadUrl?: string; message: string }> {
    throw new Error('1C eksporti ulanmagan. Ma’lumot yuborilmadi.');
  }
}
