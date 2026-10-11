import { db } from '../db/database.ts';
import { integrationProvider } from '../integrations/provider.ts';
import { capabilitiesOf } from '../integrations/capabilities.ts';
import { SalesDocHistoryService, type HistoryAdapter } from './salesdoc-history.service.ts';

// Runs the "sync every N" setting while the server is running. Nothing runs when the computer or server is off.
const CHECK_EVERY_MS = 60_000;
const lastAttempt = new Map<string, number>();
const genericRunning = new Set<string>();

export function parseSyncInterval(value: unknown): number | null {
  const match = /^(\d+)\s*(m|h|d)$/i.exec(String(value || '').trim());
  if (!match) return null;
  const n = Number(match[1]);
  const unit = match[2].toLowerCase() === 'm' ? 60_000 : match[2].toLowerCase() === 'h' ? 3_600_000 : 86_400_000;
  return n > 0 ? Math.max(5 * 60_000, n * unit) : null; // never more often than every 5 minutes
}

export function runDueSyncs(now = Date.now()): string[] {
  const started: string[] = [];
  for (const integration of db.find('integrations', i => i.status === 'CONNECTED' && i.config?.auto_sync !== false)) {
    const interval = parseSyncInterval(integration.config?.sync_interval);
    if (!interval) continue;
    // Systems that give their order history (SalesDoctor, Linko, …) load it month by month in the background.
    let adapter: any = null;
    try { adapter = integrationProvider.getAdapter(integration.provider_name); } catch { continue; }
    if (integration.disabled) continue;
    const isSalesDoc = capabilitiesOf(adapter).history;
    const history = integration.config?.history;
    // A download that was cut off by a restart is resumed right away.
    const interrupted = isSalesDoc && ((history?.status === 'RUNNING' && !SalesDocHistoryService.isRunning(integration.id)) || history?.refetch_all === true);
    const last = Math.max(lastAttempt.get(integration.id) || 0, Date.parse(integration.last_sync_at || '') || 0);
    if (!interrupted && now - last < interval) continue;
    lastAttempt.set(integration.id, now);

    if (isSalesDoc) {
      if (SalesDocHistoryService.isRunning(integration.id)) continue;
      SalesDocHistoryService.start(integration.company_id, integration.id, 'system-scheduler', history?.complete && !interrupted ? 'recent' : 'full', adapter as HistoryAdapter);
      started.push(integration.id);
    } else if (adapter.providerType === 'DISTRIBUTION' && !genericRunning.has(integration.id)) {
      genericRunning.add(integration.id);
      integrationProvider.syncProvider(integration.company_id, integration.provider_name, 'system-scheduler', 'system')
        .catch(err => console.warn('[Scheduler]', integration.provider_name, err.message))
        .finally(() => genericRunning.delete(integration.id));
      started.push(integration.id);
    }
  }
  return started;
}

export function startIntegrationScheduler(): NodeJS.Timeout {
  const timer = setInterval(() => {
    try { runDueSyncs(); } catch (err: any) { console.warn('[Scheduler]', err.message); }
  }, CHECK_EVERY_MS);
  timer.unref();
  return timer;
}
