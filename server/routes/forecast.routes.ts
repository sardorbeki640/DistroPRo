import { Router } from 'express';
import type { Request, Response } from 'express';
import { requireAuth, requirePermission } from '../middleware/auth.middleware.ts';
import { ForecastService } from '../services/forecast.service.ts';
import { activeDistribution } from '../integrations/distribution.ts';

const router = Router();

/**
 * GET /api/forecast/run-rate - Days of inventory coverage based on sales velocity
 */
router.get('/run-rate', requireAuth, requirePermission('reports', 'view'), async (req: Request, res: Response, next) => {
  try {
    const companyId = req.user!.companyId;
    const factor = parseFloat(req.query.factor as string) || 1.0;
    
    let customMap: Record<string, number> | undefined;
    if (req.query.customDemand) {
      try {
        customMap = JSON.parse(req.query.customDemand as string);
      } catch {
        // ignore invalid json
      }
    }

    const connected = activeDistribution(companyId);
    let data: any;
    if (connected?.capabilities.history) {
      try { data = await ForecastService.getStockRunRateLive(companyId, factor, customMap); }
      catch (liveError) {
        console.warn('[Forecast] Jonli buyurtma tarixi olinmadi; saqlangan nusxa ishlatildi:', (liveError as Error).message);
        data = ForecastService.getStockRunRate(companyId, factor, customMap);
        data.history.warning = 'Tashqi tizimdan tarix vaqtincha olinmadi. Quyidagi hisob saqlangan nusxaga asoslangan; yangiligi cheklangan bo‘lishi mumkin.';
      }
    } else data = ForecastService.getStockRunRate(companyId, factor, customMap);
    res.json({
      success: true,
      ...data
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/forecast/out-of-stock - Stockout items, days missing, lost sales & lost profit
 */
router.get('/out-of-stock', requireAuth, requirePermission('reports', 'view'), async (req: Request, res: Response, next) => {
  try {
    const companyId = req.user!.companyId;
    const connected = activeDistribution(companyId);
    let data: any;
    if (connected?.capabilities.history) {
      try { data = await ForecastService.getOutOfStockLostProfitLive(companyId); }
      catch (liveError) {
        console.warn('[Forecast] Jonli tugagan mahsulot tarixi olinmadi; saqlangan nusxa ishlatildi:', (liveError as Error).message);
        data = ForecastService.getOutOfStockLostProfit(companyId);
        data.history = { source: 'SAVED_COPY', stale: true, warning: 'Tashqi tizimdan tarix vaqtincha olinmadi; natija saqlangan nusxaga asoslandi.' };
      }
    } else data = ForecastService.getOutOfStockLostProfit(companyId);
    res.json({
      success: true,
      ...data
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/forecast/send-admin-sms - Send SMS Alert to Administrator
 */
router.post('/send-admin-sms', requireAuth, requirePermission('integration', 'update'), (req: Request, res: Response, next) => {
  try {
    const companyId = req.user!.companyId;
    const { phone } = req.body;

    const result = ForecastService.sendAdminStockAlertSMS(
      companyId,
      req.user!.userId,
      req.user!.email,
      phone
    );

    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/forecast/sync - Auto-sync with integrated ERP/SFA
 */
router.post('/sync', requireAuth, requirePermission('integration', 'update'), async (req: Request, res: Response, next) => {
  try {
    const companyId = req.user!.companyId;
    const { provider } = req.body;

    const result = await ForecastService.syncIntegratedWarehouse(
      companyId,
      req.user!.userId,
      req.user!.email,
      provider
    );

    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
