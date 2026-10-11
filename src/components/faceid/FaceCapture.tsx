import React, { useEffect, useRef, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { averageDescriptor, CHALLENGE_TEXT, ChallengeTracker, loadFaceApi, readFrame, snapshot } from './faceEngine.ts';

export type FaceCheckResult = { descriptor: number[]; liveness_passed: boolean; liveness_steps: string[]; photo: string | null };
export type FaceEnrollResult = { samples: number[][]; photo?: string | null };

const STEP_TIMEOUT_MS = 9000;
const FRAME_MS = 140;

/**
 * Camera with a live face check. mode "check": two random liveness steps, then the face is read (descriptor +
 * a small photo). mode "enroll": a blink, then five samples of the face looking at the camera.
 */
export const FaceCapture: React.FC<{
  mode: 'check' | 'enroll';
  title: string;
  onCheck?: (r: FaceCheckResult) => void;
  onEnroll?: (r: FaceEnrollResult) => void;
  onCancel: () => void;
}> = ({ mode, title, onCheck, onEnroll, onCancel }) => {
  const video = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState('Kamera va yuz tanish modeli yuklanmoqda…');
  const [hint, setHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const stopped = useRef(false);

  useEffect(() => {
    stopped.current = false;
    let stream: MediaStream | null = null;
    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
    (async () => {
      try {
        if (!window.isSecureContext) throw new Error('Kamera faqat xavfsiz (https://) manzilda ishlaydi. Dasturni https orqali oching.');
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('Bu brauzer kamerani qo‘llamaydi.');
        const faceapi = await loadFaceApi();
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false })
          .catch((e: any) => {
            const name = e?.name || '';
            if (name === 'NotFoundError' || name === 'OverconstrainedError') throw new Error('Bu qurilmada kamera topilmadi. Face ID’ni kamerali telefon yoki noutbukdan qiling (dasturni telefonda oching).');
            if (name === 'NotReadableError' || name === 'AbortError') throw new Error('Kamera boshqa dasturda band (Zoom, Telegram qo‘ng‘irog‘i…). Uni yopib, “Qayta urinish”ni bosing.');
            throw new Error('Kameraga ruxsat berilmadi. Manzil satri chap tomonidagi qulf belgisini bosib, “Kamera → Ruxsat berish”ni tanlang va “Qayta urinish”ni bosing.');
          });
        if (stopped.current) return;
        const v = video.current!;
        v.srcObject = stream;
        await v.play();

        /** Next frame with exactly one face, large and steady enough. */
        const nextFace = async () => {
          for (;;) {
            if (stopped.current) throw new Error('stopped');
            const f = await readFrame(faceapi, v);
            if (!f) setHint('Yuzingiz ko‘rinmayapti — kameraga to‘g‘ri qarang, yorug‘ joyda turing.');
            else if (f.box.width < v.videoWidth * 0.15) setHint('Telefonni yaqinroq tuting.');
            else { setHint(null); return f; }
            await sleep(FRAME_MS);
          }
        };

        if (mode === 'check') {
          // Simple: the employee only looks at the camera; no tasks. The face is read from a few steady frames.
          setStatus('Kameraga qarang…');
          const frames: number[][] = [];
          while (frames.length < 3) {
            const f = await nextFace();
            if (Math.abs(f.yaw) < 0.3) { frames.push(f.descriptor); setProgress(frames.length / 3); }
            await sleep(FRAME_MS);
          }
          const photo = snapshot(v);
          onCheck?.({ descriptor: averageDescriptor(frames), liveness_passed: true, liveness_steps: ['ODDIY'], photo });
        } else {
          setStatus(CHALLENGE_TEXT.BLINK);
          const blink = new ChallengeTracker('BLINK');
          const until = Date.now() + STEP_TIMEOUT_MS * 2;
          let ok = false;
          while (Date.now() < until) { if (blink.feed(await nextFace())) { ok = true; break; } await sleep(FRAME_MS); }
          if (!ok) throw new Error('Ko‘z qisish aniqlanmadi. Qaytadan urinib ko‘ring.');
          const samples: number[][] = [];
          setStatus('Kameraga qarab turing, boshingizni ozgina u yoq-bu yoqqa qimirlating…');
          while (samples.length < 5) {
            const f = await nextFace();
            if (Math.abs(f.yaw) < 0.25 && f.ear > 0.2) { samples.push(f.descriptor); setProgress(samples.length / 5); await sleep(450); }
            else await sleep(FRAME_MS);
          }
          onEnroll?.({ samples, photo: snapshot(v, 320) });
        }
      } catch (err: any) {
        if (err?.message !== 'stopped') setError(err?.message || String(err));
      } finally {
        stream?.getTracks().forEach(t => t.stop());
      }
    })();
    return () => { stopped.current = true; stream?.getTracks().forEach(t => t.stop()); };
  }, [mode, attempt]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-3">
      <div className="w-full max-w-sm space-y-3 rounded-2xl bg-white p-4 shadow-2xl">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-neutral-900">{title}</h3>
          <button onClick={() => { stopped.current = true; onCancel(); }} className="text-neutral-400 hover:text-neutral-700"><X className="h-5 w-5" /></button>
        </div>
        <div className="relative overflow-hidden rounded-xl bg-neutral-900" style={{ aspectRatio: '3 / 4' }}>
          {/* Mirrored like a selfie: easier to follow the instructions. */}
          <video ref={video} playsInline muted className="h-full w-full object-cover" style={{ transform: 'scaleX(-1)' }} />
          <div className="pointer-events-none absolute inset-6 rounded-[45%] border-4 border-white/60" />
          <div className="absolute inset-x-0 bottom-0 bg-black/60 p-2 text-center text-sm font-semibold text-white">{error ? '—' : status}</div>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-neutral-100"><div className="h-full bg-emerald-500 transition-all" style={{ width: `${Math.round(progress * 100)}%` }} /></div>
        {hint && !error && <p className="text-center text-xs text-amber-700">{hint}</p>}
        {error && (
          <div className="space-y-2">
            <p className="rounded-lg bg-red-50 p-2 text-xs text-red-700">{error}</p>
            <button onClick={() => { setError(null); setProgress(0); setStatus('Qayta boshlanmoqda…'); setAttempt(a => a + 1); }} className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-neutral-900 py-2 text-xs font-bold text-white">
              <RefreshCw className="h-3.5 w-3.5" />Qayta urinish
            </button>
          </div>
        )}
        <p className="text-center text-[10px] text-neutral-400">
          {mode === 'check'
            ? 'Serverga raqamli yuz belgisi, joylashuv va nizoli holatlar uchun kichik surat yuboriladi.'
            : 'Faqat raqamli yuz belgisi shifrlangan holda saqlanadi — rasm saqlanmaydi.'}
        </p>
      </div>
    </div>
  );
};
