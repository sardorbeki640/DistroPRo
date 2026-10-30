import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { db } from '../db/database.ts';
import { backupStatus, listBackups, resolveBackup, runBackup } from '../services/backup.service.ts';
import { businessToday } from '../utils/date.ts';

process.env.JWT_SECRET ||= 'test-secret-for-backups-0123456789';
beforeEach(() => { db.init(); db.reset(); });

test('Turso backup waits for cloud write queue and avoids rewriting every row', async () => {
  db.insert('companies', { id: 'backup-company', name: 'Nusxa' } as any);
  const originalTurso = db.isTursoEnabled;
  const originalFlush = db.flushTurso;
  const originalCheckpoint = db.checkpointAll;
  let flushed = false;
  (db as any).isTursoEnabled = () => true;
  (db as any).flushTurso = async () => { flushed = true; };
  (db as any).checkpointAll = () => { throw new Error('Turso uchun to‘liq checkpoint ishlamasligi kerak'); };
  try {
    const result = await runBackup();
    assert.equal(flushed, true);
    assert.ok(fs.statSync(result.file).size > 0);
    const sqlite = (process as any).getBuiltinModule('node:sqlite');
    const restored = new sqlite.DatabaseSync(result.file, { readOnly: true });
    const raw = restored.prepare("SELECT data FROM rows WHERE tbl = 'companies'").get() as { data: string };
    assert.equal(JSON.parse(raw.data).id, 'backup-company', 'backup contains the saved business row');
    restored.close();
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
    const restoreDir = path.join(db.directory, 'restore-check');
    fs.mkdirSync(restoreDir, { recursive: true });
    fs.copyFileSync(result.file, path.join(restoreDir, 'finance.sqlite'));
    const databaseModule = pathToFileURL(path.join(repoRoot, 'server/db/database.ts')).href;
    const script = `import { db } from ${JSON.stringify(databaseModule)}; db.init(); const c=db.findById('companies','backup-company'); if(c?.name!=='Nusxa') process.exitCode=1; else console.log(c.name); db.close();`;
    const restoredApp = spawnSync(process.execPath, [path.join(repoRoot, 'node_modules/tsx/dist/cli.mjs'), '--eval', script], {
      cwd: repoRoot,
      env: { ...process.env, NODE_ENV: 'test', FINANCE_DATA_DIR: restoreDir, JWT_SECRET: 'test-secret-for-backups-0123456789' },
      encoding: 'utf8'
    });
    assert.equal(restoredApp.status, 0, restoredApp.stderr || 'restored database did not load');
    assert.match(restoredApp.stdout, /Nusxa/);
    assert.equal(backupStatus().scheduled, false);
    assert.equal(backupStatus().storage, 'turso');
  } finally {
    (db as any).isTursoEnabled = originalTurso;
    (db as any).flushTurso = originalFlush;
    (db as any).checkpointAll = originalCheckpoint;
  }
});

test('failed Turso sync does not create a backup that looks current', async () => {
  const originalTurso = db.isTursoEnabled;
  const originalFlush = db.flushTurso;
  const originalBackup = db.backupTo;
  const target = path.join(db.directory, 'backups', 'daily', `finance-${businessToday()}.sqlite`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.rmSync(target, { force: true });
  let backupCalled = false;
  (db as any).isTursoEnabled = () => true;
  (db as any).flushTurso = async () => { throw new Error('cloud sync unavailable'); };
  (db as any).backupTo = () => { backupCalled = true; return target; };
  try {
    await assert.rejects(runBackup(), /cloud sync unavailable/);
    assert.equal(backupCalled, false);
    assert.equal(fs.existsSync(target), false);
  } finally {
    (db as any).isTursoEnabled = originalTurso;
    (db as any).flushTurso = originalFlush;
    (db as any).backupTo = originalBackup;
  }
});

test('backup downloads resolve only listed regular files inside backup folders', async () => {
  const target = path.join(db.directory, 'backups', 'daily', 'finance-safe.sqlite');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, 'test-backup');
  assert.equal(resolveBackup('daily', 'finance-safe.sqlite'), target);
  assert.equal(resolveBackup('../outside', 'finance-safe.sqlite'), null);
  assert.equal(resolveBackup('daily', '..%2fsecret.sqlite'), null);
  assert.equal(resolveBackup('daily', 'missing.sqlite'), null);

  const symlink = path.join(path.dirname(target), 'finance-link.sqlite');
  try {
    fs.symlinkSync(target, symlink);
    assert.ok(!listBackups().some(row => row.name === 'finance-link.sqlite'));
    assert.equal(resolveBackup('daily', 'finance-link.sqlite'), null);
  } catch (error: any) {
    if (error.code !== 'EPERM' && error.code !== 'EACCES') throw error;
  }
});
