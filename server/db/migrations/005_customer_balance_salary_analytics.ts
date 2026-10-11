import { db } from '../database.ts';
import type { Migration } from '../migrator.ts';
import type { 
  Permission, 
  RolePermission,
  Product,
  SalesOrder,
  SalesOrderItem,
  NotificationChannel,
  NotificationRule,
  SalaryRule,
  PieceworkRule,
  PieceworkTransaction,
  CustomerBalanceTransaction
} from '../schema.ts';

export const customerBalanceSalaryAnalyticsMigration: Migration = {
  id: '005_customer_balance_salary_analytics',
  name: 'Phase 4-8: Customer Ledger, Payroll, COGS Profit Analytics, and Notification Channels',
  up: async () => {
    const companyId = 'comp-apex-001';
    const now = new Date().toISOString();
    const today = now.slice(0, 10);

    // 1. Register Permissions
    const newPermissions: { module: any; action: any; code: string; description: string }[] = [
      // Salary
      { module: 'salary', action: 'view', code: 'salary:view', description: 'Oylik maosh vedomostlarini ko\'rish' },
      { module: 'salary', action: 'create', code: 'salary:create', description: 'Oylik maosh hisob-kitobini shakllantirish' },
      { module: 'salary', action: 'update', code: 'salary:update', description: 'Oylik maosh va stavkalarni tahrirlash' },
      { module: 'salary', action: 'approve', code: 'salary:approve', description: 'Oylik maoshni tasdiqlash' },
      { module: 'salary', action: 'pay', code: 'salary:pay', description: 'Oylik maoshni to\'lash va kassadan chiqarish' },

      // Piecework
      { module: 'piecework', action: 'view', code: 'piecework:view', description: 'Ishbay bajarilgan ishlarni ko\'rish' },
      { module: 'piecework', action: 'create', code: 'piecework:create', description: 'Ishbay hajm va stavkalarni kiritish' },

      // Customer Balance & Reconciliation (Akt Sverka)
      { module: 'balance', action: 'view', code: 'balance:view', description: 'Mijozlar balansi va Akt Sverkani ko\'rish' },
      { module: 'balance', action: 'create', code: 'balance:create', description: 'Mijoz to\'lovi va kun surishni qayd qilish' },
      { module: 'balance', action: 'update', code: 'balance:update', description: 'Mijoz balansiga rasmiy tuzatish kiritish' },
      { module: 'balance', action: 'reconcile', code: 'balance:reconcile', description: 'Akt Sverka bo\'yicha solishtirma o\'tkazish' },

      // Sales & COGS
      { module: 'sales', action: 'view', code: 'sales:view', description: 'Savdo buyurtmalari va tannarxni ko\'rish' },
      { module: 'sales', action: 'create', code: 'sales:create', description: 'Yangi savdo buyurtmasi kiritish' },

      // Profit & Analytics
      { module: 'profit', action: 'view', code: 'profit:view', description: 'Yalpi foyda va P&L moliyaviy hisobotini ko\'rish' },

      // Notifications
      { module: 'notifications', action: 'view', code: 'notifications:view', description: 'Tizim va Telegram bildirishnomalarini ko\'rish' },
      { module: 'notifications', action: 'create', code: 'notifications:create', description: 'Bildirishnoma kanallari va qoidalarini sozlash' }
    ];

    for (const p of newPermissions) {
      const permId = `perm-${p.code.replace(':', '-')}`;
      if (!db.findById('permissions', permId)) {
        db.insert('permissions', {
          id: permId,
          module: p.module,
          action: p.action,
          code: p.code,
          description: p.description
        });
      }
    }

    // Role Assignments
    const superAdminRole = 'role-superadmin';
    const adminRole = 'role-admin';
    const cashierRole = 'role-cashier';
    const agentRole = 'role-agent';

    const insertedPerms = db.find('permissions', p => 
      ['salary', 'piecework', 'balance', 'sales', 'profit', 'notifications'].includes(p.module)
    );

    // SuperAdmin & Admin get ALL
    for (const roleId of [superAdminRole, adminRole]) {
      for (const p of insertedPerms) {
        const rpId = `rp-${roleId}-${p.id}`;
        if (!db.findById('role_permissions', rpId)) {
          db.insert('role_permissions', {
            id: rpId,
            role_id: roleId,
            permission_id: p.id
          });
        }
      }
    }

    // Cashier gets salary:view, salary:pay, balance:view, balance:create, reports:view
    const cashierAllowed = ['salary:view', 'salary:pay', 'balance:view', 'balance:create'];
    for (const p of insertedPerms) {
      if (cashierAllowed.includes(p.code)) {
        const rpId = `rp-${cashierRole}-${p.id}`;
        if (!db.findById('role_permissions', rpId)) {
          db.insert('role_permissions', {
            id: rpId,
            role_id: cashierRole,
            permission_id: p.id
          });
        }
      }
    }

    // Agent gets balance:view, balance:create
    const agentAllowed = ['balance:view', 'balance:create'];
    for (const p of insertedPerms) {
      if (agentAllowed.includes(p.code)) {
        const rpId = `rp-${agentRole}-${p.id}`;
        if (!db.findById('role_permissions', rpId)) {
          db.insert('role_permissions', {
            id: rpId,
            role_id: agentRole,
            permission_id: p.id
          });
        }
      }
    }
  }
};

