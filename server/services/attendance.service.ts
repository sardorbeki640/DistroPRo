import fs from 'node:fs';
import path from 'node:path';
import { db } from '../db/database.ts';
import type { AttendanceEvent, AttendanceSettings, DisciplineRule, StartSource, ViolationType, WorkGroup, WorkSchedule } from '../db/schema.ts';
import { AuditService } from './audit.service.ts';
import { NotificationService } from './notification.service.ts';
import { escapeHtml } from './telegram.service.ts';
import { businessToday } from '../utils/date.ts';
import { activeDistribution } from '../integrations/distribution.ts';
import { StaffBotService } from './staff-bot.service.ts';
import { SheetsService } from './sheets.service.ts';

const DEFAULT_SCHEDULE: WorkSchedule = { start: '09:00', end: '18:00', grace_minutes: 10, workdays: [1, 2, 3, 4, 5, 6] };

/** The company rule book (NDGroup2026) as the starting point; every number can be changed in the settings. */
export const DEFAULT_RULES: DisciplineRule[] = [
  { type: 'LATE', label: 'Ishga kech qolish / kech boshlash', percent: 0.5, threshold: 0, percent_after: 0.5, active: true, excuses_allowed: false },
  { type: 'ABSENT', label: 'Ruxsatsiz, javob so‘ramasdan ishga chiqmaslik', percent: 2, threshold: 0, percent_after: 2, active: true, excuses_allowed: true },
  { type: 'NASIYA_MISUSE', label: 'Nasiya pulini so‘ramasdan ishlatib qo‘yish', percent: 4, threshold: 0, percent_after: 4, active: true, excuses_allowed: false },
  { type: 'TASK_LATE', label: 'Aytilgan vazifani o‘z vaqtida bajarmaslik', percent: 0.5, threshold: 0, percent_after: 0.5, active: true, excuses_allowed: false }
];
export const DEFAULT_GROUPS: WorkGroup[] = [
  { id: 'grp-sklad', name: 'Sklad / dostavchiklar', start_from: '07:30', start_to: '10:00', end: '18:00', workdays: [1, 2, 3, 4, 5, 6], source: 'FACE_ID' },
  { id: 'grp-agent', name: 'Agentlar', start_from: '08:00', start_to: '09:30', end: '18:00', workdays: [1, 2, 3, 4, 5, 6], source: 'SALESDOC_VISIT' }
];
export const VIOLATION_LABEL: Record<ViolationType, string> = { LATE: 'Kech qolish', ABSENT: 'Ishga chiqmaslik', NASIYA_MISUSE: 'Nasiya pulini ishlatish', TASK_LATE: 'Vazifa bajarilmadi', OTHER: 'Boshqa' };

/** How an employee's day is judged: start deadline (late after start + grace), end, workdays and where the start comes from. */
type Plan = WorkSchedule & { source: StartSource; group: WorkGroup | null };
const START_SOURCES: StartSource[] = ['FACE_ID', 'SALESDOC_VISIT', 'TELEGRAM_VIDEO'];
export const START_SOURCE_LABEL: Record<StartSource, string> = { FACE_ID: 'Face ID', SALESDOC_VISIT: 'Birinchi vizit', TELEGRAM_VIDEO: 'Dumaloq video' };
const DESCRIPTOR_LENGTH = 128;
const MAX_PHOTO_BYTES = 400 * 1024;
/** A stored photo path (relative to the data folder; older Windows rows use "\") as an absolute path on this system. */
const dataFile = (rel: string) => path.resolve(db.directory, ...rel.split(/[\\/]/));
const POOR_GPS_M = 150;        // a reading less exact than this goes to review
const MAX_ZONE_ACCURACY_M = 60; // with zones enforced, a reading vaguer than this (or than the radius) is refused
const BORDERLINE = 0.9;        // a face distance above threshold × this goes to review
const PHOTO_SLACK = 0.1;       // photo-made profiles: up to threshold + this goes to review instead of rejection

const tz = (iso: string) => {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tashkent', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find(p => p.type === t)?.value || '';
  return { hhmm: `${get('hour')}:${get('minute')}`, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
};
const toMinutes = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const weekday = (date: string) => { const d = new Date(`${date}T12:00:00Z`).getUTCDay(); return d === 0 ? 7 : d; };

/** Distance in metres between two GPS points (haversine). */
export function gpsDistance(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const r = 6371000, rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad, dLng = (bLng - aLng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * r * Math.asin(Math.sqrt(h)));
}

/** Euclidean distance of two face descriptors (face-api: same person usually < 0.45). */
export function faceDistance(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
  return Math.sqrt(s);
}

function checkDescriptor(d: unknown): number[] {
  if (!Array.isArray(d) || d.length !== DESCRIPTOR_LENGTH || d.some(v => typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > 1)) {
    throw new Error('Yuz ma’lumoti noto‘g‘ri. Sahifani yangilab, qayta urinib ko‘ring.');
  }
  return d as number[];
}

export class AttendanceService {
  static settings(company_id: string): AttendanceSettings {
    const s = db.findOne('attendance_settings', x => x.company_id === company_id);
    // Settings saved before the rule book existed get it (and switch to it unless another penalty was chosen).
    if (s && !s.rules) {
      return db.update('attendance_settings', s.id, {
        rules: DEFAULT_RULES, groups: DEFAULT_GROUPS, employee_groups: {}, agent_links: {},
        ...(s.penalty.mode === 'NONE' ? { penalty: { ...s.penalty, mode: 'RULES' as const }, rules_since: businessToday() } : {})
      } as any)!;
    }
    if (s) return s;
    return db.insert('attendance_settings', {
      id: `att-set-${company_id}`, company_id, default_schedule: DEFAULT_SCHEDULE, schedules: {},
      penalty: { mode: 'RULES', amount: 0, early_leave: false, monthly_cap: 0 }, zones: [], require_zone: false,
      match_threshold: 0.45, store_photos: true,
      rules: DEFAULT_RULES, groups: DEFAULT_GROUPS, employee_groups: {}, agent_links: {}, rules_since: businessToday()
    } as any);
  }

  /** The employee's day plan: their group's start window (late after its end) or the default schedule. */
  static planOf(s: AttendanceSettings, employee_id: string): Plan {
    const group = (s.groups || []).find(g => g.id === s.employee_groups?.[employee_id]) || null;
    // The admin may set one employee's way of marking the start apart from their group (e.g. one courier by video).
    const method = s.employee_methods?.[employee_id];
    if (group) return { start: group.start_to, end: group.end, grace_minutes: 0, workdays: group.workdays, source: method || group.source, group };
    return { ...this.scheduleOf(s, employee_id), source: method || 'FACE_ID', group: null };
  }

  static saveSettings(company_id: string, input: Partial<AttendanceSettings>, actor: { id: string; email: string }) {
    const current = this.settings(company_id);
    const schedule = (s: any): WorkSchedule => {
      if (!/^\d{2}:\d{2}$/.test(s?.start) || !/^\d{2}:\d{2}$/.test(s?.end) || toMinutes(s.end) <= toMinutes(s.start)) throw new Error('Ish vaqti noto‘g‘ri: boshlanishi tugashidan oldin bo‘lsin (masalan 09:00 – 18:00).');
      const grace = Number(s.grace_minutes);
      if (!Number.isInteger(grace) || grace < 0 || grace > 120) throw new Error('Kechikishga ruxsat 0–120 daqiqa bo‘lsin.');
      const workdays = Array.from(new Set((s.workdays || []).map(Number).filter((d: number) => d >= 1 && d <= 7))).sort() as number[];
      if (!workdays.length) throw new Error('Kamida bitta ish kuni tanlang.');
      return { start: s.start, end: s.end, grace_minutes: grace, workdays };
    };
    const next: Partial<AttendanceSettings> = { updated_at: new Date().toISOString() };
    if (input.default_schedule) next.default_schedule = schedule(input.default_schedule);
    if (input.schedules) next.schedules = Object.fromEntries(Object.entries(input.schedules).filter(([, s]) => s).map(([id, s]) => [id, schedule(s)]));
    if (input.penalty) {
      const p = input.penalty;
      if (!['NONE', 'FIXED', 'PER_MINUTE', 'RULES'].includes(p.mode)) throw new Error('Jarima turi noto‘g‘ri.');
      if (!(Number(p.amount) >= 0) || !(Number(p.monthly_cap) >= 0)) throw new Error('Jarima summasi manfiy bo‘lmasin.');
      next.penalty = { mode: p.mode, amount: Math.round(Number(p.amount)), early_leave: !!p.early_leave, monthly_cap: Math.round(Number(p.monthly_cap)) };
      if (p.mode === 'RULES' && current.penalty.mode !== 'RULES') (next as any).rules_since = businessToday();
    }
    if (input.rules) {
      next.rules = input.rules.map(r => {
        if (!VIOLATION_LABEL[r.type]) throw new Error('Qoida turi noto‘g‘ri.');
        const pct = (v: any, what: string) => { const n = Number(v); if (!(n >= 0 && n <= 100)) throw new Error(`${r.label || r.type}: ${what} 0–100% oralig‘ida bo‘lsin.`); return Math.round(n * 100) / 100; };
        // Every occurrence costs `percent`; the old step fields are kept as 0 (no longer used).
        const percent = pct(r.percent, 'foiz');
        return { type: r.type, label: String(r.label || VIOLATION_LABEL[r.type]).trim().slice(0, 120), percent, threshold: 0, percent_after: percent, active: !!r.active, excuses_allowed: !!r.excuses_allowed };
      });
    }
    if (input.groups) {
      next.groups = input.groups.map((g, i) => {
        if (!g.name?.trim()) throw new Error(`${i + 1}-guruh nomini yozing.`);
        if (![g.start_from, g.start_to, g.end].every(t => /^\d{2}:\d{2}$/.test(t)) || toMinutes(g.start_to) < toMinutes(g.start_from) || toMinutes(g.end) <= toMinutes(g.start_to)) throw new Error(`${g.name}: vaqtlar noto‘g‘ri (boshlash oynasi tugashdan oldin bo‘lsin).`);
        const workdays = Array.from(new Set((g.workdays || []).map(Number).filter(d => d >= 1 && d <= 7))).sort();
        if (!workdays.length) throw new Error(`${g.name}: ish kunlarini tanlang.`);
        if (!START_SOURCES.includes(g.source)) throw new Error(`${g.name}: ish boshlash qayerdan olinishi tanlanmagan.`);
        return { id: g.id || `grp-${Date.now()}-${i}`, name: g.name.trim(), start_from: g.start_from, start_to: g.start_to, end: g.end, workdays, source: g.source };
      });
    }
    if (input.employee_groups) next.employee_groups = Object.fromEntries(Object.entries(input.employee_groups).filter(([, g]) => !!g));
    if (input.agent_links) next.agent_links = Object.fromEntries(Object.entries(input.agent_links).filter(([, a]) => !!a));
    if (input.employee_methods) next.employee_methods = Object.fromEntries(Object.entries(input.employee_methods).filter(([, m]) => START_SOURCES.includes(m as StartSource))) as Record<string, StartSource>;
    if (input.zones) {
      next.zones = input.zones.map((z, i) => {
        if (!z.name?.trim() || !Number.isFinite(z.lat) || !Number.isFinite(z.lng) || Math.abs(z.lat) > 90 || Math.abs(z.lng) > 180) throw new Error(`${i + 1}-hudud: nom va to‘g‘ri koordinata kiriting.`);
        const radius = Math.round(Number(z.radius_m));
        if (!(radius >= 30 && radius <= 50000)) throw new Error(`${z.name}: radius 30 m – 50 km oralig‘ida bo‘lsin.`);
        const employee_ids = Array.from(new Set((z.employee_ids || []).filter(id => db.findById('employees', id)?.company_id === company_id)));
        return {
          id: z.id || `zone-${Date.now()}-${i}`, name: z.name.trim().slice(0, 80), lat: z.lat, lng: z.lng, radius_m: radius,
          active: z.active !== false, employee_ids, address: String(z.address || '').trim().slice(0, 200)
        };
      });
    }
    if (input.require_zone !== undefined) next.require_zone = !!input.require_zone;
    if (input.store_photos !== undefined) next.store_photos = !!input.store_photos;
    if (input.match_threshold !== undefined) {
      const t = Number(input.match_threshold);
      if (!(t >= 0.3 && t <= 0.6)) throw new Error('Yuz mosligi chegarasi 0.30–0.60 oralig‘ida bo‘lsin.');
      next.match_threshold = t;
    }
    const saved = db.update('attendance_settings', current.id, next)!;
    AuditService.log({ company_id, user_id: actor.id, user_email: actor.email, action: 'UPDATE', entity: 'AttendanceSettings', entity_id: current.id, old_value: { default_schedule: current.default_schedule, penalty: current.penalty, zones: current.zones.length }, new_value: { default_schedule: saved.default_schedule, penalty: saved.penalty, zones: saved.zones.length }, reason: 'Davomat sozlamalari o‘zgartirildi' });
    return saved;
  }

  static scheduleOf(s: AttendanceSettings, employee_id: string): WorkSchedule {
    return s.schedules?.[employee_id] || s.default_schedule;
  }

  /** Enrolls (or re-enrolls) a face from several live samples taken with the employee present, with their consent. */
  static enroll(company_id: string, employee_id: string, samples: unknown[], consent: boolean, actor: { id: string; email: string }, extra: { photo?: string | null; source?: 'CAMERA' | 'PHOTO' } = {}) {
    const employee = db.findById('employees', employee_id);
    if (!employee || employee.company_id !== company_id) throw new Error('Xodim topilmadi.');
    if (!consent) throw new Error('Xodimning biometrik ma’lumotiga yozma roziligi belgilanmagan.');
    if (!Array.isArray(samples) || samples.length < 3 || samples.length > 8) throw new Error('Kamida 3 ta yuz namunasi kerak.');
    const descriptors = samples.map(checkDescriptor);
    // The samples must be one person: a stranger passing in front of the camera spoils the profile.
    for (let i = 1; i < descriptors.length; i++) {
      if (faceDistance(descriptors[0], descriptors[i]) > 0.5) throw new Error('Namunalar bir-biriga mos emas (kadrga boshqa odam tushgan bo‘lishi mumkin). Qaytadan oling.');
    }
    const now = new Date().toISOString();
    const existing = db.findOne('face_profiles', p => p.company_id === company_id && p.employee_id === employee_id);
    // The reference portrait replaces the previous one; without a new one the old one stays.
    let photo_file = existing?.photo_file || null;
    const jpeg = this.jpegBytes(extra.photo);
    if (jpeg) {
      const rel = path.posix.join('face-photos', `${employee_id}.jpg`);
      const abs = path.join(db.directory, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, jpeg);
      photo_file = rel;
    }
    const source = extra.source === 'PHOTO' ? 'PHOTO' as const : 'CAMERA' as const;
    if (existing) db.update('face_profiles', existing.id, { descriptors, consent_at: now, consent_by: actor.id, enrolled_at: now, enrolled_by: actor.id, updated_at: now, photo_file, source });
    else db.insert('face_profiles', { id: `face-${employee_id}`, company_id, employee_id, descriptors, consent_at: now, consent_by: actor.id, enrolled_at: now, enrolled_by: actor.id, photo_file, source });
    AuditService.log({ company_id, user_id: actor.id, user_email: actor.email, action: existing ? 'UPDATE' : 'CREATE', entity: 'FaceProfile', entity_id: employee_id, old_value: null, new_value: { samples: descriptors.length, consent: true }, reason: `Face ID ro‘yxatga olindi: ${employee.full_name}` });
    return { employee_id, samples: descriptors.length };
  }

  /** Agents of the connected distribution system (any system), to link with employees. */
  static agentList(company_id: string) {
    const d = activeDistribution(company_id);
    return db.find('agents', a => a.company_id === company_id && !!a.code && (d ? a.source_integration_id === d.integration.id || (!a.source_integration_id && /^d\d+_\d+$/.test(String(a.code))) : true))
      .map(a => ({ id: a.id, name: a.full_name, code: a.code }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  static profiles(company_id: string) {
    return db.find('face_profiles', p => p.company_id === company_id).map(p => ({ employee_id: p.employee_id, samples: p.descriptors.length, enrolled_at: p.enrolled_at, consent_at: p.consent_at, has_photo: !!p.photo_file, source: p.source || 'CAMERA' }));
  }

  /**
   * Is the phone at a work place? With "Face ID only at the work place" on (require_zone) and at least one zone, the
   * reading must be inside a zone's radius (no allowance added) and exact enough to tell; otherwise Face ID is refused.
   */
  static zoneVerdict(s: AttendanceSettings, lat: unknown, lng: unknown, accuracy: unknown, employeeId?: string) {
    // Switched-off places do not count; a place limited to some employees counts only for them.
    const active = s.zones.filter(z => z.active !== false);
    const mine = active.filter(z => !z.employee_ids?.length || !employeeId || z.employee_ids.includes(employeeId));
    const strict = !!s.require_zone && active.length > 0;
    const hasGps = Number.isFinite(lat) && Number.isFinite(lng);
    if (strict && !mine.length) {
      return { strict, ok: false, zone: null, distance_m: null as number | null, message: 'Sizga Face ID qilinadigan ish joyi biriktirilmagan — rahbarga murojaat qiling.' };
    }
    if (!hasGps) {
      return { strict, ok: !strict, zone: null, distance_m: null as number | null, message: 'Joylashuv aniqlanmadi — telefonda GPS ni yoqing va brauzerga joylashuvga ruxsat bering. Face ID faqat ish joyida qilinadi.' };
    }
    let nearest: { id: string; name: string; distance: number; radius: number } | null = null;
    for (const z of mine) {
      const d = gpsDistance(Number(lat), Number(lng), z.lat, z.lng);
      if (!nearest || d - z.radius_m < nearest.distance - nearest.radius) nearest = { id: z.id, name: z.name, distance: d, radius: z.radius_m };
    }
    const acc = Math.round(Number(accuracy) || 0);
    const inside = !!nearest && nearest.distance <= nearest.radius;
    const zone = inside ? { id: nearest!.id, name: nearest!.name, distance: nearest!.distance } : null;
    if (!strict) return { strict, ok: true, zone, distance_m: nearest?.distance ?? null, message: '' };
    // A vague reading cannot prove the phone is inside a small circle.
    if (acc > Math.max(MAX_ZONE_ACCURACY_M, nearest!.radius)) {
      return { strict, ok: false, zone: null, distance_m: nearest!.distance, message: `GPS aniqligi past (±${acc} m) — ochiq joyga chiqing, 10–20 soniya kutib qayta urining.` };
    }
    if (!inside) {
      return { strict, ok: false, zone: null, distance_m: nearest!.distance, message: `Siz “${nearest!.name}”dan ${nearest!.distance} m uzoqdasiz — Face ID faqat ${nearest!.radius} m ichida qilinadi.` };
    }
    return { strict, ok: true, zone, distance_m: nearest!.distance, message: `“${nearest!.name}” hududidasiz (${nearest!.distance} m).` };
  }

  /** Before opening the camera: the employee's phone location against the work places. */
  static zoneCheck(company_id: string, user_id: string, lat: unknown, lng: unknown, accuracy: unknown) {
    const employee = this.employeeOfUser(company_id, user_id);
    if (!employee) throw new Error('Hisobingiz xodim kartasiga bog‘lanmagan. Rahbarga murojaat qiling.');
    const v = this.zoneVerdict(this.settings(company_id), lat, lng, accuracy, employee.id);
    return { ok: v.ok, strict: v.strict, distance_m: v.distance_m, message: v.message };
  }

  /** A small JPEG from a data URL, or null (wrong type, empty or too big). */
  private static jpegBytes(photo: unknown): Buffer | null {
    if (typeof photo !== 'string' || !photo.startsWith('data:image/jpeg;base64,')) return null;
    const bytes = Buffer.from(photo.slice('data:image/jpeg;base64,'.length), 'base64');
    return bytes.length > 0 && bytes.length <= MAX_PHOTO_BYTES && bytes[0] === 0xff && bytes[1] === 0xd8 ? bytes : null;
  }

  static profilePhotoPath(company_id: string, employee_id: string): string {
    const p = db.findOne('face_profiles', x => x.company_id === company_id && x.employee_id === employee_id);
    if (!p?.photo_file) throw Object.assign(new Error('Rasm yo‘q.'), { status: 404 });
    const abs = dataFile(p.photo_file);
    if (!abs.startsWith(path.resolve(db.directory)) || !fs.existsSync(abs)) throw Object.assign(new Error('Rasm topilmadi.'), { status: 404 });
    return abs;
  }

  static removeProfile(company_id: string, employee_id: string, actor: { id: string; email: string }) {
    const p = db.findOne('face_profiles', x => x.company_id === company_id && x.employee_id === employee_id);
    if (!p) throw new Error('Face ID profili yo‘q.');
    db.delete('face_profiles', p.id);
    // Removing a profile removes the biometric data entirely, the portrait included.
    if (p.photo_file) { try { fs.unlinkSync(dataFile(p.photo_file)); } catch { /* already gone */ } }
    AuditService.log({ company_id, user_id: actor.id, user_email: actor.email, action: 'DELETE', entity: 'FaceProfile', entity_id: employee_id, old_value: { enrolled_at: p.enrolled_at }, new_value: null, reason: 'Face ID profili o‘chirildi (biometrik ma’lumot yo‘q qilindi)' });
  }

  static employeeOfUser(company_id: string, user_id: string) {
    const user = db.findById('users', user_id);
    const employee = user?.employee_id ? db.findById('employees', user.employee_id) : db.findOne('employees', e => e.company_id === company_id && e.user_id === user_id);
    return employee && employee.company_id === company_id ? employee : null;
  }

  /**
   * A check-in or check-out from the phone: the face descriptor is compared with the enrolled ones on the server,
   * liveness, GPS accuracy and work zone are checked. Clear failures are REJECTED, doubtful ones go to REVIEW,
   * every attempt is kept (with a small selfie when enabled) so a manager can decide disputes.
   */
  static check(company_id: string, user: { id: string; email: string }, input: {
    type: 'IN' | 'OUT'; descriptor: unknown; liveness_passed: boolean; liveness_steps?: string[];
    lat?: number | null; lng?: number | null; accuracy_m?: number | null; photo?: string | null; device?: string | null;
  }, now = new Date()) {
    const employee = this.employeeOfUser(company_id, user.id);
    if (!employee) throw new Error('Hisobingiz xodim kartasiga bog‘lanmagan. Rahbarga murojaat qiling.');
    const profile = db.findOne('face_profiles', p => p.company_id === company_id && p.employee_id === employee.id);
    if (!profile || !profile.descriptors.length) throw new Error('Yuzingiz hali ro‘yxatdan o‘tmagan. Rahbar “Xodimlar → Face ID” orqali ro‘yxatga olsin.');
    if (input.type !== 'IN' && input.type !== 'OUT') throw new Error('Qayd turi noto‘g‘ri.');
    const descriptor = checkDescriptor(input.descriptor);
    const s = this.settings(company_id);
    if (input.type === 'IN' && this.planOf(s, employee.id).source === 'TELEGRAM_VIDEO') {
      throw new Error('Sizga ish boshlashni Telegram guruhiga dumaloq video tashlab belgilash tanlangan (Face ID emas).');
    }
    const at = now.toISOString();
    const date = businessToday(now);

    const recent = db.find('attendance_events', e => e.company_id === company_id && e.employee_id === employee.id && e.type === input.type && e.status !== 'REJECTED' && now.getTime() - Date.parse(e.at) < 2 * 60_000);
    if (recent.length) throw new Error('Bu qayd hozirgina qilingan.');

    const distance = Math.min(...profile.descriptors.map(d => faceDistance(d, descriptor)));
    const hasGps = Number.isFinite(input.lat) && Number.isFinite(input.lng);
    const place = this.zoneVerdict(s, input.lat, input.lng, input.accuracy_m, employee.id);
    let zone: { id: string; name: string; distance: number } | null = place.zone;
    if (!place.strict && hasGps && s.zones.length && !zone) {
      // Not enforced: the nearest zone within its radius plus the reading's uncertainty is noted.
      for (const z of s.zones.filter(z => z.active !== false)) {
        const d = gpsDistance(input.lat!, input.lng!, z.lat, z.lng);
        if (d <= z.radius_m + Math.min(Number(input.accuracy_m) || 0, 100) && (!zone || d < zone.distance)) zone = { id: z.id, name: z.name, distance: d };
      }
    }

    const reasons: string[] = [];
    let status: AttendanceEvent['status'] = 'ACCEPTED';
    // Face ID only at the work place: outside the zone the check is refused (the attempt is kept for the manager).
    if (place.strict && !place.ok) { status = 'REJECTED'; reasons.push(place.message); }
    if (!input.liveness_passed) { status = 'REJECTED'; reasons.push('tiriklik tekshiruvi o‘tmadi'); }
    // A profile made from an uploaded photo reads a little differently from a live camera: a near miss goes to the
    // manager instead of being refused outright.
    const photoSlack = profile.source === 'PHOTO' ? PHOTO_SLACK : 0;
    if (distance > s.match_threshold + photoSlack) { status = 'REJECTED'; reasons.push(`yuz mos kelmadi (${distance.toFixed(2)})`); }
    else if (distance > s.match_threshold) { status = 'REVIEW'; reasons.push(`yuz mosligi chegarada (${distance.toFixed(2)}, profil rasmdan olingan — kamera bilan qayta yozish tavsiya etiladi)`); }
    if (status !== 'REJECTED') {
      if (distance <= s.match_threshold && distance > s.match_threshold * BORDERLINE) { status = 'REVIEW'; reasons.push(`yuz mosligi chegarada (${distance.toFixed(2)})`); }
      if (!hasGps) { status = 'REVIEW'; reasons.push('GPS joylashuv berilmadi'); }
      else if ((Number(input.accuracy_m) || 0) > POOR_GPS_M) { status = 'REVIEW'; reasons.push(`GPS aniqligi past (±${Math.round(Number(input.accuracy_m))} m)`); }
    }

    const id = `att-${now.getTime()}-${Math.random().toString(36).slice(2, 6)}`;
    let photo_file: string | null = null;
    if (s.store_photos && typeof input.photo === 'string' && input.photo.startsWith('data:image/jpeg;base64,')) {
      const bytes = Buffer.from(input.photo.slice('data:image/jpeg;base64,'.length), 'base64');
      if (bytes.length > 0 && bytes.length <= MAX_PHOTO_BYTES && bytes[0] === 0xff && bytes[1] === 0xd8) {
        const rel = path.posix.join('attendance-photos', date.slice(0, 7), `${id}.jpg`);
        const abs = path.join(db.directory, rel);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, bytes);
        photo_file = rel;
      }
    }

    const event = db.insert('attendance_events', {
      id, company_id, employee_id: employee.id, type: input.type, at, date,
      lat: hasGps ? input.lat : null, lng: hasGps ? input.lng : null, accuracy_m: Number.isFinite(input.accuracy_m) ? Math.round(Number(input.accuracy_m)) : null,
      zone_id: zone?.id || null, zone_distance_m: zone?.distance ?? null, face_distance: Number(distance.toFixed(3)),
      liveness_passed: !!input.liveness_passed, liveness_steps: (input.liveness_steps || []).slice(0, 6),
      photo_file, status, review_reason: reasons.join('; ') || null, device: (input.device || '').slice(0, 120) || null, created_by: user.id, method: 'FACE_ID'
    });
    if (status === 'ACCEPTED' && input.type === 'IN') this.exportStart(company_id, employee.id, date, s);

    // Late arrival goes to the bots subscribed to it.
    const day = this.dayFor(s, employee.id, date, [event]);
    if (status === 'ACCEPTED' && input.type === 'IN' && day.late_minutes > 0 && day.first_in === tz(at).hhmm) {
      NotificationService.dispatchEvent(company_id, 'ATTENDANCE_LATE', `⏰ Kechikish: ${employee.full_name}`,
        `${escapeHtml(employee.full_name)} ${day.first_in} da keldi — <b>${day.late_minutes} daqiqa</b> kech (ish ${this.planOf(s, employee.id).start} da boshlanadi).${zone ? `\n📍 ${escapeHtml(zone.name)}` : hasGps ? `\n📍 https://maps.google.com/?q=${input.lat},${input.lng}` : ''}`);
      this.tellLate(company_id, employee.id, date, day.first_in!, day.late_minutes, s);
    }

    const label = input.type === 'IN' ? 'Kelish' : 'Ketish';
    return {
      event,
      message: status === 'ACCEPTED' ? `${label} qayd etildi: ${tz(at).hhmm}${zone ? ` (${zone.name})` : ''}.`
        : status === 'REVIEW' ? `${label} qayd etildi, lekin rahbar tekshiradi: ${reasons.join('; ')}.`
        : place.strict && !place.ok ? `Qayd qabul qilinmadi: ${place.message}`
        : `Qayd qabul qilinmadi: ${reasons.join('; ')}. Yorug‘ joyda, yuzingizni to‘liq ko‘rsatib qayta urinib ko‘ring.`
    };
  }

  /**
   * One employee's day: when work started (first accepted Face ID arrival, or for an agent the first visit in the connected system),
   * last departure, lateness (minutes after the start deadline) and early leave.
   * In the rule book, an excuse removes lateness only where the LATE rule accepts excuses.
   */
  static dayFor(s: AttendanceSettings, employee_id: string, date: string, extra: AttendanceEvent[] = []) {
    const plan = this.planOf(s, employee_id);
    const events = [...db.find('attendance_events', e => e.employee_id === employee_id && e.date === date), ...extra.filter(x => !db.findById('attendance_events', x.id))]
      .filter(e => e.status === 'ACCEPTED').sort((a, b) => a.at.localeCompare(b.at));
    const ins = events.filter(e => e.type === 'IN');
    const outs = events.filter(e => e.type === 'OUT');
    let firstIn = ins[0] ? tz(ins[0].at) : null;
    let visits: number | null = null;
    if (plan.source === 'SALESDOC_VISIT') {
      const agentId = s.agent_links?.[employee_id];
      const v = agentId ? db.findOne('agent_visit_days', x => x.agent_id === agentId && x.date === date) : null;
      visits = v?.visits ?? 0;
      if (v && (!firstIn || toMinutes(v.first_visit) < firstIn.minutes)) firstIn = { hhmm: v.first_visit, minutes: toMinutes(v.first_visit) };
    }
    const lastOut = outs.length ? tz(outs[outs.length - 1].at) : null;
    const workday = plan.workdays.includes(weekday(date));
    const excused = db.find('attendance_events', e => e.employee_id === employee_id && e.date === date && e.excused === true).length > 0;
    const rulesMode = s.penalty.mode === 'RULES';
    const lateExcusable = !rulesMode || (s.rules || []).find(r => r.type === 'LATE')?.excuses_allowed !== false;
    const startM = toMinutes(plan.start), endM = toMinutes(plan.end);
    const late = workday && !(excused && lateExcusable) && firstIn && firstIn.minutes > startM + plan.grace_minutes ? firstIn.minutes - startM : 0;
    const early = workday && !excused && lastOut && lastOut.minutes < endM - plan.grace_minutes ? endM - lastOut.minutes : 0;
    return {
      workday, excused, source: plan.source, group_name: plan.group?.name || null, visits,
      first_in: firstIn?.hhmm || null, last_out: lastOut?.hhmm || null, late_minutes: late, early_minutes: early,
      worked_minutes: firstIn && lastOut && lastOut.minutes > firstIn.minutes ? lastOut.minutes - firstIn.minutes : 0
    };
  }

  /** Employees whose attendance is tracked, from which date: a Face ID profile or a work group. */
  static tracked(company_id: string, s: AttendanceSettings, employee_id?: string): { employee_id: string; since: string }[] {
    const list = new Map<string, string>();
    for (const p of db.find('face_profiles', p => p.company_id === company_id)) list.set(p.employee_id, p.enrolled_at.slice(0, 10));
    const rulesSince = (s as any).rules_since || '2000-01-01';
    for (const id of Object.keys(s.employee_groups || {})) {
      const since = list.get(id);
      list.set(id, since && since < rulesSince ? since : (since || rulesSince));
    }
    return Array.from(list, ([id, since]) => ({ employee_id: id, since })).filter(x => !employee_id || x.employee_id === employee_id);
  }

  private static penaltyFor(s: AttendanceSettings, late: number, early: number) {
    const p = s.penalty;
    if (p.mode === 'NONE' || !p.amount) return 0;
    const minutes = late + (p.early_leave ? early : 0);
    if (p.mode === 'PER_MINUTE') return minutes * p.amount;
    return (late > 0 ? p.amount : 0) + (p.early_leave && early > 0 ? p.amount : 0);
  }

  /**
   * Day-by-day table for [from, to]: every employee with a Face ID profile on every workday (absent days included,
   * up to today), with lateness, early leave and the penalty by the rule. Penalties of a month never exceed its cap.
   */
  /** Raw day rows (no penalties) of one or all tracked employees in [from, to], up to today. */
  private static days(company_id: string, s: AttendanceSettings, from: string, to: string, employee_id?: string) {
    const today = businessToday();
    const names = new Map(db.find('employees', e => e.company_id === company_id).map(e => [e.id, e]));
    const rows: any[] = [];
    for (const t of this.tracked(company_id, s, employee_id)) {
      const emp = names.get(t.employee_id);
      if (!emp || emp.status === 'INACTIVE') continue;
      for (let d = from; d <= to && d <= today; d = new Date(Date.parse(`${d}T12:00:00Z`) + 86400000).toISOString().slice(0, 10)) {
        if (d < t.since) continue;
        const all = db.find('attendance_events', e => e.employee_id === t.employee_id && e.date === d);
        const day = this.dayFor(s, t.employee_id, d);
        if (!day.workday && !all.length && !day.first_in) continue;
        const review = all.some(e => e.status === 'REVIEW');
        rows.push({
          date: d, employee_id: t.employee_id, employee_name: emp.full_name, position: emp.position, ...day,
          // Today is not over: a missing start is "not yet", not an absence.
          status: day.excused && !day.first_in ? 'EXCUSED' : !day.first_in ? (day.workday ? (review ? 'REVIEW' : d === today ? 'WAITING' : 'ABSENT') : 'OFF') : (review ? 'REVIEW' : day.excused ? 'EXCUSED' : 'PRESENT'),
          review_count: all.filter(e => e.status === 'REVIEW').length,
          rejected_count: all.filter(e => e.status === 'REJECTED' && !e.excused).length,
          penalty: 0, penalty_percent: 0, violations: [] as string[]
        });
      }
    }
    return rows;
  }

  /**
   * The month's violations of one employee by the rule book, each with its percent: automatic lateness and absence
   * from the day rows, plus those entered by hand. Every occurrence costs the rule's `percent`, and they add up over
   * the month (3 times late at 0.5% = 1.5%). The old “up to N times, then another percent” step is no longer used.
   */
  static occurrences(company_id: string, employee_id: string, month: string, s = this.settings(company_id)) {
    const last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
    const rules = new Map((s.rules || []).filter(r => r.active).map(r => [r.type, r]));
    const list: { date: string; type: ViolationType; source: 'AUTO' | 'MANUAL'; id?: string; note?: string; minutes?: number; percent: number }[] = [];
    for (const r of this.days(company_id, s, `${month}-01`, last, employee_id)) {
      if (rules.has('LATE') && r.late_minutes > 0) list.push({ date: r.date, type: 'LATE', source: 'AUTO', minutes: r.late_minutes, percent: 0 });
      if (rules.has('ABSENT') && r.status === 'ABSENT') list.push({ date: r.date, type: 'ABSENT', source: 'AUTO', percent: 0 });
      // An excused day without a start is a permitted absence only where the rule accepts excuses.
      if (rules.has('ABSENT') && r.status === 'EXCUSED' && !r.first_in && rules.get('ABSENT')!.excuses_allowed === false) list.push({ date: r.date, type: 'ABSENT', source: 'AUTO', percent: 0 });
    }
    for (const v of db.find('discipline_violations', v => v.company_id === company_id && v.employee_id === employee_id && v.date.startsWith(month) && !v.cancelled_at)) {
      if (rules.has(v.type)) list.push({ date: v.date, type: v.type, source: 'MANUAL', id: v.id, note: v.note, percent: 0 });
    }
    list.sort((a, b) => a.date.localeCompare(b.date));
    for (const o of list) o.percent = rules.get(o.type)!.percent;
    return list;
  }

  /**
   * Day-by-day table for [from, to]: tracked employees on every workday (absences included, up to today), with
   * lateness, early leave and the penalty — money by the fixed / per-minute rule (with its monthly cap), or the
   * percent of salary by the rule book.
   */
  static report(company_id: string, from: string, to: string, employee_id?: string) {
    const s = this.settings(company_id);
    const rows = this.days(company_id, s, from, to, employee_id);
    if (s.penalty.mode === 'RULES') {
      const byKey = new Map(rows.map(r => [`${r.employee_id}|${r.date}`, r]));
      const done = new Set<string>();
      for (const r of rows) {
        const key = `${r.employee_id}|${r.date.slice(0, 7)}`;
        if (done.has(key)) continue;
        done.add(key);
        for (const o of this.occurrences(company_id, r.employee_id, r.date.slice(0, 7), s)) {
          const row = byKey.get(`${r.employee_id}|${o.date}`);
          if (!row) continue;
          row.penalty_percent = Math.round((row.penalty_percent + o.percent) * 100) / 100;
          row.violations.push(VIOLATION_LABEL[o.type]);
        }
      }
    } else {
      const capUsed = new Map<string, number>();
      for (const r of rows.sort((a, b) => a.date.localeCompare(b.date))) {
        let penalty = this.penaltyFor(s, r.late_minutes, r.early_minutes);
        if (s.penalty.monthly_cap > 0) {
          const key = `${r.employee_id}|${r.date.slice(0, 7)}`;
          const used = capUsed.get(key) || 0;
          penalty = Math.max(0, Math.min(penalty, s.penalty.monthly_cap - used));
          capUsed.set(key, used + penalty);
        }
        r.penalty = penalty;
      }
    }
    return rows.sort((a, b) => b.date.localeCompare(a.date) || a.employee_name.localeCompare(b.employee_name));
  }

  /**
   * Penalty of a month for payroll. Fixed / per-minute rules: a sum (`total`). Rule book: a percent of the month's
   * earned salary (`percent`), with each violation listed.
   */
  static monthPenalty(company_id: string, employee_id: string, month: string) {
    const s = this.settings(company_id);
    if (s.penalty.mode === 'RULES') {
      const items = this.occurrences(company_id, employee_id, month, s);
      return { mode: 'RULES' as const, total: 0, percent: Math.round(items.reduce((t, o) => t + o.percent, 0) * 100) / 100, items, days: [] as { date: string; late: number; early: number; penalty: number }[] };
    }
    const last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
    const rows = this.report(company_id, `${month}-01`, last, employee_id).filter(r => r.penalty > 0);
    return { mode: 'AMOUNT' as const, total: rows.reduce((t, r) => t + r.penalty, 0), percent: 0, items: [], days: rows.map(r => ({ date: r.date, late: r.late_minutes, early: r.early_minutes, penalty: r.penalty })) };
  }

  /**
   * A round video (Telegram video note) posted to the couriers' group: the moment Telegram received it is the start of
   * work. Only for employees whose way is "round video"; the day's first one counts, later ones are not recorded.
   */
  static recordVideo(company_id: string, employee_id: string, at: Date, tg: { chat_id: string; message_id: number; file_id?: string; duration?: number }) {
    const employee = db.findById('employees', employee_id);
    if (!employee || employee.company_id !== company_id || employee.status === 'INACTIVE') return { ok: false, message: 'Xodim kartasi topilmadi yoki nofaol.' };
    const s = this.settings(company_id);
    const plan = this.planOf(s, employee_id);
    if (plan.source !== 'TELEGRAM_VIDEO') {
      return { ok: false, message: `${employee.full_name}: sizga ish boshlash ${START_SOURCE_LABEL[plan.source]} orqali belgilanadi, video hisobga olinmaydi.` };
    }
    const date = businessToday(at);
    const before = this.dayFor(s, employee_id, date);
    // Later videos of the day are ignored quietly (no message in the group).
    if (before.first_in) return { ok: false, already: true, message: `${employee.full_name}: bugungi ish boshlash ${before.first_in} da qayd etilgan.` };
    const event = db.insert('attendance_events', {
      id: `att-tg-${tg.chat_id}-${tg.message_id}`, company_id, employee_id, type: 'IN', at: at.toISOString(), date,
      liveness_passed: false, liveness_steps: ['TELEGRAM_VIDEO'], status: 'ACCEPTED', review_reason: null,
      created_by: employee.user_id || 'telegram', method: 'TELEGRAM_VIDEO', telegram: tg
    });
    const day = this.dayFor(s, employee_id, date);
    if (day.late_minutes > 0) {
      NotificationService.dispatchEvent(company_id, 'ATTENDANCE_LATE', `⏰ Kechikish: ${employee.full_name}`,
        `${escapeHtml(employee.full_name)} dumaloq videoni ${day.first_in} da tashladi — <b>${day.late_minutes} daqiqa</b> kech (muddat ${plan.start}).`);
      this.tellLate(company_id, employee_id, date, day.first_in!, day.late_minutes, s);
    }
    this.exportStart(company_id, employee_id, date, s);
    return { ok: true, event, late_minutes: day.late_minutes, message: day.late_minutes > 0
      ? `⏰ ${employee.full_name} — ish ${day.first_in} da boshlandi, ${day.late_minutes} daqiqa kech.`
      : `✅ ${employee.full_name} — ish ${day.first_in} da boshlandi.` };
  }

  /**
   * Every violation to one shared company Google Sheet, “Jarimalar” (once each): automatic lateness and absence and
   * those a manager entered, with the percent and the month's total so far. An absence goes once its day is over. The
   * current month is covered (and the last one in the first days of a month, so its last days are not missed).
   */
  static exportPenalties(now = new Date(), company_id?: string) {
    const today = businessToday(now);
    const months = [today.slice(0, 7)];
    if (Number(today.slice(8, 10)) <= 3) months.unshift(new Date(Date.parse(`${today.slice(0, 8)}01T12:00:00Z`) - 86_400_000).toISOString().slice(0, 7));
    let queued = 0;
    for (const s of db.find('attendance_settings', x => (!company_id || x.company_id === company_id) && !!x.sheets?.enabled && !!x.sheets.url)) {
      const names = new Map(db.find('employees', e => e.company_id === s.company_id).map(e => [e.id, e]));
      const stamp = now.toLocaleString('ru-RU', { timeZone: 'Asia/Tashkent' });
      const ids = new Set([...this.tracked(s.company_id, s).map(t => t.employee_id), ...db.find('discipline_violations', v => v.company_id === s.company_id && months.some(m => v.date.startsWith(m))).map(v => v.employee_id)]);
      for (const employee_id of ids) {
        const e = names.get(employee_id);
        if (!e) continue;
        const group = this.planOf(s, employee_id).group?.name || '';
        for (const month of months) {
          let total = 0;
          const isRuleMode = s.penalty.mode === 'RULES';
          const entries = isRuleMode
            ? this.occurrences(s.company_id, employee_id, month, s).map(o => ({ ...o, fine: o.percent, running: 0, label: (s.rules || []).find(r => r.type === o.type)?.label || VIOLATION_LABEL[o.type], detail: o.minutes ? `${o.minutes} daqiqa kech` : o.note || '', automatic: o.source !== 'MANUAL' }))
            : this.report(s.company_id, `${month}-01`, new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10), employee_id).filter(o => o.penalty > 0).map(o => ({ date: o.date, type: o.late_minutes ? 'LATE' as const : 'ABSENT' as const, id: undefined, fine: o.penalty, running: 0, label: o.violations?.join(', ') || 'Davomat jarimasi', detail: o.late_minutes ? `${o.late_minutes} daqiqa kech` : 'Davomat qoidasi', automatic: true }));
          for (const o of entries) {
            if (o.type === 'ABSENT' && o.date >= today) continue;
            total = Math.round((total + o.fine) * 100) / 100;
            if (SheetsService.queue(s.company_id, `${isRuleMode ? 'pen' : 'penamt'}:${employee_id}:${o.date}:${o.type}:${o.id || 'auto'}`, 'Jarimalar', [
              o.date.split('-').reverse().join('.'), e.full_name, e.position || '', group, o.label, o.detail,
              o.fine, total, o.automatic ? 'Avtomatik' : 'Rahbar kiritgan', stamp
            ])) queued++;
          }
        }
      }
    }
    return { queued };
  }

  /** The day's start of one employee goes to the company's Google Sheet (once per employee and day). */
  static exportStart(company_id: string, employee_id: string, date: string, s = this.settings(company_id)) {
    if (!s.sheets?.enabled || !s.sheets.url) return;
    const day = this.dayFor(s, employee_id, date);
    const employee = db.findById('employees', employee_id);
    if (!day.first_in || !employee) return;
    const plan = this.planOf(s, employee_id);
    SheetsService.queue(company_id, `${employee_id}:${date}`, `Davomat ${date.slice(0, 7)}`, [
      date.split('-').reverse().join('.'), employee.full_name, employee.position || '', plan.group?.name || '',
      START_SOURCE_LABEL[plan.source], day.first_in, plan.start, day.late_minutes, day.late_minutes > 0 ? 'Kechikdi' : 'O‘z vaqtida',
      new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Tashkent' })
    ]);
  }

  /** The late employee is told in their own Telegram: by how much, and what this lateness costs by the rules. */
  static tellLate(company_id: string, employee_id: string, date: string, started: string, minutes: number, s = this.settings(company_id)) {
    let cost = '';
    if (s.penalty.mode === 'RULES') {
      const lates = this.occurrences(company_id, employee_id, date.slice(0, 7), s).filter(o => o.type === 'LATE');
      const mine = lates.find(o => o.date === date);
      if (mine) cost = `\nBu oydagi ${lates.indexOf(mine) + 1}-kechikish: oylikdan <b>${mine.percent}%</b> ushlanadi.`;
    } else if (s.penalty.mode !== 'NONE' && s.penalty.amount) {
      cost = `\nJarima: ${s.penalty.mode === 'PER_MINUTE' ? `${minutes} × ${s.penalty.amount.toLocaleString('ru-RU')}` : s.penalty.amount.toLocaleString('ru-RU')} so‘m.`;
    }
    StaffBotService.notify(company_id, { employee_id }, 'LATE', '⏰ Kechikdingiz',
      `Bugun ish ${started} da boshlandi — <b>${minutes} daqiqa</b> kech (muddat ${this.planOf(s, employee_id).start}).${cost}`, date);
  }

  /** A violation entered by a manager (nasiya money used without asking, a task not done on time, …). */
  static addViolation(company_id: string, input: { employee_id: string; date: string; type: ViolationType; note: string }, actor: { id: string; email: string }) {
    const employee = db.findById('employees', input.employee_id);
    if (!employee || employee.company_id !== company_id) throw new Error('Xodim topilmadi.');
    const rule = (this.settings(company_id).rules || []).find(r => r.type === input.type && r.active);
    if (!rule) throw new Error('Bu qoida yoqilmagan.');
    if (!input.note || input.note.trim().length < 3) throw new Error('Nima bo‘lganini qisqa yozing.');
    if (input.date > businessToday()) throw new Error('Kelajak sanasi bo‘lmaydi.');
    const v = db.insert('discipline_violations', { id: `viol-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, company_id, employee_id: input.employee_id, date: input.date, type: input.type, note: input.note.trim().slice(0, 300), created_by: actor.id, created_at: new Date().toISOString() });
    AuditService.log({ company_id, user_id: actor.id, user_email: actor.email, action: 'CREATE', entity: 'DisciplineViolation', entity_id: v.id, old_value: null, new_value: { employee: employee.full_name, date: v.date, type: v.type }, reason: `${rule.label}: ${employee.full_name} — ${v.note}` });
    const percent = this.occurrences(company_id, employee.id, v.date.slice(0, 7)).find(o => o.id === v.id)?.percent;
    StaffBotService.notify(company_id, { employee_id: employee.id }, 'VIOLATION', `⚠️ Qoidabuzarlik: ${rule.label}`,
      `${v.date.split('-').reverse().join('.')}: ${escapeHtml(v.note)}${percent ? `\nOylikdan <b>${percent}%</b> ushlanadi.` : ''}\nE’tirozingiz bo‘lsa rahbarga ayting.`);
    return v;
  }

  static cancelViolation(company_id: string, id: string, reason: string, actor: { id: string; email: string }) {
    const v = db.findById('discipline_violations', id);
    if (!v || v.company_id !== company_id || v.cancelled_at) throw new Error('Qoidabuzarlik topilmadi.');
    if (!reason || reason.trim().length < 3) throw new Error('Bekor qilish sababini yozing.');
    db.update('discipline_violations', id, { cancelled_at: new Date().toISOString(), cancelled_by: actor.id, cancel_reason: reason.trim() });
    AuditService.log({ company_id, user_id: actor.id, user_email: actor.email, action: 'CANCEL', entity: 'DisciplineViolation', entity_id: id, old_value: { type: v.type, date: v.date }, new_value: null, reason: `Qoidabuzarlik bekor qilindi: ${reason.trim()}` });
    StaffBotService.notify(company_id, { employee_id: v.employee_id }, 'VIOLATION', '✅ Qoidabuzarlik bekor qilindi',
      `${v.date.split('-').reverse().join('.')}: ${escapeHtml(VIOLATION_LABEL[v.type])} — ushlanma olib tashlandi.\nSabab: ${escapeHtml(reason.trim())}`);
    StaffBotService.postPenaltyCancelled(company_id, v, reason.trim());
    // Already in the sheet: a "cancelled" row under it (rows are only appended there).
    if (db.findById('sheet_rows', `${company_id}:pen:${v.employee_id}:${v.date}:${v.type}:${v.id}`)) {
      const e = db.findById('employees', v.employee_id);
      const rule = (this.settings(company_id).rules || []).find(r => r.type === v.type);
      SheetsService.queue(company_id, `pencx:${v.id}`, 'Jarimalar', [
        v.date.split('-').reverse().join('.'), e?.full_name || '', e?.position || '', this.planOf(this.settings(company_id), v.employee_id).group?.name || '',
        VIOLATION_LABEL[v.type], `Bekor qilindi: ${reason.trim()}`, rule?.percent || 0, '', 'BEKOR QILINDI', new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Tashkent' })
      ]);
    }
  }

  /** Where violations are posted: work group chats, each employee's own chat (an agent's group), and the chats to choose from. */
  static penaltyPostsView(company_id: string) {
    const s = this.settings(company_id);
    const names = new Map(db.find('employees', e => e.company_id === company_id).map(e => [e.id, e]));
    return {
      config: s.penalty_posts || { enabled: false, since: '', groups: {}, employees: {} },
      rules_mode: s.penalty.mode === 'RULES',
      ...StaffBotService.groupChats(company_id),
      groups: (s.groups || []).map(g => ({ id: g.id, name: g.name })),
      employees: this.tracked(company_id, s).map(t => ({ id: t.employee_id, name: names.get(t.employee_id)?.full_name || t.employee_id, position: names.get(t.employee_id)?.position || '', group: this.planOf(s, t.employee_id).group?.name || null }))
    };
  }

  static savePenaltyPosts(company_id: string, input: { enabled: boolean; groups: Record<string, string>; employees: Record<string, string> }, actor: { id: string; email: string }) {
    const s = this.settings(company_id);
    const chatId = (v: unknown) => /^-?\d{3,20}$/.test(String(v || '').trim()) ? String(v).trim() : null;
    const clean = (m: Record<string, string>) => Object.fromEntries(Object.entries(m || {}).map(([k, v]) => [k, chatId(v)]).filter(([, v]) => v)) as Record<string, string>;
    const next = {
      enabled: !!input.enabled,
      // Turned on now: violations from today are posted, not the whole month at once.
      since: input.enabled && !s.penalty_posts?.enabled ? businessToday() : (s.penalty_posts?.since || businessToday()),
      groups: clean(input.groups), employees: clean(input.employees)
    };
    if (next.enabled && !Object.keys(next.groups).length && !Object.keys(next.employees).length) throw new Error('Kamida bitta guruh tanlang.');
    if (next.enabled && !StaffBotService.personalBot(company_id)) throw new Error('Avval xodimlar botini ulang: Sozlamalar → Telegram botlar → “Xodimlarga shaxsiy eslatmalar”.');
    db.update('attendance_settings', s.id, { penalty_posts: next } as any);
    AuditService.log({ company_id, user_id: actor.id, user_email: actor.email, action: 'UPDATE', entity: 'AttendanceSettings', entity_id: s.id, old_value: s.penalty_posts || null, new_value: next, reason: 'Jarimalarni Telegram guruhlarga yuborish sozlandi' });
    return this.penaltyPostsView(company_id);
  }

  static violations(company_id: string, month: string) {
    const names = new Map(db.find('employees', e => e.company_id === company_id).map(e => [e.id, e.full_name]));
    const s = this.settings(company_id);
    const tracked = new Set([...this.tracked(company_id, s).map(t => t.employee_id), ...db.find('discipline_violations', v => v.company_id === company_id && v.date.startsWith(month)).map(v => v.employee_id)]);
    const out: any[] = [];
    for (const id of tracked) {
      for (const o of this.occurrences(company_id, id, month, s)) out.push({ ...o, employee_id: id, employee_name: names.get(id) || id, label: VIOLATION_LABEL[o.type] });
    }
    // Cancelled manual ones are listed too (for the record).
    for (const v of db.find('discipline_violations', v => v.company_id === company_id && v.date.startsWith(month) && !!v.cancelled_at)) {
      out.push({ date: v.date, type: v.type, source: 'MANUAL', id: v.id, note: v.note, percent: 0, cancelled: true, cancel_reason: v.cancel_reason, employee_id: v.employee_id, employee_name: names.get(v.employee_id) || v.employee_id, label: VIOLATION_LABEL[v.type] });
    }
    return out.sort((a, b) => b.date.localeCompare(a.date));
  }

  /**
   * First visit of each linked agent per day from the connected distribution system: the agent's start of work.
   * New lateness of today is sent to the bots once.
   */
  static async syncVisits(company_id: string, from: string, to: string, adapter?: any) {
    const s = this.settings(company_id);
    const links = s.agent_links || {};
    if (!Object.keys(links).length) return { days: 0 };
    const d = activeDistribution(company_id);
    if (!d) throw new Error('Distribyutor tizimi ulanmagan — agentlarning vizitlari olinmadi.');
    if (!adapter && !d.capabilities.visits) throw new Error(`${d.name} agent vizitlarini bermaydi — agentlar uchun Face ID ishlating.`);
    const visits = await (adapter || d.adapter).importVisits(d.integration.config, from, to) as { agentCode: string; start: string }[];
    // The system's agent id is stored as agents.code; agents of that system are preferred when codes repeat.
    const agentByCode = new Map(db.find('agents', a => a.company_id === company_id)
      .sort((a, b) => Number(a.source_integration_id === d.integration.id) - Number(b.source_integration_id === d.integration.id))
      .map(a => [String(a.code), a]));
    const linked = new Map(Object.entries(links).map(([emp, agent]) => [agent, emp]));
    const firsts = new Map<string, { agent_id: string; date: string; first: string; visits: number }>();
    for (const v of visits) {
      const agent = agentByCode.get(String(v.agentCode));
      const start = String(v.start || '');
      if (!agent || !linked.has(agent.id) || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(start)) continue;
      const date = start.slice(0, 10), time = start.slice(11, 16);
      const key = `${agent.id}:${date}`;
      const f = firsts.get(key);
      if (!f) firsts.set(key, { agent_id: agent.id, date, first: time, visits: 1 });
      else { f.visits++; if (time < f.first) f.first = time; }
    }
    const today = businessToday();
    const now = new Date().toISOString();
    const employees = new Map(db.find('employees', e => e.company_id === company_id).map(e => [e.id, e]));
    for (const [key, f] of firsts) {
      const old = db.findById('agent_visit_days', key);
      if (old) db.update('agent_visit_days', key, { first_visit: f.first, visits: f.visits, synced_at: now });
      else db.insert('agent_visit_days', { id: key, company_id, agent_id: f.agent_id, date: f.date, first_visit: f.first, visits: f.visits, synced_at: now });
      if (!old && linked.get(f.agent_id)) this.exportStart(company_id, linked.get(f.agent_id)!, f.date, s);
      if (!old && f.date === today) {
        const empId = linked.get(f.agent_id)!;
        const day = this.dayFor(s, empId, today);
        if (day.late_minutes > 0) {
          const emp = employees.get(empId);
          NotificationService.dispatchEvent(company_id, 'ATTENDANCE_LATE', `⏰ Kech boshladi: ${emp?.full_name || 'agent'}`,
            `${escapeHtml(emp?.full_name || '')} birinchi vizitni ${f.first} da qildi — <b>${day.late_minutes} daqiqa</b> kech (start ${this.planOf(s, empId).start} gacha).`);
          this.tellLate(company_id, empId, today, f.first, day.late_minutes, s);
        }
      }
    }
    return { days: firsts.size };
  }

  static events(company_id: string, filter: { from?: string; to?: string; employee_id?: string; status?: string }) {
    const names = new Map(db.find('employees', e => e.company_id === company_id).map(e => [e.id, e.full_name]));
    const zones = new Map(this.settings(company_id).zones.map(z => [z.id, z.name]));
    return db.find('attendance_events', e => e.company_id === company_id && (!filter.from || e.date >= filter.from) && (!filter.to || e.date <= filter.to) && (!filter.employee_id || e.employee_id === filter.employee_id) && (!filter.status || e.status === filter.status))
      .sort((a, b) => b.at.localeCompare(a.at))
      .map(e => ({ ...e, time: tz(e.at).hhmm, employee_name: names.get(e.employee_id) || e.employee_id, zone_name: e.zone_id ? zones.get(e.zone_id) || null : null, has_photo: !!e.photo_file }));
  }

  static review(company_id: string, id: string, decision: 'ACCEPTED' | 'REJECTED', reason: string, actor: { id: string; email: string }) {
    const e = db.findById('attendance_events', id);
    if (!e || e.company_id !== company_id) throw new Error('Qayd topilmadi.');
    if (!reason || reason.trim().length < 3) throw new Error('Qaror sababini yozing.');
    const updated = db.update('attendance_events', id, { status: decision, reviewed_by: actor.id, reviewed_at: new Date().toISOString(), review_reason: `${e.review_reason ? e.review_reason + ' → ' : ''}${decision === 'ACCEPTED' ? 'tasdiqlandi' : 'rad etildi'}: ${reason.trim()}` });
    AuditService.log({ company_id, user_id: actor.id, user_email: actor.email, action: 'UPDATE', entity: 'AttendanceEvent', entity_id: id, old_value: { status: e.status }, new_value: { status: decision }, reason: `Davomat qaydi ${decision === 'ACCEPTED' ? 'tasdiqlandi' : 'rad etildi'}: ${reason.trim()}` });
    if (decision === 'ACCEPTED' && e.type === 'IN') this.exportStart(company_id, e.employee_id, e.date);
    return updated;
  }

  /** The manager excuses a day (illness, a task elsewhere): no lateness, early leave or penalty for it. */
  static excuse(company_id: string, employee_id: string, date: string, excused: boolean, reason: string, actor: { id: string; email: string }) {
    const employee = db.findById('employees', employee_id);
    if (!employee || employee.company_id !== company_id) throw new Error('Xodim topilmadi.');
    if (!reason || reason.trim().length < 3) throw new Error('Sababini yozing.');
    const events = db.find('attendance_events', e => e.employee_id === employee_id && e.date === date);
    if (!events.length) {
      // An excused absence: a marker record (not an arrival).
      db.insert('attendance_events', { id: `att-ex-${employee_id}-${date}`, company_id, employee_id, type: 'IN', at: `${date}T00:00:00.000Z`, date, liveness_passed: false, status: 'REJECTED', review_reason: `Uzrli kun: ${reason.trim()}`, excused, created_by: actor.id });
    } else {
      for (const e of events) db.update('attendance_events', e.id, { excused });
    }
    AuditService.log({ company_id, user_id: actor.id, user_email: actor.email, action: 'UPDATE', entity: 'Attendance', entity_id: `${employee_id}:${date}`, old_value: null, new_value: { excused }, reason: `${employee.full_name}, ${date}: ${excused ? 'uzrli deb belgilandi' : 'uzr bekor qilindi'} — ${reason.trim()}` });
  }

  static photoPath(company_id: string, id: string): string {
    const e = db.findById('attendance_events', id);
    if (!e || e.company_id !== company_id || !e.photo_file) throw Object.assign(new Error('Rasm yo‘q.'), { status: 404 });
    const abs = dataFile(e.photo_file);
    if (!abs.startsWith(path.resolve(db.directory)) || !fs.existsSync(abs)) throw Object.assign(new Error('Rasm topilmadi.'), { status: 404 });
    return abs;
  }

  /** What the signed-in employee sees: enrolled or not, today's checks and schedule. */
  static me(company_id: string, user_id: string) {
    const employee = this.employeeOfUser(company_id, user_id);
    if (!employee) return { linked: false, enrolled: false };
    const s = this.settings(company_id);
    const today = businessToday();
    const plan = this.planOf(s, employee.id);
    const month = today.slice(0, 7);
    return {
      linked: true,
      enrolled: !!db.findOne('face_profiles', p => p.company_id === company_id && p.employee_id === employee.id),
      // Face ID only at the work place: the phone checks its location before the camera opens.
      zone_required: !!s.require_zone && s.zones.length > 0,
      employee_name: employee.full_name,
      // What the employee is told: "start by 09:30" for a window, the start time otherwise.
      schedule: { start: plan.group ? `${plan.group.start_from}–${plan.group.start_to}` : plan.start, end: plan.end, source: plan.source, group: plan.group?.name || null },
      today: this.dayFor(s, employee.id, today),
      events: this.events(company_id, { from: today, to: today, employee_id: employee.id }),
      // The employee sees their own violations of the month and what they cost (transparency, fewer disputes).
      month_violations: s.penalty.mode === 'RULES' ? this.occurrences(company_id, employee.id, month, s).map(o => ({ date: o.date, label: VIOLATION_LABEL[o.type], percent: o.percent, note: o.note || null, minutes: o.minutes || null })) : []
    };
  }
}

/** Every 10 minutes: today's first visits of linked agents from the connected system (and yesterday's once at start). */
export function startAttendanceScheduler() {
  let first = true;
  const run = async () => {
    for (const s of db.find('attendance_settings', x => Object.keys(x.agent_links || {}).length > 0)) {
      const today = businessToday();
      const from = first ? new Date(Date.parse(`${today}T12:00:00Z`) - 86400000).toISOString().slice(0, 10) : today;
      try { await AttendanceService.syncVisits(s.company_id, from, today); } catch (err: any) { console.warn('[Attendance] vizitlar:', err.message); }
    }
    first = false;
    // Penalties to the Google Sheet (after the visits, so today's lateness from them is included).
    try { AttendanceService.exportPenalties(); } catch (err: any) { console.warn('[Attendance] jarimalar → Sheets:', err.message); }
  };
  setTimeout(() => { run(); }, 30_000).unref();
  setInterval(run, 10 * 60_000).unref();
}
