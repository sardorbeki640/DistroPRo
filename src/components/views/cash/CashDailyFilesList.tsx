import React, { useState, useMemo } from 'react';
import { localToday } from '../../../utils/date';
import { 
  FolderOpen, 
  Calendar, 
  RefreshCw, 
  PlusCircle, 
  Lock, 
  ChevronRight, 
  Edit3, 
  Search, 
  TrendingUp, 
  ArrowDownLeft, 
  ArrowUpRight, 
  ShieldCheck, 
  X,
  Key,
  Trash2
} from 'lucide-react';
import { DailyFileItem } from '../../../types.ts';
import { ExportButton, exportTableXlsx, inDateRange } from '../../common/TableToolbar.tsx';

interface CashDailyFilesListProps {
  dailyFiles: DailyFileItem[];
  availableRegisters: any[];
  loading: boolean;
  currency: 'UZS' | 'USD';
  usdRate: number;
  onRefresh: () => void;
  onSelectFile: (file: DailyFileItem) => void;
  onOpenNewDailyFile: (data: { date: string; register_id: string; opening_balance: number }) => Promise<void>;
  /** Only open days; resolves when deleted, throws with the server's reason when refused. */
  onDeleteFile?: (file: DailyFileItem, reason: string) => Promise<void>;
}

export const CashDailyFilesList: React.FC<CashDailyFilesListProps> = ({
  dailyFiles,
  availableRegisters,
  loading,
  currency,
  usdRate,
  onRefresh,
  onSelectFile,
  onOpenNewDailyFile,
  onDeleteFile
}) => {
  const [deleting, setDeleting] = useState<DailyFileItem | null>(null);
  const [deleteReason, setDeleteReason] = useState('');
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const confirmDelete = async () => {
    if (!deleting || !onDeleteFile) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await onDeleteFile(deleting, deleteReason);
      setDeleting(null);
      setDeleteReason('');
    } catch (err: any) {
      setDeleteError(err.message || 'O‘chirib bo‘lmadi');
    } finally {
      setDeleteBusy(false);
    }
  };
  const [fileStatusFilter, setFileStatusFilter] = useState<'ALL' | 'OPEN' | 'CLOSED'>('ALL');
  const [fileSearchQuery, setFileSearchQuery] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [isOpenNewFileModal, setIsOpenNewFileModal] = useState(false);
  const todayStr = localToday();

  const [newFileDate, setNewFileDate] = useState(todayStr);
  const [newFileRegisterId, setNewFileRegisterId] = useState(availableRegisters[0]?.id || 'cr-default-01');
  const [newFileOpeningBalance, setNewFileOpeningBalance] = useState('0');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const formatAmount = (num?: number) => {
    const val = num || 0;
    if (currency === 'USD' && usdRate > 0) {
      return `$${Math.round(val / usdRate).toLocaleString()}`;
    }
    return `${val.toLocaleString()} UZS`;
  };

  const filteredDailyFiles = useMemo(() => {
    return dailyFiles.filter(file => {
      if (fileStatusFilter !== 'ALL' && file.status !== fileStatusFilter) return false;
      if (!inDateRange(file.date, dateFrom, dateTo)) return false;
      if (fileSearchQuery.trim()) {
        const q = fileSearchQuery.toLowerCase();
        const match = file.date.toLowerCase().includes(q) ||
          (file.register_name && file.register_name.toLowerCase().includes(q)) ||
          (file.opened_by_name && file.opened_by_name.toLowerCase().includes(q));
        if (!match) return false;
      }
      return true;
    });
  }, [dailyFiles, fileStatusFilter, fileSearchQuery, dateFrom, dateTo]);

  const listStats = useMemo(() => {
    const totalSales = filteredDailyFiles.reduce((acc, f) => acc + (f.total_sales || 0), 0);
    const totalInflow = filteredDailyFiles.reduce((acc, f) => acc + (f.cash_total || 0) + (f.terminal_total || 0) + (f.click_total || 0) + (f.credit_collections || 0), 0);
    const totalDebt = filteredDailyFiles.reduce((acc, f) => acc + (f.credit_total || 0), 0);
    const totalOrders = filteredDailyFiles.reduce((acc, f) => acc + (f.orders_count || 0), 0);
    return { totalSales, totalInflow, totalDebt, totalOrders };
  }, [filteredDailyFiles]);

  /** The day list exactly as filtered, one row per day. */
  const exportFiles = () => exportTableXlsx({
    fileName: 'Kassa_reestri_kunlar',
    title: 'Kassa reestri — kunlik fayllar',
    columns: [
      { header: 'Sana', key: 'date', type: 'date' },
      { header: 'Holati', key: 'status_label', width: 10 },
      { header: 'Kassa', key: 'register_name', width: 16 },
      { header: 'Ochgan', key: 'opened_by_name', width: 18 },
      { header: 'Zakazlar', key: 'orders_count', type: 'number', total: true },
      { header: 'Umumiy savdo', key: 'total_sales', type: 'money', total: true },
      { header: 'Naqd', key: 'cash_total', type: 'money', total: true },
      { header: 'Terminal', key: 'terminal_total', type: 'money', total: true },
      { header: 'Click', key: 'click_total', type: 'money', total: true },
      { header: 'Nasiyadan kirim', key: 'credit_collections', type: 'money', total: true },
      { header: 'Jami kirim', key: 'inflow', type: 'money', total: true },
      { header: 'Nasiya', key: 'credit_total', type: 'money', total: true },
      { header: 'Qaytarish', key: 'returns_total', type: 'money', total: true },
      { header: 'Xarajat', key: 'expenses_total', type: 'money', total: true },
      { header: 'Inkassa (bankka)', key: 'bank_deposits_total', type: 'money', total: true },
      { header: 'Kassa qoldig‘i', key: 'closing_balance', type: 'money' }
    ],
    rows: filteredDailyFiles.map(f => ({
      ...f,
      status_label: f.status === 'OPEN' ? 'Ochiq' : 'Yopilgan',
      inflow: (f.cash_total || 0) + (f.terminal_total || 0) + (f.click_total || 0) + (f.credit_collections || 0)
    })),
    filters: [
      fileStatusFilter === 'OPEN' ? 'faqat ochiq' : fileStatusFilter === 'CLOSED' ? 'faqat yopilgan' : '',
      fileSearchQuery && `qidiruv: "${fileSearchQuery}"`,
      (dateFrom || dateTo) && `davr: ${dateFrom || '…'} — ${dateTo || '…'}`
    ]
  });

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await onOpenNewDailyFile({
        date: newFileDate,
        register_id: newFileRegisterId,
        opening_balance: Number(newFileOpeningBalance) || 0
      });
      setIsOpenNewFileModal(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-neutral-200 shadow-xs">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 bg-emerald-50 text-emerald-700 rounded-xl border border-emerald-100">
            <FolderOpen className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-neutral-900">Kassa Reestri — Kunma-kun Fayllar</h1>
            <p className="text-xs text-neutral-500 mt-0.5">
              Har bir kun uchun bitta kassa reestri hujjati. O'zgartirish kiritish yoki to'liq ko'rish uchun fayl ustiga bosing.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={onRefresh}
            disabled={loading}
            className="inline-flex items-center px-3.5 py-2 text-xs font-semibold text-neutral-700 bg-neutral-100 hover:bg-neutral-200 rounded-xl transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
            Yangilash
          </button>

          <button
            onClick={() => setIsOpenNewFileModal(true)}
            className="inline-flex items-center px-4 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl transition shadow-xs"
          >
            <PlusCircle className="w-4 h-4 mr-1.5" />
            Yangi Kunlik Reestr Ochish
          </button>
        </div>
      </div>

      {/* 4 Summary Cards Across All Daily Files */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Metric 1 */}
        <div className="bg-white p-4 rounded-2xl border border-neutral-200 shadow-xs">
          <div className="flex items-center justify-between text-neutral-500">
            <span className="text-xs font-semibold uppercase">Jami Kunlik Fayllar</span>
            <div className="p-2 bg-neutral-100 rounded-xl text-neutral-700">
              <FolderOpen className="w-4 h-4" />
            </div>
          </div>
          <h3 className="text-2xl font-black text-neutral-900 mt-2">
            {dailyFiles.length} <span className="text-xs font-normal text-neutral-500">ta hujjat</span>
          </h3>
          <p className="text-[11px] text-neutral-500 mt-1">
            Jami zakazlar: {listStats.totalOrders.toLocaleString()} ta
          </p>
        </div>

        {/* Metric 2 */}
        <div className="bg-white p-4 rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50/40 to-white shadow-xs">
          <div className="flex items-center justify-between text-indigo-700">
            <span className="text-xs font-bold uppercase">Umumiy Savdolar</span>
            <div className="p-2 bg-indigo-100 rounded-xl text-indigo-700">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <h3 className="text-xl font-black text-indigo-950 mt-2">
            {formatAmount(listStats.totalSales)}
          </h3>
          <p className="text-[11px] text-indigo-600/80 mt-1">
            Barcha reestrlardagi sotuv
          </p>
        </div>

        {/* Metric 3 */}
        <div className="bg-white p-4 rounded-2xl border border-emerald-100 bg-gradient-to-br from-emerald-50/40 to-white shadow-xs">
          <div className="flex items-center justify-between text-emerald-700">
            <span className="text-xs font-bold uppercase">Jami Kirim</span>
            <div className="p-2 bg-emerald-100 rounded-xl text-emerald-700">
              <ArrowDownLeft className="w-4 h-4" />
            </div>
          </div>
          <h3 className="text-xl font-black text-emerald-950 mt-2">
            {formatAmount(listStats.totalInflow)}
          </h3>
          <p className="text-[11px] text-emerald-600/80 mt-1">
            Naqd va elektron tushumlar
          </p>
        </div>

        {/* Metric 4 */}
        <div className="bg-white p-4 rounded-2xl border border-rose-100 bg-gradient-to-br from-rose-50/40 to-white shadow-xs">
          <div className="flex items-center justify-between text-rose-700">
            <span className="text-xs font-bold uppercase">Qarzdorlik (Nasiya)</span>
            <div className="p-2 bg-rose-100 rounded-xl text-rose-700">
              <ArrowUpRight className="w-4 h-4" />
            </div>
          </div>
          <h3 className="text-xl font-black text-rose-950 mt-2">
            {formatAmount(listStats.totalDebt)}
          </h3>
          <p className="text-[11px] text-rose-600/80 mt-1">
            Olinmagan qarzlar qoldig'i
          </p>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-white p-4 rounded-2xl border border-neutral-200 shadow-xs flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          <span className="text-xs font-bold text-neutral-700 mr-1">Holati:</span>
          <button
            onClick={() => setFileStatusFilter('ALL')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-xl transition ${
              fileStatusFilter === 'ALL'
                ? 'bg-neutral-900 text-white'
                : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
            }`}
          >
            Barchasi ({dailyFiles.length})
          </button>
          <button
            onClick={() => setFileStatusFilter('OPEN')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-xl transition flex items-center space-x-1.5 ${
              fileStatusFilter === 'OPEN'
                ? 'bg-emerald-600 text-white'
                : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
            <span>Faqat Ochiq ({dailyFiles.filter(f => f.status === 'OPEN').length})</span>
          </button>
          <button
            onClick={() => setFileStatusFilter('CLOSED')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-xl transition flex items-center space-x-1.5 ${
              fileStatusFilter === 'CLOSED'
                ? 'bg-neutral-700 text-white'
                : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
            }`}
          >
            <Lock className="w-3 h-3 text-neutral-400" />
            <span>Yopilgan ({dailyFiles.filter(f => f.status === 'CLOSED').length})</span>
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          <label className="flex items-center gap-1 text-[11px] text-neutral-500">
            dan
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="h-9 px-2 text-xs rounded-xl border border-neutral-200 bg-neutral-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500" />
          </label>
          <label className="flex items-center gap-1 text-[11px] text-neutral-500">
            gacha
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="h-9 px-2 text-xs rounded-xl border border-neutral-200 bg-neutral-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500" />
          </label>
          <div className="relative w-full sm:w-56">
            <Search className="w-3.5 h-3.5 text-neutral-400 absolute left-3 top-3" />
            <input
              type="text"
              value={fileSearchQuery}
              onChange={e => setFileSearchQuery(e.target.value)}
              placeholder="Sana yoki kassir bo'yicha qidiruv..."
              className="w-full h-9 pl-8 pr-3 text-xs rounded-xl border border-neutral-200 bg-neutral-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
          <ExportButton onExport={exportFiles} />
        </div>
      </div>

      {/* Files Table */}
      <div className="bg-white rounded-2xl border border-neutral-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-neutral-100 text-neutral-700 font-bold border-b border-neutral-200 divide-x divide-neutral-200">
                <th className="py-3.5 px-4 min-w-[130px]">Sana</th>
                <th className="py-3.5 px-3 min-w-[120px]">Hujjat / Fayl #</th>
                <th className="py-3.5 px-3 min-w-[100px] text-center">Holati</th>
                <th className="py-3.5 px-3 min-w-[140px]">Kassa & Mas'ul</th>
                <th className="py-3.5 px-4 text-right min-w-[120px] bg-indigo-50/40 text-indigo-900">Umumiy Savdo</th>
                <th className="py-3.5 px-4 text-right min-w-[120px] bg-emerald-50/40 text-emerald-900">Jami Kirim</th>
                <th className="py-3.5 px-4 text-right min-w-[120px] bg-rose-50/40 text-rose-900">Qarzdorlik (Nasiya)</th>
                <th className="py-3.5 px-3 text-center min-w-[90px]">Zakazlar</th>
                <th className="py-3.5 px-4 text-center min-w-[130px] bg-neutral-50">Amallar</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 font-medium text-neutral-800">
              {loading && dailyFiles.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-neutral-500">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-emerald-600" />
                    Kunlik reestr fayllari yuklanmoqda…
                  </td>
                </tr>
              ) : filteredDailyFiles.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-neutral-400">
                    <FolderOpen className="w-8 h-8 mx-auto mb-2 text-neutral-300" />
                    Hech qanday kunlik reestr fayli topilmadi.
                  </td>
                </tr>
              ) : (
                filteredDailyFiles.map(file => {
                  const isOpen = file.status === 'OPEN';
                  const inFlow = (file.cash_total || 0) + (file.terminal_total || 0) + (file.click_total || 0) + (file.credit_collections || 0);

                  return (
                    <tr 
                      key={file.id} 
                      onClick={() => onSelectFile(file)}
                      className="hover:bg-emerald-50/30 transition divide-x divide-neutral-100 cursor-pointer group"
                    >
                      {/* Sana */}
                      <td className="py-3.5 px-4">
                        <div className="flex items-center space-x-2">
                          <Calendar className="w-4 h-4 text-neutral-400 group-hover:text-emerald-600 transition shrink-0" />
                          <div>
                            <span className="font-bold text-neutral-900 group-hover:text-emerald-700 transition">
                              {file.date}
                            </span>
                            {file.date === todayStr && (
                              <span className="ml-1.5 px-1.5 py-0.5 text-[9px] font-bold bg-emerald-100 text-emerald-800 rounded">
                                BUGUN
                              </span>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Hujjat # */}
                      <td className="py-3.5 px-3 font-mono text-[11px] text-neutral-600">
                        REG-{file.date}
                      </td>

                      {/* Holati */}
                      <td className="py-3.5 px-3 text-center">
                        {isOpen ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1 animate-pulse"></span>
                            OCHIQ
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-neutral-100 text-neutral-700 border border-neutral-200">
                            <Lock className="w-2.5 h-2.5 mr-1 text-neutral-400" />
                            YOPILGAN
                          </span>
                        )}
                      </td>

                      {/* Kassa & Mas'ul */}
                      <td className="py-3.5 px-3">
                        <div className="font-bold text-neutral-900">{file.register_name || 'Asosiy Kassa'}</div>
                        <div className="text-[10px] text-neutral-400">{file.opened_by_name || 'Kassir'}</div>
                      </td>

                      {/* Umumiy Savdo */}
                      <td className="py-3.5 px-4 text-right font-black text-indigo-700 bg-indigo-50/20">
                        {formatAmount(file.total_sales)}
                      </td>

                      {/* Jami Kirim */}
                      <td className="py-3.5 px-4 text-right font-bold text-emerald-700 bg-emerald-50/20">
                        {formatAmount(inFlow)}
                      </td>

                      {/* Qarzdorlik */}
                      <td className="py-3.5 px-4 text-right font-bold text-rose-700 bg-rose-50/20">
                        {formatAmount(file.credit_total)}
                      </td>

                      {/* Zakazlar */}
                      <td className="py-3.5 px-3 text-center">
                        <span className="px-2 py-0.5 rounded-md bg-neutral-100 text-neutral-700 font-bold text-[11px]">
                          {file.orders_count || 0} ta
                        </span>
                      </td>

                      {/* Amallar */}
                      <td className="py-3.5 px-4 text-center bg-neutral-50/40" onClick={e => e.stopPropagation()}>
                        <button
                          onClick={() => onSelectFile(file)}
                          className="inline-flex items-center space-x-1.5 px-3 py-1.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl transition shadow-xs group-hover:ring-2 group-hover:ring-emerald-400"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                          <span>O'zgartirish</span>
                          <ChevronRight className="w-3.5 h-3.5 opacity-70" />
                        </button>
                        {isOpen && onDeleteFile && (
                          <button
                            onClick={() => { setDeleting(file); setDeleteReason(''); setDeleteError(null); }}
                            className="ml-1.5 inline-flex items-center p-1.5 text-rose-600 hover:bg-rose-50 rounded-lg transition"
                            title="Ochiq kassa kunini o‘chirish"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal: Delete an open day */}
      {deleting && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-neutral-100 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-neutral-900">Kassa kunini o‘chirish — {deleting.date}</h3>
              <button onClick={() => setDeleting(null)} className="text-neutral-400 hover:text-neutral-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="rounded-xl bg-rose-50 border border-rose-200 p-3 text-xs text-rose-900 space-y-1">
              <p>Kun ichidagi hamma yozuvlar o‘chiriladi: <b>{deleting.orders_count || 0} ta buyurtma qatori</b>, kassa kirim-chiqimlari va qaytarishlar.</p>
              <p>Bu kun yaratgan qarz daftari yozuvlari “bekor qilingan” deb belgilanadi, mijoz qarzlari qayta hisoblanadi.</p>
              <p>O‘chirishdan oldin bazaning zaxira nusxasi olinadi. Distribyutor tizimiga (SalesDoctor, Linko …) to‘lov yuborilgan bo‘lsa, o‘chirish rad etiladi.</p>
            </div>
            <label className="block text-xs font-semibold text-neutral-700">
              Sabab (audit jurnaliga yoziladi)
              <input
                autoFocus
                value={deleteReason}
                onChange={e => setDeleteReason(e.target.value)}
                placeholder="Masalan: noto‘g‘ri sanaga ochilgan"
                className="mt-1 w-full px-3 py-2 text-xs rounded-xl border border-neutral-200 bg-neutral-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-rose-500"
              />
            </label>
            {deleteError && <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">{deleteError}</div>}
            <div className="flex justify-end gap-2">
              <button onClick={() => setDeleting(null)} className="px-4 py-2 text-xs font-semibold text-neutral-600 hover:bg-neutral-100 rounded-xl">Bekor qilish</button>
              <button
                onClick={confirmDelete}
                disabled={deleteBusy || deleteReason.trim().length < 3}
                className="px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-xl disabled:opacity-50 inline-flex items-center"
              >
                {deleteBusy && <RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
                O‘chirish
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Open New Daily File */}
      {isOpenNewFileModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-neutral-100">
            <div className="flex items-center justify-between border-b border-neutral-100 pb-4 mb-4">
              <div className="flex items-center space-x-2">
                <div className="p-2 bg-emerald-50 text-emerald-700 rounded-xl">
                  <FolderOpen className="w-5 h-5" />
                </div>
                <h3 className="text-base font-bold text-neutral-900">Yangi Kunlik Reestr Ochish</h3>
              </div>
              <button onClick={() => setIsOpenNewFileModal(false)} className="text-neutral-400 hover:text-neutral-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1">Reestr Sanasi</label>
                <input
                  type="date"
                  required
                  value={newFileDate}
                  onChange={e => setNewFileDate(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-neutral-200 bg-neutral-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 font-semibold"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1">Kassa Registri</label>
                <select
                  value={newFileRegisterId}
                  onChange={e => setNewFileRegisterId(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-neutral-200 bg-neutral-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  {availableRegisters.length > 0 ? (
                    availableRegisters.map(reg => (
                      <option key={reg.id} value={reg.id}>{reg.name} ({reg.currency || 'UZS'})</option>
                    ))
                  ) : (
                    <option value="cr-default-01">Asosiy Kassa (UZS)</option>
                  )}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1">Boshlang'ich Naqd Qoldiq (UZS)</label>
                <input
                  type="number"
                  value={newFileOpeningBalance}
                  onChange={e => setNewFileOpeningBalance(e.target.value)}
                  placeholder="0"
                  className="w-full px-3 py-2 text-xs rounded-xl border border-neutral-200 bg-neutral-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono"
                />
              </div>

              <div className="flex items-center justify-end space-x-3 pt-3 border-t border-neutral-100">
                <button
                  type="button"
                  onClick={() => setIsOpenNewFileModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-neutral-600 hover:bg-neutral-100 rounded-xl"
                >
                  Bekor qilish
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl flex items-center"
                >
                  {isSubmitting && <RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
                  Reestr Faylini Ochish
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
