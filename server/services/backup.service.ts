import fs from 'node:fs';
import path from 'node:path';
import { db } from '../db/database.ts';
import { businessToday } from '../utils/date.ts';

/**
 * Automatic backups of the SQLite database: one per day (kept 7 days) and one per week (kept 4 weeks), made after
 * 02:00 Tashkent time or at start-up when the last one is older than a day. BACKUP_COPY_DIR (e.g. a USB disk or a
 * Google Drive folder) gets a copy of each daily backup too.
 */
const KEEP_DAILY = 7;
const KEEP_WEEKLY = 4;

export const backupRoot = () => path.join(db.directory, 'backups');

export interface BackupFile { name: string; kind: 'daily' | 'weekly'; size_mb: number; created_at: string }

export function backupStatus() {
  const turso = db.isTursoEnabled();
  const extraCopy = process.env.BACKUP_COPY_DIR || null;
  return {
    storage: turso ? 'turso' as const : 'sqlite' as const,
    scheduled: !turso,
    extra_copy_dir: extraCopy,
    storage_notice: turso
      ? (extraCopy
        ? 'Asosiy baza Turso’da. Bu oynadagi nusxalar qo‘lda yoki yuklab olinadigan nusxalar; Render qayta ishga tushsa lokal fayllar saqlanib qolishi kafolatlanmaydi. BACKUP_COPY_DIR nusxasi ham sozlangan.'
        : 'Asosiy baza Turso’da. Avtomatik fayl nusxasi yoqilmagan; Render qayta ishga tushsa lokal nusxalar yo‘qolishi mumkin. Nusxani hozir oling va yuklab saqlang yoki doimiy BACKUP_COPY_DIR sozlang.')
      : (extraCopy
        ? 'SQLite bazasi ishlatilmoqda; kunlik/haftalik nusxalar avtomatik olinadi va qo‘shimcha joyga ko‘chiriladi.'
        : 'SQLite bazasi ishlatilmoqda; kunlik/haftalik nusxalar avtomatik olinadi. Server diski doimiy bo‘lmasa, nusxalarni alohida joyga ham saqlang.')
  };
}

export function listBackups(): BackupFile[] {
  const out: BackupFile[] = [];
  for (const kind of ['daily', 'weekly'] as const) {
    const dir = path.join(backupRoot(), kind);
    try { if (!fs.lstatSync(dir).isDirectory()) continue; } catch { continue; }
    for (const name of fs.readdirSync(dir).filter(f => /^[a-zA-Z0-9._-]+\.sqlite$/.test(f))) {
      try {
        const st = fs.lstatSync(path.join(dir, name));
        if (!st.isFile()) continue;
        out.push({ name, kind, size_mb: Math.round(st.size / 1e5) / 10, created_at: st.mtime.toISOString() });
      } catch { /* A file may disappear while retention cleanup is running. */ }
    }
  }
  return out.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

function prune(dir: string, keep: number) {
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir).filter(f => /^finance-\d{4}-\d{2}-\d{2}\.sqlite$/.test(f)).sort().reverse();
  for (const f of files.slice(keep)) fs.rmSync(path.join(dir, f), { force: true });
}

/** Makes today's backup (and the weekly one on Mondays). Returns the daily file path. */
export async function runBackup(now = new Date()): Promise<{ file: string; copied_to: string | null }> {
  const today = businessToday();
  if (db.isTursoEnabled()) {
    // Back up only after queued writes are durable in the primary cloud database.
    // Rewriting all rows here would create a large Turso outbox and block the small hosted instance.
    await db.flushTurso();
  } else {
    // Safety net for local SQLite in-place edits that were not explicitly marked dirty.
    db.checkpointAll();
  }
  const daily = db.backupTo(path.join(backupRoot(), 'daily', `finance-${today}.sqlite`));
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  if (weekday === 1 || !fs.existsSync(path.join(backupRoot(), 'weekly'))) {
    fs.mkdirSync(path.join(backupRoot(), 'weekly'), { recursive: true });
    fs.copyFileSync(daily, path.join(backupRoot(), 'weekly', `finance-${today}.sqlite`));
  }
  prune(path.join(backupRoot(), 'daily'), KEEP_DAILY);
  prune(path.join(backupRoot(), 'weekly'), KEEP_WEEKLY);
  let copiedTo: string | null = null;
  const extra = process.env.BACKUP_COPY_DIR;
  if (extra) {
    try {
      fs.mkdirSync(extra, { recursive: true });
      copiedTo = path.join(extra, path.basename(daily));
      fs.copyFileSync(daily, copiedTo);
      prune(extra, KEEP_DAILY);
    } catch (e: any) {
      console.warn('[Backup] Ikkinchi joyga ko‘chirilmadi:', e.message);
      copiedTo = null;
    }
  }
  void now;
  return { file: daily, copied_to: copiedTo };
}

/** Return only a regular backup file listed by the service; user input never becomes a filesystem path. */
export function resolveBackup(kind: string, name: string): string | null {
  if ((kind !== 'daily' && kind !== 'weekly') || !/^[a-zA-Z0-9._-]+\.sqlite$/.test(name)) return null;
  if (!listBackups().some(file => file.kind === kind && file.name === name)) return null;
  const base = path.resolve(backupRoot());
  const root = path.join(base, kind);
  const file = path.resolve(root, name);
  if (path.dirname(file) !== root) return null;
  try {
    if (!fs.lstatSync(base).isDirectory() || !fs.lstatSync(root).isDirectory()) return null;
    if (!fs.lstatSync(file).isFile()) return null; // Reject symlinks.
    return file;
  } catch { return null; }
}

function lastBackupAgeHours(): number {
  const latest = listBackups().find(b => b.kind === 'daily');
  return latest ? (Date.now() - Date.parse(latest.created_at)) / 3_600_000 : Infinity;
}

/** Checks every 15 minutes; backs up once a day after 02:00 (Tashkent), or right away if the last copy is over a day old. */
export function startBackupScheduler(): NodeJS.Timeout {
  let running = false;
  const check = async () => {
    if (running) return;
    running = true;
    try {
      // Turso is the durable database on hosted deployments. The local SQLite file
      // is only a cache there; checkpointAll() would synchronously rewrite every
      // row on the single-core free instance and stall health checks during boot.
      if (db.isTursoEnabled()) return;
      const hour = Number(new Date().toLocaleString('en-GB', { timeZone: 'Asia/Tashkent', hour: '2-digit', hour12: false }));
      const todays = listBackups().some(b => b.kind === 'daily' && b.name === `finance-${businessToday()}.sqlite`);
      if ((!todays && hour >= 2) || lastBackupAgeHours() > 26) {
        const r = await runBackup();
        console.log(`[Backup] Zaxira nusxa: ${r.file}${r.copied_to ? ` (+ ${r.copied_to})` : ''}`);
      }
    } catch (e: any) {
      console.warn('[Backup] Xato:', e.message);
    } finally { running = false; }
  };
  setTimeout(check, 60_000).unref();
  const timer = setInterval(check, 15 * 60_000);
  timer.unref();
  return timer;
}
