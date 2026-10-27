import { db } from '../database.ts';
import type { Migration } from '../migrator.ts';
import { AuditService } from '../../services/audit.service.ts';

/** Remove only disconnected, credential-free SalesDoctor placeholders for the vendor default endpoint. */
export const removeSalesDoctorDefaultEndpointMigration: Migration = {
  id: '017_remove_salesdoctor_default_endpoint',
  name: 'Ulanmagan standart SalesDoctor manzilini olib tashlash',
  up: () => {
    const matches = db.find('integrations', i =>
      i.provider_name.toUpperCase() === 'SALESDOC' &&
      i.status === 'DISCONNECTED' &&
      String(i.config?.server_url || '').replace(/\/+$/, '').toLowerCase() === 'https://server.salesdoctor.uz/api/v2' &&
      !i.config?.api_token && !i.config?.password && !i.config?.username
    );
    if (!matches.length) {
      console.log('[Migration 017] O‘chiriladigan standart SalesDoctor ulanishi topilmadi.');
      return;
    }

    const now = new Date().toISOString();
    db.transaction(() => {
      for (const row of matches) {
        // Keep a recovery record, but never copy credentials into the general quarantine table.
        const safeRow = { ...row, config: { ...row.config, api_token: undefined, password: undefined } };
        db.upsertMany('_quarantine', [{
          id: `q-salesdoc-default-${row.id}`,
          table: 'integrations',
          reason: 'Ulanmagan, credentialsiz standart SalesDoctor server manzili (017)',
          row: safeRow,
          moved_at: now
        }]);
        db.delete('integrations', row.id);
        AuditService.log({
          company_id: row.company_id, user_id: 'system', user_email: 'system', action: 'DELETE',
          entity: 'Integration', entity_id: row.id,
          old_value: { provider_name: row.provider_name, server_url: row.config?.server_url }, new_value: null,
          reason: 'Ulanmagan standart SalesDoctor server manzili olib tashlandi; credentialsiz nusxasi karantinda saqlandi'
        });
      }
    });
    console.log(`[Migration 017] ${matches.length} ta ulanmagan standart SalesDoctor manzili olib tashlandi.`);
  }
};
