import { db } from '../database.ts';
import type { Migration } from '../migrator.ts';
import { AuditService } from '../../services/audit.service.ts';
import { isTelegramToken } from '../../services/telegram.service.ts';

/**
 * The seed data came with a sample Telegram channel whose token is not a real bot token. Now that messages are
 * really sent it is switched off (kept, not deleted), so nothing is queued for a bot that does not exist.
 */
export const disableSampleBotMigration: Migration = {
  id: '014_disable_sample_bot',
  name: 'Namuna Telegram kanalini o‘chirish',
  up: () => {
    for (const c of db.find('notification_channels', c => c.channel_type === 'TELEGRAM' && c.is_active && !isTelegramToken(c.config?.bot_token || ''))) {
      db.update('notification_channels', c.id, { is_active: false, name: `${c.name} (namuna, ishlamaydi)` });
      AuditService.log({ company_id: c.company_id, user_id: 'system', user_email: 'system', action: 'UPDATE', entity: 'TelegramBot', entity_id: c.id, old_value: { is_active: true }, new_value: { is_active: false }, reason: 'Haqiqiy bot tokeni yo‘q namuna kanal o‘chirildi' });
    }
  }
};
