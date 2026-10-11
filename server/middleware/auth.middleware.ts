import type { Request, Response, NextFunction } from 'express';
import { AuthService } from '../services/auth.service.ts';
import type { AuthTokenPayload } from '../services/auth.service.ts';
import { db } from '../db/database.ts';
import type { PermissionModule, PermissionAction } from '../db/schema.ts';

/** Owner-level pages (Jarvis, backups, staff profiles): SUPER_ADMIN or the ADMIN role. Use after requireAuth. */
export const requireOwner = (req: Request, res: Response, next: NextFunction): void => {
  const p = AuthService.getUserPermissions(req.user!.userId);
  if (p.is_super_admin || p.roles.some(r => r.name === 'ADMIN')) { next(); return; }
  res.status(403).json({ success: false, error: 'Bu bo‘lim faqat rahbar (egasi yoki admin) uchun.' });
};

/** Only the super admin (the company's top account). */
export const requireSuperAdmin = (req: Request, res: Response, next: NextFunction): void => {
  if (AuthService.getUserPermissions(req.user!.userId).is_super_admin) { next(); return; }
  res.status(403).json({ success: false, error: 'Buni faqat super admin qila oladi.' });
};

// Extend Express Request
declare global {
  namespace Express {
    interface Request {
      user?: AuthTokenPayload;
    }
  }
}

export const requireAuth = (req: Request, res: Response, next: NextFunction): void => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      success: false,
      error: 'Avtorizatsiyadan o\'tilmagan: Bearer token talab qilinadi.'
    });
    return;
  }

  const token = authHeader.split(' ')[1];
  try {
    const payload = AuthService.verifyToken(token);
    req.user = payload;
    // A password issued by the owner must be replaced before anything else is allowed.
    const account = db.findById('users', payload.userId);
    if (account?.must_change_password && !['/api/auth/change-password', '/api/auth/me'].includes(req.originalUrl.split('?')[0])) {
      res.status(403).json({ success: false, error: 'Avval vaqtinchalik parolni almashtiring.', must_change_password: true });
      return;
    }
    next();
  } catch (err: any) {
    res.status(401).json({
      success: false,
      error: 'Yaroqsiz yoki muddati o\'tgan sessiya tokeni.',
      message: err.message
    });
  }
};

export const requirePermission = (module: PermissionModule, action: PermissionAction) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ success: false, error: 'Avtorizatsiya talab qilinadi.' });
      return;
    }

    try {
      const allowed = AuthService.hasPermission(req.user.userId, module, action);
      if (!allowed) {
        res.status(403).json({
          success: false,
          error: `Ruxsat rad etildi: Sizda "${module}:${action}" huquqi mavjud emas.`
        });
        return;
      }
      next();
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: 'Ruxsatni tekshirishda xatolik yuz berdi.',
        details: err.message
      });
    }
  };
};
