import { Router } from 'express';
import { businessToday } from '../utils/date.ts';
import type { Request, Response } from 'express';
import { requireAuth, requirePermission } from '../middleware/auth.middleware.ts';
import { AnalyticsService } from '../services/analytics.service.ts';
import { CustomerBalanceService } from '../services/customer_balance.service.ts';
import { NotificationService } from '../services/notification.service.ts';
import { compareAgent, comparePeriods } from '../services/compare.service.ts';
import { TeamsService } from '../services/teams.service.ts';
import { agentStrategy } from '../services/agent-strategy.service.ts';
import { activeDistribution } from '../integrations/distribution.ts';
import { db } from '../db/database.ts';
import { z } from 'zod';

const router = Router();

/**
 * GET /api/reports/pnl - Executive Profit & Loss Statement
 */
router.get('/pnl', requireAuth, requirePermission('reports', 'view'), (req: Request, res: Response, next) => {
  try {
    const fromDate = (req.query.from_date as string) || businessToday().slice(0, 8) + '01';
    const toDate = (req.query.to_date as string) || businessToday();
    const integrationId = req.query.integration_id ? String(req.query.integration_id) : undefined;

    const pnl = AnalyticsService.getProfitAndLoss(req.user!.companyId, fromDate, toDate, integrationId);
    res.json({
      success: true,
      report: pnl
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/reports/compare?a_from&a_to&b_from&b_to - two periods side by side (P&L, expenses, agents, products, customers)
 */
router.get('/compare', requireAuth, requirePermission('reports', 'view'), (req: Request, res: Response, next) => {
  try {
    const q = (k: string) => String(req.query[k] || '');
    const companyId = req.user!.companyId;
    const requested = req.query.integration_id === undefined ? undefined : String(req.query.integration_id);
    const integrationId = requested === 'all' ? undefined : requested || activeDistribution(companyId)?.integration.id;
    if (integrationId && !db.findOne('integrations', i => i.id === integrationId && i.company_id === companyId && !i.disabled)) {
      res.status(404).json({ success: false, error: 'Tanlangan server topilmadi yoki o‘chirilgan.' });
      return;
    }
    res.json({ success: true, integration_id: integrationId || null, ...comparePeriods(companyId, { from: q('a_from'), to: q('a_to') }, { from: q('b_from'), to: q('b_to') }, integrationId) });
  } catch (err) {
    next(err);
  }
});

/** Sales teams: which product categories each team sells (one agent profile shared by several people). */
router.get('/teams', requireAuth, requirePermission('reports', 'view'), (req: Request, res: Response, next) => {
  try { res.json({ success: true, ...TeamsService.view(req.user!.companyId) }); } catch (err) { next(err); }
});
router.put('/teams', requireAuth, requirePermission('settings', 'update'), (req: Request, res: Response, next) => {
  try {
    const body = z.object({ teams: z.array(z.object({
      id: z.string().max(80).optional(), name: z.string().max(60),
      categories: z.array(z.string().max(200)).max(500), members: z.record(z.string(), z.string().max(80)).optional(),
      member_employees: z.record(z.string(), z.string().max(80)).optional()
    })).max(20) }).parse(req.body);
    res.json({ success: true, ...TeamsService.save(req.user!.companyId, body.teams, { id: req.user!.userId, email: req.user!.email }) });
  } catch (err) { next(err); }
});

/** POST /api/reports/compare/agent/:agentId/strategy { a, b, force } - a growth plan for the agent written by the company's AI */
router.post('/compare/agent/:agentId/strategy', requireAuth, requirePermission('reports', 'view'), async (req: Request, res: Response, next) => {
  try {
    const p = z.object({ from: z.string(), to: z.string() });
    const body = z.object({ a: p, b: p, force: z.boolean().optional(), integration_id: z.string().nullable().optional() }).parse(req.body);
    const companyId = req.user!.companyId;
    const integrationId = body.integration_id === 'all' ? undefined : body.integration_id || activeDistribution(companyId)?.integration.id;
    if (integrationId && !db.findOne('integrations', i => i.id === integrationId && i.company_id === companyId && !i.disabled)) {
      res.status(404).json({ success: false, error: 'Tanlangan server topilmadi yoki o‘chirilgan.' });
      return;
    }
    res.json({ success: true, ...(await agentStrategy(companyId, req.params.agentId, body.a, body.b, body.force, undefined, integrationId)) });
  } catch (err) { next(err); }
});

/** GET /api/reports/compare/agent/:agentId?a_from&a_to&b_from&b_to - one agent in depth (by day, category, product, customer) */
router.get('/compare/agent/:agentId', requireAuth, requirePermission('reports', 'view'), (req: Request, res: Response, next) => {
  try {
    const q = (k: string) => String(req.query[k] || '');
    const companyId = req.user!.companyId;
    const requested = req.query.integration_id === undefined ? undefined : String(req.query.integration_id);
    const integrationId = requested === 'all' ? undefined : requested || activeDistribution(companyId)?.integration.id;
    if (integrationId && !db.findOne('integrations', i => i.id === integrationId && i.company_id === companyId && !i.disabled)) {
      res.status(404).json({ success: false, error: 'Tanlangan server topilmadi yoki o‘chirilgan.' });
      return;
    }
    res.json({ success: true, integration_id: integrationId || null, ...compareAgent(companyId, req.params.agentId, { from: q('a_from'), to: q('a_to') }, { from: q('b_from'), to: q('b_to') }, integrationId) });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/reports/gross-profit - Gross Profit breakdown
 */
router.get('/gross-profit', requireAuth, requirePermission('reports', 'view'), (req: Request, res: Response, next) => {
  try {
    const fromDate = (req.query.from_date as string) || businessToday().slice(0, 8) + '01';
    const toDate = (req.query.to_date as string) || businessToday();
    const groupBy = (req.query.group_by as 'AGENT' | 'TERRITORY' | 'CUSTOMER') || 'AGENT';
    const integrationId = req.query.integration_id ? String(req.query.integration_id) : undefined;

    const breakdown = AnalyticsService.getGrossProfitBreakdown(req.user!.companyId, groupBy, fromDate, toDate, integrationId);
    res.json({
      success: true,
      rows: breakdown
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/reports/aging - Accounts Receivable (AR) Aging Analysis
 */
router.get('/aging', requireAuth, requirePermission('reports', 'view'), (req: Request, res: Response, next) => {
  try {
    const asOfDate = (req.query.as_of_date as string) || businessToday();
    const rows = AnalyticsService.getAgingReport(req.user!.companyId, asOfDate);
    res.json({
      success: true,
      as_of_date: asOfDate,
      rows
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/reports/balance-sheet - Dedicated Executive Financial Balance Sheet
 */
router.get('/balance-sheet', requireAuth, requirePermission('reports', 'view'), (req: Request, res: Response, next) => {
  try {
    const asOfDate = (req.query.as_of_date as string) || businessToday();
    const balance = AnalyticsService.getBalanceSheet(req.user!.companyId, asOfDate);
    res.json({
      success: true,
      balance
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/reports/notifications - Outbound alerts and telegram queue
 */
router.get('/notifications', requireAuth, requirePermission('reports', 'view'), (req: Request, res: Response, next) => {
  try {
    const notifs = NotificationService.listNotifications(req.user!.companyId);
    res.json({
      success: true,
      notifications: notifs
    });
  } catch (err) {
    next(err);
  }
});

export default router;
