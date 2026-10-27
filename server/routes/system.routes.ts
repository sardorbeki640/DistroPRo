import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/database.ts';
import { requireAuth, requireOwner } from '../middleware/auth.middleware.ts';
import { listBackups, runBackup } from '../services/backup.service.ts';
import { AuditService } from '../services/audit.service.ts';
import { BotService, BOT_EVENTS } from '../services/bot.service.ts';
import { TelegramService } from '../services/telegram.service.ts';
import { StaffBotService, STAFF_REMINDERS } from '../services/staff-bot.service.ts';

const router = Router();
router.use(requireAuth, requireOwner);

/** GET /api/system/backups — automatic backups and where they are. */
router.get('/backups', (_req, res, next) => {
  try {
    res.json({ success: true, backups: listBackups(), extra_copy_dir: process.env.BACKUP_COPY_DIR || null });
  } catch (e) { next(e); }
});

/** POST /api/system/backups — make a backup now. */
router.post('/backups', (req, res, next) => {
  try {
    const r = runBackup();
    AuditService.log({ company_id: req.user!.companyId, user_id: req.user!.userId, user_email: req.user!.email, action: 'CREATE', entity: 'Backup', entity_id: r.file, old_value: null, new_value: r, reason: 'Qo‘lda zaxira nusxa olindi' });
    res.json({ success: true, ...r, backups: listBackups() });
  } catch (e) { next(e); }
});

/** GET/PUT /api/system/company — the company card shown on reports, statements and exports. */
router.get('/company', (req, res, next) => {
  try {
    const c = db.findById('companies', req.user!.companyId);
    res.json({ success: true, company: { name: c?.name || '', tax_id: c?.tax_id || '', address: c?.address || '', phone: c?.phone || '' } });
  } catch (e) { next(e); }
});

router.put('/company', (req, res, next) => {
  try {
    const body = z.object({
      name: z.string().trim().min(2, 'Kompaniya nomi kamida 2 belgi').max(160),
      tax_id: z.string().trim().max(20).regex(/^\d*$/, 'STIR faqat raqamlardan iborat').optional(),
      address: z.string().trim().max(300).optional(),
      phone: z.string().trim().max(40).optional()
    }).parse(req.body);
    const before = db.findById('companies', req.user!.companyId);
    if (!before) throw Object.assign(new Error('Kompaniya topilmadi.'), { status: 404 });
    db.update('companies', before.id, body as any);
    AuditService.log({ company_id: before.id, user_id: req.user!.userId, user_email: req.user!.email, action: 'UPDATE', entity: 'Company', entity_id: before.id, old_value: { name: before.name, tax_id: before.tax_id, address: before.address, phone: before.phone }, new_value: body, reason: 'Kompaniya ma’lumotlari o‘zgartirildi' });
    res.json({ success: true });
  } catch (e) { next(e); }
});

// ---- Telegram bots: reports and alerts to the owner's chats ----
const who = (req: any) => ({ id: req.user!.userId, email: req.user!.email });
const BotSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().max(80).default(''),
  bot_token: z.string().trim().max(120).optional(),
  chat_id: z.string().trim().max(40).default(''),
  chat_title: z.string().trim().max(120).optional(),
  topic_id: z.string().trim().max(20).regex(/^\d*$/, 'Mavzu ID faqat raqam').optional(),
  events: z.array(z.string()).max(20).default([]),
  is_active: z.boolean().optional(),
  daily_report_hour: z.number().int().min(0).max(23).optional(),
  personal: z.boolean().optional(),
  checkin_enabled: z.boolean().optional(),
  personal_events: z.array(z.string()).max(20).optional(),
  remind_before_min: z.number().int().min(0).max(180).optional(),
  missed_after_min: z.number().int().min(0).max(240).optional(),
  morning_hour: z.number().int().min(0).max(23).optional(),
  checkin_chat_id: z.string().trim().max(40).optional(),
  checkin_chat_title: z.string().trim().max(120).optional()
});
const StaffKeySchema = z.object({ employee_id: z.string().optional(), user_id: z.string().optional() }).refine(k => !!k.employee_id || !!k.user_id, 'Xodim tanlanmagan');
const BotRefSchema = z.object({ id: z.string().optional(), bot_token: z.string().trim().max(120).optional(), chat_id: z.string().trim().max(40).optional(), topic_id: z.string().trim().max(20).optional() });

router.get('/bots', (req, res, next) => {
  try { res.json({ success: true, bots: BotService.list(req.user!.companyId), events: BOT_EVENTS, staff_reminders: STAFF_REMINDERS }); } catch (e) { next(e); }
});
/** Employees and their personal Telegram: linked or not, with a link the owner can send them. */
router.get('/bots/staff', (req, res, next) => {
  try { res.json({ success: true, people: StaffBotService.people(req.user!.companyId), bot: StaffBotService.personalBot(req.user!.companyId)?.config?.bot_username || null }); } catch (e) { next(e); }
});
router.post('/bots/staff/link', (req, res, next) => {
  try { res.json({ success: true, ...StaffBotService.link(req.user!.companyId, StaffKeySchema.parse(req.body)) }); } catch (e) { next(e); }
});
router.post('/bots/staff/unlink', (req, res, next) => {
  try { StaffBotService.unlink(req.user!.companyId, StaffKeySchema.parse(req.body), who(req)); res.json({ success: true }); } catch (e) { next(e); }
});
/** A test message to one employee's own chat. */
router.post('/bots/staff/test', async (req, res, next) => {
  try {
    const key = StaffKeySchema.parse(req.body);
    const bot = StaffBotService.personalBot(req.user!.companyId);
    const row = StaffBotService.resolve(req.user!.companyId, key);
    if (!bot || !row?.chat_id) throw new Error('Bu xodim Telegram’ini hali ulamagan.');
    await TelegramService.send(bot.config.bot_token!, row.chat_id, '✅ Sinov: eslatmalar shu yerga keladi.');
    res.json({ success: true, message: `Sinov xabari ${row.chat_name || 'xodimga'} yuborildi.` });
  } catch (e) { next(e); }
});
router.post('/bots', async (req, res, next) => {
  try { res.json({ success: true, bot: await BotService.save(req.user!.companyId, who(req), BotSchema.parse(req.body)) }); } catch (e) { next(e); }
});
router.delete('/bots/:id', (req, res, next) => {
  try { BotService.remove(req.user!.companyId, req.params.id, who(req)); res.json({ success: true }); } catch (e) { next(e); }
});
/** Chats that wrote /start to the bot or added it to a group: the owner picks one instead of typing an ID. */
router.post('/bots/find-chats', async (req, res, next) => {
  try { res.json({ success: true, ...(await BotService.findChats(req.user!.companyId, BotRefSchema.parse(req.body))) }); } catch (e) { next(e); }
});
router.post('/bots/test', async (req, res, next) => {
  try { const result = await BotService.test(req.user!.companyId, BotRefSchema.parse(req.body)); res.json({ success: true, message: result.message || 'Sinov xabari yuborildi — Telegram’ni tekshiring.' }); } catch (e) { next(e); }
});
/** Sends today's report to one bot now (preview of what it gets every day). */
router.post('/bots/:id/report-now', async (req, res, next) => {
  try {
    const c = db.findById('notification_channels', req.params.id);
    if (!c || c.company_id !== req.user!.companyId) throw Object.assign(new Error('Bot topilmadi.'), { status: 404 });
    if (!c.config.chat_id) throw new Error('Bu botda rahbariyat chati tanlanmagan.');
    const report = BotService.dailyReport(req.user!.companyId);
    await TelegramService.send(c.config.bot_token!, c.config.chat_id!, `<b>${report.title}</b>\n\n${report.html}`, c.config.topic_id);
    res.json({ success: true, message: 'Hisobot yuborildi.' });
  } catch (e) { next(e); }
});

export default router;
