import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth, requirePermission } from '../middleware/auth.middleware.ts';
import { StaffService } from '../services/staff.service.ts';
import { CreateStaffAccountSchema, ResetStaffPasswordSchema } from '../validation/schemas.ts';
import { myPerformance } from '../services/agent-strategy.service.ts';
import { db } from '../db/database.ts';

const router = Router();
const operatorOf = (req: Request) => ({ userId: req.user!.userId, email: req.user!.email, companyId: req.user!.companyId });

// Personal cabinet of whoever is signed in: no permission needed beyond being signed in, and only own data.
router.get('/me/cabinet', requireAuth, (req: Request, res: Response, next) => {
  try {
    const month = typeof req.query.month === 'string' && /^\d{4}-\d{2}$/.test(req.query.month) ? req.query.month : undefined;
    res.json({ success: true, ...StaffService.cabinet(req.user!.userId, req.user!.companyId, month) });
  } catch (err) {
    next(err);
  }
});

const ProfileSchema = z.object({
  full_name: z.string().max(120).optional(), phone: z.string().max(30).optional(), position: z.string().max(80).optional(),
  login: z.string().max(60).optional(), email: z.string().max(120).optional()
});

// Own profile: everyone signed in.
// The agent's own results: this month against last month, with the AI strategy kept up to date for them.
router.get('/me/performance', requireAuth, (req: Request, res: Response, next) => {
  try { res.json({ success: true, ...myPerformance(req.user!.companyId, req.user!.userId) }); } catch (err) { next(err); }
});

router.get('/me/profile', requireAuth, (req: Request, res: Response, next) => {
  try { res.json({ success: true, profile: StaffService.myProfile(req.user!.userId, req.user!.companyId) }); } catch (err) { next(err); }
});

router.put('/me/profile', requireAuth, (req: Request, res: Response, next) => {
  try { res.json({ success: true, profile: StaffService.updateMyProfile(operatorOf(req), ProfileSchema.parse(req.body)) }); } catch (err) { next(err); }
});

// A staff member's profile: managers with settings:update.
router.put('/:employeeId/profile', requireAuth, requirePermission('settings', 'update'), (req: Request, res: Response, next) => {
  try { res.json({ success: true, row: StaffService.updateStaffProfile(operatorOf(req), req.params.employeeId, ProfileSchema.parse(req.body)) }); } catch (err) { next(err); }
});

router.get('/', requireAuth, requirePermission('settings', 'view'), (req: Request, res: Response, next) => {
  try {
    const roles = db.find('roles', r => r.company_id === req.user!.companyId).map(r => ({ id: r.id, name: r.name, description: r.description }));
    res.json({ success: true, staff: StaffService.list(req.user!.companyId), roles });
  } catch (err) {
    next(err);
  }
});

router.post('/:employeeId/account', requireAuth, requirePermission('settings', 'update'), (req: Request, res: Response, next) => {
  try {
    const input = CreateStaffAccountSchema.parse(req.body);
    res.status(201).json({ success: true, ...StaffService.createAccount(operatorOf(req), req.params.employeeId, input) });
  } catch (err) {
    next(err);
  }
});

router.post('/users/:userId/reset-password', requireAuth, requirePermission('settings', 'update'), (req: Request, res: Response, next) => {
  try {
    res.json({ success: true, ...StaffService.resetPassword(operatorOf(req), req.params.userId, ResetStaffPasswordSchema.parse(req.body || {})) });
  } catch (err) {
    next(err);
  }
});

router.post('/users/:userId/status', requireAuth, requirePermission('settings', 'update'), (req: Request, res: Response, next) => {
  try {
    const { status } = z.object({ status: z.enum(['ACTIVE', 'INACTIVE']) }).parse(req.body);
    StaffService.setStatus(operatorOf(req), req.params.userId, status);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.post('/users/:userId/role', requireAuth, requirePermission('settings', 'update'), (req: Request, res: Response, next) => {
  try {
    const { role_id } = z.object({ role_id: z.string().min(1) }).parse(req.body);
    StaffService.setRole(operatorOf(req), req.params.userId, role_id);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
