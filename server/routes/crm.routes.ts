import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth, requirePermission } from '../middleware/auth.middleware.ts';
import { CrmService } from '../services/crm.service.ts';
import type { Actor } from '../services/crm.service.ts';

const router = Router();
const actorOf = (req: Request): Actor => ({ userId: req.user!.userId, email: req.user!.email, companyId: req.user!.companyId });
const q = (req: Request, key: string) => (typeof req.query[key] === 'string' ? req.query[key] as string : undefined);
const handle = (fn: (req: Request, res: Response) => any) => (req: Request, res: Response, next: NextFunction) => {
  try { const out = fn(req, res); if (out !== undefined) res.json({ success: true, ...out }); } catch (err) { next(err); }
};

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional();
const TaskInput = z.object({
  title: z.string().trim().min(2, 'Vazifa nomini yozing').max(200),
  description: z.string().max(2000).optional(),
  assignee_user_id: z.string().optional(),
  customer_id: z.string().nullable().optional(),
  deal_id: z.string().nullable().optional(),
  due_date: date,
  priority: z.enum(['LOW', 'NORMAL', 'HIGH']).optional()
});
const TaskPatch = z.object({
  title: z.string().trim().min(2).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  assignee_user_id: z.string().optional(),
  due_date: date,
  priority: z.enum(['LOW', 'NORMAL', 'HIGH']).optional(),
  status: z.enum(['OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED']).optional()
});
const ActivityInput = z.object({
  customer_id: z.string().nullable().optional(),
  deal_id: z.string().nullable().optional(),
  type: z.enum(['CALL', 'VISIT', 'MEETING', 'MESSAGE', 'NOTE']),
  result: z.enum(['REACHED', 'NO_ANSWER', 'INTERESTED', 'NOT_INTERESTED', 'ORDER', 'PAYMENT_PROMISE', 'COMPLAINT', 'OTHER']),
  note: z.string().trim().min(2, 'Natijani qisqa yozing').max(2000),
  next_step: z.string().max(300).nullable().optional(),
  next_action_date: date
});
const DealInput = z.object({
  title: z.string().trim().min(2).max(200).optional(),
  customer_id: z.string().nullable().optional(),
  contact_name: z.string().max(120).nullable().optional(),
  contact_phone: z.string().max(40).nullable().optional(),
  company_name: z.string().max(160).nullable().optional(),
  source: z.string().max(80).nullable().optional(),
  amount: z.number().min(0).optional(),
  stage_id: z.string().optional(),
  owner_user_id: z.string().optional(),
  expected_close_date: date,
  lost_reason: z.string().max(300).nullable().optional(),
  note: z.string().max(2000).nullable().optional()
});
const StageInput = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1).max(60),
  probability: z.number().min(0).max(100),
  kind: z.enum(['OPEN', 'WON', 'LOST']),
  sort_order: z.number().int().optional()
});

router.use(requireAuth, requirePermission('crm', 'view'));

router.get('/summary', handle(req => ({ summary: CrmService.summary(actorOf(req)), sees_all: CrmService.seesAll(actorOf(req)) })));
router.get('/users', handle(req => ({ users: CrmService.users(actorOf(req)) })));
router.get('/customers', handle(req => ({ customers: CrmService.searchCustomers(actorOf(req), q(req, 'q') || '') })));
router.get('/customers/:id/overview', handle(req => CrmService.customerOverview(actorOf(req), req.params.id)));
router.patch('/customers/:id', requirePermission('crm', 'update'), handle(req => {
  const patch = z.object({
    tags: z.array(z.string().max(40)).optional(),
    owner_user_id: z.string().nullable().optional(),
    contacts: z.array(z.object({ name: z.string().max(120), phone: z.string().max(40).optional(), role: z.string().max(60).optional() })).optional(),
    comment: z.string().max(2000).nullable().optional()
  }).parse(req.body);
  return { customer: CrmService.updateCustomerCrm(actorOf(req), req.params.id, patch) };
}));

router.get('/tasks', handle(req => ({ tasks: CrmService.listTasks(actorOf(req), { scope: q(req, 'scope'), status: q(req, 'status'), customer_id: q(req, 'customer_id'), deal_id: q(req, 'deal_id'), due: q(req, 'due'), assignee: q(req, 'assignee') }) })));
router.post('/tasks', requirePermission('crm', 'update'), (req, res, next) => {
  try { res.status(201).json({ success: true, task: CrmService.createTask(actorOf(req), TaskInput.parse(req.body)) }); } catch (err) { next(err); }
});
router.patch('/tasks/:id', requirePermission('crm', 'update'), handle(req => ({ task: CrmService.updateTask(actorOf(req), req.params.id, TaskPatch.parse(req.body)) })));
router.delete('/tasks/:id', requirePermission('crm', 'update'), handle(req => { CrmService.deleteTask(actorOf(req), req.params.id); return {}; }));

router.get('/activities', handle(req => ({ activities: CrmService.listActivities(actorOf(req), { customer_id: q(req, 'customer_id'), deal_id: q(req, 'deal_id'), user_id: q(req, 'user_id'), from: q(req, 'from'), to: q(req, 'to'), scope: q(req, 'scope') }) })));
router.post('/activities', requirePermission('crm', 'update'), (req, res, next) => {
  try { res.status(201).json({ success: true, activity: CrmService.logActivity(actorOf(req), ActivityInput.parse(req.body)) }); } catch (err) { next(err); }
});

router.get('/stages', handle(req => ({ stages: CrmService.stages(req.user!.companyId) })));
router.post('/stages', requirePermission('crm', 'manage'), handle(req => ({ stage: CrmService.saveStage(actorOf(req), StageInput.parse(req.body)) })));
router.delete('/stages/:id', requirePermission('crm', 'manage'), handle(req => { CrmService.deleteStage(actorOf(req), req.params.id); return {}; }));

router.get('/deals', handle(req => CrmService.listDeals(actorOf(req), { scope: q(req, 'scope'), status: q(req, 'status'), owner: q(req, 'owner'), customer_id: q(req, 'customer_id') })));
router.post('/deals', requirePermission('crm', 'create'), (req, res, next) => {
  try { res.status(201).json({ success: true, deal: CrmService.saveDeal(actorOf(req), DealInput.parse(req.body)) }); } catch (err) { next(err); }
});
router.patch('/deals/:id', requirePermission('crm', 'update'), handle(req => ({ deal: CrmService.saveDeal(actorOf(req), DealInput.parse(req.body), req.params.id) })));
router.delete('/deals/:id', requirePermission('crm', 'delete'), handle(req => { CrmService.deleteDeal(actorOf(req), req.params.id); return {}; }));

export default router;
