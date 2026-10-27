import { randomBytes } from 'node:crypto';
import { db } from '../db/database.ts';
import type { AttendanceSettings, NotificationChannel, StaffReminderType, StaffTelegram } from '../db/schema.ts';
import { AuditService } from './audit.service.ts';
import { AttendanceService } from './attendance.service.ts';
import { SalaryService } from './salary.service.ts';
import { TelegramService, escapeHtml } from './telegram.service.ts';
import { businessToday } from '../utils/date.ts';

/**
 * Personal reminders in each employee's own Telegram chat, through the bot marked "personal" in the bot settings.
 * A person links their chat by opening t.me/<bot>?start=<code> (from their cabinet, or a link the manager sends);
 * the bot reads its updates every 20 s and binds that chat to the person.
 */
export const STAFF_REMINDERS: { type: StaffReminderType; label: string; hint: string }[] = [
  { type: 'CHECKIN_REMINDER', label: 'Ishni boshlash eslatmasi', hint: 'Start muddatidan oldin, hali Face ID / birinchi vizit bo‘lmasa' },
  { type: 'CHECKIN_MISSED', label: 'Ish boshlanmadi', hint: 'Muddat o‘tdi, lekin ish boshlangani qayd etilmadi' },
  { type: 'LATE', label: 'Kechikish', hint: 'Necha daqiqa kechikdi va qoida bo‘yicha necha foiz' },
  { type: 'VIOLATION', label: 'Qoidabuzarlik', hint: 'Rahbar qoidabuzarlik yozsa yoki bekor qilsa' },
  { type: 'SALARY_PAID', label: 'Oylik to‘landi', hint: 'Oylik to‘langanda summasi' },
  { type: 'TASK_ASSIGNED', label: 'Yangi vazifa', hint: 'Unga vazifa berilganda' },
  { type: 'TASK_DUE', label: 'Bugungi vazifalar', hint: 'Har kuni ertalab: bugun muddati tugaydigan va o‘tib ketgan vazifalar' },
  { type: 'AGENT_DEBTS', label: 'Agentga qarzdorlar', hint: 'Har kuni ertalab: agentning mijozlaridagi qarzlar' }
];
const TYPES = new Set(STAFF_REMINDERS.map(r => r.type));
export const DEFAULT_STAFF_REMINDERS: StaffReminderType[] = STAFF_REMINDERS.map(r => r.type);
const money = (n: number) => Math.round(n || 0).toLocaleString('ru-RU');
const newCode = () => randomBytes(12).toString('base64url');

const tashkent = (now: Date) => {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tashkent', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const get = (t: string) => Number(parts.find(p => p.type === t)?.value || 0);
  return get('hour') * 60 + get('minute');
};
const toMinutes = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

export type StaffKey = { employee_id?: string | null; user_id?: string | null };

export class StaffBotService {
  /** The company's bot that sends personal reminders (one per company), if any. */
  static personalBot(company_id: string): NotificationChannel | null {
    return db.findOne('notification_channels', c => c.company_id === company_id && c.channel_type === 'TELEGRAM' && c.is_active && c.config?.personal === true && !!c.config?.bot_token) || null;
  }

  /** One configured bot reads attendance groups even when private reminders are turned off. */
  static attendanceBot(company_id: string): NotificationChannel | null {
    const bots = db.find('notification_channels', c => c.company_id === company_id && c.channel_type === 'TELEGRAM' && c.is_active && !!c.config?.bot_token);
    return bots.find(c => c.config?.checkin_enabled === true)
      || bots.find(c => !!c.config?.checkin_chat_id)
      || bots.find(c => c.config?.personal === true)
      || null;
  }

  static settingsOf(bot: NotificationChannel | null) {
    const c = bot?.config || {};
    return {
      events: (Array.isArray(c.personal_events) ? c.personal_events : DEFAULT_STAFF_REMINDERS).filter((t: string) => TYPES.has(t as StaffReminderType)) as StaffReminderType[],
      remind_before_min: Number.isFinite(c.remind_before_min) ? Number(c.remind_before_min) : 15,
      missed_after_min: Number.isFinite(c.missed_after_min) ? Number(c.missed_after_min) : 30,
      morning_hour: Number.isFinite(c.morning_hour) ? Number(c.morning_hour) : 8
    };
  }

  /** The person's link row: the employee card wins over the login (an employee with a login is one person). */
  static resolve(company_id: string, who: StaffKey): StaffTelegram | null {
    let employee_id = who.employee_id || null;
    if (!employee_id && who.user_id) employee_id = db.findOne('employees', e => e.company_id === company_id && e.user_id === who.user_id)?.id || null;
    const id = employee_id ? `${company_id}:emp:${employee_id}` : who.user_id ? `${company_id}:user:${who.user_id}` : null;
    return id ? db.findById('staff_telegram', id) : null;
  }

  private static ensure(company_id: string, who: StaffKey): StaffTelegram {
    const existing = this.resolve(company_id, who);
    if (existing) return existing;
    let employee_id = who.employee_id || null;
    if (!employee_id && who.user_id) employee_id = db.findOne('employees', e => e.company_id === company_id && e.user_id === who.user_id)?.id || null;
    if (employee_id) {
      const e = db.findById('employees', employee_id);
      if (!e || e.company_id !== company_id) throw new Error('Xodim topilmadi.');
      return db.insert('staff_telegram', { id: `${company_id}:emp:${employee_id}`, company_id, employee_id, user_id: e.user_id || null, code: newCode(), muted: [] });
    }
    const u = who.user_id ? db.findById('users', who.user_id) : null;
    if (!u || u.company_id !== company_id) throw new Error('Foydalanuvchi topilmadi.');
    return db.insert('staff_telegram', { id: `${company_id}:user:${u.id}`, company_id, employee_id: null, user_id: u.id, code: newCode(), muted: [] });
  }

  /** The t.me link that binds the opener's Telegram to this person. */
  static link(company_id: string, who: StaffKey) {
    const bot = this.personalBot(company_id);
    if (!bot) throw new Error('Shaxsiy eslatmalar uchun bot tanlanmagan. Rahbar: Sozlamalar → Telegram botlar → botni sozlash → “Xodimlarga shaxsiy eslatmalar”.');
    if (!bot.config.bot_username) throw new Error('Bot nomi aniqlanmagan — bot sozlamasini qayta saqlang.');
    const row = this.ensure(company_id, who);
    return { url: `https://t.me/${bot.config.bot_username}?start=${row.code}`, bot_username: bot.config.bot_username, linked: !!row.chat_id && !row.blocked_at };
  }

  /** What the signed-in person sees in their cabinet. */
  static me(company_id: string, user_id: string) {
    const bot = this.personalBot(company_id);
    const row = this.resolve(company_id, { user_id });
    const s = this.settingsOf(bot);
    return {
      available: !!bot,
      bot_username: bot?.config?.bot_username || null,
      linked: !!row?.chat_id && !row?.blocked_at,
      blocked: !!row?.blocked_at,
      chat_name: row?.chat_name || null,
      linked_at: row?.linked_at || null,
      reminders: STAFF_REMINDERS.filter(r => s.events.includes(r.type)).map(r => ({ ...r, muted: (row?.muted || []).includes(r.type) }))
    };
  }

  static setMuted(company_id: string, user_id: string, muted: string[]) {
    const row = this.ensure(company_id, { user_id });
    return db.update('staff_telegram', row.id, { muted: muted.filter(t => TYPES.has(t as StaffReminderType)) as StaffReminderType[] });
  }

  static unlink(company_id: string, who: StaffKey, actor: { id: string; email: string }) {
    const row = this.resolve(company_id, who);
    if (!row?.chat_id) return;
    db.update('staff_telegram', row.id, { chat_id: null, chat_name: null, linked_at: null, blocked_at: null, code: newCode() });
    AuditService.log({ company_id, user_id: actor.id, user_email: actor.email, action: 'UPDATE', entity: 'StaffTelegram', entity_id: row.id, old_value: { chat: row.chat_name }, new_value: null, reason: 'Xodimning Telegram’i uzildi' });
  }

  /** Every employee (and login without an employee card) with their Telegram status, for the manager. */
  static people(company_id: string) {
    const rows = new Map(db.find('staff_telegram', r => r.company_id === company_id).map(r => [r.id, r]));
    const employees = db.find('employees', e => e.company_id === company_id && e.status !== 'INACTIVE');
    const withCard = new Set(employees.map(e => e.user_id).filter(Boolean));
    const out = employees.map(e => {
      const r = rows.get(`${company_id}:emp:${e.id}`);
      return { key: { employee_id: e.id } as StaffKey, name: e.full_name, position: e.position, linked: !!r?.chat_id && !r?.blocked_at, blocked: !!r?.blocked_at, chat_name: r?.chat_name || null, linked_at: r?.linked_at || null };
    });
    for (const u of db.find('users', u => u.company_id === company_id && u.status === 'ACTIVE' && !withCard.has(u.id))) {
      const r = rows.get(`${company_id}:user:${u.id}`);
      out.push({ key: { user_id: u.id } as StaffKey, name: u.full_name || u.email, position: 'Foydalanuvchi', linked: !!r?.chat_id && !r?.blocked_at, blocked: !!r?.blocked_at, chat_name: r?.chat_name || null, linked_at: r?.linked_at || null });
    }
    return out.sort((a, b) => Number(b.linked) - Number(a.linked) || a.name.localeCompare(b.name));
  }

  /**
   * Queues a personal reminder (sent by the bot's delivery worker with retries). Nothing happens when the person has no
   * linked chat, blocked the bot, muted this type, or the company switched the type off. `once` makes it once-only.
   */
  static notify(company_id: string, who: StaffKey, type: StaffReminderType, title: string, html: string, once?: string): boolean {
    const bot = this.personalBot(company_id);
    if (!bot || !this.settingsOf(bot).events.includes(type)) return false;
    const row = this.resolve(company_id, who);
    if (!row?.chat_id || row.blocked_at || (row.muted || []).includes(type)) return false;
    const id = once ? `pn-${type}-${row.id}-${once}` : `pn-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    if (once && db.findById('notifications', id)) return false;
    db.insert('notifications', {
      id, company_id, channel_id: bot.id, channel_type: 'TELEGRAM', title, content: html, status: 'PENDING', attempt_count: 0,
      recipient: row.chat_name || row.chat_id, personal_chat_id: row.chat_id, personal_type: type, staff_key: row.id,
      created_at: new Date().toISOString(), sent_at: null
    });
    return true;
  }

  // ---------------- Violations posted to Telegram groups ----------------

  /** The group chat an employee's violations go to: their own chat (an agent's group), else their work group's chat. */
  static penaltyChatOf(s: AttendanceSettings, employee_id: string): string | null {
    const p = s.penalty_posts;
    if (!p?.enabled) return null;
    if (p.employees?.[employee_id]) return p.employees[employee_id];
    const group = AttendanceService.planOf(s, employee_id).group;
    return (group && p.groups?.[group.id]) || null;
  }

  /**
   * Queues a group message for every violation not posted yet (from the day posting was switched on): automatic
   * lateness and absence and those a manager entered. An absence is posted once its day is over. Each message says what
   * it costs and the month's total so far, so the group sees how the penalty adds up.
   */
  static queuePenaltyPosts(now = new Date()) {
    const today = businessToday(now);
    for (const s of db.find('attendance_settings', x => !!x.penalty_posts?.enabled)) {
      const company_id = s.company_id;
      const bot = this.personalBot(company_id);
      if (!bot || s.penalty.mode !== 'RULES') continue;
      const since = s.penalty_posts!.since || today;
      const months = Array.from(new Set([since.slice(0, 7), today.slice(0, 7)])).sort().filter(m => m <= today.slice(0, 7));
      for (const t of AttendanceService.tracked(company_id, s)) {
        const chat = this.penaltyChatOf(s, t.employee_id);
        if (!chat) continue;
        const name = db.findById('employees', t.employee_id)?.full_name || 'Xodim';
        for (const month of months) {
          const list = AttendanceService.occurrences(company_id, t.employee_id, month, s);
          let total = 0;
          list.forEach((o, i) => {
            total = Math.round((total + o.percent) * 100) / 100;
            if (o.date < since || (o.type === 'ABSENT' && o.date >= today)) return;
            const id = `pp-${company_id}-${t.employee_id}-${o.date}-${o.type}-${o.id || 'auto'}`;
            if (db.findById('notifications', id)) return;
            const rule = (s.rules || []).find(r => r.type === o.type);
            const what = `${escapeHtml(rule?.label || o.type)}${o.minutes ? ` (${o.minutes} daqiqa)` : ''}${o.note ? ` — ${escapeHtml(o.note)}` : ''}`;
            let earned = 0;
            try {
              const payroll = SalaryService.calculateMonthlySalary({ company_id, employee_id: t.employee_id, period_month: month, user_id: 'telegram-bot', user_email: 'telegram-bot' });
              earned = payroll.base_amount + payroll.bonus_amount + payroll.piecework_amount;
            } catch (err: any) { console.warn('[StaffBot] jarima summasi:', err.message); }
            const dayPercent = Math.round(list.filter(x => x.date === o.date).reduce((sum, x) => sum + x.percent, 0) * 100) / 100;
            const dayAmount = earned > 0 ? Math.round(earned * dayPercent / 100) : null;
            const monthAmount = earned > 0 ? Math.round(earned * total / 100) : null;
            const amountText = dayAmount === null
              ? 'Jarima summasi: maosh tarkibi kiritilmagan, so‘mda hisoblab bo‘lmadi.'
              : `Bugungi jami jarima: <b>${money(dayAmount)} so‘m</b> (${dayPercent}%). Oy boshidan jami: <b>${money(monthAmount!)} so‘m</b> (${total}%).`;
            const percentText = `Jarima: <b>${o.percent}%</b>. Shu oy jami: <b>${total}%</b> (${i + 1} ta qoidabuzarlik).`;
            db.insert('notifications', {
              id, company_id, channel_id: bot.id, channel_type: 'TELEGRAM', title: `⚠️ ${name}: jarima`,
              content: `${o.date.split('-').reverse().join('.')} — ${what}\n${percentText} ${amountText}`,
              status: 'PENDING', attempt_count: 0, recipient: chat, personal_chat_id: chat, created_at: new Date().toISOString(), sent_at: null
            } as any);
          });
        }
      }
    }
  }

  /** A posted violation that a manager cancels is announced in the same group. */
  static postPenaltyCancelled(company_id: string, v: { id: string; employee_id: string; date: string; type: string }, reason: string) {
    const posted = db.findById('notifications', `pp-${company_id}-${v.employee_id}-${v.date}-${v.type}-${v.id}`);
    const bot = this.personalBot(company_id);
    if (!posted || !bot) return;
    const name = db.findById('employees', v.employee_id)?.full_name || 'Xodim';
    db.insert('notifications', {
      id: `ppx-${v.id}`, company_id, channel_id: bot.id, channel_type: 'TELEGRAM', title: `✅ ${name}: jarima bekor qilindi`,
      content: `${v.date.split('-').reverse().join('.')} — ushlanma olib tashlandi.\nSabab: ${escapeHtml(reason)}`,
      status: 'PENDING', attempt_count: 0, recipient: posted.personal_chat_id, personal_chat_id: posted.personal_chat_id, created_at: new Date().toISOString(), sent_at: null
    } as any);
  }

  /** Tells the same group that a missed-day penalty was excused by an admin. */
  static postAbsenceExcused(company_id: string, employee_id: string, date: string, reason: string) {
    const posted = db.findById('notifications', `pp-${company_id}-${employee_id}-${date}-ABSENT-auto`);
    if (!posted) return;
    const bot = this.personalBot(company_id);
    if (!bot) return;
    const name = db.findById('employees', employee_id)?.full_name || 'Xodim';
    const id = `ppx-absence-${company_id}-${employee_id}-${date}`;
    if (db.findById('notifications', id)) return;
    db.insert('notifications', {
      id, company_id, channel_id: bot.id, channel_type: 'TELEGRAM', title: `✅ ${name}: kun uzrli deb belgilandi`,
      content: `${date.split('-').reverse().join('.')} — sababsiz ish qoldirish jarimasi bekor qilindi.\nSabab: ${escapeHtml(reason)}`,
      status: 'PENDING', attempt_count: 0, recipient: posted.personal_chat_id, personal_chat_id: posted.personal_chat_id, created_at: new Date().toISOString(), sent_at: null
    } as any);
  }

  /** Group chats the bot has seen (it was added there or someone wrote there), to choose from. */
  static groupChats(company_id: string) {
    const bot = this.attendanceBot(company_id);
    const chats: { id: string; title: string; type: string }[] = Array.isArray(bot?.config?.recent_chats) ? bot!.config.recent_chats : [];
    return { bot_username: bot?.config?.bot_username || null, chats: chats.filter(c => c.type === 'group' || c.type === 'supergroup') };
  }

  /** The person blocked the bot: stop sending until they press /start again. */
  static markBlocked(staff_key: string) {
    if (db.findById('staff_telegram', staff_key)) db.update('staff_telegram', staff_key, { blocked_at: new Date().toISOString() });
  }

  /**
   * Reads the personal bot's new messages: "/start <code>" binds the chat to the person, "/stop" unbinds it.
   * Chats seen are remembered on the bot so "Chatni topish" still finds them.
   */
  static async pollUpdates(bot: NotificationChannel) {
    const offset = Number(bot.config.update_offset || 0);
    let updates: any[];
    try {
      updates = await TelegramService.getUpdates(bot.config.bot_token!, { offset: offset ? offset + 1 : undefined, limit: 100, timeout: 0, allowed_updates: ['message', 'my_chat_member', 'channel_post'] });
    } catch (err: any) {
      const fresh = db.findById('notification_channels', bot.id);
      if (fresh) db.update('notification_channels', bot.id, { config: { ...fresh.config, poll_error: err.message, last_poll_at: new Date().toISOString() } });
      console.warn('[StaffBot] getUpdates:', err.message);
      return 0;
    }
    const recent: { id: string; title: string; type: string }[] = Array.isArray(bot.config.recent_chats) ? bot.config.recent_chats : [];
    let last = offset;
    let lastUpdate: any = bot.config.last_update || null;
    for (const u of updates) {
      last = Math.max(last, Number(u.update_id) || 0);
      const chat = u.message?.chat || u.my_chat_member?.chat || u.channel_post?.chat;
      if (u.message || u.channel_post) {
        const m = u.message || u.channel_post;
        const settings = AttendanceService.settings(bot.company_id);
        const chatId = String(chat?.id ?? '');
        const groupMatch = Object.entries(settings.checkin_groups || {}).find(([, id]) => String(id) === chatId);
        const employeeMatch = Object.entries(settings.checkin_employee_groups || {}).find(([, id]) => String(id) === chatId);
        const legacyMatch = !!bot.config.checkin_chat_id && chatId === String(bot.config.checkin_chat_id);
        const video = !!(m.video_note || m.video || m.animation || m.document);
        lastUpdate = {
          at: new Date(Number(m.date || Date.now() / 1000) * 1000).toISOString(),
          chat: chat?.title || chat?.username || String(chat?.id || 'Noma’lum chat'),
          sender: [m.from?.first_name, m.from?.last_name].filter(Boolean).join(' ') || m.from?.username || 'Noma’lum yuboruvchi',
          kind: m.video_note ? 'Dumaloq video' : m.video ? 'Oddiy video' : m.text ? 'Matn' : video ? 'Fayl' : 'Boshqa xabar',
          checkin_group: !!(groupMatch || employeeMatch || legacyMatch),
          checkin_result: video ? (groupMatch || employeeMatch || legacyMatch ? 'Davomat guruhi topildi' : 'Guruh ID mos kelmadi') : null
        };
      }
      if (chat) {
        const title = chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(' ') || chat.username || String(chat.id);
        const i = recent.findIndex(c => c.id === String(chat.id));
        if (i >= 0) recent.splice(i, 1);
        recent.unshift({ id: String(chat.id), title, type: chat.type });
      }
      // Shared work-group check-ins, each agent's own group, and the older bot-form check-in group.
      if (u.message?.video_note || u.message?.video) {
        const settings = AttendanceService.settings(bot.company_id);
        const chatId = String(chat?.id ?? '');
        const groupMatch = Object.entries(settings.checkin_groups || {}).find(([, id]) => String(id) === chatId);
        const employeeMatch = Object.entries(settings.checkin_employee_groups || {}).find(([, id]) => String(id) === chatId);
        const legacyMatch = !!bot.config.checkin_chat_id && chatId === String(bot.config.checkin_chat_id);
        if (groupMatch || employeeMatch || legacyMatch) {
          try { await this.handleVideo(bot, u.message, groupMatch?.[0], employeeMatch?.[0]); } catch (err: any) { console.warn('[StaffBot] video:', err.message); }
        }
        continue;
      }
      if (process.env.TELEGRAM_POLLING_ONLY === '1') continue;
      const text = String(u.message?.text || '').trim();
      if (!bot.config.personal || !u.message || chat?.type !== 'private' || !text.startsWith('/')) continue;
      const chatId = String(chat.id);
      const name = [chat.first_name, chat.last_name].filter(Boolean).join(' ') + (chat.username ? ` (@${chat.username})` : '');
      try {
        await this.handleCommand(bot, chatId, name.trim() || chatId, text);
      } catch (err: any) {
        console.warn('[StaffBot]', err.message);
      }
    }
    const fresh = db.findById('notification_channels', bot.id);
    if (fresh) db.update('notification_channels', bot.id, { config: { ...fresh.config, update_offset: last, recent_chats: recent.slice(0, 20), last_update: lastUpdate, poll_error: null, last_poll_at: new Date().toISOString() } });
    return updates.length;
  }

  /**
   * A video note posted in the check-in group. The time is Telegram's (when it received the message), not the phone's.
   * Forwarded or very short videos do not count. The poster is found by their linked private chat (user id = chat id).
   */
  private static async handleVideo(bot: NotificationChannel, m: any, expectedGroupId?: string, expectedEmployeeId?: string) {
    const company_id = bot.company_id;
    const reply = (text: string) => process.env.TELEGRAM_POLLING_ONLY === '1' ? Promise.resolve() : TelegramService.call(bot.config.bot_token!, 'sendMessage', {
      chat_id: m.chat.id, text, parse_mode: 'HTML', reply_parameters: { message_id: m.message_id, allow_sending_without_reply: true },
      ...(m.message_thread_id ? { message_thread_id: m.message_thread_id } : {})
    }).catch((err: any) => console.warn('[StaffBot] reply:', err.message));
    if (!m.video_note) { await reply('❌ Davomat uchun Telegram’ning dumaloq video xabarini yuboring. Oddiy video qabul qilinmaydi.'); return; }
    if (m.forward_origin || m.forward_date || m.forward_from) { await reply('❌ Uzatilgan (forward) video hisobga olinmaydi — o‘zingiz yozib yuboring.'); return; }
    if (Number(m.video_note.duration || 0) < 2) { await reply('❌ Video juda qisqa — kamida 2 soniya yozing.'); return; }
    const fromId = String(m.from?.id || '');
    const tg = { chat_id: String(m.chat.id), message_id: Number(m.message_id), file_id: m.video_note.file_id, duration: Number(m.video_note.duration || 0) };
    const employee_id = this.employeeOfTelegram(company_id, fromId);
    if (!employee_id) {
      // Not assigned yet: remembered for the admin to assign (the video then counts); nothing is said in the group.
      this.rememberSender(bot, m.from, { at: new Date(Number(m.date) * 1000).toISOString(), ...tg, work_group_id: expectedGroupId || null, employee_group_id: expectedEmployeeId || null });
      return;
    }
    const r: any = AttendanceService.recordVideo(company_id, employee_id, new Date(Number(m.date) * 1000), tg, expectedGroupId, expectedEmployeeId);
    if (!r.already) await reply(escapeHtml(r.message));
  }

  /** The employee a Telegram account belongs to: set by the admin on the employee card, or linked through the bot. */
  static employeeOfTelegram(company_id: string, fromId: string): string | null {
    if (!fromId) return null;
    const byAdmin = db.findOne('employees', e => e.company_id === company_id && e.status !== 'INACTIVE' && String(e.telegram_user_id || '') === fromId);
    if (byAdmin) return byAdmin.id;
    return db.findOne('staff_telegram', r => r.company_id === company_id && r.chat_id === fromId && !!r.employee_id)?.employee_id || null;
  }

  /** People who posted round videos in the group but are not assigned to an employee yet (kept with their last videos). */
  private static rememberSender(bot: NotificationChannel, from: any, video: { at: string; chat_id: string; message_id: number; file_id?: string; duration: number; work_group_id?: string | null; employee_group_id?: string | null }) {
    const fresh = db.findById('notification_channels', bot.id) || bot;
    const list: any[] = Array.isArray(fresh.config.video_senders) ? [...fresh.config.video_senders] : [];
    const id = String(from?.id || '');
    if (!id) return;
    const i = list.findIndex(x => x.id === id);
    const prev = i >= 0 ? list.splice(i, 1)[0] : null;
    // A month of videos is kept, so assigning the person later still counts their days.
    const videos = [video, ...(prev?.videos || [])].filter((v: any) => Date.now() - Date.parse(v.at) < 31 * 86_400_000).slice(0, 31);
    list.unshift({ id, name: [from?.first_name, from?.last_name].filter(Boolean).join(' ') || id, username: from?.username || null, last_at: video.at, videos });
    db.update('notification_channels', bot.id, { config: { ...fresh.config, video_senders: list.slice(0, 40) } });
    // Kept in memory too, so the poll loop's own save of the bot (offset, chats) does not drop it.
    bot.config.video_senders = list.slice(0, 40);
  }

  /** Unassigned video senders and every employee's Telegram account, for the admin. */
  static telegramAccounts(company_id: string) {
    const bot = this.attendanceBot(company_id);
    const attendance = AttendanceService.settings(company_id);
    const assigned = new Set(db.find('employees', e => e.company_id === company_id && !!e.telegram_user_id).map(e => String(e.telegram_user_id)));
    const linked = new Set(db.find('staff_telegram', r => r.company_id === company_id && !!r.chat_id && !!r.employee_id).map(r => r.chat_id!));
    const senders = (Array.isArray(bot?.config?.video_senders) ? bot!.config.video_senders : [])
      .filter((x: any) => !assigned.has(x.id) && !linked.has(x.id))
      .map((x: any) => ({ id: x.id, name: x.name, username: x.username, last_at: x.last_at, videos: (x.videos || []).length }));
    const employees = db.find('employees', e => e.company_id === company_id && e.status !== 'INACTIVE').map(e => {
      const link = db.findById('staff_telegram', `${company_id}:emp:${e.id}`);
      return { id: e.id, name: e.full_name, position: e.position, telegram_user_id: e.telegram_user_id || null, telegram_name: e.telegram_name || null, bot_linked: !!link?.chat_id && !link.blocked_at };
    }).sort((a, b) => a.name.localeCompare(b.name));
    return { bot_username: bot?.config?.bot_username || null, checkin_group: Object.keys(attendance.checkin_groups || {}).length > 0 || Object.keys(attendance.checkin_employee_groups || {}).length > 0 || !!bot?.config?.checkin_chat_id, senders, employees, polling_error: bot?.config?.poll_error || null, last_poll_at: bot?.config?.last_poll_at || null, last_update: bot?.config?.last_update || null, poller_enabled: (process.env.DISABLE_BOTS !== '1' || process.env.ENABLE_TELEGRAM_POLLING === '1') && process.env.NODE_ENV !== 'test' };
  }

  /**
   * The admin assigns a Telegram account to an employee (or clears it). Round videos that account already posted in the
   * last days are counted now (the day's first one), so nothing is lost while it was unassigned.
   */
  static assignTelegram(company_id: string, employee_id: string, telegram_user_id: string | null, actor: { id: string; email: string }) {
    const e = db.findById('employees', employee_id);
    if (!e || e.company_id !== company_id) throw new Error('Xodim topilmadi.');
    const id = telegram_user_id ? String(telegram_user_id).trim() : '';
    if (id && !/^\d{4,20}$/.test(id)) throw new Error('Telegram ID faqat raqamlardan iborat bo‘ladi (masalan 123456789).');
    if (id) {
      const other = db.findOne('employees', x => x.company_id === company_id && x.id !== employee_id && String(x.telegram_user_id || '') === id);
      if (other) throw new Error(`Bu Telegram hisobi allaqachon ${other.full_name}ga biriktirilgan.`);
    }
    const bot = this.attendanceBot(company_id);
    const sender = (Array.isArray(bot?.config?.video_senders) ? bot!.config.video_senders : []).find((x: any) => x.id === id);
    db.update('employees', employee_id, { telegram_user_id: id || null, telegram_name: id ? (sender?.name || e.telegram_name || null) : null } as any);
    AuditService.log({ company_id, user_id: actor.id, user_email: actor.email, action: 'UPDATE', entity: 'Employee', entity_id: employee_id, old_value: { telegram_user_id: e.telegram_user_id || null }, new_value: { telegram_user_id: id || null }, reason: `${e.full_name}: Telegram hisobi ${id ? 'biriktirildi' : 'olib tashlandi'}` });
    let counted = 0;
    if (id && sender?.videos?.length) {
      for (const v of [...sender.videos].sort((a: any, b: any) => a.at.localeCompare(b.at))) {
        const r: any = AttendanceService.recordVideo(company_id, employee_id, new Date(v.at), { chat_id: v.chat_id, message_id: v.message_id, file_id: v.file_id, duration: v.duration }, v.work_group_id || undefined, v.employee_group_id || undefined);
        if (r.ok) counted++;
      }
      const fresh = db.findById('notification_channels', bot!.id)!;
      db.update('notification_channels', bot!.id, { config: { ...fresh.config, video_senders: (fresh.config.video_senders || []).filter((x: any) => x.id !== id) } });
    }
    return { counted };
  }

  private static async handleCommand(bot: NotificationChannel, chatId: string, name: string, text: string) {
    const [command, arg] = text.split(/\s+/, 2);
    const company_id = bot.company_id;
    const reply = (html: string) => TelegramService.send(bot.config.bot_token!, chatId, html);
    if (/^\/start(@\w+)?$/i.test(command)) {
      const row = arg ? db.findOne('staff_telegram', r => r.company_id === company_id && r.code === arg) : null;
      if (!row) {
        const mine = db.findOne('staff_telegram', r => r.company_id === company_id && r.chat_id === chatId);
        if (mine) {
          db.update('staff_telegram', mine.id, { blocked_at: null });
          await reply('✅ Siz ulangansiz. Eslatmalar shu yerga keladi.');
        } else {
          await reply('Bu bot xodimlarga eslatma yuboradi. Ulanish uchun dasturdagi <b>Kabinet → Telegram eslatmalar → “Telegram’ni ulash”</b> tugmasini bosing yoki rahbardan havola so‘rang.');
        }
        return;
      }
      // One Telegram chat belongs to one person: an old binding of this chat is removed.
      for (const other of db.find('staff_telegram', r => r.company_id === company_id && r.chat_id === chatId && r.id !== row.id)) {
        db.update('staff_telegram', other.id, { chat_id: null, chat_name: null, linked_at: null });
      }
      db.update('staff_telegram', row.id, { chat_id: chatId, chat_name: name, linked_at: new Date().toISOString(), blocked_at: null, code: newCode() });
      const person = row.employee_id ? db.findById('employees', row.employee_id)?.full_name : db.findById('users', row.user_id || '')?.full_name;
      AuditService.log({ company_id, user_id: row.user_id || 'telegram', user_email: 'telegram', action: 'UPDATE', entity: 'StaffTelegram', entity_id: row.id, old_value: null, new_value: { chat: name }, reason: `${person || 'Xodim'} Telegram’ini ulandi` });
      await reply(`✅ <b>${escapeHtml(person || '')}</b>, Telegram’ingiz ulandi.\nEndi ish eslatmalari shu yerga keladi. To‘xtatish: /stop`);
    } else if (/^\/stop(@\w+)?$/i.test(command)) {
      const mine = db.findOne('staff_telegram', r => r.company_id === company_id && r.chat_id === chatId);
      if (mine) db.update('staff_telegram', mine.id, { chat_id: null, chat_name: null, linked_at: null, code: newCode() });
      await reply(mine ? 'Eslatmalar to‘xtatildi. Qayta ulash uchun dasturdagi havoladan foydalaning.' : 'Siz ulanmagansiz.');
    }
  }

  /**
   * Time-based reminders (every minute): before the start deadline, after it when work has not started, and each morning
   * the day's tasks and the agents' debtors. Each one at most once a day per person.
   */
  static queueScheduled(now = new Date()) {
    const today = businessToday(now);
    const minute = tashkent(now);
    for (const bot of db.find('notification_channels', c => c.channel_type === 'TELEGRAM' && c.is_active && c.config?.personal === true)) {
      const company_id = bot.company_id;
      const cfg = this.settingsOf(bot);
      const linked = db.find('staff_telegram', r => r.company_id === company_id && !!r.chat_id && !r.blocked_at);
      if (!linked.length) continue;

      // Start of work.
      if (cfg.events.includes('CHECKIN_REMINDER') || cfg.events.includes('CHECKIN_MISSED')) {
        const s = AttendanceService.settings(company_id);
        for (const t of AttendanceService.tracked(company_id, s)) {
          if (t.since > today || !linked.some(r => r.employee_id === t.employee_id)) continue;
          const plan = AttendanceService.planOf(s, t.employee_id, today);
          const day = AttendanceService.dayFor(s, t.employee_id, today);
          if (!day.workday || day.first_in || day.excused) continue;
          const deadline = toMinutes(plan.start) + (plan.grace_minutes || 0);
          const how = plan.source === 'SALESDOC_VISIT' ? 'birinchi vizitni qiling'
            : plan.source === 'TELEGRAM_VIDEO' ? 'guruhga dumaloq video tashlang' : 'Face ID bilan kelganingizni belgilang';
          if (minute >= deadline - cfg.remind_before_min && minute < deadline) {
            this.notify(company_id, { employee_id: t.employee_id }, 'CHECKIN_REMINDER', '⏰ Ish boshlanishi',
              `Ish <b>${plan.start}</b> gacha boshlanadi — ${how}.`, today);
          } else if (minute >= deadline + cfg.missed_after_min && minute < deadline + cfg.missed_after_min + 180) {
            this.notify(company_id, { employee_id: t.employee_id }, 'CHECKIN_MISSED', '❗ Ish boshlangani qayd etilmadi',
              `Bugun ish ${plan.start} gacha boshlanishi kerak edi, lekin hali qayd yo‘q — ${how}. Sababli bo‘lsangiz rahbarga ayting.`, today);
          }
        }
      }

      if (minute < cfg.morning_hour * 60) continue;

      // Morning: the day's tasks.
      if (cfg.events.includes('TASK_DUE')) {
        const tasks = db.find('crm_tasks', t => t.company_id === company_id && (t.status === 'OPEN' || t.status === 'IN_PROGRESS') && !!t.due_date && t.due_date <= today);
        const byUser = new Map<string, typeof tasks>();
        for (const t of tasks) byUser.set(t.assignee_user_id, [...(byUser.get(t.assignee_user_id) || []), t]);
        for (const [user_id, list] of byUser) {
          const lines = list.sort((a, b) => String(a.due_date).localeCompare(String(b.due_date))).slice(0, 25)
            .map(t => `• ${escapeHtml(t.title)}${t.due_date! < today ? ` — <b>muddati o‘tgan</b> (${t.due_date!.split('-').reverse().join('.')})` : ' — bugun'}`);
          this.notify(company_id, { user_id }, 'TASK_DUE', `📋 Vazifalar: ${list.length} ta`, lines.join('\n') + (list.length > 25 ? `\n… yana ${list.length - 25} ta` : ''), today);
        }
      }

      // Morning, agents: their customers' debts.
      if (cfg.events.includes('AGENT_DEBTS')) {
        const s = AttendanceService.settings(company_id);
        const agentOf = new Map<string, string>(); // employee_id -> agent id
        for (const [emp, agent] of Object.entries(s.agent_links || {})) if (agent) agentOf.set(emp, agent);
        for (const a of db.find('agents', a => a.company_id === company_id && !!a.employee_id)) if (!agentOf.has(a.employee_id!)) agentOf.set(a.employee_id!, a.id);
        for (const r of linked) {
          let employee_id = r.employee_id;
          const agentId = employee_id ? agentOf.get(employee_id) : null;
          const byUser = !agentId && r.user_id ? db.findOne('agents', a => a.company_id === company_id && a.user_id === r.user_id) : null;
          const agent = agentId || byUser?.id;
          if (!agent) continue;
          const debtors = db.find('customers', c => c.company_id === company_id && c.agent_id === agent && (c.current_balance || 0) > 0)
            .sort((a, b) => b.current_balance - a.current_balance);
          if (!debtors.length) continue;
          const total = debtors.reduce((t, c) => t + c.current_balance, 0);
          const lines = debtors.slice(0, 30).map(c => `• ${escapeHtml(c.name)} — <b>${money(c.current_balance)}</b>`);
          this.notify(company_id, employee_id ? { employee_id } : { user_id: r.user_id }, 'AGENT_DEBTS', `💰 Mijozlaringiz qarzi: ${money(total)} so‘m`,
            `${debtors.length} ta mijoz qarzdor:\n${lines.join('\n')}${debtors.length > 30 ? `\n… yana ${debtors.length - 30} ta` : ''}`, today);
        }
      }
    }
  }
}

/** Every 20 s: new messages to the personal bots (linking); every minute: time-based reminders. */
export function startStaffBotScheduler() {
  const pollingOnly = process.env.TELEGRAM_POLLING_ONLY === '1';
  let busy = false;
  const poll = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      for (const bot of db.find('notification_channels', c => c.channel_type === 'TELEGRAM' && c.is_active && !!c.config?.bot_token && (c.config?.personal === true || c.config?.checkin_enabled === true || !!c.config?.checkin_chat_id))) {
        await StaffBotService.pollUpdates(bot);
      }
    } catch (err: any) { console.warn('[StaffBot]', err.message); } finally { busy = false; }
  }, 20_000);
  let tick = 0;
  if (pollingOnly) { poll.unref(); return; }
  const reminders = setInterval(() => {
    try { StaffBotService.queueScheduled(); } catch (err: any) { console.warn('[StaffBot]', err.message); }
    // Violations to the groups every 5 minutes (they are worked out from the month's attendance).
    if (tick++ % 5 === 0) { try { StaffBotService.queuePenaltyPosts(); } catch (err: any) { console.warn('[StaffBot] jarimalar:', err.message); } }
  }, 60_000);
  poll.unref(); reminders.unref();
}
