import { Router } from 'express';
import { businessToday } from '../utils/date.ts';
import type { Request, Response } from 'express';
import { requireAuth, requirePermission } from '../middleware/auth.middleware.ts';
import { db } from '../db/database.ts';
import { CashService } from '../services/cash.service.ts';
import { ForecastService } from '../services/forecast.service.ts';
import { AnalyticsService } from '../services/analytics.service.ts';
import { activeDistribution } from '../integrations/distribution.ts';
import { isLinkoId, isSalesDocId, matchesIntegrationSource } from '../services/source-tagging.service.ts';

const router = Router();

// Company-wide money figures: only for roles with report access, not for regular staff.
router.get('/stats', requireAuth, requirePermission('reports', 'view'), (req: Request, res: Response, next) => {
  try {
    const companyId = req.user!.companyId;
    const today = businessToday();
    const integrationId = activeDistribution(companyId)?.integration.id;
    const sourceMatches = (row: { source_integration_id?: string | null; source?: string | null; external_id?: string | null; code?: string | null }) => {
      if (!integrationId) return row.source !== 'DISTRIBUTION' && !row.source_integration_id && !row.external_id && !isLinkoId(row.code) && !isSalesDocId(row.code);
      return matchesIntegrationSource(row, integrationId);
    };

    const company = db.findById('companies', companyId);
    const activeRegister = db.findOne('cash_registers', r => r.company_id === companyId);
    const currentCashDay = activeRegister ? CashService.getCurrentCashDay(companyId, activeRegister.id) : null;
    const transactions = currentCashDay ? CashService.getDayTransactions(currentCashDay.id) : [];

    // Use the P&L's recognized revenue (delivered orders only) for the sales KPI.
    // Pending orders are returned separately so they cannot inflate actual sales.
    const pnl = AnalyticsService.getProfitAndLoss(companyId, today, today, integrationId || null);
    let grossSales = pnl.gross_sales;
    if (grossSales === 0 && currentCashDay) {
      grossSales = (currentCashDay.cash_payment || 0) + (currentCashDay.terminal_payment || 0) + (currentCashDay.click_payment || 0) + (currentCashDay.credit_sale || 0);
    }

    const todayExpenses = db.find('expenses', e => e.company_id === companyId && e.status === 'CONFIRMED' && e.date === today);
    const totalExpenses = todayExpenses.reduce((sum, e) => sum + e.amount, 0);

    const grossProfit = pnl.cogs_complete ? pnl.gross_profit : null;
    const netProfit = grossProfit === null ? null : grossProfit - totalExpenses;
    const netMarginPct = netProfit !== null && pnl.net_revenue > 0 ? Number(((netProfit / pnl.net_revenue) * 100).toFixed(1)) : null;

    // Inventory Run-rate & Stock-out Lost Profit
    const stockRunRate = ForecastService.getStockRunRate(companyId, 1.0);
    const stockOutAnalysis = ForecastService.getOutOfStockLostProfit(companyId);

    const customers = db.find('customers', c => c.company_id === companyId && sourceMatches(c));
    const totalCustomerDebt = customers.reduce((acc, c) => acc + (c.current_balance > 0 ? c.current_balance : 0), 0);
    const totalCreditLimit = customers.reduce((acc, c) => acc + c.credit_limit, 0);
    // Over the credit limit, only where a limit is actually set.
    const overdueCount = customers.filter(c => (c.credit_limit || 0) > 0 && c.current_balance > c.credit_limit).length;

    const integrations = db.find('integrations', i => i.company_id === companyId);
    const recentAudit = db.find('audit_logs', l => l.company_id === companyId)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 10);

    res.json({
      success: true,
      stats: {
        company,
        cashDay: currentCashDay,
        activeTransactionsCount: transactions.length,
        dailySales: grossSales,
        pendingSales: pnl.pending_sales,
        grossProfit,
        operatingExpenses: totalExpenses,
        netProfit,
        netMarginPct,
        cashInflow: currentCashDay?.cash_inflow || 0,
        cashOutflow: currentCashDay?.cash_outflow || 0,
        closingBalance: currentCashDay?.closing_balance || currentCashDay?.opening_balance || 0,
        customersCount: customers.length,
        totalCustomerDebt,
        totalCreditLimit,
        overdueCount,
        connectedIntegrationsCount: integrations.filter(i => i.status === 'CONNECTED').length,
        totalIntegrationsCount: integrations.length,
        inventory: {
          total_products: stockRunRate.summary.total_products,
          in_stock_count: stockRunRate.summary.in_stock_count,
          out_of_stock_count: stockRunRate.summary.out_of_stock_count,
          critical_count: stockRunRate.summary.critical_count,
          low_count: stockRunRate.summary.low_count,
          avg_days_remaining: stockRunRate.summary.avg_days_remaining,
          total_lost_profit_uzs: stockOutAnalysis.summary.total_lost_profit_uzs,
          total_lost_sales_uzs: stockOutAnalysis.summary.total_lost_sales_uzs,
          top_out_of_stock: stockOutAnalysis.items.slice(0, 4)
        },
        recentAudit
      }
    });
  } catch (err) {
    next(err);
  }
});

export default router;
