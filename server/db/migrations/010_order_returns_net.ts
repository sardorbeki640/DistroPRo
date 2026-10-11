import { db } from '../database.ts';
import type { Migration } from '../migrator.ts';

/** 009's download subtracted returns from totals SalesDoc had already netted; download the history again with the fix. */
export const orderReturnsNetMigration: Migration = {
  id: '010_order_returns_net',
  name: 'Qaytarishlar ikki marta ayirilmasligi uchun tarixni qayta yuklash',
  up: () => {
    for (const integration of db.find('integrations', i => /SALESDOC/.test(i.provider_name.toUpperCase()) && !!i.config?.history)) {
      db.update('integrations', integration.id, { config: { ...integration.config, history: { ...integration.config.history, refetch_all: true } } });
    }
  }
};
