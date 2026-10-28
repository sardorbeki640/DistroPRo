import 'dotenv/config';
import express from 'express';
import path from 'path';
import { migrator } from './server/db/migrator.ts';
import { initialSchemaMigration } from './server/db/migrations/001_initial_schema.ts';
import { seedInitialDataMigration } from './server/db/migrations/002_seed_initial_data.ts';
import { cashCoreExtensionsMigration } from './server/db/migrations/003_cash_core_extensions.ts';
import { expensesPhase3Migration } from './server/db/migrations/004_expenses_phase3.ts';
import { customerBalanceSalaryAnalyticsMigration } from './server/db/migrations/005_customer_balance_salary_analytics.ts';
import { dataIntegrityRepairMigration } from './server/db/migrations/006_data_integrity_repair.ts';
import { crmAndStaffAccountsMigration } from './server/db/migrations/007_crm_and_staff_accounts.ts';
import { mergeDuplicateCustomersMigration } from './server/db/migrations/008_merge_duplicate_customers.ts';
import { orderReturnsMigration } from './server/db/migrations/009_order_returns.ts';
import { orderReturnsNetMigration } from './server/db/migrations/010_order_returns_net.ts';
import { sourceIntegrationTagsMigration } from './server/db/migrations/011_source_integration_tags.ts';
import { disableTestAccountsMigration } from './server/db/migrations/012_disable_test_accounts.ts';
import { geminiModelUpdateMigration } from './server/db/migrations/013_gemini_model_update.ts';
import { disableSampleBotMigration } from './server/db/migrations/014_disable_sample_bot.ts';
import { removeTestExpenseCategoriesMigration } from './server/db/migrations/015_remove_test_expense_categories.ts';
import { removeDefaultSalesDoctorMigration } from './server/db/migrations/016_remove_default_salesdoctor.ts';
import { removeSalesDoctorDefaultEndpointMigration } from './server/db/migrations/017_remove_salesdoctor_default_endpoint.ts';
import { startBotScheduler } from './server/services/bot.service.ts';
import { startStaffBotScheduler } from './server/services/staff-bot.service.ts';
import { startSheetsScheduler } from './server/services/sheets.service.ts';
import { startStrategyScheduler } from './server/services/agent-strategy.service.ts';
import { startAttendanceScheduler } from './server/services/attendance.service.ts';
import { startIntegrationScheduler } from './server/services/scheduler.service.ts';
import { startBackupScheduler } from './server/services/backup.service.ts';
import { db } from './server/db/database.ts';
import systemRoutes from './server/routes/system.routes.ts';
import crmRoutes from './server/routes/crm.routes.ts';
import staffRoutes from './server/routes/staff.routes.ts';
import exportRoutes from './server/routes/export.routes.ts';
import authRoutes from './server/routes/auth.routes.ts';
import cashRoutes from './server/routes/cash.routes.ts';
import expenseRoutes from './server/routes/expense.routes.ts';
import auditRoutes from './server/routes/audit.routes.ts';
import dashboardRoutes from './server/routes/dashboard.routes.ts';
import integrationRoutes from './server/routes/integration.routes.ts';
import customerRoutes from './server/routes/customer.routes.ts';
import salaryRoutes from './server/routes/salary.routes.ts';
import reportRoutes from './server/routes/report.routes.ts';
import productRoutes from './server/routes/product.routes.ts';
import forecastRoutes from './server/routes/forecast.routes.ts';
import aiRoutes from './server/routes/ai.routes.ts';
import attendanceRoutes from './server/routes/attendance.routes.ts';
import staffTelegramRoutes from './server/routes/staff-telegram.routes.ts';
import jarvisRoutes from './server/routes/jarvis.routes.ts';
import { JarvisService } from './server/jarvis/jarvis.service.ts';
import { errorHandler } from './server/middleware/error.middleware.ts';
import { SetupService } from './server/services/setup.service.ts';

async function startServer() {
  // Production must use a stable private key: it signs login tokens and encrypts saved API/bot credentials.
  // Generating a temporary key at boot would invalidate sessions on restart and could leave credentials unencrypted.
  if (process.env.NODE_ENV === 'production') {
    const jwtSecret = process.env.JWT_SECRET || '';
    if (jwtSecret.length < 32 || jwtSecret === 'distribution_finance_super_secret_jwt_key_2026') {
      throw new Error('Ishlab turgan server uchun JWT_SECRET sirlar bo‘limida kamida 32 belgili doimiy maxfiy kalit sifatida sozlanishi kerak.');
    }
  }
  const app = express();
  const portArgIndex = process.argv.indexOf('--port');
  const hostArgIndex = process.argv.indexOf('--host');
  const portArg = portArgIndex !== -1 ? process.argv[portArgIndex + 1] : undefined;
  const hostArg = hostArgIndex !== -1 ? process.argv[hostArgIndex + 1] : undefined;
  const PORT = Number(process.env.PORT || portArg || 3000);
  // Cloud platforms such as Render route traffic to the container's external interface.
  // Local launch scripts can still set HOST=127.0.0.1 explicitly.
  const HOST = process.env.HOST || hostArg || '0.0.0.0';

  // Behind a reverse proxy on the same machine (Caddy on the cloud server): req.ip is the visitor, not 127.0.0.1,
  // so login attempts are limited per visitor. Only the local proxy is trusted.
  if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 'loopback');
  // Render puts exactly one proxy of its own in front of the app (it sets RENDER=true).
  else if (process.env.RENDER === 'true') app.set('trust proxy', 1);

  // Large enough for a screen table sent to /api/exports/xlsx (tens of thousands of rows).
  app.use(express.json({ limit: '25mb' }));

  // Render must be able to reach a lightweight health endpoint while the remote
  // Turso snapshot is restored. That restore can take longer than Render's
  // health-check timeout; starting the listener first prevents restart loops.
  let databaseReady = false;
  app.get('/api/health', (_req, res) => {
    res.json({ status: databaseReady ? 'ok' : 'starting', version: '1.0.0-phase1-foundation', system: 'Distribution Finance System', time: new Date().toISOString() });
  });
  app.use('/api', (req, res, next) => {
    if (!databaseReady) {
      res.status(503).json({ success: false, error: 'Tizim bazadagi ma’lumotlarni yuklamoqda. Birozdan keyin qayta urinib ko‘ring.' });
      return;
    }
    next();
  });
  if (process.env.NODE_ENV === 'production') app.use(express.static(path.join(process.cwd(), 'dist')));
  const server = app.listen(PORT, HOST, () => {
    console.log(`Distribution Finance Server running on http://${HOST}:${PORT}`);
  });

  // Bootstrap Database & execute migrations
  try {
    migrator.register(initialSchemaMigration);
    migrator.register(seedInitialDataMigration);
    migrator.register(cashCoreExtensionsMigration);
    migrator.register(expensesPhase3Migration);
    migrator.register(customerBalanceSalaryAnalyticsMigration);
    migrator.register(dataIntegrityRepairMigration);
    migrator.register(crmAndStaffAccountsMigration);
    migrator.register(mergeDuplicateCustomersMigration);
    migrator.register(orderReturnsMigration);
    migrator.register(orderReturnsNetMigration);
    migrator.register(sourceIntegrationTagsMigration);
    migrator.register(disableTestAccountsMigration);
    migrator.register(geminiModelUpdateMigration);
    migrator.register(disableSampleBotMigration);
    migrator.register(removeTestExpenseCategoriesMigration);
    migrator.register(removeDefaultSalesDoctorMigration);
    migrator.register(removeSalesDoctorDefaultEndpointMigration);
    const result = await migrator.run();
    console.log(`[DB Boot] Migrations applied: ${result.executed.length}, previously applied: ${result.alreadyApplied.length}`);
  } catch (err) {
    throw err;
  }

  // A cloud test server can't do the first-run setup (it is allowed only from this computer's own browser), so the
  // owner comes from the host's secret settings. On a free host whose disk is wiped it is made again after each wipe.
  if (SetupService.required() && process.env.OWNER_EMAIL && process.env.OWNER_PASSWORD) {
    try { SetupService.createOwner(process.env.OWNER_EMAIL.trim(), process.env.OWNER_PASSWORD); console.log('[Setup] Egasi hisobi sozlamalardan yaratildi'); }
    catch (err: any) { console.warn('[Setup] Egasi hisobi yaratilmadi:', err.message); }
  }
  databaseReady = true;
  console.log('[DB Boot] Ma’lumotlar bazasi tayyor.');

  // API Routes
  // A successful write response is sent only after Turso confirms the transaction.
  app.use('/api', (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || !db.isTursoEnabled()) return next();
    const sendJson = res.json.bind(res);
    let waitingForTurso = false;
    res.json = ((body: any) => {
      if (res.statusCode >= 400) return sendJson(body);
      if (waitingForTurso) return res;
      waitingForTurso = true;
      void db.flushTurso().then(() => sendJson(body)).catch(error => {
        console.error('[Turso] Yozuv server javobidan oldin tasdiqlanmadi:', error.message);
        res.status(503);
        sendJson({ success: false, error: 'Ma’lumot Turso bazasiga saqlanmadi. Internet yoki baza sozlamasini tekshirib, keyin qayta urinib ko‘ring.' });
      });
      return res;
    }) as typeof res.json;
    next();
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/cash', cashRoutes);
  app.use('/api/expenses', expenseRoutes);
  app.use('/api/audit', auditRoutes);
  app.use('/api/dashboard', dashboardRoutes);
  app.use('/api/integrations', integrationRoutes);
  app.use('/api/customers', customerRoutes);
  app.use('/api/salaries', salaryRoutes);
  app.use('/api/reports', reportRoutes);
  app.use('/api/products', productRoutes);
  app.use('/api/forecast', forecastRoutes);
  app.use('/api/ai', aiRoutes);
  app.use('/api/crm', crmRoutes);
  app.use('/api/staff', staffRoutes);
  app.use('/api/exports', exportRoutes);
  app.use('/api/system', systemRoutes);
  app.use('/api/attendance', attendanceRoutes);
  app.use('/api/me/telegram', staffTelegramRoutes);
  app.use('/api/jarvis', jarvisRoutes);
  // An unknown API path is an error, not the web page (which the app would read as a broken answer).
  app.use('/api', (req, res) => { res.status(404).json({ success: false, error: `API topilmadi: ${req.method} ${req.originalUrl}` }); });

  // Global Error Handler
  app.use(errorHandler);

  // Vite middleware in development vs static SPA in production
  if (process.env.NODE_ENV !== 'production') {
    // Loaded only in development, so a production server needs no Vite installed.
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }
  // DISABLE_SCHEDULER=1 for a copy of the database that must not talk to SalesDoc on its own.
  if (process.env.NODE_ENV !== 'test' && process.env.DISABLE_SCHEDULER !== '1') startIntegrationScheduler();
  if (process.env.NODE_ENV !== 'test' && process.env.DISABLE_BACKUPS !== '1') startBackupScheduler();
  // DISABLE_BOTS=1 for a copy of the database that must not message the real Telegram chats.
  if (process.env.NODE_ENV !== 'test' && process.env.DISABLE_BOTS !== '1') { startBotScheduler(); startStaffBotScheduler(); startSheetsScheduler(); startStrategyScheduler(); JarvisService.startScheduler(); }
  // Preview-safe inbound polling: consume Telegram updates without sending reminders, penalty posts or bot replies.
  else if (process.env.NODE_ENV !== 'test' && process.env.ENABLE_TELEGRAM_POLLING === '1') startStaffBotScheduler();
  if (process.env.NODE_ENV !== 'test' && process.env.DISABLE_SCHEDULER !== '1') startAttendanceScheduler();

  // Free hosts (Render) put a service to sleep after 15 min without outside traffic. Only a request through the
  // public address counts, so the server calls its own public URL every 14 min. Off unless such a URL is set.
  const keepAliveUrl = (process.env.KEEPALIVE_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, '');
  if (process.env.NODE_ENV !== 'test' && /^https?:\/\//.test(keepAliveUrl) && process.env.DISABLE_KEEPALIVE !== '1') {
    const ping = () => fetch(`${keepAliveUrl}/api/health`, { signal: AbortSignal.timeout(30000) })
      .then(r => { if (!r.ok) console.warn('[KeepAlive] javob', r.status); })
      .catch(err => console.warn('[KeepAlive]', err?.message || err));
    setInterval(ping, 14 * 60_000);
    console.log(`[KeepAlive] har 14 daqiqada: ${keepAliveUrl}/api/health`);
  }

  // Graceful shutdown: pending changes are written and the database is closed cleanly.
  const shutdown = () => {
    server.close(() => {
      try { db.close(); } catch (e: any) { console.warn('[DB] Yopishda xato:', e.message); }
      process.exit(0);
    });
    setTimeout(() => { try { db.close(); } catch { /* closing */ } process.exit(0); }, 5000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

startServer();
