import { createClient } from '@libsql/client';
import { createHash } from 'node:crypto';
import pg from 'pg';

const { Pool } = pg;
const tursoUrl = process.env.TURSO_DATABASE_URL?.trim();
const tursoToken = process.env.TURSO_AUTH_TOKEN?.trim();
const neonUrl = process.env.NEON_DATABASE_URL?.trim();
if (!tursoUrl || !tursoToken || !neonUrl) {
  console.error('TURSO_DATABASE_URL, TURSO_AUTH_TOKEN va NEON_DATABASE_URL muhit o‘zgaruvchilarini belgilang. Qiymatlarni terminalda ko‘rsatmang.');
  process.exit(2);
}

const source = createClient({ url: tursoUrl, authToken: tursoToken });
const target = new Pool({ connectionString: neonUrl, ssl: true, max: 2, connectionTimeoutMillis: 15_000 });
const digestRow = (hash, row) => {
  const fields = [String(row.tbl), String(row.k), String(Number(row.seq)), String(row.data)];
  for (const field of fields) hash.update(`${Buffer.byteLength(field)}:`).update(field);
};
async function hashSource() {
  const hash = createHash('sha256');
  let lastTable = '';
  let lastKey = '';
  let count = 0;
  let page = await source.execute({ sql: 'SELECT tbl, k, seq, data FROM distropro_rows ORDER BY tbl, k LIMIT ?', args: [1000] });
  while (page.rows.length) {
    for (const row of page.rows) { digestRow(hash, row); lastTable = String(row.tbl); lastKey = String(row.k); count++; }
    if (page.rows.length < 1000) break;
    page = await source.execute({ sql: 'SELECT tbl, k, seq, data FROM distropro_rows WHERE (tbl, k) > (?, ?) ORDER BY tbl, k LIMIT ?', args: [lastTable, lastKey, 1000] });
  }
  return { count, hash: hash.digest('hex') };
}
async function hashTarget() {
  const hash = createHash('sha256');
  let lastTable = '';
  let lastKey = '';
  let count = 0;
  let page = await target.query('SELECT tbl, k, seq, data FROM distropro_rows ORDER BY tbl, k LIMIT $1', [1000]);
  while (page.rows.length) {
    for (const row of page.rows) { digestRow(hash, row); lastTable = String(row.tbl); lastKey = String(row.k); count++; }
    if (page.rows.length < 1000) break;
    page = await target.query('SELECT tbl, k, seq, data FROM distropro_rows WHERE (tbl, k) > ($1, $2) ORDER BY tbl, k LIMIT $3', [lastTable, lastKey, 1000]);
  }
  return { count, hash: hash.digest('hex') };
}
try {
  await target.query('CREATE TABLE IF NOT EXISTS distropro_rows (tbl TEXT NOT NULL, k TEXT NOT NULL, seq BIGINT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (tbl, k))');
  const before = Number((await target.query('SELECT COUNT(*)::bigint AS n FROM distropro_rows')).rows[0].n);
  if (before > 0 && process.env.MIGRATION_RESUME !== '1') {
    throw new Error(`Neon jadvalida oldindan ${before} qator bor. Tasodifiy aralashishni oldini olish uchun to‘xtatildi; aynan shu migratsiyani davom ettirayotgan bo‘lsangiz MIGRATION_RESUME=1 ni belgilang.`);
  }

  const first = await source.execute({ sql: 'SELECT tbl, k, seq, data FROM distropro_rows ORDER BY tbl, k LIMIT ?', args: [1000] });
  let page = first;
  let lastTable = '';
  let lastKey = '';
  let copied = 0;
  while (page.rows.length) {
    const values = [];
    const tuples = page.rows.map((row, i) => {
      const n = i * 4;
      values.push(String(row.tbl), String(row.k), Number(row.seq), String(row.data));
      lastTable = String(row.tbl);
      lastKey = String(row.k);
      return `($${n + 1}, $${n + 2}, $${n + 3}, $${n + 4})`;
    });
    await target.query(`INSERT INTO distropro_rows(tbl, k, seq, data) VALUES ${tuples.join(',')} ON CONFLICT (tbl, k) DO UPDATE SET seq = EXCLUDED.seq, data = EXCLUDED.data WHERE distropro_rows.seq IS DISTINCT FROM EXCLUDED.seq OR distropro_rows.data IS DISTINCT FROM EXCLUDED.data`, values);
    copied += page.rows.length;
    console.log(`Ko‘chirildi: ${copied} qator`);
    if (page.rows.length < 1000) break;
    page = await source.execute({
      sql: 'SELECT tbl, k, seq, data FROM distropro_rows WHERE (tbl, k) > (?, ?) ORDER BY tbl, k LIMIT ?',
      args: [lastTable, lastKey, 1000]
    });
  }
  const [sourceDigest, targetDigest] = await Promise.all([hashSource(), hashTarget()]);
  console.log(`Tekshiruv: Turso ${sourceDigest.count} qator; Neon ${targetDigest.count} qator.`);
  if (sourceDigest.count !== targetDigest.count || sourceDigest.hash !== targetDigest.hash) {
    throw new Error('Qatorlar soni yoki mazmuni mos kelmadi. Render ulanishini almashtirmang; ma’lumotni tekshirib, qayta davom ettiring.');
  }
  console.log(`Mazmun tekshiruvi muvaffaqiyatli (SHA-256: ${sourceDigest.hash}). Turso bazasi o‘zgartirilmadi.`);
} finally {
  source.close();
  await target.end();
}
