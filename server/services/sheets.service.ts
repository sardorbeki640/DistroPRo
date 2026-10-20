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
/** A single penalties sheet: one dated row per violation, the running month total, cancellations. */
export const PENALTY_HEADER = ['Sana', 'Xodim', 'Lavozim', 'Guruh', 'Qoidabuzarlik', 'Tafsilot', 'Jarima (so‘m yoki %)', 'Shu oy jami (so‘m yoki %)', 'Holat', 'Yozilgan vaqt'];
const headerOf = (sheet: string) => (sheet.startsWith('Jarimalar') ? PENALTY_HEADER : SHEET_HEADER);
const MAX_ATTEMPTS = 10;
const BATCH = 200;

/** The Apps Script the owner pastes into Extensions → Apps Script of their sheet. */
export function appsScript(token: string): string {
  return `// Distro Pro → Google Sheets (davomat va jarimalar). Kengaytmalar → Apps Script ga joylang, keyin
// Deploy → New deployment → Web app: "Execute as: Me", "Who has access: Anyone" → Deploy → URL ni dasturga kiriting.
// Davomat oylar bo‘yicha; barcha sanali jarimalar bitta "Jarimalar" varag‘iga yoziladi.
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
      if (g.sheet === 'Jarimalar') {
        let fineSheet = ss.getSheetByName('Jarimalar');
        if (!fineSheet) fineSheet = ss.insertSheet('Jarimalar');
        if (fineSheet.getLastRow() === 0) fineSheet.appendRow(['Xodim', 'Jami']);
        let fineHeaders = fineSheet.getRange(1, 1, 1, Math.max(2, fineSheet.getLastColumn())).getValues()[0];
        if (fineHeaders[0] !== 'Xodim') {
          fineSheet.clearContents();
          fineSheet.appendRow(['Xodim', 'Jami']);
          fineHeaders = ['Xodim', 'Jami'];
        }
        const ledgerName = '_DistroPro Jarima ID';
        let ledger = ss.getSheetByName(ledgerName);
        if (!ledger) {
          ledger = ss.insertSheet(ledgerName);
          ledger.appendRow(['ID', 'Sana', 'Xodim', 'Qiymat']);
        }
        if (!ledger.isSheetHidden()) ledger.hideSheet();
        const ledgerLast = ledger.getLastRow();
        const ledgerRows = ledgerLast > 1 ? ledger.getRange(2, 1, ledgerLast - 1, 4).getValues() : [];
        const ledgerIndex = new Map();
        ledgerRows.forEach(function (r, i) { ledgerIndex.set(String(r[0]), i + 2); });
        const dailyTotals = new Map();
        const totalKey = function (date, employee) { return String(employee) + '\u001f' + String(date); };
        ledgerRows.forEach(function (r) {
          const k = totalKey(r[1], r[2]);
          dailyTotals.set(k, (dailyTotals.get(k) || 0) + (Number(r[3]) || 0));
        });
        g.rows.forEach(function (row, rowIndex) {
          const date = String(row[0] || '');
          const employee = String(row[1] || 'Noma’lum xodim');
          if (!date) return;
          const syncId = String((g.ids || [])[rowIndex] || '');
          if (!syncId) throw new Error('Jarima satrida takrorlanishni oldini oluvchi ID yo‘q.');
          let dateCol = fineHeaders.indexOf(date) + 1;
          let totalCol = fineHeaders.indexOf('Jami') + 1;
          if (!dateCol) {
            if (!totalCol) { totalCol = fineHeaders.length + 1; fineSheet.getRange(1, totalCol).setValue('Jami'); }
            const dateKey = function (v) {
              const value = String(v || '');
              const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
              if (iso) return Number(iso[1] + iso[2] + iso[3]);
              const local = value.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
              return local ? Number(local[3] + local[2] + local[1]) : Number.MAX_SAFE_INTEGER;
            };
            dateCol = 2;
            while (dateCol < totalCol && dateKey(fineHeaders[dateCol - 1]) <= dateKey(date)) dateCol++;
            fineSheet.insertColumnBefore(dateCol);
            fineSheet.getRange(1, dateCol).setValue(date);
            fineHeaders.splice(dateCol - 1, 0, date);
            totalCol++;
          }
          const employeeRows = fineSheet.getLastRow() > 1 ? fineSheet.getRange(2, 1, fineSheet.getLastRow() - 1, 1).getValues() : [];
          let employeeRow = employeeRows.findIndex(function (r) { return String(r[0]) === employee; }) + 2;
          if (employeeRow < 2) { employeeRow = fineSheet.getLastRow() + 1; fineSheet.getRange(employeeRow, 1).setValue(employee); }
          const amount = Number(row[6]) || 0;
          const cancelled = String(row[8] || '').toUpperCase().indexOf('BEKOR') >= 0;
          const oldAmount = Number(fineSheet.getRange(employeeRow, dateCol).getValue()) || 0;
          const hasDateLedger = ledgerRows.some(function (r) { return String(r[1]) === date && String(r[2]) === employee; });
          if (!hasDateLedger && oldAmount !== 0) {
            const baselineId = 'baseline:' + employee + ':' + date;
            if (!ledgerIndex.has(baselineId)) {
              ledger.appendRow([baselineId, date, employee, oldAmount]);
              ledgerIndex.set(baselineId, ledger.getLastRow());
              ledgerRows.push([baselineId, date, employee, oldAmount]);
              const k = totalKey(date, employee);
              dailyTotals.set(k, (dailyTotals.get(k) || 0) + oldAmount);
            }
          }
          const signedAmount = cancelled ? -amount : amount;
          const record = [syncId, date, employee, signedAmount];
          if (ledgerIndex.has(syncId)) {
            const ledgerRow = ledgerIndex.get(syncId);
            const oldRecord = ledgerRows[ledgerRow - 2];
            ledger.getRange(ledgerRow, 1, 1, 4).setValues([record]);
            if (ledgerRow >= 2) {
              ledgerRows[ledgerRow - 2] = record;
              const oldKey = totalKey(oldRecord[1], oldRecord[2]);
              dailyTotals.set(oldKey, (dailyTotals.get(oldKey) || 0) - (Number(oldRecord[3]) || 0));
            }
          }
          else {
            ledger.appendRow(record);
            ledgerIndex.set(syncId, ledger.getLastRow());
            ledgerRows.push(record);
          }
          const key = totalKey(date, employee);
          dailyTotals.set(key, (dailyTotals.get(key) || 0) + signedAmount);
          const totalForDate = Math.round((dailyTotals.get(key) || 0) * 100) / 100;
          fineSheet.getRange(employeeRow, dateCol).setValue(totalForDate);
          totalCol = fineHeaders.indexOf('Jami') + 1;
          if (totalCol > 0) fineSheet.getRange(employeeRow, totalCol).setFormula('=SUM(B' + employeeRow + ':' + (totalCol > 2 ? columnLetter(totalCol - 1) : 'B') + employeeRow + ')');
          added++;
        });
        return;
      }
      let sh = ss.getSheetByName(g.sheet);
      if (!sh) sh = ss.insertSheet(g.sheet);
      const header = g.header || body.header;
      if (sh.getLastRow() === 0) {
        sh.appendRow(header);
        sh.getRange(1, 1, 1, header.length).setFontWeight('bold');
        sh.setFrozenRows(1);
      }
      if (g.rows.length) {
        const usedCols = Math.max(header.length, sh.getLastColumn());
        const existingHeader = sh.getRange(1, 1, 1, usedCols).getValues()[0];
        let idCol = existingHeader.indexOf('_DistroPro ID') + 1;
        if (!idCol) {
          idCol = usedCols + 1;
          sh.getRange(1, idCol).setValue('_DistroPro ID');
        }
        sh.hideColumns(idCol);
        const lastRow = sh.getLastRow();
        const existingIds = lastRow > 1
          ? new Set(sh.getRange(2, idCol, lastRow - 1, 1).getValues().flat().map(String).filter(Boolean))
          : new Set();
        const pendingRows = g.rows.map(function (row, i) { return { row: row, id: String((g.ids || [])[i] || '') }; })
          .filter(function (item) { return !item.id || !existingIds.has(item.id); });
        if (pendingRows.length) {
          const width = Math.max(g.rows[0].length, idCol);
          const values = pendingRows.map(function (item) {
            const row = item.row.slice();
            while (row.length < width) row.push('');
            if (item.id) row[idCol - 1] = item.id;
            return row;
          });
          sh.getRange(sh.getLastRow() + 1, 1, values.length, width).setValues(values);
          added += pendingRows.length;
        }
      }
    });
    return reply({ ok: true, added: added });
  } finally {
    lock.releaseLock();
  }
}

function columnLetter(n) {
  let out = '';
  while (n > 0) { const rem = (n - 1) % 26; out = String.fromCharCode(65 + rem) + out; n = Math.floor((n - 1) / 26); }
  return out;
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

  /** Sends a test (creates the attendance month and one shared penalties sheet) so the owner sees it works. */
  static async test(company_id: string) {
    const sh = this.settings(company_id);
    if (!sh?.url) throw new Error('Avval skript manzilini kiriting va saqlang.');
    const month = businessToday().slice(0, 7);
    await this.post(sh.url, { token: sh.token, header: SHEET_HEADER, groups: [
      { sheet: `Davomat ${month}`, header: SHEET_HEADER, rows: [] },
      { sheet: 'Jarimalar', header: PENALTY_HEADER, rows: [] }
    ] });
    return { ok: true, message: `Ulandi: jadvalda “Davomat ${month}” va barcha oylarga umumiy “Jarimalar” varag‘i tayyor.` };
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
      for (const r of due) {
        // Queue rows from the previous monthly-tab format are folded into the shared penalties sheet too.
        const sheet = r.sheet.startsWith('Jarimalar') ? 'Jarimalar' : r.sheet;
        bySheet.set(sheet, [...(bySheet.get(sheet) || []), r]);
      }
      const at = new Date(now).toISOString();
      const s = db.findOne('attendance_settings', x => x.company_id === company_id)!;
      try {
        await this.post(sh.url, { token: sh.token, header: SHEET_HEADER, groups: Array.from(bySheet, ([sheet, rows]) => ({ sheet, header: headerOf(sheet), ids: rows.map(r => r.id), rows: rows.map(r => r.values) })) });
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
