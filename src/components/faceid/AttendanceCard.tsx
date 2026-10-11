import React, { useEffect, useState } from 'react';
import { LogIn, LogOut, MapPin, ScanFace } from 'lucide-react';
import { api } from '../../services/api.ts';
import { FaceCapture, type FaceCheckResult } from './FaceCapture.tsx';

/** Best GPS reading within a few seconds (high accuracy); null when refused or unavailable. */
function locate(): Promise<{ lat: number; lng: number; accuracy_m: number } | null> {
  return new Promise(resolve => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy_m: p.coords.accuracy }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  });
}

const STATUS: Record<string, string> = { ACCEPTED: 'qabul qilindi', REVIEW: 'rahbar tekshiradi', REJECTED: 'rad etildi' };

/** The employee's own Face ID check-in / check-out (from their phone, in the field). */
export const AttendanceCard: React.FC = () => {
  const [me, setMe] = useState<any>(null);
  const [capture, setCapture] = useState<'IN' | 'OUT' | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [place, setPlace] = useState<{ gps: { lat: number; lng: number; accuracy_m: number } | null; at: number } | null>(null);

  const load = () => api.attendance.me().then(setMe).catch(() => setMe(null));
  useEffect(() => { load(); }, []);
  if (!me?.linked) return null;

  // Face ID only at the work place: the location is checked first, so the camera opens only inside the zone.
  const start = async (type: 'IN' | 'OUT') => {
    setMsg(null);
    if (!me.zone_required) { setCapture(type); return; }
    setBusy(true);
    try {
      const gps = await locate();
      const r = await api.attendance.zoneCheck(gps || { lat: null, lng: null, accuracy_m: null });
      if (!r.ok) { setMsg({ ok: false, text: r.message }); return; }
      setPlace({ gps, at: Date.now() });
      setCapture(type);
    } catch (e: any) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  };
  const send = async (type: 'IN' | 'OUT', face: FaceCheckResult) => {
    setCapture(null);
    setBusy(true);
    try {
      // A fresh reading for the record (the server checks the zone again); the one from the pre-check if this fails.
      const gps = (await locate()) || (place && Date.now() - place.at < 120_000 ? place.gps : null);
      const r = await api.attendance.check({ type, ...face, ...(gps || { lat: null, lng: null, accuracy_m: null }), device: navigator.userAgent.slice(0, 120) });
      setMsg({ ok: r.status === 'ACCEPTED', text: r.message + (gps ? '' : ' (Joylashuvga ruxsat berilmadi.)') });
    } catch (e: any) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setBusy(false);
      load();
    }
  };

  const t = me.today || {};
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-bold text-neutral-900"><ScanFace className="h-4 w-4 text-emerald-600" />Davomat</h2>
          <p className="text-xs text-neutral-500">Ish vaqti: {me.schedule?.start} – {me.schedule?.end}{t.first_in ? ` · bugun keldingiz: ${t.first_in}` : ''}{t.last_out ? ` · ketdingiz: ${t.last_out}` : ''}{t.late_minutes ? ` · ${t.late_minutes} daq kech` : ''}</p>
        </div>
        {me.schedule?.source === 'SALESDOC_VISIT' ? (
          <span className="rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-900">Ish boshlanishi ulangan tizimdagi (SalesDoctor, Linko …) birinchi vizitingizdan olinadi{t.visits ? ` · bugun ${t.visits} vizit` : ''}.</span>
        ) : me.schedule?.source === 'TELEGRAM_VIDEO' ? (
          <span className="rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-900">Ish boshlash: Telegram guruhiga <b>dumaloq video</b> tashlang — tashlagan vaqtingiz ish boshlagan vaqt bo‘ladi. Avval pastdagi “Telegram’ni ulash” orqali ulaning.</span>
        ) : me.enrolled ? (
          <div className="flex flex-wrap gap-2">
            <button disabled={busy} onClick={() => start('IN')} className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50"><ScanFace className="h-4 w-4" />Face ID: Ishga keldim<LogIn className="h-4 w-4 opacity-70" /></button>
            <button disabled={busy} onClick={() => start('OUT')} className="inline-flex items-center gap-1.5 rounded-xl bg-neutral-900 px-4 py-2.5 text-sm font-bold text-white hover:bg-neutral-800 disabled:opacity-50"><ScanFace className="h-4 w-4" />Face ID: Ishdan ketdim<LogOut className="h-4 w-4 opacity-70" /></button>
          </div>
        ) : <span className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">Face ID uchun yuzingiz hali ro‘yxatga olinmagan — super adminga murojaat qiling (Davomat → Face ID ro‘yxati).</span>}
      </div>
      {me.enrolled && !me.schedule?.source?.match(/SALESDOC_VISIT|TELEGRAM_VIDEO/) && (
        <ol className="mt-3 grid gap-1.5 rounded-xl bg-emerald-50/60 p-3 text-[11px] text-emerald-950 sm:grid-cols-3">
          <li><b>1.</b> Tugmani bosing{me.zone_required ? ' — avval joylashuvingiz tekshiriladi (ish joyida bo‘lishingiz kerak), brauzer so‘rasa “Ruxsat berish”ni bosing' : ''}.</li>
          <li><b>2.</b> Kamera ochiladi — ruxsat bering.</li>
          <li><b>3.</b> Kameraga qarang — 1–2 soniyada o‘zi tasdiqlaydi.</li>
        </ol>
      )}
      {busy && <p className="mt-2 text-xs text-neutral-500"><MapPin className="mr-1 inline h-3.5 w-3.5" />Joylashuv aniqlanmoqda va yuborilmoqda…</p>}
      {msg && <p className={`mt-2 rounded-lg p-2 text-xs ${msg.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-900'}`}>{msg.text}</p>}
      {(me.events || []).length > 0 && (
        <ul className="mt-2 space-y-0.5 text-[11px] text-neutral-500">
          {me.events.map((e: any) => <li key={e.id}>{e.time} — {e.type === 'IN' ? 'kelish' : 'ketish'}: {STATUS[e.status]}{e.zone_name ? ` · ${e.zone_name}` : ''}</li>)}
        </ul>
      )}
      {(me.month_violations || []).length > 0 && (
        <div className="mt-3 rounded-xl border border-rose-100 bg-rose-50 p-3 text-xs text-rose-900">
          <b>Shu oy qoidabuzarliklar: {Math.round(me.month_violations.reduce((s: number, v: any) => s + v.percent, 0) * 100) / 100}% oylikdan</b>
          <ul className="mt-1 space-y-0.5">{me.month_violations.map((v: any, i: number) => <li key={i}>{v.date.split('-').reverse().slice(0, 2).join('.')} — {v.label}{v.minutes ? ` (${v.minutes} daq)` : ''}: {v.percent}%{v.note ? ` · ${v.note}` : ''}</li>)}</ul>
        </div>
      )}
      {capture && <FaceCapture mode="check" title={capture === 'IN' ? 'Ishga kelishni tasdiqlash' : 'Ishdan ketishni tasdiqlash'} onCheck={r => send(capture, r)} onCancel={() => setCapture(null)} />}
    </div>
  );
};
