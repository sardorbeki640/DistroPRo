import React from 'react';
import { AlertTriangle, TrendingUp, ShieldAlert, Sparkles, DollarSign, ArrowUpRight, CheckCircle2 } from 'lucide-react';
import { DailyOrderEntry, Agent } from '../../../types.ts';

interface CashSmartAlertsProps {
  items: DailyOrderEntry[];
  agents: Agent[];
  currency: 'UZS' | 'USD';
  onToggleCurrency: (c: 'UZS' | 'USD') => void;
  usdRate: number;
}

export const CashSmartAlerts: React.FC<CashSmartAlertsProps> = ({
  items,
  agents,
  currency,
  onToggleCurrency,
  usdRate
}) => {
  // Analyze anomalies
  const totalSales = items.reduce((sum, i) => sum + (i.sale_amount || 0), 0);
  const totalDebt = items.reduce((sum, i) => sum + (i.remaining_debt || 0), 0);
  const totalInflow = items.reduce((sum, i) => sum + (i.cash_payment || 0) + (i.uy_oplata || 0) + (i.nasiyadan_kirim || 0) + (i.terminal_click || 0), 0);

  // Group by agent to check debt concentration
  const agentMap = new Map<string, { name: string; sales: number; debt: number; count: number }>();
  for (const item of items) {
    const agName = item.agent_name || 'Umumiy';
    const curr = agentMap.get(agName) || { name: agName, sales: 0, debt: 0, count: 0 };
    curr.sales += item.sale_amount || 0;
    curr.debt += item.remaining_debt || 0;
    curr.count += 1;
    agentMap.set(agName, curr);
  }

  const suspiciousAgents = Array.from(agentMap.values()).filter(a => {
    return a.sales > 5000000 && (a.debt / a.sales) > 0.45;
  });

  const highDebtOrders = items.filter(i => (i.remaining_debt || 0) >= 3000000);

  const formatMoney = (amount: number) => {
    if (currency === 'USD' && usdRate > 0) {
      return `$${(amount / usdRate).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`;
    }
    return `${amount.toLocaleString()} UZS`;
  };

  return (
    <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white rounded-2xl p-4 shadow-md border border-indigo-900/50">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-indigo-800/40 pb-3 mb-3">
        <div className="flex items-center space-x-2">
          <div className="p-1.5 bg-indigo-500/20 text-indigo-300 rounded-lg border border-indigo-500/30">
            <Sparkles className="w-4 h-4 text-amber-300 animate-pulse" />
          </div>
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-indigo-200 flex items-center gap-1.5">
              Aqlli Tizim & Xavfsizlik Nazorati (Smart AI Audit)
              <span className="px-1.5 py-0.2 bg-emerald-500/20 text-emerald-300 text-[10px] rounded border border-emerald-500/30">
                FAOL
              </span>
            </h3>
            <p className="text-[11px] text-indigo-300/80">
              Anomaliyalar tahlili, qarzdorlik konsentratsiyasi va valyuta kursi
            </p>
          </div>
        </div>

        {/* Multi-Currency Toggle */}
        <div className="flex items-center space-x-2 bg-indigo-950/80 px-3 py-1.5 rounded-xl border border-indigo-800/60 text-xs">
          <span className="text-[11px] text-indigo-300">Valyuta:</span>
          <button
            onClick={() => onToggleCurrency('UZS')}
            className={`px-2 py-0.5 rounded-md font-bold transition text-xs ${
              currency === 'UZS' ? 'bg-indigo-600 text-white shadow-xs' : 'text-indigo-300 hover:text-white'
            }`}
          >
            UZS (So'm)
          </button>
          <button
            onClick={() => onToggleCurrency('USD')}
            disabled={!(usdRate > 0)}
            className={`px-2 py-0.5 rounded-md font-bold transition text-xs ${
              currency === 'USD' ? 'bg-emerald-600 text-white shadow-xs' : 'text-indigo-300 hover:text-white'
            }`}
          >
            USD ($)
          </button>
          <span className="text-[10px] text-indigo-400 pl-1 border-l border-indigo-800/60">
            {usdRate > 0 ? `1$ = ${usdRate.toLocaleString()} UZS (Markaziy bank)` : 'Dollar kursi olinmadi'}
          </span>
        </div>
      </div>

      {/* Anomaly Badges / Insights */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
        {/* Insight 1: General Flow */}
        <div className="bg-white/5 rounded-xl p-2.5 border border-white/10 flex items-start space-x-2.5">
          <TrendingUp className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold text-neutral-200">Kirim koeffitsiyenti:</span>
            <p className="text-[11px] text-neutral-300 mt-0.5">
              {totalSales > 0 ? Math.round((totalInflow / totalSales) * 100) : 0}% naqd/elektron yig'ildi. Nasiya ulushi:{' '}
              {totalSales > 0 ? Math.round((totalDebt / totalSales) * 100) : 0}%.
            </p>
          </div>
        </div>

        {/* Insight 2: Suspicious Debt Concentration */}
        <div className="bg-white/5 rounded-xl p-2.5 border border-white/10 flex items-start space-x-2.5">
          {suspiciousAgents.length > 0 ? (
            <>
              <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold text-amber-300">Qarz konsentratsiyasi:</span>
                <p className="text-[11px] text-neutral-300 mt-0.5">
                  {suspiciousAgents.map(a => `${a.name} (${Math.round((a.debt/a.sales)*100)}% nasiya)`).join(', ')}
                </p>
              </div>
            </>
          ) : (
            <>
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold text-emerald-300">Agentlar balansi xavfsiz:</span>
                <p className="text-[11px] text-neutral-300 mt-0.5">
                  Barcha agentlarda nasiya ulushi 45% dan past me'yorda.
                </p>
              </div>
            </>
          )}
        </div>

        {/* Insight 3: High single tickets */}
        <div className="bg-white/5 rounded-xl p-2.5 border border-white/10 flex items-start space-x-2.5">
          <AlertTriangle className="w-4 h-4 text-indigo-300 shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold text-indigo-200">Yirik nasiyalar (&gt; 3 mln):</span>
            <p className="text-[11px] text-neutral-300 mt-0.5">
              {highDebtOrders.length > 0
                ? `${highDebtOrders.length} ta yirik qarzli do'kon mavjud. Alohida nazoratga olindi.`
                : "Ushbu kunda 3 mln UZS dan yuqori xavfli nasiya yo'q."}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
