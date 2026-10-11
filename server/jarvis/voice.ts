/**
 * Speech for Jarvis. The browser records the microphone and sends 16 kHz mono WAV; answers come back as MP3.
 * - azure: Microsoft Speech — Uzbek (uz-UZ) and Russian (ru-RU) recognition and neural voices.
 * - openai: Whisper / transcription and OpenAI voices (any OpenAI-compatible base URL).
 * - browser: done entirely in the browser (Chrome/Edge); the server is not involved.
 */
export type VoiceProvider = 'browser' | 'azure' | 'openai';
export type SpeechLang = 'uz' | 'ru';

export interface VoiceConfig { provider: VoiceProvider; key: string; region?: string | null; gender?: 'female' | 'male'; baseUrl?: string | null }

const AZURE_VOICES: Record<SpeechLang, Record<'female' | 'male', string>> = {
  uz: { female: 'uz-UZ-MadinaNeural', male: 'uz-UZ-SardorNeural' },
  ru: { female: 'ru-RU-SvetlanaNeural', male: 'ru-RU-DmitryNeural' }
};

/** Russian if the text is mostly Cyrillic without Uzbek-only letters; Uzbek otherwise. */
export function detectLang(text: string): SpeechLang {
  const cyr = (text.match(/[а-яё]/gi) || []).length;
  const lat = (text.match(/[a-z]/gi) || []).length;
  if (/[ўқғҳ]/i.test(text)) return 'uz';
  return cyr > lat ? 'ru' : 'uz';
}

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Text that reads well aloud: no markdown symbols, long answers cut to a speakable length. */
export function speakable(text: string): string {
  const plain = text.replace(/\*\*|__|`|#{1,6}\s*/g, '').replace(/^[ \t]*[-•*][ \t]+/gm, '').replace(/\n{2,}/g, '. ').replace(/\n/g, ' ').replace(/\s{2,}/g, ' ').trim();
  return plain.length > 1500 ? `${plain.slice(0, 1500).replace(/[^.!?]*$/, '')}` : plain;
}

async function call(url: string, init: RequestInit, service: string): Promise<Response> {
  let res: Response;
  try { res = await fetch(url, { ...init, signal: AbortSignal.timeout(60_000) }); }
  catch { throw new Error(`${service} bilan aloqa yo‘q.`); }
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 200);
    if (res.status === 401 || res.status === 403) throw new Error(`${service}: kalit yoki hudud (region) noto‘g‘ri.`);
    if (res.status === 429) throw new Error(`${service}: limit tugagan.`);
    throw new Error(`${service} xatosi (${res.status}). ${detail}`.trim());
  }
  return res;
}

export async function transcribe(c: VoiceConfig, wav: Buffer, lang: SpeechLang): Promise<string> {
  if (wav.length < 2000) throw new Error('Ovoz juda qisqa. Tugmani bosib, gapirib, keyin to‘xtating.');
  if (wav.length > 8 * 1024 * 1024) throw new Error('Ovoz juda uzun (60 soniyadan oshmasin).');
  if (c.provider === 'azure') {
    if (!c.region) throw new Error('Azure hududi (region) kiritilmagan.');
    const url = `https://${c.region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=${lang === 'ru' ? 'ru-RU' : 'uz-UZ'}&format=simple`;
    const res = await call(url, { method: 'POST', headers: { 'Ocp-Apim-Subscription-Key': c.key, 'Content-Type': 'audio/wav; codecs=audio/pcm; samplerate=16000', Accept: 'application/json' }, body: new Uint8Array(wav) }, 'Azure Speech');
    const data: any = await res.json();
    if (data.RecognitionStatus && data.RecognitionStatus !== 'Success') throw new Error(data.RecognitionStatus === 'NoMatch' ? 'Gap tushunilmadi. Aniqroq va mikrofonga yaqinroq gapiring.' : `Tanib bo‘lmadi (${data.RecognitionStatus}).`);
    return String(data.DisplayText || '').trim();
  }
  if (c.provider === 'openai') {
    const base = (c.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'speech.wav');
    form.append('model', 'whisper-1');
    form.append('language', lang);
    const res = await call(`${base}/audio/transcriptions`, { method: 'POST', headers: { authorization: `Bearer ${c.key}` }, body: form }, 'OpenAI ovoz');
    const data: any = await res.json();
    return String(data.text || '').trim();
  }
  throw new Error('Brauzer rejimida nutq brauzerning o‘zida tanib olinadi.');
}

export async function synthesize(c: VoiceConfig, text: string): Promise<Buffer> {
  const say = speakable(text);
  if (!say) throw new Error('Aytiladigan matn yo‘q.');
  const lang = detectLang(say);
  if (c.provider === 'azure') {
    if (!c.region) throw new Error('Azure hududi (region) kiritilmagan.');
    const voice = AZURE_VOICES[lang][c.gender || 'female'];
    const ssml = `<speak version="1.0" xml:lang="${voice.slice(0, 5)}"><voice name="${voice}">${xml(say)}</voice></speak>`;
    const res = await call(`https://${c.region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: 'POST',
      headers: { 'Ocp-Apim-Subscription-Key': c.key, 'Content-Type': 'application/ssml+xml', 'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3', 'User-Agent': 'DistroPro-Jarvis' },
      body: ssml
    }, 'Azure Speech');
    return Buffer.from(await res.arrayBuffer());
  }
  if (c.provider === 'openai') {
    const base = (c.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
    const res = await call(`${base}/audio/speech`, {
      method: 'POST', headers: { authorization: `Bearer ${c.key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'tts-1', voice: c.gender === 'male' ? 'onyx' : 'nova', input: say, response_format: 'mp3' })
    }, 'OpenAI ovoz');
    return Buffer.from(await res.arrayBuffer());
  }
  throw new Error('Brauzer rejimida ovoz brauzerning o‘zida chiqariladi.');
}
