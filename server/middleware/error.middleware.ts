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

  // Standard or custom errors
  const status = err.status || err.statusCode || 400;
  res.status(status).json({
    success: false,
    error: err.message || 'Kutilmagan server xatoligi'
  });
};
