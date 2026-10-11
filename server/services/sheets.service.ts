import { randomBytes } from 'node:crypto';
import { db } from '../db/database.ts';
import { AuditService } from './audit.service.ts';
import { businessToday } from '../utils/date.ts';

/**
 * Google Sheets without Google Cloud keys: the company adds a small Apps Script to its own sheet and deploys it as a
 * web app; the server posts rows to that URL with a secret token the script checks. Rows wait in a queue (sheet_rows)
 * and are retried, so a short internet outage loses nothing.
 */
export const SHEET_HEADER = ['Sana', 'Xodim', 'Lavozim', 'Guruh', 'Usul', 'Ish boshladi', 'Muddat', 'Kechikish, daq', 'Holat', 'Yozilgan vaqt'];
/** The month's penalties sheet ("Jarimalar YYYY-MM"): one row per violation, the running month total, cancellations. */
export const PENALTY_HEADER = ['Sana', 'Xodim', 'Lavozim', 'Guruh', 'Qoidabuzarlik', 'Tafsilot', 'Jarima, %', 'Shu oy jami, %', 'Holat', 'Yozilgan vaqt'];
const headerOf = (sheet: string) => (sheet.startsWith('Jarimalar') ? PENALTY_HEADER : SHEET_HEADER);
const MAX_ATTEMPTS = 10;
const BATCH = 200;

/** The Apps Script the owner pastes into Extensions → Apps Script of their sheet. */
export function appsScript(token: string): string {
  return `// Distro Pro → Google Sheets (davomat va jarimalar). Kengaytmalar → Apps Script ga joylang, keyin
// Deploy → New deployment → Web app: "Execute as: Me", "Who has access: Anyone" → Deploy → URL ni dasturga kiriting.
// Har oyga alohida varaqlar: "Davomat YYYY-MM" (ish boshlash) va "Jarimalar YYYY-MM".
const TOKEN = '${token}';

function doPost(e) {
  const body = JSON.parse(e.postData.contents || '{}');
  if (body.token !== TOKEN) return reply({ ok: false, error: 'token noto‘g‘ri' });
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const groups = body.groups || [];
    let added = 0;
    groups.forEach(function (g) {
      let sh = ss.getSheetByName(g.sheet);
      if (!sh) sh = ss.insertSheet(g.sheet);
      const header = g.header || body.header;
      if (sh.getLastRow() === 0) {
        sh.appendRow(header);
        sh.getRange(1, 1, 1, header.length).setFontWeight('bold');
        sh.setFrozenRows(1);
      }
      if (g.rows.length) {
        sh.getRange(sh.getLastRow() + 1, 1, g.rows.length, g.rows[0].length).setValues(g.rows);
        added += g.rows.length;
      }
    });
    return reply({ ok: true, added: added });
  } finally {
    lock.releaseLock();
  }
}

function reply(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
`;
}

export class SheetsService {
  /** Replaced in tests. */
  static fetchImpl: typeof fetch = (...args) => fetch(...args);

  /** The company's sheet settings (a token is made on first use). */
  static settings(company_id: string) {
    const s = db.findOne('attendance_settings', x => x.company_id === company_id);
    if (!s) return null;
    if (!s.sheets?.token) {
      db.update('attendance_settings', s.id, { sheets: { enabled: false, url: '', ...(s.sheets || {}), token: randomBytes(18).toString('base64url') } } as any);
    }
    return db.findById('attendance_settings', s.id)!.sheets!;
  }

  static view(company_id: string) {
    const sh = this.settings(company_id);
    const rows = db.find('sheet_rows', r => r.company_id === company_id);
    return {
      enabled: !!sh?.enabled, url: sh?.url || '', script: sh ? appsScript(sh.token) : '',
      pending: rows.filter(r => r.status === 'PENDING').length,
      failed: rows.filter(r => r.status === 'FAILED').length,
      sent: rows.filter(r => r.status === 'SENT').length,
      last_sent_at: sh?.last_sent_at || null, last_error: sh?.last_error || null
    };
  }

  static save(company_id: string, input: { enabled: boolean; url: string }, actor: { id: string; email: string }) {
    const url = String(input.url || '').trim();
    if (input.enabled && !/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url)) {
      throw new Error('Apps Script web-ilova manzilini kiriting: https://script.google.com/macros/s/…/exec');
    }
    const current = this.settings(company_id);
    const s = db.findOne('attendance_settings', x => x.company_id === company_id)!;
    db.update('attendance_settings', s.id, { sheets: { ...current!, enabled: !!input.enabled, url } } as any);
    // Rows that failed for good are tried again after the settings change.
    for (const r of db.find('sheet_rows', r => r.company_id === company_id && r.status === 'FAILED')) db.update('sheet_rows', r.id, { status: 'PENDING', attempts: 0 });
    AuditService.log({ company_id, user_id: actor.id, user_email: actor.email, action: 'UPDATE', entity: 'GoogleSheets', entity_id: company_id, old_value: { enabled: current?.enabled }, new_value: { enabled: !!input.enabled }, reason: 'Google Sheets (davomat) sozlamasi' });
    return this.view(company_id);
  }

  /** Adds a row once (the id makes it once per employee and day). */
  static queue(company_id: string, id: string, sheet: string, values: (string | number)[]) {
    const key = `${company_id}:${id}`;
    if (db.findById('sheet_rows', key)) return false;
    db.insert('sheet_rows', { id: key, company_id, sheet, values, status: 'PENDING', attempts: 0, created_at: new Date().toISOString(), sent_at: null });
    return true;
  }

  private static async post(url: string, body: unknown): Promise<{ ok: boolean; added?: number; error?: string }> {
    let res: Response;
    try {
      res = await this.fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body), redirect: 'follow', signal: AbortSignal.timeout(30000) });
    } catch (err: any) {
      throw new Error(`Google bilan aloqa yo‘q (${err?.name === 'TimeoutError' ? 'vaqt tugadi' : err?.message || 'tarmoq xatosi'}).`);
    }
    const text = await res.text();
    let data: any = null;
    try { data = JSON.parse(text); } catch { /* not JSON */ }
    if (!data) throw new Error(res.status === 404 ? 'Skript manzili topilmadi — URL ni tekshiring.' : 'Skript javobi tushunarsiz. Deploy qilishda “Who has access: Anyone” tanlanganini tekshiring.');
    if (!data.ok) throw new Error(`Skript rad etdi: ${data.error || 'noma’lum xato'}${/token/i.test(data.error || '') ? ' — skript kodini dasturdagi yangisi bilan almashtiring.' : ''}`);
    return data;
  }

  /** Sends a test (only creates this month's sheet with its header) so the owner sees it works. */
  static async test(company_id: string) {
    const sh = this.settings(company_id);
    if (!sh?.url) throw new Error('Avval skript manzilini kiriting va saqlang.');
    const month = businessToday().slice(0, 7);
    await this.post(sh.url, { token: sh.token, header: SHEET_HEADER, groups: [
      { sheet: `Davomat ${month}`, header: SHEET_HEADER, rows: [] },
      { sheet: `Jarimalar ${month}`, header: PENALTY_HEADER, rows: [] }
    ] });
    return { ok: true, message: `Ulandi: jadvalda “Davomat ${month}” va “Jarimalar ${month}” varaqlari tayyor.` };
  }

  /** Sends waiting rows of every company (grouped by sheet), retrying failures with growing pauses. */
  static async flush(now = Date.now()) {
    let sent = 0;
    const companies = new Set(db.find('sheet_rows', r => r.status === 'PENDING').map(r => r.company_id));
    for (const company_id of companies) {
      const sh = this.settings(company_id);
      if (!sh?.enabled || !sh.url) continue;
      const due = db.find('sheet_rows', r => r.company_id === company_id && r.status === 'PENDING' && (!r.attempts || now - Date.parse(r.last_attempt_at || r.created_at) >= 30_000 * 2 ** Math.min(r.attempts, 8)))
        .sort((a, b) => a.created_at.localeCompare(b.created_at)).slice(0, BATCH);
      if (!due.length) continue;
      const bySheet = new Map<string, typeof due>();
      for (const r of due) bySheet.set(r.sheet, [...(bySheet.get(r.sheet) || []), r]);
      const at = new Date(now).toISOString();
      const s = db.findOne('attendance_settings', x => x.company_id === company_id)!;
      try {
        await this.post(sh.url, { token: sh.token, header: SHEET_HEADER, groups: Array.from(bySheet, ([sheet, rows]) => ({ sheet, header: headerOf(sheet), rows: rows.map(r => r.values) })) });
        for (const r of due) db.update('sheet_rows', r.id, { status: 'SENT', sent_at: at, last_error: null, attempts: r.attempts + 1 });
        db.update('attendance_settings', s.id, { sheets: { ...db.findById('attendance_settings', s.id)!.sheets!, last_sent_at: at, last_error: null } } as any);
        sent += due.length;
      } catch (err: any) {
        for (const r of due) db.update('sheet_rows', r.id, { attempts: r.attempts + 1, last_error: err.message, status: r.attempts + 1 >= MAX_ATTEMPTS ? 'FAILED' : 'PENDING', last_attempt_at: at });
        db.update('attendance_settings', s.id, { sheets: { ...db.findById('attendance_settings', s.id)!.sheets!, last_error: err.message } } as any);
      }
    }
    return { sent };
  }
}

/** Every 30 s while the server runs. */
export function startSheetsScheduler() {
  let busy = false;
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try { await SheetsService.flush(); } catch (err: any) { console.warn('[Sheets]', err.message); } finally { busy = false; }
  }, 30_000);
  timer.unref();
}
