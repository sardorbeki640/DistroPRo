import { callClaude, type ClaudeBlock, type ClaudeMessage, type ClaudeResponse, type ClaudeTool } from './claude.ts';

/**
 * One interface for every AI service. Conversations are stored in Claude's block format (text / tool_use / tool_result)
 * and translated to OpenAI-style chat (OpenAI, DeepSeek, Groq, OpenRouter, Mistral, Ollama, …) or Gemini on the way out.
 */
export type LlmProvider = 'anthropic' | 'openai' | 'gemini' | 'openai_compatible';

export const PROVIDERS: { id: LlmProvider; name: string; default_model: string; base_url?: string; key_hint: string }[] = [
  { id: 'anthropic', name: 'Anthropic Claude (tavsiya)', default_model: 'claude-opus-5', key_hint: 'sk-ant-…' },
  { id: 'openai', name: 'OpenAI (ChatGPT API)', default_model: '', base_url: 'https://api.openai.com/v1', key_hint: 'sk-…' },
  { id: 'openai_compatible', name: 'Boshqa (OpenAI formatidagi: DeepSeek, Groq, OpenRouter, Mistral, Ollama…)', default_model: '', key_hint: 'xizmat kaliti (Ollama uchun bo‘sh)' }
];

export interface LlmConfig { provider: LlmProvider; model: string; apiKey: string; baseUrl?: string | null }
// json: ask for a JSON-only answer where the service supports it (Gemini, OpenAI), so long answers are not malformed.
export type LlmTransport = (config: LlmConfig, request: { system: string; messages: ClaudeMessage[]; tools: ClaudeTool[]; maxTokens: number; json?: boolean }) => Promise<ClaudeResponse>;

const blocks = (m: ClaudeMessage): ClaudeBlock[] => (typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content);

/** Replaced in tests (no waiting between retries). */
export const llmRetry = { delays: [4000, 12000] };

async function postJson(url: string, headers: Record<string, string>, body: unknown, service: string): Promise<any> {
  // A busy service (5xx, 429 "overloaded") often answers a few seconds later: try again before giving up.
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(120_000) });
    } catch (e: any) {
      throw new Error(`${service} bilan aloqa yo‘q (${e?.name === 'TimeoutError' ? 'javob kechikdi' : 'internet yoki manzil'}).`);
    }
    const data: any = await res.json().catch(() => null);
    if (res.ok) return data;
    const detail = String(data?.error?.message || data?.message || '').slice(0, 200);
    const retryable = res.status >= 500 || res.status === 429;
    if (retryable && attempt < llmRetry.delays.length) {
      await new Promise(r => setTimeout(r, llmRetry.delays[attempt]));
      continue;
    }
    if (res.status === 401 || res.status === 403) throw new Error(`${service}: kalit qabul qilinmadi yoki ruxsat yo‘q. ${detail}`.trim());
    if (res.status === 404) throw new Error(`${service}: model yoki manzil topilmadi — model nomini tekshiring. ${detail}`.trim());
    if (res.status === 429) throw new Error(`${service}: limit yoki balans tugagan (429). ${detail}`.trim());
    if (res.status >= 500) throw new Error(`${service} serveri hozir javob bermayapti (${res.status}${detail ? `: ${detail}` : ''}). Birozdan keyin urining.`);
    throw new Error(`${service} xatosi (${res.status}). ${detail}`.trim());
  }
}

// ---------- OpenAI-style chat completions (also every compatible service) ----------
async function openAiChat(c: LlmConfig, r: { system: string; messages: ClaudeMessage[]; tools: ClaudeTool[]; maxTokens: number; json?: boolean }): Promise<ClaudeResponse> {
  const base = (c.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const messages: any[] = [{ role: 'system', content: r.system }];
  for (const m of r.messages) {
    const bs = blocks(m);
    if (m.role === 'assistant') {
      const text = bs.filter(b => b.type === 'text').map(b => (b as any).text).join('\n');
      const calls = bs.filter(b => b.type === 'tool_use').map((b: any) => ({ id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) } }));
      messages.push({ role: 'assistant', content: text || null, ...(calls.length ? { tool_calls: calls } : {}) });
    } else {
      for (const b of bs) {
        if (b.type === 'tool_result') messages.push({ role: 'tool', tool_call_id: b.tool_use_id, content: b.content });
        else if (b.type === 'text') messages.push({ role: 'user', content: b.text });
      }
    }
  }
  const body: any = { model: c.model, messages, max_tokens: r.maxTokens };
  if (r.tools.length) body.tools = r.tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } }));
  if (r.json && c.provider === 'openai') body.response_format = { type: 'json_object' };
  const name = c.provider === 'openai' ? 'OpenAI' : 'AI xizmati';
  const data = await postJson(`${base}/chat/completions`, c.apiKey ? { authorization: `Bearer ${c.apiKey}` } : {}, body, name);
  const choice = data?.choices?.[0];
  if (!choice?.message) throw new Error(`${name} javobi bo‘sh.`);
  const content: ClaudeBlock[] = [];
  if (choice.message.content) content.push({ type: 'text', text: String(choice.message.content) });
  for (const call of choice.message.tool_calls || []) {
    let input: any = {};
    try { input = call.function?.arguments ? JSON.parse(call.function.arguments) : {}; } catch { input = {}; }
    content.push({ type: 'tool_use', id: call.id || `call_${Math.random().toString(36).slice(2)}`, name: call.function?.name, input });
  }
  return { content, stop_reason: content.some(b => b.type === 'tool_use') ? 'tool_use' : 'end_turn' };
}

// ---------- Gemini ----------
/** Gemini takes an OpenAPI subset: no additionalProperties. */
function geminiSchema(schema: any): any {
  if (Array.isArray(schema)) return schema.map(geminiSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const out: any = {};
  for (const [k, v] of Object.entries(schema)) if (k !== 'additionalProperties') out[k] = geminiSchema(v);
  if (out.type === 'object' && out.properties && !Object.keys(out.properties).length) delete out.properties;
  return out;
}

async function geminiChat(c: LlmConfig, r: { system: string; messages: ClaudeMessage[]; tools: ClaudeTool[]; maxTokens: number; json?: boolean }): Promise<ClaudeResponse> {
  const names = new Map<string, string>();
  const contents: any[] = [];
  for (const m of r.messages) {
    const parts: any[] = [];
    for (const b of blocks(m)) {
      if (b.type === 'text' && b.text) parts.push({ text: b.text });
      // Newer Gemini models require the thought signature of a function call to come back with it.
      if (b.type === 'tool_use') { names.set(b.id, b.name); parts.push({ functionCall: { name: b.name, args: b.input ?? {} }, ...(b.thought_signature ? { thoughtSignature: b.thought_signature } : {}) }); }
      if (b.type === 'tool_result') parts.push({ functionResponse: { name: names.get(b.tool_use_id) || 'tool', response: { content: b.content } } });
    }
    if (parts.length) contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts });
  }
  const body: any = { systemInstruction: { parts: [{ text: r.system }] }, contents, generationConfig: { maxOutputTokens: r.maxTokens, ...(r.json && !r.tools.length ? { responseMimeType: 'application/json' } : {}) } };
  if (r.tools.length) body.tools = [{ functionDeclarations: r.tools.map(t => ({ name: t.name, description: t.description, parameters: geminiSchema(t.input_schema) })) }];
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(c.model)}:generateContent`;
  const data = await postJson(url, { 'x-goog-api-key': c.apiKey }, body, 'Gemini');
  const parts = data?.candidates?.[0]?.content?.parts || [];
  if (!parts.length) throw new Error(`Gemini javob bermadi${data?.promptFeedback?.blockReason ? ` (${data.promptFeedback.blockReason})` : ''}.`);
  const content: ClaudeBlock[] = [];
  parts.forEach((p: any, i: number) => {
    if (p.text) content.push({ type: 'text', text: p.text });
    if (p.functionCall) content.push({ type: 'tool_use', id: `gm_${Date.now().toString(36)}_${i}`, name: p.functionCall.name, input: p.functionCall.args || {}, ...(p.thoughtSignature ? { thought_signature: p.thoughtSignature } : {}) });
  });
  return { content, stop_reason: content.some(b => b.type === 'tool_use') ? 'tool_use' : 'end_turn' };
}

export const httpLlmTransport: LlmTransport = async (c, r) => {
  // Claude thinks before answering and thinking counts toward max_tokens: leave room so the answer is not cut off.
  if (c.provider === 'anthropic') return callClaude({ apiKey: c.apiKey, model: c.model, system: r.system, messages: r.messages, tools: r.tools, maxTokens: Math.max(r.maxTokens, 16000) });
  if (c.provider === 'gemini') return geminiChat(c, r);
  return openAiChat(c, r);
};

/** Models the account can use, straight from the service (names change over time; nothing hard-coded). */
export async function listModels(c: Omit<LlmConfig, 'model'>): Promise<string[]> {
  const get = async (url: string, headers: Record<string, string>, service: string) => {
    let res: Response;
    try { res = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) }); } catch { throw new Error(`${service} bilan aloqa yo‘q.`); }
    const data: any = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`${service}: ${data?.error?.message || `xato ${res.status}`}`);
    return data;
  };
  if (c.provider === 'anthropic') {
    const d = await get('https://api.anthropic.com/v1/models?limit=100', { 'x-api-key': c.apiKey, 'anthropic-version': '2023-06-01' }, 'Claude');
    return (d.data || []).map((m: any) => String(m.id));
  }
  if (c.provider === 'gemini') {
    const d = await get('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { 'x-goog-api-key': c.apiKey }, 'Gemini');
    return (d.models || []).filter((m: any) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m: any) => String(m.name).replace(/^models\//, '')).filter((n: string) => /gemini/i.test(n));
  }
  const base = (c.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const d = await get(`${base}/models`, c.apiKey ? { authorization: `Bearer ${c.apiKey}` } : {}, c.provider === 'openai' ? 'OpenAI' : 'AI xizmati');
  return (d.data || d.models || []).map((m: any) => String(m.id || m.name)).filter(Boolean);
}

export async function callLlm(config: LlmConfig, request: { system: string; messages: ClaudeMessage[]; tools: ClaudeTool[]; maxTokens?: number; json?: boolean }, transport?: LlmTransport): Promise<ClaudeResponse> {
  return (transport || httpLlmTransport)(config, { ...request, maxTokens: request.maxTokens ?? 2500 });
}
