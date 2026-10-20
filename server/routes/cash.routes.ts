import { CashPostingService } from '../services/cash-posting.service.ts';
import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { CashService } from '../services/cash.service.ts';
import { CustomerBalanceService } from '../services/customer_balance.service.ts';
import { requireAuth, requirePermission } from '../middleware/auth.middleware.ts';
import { AuthService } from '../services/auth.service.ts';
import { 
  OpenCashDaySchema, 
  CloseCashDaySchema, 
  CreateTransactionSchema,
  CreateDailyOrderSchema,
  CreateCreditCollectionSchema,
  CreateReturnSchema,
  CreateCarriedForwardSchema,
  CorrectTransactionSchema,
  ReopenCashDaySchema
} from '../validation/schemas.ts';
import { db } from '../db/database.ts';
import { integrationProvider } from '../integrations/provider.ts';
import { businessToday } from '../utils/date.ts';
import { buildXlsx, xlsxDisposition, XLSX_MIME } from '../utils/xlsx.ts';

const router = Router();

// Every cash-day read or write must stay inside the caller's company.
function ownedDay(req: Request, res: Response, id: string) {
  const day = CashService.getCashDayById(id);
  if (!day || day.company_id !== req.user!.companyId) {
    res.status(404).json({ success: false, error: 'Kassa kuni topilmadi.' });
    return null;
  }
  return day;
}
router.post('/days/:id/save', requireAuth, requirePermission('cash', 'create'), async (req, res, next) => {
  try { res.json({success:true,...await CashPostingService.save(req.user!.companyId,req.params.id,undefined,{id:req.user!.userId,email:req.user!.email})}); }
  catch(err){ next(err); }
});
// After a payment set to 0 / deleted in the cash register was deleted by hand in SalesDoc: check it is gone.
router.post('/days/:id/verify-cancellations', requireAuth, requirePermission('cash', 'create'), async (req, res, next) => {
  try { res.json({success:true,...await CashPostingService.verifyCancellations(req.user!.companyId,req.params.id,undefined,{id:req.user!.userId,email:req.user!.email})}); }
  catch(err){ next(err); }
});

// GET /api/cash/exchange-rate?date=YYYY-MM-DD — official USD rate of the Central Bank of Uzbekistan for that day.
const rateCache = new Map<string, { rate: number; date: string }>();
router.get('/exchange-rate', requireAuth, requirePermission('cash', 'view'), async (req: Request, res: Response) => {
  const date = typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date) ? req.query.date : businessToday();
  const cached = rateCache.get(date);
  if (cached) { res.json({ success: true, currency: 'USD', ...cached, source: 'cbu.uz' }); return; }
  try {
    const response = await fetch(`https://cbu.uz/uz/arkhiv-kursov-valyut/json/USD/${date}/`, { signal: AbortSignal.timeout(8000) });
    const data: any = await response.json();
    const rate = Number(String(data?.[0]?.Rate || '').replace(',', '.'));
    if (!response.ok || !Number.isFinite(rate) || rate <= 0) throw new Error('Kurs javobi noto‘g‘ri');
    const value = { rate, date: String(data[0].Date || date) };
    rateCache.set(date, value);
    res.json({ success: true, currency: 'USD', ...value, source: 'cbu.uz' });
  } catch (err: any) {
    // No invented fallback rate: the page hides dollar amounts instead.
    res.json({ success: false, currency: 'USD', rate: null, date, source: 'cbu.uz', error: `Markaziy bank kursi olinmadi: ${err.message}` });
  }
});

// GET /api/cash/status - get active cash day and register info (backwards-compatible)
router.get('/status', requireAuth, requirePermission('cash', 'view'), (req: Request, res: Response, next) => {
  try {
    const companyId = req.user!.companyId;
    const registerId = req.query.register_id as string | undefined;

    const registers = db.find('cash_registers', r => r.company_id === companyId);
    const activeRegister = registerId 
      ? registers.find(r => r.id === registerId) || registers[0]
      : registers[0];

    const currentDay = activeRegister ? CashService.getCurrentCashDay(companyId, activeRegister.id) : null;
    const transactions = currentDay ? CashService.getDayTransactions(currentDay.id) : [];

    res.json({
      success: true,
      register: activeRegister,
      availableRegisters: registers,
      currentDay,
      transactions
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/cash/registry - Universal Daily Registry with Date Range filter and top KPIs (Umumiy sotuv, Kirim, Qarzdorlik)
router.get('/registry', requireAuth, requirePermission('cash', 'view'), (req: Request, res: Response, next) => {
  try {
    const companyId = req.user!.companyId;
    const from_date = req.query.from_date as string | undefined;
    const to_date = req.query.to_date as string | undefined;
    const agent_id = req.query.agent_id as string | undefined;
    const customer_id = req.query.customer_id as string | undefined;
    const search = req.query.search as string | undefined;
    const integration_id = req.query.integration_id as string | undefined;

    const result = CashService.getRegistry(companyId, {
      from_date,
      to_date,
      agent_id,
      customer_id,
      search,
      integration_id
    });

    res.json({
      success: true,
      ...result
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/cash/registry/orders - Create new order entry in registry
router.post('/registry/orders', requireAuth, requirePermission('cash', 'create'), (req: Request, res: Response, next) => {
  try {
    const companyId = req.user!.companyId;
    const order = CashService.createRegistryOrder({
      company_id: companyId,
      order_date: req.body.order_date,
      cash_day_id:req.body.cash_day_id,
      agent_id: req.body.agent_id,
      customer_id: req.body.customer_id,
      order_number: req.body.order_number,
      sale_amount: req.body.sale_amount,
      cash_payment: req.body.cash_payment,
      nasiya_perech: req.body.nasiya_perech,
      nasiyadan_kirim: req.body.nasiyadan_kirim,
      return_amount: req.body.return_amount,
      carried_forward_amount: req.body.carried_forward_amount,
      terminal_click: req.body.terminal_click,
      remaining_debt: req.body.remaining_debt,
      note: req.body.note,
      user_id: req.user!.userId,
      user_email: req.user!.email
    });

    res.status(201).json({
      success: true,
      message: 'Reestrga yangi yozuv muvaffaqiyatli kiritildi',
      order
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/cash/registry/orders/:id - Update registry order
router.put('/registry/orders/:id', requireAuth, requirePermission('cash', 'update'), (req: Request, res: Response, next) => {
  try {
    const { id } = req.params;
    const companyId = req.user!.companyId;
    const updated = CashService.updateRegistryOrder(
      id,
      companyId,
      req.body,
      req.user!.userId,
      req.user!.email
    );

    res.json({
      success: true,
      message: 'Reestr yozuvi muvaffaqiyatli yangilandi',
      order: updated
    });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/cash/registry/orders/:id - Delete registry order
router.delete('/registry/orders/:id', requireAuth, requirePermission('cash', 'delete'), (req: Request, res: Response, next) => {
  try {
    const { id } = req.params;
    const companyId = req.user!.companyId;
    CashService.deleteRegistryOrder(
      id,
      companyId,
      req.user!.userId,
      req.user!.email
    );

    res.json({
      success: true,
      message: 'Reestr yozuvi muvaffaqiyatli o\'chirildi'
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/cash/days - list all cash days
router.get('/days', requireAuth, requirePermission('cash', 'view'), (req: Request, res: Response, next) => {
  try {
    const companyId = req.user!.companyId;
    const status = req.query.status as ('OPEN' | 'CLOSED') | undefined;
    const days = CashService.listCashDays(companyId, status);

    res.json({
      success: true,
      days
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/cash/daily-files - barcha kunlik fayllar ro'yxatini olish
router.get('/daily-files', requireAuth, requirePermission('cash', 'view'), (req: Request, res: Response, next) => {
  try {
    const list = CashService.getDailyFilesList(req.user!.companyId);
    res.json({
      success: true,
      files: list
    });
  } catch (err) {
    next(err);
  }
});

// Inkassa: naqd pulni bankka topshirish (xarajat emas — pul joyini o'zgartiradi; faqat bank komissiyasi xarajat)
const BankDepositSchema = z.object({
  amount: z.number().positive('Summa musbat bo‘lishi kerak'),
  bank_name: z.string().trim().min(2, 'Bank nomini yozing').max(120),
  receipt_no: z.string().trim().max(60).optional(),
  fee: z.number().min(0).optional(),
  note: z.string().trim().max(300).optional()
});
router.post('/days/:id/bank-deposits', requireAuth, requirePermission('cash', 'create'), (req: Request, res: Response, next) => {
  try {
    const v = BankDepositSchema.parse(req.body);
    const tx = CashService.recordBankDeposit({ company_id: req.user!.companyId, cash_day_id: req.params.id, ...v, user_id: req.user!.userId, user_email: req.user!.email });
    res.status(201).json({ success: true, message: `Inkassa yozildi: ${tx.amount.toLocaleString('ru-RU')} so‘m bankka topshirildi.`, transaction: tx });
  } catch (err) {
    next(err);
  }
});
router.get('/bank-deposits', requireAuth, requirePermission('cash', 'view'), (req: Request, res: Response, next) => {
  try {
    res.json({ success: true, deposits: CashService.listBankDeposits(req.user!.companyId, req.query.cash_day_id ? String(req.query.cash_day_id) : undefined) });
  } catch (err) {
    next(err);
  }
});
router.delete('/bank-deposits/:id', requireAuth, requirePermission('cash', 'delete'), (req: Request, res: Response, next) => {
  try {
    CashService.deleteBankDeposit(req.user!.companyId, req.params.id, req.user!.userId, req.user!.email);
    res.json({ success: true, message: 'Inkassa yozuvi o‘chirildi.' });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/cash/daily-files/:id { reason } - ochiq kassa kunini (xato ochilgan) ichidagi yozuvlari bilan o'chirish
router.delete('/daily-files/:id', requireAuth, requirePermission('cash', 'delete'), (req: Request, res: Response, next) => {
  try {
    const result = CashService.deleteCashDay(req.user!.companyId, req.params.id, req.user!.userId, req.user!.email, String(req.body?.reason || ''));
    res.json({
      success: true,
      message: `${result.date} kassa kuni o‘chirildi: ${result.orders} ta buyurtma qatori, ${result.transactions} ta kassa yozuvi${result.ledger_reversed ? `, ${result.ledger_reversed} ta qarz daftari yozuvi bekor qilindi` : ''}.`,
      result
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/cash/daily-files/:id - bitta kunlik fayl ichidagi barcha operatsiyalarni bittada olish
router.get('/daily-files/:id', requireAuth, requirePermission('cash', 'view'), (req: Request, res: Response, next) => {
  try {
    const dossier = CashService.getFullDailyDossier(req.user!.companyId, req.params.id);
    res.json({
      success: true,
      dossier
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/cash/daily-files/:id/reopen - yopilgan kunlik faylni qayta ochish (tahrirlash uchun)
router.post('/daily-files/:id/reopen', requireAuth, requirePermission('cash', 'view'), (req: Request, res: Response, next) => {
  try {
    // Reopening a closed day is a director decision, recorded with a reason in the audit log.
    if (!AuthService.isCashSupervisor(req.user!.userId)) {
      res.status(403).json({ success: false, error: 'Yopilgan kassani faqat direktor yoki bosh buxgalter (cash:correct) qayta ochadi.' });
      return;
    }
    const { reason } = ReopenCashDaySchema.parse(req.body || {});
    const reopened = CashService.reopenCashDay(
      req.user!.companyId,
      req.params.id,
      req.user!.userId,
      req.user!.email,
      reason
    );
    res.json({
      success: true,
      message: `${reopened.date} sanasidagi kunlik fayl qayta ochildi. Endi unga o'zgartirish kiritishingiz mumkin.`,
      cashDay: reopened
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/cash/days/open - open new or get existing CashDay
router.post('/days/open', requireAuth, requirePermission('cash', 'create'), async (req: Request, res: Response, next) => {
  try {
    const validated = OpenCashDaySchema.parse(req.body);
    const userRole = req.user!.roles[0];

    const cashDay = CashService.openCashDay({
      company_id: req.user!.companyId,
      register_id: validated.register_id,
      date: validated.date,
      opening_balance: validated.opening_balance,
      manual_opening_adjustment: validated.manual_opening_adjustment,
      user_id: req.user!.userId,
      user_email: req.user!.email,
      user_role: userRole,
      is_privileged: AuthService.isCashSupervisor(req.user!.userId)
    });

    // Automatically sync and pull the day's delivered ("yetkazildi") & pending ("yetkaziladi") orders from integrated system
    let syncStats = null;
    let syncError = null;
    try {
      syncStats = await integrationProvider.syncDayOrders(
        req.user!.companyId,
        validated.date,
        cashDay.id,
        req.user!.userId
      );
    } catch (syncErr: any) {
      syncError=syncErr.message;
    }

    const updatedDay = CashService.getCashDayById(cashDay.id) || cashDay;

    res.status(201).json({
      success: true,
      message: syncError ? `Kassa ochildi, lekin buyurtmalar olinmadi: ${syncError}` : syncStats && syncStats.syncedCount > 0
        ? `${cashDay.date} sanasi uchun kassa kuni ochildi. Integratsiyadan ${syncStats.syncedCount} ta buyurtma (${syncStats.totalSales.toLocaleString()} UZS: ${syncStats.deliveredCount} ta yetkazildi, ${syncStats.pendingCount} ta yetkaziladi) avtomatik yuklandi.`
        : `${cashDay.date} sanasi uchun kassa kuni muvaffaqiyatli ochildi.`,
      cashDay: updatedDay,
      syncStats,
      syncError
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/cash/days/:id/sync-orders - Refresh/Sync Day orders from SalesDoc/Integration anytime
router.post('/days/:id/sync-orders', requireAuth, requirePermission('cash', 'create'), async (req: Request, res: Response, next) => {
  try {
    const cashDay = CashService.getCashDayById(req.params.id);
    if (!cashDay || cashDay.company_id !== req.user!.companyId) {
      return res.status(404).json({ success: false, error: 'Kassa kuni topilmadi.' });
    }

    const result = await integrationProvider.syncDayOrders(
      req.user!.companyId,
      cashDay.date,
      cashDay.id,
      req.user!.userId
    );

    const updatedDay = CashService.getCashDayById(cashDay.id) || cashDay;

    res.json({
      success: true,
      message: `${cashDay.date} sanasi uchun ${result.syncedCount} ta buyurtma (${result.totalSales.toLocaleString()} UZS: ${result.deliveredCount} ta yetkazildi, ${result.pendingCount} ta yetkaziladi) sinxronlashtirildi.`,
      cashDay: updatedDay,
      ...result
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/cash/days/:id - get single CashDay
router.get('/days/:id', requireAuth, requirePermission('cash', 'view'), (req: Request, res: Response, next) => {
  try {
    const cashDay = CashService.getCashDayById(req.params.id);
    if (!cashDay || cashDay.company_id !== req.user!.companyId) {
      res.status(404).json({ success: false, error: 'Kassa kuni topilmadi.' });
      return;
    }

    res.json({
      success: true,
      cashDay
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/cash/days/:id/summary - get compact payment summary cards
router.get('/days/:id/summary', requireAuth, requirePermission('cash', 'view'), (req: Request, res: Response, next) => {
  try {
    if (!ownedDay(req, res, req.params.id)) return;
    const summary = CashService.getDaySummary(req.params.id);
    res.json({
      success: true,
      summary
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/cash/days/:id/close - close OPEN CashDay
router.post('/days/:id/close', requireAuth, requirePermission('cash', 'close'), async (req: Request, res: Response, next) => {
  try {
    const validated = CloseCashDaySchema.parse({
      ...req.body,
      cash_day_id: req.params.id
    });

    const ownedDay=db.findOne('cash_days',d=>d.id===validated.cash_day_id && d.company_id===req.user!.companyId);
    if(!ownedDay) throw new Error('Kassa kuni topilmadi');
    const closedDay = CashService.closeCashDay({
      cash_day_id: validated.cash_day_id,
      actual_cash: validated.actual_cash,
      reason: validated.reason,
      notes: validated.notes,
      user_id: req.user!.userId,
      user_email: req.user!.email
    });

    const posting=await CashPostingService.save(req.user!.companyId,closedDay.id).catch((err:any)=>({pending:true,message:err.message}));
    res.json({
      success: true,
      message: 'Kassa kuni yopildi. ' + posting.message,
      posting,
      cashDay: closedDay
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/cash/days/:id/transactions - add single transaction
router.post('/days/:id/transactions', requireAuth, requirePermission('cash', 'create'), (req: Request, res: Response, next) => {
  try {
    const validated = CreateTransactionSchema.parse({
      ...req.body,
      cash_day_id: req.params.id
    });

    const hasCorrect = AuthService.hasPermission(req.user!.userId, 'cash', 'correct');
    const userRole = req.user!.roles[0];

    const transaction = CashService.addTransaction({
      company_id: req.user!.companyId,
      cash_day_id: validated.cash_day_id,
      transaction_type: validated.transaction_type,
      amount: validated.amount,
      payment_method: validated.payment_method,
      customer_id: validated.customer_id,
      employee_id: validated.employee_id,
      agent_id: validated.agent_id,
      order_number: validated.order_number,
      order_id: validated.order_id,
      source_transaction_id: validated.source_transaction_id,
      external_reference: validated.external_reference,
      description: validated.description,
      user_id: req.user!.userId,
      user_email: req.user!.email,
      user_role: userRole,
      has_correction_permission: hasCorrect,
      correction_reason: validated.correction_reason
    });

    res.status(201).json({
      success: true,
      message: 'Tranzaksiya muvaffaqiyatli saqlandi.',
      transaction
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/cash/days/:id/transactions - get filtered transactions (agent, customer, search, type)
router.get('/days/:id/transactions', requireAuth, requirePermission('cash', 'view'), (req: Request, res: Response, next) => {
  try {
    if (!ownedDay(req, res, req.params.id)) return;
    const transactions = CashService.getFilteredTransactions(req.params.id, {
      agent_id: req.query.agent_id as string,
      customer_id: req.query.customer_id as string,
      transaction_type: req.query.transaction_type as any,
      payment_method: req.query.payment_method as any,
      search: req.query.search as string
    });

    res.json({
      success: true,
      transactions
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/cash/days/:id/orders - daily order/sale entry with multi-payment validation
router.post('/days/:id/orders', requireAuth, requirePermission('cash', 'create'), (req: Request, res: Response, next) => {
  try {
    const validated = CreateDailyOrderSchema.parse({
      ...req.body,
      cash_day_id: req.params.id
    });

    const result = CashService.createDailyOrder({
      company_id: req.user!.companyId,
      cash_day_id: validated.cash_day_id,
      order_number: validated.order_number || '',
      order_date: validated.order_date || '',
      agent_id: validated.agent_id,
      customer_id: validated.customer_id,
      sale_amount: validated.sale_amount,
      cash_payment: validated.cash_payment,
      terminal_payment: validated.terminal_payment,
      click_payment: validated.click_payment,
      credit_amount: validated.credit_amount,
      note: validated.note,
      user_id: req.user!.userId,
      user_email: req.user!.email
    });

    res.status(201).json({
      success: true,
      message: 'Buyurtma va to\'lovlar muvaffaqiyatli qayd etildi.',
      ...result
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/cash/days/:id/orders - list daily orders
router.get('/days/:id/orders', requireAuth, requirePermission('cash', 'view'), (req: Request, res: Response, next) => {
  try {
    if (!ownedDay(req, res, req.params.id)) return;
    const orders = CashService.getDailyOrders(req.params.id, {
      agent_id: req.query.agent_id as string,
      customer_id: req.query.customer_id as string,
      search: req.query.search as string
    });

    res.json({
      success: true,
      orders
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/cash/days/:id/collections - credit collection
router.post('/days/:id/collections', requireAuth, requirePermission('cash', 'create'), (req: Request, res: Response, next) => {
  try {
    const validated = CreateCreditCollectionSchema.parse({
      ...req.body,
      cash_day_id: req.params.id
    });

    const tx = CashService.recordCreditCollection({
      company_id: req.user!.companyId,
      cash_day_id: validated.cash_day_id,
      customer_id: validated.customer_id,
      agent_id: validated.agent_id,
      amount: validated.amount,
      payment_method: validated.payment_method,
      external_reference: validated.external_reference,
      description: validated.description,
      user_id: req.user!.userId,
      user_email: req.user!.email
    });

    res.status(201).json({
      success: true,
      message: 'Qarz to\'lovi qabul qilindi va mijoz balansi yangilandi.',
      transaction: tx
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/cash/days/:id/returns - return / vozvrat
router.post('/days/:id/returns', requireAuth, requirePermission('cash', 'create'), (req: Request, res: Response, next) => {
  try {
    const validated = CreateReturnSchema.parse({
      ...req.body,
      cash_day_id: req.params.id
    });

    const result = CashService.recordReturn({
      company_id: req.user!.companyId,
      cash_day_id: validated.cash_day_id,
      customer_id: validated.customer_id,
      agent_id: validated.agent_id,
      order_reference: validated.order_reference,
      amount: validated.amount,
      date: validated.date || '',
      reason: validated.reason,
      payment_impact: validated.payment_impact,
      external_reference: validated.external_reference,
      user_id: req.user!.userId,
      user_email: req.user!.email
    });

    res.status(201).json({
      success: true,
      message: 'Mahsulot qaytarilishi qayd etildi.',
      ...result
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/cash/days/:id/carried-forward - carried forward transaction
router.post('/days/:id/carried-forward', requireAuth, requirePermission('cash', 'create'), (req: Request, res: Response, next) => {
  try {
    const validated = CreateCarriedForwardSchema.parse({
      ...req.body,
      cash_day_id: req.params.id
    });

    const tx = CashService.recordCarriedForward({
      company_id: req.user!.companyId,
      cash_day_id: validated.cash_day_id,
      customer_id: validated.customer_id,
      agent_id: validated.agent_id,
      amount: validated.amount,
      source_transaction_id: validated.source_transaction_id,
      description: validated.description,
      user_id: req.user!.userId,
      user_email: req.user!.email
    });

    res.status(201).json({
      success: true,
      message: 'Kun surildi tranzaksiyasi muvaffaqiyatli saqlandi.',
      transaction: tx
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/cash/transactions/:id - controlled correction
router.patch('/transactions/:id', requireAuth, requirePermission('cash', 'view'), (req: Request, res: Response, next) => {
  try {
    const validated = CorrectTransactionSchema.parse(req.body);
    const hasCorrect = AuthService.hasPermission(req.user!.userId, 'cash', 'correct');
    const userRole = req.user!.roles[0];

    const updatedTx = CashService.correctTransaction({
      transaction_id: req.params.id,
      company_id: req.user!.companyId,
      amount: validated.amount,
      payment_method: validated.payment_method,
      description: validated.description,
      reason: validated.reason,
      user_id: req.user!.userId,
      user_email: req.user!.email,
      user_role: userRole,
      has_correction_permission: hasCorrect
    });

    res.json({
      success: true,
      message: 'Tranzaksiya nazorat ostida to\'g\'rilandi.',
      transaction: updatedTx
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/cash/customers - list customers with balances
router.get('/customers', requireAuth, requirePermission('customer', 'view'), (req: Request, res: Response, next) => {
  try {
    const customers = CustomerBalanceService.listCustomers(req.user!.companyId);
    res.json({
      success: true,
      customers
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/cash/customers/:id/history - full statement for customer
router.get('/customers/:id/history', requireAuth, requirePermission('customer', 'view'), (req: Request, res: Response, next) => {
  try {
    const history = CustomerBalanceService.getCustomerHistory(req.user!.companyId, req.params.id);
    res.json({
      success: true,
      ...history
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/cash/agents - list agents
router.get('/agents', requireAuth, requirePermission('employee', 'view'), (req: Request, res: Response, next) => {
  try {
    const agents = db.find('agents', a => a.company_id === req.user!.companyId && a.status === 'ACTIVE');
    res.json({
      success: true,
      agents
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/cash/carried-forward/pending - pending carried forwards from previous day
router.get('/carried-forward/pending', requireAuth, requirePermission('cash', 'view'), (req: Request, res: Response, next) => {
  try {
    const date = (req.query.date as string) || businessToday();
    const pending = CashService.getPendingCarriedForwards(req.user!.companyId, date);
    res.json({
      success: true,
      pending
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/cash/day/:id/sync-distribution-orders - pull orders from distribution software
router.post('/day/:id/sync-distribution-orders', requireAuth, requirePermission('cash', 'create'), (req: Request, res: Response, next) => {
  try {
    const cashDay = ownedDay(req, res, req.params.id);
    if (!cashDay) return;
    const result = CashService.syncDailyOrdersFromDistribution({
      company_id: req.user!.companyId,
      cash_day_id: req.params.id,
      date: cashDay.date,
      user_id: req.user!.userId,
      user_email: req.user!.email
    });
    res.json({
      success: true,
      message: `Distributsiya dasturidan ${result.count} ta buyurtma kassa shabloniga yuklandi.`,
      ...result
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/cash/day/:id/returns-reconciliation - compare cash returns vs distribution returns
router.get('/day/:id/returns-reconciliation', requireAuth, requirePermission('cash', 'view'), (req: Request, res: Response, next) => {
  try {
    const result = CashService.getReturnsReconciliation(req.user!.companyId, req.params.id);
    res.json({
      success: true,
      ...result
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/cash/day/:id/export-excel - the cash day as a formatted .xlsx (register + cash movements)
router.get('/day/:id/export-excel', requireAuth, requirePermission('cash', 'view'), (req: Request, res: Response, next) => {
  try {
    const sheets = CashService.exportCashDaySheets(req.user!.companyId, req.params.id);
    const day = db.findById('cash_days', req.params.id);
    res.setHeader('Content-Type', XLSX_MIME);
    res.setHeader('Content-Disposition', xlsxDisposition(`Kassa_${day?.date || req.params.id}.xlsx`));
    res.send(buildXlsx(sheets));
  } catch (err) {
    next(err);
  }
});

// POST /api/cash/day/:id/import-excel - import rows into cash day
router.post('/day/:id/import-excel', requireAuth, requirePermission('cash', 'create'), (req: Request, res: Response, next) => {
  try {
    const rows = req.body.rows || [];
    const result = CashService.importCashDayOrders({
      company_id: req.user!.companyId,
      cash_day_id: req.params.id,
      rows,
      user_id: req.user!.userId,
      user_email: req.user!.email
    });
    res.json({
      success: true,
      message: `${result.count} ta buyurtma Excel fayldan import qilindi.`,
      ...result
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/cash/sync-payment-to-distribution - sync payment receipt (Oplata) or debt to distribution ERP
router.post('/sync-payment-to-distribution', requireAuth, requirePermission('cash', 'create'), (req: Request, res: Response, next) => {
  try {
    const { transaction_id } = req.body;
    if (!transaction_id) {
      return res.status(400).json({ success: false, message: 'Tranzaksiya ID kiritilishi shart' });
    }
    const result = CashService.syncPaymentToDistribution({
      company_id: req.user!.companyId,
      transaction_id,
      user_id: req.user!.userId,
      user_email: req.user!.email
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Backwards-compatible legacy endpoints:
router.post('/day/open', requireAuth, requirePermission('cash', 'create'), (req: Request, res: Response, next) => {
  try {
    const validated = OpenCashDaySchema.parse(req.body);
    const newDay = CashService.openCashDay({
      company_id: req.user!.companyId,
      register_id: validated.register_id,
      date: validated.date,
      opening_balance: validated.opening_balance,
      user_id: req.user!.userId,
      user_email: req.user!.email,
      user_role: req.user!.roles[0],
      is_privileged: AuthService.isCashSupervisor(req.user!.userId)
    });

    res.status(201).json({
      success: true,
      message: `${newDay.date} sanasi uchun kassa kuni muvaffaqiyatli ochildi.`,
      cashDay: newDay
    });
  } catch (err) {
    next(err);
  }
});

router.post('/day/close', requireAuth, requirePermission('cash', 'close'), async (req: Request, res: Response, next) => {
  try {
    const validated = CloseCashDaySchema.parse(req.body);
    const ownedDay=db.findOne('cash_days',d=>d.id===validated.cash_day_id && d.company_id===req.user!.companyId);
    if(!ownedDay) throw new Error('Kassa kuni topilmadi');
    const closedDay = CashService.closeCashDay({
      cash_day_id: validated.cash_day_id,
      actual_cash: validated.actual_cash,
      reason: validated.reason,
      notes: validated.notes,
      user_id: req.user!.userId,
      user_email: req.user!.email
    });

    const posting=await CashPostingService.save(req.user!.companyId,closedDay.id).catch((err:any)=>({pending:true,message:err.message}));
    res.json({
      success: true,
      message: 'Kassa kuni yopildi. ' + posting.message,
      posting,
      cashDay: closedDay
    });
  } catch (err) {
    next(err);
  }
});

router.post('/transactions', requireAuth, requirePermission('cash', 'create'), (req: Request, res: Response, next) => {
  try {
    const validated = CreateTransactionSchema.parse(req.body);
    const transaction = CashService.addTransaction({
      company_id: req.user!.companyId,
      cash_day_id: validated.cash_day_id,
      transaction_type: validated.transaction_type,
      amount: validated.amount,
      payment_method: validated.payment_method,
      customer_id: validated.customer_id,
      employee_id: validated.employee_id,
      agent_id: validated.agent_id,
      order_number: validated.order_number,
      order_id: validated.order_id,
      source_transaction_id: validated.source_transaction_id,
      external_reference: validated.external_reference,
      description: validated.description,
      user_id: req.user!.userId,
      user_email: req.user!.email,
      user_role: req.user!.roles[0]
    });

    res.status(201).json({
      success: true,
      message: 'Tranzaksiya muvaffaqiyatli saqlandi va kassa hisobiga qo\'shildi.',
      transaction
    });
  } catch (err) {
    next(err);
  }
});

router.get('/transactions/:cashDayId', requireAuth, requirePermission('cash', 'view'), (req: Request, res: Response, next) => {
  try {
    if (!ownedDay(req, res, req.params.cashDayId)) return;
    const transactions = CashService.getDayTransactions(req.params.cashDayId);
    res.json({
      success: true,
      transactions
    });
  } catch (err) {
    next(err);
  }
});

export default router;
