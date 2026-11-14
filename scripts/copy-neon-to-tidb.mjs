import { createHash } from 'node:crypto';
import pg from 'pg';

const { Pool } = pg;
const sourceUrl = process.env.NEON_DATABASE_URL?.trim();
const targetUrl = process.env.TIDB_DATABASE_URL?.trim();
if (!sourceUrl || !targetUrl) {
  throw new Error('NEON_DATABASE_URL va TIDB_DATABASE_URL ni muhit o‘zgaruvchilari sifatida belgilang. Ularning qiymatlarini terminalga yoki chatga chiqarmang.');
}

const source = new Pool({ connectionString: sourceUrl, ssl: true, max: 1, connectionTimeoutMillis: 15_000 });
const target = new Pool({ connectionString: targetUrl, ssl: true, max: 1, connectionTimeoutMillis: 15_000 });
const digestRows = rows => {
  const hash = createHash('sha256');
  for (const row of rows) {
    for (const value of row) {
      const part = value === null ? '<null>' : String(value);
      hash.update(`${Buffer.byteLength(part)}:`).update(part);
    }
  }
  return hash.digest('hex');
};

try {
  await source.query('SELECT 1');
  await target.query('SELECT 1');
  const sourceRows = await source.query('SELECT tbl, k, seq, data FROM distropro_rows ORDER BY tbl, k');
  const sourceChanges = await source.query('SELECT op, tbl, k, seq, data FROM distropro_sync_changes ORDER BY change_id');
  console.log(`Manba tayyor: ${sourceRows.rowCount} ta amaldagi yozuv, ${sourceChanges.rowCount} ta sinxronlash yozuvi.`);

  await target.query('CREATE TABLE IF NOT EXISTS distropro_rows (tbl TEXT NOT NULL, k TEXT NOT NULL, seq BIGINT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (tbl, k))');
  await target.query(`CREATE TABLE IF NOT EXISTS distropro_sync_changes (
    change_id BIGSERIAL PRIMARY KEY, op TEXT NOT NULL, tbl TEXT NOT NULL, k TEXT, seq BIGINT, data TEXT
  )`);
  const targetRowsBefore = Number((await target.query('SELECT COUNT(*) AS n FROM distropro_rows')).rows[0].n);
  const targetChangesBefore = Number((await target.query('SELECT COUNT(*) AS n FROM distropro_sync_changes')).rows[0].n);
  if (targetRowsBefore || targetChangesBefore) {
    throw new Error(`TiDB nishon bazasi bo‘sh emas (${targetRowsBefore} asosiy va ${targetChangesBefore} sinxronlash yozuvi). Hech narsa o‘zgartirilmadi.`);
  }
  if (process.env.CONFIRM_TIDB_COPY !== 'YES') {
    console.log('Quruq tekshiruv tugadi. Ma’lumot ko‘chmadi. Ko‘chirish uchun CONFIRM_TIDB_COPY=YES belgilang.');
    process.exitCode = 0;
  } else {
    const client = await target.connect();
    try {
      await client.query('BEGIN');
      const batchSize = 100;
      for (let offset = 0; offset < sourceRows.rows.length; offset += batchSize) {
        const page = sourceRows.rows.slice(offset, offset + batchSize);
        const values = [];
        const tuples = page.map((row, index) => {
          const i = index * 4;
          values.push(row.tbl, row.k, row.seq, row.data);
          return `($${i + 1}, $${i + 2}, $${i + 3}, $${i + 4})`;
        });
        if (tuples.length) await client.query(`INSERT INTO distropro_rows(tbl,k,seq,data) VALUES ${tuples.join(',')}`, values);
      }
      const changeBatchSize = 100;
      for (let offset = 0; offset < sourceChanges.rows.length; offset += changeBatchSize) {
        const page = sourceChanges.rows.slice(offset, offset + changeBatchSize);
        const values = [];
        const tuples = page.map((row, index) => {
          const i = index * 5;
          values.push(row.op, row.tbl, row.k, row.seq, row.data);
          return `($${i + 1}, $${i + 2}, $${i + 3}, $${i + 4}, $${i + 5})`;
        });
        if (tuples.length) await client.query(`INSERT INTO distropro_sync_changes(op,tbl,k,seq,data) VALUES ${tuples.join(',')}`, values);
      }
      const targetRows = await client.query('SELECT tbl, k, seq, data FROM distropro_rows ORDER BY tbl, k');
      const targetChanges = await client.query('SELECT op, tbl, k, seq, data FROM distropro_sync_changes ORDER BY change_id');
      if (digestRows(sourceRows.rows.map(row => [row.tbl, row.k, row.seq, row.data])) !== digestRows(targetRows.rows.map(row => [row.tbl, row.k, row.seq, row.data]))) {
        throw new Error('Asosiy yozuvlar hash tekshiruvidan o‘tmadi. Tranzaksiya bekor qilindi.');
      }
      if (digestRows(sourceChanges.rows.map(row => [row.op, row.tbl, row.k, row.seq, row.data])) !== digestRows(targetChanges.rows.map(row => [row.op, row.tbl, row.k, row.seq, row.data]))) {
        throw new Error('Sinxronlash yozuvlari hash tekshiruvidan o‘tmadi. Tranzaksiya bekor qilindi.');
      }
      await client.query('COMMIT');
      console.log(`Ko‘chirish va hash tekshiruvi muvaffaqiyatli: ${targetRows.rowCount} asosiy yozuv, ${targetChanges.rowCount} sinxronlash yozuvi.`);
      console.log('Neon o‘zgartirilmadi. Ilova TiDB’ga faqat Render’da TIDB_DATABASE_URL o‘rnatilgach ulanadi.');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
} finally {
  await Promise.all([source.end(), target.end()]);
}
