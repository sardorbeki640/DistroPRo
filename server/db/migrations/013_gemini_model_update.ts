import { db } from '../database.ts';
import type { Migration } from '../migrator.ts';
import { AuditService } from '../../services/audit.service.ts';

/** Google closed gemini-2.5-flash to new API users (2026-10); Jarvis settings move to its recommended successor. */
export const geminiModelUpdateMigration: Migration = {
  id: '013_gemini_model_update',
  name: 'Jarvis: yopilgan Gemini modelini yangisiga almashtirish',
  up: () => {
    for (const s of db.find('jarvis_settings', s => s.provider === 'gemini' && /^gemini-2\.5-flash$/.test(s.model || ''))) {
      db.update('jarvis_settings', s.id, { model: 'gemini-3.8-flash' });
      AuditService.log({ company_id: s.company_id, user_id: 'system', user_email: 'system', action: 'UPDATE', entity: 'JarvisSettings', entity_id: s.id, old_value: { model: s.model }, new_value: { model: 'gemini-3.8-flash' }, reason: 'gemini-2.5-flash yangi foydalanuvchilar uchun yopilgan — Google tavsiya qilgan modelga o‘tkazildi' });
    }
  }
};
