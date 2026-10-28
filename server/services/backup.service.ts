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

export function listBackups(): BackupFile[] {
  const out: BackupFile[] = [];
  for (const kind of ['daily', 'weekly'] as const) {
    const dir = path.join(backupRoot(), kind);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir).filter(f => f.endsWith('.sqlite'))) {
      const st = fs.statSync(path.join(dir, name));
      out.push({ name, kind, size_mb: Math.round(st.size / 1e5) / 10, created_at: st.mtime.toISOString() });
    }
  }
  return out.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

function prune(dir: string, keep: number) {
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.sqlite')).sort().reverse();
  for (const f of files.slice(keep)) fs.rmSync(path.join(dir, f), { force: true });
}

/** Makes today's backup (and the weekly one on Mondays). Returns the daily file path. */
export function runBackup(now = new Date()): { file: string; copied_to: string | null } {
  const today = businessToday();
  // Rewrites everything first, so an in-place edit that nobody marked cannot be missing from the copy.
  db.checkpointAll();
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

function lastBackupAgeHours(): number {
  const latest = listBackups().find(b => b.kind === 'daily');
  return latest ? (Date.now() - Date.parse(latest.created_at)) / 3_600_000 : Infinity;
}

/** Checks every 15 minutes; backs up once a day after 02:00 (Tashkent), or right away if the last copy is over a day old. */
export function startBackupScheduler(): NodeJS.Timeout {
  const check = () => {
    try {
      // Turso is the durable database on hosted deployments. The local SQLite file
      // is only a cache there; checkpointAll() would synchronously rewrite every
      // row on the single-core free instance and stall health checks during boot.
      if (db.isTursoEnabled()) return;
      const hour = Number(new Date().toLocaleString('en-GB', { timeZone: 'Asia/Tashkent', hour: '2-digit', hour12: false }));
      const todays = listBackups().some(b => b.kind === 'daily' && b.name === `finance-${businessToday()}.sqlite`);
      if ((!todays && hour >= 2) || lastBackupAgeHours() > 26) {
        const r = runBackup();
        console.log(`[Backup] Zaxira nusxa: ${r.file}${r.copied_to ? ` (+ ${r.copied_to})` : ''}`);
      }
    } catch (e: any) {
      console.warn('[Backup] Xato:', e.message);
    }
  };
  setTimeout(check, 60_000).unref();
  const timer = setInterval(check, 15 * 60_000);
  timer.unref();
  return timer;
}
