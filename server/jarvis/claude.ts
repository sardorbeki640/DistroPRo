/** Minimal Claude Messages API client (no SDK): text and tool use. */

export interface ClaudeTool { name: string; description: string; input_schema: Record<string, unknown> }
export type ClaudeBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: any; thought_signature?: string } // signature: Gemini only
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };
export interface ClaudeMessage { role: 'user' | 'assistant'; content: string | ClaudeBlock[] }
export interface ClaudeResponse { content: ClaudeBlock[]; stop_reason: string; usage?: { input_tokens: number; output_tokens: number } }

export type ClaudeTransport = (body: Record<string, unknown>, apiKey: string) => Promise<ClaudeResponse>;

export const CLAUDE_MODELS = ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'] as const;
export const DEFAULT_MODEL = 'claude-opus-5';

/** Replaced in tests (no waiting between retries). */
export const claudeRetry = { delays: [3000, 10000] };

/**
 * Talks to api.anthropic.com. A busy service (429, 529, 5xx) is tried again a few seconds later; other errors are
 * turned into plain Uzbek messages. Claude Opus 5 thinks before answering, so answers can take a while.
 */
export const httpTransport: ClaudeTransport = async (body, apiKey) => {
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json',
          // A request a safety classifier declines is answered by a fallback model inside the same call.
          'anthropic-beta': 'server-side-fallback-2026-07-01'
        },
        body: JSON.stringify({ ...body, fallbacks: 'default' }),
        signal: AbortSignal.timeout(300_000)
      });
    } catch (e: any) {
      throw new Error(`Claude bilan aloqa yo‘q (${e?.name === 'TimeoutError' ? 'javob kechikdi' : 'internet'}).`);
    }
    const data: any = await res.json().catch(() => null);
    if (res.ok) {
      if (data?.stop_reason === 'refusal') throw new Error('Claude bu so‘rovga javob bermadi (xavfsizlik cheklovi). Savolni boshqacha bering.');
      return data as ClaudeResponse;
    }
    const detail = data?.error?.message ? ` ${String(data.error.message).slice(0, 200)}` : '';
    if ((res.status === 429 || res.status >= 500) && attempt < claudeRetry.delays.length) {
      await new Promise(r => setTimeout(r, claudeRetry.delays[attempt]));
      continue;
    }
    if (res.status === 401) throw new Error('Claude API kaliti qabul qilinmadi. Jarvis sozlamalarida kalitni tekshiring.');
    if (res.status === 403) throw new Error(`Claude: bu kalitga ruxsat yo‘q.${detail}`);
    if (res.status === 429) throw new Error(`Claude limiti yoki balansi tugagan (429).${detail}`);
    if (res.status === 529 || res.status >= 500) throw new Error(`Claude serveri hozir band (${res.status}). Bir daqiqadan keyin qayta urining.`);
    throw new Error(`Claude xatosi (${res.status}).${detail}`);
  }
};

export async function callClaude(opts: {
  apiKey: string; model: string; system: string; messages: ClaudeMessage[]; tools: ClaudeTool[]; maxTokens?: number; transport?: ClaudeTransport;
}): Promise<ClaudeResponse> {
  // Fields other services add to blocks (e.g. Gemini's thought_signature) are not part of Claude's format.
  const messages = opts.messages.map(m => (typeof m.content === 'string' ? m : { ...m, content: m.content.map(b => (b.type === 'tool_use' ? { type: 'tool_use' as const, id: b.id, name: b.name, input: b.input } : b)) }));
  const body = { model: opts.model, max_tokens: opts.maxTokens ?? 2048, system: opts.system, tools: opts.tools, messages };
  return (opts.transport || httpTransport)(body, opts.apiKey);
}
