import React from 'react';
import { Database, Clock, Layers, CheckCircle2, AlertCircle } from 'lucide-react';
import { NavView } from '../../types.ts';

interface PlaceholderViewProps {
  view: NavView;
}

export const PlaceholderView: React.FC<PlaceholderViewProps> = ({ view }) => {
  const meta: Record<string, { title: string; desc: string; entities: string[]; upcomingLogic: string[] }> = {
    customers: {
      title: 'Mijozlar va Qarzdorlik (Customers & Balances)',
      desc: 'Savdo nuqtalari, kredit limitlari, qarzdorlik muddatlari va avans qoldiqlari boshqaruvi.',
      entities: ['Customer', 'CustomerBalanceTransaction', 'Territory', 'Agent', 'ExternalCustomer'],
      upcomingLogic: [
        'Kredit limitidan oshib ketgan mijozlarga avtomatik yuk jo\'natishni bloklash',
        'Mijozlar balansi bo\'yicha kunlik hisob-kitob (Akt sverki)',
        '1C va Smartup dasturlari bilan avtomatik sinxronizatsiya'
      ]
    },
    expenses: {
      title: 'Rasxodlar va Xarajat Limitlari (Expenses)',
      desc: 'Kompaniya xarajatlari toifalari, kunlik/oylik limitlar va tasdiqlash jarayonlari.',
      entities: ['Expense', 'ExpenseCategory', 'ExpenseLimit', 'AuditLog'],
      upcomingLogic: [
        'Kategoriya bo\'yicha kunlik/oylik limitdan oshganda ogohlantirish',
        'Ko\'p bosqichli xarajat tasdiqlash zanjiri (Moliya direktori imzosi)',
        'Kassa chiqimi bilan avtomatik bog\'lash'
      ]
    },
    employees: {
      title: 'Xodimlar, Oylik va Ishbay Ish Haqi (Salary & Piecework)',
      desc: 'Xodimlar ro\'yxati, lavozimlar, oylik maosh qoidalari va ishbay to\'lovlar (piecework).',
      entities: ['Employee', 'Salary', 'SalaryRule', 'PieceworkRule', 'PieceworkTransaction'],
      upcomingLogic: [
        'Sotuv agentlari uchun savdo hajmiga qarab foizli KPI hisoblash',
        'Ombor va yuk tashuvchilar uchun ishbay (piecework) hisob-kitob',
        'Oylik avans va yakuniy maosh vedomostlari shakllantirish'
      ]
    },
    reports: {
      title: 'Moliyaviy Hisobotlar (Financial Reports)',
      desc: 'P&L (Foyda va Zarar), Cash Flow (Pul Oqimi), Agentlar savdosi va qarzdorlik tahlili.',
      entities: ['AuditLog', 'CashDay', 'CashTransaction', 'Payment', 'Return'],
      upcomingLogic: [
        'Haqiqiy operatsion foyda va rentabellik hisobi',
        'Qarzdorlik muddati bo\'yicha tahlil (Aging report: 0-30, 31-60, 60+ kun)',
        'Excel (.xlsx) va PDF formatlarida eksport qilish qatlami'
      ]
    }
  };

  const current = meta[view] || {
    title: 'Modul Foundation',
    desc: 'Ushbu modulning database modellari yaratilgan va keyingi bosqichda faollashtiriladi.',
    entities: [],
    upcomingLogic: []
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-neutral-200 bg-white p-6 shadow-2xs">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-neutral-100 text-neutral-800">
            <Layers className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-neutral-900">{current.title}</h2>
              <span className="rounded bg-neutral-100 px-2 py-0.5 text-[10px] font-semibold text-neutral-600 uppercase">
                Phase 2/3 Rejalashtirilgan
              </span>
            </div>
            <p className="text-xs text-neutral-500">{current.desc}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {/* Database Entities Available */}
        <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-2xs">
          <div className="flex items-center gap-2 border-b border-neutral-100 pb-3">
            <Database className="h-4 w-4 text-emerald-600" />
            <h3 className="text-xs font-semibold text-neutral-900">
              Mavjud Database Entitylari (Foundation Tayyor)
            </h3>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {current.entities.map(e => (
              <span key={e} className="rounded-lg border border-neutral-200 bg-neutral-50 px-2.5 py-1 font-mono text-xs font-medium text-neutral-800">
                {e}
              </span>
            ))}
          </div>
          <p className="mt-4 text-[11px] text-neutral-400">
            Ushbu entitylar Phase 1 schema, relationshiplar va migratsiyalarga to'liq kiritilgan.
          </p>
        </div>

        {/* Business Logic Roadmap */}
        <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-2xs">
          <div className="flex items-center gap-2 border-b border-neutral-100 pb-3">
            <Clock className="h-4 w-4 text-emerald-600" />
            <h3 className="text-xs font-semibold text-neutral-900">
              Keyingi Bosqichda Bajariladigan Mantiq (TODO)
            </h3>
          </div>
          <ul className="mt-4 space-y-2 text-xs text-neutral-600">
            {current.upcomingLogic.map((logic, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-[10px] font-bold text-neutral-600">
                  {i + 1}
                </span>
                <span>{logic}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
};
