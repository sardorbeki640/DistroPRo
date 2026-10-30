/**
 * Telegram Bot API (https://core.telegram.org/bots/api): checking a token, finding the chats that wrote to the bot,
 * and sending messages. Errors come back in plain Uzbek; `permanent` errors (bad token, unknown chat, bot blocked)
 * are not retried.
 */
const API = 'https://api.telegram.org';
const LIMIT = 4000; // Telegram allows 4096 characters per message; a little is kept for the HTML tags.

export class TelegramError extends Error {
  constructor(message: string, public permanent: boolean) { super(message); }
}

export const isTelegramToken = (token: string) => /^\d{5,}:[A-Za-z0-9_-]{30,}$/.test(String(token || '').trim());

/** Text for Telegram HTML mode: user data (customer names, comments) must not break the markup. */
export const escapeHtml = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export class TelegramService {
  private static updatesTails = new Map<string, Promise<unknown>>();
  /** Replaced in tests. */
  static fetchImpl: typeof fetch = (...args) => fetch(...args);

  static async call(token: string, method: string, body: Record<string, unknown> = {}): Promise<any> {
    if (!isTelegramToken(token)) throw new TelegramError('Bot tokeni noto‘g‘ri ko‘rinishda. @BotFather bergan tokenni to‘liq kiriting (masalan 123456789:AA…).', true);
    let res: Response;
    try {
      res = await this.fetchImpl(`${API}/bot${token.trim()}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000)
      });
    } catch (err: any) {
      const code = String(err?.cause?.code || err?.code || '').trim();
      const reason = err?.name === 'TimeoutError' || err?.name === 'AbortError'
        ? 'vaqt tugadi'
        : code ? `tarmoq xatosi: ${code}` : 'tarmoq xatosi';
      throw new TelegramError(`Telegram bilan aloqa yo‘q (${reason}).`, false);
    }
    const data: any = await res.json().catch(() => null);
    if (data?.ok) return data.result;
    const description = String(data?.description || `HTTP ${res.status}`);
    const code = Number(data?.error_code || res.status);
    if (code === 401 || code === 404) throw new TelegramError('Bot tokeni noto‘g‘ri yoki bekor qilingan. @BotFather’dan yangi token oling.', true);
    if (/chat not found/i.test(description)) throw new TelegramError('Chat topilmadi. Botga Telegram’da /start yozing (yoki botni guruhga qo‘shing), keyin “Chatni topish”ni bosing.', true);
    if (/bot was blocked|user is deactivated/i.test(description)) throw new TelegramError('Foydalanuvchi botni bloklagan. Botni qayta ishga tushirsin (/start).', true);
    if (/kicked|not a member|have no rights|not enough rights/i.test(description)) throw new TelegramError('Bot guruhdan chiqarilgan yoki yozish huquqi yo‘q. Botni guruhga qayta qo‘shing.', true);
    if (/thread not found|topic/i.test(description)) throw new TelegramError('Guruhdagi mavzu (topic) topilmadi. Mavzu ID sini tekshiring yoki bo‘sh qoldiring.', true);
    if (code === 429) throw new TelegramError('Telegram juda ko‘p xabar yuborilganini aytdi; birozdan keyin qayta yuboriladi.', false);
    throw new TelegramError(`Telegram xatosi: ${description}`, code >= 400 && code < 500);
  }

  /** The bot's own name and username: proves the token works. */
  static async getMe(token: string): Promise<{ id: number; name: string; username: string }> {
    const me = await this.call(token, 'getMe');
    return { id: me.id, name: me.first_name, username: me.username };
  }

  static async getWebhookInfo(token: string): Promise<{ url: string }> {
    const info = await this.call(token, 'getWebhookInfo');
    return { url: String(info?.url || '') };
  }

  /** Serialize getUpdates calls per token: Telegram rejects simultaneous pollers with a 409 conflict. */
  static async getUpdates(token: string, body: Record<string, unknown> = {}): Promise<any[]> {
    const key = token.trim();
    const previous = this.updatesTails.get(key) || Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>(resolve => { release = resolve; });
    const tail = previous.then(() => current);
    this.updatesTails.set(key, tail);
    await previous;
    try { return await this.call(key, 'getUpdates', body); }
    finally {
      release();
      if (this.updatesTails.get(key) === tail) this.updatesTails.delete(key);
    }
  }

  /**
   * Chats that recently wrote to the bot or added it to a group (Telegram keeps updates ~24 h).
   * So the owner never has to look up a chat_id by hand.
   */
  static async findChats(token: string): Promise<{ id: string; title: string; type: string }[]> {
    const updates: any[] = await this.getUpdates(token, { limit: 100, allowed_updates: ['message', 'my_chat_member', 'channel_post'] });
    const chats = new Map<string, { id: string; title: string; type: string }>();
    for (const u of updates) {
      const chat = u.message?.chat || u.my_chat_member?.chat || u.channel_post?.chat;
      if (!chat) continue;
      const title = chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(' ') || chat.username || String(chat.id);
      chats.set(String(chat.id), { id: String(chat.id), title, type: chat.type });
    }
    return Array.from(chats.values()).reverse();
  }

  /** Sends HTML text, split into several messages when longer than Telegram allows (at line breaks). */
  static async send(token: string, chatId: string, html: string, topicId?: string | number | null): Promise<number> {
    const parts: string[] = [];
    let current = '';
    for (const line of html.split('\n')) {
      if ((current + '\n' + line).length > LIMIT && current) { parts.push(current); current = ''; }
      current = current ? `${current}\n${line}` : line.slice(0, LIMIT);
    }
    if (current) parts.push(current);
    for (const text of parts) {
      await this.call(token, 'sendMessage', {
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        ...(topicId ? { message_thread_id: Number(topicId) } : {})
      });
    }
    return parts.length;
  }
}
