import { Router } from 'express';
import { businessToday } from '../utils/date.ts';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth, requirePermission } from '../middleware/auth.middleware.ts';
import { AuthService } from '../services/auth.service.ts';
import { SalaryService, cleanPayComponents } from '../services/salary.service.ts';
import { isValidIsoDate } from '../utils/date.ts';
import { db } from '../db/database.ts';

const router = Router();

const CalculateSalarySchema = z.object({
  employee_id: z.string().min(1, 'Xodim tanlanishi shart.'),
  period_month: z.string().regex(/^\d{4}-\d{2}$/, 'Davr YYYY-MM formatida bo\'lishi kerak.')
});

const PaySalarySchema = z.object({
  salary_id: z.string().min(1, 'Maosh hujjati tanlanishi shart.'),
  cash_day_id: z.string().optional().default(''),
  payment_method: z.enum(['CASH', 'BANK_TRANSFER']).default('CASH')
});

const RecordPieceworkSchema = z.object({
  employee_id: z.string().min(1, 'Xodim tanlanishi shart.'),
  units_completed: z.number().positive('Bajarilgan hajm 0 dan katta bo\'lishi shart.'),
  rate_applied: z.number().positive('Stavka 0 dan katta bo\'lishi shart.'),
  date: z.string().optional()
});

/**
 * GET /api/salaries/employees - List all employees (enriched with base salary, limits, and agent data)
 */
router.get('/employees', requireAuth, requirePermission('employee', 'view'), (req: Request, res: Response, next) => {
  try {
    const employees = SalaryService.getEnrichedEmployees(req.user!.companyId);
    res.json({
      success: true,
      employees
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/salaries/employees - Create new employee
 */
router.post('/employees', requireAuth, requirePermission('employee', 'create'), (req: Request, res: Response, next) => {
  try {
    const { 
      full_name, 
      position, 
      phone, 
      salary_type, 
      base_salary, 
      daily_expense_limit, 
      status, 
      is_agent, 
      agent_code, 
      commission_rate, 
      territory_id 
    } = req.body;

    if (!full_name || !full_name.trim()) {
      return res.status(400).json({ success: false, message: "Xodim F.I.SH kiritilishi shart." });
    }
    if (!position || !position.trim()) {
      return res.status(400).json({ success: false, message: "Xodim lavozimi kiritilishi shart." });
    }

    const employee = SalaryService.createEmployee({
      company_id: req.user!.companyId,
      full_name,
      position,
      phone: phone || '',
      salary_type: salary_type || 'FIXED',
      base_salary: Number(base_salary) || 0,
      daily_expense_limit: daily_expense_limit ? Number(daily_expense_limit) : undefined,
      status: status || 'ACTIVE',
      is_agent: Boolean(is_agent),
      agent_code,
      commission_rate: commission_rate ? Number(commission_rate) : undefined,
      territory_id,
      pay_components: req.body.pay_components !== undefined ? cleanPayComponents(req.body.pay_components) : undefined,
      user_id: req.user!.userId,
      user_email: req.user!.email
    });

    res.status(201).json({
      success: true,
      message: `${employee.full_name} muvaffaqiyatli xodim sifatida qo'shildi.`,
      employee
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/salaries/employees/:id - Update employee
 */
router.put('/employees/:id', requireAuth, requirePermission('employee', 'update'), (req: Request, res: Response, next) => {
  try {
    const employee = SalaryService.updateEmployee(
      req.params.id,
      req.user!.companyId,
      { ...req.body, pay_components: req.body.pay_components !== undefined ? cleanPayComponents(req.body.pay_components) : undefined },
      req.user!.userId,
      req.user!.email
    );

    res.json({
      success: true,
      message: `${employee.full_name} ma'lumotlari yangilandi.`,
      employee
    });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/salaries/employees/:id - Delete or deactivate employee
 */
router.delete('/employees/:id', requireAuth, requirePermission('employee', 'delete'), (req: Request, res: Response, next) => {
  try {
    const result = SalaryService.deleteEmployee(
      req.params.id,
      req.user!.companyId,
      req.user!.userId,
      req.user!.email
    );

    res.json({
      success: true,
      message: result.message,
      deleted: result.deleted
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/salaries - List salary records for period
 */
router.get('/', requireAuth, requirePermission('salary', 'view'), (req: Request, res: Response, next) => {
  try {
    const period = (req.query.period as string) || new Date().toISOString().slice(0, 7);
    const records = db.find('salaries', s => s.company_id === req.user!.companyId && s.period_month === period);
    
    // Enrich with employee info
    const employees = db.find('employees', e => e.company_id === req.user!.companyId);
    const empMap = new Map(employees.map(e => [e.id, e]));

    const enriched = records.map(r => ({
      ...r,
      employee_name: empMap.get(r.employee_id)?.full_name || 'Noma\'lum xodim',
      position: empMap.get(r.employee_id)?.position || ''
    }));

    res.json({
      success: true,
      salaries: enriched
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/salaries/calculate - Preview and calculate monthly payroll
 */
router.post('/calculate', requireAuth, requirePermission('salary', 'create'), (req: Request, res: Response, next) => {
  try {
    const validated = CalculateSalarySchema.parse(req.body);
    const result = SalaryService.calculateMonthlySalary({
      company_id: req.user!.companyId,
      employee_id: validated.employee_id,
      period_month: validated.period_month,
      user_id: req.user!.userId,
      user_email: req.user!.email
    });

    res.json({
      success: true,
      breakdown: result
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/salaries/generate - Finalize and save salary record
 */
router.post('/generate', requireAuth, requirePermission('salary', 'create'), (req: Request, res: Response, next) => {
  try {
    const validated = CalculateSalarySchema.parse(req.body);
    const record = SalaryService.generateSalaryRecord({
      company_id: req.user!.companyId,
      employee_id: validated.employee_id,
      period_month: validated.period_month,
      user_id: req.user!.userId,
      user_email: req.user!.email
    });

    res.status(201).json({
      success: true,
      message: 'Oylik maosh hujjati shakllantirildi.',
      salary: record
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/salaries/:id/approve - Approve salary statement
 */
router.post('/:id/approve', requireAuth, requirePermission('salary', 'update'), (req: Request, res: Response, next) => {
  try {
    const record = SalaryService.approveSalary(req.params.id, req.user!.userId, req.user!.email, req.user!.companyId);
    res.json({
      success: true,
      message: 'Maosh tasdiqlandi.',
      salary: record
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/salaries/pay - Pay salary and integrate with Kassa
 */
router.post('/pay', requireAuth, requirePermission('salary', 'update'), (req: Request, res: Response, next) => {
  try {
    const validated = PaySalarySchema.parse(req.body);
    const result = SalaryService.paySalary(
      validated.salary_id,
      validated.cash_day_id,
      validated.payment_method,
      req.user!.userId,
      req.user!.email
    );

    res.json({
      success: true,
      message: 'Maosh to\'landi va kassa chiqimiga yozildi.',
      ...result
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/salaries/piecework - Record completed piecework units
 */
router.post('/piecework', requireAuth, requirePermission('salary', 'create'), (req: Request, res: Response, next) => {
  try {
    const validated = RecordPieceworkSchema.parse(req.body);
    const tx = SalaryService.recordPiecework({
      company_id: req.user!.companyId,
      employee_id: validated.employee_id,
      units_completed: validated.units_completed,
      rate_applied: validated.rate_applied,
      date: validated.date || businessToday(),
      user_id: req.user!.userId,
      user_email: req.user!.email
    });

    res.status(201).json({
      success: true,
      message: 'Ishbay hisob muvaffaqiyatli saqlandi.',
      transaction: tx
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/salaries/trip-piecework - Record multi-zone trip for delivery driver
 */
router.post('/trip-piecework', requireAuth, requirePermission('salary', 'create'), (req: Request, res: Response, next) => {
  try {
    const { employee_id, zone_name, rate_per_trip, trips_count, date, description } = req.body;
    if (!employee_id || !zone_name || !rate_per_trip) {
      return res.status(400).json({ success: false, message: 'Xodim, hudud/zona va reys stavkasi kiritilishi shart.' });
    }

    const tx = SalaryService.recordTripPiecework({
      company_id: req.user!.companyId,
      employee_id,
      zone_name,
      rate_per_trip: Number(rate_per_trip),
      trips_count: trips_count ? Number(trips_count) : 1,
      date: date || businessToday(),
      description,
      user_id: req.user!.userId,
      user_email: req.user!.email
    });

    res.status(201).json({
      success: true,
      message: `${zone_name} bo'yicha yetkazib berish reysi saqlandi.`,
      transaction: tx
    });
  } catch (err) {
    next(err);
  }
});

const WorkEntrySchema = z.object({
  employee_id: z.string().min(1, 'Xodim tanlanishi shart.'),
  unit_type: z.enum(['DAY', 'TRIP', 'PIECE', 'HOUR', 'OTHER']),
  units: z.number().positive('Miqdor 0 dan katta bo‘lishi shart.'),
  rate: z.number().positive('Stavka 0 dan katta bo‘lishi shart.').optional(),
  date: z.string().refine(isValidIsoDate, 'Sana YYYY-MM-DD bo‘lsin.').optional(),
  note: z.string().max(300).optional(),
  zone_name: z.string().max(120).optional()
});

/** POST /api/salaries/work - Record days (kunbay), trips, pieces or hours (ishbay) for any employee. */
router.post('/work', requireAuth, requirePermission('salary', 'create'), (req: Request, res: Response, next) => {
  try {
    const v = WorkEntrySchema.parse(req.body);
    const entry = SalaryService.recordWork({ company_id: req.user!.companyId, ...v, date: v.date || businessToday(), user_id: req.user!.userId, user_email: req.user!.email });
    res.status(201).json({ success: true, message: 'Ish qayd etildi.', entry });
  } catch (err) {
    next(err);
  }
});

/** GET /api/salaries/work?month=YYYY-MM&employee_id= - Recorded work of the month. */
router.get('/work', requireAuth, requirePermission('salary', 'view'), (req: Request, res: Response, next) => {
  try {
    const month = /^\d{4}-\d{2}$/.test(String(req.query.month)) ? String(req.query.month) : businessToday().slice(0, 7);
    res.json({ success: true, entries: SalaryService.listWork(req.user!.companyId, month, req.query.employee_id ? String(req.query.employee_id) : undefined) });
  } catch (err) {
    next(err);
  }
});

router.delete('/work/:id', requireAuth, requirePermission('salary', 'update'), (req: Request, res: Response, next) => {
  try {
    SalaryService.deleteWork(req.user!.companyId, req.params.id, req.user!.userId, req.user!.email);
    res.json({ success: true, message: 'Yozuv o‘chirildi.' });
  } catch (err) {
    next(err);
  }
});

/** GET /api/salaries/pay-options - Agents and expeditor names to pick in a percent pay part. */
router.get('/pay-options', requireAuth, requirePermission('employee', 'view'), (req: Request, res: Response, next) => {
  try {
    const companyId = req.user!.companyId;
    const agents = db.find('agents', a => a.company_id === companyId).map(a => ({ id: a.id, name: a.full_name, code: a.code, employee_id: a.employee_id || null }));
    const expeditors = new Set<string>();
    for (const o of db.find('sales_orders', o => o.company_id === companyId && !!o.expeditor_name)) expeditors.add(String(o.expeditor_name).trim());
    res.json({ success: true, agents: agents.sort((a, b) => a.name.localeCompare(b.name)), expeditors: Array.from(expeditors).sort() });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/salaries/cabinet/:employeeId - Employee personal cabinet (Read-only for Dostavchik/Agent)
 */
router.get('/cabinet/:employeeId', requireAuth, (req: Request, res: Response, next) => {
  try {
    const employeeId = req.params.employeeId;
    const actor = AuthService.getUserPermissions(req.user!.userId);
    const employee = db.findOne('employees', e => e.id === employeeId && e.company_id === req.user!.companyId);
    const isSelf = actor.employee_id === employeeId || employee?.user_id === actor.id;
    const isManager = actor.is_super_admin || actor.roles.some(r => r.name === 'ADMIN');
    if (!isSelf && !isManager && !AuthService.hasPermission(actor.id, 'salary', 'view')) {
      res.status(403).json({ success: false, error: 'Faqat o‘z ma’lumotlaringizni ko‘rishingiz mumkin.' });
      return;
    }
    const month = req.query.month as string;
    const cabinet = SalaryService.getEmployeePersonalCabinet(req.user!.companyId, employeeId, month);
    res.json({
      success: true,
      ...cabinet
    });
  } catch (err) {
    next(err);
  }
});

export default router;
