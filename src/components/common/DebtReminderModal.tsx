import React, { useEffect, useState } from 'react';
import { api } from '../../services/api.ts';
import { copyText, COPY_FAILED } from '../../utils/clipboard.ts';
import { 
  X, 
  Send, 
  Copy, 
  Check, 
  MessageSquare, 
  Smartphone, 
  AlertTriangle,
  Building2,
  Calendar,
  Sparkles
} from 'lucide-react';

interface DebtReminderModalProps {
  isOpen: boolean;
  onClose: () => void;
  customer: {
    id?: string;
    name: string;
    phone?: string;
    balance: number;
    daysOverdue?: number;
    lastPaymentDate?: string;
  } | null;
}

export const DebtReminderModal: React.FC<DebtReminderModalProps> = ({
  isOpen,
  onClose,
  customer
}) => {
  const [tone, setTone] = useState<'FRIENDLY' | 'OFFICIAL' | 'URGENT'>('FRIENDLY');
  const [copied, setCopied] = useState<boolean>(false);
  // The company's own name and phone (Sozlamalar → Korxona), never placeholders sent to a customer.
  const [firm, setFirm] = useState<{ name: string; phone: string }>({ name: '', phone: '' });
  useEffect(() => { if (isOpen) api.getCompany().then(r => setFirm({ name: r.company?.name || '', phone: r.company?.phone || '' })).catch(() => {}); }, [isOpen]);

  if (!isOpen || !customer) return null;
  const firmName = firm.name || 'Korxona';
  const contact = firm.phone ? `\nSavollar bo'yicha: ${firm.phone}` : '';

  const debtFormatted = Math.abs(customer.balance).toLocaleString();
  const phone = customer.phone || '';
  const cleanPhone = phone.replace(/[^0-9]/g, '');

  const getReminderText = () => {
    switch (tone) {
      case 'FRIENDLY':
        return `Assalomu alaykum, hurmatli ${customer.name}!
${firmName} kompaniyasidan hisob-kitob bo'yicha do'stona eslatma:

Sizning joriy qarzdorlik balansingiz: ${debtFormatted} UZS ni tashkil etmoqda.
Qulay vaqtingizda to'lovni amalga oshirishingizni so'raymiz.

Hamkorligingiz va ishonchingiz uchun minnatdormiz!${contact}`;

      case 'OFFICIAL':
        return `Hurmatli ${customer.name} rahbariyati va hisobxonasiga!
${firmName} moliyaviy bo'limidan bildirishnoma:

Tizimdagi solishtirma ma'lumotlariga ko'ra, qoldiq qarzdorlik summasi: ${debtFormatted} UZS.
Iltimos, o'zaro hisob-kitoblar yaxlitligi uchun to'lovni 3 (uch) bank ish kuni ichida amalga oshirishingizni so'raymiz.${contact}`;

      case 'URGENT':
        return `DIQQAT: TO'LOV MUDDATI KECHIKKAN!
Hurmatli ${customer.name}!

Sizning ${debtFormatted} UZS miqdoridagi qarzdorligingiz bo'yicha belgilangan muddat ${customer.daysOverdue ? `${customer.daysOverdue} kunga ` : ''}o'tgan.
Yangi tovar buyurtmalarini to'xtatmaslik va kredit limitini bloklamaslik uchun zudlik bilan to'lovni amalga oshirishingizni talab qilamiz.

${firmName}${contact}`;
    }
  };

  const messageText = getReminderText();

  const handleCopy = async () => {
    if (!(await copyText(messageText))) { alert(COPY_FAILED); return; }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleOpenTelegram = () => {
    const encoded = encodeURIComponent(messageText);
    window.open(`https://t.me/share/url?text=${encoded}`, '_blank');
  };

  const handleOpenSms = () => {
    const encoded = encodeURIComponent(messageText);
    window.location.href = `sms:${cleanPhone}?body=${encoded}`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-150">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-200 pb-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
              <MessageSquare className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-neutral-900">
                Qarz Eslatmasi (Telegram / SMS)
              </h3>
              <p className="text-xs text-neutral-500">
                Mijozga bir bosishda xushmuomala yoki rasmiy eslatma yuborish
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Customer Mini Card */}
        <div className="rounded-xl bg-neutral-50 p-3.5 border border-neutral-200 flex items-center justify-between">
          <div>
            <span className="text-[11px] font-bold text-neutral-400 uppercase">Mijoz / Do'kon</span>
            <p className="text-sm font-bold text-neutral-900">{customer.name}</p>
            <p className="text-xs text-neutral-500 font-mono">{customer.phone || 'Telefon yo\'q'}</p>
          </div>
          <div className="text-right">
            <span className="text-[11px] font-bold text-neutral-400 uppercase">Qarzdorlik</span>
            <p className="text-base font-black text-rose-600">{debtFormatted} UZS</p>
            {customer.daysOverdue && customer.daysOverdue > 0 ? (
              <span className="text-[10px] font-bold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">
                {customer.daysOverdue} kun kechikkan
              </span>
            ) : null}
          </div>
        </div>

        {/* Tone Selector */}
        <div>
          <label className="block text-xs font-bold text-neutral-700 mb-1.5 uppercase tracking-wide">
            Eslatma Uslubi (Tone):
          </label>
          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={() => setTone('FRIENDLY')}
              className={`rounded-xl py-2 px-3 text-xs font-semibold border transition ${
                tone === 'FRIENDLY'
                  ? 'bg-emerald-50 border-emerald-500 text-emerald-800 shadow-xs'
                  : 'border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50'
              }`}
            >
              😊 Do'stona
            </button>
            <button
              onClick={() => setTone('OFFICIAL')}
              className={`rounded-xl py-2 px-3 text-xs font-semibold border transition ${
                tone === 'OFFICIAL'
                  ? 'bg-indigo-50 border-indigo-500 text-indigo-800 shadow-xs'
                  : 'border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50'
              }`}
            >
              📄 Rasmiy Buxgalteriya
            </button>
            <button
              onClick={() => setTone('URGENT')}
              className={`rounded-xl py-2 px-3 text-xs font-semibold border transition ${
                tone === 'URGENT'
                  ? 'bg-rose-50 border-rose-500 text-rose-800 shadow-xs'
                  : 'border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50'
              }`}
            >
              ⚠️ Qat'iy Talabnoma
            </button>
          </div>
        </div>

        {/* Text Preview */}
        <div>
          <label className="block text-xs font-bold text-neutral-700 mb-1.5 uppercase tracking-wide">
            Tayyor Xabar Matni:
          </label>
          <div className="rounded-xl border border-neutral-200 bg-neutral-900 p-4 font-mono text-xs text-neutral-100 leading-relaxed whitespace-pre-line">
            {messageText}
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-2 pt-2">
          <button
            onClick={handleCopy}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 px-4 rounded-xl bg-neutral-100 hover:bg-neutral-200 text-neutral-800 text-xs font-bold transition"
          >
            {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
            <span>{copied ? "Nusxalandi!" : "Nusxa Olish"}</span>
          </button>

          <button
            onClick={handleOpenTelegram}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 px-4 rounded-xl bg-[#2AABEE] hover:bg-[#229ED9] text-white text-xs font-bold shadow-xs transition"
          >
            <Send className="h-4 w-4" />
            <span>Telegramda Ulashish</span>
          </button>

          {customer.phone && (
            <button
              onClick={handleOpenSms}
              className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl border border-neutral-300 hover:bg-neutral-50 text-neutral-700 text-xs font-semibold transition"
              title="SMS ilovasida ochish"
            >
              <Smartphone className="h-4 w-4" />
              <span>SMS</span>
            </button>
          )}
        </div>

      </div>
    </div>
  );
};
