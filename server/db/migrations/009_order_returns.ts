import { db } from '../database.ts';
import type { Migration } from '../migrator.ts';

/** Orders now carry SalesDoc's returned amount; download the history once more so older months get it too. */
export const orderReturnsMigration: Migration = {
  id: '009_order_returns',
  name: 'SalesDoc buyurtmalaridagi qaytarishlarni olish uchun tarixni qayta yuklash',
  up: () => {
    for (const integration of db.find('integrations', i => /SALESDOC/.test(i.provider_name.toUpperCase()) && !!i.config?.history)) {
      db.update('integrations', integration.id, { config: { ...integration.config, history: { ...integration.config.history, refetch_all: true } } });
    }
  }
};
