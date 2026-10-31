import { db } from '../db/database.ts';
import { integrationProvider } from '../integrations/provider.ts';
import { capabilitiesOf } from '../integrations/capabilities.ts';
import { SalesDocHistoryService, type HistoryAdapter } from './salesdoc-history.service.ts';

// Runs the "sync every N" setting while the server is running. Nothing runs when the computer or server is off.
const CHECK_EVERY_MS = 60_000;
// A history import can be large on the free Render instance. If the process
// was restarted while importing, let the API settle before resuming the same
// work; otherwise each restart immediately starts another expensive import.
const INTERRUPTED_HISTORY_COOLDOWN_MS = 2 * 60_000;
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
  for (const integration of db.find('integrations', i => i.status === 'CONNECTED')) {
    const interval = parseSyncInterval(integration.config?.sync_interval);
    // Systems that give their order history (SalesDoctor, Linko, …) load it month by month in the background.
    let adapter: any = null;
    try { adapter = integrationProvider.getAdapter(integration.provider_name); } catch { continue; }
    if (integration.disabled) continue;
    const isSalesDoc = capabilitiesOf(adapter).history;
    const historicalStockPending = integration.provider_name === 'SALESDOC'
      && capabilitiesOf(adapter).historicalStock
      && !!integration.config?.history_start_date
      && integration.config?.stockout_history?.complete !== true;
    if (historicalStockPending) {
      void SalesDocHistoryService.syncSalesDocStockoutHistory(integration.company_id, integration.id, adapter as any)
        .catch(err => console.warn('[Scheduler] SalesDoctor tarixiy qoldig‘i:', err.message));
    }
    // Historical stock dating is a separate provider job. It must continue even
    // when routine order sync has no interval configured; its own 5-minute
    // provider throttle controls the request rate.
    if (!interval) continue;
    // Historical stock dating is an explicit full-history job and continues to
    // completion even when routine automatic order imports are disabled.
    if (integration.config?.auto_sync === false) continue;
    const history = integration.config?.history;
    // A download cut off by a restart is resumed after a cooldown, not on each boot.
    const historyStartedAt = Date.parse(history?.started_at || '') || 0;
    const interruptedPending = isSalesDoc
      && ((history?.status === 'RUNNING' && !SalesDocHistoryService.isRunning(integration.id)) || history?.refetch_all === true);
    const interrupted = interruptedPending && now - historyStartedAt >= INTERRUPTED_HISTORY_COOLDOWN_MS;
    if (interruptedPending && !interrupted) continue;
    const last = Math.max(lastAttempt.get(integration.id) || 0, Date.parse(integration.last_sync_at || '') || 0);
    if (!interrupted && now - last < interval) continue;
    lastAttempt.set(integration.id, now);

    if (isSalesDoc) {
      if (SalesDocHistoryService.isRunning(integration.id)) continue;
      SalesDocHistoryService.start(integration.company_id, integration.id, 'system-scheduler', history?.complete && !interrupted ? 'recent' : 'full', adapter as HistoryAdapter);
      started.push(integration.id);
    } else if (adapter.providerType === 'DISTRIBUTION' && !genericRunning.has(integration.id)) {
      genericRunning.add(integration.id);
      integrationProvider.syncProvider(integration.company_id, integration.provider_name, 'system-scheduler', 'system', integration.id)
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
