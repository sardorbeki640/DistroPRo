import { Router } from 'express';
import type { Request, Response } from 'express';
import { AuditService } from '../services/audit.service.ts';
import { requireAuth, requirePermission } from '../middleware/auth.middleware.ts';
import type { AuditAction } from '../db/schema.ts';

const router = Router();

router.get('/logs', requireAuth, requirePermission('settings', 'view'), (req: Request, res: Response, next) => {
  try {
    const companyId = req.user!.companyId;
    const entity = req.query.entity as string | undefined;
    const action = req.query.action as AuditAction | undefined;
    const userId = req.query.user_id as string | undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;

    const logs = AuditService.getLogs(companyId, {
      entity,
      action,
      user_id: userId,
      limit
    });

    res.json({
      success: true,
      logs
    });
  } catch (err) {
    next(err);
  }
});

export default router;
