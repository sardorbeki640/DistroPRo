import { Router } from 'express';
import type { Request } from 'express';
import { z } from 'zod';
import { requireAuth, requireOwner } from '../middleware/auth.middleware.ts';
import { JarvisService } from '../jarvis/jarvis.service.ts';
import type { JarvisContext } from '../jarvis/tools.ts';
import { synthesize, transcribe } from '../jarvis/voice.ts';
import { computeInsights } from '../jarvis/insights.ts';

const router = Router();

const ctx = (req: Request): JarvisContext => ({ companyId: req.user!.companyId, userId: req.user!.userId, email: req.user!.email });

// Jarvis sees the whole business (debts, profit, every customer), so only the owner and admins use it.
router.use(requireAuth, requireOwner);

router.get('/settings', (req, res, next) => {
  try { res.json({ success: true, settings: JarvisService.publicSettings(req.user!.companyId) }); } catch (e) { next(e); }
});

// Obsidian vault on this computer: Jarvis fills it from the books and searches it.
router.get('/obsidian', (req, res, next) => {
  try { res.json({ success: true, obsidian: JarvisService.obsidianView(req.user!.companyId) }); } catch (e) { next(e); }
});
router.put('/obsidian', (req, res, next) => {
  try {
    const body = z.object({ vault: z.string().max(400).nullable().optional(), auto: z.boolean().optional() }).parse(req.body);
    res.json({ success: true, obsidian: JarvisService.saveObsidian(ctx(req), body) });
  } catch (e) { next(e); }
});
router.post('/obsidian/sync', (req, res, next) => {
  try { res.json({ success: true, obsidian: JarvisService.syncObsidian(req.user!.companyId) }); } catch (e) { next(e); }
});

router.put('/settings', (req, res, next) => {
  try {
    const body = z.object({
      provider: z.enum(['anthropic', 'openai', 'gemini', 'openai_compatible']).optional(),
      api_key: z.string().max(400).optional(), model: z.string().max(120).optional(), base_url: z.string().max(300).optional(),
      voice_provider: z.enum(['browser', 'azure', 'openai']).optional(), voice_key: z.string().max(400).optional(),
      voice_region: z.string().max(40).optional(), voice_gender: z.enum(['female', 'male']).optional(),
      auto_briefing: z.boolean().optional()
    }).parse(req.body);
    res.json({ success: true, settings: JarvisService.saveSettings(ctx(req), body) });
  } catch (e) { next(e); }
});

// Speech: the browser sends 16 kHz mono WAV (base64); text comes back. Answers are read aloud as MP3.
router.post('/voice/transcribe', async (req, res, next) => {
  try {
    const body = z.object({ audio: z.string().min(100).max(12_000_000), language: z.enum(['uz', 'ru']).default('uz') }).parse(req.body);
    const text = await transcribe(JarvisService.voiceConfig(req.user!.companyId), Buffer.from(body.audio, 'base64'), body.language);
    res.json({ success: true, text });
  } catch (e) { next(e); }
});

router.post('/voice/speak', async (req, res, next) => {
  try {
    const body = z.object({ text: z.string().min(1).max(8000) }).parse(req.body);
    const audio = await synthesize(JarvisService.voiceConfig(req.user!.companyId), body.text);
    res.setHeader('Content-Type', 'audio/mpeg');
    res.send(audio);
  } catch (e) { next(e); }
});

router.get('/conversations', (req, res, next) => {
  try { res.json({ success: true, conversations: JarvisService.listConversations(ctx(req)) }); } catch (e) { next(e); }
});

router.get('/conversations/:id', (req, res, next) => {
  try { res.json({ success: true, conversation: JarvisService.view(ctx(req), req.params.id) }); } catch (e) { next(e); }
});

router.delete('/conversations/:id', (req, res, next) => {
  try { JarvisService.deleteConversation(ctx(req), req.params.id); res.json({ success: true }); } catch (e) { next(e); }
});

router.post('/ask', async (req, res, next) => {
  try {
    const body = z.object({ text: z.string().min(1).max(4000), conversation_id: z.string().max(80).nullable().optional() }).parse(req.body);
    res.json({ success: true, conversation: await JarvisService.ask(ctx(req), body.text, body.conversation_id) });
  } catch (e) { next(e); }
});

router.get('/models', async (req, res, next) => {
  try { res.json({ success: true, models: await JarvisService.availableModels(req.user!.companyId) }); } catch (e) { next(e); }
});

router.get('/insights', (req, res, next) => {
  try { res.json({ success: true, insights: computeInsights(req.user!.companyId, req.query.fresh === '1') }); } catch (e) { next(e); }
});

router.get('/memories', (req, res, next) => {
  try { res.json({ success: true, memories: JarvisService.memories(ctx(req)) }); } catch (e) { next(e); }
});

router.delete('/memories/:id', (req, res, next) => {
  try { JarvisService.deleteMemory(ctx(req), req.params.id); res.json({ success: true }); } catch (e) { next(e); }
});

router.get('/actions', (req, res, next) => {
  try { res.json({ success: true, actions: JarvisService.actions(ctx(req)) }); } catch (e) { next(e); }
});

export default router;
