import { JarvisService } from '../jarvis/jarvis.service.ts';
import { db } from '../db/database.ts';
import { ForecastService } from './forecast.service.ts';
import { CashService } from './cash.service.ts';
import { AnalyticsService } from './analytics.service.ts';
import { addDays, businessToday } from '../utils/date.ts';
import { activeDistribution } from '../integrations/distribution.ts';
import { matchesIntegrationSource } from './source-tagging.service.ts';

// Profit is null when the cost of some sales is unknown; say so instead of printing a guessed number.
const fmtProfit = (value: number | null, margin?: number | null) =>
  value === null ? 'hisoblanmadi (ayrim sotuvlar tannarxi noma’lum)' : `${value.toLocaleString()} UZS${margin !== undefined && margin !== null ? ` (rentabellik ${margin}%)` : ''}`;

export interface AIAnalysisResult {
  generated_at: string;
  is_live_ai: boolean;
  model: string;
  executive_summary: string;
  key_findings: {
    category: 'CASH_FLOW' | 'INVENTORY_STOCKOUT' | 'DEBT_RISK' | 'PROFITABILITY';
    title: string;
    description: string;
    severity: 'CRITICAL' | 'WARNING' | 'HEALTHY';
  }[];
  actionable_recommendations: string[];
  metrics_snapshot: {
    daily_sales: number;
    daily_inflow: number;
    daily_outflow: number;
    operating_expenses: number;
    net_profit: number | null;
    net_margin_pct: number | null;
    cash_in_hand: number;
    out_of_stock_count: number;
    total_lost_profit_uzs: number;
    total_lost_sales_uzs: number;
    estimate_unknown_count: number;
    avg_inventory_days: number;
    total_customer_debt: number;
  };
}

export class AIService {
  /**
   * The company's AI as set up in Jarvis (Gemini, Claude, OpenAI, …), in the shape this service already calls.
   * Before, this read a GEMINI_API_KEY variable that was never set, so every answer came from the fallback rules.
   */
  private static getAIClient(companyId: string): { models: { generateContent(o: { model?: string; contents: string; config?: { systemInstruction?: string; temperature?: number } }): Promise<{ text: string }> } } | null {
    if (!JarvisService.ready(companyId)) return null;
    return {
      models: {
        generateContent: async o => {
          const r = await JarvisService.complete(companyId, o.config?.systemInstruction || 'Siz distribyutsiya biznesining moliya va savdo tahlilchisisiz. O‘zbek tilida, aniq raqamlar bilan javob bering.', o.contents, 3000);
          return { text: r.text };
        }
      }
    };
  }

  private static modelName(companyId: string) {
    return JarvisService.settings(companyId).model || 'AI';
  }

  /**
   * Aggregates comprehensive, real-time intelligence about the user's business,
   * connected integrations, sales reps/agents, customers, debts, and inventory.
   */
  public static getCompleteBusinessProfile(companyId: string) {
    const activeRegister = db.findOne('cash_registers', r => r.company_id === companyId);
    const cashDay = activeRegister ? CashService.getCurrentCashDay(companyId, activeRegister.id) : null;
    const today = businessToday();
    const thirtyDaysAgo = addDays(today, -30);

    // 1. Integration Status
    const integrations = db.find('integrations', i => i.company_id === companyId);
    const activeIntegration = activeDistribution(companyId)?.integration || null;
    const integrationId = activeIntegration?.id;
    const sourceScopeId = integrationId || null;
    const extOrdersCount = db.find('external_orders', o => o.company_id === companyId && !!integrationId && o.integration_id === integrationId).length;
    const extCustomersCount = db.find('external_customers', c => c.company_id === companyId && !!integrationId && c.integration_id === integrationId).length;
    const extPaymentsCount = db.find('external_payments', p => p.company_id === companyId && !!integrationId && p.integration_id === integrationId).length;

    // 2. Staff, Agents and Agent Performance
    const employees = db.find('employees', e => e.company_id === companyId && e.status === 'ACTIVE');
    const agents = db.find('agents', a => a.company_id === companyId && a.status === 'ACTIVE');
    const allOrders = db.find('sales_orders', o => o.company_id === companyId && o.status !== 'CANCELLED' && matchesIntegrationSource(o, sourceScopeId));

    const agentPerfMap = new Map<string, { name: string; sales: number; ordersCount: number }>();
    for (const a of agents) {
      agentPerfMap.set(a.id, { name: a.full_name, sales: 0, ordersCount: 0 });
    }

    for (const o of allOrders) {
      // Orders carry their agent in agent_id (created_by is the importing user).
      const agentId = o.agent_id || o.created_by;
      if (agentId && agentPerfMap.has(agentId)) {
        const perf = agentPerfMap.get(agentId)!;
        perf.sales += o.total_sales;
        perf.ordersCount += 1;
      }
    }
    const topAgents = Array.from(agentPerfMap.values())
      .sort((a, b) => b.sales - a.sales)
      .slice(0, 5);

    // 3. Customers & Receivables (Nasiyalar)
    const customers = db.find('customers', c => c.company_id === companyId && matchesIntegrationSource(c, sourceScopeId));
    let totalCustomerDebt = 0;
    let overdueCount = 0;
    for (const c of customers) {
      if ((c.current_balance || 0) > 0) {
        totalCustomerDebt += c.current_balance;
        // Over the limit only when a limit is set (no invented default limit).
        if ((c.credit_limit || 0) > 0 && c.current_balance > c.credit_limit) {
          overdueCount++;
        }
      }
    }

    const topDebtors = customers
      .filter(c => (c.current_balance || 0) > 0)
      .sort((a, b) => (b.current_balance || 0) - (a.current_balance || 0))
      .slice(0, 5)
      .map(c => ({
        name: c.name,
        code: c.code,
        phone: c.phone,
        debt: c.current_balance
      }));

    // 4. Products, Inventory & Stock Run Rate
    const stockRunRate = ForecastService.getStockRunRate(companyId, 1.0);
    const stockOutAnalysis = ForecastService.getOutOfStockLostProfit(companyId);
    const allProducts = db.find('products', p => p.company_id === companyId && p.is_active && matchesIntegrationSource(p, sourceScopeId));

    // Top selling products by historical volume
    const topProducts = allProducts
      .filter(p => (p.daily_sales_avg || 0) > 0)
      .sort((a, b) => (b.daily_sales_avg || 0) - (a.daily_sales_avg || 0))
      .slice(0, 5)
      .map(p => ({
        name: p.name,
        sku: p.sku,
        stock: p.stock_quantity || 0,
        daily_sales: p.daily_sales_avg || 0,
        price: p.selling_price || 0
      }));

    // 5. Historical Sales Performance (Last 30 days)
    const recentOrders = allOrders.filter(o => o.order_date >= thirtyDaysAgo);
    const recentRevenue = recentOrders.reduce((sum, o) => sum + o.total_sales, 0);
    const avgDailyRevenue = recentOrders.length > 0 ? Math.round(recentRevenue / 30) : 0;

    // 6. Today's Delivery & Cash State
    const todayEntries = cashDay ? db.find('daily_order_entries', e => e.cash_day_id === cashDay.id) : [];
    let deliveredCount = 0;
    let deliveredSales = 0;
    let pendingDeliveryCount = 0;
    let pendingDeliverySales = 0;

    for (const e of todayEntries) {
      if (e.status === 'DELIVERED' || (e.note && e.note.includes('Yetkazildi'))) {
        deliveredCount++;
        deliveredSales += e.sale_amount;
      } else {
        pendingDeliveryCount++;
        pendingDeliverySales += e.sale_amount;
      }
    }

    const todayExpenses = db.find('expenses', e => e.company_id === companyId && e.status === 'CONFIRMED' && e.date === today);
    const totalExpenses = todayExpenses.reduce((sum, e) => sum + e.amount, 0) || (cashDay?.expense_amount || 0);

    const todaySales = cashDay?.total_sales || (deliveredSales + pendingDeliverySales);
    // Same rules as the P&L report: delivered sales, real product cost, no percentage guess.
    const todayPnl = AnalyticsService.getProfitAndLoss(companyId, today, today, sourceScopeId);
    const todayGrossProfit = todayPnl.cogs_complete ? todayPnl.gross_profit : null;
    const todayNetProfit = todayGrossProfit === null ? null : todayGrossProfit - totalExpenses;
    const netMarginPct = todayNetProfit !== null && todayPnl.net_revenue > 0 ? Number(((todayNetProfit / todayPnl.net_revenue) * 100).toFixed(1)) : null;

    const cashInHand = (cashDay?.status === 'CLOSED' ? cashDay.actual_closing_balance : cashDay?.calculated_closing_balance) ?? cashDay?.closing_balance ?? cashDay?.opening_balance ?? 0;

    return {
      company_id: companyId,
      integration: {
        provider: activeIntegration?.provider_name || 'ULANMAGAN',
        is_active: activeIntegration?.status === 'CONNECTED',
        last_sync: activeIntegration?.last_sync_at || 'Mavjud emas',
        synced_counts: {
          orders: extOrdersCount,
          customers: extCustomersCount,
          payments: extPaymentsCount
        }
      },
      workforce: {
        total_employees: employees.length,
        total_agents: agents.length,
        top_agents: topAgents
      },
      customers_and_debt: {
        total_customers: customers.length,
        total_debt_uzs: totalCustomerDebt,
        overdue_debtors_count: overdueCount,
        top_debtors: topDebtors
      },
      inventory: {
        total_sku_count: allProducts.length,
        total_stock_value_uzs: stockRunRate.summary.total_stock_value_uzs,
        avg_days_remaining: stockRunRate.summary.avg_days_remaining,
        out_of_stock_count: stockOutAnalysis.summary.out_of_stock_count,
        total_lost_profit_uzs: stockOutAnalysis.summary.total_lost_profit_uzs,
        total_lost_sales_uzs: stockOutAnalysis.summary.total_lost_sales_uzs,
        estimate_unknown_count: stockOutAnalysis.summary.estimate_unknown_count,
        out_of_stock_items: stockOutAnalysis.items,
        top_selling_products: topProducts
      },
      historical_sales: {
        last_30_days_revenue_uzs: recentRevenue,
        avg_daily_revenue_uzs: avgDailyRevenue,
        total_orders_count: allOrders.length
      },
      today: {
        date: today,
        cash_day_status: cashDay?.status || 'OCHILMAGAN',
        total_sales: todaySales,
        delivered_count: deliveredCount,
        delivered_sales: deliveredSales,
        pending_delivery_count: pendingDeliveryCount,
        pending_delivery_sales: pendingDeliverySales,
        cash_inflow: cashDay?.cash_inflow || 0,
        cash_outflow: cashDay?.cash_outflow || 0,
        cash_in_hand: cashInHand,
        expenses: totalExpenses,
        gross_profit: todayGrossProfit,
        net_profit: todayNetProfit,
        net_margin_pct: netMarginPct
      }
    };
  }

  /**
   * Prepares complete real business facts from the database
   */
  private static getCompanyFinancialContext(companyId: string) {
    const profile = this.getCompleteBusinessProfile(companyId);
    return {
      daily_sales: profile.today.total_sales,
      daily_inflow: profile.today.cash_inflow,
      daily_outflow: profile.today.cash_outflow,
      operating_expenses: profile.today.expenses,
      gross_profit: profile.today.gross_profit,
      net_profit: profile.today.net_profit,
      net_margin_pct: profile.today.net_margin_pct,
      cash_in_hand: profile.today.cash_in_hand,
      stock_summary: ForecastService.getStockRunRate(companyId).summary,
      stockout_summary: {
        out_of_stock_count: profile.inventory.out_of_stock_count,
        total_lost_profit_uzs: profile.inventory.total_lost_profit_uzs,
        total_lost_sales_uzs: profile.inventory.total_lost_sales_uzs,
        estimate_unknown_count: profile.inventory.estimate_unknown_count
      },
      out_of_stock_items: profile.inventory.out_of_stock_items,
      total_customer_debt: profile.customers_and_debt.total_debt_uzs,
      overdue_debtors_count: profile.customers_and_debt.overdue_debtors_count,
      business_profile: profile
    };
  }

  /**
   * Generates comprehensive AI Financial & Inventory Audit
   */
  public static async generateAuditAnalysis(companyId: string): Promise<AIAnalysisResult> {
    const ctx = this.getCompanyFinancialContext(companyId);
    const now = new Date().toISOString();
    const ai = this.getAIClient(companyId);

    const metricsSnapshot = {
      daily_sales: ctx.daily_sales,
      daily_inflow: ctx.daily_inflow,
      daily_outflow: ctx.daily_outflow,
      operating_expenses: ctx.operating_expenses,
      net_profit: ctx.net_profit,
      net_margin_pct: ctx.net_margin_pct,
      cash_in_hand: ctx.cash_in_hand,
      out_of_stock_count: ctx.stockout_summary.out_of_stock_count,
      total_lost_profit_uzs: ctx.stockout_summary.total_lost_profit_uzs,
      total_lost_sales_uzs: ctx.stockout_summary.total_lost_sales_uzs,
      estimate_unknown_count: ctx.stockout_summary.estimate_unknown_count,
      avg_inventory_days: ctx.stock_summary.avg_days_remaining,
      total_customer_debt: ctx.total_customer_debt
    };

    if (ai) {
      try {
        const prompt = `Siz yirik distribyutsiya kompaniyasining Bosh Moliyaviy va Ombor Tahlilchisi (Chief Financial & Inventory AI Analyst)siz.
Kompaniyaning bugungi haqiqiy moliyaviy va ombor ko'rsatkichlari quyidagicha:
- Kunlik savdo hajmi: ${ctx.daily_sales.toLocaleString()} UZS
- Kassaga tushum (Inflow): ${ctx.daily_inflow.toLocaleString()} UZS
- Chiqim (Outflow): ${ctx.daily_outflow.toLocaleString()} UZS
- Kunlik tasdiqlangan xarajatlar (Rasxodlar): ${ctx.operating_expenses.toLocaleString()} UZS
- Kunlik SOF FOYDA (Net Profit): ${fmtProfit(ctx.net_profit, ctx.net_margin_pct)}
- Kassadagi naqd qoldiq: ${ctx.cash_in_hand.toLocaleString()} UZS
- Ombordagi tovarlar o'rtacha necha kunga yetishi: ${ctx.stock_summary.avg_days_remaining} kun
- Tugagan mahsulotlar soni: ${ctx.stockout_summary.out_of_stock_count} ta
- Mavjud ma’lumotga ko‘ra TAXMINIY boy berilgan sof foyda: ${ctx.stockout_summary.total_lost_profit_uzs.toLocaleString()} UZS
- Mavjud ma’lumotga ko‘ra TAXMINIY boy berilgan savdo: ${ctx.stockout_summary.total_lost_sales_uzs.toLocaleString()} UZS
- Sana yoki talab tarixi yetarli bo‘lmagani uchun hisoblanmagan mahsulotlar: ${ctx.stockout_summary.estimate_unknown_count} ta. Ularni nol yo‘qotish deb talqin qilmang.
- Tugagan tovarlar ro'yxati:
${ctx.out_of_stock_items.map(i => `  * ${i.name}: ${i.days_out_of_stock === null ? '0 qoldiq sanasi tasdiqlanmagan' : `0 qoldiq ${i.days_out_of_stock} kun oldin tasdiqlangan`}, ${i.estimate_status === 'ESTIMATED' ? `taxminiy savdo yo‘qotishi ${i.lost_sales_uzs.toLocaleString()} UZS` : 'yo‘qotish hisoblanmagan — ma’lumot yetarli emas'}`).join('\n')}
- Mijozlar qarzdorligi (Nasiyalar): ${ctx.total_customer_debt.toLocaleString()} UZS (Limitdan oshgan: ${ctx.overdue_debtors_count} ta)

Iltimos, o'zbek tilida professional, lo'nda va amaliy tahlil taqdim eting.
Format:
JSON ob'ekt qaytaring:
{
  "executive_summary": "1-2 jumlada korxonaning bugungi umumiy holati va asosiy e'tibor qaratish kerak bo'lgan xavf",
  "key_findings": [
    { "category": "INVENTORY_STOCKOUT", "title": "Sarlavha", "description": "Tavsif", "severity": "CRITICAL" },
    { "category": "PROFITABILITY", "title": "Sarlavha", "description": "Tavsif", "severity": "HEALTHY" },
    { "category": "DEBT_RISK", "title": "Sarlavha", "description": "Tavsif", "severity": "WARNING" },
    { "category": "CASH_FLOW", "title": "Sarlavha", "description": "Tavsif", "severity": "HEALTHY" }
  ],
  "actionable_recommendations": [
    "1-tavsiya",
    "2-tavsiya",
    "3-tavsiya",
    "4-tavsiya"
  ]
}
Faqat sof JSON formatida javob bering, markdown belgilarsiz.`;

        const response = await ai.models.generateContent({
          model: 'gemini-3.8-flash',
          contents: prompt,
          config: {
            temperature: 0.2
          }
        });

        const rawText = response.text || '';
        const cleanJson = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
        const parsed = JSON.parse(cleanJson);

        return {
          generated_at: now,
          is_live_ai: true,
          model: this.modelName(companyId),
          executive_summary: parsed.executive_summary,
          key_findings: parsed.key_findings,
          actionable_recommendations: parsed.actionable_recommendations,
          metrics_snapshot: metricsSnapshot
        };
      } catch (err) {
        console.warn('[AIService] Gemini API call fallback triggered:', err);
      }
    }

    // Deterministic, truthful high-level business intelligence fallback
    const topMissing = ctx.out_of_stock_items[0];
    const lostProfitUzs = new Intl.NumberFormat('uz-UZ').format(ctx.stockout_summary.total_lost_profit_uzs);
    const netProfitUzs = fmtProfit(ctx.net_profit);

    return {
      generated_at: now,
      is_live_ai: false,
      model: 'Distro AI Rules Engine (Deterministic)',
      executive_summary: `Mahalliy hisob-kitob: savdo ${ctx.daily_sales.toLocaleString()} UZS, operatsion natija ${netProfitUzs}. AI javobi olinmadi. Ma’lumot to‘liqligini tekshiring.`,
      key_findings: [{category: 'CASH_FLOW', title: 'Hisobdagi naqd qoldiq', description: `${ctx.cash_in_hand.toLocaleString()} UZS. Kelajak majburiyatlari kiritilmagan bo‘lsa, mablag‘ yetarliligini baholab bo‘lmaydi.`, severity: 'WARNING'}],
      actionable_recommendations: ['Kassa, bank, savdo va qarzdorlik yozuvlarini manba hujjatlar bilan solishtiring.'],
      metrics_snapshot: metricsSnapshot
    };
  }

  /**
   * Interactive AI Agent chat handler
   */
  public static async chatWithAgent(companyId: string, userMessage: string, history: { role: string; text: string }[] = []) {
    const ctx = this.getCompanyFinancialContext(companyId);
    const ai = this.getAIClient(companyId);

    const lower = userMessage.toLowerCase();

    // Check for explicit action requests in message
    let actionTriggered: { type: string; details?: any } | undefined;

    // Chat provides advice; mutations use dedicated validated forms.

    const prof = ctx.business_profile;
    // Said above a rule-based answer, so nobody takes it for the AI's.
    let ai_note: string | undefined = ai ? undefined : 'AI ulanmagan — bu oddiy hisob-kitob javobi. Haqiqiy AI uchun egasi Jarvis → Sozlamalar’da Claude API kalitini kiritsin.';

    if (ai) {
      try {
        const topAgentsList = prof.workforce.top_agents.length > 0
          ? prof.workforce.top_agents.map((a, i) => `  ${i+1}. ${a.name}: ${a.sales.toLocaleString()} UZS (${a.ordersCount} ta buyurtma)`).join('\n')
          : '  Savdo agentlari hali ro\'yxatga olinmagan yoki savdo qayd etilmagan';

        const topDebtorsList = prof.customers_and_debt.top_debtors.length > 0
          ? prof.customers_and_debt.top_debtors.map((d, i) => `  ${i+1}. ${d.name} (${d.phone}): ${d.debt.toLocaleString()} UZS`).join('\n')
          : '  Qarzdor mijozlar mavjud emas';

        const topProductsList = prof.inventory.top_selling_products.length > 0
          ? prof.inventory.top_selling_products.map((p, i) => `  ${i+1}. ${p.name}: Kunlik sotuv ~${p.daily_sales} dona, omborda ${p.stock} dona`).join('\n')
          : '  Tovar savdo tahlili shakllanmoqda';

        const systemPrompt = `Siz "Distro Finance AI Maslahatchisi" - foydalanuvchining distribyutsiya biznesi, moliyasi, ombori va savdo agentlari bo'yicha to'liq xabardor bosh konsultantisiz.
Siz ulangan dasturlar (${prof.integration.provider}) va ichki bazadan faqat quyidagi mavjud ma’lumotlarni ko‘rgansiz:

1. ULANGAN TIZIM & INTEGRATSIYA:
- Provayder: ${prof.integration.provider} (${prof.integration.is_active ? 'Faol' : 'Nofaol'})
- Oxirgi sinxronizatsiya: ${prof.integration.last_sync}
- Sinxronlangan ma'lumotlar: ${prof.integration.synced_counts.orders} ta buyurtma, ${prof.integration.synced_counts.customers} ta mijoz, ${prof.integration.synced_counts.payments} ta to'lov

2. XODIMLAR VA SAVDO AGENTLARI:
- Jami xodimlar: ${prof.workforce.total_employees} ta, Agentlar: ${prof.workforce.total_agents} ta
- Eng ko'p sotgan agentlar:
${topAgentsList}

3. SOTUV VA BUYURTMALAR (OLDINGI TAHLIL & BUGUN):
- Oxirgi 30 kunlik jami tushum: ${prof.historical_sales.last_30_days_revenue_uzs.toLocaleString()} UZS
- O'rtacha kunlik sotuv: ${prof.historical_sales.avg_daily_revenue_uzs.toLocaleString()} UZS
- Jami buyurtmalar soni: ${prof.historical_sales.total_orders_count} ta
- BUGUNGI SOTUV SUMMASI: ${prof.today.total_sales.toLocaleString()} UZS
- Bugun YETKAZILDI: ${prof.today.delivered_count} ta buyurtma (${prof.today.delivered_sales.toLocaleString()} UZS)
- Bugun YETKAZILADI (Kutilayotgan): ${prof.today.pending_delivery_count} ta buyurtma (${prof.today.pending_delivery_sales.toLocaleString()} UZS)

4. MOLIYA & KASSA:
- Kassadagi naqd qoldiq: ${prof.today.cash_in_hand.toLocaleString()} UZS
- Kunlik kassa kirimi (Inflow): ${prof.today.cash_inflow.toLocaleString()} UZS
- Kunlik chiqim (Outflow): ${prof.today.cash_outflow.toLocaleString()} UZS
- Bugungi tasdiqlangan rasxodlar: ${prof.today.expenses.toLocaleString()} UZS
- Bugungi operatsion sof foyda: ${fmtProfit(prof.today.net_profit, prof.today.net_margin_pct)}

5. OMBOR VA ZAXIRALAR:
- Tovar nomenklaturasi: ${prof.inventory.total_sku_count} ta SKU
- Zaxiralar o'rtacha ${prof.inventory.avg_days_remaining} kunga yetadi
- Tugagan mahsulotlar: ${prof.inventory.out_of_stock_count} ta (Boy berilgan foyda: ${prof.inventory.total_lost_profit_uzs.toLocaleString()} UZS)
- Eng xaridorgir tovarlar:
${topProductsList}

6. MIJOZLAR VA NASIYALAR:
- Jami mijozlar: ${prof.customers_and_debt.total_customers} ta
- Jami nasiya qarzdorlik: ${prof.customers_and_debt.total_debt_uzs.toLocaleString()} UZS
- Kredit limitidan oshganlar: ${prof.customers_and_debt.overdue_debtors_count} ta
- Eng katta qarzdorlar:
${topDebtorsList}

Ko'rsatma: Foydalanuvchining savoliga o'zbek tilida, aniq faktlar va raqamlar bilan, o'ta xushmuomala va biznes egasiga yordam beradigan ruhda javob bering.`;

        const response = await ai.models.generateContent({
          model: 'gemini-3.8-flash',
          contents: userMessage,
          config: {
            temperature: 0.3,
            systemInstruction: systemPrompt
          }
        });

        return {
          reply: response.text || 'Xizmatdan foydalanishda javob olinmadi.',
          actionTriggered,
          metrics: {
            net_profit: ctx.net_profit,
            cash_in_hand: ctx.cash_in_hand,
            lost_profit: ctx.stockout_summary.total_lost_profit_uzs,
            out_of_stock_count: ctx.stockout_summary.out_of_stock_count
          }
        };
      } catch (err: any) {
        console.warn('[AIService] AI chat fallback:', err?.message || err);
        ai_note = `AI javob bermadi (${String(err?.message || err).slice(0, 200)}) — quyida oddiy hisob-kitob javobi.`;
      }
    }

    // Deterministic conversational agent fallback
    let reply = '';
    const lostUzs = new Intl.NumberFormat('uz-UZ').format(ctx.stockout_summary.total_lost_profit_uzs);
    const netProfitUzs = fmtProfit(ctx.net_profit);
    const cashUzs = new Intl.NumberFormat('uz-UZ').format(ctx.cash_in_hand);

    if (lower.includes('agent') || lower.includes('hodim') || lower.includes('xodim') || lower.includes('kim ko\'p') || lower.includes('eng ko\'p')) {
      if (prof.workforce.top_agents.length > 0) {
        reply = `Agentlarimiz savdo reytingi:\n` +
          prof.workforce.top_agents.map((a, i) => `${i+1}. ${a.name} — ${a.sales.toLocaleString()} UZS (${a.ordersCount} ta buyurtma)`).join('\n') +
          `\n\nJami faol agentlar: ${prof.workforce.total_agents} ta, umumiy xodimlar: ${prof.workforce.total_employees} ta.`;
      } else {
        reply = `Hozirda tizimda ${prof.workforce.total_agents} ta agent va ${prof.workforce.total_employees} ta xodim ro'yxatdan o'tgan. Integratsiyadan yangi buyurtmalar sinxronlangach, ularning sotuv dinamikasi bu yerda shakllanadi.`;
      }
    } else if (lower.includes('yetkazildi') || lower.includes('yetkaziladi') || lower.includes('dostavka') || lower.includes('yetkazish')) {
      reply = `Bugungi yetkazib berish (Dostavka) holati:\n` +
        `• Yetkazildi: ${prof.today.delivered_count} ta buyurtma (${prof.today.delivered_sales.toLocaleString()} UZS)\n` +
        `• Yetkaziladi (Kutilmoqda): ${prof.today.pending_delivery_count} ta buyurtma (${prof.today.pending_delivery_sales.toLocaleString()} UZS)\n` +
        `• Jami kunlik savdo: ${prof.today.total_sales.toLocaleString()} UZS.\n` +
        `Barcha buyurtmalar kunlik kassa reestri bilan to'liq bog'langan.`;
    } else if (lower.includes('biznes') || lower.includes('xulosa') || lower.includes('tizim') || lower.includes('haqida')) {
      reply = `Sizning biznesingiz bo'yicha to'liq axborot:\n` +
        `• Ulangan tizim: ${prof.integration.provider} (${prof.integration.is_active ? 'Faol' : 'Nofaol'})\n` +
        `• Oxirgi 30 kunlik savdo hajmi: ${prof.historical_sales.last_30_days_revenue_uzs.toLocaleString()} UZS (Kunlik o'rtacha: ${prof.historical_sales.avg_daily_revenue_uzs.toLocaleString()} UZS)\n` +
        `• Bugungi savdo: ${prof.today.total_sales.toLocaleString()} UZS (Yetkazildi: ${prof.today.delivered_sales.toLocaleString()} UZS, Yetkaziladi: ${prof.today.pending_delivery_sales.toLocaleString()} UZS)\n` +
        `• Kassadagi naqd qoldiq: ${cashUzs} UZS\n` +
        `• Nasiyalar portfeli: ${prof.customers_and_debt.total_debt_uzs.toLocaleString()} UZS (${prof.customers_and_debt.total_customers} ta mijoz)\n` +
        `• Xodimlar: ${prof.workforce.total_employees} ta (shulardan ${prof.workforce.total_agents} ta savdo agenti)\n` +
        `• Ombordagi tovarlar: ${prof.inventory.total_sku_count} ta SKU, o'rtacha ${prof.inventory.avg_days_remaining} kunga yetadi.`;
    } else if (lower.includes('tugagan') || lower.includes('mahsulot') || lower.includes('boy berilgan') || lower.includes('foydadan')) {
      reply = `Hozirda omborda ${ctx.stockout_summary.out_of_stock_count} ta xaridorgir tovar tugagan:\n` +
        ctx.out_of_stock_items.map(i => `• ${i.name}: ${i.days_out_of_stock === null ? 'qachondan beri yo‘qligi noma’lum' : `${i.days_out_of_stock} kundan beri yo'q`}, boy berilgan sof foyda: ${(i.lost_profit_uzs).toLocaleString()} UZS`).join('\n') +
        `\n\nJami boy berilgan sof foyda: ${lostUzs} UZS! Adminga darhol SMS eslatma jo'natishimiz yoki ta'minotchiga buyurtma shakllantirishimiz mumkin.`;
    } else if (lower.includes('qoldiq') || lower.includes('necha kunga') || lower.includes('ombor')) {
      reply = `Ombordagi tovarlar oldingi sotuvlar dinamikasi bo'yicha o'rtacha ${ctx.stock_summary.avg_days_remaining} kunga yetadi.\n` +
        `• Tugagan tovarlar: ${ctx.stock_summary.out_of_stock_count} ta\n` +
        `• Kritik xavf (≤3 kun): ${ctx.stock_summary.critical_count} ta\n` +
        `• Kam qoldiq (≤7 kun): ${ctx.stock_summary.low_count} ta\n` +
        `• Barqaror qoldiq: ${ctx.stock_summary.optimal_count} ta.\n` +
        `Zaxiralarni me'yorga keltirish uchun tavsiya etilgan zakaz summasi: ${(ctx.stock_summary.total_reorder_cost_uzs).toLocaleString()} UZS.`;
    } else if (lower.includes('foyda') || lower.includes('savdo') || lower.includes('kassa') || lower.includes('balans')) {
      reply = `Bugungi moliyaviy ko'rsatkichlar:\n` +
        `• Kunlik savdo hajmi: ${(ctx.daily_sales).toLocaleString()} UZS (Yetkazildi: ${prof.today.delivered_sales.toLocaleString()} UZS, Yetkaziladi: ${prof.today.pending_delivery_sales.toLocaleString()} UZS)\n` +
        `• Kunlik tushum (Inflow): ${(ctx.daily_inflow).toLocaleString()} UZS\n` +
        `• Chiqim (Outflow): ${(ctx.daily_outflow).toLocaleString()} UZS\n` +
        `• Rasxodlar (Xarajatlar): ${(ctx.operating_expenses).toLocaleString()} UZS\n` +
        `• SOF FOYDA: ${fmtProfit(ctx.net_profit, ctx.net_margin_pct)}\n` +
        `• Kassadagi naqd qoldiq: ${cashUzs} UZS.`;
    } else if (lower.includes('nasiya') || lower.includes('qarz') || lower.includes('mijoz')) {
      const topDebtorsText = prof.customers_and_debt.top_debtors.length > 0
        ? `\nEng katta qarzdorlar:\n` + prof.customers_and_debt.top_debtors.map(d => `• ${d.name} (${d.phone}): ${d.debt.toLocaleString()} UZS`).join('\n')
        : '';
      reply = `Mijozlarning jami qarzdorligi (Nasiyalar): ${(ctx.total_customer_debt).toLocaleString()} UZS.\n` +
        `Ushbu summadan ${ctx.overdue_debtors_count} ta mijoz ruxsat etilgan kredit limitidan oshib ketgan.${topDebtorsText}\n\n` +
        `Nasiyalarni qat'iy nazorat qilish uchun Akt Sverka va SMS eslatmalar modulidan foydalaning.`;
    } else {
      reply = `Assalomu alaykum! Men sizning Distro AI Moliya va Biznes Maslahatchisingizman.\n` +
        `Biznesingizning bugungi asosiy ko'rsatkichlari:\n` +
        `• Ulangan tizim: ${prof.integration.provider}\n` +
        `• Bugungi savdo: ${prof.today.total_sales.toLocaleString()} UZS (${prof.today.delivered_count} ta yetkazildi, ${prof.today.pending_delivery_count} ta yetkaziladi)\n` +
        `• Kassadagi naqd qoldiq: ${cashUzs} UZS\n` +
        `• Sof foyda: ${netProfitUzs}\n` +
        `• Tugagan mahsulotlar: ${ctx.stockout_summary.out_of_stock_count} ta (Boy berilgan foyda: ${lostUzs} UZS)\n\n` +
        `Qaysi ma'lumotni bilmoqchisiz? Masalan: "Agentlarim qancha sotdi?", "Bugun qancha yetkazildi va yetkaziladi?", "Eng katta qarzdorlar kim?", "Biznesim haqida to'liq xulosa ber".`;
    }

    return {
      reply,
      ai_note,
      actionTriggered,
      metrics: {
        net_profit: ctx.net_profit,
        cash_in_hand: ctx.cash_in_hand,
        lost_profit: ctx.stockout_summary.total_lost_profit_uzs,
        out_of_stock_count: ctx.stockout_summary.out_of_stock_count
      }
    };
  }
}
