import type { AuthUser, NavView } from '../types.ts';

export function can(user: AuthUser | null, code: string): boolean {
  if (!user) return false;
  if (user.is_super_admin) return true;
  const [module, action] = code.split(':');
  const alt = module === 'expenses' ? `expense:${action}` : module === 'expense' ? `expenses:${action}` : null;
  return user.permissions.includes(code) || (!!alt && user.permissions.includes(alt));
}

// Which permission opens each page. The server checks the same rights; this only hides pages a person cannot use.
export const VIEW_PERMISSION: Record<NavView, string | null> = {
  dashboard: 'reports:view',
  forecast: 'reports:view',
  cash: 'cash:view',
  daily_files: 'cash:view',
  customers: 'customer:view',
  expenses: 'expenses:view',
  employees: 'employee:view',
  products: 'reports:view',
  reports: 'reports:view',
  balance: 'reports:view',
  integrations: 'integration:view',
  settings: 'settings:view',
  audit: 'settings:view',
  crm: 'crm:view',
  cabinet: null,
  attendance: 'employee:view',
  jarvis: null // owner / admin only, see canOpen
};

/** Owner-level: SUPER_ADMIN or the ADMIN role (the server checks the same). */
export const isOwner = (user: AuthUser | null) => !!user && (user.is_super_admin || user.roles.some(r => r.name === 'ADMIN'));

export const canOpen = (user: AuthUser | null, view: NavView) => {
  if (view === 'jarvis') return isOwner(user);
  const code = VIEW_PERMISSION[view];
  return !!user && (code === null || can(user, code));
};

/** First page after sign-in: the dashboard for managers, the personal cabinet for staff. */
export const homeView = (user: AuthUser | null): NavView => (canOpen(user, 'dashboard') ? 'dashboard' : 'cabinet');
