import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Bot, Brain, Clock, Info, ListChecks, Mic, MessageSquarePlus, Radio, Send, Settings, ShieldAlert, Square, Trash2, Volume2, VolumeX, Wrench } from 'lucide-react';
import { api, type JarvisConversationView, type JarvisInsight, type JarvisSettingsView } from '../../services/api.ts';
import type { NavView } from '../../types.ts';
import { ArcReactor, type JarvisState } from '../jarvis/ArcReactor.tsx';
import { JarvisSettingsPanel } from '../jarvis/JarvisSettingsPanel.tsx';
import { browserRecognize, browserSpeak, chime, playMp3, startRecording, startWakeListener, stopSpeaking, type SpeechLang } from '../../utils/voice.ts';

/** One-tap commands an owner gives most often. */
const QUICK: [string, string][] = [
  ['Brifing', 'Ertalabki brifingni tayyorla: kechagi va oy boshidan savdo, bugungi kassa, eng xavfli qarzlar, xaridni to‘xtatgan mijozlar, tugab qolayotgan tovarlar. Oxirida bugun nima qilish kerakligini 5 ta aniq band qilib yoz.'],
  ['Savdo tahlili', 'Shu oyni o‘tgan oyning shu kunlari bilan solishtir. Savdo nima sababdan o‘zgarganini agentlar, mahsulotlar va mijozlar kesimida tushuntir va nima qilishni tavsiya qil.'],
  ['Qarz rejasi', '60 kundan eski qarzlarni ko‘rib chiq. Kimdan birinchi navbatda qancha undirish kerak, qaysi agent mas’ul — aniq reja tuz.'],
  ['Yo‘qolgan mijozlar', 'Avval muntazam olib, 21 kundan beri xarid qilmagan mijozlarni top va kimga qo‘ng‘iroq qilish kerakligini ayt.'],
  ['Agentlar', 'Shu oy agentlar natijasini solishtir: kim yaxshi, kim yomon, nima qilish kerak?'],
  ['Ombor', 'Qaysi tovarlar tez tugaydi va qaysilari ortiqcha? Buyurtma miqdorlari bilan ayt.'],
  ['Xarajatlar', 'Shu oy xarajatlarini o‘tgan oy bilan solishtir. Qaysi toifa oshgan va qayerda tejash mumkin?'],
  ['Bugungi kassa', 'Bugungi kassa kuni holatini ayt: tushum, nasiya, xarajat, qoldiq va qarzga qolgan eng katta buyurtmalar.']
];

const STATE_TEXT: Record<JarvisState, string> = {
  idle: 'Tayyor', wake: '“Jarvis” deb chaqiring', listening: 'Tinglayapman…', thinking: 'Tahlil qilyapman…', speaking: 'Gapiryapman…', offline: 'Sozlanmagan'
};

const LEVEL_STYLE: Record<JarvisInsight['level'], { cls: string; Icon: any }> = {
  critical: { cls: 'border-red-500/50 bg-red-500/10 text-red-100', Icon: ShieldAlert },
  warning: { cls: 'border-amber-400/50 bg-amber-400/10 text-amber-50', Icon: AlertTriangle },
  info: { cls: 'border-cyan-500/30 bg-cyan-500/5 text-cyan-50', Icon: Info }
};

function Formatted({ text }: { text: string }) {
  return (
    <div className="space-y-1.5">
      {text.split(/\n{2,}/).map((block, i) => (
        <p key={i} className="whitespace-pre-wrap leading-relaxed">
          {block.split(/(\*\*[^*]+\*\*)/g).map((part, j) => part.startsWith('**') && part.endsWith('**') ? <strong key={j} className="text-cyan-200">{part.slice(2, -2)}</strong> : <React.Fragment key={j}>{part.replace(/^#{1,4}\s*/gm, '')}</React.Fragment>)}
        </p>
      ))}
    </div>
  );
}

const pref = (k: string, d: string) => { try { return localStorage.getItem(k) || d; } catch { return d; } };
const setPref = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

export const JarvisView: React.FC<{ onNavigate?: (view: NavView) => void }> = ({ onNavigate }) => {
  const [tab, setTab] = useState<'hud' | 'log' | 'settings'>('hud');
  const [settings, setSettings] = useState<JarvisSettingsView | null>(null);
  const [conversations, setConversations] = useState<{ id: string; title: string; updated_at: string }[]>([]);
  const [current, setCurrent] = useState<JarvisConversationView | null>(null);
  const [insights, setInsights] = useState<JarvisInsight[]>([]);
  const [actions, setActions] = useState<any[]>([]);
  const [text, setText] = useState('');
  const [state, setState] = useState<JarvisState>('idle');
  const [level, setLevel] = useState(0);
  const [heard, setHeard] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [lang, setLang] = useState<SpeechLang>(pref('jarvis.lang', 'uz') as SpeechLang);
  const [voiceOn, setVoiceOn] = useState(pref('jarvis.speak', '1') === '1');
  const [wakeOn, setWakeOn] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [clock, setClock] = useState(new Date());
  const stopListening = useRef<null | (() => void)>(null);
  const wake = useRef<{ stop: () => void } | null>(null);
  const busyRef = useRef(false);
  const currentRef = useRef<JarvisConversationView | null>(null);
  const feedEnd = useRef<HTMLDivElement>(null);
  currentRef.current = current;

  const configured = !!settings?.configured;
  const loadList = () => api.jarvis.conversations().then(r => setConversations(r.conversations)).catch(() => {});
  const loadInsights = (fresh = false) => api.jarvis.insights(fresh).then(r => setInsights(r.insights)).catch(() => {});

  useEffect(() => {
    api.jarvis.settings().then(r => { setSettings(r.settings); if (!r.settings.configured) { setTab('settings'); setState('offline'); } }).catch(e => setError(e.message));
    loadList(); loadInsights();
    const t = setInterval(() => setClock(new Date()), 1000);
    const i = setInterval(() => loadInsights(), 5 * 60_000);
    return () => { clearInterval(t); clearInterval(i); stopSpeaking(); stopListening.current?.(); wake.current?.stop(); };
  }, []);
  useEffect(() => { feedEnd.current?.scrollIntoView({ behavior: 'smooth' }); }, [current, state]);
  useEffect(() => { if (tab === 'log') api.jarvis.actions().then(r => setActions(r.actions)).catch(e => setError(e.message)); }, [tab]);

  // The morning briefing (made at 08:00) opens by itself when it is today's.
  useEffect(() => {
    const today = new Date().toLocaleDateString('ru-RU', { timeZone: 'Asia/Tashkent' });
    const brief = conversations.find(c => c.title.startsWith('Ertalabki brifing') && c.title.endsWith(today.replace(/\//g, '.')));
    if (brief && !current) api.jarvis.conversation(brief.id).then(r => setCurrent(r.conversation)).catch(() => {});
  }, [conversations]);

  const idleState = (): JarvisState => (!configured ? 'offline' : wake.current ? 'wake' : 'idle');

  const say = useCallback(async (answer: string) => {
    if (!voiceOn) return;
    setState('speaking');
    try {
      if (!settings || settings.voice.provider === 'browser') {
        const pulse = setInterval(() => setLevel(0.3 + Math.random() * 0.5), 120);
        await browserSpeak(answer).finally(() => { clearInterval(pulse); setLevel(0); });
      } else {
        await playMp3(await api.jarvis.speak(answer), setLevel);
      }
    } catch (e: any) { setError(`Ovoz: ${e.message}`); }
    setState(idleState());
  }, [voiceOn, settings, configured]);

  const ask = useCallback(async (question: string) => {
    if (!question.trim() || busyRef.current || !configured) return;
    busyRef.current = true;
    stopSpeaking();
    setError(null); setHeard(''); setText('');
    setState('thinking');
    const base = currentRef.current;
    setCurrent({ id: base?.id || '', title: base?.title || question.slice(0, 60), items: [...(base?.items || []), { role: 'user', text: question }] });
    try {
      const r = await api.jarvis.ask(question, base?.id || null);
      setCurrent(r.conversation);
      loadList();
      const last = [...r.conversation.items].reverse().find(i => i.role === 'assistant');
      const nav = r.conversation.client_actions?.find(a => a.type === 'navigate');
      if (last) await say(last.text);
      if (nav && onNavigate) onNavigate(nav.page as NavView);
    } catch (e: any) {
      setError(e.message);
      setCurrent(base);
      setText(question);
    } finally {
      busyRef.current = false;
      setState(idleState());
    }
  }, [configured, say, onNavigate]);

  /** Push-to-talk: speak, then the recognised text is asked. */
  const toggleMic = async () => {
    if (state === 'listening') { stopListening.current?.(); return; }
    if (!configured || busyRef.current) return;
    setError(null); stopSpeaking(); chime();
    const wasWake = !!wake.current;
    wake.current?.stop(); wake.current = null;
    setState('listening');
    try {
      let spoken = '';
      if (!settings || settings.voice.provider === 'browser') {
        const rec = browserRecognize(lang);
        stopListening.current = rec.stop;
        spoken = await rec.result;
      } else {
        const rec = await startRecording();
        const done = new Promise<string>((res, rej) => { stopListening.current = () => rec.stop().then(res, rej); });
        const timer = setTimeout(() => stopListening.current?.(), 60_000);
        const audio = await done.finally(() => clearTimeout(timer));
        setState('thinking');
        spoken = (await api.jarvis.transcribe(audio, lang)).text;
      }
      stopListening.current = null;
      if (spoken) { setHeard(spoken); await ask(spoken); } else { setError('Gap eshitilmadi. Qayta urinib ko‘ring.'); setState(idleState()); }
    } catch (e: any) { setError(e.message); setState(idleState()); }
    finally { stopListening.current = null; if (wasWake) startWake(); }
  };

  /** Wake word: "Jarvis, …" any time while this page is open (Chrome/Edge). */
  const startWake = () => {
    wake.current?.stop();
    wake.current = startWakeListener(lang, {
      onArmed: armed => setState(armed ? 'listening' : busyRef.current ? 'thinking' : 'wake'),
      onHeard: t => { if (!busyRef.current) setHeard(t); },
      onCommand: t => { if (t) { chime(); ask(t); } },
      onError: m => { setError(m); setWakeOn(false); wake.current = null; setState(idleState()); }
    });
    setState('wake');
  };
  const toggleWake = () => {
    if (wakeOn) { wake.current?.stop(); wake.current = null; setWakeOn(false); setState(idleState()); }
    else { setWakeOn(true); startWake(); }
  };

  // Ctrl+J: talk.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'j') { e.preventDefault(); toggleMic(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const open = async (id: string) => {
    try { setCurrent((await api.jarvis.conversation(id)).conversation); setShowHistory(false); } catch (e: any) { setError(e.message); }
  };
  const remove = async (id: string) => {
    if (!window.confirm('Bu suhbat o‘chirilsinmi?')) return;
    await api.jarvis.deleteConversation(id).catch(e => setError(e.message));
    if (current?.id === id) setCurrent(null);
    loadList();
  };

  const tabBtn = (id: typeof tab, label: string, Icon: any) => (
    <button onClick={() => setTab(id)} className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider transition ${tab === id ? 'bg-cyan-400 text-slate-950' : 'text-cyan-200/80 hover:bg-cyan-400/10'}`}><Icon className="h-3.5 w-3.5" />{label}</button>
  );
  const tashkent = clock.toLocaleTimeString('ru-RU', { timeZone: 'Asia/Tashkent', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const lastAnswer = current ? [...current.items].reverse().find(i => i.role === 'assistant') : null;

  return (
    <div className="relative min-h-[calc(100vh-4rem)] overflow-hidden bg-[#03060d] p-4 text-cyan-50 md:p-6"
      style={{ backgroundImage: 'linear-gradient(rgba(34,211,238,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(34,211,238,0.06) 1px, transparent 1px)', backgroundSize: '40px 40px' }}>
      <div className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(ellipse at 50% 35%, rgba(14,116,144,0.25), transparent 60%)' }} />

      {/* Top bar */}
      <div className="relative flex flex-wrap items-center justify-between gap-3 border-b border-cyan-500/20 pb-3">
        <div className="flex items-center gap-3">
          <Bot className="h-6 w-6 text-cyan-300" />
          <div>
            <h1 className="font-mono text-lg font-black tracking-[0.35em] text-cyan-200">J.A.R.V.I.S.</h1>
            <p className="font-mono text-[10px] uppercase tracking-widest text-cyan-400/70">
              {settings ? `${settings.providers.find(p => p.id === settings.provider)?.name || settings.provider} · ${settings.model || '—'}` : 'yuklanmoqda'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <span className="hidden items-center gap-1.5 font-mono text-sm text-cyan-200 sm:flex"><Clock className="h-4 w-4 text-cyan-400" />{tashkent}</span>
          <div className="flex gap-1 rounded-lg border border-cyan-500/20 bg-slate-950/50 p-1">{tabBtn('hud', 'Markaz', Radio)}{tabBtn('log', 'Jurnal', ListChecks)}{tabBtn('settings', 'Sozlamalar', Settings)}</div>
        </div>
      </div>

      {error && <div className="relative mt-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">{error}</div>}

      {tab === 'settings' && settings && (
        <div className="relative mt-4"><JarvisSettingsPanel settings={settings} onSaved={s => { setSettings(s); setState(s.configured ? 'idle' : 'offline'); if (s.configured) setTab('hud'); }} /></div>
      )}

      {tab === 'log' && (
        <div className="relative mt-4 overflow-x-auto rounded-2xl border border-cyan-500/20 bg-slate-900/60">
          <table className="min-w-full text-xs">
            <thead className="text-left text-cyan-400/80"><tr><th className="px-3 py-2">Vaqt</th><th className="px-3 py-2">Kim</th><th className="px-3 py-2">Amal</th><th className="px-3 py-2">Turi</th><th className="px-3 py-2">Holat</th></tr></thead>
            <tbody className="divide-y divide-cyan-500/10">
              {actions.map(a => (
                <tr key={a.id}>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-slate-400">{new Date(a.created_at).toLocaleString('ru-RU')}</td>
                  <td className="px-3 py-2">{a.user}</td>
                  <td className="px-3 py-2">{a.summary}{a.error && <div className="text-red-400">{a.error}</div>}</td>
                  <td className="px-3 py-2">{a.risk === 'write' ? 'O‘zgartirish' : 'O‘qish'}</td>
                  <td className={`px-3 py-2 font-bold ${a.status === 'DONE' ? 'text-emerald-400' : 'text-red-400'}`}>{a.status === 'DONE' ? 'Bajarildi' : 'Xato'}</td>
                </tr>
              ))}
              {!actions.length && <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-500">Hali amal yo‘q</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'hud' && (
        <div className="relative mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[300px_1fr_380px]">
          {/* Left: what needs attention */}
          <aside className="space-y-2 xl:max-h-[calc(100vh-12rem)] xl:overflow-y-auto">
            <div className="flex items-center justify-between"><h2 className="font-mono text-[11px] font-bold uppercase tracking-widest text-cyan-400">Diqqat talab qiladi</h2><button onClick={() => loadInsights(true)} className="font-mono text-[10px] text-cyan-500 hover:text-cyan-300">yangilash</button></div>
            {insights.map(i => {
              const { cls, Icon } = LEVEL_STYLE[i.level];
              return (
                <div key={i.id} className={`rounded-xl border p-3 ${cls}`}>
                  <div className="flex items-start gap-2"><Icon className="mt-0.5 h-4 w-4 shrink-0" /><div className="min-w-0"><p className="text-xs font-bold">{i.title}</p><p className="mt-0.5 text-[11px] opacity-80">{i.detail}</p></div></div>
                  <div className="mt-2 flex gap-2 pl-6">
                    <button disabled={!configured || state === 'thinking'} onClick={() => ask(`Shu masalani tahlil qil va nima qilish kerakligini aniq ayt: ${i.title}. ${i.detail}`)} className="rounded-md bg-white/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider hover:bg-white/20 disabled:opacity-40">Tahlil</button>
                    {i.page && onNavigate && <button onClick={() => onNavigate(i.page as NavView)} className="rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider opacity-80 hover:bg-white/10">Ochish</button>}
                  </div>
                </div>
              );
            })}
            {!insights.length && <p className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs text-emerald-200">Hammasi joyida — diqqat talab qiladigan narsa yo‘q.</p>}
          </aside>

          {/* Center: the reactor */}
          <section className="flex flex-col items-center">
            <ArcReactor state={state} level={level} size={280} onClick={toggleMic} />
            <p className="mt-3 font-mono text-sm font-bold uppercase tracking-[0.3em] text-cyan-200">{STATE_TEXT[state]}</p>
            <p className="mt-1 min-h-[1.25rem] max-w-xl text-center text-sm italic text-cyan-100/70">{heard}</p>

            <div className="mt-4 flex items-center gap-2">
              <button onClick={toggleMic} disabled={!configured || state === 'thinking'} title="Gapirish (Ctrl+J)"
                className={`flex h-14 w-14 items-center justify-center rounded-full border-2 transition ${state === 'listening' ? 'border-red-400 bg-red-500/30 text-red-100' : 'border-cyan-400/60 bg-cyan-400/10 text-cyan-100 hover:bg-cyan-400/20'} disabled:opacity-40`}>
                {state === 'listening' ? <Square className="h-5 w-5" /> : <Mic className="h-6 w-6" />}
              </button>
              <button onClick={toggleWake} disabled={!configured} title="“Jarvis” deb chaqirish rejimi"
                className={`rounded-full border px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-wider ${wakeOn ? 'border-cyan-300 bg-cyan-400 text-slate-950' : 'border-cyan-500/40 text-cyan-200 hover:bg-cyan-400/10'} disabled:opacity-40`}>
                {wakeOn ? 'Uyg‘otish: yoqilgan' : '“Jarvis” rejimi'}
              </button>
              <button onClick={() => { const v = !voiceOn; setVoiceOn(v); setPref('jarvis.speak', v ? '1' : '0'); if (!v) stopSpeaking(); }} title="Javobni ovoz bilan aytish"
                className="flex h-9 w-9 items-center justify-center rounded-full border border-cyan-500/40 text-cyan-200 hover:bg-cyan-400/10">{voiceOn ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}</button>
              {(['uz', 'ru'] as const).map(l => (
                <button key={l} onClick={() => { setLang(l); setPref('jarvis.lang', l); if (wakeOn) setTimeout(startWake, 50); }}
                  className={`rounded-md px-2 py-1 font-mono text-[10px] font-bold ${lang === l ? 'bg-cyan-400 text-slate-950' : 'text-cyan-300 hover:bg-cyan-400/10'}`}>{l === 'uz' ? 'UZ' : 'RU'}</button>
              ))}
            </div>

            <form onSubmit={e => { e.preventDefault(); ask(text); }} className="mt-4 flex w-full max-w-2xl items-center gap-2">
              <input value={text} onChange={e => setText(e.target.value)} disabled={!configured} maxLength={4000}
                placeholder={configured ? 'Buyruq yozing yoki mikrofonni bosing…' : 'Avval Sozlamalarda AI xizmati va kalitini kiriting'}
                className="flex-1 rounded-xl border border-cyan-500/40 bg-slate-950/70 px-4 py-3 text-sm text-cyan-50 placeholder:text-slate-500 focus:border-cyan-300 focus:outline-hidden" />
              <button type="submit" disabled={!configured || !text.trim() || state === 'thinking'} className="flex h-12 w-12 items-center justify-center rounded-xl bg-cyan-400 text-slate-950 hover:bg-cyan-300 disabled:opacity-40"><Send className="h-5 w-5" /></button>
            </form>

            <div className="mt-3 flex max-w-2xl flex-wrap justify-center gap-1.5">
              {QUICK.map(([label, q]) => <button key={label} disabled={!configured || state === 'thinking'} onClick={() => ask(q)} className="rounded-full border border-cyan-500/30 bg-cyan-500/5 px-3 py-1 text-[11px] font-semibold text-cyan-100 hover:border-cyan-300 hover:bg-cyan-400/10 disabled:opacity-40">{label}</button>)}
            </div>
            {lastAnswer && state !== 'thinking' && (
              <div className="mt-5 w-full max-w-2xl rounded-2xl border border-cyan-500/25 bg-slate-950/60 p-4 text-sm text-cyan-50 shadow-[0_0_30px_rgba(34,211,238,0.08)]">
                <Formatted text={lastAnswer.text} />
              </div>
            )}
          </section>

          {/* Right: conversation */}
          <aside className="flex flex-col rounded-2xl border border-cyan-500/20 bg-slate-950/50 xl:max-h-[calc(100vh-12rem)]">
            <div className="flex items-center justify-between border-b border-cyan-500/15 px-3 py-2">
              <span className="truncate font-mono text-[11px] font-bold uppercase tracking-widest text-cyan-400">{showHistory ? 'Suhbatlar' : current?.title || 'Yangi suhbat'}</span>
              <div className="flex gap-1">
                <button onClick={() => { setCurrent(null); setShowHistory(false); stopSpeaking(); }} title="Yangi suhbat" className="rounded p-1 text-cyan-300 hover:bg-cyan-400/10"><MessageSquarePlus className="h-4 w-4" /></button>
                <button onClick={() => setShowHistory(v => !v)} title="Suhbatlar tarixi" className={`rounded p-1 hover:bg-cyan-400/10 ${showHistory ? 'text-cyan-100' : 'text-cyan-300'}`}><Brain className="h-4 w-4" /></button>
              </div>
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto p-3 text-xs">
              {showHistory ? conversations.map(c => (
                <div key={c.id} className={`group flex items-center gap-1 rounded-lg px-2 py-1.5 ${current?.id === c.id ? 'bg-cyan-400/15' : 'hover:bg-cyan-400/5'}`}>
                  <button onClick={() => open(c.id)} className="flex-1 truncate text-left text-cyan-100" title={c.title}>{c.title}</button>
                  <button onClick={() => remove(c.id)} className="text-slate-500 opacity-0 hover:text-red-400 group-hover:opacity-100"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              )) : (current?.items || []).map((it, i) => it.role === 'tool' ? (
                <div key={i} className="flex items-center gap-1.5 font-mono text-[10px] text-cyan-500/80"><Wrench className="h-3 w-3" />{it.text}{it.status === 'FAILED' && <span className="text-red-400"> · xato</span>}</div>
              ) : (
                <div key={i} className={it.role === 'user' ? 'ml-6 rounded-xl bg-cyan-400/15 px-3 py-2 text-cyan-50' : 'mr-2 rounded-xl border border-cyan-500/15 bg-slate-900/70 px-3 py-2 text-cyan-50'}>
                  {it.role === 'user' ? <p className="whitespace-pre-wrap">{it.text}</p> : <Formatted text={it.text} />}
                  {it.role === 'assistant' && <button onClick={() => say(it.text)} className="mt-1 text-cyan-500 hover:text-cyan-300" title="Ovoz bilan"><Volume2 className="h-3.5 w-3.5" /></button>}
                </div>
              ))}
              {!showHistory && !current?.items.length && <p className="text-slate-500">Savol bering — javob va Jarvis ko‘rib chiqqan ma’lumotlar shu yerda chiqadi.</p>}
              {state === 'thinking' && <p className="animate-pulse font-mono text-[11px] text-amber-300">Ma’lumotlar o‘qilmoqda…</p>}
              <div ref={feedEnd} />
            </div>
          </aside>
        </div>
      )}
    </div>
  );
};
