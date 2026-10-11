import React, { useEffect, useState } from 'react';
import { BookOpen, FolderOpen, RefreshCw } from 'lucide-react';
import { api, type ObsidianView } from '../../services/api.ts';

const box = 'space-y-3 rounded-2xl border border-cyan-500/20 bg-slate-900/60 p-5';
const input = 'mt-1 block w-full rounded-lg border border-cyan-500/30 bg-slate-950/70 px-3 py-2 font-mono text-xs text-cyan-50 placeholder:text-slate-500 focus:border-cyan-400 focus:outline-hidden';

/** Obsidian vault: Jarvis keeps business notes there and searches the owner's own notes. */
export const ObsidianPanel: React.FC = () => {
  const [v, setV] = useState<ObsidianView | null>(null);
  const [path, setPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => { api.jarvis.obsidian().then(r => { setV(r.obsidian); setPath(r.obsidian.vault || r.obsidian.default_vault); }).catch(e => setMsg({ ok: false, text: e.message })); }, []);
  if (!v) return null;

  const run = async (fn: () => Promise<{ obsidian: any }>, ok: (o: any) => string) => {
    setBusy(true); setMsg(null);
    try { const r = await fn(); setV(r.obsidian); setMsg({ ok: true, text: ok(r.obsidian) }); } catch (e: any) { setMsg({ ok: false, text: e.message }); } finally { setBusy(false); }
  };
  const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');

  return (
    <div className={`${box} lg:col-span-2`}>
      <div className="flex items-center gap-2 text-sm font-bold text-cyan-200"><BookOpen className="h-4 w-4" />Obsidian — biznes bilim bazasi</div>
      <p className="text-[11px] text-slate-400">
        Jarvis shu papkani o‘zi to‘ldirib boradi: kundalik holat, har bir agent (strategiyasi bilan), qarzdorlar, xaridni to‘xtatgan mijozlar, ombor va xotira.
        Siz yozgan eslatmalarni o‘qiydi va savollarga javobda ishlatadi, lekin <b>hech qachon o‘zgartirmaydi</b>. O‘z xulosalarini <code>Jarvis/</code> papkasiga yozadi.
      </p>
      <label className="block text-xs font-semibold text-cyan-100/80">Vault papkasi (shu kompyuterda)
        <input className={input} value={path} onChange={e => setPath(e.target.value)} placeholder={v.default_vault} />
      </label>
      <label className="flex items-center gap-2 text-xs text-cyan-50">
        <input type="checkbox" checked={v.auto} disabled={!v.vault || busy} onChange={e => run(() => api.jarvis.saveObsidian({ auto: e.target.checked }), o => o.auto ? 'Har soatda avtomatik yangilanadi.' : 'Avtomatik yangilash o‘chirildi.')} />
        Har soatda avtomatik yangilab borsin (ertalabki brifing ham kundalikka yoziladi)
      </label>
      <div className="flex flex-wrap gap-2">
        <button disabled={busy || !path.trim()} onClick={() => run(() => api.jarvis.saveObsidian({ vault: path.trim(), auto: v.vault ? v.auto : true }), () => 'Ulandi va to‘ldirildi. Obsidian’da “Open folder as vault” orqali shu papkani oching.')} className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-500 px-4 py-1.5 text-xs font-bold text-slate-950 hover:bg-cyan-400 disabled:opacity-50"><FolderOpen className="h-3.5 w-3.5" />{v.vault ? 'Papkani saqlash' : 'Ulash va to‘ldirish'}</button>
        {v.vault && <button disabled={busy} onClick={() => run(() => api.jarvis.syncObsidian(), o => `Yangilandi: ${o.written} ta eslatma.${o.skipped?.length ? ` Siz yozgan ${o.skipped.length} ta eslatmaga tegilmadi.` : ''}`)} className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/40 px-3 py-1.5 text-xs font-semibold text-cyan-100 hover:bg-cyan-500/10 disabled:opacity-50"><RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />Hozir yangilash</button>}
        {v.vault && <button disabled={busy} onClick={() => { if (confirm('Obsidian ulanishi o‘chirilsinmi? Papkadagi eslatmalar o‘chirilmaydi.')) run(() => api.jarvis.saveObsidian({ vault: null }), () => 'Uzildi. Papkadagi eslatmalar joyida qoldi.'); }} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-400 hover:text-red-400 disabled:opacity-50">Uzish</button>}
      </div>
      <p className="text-xs text-slate-300">Holat: {v.vault ? <b className={v.exists ? 'text-emerald-400' : 'text-amber-400'}>{v.exists ? 'ulangan' : 'papka topilmadi'}</b> : <b className="text-amber-400">ulanmagan</b>}{v.vault && <> · oxirgi yangilanish: {when(v.last_sync)}</>}</p>
      {v.last_error && <p className="rounded-lg bg-red-950/50 p-2 text-[11px] text-red-300">Oxirgi xato: {v.last_error}</p>}
      {msg && <p className={`text-xs ${msg.ok ? 'text-emerald-400' : 'text-red-400'}`}>{msg.text}</p>}
      <details className="text-[11px] text-slate-400">
        <summary className="cursor-pointer font-semibold text-cyan-200/80">Obsidian’ni qanday ochaman?</summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>obsidian.md saytidan Obsidian’ni o‘rnating (shaxsiy foydalanish bepul).</li>
          <li>Obsidian’da “Open folder as vault” → yuqoridagi papkani tanlang.</li>
          <li>“Bosh sahifa” eslatmasidan boshlang; “Graph view” agentlar, mijozlar va kunlarni bog‘lab ko‘rsatadi.</li>
          <li>O‘z rejalaringizni istalgan papkada yozing — Jarvis’dan “rejalarimda nima deyilgan?” deb so‘rasangiz, o‘sha yerdan topadi.</li>
        </ol>
      </details>
    </div>
  );
};
