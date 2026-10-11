import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth, requirePermission, requireSuperAdmin } from '../middleware/auth.middleware.ts';
import { AttendanceService } from '../services/attendance.service.ts';
import { SheetsService } from '../services/sheets.service.ts';
import { StaffBotService } from '../services/staff-bot.service.ts';
import { AuthService } from '../services/auth.service.ts';
import { isValidIsoDate, businessToday } from '../utils/date.ts';

/** Face ID attendance: check-in from the employee's phone, enrollment, settings, reports and review (managers). */
const router = Router();
const who = (req: Request) => ({ id: req.user!.userId, email: req.user!.email });
const date = z.string().refine(isValidIsoDate, 'Sana YYYY-MM-DD bo‘lsin');

// ---- The employee ----
router.get('/me', requireAuth, (req, res, next) => {
  try { res.json({ success: true, ...AttendanceService.me(req.user!.companyId, req.user!.userId) }); } catch (e) { next(e); }
});
const CheckSchema = z.object({
  type: z.enum(['IN', 'OUT']),
  descriptor: z.array(z.number()).length(128),
  liveness_passed: z.boolean(),
  liveness_steps: z.array(z.string().max(30)).max(6).optional(),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
  accuracy_m: z.number().min(0).max(100000).nullable().optional(),
  photo: z.string().max(600_000).nullable().optional(),
  device: z.string().max(200).nullable().optional()
});
router.post('/check', requireAuth, (req, res, next) => {
  try {
    const r = AttendanceService.check(req.user!.companyId, who(req), CheckSchema.parse(req.body));
    res.status(r.event.status === 'REJECTED' ? 422 : 201).json({ success: r.event.status !== 'REJECTED', status: r.event.status, message: r.message, error: r.event.status === 'REJECTED' ? r.message : undefined });
  } catch (e) { next(e); }
});

// ---- Managers ----
router.get('/settings', requireAuth, requirePermission('employee', 'view'), (req, res, next) => {
  try { res.json({ success: true, settings: AttendanceService.settings(req.user!.companyId) }); } catch (e) { next(e); }
});
router.put('/settings', requireAuth, requirePermission('employee', 'update'), (req, res, next) => {
  try {
    const body = { ...(req.body || {}) };
    // Work places, their radius and the "only at the work place" rule are the super admin's; others keep them as they are.
    const current = AttendanceService.settings(req.user!.companyId);
    const places = (z: any[] = []) => JSON.stringify(z.map(x => [String(x.name || '').trim(), Number(x.lat), Number(x.lng), Math.round(Number(x.radius_m)), x.active !== false, [...(x.employee_ids || [])].sort(), String(x.address || '').trim()]));
    const touchesZones = (body.zones !== undefined && places(body.zones) !== places(current.zones)) || (body.require_zone !== undefined && !!body.require_zone !== !!current.require_zone);
    if (touchesZones && !AuthService.getUserPermissions(req.user!.userId).is_super_admin) {
      res.status(403).json({ success: false, error: 'Ish joyi lokatsiyasi va masofasini faqat super admin o‘zgartira oladi.' });
      return;
    }
    res.json({ success: true, settings: AttendanceService.saveSettings(req.user!.companyId, body, who(req)) });
  } catch (e) { next(e); }
});
/** Before the camera opens: is the phone at a work place? */
router.post('/zone-check', requireAuth, (req, res, next) => {
  try {
    const b = z.object({ lat: z.number().min(-90).max(90).nullable().optional(), lng: z.number().min(-180).max(180).nullable().optional(), accuracy_m: z.number().min(0).max(100000).nullable().optional() }).parse(req.body || {});
    res.json({ success: true, ...AttendanceService.zoneCheck(req.user!.companyId, req.user!.userId, b.lat, b.lng, b.accuracy_m) });
  } catch (e) { next(e); }
});
// Employees' faces and photos are entered only by the super admin; they stay until the super admin replaces them.
router.post('/enroll/:employeeId', requireAuth, requireSuperAdmin, (req, res, next) => {
  try {
    const body = z.object({
      samples: z.array(z.array(z.number()).length(128)).min(3).max(8), consent: z.boolean(),
      photo: z.string().max(600_000).nullable().optional(), source: z.enum(['CAMERA', 'PHOTO']).optional()
    }).parse(req.body);
    res.json({ success: true, ...AttendanceService.enroll(req.user!.companyId, req.params.employeeId, body.samples, body.consent, who(req), { photo: body.photo, source: body.source }), message: 'Face ID ro‘yxatga olindi.' });
  } catch (e) { next(e); }
});
// ---- Google Sheets: every start of work appended to the company's sheet ----
router.get('/sheets', requireAuth, requirePermission('employee', 'update'), (req, res, next) => {
  try { AttendanceService.settings(req.user!.companyId); res.json({ success: true, ...SheetsService.view(req.user!.companyId) }); } catch (e) { next(e); }
});
router.put('/sheets', requireAuth, requirePermission('employee', 'update'), (req, res, next) => {
  try {
    const body = z.object({ enabled: z.boolean(), url: z.string().trim().max(300) }).parse(req.body);
    res.json({ success: true, ...SheetsService.save(req.user!.companyId, body, who(req)) });
  } catch (e) { next(e); }
});
router.post('/sheets/test', requireAuth, requirePermission('employee', 'update'), async (req, res, next) => {
  try { res.json({ success: true, ...(await SheetsService.test(req.user!.companyId)) }); } catch (e) { next(e); }
});
// ---- Employees' Telegram accounts (set by the admin; for round videos in the group without opening the bot) ----
router.get('/telegram-accounts', requireAuth, requirePermission('employee', 'update'), (req, res, next) => {
  try { res.json({ success: true, ...StaffBotService.telegramAccounts(req.user!.companyId) }); } catch (e) { next(e); }
});
router.put('/telegram-accounts', requireAuth, requirePermission('employee', 'update'), (req, res, next) => {
  try {
    const body = z.object({ employee_id: z.string().max(80), telegram_user_id: z.string().max(30).nullable() }).parse(req.body);
    res.json({ success: true, ...StaffBotService.assignTelegram(req.user!.companyId, body.employee_id, body.telegram_user_id, who(req)), ...StaffBotService.telegramAccounts(req.user!.companyId) });
  } catch (e) { next(e); }
});
// ---- Violations posted to Telegram groups (each agent's own group, the couriers' common group) ----
router.get('/penalty-posts', requireAuth, requirePermission('employee', 'update'), (req, res, next) => {
  try { res.json({ success: true, ...AttendanceService.penaltyPostsView(req.user!.companyId) }); } catch (e) { next(e); }
});
router.put('/penalty-posts', requireAuth, requirePermission('employee', 'update'), (req, res, next) => {
  try {
    const map = z.record(z.string(), z.string().max(30));
    const body = z.object({ enabled: z.boolean(), groups: map.default({}), employees: map.default({}) }).parse(req.body);
    res.json({ success: true, ...AttendanceService.savePenaltyPosts(req.user!.companyId, body, who(req)) });
  } catch (e) { next(e); }
});
router.get('/profiles/:employeeId/photo', requireAuth, requirePermission('employee', 'view'), (req, res, next) => {
  try { res.setHeader('Cache-Control', 'private, no-store'); res.sendFile(AttendanceService.profilePhotoPath(req.user!.companyId, req.params.employeeId)); } catch (e) { next(e); }
});
router.delete('/enroll/:employeeId', requireAuth, requireSuperAdmin, (req, res, next) => {
  try { AttendanceService.removeProfile(req.user!.companyId, req.params.employeeId, who(req)); res.json({ success: true, message: 'Face ID profili o‘chirildi.' }); } catch (e) { next(e); }
});
router.get('/report', requireAuth, requirePermission('employee', 'view'), (req, res, next) => {
  try {
    const to = isValidIsoDate(String(req.query.to)) ? String(req.query.to) : businessToday();
    const from = isValidIsoDate(String(req.query.from)) ? String(req.query.from) : `${to.slice(0, 7)}-01`;
    res.json({ success: true, from, to, mode: AttendanceService.settings(req.user!.companyId).penalty.mode, rows: AttendanceService.report(req.user!.companyId, from, to, req.query.employee_id ? String(req.query.employee_id) : undefined) });
  } catch (e) { next(e); }
});
router.get('/events', requireAuth, requirePermission('employee', 'view'), (req, res, next) => {
  try {
    res.json({ success: true, events: AttendanceService.events(req.user!.companyId, { from: req.query.from as string, to: req.query.to as string, employee_id: req.query.employee_id as string, status: req.query.status as string }) });
  } catch (e) { next(e); }
});
router.get('/events/:id/photo', requireAuth, requirePermission('employee', 'view'), (req: Request, res: Response, next) => {
  try { res.setHeader('Cache-Control', 'private, max-age=3600'); res.sendFile(AttendanceService.photoPath(req.user!.companyId, req.params.id)); } catch (e) { next(e); }
});
router.post('/events/:id/review', requireAuth, requirePermission('employee', 'update'), (req, res, next) => {
  try {
    const body = z.object({ decision: z.enum(['ACCEPTED', 'REJECTED']), reason: z.string().max(300) }).parse(req.body);
    res.json({ success: true, event: AttendanceService.review(req.user!.companyId, req.params.id, body.decision, body.reason, who(req)) });
  } catch (e) { next(e); }
});
router.post('/excuse', requireAuth, requirePermission('employee', 'update'), (req, res, next) => {
  try {
    const body = z.object({ employee_id: z.string(), date, excused: z.boolean(), reason: z.string().max(300) }).parse(req.body);
    AttendanceService.excuse(req.user!.companyId, body.employee_id, body.date, body.excused, body.reason, who(req));
    res.json({ success: true });
  } catch (e) { next(e); }
});
// ---- Discipline rule book: violations (automatic + entered by hand) ----
router.get('/violations', requireAuth, requirePermission('employee', 'view'), (req, res, next) => {
  try {
    const month = /^\d{4}-\d{2}$/.test(String(req.query.month)) ? String(req.query.month) : businessToday().slice(0, 7);
    res.json({ success: true, month, violations: AttendanceService.violations(req.user!.companyId, month) });
  } catch (e) { next(e); }
});
router.post('/violations', requireAuth, requirePermission('employee', 'update'), (req, res, next) => {
  try {
    const body = z.object({ employee_id: z.string(), date, type: z.enum(['LATE', 'ABSENT', 'NASIYA_MISUSE', 'TASK_LATE', 'OTHER']), note: z.string().max(300) }).parse(req.body);
    res.status(201).json({ success: true, violation: AttendanceService.addViolation(req.user!.companyId, body, who(req)) });
  } catch (e) { next(e); }
});
router.post('/violations/:id/cancel', requireAuth, requirePermission('employee', 'update'), (req, res, next) => {
  try { AttendanceService.cancelViolation(req.user!.companyId, req.params.id, String(req.body?.reason || ''), who(req)); res.json({ success: true }); } catch (e) { next(e); }
});
/** Pulls agents' first visits from SalesDoc for a period now (the scheduler does today every 10 minutes). */
router.post('/sync-visits', requireAuth, requirePermission('employee', 'update'), async (req, res, next) => {
  try {
    const body = z.object({ from: date, to: date }).parse(req.body);
    if (Date.parse(body.to) - Date.parse(body.from) > 62 * 86400000) throw new Error('Bir martada ko‘pi bilan 2 oy.');
    const r = await AttendanceService.syncVisits(req.user!.companyId, body.from, body.to);
    res.json({ success: true, message: `${r.days} ta agent-kun yangilandi.` });
  } catch (e) { next(e); }
});
/** SalesDoc agents to link with employees (for the "first visit" start time). */
router.get('/agents', requireAuth, requirePermission('employee', 'view'), (req, res, next) => {
  try { res.json({ success: true, agents: AttendanceService.agentList(req.user!.companyId) }); } catch (e) { next(e); }
});

/** Who is enrolled (dates only; descriptors never leave the server). */
router.get('/profiles', requireAuth, requirePermission('employee', 'view'), (req, res, next) => {
  try { res.json({ success: true, profiles: AttendanceService.profiles(req.user!.companyId) }); } catch (e) { next(e); }
});

export default router;
