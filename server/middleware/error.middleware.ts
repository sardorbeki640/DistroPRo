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

  // Unknown exceptions are server failures, not client validation errors.
  const requestedStatus = Number(err.status || err.statusCode);
  const status = Number.isInteger(requestedStatus) && requestedStatus >= 400 && requestedStatus <= 599 ? requestedStatus : 500;
  res.status(status).json({
    success: false,
    error: status >= 500 ? 'Serverda kutilmagan xatolik yuz berdi. Birozdan keyin qayta urinib ko‘ring.' : (err.message || 'So‘rovni bajarib bo‘lmadi.')
  });
};
