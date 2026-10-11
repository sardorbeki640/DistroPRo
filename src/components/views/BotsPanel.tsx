import React, { useEffect, useState } from 'react';
import { Bot, Plus, RefreshCw, Search, Send, Trash2, X } from 'lucide-react';
import { api, BotView, StaffTelegramPerson } from '../../services/api.ts';
import { SecretInput } from '../common/SecretInput.tsx';

/** Who has linked their Telegram for personal reminders; the owner copies a person's link to send it to them. */
const StaffTelegramList: React.FC<{ onMessage: (m: string) => void; onError: (m: string) => void }> = ({ onMessage, onError }) => {
  const [people, setPeople] = useState<StaffTelegramPerson[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const load = () => api.bots.staff().then(r => setPeople(r.people)).catch(e => onError(e.message));
  useEffect(() => { load(); }, []);
  const keyOf = (p: StaffTelegramPerson) => p.key.employee_id || p.key.user_id || '';
  const act = async (p: StaffTelegramPerson, what: string, fn: () => Promise<any>) => {
    setBusy(`${what}-${keyOf(p)}`);
    try { await fn(); } catch (e: any) { onError(e.message); } finally { setBusy(null); }
  };
  const copyLink = (p: StaffTelegramPerson) => act(p, 'link', async () => {
    const { url } = await api.bots.staffLink(p.key);
    try { await navigator.clipboard.writeText(url); onMessage(`${p.name} uchun havola nusxalandi — unga yuboring (bir marta ishlaydi): ${url}`); }
    catch { onMessage(`${p.name} uchun havola (bir marta ishlaydi): ${url}`); }
  });
  const linked = people.filter(p => p.linked).length;
  return (
    <div className="mt-4 space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold text-neutral-900">Xodimlarning Telegram’i ({linked} / {people.length} ulangan)</h3>
        <button onClick={load} className="rounded-lg p-1 text-neutral-400 hover:bg-neutral-100" title="Yangilash"><RefreshCw className="h-3.5 w-3.5" /></button>
      </div>
      <p className="text-[11px] text-neutral-500">Xodim o‘zi ulaydi: Kabinet → “Telegram eslatmalar” → “Telegram’ni ulash”. Yoki shu yerdan havolani nusxalab unga yuboring — havolani ochib <b>Start</b> bosgach, eslatmalar lichkasiga keladi.</p>
      <div className="max-h-80 overflow-y-auto rounded-xl border border-neutral-200">
        <table className="min-w-full text-xs">
          <tbody className="divide-y divide-neutral-100">
            {people.map(p => (
              <tr key={keyOf(p)}>
                <td className="px-3 py-2"><div className="font-semibold">{p.name}</div><div className="text-[10px] text-neutral-400">{p.position}</div></td>
                <td className="px-2">
                  {p.linked ? <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">Ulangan{p.chat_name ? ` · ${p.chat_name}` : ''}</span>
                    : p.blocked ? <span className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">Botni bloklagan</span>
                    : <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-500">Ulanmagan</span>}
                </td>
                <td className="whitespace-nowrap px-2 text-right">
                  <button onClick={() => copyLink(p)} disabled={!!busy} className="rounded-lg border border-neutral-300 px-2 py-1 font-semibold hover:bg-neutral-50 disabled:opacity-50">{p.linked ? 'Yangi havola' : 'Havolani nusxalash'}</button>
                  {p.linked && <>
                    <button onClick={() => act(p, 'test', async () => onMessage((await api.bots.staffTest(p.key)).message))} disabled={!!busy} className="ml-1 rounded-lg border border-neutral-300 px-2 py-1 font-semibold hover:bg-neutral-50 disabled:opacity-50">Sinov</button>
                    <button onClick={() => { if (confirm(`${p.name} Telegram’i uzilsinmi?`)) act(p, 'unlink', async () => { await api.bots.staffUnlink(p.key); load(); }); }} disabled={!!busy} className="ml-1 rounded-lg p-1 text-neutral-400 hover:bg-red-50 hover:text-red-600" title="Uzish"><Trash2 className="h-3.5 w-3.5" /></button>
                  </>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

type Form = { id?: string; name: string; bot_token: string; chat_id: string; chat_title: string; topic_id: string; events: string[]; is_active: boolean; daily_report_hour: number; personal: boolean; personal_events: string[]; remind_before_min: number; missed_after_min: number; morning_hour: number; checkin_chat_id: string; checkin_chat_title: string };
const empty: Form = { name: '', bot_token: '', chat_id: '', chat_title: '', topic_id: '', events: ['DAILY_REPORT', 'CASH_DAY_CLOSED', 'CASH_CLOSING_DISCREPANCY'], is_active: true, daily_report_hour: 20, personal: false, personal_events: [], remind_before_min: 15, missed_after_min: 30, morning_hour: 8, checkin_chat_id: '', checkin_chat_title: '' };
const input = 'mt-1 w-full rounded-lg border border-neutral-300 px-2.5 py-2 text-xs focus:border-neutral-900 focus:outline-hidden';

/** Telegram bots that get reports and alerts (owner only). */
export const BotsPanel: React.FC = () => {
  const [bots, setBots] = useState<BotView[]>([]);
  const [events, setEvents] = useState<{ type: string; label: string; hint: string }[]>([]);
  const [reminders, setReminders] = useState<{ type: string; label: string; hint: string }[]>([]);
  const [form, setForm] = useState<Form | null>(null);
  const [savedToken, setSavedToken] = useState<string | null>(null);
  const [chats, setChats] = useState<{ id: string; title: string; type: string }[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => api.bots.list().then(r => { setBots(r.bots); setEvents(r.events); setReminders(r.staff_reminders || []); }).catch(e => setError(e.message));
  useEffect(() => { load(); }, []);

  const run = async (key: string, fn: () => Promise<any>) => {
    setBusy(key); setError(null); setMsg(null);
    try { await fn(); } catch (e: any) { setError(e.message); } finally { setBusy(null); }
  };
  const ref = () => ({ id: form?.id, bot_token: form?.bot_token || undefined });

  const openNew = () => { setForm({ ...empty, personal_events: reminders.map(r => r.type) }); setSavedToken(null); setChats(null); setError(null); setMsg(null); };
  const openEdit = (b: BotView) => {
    setForm({ id: b.id, name: b.name, bot_token: '', chat_id: b.chat_id, chat_title: b.chat_title, topic_id: b.topic_id || '', events: b.events, is_active: b.is_active, daily_report_hour: b.daily_report_hour, personal: b.personal, personal_events: b.personal_events, remind_before_min: b.remind_before_min, missed_after_min: b.missed_after_min, morning_hour: b.morning_hour, checkin_chat_id: b.checkin_chat_id || '', checkin_chat_title: b.checkin_chat_title || '' });
    setSavedToken(b.token_masked); setChats(null); setError(null); setMsg(null);
  };

  const findChats = () => run('find', async () => {
    const r = await api.bots.findChats(ref());
    setChats(r.chats);
    if (form && !form.name) setForm({ ...form, name: `@${r.bot.username}` });
    if (!r.chats.length) setMsg(`@${r.bot.username} topildi, lekin unga hali hech kim yozmagan. Telegram’da botga /start yozing yoki uni guruhga qo‘shing, keyin qayta bosing.`);
  });
  const test = () => run('test', async () => { const r = await api.bots.test({ ...ref(), chat_id: form?.chat_id, topic_id: form?.topic_id || undefined }); setMsg(r.message); });
  const save = () => run('save', async () => {
    await api.bots.save({ ...form!, bot_token: form!.bot_token || undefined, topic_id: form!.topic_id || undefined });
    setForm(null); setMsg('Bot saqlandi.'); load();
  });

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-bold text-neutral-900"><Bot className="h-4 w-4" />Telegram botlar</h2>
          <p className="text-xs text-neutral-500">Rahbariyatga: kunlik hisobot, kassa, qarzdorlar, xatolar. Xodimlarga: shaxsiy eslatmalar o‘z lichkasiga.</p>
        </div>
        <button onClick={openNew} className="inline-flex items-center gap-1.5 rounded-lg bg-neutral-900 px-3 py-2 text-xs font-semibold text-white"><Plus className="h-3.5 w-3.5" />Bot ulash</button>
      </div>
      {error && <p className="mt-2 rounded-lg bg-red-50 p-2 text-xs text-red-700">{error}</p>}
      {msg && <p className="mt-2 rounded-lg bg-emerald-50 p-2 text-xs text-emerald-700">{msg}</p>}

      {bots.length === 0 ? <p className="mt-3 text-xs text-neutral-400">Hali bot ulanmagan.</p> : (
        <div className="mt-3 space-y-2">
          {bots.map(b => (
            <div key={b.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-neutral-200 p-3 text-xs">
              <div className="space-y-0.5">
                <div className="font-semibold text-neutral-900">{b.name} {b.bot_username && <span className="font-normal text-neutral-500">@{b.bot_username}</span>} {!b.is_active && <span className="rounded bg-neutral-100 px-1.5 text-[10px] text-neutral-500">o‘chirilgan</span>}</div>
                {b.personal && <div className="font-semibold text-blue-700">👤 Xodimlarga shaxsiy eslatmalar · Telegram’ini ulagan: {b.linked_people}</div>}
                <div className="text-neutral-500">Chat: {b.chat_title || b.chat_id || '—'} · {b.events.length ? b.events.map(e => events.find(x => x.type === e)?.label || e).join(', ') : 'hech narsa tanlanmagan'}{b.events.includes('DAILY_REPORT') ? ` · hisobot soat ${b.daily_report_hour}:00` : ''}</div>
                <div className="text-[11px] text-neutral-400">Yuborilgan: {b.sent}{b.pending ? ` · navbatda: ${b.pending}` : ''}{b.failed ? ` · xato: ${b.failed}` : ''}{b.last_sent_at ? ` · oxirgisi ${new Date(b.last_sent_at).toLocaleString('ru-RU')}` : ''}</div>
                {b.last_error && <div className="text-[11px] text-red-600">Oxirgi xato: {b.last_error}</div>}
              </div>
              <div className="flex gap-1.5">
                <button onClick={() => run(`rep-${b.id}`, async () => { const r = await api.bots.reportNow(b.id); setMsg(r.message); })} disabled={!!busy} className="rounded-lg border border-neutral-300 px-2.5 py-1.5 font-semibold hover:bg-neutral-50 disabled:opacity-50" title="Bugungi hisobotni hozir yuborish">
                  {busy === `rep-${b.id}` ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : 'Hisobot yuborish'}
                </button>
                <button onClick={() => openEdit(b)} className="rounded-lg border border-neutral-300 px-2.5 py-1.5 font-semibold hover:bg-neutral-50">Sozlash</button>
                <button onClick={() => { if (confirm(`"${b.name}" boti uzilsinmi?`)) run(`del-${b.id}`, async () => { await api.bots.remove(b.id); load(); }); }} className="rounded-lg p-1.5 text-neutral-400 hover:bg-red-50 hover:text-red-600" title="Uzish"><Trash2 className="h-4 w-4" /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {bots.some(b => b.personal && b.is_active) && <StaffTelegramList onMessage={setMsg} onError={setError} />}

      {form && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-lg space-y-3 overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold">{form.id ? 'Botni sozlash' : 'Telegram bot ulash'}</h3>
              <button onClick={() => setForm(null)} className="text-neutral-400 hover:text-neutral-600"><X className="h-5 w-5" /></button>
            </div>
            {!form.id && (
              <ol className="list-decimal space-y-0.5 rounded-xl bg-neutral-50 p-3 pl-7 text-[11px] text-neutral-600">
                <li>Telegram’da <b>@BotFather</b> → /newbot → bot nomini bering → u bergan <b>tokenni</b> nusxalang.</li>
                <li>Botingizni oching va <b>/start</b> bosing (yoki botni guruhga qo‘shing).</li>
                <li>Tokenni pastga joylab, <b>“Chatni topish”</b>ni bosing va chatni tanlang.</li>
              </ol>
            )}
            {error && <p className="rounded-lg bg-red-50 p-2 text-xs text-red-700">{error}</p>}
            {msg && <p className="rounded-lg bg-emerald-50 p-2 text-xs text-emerald-700">{msg}</p>}
            <label className="block text-xs font-semibold text-neutral-700">Bot tokeni
              <SecretInput className={input} value={form.bot_token} onChange={e => setForm({ ...form, bot_token: e.target.value })} placeholder={savedToken ? `Saqlangan: ${savedToken} (o‘zgartirish uchun yangisini kiriting)` : '123456789:AA…'} />
            </label>
            <div className="flex items-end gap-2">
              <label className="block flex-1 text-xs font-semibold text-neutral-700">Chat
                {chats && chats.length > 0 ? (
                  <select className={input} value={form.chat_id} onChange={e => { const c = chats.find(x => x.id === e.target.value); setForm({ ...form, chat_id: e.target.value, chat_title: c?.title || '' }); }}>
                    <option value="">Tanlang…</option>
                    {chats.map(c => <option key={c.id} value={c.id}>{c.title} ({c.type === 'private' ? 'shaxsiy' : c.type === 'channel' ? 'kanal' : 'guruh'})</option>)}
                  </select>
                ) : (
                  <input className={input} value={form.chat_id} onChange={e => setForm({ ...form, chat_id: e.target.value, chat_title: '' })} placeholder="Chat ID yoki @kanal" />
                )}
              </label>
              <button type="button" onClick={findChats} disabled={!!busy || (!form.bot_token && !form.id)} className="inline-flex items-center gap-1 rounded-lg border border-neutral-300 px-3 py-2 text-xs font-semibold hover:bg-neutral-50 disabled:opacity-50">
                {busy === 'find' ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}Chatni topish
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-xs font-semibold text-neutral-700">Nomi
                <input className={input} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Masalan: Rahbariyat" />
              </label>
              <label className="block text-xs font-semibold text-neutral-700">Guruh mavzusi ID (ixtiyoriy)
                <input className={input} value={form.topic_id} onChange={e => setForm({ ...form, topic_id: e.target.value.replace(/\D/g, '') })} placeholder="bo‘sh" />
              </label>
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-neutral-700">Qaysi xabarlar kelsin</p>
              {events.map(ev => (
                <label key={ev.type} className="flex items-start gap-2 text-xs">
                  <input type="checkbox" className="mt-0.5" checked={form.events.includes(ev.type)} onChange={e => setForm({ ...form, events: e.target.checked ? [...form.events, ev.type] : form.events.filter(x => x !== ev.type) })} />
                  <span><b>{ev.label}</b> <span className="text-neutral-500">— {ev.hint}</span></span>
                </label>
              ))}
              {form.events.includes('DAILY_REPORT') && (
                <label className="ml-5 flex items-center gap-2 text-xs text-neutral-600">Kunlik hisobot soati (Toshkent)
                  <select className="rounded border border-neutral-300 px-1 py-0.5" value={form.daily_report_hour} onChange={e => setForm({ ...form, daily_report_hour: Number(e.target.value) })}>
                    {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
                  </select>
                </label>
              )}
            </div>
            <div className="space-y-1.5 rounded-xl border border-blue-100 bg-blue-50/50 p-3">
              <label className="flex items-start gap-2 text-xs">
                <input type="checkbox" className="mt-0.5" checked={form.personal} onChange={e => setForm({ ...form, personal: e.target.checked })} />
                <span><b>Xodimlarga shaxsiy eslatmalar shu bot orqali</b> <span className="text-neutral-500">— har bir xodim botni o‘z havolasi bilan ochadi va eslatmalar uning lichkasiga keladi. Bu holda rahbariyat chati shart emas.</span></span>
              </label>
              {form.personal && (
                <div className="ml-5 space-y-1.5">
                  {reminders.map(r => (
                    <label key={r.type} className="flex items-start gap-2 text-xs">
                      <input type="checkbox" className="mt-0.5" checked={form.personal_events.includes(r.type)} onChange={e => setForm({ ...form, personal_events: e.target.checked ? [...form.personal_events, r.type] : form.personal_events.filter(x => x !== r.type) })} />
                      <span><b>{r.label}</b> <span className="text-neutral-500">— {r.hint}</span></span>
                    </label>
                  ))}
                  <label className="block pt-1 text-[11px] font-semibold text-neutral-700">Dostavchiklar dumaloq video tashlaydigan guruh (ixtiyoriy)
                    <select className={input} value={form.checkin_chat_id} onChange={e => { const c = chats?.find(x => x.id === e.target.value); setForm({ ...form, checkin_chat_id: e.target.value, checkin_chat_title: c?.title || (e.target.value === form.checkin_chat_id ? form.checkin_chat_title : '') }); }}>
                      <option value="">— yo‘q —</option>
                      {form.checkin_chat_id && !chats?.some(c => c.id === form.checkin_chat_id) && <option value={form.checkin_chat_id}>{form.checkin_chat_title || form.checkin_chat_id}</option>}
                      {(chats || []).filter(c => c.type === 'group' || c.type === 'supergroup').map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
                    </select>
                    <span className="mt-1 block font-normal text-neutral-500">Guruh ro‘yxatda bo‘lmasa: botni guruhga qo‘shing, guruhda biror narsa yozing va “Chatni topish”ni bosing. Bot guruhdagi videolarni ko‘rishi uchun uni guruhda <b>admin</b> qiling (yoki @BotFather → /setprivacy → Disable). Video yuborilgan vaqt — ish boshlagan vaqt; usul “Davomat → Qoidalar va sozlamalar”da har bir xodimga tanlanadi. Xodim botga ulanmasa ham bo‘ladi: “Davomat → Sozlamalar → Xodimlarning Telegram hisoblari”da uning Telegram’ini biriktiring.</span>
                  </label>
                  <div className="grid grid-cols-3 gap-2 pt-1">
                    <label className="text-[11px] font-semibold text-neutral-700">Startdan necha daqiqa oldin eslatilsin
                      <input type="number" min={0} max={180} className={input} value={form.remind_before_min} onChange={e => setForm({ ...form, remind_before_min: Number(e.target.value) })} />
                    </label>
                    <label className="text-[11px] font-semibold text-neutral-700">“Ish boshlanmadi” muddatdan necha daqiqa keyin
                      <input type="number" min={0} max={240} className={input} value={form.missed_after_min} onChange={e => setForm({ ...form, missed_after_min: Number(e.target.value) })} />
                    </label>
                    <label className="text-[11px] font-semibold text-neutral-700">Ertalabki xabarlar soati
                      <select className={input} value={form.morning_hour} onChange={e => setForm({ ...form, morning_hour: Number(e.target.value) })}>
                        {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
                      </select>
                    </label>
                  </div>
                </div>
              )}
            </div>
            <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={form.is_active} onChange={e => setForm({ ...form, is_active: e.target.checked })} />Yoqilgan</label>
            <div className="flex flex-wrap justify-end gap-2 border-t border-neutral-100 pt-3">
              <button type="button" onClick={test} disabled={!!busy || !form.chat_id || (!form.bot_token && !form.id)} className="mr-auto inline-flex items-center gap-1 rounded-lg border border-neutral-300 px-3 py-2 text-xs font-semibold hover:bg-neutral-50 disabled:opacity-50">
                {busy === 'test' ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}Sinov xabari
              </button>
              <button type="button" onClick={() => setForm(null)} className="rounded-lg px-3 py-2 text-xs font-semibold text-neutral-600 hover:bg-neutral-100">Bekor qilish</button>
              <button type="button" onClick={save} disabled={!!busy || (!form.chat_id && !form.personal) || (!form.bot_token && !form.id)} className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
                {busy === 'save' ? 'Saqlanmoqda…' : 'Saqlash'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
