import { randomUUID } from 'node:crypto';
import { db } from '../db/database.ts';
import type { JarvisConversation, JarvisSettings } from '../db/schema.ts';
import { AuditService } from '../services/audit.service.ts';
import { businessToday } from '../utils/date.ts';
import { CLAUDE_MODELS, DEFAULT_MODEL, type ClaudeBlock, type ClaudeMessage } from './claude.ts';
import { callLlm, listModels, PROVIDERS, type LlmProvider, type LlmTransport } from './llm.ts';
import type { VoiceConfig, VoiceProvider } from './voice.ts';
import { decryptSecret, encryptSecret } from './secrets.ts';
import { findTool, runTool, toolsFor, type JarvisContext } from './tools.ts';
import { computeInsights } from './insights.ts';
import fs from 'node:fs';
import { checkVaultPath, defaultVault, syncVault } from './obsidian.ts';

const MAX_STEPS = 8;            // tool rounds for one question
const CONTEXT_CHARS = 60_000;   // how much of the conversation is sent back to the AI
const now = () => new Date().toISOString();
const fail = (message: string, status = 400) => Object.assign(new Error(message), { status });

/** Business assistant for the owner: the chosen AI reads the books through tools and answers with concrete advice. */
export class JarvisService {
  static transport: LlmTransport | undefined; // replaced in tests

  static settings(companyId: string): JarvisSettings {
    const existing = db.findById('jarvis_settings', companyId);
    if (existing) return existing;
    const row: JarvisSettings = { id: companyId, company_id: companyId, api_key_enc: null, model: DEFAULT_MODEL, updated_at: now() };
    db.insert('jarvis_settings', row);
    return row;
  }

  /** Ready to answer: a key, or a keyless local service (Ollama) with its address. */
  private static aiReady(s: JarvisSettings) {
    // A service that was removed (Gemini) does not count: the company sets up Claude instead.
    if (!PROVIDERS.some(p => p.id === (s.provider || 'anthropic'))) return false;
    return !!s.model && (!!s.api_key_enc || ((s.provider || 'anthropic') === 'openai_compatible' && !!s.base_url));
  }

  /** Whether the company's AI (the one set up in Jarvis) can answer. */
  static ready(companyId: string) {
    return this.aiReady(this.settings(companyId));
  }

  /**
   * One answer from the company's AI without tools (analyses, strategies). The same service, model and key as Jarvis,
   * so every AI feature of the program works once Jarvis is set up.
   */
  static async complete(companyId: string, system: string, prompt: string, maxTokens = 2500, json = false): Promise<{ text: string; model: string }> {
    const s = this.settings(companyId);
    if (!this.aiReady(s)) throw fail('AI ulanmagan: Jarvis sozlamalarida AI xizmati, model va kalitni kiriting.');
    const llm = { provider: s.provider || 'anthropic', model: s.model, apiKey: s.api_key_enc ? decryptSecret(s.api_key_enc) : '', baseUrl: s.base_url } as const;
    const res = await callLlm(llm, { system, tools: [], messages: [{ role: 'user', content: prompt }], maxTokens, json }, this.transport);
    const text = res.content.filter(b => b.type === 'text').map(b => (b as any).text).join('\n').trim();
    if (!text) throw fail('AI javob qaytarmadi. Qayta urinib ko‘ring.');
    return { text, model: s.model };
  }

  static publicSettings(companyId: string) {
    const s = this.settings(companyId);
    const voice = s.voice_provider || 'browser';
    // A removed service (Gemini) is shown as Claude waiting for its key.
    const removed = !PROVIDERS.some(p => p.id === (s.provider || 'anthropic'));
    return {
      configured: this.aiReady(s), provider: removed ? 'anthropic' : s.provider || 'anthropic', model: removed ? DEFAULT_MODEL : s.model,
      base_url: removed ? '' : s.base_url || '', has_key: !removed && !!s.api_key_enc,
      providers: PROVIDERS, claude_models: CLAUDE_MODELS, auto_briefing: !!s.auto_briefing, last_briefing_date: s.last_briefing_date || null,
      voice: { provider: voice, configured: voice === 'browser' || !!s.voice_key_enc, region: s.voice_region || '', gender: s.voice_gender || 'female' }
    };
  }

  static saveSettings(actor: { userId: string; email: string; companyId: string }, input: {
    provider?: LlmProvider; api_key?: string; model?: string; base_url?: string;
    voice_provider?: VoiceProvider; voice_key?: string; voice_region?: string; voice_gender?: 'female' | 'male'; auto_briefing?: boolean;
  }) {
    const s = this.settings(actor.companyId);
    const patch: Partial<JarvisSettings> = { updated_at: now() };
    // A stored service that was removed (Gemini) moves to Claude on the next save, without its old key.
    const stored = PROVIDERS.some(p => p.id === (s.provider || 'anthropic')) ? (s.provider || 'anthropic') : null;
    const provider = input.provider ?? stored ?? 'anthropic';
    if (!PROVIDERS.some(p => p.id === provider)) throw fail('Noma’lum AI xizmati.');
    if (provider !== stored) {
      patch.provider = provider;
      // A key belongs to its service; the new service needs its own.
      patch.api_key_enc = null;
      patch.model = PROVIDERS.find(p => p.id === provider)!.default_model;
      patch.base_url = PROVIDERS.find(p => p.id === provider)!.base_url || null;
    }
    const key = input.api_key?.trim();
    if (key) {
      if (provider === 'anthropic' && !/^sk-ant-[A-Za-z0-9_\-]{20,}$/.test(key)) throw fail('Bu Claude API kalitiga o‘xshamaydi (sk-ant-… bilan boshlanadi).');
      if (provider === 'openai' && !/^sk-[A-Za-z0-9_\-]{20,}$/.test(key)) throw fail('Bu OpenAI API kalitiga o‘xshamaydi (sk-… bilan boshlanadi).');
      if (key.length < 16 || /\s/.test(key)) throw fail('Kalit noto‘g‘ri ko‘rinadi.');
      patch.api_key_enc = encryptSecret(key);
    }
    if (input.model !== undefined) {
      const model = input.model.trim();
      if (!/^[A-Za-z0-9._:\/\-]{2,100}$/.test(model)) throw fail('Model nomi noto‘g‘ri (masalan: claude-sonnet-5, gemini-2.5-flash, deepseek-chat, llama3.1).');
      patch.model = model;
    }
    if (input.base_url !== undefined && provider !== 'anthropic' && provider !== 'gemini') {
      const url = input.base_url.trim().replace(/\/+$/, '');
      if (url) {
        let u: URL;
        try { u = new URL(url); } catch { throw fail('Manzil noto‘g‘ri (masalan https://api.deepseek.com/v1).'); }
        // A key may travel only over HTTPS; plain HTTP only to this computer (Ollama, LM Studio).
        if (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname))) throw fail('Faqat https:// manzil (yoki shu kompyuterdagi http://localhost).');
        patch.base_url = url;
      } else if (provider === 'openai_compatible') throw fail('Xizmat manzilini (base URL) kiriting.');
    }
    if (input.voice_provider !== undefined) {
      if (!['browser', 'azure', 'openai'].includes(input.voice_provider)) throw fail('Noma’lum ovoz xizmati.');
      if (input.voice_provider !== (s.voice_provider || 'browser')) patch.voice_key_enc = null;
      patch.voice_provider = input.voice_provider;
    }
    if (input.voice_key?.trim()) patch.voice_key_enc = encryptSecret(input.voice_key.trim());
    if (input.voice_region !== undefined) {
      const region = input.voice_region.trim().toLowerCase();
      if (region && !/^[a-z0-9]{3,30}$/.test(region)) throw fail('Azure hududi noto‘g‘ri (masalan: westeurope, eastus).');
      patch.voice_region = region || null;
    }
    if (input.voice_gender !== undefined) patch.voice_gender = input.voice_gender === 'male' ? 'male' : 'female';
    if (input.auto_briefing !== undefined) patch.auto_briefing = !!input.auto_briefing;
    db.update('jarvis_settings', s.id, patch);
    AuditService.log({
      company_id: actor.companyId, user_id: actor.userId, user_email: actor.email, action: 'UPDATE', entity: 'JarvisSettings', entity_id: s.id,
      old_value: { provider: s.provider || 'anthropic', model: s.model, voice: s.voice_provider || 'browser' },
      new_value: { provider, model: patch.model ?? s.model, voice: patch.voice_provider ?? s.voice_provider ?? 'browser', api_key_changed: !!key, voice_key_changed: !!input.voice_key?.trim() },
      reason: 'Jarvis sozlamalari o‘zgartirildi'
    });
    return this.publicSettings(actor.companyId);
  }

  // ---------- Obsidian vault ----------
  static obsidianView(companyId: string) {
    const s = this.settings(companyId);
    return {
      vault: s.obsidian_vault || null, default_vault: defaultVault(companyId), auto: !!s.obsidian_auto,
      last_sync: s.obsidian_last_sync || null, last_error: s.obsidian_last_error || null,
      exists: !!s.obsidian_vault && fs.existsSync(s.obsidian_vault)
    };
  }

  /** Connects (or disconnects with vault = null) the vault folder; the folder is created and filled right away. */
  static saveObsidian(actor: { userId: string; email: string; companyId: string }, input: { vault?: string | null; auto?: boolean }) {
    const s = this.settings(actor.companyId);
    const patch: Partial<JarvisSettings> = { updated_at: now() };
    if (input.vault === null || input.vault === '') { patch.obsidian_vault = null; patch.obsidian_auto = false; }
    else if (input.vault !== undefined) {
      const vault = checkVaultPath(input.vault);
      try { fs.mkdirSync(vault, { recursive: true }); } catch (e: any) { throw fail(`Papkani yaratib bo‘lmadi: ${e.message}`); }
      patch.obsidian_vault = vault;
    }
    if (input.auto !== undefined) patch.obsidian_auto = !!input.auto;
    db.update('jarvis_settings', s.id, patch);
    AuditService.log({ company_id: actor.companyId, user_id: actor.userId, user_email: actor.email, action: 'UPDATE', entity: 'JarvisSettings', entity_id: s.id, old_value: { obsidian_vault: s.obsidian_vault || null }, new_value: { obsidian_vault: patch.obsidian_vault ?? s.obsidian_vault ?? null, auto: patch.obsidian_auto ?? s.obsidian_auto ?? false }, reason: 'Obsidian sozlamasi' });
    if (patch.obsidian_vault) this.syncObsidian(actor.companyId);
    return this.obsidianView(actor.companyId);
  }

  /** Writes the business notes now; the result (or the error) is kept for the settings page. */
  static syncObsidian(companyId: string) {
    const s = this.settings(companyId);
    if (!s.obsidian_vault) throw fail('Obsidian ulanmagan.');
    try {
      const r = syncVault(companyId, s.obsidian_vault);
      db.update('jarvis_settings', s.id, { obsidian_last_sync: r.at, obsidian_last_error: null });
      return { ...this.obsidianView(companyId), written: r.written, skipped: r.skipped };
    } catch (e: any) {
      db.update('jarvis_settings', s.id, { obsidian_last_error: String(e?.message || e).slice(0, 300) });
      throw fail(`Obsidian yangilanmadi: ${e?.message || e}`);
    }
  }

  /** Models available on the saved account (for the settings list). */
  static async availableModels(companyId: string) {
    const s = this.settings(companyId);
    if (!s.api_key_enc && (s.provider || 'anthropic') !== 'openai_compatible') throw fail('Avval API kalitini saqlang.');
    const models = await listModels({ provider: s.provider || 'anthropic', apiKey: s.api_key_enc ? decryptSecret(s.api_key_enc) : '', baseUrl: s.base_url });
    return [...new Set(models)].sort();
  }

  /** Voice service of the company (server-side providers only). */
  static voiceConfig(companyId: string): VoiceConfig {
    const s = this.settings(companyId);
    const provider = s.voice_provider || 'browser';
    if (provider === 'browser') throw fail('Ovoz brauzer rejimida — server ovoz xizmati sozlanmagan.');
    if (!s.voice_key_enc) throw fail('Ovoz xizmati kaliti kiritilmagan (Jarvis → Sozlamalar).');
    return { provider, key: decryptSecret(s.voice_key_enc), region: s.voice_region, gender: s.voice_gender || 'female', baseUrl: (s.provider === 'openai' ? s.base_url : null) };
  }

  static listConversations(ctx: JarvisContext) {
    return db.find('jarvis_conversations', c => c.company_id === ctx.companyId && c.user_id === ctx.userId)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 50)
      .map(c => ({ id: c.id, title: c.title, updated_at: c.updated_at }));
  }

  private static own(ctx: JarvisContext, id: string): JarvisConversation {
    const c = db.findById('jarvis_conversations', id);
    if (!c || c.company_id !== ctx.companyId || c.user_id !== ctx.userId) throw fail('Suhbat topilmadi.', 404);
    return c;
  }

  static deleteConversation(ctx: JarvisContext, id: string) {
    this.own(ctx, id);
    db.delete('jarvis_conversations', id);
  }

  /** The conversation as the screen shows it: questions, answers, and which data Jarvis looked at. */
  static view(ctx: JarvisContext, id: string) {
    const c = this.own(ctx, id);
    const actions = new Map(db.find('jarvis_actions', a => a.conversation_id === id).map(a => [a.tool_use_id, a]));
    const items: { role: 'user' | 'assistant' | 'tool'; text: string; status?: string }[] = [];
    for (const m of c.messages as ClaudeMessage[]) {
      if (typeof m.content === 'string') { items.push({ role: m.role, text: m.content }); continue; }
      for (const b of m.content) {
        if (b.type === 'text' && b.text.trim()) items.push({ role: 'assistant', text: b.text });
        if (b.type === 'tool_use') {
          const a = actions.get(b.id);
          items.push({ role: 'tool', text: a?.summary || b.name, status: a?.status || 'DONE' });
        }
      }
    }
    return { id: c.id, title: c.title, items };
  }

  private static systemPrompt(ctx: JarvisContext): string {
    const company = db.findById('companies', ctx.companyId);
    const user = db.findById('users', ctx.userId);
    const sources = db.find('integrations', i => i.company_id === ctx.companyId && i.provider_type === 'DISTRIBUTION' && i.status === 'CONNECTED').map(i => i.provider_name);
    return [
      `Siz Jarvis — “${company?.name || 'kompaniya'}” distribyutsiya biznesining rahbar yordamchisi va tahlilchisisiz. Suhbatdosh: ${user?.full_name || 'rahbar'}.`,
      `Bugun ${businessToday()} (Toshkent vaqti). Ma’lumot manbalari: Distro Pro bazasi${sources.length ? ` (${sources.join(', ')} bilan sinxron)` : ''}.`,
      'Til: foydalanuvchi qaysi tilda yozsa, shu tilda javob bering. O‘zbekcha — sof adabiy tilda, ruscha — ruscha.',
      'Raqamlarni faqat vositalardan oling, taxmin qilmang. Ma’lumot yetmasa, buni ochiq ayting va nima kerakligini yozing.',
      'Tavsiyalar aniq bo‘lsin: kim, nima qiladi, qancha summa yoki miqdor, qachongacha va nima uchun (qaysi raqamga asoslanib). Umumiy maslahat bermang.',
      'Summalarni so‘mda, minglik bo‘shliq bilan yozing (1 250 000 so‘m). Javob qisqa: avval xulosa, keyin 3–7 ta asosiy band.',
      'CRM vazifasi yoki qayd faqat foydalanuvchi so‘rasa yaratiladi; yaratganingizni natija kelgandan keyin ayting.',
      'Tannarx noma’lum bo‘lsa foyda hisoblanmagan bo‘ladi — buni aytib, Mahsulotlar bo‘limida kirim narxini kiritishni tavsiya qiling.',
      'Siz faol yordamchisiz: javob oxirida, agar ma’lumotda xavf yoki imkoniyat ko‘rsangiz, bitta keyingi qadamni taklif qiling.',
      'Foydalanuvchi sahifani ochishni so‘rasa open_page vositasini ishlating. “Eslab qol” desa yoki doimiy qoida aytsa — remember; “unut” desa — forget.',
      'Ovozli javob o‘qiladi: qisqa, ravon gaplar; jadval va uzun ro‘yxatdan qoching (kerak bo‘lsa 5 banddan oshmasin).',
      ...(db.findById('jarvis_settings', ctx.companyId)?.obsidian_vault ? [
        'Obsidian bilim bazasi ulangan. Rahbarning rejalari, kelishuvlari yoki oldin yozganlari haqidagi savolda avval obsidian_search bilan qidiring.',
        'Muhim tahlil, strategiya, reja yoki rahbar “yozib qo‘y” degan narsani obsidian_write bilan Jarvis/ papkasiga saqlang va buni javobda ayting. Agent va mijozlarni [[Agentlar/Ism]] ko‘rinishida bog‘lang.'
      ] : []),
      ...this.memoryLines(ctx),
      ...this.insightLines(ctx)
    ].join('\n');
  }

  /** What the owner asked Jarvis to remember, in every conversation. */
  private static memoryLines(ctx: JarvisContext): string[] {
    const memories = db.find('jarvis_memories', m => m.company_id === ctx.companyId).sort((a, b) => a.created_at.localeCompare(b.created_at)).slice(-60);
    return memories.length ? ['Doimiy xotira (foydalanuvchi aytgan faktlar va qoidalar, ularga amal qiling):', ...memories.map(m => `- ${m.text}`)] : [];
  }

  /** Current warnings computed without AI, so answers start from what needs attention now. */
  private static insightLines(ctx: JarvisContext): string[] {
    try {
      const list = computeInsights(ctx.companyId).filter(i => i.level !== 'info').slice(0, 6);
      return list.length ? ['Hozirgi ogohlantirishlar (tizim o‘zi aniqlagan):', ...list.map(i => `- ${i.title}: ${i.detail}`)] : [];
    } catch { return []; }
  }

  // ---------- memory (shown and editable on the Jarvis page) ----------
  static memories(ctx: JarvisContext) {
    return db.find('jarvis_memories', m => m.company_id === ctx.companyId).sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map(m => ({ id: m.id, text: m.text, created_at: m.created_at }));
  }

  static deleteMemory(ctx: JarvisContext, id: string) {
    const m = db.findById('jarvis_memories', id);
    if (!m || m.company_id !== ctx.companyId) throw fail('Xotira topilmadi.', 404);
    db.delete('jarvis_memories', id);
  }

  /** Recent part of the conversation that fits the context budget, starting at a plain question. */
  private static recent(messages: ClaudeMessage[]): ClaudeMessage[] {
    let size = 0;
    let start = messages.length;
    for (let i = messages.length - 1; i >= 0; i--) {
      size += JSON.stringify(messages[i].content).length;
      if (size > CONTEXT_CHARS && start < messages.length) break;
      if (messages[i].role === 'user' && typeof messages[i].content === 'string') start = i;
    }
    return messages.slice(start);
  }

  /** One question: Claude may call tools several times before it answers. */
  static async ask(ctx: JarvisContext, text: string, conversationId?: string | null) {
    const question = text.trim();
    if (!question) throw fail('Savol bo‘sh.');
    if (question.length > 4000) throw fail('Savol 4000 belgidan oshmasin.');
    const s = this.settings(ctx.companyId);
    if (!this.aiReady(s)) throw fail('Avval Jarvis sozlamalarida AI xizmati, model va API kalitini kiriting.');
    const llm = { provider: s.provider || 'anthropic', model: s.model, apiKey: s.api_key_enc ? decryptSecret(s.api_key_enc) : '', baseUrl: s.base_url } as const;

    let conv: JarvisConversation;
    if (conversationId) conv = this.own(ctx, conversationId);
    else {
      conv = { id: randomUUID(), company_id: ctx.companyId, user_id: ctx.userId, title: question.slice(0, 60), messages: [], created_at: now(), updated_at: now() };
      db.insert('jarvis_conversations', conv);
    }
    const messages: ClaudeMessage[] = [...conv.messages, { role: 'user', content: question }];
    const system = this.systemPrompt(ctx);
    const tools = toolsFor(ctx.companyId);
    let answered = false;
    const clientActions: { type: 'navigate'; page: string }[] = [];

    // The turn is saved only when it ends with an answer; a broken turn (network, limit) would leave an unanswered
    // tool call that Claude refuses on the next question. Tool runs are in the action log either way.
    try {
      for (let step = 0; step < MAX_STEPS; step++) {
        const res = await callLlm(llm, { system, tools, messages: this.recent(messages), maxTokens: 2500 }, this.transport);
        messages.push({ role: 'assistant', content: res.content });
        const uses = res.content.filter((b): b is Extract<ClaudeBlock, { type: 'tool_use' }> => b.type === 'tool_use');
        if (!uses.length || res.stop_reason !== 'tool_use') { answered = true; break; }
        const results: ClaudeBlock[] = [];
        for (const use of uses) {
          const tool = findTool(use.name);
          const out = await runTool(ctx, use.name, use.input);
          db.insert('jarvis_actions', {
            id: randomUUID(), company_id: ctx.companyId, user_id: ctx.userId, conversation_id: conv.id, tool_use_id: use.id, tool: use.name,
            input: use.input, risk: tool?.risk || 'read', summary: tool ? tool.summary(use.input || {}) : use.name,
            status: out.ok ? 'DONE' : 'FAILED', error: out.ok ? null : out.text, created_at: now()
          });
          if (out.ok && use.name === 'open_page') clientActions.push({ type: 'navigate', page: String(use.input?.page || '') });
          results.push({ type: 'tool_result', tool_use_id: use.id, content: out.text, ...(out.ok ? {} : { is_error: true }) });
        }
        messages.push({ role: 'user', content: results });
      }
      if (!answered) {
        // Close the open tool round so the history stays valid, then say why there is no full answer.
        messages.push({ role: 'assistant', content: [{ type: 'text', text: 'Savol juda ko‘p bosqich talab qildi. Uni qismlarga bo‘lib so‘rang.' }] });
      }
    } catch (err) {
      if (!conversationId) db.delete('jarvis_conversations', conv.id);
      throw err;
    }
    db.update('jarvis_conversations', conv.id, { messages, updated_at: now() });
    return { ...this.view(ctx, conv.id), client_actions: clientActions };
  }

  static readonly BRIEFING_PROMPT = 'Ertalabki brifingni tayyorla: kechagi va oy boshidan savdo, bugungi kassa holati, eng xavfli qarzlar, xaridni to‘xtatgan mijozlar, tugab qolayotgan tovarlar va hozirgi ogohlantirishlar. Oxirida bugun nima qilish kerakligini 5 ta aniq band qilib yoz (kim, nima, qancha).';

  /** The morning briefing, prepared once a day at 08:00 for the owner when switched on. */
  static async morningBriefing(companyId: string, force = false) {
    const s = this.settings(companyId);
    const today = businessToday();
    if (!this.aiReady(s) || (!force && (!s.auto_briefing || s.last_briefing_date === today))) return null;
    const ownerRole = db.findOne('roles', r => r.company_id === companyId && r.name === 'SUPER_ADMIN');
    const ownerLink = ownerRole ? db.find('user_roles', ur => ur.role_id === ownerRole.id).map(ur => db.findById('users', ur.user_id)).find(u => u?.status === 'ACTIVE') : null;
    if (!ownerLink) return null;
    db.update('jarvis_settings', s.id, { last_briefing_date: today });
    const ctx: JarvisContext = { companyId, userId: ownerLink.id, email: ownerLink.email };
    const view = await this.ask(ctx, this.BRIEFING_PROMPT);
    db.update('jarvis_conversations', view.id, { title: `Ertalabki brifing — ${today.split('-').reverse().join('.')}` });
    // The briefing also goes into today's Obsidian note.
    if (s.obsidian_vault) { try { this.syncObsidian(companyId); } catch (e: any) { console.warn('[Jarvis] Obsidian:', e.message); } }
    return view.id;
  }

  /**
   * Every 10 minutes: after 08:00 Tashkent the day's briefing for companies that switched it on, and once an hour the
   * Obsidian business notes of companies that switched auto-refresh on.
   */
  static startScheduler(): NodeJS.Timeout {
    const check = () => {
      for (const s of db.find('jarvis_settings', x => !!x.obsidian_vault && !!x.obsidian_auto && (!x.obsidian_last_sync || Date.now() - Date.parse(x.obsidian_last_sync) > 55 * 60_000))) {
        try { this.syncObsidian(s.company_id); } catch (e: any) { console.warn('[Jarvis] Obsidian yangilanmadi:', e.message); }
      }
      const hour = Number(new Date().toLocaleString('en-GB', { timeZone: 'Asia/Tashkent', hour: '2-digit', hour12: false }));
      if (hour < 8) return;
      for (const s of db.find('jarvis_settings', x => !!x.auto_briefing && x.last_briefing_date !== businessToday())) {
        this.morningBriefing(s.company_id).catch(e => console.warn('[Jarvis] Brifing tayyorlanmadi:', e.message));
      }
    };
    const timer = setInterval(check, 10 * 60_000);
    timer.unref();
    setTimeout(check, 90_000).unref();
    return timer;
  }

  /** Recent tool runs, newest first (for the log tab). */
  static actions(ctx: JarvisContext) {
    return db.find('jarvis_actions', a => a.company_id === ctx.companyId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 200)
      .map(a => ({ id: a.id, created_at: a.created_at, user: db.findById('users', a.user_id)?.full_name || '', tool: a.tool, risk: a.risk, summary: a.summary, status: a.status, error: a.error }));
  }
}
