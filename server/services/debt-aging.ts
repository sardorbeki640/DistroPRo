import { db } from '../db/database.ts';
import { businessToday, daysBetween } from '../utils/date.ts';

/** A part of a customer's debt that is still unpaid. `date: null` = origin date unknown. */
export interface OpenDebtLot { date: string | null; amount: number }

/**
 * Open debt of a customer after applying payments to the oldest debts first (FIFO).
 * The lots always add up to the customer's debt, so aging buckets can never exceed what is owed.
 * A cached balance above the ledger (imported without history) becomes a lot of unknown age.
 */
/**
 * The company's ledger rows grouped by customer, read once. Pass it to openDebtLots when going through many
 * customers: otherwise every customer scans the whole ledger (thousands of customers × all rows = seconds).
 */
export function ledgerByCustomer(companyId: string): Map<string, any[]> {
  const map = new Map<string, any[]>();
  for (const t of db.find('customer_balance_transactions', t => t.company_id === companyId && t.status !== 'REVERSED')) {
    let list = map.get(t.customer_id);
    if (!list) map.set(t.customer_id, (list = []));
    list.push(t);
  }
  return map;
}

export function openDebtLots(companyId: string, customerId: string, asOf: string = businessToday(), ledger?: Map<string, any[]>): { lots: OpenDebtLot[]; debt: number; prepaid: number } {
  const rows = ledger ? ledger.get(customerId) || [] : db.find('customer_balance_transactions', t => t.company_id === companyId && t.customer_id === customerId && t.status !== 'REVERSED');
  const txs = rows.filter(t => (t.date || t.transaction_date || t.created_at.slice(0, 10)) <= asOf)
    .sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.created_at.localeCompare(b.created_at));

  const lots: OpenDebtLot[] = [];
  let credit = 0; // payments not yet matched to a debt (prepayment)
  for (const t of txs) {
    if (t.transaction_type === 'DEBIT') {
      let amount = t.amount;
      const used = Math.min(credit, amount);
      credit -= used;
      amount -= used;
      if (amount > 0) lots.push({ date: t.age_unknown ? null : (t.date || t.created_at.slice(0, 10)), amount });
    } else {
      credit += t.amount;
      // Unknown-age debt is the oldest by definition, then by date.
      lots.sort((a, b) => (a.date === null ? -1 : b.date === null ? 1 : a.date.localeCompare(b.date)));
      while (credit > 0 && lots.length) {
        const used = Math.min(credit, lots[0].amount);
        lots[0].amount -= used;
        credit -= used;
        if (lots[0].amount <= 0) lots.shift();
      }
    }
  }

  let debt = lots.reduce((s, l) => s + l.amount, 0);
  if (asOf >= businessToday()) {
    const cached = db.findById('customers', customerId)?.current_balance || 0;
    const ledgerBalance = debt - credit;
    if (cached > ledgerBalance + 1) {
      lots.unshift({ date: null, amount: cached - ledgerBalance });
      debt += cached - ledgerBalance;
    }
  }
  return { lots, debt: Math.round(debt), prepaid: Math.round(credit) };
}

export function lotAge(lot: OpenDebtLot, asOf: string): number | null {
  return lot.date === null ? null : Math.max(0, daysBetween(lot.date, asOf));
}
