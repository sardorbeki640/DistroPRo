import { db } from '../db/database.ts';
import type { Integration } from '../db/schema.ts';
import type { DistributionCapabilities, IntegrationAdapter } from './interfaces.ts';
import { integrationProvider } from './provider.ts';
import { capabilitiesOf } from './capabilities.ts';

/**
 * The connected distribution system, whichever it is (SalesDoctor, Linko, or any adapter added later).
 * Everything that works "with the distribution system" — sending cash payments, agents' visits, price lists,
 * forecasts — goes through here, so connecting another system needs only its adapter.
 */
export type ActiveDistribution = { integration: Integration; adapter: IntegrationAdapter; name: string; capabilities: DistributionCapabilities };

const NAMES: Record<string, string> = { SALESDOC: 'SalesDoctor', SALESDOCTOR: 'SalesDoctor', SALES_DOCTOR: 'SalesDoctor', LINKO: 'Linko', SMARTUP: 'Smartup', '1C_ENTERPRISE_ERP': '1C', CUSTOM_SERVER: 'Shaxsiy server' };

export function systemName(providerName: string, adapter?: IntegrationAdapter | null): string {
  return adapter?.displayName || NAMES[providerName.toUpperCase()] || providerName;
}

export { capabilitiesOf };

function adapterFor(i: Integration): IntegrationAdapter | null {
  try { return integrationProvider.getAdapter(i.provider_name); } catch { return null; }
}

/** Distribution integrations of the company that are set up (connected or not), with their adapter. */
export function distributionIntegrations(company_id: string): ActiveDistribution[] {
  return db.find('integrations', i => i.company_id === company_id)
    .map(i => ({ i, a: adapterFor(i) }))
    .filter((x): x is { i: Integration; a: IntegrationAdapter } => !!x.a && x.a.providerType === 'DISTRIBUTION')
    .map(({ i, a }) => ({ integration: i, adapter: a, name: systemName(i.provider_name, a), capabilities: capabilitiesOf(a) }));
}

/**
 * The one system the cash register and reports work with: the connected and switched-on one. If several are on,
 * the one marked `primary` in its settings, else the most recently synced.
 */
export function activeDistribution(company_id: string): ActiveDistribution | null {
  const on = distributionIntegrations(company_id).filter(d => d.integration.status === 'CONNECTED' && !d.integration.disabled);
  if (!on.length) return null;
  return on.find(d => d.integration.config?.primary === true)
    || on.sort((a, b) => String(b.integration.last_sync_at || '').localeCompare(String(a.integration.last_sync_at || '')))[0];
}

/** Like activeDistribution, but a clear message instead of null (for actions that need a system). */
export function requireDistribution(company_id: string, need?: keyof DistributionCapabilities): ActiveDistribution {
  const d = activeDistribution(company_id);
  if (!d) throw new Error('Distribyutor tizimi (SalesDoctor, Linko …) ulanmagan yoki o‘chirilgan. Integratsiyalar bo‘limida ulang.');
  if (need && !d.capabilities[need]) {
    const what = { payments: 'kassadan to‘lov yuborish', visits: 'agent vizitlarini berish', priceTypes: 'narx turlarini berish', paymentTypes: 'to‘lov turlarini berish', history: 'buyurtmalar tarixini berish', historicalStock: 'tarixiy ombor qoldig‘ini berish' }[need];
    throw new Error(`${d.name} bilan ${what} hali qo‘llab-quvvatlanmaydi.`);
  }
  return d;
}
