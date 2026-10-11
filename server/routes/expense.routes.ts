import { Router } from 'express';
import { businessToday } from '../utils/date.ts';
import type { Request, Response, NextFunction } from 'express';
import { ExpenseService } from '../services/expense.service.ts';
import { requireAuth } from '../middleware/auth.middleware.ts';
import { AuthService } from '../services/auth.service.ts';
import { db } from '../db/database.ts';
import { buildXlsx, xlsxDisposition, XLSX_MIME } from '../utils/xlsx.ts';

const router = Router();

// Permission verification middleware helper
const checkExpensePerm = (action: string) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ success: false, error: 'Avtorizatsiya talab qilinadi.' });
      return;
    }
    if (req.user.roles && req.user.roles.includes('SUPER_ADMIN')) {
      next();
      return;
    }
    const has = AuthService.hasPermission(req.user.userId, 'expenses', action as any) ||
                AuthService.hasPermission(req.user.userId, 'expense', action as any) ||
                AuthService.hasPermissionCode(req.user.userId, `expenses:${action}`) ||
                AuthService.hasPermissionCode(req.user.userId, `expenses.${action}`);
    if (!has) {
      res.status(403).json({
        success: false,
        error: `Ruxsat rad etildi: Sizda "expenses.${action}" huquqi mavjud emas.`
      });
      return;
    }
    next();
  };
};

// GET /api/expenses - list expenses with filters
router.get('/', requireAuth, checkExpensePerm('view'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const companyId = req.user!.companyId;
    const { 
      date, 
      from_date, 
      to_date, 
      category_id, 
      employee_id, 
      payment_method, 
      status, 
      created_by, 
      search 
    } = req.query;

    const result = ExpenseService.getExpenses({
      company_id: companyId,
      date: date as string,
      from_date: from_date as string,
      to_date: to_date as string,
      category_id: category_id as string,
      employee_id: employee_id as string,
      payment_method: payment_method as any,
      status: status as any,
      created_by: created_by as string,
      search: search as string
    });

    res.json({
      success: true,
      ...result
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/expenses/preview - calculate preview before confirm
router.get('/preview', requireAuth, checkExpensePerm('create'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const companyId = req.user!.companyId;
    const { 
      category_id, 
      amount, 
      date, 
      is_company_expense, 
      employee_ids, 
      payment_method,
      comment
    } = req.query;

    let parsedEmployees: string[] = [];
    if (typeof employee_ids === 'string') {
      try {
        parsedEmployees = JSON.parse(employee_ids);
      } catch {
        parsedEmployees = employee_ids.split(',').map(s => s.trim()).filter(Boolean);
      }
    } else if (Array.isArray(employee_ids)) {
      parsedEmployees = employee_ids as string[];
    }

    const preview = ExpenseService.getExpensePreview({
      company_id: companyId,
      category_id: category_id as string,
      amount: Number(amount) || 0,
      date: (date as string) || businessToday(),
      is_company_expense: String(is_company_expense) === 'true' || is_company_expense === undefined,
      employee_ids: parsedEmployees,
      payment_method: (payment_method as any) || 'CASH',
      comment: (comment as string) || ''
    });

    res.json({
      success: true,
      preview
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/expenses/categories - get all categories
router.get('/categories', requireAuth, checkExpensePerm('view'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const companyId = req.user!.companyId;
    const categories = db.find('expense_categories', c => c.company_id === companyId);
    // Sort active first, then by name
    categories.sort((a, b) => {
      if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    res.json({
      success: true,
      categories
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/expenses/categories - create category
router.post('/categories', requireAuth, checkExpensePerm('manage_categories'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const companyId = req.user!.companyId;
    const { name, description, monthly_limit } = req.body;

    const category = ExpenseService.createCategory({
      company_id: companyId,
      name,
      description,
      monthly_limit: Number(monthly_limit) || 0,
      user_id: req.user!.userId,
      user_email: req.user!.email
    });

    res.status(201).json({
      success: true,
      category
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/expenses/categories/:id - update category or toggle active
router.put('/categories/:id', requireAuth, checkExpensePerm('manage_categories'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { name, description, monthly_limit, is_active } = req.body;

    const category = ExpenseService.updateCategory({
      category_id: id,
      name,
      description,
      monthly_limit,
      is_active,
      company_id: req.user!.companyId,
      user_id: req.user!.userId,
      user_email: req.user!.email
    });

    res.json({
      success: true,
      category
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/expenses - create expense (Draft or Confirm)
router.post('/', requireAuth, checkExpensePerm('create'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const companyId = req.user!.companyId;
    const {
      date,
      category_id,
      amount,
      payment_method,
      comment,
      is_company_expense,
      employee_ids,
      allocations,
      confirm_immediately
    } = req.body;

    const result = ExpenseService.createExpense({
      company_id: companyId,
      date: date || businessToday(),
      category_id,
      amount: Number(amount),
      payment_method,
      comment,
      is_company_expense: Boolean(is_company_expense),
      employee_ids,
      allocations,
      user_id: req.user!.userId,
      user_email: req.user!.email,
      confirm_immediately: Boolean(confirm_immediately)
    });

    res.status(201).json({
      success: true,
      expense: result.expense,
      allocations: result.allocations
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/expenses/export - Excel/CSV Export
router.get('/export', requireAuth, checkExpensePerm('view'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const companyId = req.user!.companyId;
    const { 
      date, 
      from_date, 
      to_date, 
      category_id, 
      employee_id, 
      payment_method, 
      status, 
      search 
    } = req.query;

    const filters = {
      company_id: companyId,
      date: date as string,
      from_date: from_date as string,
      to_date: to_date as string,
      category_id: category_id as string,
      employee_id: employee_id as string,
      payment_method: payment_method as any,
      status: status as any,
      search: search as string
    };
    const fmt = (d?: string) => (d ? d.split('-').reverse().join('.') : '');
    const period = date ? fmt(date as string) : from_date || to_date ? `${fmt(from_date as string) || '…'} — ${fmt(to_date as string) || '…'}` : 'barcha sanalar';
    // Every export of the program is an Excel workbook.
    res.setHeader('Content-Type', XLSX_MIME);
    res.setHeader('Content-Disposition', xlsxDisposition(`Xarajatlar_${businessToday()}.xlsx`));
    res.send(buildXlsx(ExpenseService.exportSheets(filters, period)));
  } catch (err) {
    next(err);
  }
});

// GET /api/expenses/reports/daily - daily report
router.get('/reports/daily', requireAuth, checkExpensePerm('view'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const companyId = req.user!.companyId;
    const date = (req.query.date as string) || businessToday();
    const report = ExpenseService.getDailyReport(companyId, date);
    res.json({ success: true, report });
  } catch (err) {
    next(err);
  }
});

// GET /api/expenses/reports/monthly - monthly report
router.get('/reports/monthly', requireAuth, checkExpensePerm('view'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const companyId = req.user!.companyId;
    const month = (req.query.month as string) || businessToday().slice(0, 7);
    const report = ExpenseService.getMonthlyReport(companyId, month);
    res.json({ success: true, report });
  } catch (err) {
    next(err);
  }
});

// GET /api/expenses/reports/employee-summary - monthly employee summary
router.get('/reports/employee-summary', requireAuth, checkExpensePerm('view_employee_expenses'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const companyId = req.user!.companyId;
    const month = (req.query.month as string) || businessToday().slice(0, 7);
    const summary = ExpenseService.getMonthlyEmployeeSummary(companyId, month);
    res.json({ success: true, summary });
  } catch (err) {
    next(err);
  }
});

// GET /api/expenses/employees/:employee_id/profile - individual employee profile with expenses
router.get('/employees/:employee_id/profile', requireAuth, checkExpensePerm('view_employee_expenses'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const { employee_id } = req.params;
    const month = (req.query.month as string) || businessToday().slice(0, 7);
    const emp = db.findById('employees', employee_id);
    if (!emp || emp.company_id !== req.user!.companyId) { res.status(404).json({ success: false, error: 'Xodim topilmadi.' }); return; }
    const profile = ExpenseService.getEmployeeProfile(employee_id, month);
    res.json({ success: true, profile });
  } catch (err) {
    next(err);
  }
});

// POST /api/expenses/employees/:employee_id/daily-limit - set employee daily limit
router.post('/employees/:employee_id/daily-limit', requireAuth, checkExpensePerm('manage_limits'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const { employee_id } = req.params;
    const { daily_limit, effective_from, effective_to } = req.body;
    const limit = ExpenseService.setEmployeeDailyLimit({
      employee_id,
      daily_limit: Number(daily_limit),
      effective_from,
      effective_to,
      user_id: req.user!.userId,
      user_email: req.user!.email,
      company_id: req.user!.companyId
    });
    res.json({ success: true, limit });
  } catch (err) {
    next(err);
  }
});

// GET /api/expenses/:id - detail view
router.get('/:id', requireAuth, checkExpensePerm('view'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const detail = ExpenseService.getExpenseDetail(id, req.user!.companyId);
    res.json({ success: true, detail });
  } catch (err) {
    next(err);
  }
});

// POST /api/expenses/:id/confirm - atomic confirmation
router.post('/:id/confirm', requireAuth, checkExpensePerm('confirm'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { comment } = req.body;
    const result = ExpenseService.confirmExpense({
      expense_id: id,
      company_id: req.user!.companyId,
      user_id: req.user!.userId,
      user_email: req.user!.email,
      comment
    });
    res.json({ success: true, expense: result.expense, allocations: result.allocations });
  } catch (err) {
    next(err);
  }
});

// POST /api/expenses/:id/cancel - cancel expense
router.post('/:id/cancel', requireAuth, checkExpensePerm('cancel'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const cancelled = ExpenseService.cancelExpense({
      expense_id: id,
      company_id: req.user!.companyId,
      reason,
      user_id: req.user!.userId,
      user_email: req.user!.email
    });
    res.json({ success: true, expense: cancelled });
  } catch (err) {
    next(err);
  }
});

// POST /api/expenses/:id/correct - controlled correction of confirmed expense
router.post('/:id/correct', requireAuth, checkExpensePerm('update'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { amount, payment_method, comment, category_id, reason } = req.body;
    const corrected = ExpenseService.correctExpense({
      expense_id: id,
      company_id: req.user!.companyId,
      amount,
      payment_method,
      comment,
      category_id,
      reason,
      user_id: req.user!.userId,
      user_email: req.user!.email
    });
    res.json({ success: true, expense: corrected });
  } catch (err) {
    next(err);
  }
});

export default router;
