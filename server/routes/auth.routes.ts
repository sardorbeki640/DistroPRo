import { Router } from 'express';
import type { Request, Response } from 'express';
import { AuthService } from '../services/auth.service.ts';
import { requireAuth, requirePermission } from '../middleware/auth.middleware.ts';
import { LoginSchema, AssignRoleSchema, ChangePasswordSchema } from '../validation/schemas.ts';
import { db } from '../db/database.ts';
import { SetupService } from '../services/setup.service.ts';
import { timingSafeEqual } from 'node:crypto';

const router = Router();
function hasValidSetupToken(candidate: unknown): boolean {
  const expected = process.env.OWNER_SETUP_TOKEN || '';
  if (expected.length < 32 || typeof candidate !== 'string') return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(candidate);
  return a.length === b.length && timingSafeEqual(a, b);
}

router.get('/setup', (_req,res) => res.json({
  required: SetupService.required(),
  mode: process.env.NODE_ENV !== 'production' ? 'local' : ((process.env.OWNER_SETUP_TOKEN || '').length >= 32 ? 'token' : 'environment')
}));
router.post('/setup', (req,res,next) => {
  const address = req.socket.remoteAddress;
  const localRequest = ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(address || '') && req.headers.origin === `http://${req.headers.host}`;
  const sameOrigin = typeof req.headers.origin === 'string' && req.headers.origin === `${req.protocol}://${req.headers.host}`;
  const remoteRequest = process.env.NODE_ENV === 'production' && sameOrigin && hasValidSetupToken(req.body?.setup_token);
  if (!localRequest && !remoteRequest) {
    res.status(403).json({error:'Serverda ilk sozlash uchun Render’da OWNER_EMAIL va OWNER_PASSWORD kiriting yoki OWNER_SETUP_TOKEN (kamida 32 belgi) sozlang.'}); return;
  }
  try {
    SetupService.createOwner(String(req.body.email || '').trim(),String(req.body.password || ''));
    res.json({success:true});
  } catch(error) {next(error);}
});

router.post('/login', async (req: Request, res: Response, next) => {
  try {
    if (process.env.NODE_ENV !== 'test' && SetupService.required()) {res.status(403).json({error:'Avval korxona egasi hisobini yarating'});return;}
    const validated = LoginSchema.parse(req.body);
    const result = await AuthService.login(validated.email, validated.password, req.ip);
    res.json({
      success: true,
      token: result.token,
      user: result.user
    });
  } catch (err) {
    next(err);
  }
});

router.post('/change-password', requireAuth, (req: Request, res: Response, next) => {
  try {
    const { current_password, new_password } = ChangePasswordSchema.parse(req.body);
    AuthService.changePassword(req.user!.userId, current_password, new_password);
    res.json({ success: true, message: 'Parol almashtirildi.' });
  } catch (err) {
    next(err);
  }
});

router.get('/me', requireAuth, (req: Request, res: Response, next) => {
  try {
    const userDetails = AuthService.getUserPermissions(req.user!.userId);
    res.json({
      success: true,
      user: userDetails
    });
  } catch (err) {
    next(err);
  }
});

router.get('/users', requireAuth, requirePermission('settings', 'view'), (req: Request, res: Response, next) => {
  try {
    const companyId = req.user!.companyId;
    const users = db.find('users', u => u.company_id === companyId);
    const roles = db.find('roles', r => r.company_id === companyId);
    const userRoles = db.getTable('user_roles');

    const mappedUsers = users.map(u => {
      const uRoles = userRoles.filter(ur => ur.user_id === u.id).map(ur => ur.role_id);
      const roleObjects = roles.filter(r => uRoles.includes(r.id));
      return {
        id: u.id,
        email: u.email,
        full_name: u.full_name,
        phone: u.phone,
        status: u.status,
        roles: roleObjects
      };
    });

    res.json({
      success: true,
      users: mappedUsers,
      availableRoles: roles
    });
  } catch (err) {
    next(err);
  }
});

router.post('/assign-role', requireAuth, requirePermission('settings', 'update'), (req: Request, res: Response, next) => {
  try {
    const validated = AssignRoleSchema.parse(req.body);
    AuthService.assignRole(
      req.user!.userId,
      validated.target_user_id,
      validated.target_role_id,
      validated.reason
    );
    res.json({
      success: true,
      message: 'Foydalanuvchi roli muvaffaqiyatli yangilandi va audit qilindi.'
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/roles-permissions - Get role permissions matrix
router.get('/roles-permissions', requireAuth, requirePermission('settings', 'view'), (req: Request, res: Response, next) => {
  try {
    const matrix = AuthService.getRolePermissionsMatrix(req.user!.companyId);
    res.json({
      success: true,
      ...matrix
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/auth/roles-permissions/:roleId - Update role permissions
router.put('/roles-permissions/:roleId', requireAuth, requirePermission('settings', 'update'), (req: Request, res: Response, next) => {
  try {
    const { roleId } = req.params;
    const { permissions, reason } = req.body;

    if (!Array.isArray(permissions)) {
      res.status(400).json({ success: false, error: 'permissions massiv bo\'lishi shart' });
      return;
    }

    const result = AuthService.updateRolePermissions(
      req.user!.userId,
      roleId,
      permissions,
      reason
    );

    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
