import React, { useState, useEffect } from 'react';
import { 
  Smartphone, 
  Download, 
  CheckCircle2, 
  ExternalLink, 
  X, 
  QrCode, 
  ShieldCheck, 
  Cpu, 
  Zap,
  Globe
} from 'lucide-react';

interface ApkInstallModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ApkInstallModal: React.FC<ApkInstallModalProps> = ({ isOpen, onClose }) => {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [installedSuccess, setInstalledSuccess] = useState(false);

  useEffect(() => {
    // Detect standalone mode
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as any).standalone === true;
    setIsInstalled(isStandalone);

    const handler = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };

    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  if (!isOpen) return null;

  const handleInstallPwa = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setInstalledSuccess(true);
        setDeferredPrompt(null);
      }
    } else {
      // Guide user
      alert("Ilovani o'rnatish uchun brauzer menyusidagi (3 nuqta) 'Ilovani o'rnatish' yoki 'Bosh ekranga qo'shish' tugmasini bosing.");
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-neutral-100 relative overflow-hidden">
        {/* Background accent */}
        <div className="absolute -top-16 -right-16 w-36 h-36 bg-emerald-100 rounded-full blur-2xl pointer-events-none"></div>

        <div className="flex items-center justify-between border-b border-neutral-100 pb-4 mb-4">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-emerald-50 text-emerald-600 rounded-2xl border border-emerald-100">
              <Smartphone className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-bold text-neutral-900">Distro Finance Mobil APK</h3>
              <p className="text-xs text-neutral-500">Android & iOS uchun to'liq avtonom dastur</p>
            </div>
          </div>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-600 p-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4">
          {/* Status Banner */}
          <div className="p-4 rounded-2xl bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-100">
            <div className="flex items-center space-x-2 text-emerald-800 font-bold text-xs">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              <span>Android WebAPK & PWA Standalone Sertifikati Faol</span>
            </div>
            <p className="text-[11px] text-emerald-700/90 mt-1 leading-relaxed">
              Ushbu dastur Android qurilmalarida to'liq mustaqil APK kabi ishlaydi. 
              Smartfon xotirasiga o'rnatilgandan so'ng brauzersiz, to'liq ekranda va oflayn rejimda ishlaydi.
            </p>
          </div>

          {/* Key Advantages */}
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 bg-neutral-50 rounded-xl border border-neutral-100">
              <Zap className="w-4 h-4 text-emerald-600 mb-1" />
              <h4 className="text-xs font-bold text-neutral-900">Tezkor Yuklanish</h4>
              <p className="text-[10px] text-neutral-500 mt-0.5">Service worker orqali keshlash va darhol ochilish</p>
            </div>

            <div className="p-3 bg-neutral-50 rounded-xl border border-neutral-100">
              <Cpu className="w-4 h-4 text-indigo-600 mb-1" />
              <h4 className="text-xs font-bold text-neutral-900">Oflayn Xavfsizlik</h4>
              <p className="text-[10px] text-neutral-500 mt-0.5">Internet uzilganda ham ma'lumotlar saqlanadi</p>
            </div>
          </div>

          {/* Installation steps for Android */}
          <div className="p-4 rounded-2xl border border-neutral-200 bg-neutral-50 space-y-2">
            <h4 className="text-xs font-bold text-neutral-800">Android Telefoningizga O'rnatish:</h4>
            <ol className="text-xs text-neutral-600 space-y-1.5 list-decimal pl-4">
              <li>Smartfoningizda Google Chrome yoki Samsung Internet brauzerini oching.</li>
              <li>Pastdagi <strong>"Bosh Ekranga O'rnatish (APK)"</strong> tugmasini bosing yoki brauzer menyusidan <strong>"Ilovani o'rnatish"</strong>ni tanlang.</li>
              <li>Dastur ilova sifatida o'rnatiladi va telefon menyusida paydo bo'ladi.</li>
            </ol>
          </div>

          {installedSuccess && (
            <div className="p-3 rounded-xl bg-emerald-100 text-emerald-800 text-xs font-semibold flex items-center space-x-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>Dastur smartfoningizga muvaffaqiyatli o'rnatildi!</span>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex items-center space-x-3 pt-2">
            <button
              onClick={onClose}
              className="flex-1 py-2.5 text-xs font-semibold text-neutral-600 hover:bg-neutral-100 rounded-xl transition"
            >
              Yopish
            </button>

            <button
              onClick={handleInstallPwa}
              className="flex-2 py-2.5 px-4 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl transition shadow-xs flex items-center justify-center space-x-2"
            >
              <Download className="w-4 h-4" />
              <span>Bosh Ekranga O'rnatish (APK)</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
