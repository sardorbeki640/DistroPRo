import { db } from './database.ts';
import type { MigrationRecord } from './schema.ts';

export interface Migration {
  id: string;
  name: string;
  up: () => Promise<void> | void;
  down?: () => Promise<void> | void;
}

export class MigrationRunner {
  private migrations: Migration[] = [];

  public register(migration: Migration): void {
    this.migrations.push(migration);
  }

  public async run(): Promise<{ executed: string[]; alreadyApplied: string[] }> {
    db.init();
    await db.connectTurso();
    const appliedRecords = db.getTable('_migrations');
    const appliedIds = new Set(appliedRecords.map((m: MigrationRecord) => m.id));

    const executed: string[] = [];
    const alreadyApplied: string[] = [];

    for (const migration of this.migrations) {
      if (appliedIds.has(migration.id)) {
        alreadyApplied.push(migration.id);
        continue;
      }

      console.log(`[Migration] Running: ${migration.id} - ${migration.name}...`);
      await migration.up();

      db.insert('_migrations', {
        id: migration.id,
        name: migration.name,
        applied_at: new Date().toISOString()
      });

      executed.push(migration.id);
      console.log(`[Migration] Completed: ${migration.id}`);
    }

    await db.flushTurso();

    return { executed, alreadyApplied };
  }
}

export const migrator = new MigrationRunner();
