import { Router } from 'express';
import type { Request, Response } from 'express';
import { requireAuth, requirePermission } from '../middleware/auth.middleware.ts';
import { AIService } from '../services/ai.service.ts';
import { ForecastService } from '../services/forecast.service.ts';
import { AuthService } from '../services/auth.service.ts';

const router = Router();

/**
 * GET /api/ai/analysis - Generate deep AI audit and insights for the business
 */
router.get('/analysis', requireAuth, requirePermission('reports', 'view'), async (req: Request, res: Response, next) => {
  try {
    const companyId = req.user!.companyId;
    const result = await AIService.generateAuditAnalysis(companyId);
    res.json({
      success: true,
      analysis: result
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/ai/chat - Interactive AI Agent chat
 */
router.post('/chat', requireAuth, requirePermission('reports', 'view'), async (req: Request, res: Response, next) => {
  try {
    const companyId = req.user!.companyId;
    const { message, history } = req.body;

    if (!message || typeof message !== 'string') {
      res.status(400).json({ success: false, error: 'Xabar matni kiritilishi shart' });
      return;
    }

    const result = await AIService.chatWithAgent(companyId, message, history || []);

    // If an action was triggered (e.g. SEND_ADMIN_SMS)
    if (result.actionTriggered?.type === 'SEND_ADMIN_SMS') {
      if (!AuthService.hasPermission(req.user!.userId, 'notifications', 'create')) {res.status(403).json({error:'Xabar yuborish huquqi yo‘q'});return;}
      const smsRes = ForecastService.sendAdminStockAlertSMS(
        companyId,
        req.user!.userId,
        req.user!.email,
        result.actionTriggered.details?.phone
      );
      (result as any).actionResult = smsRes;
    } else if (result.actionTriggered?.type === 'SYNC_INTEGRATION') {
      if (!AuthService.hasPermission(req.user!.userId, 'integration', 'update')) {res.status(403).json({error:'Sinxronlash huquqi yo‘q'});return;}
      const syncRes = await ForecastService.syncIntegratedWarehouse(
        companyId,
        req.user!.userId,
        req.user!.email,
        result.actionTriggered.details?.provider || '1C'
      );
      (result as any).actionResult = syncRes;
    }

    res.json({
      success: true,
      ...result
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/ai/business-profile - Real-time full business intelligence dossier
 */
router.get('/business-profile', requireAuth, requirePermission('reports', 'view'), (req: Request, res: Response, next) => {
  try {
    const companyId = req.user!.companyId;
    const profile = AIService.getCompleteBusinessProfile(companyId);
    res.json({
      success: true,
      profile
    });
  } catch (err) {
    next(err);
  }
});

export default router;
