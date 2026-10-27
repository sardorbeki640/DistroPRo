import { db } from '../db/database.ts';
import type { NotificationChannel, NotificationEventType } from '../db/schema.ts';
import { AuditService } from './audit.service.ts';
import { TelegramError, TelegramService, escapeHtml, isTelegramToken } from './telegram.service.ts';
import { businessToday } from '../utils/date.ts';
import { StaffBotService, STAFF_REMINDERS } from './staff-bot.service.ts';

/** What a bot can be subscribed to (shown as checkboxes). */
export const BOT_EVENTS: { type: NotificationEventType; label: string; hint: string }[] = [
  { type: 'DAILY_REPORT', label: 'Kunlik hisobot', hint: 'Har kuni belgilangan soatda: savdo, kassa, qarzlar, tugagan tovarlar' },
  { type: 'CASH_DAY_CLOSED', label: 'Kassa yopildi', hint: 'Kassa kuni yopilganda yakuniy summalar' },
  { type: 'CASH_CLOSING_DISCREPANCY', label: 'Kassada farq', hint: 'Yopishda sanalgan pul hisobdan farq qilsa' },
  { type: 'DEBT_THRESHOLD_EXCEEDED', label: 'Qarzdorlar', hint: 'Mijozlar bo‘limidan yuborilgan muddati o‘tgan qarzlar hisoboti' },
  { type: 'STOCKOUT_WARNING', label: 'Tovar tugashi', hint: 'Dashboard / Prognozdan yuborilgan tugagan tovarlar ogohlantirishi' },
  { type: 'DISTRIBUTION_SYNC_FAILURE', label: 'Integratsiya xatosi', hint: 'SalesDoc / Linko’dan yuklash xato bilan to‘xtasa' },
  { type: 'ATTENDANCE_LATE', label: 'Kechikishlar', hint: 'Xodim Face ID bilan ishga kech kelganda (joylashuvi bilan)' }
];
const EVENT_TYPES = new Set(BOT_EVENTS.map(e => e.type));
const MAX_ATTEMPTS = 6;
const money = (n: number) => Math.round(n || 0).toLocaleString('ru-RU');

export class BotService {
  private static mask(token?: string) {
    return token ? `${token.split(':')[0]}:••••${token.slice(-4)}` : null;
  }

  /** Bots of the company with what they receive and how the last messages went; the token never leaves the server. */
  static list(company_id: string) {
    const rules = db.find('notification_rules', r => r.company_id === company_id && r.is_active);
    const notifs = db.find('notifications', n => n.company_id === company_id && n.channel_type === 'TELEGRAM');
    return db.find('notification_channels', c => c.company_id === company_id && c.channel_type === 'TELEGRAM').map(c => {
      const mine = notifs.filter(n => n.channel_id === c.id).sort((a, b) => b.created_at.localeCompare(a.created_at));
      const lastFailed = mine.find(n => n.status === 'FAILED');
      return {
        id: c.id,
        name: c.name,
        is_active: c.is_active,
        bot_username: c.config?.bot_username || null,
        token_masked: this.mask(c.config?.bot_token),
        chat_id: c.config?.chat_id || '',
        chat_title: c.config?.chat_title || '',
        topic_id: c.config?.topic_id || '',
        daily_report_hour: c.config?.daily_report_hour ?? 20,
        events: rules.filter(r => r.channel_id === c.id).map(r => r.event_type),
        personal: c.config?.personal === true,
        personal_events: StaffBotService.settingsOf(c).events,
        remind_before_min: StaffBotService.settingsOf(c).remind_before_min,
        missed_after_min: StaffBotService.settingsOf(c).missed_after_min,
        morning_hour: StaffBotService.settingsOf(c).morning_hour,
        checkin_enabled: c.config?.checkin_enabled === true || !!c.config?.checkin_chat_id,
        poll_error: c.config?.poll_error || null,
        last_poll_at: c.config?.last_poll_at || null,
        last_update: c.config?.last_update || null,
        poller_enabled: (process.env.DISABLE_BOTS !== '1' || process.env.ENABLE_TELEGRAM_POLLING === '1') && process.env.NODE_ENV !== 'test',
        checkin_chat_id: c.config?.checkin_chat_id || '',
        checkin_chat_title: c.config?.checkin_chat_title || '',
        linked_people: c.config?.personal === true ? db.find('staff_telegram', r => r.company_id === company_id && !!r.chat_id && !r.blocked_at).length : 0,
        sent: mine.filter(n => n.status === 'SENT').length,
        pending: mine.filter(n => n.status === 'PENDING').length,
        failed: mine.filter(n => n.status === 'FAILED').length,
        last_sent_at: mine.find(n => n.status === 'SENT')?.sent_at || null,
        last_error: lastFailed?.error_message || null,
        created_at: c.created_at
      };
    });
  }

  /** Creates or updates a bot. A new token is checked with Telegram first; an empty token keeps the stored one. */
  static async save(company_id: string, user: { id: string; email: string }, input: {
    id?: string; name: string; bot_token?: string; chat_id: string; chat_title?: string; topic_id?: string;
    events: string[]; is_active?: boolean; daily_report_hour?: number;
    personal?: boolean; checkin_enabled?: boolean; personal_events?: string[]; remind_before_min?: number; missed_after_min?: number; morning_hour?: number;
    checkin_chat_id?: string; checkin_chat_title?: string;
  }) {
    const existing = input.id ? db.findById('notification_channels', input.id) : null;
    if (input.id && (!existing || existing.company_id !== company_id)) throw new Error('Bot topilmadi.');
    const token = (input.bot_token || '').trim() || existing?.config?.bot_token || '';
    if (!isTelegramToken(token)) throw new Error('Bot tokenini kiriting (@BotFather beradi, masalan 123456789:AA…).');
    const chatId = String(input.chat_id || '').trim();
    const events = input.events.filter(e => EVENT_TYPES.has(e as NotificationEventType)) as NotificationEventType[];
    const personal = input.personal ?? existing?.config?.personal === true;
    const checkinEnabled = input.checkin_enabled ?? (existing?.config?.checkin_enabled === true || !!(input.checkin_chat_id || existing?.config?.checkin_chat_id));
    // A bot only for employees' personal reminders needs no group chat.
    if (chatId && !/^-?\d{3,}$/.test(chatId) && !/^@\w{4,}$/.test(chatId)) throw new Error('Chat ID raqam (guruhda -100… bilan) yoki @kanal_nomi bo‘lishi kerak. “Chatni topish” tugmasidan foydalaning.');
    if (events.length && !chatId) throw new Error('Rahbariyat xabarlari tanlangan — ular uchun chat tanlang yoki xabar turlarini olib tashlang.');
    if (!chatId && !personal && !checkinEnabled && !existing) throw new Error('Bot vazifasini tanlang: rahbariyat xabarlari, shaxsiy eslatmalar yoki davomat guruhlarini o‘qish.');
    const minutes = (v: unknown, fallback: number, max: number) => { const n = Number(v ?? fallback); if (!Number.isInteger(n) || n < 0 || n > max) throw new Error(`Daqiqa 0–${max} oralig‘ida bo‘lsin.`); return n; };
    const prev = StaffBotService.settingsOf(existing);
    const personalCfg = {
      personal,
      checkin_enabled: checkinEnabled,
      personal_events: (input.personal_events ?? prev.events).filter(t => STAFF_REMINDERS.some(r => r.type === t)),
      remind_before_min: minutes(input.remind_before_min, prev.remind_before_min, 180),
      missed_after_min: minutes(input.missed_after_min, prev.missed_after_min, 240),
      morning_hour: minutes(input.morning_hour, prev.morning_hour, 23),
      // The group where couriers post round videos to start work (read by this bot; needs privacy mode off or admin rights).
      checkin_chat_id: input.checkin_chat_id !== undefined ? (String(input.checkin_chat_id).trim() || null) : (existing?.config?.checkin_chat_id || null),
      checkin_chat_title: input.checkin_chat_id !== undefined ? (String(input.checkin_chat_title || '').trim() || null) : (existing?.config?.checkin_chat_title || null)
    };
    if (personalCfg.checkin_chat_id && !/^-\d{5,}$/.test(personalCfg.checkin_chat_id)) throw new Error('Video guruhi Telegram guruhi bo‘lishi kerak (ID -100… bilan). “Chatni topish” bilan tanlang.');
    const hour = Number(input.daily_report_hour ?? existing?.config?.daily_report_hour ?? 20);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new Error('Kunlik hisobot soati 0–23 oralig‘ida bo‘lsin.');
    const tokenChanged = token !== existing?.config?.bot_token;
    const me = tokenChanged || !existing?.config?.bot_username ? await TelegramService.getMe(token) : null;

    const now = new Date().toISOString();
    const config = {
      ...(existing?.config || {}),
      bot_token: token,
      bot_username: me?.username || existing?.config?.bot_username,
      chat_id: chatId,
      chat_title: (input.chat_title || '').trim() || (chatId === existing?.config?.chat_id ? existing?.config?.chat_title : '') || '',
      topic_id: String(input.topic_id || '').trim() || undefined,
      daily_report_hour: hour,
      ...personalCfg,
      ...(tokenChanged ? { update_offset: 0, recent_chats: [], last_poll_at: null, poll_error: null } : {})
    };
    const id = existing?.id || `chan-tg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    db.transaction(() => {
      // One bot sends personal reminders: choosing this one releases the others.
      if (personal) {
        for (const other of db.find('notification_channels', c => c.company_id === company_id && c.id !== id && c.config?.personal === true)) {
          db.update('notification_channels', other.id, { config: { ...other.config, personal: false } });
        }
      }
      if (existing) db.update('notification_channels', id, { name: input.name.trim() || existing.name, is_active: input.is_active !== false, config, updated_at: now });
      else db.insert('notification_channels', { id, company_id, channel_type: 'TELEGRAM', name: input.name.trim() || `@${me?.username}`, is_active: input.is_active !== false, config, created_at: now });
      db.removeWhere('notification_rules', r => r.company_id === company_id && r.channel_id === id);
      for (const event_type of events) {
        db.insert('notification_rules', { id: `rule-${id}-${event_type}`, company_id, event_type, channel_id: id, is_active: true, created_at: now });
      }
      AuditService.log({
        company_id, user_id: user.id, user_email: user.email, action: existing ? 'UPDATE' : 'CREATE', entity: 'TelegramBot', entity_id: id,
        old_value: existing ? { name: existing.name, chat_id: existing.config?.chat_id } : null,
        new_value: { name: input.name, bot: config.bot_username, chat_id: chatId, events },
        reason: existing ? 'Telegram bot sozlamasi o‘zgartirildi' : 'Telegram bot ulandi'
      });
    });
    return this.list(company_id).find(b => b.id === id)!;
  }

  static remove(company_id: string, id: string, user: { id: string; email: string }) {
    const c = db.findById('notification_channels', id);
    if (!c || c.company_id !== company_id) throw new Error('Bot topilmadi.');
    db.transaction(() => {
      db.removeWhere('notification_rules', r => r.channel_id === id);
      db.delete('notification_channels', id);
      AuditService.log({ company_id, user_id: user.id, user_email: user.email, action: 'DELETE', entity: 'TelegramBot', entity_id: id, old_value: { name: c.name, chat_id: c.config?.chat_id }, new_value: null, reason: 'Telegram bot uzildi' });
    });
  }

  /** Token: the stored one of a saved bot, or the one being typed in the form. */
  private static tokenFor(company_id: string, input: { id?: string; bot_token?: string }) {
    if (input.bot_token?.trim()) return input.bot_token.trim();
    const c = input.id ? db.findById('notification_channels', input.id) : null;
    if (!c || c.company_id !== company_id || !c.config?.bot_token) throw new Error('Bot tokenini kiriting.');
    return c.config.bot_token;
  }

  static async findChats(company_id: string, input: { id?: string; bot_token?: string }) {
    const token = this.tokenFor(company_id, input);
    const [me, fresh] = await Promise.all([TelegramService.getMe(token), TelegramService.findChats(token)]);
    // A personal-reminder bot reads its messages itself; the chats it saw are kept on the bot.
    const c = input.id ? db.findById('notification_channels', input.id) : null;
    const kept: { id: string; title: string; type: string }[] = c?.company_id === company_id && Array.isArray(c.config?.recent_chats) ? c.config.recent_chats : [];
    const chats = [...fresh, ...kept.filter(k => !fresh.some(f => f.id === k.id))];
    return { bot: me, chats };
  }

  /** Sends a test message right away (not through the queue) so the owner sees the result at once. */
  static async test(company_id: string, input: { id?: string; bot_token?: string; chat_id?: string; topic_id?: string }) {
    const token = this.tokenFor(company_id, input);
    const c = input.id ? db.findById('notification_channels', input.id) : null;
    const chatId = String(input.chat_id || c?.config?.chat_id || '').trim();
    if (!chatId) {
      if (!c?.config?.checkin_enabled && !c?.config?.checkin_chat_id) throw new Error('Guruh chati tanlanmagan. Davomat boti sifatida tekshirish uchun “Davomat videolarini o‘qish”ni yoqing.');
      const [me, webhook] = await Promise.all([TelegramService.getMe(token), TelegramService.getWebhookInfo(token)]);
      if (webhook.url) throw new Error(`@${me.username} ishlayapti, ammo webhook yoqilgan (${webhook.url}) — getUpdates orqali video o‘qilmaydi. Bot webhook’ini Telegram’dan o‘chirib, keyin qayta tekshiring.`);
      return { ok: true, message: `@${me.username} tokeni ishlayapti. Davomat guruhi xabarlarini o‘qish yoqilgan; bot guruhda admin bo‘lsin yoki @BotFather → /setprivacy → Disable qiling.` };
    }
    const company = db.findById('companies', company_id);
    await TelegramService.send(token, chatId, `✅ <b>Distro Pro</b> bot ulandi.\n${escapeHtml(company?.name || '')} xabarlari shu yerga keladi.`, input.topic_id || c?.config?.topic_id);
    return { ok: true };
  }

  /**
   * Sends queued Telegram notifications. A failed one is retried later (30 s, 1, 2, 4… min) up to MAX_ATTEMPTS;
   * a permanent error (bad token, unknown chat) stops at once. Runs every 20 s while the server is up.
   */
  static async deliverPending(now = Date.now()): Promise<{ sent: number; failed: number }> {
    let sent = 0, failed = 0;
    const due = db.find('notifications', n => n.channel_type === 'TELEGRAM' && n.status === 'PENDING' && (!n.last_attempt_at || now - Date.parse(n.last_attempt_at) >= 30_000 * 2 ** Math.max(0, n.attempt_count - 1)))
      .sort((a, b) => a.created_at.localeCompare(b.created_at)).slice(0, 20);
    for (const n of due) {
      const channel = n.channel_id ? db.findById('notification_channels', n.channel_id) : null;
      const attempt = n.attempt_count + 1;
      const at = new Date(now).toISOString();
      // A personal reminder goes to the employee's own chat; everything else to the bot's group chat.
      const chatId = n.personal_chat_id || channel?.config?.chat_id;
      if (!channel || !channel.is_active || !channel.config?.bot_token || !chatId) {
        db.update('notifications', n.id, { status: 'FAILED', attempt_count: attempt, last_attempt_at: at, error_message: 'Bot o‘chirilgan yoki sozlanmagan.' });
        failed++; continue;
      }
      try {
        await TelegramService.send(channel.config.bot_token, chatId, `<b>${escapeHtml(n.title)}</b>\n\n${n.content}`, n.personal_chat_id ? undefined : channel.config.topic_id);
        db.update('notifications', n.id, { status: 'SENT', attempt_count: attempt, last_attempt_at: at, sent_at: at, error_message: null });
        sent++;
      } catch (err: any) {
        const final = (err instanceof TelegramError && err.permanent) || attempt >= MAX_ATTEMPTS;
        db.update('notifications', n.id, { status: final ? 'FAILED' : 'PENDING', attempt_count: attempt, last_attempt_at: at, error_message: err.message });
        if (final && n.staff_key && err instanceof TelegramError && err.permanent) StaffBotService.markBlocked(n.staff_key);
        if (final) failed++;
      }
    }
    return { sent, failed };
  }

  /** End-of-day summary of the business date (HTML for Telegram). */
  static dailyReport(company_id: string, date = businessToday()): { title: string; html: string } {
    const orders = db.find('sales_orders', o => o.company_id === company_id && o.order_date === date && o.status !== 'CANCELLED');
    const net = (o: any) => Number(o.net_sales ?? ((o.total_sales || 0) - (o.return_amount || 0))) || 0;
    const delivered = orders.filter(o => o.status === 'DELIVERED');
    const day = db.findOne('cash_days', d => d.company_id === company_id && d.date === date);
    const entries = day ? db.find('daily_order_entries', e => e.cash_day_id === day.id) : [];
    const sum = (k: string) => entries.reduce((s, e: any) => s + (Number(e[k]) || 0), 0);
    const debtors = db.find('customers', c => c.company_id === company_id && (c.current_balance || 0) > 0);
    const outOfStock = db.find('products', p => p.company_id === company_id && p.is_active && (p.stock_quantity || 0) <= 0).length;
    const lines = [
      `📅 ${date.split('-').reverse().join('.')}`,
      '',
      `🛒 <b>Savdo:</b> ${orders.length} ta buyurtma · ${money(orders.reduce((s, o) => s + net(o), 0))} so‘m`,
      `   yetkazilgan: ${delivered.length} ta · ${money(delivered.reduce((s, o) => s + net(o), 0))} so‘m`,
      day
        ? `💵 <b>Kassa</b> (${day.status === 'OPEN' ? 'ochiq' : 'yopilgan'}): naqd ${money(sum('cash_payment'))}, terminal/click ${money(sum('terminal_click') || sum('terminal_payment') + sum('click_payment'))}, nasiyadan kirim ${money(sum('nasiyadan_kirim'))} so‘m`
        : '💵 <b>Kassa:</b> bu kunga kassa ochilmagan',
      ...(day ? (() => {
        const deposits = db.find('cash_transactions', t => t.cash_day_id === day.id && t.transfer_kind === 'BANK_DEPOSIT');
        return deposits.length ? [`🏦 <b>Inkassa:</b> bankka ${money(deposits.reduce((s, t) => s + t.amount, 0))} so‘m topshirildi`] : [];
      })() : []),
      `📒 <b>Qarzlar:</b> ${debtors.length} ta mijoz · ${money(debtors.reduce((s, c) => s + (c.current_balance || 0), 0))} so‘m`,
      `📦 <b>Tugagan tovarlar:</b> ${outOfStock} ta`
    ];
    return { title: '📊 Kunlik hisobot', html: lines.join('\n') };
  }

  /** Queues the daily report once per day for every active bot subscribed to it whose hour has come (Tashkent time). */
  static queueDailyReports(now = new Date()) {
    const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tashkent', hour: '2-digit', hourCycle: 'h23' }).format(now));
    const today = businessToday(now);
    const rules = db.find('notification_rules', r => r.event_type === 'DAILY_REPORT' && r.is_active);
    for (const rule of rules) {
      const c = db.findById('notification_channels', rule.channel_id) as NotificationChannel | null;
      if (!c || !c.is_active || c.config?.last_daily_report === today) continue;
      if (hour < Number(c.config?.daily_report_hour ?? 20)) continue;
      const report = this.dailyReport(c.company_id, today);
      db.transaction(() => {
        db.insert('notifications', {
          id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, company_id: c.company_id, channel_id: c.id, channel_type: 'TELEGRAM',
          title: report.title, content: report.html, status: 'PENDING', attempt_count: 0, recipient: c.config?.chat_id, created_at: new Date().toISOString(), sent_at: null
        });
        db.update('notification_channels', c.id, { config: { ...c.config, last_daily_report: today } });
      });
    }
  }
}

/** Starts delivery (every 20 s) and the daily-report check (every minute). */
export function startBotScheduler() {
  let busy = false;
  const deliver = setInterval(async () => {
    if (busy) return;
    busy = true;
    try { await BotService.deliverPending(); } catch (err: any) { console.warn('[Bot]', err.message); } finally { busy = false; }
  }, 20_000);
  const reports = setInterval(() => { try { BotService.queueDailyReports(); } catch (err: any) { console.warn('[Bot]', err.message); } }, 60_000);
  deliver.unref(); reports.unref();
}
