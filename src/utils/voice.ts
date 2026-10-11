/** Microphone and speaker helpers for Jarvis (browser side). */

export type SpeechLang = 'uz' | 'ru';
const LOCALE: Record<SpeechLang, string> = { uz: 'uz-UZ', ru: 'ru-RU' };

/** Records the microphone until stop() and returns 16 kHz mono WAV as base64 (what Azure/Whisper accept). */
export async function startRecording(): Promise<{ stop: () => Promise<string>; cancel: () => void }> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Bu brauzer mikrofonni qo‘llamaydi.');
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } })
    .catch(() => { throw new Error('Mikrofonga ruxsat berilmadi. Brauzer manzil satridagi mikrofon belgisidan ruxsat bering.'); });
  const recorder = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  recorder.start();
  const release = () => stream.getTracks().forEach(t => t.stop());
  return {
    cancel: () => { try { recorder.stop(); } catch { /* already stopped */ } release(); },
    stop: () => new Promise<string>((resolve, reject) => {
      recorder.onstop = async () => {
        release();
        try { resolve(await toWav16k(new Blob(chunks, { type: recorder.mimeType }))); } catch (e) { reject(e); }
      };
      recorder.stop();
    })
  };
}

async function toWav16k(blob: Blob): Promise<string> {
  const ctx = new AudioContext();
  const decoded = await ctx.decodeAudioData(await blob.arrayBuffer()).finally(() => ctx.close());
  const rate = 16000;
  const offline = new OfflineAudioContext(1, Math.max(1, Math.ceil(decoded.duration * rate)), rate);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start();
  const pcm = (await offline.startRendering()).getChannelData(0);
  const buf = new ArrayBuffer(44 + pcm.length * 2);
  const v = new DataView(buf);
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + pcm.length * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) { const x = Math.max(-1, Math.min(1, pcm[i])); v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true); }
  let binary = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Free mode: the browser's own recognition (Chrome / Edge, needs internet). Resolves with the spoken text. */
export function browserRecognize(lang: SpeechLang): { result: Promise<string>; stop: () => void } {
  const Rec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!Rec) return { result: Promise.reject(new Error('Bu brauzerda ovozni tanish yo‘q. Chrome yoki Edge’dan foydalaning yoki Sozlamalarda Azure/OpenAI ovozini ulang.')), stop: () => {} };
  const rec = new Rec();
  rec.lang = LOCALE[lang];
  rec.interimResults = false;
  rec.continuous = false;
  const result = new Promise<string>((resolve, reject) => {
    let text = '';
    rec.onresult = (e: any) => { text = Array.from(e.results).map((r: any) => r[0].transcript).join(' '); };
    rec.onerror = (e: any) => reject(new Error(e.error === 'not-allowed' ? 'Mikrofonga ruxsat berilmadi.' : e.error === 'no-speech' ? 'Ovoz eshitilmadi.' : `Ovozni tanib bo‘lmadi (${e.error}).`));
    rec.onend = () => resolve(text.trim());
  });
  rec.start();
  return { result, stop: () => rec.stop() };
}

/** Free mode: the browser's own voice; Uzbek voices are rare, so the closest available one is used. */
export function browserSpeak(text: string): Promise<void> {
  return new Promise(resolve => {
    if (!('speechSynthesis' in window)) return resolve();
    const plain = text.replace(/\*\*|`|#{1,6}\s*/g, '').replace(/^[ \t]*[-•*][ \t]+/gm, '');
    const ru = (plain.match(/[а-яё]/gi) || []).length > (plain.match(/[a-z]/gi) || []).length && !/[ўқғҳ]/i.test(plain);
    const u = new SpeechSynthesisUtterance(plain.slice(0, 2000));
    const voices = speechSynthesis.getVoices();
    u.voice = voices.find(v => v.lang.startsWith(ru ? 'ru' : 'uz')) || voices.find(v => v.lang.startsWith(ru ? 'ru' : 'tr')) || null;
    u.lang = ru ? 'ru-RU' : 'uz-UZ';
    u.onend = () => resolve();
    u.onerror = () => resolve();
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  });
}

export function stopSpeaking() {
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  currentAudio?.pause();
}

let currentAudio: HTMLAudioElement | null = null;
let audioCtx: AudioContext | null = null;

/** Plays the answer; onLevel gets the loudness (0..1) about 30 times a second so the reactor can pulse with the voice. */
export function playMp3(blob: Blob, onLevel?: (level: number) => void): Promise<void> {
  return new Promise(resolve => {
    currentAudio?.pause();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    currentAudio = audio;
    let raf = 0;
    if (onLevel) {
      try {
        audioCtx ||= new AudioContext();
        const src = audioCtx.createMediaElementSource(audio);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        src.connect(analyser); analyser.connect(audioCtx.destination);
        const data = new Uint8Array(analyser.frequencyBinCount);
        const tick = () => { analyser.getByteFrequencyData(data); onLevel(Math.min(1, data.reduce((s, v) => s + v, 0) / data.length / 90)); raf = requestAnimationFrame(tick); };
        tick();
      } catch { /* analyser not available: plain playback */ }
    }
    audio.onended = audio.onerror = audio.onpause = () => { cancelAnimationFrame(raf); onLevel?.(0); URL.revokeObjectURL(url); resolve(); };
    audio.play().catch(() => resolve());
  });
}

/** Short two-tone chime when Jarvis wakes up. */
export function chime() {
  try {
    audioCtx ||= new AudioContext();
    const t = audioCtx.currentTime;
    for (const [i, f] of [[0, 880], [1, 1320]] as const) {
      const o = audioCtx.createOscillator(); const g = audioCtx.createGain();
      o.frequency.value = f; o.type = 'sine';
      g.gain.setValueAtTime(0.0001, t + i * 0.09); g.gain.exponentialRampToValueAtTime(0.18, t + i * 0.09 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.09 + 0.22);
      o.connect(g); g.connect(audioCtx.destination); o.start(t + i * 0.09); o.stop(t + i * 0.09 + 0.25);
    }
  } catch { /* no audio */ }
}

const WAKE = /(jarvis|jarvıs|djarvis|jarviz|жарвис|джарвис|жарвиз|джарвиз)/i;

/**
 * Wake-word mode (Chrome/Edge): listens all the time; "Jarvis …" with a request runs it at once,
 * "Jarvis" alone arms the next sentence as the request (8 seconds).
 */
export function startWakeListener(lang: SpeechLang, handlers: { onArmed: (armed: boolean) => void; onHeard: (text: string) => void; onCommand: (text: string) => void; onError: (message: string) => void }) {
  const Rec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!Rec) { handlers.onError('Uyg‘otish rejimi uchun Chrome yoki Edge kerak.'); return { stop: () => {} }; }
  let active = true;
  let armed = false;
  let disarm: any = null;
  let rec: any = null;
  const arm = (on: boolean) => {
    armed = on; handlers.onArmed(on);
    clearTimeout(disarm);
    if (on) disarm = setTimeout(() => arm(false), 8000);
  };
  const start = () => {
    if (!active) return;
    rec = new Rec();
    rec.lang = LOCALE[lang];
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e: any) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const text = String(e.results[i][0].transcript || '').trim();
        handlers.onHeard(text);
        if (!e.results[i].isFinal || !text) continue;
        const m = WAKE.exec(text);
        if (armed) { arm(false); handlers.onCommand(m ? text.slice(m.index + m[0].length).replace(/^[\s,.!?]+/, '') || text : text); continue; }
        if (!m) continue;
        const rest = text.slice(m.index + m[0].length).replace(/^[\s,.!?]+/, '');
        if (rest.length > 3) handlers.onCommand(rest); else { chime(); arm(true); }
      }
    };
    rec.onerror = (e: any) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { active = false; handlers.onError('Mikrofonga ruxsat berilmadi.'); }
    };
    rec.onend = () => { if (active) setTimeout(start, 300); };
    try { rec.start(); } catch { setTimeout(start, 1000); }
  };
  start();
  return { stop: () => { active = false; clearTimeout(disarm); try { rec?.stop(); } catch { /* stopped */ } } };
}
