import { createHash } from 'node:crypto';
import { db } from '../db/database.ts';
import type { IntegrationAdapter, RemotePayment } from '../integrations/interfaces.ts';
import { activeDistribution, systemName } from '../integrations/distribution.ts';
import { integrationProvider } from '../integrations/provider.ts';
import { CashService } from './cash.service.ts';
import { AuditService } from './audit.service.ts';

/** The system refused the payment (nothing recorded there), as opposed to no answer. Older rows: the SalesDoctor text. */
function isExplicitRefusal(job: { refused?: boolean | null; error_message?: string | null }): boolean {
  if (job.refused) return true;
  const message = job.error_message;
  if (!message || !/SalesDoctor \[setPayment\] xatosi/.test(message)) return false;
  return !/tarmoq xatosi|timeout|vaqti tugadi|HTTP 5\d\d/i.test(message);
}

const METHOD_LABEL: Record<string, string> = { CASH: 'naqd', TERMINAL: 'terminal', CLICK: 'Click', OLD_DEBT: 'eski qarz', HOME: 'uy oplata' };
const jobId = (integrationId: string, rowId: string, method: string) => 'cash-post:' + createHash('sha256').update(`${integrationId}:${rowId}:${method}`).digest('hex').slice(0, 32);
const same = (r: RemotePayment, code: string) => r.code_1C === code;

/**
 * Cash register payments sent to the connected distribution system (SalesDoctor, Linko, … — any adapter with
 * postPayment + listDayPayments). An uncertain response is reconciled, never blindly re-sent.
 *
 * Edits after sending:
 *  - a changed amount (or payment type) is sent again with the same reference: the system updates that payment.
 *    Afterwards the day's payments are read back: exactly one with that reference and the new amount, or the row is
 *    left UNCERTAIN (never sent again blindly).
 *  - set to 0 or the row deleted: payments are not deleted through the API, so it is marked CANCEL_REQUIRED for
 *    deletion by hand there; verifyCancellations() then checks it is really gone.
 * A problem on one row is reported for that row; the other payments of the day are still sent.
 */
export class CashPostingService {
  private static running = new Set<string>();

  /** The system to send to: the active one (the adapter can be replaced in tests). */
  private static target(companyId: string, adapterOverride?: IntegrationAdapter) {
    const d = activeDistribution(companyId);
    if (!d) throw new Error('Kassa saqlangan. Distribyutor tizimi (SalesDoctor, Linko …) ulanmagan; oplata yuborilmadi.');
    const adapter = adapterOverride || d.adapter;
    if (typeof adapter.postPayment !== 'function' || typeof adapter.listDayPayments !== 'function') {
      throw new Error(`Kassa saqlangan. ${d.name} bilan to‘lov yuborish hali qo‘llab-quvvatlanmaydi — oplata faqat kassada qoldi.`);
    }
    return { integration: d.integration, adapter, name: systemName(d.integration.provider_name, adapter) };
  }

  static async save(companyId: string, dayId: string, adapterOverride?: IntegrationAdapter, user: { id: string; email: string } = { id: 'system', email: 'system' }) {
    const day = db.findOne('cash_days', d => d.id === dayId && d.company_id === companyId);
    if (!day) throw new Error('Kassa kuni topilmadi');
    if (this.running.has(dayId)) throw new Error('To‘lovlar yuborilmoqda. Tugashini kuting.');
    this.running.add(dayId);
    try {
      CashService.recalculateCashDayTotals(dayId);
      const { integration, adapter, name } = this.target(companyId, adapterOverride);
      const config = integration.config;
      const dayPayments = () => adapter.listDayPayments!(config, day.date);
      const rows = db.find('daily_order_entries', o => o.company_id === companyId && o.cash_day_id === dayId);
      const plans: { id: string; payload: Record<string, any>; mode: 'NEW' | 'UPDATE'; label: string }[] = [];
      const errors: string[] = [];
      const cancelRequired: { order: string; method: string; amount: number }[] = [];
      const seen = new Set<string>();
      const markCancel = (job: any, label: string) => {
        if (job.status === 'PROCESSED' || job.status === 'CANCEL_REQUIRED') {
          if (job.status !== 'CANCEL_REQUIRED') {
            db.update('integration_transactions', job.id, { status: 'CANCEL_REQUIRED', error_message: `Kassada 0 qilingan yoki o‘chirilgan — ${name}da qo‘lda o‘chiring.` });
            AuditService.log({ company_id: companyId, user_id: user.id, user_email: user.email, action: 'UPDATE', entity: 'DistributionPayment', entity_id: job.external_id, old_value: { amount: job.payload.payment.amount }, new_value: { amount: 0 }, reason: `${label}: kassada bekor qilindi, ${name}da o‘chirish kerak` });
          }
          cancelRequired.push({ order: job.payload.payment.comment, method: job.payload.method, amount: job.payload.payment.amount });
        } else if (job.status === 'SENDING' || job.status === 'UNCERTAIN') {
          errors.push(`${label}: ${name} javobi tasdiqlanmagan to‘lov 0 qilindi — avval ${name}da tekshiring.`);
        } else if (job.status === 'PENDING' || job.status === 'FAILED') {
          db.update('integration_transactions', job.id, { status: 'CANCELLED', error_message: 'Yuborilmasdan bekor qilindi' });
        }
      };

      for (const row of rows) {
        if ((row.uy_oplata || 0) > 0 && !['EXISTING', 'NEW'].includes(config.uy_oplata_mode)) throw new Error('Kassa saqlangan. “Uy oplata” oldin to‘langanmi yoki yangi to‘lovmi — integratsiya sozlamasida belgilang.');
        const amounts = { CASH: Number(row.cash_payment || 0), TERMINAL: Number(row.terminal_click ?? row.terminal_payment ?? 0), CLICK: Number(row.click_payment || 0), OLD_DEBT: Number(row.nasiyadan_kirim || 0), HOME: config.uy_oplata_mode === 'NEW' ? Number(row.uy_oplata || 0) : 0 };
        for (const [method, amount] of Object.entries(amounts)) {
          const id = jobId(integration.id, row.id, method);
          seen.add(id);
          const label = `№${row.order_number} ${METHOD_LABEL[method]}`;
          if (!Number.isFinite(amount) || amount < 0) { errors.push(`${label}: summa noto‘g‘ri`); continue; }
          const old = db.findById('integration_transactions', id);
          if (amount === 0) { if (old) markCancel(old, label); continue; }
          const debtRow = row.entry_kind === 'DEBT_COLLECTION';
          // A debt payment of a customer that is not in the system stays in the cash register only.
          if (debtRow && !row.customer_ref) continue;
          if (!row.customer_ref || (!debtRow && !row.order_ref) || row.integration_id !== integration.id) { errors.push(`${label}: ${name} buyurtmasiga bog‘lanmagan — kun buyurtmalarini yangilang.`); continue; }
          // The order's own payment type describes sale terms and may be switched off in the system,
          // so a payment is sent only with the type chosen in the integration settings.
          const paymentType = config.payment_types?.[method];
          if (!paymentType) throw new Error(`Kassa saqlangan, lekin ${name}ga yuborilmadi: ${method === 'TERMINAL' || method === 'CLICK' ? 'terminal/Click' : 'naqd'} pul qaysi ${name} to‘lov turiga yozilishi tanlanmagan. Integratsiyalar → ${name} → sozlamalarda tanlang.`);
          // Set config.link_payment_to_order = true only if orders are delivered there before the cash day is saved.
          const linkOrder = config.link_payment_to_order === true && method !== 'OLD_DEBT' && !debtRow;
          const payment = { code_1C: id.replace('cash-post:', 'DF-'), amount, paymentDate: day.date + ' 12:00:00', client: row.customer_ref, paymentType, ...(linkOrder ? { order: row.order_ref } : {}), comment: debtRow ? `Kassa ${day.date}; ${method}; qarz to‘lovi ${row.order_number}` : `Kassa ${day.date}; ${method}; buyurtma ${row.order_number}` };
          const payload = { direction: 'OUTBOUND', dayId, rowId: row.id, method, payment };
          const changed = old && JSON.stringify(old.payload.payment) !== JSON.stringify(payment);
          if (!old) { plans.push({ id, payload, mode: 'NEW', label }); continue; }
          if (old.status === 'PROCESSED') { if (changed) plans.push({ id, payload, mode: 'UPDATE', label }); continue; }
          // Restored before it was deleted there: the same record is updated. Deleted there already: created again.
          if (old.status === 'CANCEL_REQUIRED') { plans.push({ id, payload, mode: 'UPDATE', label }); continue; }
          if (old.status === 'CANCELLED') { plans.push({ id, payload, mode: 'NEW', label }); continue; }
          const refusedBefore = old.status === 'UNCERTAIN' && isExplicitRefusal(old as any);
          if ((old.status === 'SENDING' || old.status === 'UNCERTAIN') && !refusedBefore && changed) { errors.push(`${label}: oldingi yuborish tasdiqlanmagan — avval ${name}da solishtiring, keyin o‘zgartiring.`); continue; }
          plans.push({ id, payload, mode: 'NEW', label });
        }
      }
      // Rows deleted from the cash register after their payment was sent.
      for (const job of db.find('integration_transactions', t => t.company_id === companyId && t.integration_id === integration.id && (t.payload as any)?.dayId === dayId && !seen.has(t.id))) {
        markCancel(job, `${(job.payload as any).payment?.comment || job.external_id} (qator o‘chirilgan)`);
      }

      db.transaction(() => {
        for (const p of plans) {
          const old = db.findById('integration_transactions', p.id);
          if (!old) db.insert('integration_transactions', { id: p.id, company_id: companyId, integration_id: integration.id, external_id: p.payload.payment.code_1C, entity_type: 'PAYMENT', status: 'PENDING', payload: p.payload, created_at: new Date().toISOString() });
          else if (p.mode === 'UPDATE') db.update('integration_transactions', p.id, { previous_payload: old.payload, payload: p.payload, error_message: null });
          else if (['PENDING', 'FAILED', 'CANCELLED'].includes(old.status)) db.update('integration_transactions', p.id, { payload: p.payload, status: 'PENDING', error_message: null });
        }
      });

      let confirmed = db.find('integration_transactions', t => t.company_id === companyId && (t.payload as any)?.dayId === dayId && t.status === 'PROCESSED' && !plans.some(p => p.id === t.id)).length;
      let updated = 0;
      // Payments already there for this day, read once before the first new send. A payment whose local record was lost
      // (restored database, row re-created with a new id) is recognised by its comment, client and amount and is not sent twice.
      let receipts: RemotePayment[] | null = null;
      const findExisting = async (payment: any) => {
        if (!receipts) receipts = await dayPayments();
        return receipts.find(p => same(p, payment.code_1C) || (!!p.comment && p.comment === payment.comment && p.amount === payment.amount && (!p.client?.SD_id || p.client.SD_id === payment.client?.SD_id)));
      };

      for (const p of plans) {
        let job = db.findById('integration_transactions', p.id)!;
        if (p.mode === 'UPDATE') {
          const before = job.previous_payload?.payment?.amount;
          db.update('integration_transactions', job.id, { status: 'SENDING', error_message: null });
          try {
            await adapter.postPayment!(config, job.payload.payment);
          } catch (err: any) {
            // Refused: nothing changed there, the old amount stands (back to PROCESSED with the old payload, retried next save).
            if (err.rejected) db.update('integration_transactions', job.id, { status: 'PROCESSED', payload: job.previous_payload || job.payload, error_message: `O‘zgartirish rad etildi: ${err.message}` });
            else db.update('integration_transactions', job.id, { status: 'UNCERTAIN', error_message: err.message });
            errors.push(`${p.label}: ${err.rejected ? `${name} o‘zgartirishni rad etdi — ` : 'javob kelmadi — '}${err.message}`);
            continue;
          }
          // Read back: one payment with this reference and the new amount. Anything else (a copy, the old amount) is not trusted.
          try {
            const after = (await dayPayments()).filter(r => same(r, job.external_id));
            if (after.length === 1 && after[0].amount === job.payload.payment.amount) {
              db.update('integration_transactions', job.id, { status: 'PROCESSED', processed_at: new Date().toISOString(), error_message: null });
              AuditService.log({ company_id: companyId, user_id: user.id, user_email: user.email, action: 'UPDATE', entity: 'DistributionPayment', entity_id: job.external_id, old_value: { amount: before }, new_value: { amount: job.payload.payment.amount }, reason: `${p.label}: kassada o‘zgartirildi, ${name}da ham yangilandi` });
              confirmed++; updated++;
            } else {
              const why = after.length > 1 ? `${name}da shu kodli ${after.length} ta to‘lov bor (nusxa paydo bo‘lgan)` : after.length === 0 ? `${name}da to‘lov topilmadi` : `${name}da summa ${after[0].amount.toLocaleString('ru-RU')}`;
              db.update('integration_transactions', job.id, { status: 'UNCERTAIN', error_message: `O‘zgartirish tekshiruvdan o‘tmadi: ${why}` });
              errors.push(`${p.label}: ${why} — ${name}da tekshiring.`);
            }
          } catch (err: any) {
            db.update('integration_transactions', job.id, { status: 'UNCERTAIN', error_message: `O‘zgartirish yuborildi, lekin tekshirib bo‘lmadi: ${err.message}` });
            errors.push(`${p.label}: o‘zgartirish yuborildi, tekshirib bo‘lmadi — keyingi saqlashda tekshiriladi.`);
          }
          continue;
        }

        if (job.status === 'PROCESSED') { confirmed++; continue; }
        if (['PENDING', 'FAILED'].includes(job.status)) {
          let existing: RemotePayment | undefined;
          try { existing = await findExisting(job.payload.payment); }
          catch (err: any) { errors.push(`${p.label}: ${name}dagi to‘lovlarni tekshirib bo‘lmadi (${err.message}); ikki marta yozilmasligi uchun yuborilmadi.`); continue; }
          if (existing) {
            if (existing.amount === job.payload.payment.amount) {
              db.update('integration_transactions', job.id, { status: 'PROCESSED', processed_at: new Date().toISOString(), error_message: `${name}da oldindan bor (${existing.code_1C || 'izoh bo‘yicha'})` });
              confirmed++; continue;
            }
            // Same reference, other amount (e.g. restored after a hand deletion was not done): update it instead of a second payment.
            db.update('integration_transactions', job.id, { status: 'PROCESSED', previous_payload: { payment: { ...job.payload.payment, amount: existing.amount } } });
            plans.push({ ...p, mode: 'UPDATE' });
            continue;
          }
        }
        if (['SENDING', 'UNCERTAIN'].includes(job.status)) {
          let absent = false;
          try {
            const receipt = (await dayPayments()).find(r => same(r, job.external_id));
            if (receipt && receipt.amount === job.payload.payment.amount) {
              db.update('integration_transactions', job.id, { status: 'PROCESSED', processed_at: new Date().toISOString(), error_message: null }); confirmed++; continue;
            }
            absent = !receipt;
          } catch { /* Preserve uncertainty. */ }
          // A refusal plus no payment there means it was never accepted.
          if (!(absent && isExplicitRefusal(job as any))) { errors.push(`${p.label}: javob tasdiqlanmagan. ${name}da tekshiring; qayta yuborilmadi.`); continue; }
          // Refused earlier and confirmed absent: send the current version now.
          job = db.update('integration_transactions', job.id, { status: 'PENDING', payload: p.payload, error_message: null, refused: false } as any)!;
        }
        // Persist before network I/O so crashes cannot cause a second charge.
        db.update('integration_transactions', job.id, { status: 'SENDING', error_message: null });
        try {
          await adapter.postPayment!(config, job.payload.payment);
          db.update('integration_transactions', job.id, { status: 'PROCESSED', processed_at: new Date().toISOString(), error_message: null });
          confirmed++;
        } catch (err: any) {
          // Refused: nothing was recorded there, so it may be re-sent after the cause is fixed.
          // No answer (network, timeout): the payment may exist, so it is checked there before any resend.
          db.update('integration_transactions', job.id, { status: err.rejected ? 'FAILED' : 'UNCERTAIN', refused: !!err.rejected, error_message: err.message } as any);
          errors.push(`${p.label}: ${err.rejected ? `${name} rad etdi — ` : ''}${err.message}`);
        }
      }

      const notes: string[] = [];
      if (updated) notes.push(`${updated} ta to‘lov ${name}da o‘zgartirildi.`);
      if (cancelRequired.length) notes.push(`${cancelRequired.length} ta to‘lov kassada bekor qilingan — ${name}da qo‘lda o‘chiring, keyin “O‘chirdim — tekshirish” tugmasini bosing.`);
      const total = confirmed + errors.length;
      return {
        saved: true, system: name, confirmed, updated, total, pending: errors.length, errors,
        cancel_required: cancelRequired,
        message: `Kassa saqlandi. ${name} ${confirmed} ta to‘lovni tasdiqladi.${notes.length ? ' ' + notes.join(' ') : ''}${errors.length ? ' Muammolar: ' + errors.join(' ') : ''}`
      };
    } finally { this.running.delete(dayId); }
  }

  /** After deleting by hand in the system: payments that are really gone become CANCELLED; the rest are listed. */
  static async verifyCancellations(companyId: string, dayId: string, adapterOverride?: IntegrationAdapter, user: { id: string; email: string } = { id: 'system', email: 'system' }) {
    const day = db.findOne('cash_days', d => d.id === dayId && d.company_id === companyId);
    if (!day) throw new Error('Kassa kuni topilmadi');
    const jobs = db.find('integration_transactions', t => t.company_id === companyId && (t.payload as any)?.dayId === dayId && t.status === 'CANCEL_REQUIRED');
    if (!jobs.length) return { cancelled: 0, still: [] as string[], message: 'O‘chirilishi kerak bo‘lgan to‘lov yo‘q.' };
    const integration = db.findById('integrations', jobs[0].integration_id);
    if (!integration) throw new Error('Integratsiya topilmadi');
    // The payments were sent to this integration's system, whichever is active now.
    const adapter = adapterOverride || integrationProvider.getAdapter(integration.provider_name);
    if (typeof adapter.listDayPayments !== 'function') throw new Error('Bu tizimdagi to‘lovlarni o‘qib bo‘lmaydi.');
    const name = systemName(integration.provider_name, adapter);
    const receipts = await adapter.listDayPayments(integration.config, day.date);
    let cancelled = 0;
    const still: string[] = [];
    for (const job of jobs) {
      if (receipts.some(r => same(r, job.external_id))) { still.push(`${(job.payload as any).payment.comment} — ${Number((job.payload as any).payment.amount).toLocaleString('ru-RU')} so‘m`); continue; }
      db.update('integration_transactions', job.id, { status: 'CANCELLED', processed_at: new Date().toISOString(), error_message: `${name}da o‘chirilgani tasdiqlandi` });
      AuditService.log({ company_id: companyId, user_id: user.id, user_email: user.email, action: 'CANCEL', entity: 'DistributionPayment', entity_id: job.external_id, old_value: { amount: (job.payload as any).payment.amount }, new_value: null, reason: `${name}da qo‘lda o‘chirilgani tekshirildi` });
      cancelled++;
    }
    return { cancelled, still, message: still.length ? `${cancelled} ta tasdiqlandi. ${name}da hali bor: ${still.join('; ')}` : `${cancelled} ta to‘lov ${name}da o‘chirilgani tasdiqlandi.` };
  }
}
