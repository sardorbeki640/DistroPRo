import { db } from '../database.ts';
import type { Migration } from '../migrator.ts';
import { AuditService } from '../../services/audit.service.ts';

/** Remove only the disconnected SalesDoctor placeholder shipped by the seed data.
 * Any configured connection or imported history is preserved.
 */
export const removeDefaultSalesDoctorMigration: Migration = {
  id: '016_remove_default_salesdoctor',
  name: 'Standart SalesDoctor server namunasini olib tashlash',
  up: () => {
    const placeholder = db.findOne('integrations', i =>
      i.id === 'integ-salesdoc-01' &&
      i.provider_name.toUpperCase() === 'SALESDOC' &&
      i.status === 'DISCONNECTED' &&
      String(i.config?.server_url || '').replace(/\/+$/, '').toLowerCase() === 'https://server.salesdoctor.uz/api/v2' &&
      !i.config?.api_token && !i.config?.password && !i.config?.username
    );
    if (!placeholder) return;

    const now = new Date().toISOString();
    db.transaction(() => {
      db.upsertMany('_quarantine', [{
        id: `q-integration-${placeholder.id}`,
        table: 'integrations',
        reason: 'Avvaldan kiritilgan, ulanmagan standart SalesDoctor server namunasi (016)',
        row: placeholder,
        moved_at: now
      }]);
      db.delete('integrations', placeholder.id);
      AuditService.log({
        company_id: placeholder.company_id,
        user_id: 'system',
        user_email: 'system',
        action: 'DELETE',
        entity: 'Integration',
        entity_id: placeholder.id,
        old_value: { provider_name: placeholder.provider_name, server_url: placeholder.config?.server_url },
        new_value: null,
        reason: 'Ulanmagan standart SalesDoctor server namunasi olib tashlandi; nusxasi _quarantine da saqlandi'
      });
    });
  }
};
