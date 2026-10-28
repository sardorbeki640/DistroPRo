import { Router } from 'express';
import type { Request, Response } from 'express';
import { requireAuth, requirePermission } from '../middleware/auth.middleware.ts';
import { integrationProvider } from '../integrations/provider.ts';
import { db } from '../db/database.ts';
import { AuditService } from '../services/audit.service.ts';
import type { Integration } from '../db/schema.ts';
import { SalesDocHistoryService } from '../services/salesdoc-history.service.ts';
import { isValidIsoDate } from '../utils/date.ts';
import { activeDistribution, distributionIntegrations, type ActiveDistribution } from '../integrations/distribution.ts';
import { tagIntegrationRows } from '../services/source-tagging.service.ts';

const router = Router();

/** Permanently remove a connection and its credentials while preserving, but hiding, its imported history. */
router.delete('/connection/:id', requireAuth, requirePermission('integration', 'create'), (req: Request, res: Response, next) => {
  try {
    const companyId = req.user!.companyId;
    const target = db.findOne('integrations', i => i.id === req.params.id && i.company_id === companyId);
    if (!target) { res.status(404).json({ success: false, error: 'Server ulanishi topilmadi.' }); return; }

    // Tag legacy imported records before the connection id is removed so they remain hidden.
    tagIntegrationRows(target.id);
    SalesDocHistoryService.stop(target.id);
    const shouldChooseNext = target.config?.primary === true;
    const next = shouldChooseNext
      ? distributionIntegrations(companyId)
          .filter(d => d.integration.id !== target.id && d.integration.status === 'CONNECTED' && !d.integration.disabled)
          .sort((a, b) => String(b.integration.last_sync_at || '').localeCompare(String(a.integration.last_sync_at || '')))[0]?.integration
      : undefined;
    db.transaction(() => {
      if (next) {
        for (const d of distributionIntegrations(companyId)) {
          const isNext = d.integration.id === next.id;
          if (!!d.integration.config?.primary !== isNext) db.update('integrations', d.integration.id, { config: { ...d.integration.config, primary: isNext } });
        }
      }
      db.delete('integrations', target.id);
    });
    AuditService.log({
      company_id: companyId, user_id: req.user!.userId, user_email: req.user!.email, action: 'DELETE', entity: 'Integration',
      entity_id: target.id, old_value: { provider_name: target.provider_name, connection_name: target.config?.connection_name || '', server_url: target.config?.server_url || '' },
      new_value: null, reason: 'Server ulanishi va saqlangan kirish ma’lumotlari o‘chirildi; import tarixi yashirildi'
    });
    res.json({ success: true, message: 'Server ulanishi o‘chirildi. Avvalgi import tarixi o‘chmadi va ko‘rinmaydi.' });
  } catch (err) { next(err); }
});

/** A changed endpoint/account is a new data source; keep the old rows attached to the old connection id. */
function sameConnectionSource(a: Record<string, any>, b: Record<string, any>) {
  const identity = (c: Record<string, any>) => JSON.stringify([
    String(c.server_url || '').trim().replace(/\/+$/, '').toLowerCase(),
    String(c.company_account_id || '').trim(), String(c.branch_code || '').trim(), String(c.database_name || '').trim(),
    String(c.auth_type || '').toUpperCase(), String(c.username || '').trim().toLowerCase(),
    String(c.api_token || ''), String(c.password || '')
  ]);
  return identity(a) === identity(b);
}

router.get('/list', requireAuth, requirePermission('integration', 'view'), (req: Request, res: Response, next) => {
  try {
    const companyId = req.user!.companyId;
    const registered = db.find('integrations', i => i.company_id === companyId);
    const adapters = integrationProvider.listAdapters();

    // Map registered integrations with safe masked configs
    const dists = new Map(distributionIntegrations(companyId).map(d => [d.integration.id, d]));
    const safeIntegrations = registered.map(item => {
      const cfg = item.config || {};
      const d = dists.get(item.id);
      return {
        ...item,
        system_name: d?.name || item.provider_name,
        capabilities: d?.capabilities || null,
        config: {
          connection_name: cfg.connection_name || '',
          forecast_days:cfg.forecast_days||100,
        order_date_field:cfg.order_date_field||'date',
        payment_cash_id:configuredPaymentId(cfg.payment_types?.CASH),
        payment_terminal_id:configuredPaymentId(cfg.payment_types?.TERMINAL),
        auth_type: cfg.auth_type || 'API_TOKEN',
          server_url: cfg.server_url || '',
          company_account_id: cfg.company_account_id || '',
          branch_code: cfg.branch_code || '',
          database_name: cfg.database_name || '',
          sync_interval: cfg.sync_interval || '1h',
          auto_sync: cfg.auto_sync !== false,
          primary: cfg.primary === true,
          has_token: Boolean(cfg.api_token),
          api_token_masked: cfg.api_token ? `${cfg.api_token.slice(0, 4)}••••${cfg.api_token.slice(-4)}` : null,
          has_password: Boolean(cfg.password),
          username: cfg.username || ''
        }
      };
    });

    res.json({
      success: true,
      integrations: safeIntegrations,
      availableAdapters: adapters
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/integrations/:provider/enabled { enabled } - Switch an integration off (settings kept) or back on.
 * Off: nothing is imported, synced or sent to it, and the cash register and forecasts ignore it.
 */
router.post('/:provider/enabled', requireAuth, requirePermission('integration', 'create'), async (req: Request, res: Response, next) => {
  try {
    const companyId = req.user!.companyId;
    const upperProvider = req.params.provider.toUpperCase();
    const integrationId = String(req.body?.integration_id || '');
    const record = db.findOne('integrations', i => i.company_id === companyId && i.provider_name.toUpperCase() === upperProvider && (!integrationId || i.id === integrationId));
    if (!record) {
      res.status(404).json({ success: false, error: 'Bu integratsiya hali sozlanmagan.' });
      return;
    }
    const enabled = req.body?.enabled === true;
    let message: string;
    if (!enabled) {
      // Preserve imported history, but attach legacy rows to this source so disabling it hides them everywhere.
      tagIntegrationRows(record.id);
      // A running history download is stopped (after the request in flight); months already loaded stay.
      const stopping = SalesDocHistoryService.stop(record.id);
      db.update('integrations', record.id, { disabled: true, status: 'DISCONNECTED' });
      message = `${upperProvider} o‘chirildi. Sozlamalar saqlanib qoldi.${stopping ? ' Tarix yuklanishi to‘xtatildi — yuklangan oylar saqlandi, qayta yoqilganda davom etadi.' : ''}`;
    } else {
      const check = await integrationProvider.getAdapter(upperProvider).testConnection(record.config).catch((e: any) => ({ ok: false, message: e.message }));
      db.update('integrations', record.id, { disabled: false, status: check.ok ? 'CONNECTED' : 'ERROR' });
      message = check.ok ? `${upperProvider} yoqildi.` : `${upperProvider} yoqildi, lekin ulanish tasdiqlanmadi: ${check.message}`;
    }
    AuditService.log({
      company_id: companyId, user_id: req.user!.userId, user_email: req.user!.email, action: 'UPDATE', entity: 'Integration',
      entity_id: upperProvider, old_value: { disabled: !!record.disabled }, new_value: { disabled: !enabled }, reason: message
    });
    res.json({ success: true, message });
  } catch (err) {
    next(err);
  }
});

/** Choose which connected distribution connection drives default reports and integration-backed screens. */
router.post('/:provider/primary', requireAuth, requirePermission('integration', 'create'), (req: Request, res: Response, next) => {
  try {
    const companyId = req.user!.companyId;
    const provider = String(req.params.provider || '').toUpperCase();
    const integrationId = String(req.body?.integration_id || '');
    const target = db.findOne('integrations', i => i.id === integrationId && i.company_id === companyId && i.provider_name.toUpperCase() === provider);
    if (!target || !distributionIntegrations(companyId).some(d => d.integration.id === target.id)) {
      res.status(404).json({ success: false, error: 'Tanlangan server ulanishi topilmadi.' });
      return;
    }
    if (target.disabled || target.status !== 'CONNECTED') {
      res.status(400).json({ success: false, error: 'Asosiy qilishdan oldin serverni yoqing va ulanishni tekshiring.' });
      return;
    }
    const rows = distributionIntegrations(companyId).map(d => d.integration);
    db.transaction(() => {
      for (const row of rows) {
        const isTarget = row.id === target.id;
        if (!!row.config?.primary !== isTarget) db.update('integrations', row.id, { config: { ...row.config, primary: isTarget } });
      }
    });
    AuditService.log({
      company_id: companyId, user_id: req.user!.userId, user_email: req.user!.email, action: 'UPDATE', entity: 'Integration',
      entity_id: target.id, old_value: null, new_value: { provider_name: provider, integration_id: target.id, connection_name: target.config?.connection_name || '' },
      reason: `${target.config?.connection_name || provider} asosiy server sifatida tanlandi`
    });
    res.json({ success: true, message: `${target.config?.connection_name || provider} asosiy server qilindi.` });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/integrations/config/:provider - Get saved configuration for a specific provider
 */
router.get('/config/:provider', requireAuth, requirePermission('integration', 'view'), (req: Request, res: Response, next) => {
  try {
    const providerName = req.params.provider.toUpperCase();
    const integrationRecord = db.findOne('integrations', i =>
      i.company_id === req.user!.companyId && i.provider_name.toUpperCase() === providerName &&
      (!req.query.integration_id || i.id === String(req.query.integration_id))
    );

    if (!integrationRecord) {
      res.json({
        success: true,
        configured: false,
        config: null
      });
      return;
    }

    const cfg = integrationRecord.config || {};
    res.json({
      success: true,
      configured: true,
      config: {
        auth_type: cfg.auth_type || 'API_TOKEN',
        server_url: cfg.server_url || '',
        company_account_id: cfg.company_account_id || '',
        branch_code: cfg.branch_code || '',
        database_name: cfg.database_name || '',
        username: cfg.username || '',
        // Secrets never leave the server. An empty field on save keeps the stored value.
        api_token: '',
        password: '',
        has_token: Boolean(cfg.api_token),
        has_password: Boolean(cfg.password),
        history_start_date: cfg.history_start_date || '',
        forecast_days: cfg.forecast_days || 100,
        sale_price_type_id: cfg.sale_price_type_id || '',
        sale_price_type_ids: cfg.sale_price_type_ids || (cfg.sale_price_type_id ? [cfg.sale_price_type_id] : []),
        purchase_price_type_id: cfg.purchase_price_type_id || '',
        sync_interval: cfg.sync_interval || '1h',
        auto_sync: cfg.auto_sync !== false,
        status: integrationRecord.status,
        integration_id: integrationRecord.id,
        connection_name: cfg.connection_name || '',
        last_sync_at: integrationRecord.last_sync_at
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/integrations/config - Save integration credentials (API Token or Server Login/Password)
 */
router.post('/config', requireAuth, requirePermission('integration', 'create'), async (req: Request, res: Response, next) => {
  try {
    const { 
      provider_name, 
      auth_type, 
      server_url, 
      api_token, 
      username, 
      password, 
      company_account_id, 
      branch_code, 
      database_name,
      sync_interval, 
      auto_sync, integration_id, connection_name
    } = req.body;

    if (!provider_name) {
      res.status(400).json({ success: false, error: 'provider_name kiritilishi shart' });
      return;
    }

    const upperProvider = provider_name.toUpperCase();
    const companyId = req.user!.companyId;
    if (!integration_id && db.findOne('integrations', i => i.company_id === companyId && i.provider_name.toUpperCase() === upperProvider) && !String(connection_name || '').trim()) {
      res.status(400).json({ success: false, error: 'Yangi ulanish uchun server nomini kiriting.' });
      return;
    }
    if (connection_name && db.findOne('integrations', i => i.company_id === companyId && i.provider_name.toUpperCase() === upperProvider && i.id !== integration_id && String(i.config?.connection_name || '').toLowerCase() === String(connection_name).trim().toLowerCase())) {
      res.status(400).json({ success: false, error: 'Bu server nomi oldin ishlatilgan. Boshqa nom tanlang.' });
      return;
    }

    const existing = integration_id
      ? db.findOne('integrations', i => i.id === String(integration_id) && i.company_id === companyId && i.provider_name.toUpperCase() === upperProvider)
      : (!connection_name ? db.findOne('integrations', i => i.company_id === companyId && i.provider_name.toUpperCase() === upperProvider) : undefined);

    const forecastDays=Number(req.body.forecast_days||existing?.config.forecast_days||100);
    if(!Number.isInteger(forecastDays)||forecastDays<1||forecastDays>3660) throw new Error('Prognoz davri 1–3660 kun bo‘lsin');
    const configPayload: Record<string, any> = {
      ...existing?.config,
      connection_name: String(connection_name || existing?.config?.connection_name || '').trim(),
      forecast_days:forecastDays,
      order_date_field:req.body.order_date_field==='dateLoad'?'dateLoad':'date',
      // Cash and old-debt payments go to the cash type; terminal and Click to the card type.
      payment_types:{...existing?.config.payment_types,...(req.body.payment_cash_id?{CASH:configuredPaymentRef(upperProvider, String(req.body.payment_cash_id)),OLD_DEBT:configuredPaymentRef(upperProvider, String(req.body.payment_cash_id))}:{}),...(req.body.payment_terminal_id?{TERMINAL:configuredPaymentRef(upperProvider, String(req.body.payment_terminal_id)),CLICK:configuredPaymentRef(upperProvider, String(req.body.payment_terminal_id))}:{})},
      // Which SalesDoc price type is the selling price and which the purchase cost ('' = detected automatically).
      ...(req.body.sale_price_type_id !== undefined ? { sale_price_type_id: String(req.body.sale_price_type_id || '') } : {}),
      ...(req.body.sale_price_type_ids !== undefined ? { sale_price_type_ids: Array.isArray(req.body.sale_price_type_ids) ? req.body.sale_price_type_ids.map(String).filter(Boolean) : [] } : {}),
      ...(req.body.purchase_price_type_id !== undefined ? { purchase_price_type_id: String(req.body.purchase_price_type_id || '') } : {}),
      auth_type: auth_type || 'API_TOKEN',
      server_url: (server_url || '').trim(),
      company_account_id: (company_account_id || '').trim(),
      branch_code: (branch_code || '').trim(),
      database_name: (database_name || '').trim(),
      sync_interval: sync_interval || '1h',
      auto_sync: auto_sync !== false
    };
    delete configPayload.uy_oplata_mode;
    if (configPayload.payment_types) delete configPayload.payment_types.HOME;

    if (auth_type === 'SERVER_CREDENTIALS') {
      configPayload.username = (username || '').trim();
      configPayload.password = password || (existing?.config?.password ?? '');
    } else {
      configPayload.api_token = api_token || (existing?.config?.api_token ?? '');
    }
    if (req.body.history_start_date !== undefined) {
      if (req.body.history_start_date && !isValidIsoDate(req.body.history_start_date)) throw new Error('Tarix boshlanish sanasi YYYY-MM-DD bo‘lsin');
      configPayload.history_start_date = req.body.history_start_date || undefined;
    }

    const sourceChanged = !!existing && !sameConnectionSource(existing.config || {}, configPayload);
    const requiresConnectionCheck = !existing || sourceChanged;
    // Saving options such as dates and price types must not wait on a remote login
    // or trigger a full data sync. Verify only a new or changed data source.
    const check = requiresConnectionCheck
      ? await integrationProvider.getAdapter(upperProvider).testConnection(configPayload).catch((e: any) => ({ ok: false, message: e.message }))
      : { ok: existing!.status === 'CONNECTED', message: 'Ulanish sozlamalari o‘zgarmadi; faqat parametrlar saqlandi.' };
    if (sourceChanged && !check.ok) {
      res.status(400).json({ success: false, error: `Yangi server ulanishi tasdiqlanmadi; amaldagi ulanish va uning ma’lumotlari saqlab qolindi: ${check.message}`, integration_id: existing!.id, connected: false });
      return;
    }
    // Saving the settings of a switched-off integration does not switch it back on.
    const status: Integration['status'] = existing?.disabled ? 'DISCONNECTED' : check.ok ? 'CONNECTED' : 'ERROR';

    let recordId: string;
    if (existing && sourceChanged) {
      // Preserve the previous source id so reports for the new endpoint cannot mix its imported history.
      tagIntegrationRows(existing.id);
      SalesDocHistoryService.stop(existing.id);
      db.update('integrations', existing.id, { disabled: true, status: 'DISCONNECTED', config: { ...existing.config, primary: false } });
      for (const other of db.find('integrations', i => i.company_id === companyId && i.id !== existing.id && i.config?.primary === true)) {
        db.update('integrations', other.id, { config: { ...other.config, primary: false } });
      }
      configPayload.primary = true;
      recordId = `int-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      db.insert('integrations', {
        id: recordId, company_id: companyId, provider_type: existing.provider_type, provider_name: upperProvider,
        status, disabled: !!existing.disabled, config: configPayload, last_sync_at: null, created_at: new Date().toISOString()
      });
    } else if (existing) {
      recordId = existing.id;
      db.update('integrations', existing.id, {
        config: configPayload,
        status
      });
    } else {
      recordId = `int-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const newRecord: Integration = {
        id: recordId,
        company_id: companyId,
        provider_type: 'DISTRIBUTION',
        provider_name: upperProvider,
        status,
        config: configPayload,
        last_sync_at: null,
        created_at: new Date().toISOString()
      };
      db.insert('integrations', newRecord);
    }

    AuditService.log({
      company_id: companyId,
      user_id: req.user!.userId,
      user_email: req.user!.email,
      action: 'UPDATE',
      entity: 'Integration',
      entity_id: upperProvider,
      old_value: null,
      new_value: {
        provider_name: upperProvider,
        auth_type: configPayload.auth_type,
        server_url: configPayload.server_url,
        username: configPayload.username
      },
      reason: sourceChanged
        ? `${upperProvider} yangi server sifatida ulandi; oldingi server o‘chirildi va uning tarixi eski ulanishga biriktirildi`
        : `${upperProvider} uchun server kabineti ulanish sozlamalari yangilandi`
    });

    if (!check.ok) {
      // Keep the saved record addressable by the UI so it can show the exact connection
      // failure and let the owner retry without losing the values they just entered.
      res.json({ success: true, connected: false, message: `Sozlamalar saqlandi, ammo ulanish tasdiqlanmadi: ${check.message}`, integration_id: recordId });
      return;
    }

    if (existing?.disabled) {
      res.json({ success: true, message: `${upperProvider} sozlamalari saqlandi. Ulanish o‘chirilgan — ishlatish uchun kartadagi “Yoqish” tugmasini bosing.`, integration_id: recordId });
      return;
    }

    let syncDetails: any = null;
    try {
      if (configPayload.auto_sync && requiresConnectionCheck) {
        syncDetails = await integrationProvider.syncProvider(
          companyId,
          upperProvider,
          req.user!.userId,
          req.user!.email,
          recordId
        );
        tagIntegrationRows(recordId);
      }
    } catch (syncErr: any) {
      console.warn('[Integration AutoSync] Failed to auto-sync on save:', syncErr.message);
    }

    const syncMsg = syncDetails?.details?.background
      ? `. ${syncDetails.details.message}`
      : syncDetails?.recordsImported ? `. ${syncDetails.recordsImported} ta yozuv sinxronlandi.` : '.';

    res.json({
      success: true,
      connected: true,
      message: `${upperProvider} ulandi va sozlamalar saqlandi${syncMsg}`,
      integration_id: recordId,
      sync: syncDetails
    });
  } catch (err) {
    next(err);
  }
});

/**
 * The integration a route is about: ":provider" may be a provider name (SALESDOC, LINKO, …), the old "salesdoc"/"salesdoctor"
 * paths, or "active" for whichever distribution system is connected now.
 */
function distributionFor(companyId: string, provider: string, integrationId?: string): ActiveDistribution | null {
  const p = String(provider || '').toUpperCase();
  if (integrationId) return distributionIntegrations(companyId).find(d => d.integration.id === integrationId && (!p || p === 'ACTIVE' || d.integration.provider_name.toUpperCase() === p)) || null;
  if (!p || p === 'ACTIVE') return activeDistribution(companyId);
  const all = distributionIntegrations(companyId);
  const sameName = (name: string) => name.toUpperCase() === p || (/^SALES_?DOC/.test(p) && /^SALES_?DOC/.test(name.toUpperCase()));
  const matches = all.filter(d => sameName(d.integration.provider_name));
  const active = activeDistribution(companyId);
  if (active && matches.some(d => d.integration.id === active.integration.id)) return active;
  const usable = matches.filter(d => d.integration.status === 'CONNECTED' && !d.integration.disabled);
  return usable.find(d => d.integration.config?.primary === true)
    || usable.slice().sort((a, b) => String(b.integration.last_sync_at || '').localeCompare(String(a.integration.last_sync_at || '')))[0]
    || matches[0]
    || null;
}

const notConnected = (res: Response, provider: string) =>
  res.status(404).json({ success: false, error: `${String(provider).toUpperCase() === 'ACTIVE' ? 'Distribyutor tizimi' : provider} ulanmagan` });
const configuredPaymentId = (value: any) => String(value?.SD_id ?? value?.id ?? value?.code_1C ?? '');
const configuredPaymentRef = (provider: string, value: string) => provider === 'LINKO' ? { id: value } : { SD_id: value };

/** The connected distribution system: its name and what it can do, so the screens adapt to it instead of a fixed system. */
// Any signed-in user: cashiers and managers see the system's name on their screens (no settings are returned).
router.get('/active', requireAuth, (req: Request, res: Response, next) => {
  try {
    const d = activeDistribution(req.user!.companyId);
    res.json({
      success: true,
      active: d ? { id: d.integration.id, provider: d.integration.provider_name, name: d.name, capabilities: d.capabilities, last_sync_at: d.integration.last_sync_at || null } : null,
      systems: distributionIntegrations(req.user!.companyId).map(x => ({ id: x.integration.id, provider: x.integration.provider_name, name: x.name, status: x.integration.status, disabled: !!x.integration.disabled, capabilities: x.capabilities }))
    });
  } catch (err) {
    next(err);
  }
});

/** Payment types of the connected system (what a cash payment is sent as), so the owner picks one instead of typing an ID. */
router.get('/:provider/payment-types', requireAuth, requirePermission('integration', 'view'), async (req: Request, res: Response, next) => {
  try {
    const d = distributionFor(req.user!.companyId, req.params.provider, String(req.query.integration_id || '') || undefined);
    if (!d) { notConnected(res, req.params.provider); return; }
    if (!d.adapter.listPaymentTypes) { res.status(400).json({ success: false, error: `${d.name} to‘lov turlarini bermaydi.` }); return; }
    const list = await d.adapter.listPaymentTypes(d.integration.config);
    res.json({
      success: true,
      system: d.name,
      paymentTypes: list.map(t => ({ SD_id: t.id, id: t.id, name: t.name, active: t.active })),
      selected: { cash: configuredPaymentId(d.integration.config?.payment_types?.CASH), terminal: configuredPaymentId(d.integration.config?.payment_types?.TERMINAL) }
    });
  } catch (err) {
    next(err);
  }
});

/** Price types of the connected system, and which one is used as selling price and which as purchase cost (chosen or detected). */
router.get('/:provider/price-types', requireAuth, requirePermission('integration', 'view'), async (req: Request, res: Response, next) => {
  try {
    const d = distributionFor(req.user!.companyId, req.params.provider, String(req.query.integration_id || '') || undefined);
    if (!d) { notConnected(res, req.params.provider); return; }
    if (!d.adapter.listPriceTypes) { res.status(400).json({ success: false, error: `${d.name} narx turlarini bermaydi.` }); return; }
    const types = await d.adapter.listPriceTypes(d.integration.config);
    const cfg = d.integration.config || {};
    const pick = (kind: 'sale' | 'purchase', chosen?: string) =>
      (chosen && types.find(t => t.id === chosen)) || types.find(t => t.kind === kind && t.active) || types.find(t => t.kind === kind) || null;
    const a = d.adapter as any;
    const used = (kind: 'sale' | 'purchase', chosen?: string) => (typeof a.pickPriceType === 'function' ? a.pickPriceType(types, kind, chosen) : pick(kind, chosen))?.id || null;
    res.json({
      success: true,
      system: d.name,
      priceTypes: types,
      selected: { sale: cfg.sale_price_type_ids || (cfg.sale_price_type_id ? [cfg.sale_price_type_id] : []), purchase: cfg.purchase_price_type_id || '' },
      used: { sale: used('sale', cfg.sale_price_type_id), purchase: used('purchase', cfg.purchase_price_type_id) }
    });
  } catch (err) {
    next(err);
  }
});

/** Progress and coverage of the order history (polled by the UI while a download runs). ?provider=LINKO for a given system. */
router.get('/:provider/history-status', requireAuth, requirePermission('integration', 'view'), (req: Request, res: Response, next) => {
  try {
    const companyId = req.user!.companyId;
    const asked = String(req.query.provider || '');
    // Old path "/salesdoc/history-status" without ?provider still means SalesDoc.
    const integrationId = String(req.query.integration_id || '');
    const d = distributionFor(companyId, asked || req.params.provider, integrationId || undefined);
    const integration = d?.integration;
    if (!integration) { res.json({ success: true, configured: false, history: null }); return; }
    const history = SalesDocHistoryService.getState(integration.id);
    res.json({
      success: true,
      configured: true,
      system: d!.name,
      running: SalesDocHistoryService.isRunning(integration.id),
      // A RUNNING state without a live job means the server stopped mid-download; the next run resumes it.
      history: history ? { ...history, chunks: undefined, months: Object.keys(history.chunks || {}).length } : null
    });
  } catch (err) {
    next(err);
  }
});

/** Summary of the connected distribution system (orders, payments, customers it brought). Old path: /salesdoctor/summary. */
router.get('/:provider/summary', requireAuth, requirePermission('integration', 'view'), (req: Request, res: Response, next) => {
  try {
    const companyId = req.user!.companyId;
    const provider = /^salesdoctor$/i.test(req.params.provider) ? 'active' : req.params.provider;
    const d = distributionFor(companyId, provider) || (provider === 'active' ? distributionIntegrations(companyId)[0] || null : null);
    const integration = d?.integration || null;
    const fromIt = (x: { source_integration_id?: string | null }) => !integration || !x.source_integration_id || x.source_integration_id === integration.id;

    const orders = db.find('sales_orders', o => o.company_id === companyId && o.source === 'DISTRIBUTION' && fromIt(o as any)).slice(0, 50);
    const extOrders = db.find('external_orders', o => o.company_id === companyId && (!integration || o.integration_id === integration.id)).slice(0, 50);
    const extPayments = db.find('external_payments', p => p.company_id === companyId && (!integration || p.integration_id === integration.id)).slice(0, 50);
    const customers = db.find('customers', c => c.company_id === companyId && !!integration && (c as any).source_integration_id === integration.id).slice(0, 50);

    const totalSalesAmount = orders.reduce((sum, o) => sum + o.total_sales, 0);
    const totalPaymentsAmount = extPayments.reduce((sum, p) => sum + p.amount, 0);

    const safeIntegration = integration ? { ...integration, config: { ...integration.config, password: undefined, api_token: undefined, history: undefined } } : null;
    res.json({
      success: true,
      system: d?.name || null,
      capabilities: d?.capabilities || null,
      connected: Boolean(integration && integration.status === 'CONNECTED' && !integration.disabled),
      integration: safeIntegration,
      stats: {
        totalOrdersCount: orders.length || extOrders.length,
        totalSalesAmount,
        totalPaymentsCount: extPayments.length,
        totalPaymentsAmount,
        customersCount: customers.length,
        lastSyncAt: integration?.last_sync_at || null
      },
      recentOrders: orders.length > 0 ? orders : extOrders,
      recentPayments: extPayments,
      customers
    });
  } catch (err) {
    next(err);
  }
});

router.post('/sync', requireAuth, requirePermission('integration', 'create'), async (req: Request, res: Response, next) => {
  try {
    const { provider_name, integration_id } = req.body;
    if (!provider_name) {
      res.status(400).json({ success: false, error: 'provider_name kiritilishi shart' });
      return;
    }

    const result = await integrationProvider.syncProvider(
      req.user!.companyId,
      provider_name,
      req.user!.userId,
      req.user!.email,
      integration_id
    );
    const syncedIntegration = db.findOne('integrations', i => i.company_id === req.user!.companyId && i.provider_name.toUpperCase() === String(provider_name).toUpperCase() && (!integration_id || i.id === integration_id));
    if (syncedIntegration && result.status !== 'FAILED') tagIntegrationRows(syncedIntegration.id);

    res.json({
      success: true,
      result
    });
  } catch (err) {
    next(err);
  }
});

router.post('/test-connection', requireAuth, requirePermission('integration', 'create'), async (req: Request, res: Response, next) => {
  try {
    const { provider_name, config, integration_id } = req.body;
    if (!provider_name) {
      res.status(400).json({ success: false, error: 'provider_name kiritilishi shart' });
      return;
    }

    const adapter = integrationProvider.getAdapter(provider_name);
    const integrationRecord = db.findOne('integrations', i =>
      i.company_id === req.user!.companyId && i.provider_name.toUpperCase() === provider_name.toUpperCase() &&
      (!integration_id || i.id === integration_id)
    );

    // Form fields override saved ones, but an empty secret field means "use the saved secret".
    const saved = integrationRecord?.config || {};
    const effectiveConfig = { ...saved, ...(config || {}) };
    if (!config?.password) effectiveConfig.password = saved.password;
    if (!config?.api_token) effectiveConfig.api_token = saved.api_token;
    const result = await adapter.testConnection(effectiveConfig);

    res.json({
      success: true,
      result
    });
  } catch (err) {
    next(err);
  }
});

export default router;
