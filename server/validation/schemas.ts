import { z } from 'zod';
import { isValidIsoDate } from '../utils/date.ts';

const isoDate = z.string().refine(isValidIsoDate, "Sana haqiqiy kalendar kuni (YYYY-MM-DD) bo'lishi shart");

// "email" holds either an email (owner, admins) or a staff login such as a phone number.
export const LoginSchema = z.object({
  email: z.string().trim().min(3, 'Email yoki loginni kiriting').max(200),
  password: z.string().min(6, 'Parol kamida 6 belgidan iborat bo\'lishi kerak').max(128)
});

export const ChangePasswordSchema = z.object({
  current_password: z.string().min(1, 'Joriy parolni kiriting'),
  new_password: z.string().min(6, 'Yangi parol kamida 6 belgi bo‘lsin').max(128)
});

// The owner may type the employee's password (at least 6 characters) or leave it empty for a 6-digit one.
const StaffPassword = z.string().trim().min(6, 'Parol kamida 6 belgi bo‘lsin').max(64).regex(/^\S+$/, 'Parolda bo‘sh joy bo‘lmasin');
export const CreateStaffAccountSchema = z.object({
  login: z.string().trim().min(3, 'Login kamida 3 belgi').max(60).regex(/^[a-zA-Z0-9._+@-]+$/, 'Loginda faqat lotin harflari, raqamlar va . _ - + @'),
  role_id: z.string().min(1, 'Rolni tanlang'),
  password: z.union([StaffPassword, z.literal('')]).optional(),
  must_change: z.boolean().optional()
});
export const ResetStaffPasswordSchema = z.object({
  password: z.union([StaffPassword, z.literal('')]).optional(),
  must_change: z.boolean().optional()
});

export const OpenCashDaySchema = z.object({
  register_id: z.string().min(1, 'Kassa apparati ID kiritilishi shart'),
  date: isoDate,
  opening_balance: z.number().nonnegative('Boshlang\'ich qoldiq manfiy bo\'lmasligi kerak').optional(),
  manual_opening_adjustment: z.number().optional()
});

export const CloseCashDaySchema = z.object({
  cash_day_id: z.string().min(1, 'Kassa kuni ID kiritilishi shart'),
  actual_cash: z.number().nonnegative('Faktik naqd pul summasi manfiy bo\'lmasligi kerak'),
  reason: z.string().min(3, 'Kassani yopishda sabab / izoh kamida 3 belgi bo\'lishi shart'),
  notes: z.string().optional()
});

export const CreateTransactionSchema = z.object({
  cash_day_id: z.string().min(1, 'Kassa kuni ID kiritilishi shart'),
  transaction_type: z.enum([
    'SALE_PAYMENT',
    'CREDIT_SALE',
    'CREDIT_COLLECTION',
    'RETURN',
    'CARRIED_FORWARD',
    'EXPENSE',
    'TRANSFER_IN',
    'TRANSFER_OUT',
    'ADJUSTMENT'
  ]),
  amount: z.number().positive('Summa 0 dan katta bo\'lishi shart'),
  payment_method: z.enum(['CASH', 'TERMINAL', 'CLICK', 'BANK_TRANSFER', 'OTHER']),
  customer_id: z.string().nullable().optional(),
  employee_id: z.string().nullable().optional(),
  agent_id: z.string().nullable().optional(),
  order_number: z.string().nullable().optional(),
  order_id: z.string().nullable().optional(),
  source_transaction_id: z.string().nullable().optional(),
  external_reference: z.string().nullable().optional(),
  description: z.string().min(3, 'Izoh kamida 3 belgi bo\'lishi shart'),
  correction_reason: z.string().optional()
});

export const CreateDailyOrderSchema = z.object({
  cash_day_id: z.string().min(1, 'Kassa kuni ID kiritilishi shart'),
  order_number: z.string().optional(),
  order_date: isoDate.optional(),
  agent_id: z.string().nullable().optional(),
  customer_id: z.string().min(1, 'Mijoz tanlanishi shart'),
  sale_amount: z.number().positive('Savdo summasi 0 dan katta bo\'lishi shart'),
  cash_payment: z.number().min(0).default(0),
  terminal_payment: z.number().min(0).default(0),
  click_payment: z.number().min(0).default(0),
  credit_amount: z.number().min(0).default(0),
  note: z.string().optional()
});

export const CreateCreditCollectionSchema = z.object({
  cash_day_id: z.string().min(1, 'Kassa kuni ID kiritilishi shart'),
  customer_id: z.string().min(1, 'Mijoz tanlanishi shart'),
  agent_id: z.string().nullable().optional(),
  amount: z.number().positive('Qarz yopish summasi 0 dan katta bo\'lishi shart'),
  payment_method: z.enum(['CASH', 'TERMINAL', 'CLICK', 'BANK_TRANSFER', 'OTHER']).default('CASH'),
  external_reference: z.string().nullable().optional(),
  description: z.string().min(3, 'Izoh kamida 3 belgi bo\'lishi shart')
});

export const CreateReturnSchema = z.object({
  cash_day_id: z.string().min(1, 'Kassa kuni ID kiritilishi shart'),
  customer_id: z.string().min(1, 'Mijoz tanlanishi shart'),
  agent_id: z.string().nullable().optional(),
  order_reference: z.string().nullable().optional(),
  amount: z.number().positive('Qaytarish summasi 0 dan katta bo\'lishi shart'),
  date: isoDate.optional(),
  reason: z.string().min(3, 'Qaytarish sababi kamida 3 belgi bo\'lishi shart'),
  payment_impact: z.enum(['CASH_REFUND', 'BALANCE_CREDIT']),
  external_reference: z.string().nullable().optional()
});

export const CreateCarriedForwardSchema = z.object({
  cash_day_id: z.string().min(1, 'Kassa kuni ID kiritilishi shart'),
  customer_id: z.string().min(1, 'Mijoz tanlanishi shart'),
  agent_id: z.string().nullable().optional(),
  amount: z.number().positive('Kun surish summasi 0 dan katta bo\'lishi shart'),
  source_transaction_id: z.string().nullable().optional(),
  description: z.string().min(3, 'Kun surish sababi / izoh kamida 3 belgi bo\'lishi shart')
});

export const CorrectTransactionSchema = z.object({
  amount: z.number().positive().optional(),
  payment_method: z.enum(['CASH', 'TERMINAL', 'CLICK', 'BANK_TRANSFER', 'OTHER']).optional(),
  description: z.string().optional(),
  reason: z.string().min(3, 'Korreksiya sababi kamida 3 belgi bo\'lishi shart')
});

export const ReopenCashDaySchema = z.object({
  reason: z.string().trim().min(5, 'Qayta ochish sababi kamida 5 belgi bo\'lishi shart')
});

export const AssignRoleSchema = z.object({
  target_user_id: z.string().min(1, 'Foydalanuvchi tanlanishi shart'),
  target_role_id: z.string().min(1, 'Rol tanlanishi shart'),
  reason: z.string().min(3, 'Rol tayinlashda asoslantiruvchi sabab kiritilishi shart')
});
