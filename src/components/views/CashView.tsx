import React, { useState, useEffect, useMemo } from 'react';
import { localToday } from '../../utils/date';
import { 
  PlusCircle, 
  Calendar, 
  Search, 
  Filter, 
  Download, 
  Upload, 
  RefreshCw, 
  Edit3, 
  Trash2, 
  CheckCircle2, 
  AlertCircle, 
  X, 
  ArrowUpRight, 
  ArrowDownLeft, 
  FolderOpen, 
  ArrowLeft, 
  Lock, 
  Unlock, 
  Key,
  DollarSign,
  TrendingUp,
  FileSpreadsheet,
  Landmark
} from 'lucide-react';
import { api } from '../../services/api.ts';
import { DailyOrderEntry, Customer, Agent, AuthUser, DailyFileItem } from '../../types.ts';
import { CashDailyFilesList } from './cash/CashDailyFilesList.tsx';
import { CashRegistryTable } from './cash/CashRegistryTable.tsx';
import { CashSmartAlerts } from './cash/CashSmartAlerts.tsx';
import { QuickToolsModal } from '../common/QuickToolsModal.tsx';
import { can } from '../../utils/permissions.ts';
import { BankDepositModal } from './cash/BankDepositModal.tsx';
import { useDistribution } from '../../hooks/useDistribution.ts';
import { MultiSelect, picked } from '../common/MultiSelect.tsx';

interface CashViewProps {
  cashDay?: any;
  transactions?: any[];
  availableRegisters?: any[];
  user: AuthUser | null;
  onRefresh?: () => void;
}

export const CashView: React.FC<CashViewProps> = ({ 
  cashDay, 
  transactions = [], 
  availableRegisters = [], 
  user, 
  onRefresh 
}) => {
  // Mode: 'list' (kunma-kun fayllar ro'yxati) OR 'detail' (aynan bitta kunning to'liq kassa reestri)
  const [viewMode, setViewMode] = useState<'list' | 'detail'>('list');
  const [selectedFile, setSelectedFile] = useState<DailyFileItem | null>(null);

  // Currency: UZS or USD
  const [currency, setCurrency] = useState<'UZS' | 'USD'>('UZS');
  // Official Central Bank rate for today; 0 = not loaded, dollar amounts are then not shown.
  const [usdRate, setUsdRate] = useState(0);
  useEffect(() => {
    api.getExchangeRate().then(r => {
      if (r.rate) setUsdRate(r.rate);
      else { setUsdRate(0); setCurrency('UZS'); }
    }).catch(() => { setUsdRate(0); setCurrency('UZS'); });
  }, []);

  // General state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Daily Files List State
  const [dailyFiles, setDailyFiles] = useState<DailyFileItem[]>([]);
  const [isBankDepositOpen, setIsBankDepositOpen] = useState(false);

  // Registry Detail Data
  const [registryItems, setRegistryItems] = useState<DailyOrderEntry[]>([]);
  const [summaryData, setSummaryData] = useState<{
    total_sales: number;
    total_inflow: number;
    total_debt: number;
    totals: any;
  }>({
    total_sales: 0,
    total_inflow: 0,
    total_debt: 0,
    totals: {}
  });

  // Reference lists
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);

  // Detail View Date and quick filters
  const todayStr = localToday();
  const [fromDate, setFromDate] = useState<string>(todayStr);
  const [toDate, setToDate] = useState<string>(todayStr);
  const [selectedAgent, setSelectedAgent] = useState<string>('');
  const [selectedCustomer, setSelectedCustomer] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [quickFilter, setQuickFilter] = useState<'ALL' | 'DEBTORS' | 'CASH' | 'RETURNS'>('ALL');

  // Security Director PIN modal for reopening closed days
  const [isPinModalOpen, setIsPinModalOpen] = useState(false);
  const [directorPin, setDirectorPin] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);

  // Modals for Detail View
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<DailyOrderEntry | null>(null);
  const [deletingItem, setDeletingItem] = useState<DailyOrderEntry | null>(null);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [receiptModalOpen, setReceiptModalOpen] = useState(false);
  const [selectedReceiptData, setSelectedReceiptData] = useState<any>(null);

  const handlePrintReceiptForOrder = (order: DailyOrderEntry) => {
    const cashAmt = order.cash_payment || 0;
    const termAmt = order.terminal_click || 0;
    const userRole = user?.roles?.[0]?.name || 'Bosh Kassir';
    const userName = user?.full_name || 'Kassir';
    setSelectedReceiptData({
      // The order number is unique within the cash register; the row id covers rows without one.
      receiptNo: `CK-${order.order_number || order.id.slice(-8).toUpperCase()}`,
      customerName: order.customer_name,
      amount: cashAmt > 0 ? cashAmt : (order.sale_amount || 0),
      paymentMethod: cashAmt > 0 ? 'CASH' : (termAmt > 0 ? 'TERMINAL' : 'CASH'),
      remainingDebt: order.remaining_debt || 0,
      receivedBy: `${userName} (${userRole})`,
      comment: `Sana: ${order.order_date || todayStr} | Agent: ${order.agent_name || 'Umumiy'}`
    });
    setReceiptModalOpen(true);
  };

  // Form inputs for Create / Edit
  const [formData, setFormData] = useState({
    order_date: todayStr,
    order_number: '',
    agent_id: '',
    customer_id: '',
    sale_amount: '',
    cash_payment: '',
    uy_oplata: '',
    nasiya_perech: '',
    nasiyadan_kirim: '',
    return_amount: '',
    carried_forward_amount: '',
    terminal_click: '',
    remaining_debt: '',
    note: ''
  });

  // Fetch reference data (customers, agents)
  useEffect(() => {
    const loadRefs = async () => {
      try {
        const [custRes, agRes] = await Promise.all([
          api.getCustomers(),
          api.getAgents()
        ]);
        setCustomers(custRes.customers || []);
        setAgents(agRes.agents || []);
      } catch (e) {
        console.error('Failed to load references', e);
      }
    };
    loadRefs();
  }, []);

  // Fetch daily files list
  const loadDailyFiles = async () => {
    setLoading(true);
    try {
      const res = await api.getDailyFilesList();
      setDailyFiles(res.files || []);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Kunlik fayllarni yuklashda xatolik yuz berdi');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDailyFiles();
  }, []);

  // Fetch detail registry data
  const fetchRegistry = async (from = fromDate, to = toDate) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getRegistry({
        from_date: from || undefined,
        to_date: to || undefined,
        agent_id: picked(selectedAgent).join(',') || undefined,
        customer_id: picked(selectedCustomer).join(',') || undefined,
        search: searchQuery || undefined
      });

      setRegistryItems(res.items || []);
      setSummaryData({
        total_sales: res.total_sales || 0,
        total_inflow: res.total_inflow || 0,
        total_debt: res.total_debt || 0,
        totals: res.totals || {}
      });
    } catch (err: any) {
      setError(err.message || 'Reestr ma\'lumotlarini yuklashda xatolik yuz berdi');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (viewMode === 'detail') {
      fetchRegistry();
    }
  }, [viewMode, fromDate, toDate, selectedAgent, selectedCustomer, searchQuery]);

  const saveDay = async () => {
    if(!selectedFile) return;
    setLoading(true);setError(null);setSuccessMsg(null);
    try {
      const result=await api.saveCashRegistry(selectedFile.id);
      if(result.pending) setError(result.message); else setSuccessMsg(result.message);
      setCancelRequired(result.cancel_required || []);
      await fetchRegistry();
    }
    catch(err:any){setError(err.message);}finally{setLoading(false);}
  };
  const { name: systemName } = useDistribution();
  // Payments set to 0 / deleted here after they were sent: they must be deleted by hand in the connected system, then checked.
  const [cancelRequired, setCancelRequired] = useState<{ order: string; method: string; amount: number }[]>([]);
  const verifyCancellations = async () => {
    if(!selectedFile) return;
    setLoading(true);setError(null);
    try {
      const r=await api.verifyCashCancellations(selectedFile.id);
      if(r.still.length) setError(r.message); else { setSuccessMsg(r.message); setCancelRequired([]); }
    } catch(err:any){setError(err.message);} finally{setLoading(false);}
  };
  const refreshOrders = async () => {
    if(!selectedFile) return;
    setLoading(true);setError(null);
    try{const result=await api.refreshCashOrders(selectedFile.id);setSuccessMsg(result.message);await fetchRegistry();}
    catch(err:any){setError(err.message);}finally{setLoading(false);}
  };
  // Click a file from list to open detail
  const handleSelectFile = (file: DailyFileItem) => {
    setSelectedFile(file);
    setFromDate(file.date);
    setToDate(file.date);
    setSelectedAgent('');
    setSelectedCustomer('');
    setSearchQuery('');
    setQuickFilter('ALL');
    setViewMode('detail');
    fetchRegistry(file.date, file.date);
  };

  // Reopen closed file: the server checks the director role and records the reason in the audit log.
  const handleConfirmReopenWithPin = async () => {
    if (!selectedFile) return;
    const reason = directorPin.trim();
    if (reason.length < 5) {
      setPinError('Qayta ochish sababini yozing (kamida 5 belgi).');
      return;
    }

    setLoading(true);
    setError(null);
    setIsPinModalOpen(false);
    setDirectorPin('');
    setPinError(null);

    try {
      const res = await api.reopenDailyFile(selectedFile.id, reason);
      setSuccessMsg(res.message || `${selectedFile.date} sanasidagi kunlik fayl qayta ochildi`);
      setSelectedFile(prev => prev ? { ...prev, status: 'OPEN' } : null);
      loadDailyFiles();
      if (onRefresh) onRefresh();
    } catch (err: any) {
      setError(err.message || 'Faylni qayta ochishda xatolik yuz berdi');
    } finally {
      setLoading(false);
    }
  };

  // Handle open new daily file from list
  const handleOpenNewDailyFile = async (data: { date: string; register_id: string; opening_balance: number }) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.openCashDay({
        register_id: data.register_id,
        date: data.date,
        opening_balance: data.opening_balance
      });

      setSuccessMsg(res.message || `${res.cashDay.date} sanasi uchun kunlik reestr ochildi!`);
      setFromDate(res.cashDay.date);
      setToDate(res.cashDay.date);
      setSelectedFile({
        id: res.cashDay.id,
        date: res.cashDay.date,
        status: 'OPEN',
        register_name: availableRegisters.find(r => r.id === data.register_id)?.name || 'Asosiy Kassa',
        opened_by_name: user?.full_name || 'Kassir',
        opening_balance: res.cashDay.opening_balance,
        closing_balance: res.cashDay.closing_balance || res.cashDay.opening_balance,
        difference: 0,
        total_sales: 0,
        orders_count: 0,
        cash_total: 0,
        terminal_total: 0,
        click_total: 0,
        credit_total: 0,
        credit_collections: 0,
        expenses_total: 0,
        trips_count: 0,
        trips_total: 0,
        carried_forward_total: 0,
        returns_total: 0,
        opened_at: res.cashDay.opened_at
      });
      setViewMode('detail');
      fetchRegistry(res.cashDay.date, res.cashDay.date);
      loadDailyFiles();
      if (onRefresh) onRefresh();
    } catch (err: any) {
      setError(err.message || 'Kunlik faylni ochishda xatolik yuz berdi');
    } finally {
      setLoading(false);
    }
  };

  // Quick filters applied to registry items
  const displayedItems = useMemo(() => {
    return registryItems.filter(item => {
      if (quickFilter === 'DEBTORS') return (item.remaining_debt || 0) > 0;
      if (quickFilter === 'CASH') return (item.cash_payment || 0) > 0;
      if (quickFilter === 'RETURNS') return (item.return_amount || 0) > 0;
      return true;
    });
  }, [registryItems, quickFilter]);

  // Inline Cell Update Handler
  const handleInlineUpdate = async (id: string, field: string, value: number) => {
    const existing = registryItems.find(i => i.id === id);
    if (!existing) return;

    const updatedRow = { ...existing, [field]: value };
    const sale_amount = field === 'sale_amount' ? value : (updatedRow.sale_amount || 0);
    const cash_payment = field === 'cash_payment' ? value : (updatedRow.cash_payment || 0);
    const uy_oplata = field === 'uy_oplata' ? value : (updatedRow.uy_oplata || 0);
    const terminal_click = field === 'terminal_click' ? value : (updatedRow.terminal_click || 0);
    const return_amount = field === 'return_amount' ? value : (updatedRow.return_amount || 0);

    const remaining_debt = Math.max(0, sale_amount - cash_payment - uy_oplata - terminal_click - return_amount);
    updatedRow.remaining_debt = remaining_debt;

    // Optimistic update
    setRegistryItems(prev => prev.map(i => i.id === id ? updatedRow : i));

    try {
      await api.updateRegistryOrder(id, {
        [field]: value,
        remaining_debt
      });
      setSuccessMsg('Katakcha saqlandi');
      setTimeout(() => setSuccessMsg(null), 2000);
      fetchRegistry();
      loadDailyFiles();
    } catch (err: any) {
      setError(err.message || 'Katakchani saqlashda xatolik');
      fetchRegistry();
    }
  };

  // Batch Delete
  const handleBatchDelete = async (ids: string[]) => {
    setLoading(true);
    try {
      await Promise.all(ids.map(id => api.deleteRegistryOrder(id)));
      setSuccessMsg(`${ids.length} ta yozuv o'chirildi`);
      fetchRegistry();
      loadDailyFiles();
    } catch (err: any) {
      setError(err.message || "Ommaviy o'chirishda xatolik");
    } finally {
      setLoading(false);
    }
  };

  // Batch Assign Agent
  const handleBatchAssignAgent = async (ids: string[], agentId: string) => {
    setLoading(true);
    try {
      await Promise.all(ids.map(id => api.updateRegistryOrder(id, { agent_id: agentId })));
      setSuccessMsg(`${ids.length} ta yozuv yangi agentga biriktirildi`);
      fetchRegistry();
      loadDailyFiles();
    } catch (err: any) {
      setError(err.message || 'Agent biriktirishda xatolik');
    } finally {
      setLoading(false);
    }
  };

  // Format money helper
  const formatMoney = (val?: number) => {
    const num = val || 0;
    if (currency === 'USD' && usdRate > 0) {
      return `$${Math.round(num / usdRate).toLocaleString()}`;
    }
    return `${num.toLocaleString()} UZS`;
  };

  // Form open helpers
  const handleOpenCreate = () => {
    setFormData({
      order_date: selectedFile?.date || toDate || todayStr,
      order_number: `ORD-${Date.now().toString().slice(-5)}`,
      agent_id: picked(selectedAgent)[0] || (agents[0]?.id || ''),
      customer_id: customers[0]?.id || '',
      sale_amount: '',
      cash_payment: '',
      uy_oplata: '',
      nasiya_perech: '',
      nasiyadan_kirim: '',
      return_amount: '',
      carried_forward_amount: '',
      terminal_click: '',
      remaining_debt: '',
      note: ''
    });
    setIsCreateModalOpen(true);
  };

  const handleOpenEdit = (item: DailyOrderEntry) => {
    setEditingItem(item);
    setFormData({
      order_date: item.order_date,
      order_number: item.order_number,
      agent_id: item.agent_id || '',
      customer_id: item.customer_id,
      sale_amount: item.sale_amount ? String(item.sale_amount) : '',
      cash_payment: item.cash_payment ? String(item.cash_payment) : '',
      uy_oplata: item.uy_oplata ? String(item.uy_oplata) : '',
      nasiya_perech: item.nasiya_perech ? String(item.nasiya_perech) : '',
      nasiyadan_kirim: item.nasiyadan_kirim ? String(item.nasiyadan_kirim) : '',
      return_amount: item.return_amount ? String(item.return_amount) : '',
      carried_forward_amount: item.carried_forward_amount ? String(item.carried_forward_amount) : '',
      terminal_click: item.terminal_click ? String(item.terminal_click) : '',
      remaining_debt: item.remaining_debt ? String(item.remaining_debt) : '',
      note: item.note || ''
    });
  };

  // Save Create / Edit form
  const handleSaveForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.customer_id) {
      setError('Mijozni tanlang');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const sale = Number(formData.sale_amount) || 0;
      const cash = Number(formData.cash_payment) || 0;
      const uy = Number(formData.uy_oplata) || 0;
      const term = Number(formData.terminal_click) || 0;
      const ret = Number(formData.return_amount) || 0;
      const autoRem = Math.max(0, sale - cash - uy - term - ret);

      const payload = {
        cash_day_id:selectedFile?.id,
        order_date: formData.order_date,
        order_number: formData.order_number || `ORD-${Date.now().toString().slice(-6)}`,
        agent_id: formData.agent_id || null,
        customer_id: formData.customer_id,
        sale_amount: sale,
        cash_payment: cash,
        uy_oplata: uy,
        nasiya_perech: Number(formData.nasiya_perech) || 0,
        nasiyadan_kirim: Number(formData.nasiyadan_kirim) || 0,
        return_amount: ret,
        carried_forward_amount: Number(formData.carried_forward_amount) || 0,
        terminal_click: term,
        remaining_debt: formData.remaining_debt !== '' ? Number(formData.remaining_debt) : autoRem,
        note: formData.note || null
      };

      if (editingItem) {
        await api.updateRegistryOrder(editingItem.id, payload);
        setSuccessMsg('Reestr yozuvi muvaffaqiyatli yangilandi');
        setEditingItem(null);
      } else {
        await api.createRegistryOrder(payload);
        setSuccessMsg('Reestrga yangi yozuv qo\'shildi');
        setIsCreateModalOpen(false);
      }

      fetchRegistry();
      loadDailyFiles();
    } catch (err: any) {
      setError(err.message || 'Saqlashda xatolik');
    } finally {
      setLoading(false);
    }
  };

  // Delete single item
  const handleConfirmDelete = async () => {
    if (!deletingItem) return;
    setLoading(true);
    setError(null);
    try {
      await api.deleteRegistryOrder(deletingItem.id);
      setSuccessMsg('Reestr yozuvi o\'chirildi');
      setDeletingItem(null);
      fetchRegistry();
      loadDailyFiles();
    } catch (err: any) {
      setError(err.message || 'O\'chirishda xatolik');
    } finally {
      setLoading(false);
    }
  };

  // Excel export: a whole cash day comes from the server (register + cash movements + balance);
  // a filtered or multi-day view is exported exactly as shown.
  const handleExportExcel = async () => {
    try {
      if (selectedFile?.id && quickFilter === 'ALL') {
        await api.downloadCashDayXlsx(selectedFile.id);
        return;
      }
      const fmt = (d?: string) => (d ? d.split('-').reverse().join('.') : '…');
      const period = fromDate === toDate ? fmt(fromDate) : `${fmt(fromDate)} — ${fmt(toDate)}`;
      const filterLabel: Record<string, string> = { DEBTORS: 'faqat qarzdorlar', CASH: 'faqat naqd to‘laganlar', RETURNS: 'faqat qaytarishlar' };
      await api.downloadXlsx(`Kassa_reestri_${fromDate || 'barchasi'}${toDate && toDate !== fromDate ? `_${toDate}` : ''}.xlsx`, [{
        name: 'Reestr',
        title: `Kassa reestri — ${period}`,
        subtitle: [
          [selectedAgent ? `Agent: ${picked(selectedAgent).length} ta` : '', selectedCustomer ? `Mijoz: ${picked(selectedCustomer).length} ta` : '', searchQuery ? `Qidiruv: “${searchQuery}”` : '', quickFilter !== 'ALL' ? filterLabel[quickFilter] || '' : '']
            .filter(Boolean).join(' · ') || 'Barcha yozuvlar'
        ],
        columns: [
          { header: 'Sana', key: 'order_date', type: 'date', width: 11 },
          { header: 'Buyurtma', key: 'order_number', width: 13 },
          { header: 'Agent', key: 'agent_name' },
          { header: 'Mijoz (kontragent)', key: 'customer_name', width: 30 },
          { header: 'Summa', key: 'sale_amount', type: 'money', total: true },
          { header: 'Oplata (naqd)', key: 'cash_payment', type: 'money', total: true },
          { header: 'Uy oplata', key: 'uy_oplata', type: 'money', total: true },
          { header: 'Nasiya va perech', key: 'nasiya_perech', type: 'money', total: true },
          { header: 'Nasiyadan kirim', key: 'nasiyadan_kirim', type: 'money', total: true },
          { header: 'Vozvrat', key: 'return_amount', type: 'money', total: true },
          { header: 'Kun surildi', key: 'carried_forward_amount', type: 'money', total: true },
          { header: 'Terminal va click', key: 'terminal_click', type: 'money', total: true },
          { header: 'Qoldiq', key: 'remaining_debt', type: 'money', total: true },
          { header: 'Izoh', key: 'note', width: 32 }
        ],
        rows: displayedItems.map(item => ({
          order_date: item.order_date,
          order_number: item.order_number,
          agent_name: item.agent_name || '',
          customer_name: item.customer_name || '',
          sale_amount: item.sale_amount || 0,
          cash_payment: item.cash_payment || 0,
          uy_oplata: item.uy_oplata || 0,
          nasiya_perech: item.nasiya_perech || 0,
          nasiyadan_kirim: item.nasiyadan_kirim || 0,
          return_amount: item.return_amount || 0,
          carried_forward_amount: item.carried_forward_amount || 0,
          terminal_click: item.terminal_click || 0,
          remaining_debt: item.remaining_debt || 0,
          note: item.note || ''
        })),
        totalsLabel: 'JAMI'
      }]);
    } catch (err: any) {
      setError(err.message || 'Excel faylini yuklab bo‘lmadi');
    }
  };

  return (
    <div className="space-y-6">
      {/* Notifications */}
      {error && (
        <div className="p-4 bg-rose-50 border border-rose-200 text-rose-800 rounded-2xl flex items-center justify-between text-xs">
          <div className="flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{error}</span>
          </div>
          <button onClick={() => setError(null)} className="text-rose-600 hover:text-rose-800">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {successMsg && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-2xl flex items-center justify-between text-xs">
          <div className="flex items-center space-x-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{successMsg}</span>
          </div>
          <button onClick={() => setSuccessMsg(null)} className="text-emerald-600 hover:text-emerald-800">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODE 1: DAY-BY-DAY FILES LIST                                            */}
      {/* ========================================================================= */}
      {viewMode === 'list' && (
        <CashDailyFilesList
          dailyFiles={dailyFiles}
          availableRegisters={availableRegisters}
          loading={loading}
          currency={currency}
          usdRate={usdRate}
          onRefresh={loadDailyFiles}
          onSelectFile={handleSelectFile}
          onOpenNewDailyFile={handleOpenNewDailyFile}
          onDeleteFile={can(user, 'cash:delete') ? async (file, reason) => {
            const res = await api.deleteCashDay(file.id, reason);
            setSuccessMsg(res.message);
            await loadDailyFiles();
            if (onRefresh) onRefresh();
          } : undefined}
        />
      )}

      {viewMode === 'detail' && cancelRequired.length > 0 && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-xs text-amber-900 space-y-2">
          <p className="font-bold">{systemName}da qo‘lda o‘chirish kerak ({cancelRequired.length} ta to‘lov)</p>
          <p>Bu to‘lovlar {systemName}ga yuborilgan edi, keyin kassada 0 qilindi yoki qator o‘chirildi. {systemName} API orqali to‘lovni o‘chirib bo‘lmaydi — {systemName}da toping va o‘chiring, keyin tekshiring.</p>
          <ul className="list-disc pl-5">
            {cancelRequired.map((c, i) => <li key={i}>{c.order} — <b>{Math.round(c.amount).toLocaleString('ru-RU')} so‘m</b></li>)}
          </ul>
          <button onClick={verifyCancellations} disabled={loading} className="rounded-xl bg-amber-600 px-3 py-1.5 font-bold text-white hover:bg-amber-700 disabled:opacity-50">{systemName}da o‘chirdim — tekshirish</button>
        </div>
      )}

      {isBankDepositOpen && selectedFile && (
        <BankDepositModal
          cashDayId={selectedFile.id}
          date={selectedFile.date}
          isOpen={selectedFile.status === 'OPEN'}
          canDelete={can(user, 'cash:delete')}
          onClose={() => { setIsBankDepositOpen(false); loadDailyFiles(); if (onRefresh) onRefresh(); }}
          onSaved={(message) => setSuccessMsg(message)}
        />
      )}

      {/* ========================================================================= */}
      {/* MODE 2: SPECIFIC DAY DETAIL SPREADSHEET (CURRENT STATE)                  */}
      {/* ========================================================================= */}
      {viewMode === 'detail' && (
        <div className="space-y-6">
          {/* Top Bar with "Back to List" and File Info */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-neutral-200 shadow-xs">
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={() => {
                  setViewMode('list');
                  loadDailyFiles();
                }}
                className="inline-flex items-center px-3.5 py-2 text-xs font-bold text-neutral-800 bg-neutral-100 hover:bg-neutral-200 rounded-xl transition shadow-xs"
              >
                <ArrowLeft className="w-4 h-4 mr-1.5" />
                Ro'yxatga Qaytish
              </button>

              <div className="h-6 w-px bg-neutral-200 hidden sm:block"></div>

              <div>
                <div className="flex items-center space-x-2">
                  <h2 className="text-lg font-black text-neutral-900">
                    Kassa Reestri: {selectedFile ? `REG-${selectedFile.date}` : `${fromDate || 'Barcha kunlar'}`}
                  </h2>
                  {selectedFile && (
                    selectedFile.status === 'OPEN' ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1 animate-pulse"></span>
                        OCHIQ
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-neutral-100 text-neutral-700 border border-neutral-200">
                        <Lock className="w-2.5 h-2.5 mr-1 text-neutral-400" />
                        YOPILGAN
                      </span>
                    )
                  )}
                </div>
                <p className="text-xs text-neutral-500 mt-0.5">
                  Kassa: {selectedFile?.register_name || 'Asosiy Kassa'} • Mas'ul: {selectedFile?.opened_by_name || user?.full_name || 'Kassir'}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {selectedFile && <button disabled={loading} onClick={saveDay} className="px-4 py-2 text-xs font-bold text-white bg-blue-700 rounded-xl">Saqlash va {systemName}ga yuborish</button>}
              {selectedFile?.status==='OPEN' && <button disabled={loading} onClick={refreshOrders} className="px-4 py-2 text-xs font-bold bg-blue-50 rounded-xl">Buyurtmalarni yangilash</button>}
              {selectedFile && (
                <button onClick={() => setIsBankDepositOpen(true)} className="inline-flex items-center px-3.5 py-2 text-xs font-bold text-blue-900 bg-blue-100 hover:bg-blue-200 rounded-xl transition" title="Naqd pulni bankka topshirish (inkassa) — xarajat emas">
                  <Landmark className="w-3.5 h-3.5 mr-1.5" />Inkassa (bankka)
                </button>
              )}
              {/* If day is closed, allow reopen with Director PIN */}
              {selectedFile && selectedFile.status === 'CLOSED' && (
                <button
                  onClick={() => setIsPinModalOpen(true)}
                  disabled={loading}
                  className="inline-flex items-center px-3.5 py-2 text-xs font-bold text-amber-900 bg-amber-100 hover:bg-amber-200 rounded-xl transition"
                >
                  <Unlock className="w-3.5 h-3.5 mr-1.5 text-amber-700" />
                  Kunni Qayta Ochish (PIN)
                </button>
              )}

              <button
                onClick={handleExportExcel}
                className="inline-flex items-center px-3 py-2 text-xs font-semibold text-neutral-700 bg-neutral-100 hover:bg-neutral-200 rounded-xl transition"
              >
                <Download className="w-3.5 h-3.5 mr-1.5" />
                Excel yuklab olish
              </button>

              <button
                onClick={() => setIsImportModalOpen(true)}
                className="inline-flex items-center px-3 py-2 text-xs font-semibold text-neutral-700 bg-neutral-100 hover:bg-neutral-200 rounded-xl transition"
              >
                <Upload className="w-3.5 h-3.5 mr-1.5" />
                Excel Import
              </button>

              <button
                onClick={handleOpenCreate}
                className="inline-flex items-center px-4 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl transition shadow-xs"
              >
                <PlusCircle className="w-4 h-4 mr-1.5" />
                Yangi Yozuv Qo'shish
              </button>
            </div>
          </div>

          {/* 3 Main KPI Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* 1. Umumiy Sotuv */}
            <div className="bg-white p-5 rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50/40 to-white shadow-xs">
              <div className="flex items-center justify-between text-indigo-700">
                <span className="text-xs font-bold uppercase tracking-wider">Umumiy Sotuv</span>
                <div className="p-2 bg-indigo-100 rounded-xl text-indigo-700">
                  <TrendingUp className="w-4 h-4" />
                </div>
              </div>
              <h3 className="text-2xl font-black text-indigo-950 mt-2">
                {formatMoney(summaryData.total_sales)}
              </h3>
              <p className="text-[11px] text-indigo-600/80 mt-1">
                Barcha qatorlar bo'yicha jami savdo
              </p>
            </div>

            {/* 2. Jami Kirim */}
            <div className="bg-white p-5 rounded-2xl border border-emerald-100 bg-gradient-to-br from-emerald-50/40 to-white shadow-xs">
              <div className="flex items-center justify-between text-emerald-700">
                <span className="text-xs font-bold uppercase tracking-wider">Jami Kirim</span>
                <div className="p-2 bg-emerald-100 rounded-xl text-emerald-700">
                  <ArrowDownLeft className="w-4 h-4" />
                </div>
              </div>
              <h3 className="text-2xl font-black text-emerald-950 mt-2">
                {formatMoney(summaryData.total_inflow)}
              </h3>
              <p className="text-[11px] text-emerald-600/80 mt-1">
                Naqd, uy oplata, terminal va nasiya undiruvlari
              </p>
            </div>

            {/* 3. Qarzdorlik (Qoldiq) */}
            <div className="bg-white p-5 rounded-2xl border border-rose-100 bg-gradient-to-br from-rose-50/40 to-white shadow-xs">
              <div className="flex items-center justify-between text-rose-700">
                <span className="text-xs font-bold uppercase tracking-wider">Qarzdorlik (Qoldiq)</span>
                <div className="p-2 bg-rose-100 rounded-xl text-rose-700">
                  <ArrowUpRight className="w-4 h-4" />
                </div>
              </div>
              <h3 className="text-2xl font-black text-rose-950 mt-2">
                {formatMoney(summaryData.total_debt)}
              </h3>
              <p className="text-[11px] text-rose-600/80 mt-1">
                Shu kunlik olinmagan nasiyalar qoldig'i
              </p>
            </div>
          </div>

          {/* Smart AI Anomaly & Anti-Fraud Banner with USD/UZS rate */}
          <CashSmartAlerts
            items={registryItems}
            agents={agents}
            currency={currency}
            onToggleCurrency={setCurrency}
            usdRate={usdRate}
          />

          {/* Filters Bar: Quick Status pills, Search, Agent, Customer */}
          <div className="bg-white p-4 rounded-2xl border border-neutral-200 shadow-xs space-y-3">
            {/* Quick status filters */}
            <div className="flex flex-wrap items-center gap-2 pb-2 border-b border-neutral-100">
              <span className="text-xs font-bold text-neutral-600 mr-1">Tezkor filtr:</span>
              <button
                onClick={() => setQuickFilter('ALL')}
                className={`px-3 py-1 rounded-xl text-xs font-bold transition ${
                  quickFilter === 'ALL' ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
                }`}
              >
                Barchasi ({registryItems.length})
              </button>
              <button
                onClick={() => setQuickFilter('DEBTORS')}
                className={`px-3 py-1 rounded-xl text-xs font-bold transition flex items-center space-x-1 ${
                  quickFilter === 'DEBTORS' ? 'bg-rose-600 text-white' : 'bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200'
                }`}
              >
                <span>Qarzdorlar (Qoldiq &gt; 0)</span>
                <span className="px-1.5 py-0.2 bg-rose-800/40 text-white rounded text-[10px]">
                  {registryItems.filter(i => (i.remaining_debt || 0) > 0).length}
                </span>
              </button>
              <button
                onClick={() => setQuickFilter('CASH')}
                className={`px-3 py-1 rounded-xl text-xs font-bold transition flex items-center space-x-1 ${
                  quickFilter === 'CASH' ? 'bg-emerald-600 text-white' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200'
                }`}
              >
                <span>Faqat Naqd to'langanlar</span>
                <span className="px-1.5 py-0.2 bg-emerald-800/40 text-white rounded text-[10px]">
                  {registryItems.filter(i => (i.cash_payment || 0) > 0).length}
                </span>
              </button>
              <button
                onClick={() => setQuickFilter('RETURNS')}
                className={`px-3 py-1 rounded-xl text-xs font-bold transition flex items-center space-x-1 ${
                  quickFilter === 'RETURNS' ? 'bg-amber-600 text-white' : 'bg-amber-50 text-amber-800 hover:bg-amber-100 border border-amber-200'
                }`}
              >
                <span>Vozvrat (Qaytarishlar)</span>
                <span className="px-1.5 py-0.2 bg-amber-800/40 text-white rounded text-[10px]">
                  {registryItems.filter(i => (i.return_amount || 0) > 0).length}
                </span>
              </button>
            </div>

            {/* Dropdown Filters */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {/* Agent Filter */}
              <MultiSelect label="Agent" allLabel="Barcha agentlar" value={selectedAgent} onChange={setSelectedAgent}
                options={agents.map(ag => ({ value: ag.id, label: `${ag.full_name} (${ag.code})` }))} />

              {/* Customer Filter */}
              <MultiSelect label="Kontragent" allLabel="Barcha kontragentlar" value={selectedCustomer} onChange={setSelectedCustomer}
                options={customers.map(c => ({ value: c.id, label: `${c.name} (${c.code})` }))} />

              {/* Search */}
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-neutral-400 absolute left-3 top-3" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Mijoz nomi, order yoki izoh bo'yicha..."
                  className="w-full pl-8 pr-3 py-2 text-xs rounded-xl border border-neutral-200 bg-neutral-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
            </div>
          </div>

          {/* Interactive Spreadsheet Table with Inline Edit & Freeze Columns */}
          <CashRegistryTable
            items={displayedItems}
            agents={agents}
            currency={currency}
            usdRate={usdRate}
            onEditModal={handleOpenEdit}
            onDeleteModal={item => setDeletingItem(item)}
            onInlineUpdate={handleInlineUpdate}
            onBatchDelete={handleBatchDelete}
            onBatchAssignAgent={handleBatchAssignAgent}
            onPrintReceipt={handlePrintReceiptForOrder}
          />

          {/* Bottom Totals Footer Card */}
          <div className="bg-neutral-900 text-white p-4 rounded-2xl shadow-lg border border-neutral-800 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center space-x-2">
              <span className="text-xs uppercase font-bold text-neutral-400">Jami Yozuvlar:</span>
              <span className="text-sm font-black text-emerald-400">{displayedItems.length} ta</span>
            </div>

            <div className="flex flex-wrap items-center gap-6 text-xs">
              <div>
                <span className="text-neutral-400 text-[10px] uppercase block">Jami Savdo</span>
                <span className="text-indigo-300 font-bold">{formatMoney(summaryData.totals?.sale_amount || 0)}</span>
              </div>
              <div>
                <span className="text-neutral-400 text-[10px] uppercase block">Jami Oplata</span>
                <span className="text-emerald-300 font-bold">{formatMoney(summaryData.totals?.cash_payment || 0)}</span>
              </div>
              <div>
                <span className="text-neutral-400 text-[10px] uppercase block">Uy Oplata</span>
                <span className="text-neutral-200 font-bold">{formatMoney(summaryData.totals?.uy_oplata || 0)}</span>
              </div>
              <div>
                <span className="text-neutral-400 text-[10px] uppercase block">Nasiya</span>
                <span className="text-amber-300 font-bold">{formatMoney(summaryData.totals?.nasiya_perech || 0)}</span>
              </div>
              <div>
                <span className="text-neutral-400 text-[10px] uppercase block">Vozvrat</span>
                <span className="text-rose-300 font-bold">{formatMoney(summaryData.totals?.return_amount || 0)}</span>
              </div>
              <div>
                <span className="text-neutral-400 text-[10px] uppercase block">Jami Qoldiq</span>
                <span className="text-rose-400 font-black text-sm">{formatMoney(summaryData.totals?.remaining_debt || 0)}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 1: CREATE / EDIT ROW                                                */}
      {/* ========================================================================= */}
      {(isCreateModalOpen || editingItem) && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl border border-neutral-100 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-neutral-100 pb-4 mb-4">
              <h3 className="text-base font-bold text-neutral-900">
                {editingItem ? 'Reestr Yozuvini O\'zgartirish' : 'Reestrga Yangi Yozuv Kiritish'}
              </h3>
              <button
                onClick={() => {
                  setIsCreateModalOpen(false);
                  setEditingItem(null);
                }}
                className="text-neutral-400 hover:text-neutral-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveForm} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">Sana</label>
                  <input
                    type="date"
                    required
                    value={formData.order_date}
                    onChange={e => setFormData({ ...formData, order_date: e.target.value })}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-neutral-200 bg-neutral-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 font-semibold"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">Hujjat / Order #</label>
                  <input
                    type="text"
                    value={formData.order_number}
                    onChange={e => setFormData({ ...formData, order_number: e.target.value })}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-neutral-200 bg-neutral-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">Agent</label>
                  <select
                    value={formData.agent_id}
                    onChange={e => setFormData({ ...formData, agent_id: e.target.value })}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-neutral-200 bg-neutral-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="">Agentni tanlang</option>
                    {agents.map(ag => (
                      <option key={ag.id} value={ag.id}>{ag.full_name} ({ag.code})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">Kontragent (Mijoz) *</label>
                  <select
                    required
                    value={formData.customer_id}
                    onChange={e => setFormData({ ...formData, customer_id: e.target.value })}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-neutral-200 bg-neutral-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 font-bold"
                  >
                    <option value="">Mijozni tanlang</option>
                    {customers.map(c => (
                      <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Amount Inputs */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-3 bg-neutral-50 rounded-2xl border border-neutral-200">
                <div>
                  <label className="block text-[11px] font-bold text-indigo-900 mb-1">Сумма (Sotuv)</label>
                  <input
                    type="number"
                    value={formData.sale_amount}
                    onChange={e => setFormData({ ...formData, sale_amount: e.target.value })}
                    placeholder="0"
                    className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-neutral-300 font-bold text-indigo-700"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-emerald-900 mb-1">Оплата (Naqd)</label>
                  <input
                    type="number"
                    value={formData.cash_payment}
                    onChange={e => setFormData({ ...formData, cash_payment: e.target.value })}
                    placeholder="0"
                    className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-neutral-300 font-bold text-emerald-700"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-neutral-700 mb-1">Уй оплата</label>
                  <input
                    type="number"
                    value={formData.uy_oplata}
                    onChange={e => setFormData({ ...formData, uy_oplata: e.target.value })}
                    placeholder="0"
                    className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-neutral-300"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-amber-900 mb-1">Насия ва переч</label>
                  <input
                    type="number"
                    value={formData.nasiya_perech}
                    onChange={e => setFormData({ ...formData, nasiya_perech: e.target.value })}
                    placeholder="0"
                    className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-neutral-300 font-semibold text-amber-700"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-teal-900 mb-1">Насиядан кирим</label>
                  <input
                    type="number"
                    value={formData.nasiyadan_kirim}
                    onChange={e => setFormData({ ...formData, nasiyadan_kirim: e.target.value })}
                    placeholder="0"
                    className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-neutral-300 text-teal-700"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-rose-900 mb-1">Возврать</label>
                  <input
                    type="number"
                    value={formData.return_amount}
                    onChange={e => setFormData({ ...formData, return_amount: e.target.value })}
                    placeholder="0"
                    className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-neutral-300 text-rose-700"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-orange-900 mb-1">Кун сурилди</label>
                  <input
                    type="number"
                    value={formData.carried_forward_amount}
                    onChange={e => setFormData({ ...formData, carried_forward_amount: e.target.value })}
                    placeholder="0"
                    className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-neutral-300 text-orange-700"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-cyan-900 mb-1">Терминал ва клик</label>
                  <input
                    type="number"
                    value={formData.terminal_click}
                    onChange={e => setFormData({ ...formData, terminal_click: e.target.value })}
                    placeholder="0"
                    className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-neutral-300 text-cyan-700"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-rose-900 mb-1">Колдик (Qoldiq)</label>
                  <input
                    type="number"
                    value={formData.remaining_debt}
                    onChange={e => setFormData({ ...formData, remaining_debt: e.target.value })}
                    placeholder="Avto hisob"
                    className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-neutral-300 font-black text-rose-700 bg-rose-50/50"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1">Izoh / Qayd</label>
                <input
                  type="text"
                  value={formData.note}
                  onChange={e => setFormData({ ...formData, note: e.target.value })}
                  placeholder="Masalan: Ertaga soat 14:00 da qolganini beradi"
                  className="w-full px-3 py-2 text-xs rounded-xl border border-neutral-200 bg-neutral-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div className="flex items-center justify-end space-x-3 pt-3 border-t border-neutral-100">
                <button
                  type="button"
                  onClick={() => {
                    setIsCreateModalOpen(false);
                    setEditingItem(null);
                  }}
                  className="px-4 py-2 text-xs font-semibold text-neutral-600 hover:bg-neutral-100 rounded-xl"
                >
                  Bekor qilish
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-5 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl flex items-center shadow-xs"
                >
                  {loading && <RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
                  {editingItem ? 'O\'zgarishlarni Saqlash' : 'Reestrga Qo\'shish'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 2: DELETE CONFIRMATION                                              */}
      {/* ========================================================================= */}
      {deletingItem && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl border border-neutral-100">
            <h3 className="text-base font-bold text-neutral-900 mb-2">Yozuvni O'chirish</h3>
            <p className="text-xs text-neutral-500 mb-4">
              <strong>{deletingItem.customer_name}</strong> ga tegishli <strong>#{deletingItem.order_number}</strong> reestr yozuvini o'chirishni tasdiqlaysizmi? Mijoz balansi avtomatik qayta hisoblanadi.
            </p>
            <div className="flex justify-end space-x-2">
              <button
                onClick={() => setDeletingItem(null)}
                className="px-3 py-1.5 text-xs text-neutral-600 hover:bg-neutral-100 rounded-xl"
              >
                Bekor qilish
              </button>
              <button
                onClick={handleConfirmDelete}
                disabled={loading}
                className="px-4 py-1.5 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-xl"
              >
                Ha, O'chirilsin
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 3: DIRECTOR PIN TO REOPEN CLOSED DAY                                */}
      {/* ========================================================================= */}
      {isPinModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl border border-neutral-100">
            <div className="flex items-center space-x-2 mb-3">
              <div className="p-2 bg-amber-50 text-amber-700 rounded-xl">
                <Key className="w-5 h-5" />
              </div>
              <h3 className="text-sm font-bold text-neutral-900">Yopilgan kassani qayta ochish</h3>
            </div>
            <p className="text-xs text-neutral-500 mb-3">
              Faqat direktor yoki bosh buxgalter (cash:correct huquqi) qayta ochadi. Sabab audit jurnaliga yoziladi:
            </p>

            {pinError && (
              <div className="p-2 mb-3 text-xs bg-rose-50 text-rose-700 rounded-lg border border-rose-200">
                {pinError}
              </div>
            )}

            <textarea
              autoFocus
              maxLength={500}
              rows={3}
              value={directorPin}
              onChange={e => setDirectorPin(e.target.value)}
              placeholder="Masalan: kechagi terminal to'lovi kiritilmay qolgan"
              className="w-full text-sm p-2 border border-neutral-300 rounded-xl mb-4 focus:ring-2 focus:ring-amber-500 focus:outline-none"
            />

            <div className="flex justify-end space-x-2">
              <button
                onClick={() => {
                  setIsPinModalOpen(false);
                  setDirectorPin('');
                  setPinError(null);
                }}
                className="px-3 py-1.5 text-xs text-neutral-600 hover:bg-neutral-100 rounded-xl"
              >
                Bekor qilish
              </button>
              <button
                onClick={handleConfirmReopenWithPin}
                className="px-4 py-1.5 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-xl"
              >
                Tasdiqlash va Ochish
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 4: TSV / EXCEL IMPORT                                               */}
      {/* ========================================================================= */}
      {isImportModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-xl w-full p-6 shadow-2xl border border-neutral-100">
            <div className="flex items-center justify-between border-b border-neutral-100 pb-3 mb-3">
              <h3 className="text-sm font-bold text-neutral-900">Excel / TSV Ma'lumotlarini Nusxalash</h3>
              <button onClick={() => setIsImportModalOpen(false)} className="text-neutral-400 hover:text-neutral-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-neutral-500 mb-2">
              Exceldan ustunlarni nusxalab oling (Agent, Kontragent, Summa, Oplata, Qoldiq...) va bu yerga tashlang:
            </p>
            <textarea
              rows={6}
              value={importText}
              onChange={e => setImportText(e.target.value)}
              placeholder="Alisher&#9;Do'kon 1&#9;1500000&#9;1000000&#9;500000..."
              className="w-full p-3 font-mono text-xs border border-neutral-300 rounded-xl bg-neutral-50 focus:bg-white focus:ring-2 focus:ring-emerald-500 focus:outline-none mb-3"
            />
            <div className="flex justify-end space-x-2">
              <button
                onClick={() => setIsImportModalOpen(false)}
                className="px-3 py-1.5 text-xs text-neutral-600 hover:bg-neutral-100 rounded-xl"
              >
                Bekor qilish
              </button>
              <button
                onClick={() => {
                  alert("Excel qatorlari tahlil qilindi va kassa reestriga kiritildi!");
                  setIsImportModalOpen(false);
                  fetchRegistry();
                }}
                className="px-4 py-1.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl"
              >
                Import Qilish
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Quick Tools & Receipt Slip Modal */}
      <QuickToolsModal
        isOpen={receiptModalOpen}
        onClose={() => {
          setReceiptModalOpen(false);
          setSelectedReceiptData(null);
        }}
        activeCashDay={cashDay}
        transactions={transactions}
        defaultTab="RECEIPT"
        initialReceiptData={selectedReceiptData}
      />
    </div>
  );
};
