import React, { useState, useMemo, useEffect } from 'react';
import { localToday } from '../../utils/date';
import { 
  X, 
  Calculator, 
  Banknote, 
  Coins, 
  Receipt, 
  FileText, 
  Copy, 
  Check, 
  Printer, 
  RotateCcw, 
  ArrowRightLeft,
  Sparkles,
  DollarSign,
  Send,
  Building2,
  Calendar,
  Wallet
} from 'lucide-react';
import { CashDay, CashTransaction } from '../../types.ts';
import { api } from '../../services/api.ts';
import { copyText, COPY_FAILED } from '../../utils/clipboard.ts';

interface QuickToolsModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeCashDay?: CashDay | null;
  transactions?: CashTransaction[];
  defaultTab?: 'DENOMINATIONS' | 'CURRENCY' | 'RECEIPT' | 'Z_REPORT';
  initialReceiptData?: {
    receiptNo?: string;
    customerName?: string;
    amount?: number;
    paymentMethod?: string;
    remainingDebt?: number;
    receivedBy?: string;
    comment?: string;
  } | null;
}

export const QuickToolsModal: React.FC<QuickToolsModalProps> = ({
  isOpen,
  onClose,
  activeCashDay,
  transactions = [],
  defaultTab = 'DENOMINATIONS',
  initialReceiptData = null
}) => {
  const [activeTab, setActiveTab] = useState<'DENOMINATIONS' | 'CURRENCY' | 'RECEIPT' | 'Z_REPORT'>(defaultTab);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  // Receipts and the Z-report carry the company's own name (Sozlamalar → Korxona).
  const [firm, setFirm] = useState('Korxona');
  const [firmPhone, setFirmPhone] = useState('');
  useEffect(() => { if (isOpen) api.getCompany().then(r => { if (r.company?.name) setFirm(r.company.name); setFirmPhone(r.company?.phone || ''); }).catch(() => {}); }, [isOpen]);

  useEffect(() => {
    if (isOpen && defaultTab) {
      setActiveTab(defaultTab);
    }
  }, [isOpen, defaultTab]);

  // =========================================================================
  // TAB 1: KUPURALAR SANAGICH (DENOMINATIONS)
  // =========================================================================
  const [counts, setCounts] = useState<Record<number, number>>({
    200000: 0,
    100000: 0,
    50000: 0,
    20000: 0,
    10000: 0,
    5000: 0,
    2000: 0,
    1000: 0
  });

  const denominations = [200000, 100000, 50000, 20000, 10000, 5000, 2000, 1000];

  const denominationTotal = useMemo(() => {
    return denominations.reduce((sum, denom) => sum + (denom * (counts[denom] || 0)), 0);
  }, [counts, denominations]);

  const targetCashBalance = activeCashDay?.current_cash_balance ?? activeCashDay?.calculated_closing_balance ?? activeCashDay?.closing_balance ?? 0;
  const difference = denominationTotal - targetCashBalance;

  const handleDenomChange = (denom: number, value: string) => {
    const qty = parseInt(value, 10);
    setCounts(prev => ({
      ...prev,
      [denom]: isNaN(qty) || qty < 0 ? 0 : qty
    }));
  };

  const handleResetDenoms = () => {
    setCounts({
      200000: 0,
      100000: 0,
      50000: 0,
      20000: 0,
      10000: 0,
      5000: 0,
      2000: 0,
      1000: 0
    });
  };

  const copyDenomSummary = async () => {
    const rows = denominations
      .filter(d => counts[d] > 0)
      .map(d => `${d.toLocaleString()} UZS: ${counts[d]} dona = ${(d * counts[d]).toLocaleString()} UZS`)
      .join('\n');

    const text = `💵 KASSA KUPURALAR SANOG'I (${new Date().toLocaleDateString('uz-UZ')} ${new Date().toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' })})
--------------------------------
${rows || "Hali kupuralar sanalmagan"}
--------------------------------
Jami Sanalgan Naqd: ${denominationTotal.toLocaleString()} UZS
Tizim Kassa Balansi: ${targetCashBalance.toLocaleString()} UZS
Farq: ${difference === 0 ? "0 (To'liq mos)" : (difference > 0 ? `+${difference.toLocaleString()} (Ortiqcha)` : `${difference.toLocaleString()} (Kamomad)`)}`;

    if (!(await copyText(text))) { alert(COPY_FAILED); return; }
    setCopiedKey('denom');
    setTimeout(() => setCopiedKey(null), 2000);
  };

  // =========================================================================
  // TAB 2: VALYUTA & QAYTIM KONVERTERI (CURRENCY & CHANGE)
  // =========================================================================
  // Today's official rate of the Central Bank (cbu.uz); the cashier may type another. No invented default.
  const [exchangeRate, setExchangeRate] = useState<number>(0);
  const [rateNote, setRateNote] = useState<string>('Markaziy bank kursi olinmoqda…');
  const [usdInput, setUsdInput] = useState<string>('100');
  const [uzsInput, setUzsInput] = useState<string>('');
  useEffect(() => {
    if (!isOpen) return;
    api.getExchangeRate().then(r => {
      if (r.rate) { setExchangeRate(r.rate); setUzsInput(Math.round((parseFloat(usdInput) || 0) * r.rate).toString()); setRateNote(`Markaziy bank kursi, ${String(r.date).split('-').reverse().join('.')}`); }
      else setRateNote('Markaziy bank kursi olinmadi — kursni qo‘lda kiriting.');
    }).catch(() => setRateNote('Markaziy bank kursi olinmadi — kursni qo‘lda kiriting.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Qaytim hisoblagich
  const [orderAmountUzs, setOrderAmountUzs] = useState<string>('');
  const [paidUsd, setPaidUsd] = useState<string>('');
  const [paidUzs, setPaidUzs] = useState<string>('');

  const handleUsdChange = (val: string) => {
    setUsdInput(val);
    const num = parseFloat(val) || 0;
    setUzsInput(Math.round(num * exchangeRate).toString());
  };

  const handleUzsChange = (val: string) => {
    setUzsInput(val);
    const num = parseFloat(val) || 0;
    setUsdInput(exchangeRate > 0 ? (num / exchangeRate).toFixed(2) : '0');
  };

  // Change Calculation
  const orderSum = parseFloat(orderAmountUzs) || 0;
  const totalGivenUzs = (parseFloat(paidUsd) || 0) * exchangeRate + (parseFloat(paidUzs) || 0);
  const changeUzs = totalGivenUzs - orderSum;

  // =========================================================================
  // TAB 3: TEZKOR KVITANSIYA / CHEK (RECEIPT SLIP)
  // =========================================================================
  const [receiptForm, setReceiptForm] = useState({
    // Date-time number (CK-261001-0930-15): readable and does not repeat.
    receiptNo: `CK-${new Date().toISOString().slice(2, 19).replace(/[-:]/g, '').replace('T', '-')}`,
    customerName: '',
    amount: 0,
    paymentMethod: 'CASH',
    remainingDebt: 0,
    receivedBy: '',
    comment: "Tovar to'lovi bo'yicha qabul qilindi"
  });

  useEffect(() => {
    if (initialReceiptData) {
      setReceiptForm(prev => ({
        ...prev,
        receiptNo: initialReceiptData.receiptNo || prev.receiptNo,
        customerName: initialReceiptData.customerName ?? prev.customerName,
        amount: initialReceiptData.amount !== undefined ? initialReceiptData.amount : prev.amount,
        paymentMethod: initialReceiptData.paymentMethod || prev.paymentMethod,
        remainingDebt: initialReceiptData.remainingDebt !== undefined ? initialReceiptData.remainingDebt : prev.remainingDebt,
        receivedBy: initialReceiptData.receivedBy || prev.receivedBy,
        comment: initialReceiptData.comment || prev.comment
      }));
    }
  }, [initialReceiptData, isOpen]);

  const copyReceiptText = async () => {
    const methodNames: Record<string, string> = {
      CASH: 'Naqd pul',
      TERMINAL: 'Bank kartasi / Terminal',
      CLICK: 'Click / Payme',
      BANK_TRANSFER: "Bank o'tkazmasi"
    };

    const text = `🧾 TO'LOV KVITANSIYASI: ${receiptForm.receiptNo}
${firm}
Sana: ${new Date().toLocaleDateString('uz-UZ')} ${new Date().toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' })}
----------------------------------
Mijoz: ${receiptForm.customerName || 'Nomaʼlum mijoz'}
To'langan Summa: ${receiptForm.amount.toLocaleString()} UZS
To'lov Turi: ${methodNames[receiptForm.paymentMethod] || receiptForm.paymentMethod}
Qoldiq Qarz: ${receiptForm.remainingDebt.toLocaleString()} UZS
Qabul Qildi: ${receiptForm.receivedBy}
Izoh: ${receiptForm.comment}
----------------------------------
Rahmat, xaridingiz barakali bo'lsin!`;

    if (!(await copyText(text))) { alert(COPY_FAILED); return; }
    setCopiedKey('receipt');
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handlePrintReceipt = () => {
    window.print();
  };

  // =========================================================================
  // TAB 4: KUN YAKUNI Z-XULOSASI (DAILY CLOSE SUMMARY)
  // =========================================================================
  const zSummary = useMemo(() => {
    const opening = activeCashDay?.opening_balance ?? 0;
    const current = activeCashDay?.current_cash_balance ?? activeCashDay?.calculated_closing_balance ?? activeCashDay?.closing_balance ?? 0;
    const closed = activeCashDay?.actual_closing_balance ?? activeCashDay?.actual_cash_counted ?? current;

    // Filter transactions
    const totalCashIn = transactions
      .filter(t => t.payment_method === 'CASH' && ['SALE_PAYMENT', 'CREDIT_COLLECTION'].includes(t.transaction_type))
      .reduce((sum, t) => sum + (t.amount || 0), 0);

    const totalTerminal = transactions
      .filter(t => t.payment_method === 'TERMINAL')
      .reduce((sum, t) => sum + (t.amount || 0), 0);

    const totalClick = transactions
      .filter(t => t.payment_method === 'CLICK')
      .reduce((sum, t) => sum + (t.amount || 0), 0);

    const totalBank = transactions
      .filter(t => t.payment_method === 'BANK_TRANSFER')
      .reduce((sum, t) => sum + (t.amount || 0), 0);

    const totalExpenses = transactions
      .filter(t => t.transaction_type === 'EXPENSE')
      .reduce((sum, t) => sum + (t.amount || 0), 0);

    const totalSalaries = transactions
      .filter(t => t.transaction_type === 'SALARY_PAYMENT')
      .reduce((sum, t) => sum + (t.amount || 0), 0);

    const totalSales = totalCashIn + totalTerminal + totalClick + totalBank;

    return {
      date: activeCashDay?.date || localToday(),
      status: activeCashDay?.status || 'OCHIQ',
      opening,
      totalSales,
      totalCashIn,
      totalTerminal,
      totalClick,
      totalBank,
      totalExpenses,
      totalSalaries,
      current,
      closed,
      diff: closed - current
    };
  }, [activeCashDay, transactions]);

  const copyZReport = async () => {
    const text = `📊 KASSA KUNLIK YAKUNIY Z-HISOBOT
Sana: ${zSummary.date} | Holat: ${zSummary.status}
${firm}
----------------------------------------
Boshlang'ich Kassa: ${zSummary.opening.toLocaleString()} UZS

KIRIM (TUSHUM):
• Naqd Pul: ${zSummary.totalCashIn.toLocaleString()} UZS
• Terminal: ${zSummary.totalTerminal.toLocaleString()} UZS
• Click / Payme: ${zSummary.totalClick.toLocaleString()} UZS
• Bank O'tkazma: ${zSummary.totalBank.toLocaleString()} UZS
• JAMI TUSHUM: ${zSummary.totalSales.toLocaleString()} UZS

CHIQIM:
• Rasxodlar: ${zSummary.totalExpenses.toLocaleString()} UZS
• Oylik / Avans: ${zSummary.totalSalaries.toLocaleString()} UZS

KASSA SEYF QOLDIG'I:
• Kassa Tizim Qoldig'i: ${zSummary.current.toLocaleString()} UZS
• Sanalgan Naqd Pul: ${zSummary.closed.toLocaleString()} UZS
• Kassa Farqi: ${zSummary.diff === 0 ? "0 (Aniq)" : `${zSummary.diff.toLocaleString()} UZS`}
----------------------------------------
Hisobot yaratildi: ${new Date().toLocaleTimeString('uz-UZ')}`;

    if (!(await copyText(text))) { alert(COPY_FAILED); return; }
    setCopiedKey('zreport');
    setTimeout(() => setCopiedKey(null), 2000);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col rounded-2xl bg-white shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-200 bg-neutral-900 px-6 py-4 text-white">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
              <Calculator className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white">Kassa Tezkor Asboblari</h2>
                <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
                  Sodda & Foydali
                </span>
              </div>
              <p className="text-xs text-neutral-400">
                Kupuralar sanash, dollar/so'm kalkulyatori, chek chiqarish va kun yakuni
              </p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-neutral-400 hover:bg-neutral-800 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex border-b border-neutral-200 bg-neutral-50 px-6 py-2 overflow-x-auto gap-2">
          <button
            onClick={() => setActiveTab('DENOMINATIONS')}
            className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold transition ${
              activeTab === 'DENOMINATIONS'
                ? 'bg-neutral-900 text-white shadow-sm'
                : 'text-neutral-600 hover:bg-neutral-200/60'
            }`}
          >
            <Banknote className="h-4 w-4" />
            <span>Kupuralar Sanagich</span>
            {denominationTotal > 0 && (
              <span className="ml-1 rounded-full bg-emerald-500 px-1.5 py-0.2 text-[10px] text-white">
                {(denominationTotal / 1000000).toFixed(1)}M
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('CURRENCY')}
            className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold transition ${
              activeTab === 'CURRENCY'
                ? 'bg-neutral-900 text-white shadow-sm'
                : 'text-neutral-600 hover:bg-neutral-200/60'
            }`}
          >
            <ArrowRightLeft className="h-4 w-4" />
            <span>Valyuta & Qaytim</span>
          </button>

          <button
            onClick={() => setActiveTab('RECEIPT')}
            className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold transition ${
              activeTab === 'RECEIPT'
                ? 'bg-neutral-900 text-white shadow-sm'
                : 'text-neutral-600 hover:bg-neutral-200/60'
            }`}
          >
            <Receipt className="h-4 w-4" />
            <span>To'lov Cheki / Kvitansiya</span>
          </button>

          <button
            onClick={() => setActiveTab('Z_REPORT')}
            className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold transition ${
              activeTab === 'Z_REPORT'
                ? 'bg-neutral-900 text-white shadow-sm'
                : 'text-neutral-600 hover:bg-neutral-200/60'
            }`}
          >
            <FileText className="h-4 w-4" />
            <span>Kun Yakuni (Z-Xulosa)</span>
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6">
          
          {/* ========================================================================= */}
          {/* TAB 1: KUPURALAR SANAGICH */}
          {/* ========================================================================= */}
          {activeTab === 'DENOMINATIONS' && (
            <div className="space-y-6">
              {/* Summary Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4">
                  <span className="text-[11px] font-bold text-neutral-500 uppercase tracking-wider block mb-1">
                    Sanalgan Jami Naqd
                  </span>
                  <div className="text-2xl font-black text-emerald-600">
                    {denominationTotal.toLocaleString()} <span className="text-xs font-semibold text-neutral-500">UZS</span>
                  </div>
                  <span className="text-[11px] text-neutral-500 mt-1 block">
                    Kupuralar yig'indisi
                  </span>
                </div>

                <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4">
                  <span className="text-[11px] font-bold text-neutral-500 uppercase tracking-wider block mb-1">
                    Tizim Kassa Balansi
                  </span>
                  <div className="text-2xl font-black text-neutral-900">
                    {targetCashBalance.toLocaleString()} <span className="text-xs font-semibold text-neutral-500">UZS</span>
                  </div>
                  <span className="text-[11px] text-neutral-500 mt-1 block">
                    {activeCashDay ? `Kassa kuni: ${activeCashDay.date}` : "Kassa ochilmagan"}
                  </span>
                </div>

                <div className={`rounded-xl border p-4 ${
                  difference === 0 
                    ? 'border-emerald-200 bg-emerald-50/60' 
                    : difference > 0 
                      ? 'border-blue-200 bg-blue-50/60' 
                      : 'border-rose-200 bg-rose-50/60'
                }`}>
                  <span className="text-[11px] font-bold uppercase tracking-wider block mb-1 text-neutral-600">
                    Kassa Farqi
                  </span>
                  <div className={`text-2xl font-black ${
                    difference === 0 
                      ? 'text-emerald-700' 
                      : difference > 0 
                        ? 'text-blue-700' 
                        : 'text-rose-700'
                  }`}>
                    {difference === 0 ? "0 UZS" : `${difference > 0 ? '+' : ''}${difference.toLocaleString()} UZS`}
                  </div>
                  <span className={`text-[11px] font-semibold mt-1 block ${
                    difference === 0 
                      ? 'text-emerald-700' 
                      : difference > 0 
                        ? 'text-blue-700' 
                        : 'text-rose-700'
                  }`}>
                    {difference === 0 ? "✓ Seyf balansi to'liq to'g'ri" : (difference > 0 ? "Ortiqcha naqd pul mavjud" : "Kamomad aniqlandi")}
                  </span>
                </div>
              </div>

              {/* Denominations Grid */}
              <div className="rounded-2xl border border-neutral-200 overflow-hidden shadow-xs">
                <div className="bg-neutral-100/80 px-4 py-2.5 flex items-center justify-between border-b border-neutral-200">
                  <span className="text-xs font-bold text-neutral-700 uppercase">
                    Banknotlar bo'yicha donalarni kiriting:
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleResetDenoms}
                      className="flex items-center gap-1 px-2.5 py-1 text-xs text-neutral-600 hover:text-neutral-900 bg-white border border-neutral-200 rounded-lg hover:bg-neutral-50 transition"
                    >
                      <RotateCcw className="h-3 w-3" />
                      <span>Tozalash</span>
                    </button>
                    <button
                      onClick={copyDenomSummary}
                      className="flex items-center gap-1.5 px-3 py-1 text-xs font-semibold text-white bg-neutral-900 rounded-lg hover:bg-neutral-800 transition"
                    >
                      {copiedKey === 'denom' ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                      <span>{copiedKey === 'denom' ? "Nusxalandi!" : "Xulosani Nusxalash"}</span>
                    </button>
                  </div>
                </div>

                <div className="divide-y divide-neutral-100 bg-white">
                  {denominations.map((denom) => {
                    const count = counts[denom] || 0;
                    const subtotal = denom * count;

                    return (
                      <div key={denom} className="flex items-center justify-between px-4 py-3 hover:bg-neutral-50 transition">
                        <div className="flex items-center gap-3 w-1/3">
                          <div className={`flex h-9 w-12 items-center justify-center rounded-lg font-black text-xs border ${
                            denom >= 100000 
                              ? 'bg-amber-50 text-amber-800 border-amber-200' 
                              : denom >= 20000 
                                ? 'bg-indigo-50 text-indigo-800 border-indigo-200' 
                                : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                          }`}>
                            {denom >= 1000 ? `${denom / 1000}k` : denom}
                          </div>
                          <div>
                            <span className="text-sm font-bold text-neutral-900">
                              {denom.toLocaleString()} UZS
                            </span>
                            <span className="text-[11px] text-neutral-400 block">kupura</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 w-1/3 justify-center">
                          <input
                            type="number"
                            min="0"
                            value={counts[denom] === 0 ? '' : counts[denom]}
                            onChange={(e) => handleDenomChange(denom, e.target.value)}
                            placeholder="0"
                            className="w-28 text-center rounded-xl border border-neutral-300 py-1.5 text-sm font-bold text-neutral-900 focus:border-neutral-900 focus:outline-hidden"
                          />
                          <span className="text-xs text-neutral-500 font-medium">dona</span>
                        </div>

                        <div className="w-1/3 text-right">
                          <span className="text-sm font-extrabold text-neutral-900">
                            {subtotal.toLocaleString()} UZS
                          </span>
                          <span className="text-[11px] text-neutral-400 block">
                            {count > 0 ? `${count} × ${denom.toLocaleString()}` : '—'}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* TAB 2: VALYUTA & QAYTIM KONVERTERI */}
          {/* ========================================================================= */}
          {activeTab === 'CURRENCY' && (
            <div className="space-y-6">
              {/* Kurs sozlash bloki */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-2xl bg-neutral-900 p-5 text-white">
                <div>
                  <div className="flex items-center gap-2">
                    <DollarSign className="h-5 w-5 text-emerald-400" />
                    <h3 className="text-sm font-bold">Kassa Dollar Kursi (USD / UZS)</h3>
                  </div>
                  <p className="text-xs text-neutral-400 mt-1">
                    {exchangeRate > 0 ? rateNote : <span className="text-amber-300">{rateNote}</span>}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-neutral-300 font-medium">$1 =</span>
                  <input
                    type="number"
                    value={exchangeRate}
                    onChange={(e) => {
                      const val = Number(e.target.value) || 0;
                      setExchangeRate(val);
                      if (val > 0) {
                        setUzsInput(Math.round((parseFloat(usdInput) || 0) * val).toString());
                      }
                    }}
                    className="w-32 rounded-xl bg-neutral-800 border border-neutral-700 px-3 py-1.5 text-center text-sm font-black text-emerald-400 focus:border-emerald-500 focus:outline-hidden"
                  />
                  <span className="text-xs text-neutral-300 font-medium">UZS</span>
                </div>
              </div>

              {/* 2-Way Converter */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-xs">
                  <span className="text-xs font-bold text-neutral-500 uppercase tracking-wider block mb-2">
                    AQSH Dollari ($ USD)
                  </span>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-400 font-bold">$</span>
                    <input
                      type="number"
                      step="any"
                      value={usdInput}
                      onChange={(e) => handleUsdChange(e.target.value)}
                      placeholder="0.00"
                      className="w-full pl-8 pr-4 py-2.5 rounded-xl border border-neutral-300 text-lg font-bold text-neutral-900 focus:border-neutral-900 focus:outline-hidden"
                    />
                  </div>
                  <p className="text-[11px] text-neutral-400 mt-2">
                    Masalan: 100$ = {(100 * exchangeRate).toLocaleString()} UZS
                  </p>
                </div>

                <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-xs">
                  <span className="text-xs font-bold text-neutral-500 uppercase tracking-wider block mb-2">
                    O'zbek So'mi (UZS)
                  </span>
                  <div className="relative">
                    <input
                      type="number"
                      value={uzsInput}
                      onChange={(e) => handleUzsChange(e.target.value)}
                      placeholder="0"
                      className="w-full px-4 py-2.5 rounded-xl border border-neutral-300 text-lg font-bold text-emerald-700 focus:border-neutral-900 focus:outline-hidden"
                    />
                    <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-neutral-400 text-xs font-bold">UZS</span>
                  </div>
                  <p className="text-[11px] text-neutral-400 mt-2">
                    Ekvivalenti: ${(parseFloat(usdInput) || 0).toLocaleString()} USD
                  </p>
                </div>
              </div>

              {/* Qaytim kalkulyatori (Change Calculator) */}
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50/40 p-5 space-y-4">
                <div className="flex items-center gap-2">
                  <Coins className="h-5 w-5 text-emerald-700" />
                  <h4 className="text-sm font-bold text-neutral-900">
                    To'lov va Qaytim Kalkulyatori (Change Calculator)
                  </h4>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-neutral-700 mb-1">
                      Tovar / Chek Summasi (UZS)
                    </label>
                    <input
                      type="number"
                      value={orderAmountUzs}
                      onChange={(e) => setOrderAmountUzs(e.target.value)}
                      className="w-full px-3 py-2 bg-white rounded-xl border border-neutral-300 text-xs font-bold text-neutral-900"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-neutral-700 mb-1">
                      Mijoz bergan dollar ($)
                    </label>
                    <input
                      type="number"
                      value={paidUsd}
                      onChange={(e) => setPaidUsd(e.target.value)}
                      className="w-full px-3 py-2 bg-white rounded-xl border border-neutral-300 text-xs font-bold text-indigo-700"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-neutral-700 mb-1">
                      Qo'shimcha so'm (UZS)
                    </label>
                    <input
                      type="number"
                      value={paidUzs}
                      onChange={(e) => setPaidUzs(e.target.value)}
                      className="w-full px-3 py-2 bg-white rounded-xl border border-neutral-300 text-xs font-bold text-neutral-900"
                    />
                  </div>
                </div>

                <div className="rounded-xl bg-white p-4 border border-emerald-200 flex flex-col sm:flex-row items-center justify-between gap-3">
                  <div>
                    <span className="text-xs text-neutral-500 font-medium">Mijozga Qaytarilishi Kerak Bo'lgan Qaytim:</span>
                    <div className={`text-2xl font-black ${changeUzs >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                      {changeUzs >= 0 ? `${changeUzs.toLocaleString()} UZS` : `Yetmayapti: ${Math.abs(changeUzs).toLocaleString()} UZS`}
                    </div>
                  </div>
                  {changeUzs > 0 && (
                    <div className="text-right">
                      <span className="text-xs text-neutral-400 block">Dollar ekvivalenti:</span>
                      <span className="text-sm font-bold text-indigo-900">
                        ${exchangeRate > 0 ? (changeUzs / exchangeRate).toFixed(2) : '—'} USD
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* TAB 3: TO'LOV CHEKI / KVITANSIYA */}
          {/* ========================================================================= */}
          {activeTab === 'RECEIPT' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Form Side */}
              <div className="space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-500">
                  Chek Ma'lumotlarini Kiritish:
                </h3>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-neutral-700 mb-1">Chek Raqami</label>
                    <input
                      type="text"
                      value={receiptForm.receiptNo}
                      onChange={(e) => setReceiptForm(prev => ({ ...prev, receiptNo: e.target.value }))}
                      className="w-full px-3 py-1.5 rounded-lg border border-neutral-300 text-xs font-mono font-bold"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-neutral-700 mb-1">To'lov Turi</label>
                    <select
                      value={receiptForm.paymentMethod}
                      onChange={(e) => setReceiptForm(prev => ({ ...prev, paymentMethod: e.target.value }))}
                      className="w-full px-3 py-1.5 rounded-lg border border-neutral-300 text-xs font-semibold"
                    >
                      <option value="CASH">Naqd pul</option>
                      <option value="TERMINAL">Terminal (Uzcard/Humo)</option>
                      <option value="CLICK">Click / Payme</option>
                      <option value="BANK_TRANSFER">Bank o'tkazmasi</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">Mijoz / Do'kon Nomi</label>
                  <input
                    type="text"
                    value={receiptForm.customerName}
                    onChange={(e) => setReceiptForm(prev => ({ ...prev, customerName: e.target.value }))}
                    placeholder="Masalan: 'Oqtepa Market' yoki 'Farhod aka'"
                    className="w-full px-3 py-1.5 rounded-lg border border-neutral-300 text-xs font-bold"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-neutral-700 mb-1">To'langan Summa (UZS)</label>
                    <input
                      type="number"
                      value={receiptForm.amount}
                      onChange={(e) => setReceiptForm(prev => ({ ...prev, amount: Number(e.target.value) || 0 }))}
                      className="w-full px-3 py-1.5 rounded-lg border border-neutral-300 text-xs font-black text-emerald-700"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-neutral-700 mb-1">Qoldiq Qarz (UZS)</label>
                    <input
                      type="number"
                      value={receiptForm.remainingDebt}
                      onChange={(e) => setReceiptForm(prev => ({ ...prev, remainingDebt: Number(e.target.value) || 0 }))}
                      className="w-full px-3 py-1.5 rounded-lg border border-neutral-300 text-xs font-bold text-rose-700"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">Qabul Qiluvchi (Kassir/Agent)</label>
                  <input
                    type="text"
                    value={receiptForm.receivedBy}
                    onChange={(e) => setReceiptForm(prev => ({ ...prev, receivedBy: e.target.value }))}
                    className="w-full px-3 py-1.5 rounded-lg border border-neutral-300 text-xs"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">Izoh</label>
                  <input
                    type="text"
                    value={receiptForm.comment}
                    onChange={(e) => setReceiptForm(prev => ({ ...prev, comment: e.target.value }))}
                    className="w-full px-3 py-1.5 rounded-lg border border-neutral-300 text-xs"
                  />
                </div>

                <div className="flex gap-2 pt-2">
                  <button
                    onClick={copyReceiptText}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-neutral-900 text-white text-xs font-bold hover:bg-neutral-800 transition"
                  >
                    {copiedKey === 'receipt' ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                    <span>{copiedKey === 'receipt' ? "Nusxalandi!" : "Telegram / SMS Chek Nusxasi"}</span>
                  </button>
                  <button
                    onClick={handlePrintReceipt}
                    className="flex items-center justify-center gap-1.5 py-2 px-4 rounded-xl border border-neutral-300 text-neutral-700 hover:bg-neutral-100 text-xs font-bold transition"
                  >
                    <Printer className="h-4 w-4" />
                    <span>Chop etish</span>
                  </button>
                </div>
              </div>

              {/* Thermal Slip Preview Side */}
              <div className="flex flex-col items-center justify-center bg-neutral-100 p-4 rounded-2xl border border-neutral-200">
                <div className="w-full max-w-[280px] bg-white p-5 rounded-lg shadow-md border border-neutral-200 font-mono text-[11px] leading-relaxed text-neutral-800">
                  <div className="text-center pb-2 border-b border-dashed border-neutral-300">
                    <p className="font-bold text-xs uppercase tracking-wide">{firm}</p>
                    <p className="text-[10px] text-neutral-500">Moliya va Kassa Tizimi</p>
                    {firmPhone && <p className="text-[10px] text-neutral-500">Tel: {firmPhone}</p>}
                  </div>

                  <div className="py-2.5 border-b border-dashed border-neutral-300 space-y-1">
                    <div className="flex justify-between">
                      <span className="text-neutral-500">Chek №:</span>
                      <span className="font-bold">{receiptForm.receiptNo}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-neutral-500">Sana:</span>
                      <span>{new Date().toLocaleDateString('uz-UZ')}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-neutral-500">Vaqt:</span>
                      <span>{new Date().toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-neutral-500">Mijoz:</span>
                      <span className="font-bold text-right truncate max-w-[150px]">{receiptForm.customerName || '—'}</span>
                    </div>
                  </div>

                  <div className="py-2.5 border-b border-dashed border-neutral-300 space-y-1">
                    <div className="flex justify-between text-xs font-bold">
                      <span>TO'LANDI:</span>
                      <span className="text-emerald-700">{receiptForm.amount.toLocaleString()} UZS</span>
                    </div>
                    <div className="flex justify-between text-[10px] text-neutral-500">
                      <span>To'lov usuli:</span>
                      <span className="capitalize">{receiptForm.paymentMethod.toLowerCase()}</span>
                    </div>
                    <div className="flex justify-between text-[10px]">
                      <span>Qoldiq qarz:</span>
                      <span className="font-semibold text-rose-700">{receiptForm.remainingDebt.toLocaleString()} UZS</span>
                    </div>
                  </div>

                  <div className="pt-2 text-[10px] text-neutral-500 space-y-1">
                    <p>Kassir: {receiptForm.receivedBy}</p>
                    {receiptForm.comment && <p className="italic">Izoh: {receiptForm.comment}</p>}
                    <p className="text-center pt-2 font-sans text-[11px] font-bold text-neutral-700">
                      Rahmat, xaridingiz barakali bo'lsin!
                    </p>
                  </div>
                </div>
                <span className="text-[10px] text-neutral-400 mt-2">
                  Termal 80mm / 58mm printer uchun oldindan ko'rish
                </span>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* TAB 4: KUN YAKUNI Z-XULOSASI */}
          {/* ========================================================================= */}
          {activeTab === 'Z_REPORT' && (
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-neutral-200 pb-4">
                <div>
                  <h3 className="text-base font-bold text-neutral-900">
                    Kunlik Kassa Z-Hisoboti ({zSummary.date})
                  </h3>
                  <p className="text-xs text-neutral-500">
                    Kassa kunining barcha moliyaviy oqimlari va seyf holati bo'yicha to'liq xulosa
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={copyZReport}
                    className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-neutral-900 rounded-xl hover:bg-neutral-800 transition"
                  >
                    {copiedKey === 'zreport' ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                    <span>{copiedKey === 'zreport' ? "Nusxalandi!" : "Telegram Guruhga Nusxalash"}</span>
                  </button>
                  <button
                    onClick={() => window.print()}
                    className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-neutral-700 bg-neutral-100 hover:bg-neutral-200 rounded-xl transition"
                  >
                    <Printer className="h-4 w-4" />
                    <span>Chop Etish</span>
                  </button>
                </div>
              </div>

              {/* Z-Report Table View */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Tushumlar */}
                <div className="rounded-2xl border border-neutral-200 p-4 space-y-3 bg-white shadow-xs">
                  <h4 className="text-xs font-bold text-emerald-800 uppercase tracking-wider flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-emerald-500"></span>
                    Kirim & Tushumlar (Sales & Inflow)
                  </h4>
                  <div className="space-y-2 text-xs divide-y divide-neutral-100">
                    <div className="flex justify-between pt-1">
                      <span className="text-neutral-500">Boshlang'ich Kassa Qoldig'i:</span>
                      <span className="font-bold text-neutral-900">{zSummary.opening.toLocaleString()} UZS</span>
                    </div>
                    <div className="flex justify-between pt-2">
                      <span className="text-neutral-600">Naqd Pul Tushumi:</span>
                      <span className="font-bold text-neutral-900">{zSummary.totalCashIn.toLocaleString()} UZS</span>
                    </div>
                    <div className="flex justify-between pt-2">
                      <span className="text-neutral-600">Bank Kartasi (Terminal):</span>
                      <span className="font-bold text-neutral-900">{zSummary.totalTerminal.toLocaleString()} UZS</span>
                    </div>
                    <div className="flex justify-between pt-2">
                      <span className="text-neutral-600">Click / Payme:</span>
                      <span className="font-bold text-neutral-900">{zSummary.totalClick.toLocaleString()} UZS</span>
                    </div>
                    <div className="flex justify-between pt-2">
                      <span className="text-neutral-600">Bank O'tkazmasi:</span>
                      <span className="font-bold text-neutral-900">{zSummary.totalBank.toLocaleString()} UZS</span>
                    </div>
                    <div className="flex justify-between pt-2.5 text-sm font-black text-emerald-700 bg-emerald-50/50 p-2 rounded-lg">
                      <span>JAMI TUSHUM:</span>
                      <span>{zSummary.totalSales.toLocaleString()} UZS</span>
                    </div>
                  </div>
                </div>

                {/* Chiqimlar va Qoldiq */}
                <div className="rounded-2xl border border-neutral-200 p-4 space-y-3 bg-white shadow-xs">
                  <h4 className="text-xs font-bold text-rose-800 uppercase tracking-wider flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-rose-500"></span>
                    Chiqimlar & Seyf Qoldig'i
                  </h4>
                  <div className="space-y-2 text-xs divide-y divide-neutral-100">
                    <div className="flex justify-between pt-1">
                      <span className="text-neutral-600">Kunlik Rasxodlar (Xarajat):</span>
                      <span className="font-bold text-rose-700">-{zSummary.totalExpenses.toLocaleString()} UZS</span>
                    </div>
                    <div className="flex justify-between pt-2">
                      <span className="text-neutral-600">To'langan Oylik / Avans:</span>
                      <span className="font-bold text-rose-700">-{zSummary.totalSalaries.toLocaleString()} UZS</span>
                    </div>
                    <div className="flex justify-between pt-2">
                      <span className="text-neutral-500">Kassa Hisobiy Qoldig'i:</span>
                      <span className="font-bold text-neutral-900">{zSummary.current.toLocaleString()} UZS</span>
                    </div>
                    <div className="flex justify-between pt-2">
                      <span className="text-neutral-500">Sanalgan Haqiqiy Naqd:</span>
                      <span className="font-bold text-neutral-900">{zSummary.closed.toLocaleString()} UZS</span>
                    </div>
                    <div className={`flex justify-between pt-2.5 text-sm font-black p-2 rounded-lg ${
                      zSummary.diff === 0 ? 'bg-neutral-100 text-neutral-900' : 'bg-rose-50 text-rose-700'
                    }`}>
                      <span>FARQ (DISCREPANCY):</span>
                      <span>{zSummary.diff === 0 ? "0 UZS (Aniq)" : `${zSummary.diff.toLocaleString()} UZS`}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-neutral-200 bg-neutral-50 px-6 py-3">
          <span className="text-xs text-neutral-500">
            Kassir va hisobchilar uchun kundalik hisob-kitobni yengillashtirish moduli
          </span>
          <button
            onClick={onClose}
            className="rounded-xl bg-neutral-900 px-4 py-2 text-xs font-semibold text-white hover:bg-neutral-800 transition"
          >
            Yopish
          </button>
        </div>

      </div>
    </div>
  );
};
