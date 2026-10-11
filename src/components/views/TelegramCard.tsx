import React, { useEffect, useState } from 'react';
import { Send } from 'lucide-react';
import { api, MyTelegram } from '../../services/api.ts';

/** The signed-in person's own Telegram: link it once, then work reminders come to their private chat. */
export const TelegramCard: React.FC = () => {
  const [me, setMe] = useState<MyTelegram | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);

  const load = () => api.myTelegram.get().then(setMe).catch(e => setError(e.message));
  useEffect(() => { load(); }, []);
  // After the link is opened, the bot binds the chat within ~20 s: check a few times.
  useEffect(() => {
    if (!waiting) return;
    let n = 0;
    const timer = setInterval(async () => {
      n++;
      const r = await api.myTelegram.get().catch(() => null);
      if (r) setMe(r);
      if (r?.linked || n >= 12) { setWaiting(false); clearInterval(timer); }
    }, 5000);
    return () => clearInterval(timer);
  }, [waiting]);

  if (!me || !me.available) return null; // no personal-reminder bot set up by the owner

  const connect = async () => {
    setError(null);
    try {
      const { url } = await api.myTelegram.link();
      window.open(url, '_blank', 'noopener');
      setWaiting(true);
    } catch (e: any) { setError(e.message); }
  };
  const toggle = async (type: string, muted: boolean) => {
    const list = me.reminders.filter(r => (r.type === type ? muted : r.muted)).map(r => r.type);
    try { setMe(await api.myTelegram.mute(list)); } catch (e: any) { setError(e.message); }
  };

  return (
    <div className="space-y-3 rounded-2xl border border-neutral-200 bg-white p-5 shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-bold text-neutral-900"><Send className="h-4 w-4" />Telegram eslatmalar</h2>
          <p className="text-xs text-neutral-500">
            {me.linked ? <>Ulangan{me.chat_name ? `: ${me.chat_name}` : ''}. Eslatmalar @{me.bot_username} orqali lichkangizga keladi.</>
              : me.blocked ? 'Botni bloklagansiz — eslatmalar kelmayapti. Qayta ulang.'
              : 'Ish eslatmalari (ish boshlanishi, vazifalar, oylik, qarzdorlar) Telegram lichkangizga kelsin.'}
          </p>
        </div>
        {me.linked
          ? <button onClick={async () => { if (confirm('Telegram eslatmalari to‘xtatilsinmi?')) { try { setMe(await api.myTelegram.unlink()); } catch (e: any) { setError(e.message); } } }} className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-semibold hover:bg-neutral-50">Uzish</button>
          : <button onClick={connect} className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-sky-700">{waiting ? 'Telegram’da “Start”ni bosing…' : 'Telegram’ni ulash'}</button>}
      </div>
      {error && <p className="rounded-lg bg-red-50 p-2 text-xs text-red-700">{error}</p>}
      {me.linked && me.reminders.length > 0 && (
        <div className="grid gap-1.5 sm:grid-cols-2">
          {me.reminders.map(r => (
            <label key={r.type} className="flex items-start gap-2 text-xs">
              <input type="checkbox" className="mt-0.5" checked={!r.muted} onChange={e => toggle(r.type, !e.target.checked)} />
              <span><b>{r.label}</b> <span className="text-neutral-500">— {r.hint}</span></span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
};
