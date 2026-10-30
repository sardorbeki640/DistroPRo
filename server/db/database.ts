import fs from 'node:fs';
import path from 'node:path';
import { createClient, type Client } from '@libsql/client';
import type { DatabaseSchema } from './schema.ts';
import { decryptSecret, encryptSecret } from '../jarvis/secrets.ts';

const DB_DIR = path.resolve(process.env.FINANCE_DATA_DIR || path.join(process.cwd(), '.data'));
const SQLITE_FILE = path.resolve(DB_DIR, 'finance.sqlite');
const LEGACY_JSON = path.resolve(DB_DIR, 'finance_db.json');

const INITIAL_EMPTY_SCHEMA: DatabaseSchema = {
  companies: [],
  roles: [],
  permissions: [],
  role_permissions: [],
  users: [],
  user_roles: [],
  employees: [],
  agents: [],
  customers: [],
  territories: [],
  cash_registers: [],
  cash_days: [],
  cash_transactions: [],
  daily_order_entries: [],
  payments: [],
  customer_balance_transactions: [],
  returns: [],
  expenses: [],
  expense_categories: [],
  expense_limits: [],
  expense_allocations: [],
  employee_daily_limits: [],
  salaries: [],
  salary_rules: [],
  piecework_rules: [],
  piecework_transactions: [],
  products: [],
  sales_orders: [],
  sales_order_items: [],
  notification_events: [],
  notification_channels: [],
  notification_rules: [],
  notifications: [],
  audit_logs: [],
  integrations: [],
  integration_transactions: [],
  external_orders: [],
  external_customers: [],
  external_payments: [],
  external_returns: [],
  crm_tasks: [],
  crm_activities: [],
  crm_stages: [],
  crm_deals: [],
  jarvis_conversations: [],
  jarvis_actions: [],
  jarvis_settings: [],
  jarvis_memories: [],
  face_profiles: [],
  attendance_events: [],
  attendance_settings: [],
  discipline_violations: [],
  agent_visit_days: [],
  staff_telegram: [],
  sheet_rows: [],
  sales_teams: [],
  agent_strategies: [],
  _quarantine: [],
  _migrations: []
};

/**
 * Tables whose rows may come from a distribution integration (row.source_integration_id). Rows of an integration the user
 * switched off are hidden from every read (find/findOne/getTable) but kept, so switching it on again shows them.
 * Cash days and cash transactions are never hidden: they are money actually received.
 */
const SOURCED_TABLES = new Set<string>(['customers', 'products', 'agents', 'sales_orders', 'sales_order_items', 'customer_balance_transactions']);

/** Integration secrets (SalesDoc / Linko passwords and tokens) are stored encrypted on disk and in backups. */
const SECRET_FIELDS = ['password', 'api_token', 'bot_token'];
// Tables whose row.config holds secrets (integration passwords, bot tokens): encrypted on disk, plain in memory.
const SECRET_TABLES = new Set(['integrations', 'notification_channels']);
const ENC_PREFIX = 'enc:';

interface RowMeta { key: string; seq: number }
type TursoOutboxOp = { id: number; op: 'clear' | 'upsert' | 'delete'; tbl: string; k: string | null; seq: number | null; data: string | null };

/**
 * Data lives in memory (fast reads, same API as before) and is persisted to SQLite row by row: a change writes only
 * the rows it touched, in one SQLite transaction. A failed transaction is undone from a journal of the changes it made
 * (no whole-database snapshot). The old single JSON file is imported once and kept next to the database.
 */
class DatabaseManager {
  private data: DatabaseSchema;
  private isLoaded = false;
  private sql: any = null;
  private stmt: { upsert: any; remove: any; clearTable: any } | null = null;
  private meta = new WeakMap<object, RowMeta>();
  private index = new Map<string, Map<string, any>>();     // table -> key -> row
  private dirty = new Map<string, Set<string>>();          // table -> keys to write (or delete when gone)
  private fullDirty = new Set<string>();                    // tables to rewrite completely
  private journal: (() => void)[] = [];
  private transactionDepth = 0;
  private nextSeq = 1;
  private turso: Client | null = null;
  private tursoDrain: Promise<void> | null = null;
  private tursoRetryTimer: NodeJS.Timeout | null = null;
  private tursoRetryDelayMs = 5_000;
  private tursoLastErrorLogAt = 0;

  constructor() {
    this.data = JSON.parse(JSON.stringify(INITIAL_EMPTY_SCHEMA));
  }

  // ---------------- storage ----------------

  public init(): void {
    if (this.isLoaded) return;
    if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
    const sqlite = (process as any).getBuiltinModule?.('node:sqlite');
    if (!sqlite) throw new Error('Bu Node versiyasida SQLite yo‘q (Node 22.5+ kerak).');
    this.sql = new sqlite.DatabaseSync(SQLITE_FILE);
    this.sql.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=10000;');
    this.sql.exec('CREATE TABLE IF NOT EXISTS rows(tbl TEXT NOT NULL, k TEXT NOT NULL, seq INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(tbl, k)) WITHOUT ROWID');
    this.sql.exec('CREATE TABLE IF NOT EXISTS turso_outbox(id INTEGER PRIMARY KEY AUTOINCREMENT, op TEXT NOT NULL, tbl TEXT NOT NULL, k TEXT, seq INTEGER, data TEXT)');
    this.stmt = {
      upsert: this.sql.prepare('INSERT OR REPLACE INTO rows(tbl, k, seq, data) VALUES (?, ?, ?, ?)'),
      remove: this.sql.prepare('DELETE FROM rows WHERE tbl = ? AND k = ?'),
      clearTable: this.sql.prepare('DELETE FROM rows WHERE tbl = ?')
    };
    const count = Number(this.sql.prepare('SELECT COUNT(*) AS n FROM rows').get().n);
    if (count === 0 && fs.existsSync(LEGACY_JSON) && fs.statSync(LEGACY_JSON).size > 0) {
      this.importLegacyJson();
    } else if (!process.env.TURSO_DATABASE_URL?.trim() || !process.env.TURSO_AUTH_TOKEN?.trim()) {
      // With Turso enabled, wait to hydrate until we know which snapshot is
      // authoritative; holding both local and cloud copies can exceed a small
      // host's memory limit during startup.
      this.reloadFromSqlite();
    }
    this.isLoaded = true;
  }

  private reloadFromSqlite(): void {
    this.data = JSON.parse(JSON.stringify(INITIAL_EMPTY_SCHEMA));
    this.index.clear();
    this.meta = new WeakMap<object, RowMeta>();
    let maxSeq = 0;
    for (const r of this.sql.prepare('SELECT tbl, k, seq, data FROM rows ORDER BY tbl, seq').iterate()) {
      const row = this.deserialize(r.tbl, JSON.parse(r.data));
      const table = ((this.data as any)[r.tbl] ||= []) as any[];
      table.push(row);
      this.meta.set(row, { key: r.k, seq: Number(r.seq) });
      this.indexOf(r.tbl).set(r.k, row);
      if (Number(r.seq) > maxSeq) maxSeq = Number(r.seq);
    }
    this.nextSeq = maxSeq + 1;
  }

  /** Hydrate in small turns so the HTTP health endpoint stays responsive on small hosts. */
  private async reloadFromSqliteYielding(): Promise<void> {
    this.data = JSON.parse(JSON.stringify(INITIAL_EMPTY_SCHEMA));
    this.index.clear();
    this.meta = new WeakMap<object, RowMeta>();
    let maxSeq = 0;
    let processed = 0;
    for (const r of this.sql.prepare('SELECT tbl, k, seq, data FROM rows ORDER BY tbl, seq').iterate()) {
      const row = this.deserialize(r.tbl, JSON.parse(r.data));
      const table = ((this.data as any)[r.tbl] ||= []) as any[];
      table.push(row);
      this.meta.set(row, { key: r.k, seq: Number(r.seq) });
      this.indexOf(r.tbl).set(r.k, row);
      if (Number(r.seq) > maxSeq) maxSeq = Number(r.seq);
      // Keep Render's 5-second health check responsive even while restoring a
      // large Turso snapshot on a single-core free instance.
      if (++processed % 500 === 0) await new Promise<void>(resolve => setImmediate(resolve));
    }
    this.nextSeq = maxSeq + 1;
  }

  /** Connect the local SQLite cache to a Turso database and restore the cloud copy before migrations run. */
  public async connectTurso(): Promise<void> {
    if (this.turso) return;
    const url = process.env.TURSO_DATABASE_URL?.trim();
    const authToken = process.env.TURSO_AUTH_TOKEN?.trim();
    if (!url && !authToken) return;
    if (!url || (!authToken && !url.startsWith('file:'))) {
      throw new Error('Turso ulanishi uchun TURSO_DATABASE_URL va TURSO_AUTH_TOKEN sozlanishi kerak.');
    }

    const startedAt = Date.now();
    let restoredRows = 0;
    const client = createClient({ url, ...(authToken ? { authToken } : {}) });
    await client.execute('CREATE TABLE IF NOT EXISTS distropro_rows (tbl TEXT NOT NULL, k TEXT NOT NULL, seq INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (tbl, k))');
    const pageSize = 5000;
    // Page on the composite primary key. Ordering/cursoring by seq had no matching
    // index and forced Turso to rescan and resort the entire cloud table per page.
    const firstPage = await client.execute({
      sql: 'SELECT tbl, k, seq, data FROM distropro_rows ORDER BY tbl, k LIMIT ?',
      args: [pageSize]
    });
    const localCount = Number(this.sql.prepare('SELECT COUNT(*) AS n FROM rows').get().n);

    if (firstPage.rows.length === 0) {
      // First connection: preserve any existing SQLite data by seeding the empty Turso table.
      if (localCount > 0) await this.writeTursoRows(client, this.sql.prepare('SELECT tbl, k, seq, data FROM rows ORDER BY tbl, seq').iterate());
      await this.reloadFromSqliteYielding();
    } else {
      // Cloud is authoritative after the first sync. Replay the durable local outbox over the snapshot.
      this.data = JSON.parse(JSON.stringify(INITIAL_EMPTY_SCHEMA));
      this.index.clear();
      this.meta = new WeakMap<object, RowMeta>();
      this.nextSeq = 1;
      const pending = this.sql.prepare('SELECT id, op, tbl, k, seq, data FROM turso_outbox ORDER BY id').all() as TursoOutboxOp[];
      this.sql.exec('BEGIN IMMEDIATE');
      try {
        this.sql.exec('DELETE FROM rows');
        const put = this.sql.prepare('INSERT OR REPLACE INTO rows(tbl, k, seq, data) VALUES (?, ?, ?, ?)');
        let page = firstPage;
        let lastTable = '';
        let lastKey = '';
        while (page.rows.length) {
          for (const row of page.rows as any[]) {
            const tableName = String(row.tbl), key = String(row.k), seq = Number(row.seq), data = String(row.data);
            put.run(tableName, key, seq, data);
            this.hydrateMemoryRow(tableName, key, seq, data);
            lastTable = tableName;
            lastKey = key;
            if (++restoredRows % 500 === 0) await new Promise<void>(resolve => setImmediate(resolve));
          }
          if (page.rows.length < pageSize) break;
          page = await client.execute({
            // A row-value cursor matches the composite (tbl, k) primary key and
            // avoids scanning the table again for every hydration page.
            sql: 'SELECT tbl, k, seq, data FROM distropro_rows WHERE (tbl, k) > (?, ?) ORDER BY tbl, k LIMIT ?',
            args: [lastTable, lastKey, pageSize]
          });
        }
        await this.applyOutboxToLocal(pending);
        this.sql.exec('COMMIT');
        await this.applyOutboxToMemory(pending);
        this.nextSeq = Math.max(this.nextSeq, ...pending.filter(op => op.seq !== null).map(op => Number(op.seq) + 1), 1);
      } catch (error) {
        try { this.sql.exec('ROLLBACK'); } catch { /* not started */ }
        throw error;
      }
      // The cloud snapshot is already in memory. Re-reading the just-written
      // local cache here doubled JSON parsing on every cold start.
    }

    this.turso = client;
    await this.flushTurso();
    this.scheduleTursoFlush();
    console.log(`[Turso] Ulanish tayyor; ${restoredRows} qator ${Date.now() - startedAt} ms da tiklandi.`);
  }

  /** Load a cloud row into the live in-memory view while the optional SQLite cache is populated. */
  private hydrateMemoryRow(tableName: string, key: string, seq: number, serialized: string): void {
    const row = this.deserialize(tableName, JSON.parse(serialized));
    const table = ((this.data as any)[tableName] ||= []) as any[];
    table.push(row);
    this.meta.set(row, { key, seq });
    this.indexOf(tableName).set(key, row);
    if (seq >= this.nextSeq) this.nextSeq = seq + 1;
  }

  /** Replay the durable outbox over a cloud snapshot in memory, in the same order as its SQLite replay. */
  private async applyOutboxToMemory(ops: TursoOutboxOp[]): Promise<void> {
    let processed = 0;
    for (const op of ops) {
      const table = ((this.data as any)[op.tbl] ||= []) as any[];
      const index = this.indexOf(op.tbl);
      if (op.op === 'clear') {
        (this.data as any)[op.tbl] = [];
        index.clear();
      } else if (op.op === 'delete' && op.k !== null) {
        const old = index.get(op.k);
        if (old) {
          const at = table.indexOf(old);
          if (at >= 0) table.splice(at, 1);
          this.meta.delete(old);
          index.delete(op.k);
        }
      } else if (op.op === 'upsert' && op.k !== null && op.seq !== null && op.data !== null) {
        const row = this.deserialize(op.tbl, JSON.parse(op.data));
        const old = index.get(op.k);
        if (old) {
          const at = table.indexOf(old);
          if (at >= 0) table[at] = row; else table.push(row);
          this.meta.delete(old);
        } else table.push(row);
        this.meta.set(row, { key: op.k, seq: Number(op.seq) });
        index.set(op.k, row);
        this.nextSeq = Math.max(this.nextSeq, Number(op.seq) + 1);
      }
      if (++processed % 500 === 0) await new Promise<void>(resolve => setImmediate(resolve));
    }
  }

  private async applyOutboxToLocal(ops: TursoOutboxOp[]): Promise<void> {
    const remove = this.sql.prepare('DELETE FROM rows WHERE tbl = ? AND k = ?');
    const clear = this.sql.prepare('DELETE FROM rows WHERE tbl = ?');
    const put = this.sql.prepare('INSERT OR REPLACE INTO rows(tbl, k, seq, data) VALUES (?, ?, ?, ?)');
    let processed = 0;
    for (const op of ops) {
      if (op.op === 'clear') clear.run(op.tbl);
      else if (op.op === 'delete' && op.k !== null) remove.run(op.tbl, op.k);
      else if (op.op === 'upsert' && op.k !== null && op.seq !== null && op.data !== null) put.run(op.tbl, op.k, op.seq, op.data);
      if (++processed % 25 === 0) await new Promise<void>(resolve => setImmediate(resolve));
    }
  }

  private async writeTursoRows(client: Client, rows: Iterable<any>): Promise<void> {
    // Use a single HTTP batch per small chunk. Sequential execute() calls inside an
    // interactive transaction can leave the Turso stream idle long enough to expire.
    let statements: any[] = [];
    for (const row of rows) {
      statements.push({
        sql: 'INSERT OR REPLACE INTO distropro_rows(tbl, k, seq, data) VALUES (?, ?, ?, ?)',
        args: [row.tbl, row.k, Number(row.seq), row.data]
      });
      if (statements.length === 50) {
        await client.batch(statements, 'write');
        statements = [];
      }
    }
    if (statements.length) {
      await client.batch(statements, 'write');
    }
  }

  /** Wait until every locally committed write has reached Turso. Mutating API responses use this as a durability barrier. */
  public isTursoEnabled(): boolean { return this.turso !== null; }

  public async flushTurso(): Promise<void> {
    if (!this.turso || !this.sql) return;
    if (this.tursoDrain) {
      await this.tursoDrain;
      if (Number(this.sql.prepare('SELECT COUNT(*) AS n FROM turso_outbox').get().n) > 0) return this.flushTurso();
      return;
    }
    const work = this.drainTursoOutbox();
    this.tursoDrain = work;
    try {
      await work;
      this.tursoRetryDelayMs = 5_000;
    } catch (error) {
      const now = Date.now();
      if (now - this.tursoLastErrorLogAt >= 60_000) {
        console.error('[Turso] Sinxronlash xatosi; navbat saqlanib, keyin qayta uriniladi:', (error as Error).message);
        this.tursoLastErrorLogAt = now;
      }
      this.tursoRetryDelayMs = Math.min(this.tursoRetryDelayMs * 2, 5 * 60_000);
      this.scheduleTursoFlush(this.tursoRetryDelayMs);
      throw error;
    } finally { if (this.tursoDrain === work) this.tursoDrain = null; }
    if (Number(this.sql.prepare('SELECT COUNT(*) AS n FROM turso_outbox').get().n) > 0) return this.flushTurso();
  }

  /** Coalesce background writes and back off on network failures instead of flooding Turso and Render logs. */
  private scheduleTursoFlush(delayMs = this.tursoRetryDelayMs): void {
    if (!this.turso || !this.sql || this.tursoRetryTimer) return;
    this.tursoRetryTimer = setTimeout(() => {
      this.tursoRetryTimer = null;
      void this.flushTurso().catch(() => { /* flushTurso logs once and schedules a backed-off retry */ });
    }, delayMs);
    this.tursoRetryTimer.unref?.();
  }

  private async drainTursoOutbox(): Promise<void> {
    while (true) {
      const ops = this.sql.prepare('SELECT id, op, tbl, k, seq, data FROM turso_outbox ORDER BY id LIMIT 50').all() as TursoOutboxOp[];
      if (!ops.length) return;
      const statements = ops.flatMap(op => {
        if (op.op === 'clear') return [{ sql: 'DELETE FROM distropro_rows WHERE tbl = ?', args: [op.tbl] }];
        if (op.op === 'delete' && op.k !== null) return [{ sql: 'DELETE FROM distropro_rows WHERE tbl = ? AND k = ?', args: [op.tbl, op.k] }];
        if (op.op === 'upsert' && op.k !== null && op.seq !== null && op.data !== null) {
          return [{ sql: 'INSERT OR REPLACE INTO distropro_rows(tbl, k, seq, data) VALUES (?, ?, ?, ?)', args: [op.tbl, op.k, op.seq, op.data] }];
        }
        return [];
      });
      // A batch is atomic on the remote database, avoids a long-lived interactive
      // transaction, and preserves operation order (including clear + reinsert).
      await this.turso!.batch(statements, 'write');
      const ids = ops.map(op => op.id);
      const placeholders = ids.map(() => '?').join(',');
      this.sql.prepare(`DELETE FROM turso_outbox WHERE id IN (${placeholders})`).run(...ids);
    }
  }

  /** One-time move from finance_db.json; the JSON stays as finance_db.json.imported-<time>. */
  private importLegacyJson() {
    let parsed: any;
    try {
      parsed = JSON.parse(fs.readFileSync(LEGACY_JSON, 'utf-8'));
      for (const key of Object.keys(INITIAL_EMPTY_SCHEMA)) {
        if (key in parsed && !Array.isArray(parsed[key])) throw new Error(`Invalid table: ${key}`);
      }
    } catch (err) {
      throw new Error('Eski baza fayli (finance_db.json) ochilmadi. Asl fayl saqlandi; zaxira nusxani tekshiring.', { cause: err });
    }
    this.data = { ...JSON.parse(JSON.stringify(INITIAL_EMPTY_SCHEMA)), ...parsed };
    for (const [table, rows] of Object.entries(this.data)) {
      if (!Array.isArray(rows)) continue;
      for (const row of rows as any[]) this.ensureMeta(table, row);
      this.fullDirty.add(table);
    }
    this.flush();
    this.sql.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.renameSync(LEGACY_JSON, `${LEGACY_JSON}.imported-${stamp}`);
    for (const extra of [`${LEGACY_JSON}.previous`]) if (fs.existsSync(extra)) fs.renameSync(extra, `${extra}.imported-${stamp}`);
    console.log(`[DB] finance_db.json SQLite bazasiga ko‘chirildi (${SQLITE_FILE}).`);
  }

  private indexOf(table: string): Map<string, any> {
    let m = this.index.get(table);
    if (!m) { m = new Map(); this.index.set(table, m); }
    return m;
  }

  private ensureMeta(table: string, row: any): RowMeta {
    let m = this.meta.get(row);
    if (m) return m;
    const idx = this.indexOf(table);
    const seq = this.nextSeq++;
    let key = row && row.id !== undefined && row.id !== null ? String(row.id) : `auto:${seq}`;
    if (idx.has(key) && idx.get(key) !== row) key = `${key}#${seq}`;   // legacy duplicate ids are kept apart
    m = { key, seq };
    this.meta.set(row, m);
    idx.set(key, row);
    return m;
  }

  private touch(table: string, key: string) {
    let set = this.dirty.get(table);
    if (!set) { set = new Set(); this.dirty.set(table, set); }
    set.add(key);
  }

  private serialize(table: string, row: any): string {
    // Face descriptors are biometric data: one encrypted string on disk.
    if (table === 'face_profiles' && Array.isArray(row?.descriptors) && process.env.JWT_SECRET) {
      return JSON.stringify({ ...row, descriptors: ENC_PREFIX + encryptSecret(JSON.stringify(row.descriptors)) });
    }
    if (SECRET_TABLES.has(table) && row?.config && process.env.JWT_SECRET) {
      const config = { ...row.config };
      for (const f of SECRET_FIELDS) {
        if (typeof config[f] === 'string' && config[f] && !config[f].startsWith(ENC_PREFIX)) config[f] = ENC_PREFIX + encryptSecret(config[f]);
      }
      return JSON.stringify({ ...row, config });
    }
    return JSON.stringify(row);
  }

  private deserialize(table: string, row: any): any {
    if (table === 'face_profiles' && typeof row?.descriptors === 'string' && row.descriptors.startsWith(ENC_PREFIX)) {
      try { row.descriptors = JSON.parse(decryptSecret(row.descriptors.slice(ENC_PREFIX.length))); }
      catch { console.warn('[DB] Yuz profili ochilmadi (server kaliti o‘zgargan) — xodimni qayta ro‘yxatdan o‘tkazing.'); row.descriptors = []; }
    }
    if (SECRET_TABLES.has(table) && row?.config) {
      for (const f of SECRET_FIELDS) {
        const v = row.config[f];
        if (typeof v === 'string' && v.startsWith(ENC_PREFIX)) {
          try { row.config[f] = decryptSecret(v.slice(ENC_PREFIX.length)); }
          catch { console.warn(`[DB] ${row.provider_name || row.name} ${f} ochilmadi (server kaliti o‘zgargan) — sozlamada qayta kiriting.`); row.config[f] = ''; }
        }
      }
    }
    return row;
  }

  /** Writes pending changes in one SQLite transaction. */
  private flush(): void {
    if (!this.sql || (!this.dirty.size && !this.fullDirty.size)) return;
    const { upsert, remove, clearTable } = this.stmt!;
    const enqueue = this.turso ? this.sql.prepare('INSERT INTO turso_outbox(op, tbl, k, seq, data) VALUES (?, ?, ?, ?, ?)') : null;
    this.sql.exec('BEGIN IMMEDIATE');
    try {
      for (const table of this.fullDirty) {
        enqueue?.run('clear', table, null, null, null);
        clearTable.run(table);
        const rows = ((this.data as any)[table] || []) as any[];
        const idx = this.indexOf(table);
        idx.clear();
        for (const row of rows) {
          const m = this.meta.get(row) || this.ensureMeta(table, row);
          idx.set(m.key, row);
          const data = this.serialize(table, row);
          upsert.run(table, m.key, m.seq, data);
          enqueue?.run('upsert', table, m.key, m.seq, data);
        }
        this.dirty.delete(table);
      }
      for (const [table, keys] of this.dirty) {
        const idx = this.indexOf(table);
        for (const key of keys) {
          const row = idx.get(key);
          if (row) {
            const seq = this.meta.get(row)!.seq;
            const data = this.serialize(table, row);
            upsert.run(table, key, seq, data);
            enqueue?.run('upsert', table, key, seq, data);
          } else {
            remove.run(table, key);
            enqueue?.run('delete', table, key, null, null);
          }
        }
      }
      this.sql.exec('COMMIT');
    } catch (error) {
      try { this.sql.exec('ROLLBACK'); } catch { /* not started */ }
      throw Object.assign(new Error('Ma’lumotni saqlab bo‘lmadi (disk band yoki to‘la). O‘zgarish bekor qilindi — qayta urinib ko‘ring.'), { cause: error, status: 503 });
    }
    this.dirty.clear();
    this.fullDirty.clear();
    if (this.turso) this.scheduleTursoFlush();
  }

  /** Kept for callers of the old API: writes whatever is pending. */
  public persist(): void {
    if (this.transactionDepth > 0) return;
    this.flush();
  }

  /**
   * For code that changed rows in place (migrations, bulk repairs): with rows, only those are written;
   * without, the whole table is rewritten.
   */
  public markDirty(tableName: keyof DatabaseSchema | string, rows?: any[]): void {
    this.init();
    if (!rows) { this.fullDirty.add(tableName as string); return; }
    for (const row of rows) this.touch(tableName as string, this.ensureMeta(tableName as string, row).key);
  }

  /** Rewrites every table — a safety net for in-place edits nobody marked (run nightly with the backup). */
  public checkpointAll(): void {
    this.init();
    for (const table of Object.keys(this.data)) this.fullDirty.add(table);
    this.persist();
  }

  public getData(): DatabaseSchema {
    this.init();
    return this.data;
  }

  // ---------------- reads ----------------

  /** Ids of switched-off integrations whose rows are hidden, or null when nothing is hidden (checked per read; the table is tiny). */
  private hiddenSources(tableName: string): Set<string> | null {
    if (!SOURCED_TABLES.has(tableName)) return null;
    let hidden: Set<string> | null = null;
    const integrations = this.data.integrations as any[];
    const known = new Set(integrations.map(i => String(i.id)));
    for (const i of integrations) if (i.disabled) (hidden ||= new Set()).add(String(i.id));
    // Keep imported rows hidden if an admin permanently removes its connection record.
    // The historical rows stay in the database for audit/recovery; deleting the connection
    // must not make that server's old data reappear in current screens.
    for (const row of this.data[tableName as keyof DatabaseSchema] as any[]) {
      const sourceId = row?.source_integration_id;
      if (sourceId && !known.has(String(sourceId))) (hidden ||= new Set()).add(String(sourceId));
    }
    return hidden;
  }

  /** A row's source is inherited when missing: an order line from its order, a ledger row from its customer. */
  private inheritSource(tableName: string, rows: any[]) {
    if (tableName !== 'sales_order_items' && tableName !== 'customer_balance_transactions') return;
    const parentTable = tableName === 'sales_order_items' ? 'sales_orders' : 'customers';
    const parentKey = tableName === 'sales_order_items' ? 'sales_order_id' : 'customer_id';
    const parents = this.indexOf(parentTable);
    for (const r of rows) {
      if (!r || r.source_integration_id !== undefined || !r[parentKey]) continue;
      const parent = parents.get(String(r[parentKey]));
      if (parent?.source_integration_id) r.source_integration_id = parent.source_integration_id;
    }
  }

  public getTable<K extends keyof DatabaseSchema>(tableName: K): DatabaseSchema[K] {
    this.init();
    const hidden = this.hiddenSources(tableName as string);
    if (!hidden) return this.data[tableName];
    return (this.data[tableName] as any[]).filter(r => !r.source_integration_id || !hidden.has(r.source_integration_id)) as DatabaseSchema[K];
  }

  /** Every row, including those of switched-off integrations. For migrations and source bookkeeping only. */
  public getTableIncludingHidden<K extends keyof DatabaseSchema>(tableName: K): DatabaseSchema[K] {
    this.init();
    return this.data[tableName];
  }

  public findById<K extends keyof DatabaseSchema>(tableName: K, id: string): DatabaseSchema[K][number] | null {
    this.init();
    const hit = this.indexOf(tableName as string).get(String(id));
    if (hit && hit.id === id) return hit;
    return (this.data[tableName] as any[]).find((item: any) => item.id === id) || null;
  }

  public find<K extends keyof DatabaseSchema>(tableName: K, predicate: (item: DatabaseSchema[K][number]) => boolean): DatabaseSchema[K][number][] {
    this.init();
    const table = this.data[tableName] as any[];
    const hidden = this.hiddenSources(tableName as string);
    if (!hidden) return table.filter(predicate);
    return table.filter(r => (!r.source_integration_id || !hidden.has(r.source_integration_id)) && predicate(r));
  }

  public findOne<K extends keyof DatabaseSchema>(tableName: K, predicate: (item: DatabaseSchema[K][number]) => boolean): DatabaseSchema[K][number] | null {
    this.init();
    const table = this.data[tableName] as any[];
    const hidden = this.hiddenSources(tableName as string);
    if (!hidden) return table.find(predicate) || null;
    return table.find(r => (!r.source_integration_id || !hidden.has(r.source_integration_id)) && predicate(r)) || null;
  }

  // ---------------- writes (each one is a transaction) ----------------

  public insert<K extends keyof DatabaseSchema>(tableName: K, record: DatabaseSchema[K][number]): DatabaseSchema[K][number] {
    return this.transaction(() => {
      const t = tableName as string;
      const table = this.data[tableName] as any[];
      if (t === 'users') {
        const email = (record as any).email?.toLowerCase();
        if (table.some((u: any) => u.email?.toLowerCase() === email)) throw new Error(`User with email "${email}" already exists.`);
      }
      if (t === 'cash_days') {
        const { company_id, date, register_id } = record as any;
        if (table.find((cd: any) => cd.company_id === company_id && cd.date === date && cd.register_id === register_id)) {
          throw new Error(`Unique Constraint Violation: CashDay already exists for company_id ${company_id}, register_id ${register_id} on date ${date}.`);
        }
      }
      this.inheritSource(t, [record]);
      const m = this.ensureMeta(t, record);
      table.push(record);
      this.touch(t, m.key);
      this.journal.push(() => {
        const at = table.lastIndexOf(record);
        if (at >= 0) table.splice(at, 1);
        this.indexOf(t).delete(m.key);
        this.touch(t, m.key);
      });
      return record;
    });
  }

  public update<K extends keyof DatabaseSchema>(tableName: K, id: string, updates: Partial<DatabaseSchema[K][number]>): DatabaseSchema[K][number] | null {
    if (tableName === 'audit_logs') throw new Error('Security Violation: Audit logs cannot be edited.');
    return this.transaction(() => {
      const t = tableName as string;
      const table = this.data[tableName] as any[];
      const idx = table.findIndex((item: any) => item.id === id);
      if (idx === -1) return null;
      const previous = table[idx];
      const next = { ...previous, ...updates, updated_at: new Date().toISOString() };
      const m = this.meta.get(previous) || this.ensureMeta(t, previous);
      this.meta.set(next, m);
      table[idx] = next;
      this.indexOf(t).set(m.key, next);
      this.touch(t, m.key);
      this.journal.push(() => {
        const at = table.indexOf(next);
        if (at >= 0) table[at] = previous;
        this.indexOf(t).set(m.key, previous);
        this.touch(t, m.key);
      });
      return next;
    });
  }

  public delete<K extends keyof DatabaseSchema>(tableName: K, id: string): boolean {
    if (tableName === 'audit_logs') throw new Error('Security Violation: Audit logs are strictly immutable and cannot be deleted.');
    return this.transaction(() => {
      const t = tableName as string;
      const table = this.data[tableName] as any[];
      const idx = table.findIndex((item: any) => item.id === id);
      if (idx === -1) return false;
      const [removed] = table.splice(idx, 1);
      const m = this.meta.get(removed) || this.ensureMeta(t, removed);
      this.indexOf(t).delete(m.key);
      this.touch(t, m.key);
      this.journal.push(() => {
        table.splice(Math.min(idx, table.length), 0, removed);
        this.indexOf(t).set(m.key, removed);
        this.touch(t, m.key);
      });
      return true;
    });
  }

  /** Removes all matching rows in one transaction. */
  public removeWhere<K extends keyof DatabaseSchema>(tableName: K, predicate: (item: DatabaseSchema[K][number]) => boolean): number {
    if (tableName === 'audit_logs') throw new Error('Security Violation: Audit logs are strictly immutable and cannot be deleted.');
    return this.transaction(() => {
      const t = tableName as string;
      const previous = this.data[tableName] as any[];
      const kept: any[] = [];
      const removed: any[] = [];
      for (const item of previous) (predicate(item) ? removed : kept).push(item);
      if (!removed.length) return 0;
      (this.data as any)[tableName] = kept;
      const idx = this.indexOf(t);
      for (const row of removed) { const m = this.meta.get(row) || this.ensureMeta(t, row); idx.delete(m.key); this.touch(t, m.key); }
      this.journal.push(() => {
        (this.data as any)[tableName] = previous;
        for (const row of removed) { const m = this.meta.get(row)!; idx.set(m.key, row); this.touch(t, m.key); }
      });
      return removed.length;
    });
  }

  /** Inserts or merges many rows by id in one transaction. */
  public upsertMany<K extends keyof DatabaseSchema>(tableName: K, records: DatabaseSchema[K][number][]): { inserted: number; updated: number } {
    if (tableName === 'audit_logs') throw new Error('Security Violation: Audit logs cannot be edited.');
    return this.transaction(() => {
      const t = tableName as string;
      const previous = this.data[tableName] as any[];
      this.inheritSource(t, records as any[]);
      const table = previous.slice();
      const position = new Map<string, number>(table.map((row: any, i: number) => [row.id, i]));
      const idx = this.indexOf(t);
      const replaced: [string, any][] = [];
      const added: string[] = [];
      let inserted = 0;
      let updated = 0;
      for (const record of records as any[]) {
        const i = position.get(record.id);
        if (i === undefined) {
          const m = this.ensureMeta(t, record);
          position.set(record.id, table.length);
          table.push(record);
          this.touch(t, m.key);
          added.push(m.key);
          inserted++;
        } else {
          const old = table[i];
          const merged = { ...old, ...record };
          const m = this.meta.get(old) || this.ensureMeta(t, old);
          this.meta.set(merged, m);
          table[i] = merged;
          replaced.push([m.key, old]);
          idx.set(m.key, merged);
          this.touch(t, m.key);
          updated++;
        }
      }
      (this.data as any)[tableName] = table;
      this.journal.push(() => {
        (this.data as any)[tableName] = previous;
        for (const key of added) { idx.delete(key); this.touch(t, key); }
        for (const [key, old] of replaced) { idx.set(key, old); this.touch(t, key); }
      });
      return { inserted, updated };
    });
  }

  /**
   * Atomic runner. Changes are written to SQLite when the outermost transaction ends; an error undoes the changes made
   * inside (nested transactions roll back only their own part when the caller catches the error).
   */
  public transaction<T>(callback: (db: DatabaseManager) => T): T {
    this.init();
    const mark = this.journal.length;
    const depthBefore = this.transactionDepth;
    const outer = depthBefore === 0;
    this.transactionDepth++;
    try {
      const result = callback(this);
      if (result && typeof (result as any).then === 'function') throw new Error('Async callback is not supported in transaction');
      this.transactionDepth = depthBefore;
      if (outer) {
        this.flush();
        this.journal.length = 0;
      }
      return result;
    } catch (error) {
      this.transactionDepth = depthBefore;
      while (this.journal.length > mark) this.journal.pop()!();
      if (outer) {
        // Memory is back to the last saved state; nothing from this transaction may be written later.
        this.dirty.clear();
        this.fullDirty.clear();
        this.journal.length = 0;
      }
      throw error;
    }
  }

  // ---------------- backups ----------------

  /** Consistent copy of the live database (safe while the server runs). Returns the backup path. */
  public backupTo(target: string): string {
    this.init();
    this.persist();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (fs.existsSync(target)) fs.unlinkSync(target);
    this.sql.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
    this.sql.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    return target;
  }

  /** Copies the database next to it before a risky change (once per label). Returns the backup path or null. */
  public backup(label: string): string | null {
    this.init();
    const target = `${SQLITE_FILE}.backup-${label}`;
    if (fs.existsSync(target)) return target;
    return this.backupTo(target);
  }

  public get directory(): string { return DB_DIR; }

  /** What is on disk for a table (tests check that rollbacks never reach the file). */
  public readPersisted(tableName: keyof DatabaseSchema | string): any[] {
    this.init();
    return this.sql.prepare('SELECT data FROM rows WHERE tbl = ? ORDER BY seq').all(tableName).map((r: any) => this.deserialize(tableName as string, JSON.parse(r.data)));
  }

  public close(): void {
    if (!this.sql) return;
    try { this.persist(); } finally { this.sql.close(); this.sql = null; this.isLoaded = false; }
  }

  // Reset database for tests. Refused outside the test runner, which gives every test file its own data folder:
  // a test started by hand would otherwise empty the real database in .data.
  public reset(): void {
    if (process.env.NODE_ENV !== 'test' || !process.env.FINANCE_DATA_DIR) {
      throw new Error('db.reset() faqat test rejimida (NODE_ENV=test) va alohida FINANCE_DATA_DIR bilan ishlaydi. Testlarni scripts/run-tests.mjs orqali ishga tushiring.');
    }
    this.init();
    this.data = JSON.parse(JSON.stringify(INITIAL_EMPTY_SCHEMA));
    this.index.clear();
    this.dirty.clear();
    this.fullDirty.clear();
    this.journal.length = 0;
    this.transactionDepth = 0;
    this.sql.exec('DELETE FROM rows');
  }
}

export const db = new DatabaseManager();
