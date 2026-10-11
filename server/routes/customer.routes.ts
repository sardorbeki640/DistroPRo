import { Router } from 'express';
import { businessToday } from '../utils/date.ts';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth, requirePermission } from '../middleware/auth.middleware.ts';
import { CustomerBalanceService } from '../services/customer_balance.service.ts';
import { CashService } from '../services/cash.service.ts';
import { NotificationService } from '../services/notification.service.ts';
import { db } from '../db/database.ts';

const router = Router();

// Validation Schemas
const CreateCustomerSchema = z.object({
  name: z.string().min(2, 'Mijoz nomi kamida 2 belgidan iborat bo\'lishi kerak.'),
  code: z.string().min(1, 'Mijoz kodi (STIR yoki ichki kod) kiritilishi shart.'),
  phone: z.string().min(5, 'Telefon raqami kiritilishi shart.'),
  address: z.string().optional(),
  territory_id: z.string().optional().nullable(),
  agent_id: z.string().optional().nullable(),
  delivery_id: z.string().optional().nullable(),
  credit_limit: z.number().nonnegative('Kredit limiti manfiy bo\'lishi mumkin emas.').default(0),
  credit_limit_enabled: z.boolean().default(true),
  debt_alert_threshold: z.number().nonnegative().optional().default(0),
  initial_debt: z.number().default(0),
  comment: z.string().optional()
});

const RecordPaymentSchema = z.object({
  customer_id: z.string().min(1, 'Mijoz tanlanishi shart.'),
  amount: z.number().positive('To\'lov summasi 0 dan katta bo\'lishi shart.'),
  payment_method: z.enum(['CASH', 'TERMINAL', 'CLICK', 'BANK_TRANSFER', 'OTHER']),
  date: z.string().optional(),
  agent_id: z.string().optional().nullable(),
  cash_day_id: z.string().optional().nullable(),
  comment: z.string().optional()
});

const RecordAdjustmentSchema = z.object({
  customer_id: z.string().min(1, 'Mijoz tanlanishi shart.'),
  amount: z.number().positive('Tuzatish summasi 0 dan katta bo\'lishi shart.'),
  direction: z.enum(['INCREASE_DEBT', 'DECREASE_DEBT']),
  date: z.string().optional(),
  reason: z.string().min(3, 'Tuzatish sababi kiritilishi shart.')
});

const CarriedForwardSchema = z.object({
  customer_id: z.string().min(1, 'Mijoz tanlanishi shart.'),
  source_date: z.string().min(1, 'Boshlang\'ich sana kiritilishi shart.'),
  target_date: z.string().min(1, 'Ko\'chirilayotgan sana kiritilishi shart.'),
  amount: z.number().positive('Summa 0 dan katta bo\'lishi shart.'),
  comment: z.string().optional()
});

/**
 * GET /api/customers - List all customers with real-time balance status
 */
router.get('/', requireAuth, requirePermission('customer', 'view'), (req: Request, res: Response, next) => {
  try {
    const companyId = req.user!.companyId;
    const { agent_id, territory_id, search } = req.query;

    const report = CustomerBalanceService.getCustomerBalanceReport(companyId, {
      agentId: agent_id as string,
      territoryId: territory_id as string,
      search: search as string
    });

    res.json({
      success: true,
      customers: report
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/customers - Create new customer
 */
router.post('/', requireAuth, requirePermission('customer', 'create'), (req: Request, res: Response, next) => {
  try {
    const validated = CreateCustomerSchema.parse(req.body);
    const companyId = req.user!.companyId;

    const customerId = `cust-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const now = new Date().toISOString();

    const newCustomer = {
      id: customerId,
      company_id: companyId,
      external_id: null,
      territory_id: validated.territory_id || null,
      agent_id: validated.agent_id || null,
      delivery_id: validated.delivery_id || null,
      name: validated.name,
      code: validated.code,
      phone: validated.phone,
      address: validated.address || '',
      credit_limit: validated.credit_limit,
      credit_limit_enabled: validated.credit_limit_enabled,
      debt_alert_threshold: validated.debt_alert_threshold || 0,
      current_balance: 0,
      status: 'ACTIVE' as const,
      comment: validated.comment || null,
      is_active: true,
      created_at: now,
      updated_at: now
    };

    db.insert('customers', newCustomer);

    // Initial debt setup if provided
    if (validated.initial_debt > 0) {
      CustomerBalanceService.recordDebit({
        company_id: companyId,
        customer_id: customerId,
        amount: validated.initial_debt,
        reference_type: 'ADJUSTMENT',
        reference_id: `init-${customerId}`,
        date: now.slice(0, 10),
        description: 'Boshlang\'ich qoldiq (Opening balance)',
        user_id: req.user!.userId,
        user_email: req.user!.email
      });
    }

    const saved = db.findById('customers', customerId);

    res.status(201).json({
      success: true,
      message: 'Mijoz muvaffaqiyatli yaratildi.',
      customer: saved
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/customers/overdue-debts-summary - Debt aged > 10 days grouped by Agent
 * (declared before "/:id", which would otherwise take "overdue-debts-summary" for a customer id)
 */
router.get('/overdue-debts-summary', requireAuth, requirePermission('customer', 'view'), (req: Request, res: Response, next) => {
  try {
    const minDays = req.query.min_days ? parseInt(req.query.min_days as string, 10) : 10;
    const summary = NotificationService.getOverdueCustomerDebtsSummary(req.user!.companyId, minDays);
    res.json({
      success: true,
      ...summary
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/customers/:id - Customer Details and Balance Summary
 */
router.get('/:id', requireAuth, requirePermission('customer', 'view'), (req: Request, res: Response, next) => {
  try {
    const summary = CustomerBalanceService.getBalanceSummary(req.user!.companyId, req.params.id);
    res.json({
      success: true,
      ...summary
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/customers/:id/statement - Akt Sverka (Statement of Account)
 */
router.get('/:id/statement', requireAuth, requirePermission('balance', 'view'), (req: Request, res: Response, next) => {
  try {
    const fromDate = (req.query.from_date as string) || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
    const toDate = (req.query.to_date as string) || businessToday();

    // Only the user's own company's customers.
    const owner = db.findById('customers', req.params.id);
    if (!owner || owner.company_id !== req.user!.companyId) { res.status(404).json({ success: false, error: 'Mijoz topilmadi.' }); return; }
    const statement = CustomerBalanceService.getStatement(req.params.id, fromDate, toDate);
    res.json({
      success: true,
      statement
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/customers/payments - Record customer payment (Credit)
 */
router.post('/payments', requireAuth, requirePermission('balance', 'create'), (req: Request, res: Response, next) => {
  try {
    const validated = RecordPaymentSchema.parse(req.body);
    // Money taken today goes through today's cash register, so it shows in the cash day, reports and SalesDoc.
    const today = businessToday();
    if (['CASH', 'TERMINAL', 'CLICK'].includes(validated.payment_method) && !validated.cash_day_id && (!validated.date || validated.date === today)) {
      const result = CashService.recordDebtCollection({
        company_id: req.user!.companyId,
        customer_id: validated.customer_id,
        amount: validated.amount,
        payment_method: validated.payment_method as 'CASH' | 'TERMINAL' | 'CLICK',
        comment: validated.comment,
        user_id: req.user!.userId,
        user_email: req.user!.email
      });
      res.status(201).json({
        success: true,
        message: `To‘lov ${today} kassasiga “${validated.payment_method === 'CASH' ? 'nasiyadan kirim' : 'terminal'}” qatori (${result.entry.order_number}) bo‘lib yozildi va mijoz qarzi kamaydi.`
          + (result.sent_to_salesdoc_with_day
            ? ` ${result.system}ga kassa “Saqlash va yuborish” qilinganda yuboriladi.`
            : result.system ? ` Mijoz ${result.system}da yo‘q (yoki u to‘lov qabul qilmaydi) — to‘lov faqat bu dasturda.` : ' Distribyutor tizimi ulanmagan — to‘lov faqat bu dasturda.'),
        ...result
      });
      return;
    }
    const result = CustomerBalanceService.recordPayment({
      company_id: req.user!.companyId,
      customer_id: validated.customer_id,
      amount: validated.amount,
      payment_method: validated.payment_method as any,
      date: validated.date,
      agent_id: validated.agent_id,
      cash_day_id: validated.cash_day_id,
      comment: validated.comment,
      user_id: req.user!.userId,
      user_email: req.user!.email
    });

    res.status(201).json({
      success: true,
      message: 'Mijoz to\'lovi muvaffaqiyatli qabul qilindi.',
      ...result
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/customers/adjustments - Controlled Balance Adjustment
 */
router.post('/adjustments', requireAuth, requirePermission('balance', 'update'), (req: Request, res: Response, next) => {
  try {
    const validated = RecordAdjustmentSchema.parse(req.body);
    const tx = CustomerBalanceService.recordAdjustment({
      company_id: req.user!.companyId,
      customer_id: validated.customer_id,
      amount: validated.amount,
      direction: validated.direction,
      date: validated.date,
      reason: validated.reason,
      user_id: req.user!.userId,
      user_email: req.user!.email
    });

    res.status(201).json({
      success: true,
      message: 'Mijoz balansiga tuzatish kiritildi.',
      transaction: tx
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/customers/carried-forward - Kun surish (Carried Forward)
 */
router.post('/carried-forward', requireAuth, requirePermission('balance', 'create'), (req: Request, res: Response, next) => {
  try {
    const validated = CarriedForwardSchema.parse(req.body);
    const tx = CustomerBalanceService.recordCarriedForward({
      company_id: req.user!.companyId,
      customer_id: validated.customer_id,
      source_date: validated.source_date,
      target_date: validated.target_date,
      amount: validated.amount,
      comment: validated.comment,
      user_id: req.user!.userId,
      user_email: req.user!.email
    });

    res.status(201).json({
      success: true,
      message: 'Kun surish muvaffaqiyatli o\'tkazildi.',
      transaction: tx
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/customers/reports/agents - Agent Debt Summary Report
 */
router.get('/reports/agents', requireAuth, requirePermission('reports', 'view'), (req: Request, res: Response, next) => {
  try {
    const agentId = req.query.agent_id as string;
    const fromDate = req.query.from_date as string;
    const toDate = req.query.to_date as string;

    const summary = CustomerBalanceService.getAgentDebtSummary(agentId, fromDate, toDate, req.user!.companyId);
    res.json({
      success: true,
      summary
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/customers/reports/territories - Territory Debt Summary Report
 */
router.get('/reports/territories', requireAuth, requirePermission('reports', 'view'), (req: Request, res: Response, next) => {
  try {
    const territoryId = req.query.territory_id as string;
    const fromDate = req.query.from_date as string;
    const toDate = req.query.to_date as string;

    const summary = CustomerBalanceService.getTerritoryDebtSummary(territoryId, fromDate, toDate, req.user!.companyId);
    res.json({
      success: true,
      summary
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/customers/dispatch-overdue-debts-alert - Trigger Telegram Bot alert to admin
 */
router.post('/dispatch-overdue-debts-alert', requireAuth, requirePermission('notifications', 'create'), (req: Request, res: Response, next) => {
  try {
    const minDays = req.body.min_days ? parseInt(req.body.min_days, 10) : 10;
    const result = NotificationService.sendOverdueDebtsTelegramAlert(req.user!.companyId, minDays);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
