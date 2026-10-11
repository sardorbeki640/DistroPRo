import { db } from '../database.ts';
import type { Migration } from '../migrator.ts';
import { tagSalesDocRows } from '../../services/source-tagging.service.ts';

/** Marks existing SalesDoc rows with their integration, so switching SalesDoc off hides its data (and on shows it again). */
export const sourceIntegrationTagsMigration: Migration = {
  id: '011_source_integration_tags',
  name: 'Ma’lumotlarni qaysi integratsiyadan kelgani bo‘yicha belgilash',
  up: () => {
    db.backup('011');
    for (const integration of db.getTableIncludingHidden('integrations').filter(i => /SALESDOC|SALES_DOCTOR/.test(i.provider_name.toUpperCase()))) {
      console.log('[Migration 011]', integration.id, JSON.stringify(tagSalesDocRows(integration.id)));
    }
  }
};
