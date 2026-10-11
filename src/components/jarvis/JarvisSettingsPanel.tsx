import React, { useEffect, useState } from 'react';
import { Brain, KeyRound, Sunrise, Trash2, Volume2 } from 'lucide-react';
import { api, type JarvisSettingsView } from '../../services/api.ts';
import { SecretInput } from '../common/SecretInput.tsx';
import { ObsidianPanel } from './ObsidianPanel.tsx';
import { browserSpeak, playMp3 } from '../../utils/voice.ts';

const KEY_LINKS: Record<string, string> = {
  anthropic: 'console.anthropic.com → Settings → API Keys → “Create Key” (sk-ant-api… bilan boshlanadi; hisobda balans bo‘lishi kerak)',
  openai: 'platform.openai.com → API keys',
  openai_compatible: 'xizmat kabineti (DeepSeek: platform.deepseek.com, Groq: console.groq.com, OpenRouter: openrouter.ai/keys). Ollama uchun kalit kerak emas, manzil http://localhost:11434/v1'
};

const box = 'space-y-3 rounded-2xl border border-cyan-500/20 bg-slate-900/60 p-5';
const input = 'mt-1 block w-full rounded-lg border border-cyan-500/30 bg-slate-950/70 px-3 py-2 text-xs text-cyan-50 placeholder:text-slate-500 focus:border-cyan-400 focus:outline-hidden';
const label = 'block text-xs font-semibold text-cyan-100/80';

/** AI service, voice, morning briefing and memory of Jarvis. */
export const JarvisSettingsPanel: React.FC<{ settings: JarvisSettingsView; onSaved: (s: JarvisSettingsView) => void }> = ({ settings, onSaved }) => {
  const fill = (s: JarvisSettingsView) => ({ provider: s.provider, model: s.model, base_url: s.base_url, api_key: '', voice_provider: s.voice.provider, voice_key: '', voice_region: s.voice.region, voice_gender: s.voice.gender, auto_briefing: s.auto_briefing });
  const [form, setForm] = useState(fill(settings));
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [memories, setMemories] = useState<{ id: string; text: string; created_at: string }[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const loadModels = async () => {
    setLoadingModels(true); setError(null);
    try { const r = await api.jarvis.models(); setModels(r.models); if (!r.models.length) setError('Bu kalit bilan model topilmadi.'); }
    catch (e: any) { setError(e.message); } finally { setLoadingModels(false); }
  };

  useEffect(() => { api.jarvis.memories().then(r => setMemories(r.memories)).catch(() => {}); }, []);

  const save = async () => {
    setMsg(null); setError(null);
    try {
      if (form.provider !== settings.provider) await api.jarvis.saveSettings({ provider: form.provider });
      const r = await api.jarvis.saveSettings({
        ...(form.api_key.trim() ? { api_key: form.api_key.trim() } : {}),
        ...(form.model.trim() ? { model: form.model.trim() } : {}),
        ...(form.provider === 'openai' || form.provider === 'openai_compatible' ? { base_url: form.base_url } : {}),
        voice_provider: form.voice_provider, voice_gender: form.voice_gender, auto_briefing: form.auto_briefing,
        ...(form.voice_provider === 'azure' ? { voice_region: form.voice_region } : {}),
        ...(form.voice_key.trim() ? { voice_key: form.voice_key.trim() } : {})
      });
      onSaved(r.settings); setForm(fill(r.settings));
      setMsg(r.settings.configured ? 'Saqlandi. Jarvis tayyor.' : 'Saqlandi. API kalitini ham kiriting.');
    } catch (e: any) { setError(e.message); }
  };

  const testVoice = async () => {
    setError(null);
    const text = 'Assalomu alaykum! Men Jarvisman. Barcha tizimlar ishlamoqda.';
    try { if (form.voice_provider === 'browser') await browserSpeak(text); else await playMp3(await api.jarvis.speak(text)); } catch (e: any) { setError(e.message); }
  };

  const forget = async (id: string) => {
    await api.jarvis.deleteMemory(id).catch(e => setError(e.message));
    setMemories(m => m.filter(x => x.id !== id));
  };

  const providerInfo = settings.providers.find(p => p.id === form.provider);
  const same = settings.provider === form.provider;
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div className={box}>
        <div className="flex items-center gap-2 text-sm font-bold text-cyan-200"><KeyRound className="h-4 w-4" />AI xizmati — Jarvis miyasi</div>
        <label className={label}>Xizmat
          <select className={input} value={form.provider} onChange={e => { const p = settings.providers.find(x => x.id === e.target.value)!; setForm(f => ({ ...f, provider: p.id, model: p.id === settings.provider ? settings.model : p.default_model, base_url: p.id === settings.provider ? settings.base_url : p.base_url || '', api_key: '' })); }}>
            {settings.providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label className={label}>Model
          <input className={input} list="jv-models" value={form.model} onChange={e => setForm(f => ({ ...f, model: e.target.value }))} placeholder={form.provider === 'openai' ? 'hisobingizdagi model nomi' : form.provider === 'openai_compatible' ? 'deepseek-chat, llama3.1 …' : ''} />
          <datalist id="jv-models">{(models.length && same ? models : form.provider === 'anthropic' ? settings.claude_models : []).map(m => <option key={m} value={m} />)}</datalist>
        </label>
        {same && settings.has_key && (
          <div className="space-y-1">
            <button type="button" onClick={loadModels} disabled={loadingModels} className="rounded-lg border border-cyan-500/40 px-3 py-1 text-[11px] font-semibold text-cyan-100 hover:bg-cyan-500/10 disabled:opacity-50">{loadingModels ? 'Yuklanmoqda…' : 'Hisobingizdagi modellarni ko‘rish'}</button>
            {!!models.length && (
              <div className="flex max-h-28 flex-wrap gap-1 overflow-y-auto">
                {models.map(m => <button type="button" key={m} onClick={() => setForm(f => ({ ...f, model: m }))} className={`rounded px-2 py-0.5 font-mono text-[10px] ${form.model === m ? 'bg-cyan-400 text-slate-950' : 'bg-slate-950/70 text-cyan-200 hover:bg-cyan-500/20'}`}>{m}</button>)}
              </div>
            )}
          </div>
        )}
        {(form.provider === 'openai' || form.provider === 'openai_compatible') && (
          <label className={label}>Manzil (base URL)<input className={input} value={form.base_url} onChange={e => setForm(f => ({ ...f, base_url: e.target.value }))} placeholder="https://api.deepseek.com/v1" /></label>
        )}
        <label className={label}>API kaliti
          <SecretInput className={`${input} font-mono`} value={form.api_key} onChange={e => setForm(f => ({ ...f, api_key: e.target.value }))} placeholder={same && settings.has_key ? 'Saqlangan — almashtirish uchun yangisini kiriting' : providerInfo?.key_hint} />
        </label>
        <p className="text-[11px] text-slate-400">Kalit: {KEY_LINKS[form.provider]}. Serverda shifrlangan saqlanadi, brauzerga qaytmaydi.</p>
        <p className="text-xs text-slate-300">Holat: {settings.configured ? <b className="text-emerald-400">tayyor ({settings.model})</b> : <b className="text-amber-400">sozlanmagan</b>}</p>
      </div>

      <div className={box}>
        <div className="flex items-center gap-2 text-sm font-bold text-cyan-200"><Volume2 className="h-4 w-4" />Ovoz</div>
        <label className={label}>Ovoz xizmati
          <select className={input} value={form.voice_provider} onChange={e => setForm(f => ({ ...f, voice_provider: e.target.value as any, voice_key: '' }))}>
            <option value="browser">Brauzer (bepul, Chrome/Edge)</option>
            <option value="azure">Microsoft Azure Speech — o‘zbekcha neyron ovoz (tavsiya)</option>
            <option value="openai">OpenAI (Whisper + OpenAI ovozi)</option>
          </select>
        </label>
        {form.voice_provider !== 'browser' && (
          <label className={label}>{form.voice_provider === 'azure' ? 'Azure Speech kaliti (Key 1)' : 'OpenAI API kaliti'}
            <SecretInput className={`${input} font-mono`} value={form.voice_key} onChange={e => setForm(f => ({ ...f, voice_key: e.target.value }))} placeholder={settings.voice.provider === form.voice_provider && settings.voice.configured ? 'Saqlangan' : ''} />
          </label>
        )}
        {form.voice_provider === 'azure' && <label className={label}>Hudud (Region)<input className={input} value={form.voice_region} onChange={e => setForm(f => ({ ...f, voice_region: e.target.value }))} placeholder="westeurope" /></label>}
        <label className={label}>Ovoz turi
          <select className={input} value={form.voice_gender} onChange={e => setForm(f => ({ ...f, voice_gender: e.target.value as any }))}>
            <option value="male">Erkak ovozi{form.voice_provider === 'azure' ? ' (Sardor / Dmitriy)' : ''}</option>
            <option value="female">Ayol ovozi{form.voice_provider === 'azure' ? ' (Madina / Svetlana)' : ''}</option>
          </select>
        </label>
        <button onClick={testVoice} className="rounded-lg border border-cyan-500/40 px-3 py-1.5 text-xs font-semibold text-cyan-100 hover:bg-cyan-500/10">Ovozni sinash</button>
        <p className="text-[11px] text-slate-400">{form.voice_provider === 'azure' ? 'portal.azure.com → “Speech service” yarating → Keys and Endpoint: Key 1 va Region. Oyiga bepul limit bor.' : form.voice_provider === 'openai' ? 'O‘zbekcha talaffuz Azure’dagidek tabiiy bo‘lmasligi mumkin.' : 'Bepul; o‘zbekcha ovoz brauzerda ko‘pincha yo‘q — yaqin ovoz ishlatiladi.'}</p>
      </div>

      <div className={box}>
        <div className="flex items-center gap-2 text-sm font-bold text-cyan-200"><Sunrise className="h-4 w-4" />Ertalabki brifing</div>
        <label className="flex items-center gap-2 text-xs text-cyan-50">
          <input type="checkbox" checked={form.auto_briefing} onChange={e => setForm(f => ({ ...f, auto_briefing: e.target.checked }))} />
          Har kuni soat 08:00 da brifingni o‘zi tayyorlasin
        </label>
        <p className="text-[11px] text-slate-400">Brifing “Suhbatlar”da saqlanadi va Jarvis ochilganda ko‘rsatiladi. Har kuni AI xizmatidan bitta so‘rov sarflanadi. {settings.last_briefing_date ? `Oxirgisi: ${settings.last_briefing_date}.` : ''}</p>
      </div>

      <div className={box}>
        <div className="flex items-center gap-2 text-sm font-bold text-cyan-200"><Brain className="h-4 w-4" />Xotira ({memories.length})</div>
        <p className="text-[11px] text-slate-400">Jarvisga “eslab qol: …” desangiz shu yerga yoziladi va har suhbatda hisobga olinadi. “… ni unut” desangiz o‘chiradi.</p>
        <div className="max-h-48 space-y-1 overflow-y-auto">
          {memories.map(m => (
            <div key={m.id} className="flex items-start gap-2 rounded-lg bg-slate-950/60 px-2.5 py-1.5 text-xs text-cyan-50">
              <span className="flex-1">{m.text}</span>
              <button onClick={() => forget(m.id)} className="text-slate-500 hover:text-red-400" title="O‘chirish"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          ))}
          {!memories.length && <p className="text-[11px] text-slate-500">Hali hech narsa eslab qolinmagan.</p>}
        </div>
      </div>

      <ObsidianPanel />

      <div className="flex items-center gap-3 lg:col-span-2">
        <button onClick={save} className="rounded-lg bg-cyan-500 px-5 py-2 text-xs font-bold text-slate-950 hover:bg-cyan-400">Saqlash</button>
        {msg && <span className="text-xs text-emerald-400">{msg}</span>}
        {error && <span className="text-xs text-red-400">{error}</span>}
      </div>
    </div>
  );
};
