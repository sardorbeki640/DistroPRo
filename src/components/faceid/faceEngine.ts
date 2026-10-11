/**
 * Face detection, descriptors and liveness in the browser with @vladmandic/face-api (MIT, includes TensorFlow.js),
 * loaded from jsDelivr on first use so the app bundle stays small. Pinned version: models and code always match.
 */
const VERSION = '1.7.15';
const BASE = `https://cdn.jsdelivr.net/npm/@vladmandic/face-api@${VERSION}`;

let loading: Promise<any> | null = null;

export function loadFaceApi(): Promise<any> {
  if (!loading) {
    loading = (async () => {
      const faceapi: any = await import(/* @vite-ignore */ `${BASE}/dist/face-api.esm.js`);
      await faceapi.tf?.ready?.();
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(`${BASE}/model`),
        faceapi.nets.faceLandmark68Net.loadFromUri(`${BASE}/model`),
        faceapi.nets.faceRecognitionNet.loadFromUri(`${BASE}/model`)
      ]);
      return faceapi;
    })().catch(err => { loading = null; throw new Error(`Yuz tanish modeli yuklanmadi (internetni tekshiring): ${err?.message || err}`); });
  }
  return loading;
}

export type FaceFrame = { descriptor: number[]; ear: number; yaw: number; box: { x: number; y: number; width: number; height: number }; score: number };

type P = { x: number; y: number };
const dist = (a: P, b: P) => Math.hypot(a.x - b.x, a.y - b.y);
/** Eye aspect ratio: about 0.3 open, below ~0.2 closed. */
function eyeRatio(eye: P[]) {
  return (dist(eye[1], eye[5]) + dist(eye[2], eye[4])) / (2 * dist(eye[0], eye[3]));
}

/** One video frame: the single face (or null) with its descriptor, blink ratio and head turn (-1 left … +1 right). */
export async function readFrame(faceapi: any, video: HTMLVideoElement): Promise<FaceFrame | null> {
  const r = await faceapi.detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 })).withFaceLandmarks().withFaceDescriptor();
  if (!r) return null;
  const lm = r.landmarks;
  const left = lm.getLeftEye(), right = lm.getRightEye(), nose = lm.getNose();
  const eyeL = { x: left.reduce((s: number, p: P) => s + p.x, 0) / left.length, y: 0 };
  const eyeR = { x: right.reduce((s: number, p: P) => s + p.x, 0) / right.length, y: 0 };
  const mid = (eyeL.x + eyeR.x) / 2;
  const span = Math.abs(eyeR.x - eyeL.x) || 1;
  const tip = nose[3] || nose[nose.length - 1];
  return {
    descriptor: Array.from(r.descriptor as Float32Array).map(v => Number(v.toFixed(6))),
    ear: (eyeRatio(left) + eyeRatio(right)) / 2,
    // Positive when the head turns to the person's left in a mirrored selfie view; only the size matters for liveness.
    yaw: (tip.x - mid) / span,
    box: r.detection.box,
    score: r.detection.score
  };
}

// ---------- Enrollment from uploaded photos ----------

/** The more exact detector (SSD MobileNet) for still photos; loaded only when a photo is enrolled. */
let ssdLoading: Promise<void> | null = null;
function ensureSsd(faceapi: any): Promise<void> {
  if (!ssdLoading) {
    ssdLoading = faceapi.nets.ssdMobilenetv1.loadFromUri(`${BASE}/model`)
      .catch((err: any) => { ssdLoading = null; throw new Error(`Yuz aniqlash modeli yuklanmadi (internetni tekshiring): ${err?.message || err}`); });
  }
  return ssdLoading!;
}

type Picture = { source: CanvasImageSource; width: number; height: number; close?: () => void };

/** Opens an image file; the phone's rotation (EXIF) is applied so the face stands upright. */
async function openPicture(file: File): Promise<Picture> {
  if (/\.(heic|heif)$/i.test(file.name) || /heic|heif/i.test(file.type)) {
    throw new Error(`${file.name}: iPhone’ning HEIC rasmini brauzer ocholmaydi. JPG qilib yuboring (iPhone: Sozlamalar → Kamera → Formatlar → “Most Compatible”) yoki rasmdan skrinshot oling.`);
  }
  if (file.type && !file.type.startsWith('image/')) throw new Error(`${file.name}: bu rasm fayli emas. JPG yoki PNG yuklang.`);
  if (file.size > 25 * 1024 * 1024) throw new Error(`${file.name}: fayl juda katta (25 MB dan oshmasin).`);
  try {
    let bmp = await createImageBitmap(file, { imageOrientation: 'from-image' } as any);
    // A 12-megapixel phone photo is reduced once: faster, and phones do not run out of memory.
    const big = Math.max(bmp.width, bmp.height);
    if (big > 2400) {
      const s = 2400 / big, full = bmp;
      bmp = await createImageBitmap(full, { resizeWidth: Math.round(full.width * s), resizeHeight: Math.round(full.height * s), resizeQuality: 'high' });
      full.close();
    }
    return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
  } catch {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve({ source: img, width: img.naturalWidth, height: img.naturalHeight }); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`${file.name}: rasm ochilmadi. JPG yoki PNG yuklang.`)); };
      img.src = url;
    });
  }
}

type Box = { x: number; y: number; width: number; height: number };

/** Draws the picture turned by `turn` degrees (clockwise), optionally a part of it, scaled to maxSide pixels (small pictures are enlarged). */
function draw(p: Picture, opts: { turn?: 0 | 90 | 180 | 270; crop?: Box; maxSide?: number } = {}) {
  const turn = opts.turn || 0;
  const tw = turn % 180 ? p.height : p.width, th = turn % 180 ? p.width : p.height;   // size after turning
  const turned = document.createElement('canvas');
  turned.width = tw; turned.height = th;
  const g = turned.getContext('2d')!;
  g.translate(tw / 2, th / 2);
  g.rotate((turn * Math.PI) / 180);
  g.drawImage(p.source, -p.width / 2, -p.height / 2);
  const src = opts.crop || { x: 0, y: 0, width: tw, height: th };
  const scale = (opts.maxSide || 1280) / Math.max(src.width, src.height);
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(src.width * scale));
  out.height = Math.max(1, Math.round(src.height * scale));
  out.getContext('2d')!.drawImage(turned, src.x, src.y, src.width, src.height, 0, 0, out.width, out.height);
  return out;
}

/** Faces in a picture: the exact detector first, then the fast one with a large input for small faces. */
async function findFaces(faceapi: any, input: HTMLCanvasElement): Promise<(Box & { score: number })[]> {
  let found: any[] = await faceapi.detectAllFaces(input, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.3 }));
  if (!found.length) found = await faceapi.detectAllFaces(input, new faceapi.TinyFaceDetectorOptions({ inputSize: 608, scoreThreshold: 0.3 }));
  return found.map(f => ({ x: f.box.x, y: f.box.y, width: f.box.width, height: f.box.height, score: f.score }))
    .sort((a, b) => b.width * b.height - a.width * a.height);
}

/** Descriptor of the face in the middle of a cut-out (a neighbour's face at the edge is ignored). */
async function describeFace(faceapi: any, input: HTMLCanvasElement): Promise<number[] | null> {
  let all: any[] = await faceapi.detectAllFaces(input, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.3 })).withFaceLandmarks().withFaceDescriptors();
  if (!all.length) all = await faceapi.detectAllFaces(input, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.3 })).withFaceLandmarks().withFaceDescriptors();
  const off = (r: any) => Math.hypot(r.detection.box.x + r.detection.box.width / 2 - input.width / 2, r.detection.box.y + r.detection.box.height / 2 - input.height / 2);
  const r = all.sort((a, b) => off(a) - off(b))[0];
  return r ? Array.from(r.descriptor as Float32Array).map(v => Number(v.toFixed(6))) : null;
}

const distance = (a: number[], b: number[]) => Math.sqrt(a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0));

/**
 * Face samples from photos the manager uploads (instead of the live camera). Each photo must show one clear face;
 * a photo saved sideways is turned upright. Every photo gives three samples (the face cut out at three sizes), so one
 * good photo is enough; samples that disagree with the others are dropped. Also returns a small portrait of the first
 * photo, kept as the employee's reference picture.
 */
export async function samplesFromPhotos(faceapi: any, files: File[]): Promise<{ samples: number[][]; photo: string }> {
  if (!files.length) throw new Error('Rasm tanlanmagan.');
  await ensureSsd(faceapi);
  const samples: number[][] = [];
  let photo = '';
  for (const file of files.slice(0, 3)) {
    const pic = await openPicture(file);
    try {
      // A picture saved sideways or upside down is tried turned until the face reads cleanly.
      let seen = false, done = false;
      for (const turn of [0, 90, 270, 180] as const) {
        const view = draw(pic, { turn, maxSide: 1280 });
        const faces = await findFaces(faceapi, view);
        if (!faces.length) continue;
        seen = true;
        const face = faces[0];
        // One person: another clear face nearly as big as the first means a group photo.
        const others = faces.slice(1).filter(f => f.score >= 0.6 && f.width * f.height > 0.35 * face.width * face.height);
        if (others.length) throw new Error(`${file.name}: rasmda ${others.length + 1} ta yuz bor. Faqat xodimning o‘zi tushgan rasm kerak.`);
        const tw = turn % 180 ? pic.height : pic.width, th = turn % 180 ? pic.width : pic.height;
        const k = tw / view.width;   // view pixels -> picture pixels
        if (face.width * k < 40) throw new Error(`${file.name}: yuz juda kichik. Yuz kattaroq ko‘rinadigan (yaqinroqdan olingan) rasm yuklang.`);

        // The face cut out of the full-size (turned) picture at three sizes.
        const cx = (face.x + face.width / 2) * k, cy = (face.y + face.height / 2) * k, size = Math.max(face.width, face.height) * k;
        const cut = (margin: number): Box => {
          const side = Math.min(size * margin, tw, th);
          return { x: Math.max(0, Math.min(tw - side, cx - side / 2)), y: Math.max(0, Math.min(th - side, cy - side / 2)), width: side, height: side };
        };
        const cuts: number[][] = [];
        for (const margin of [1.5, 1.9, 2.4, 3.0]) {
          const d = await describeFace(faceapi, draw(pic, { turn, crop: cut(margin), maxSide: 512 }));
          if (d) cuts.push(d);
        }
        // The cuts of one upright face agree closely; a face read upside down does not.
        const mid = cuts.length ? averageDescriptor(cuts) : [];
        const own = cuts.filter(d => distance(d, mid) <= 0.25);
        if (own.length < 3) continue;
        samples.push(...own);
        if (!photo) photo = draw(pic, { turn, crop: cut(2.1), maxSide: 320 }).toDataURL('image/jpeg', 0.85);
        done = true;
        break;
      }
      if (!done) throw new Error(seen
        ? `${file.name}: yuz belgilari aniq o‘qilmadi. Yuz to‘g‘ri (tik), aniq (xira emas) va yorug‘ tushgan rasm yuklang.`
        : `${file.name}: yuz topilmadi. Yuz to‘liq, oldindan, yorug‘ joyda tushgan rasm yuklang (ko‘zoynak va niqobsiz).`);
    } finally {
      pic.close?.();
    }
  }
  // Samples that disagree with the rest (a bad cut, another person in another photo) are dropped.
  const center = averageDescriptor(samples);
  const near = samples.filter(s => distance(s, center) <= 0.35).sort((a, b) => distance(a, center) - distance(b, center));
  // The server checks every sample against the first one (≤ 0.5): the most typical sample goes first.
  const kept = near.filter(s => distance(s, near[0]) <= 0.45);
  if (files.length > 1 && kept.length < samples.length * 0.6) throw new Error('Yuklangan rasmlardagi yuzlar bir-biriga o‘xshamayapti — hammasi bitta xodimniki ekanini tekshiring.');
  if (kept.length < 3) throw new Error('Rasmdan yuz belgisi yetarlicha olinmadi. Yuz kattaroq va aniqroq ko‘rinadigan boshqa rasm yuklang.');
  return { samples: kept.slice(0, 8), photo };
}

/** Mean of several descriptors of the same face (steadier than one frame). */
export function averageDescriptor(list: number[][]): number[] {
  return list[0].map((_, i) => Number((list.reduce((s, d) => s + d[i], 0) / list.length).toFixed(6)));
}

/** A small JPEG of the current frame (for the manager to settle disputes). */
export function snapshot(video: HTMLVideoElement, width = 240): string {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = Math.round((video.videoHeight / video.videoWidth) * width) || width;
  canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.7);
}

export type Challenge = 'BLINK' | 'TURN_LEFT' | 'TURN_RIGHT';
export const CHALLENGE_TEXT: Record<Challenge, string> = {
  BLINK: 'Ko‘zingizni qisib, oching',
  TURN_LEFT: 'Boshingizni sekin chapga buring',
  TURN_RIGHT: 'Boshingizni sekin o‘ngga buring'
};

/** Two random steps, always including a blink: a photo cannot blink, a replayed video does not know the order. */
export function randomChallenges(): Challenge[] {
  const turn: Challenge = Math.random() < 0.5 ? 'TURN_LEFT' : 'TURN_RIGHT';
  return Math.random() < 0.5 ? ['BLINK', turn] : [turn, 'BLINK'];
}

/** Watches frames for one step. Blink: eyes clearly open → closed → open. Turn: head clearly to one side. */
export class ChallengeTracker {
  private sawOpen = false;
  private sawClosed = false;
  private baseYaw: number | null = null;
  constructor(public step: Challenge) {}
  feed(f: FaceFrame): boolean {
    if (this.step === 'BLINK') {
      if (f.ear > 0.26) { if (this.sawClosed) return true; this.sawOpen = true; }
      if (this.sawOpen && f.ear < 0.19) this.sawClosed = true;
      return false;
    }
    if (this.baseYaw === null) { this.baseYaw = f.yaw; return false; }
    const moved = f.yaw - this.baseYaw;
    // The selfie camera mirrors: "left" for the person is a positive shift here on most phones; either clear turn
    // in the asked direction counts, judged against where the head started.
    return this.step === 'TURN_LEFT' ? moved > 0.18 : moved < -0.18;
  }
}
