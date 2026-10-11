import React from 'react';
import { X, Printer, Download, Copy, Check, Building2, Calendar, FileText } from 'lucide-react';
import { copyText, COPY_FAILED } from '../../utils/clipboard.ts';

interface StatementPrintModalProps {
  isOpen: boolean;
  onClose: () => void;
  statementData: {
    company?: { name: string; tax_id?: string; phone?: string; address?: string };
    customer: {
      name: string;
      code?: string;
      phone?: string;
      address?: string;
    };
    period: {
      from: string;
      to: string;
    };
    opening_balance: number;
    closing_balance: number;
    total_debit: number;
    total_credit: number;
    transactions: Array<{
      id: string;
      date: string;
      ledger_type: string;
      reference_id?: string;
      comment?: string;
      debit: number;
      credit: number;
      running_balance: number;
    }>;
  } | null;
}

export const StatementPrintModal: React.FC<StatementPrintModalProps> = ({
  isOpen,
  onClose,
  statementData
}) => {
  const [copied, setCopied] = React.useState(false);

  if (!isOpen || !statementData) return null;
  // The company's own name from its card (Sozlamalar), not a fixed one.
  const firm = statementData.company?.name || 'Korxona';

  const handlePrint = () => {
    window.print();
  };

  const handleCopySummary = async () => {
    const text = `📄 O'ZARO HISOB-KITOBLAR SOLISHTIRMA DALOLATNOMASI (AKT-SVERKA)
Korxona: ${firm}
Mijoz: ${statementData.customer.name} (${statementData.customer.phone || ''})
Davr: ${statementData.period.from} dan ${statementData.period.to} gacha
--------------------------------------------------
Boshlang'ich Qoldiq: ${statementData.opening_balance.toLocaleString()} UZS
Berilgan Tovar (Kirim/Debit): +${statementData.total_debit.toLocaleString()} UZS
Amalga Oshirilgan To'lov (Kredit): -${statementData.total_credit.toLocaleString()} UZS
--------------------------------------------------
YAKUNIY QOLDIQ QARZ: ${statementData.closing_balance.toLocaleString()} UZS
Holat: ${statementData.closing_balance > 0 ? "Mijozning qarzdorligi mavjud" : (statementData.closing_balance < 0 ? "Mijoz foydasiga ortiqcha to'lov" : "Hisob-kitob 0 ga teng (To'liq yopilgan)")}
--------------------------------------------------
${firm} buxgalteriyasi`;

    if (!(await copyText(text))) { alert(COPY_FAILED); return; }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col rounded-2xl bg-white shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        
        {/* Header toolbar */}
        <div className="flex items-center justify-between border-b border-neutral-200 bg-neutral-900 px-6 py-3.5 text-white">
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-emerald-400" />
            <h3 className="text-sm font-bold">Rasmiy Solishtirma Dalolatnomasi (Akt-Sverka)</h3>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopySummary}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-neutral-800 text-neutral-200 hover:bg-neutral-700 text-xs font-semibold transition"
            >
              {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
              <span>{copied ? "Nusxalandi" : "Qisqa Xulosani Nusxalash"}</span>
            </button>
            <button
              onClick={handlePrint}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 text-xs font-bold transition shadow-xs"
            >
              <Printer className="h-4 w-4" />
              <span>Chop Etish (A4 Print)</span>
            </button>
            <button
              onClick={onClose}
              className="ml-2 flex h-7 w-7 items-center justify-center rounded-lg text-neutral-400 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Printable Document Body */}
        <div className="flex-1 overflow-y-auto p-6 md:p-8 bg-neutral-100 flex justify-center">
          <div className="w-full max-w-3xl bg-white p-8 md:p-10 shadow-sm border border-neutral-200 text-neutral-900 rounded-sm font-sans text-xs print:p-0 print:border-none print:shadow-none">
            
            {/* Document Header */}
            <div className="text-center space-y-1 pb-6 border-b-2 border-neutral-800">
              <h1 className="text-base font-black uppercase tracking-wide">
                O'ZARO HISOB-KITOBLARNI SOLISHTIRMA DALOLATNOMASI (AKT-SVERKA)
              </h1>
              <p className="text-xs font-medium text-neutral-600">
                Davr: <strong>{statementData.period.from}</strong> dan <strong>{statementData.period.to}</strong> gacha
              </p>
            </div>

            {/* Parties info */}
            <div className="grid grid-cols-2 gap-6 py-5 border-b border-neutral-200 text-[11px] leading-relaxed">
              <div>
                <p className="font-bold text-neutral-500 uppercase text-[10px]">TASHKILOT (YETKAZIB BERUVCHI):</p>
                <p className="font-black text-sm text-neutral-900">{firm}</p>
                {/* Only what is on the company card (Sozlamalar → Korxona); nothing invented on a legal document. */}
                {statementData.company?.address && <p>Manzil: {statementData.company.address}</p>}
                {(statementData.company?.tax_id || statementData.company?.phone) && (
                  <p>{[statementData.company?.tax_id && `STIR: ${statementData.company.tax_id}`, statementData.company?.phone && `Tel: ${statementData.company.phone}`].filter(Boolean).join(' | ')}</p>
                )}
              </div>

              <div>
                <p className="font-bold text-neutral-500 uppercase text-[10px]">MIJOZ (XARIDOR):</p>
                <p className="font-black text-sm text-neutral-900">{statementData.customer.name}</p>
                <p>Mijoz kodi: {statementData.customer.code || 'Mavjud emas'}</p>
                <p>Telefon: {statementData.customer.phone || '—'}</p>
                <p>Manzil: {statementData.customer.address || '—'}</p>
              </div>
            </div>

            {/* Preamble */}
            <p className="py-4 text-justify text-[11px] text-neutral-700 leading-relaxed">
              Biz, quyida imzo chekuvchilar, {firm} buxgalteriyasi va {statementData.customer.name} rahbariyati ushbu dalolatnomani tuzdik shul haqidakim, {statementData.period.from} dan {statementData.period.to} gacha bo'lgan davrda o'zaro hisob-kitoblar holati quyidagicha qayd etildi:
            </p>

            {/* Balance Overview Table */}
            <div className="mb-4 rounded border border-neutral-300 overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead className="bg-neutral-100 font-bold border-b border-neutral-300">
                  <tr>
                    <th className="p-2 border-r border-neutral-300">Boshlang'ich Qoldiq</th>
                    <th className="p-2 border-r border-neutral-300 text-right">Jami Yetkazilgan Tovar (Debit)</th>
                    <th className="p-2 border-r border-neutral-300 text-right">Jami To'langan Mablag' (Kredit)</th>
                    <th className="p-2 text-right">Yakuniy Qoldiq Qarz</th>
                  </tr>
                </thead>
                <tbody className="font-semibold divide-y divide-neutral-200">
                  <tr>
                    <td className="p-2 border-r border-neutral-300">{statementData.opening_balance.toLocaleString()} UZS</td>
                    <td className="p-2 border-r border-neutral-300 text-right text-rose-600">+{statementData.total_debit.toLocaleString()} UZS</td>
                    <td className="p-2 border-r border-neutral-300 text-right text-emerald-600">-{statementData.total_credit.toLocaleString()} UZS</td>
                    <td className="p-2 text-right font-black text-sm text-neutral-900 bg-neutral-50">{statementData.closing_balance.toLocaleString()} UZS</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Detail transactions table */}
            <div className="mb-6 rounded border border-neutral-300 overflow-hidden">
              <div className="bg-neutral-100 p-2 font-bold text-[11px] border-b border-neutral-300 uppercase">
                Davr Ichidagi Operatsiyalar Reyestri:
              </div>
              <table className="w-full text-left text-[11px]">
                <thead className="bg-neutral-50 text-neutral-600 font-semibold border-b border-neutral-200">
                  <tr>
                    <th className="p-2 border-r border-neutral-200">Sana</th>
                    <th className="p-2 border-r border-neutral-200">Hujjat / Operatsiya</th>
                    <th className="p-2 border-r border-neutral-200">Izoh</th>
                    <th className="p-2 border-r border-neutral-200 text-right">Debit (+)</th>
                    <th className="p-2 border-r border-neutral-200 text-right">Kredit (-)</th>
                    <th className="p-2 text-right">Qoldiq</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200">
                  {statementData.transactions.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-4 text-center text-neutral-400">
                        Ushbu davrda harakatlar mavjud emas
                      </td>
                    </tr>
                  ) : (
                    statementData.transactions.map((tr) => (
                      <tr key={tr.id}>
                        <td className="p-2 font-mono border-r border-neutral-200">{tr.date}</td>
                        <td className="p-2 font-medium border-r border-neutral-200">{tr.ledger_type}</td>
                        <td className="p-2 text-neutral-500 border-r border-neutral-200">{tr.comment || tr.reference_id || '—'}</td>
                        <td className="p-2 text-right text-rose-600 font-medium border-r border-neutral-200">
                          {tr.debit > 0 ? `+${tr.debit.toLocaleString()}` : '—'}
                        </td>
                        <td className="p-2 text-right text-emerald-600 font-medium border-r border-neutral-200">
                          {tr.credit > 0 ? `-${tr.credit.toLocaleString()}` : '—'}
                        </td>
                        <td className="p-2 text-right font-bold text-neutral-900">
                          {tr.running_balance.toLocaleString()} UZS
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Conclusion text */}
            <div className="p-3.5 bg-neutral-50 border border-neutral-200 rounded text-[11px] leading-relaxed">
              <strong>Xulosa:</strong> {statementData.period.to} holatiga ko'ra, {statementData.customer.name} ning {firm} oldidagi qarzdorligi{' '}
              <strong>{statementData.closing_balance.toLocaleString()} UZS</strong> (so'm) ni tashkil etadi.
            </div>

            {/* Signatures block */}
            <div className="grid grid-cols-2 gap-10 pt-10 text-[11px]">
              <div className="space-y-6">
                <p className="font-bold">Yetkazib beruvchi nomidan:</p>
                <div className="space-y-4">
                  <div className="flex justify-between items-end border-b border-neutral-400 pb-1">
                    <span className="text-neutral-500 text-[10px]">Bosh hisobchi:</span>
                    <span className="font-medium">Nodira S.</span>
                  </div>
                  <div className="flex justify-between items-end border-b border-neutral-400 pb-1">
                    <span className="text-neutral-500 text-[10px]">Imzo:</span>
                    <span className="text-neutral-300">_________________</span>
                  </div>
                  <p className="text-[10px] text-neutral-400 text-center">M.O'. (Muhr o'rni)</p>
                </div>
              </div>

              <div className="space-y-6">
                <p className="font-bold">Xaridor nomidan:</p>
                <div className="space-y-4">
                  <div className="flex justify-between items-end border-b border-neutral-400 pb-1">
                    <span className="text-neutral-500 text-[10px]">Mijoz rahbari / Vakili:</span>
                    <span className="font-medium">{statementData.customer.name}</span>
                  </div>
                  <div className="flex justify-between items-end border-b border-neutral-400 pb-1">
                    <span className="text-neutral-500 text-[10px]">Imzo:</span>
                    <span className="text-neutral-300">_________________</span>
                  </div>
                  <p className="text-[10px] text-neutral-400 text-center">M.O'. (Muhr o'rni)</p>
                </div>
              </div>
            </div>

          </div>
        </div>

      </div>
    </div>
  );
};
