import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { db } from '../db/database.ts';
import type { User, Role, Permission, UserRole, RolePermission, PermissionModule, PermissionAction } from '../db/schema.ts';
import { AuditService } from './audit.service.ts';

// The old example value was published in .env.example; anyone could forge tokens with it.
const KNOWN_PUBLIC_SECRETS = new Set(['distribution_finance_super_secret_jwt_key_2026']);
const configuredSecret = process.env.JWT_SECRET || '';
if (configuredSecret && (KNOWN_PUBLIC_SECRETS.has(configuredSecret) || configuredSecret.length < 32)) {
  throw new Error('JWT_SECRET xavfsiz emas: namunadagi yoki 32 belgidan qisqa kalit. .env.local faylida yangi tasodifiy kalit yozing.');
}
const JWT_SECRET = configuredSecret || randomBytes(48).toString('hex');
const TOKEN_EXPIRY = '24h';
// Failed sign-ins per IP+login; 10 failures lock that pair for 15 minutes.
const LOGIN_ATTEMPTS = new Map<string, { count: number; lockedUntil: number; lastAttemptAt: number }>();
const MAX_LOGIN_KEYS = 10_000;
const LOGIN_WINDOW_MS = 30 * 60_000;
const DUMMY_PASSWORD_HASH = bcrypt.hashSync(randomBytes(32).toString('hex'), 10);

export interface AuthTokenPayload {
  userId: string;
  email: string;
  companyId: string;
  roles: string[];
}

export interface UserWithPermissions {
  id: string;
  company_id: string;
  email: string;
  full_name: string;
  phone?: string;
  status: string;
  roles: Role[];
  permissions: string[]; // List of permission codes e.g. "cash:view", "cash:create"
  is_super_admin: boolean;
  login?: string;
  employee_id?: string | null;
  must_change_password?: boolean;
  company_name?: string;
}

export class AuthService {
  /**
   * Authenticates user by email & password and generates JWT token
   */
  public static async login(email: string, password: string, clientIp?: string): Promise<{ token: string; user: UserWithPermissions }> {
    const normalized = email.trim().toLowerCase();
    // Staff accounts use a short login (often a phone); owners and admins use email.
    const key = `${clientIp || 'local'}|${normalized}`;
    // Staff passwords may be short (6 digits): besides the per-address limit, one login is locked after 20 wrong
    // tries from anywhere, so guessing from many addresses does not work either.
    const loginKey = `*|${normalized}`;
    const now = Date.now();
    for (const k of [key, loginKey]) {
      const attempts = LOGIN_ATTEMPTS.get(k);
      if (attempts && attempts.lockedUntil > Date.now()) {
        throw new Error(`Juda ko'p noto'g'ri urinish. ${Math.ceil((attempts.lockedUntil - Date.now()) / 60000)} daqiqadan keyin qayta urining.`);
      }
      if (attempts && (now - attempts.lastAttemptAt > LOGIN_WINDOW_MS || (attempts.lockedUntil > 0 && attempts.lockedUntil <= now))) LOGIN_ATTEMPTS.delete(k);
    }
    const user = db.findOne('users', u => u.email.toLowerCase() === normalized || (!!u.login && u.login.toLowerCase() === normalized));
    const fail = (message: string) => {
      if (LOGIN_ATTEMPTS.size >= MAX_LOGIN_KEYS) {
        for (const [storedKey, value] of LOGIN_ATTEMPTS) {
          if (now - value.lastAttemptAt > LOGIN_WINDOW_MS || (value.lockedUntil > 0 && value.lockedUntil <= now)) LOGIN_ATTEMPTS.delete(storedKey);
        }
        while (LOGIN_ATTEMPTS.size >= MAX_LOGIN_KEYS) LOGIN_ATTEMPTS.delete(LOGIN_ATTEMPTS.keys().next().value!);
      }
      for (const [k, max, minutes] of [[key, 10, 15], [loginKey, 20, 30]] as const) {
        const a = LOGIN_ATTEMPTS.get(k) || { count: 0, lockedUntil: 0, lastAttemptAt: now };
        a.count++;
        a.lastAttemptAt = now;
        if (a.count >= max) { a.lockedUntil = Date.now() + minutes * 60000; a.count = 0; }
        LOGIN_ATTEMPTS.set(k, a);
      }
      return new Error(message);
    };

    if (!user) {
      bcrypt.compareSync(password, DUMMY_PASSWORD_HASH);
      throw fail('Login yoki parol noto\'g\'ri.');
    }

    const isMatch = bcrypt.compareSync(password, user.password_hash);
    if (user.status !== 'ACTIVE' || !isMatch) {
      throw fail('Login yoki parol noto\'g\'ri.');
    }
    LOGIN_ATTEMPTS.delete(key);
    LOGIN_ATTEMPTS.delete(loginKey);
    db.update('users', user.id, { last_login_at: new Date().toISOString() });

    const userDetails = this.getUserPermissions(user.id);

    const tokenPayload: AuthTokenPayload = {
      userId: user.id,
      email: user.email,
      companyId: user.company_id,
      roles: userDetails.roles.map(r => r.name)
    };

    const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });

    // Audit login
    AuditService.log({
      company_id: user.company_id,
      user_id: user.id,
      user_email: user.email,
      action: 'LOGIN',
      entity: 'User',
      entity_id: user.id,
      old_value: null,
      new_value: { ip: clientIp || 'internal', time: new Date().toISOString() },
      reason: 'Tizimga muvaffaqiyatli kirish'
    });

    return { token, user: userDetails };
  }

  /**
   * Fetches user and aggregates their full role and permission matrix.
   */
  public static getUserPermissions(userId: string): UserWithPermissions {
    const user = db.findById('users', userId);
    if (!user) {
      throw new Error('Foydalanuvchi topilmadi.');
    }

    // Get user roles
    const userRoleLinks = db.find('user_roles', ur => ur.user_id === userId);
    const roleIds = userRoleLinks.map(ur => ur.role_id);
    const roles = db.find('roles', r => roleIds.includes(r.id));

    const isSuperAdmin = roles.some(r => r.name === 'SUPER_ADMIN');

    // Aggregate permissions
    const permissionCodes = new Set<string>();

    if (isSuperAdmin) {
      // Super admin gets all system permissions
      const allPerms = db.getTable('permissions');
      for (const p of allPerms) {
        permissionCodes.add(p.code);
      }
    } else {
      // Find role permissions
      const rolePermLinks = db.find('role_permissions', rp => roleIds.includes(rp.role_id));
      const permIds = rolePermLinks.map(rp => rp.permission_id);
      const perms = db.find('permissions', p => permIds.includes(p.id));
      for (const p of perms) {
        permissionCodes.add(p.code);
      }
    }

    return {
      id: user.id,
      company_id: user.company_id,
      email: user.email,
      full_name: user.full_name,
      phone: user.phone,
      status: user.status,
      roles,
      permissions: Array.from(permissionCodes),
      is_super_admin: isSuperAdmin,
      login: user.login,
      employee_id: user.employee_id || null,
      must_change_password: !!user.must_change_password,
      company_name: db.findById('companies', user.company_id)?.name || ''
    };
  }

  /** Owner-level visibility: sees every staff member's CRM records. */
  public static canSeeAll(userId: string): boolean {
    const d = this.getUserPermissions(userId);
    return d.is_super_admin || d.roles.some(r => r.name === 'ADMIN') || d.permissions.includes('crm:manage');
  }

  public static changePassword(userId: string, currentPassword: string, newPassword: string): void {
    const user = db.findById('users', userId);
    if (!user) throw new Error('Foydalanuvchi topilmadi.');
    if (!bcrypt.compareSync(currentPassword, user.password_hash)) throw new Error('Joriy parol noto‘g‘ri.');
    if (currentPassword === newPassword) throw new Error('Yangi parol eskisidan farq qilsin.');
    const privileged = this.getUserPermissions(userId);
    const minimumLength = privileged.is_super_admin || privileged.roles.some(r => r.name === 'ADMIN') ? 12 : 8;
    if (newPassword.length < minimumLength) throw new Error(`Yangi parol kamida ${minimumLength} belgidan iborat bo‘lsin.`);
    db.update('users', userId, { password_hash: bcrypt.hashSync(newPassword, 12), must_change_password: false });
    AuditService.log({ company_id: user.company_id, user_id: user.id, user_email: user.email, action: 'UPDATE', entity: 'User', entity_id: user.id, old_value: null, new_value: { password_changed: true }, reason: 'Foydalanuvchi parolini almashtirdi' });
  }

  /**
   * Checks if user has a specific permission module:action or dot syntax
   */
  public static hasPermission(
    userId: string, 
    module: PermissionModule | string, 
    action: PermissionAction | string
  ): boolean {
    const userDetails = this.getUserPermissions(userId);
    if (userDetails.is_super_admin) return true;

    const colonCode = `${module}:${action}`;
    const dotCode = `${module}.${action}`;
    return (
      userDetails.permissions.includes(colonCode) ||
      userDetails.permissions.includes(dotCode) ||
      (module === 'expenses' && (userDetails.permissions.includes(`expense:${action}`) || userDetails.permissions.includes(`expense.${action}`))) ||
      (module === 'expense' && (userDetails.permissions.includes(`expenses:${action}`) || userDetails.permissions.includes(`expenses.${action}`))) ||
      userDetails.permissions.includes('*')
    );
  }

  /** Director-level cash control: SUPER_ADMIN, ADMIN or explicit cash:correct. Checks every role, not only the first. */
  public static isCashSupervisor(userId: string): boolean {
    const details = this.getUserPermissions(userId);
    return details.is_super_admin || details.roles.some(r => r.name === 'ADMIN') || this.hasPermission(userId, 'cash', 'correct');
  }

  /**
   * Checks if user has a specific permission code (e.g. 'expenses.confirm' or 'expenses:confirm')
   */
  public static hasPermissionCode(userId: string, code: string): boolean {
    const userDetails = this.getUserPermissions(userId);
    if (userDetails.is_super_admin) return true;
    const colonCode = code.replace('.', ':');
    const dotCode = code.replace(':', '.');
    return (
      userDetails.permissions.includes(code) ||
      userDetails.permissions.includes(colonCode) ||
      userDetails.permissions.includes(dotCode) ||
      (code.startsWith('expenses') && (userDetails.permissions.includes(code.replace('expenses', 'expense')) || userDetails.permissions.includes(colonCode.replace('expenses', 'expense')))) ||
      (code.startsWith('expense') && (userDetails.permissions.includes(code.replace('expense', 'expenses')) || userDetails.permissions.includes(colonCode.replace('expense', 'expenses')))) ||
      userDetails.permissions.includes('*')
    );
  }

  /**
   * Verifies JWT and returns payload
   */
  public static verifyToken(token: string): AuthTokenPayload {
    try {
      const payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }) as AuthTokenPayload;
      const user = db.findById('users', payload.userId);
      if (!user || user.status !== 'ACTIVE' || user.company_id !== payload.companyId) throw new Error('Inactive account');
      return payload;
    } catch {
      throw new Error('Yaroqsiz yoki muddati o\'tgan sessiya tokeni.');
    }
  }

  /**
   * Admin permission management constraint enforcement:
   * "ADMIN boshqa foydalanuvchilarning permissionlarini boshqara olishi kerak,
   * lekin SUPER_ADMIN darajasidagi huquqni faqat SUPER_ADMIN bera olsin."
   */
  public static assignRole(
    operatorUserId: string,
    targetUserId: string,
    targetRoleId: string,
    reason: string
  ): void {
    const operator = this.getUserPermissions(operatorUserId);
    const targetRole = db.findById('roles', targetRoleId);

    const targetUser = db.findById('users', targetUserId);
    if (!targetRole || targetRole.company_id !== operator.company_id) {
      throw new Error('Belgilangan rol topilmadi.');
    }
    if (!targetUser || targetUser.company_id !== operator.company_id) {
      throw new Error('Foydalanuvchi topilmadi.');
    }

    // Check if assigning SUPER_ADMIN role
    if (targetRole.name === 'SUPER_ADMIN' && !operator.is_super_admin) {
      throw new Error('Xavfsizlik qoidasi: SUPER_ADMIN rolini faqat SUPER_ADMIN boshqara oladi.');
    }

    // Check if operator is at least ADMIN
    const canManageRoles = operator.is_super_admin || operator.roles.some(r => r.name === 'ADMIN');
    if (!canManageRoles) {
      throw new Error('Ruxsat cheklangan: Rollarni boshqarish huquqiga ega emassiz.');
    }

    // Check existing link
    const existing = db.findOne('user_roles', ur => ur.user_id === targetUserId && ur.role_id === targetRoleId);
    if (existing) {
      return; // Already assigned
    }

    const newLink: UserRole = {
      id: `ur-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      user_id: targetUserId,
      role_id: targetRoleId
    };
    db.insert('user_roles', newLink);

    AuditService.log({
      company_id: operator.company_id,
      user_id: operator.id,
      user_email: operator.email,
      action: 'UPDATE',
      entity: 'UserRole',
      entity_id: targetUserId,
      old_value: null,
      new_value: { role_id: targetRoleId, role_name: targetRole.name },
      reason
    });
  }

  /**
   * Retrieves full matrix of roles, their assigned permissions, and all system permissions
   */
  public static getRolePermissionsMatrix(companyId: string): {
    roles: Role[];
    permissions: Permission[];
    matrix: Record<string, string[]>; // roleId -> permissionCodes[]
  } {
    const roles = db.find('roles', r => r.company_id === companyId);
    const permissions = db.getTable('permissions');
    const rolePermissions = db.getTable('role_permissions');

    const permMap = new Map<string, Permission>();
    for (const p of permissions) {
      permMap.set(p.id, p);
    }

    const matrix: Record<string, string[]> = {};
    for (const r of roles) {
      if (r.name === 'SUPER_ADMIN') {
        matrix[r.id] = permissions.map(p => p.code);
      } else {
        const assigned = rolePermissions.filter(rp => rp.role_id === r.id);
        matrix[r.id] = assigned.map(rp => permMap.get(rp.permission_id)?.code).filter(Boolean) as string[];
      }
    }

    return { roles, permissions, matrix };
  }

  /**
   * Updates assigned permissions for a given role
   */
  public static updateRolePermissions(
    operatorUserId: string,
    roleId: string,
    permissionCodes: string[],
    reason: string = 'Rol huquqlari qayta sozlandi'
  ): { success: boolean; role: Role; updatedPermissions: string[] } {
    const operator = this.getUserPermissions(operatorUserId);
    const role = db.findById('roles', roleId);

    if (!role || role.company_id !== operator.company_id) {
      throw new Error('Rol topilmadi.');
    }

    if (role.name === 'SUPER_ADMIN') {
      throw new Error('SUPER_ADMIN roli barcha tizim huquqlariga to\'liq ega, uni cheklab bo\'lmaydi.');
    }

    const canManageRoles = operator.is_super_admin || operator.roles.some(r => r.name === 'ADMIN' || (r.name as string) === 'DIRECTOR');
    if (!canManageRoles) {
      throw new Error('Ruxsat cheklangan: Rol huquqlarini o\'zgartirish huquqiga ega emassiz.');
    }

    // Find permission IDs for codes
    const allPermissions = db.getTable('permissions');
    const targetPermIds = new Set<string>();
    for (const code of permissionCodes) {
      const perm = allPermissions.find(p => p.code === code);
      if (perm) {
        targetPermIds.add(perm.id);
      }
    }

    // A non-super admin cannot hand out permissions they do not hold themselves.
    if (!operator.is_super_admin) {
      const extra = permissionCodes.filter(code => !operator.permissions.includes(code));
      if (extra.length) throw new Error(`O'zingizda yo'q huquqni bera olmaysiz: ${extra.join(', ')}`);
    }

    // Replace the role's permissions atomically: a failure leaves the old set intact.
    const existingRolePerms = db.find('role_permissions', rp => rp.role_id === roleId);
    db.transaction(() => {
      for (const erp of existingRolePerms) {
        db.delete('role_permissions', erp.id);
      }
      for (const permId of targetPermIds) {
        const newRp: RolePermission = {
          id: `rp-${randomBytes(8).toString('hex')}`,
          role_id: roleId,
          permission_id: permId
        };
        db.insert('role_permissions', newRp);
      }
    });

    AuditService.log({
      company_id: operator.company_id,
      user_id: operator.id,
      user_email: operator.email,
      action: 'UPDATE',
      entity: 'RolePermission',
      entity_id: roleId,
      old_value: existingRolePerms.map(e => e.permission_id),
      new_value: Array.from(targetPermIds),
      reason
    });

    return {
      success: true,
      role,
      updatedPermissions: permissionCodes
    };
  }
}
