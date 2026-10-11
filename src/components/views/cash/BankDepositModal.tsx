import React, { useEffect, useState } from 'react';
import { Landmark, RefreshCw, Trash2, X } from 'lucide-react';
import { api } from '../../../services/api.ts';

const input = 'mt-1 w-full rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500';
const money = (n: number) => Math.round(n || 0).toLocaleString('ru-RU');

/**
 * Inkassa: cash from the register handed to the bank. It lowers the register's cash but is not an expense
 * (profit does not change); only the bank's commission is booked as an expense.
 */
export const BankDepositModal: React.FC<{ cashDayId: string; date: string; isOpen: boolean; canDelete: boolean; onClose: () => void; onSaved: (message: string) => void }> = ({ cashDayId, date, isOpen, canDelete, onClose, onSaved }) => {
  const [amount, setAmount] = useState('');
  const [bank, setBank] = useState('');
  const [receipt, setReceipt] = useState('');
  const [fee, setFee] = useState('');
  const [note, setNote] = useState('');
  const [deposits, setDeposits] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => api.getBankDeposits(cashDayId).then(r => {
    setDeposits(r.deposits);
    if (!bank && r.deposits[0]?.bank_name) setBank(r.deposits[0].bank_name);
  }).catch(e => setError(e.message));
  useEffect(() => { load(); }, [cashDayId]);

  const save = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setBusy(true); setError(null);
    try {
      const r = await api.recordBankDeposit(cashDayId, { amount: Number(amount), bank_name: bank, receipt_no: receipt || undefined, fee: fee ? Number(fee) : undefined, note: note || undefined });
      onSaved(r.message);
      setAmount(''); setReceipt(''); setFee(''); setNote('');
      load();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  const remove = async (id: string) => {
    if (!confirm('Bu inkassa yozuvi o‘chirilsinmi? Komissiya xarajati ham bekor qilinadi.')) return;
    try { const r = await api.deleteBankDeposit(id); onSaved(r.message); load(); } catch (e: any) { setError(e.message); }
  };

  const total = deposits.reduce((s, d) => s + d.amount, 0);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
      <div className="max-h-[90vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-base font-bold text-neutral-900"><Landmark className="h-5 w-5 text-blue-700" />Inkassa — bankka topshirish ({date})</h3>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-600"><X className="h-5 w-5" /></button>
        </div>
        <p className="rounded-xl border border-blue-100 bg-blue-50 p-3 text-[11px] text-blue-900">
          Kassadagi naqd pul kamayadi, lekin bu <b>xarajat emas</b> — pul kassadan bankka o‘tadi, foyda o‘zgarmaydi.
          Faqat bank olgan <b>komissiya</b> “Bank xizmatlari” xarajati bo‘lib yoziladi.
        </p>
        {error && <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">{error}</div>}

        {isOpen ? (
          <form onSubmit={save} className="grid grid-cols-2 gap-3">
            <label className="text-xs font-semibold text-neutral-700">Topshirilgan summa
              <input required type="number" min="1" className={input} value={amount} onChange={e => setAmount(e.target.value)} placeholder="so‘m" />
            </label>
            <label className="text-xs font-semibold text-neutral-700">Bank
              <input required className={input} value={bank} onChange={e => setBank(e.target.value)} placeholder="Masalan: Kapitalbank" />
            </label>
            <label className="text-xs font-semibold text-neutral-700">Kvitansiya / hujjat №
              <input className={input} value={receipt} onChange={e => setReceipt(e.target.value)} />
            </label>
            <label className="text-xs font-semibold text-neutral-700">Bank komissiyasi (bo‘lsa)
              <input type="number" min="0" className={input} value={fee} onChange={e => setFee(e.target.value)} placeholder="0" />
            </label>
            <label className="col-span-2 text-xs font-semibold text-neutral-700">Izoh
              <input className={input} value={note} onChange={e => setNote(e.target.value)} placeholder="Masalan: inkassator F.I.SH" />
            </label>
            <div className="col-span-2 flex justify-end">
              <button disabled={busy} className="inline-flex items-center rounded-xl bg-blue-700 px-4 py-2 text-xs font-bold text-white hover:bg-blue-800 disabled:opacity-50">
                {busy && <RefreshCw className="mr-1.5 h-3.5 w-3.5 animate-spin" />}Inkassani yozish
              </button>
            </div>
          </form>
        ) : <p className="text-xs text-amber-700">Kassa kuni yopilgan — yangi inkassa yozish uchun kunni qayta oching.</p>}

        <div className="border-t border-neutral-100 pt-3">
          <p className="mb-2 text-xs font-bold text-neutral-800">Shu kungi inkassalar: {money(total)} so‘m</p>
          {deposits.length === 0 ? <p className="text-xs text-neutral-400">Hali yo‘q.</p> : (
            <table className="min-w-full text-xs">
              <thead className="text-left text-neutral-500"><tr><th className="py-1">Bank</th><th>Kvitansiya</th><th className="text-right">Summa</th><th className="text-right">Komissiya</th><th /></tr></thead>
              <tbody className="divide-y divide-neutral-100">
                {deposits.map(d => (
                  <tr key={d.id}>
                    <td className="py-1.5">{d.bank_name}</td>
                    <td>{d.external_reference || '—'}</td>
                    <td className="text-right font-semibold">{money(d.amount)}</td>
                    <td className="text-right text-rose-700">{d.fee ? money(d.fee) : '—'}</td>
                    <td className="text-right">{isOpen && canDelete && <button onClick={() => remove(d.id)} className="text-neutral-300 hover:text-red-600" title="O‘chirish"><Trash2 className="h-3.5 w-3.5" /></button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};
