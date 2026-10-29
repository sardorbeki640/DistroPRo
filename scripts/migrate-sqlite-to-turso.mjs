import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { config } from 'dotenv';
import { createClient } from '@libsql/client';

config({ path: path.resolve('.env.local') });
const dataDir = path.resolve(process.env.FINANCE_DATA_DIR || path.join(process.cwd(), '.data'));
const sqlitePath = path.join(dataDir, 'finance.sqlite');
const apply = process.argv.includes('--apply');
const url = process.env.TURSO_DATABASE_URL?.trim();
const authToken = process.env.TURSO_AUTH_TOKEN?.trim();

if (!fs.existsSync(sqlitePath)) throw new Error(`SQLite fayli topilmadi: ${sqlitePath}`);
if (!url || !authToken) throw new Error('TURSO_DATABASE_URL va TURSO_AUTH_TOKEN muhit o‘zgaruvchilarini sozlang.');

const sqlite = (process.getBuiltinModule?.('node:sqlite'));
if (!sqlite) throw new Error('node:sqlite mavjud emas. Node 22.5 yoki undan yangiroq versiya kerak.');
const source = new sqlite.DatabaseSync(sqlitePath, { readOnly: true });
const client = createClient({ url, authToken });

const normalized = (row) => ({
  tbl: String(row.tbl),
  k: String(row.k),
  seq: Number(row.seq),
  data: String(row.data),
});

const digestRow = (hash, row) => {
  const value = normalized(row);
  hash.update(JSON.stringify([value.tbl, value.k, value.seq, value.data]));
  hash.update('\n');
};

try {
  if (apply) {
    await client.execute(`CREATE TABLE IF NOT EXISTS distropro_rows (
      tbl TEXT NOT NULL,
      k TEXT NOT NULL,
      seq INTEGER NOT NULL,
      data TEXT NOT NULL,
      PRIMARY KEY (tbl, k)
    )`);
    await client.execute(`CREATE TABLE IF NOT EXISTS distropro_rows_local_import_backup (
      tbl TEXT NOT NULL,
      k TEXT NOT NULL,
      seq INTEGER NOT NULL,
      data TEXT NOT NULL,
      PRIMARY KEY (tbl, k)
    )`);
    await client.execute(`INSERT OR IGNORE INTO distropro_rows_local_import_backup(tbl, k, seq, data)
      SELECT tbl, k, seq, data FROM distropro_rows`);
  }

  const sourceCount = Number(source.prepare('SELECT COUNT(*) AS n FROM rows').get().n);
  let targetCountBefore = 0;
  try {
    targetCountBefore = Number((await client.execute('SELECT COUNT(*) AS n FROM distropro_rows')).rows[0]?.n || 0);
  } catch (error) {
    if (!apply || !String(error).toLowerCase().includes('no such table')) throw error;
  }
  console.log(`Mahalliy SQLite qatorlari: ${sourceCount}`);
  console.log(`Turso’dagi hozirgi qatorlar: ${targetCountBefore}`);

  if (!apply) {
    console.log('Tekshiruv rejimi: Turso’ga yozilmadi. Ko‘chirish uchun --apply parametrini bering.');
    process.exitCode = 0;
  } else {
    const readRows = source.prepare('SELECT tbl, k, seq, data FROM rows ORDER BY tbl, k');
    let batch = [];
    let written = 0;
    for (const raw of readRows.iterate()) {
      const row = normalized(raw);
      batch.push({
        sql: 'INSERT OR REPLACE INTO distropro_rows(tbl, k, seq, data) VALUES (?, ?, ?, ?)',
        args: [row.tbl, row.k, row.seq, row.data],
      });
      if (batch.length === 500) {
        await client.batch(batch, 'write');
        written += batch.length;
        batch = [];
        if (written % 1000 === 0) console.log(`Ko‘chirildi: ${written}/${sourceCount}`);
      }
    }
    if (batch.length) {
      await client.batch(batch, 'write');
      written += batch.length;
    }

    const sourceHash = createHash('sha256');
    const verifyHash = createHash('sha256');
    const checkRows = source.prepare('SELECT tbl, k, seq, data FROM rows ORDER BY tbl, k');
    const iterator = checkRows.iterate();
    let checked = 0;
    while (true) {
      const group = [];
      while (group.length < 200) {
        const next = iterator.next();
        if (next.done) break;
        group.push(normalized(next.value));
      }
      if (!group.length) break;
      const predicates = group.map(() => '(tbl = ? AND k = ?)').join(' OR ');
      const args = group.flatMap(row => [row.tbl, row.k]);
      const result = await client.execute({
        sql: `SELECT tbl, k, seq, data FROM distropro_rows WHERE ${predicates} ORDER BY tbl, k`,
        args,
      });
      const remoteByKey = new Map(result.rows.map(raw => {
        const row = normalized(raw);
        return [`${row.tbl}\u0000${row.k}`, row];
      }));
      for (const row of group) {
        const remote = remoteByKey.get(`${row.tbl}\u0000${row.k}`);
        if (!remote) throw new Error(`Tekshiruvda qator topilmadi: ${row.tbl}/${row.k}`);
        if (row.seq !== remote.seq || row.data !== remote.data) throw new Error(`Tekshiruv mos kelmadi: ${row.tbl}/${row.k}`);
        digestRow(sourceHash, row);
        digestRow(verifyHash, remote);
        checked++;
      }
      if (checked % 1000 === 0 || checked === sourceCount) console.log(`Tekshirildi: ${checked}/${sourceCount}`);
    }
    const sourceDigest = sourceHash.digest('hex');
    const verifyDigest = verifyHash.digest('hex');
    const targetCountAfter = Number((await client.execute('SELECT COUNT(*) AS n FROM distropro_rows')).rows[0]?.n || 0);
    if (sourceDigest !== verifyDigest || targetCountAfter < sourceCount) {
      throw new Error('Turso tekshiruvi to‘liq mos kelmadi. Mahalliy SQLite fayli saqlab qolindi.');
    }
    console.log(`Ko‘chirildi va tekshirildi: ${checked} qator.`);
    console.log(`SHA-256: ${sourceDigest}`);
    console.log(`Turso jami qatorlari: ${targetCountAfter}`);
    console.log('Mahalliy SQLite o‘chirilmagan. Ilova hali unga tayanadi; dastur Turso-only rejimiga o‘tgandan keyin alohida o‘chiriladi.');
  }
} finally {
  source.close();
  await client.close();
}
