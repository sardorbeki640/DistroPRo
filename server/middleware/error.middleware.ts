import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';

export const errorHandler = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  console.error('[API Error]:', err);

  // Zod Validation Error
  if (err instanceof ZodError) {
    res.status(400).json({
      success: false,
      error: 'Validatsiya xatosi',
      validationErrors: err.issues.map(i => ({
        field: i.path.join('.'),
        message: i.message
      }))
    });
    return;
  }

  // Missing Sheets setup is an actionable configuration problem, not a server crash.
  // Keep the instruction visible to the user instead of disguising it as HTTP 500.
  const message = String(err?.message || '');
  if (/SQL write operations are forbidden|BLOCKED.*write operations/i.test(message)) {
    res.status(503).json({
      success: false,
      error: 'Ma’lumotlar bazasi yozuvlarni vaqtincha rad etdi. SalesDoctor ma’lumotlari olinishi mumkin, lekin bazaga saqlanmayapti. Turso bazasining yozish limiti yoki rejasini tekshiring.',
      errorCode: 'DATABASE_WRITE_BLOCKED'
    });
    return;
  }
  if (message.includes('Google Sheets ulanishini yoqing') || message.includes('Sheets ulanishi sozlanmagan')) {
    res.status(400).json({
      success: false,
      error: 'Google Sheets manbasi tanlangan, lekin Sheets hali ulanmagan. Sozlamalarda Google Sheets URL manzilini saqlang yoki KPI uchun “Ulangan tizim” manbasini tanlang.'
    });
    return;
  }

  // Unknown exceptions are server failures, not client validation errors.
  const requestedStatus = Number(err.status || err.statusCode);
  const status = Number.isInteger(requestedStatus) && requestedStatus >= 400 && requestedStatus <= 599 ? requestedStatus : 500;
  res.status(status).json({
    success: false,
    error: status >= 500 ? 'Serverda kutilmagan xatolik yuz berdi. Birozdan keyin qayta urinib ko‘ring.' : (err.message || 'So‘rovni bajarib bo‘lmadi.')
  });
};
