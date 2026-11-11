import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import pg from 'pg';

const { Pool } = pg;
const sourcePath = path.resolve(process.env.SQLITE_SOURCE || '.data/finance.sqlite');
const neonUrl = process.env.NEON_DATABASE_URL?.trim();
if (!neonUrl) {
  console.error('NEON_DATABASE_URL muhit o‘zgaruvchisini belgilang. Qiymatni terminalda ko‘rsatmang.');
  process.exit(2);
}
if (!fs.existsSync(sourcePath)) throw new Error(`SQLite nusxasi topilmadi: ${sourcePath}`);

const sqlite = process.getBuiltinModule?.('node:sqlite');
if (!sqlite?.DatabaseSync) throw new Error('SQLite o‘qish uchun Node 22.5+ kerak.');
const source = new sqlite.DatabaseSync(sourcePath, { readOnly: true });
const target = new Pool({ connectionString: neonUrl, ssl: true, max: 2, connectionTimeoutMillis: 15_000 });
const queryTarget = async (sql, values) => {
  for (let attempt = 1; ; attempt++) {
    try { return await target.query(sql, values); }
    catch (error) {
      const code = error?.code;
      const retryable = ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', '57P01', '08006', '08003'].includes(code);
      if (!retryable || attempt >= 5) throw error;
      console.warn(`[Neon] Ulanish uzildi; xavfsiz qayta urinilmoqda (${attempt}/4).`);
      await new Promise(resolve => setTimeout(resolve, Math.min(1_000 * 2 ** (attempt - 1), 8_000)));
    }
  }
};
const digestRow = (hash, row) => {
  for (const field of [String(row.tbl), String(row.k), String(Number(row.seq)), String(row.data)]) {
    hash.update(`${Buffer.byteLength(field)}:`).update(field);
  }
};

async function hashSource(upper = null) {
  const hash = createHash('sha256');
  let lastTable = '';
  let lastKey = '';
  let count = 0;
  let page = upper
    ? source.prepare('SELECT tbl, k, seq, data FROM rows WHERE (tbl, k) <= (?, ?) ORDER BY tbl, k LIMIT ?').all(upper.tbl, upper.key, 1000)
    : source.prepare('SELECT tbl, k, seq, data FROM rows ORDER BY tbl, k LIMIT ?').all(1000);
  while (page.length) {
    for (const row of page) { digestRow(hash, row); lastTable = String(row.tbl); lastKey = String(row.k); count++; }
    if (page.length < 1000) break;
    page = upper
      ? source.prepare('SELECT tbl, k, seq, data FROM rows WHERE (tbl, k) > (?, ?) AND (tbl, k) <= (?, ?) ORDER BY tbl, k LIMIT ?').all(lastTable, lastKey, upper.tbl, upper.key, 1000)
      : source.prepare('SELECT tbl, k, seq, data FROM rows WHERE (tbl, k) > (?, ?) ORDER BY tbl, k LIMIT ?').all(lastTable, lastKey, 1000);
  }
  return { count, hash: hash.digest('hex') };
}

async function hashTarget(upper = null) {
  const hash = createHash('sha256');
  let lastTable = '';
  let lastKey = '';
  let count = 0;
  let page = upper
    ? await queryTarget('SELECT tbl, k, seq, data FROM distropro_rows WHERE (tbl, k) <= ($1, $2) ORDER BY tbl, k LIMIT $3', [upper.tbl, upper.key, 1000])
    : await queryTarget('SELECT tbl, k, seq, data FROM distropro_rows ORDER BY tbl, k LIMIT $1', [1000]);
  while (page.rows.length) {
    for (const row of page.rows) { digestRow(hash, row); lastTable = String(row.tbl); lastKey = String(row.k); count++; }
    if (page.rows.length < 1000) break;
    page = upper
      ? await queryTarget('SELECT tbl, k, seq, data FROM distropro_rows WHERE (tbl, k) > ($1, $2) AND (tbl, k) <= ($3, $4) ORDER BY tbl, k LIMIT $5', [lastTable, lastKey, upper.tbl, upper.key, 1000])
      : await queryTarget('SELECT tbl, k, seq, data FROM distropro_rows WHERE (tbl, k) > ($1, $2) ORDER BY tbl, k LIMIT $3', [lastTable, lastKey, 1000]);
  }
  return { count, hash: hash.digest('hex') };
}

function hashSourceByTable() {
  const hashes = new Map();
  for (const row of source.prepare('SELECT tbl, k, seq, data FROM rows ORDER BY tbl, k').iterate()) {
    const table = String(row.tbl);
    let hash = hashes.get(table);
    if (!hash) hashes.set(table, hash = createHash('md5'));
    digestRow(hash, row);
  }
  return new Map([...hashes].map(([table, hash]) => [table, hash.digest('hex')]));
}

async function hashTargetByTable() {
  // Aggregate each table on Neon so verification transfers only one small digest per table.
  const sql = `SELECT tbl, md5(string_agg(octet_length(tbl)::text || ':' || tbl || octet_length(k)::text || ':' || k || octet_length(seq::text)::text || ':' || seq::text || octet_length(data)::text || ':' || data, '' ORDER BY k)) AS hash FROM distropro_rows GROUP BY tbl ORDER BY tbl`;
  const result = await queryTarget(sql);
  return new Map(result.rows.map(row => [String(row.tbl), String(row.hash)]));
}

try {
  const pending = Number(source.prepare('SELECT COUNT(*) AS n FROM turso_outbox').get()?.n || 0);
  if (pending > 0) throw new Error(`${pending} ta hali Turso’ga tasdiqlanmagan mahalliy yozuv bor; ularni avval alohida tiklash kerak.`);
  await queryTarget('CREATE TABLE IF NOT EXISTS distropro_rows (tbl TEXT NOT NULL, k TEXT NOT NULL, seq BIGINT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (tbl, k))');
  const before = Number((await queryTarget('SELECT COUNT(*)::bigint AS n FROM distropro_rows')).rows[0].n);
  if (before > 0 && process.env.MIGRATION_RESUME !== '1') {
    throw new Error(`Neon jadvalida oldindan ${before} qator bor; tasodifiy aralashmasligi uchun migratsiya to‘xtatildi.`);
  }

  let lastTable = '';
  let lastKey = '';
  let copied = 0;
  let page;
  const sourceTotal = Number(source.prepare('SELECT COUNT(*) AS n FROM rows').get().n);
  if (before > 0 && before === sourceTotal) {
    console.log(`Neon’da ${before} qator bor; ularni yakuniy to‘liq tekshiruv bilan solishtiryapman.`);
    page = [];
  } else if (before > 0) {
    const cursor = (await queryTarget('SELECT tbl, k FROM distropro_rows ORDER BY tbl DESC, k DESC LIMIT 1')).rows[0];
    if (!cursor) throw new Error('Neon qatorlari holati noaniq; xavfsizlik uchun migratsiya to‘xtatildi.');
    const upper = { tbl: String(cursor.tbl), key: String(cursor.k) };
    const [sourcePrefix, targetPrefix] = await Promise.all([hashSource(upper), hashTarget(upper)]);
    if (sourcePrefix.count !== before || targetPrefix.count !== before || sourcePrefix.hash !== targetPrefix.hash) {
      throw new Error('Neon’dagi qisman nusxa SQLite bosh qismi bilan mos kelmadi; hech narsa o‘chirilmadi.');
    }
    lastTable = upper.tbl;
    lastKey = upper.key;
    console.log(`Oldingi ${before} qator mazmuni tasdiqlandi; qolgan qismi davom ettirilmoqda.`);
    page = source.prepare('SELECT tbl, k, seq, data FROM rows WHERE (tbl, k) > (?, ?) ORDER BY tbl, k LIMIT ?').all(lastTable, lastKey, 500);
  } else {
    page = source.prepare('SELECT tbl, k, seq, data FROM rows ORDER BY tbl, k LIMIT ?').all(500);
  }
  while (page.length) {
    const values = [];
    const tuples = page.map((row, i) => {
      const n = i * 4;
      values.push(String(row.tbl), String(row.k), Number(row.seq), String(row.data));
      lastTable = String(row.tbl);
      lastKey = String(row.k);
      return `($${n + 1}, $${n + 2}, $${n + 3}, $${n + 4})`;
    });
    await queryTarget(`INSERT INTO distropro_rows(tbl, k, seq, data) VALUES ${tuples.join(',')} ON CONFLICT (tbl, k) DO UPDATE SET seq = EXCLUDED.seq, data = EXCLUDED.data WHERE distropro_rows.seq IS DISTINCT FROM EXCLUDED.seq OR distropro_rows.data IS DISTINCT FROM EXCLUDED.data`, values);
    copied += page.length;
    if (copied % 10_000 < 500 || page.length < 500) console.log(`Ko‘chirildi: ${copied} qator`);
    if (page.length < 500) break;
    page = source.prepare('SELECT tbl, k, seq, data FROM rows WHERE (tbl, k) > (?, ?) ORDER BY tbl, k LIMIT ?').all(lastTable, lastKey, 500);
  }

  const [sourceDigest, targetDigest, targetCount] = await Promise.all([
    Promise.resolve(hashSourceByTable()),
    hashTargetByTable(),
    queryTarget('SELECT COUNT(*)::bigint AS n FROM distropro_rows')
  ]);
  const sourceCount = Number(source.prepare('SELECT COUNT(*) AS n FROM rows').get().n);
  const neonCount = Number(targetCount.rows[0].n);
  console.log(`Tekshiruv: SQLite ${sourceCount} qator; Neon ${neonCount} qator.`);
  const mismatches = [...new Set([...sourceDigest.keys(), ...targetDigest.keys()])]
    .filter(table => sourceDigest.get(table) !== targetDigest.get(table));
  if (sourceCount !== neonCount || mismatches.length) {
    throw new Error('Qatorlar soni yoki mazmuni mos kelmadi. Neon’ni asosiy baza qilmang; tekshiruvni davom ettiring.');
  }
  console.log(`Barcha ${sourceDigest.size} jadvaldagi mazmun MD5 xeshlari va qatorlar soni mos. Manba SQLite fayli o‘zgartirilmadi.`);
} finally {
  source.close();
  await target.end();
}
