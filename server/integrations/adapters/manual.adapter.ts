import type { 
  IntegrationAdapter, 
  ExternalSyncOrder, 
  ExternalSyncCustomer, 
  ExternalSyncPayment, 
  ExportDataPayload 
} from '../interfaces.ts';

/**
 * Manual Data Entry Adapter
 * Used for direct operator entries, reconciliations and manual uploads with mandatory audit reason.
 */
export class ManualAdapter implements IntegrationAdapter {
  public readonly providerName = 'MANUAL_OPERATOR_ADAPTER';
  public readonly providerType = 'MANUAL' as const;

  public async testConnection(config: Record<string, any>): Promise<{ ok: boolean; message: string }> {
    return {
      ok: true,
      message: 'Qo\'lda kiritish (Manual Entry) qatlami faol. Audit majburiy sabab tekshiruvi yoqilgan.'
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

  public async exportData(payload: ExportDataPayload, config: Record<string, any>): Promise<{ message: string }> {
    return {
      message: `Qo'lda kiritilgan ${payload.type} ma'lumotlari hisoboti chiqarildi.`
    };
  }
}
