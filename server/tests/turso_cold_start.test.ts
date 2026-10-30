import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../db/database.ts';

process.env.JWT_SECRET ||= 'test-secret-for-turso-cold-start-012345';
let remoteFile = '';
before(() => {
  remoteFile = path.join(db.directory, 'test-turso.db');
  process.env.TURSO_DATABASE_URL = `file:${remoteFile.replace(/\\/g, '/')}`;
  delete process.env.TURSO_AUTH_TOKEN;
  db.init();
  db.insert('companies', { id: 'cloud-company', name: 'Cloud row' } as any);
});
after(() => {
  try { db.close(); } catch { /* test cleanup */ }
  try { (db as any).turso?.close(); } catch { /* test cleanup */ }
  try { fs.rmSync(remoteFile, { force: true }); } catch { /* test cleanup */ }
});

test('cold start hydrates cloud rows directly and replays durable local outbox writes', async () => {
  await db.connectTurso();
  assert.equal(db.findById('companies', 'cloud-company')?.name, 'Cloud row');

  // Simulate a process stopping after writing to the durable outbox but before remote ACK.
  db.insert('companies', { id: 'pending-company', name: 'Pending outbox row' } as any);
  db.close();
  (db as any).turso?.close();
  (db as any).turso = null;
  db.init();

  await db.connectTurso();
  assert.equal(db.findById('companies', 'cloud-company')?.name, 'Cloud row');
  assert.equal(db.findById('companies', 'pending-company')?.name, 'Pending outbox row');
  assert.equal(Number((db as any).sql.prepare('SELECT COUNT(*) AS n FROM turso_outbox').get().n), 0);
});
