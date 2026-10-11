import React, { useState, useEffect } from 'react';
import { 
  ShieldAlert, 
  Search, 
  Filter, 
  Clock, 
  User, 
  FileText, 
  Lock,
  ChevronDown,
  RefreshCw,
  Eye
} from 'lucide-react';
import { AuditLog } from '../../types.ts';
import { api } from '../../services/api.ts';
import { TableToolbar, matchesSearch, inDateRange, exportTableXlsx, isPicked, picked, pickedLabels } from '../common/TableToolbar.tsx';

export const AuditView: React.FC = () => {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedEntity, setSelectedEntity] = useState<string>('');
  const [selectedAction, setSelectedAction] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const res = await api.getAuditLogs({
        // One value is filtered by the server; several are filtered here.
        entity: picked(selectedEntity).length === 1 ? selectedEntity : undefined,
        action: picked(selectedAction).length === 1 ? selectedAction : undefined,
        limit: 1000
      });
      setLogs(res.logs || []);
    } catch (err) {
      console.error('Failed to load audit logs:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, [selectedEntity, selectedAction]);

  const [selectedUser, setSelectedUser] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const users = Array.from(new Set(logs.map(l => l.user_email).filter(Boolean))).sort() as string[];

  const filteredLogs = logs.filter(l =>
    matchesSearch(l, searchQuery, ['user_email', 'entity', 'reason', 'entity_id']) &&
    isPicked(selectedUser, l.user_email) && isPicked(selectedAction, l.action) && isPicked(selectedEntity, l.entity) &&
    inDateRange(l.timestamp, dateFrom, dateTo)
  );

  const exportLogs = () => exportTableXlsx({
    fileName: 'Audit_jurnali',
    title: 'Audit jurnali',
    columns: [
      { header: 'Vaqt', key: 'time', width: 20 },
      { header: 'Foydalanuvchi', key: 'user_email', width: 28 },
      { header: 'Amal', key: 'action', width: 10 },
      { header: 'Obyekt', key: 'entity', width: 18 },
      { header: 'Obyekt ID', key: 'entity_id', width: 24 },
      { header: 'Sabab', key: 'reason', width: 48 }
    ],
    rows: filteredLogs.map(l => ({ ...l, time: new Date(l.timestamp).toLocaleString('ru-RU') })),
    filters: [
      selectedAction && `amal: ${pickedLabels(selectedAction)}`,
      selectedEntity && `obyekt: ${pickedLabels(selectedEntity)}`,
      selectedUser && `foydalanuvchi: ${pickedLabels(selectedUser)}`,
      searchQuery && `qidiruv: "${searchQuery}"`,
      (dateFrom || dateTo) && `davr: ${dateFrom || '…'} — ${dateTo || '…'}`
    ]
  });

  return (
    <div className="space-y-6">
      {/* Header Info */}
      <div className="flex flex-col justify-between gap-4 rounded-xl border border-neutral-200 bg-white p-5 shadow-2xs sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-emerald-600" />
            <h2 className="text-base font-semibold text-neutral-900">Tizim Audit va Xavfsizlik Jurnali</h2>
          </div>
          <p className="mt-1 text-xs text-neutral-500">
            Har bir kassa ochish, yopish, tranzaksiya, RBAC o'zgarishi va sinxronizatsiya yozuvlari o'zgarmas (immutable) holda saqlanadi.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-xs text-neutral-600">
            <Lock className="h-3.5 w-3.5 text-neutral-400" />
            <span>O'chirish taqiqlangan (WORM)</span>
          </div>

          <button
            onClick={fetchLogs}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin text-emerald-600' : ''}`} />
            <span>Yangilash</span>
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <TableToolbar
        search={searchQuery}
        onSearch={setSearchQuery}
        searchPlaceholder="Foydalanuvchi, obyekt yoki sabab…"
        selects={[
          { label: 'Amal', value: selectedAction, onChange: setSelectedAction, allLabel: 'Barcha amallar', options: ['CREATE', 'UPDATE', 'DELETE', 'CLOSE', 'LOGIN', 'SYNC'].map(a => ({ value: a, label: a })) },
          { label: 'Obyekt', value: selectedEntity, onChange: setSelectedEntity, allLabel: 'Barcha obyektlar', options: ['CashDay', 'CashTransaction', 'UserRole', 'Integration', 'User'].map(e => ({ value: e, label: e })) },
          { label: 'Foydalanuvchi', value: selectedUser, onChange: setSelectedUser, allLabel: 'Barcha foydalanuvchilar', options: users.map(u => ({ value: u, label: u })) }
        ]}
        dateFrom={dateFrom}
        dateTo={dateTo}
        onDateFrom={setDateFrom}
        onDateTo={setDateTo}
        count={filteredLogs.length}
        onReset={() => { setSearchQuery(''); setSelectedAction(''); setSelectedEntity(''); setSelectedUser(''); setDateFrom(''); setDateTo(''); }}
        onExport={exportLogs}
      />

      {/* Logs Table */}
      <div className="rounded-xl border border-neutral-200 bg-white shadow-2xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-neutral-100 bg-neutral-50 text-[11px] font-semibold text-neutral-600">
              <tr>
                <th className="px-4 py-3">Vaqt</th>
                <th className="px-4 py-3">Foydalanuvchi</th>
                <th className="px-4 py-3">Amal (Action)</th>
                <th className="px-4 py-3">Entity</th>
                <th className="px-4 py-3">Entity ID</th>
                <th className="px-4 py-3">Sabab (Reason)</th>
                <th className="px-4 py-3 text-right">Tafsilot</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-neutral-400">
                    {loading ? 'Audit jurnali yuklanmoqda...' : 'Audit yozuvlari topilmadi.'}
                  </td>
                </tr>
              ) : (
                filteredLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-neutral-50/70">
                    <td className="px-4 py-3 font-mono text-[11px] text-neutral-500 whitespace-nowrap">
                      {new Date(log.timestamp).toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <User className="h-3.5 w-3.5 text-neutral-400" />
                        <span className="font-medium text-neutral-800">{log.user_email}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                        log.action === 'CREATE' ? 'bg-emerald-50 text-emerald-700' :
                        log.action === 'CLOSE' ? 'bg-amber-50 text-amber-700' :
                        log.action === 'LOGIN' ? 'bg-blue-50 text-blue-700' :
                        log.action === 'SYNC' ? 'bg-purple-50 text-purple-700' :
                        'bg-neutral-100 text-neutral-700'
                      }`}>
                        {log.action}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium text-neutral-900">{log.entity}</td>
                    <td className="px-4 py-3 font-mono text-[11px] text-neutral-500 max-w-[120px] truncate">{log.entity_id}</td>
                    <td className="px-4 py-3 text-neutral-700 max-w-xs truncate">
                      {log.reason || <span className="text-neutral-400">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => setSelectedLog(log)}
                        className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-900"
                        title="To'liq o'zgarish JSON tafsilotlarini ko'rish"
                      >
                        <Eye className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Details Modal */}
      {selectedLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-neutral-200 bg-white p-6 shadow-xl max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-neutral-100 pb-3">
              <div>
                <h3 className="text-sm font-semibold text-neutral-900">Audit Yozuvi Tafsiloti</h3>
                <p className="text-xs text-neutral-500 font-mono">{selectedLog.id}</p>
              </div>
              <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs font-semibold">
                {selectedLog.action}
              </span>
            </div>

            <div className="mt-4 space-y-3 text-xs">
              <div>
                <span className="text-neutral-500 font-medium">Bajaruvchi foydalanuvchi:</span>
                <p className="font-semibold text-neutral-800">{selectedLog.user_email} ({selectedLog.user_id})</p>
              </div>

              <div>
                <span className="text-neutral-500 font-medium">Amal sababi (Reason):</span>
                <p className="rounded bg-neutral-50 p-2 font-medium text-neutral-800">
                  {selectedLog.reason || 'Sabab ko\'rsatilmagan'}
                </p>
              </div>

              {selectedLog.old_value && (
                <div>
                  <span className="text-neutral-500 font-medium">Oldingi qiymat (Old value):</span>
                  <pre className="mt-1 max-h-36 overflow-x-auto rounded bg-neutral-900 p-2.5 font-mono text-[11px] text-neutral-200">
                    {JSON.stringify(JSON.parse(selectedLog.old_value), null, 2)}
                  </pre>
                </div>
              )}

              {selectedLog.new_value && (
                <div>
                  <span className="text-neutral-500 font-medium">Yangi qiymat (New value):</span>
                  <pre className="mt-1 max-h-36 overflow-x-auto rounded bg-neutral-900 p-2.5 font-mono text-[11px] text-emerald-400">
                    {JSON.stringify(JSON.parse(selectedLog.new_value), null, 2)}
                  </pre>
                </div>
              )}
            </div>

            <div className="mt-5 flex justify-end">
              <button
                onClick={() => setSelectedLog(null)}
                className="rounded-lg bg-neutral-900 px-4 py-1.5 text-xs font-semibold text-white hover:bg-black"
              >
                Yopish
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
