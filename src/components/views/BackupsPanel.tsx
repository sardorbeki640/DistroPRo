import React, { useEffect, useState } from 'react';
import { DatabaseBackup, Download, RefreshCw } from 'lucide-react';
import { api } from '../../services/api.ts';

/** Automatic backups: what exists, and a button to make one now (owner only). */
export const BackupsPanel: React.FC = () => {
  const [rows, setRows] = useState<{ name: string; kind: 'daily' | 'weekly'; size_mb: number; created_at: string }[]>([]);
  const [extra, setExtra] = useState<string | null>(null);
  const [storageNotice, setStorageNotice] = useState('');
  const [scheduled, setScheduled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { api.getBackups().then(r => { setRows(r.backups); setExtra(r.extra_copy_dir); setStorageNotice(r.storage_notice); setScheduled(r.scheduled); }).catch(e => setError(e.message)); }, []);

  const now = async () => {
    setBusy(true); setError(null); setMsg(null);
    try {
      const r = await api.runBackup();
      setRows(r.backups);
      setMsg(`Zaxira nusxa olindi${r.copied_to ? ` va ${r.copied_to} ga ham ko‘chirildi` : ''}.`);
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  const download = async (row: typeof rows[number]) => {
    const key = `${row.kind}:${row.name}`;
    setDownloading(key); setError(null);
    try { await api.downloadBackup(row.kind, row.name); }
    catch (e: any) { setError(e.message); }
    finally { setDownloading(null); }
  };

  const latest = rows[0];
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-bold text-neutral-900"><DatabaseBackup className="h-4 w-4" />Zaxira nusxalar</h2>
          <p className="text-xs text-neutral-500">{scheduled ? 'Har kecha avtomatik (7 kunlik + 4 haftalik saqlanadi).' : 'Avtomatik fayl nusxasi yoqilmagan.'} {latest ? <>Oxirgisi: <b>{new Date(latest.created_at).toLocaleString('ru-RU')}</b>.</> : 'Hali nusxa yo‘q.'}</p>
          <p className="text-[11px] text-neutral-500">{extra ? <>Ikkinchi joyga ham ko‘chiriladi: <b className="font-mono">{extra}</b></> : 'Ikkinchi saqlash joyi sozlanmagan. Server muhitida BACKUP_COPY_DIR ko‘rsatilishi mumkin.'}</p>
        </div>
        <button onClick={now} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-neutral-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">
          <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />Hozir nusxa olish
        </button>
      </div>
      {!!storageNotice && <p className={`mt-3 rounded-lg p-2 text-xs ${scheduled ? 'bg-blue-50 text-blue-800' : 'bg-amber-50 text-amber-900'}`}>{storageNotice}</p>}
      {error && <p className="mt-2 rounded-lg bg-red-50 p-2 text-xs text-red-700">{error}</p>}
      {msg && <p className="mt-2 rounded-lg bg-emerald-50 p-2 text-xs text-emerald-700">{msg}</p>}
      {!!rows.length && (
        <table className="mt-3 min-w-full text-xs">
          <thead className="text-left text-neutral-500"><tr><th className="py-1">Fayl</th><th>Turi</th><th className="text-right">Hajmi</th><th className="text-right">Vaqti</th><th className="text-right">Yuklab olish</th></tr></thead>
          <tbody className="divide-y divide-neutral-100">
            {rows.map(r => <tr key={r.kind + r.name}><td className="py-1.5 font-mono">{r.name}</td><td>{r.kind === 'daily' ? 'Kunlik' : 'Haftalik'}</td><td className="text-right">{r.size_mb} MB</td><td className="text-right">{new Date(r.created_at).toLocaleString('ru-RU')}</td><td className="text-right"><button onClick={() => download(r)} disabled={downloading !== null} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-blue-700 hover:bg-blue-50 disabled:opacity-50"><Download className="h-3.5 w-3.5" />{downloading === `${r.kind}:${r.name}` ? 'Yuklanmoqda…' : 'Yuklab olish'}</button></td></tr>)}
          </tbody>
        </table>
      )}
    </div>
  );
};
