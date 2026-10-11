import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.middleware.ts';
import { StaffBotService } from '../services/staff-bot.service.ts';

/** The signed-in person's own Telegram for personal reminders (any role: every employee links their own chat). */
const router = Router();
router.use(requireAuth);

router.get('/', (req, res, next) => {
  try { res.json({ success: true, ...StaffBotService.me(req.user!.companyId, req.user!.userId) }); } catch (e) { next(e); }
});
router.post('/link', (req, res, next) => {
  try { res.json({ success: true, ...StaffBotService.link(req.user!.companyId, { user_id: req.user!.userId }) }); } catch (e) { next(e); }
});
router.post('/mute', (req, res, next) => {
  try {
    const { muted } = z.object({ muted: z.array(z.string().max(30)).max(20) }).parse(req.body);
    StaffBotService.setMuted(req.user!.companyId, req.user!.userId, muted);
    res.json({ success: true, ...StaffBotService.me(req.user!.companyId, req.user!.userId) });
  } catch (e) { next(e); }
});
router.post('/unlink', (req, res, next) => {
  try {
    StaffBotService.unlink(req.user!.companyId, { user_id: req.user!.userId }, { id: req.user!.userId, email: req.user!.email });
    res.json({ success: true, ...StaffBotService.me(req.user!.companyId, req.user!.userId) });
  } catch (e) { next(e); }
});

export default router;
