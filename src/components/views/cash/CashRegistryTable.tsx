import React, { useState } from 'react';
import { 
  Edit3, 
  Trash2, 
  Check, 
  ChevronDown, 
  ChevronRight, 
  UserCheck, 
  Layers, 
  FileSpreadsheet, 
  CheckSquare, 
  Square,
  Sparkles,
  Smartphone,
  Minimize2,
  Maximize2,
  Receipt
} from 'lucide-react';
import { DailyOrderEntry, Agent } from '../../../types.ts';

interface CashRegistryTableProps {
  items: DailyOrderEntry[];
  agents: Agent[];
  currency: 'UZS' | 'USD';
  usdRate: number;
  onEditModal: (item: DailyOrderEntry) => void;
  onDeleteModal: (item: DailyOrderEntry) => void;
  onInlineUpdate: (id: string, field: string, value: number) => Promise<void>;
  onBatchDelete: (ids: string[]) => Promise<void>;
  onBatchAssignAgent: (ids: string[], agentId: string) => Promise<void>;
  onPrintReceipt?: (item: DailyOrderEntry) => void;
}

export const CashRegistryTable: React.FC<CashRegistryTableProps> = ({
  items,
  agents,
  currency,
  usdRate,
  onEditModal,
  onDeleteModal,
  onInlineUpdate,
  onBatchDelete,
  onBatchAssignAgent,
  onPrintReceipt
}) => {
  // Density: 'compact' (25-30 rows) vs 'normal'
  const [density, setDensity] = useState<'compact' | 'normal'>('normal');

  // Display Mode: 'table' | 'grouped' | 'cards'
  const [displayMode, setDisplayMode] = useState<'table' | 'grouped' | 'cards'>('table');

  // Expanded agents for Grouped mode
  const [expandedAgents, setExpandedAgents] = useState<Record<string, boolean>>({});

  // Inline Cell Editing State
  const [editingCell, setEditingCell] = useState<{ id: string; field: string; value: string } | null>(null);
  const [inlineSaving, setInlineSaving] = useState(false);

  // Multi-select Checkboxes
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchAgentModal, setBatchAgentModal] = useState(false);
  const [targetBatchAgentId, setTargetBatchAgentId] = useState('');

  const formatAmount = (val?: number) => {
    const num = val || 0;
    if (currency === 'USD' && usdRate > 0) {
      return `$${Math.round(num / usdRate).toLocaleString()}`;
    }
    return num.toLocaleString();
  };

  // Toggle selection
  const handleToggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const handleSelectAll = () => {
    if (selectedIds.size === items.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(items.map(i => i.id)));
    }
  };

  // Commit inline edit
  const handleCommitInline = async () => {
    if (!editingCell) return;
    const numVal = Number(editingCell.value.replace(/\s/g, '')) || 0;
    setInlineSaving(true);
    try {
      await onInlineUpdate(editingCell.id, editingCell.field, numVal);
      setEditingCell(null);
    } catch (e) {
      console.error(e);
    } finally {
      setInlineSaving(false);
    }
  };

  // Group items by Agent for 'grouped' mode
  const agentGroups = React.useMemo(() => {
    const map = new Map<string, { agentName: string; agentId: string; items: DailyOrderEntry[]; totalSales: number; totalCash: number; totalDebt: number }>();
    for (const it of items) {
      const agId = it.agent_id || 'unassigned';
      const agName = it.agent_name || 'Umumiy / Biriktirilmagan';
      const grp = map.get(agId) || { agentName: agName, agentId: agId, items: [], totalSales: 0, totalCash: 0, totalDebt: 0 };
      grp.items.push(it);
      grp.totalSales += it.sale_amount || 0;
      grp.totalCash += (it.cash_payment || 0);
      grp.totalDebt += it.remaining_debt || 0;
      map.set(agId, grp);
    }
    return Array.from(map.values());
  }, [items]);

  // Styling helper based on density
  const cellPadding = density === 'compact' ? 'py-1.5 px-2 text-[11px]' : 'py-2.5 px-3 text-xs';

  return (
    <div className="space-y-3">
      {/* Control Bar: View Switcher, Density Toggle, Batch indicator */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-neutral-50 p-2.5 rounded-xl border border-neutral-200 text-xs">
        <div className="flex items-center space-x-1.5">
          <span className="text-[11px] font-bold text-neutral-600 uppercase mr-1">Ko'rinish:</span>
          <button
            onClick={() => setDisplayMode('table')}
            className={`px-3 py-1 rounded-lg font-bold transition flex items-center space-x-1 ${
              displayMode === 'table' ? 'bg-emerald-600 text-white shadow-xs' : 'bg-white text-neutral-700 hover:bg-neutral-100 border border-neutral-200'
            }`}
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>Excel Jadval</span>
          </button>
          <button
            onClick={() => setDisplayMode('grouped')}
            className={`px-3 py-1 rounded-lg font-bold transition flex items-center space-x-1 ${
              displayMode === 'grouped' ? 'bg-indigo-600 text-white shadow-xs' : 'bg-white text-neutral-700 hover:bg-neutral-100 border border-neutral-200'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Agentlar bo'yicha</span>
          </button>
          <button
            onClick={() => setDisplayMode('cards')}
            className={`px-3 py-1 rounded-lg font-bold transition flex items-center space-x-1 ${
              displayMode === 'cards' ? 'bg-neutral-900 text-white shadow-xs' : 'bg-white text-neutral-700 hover:bg-neutral-100 border border-neutral-200'
            }`}
          >
            <Smartphone className="w-3.5 h-3.5" />
            <span>Mobil Kartochkalar</span>
          </button>
        </div>

        <div className="flex items-center space-x-2">
          {/* Density toggle */}
          <button
            onClick={() => setDensity(d => d === 'compact' ? 'normal' : 'compact')}
            className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-white border border-neutral-200 text-neutral-700 hover:bg-neutral-100 font-semibold"
            title="Qatorlar zichligini o'zgartirish (ekranga ko'proq yozuv sig'dirish)"
          >
            {density === 'compact' ? (
              <>
                <Maximize2 className="w-3 h-3 text-indigo-600" />
                <span>Standart ko'rinish</span>
              </>
            ) : (
              <>
                <Minimize2 className="w-3 h-3 text-emerald-600" />
                <span>Kompakt (25+ qator)</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Floating Batch Actions Bar */}
      {selectedIds.size > 0 && (
        <div className="p-3 bg-indigo-900 text-white rounded-xl shadow-lg border border-indigo-700 flex flex-wrap items-center justify-between gap-3 animate-in fade-in duration-200">
          <div className="flex items-center space-x-2">
            <CheckSquare className="w-4 h-4 text-emerald-400" />
            <span className="text-xs font-bold">{selectedIds.size} ta qator belgilandi</span>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setBatchAgentModal(true)}
              className="px-3 py-1 text-xs font-semibold bg-indigo-700 hover:bg-indigo-600 rounded-lg transition"
            >
              Agent biriktirish
            </button>
            <button
              onClick={async () => {
                if (window.confirm(`${selectedIds.size} ta tanlangan yozuvni o'chirishni tasdiqlaysizmi?`)) {
                  await onBatchDelete(Array.from(selectedIds));
                  setSelectedIds(new Set());
                }
              }}
              className="px-3 py-1 text-xs font-semibold bg-rose-600 hover:bg-rose-700 rounded-lg transition"
            >
              Ommaviy O'chirish
            </button>
            <button
              onClick={() => setSelectedIds(new Set())}
              className="px-2 py-1 text-xs text-neutral-300 hover:text-white"
            >
              ✕ Bekor qilish
            </button>
          </div>
        </div>
      )}

      {/* Batch Assign Modal */}
      {batchAgentModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-5 shadow-2xl border border-neutral-100">
            <h3 className="text-sm font-bold text-neutral-900 mb-2">Agentni Ommaviy Biriktirish</h3>
            <p className="text-xs text-neutral-500 mb-4">
              Tanlangan {selectedIds.size} ta buyurtmaga mas'ul agentni tanlang:
            </p>
            <select
              value={targetBatchAgentId}
              onChange={e => setTargetBatchAgentId(e.target.value)}
              className="w-full p-2 text-xs rounded-xl border border-neutral-200 mb-4"
            >
              <option value="">Agentni tanlang</option>
              {agents.map(ag => (
                <option key={ag.id} value={ag.id}>{ag.full_name} ({ag.code})</option>
              ))}
            </select>
            <div className="flex justify-end space-x-2">
              <button
                onClick={() => setBatchAgentModal(false)}
                className="px-3 py-1.5 text-xs text-neutral-600 hover:bg-neutral-100 rounded-lg"
              >
                Bekor qilish
              </button>
              <button
                onClick={async () => {
                  if (targetBatchAgentId) {
                    await onBatchAssignAgent(Array.from(selectedIds), targetBatchAgentId);
                    setBatchAgentModal(false);
                    setSelectedIds(new Set());
                  }
                }}
                disabled={!targetBatchAgentId}
                className="px-4 py-1.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg"
              >
                Biriktirish
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 1. TABLE VIEW WITH INLINE EDITING & STICKY FROZEN COLUMNS                  */}
      {/* ========================================================================= */}
      {displayMode === 'table' && (
        <div className="bg-white rounded-2xl border border-neutral-200 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-neutral-800 text-white font-semibold divide-x divide-neutral-700">
                  {/* Sticky Checkbox */}
                  <th className="py-3 px-2 w-9 text-center sticky left-0 bg-neutral-800 z-30 shadow-[1px_0_0_0_#374151]">
                    <input
                      type="checkbox"
                      checked={items.length > 0 && selectedIds.size === items.length}
                      onChange={handleSelectAll}
                      className="rounded text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                    />
                  </th>

                  {/* Sticky 1: Agent */}
                  <th className="py-3 px-3 min-w-[130px] sticky left-[36px] bg-neutral-800 z-30 shadow-[1px_0_0_0_#374151]">
                    Агент
                  </th>

                  {/* Sticky 2: Kontragent */}
                  <th className="py-3 px-3 min-w-[160px] sticky left-[166px] bg-neutral-800 z-30 shadow-[3px_0_6px_-2px_rgba(0,0,0,0.4)]">
                    Контрагент
                  </th>

                  {/* Other 8 columns */}
                  <th className="py-3 px-3 text-right min-w-[105px] bg-indigo-950/70">Сумма (Sotuv)</th>
                  <th className="py-3 px-3 text-right min-w-[100px] bg-emerald-950/70">Оплата</th>
                  <th className="py-3 px-3 text-right min-w-[110px] bg-amber-950/60">Насия ва переч</th>
                  <th className="py-3 px-3 text-right min-w-[105px]">Насиядан кирим</th>
                  <th className="py-3 px-3 text-right min-w-[90px]">Возврать</th>
                  <th className="py-3 px-3 text-right min-w-[95px]">Кун сурилди</th>
                  <th className="py-3 px-3 text-right min-w-[110px]">Терминал ва клик</th>
                  <th className="py-3 px-3 text-right min-w-[110px] bg-rose-950/70">Колдик</th>
                  <th className="py-3 px-3 text-center min-w-[80px]">Амаллар</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-neutral-100 font-medium text-neutral-800">
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="py-12 text-center text-neutral-400">
                      Ushbu sanada reestr yozuvlari topilmadi.
                    </td>
                  </tr>
                ) : (
                  items.map(item => {
                    const isSelected = selectedIds.has(item.id);

                    // Render inline editable cell
                    const renderEditableCell = (field: keyof DailyOrderEntry, defaultVal: number, bgClass = '', textClass = '') => {
                      const isEditing = editingCell?.id === item.id && editingCell?.field === field;

                      if (isEditing) {
                        return (
                          <td className={`${cellPadding} text-right bg-amber-50 p-1`}>
                            <input
                              type="number"
                              autoFocus
                              value={editingCell.value}
                              onChange={e => setEditingCell({ ...editingCell, value: e.target.value })}
                              onBlur={handleCommitInline}
                              onKeyDown={e => {
                                if (e.key === 'Enter') handleCommitInline();
                                if (e.key === 'Escape') setEditingCell(null);
                              }}
                              className="w-full text-right px-1.5 py-0.5 rounded border border-amber-400 bg-white text-xs font-bold text-neutral-900 focus:outline-none ring-2 ring-amber-300"
                            />
                          </td>
                        );
                      }

                      return (
                        <td
                          onClick={() => setEditingCell({ id: item.id, field: field as string, value: String(defaultVal || '') })}
                          className={`${cellPadding} text-right cursor-pointer hover:ring-1 hover:ring-indigo-300 hover:bg-indigo-50/40 transition ${bgClass} ${textClass}`}
                          title="Tahrirlash uchun bosing"
                        >
                          {formatAmount(defaultVal)}
                        </td>
                      );
                    };

                    return (
                      <tr
                        key={item.id}
                        className={`hover:bg-neutral-50 transition divide-x divide-neutral-100 ${
                          isSelected ? 'bg-indigo-50/50' : ''
                        }`}
                      >
                        {/* Sticky Checkbox */}
                        <td className={`${cellPadding} text-center sticky left-0 bg-white z-20 shadow-[1px_0_0_0_#e5e7eb]`}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => handleToggleSelect(item.id)}
                            className="rounded text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                          />
                        </td>

                        {/* Sticky Agent */}
                        <td className={`${cellPadding} sticky left-[36px] bg-white z-20 shadow-[1px_0_0_0_#e5e7eb]`}>
                          <div className="font-semibold text-neutral-900 truncate max-w-[130px]">{item.agent_name || 'Umumiy'}</div>
                          <div className="text-[10px] text-neutral-400">{item.order_date} | #{item.order_number}</div>
                        </td>

                        {/* Sticky Kontragent */}
                        <td className={`${cellPadding} sticky left-[166px] bg-white z-20 shadow-[3px_0_6px_-2px_rgba(0,0,0,0.12)]`}>
                          <div className="font-bold text-neutral-900 truncate max-w-[160px]">{item.customer_name}</div>
                          {item.note && <div className="text-[10px] text-neutral-400 italic truncate max-w-[160px]">{item.note}</div>}
                        </td>

                        {/* 1. Summa */}
                        {renderEditableCell('sale_amount', item.sale_amount || 0, 'bg-indigo-50/20', 'font-bold text-indigo-700')}

                        {/* 2. Oplata */}
                        {renderEditableCell('cash_payment', item.cash_payment || 0, 'bg-emerald-50/20', 'font-semibold text-emerald-700')}

                        {/* 3. Nasiya va perech */}
                        {renderEditableCell('nasiya_perech', item.nasiya_perech || 0, 'bg-amber-50/20', 'font-medium text-amber-700')}

                        {/* 5. Nasiyadan kirim */}
                        {renderEditableCell('nasiyadan_kirim', item.nasiyadan_kirim || 0, '', 'font-medium text-teal-700')}

                        {/* 6. Возврать */}
                        {renderEditableCell('return_amount', item.return_amount || 0, '', 'text-rose-600')}

                        {/* 7. Кун сурилди */}
                        {renderEditableCell('carried_forward_amount', item.carried_forward_amount || 0, '', 'text-orange-600')}

                        {/* 8. Терминал ва клик */}
                        {renderEditableCell('terminal_click', item.terminal_click || 0, '', 'font-medium text-cyan-700')}

                        {/* 9. Колдик */}
                        <td className={`${cellPadding} text-right font-black text-rose-700 bg-rose-50/30`}>
                          {formatAmount(item.remaining_debt)}
                        </td>

                        {/* Actions */}
                        <td className={`${cellPadding} text-center`}>
                          <div className="flex items-center justify-center space-x-1">
                            {onPrintReceipt && (
                              <button
                                onClick={() => onPrintReceipt(item)}
                                className="p-1 text-neutral-400 hover:text-emerald-600 hover:bg-emerald-50 rounded"
                                title="Tezkor chek / kvitansiya chiqarish"
                              >
                                <Receipt className="w-3.5 h-3.5" />
                              </button>
                            )}
                            <button
                              onClick={() => onEditModal(item)}
                              className="p-1 text-neutral-400 hover:text-indigo-600 hover:bg-neutral-100 rounded"
                              title="To'liq tahrirlash oynasi"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => onDeleteModal(item)}
                              className="p-1 text-neutral-400 hover:text-rose-600 hover:bg-neutral-100 rounded"
                              title="O'chirish"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 2. GROUPED BY AGENT VIEW (Accordion Mode)                                 */}
      {/* ========================================================================= */}
      {displayMode === 'grouped' && (
        <div className="space-y-3">
          {agentGroups.map(grp => {
            const isExpanded = !!expandedAgents[grp.agentId];

            return (
              <div key={grp.agentId} className="bg-white rounded-2xl border border-neutral-200 overflow-hidden shadow-xs">
                <div
                  onClick={() => setExpandedAgents(prev => ({ ...prev, [grp.agentId]: !prev[grp.agentId] }))}
                  className="p-4 bg-gradient-to-r from-neutral-50 to-white flex items-center justify-between cursor-pointer hover:bg-neutral-100/60 transition border-b border-neutral-100"
                >
                  <div className="flex items-center space-x-3">
                    <div className="p-2 bg-indigo-50 text-indigo-700 rounded-xl">
                      {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </div>
                    <div>
                      <h4 className="font-bold text-neutral-900 text-sm">{grp.agentName}</h4>
                      <p className="text-[11px] text-neutral-500">{grp.items.length} ta do'kon / zakaz</p>
                    </div>
                  </div>

                  <div className="flex items-center space-x-6 text-xs">
                    <div className="text-right">
                      <span className="text-[10px] text-neutral-400 uppercase font-bold block">Sotuv</span>
                      <span className="font-black text-indigo-700">{formatAmount(grp.totalSales)}</span>
                    </div>
                    <div className="text-right">
                      <span className="text-[10px] text-neutral-400 uppercase font-bold block">Kirim</span>
                      <span className="font-black text-emerald-700">{formatAmount(grp.totalCash)}</span>
                    </div>
                    <div className="text-right">
                      <span className="text-[10px] text-neutral-400 uppercase font-bold block">Qarz</span>
                      <span className="font-black text-rose-700">{formatAmount(grp.totalDebt)}</span>
                    </div>
                  </div>
                </div>

                {isExpanded && (
                  <div className="p-3 bg-neutral-50/50">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                      {grp.items.map(order => (
                        <div key={order.id} className="p-3 bg-white rounded-xl border border-neutral-200 shadow-xs flex flex-col justify-between space-y-2">
                          <div>
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-neutral-900 text-xs truncate">{order.customer_name}</span>
                              <span className="text-[10px] font-mono text-neutral-400">#{order.order_number}</span>
                            </div>
                            <div className="mt-2 grid grid-cols-3 gap-1 text-[11px]">
                              <div>
                                <span className="text-[9px] text-neutral-400 block uppercase">Sotuv</span>
                                <span className="font-bold text-indigo-700">{formatAmount(order.sale_amount)}</span>
                              </div>
                              <div>
                                <span className="text-[9px] text-neutral-400 block uppercase">To'lov</span>
                                <span className="font-bold text-emerald-700">{formatAmount(order.cash_payment)}</span>
                              </div>
                              <div>
                                <span className="text-[9px] text-neutral-400 block uppercase">Qoldiq</span>
                                <span className="font-bold text-rose-700">{formatAmount(order.remaining_debt)}</span>
                              </div>
                            </div>
                          </div>

                          <div className="pt-2 border-t border-neutral-100 flex items-center justify-end space-x-1.5">
                            {onPrintReceipt && (
                              <button
                                onClick={() => onPrintReceipt(order)}
                                className="px-2 py-1 text-[11px] font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 rounded-lg flex items-center space-x-1"
                                title="Chek chiqarish"
                              >
                                <Receipt className="w-3 h-3 text-emerald-600" />
                                <span>Chek</span>
                              </button>
                            )}
                            <button
                              onClick={() => onEditModal(order)}
                              className="px-2 py-1 text-[11px] font-semibold text-neutral-700 bg-neutral-100 hover:bg-neutral-200 rounded-lg"
                            >
                              Tahrirlash
                            </button>
                            <button
                              onClick={() => onDeleteModal(order)}
                              className="p-1 text-rose-500 hover:text-rose-700"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ========================================================================= */}
      {/* 3. MOBILE TOUCH-FRIENDLY CARD VIEW                                        */}
      {/* ========================================================================= */}
      {displayMode === 'cards' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {items.map(item => (
            <div key={item.id} className="bg-white p-4 rounded-2xl border border-neutral-200 shadow-xs space-y-3">
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-[10px] font-mono text-neutral-400">#{item.order_number}</span>
                  <h4 className="font-bold text-neutral-900 text-sm">{item.customer_name}</h4>
                  <p className="text-xs text-neutral-500">{item.agent_name || 'Umumiy'}</p>
                </div>
                <div className="text-right">
                  <span className="text-xs font-black text-indigo-700 block">{formatAmount(item.sale_amount)}</span>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                    (item.remaining_debt || 0) > 0 ? 'bg-rose-100 text-rose-800' : 'bg-emerald-100 text-emerald-800'
                  }`}>
                    {(item.remaining_debt || 0) > 0 ? `Qarz: ${formatAmount(item.remaining_debt)}` : "To'liq to'langan"}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-1.5 p-2 bg-neutral-50 rounded-xl text-center text-[10px]">
                <div>
                  <span className="text-neutral-400 block">Оплата</span>
                  <span className="font-bold text-emerald-700">{formatAmount(item.cash_payment)}</span>
                </div>
                <div>
                  <span className="text-neutral-400 block">Насия</span>
                  <span className="font-bold text-amber-700">{formatAmount(item.nasiya_perech)}</span>
                </div>
                <div>
                  <span className="text-neutral-400 block">Терминал</span>
                  <span className="font-bold text-cyan-700">{formatAmount(item.terminal_click)}</span>
                </div>
              </div>

              <div className="flex items-center justify-end space-x-2 pt-1 border-t border-neutral-100">
                {onPrintReceipt && (
                  <button
                    onClick={() => onPrintReceipt(item)}
                    className="flex items-center space-x-1 px-3 py-1.5 text-xs font-semibold bg-emerald-50 hover:bg-emerald-100 text-emerald-800 rounded-xl"
                  >
                    <Receipt className="w-3.5 h-3.5" />
                    <span>Chek</span>
                  </button>
                )}
                <button
                  onClick={() => onEditModal(item)}
                  className="px-3 py-1.5 text-xs font-semibold bg-neutral-100 hover:bg-neutral-200 text-neutral-700 rounded-xl"
                >
                  Tahrirlash
                </button>
                <button
                  onClick={() => onDeleteModal(item)}
                  className="px-3 py-1.5 text-xs font-semibold bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-xl"
                >
                  O'chirish
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
