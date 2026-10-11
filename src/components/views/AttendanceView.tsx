import React, { useEffect, useState } from 'react';
import { ScanFace } from 'lucide-react';
import { api } from '../../services/api.ts';
import { AttendanceManager } from '../faceid/AttendanceManager.tsx';

/** Admin page: Face ID attendance, the discipline rule book, enrollment and review (also a tab in Employees). */
export const AttendanceView: React.FC = () => {
  const [employees, setEmployees] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.getEmployees().then(r => setEmployees(r.employees || [])).catch(e => setError(e.message)); }, []);
  return (
    <div className="space-y-4 pb-12">
      <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-xs">
        <h1 className="flex items-center gap-2 text-xl font-bold text-neutral-900"><ScanFace className="h-6 w-6 text-emerald-600" />Davomat & Face ID</h1>
        <p className="text-xs text-neutral-500">Kim qachon ish boshladi, kechikish va ishga chiqmaslik, kompaniya qoidalari bo‘yicha jarima foizlari, yuzni ro‘yxatga olish va shubhali qaydlarni tekshirish.</p>
      </div>
      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</div>}
      <AttendanceManager employees={employees} />
    </div>
  );
};
