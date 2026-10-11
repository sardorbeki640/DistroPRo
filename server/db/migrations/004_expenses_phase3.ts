import { db } from '../database.ts';
import type { Migration } from '../migrator.ts';
import type { 
  Permission, 
  RolePermission, 
  ExpenseCategory, 
  Employee, 
  EmployeeDailyLimit,
  Salary
} from '../schema.ts';

export const expensesPhase3Migration: Migration = {
  id: '004_expenses_phase3',
  name: 'Phase 3: Expenses module schema, permissions, categories, and employee limits',
  up: async () => {
    const companyId = 'comp-apex-001';
    const now = new Date().toISOString();

    // 1. Phase 3 Permissions
    const expensePermissions: { code: string; action: any; description: string }[] = [
      { code: 'expenses:view', action: 'view', description: 'Xarajatlar ro\'yxati va tafsilotlarini ko\'rish' },
      { code: 'expenses:create', action: 'create', description: 'Yangi xarajat loyihasini (Draft) yaratish' },
      { code: 'expenses:update', action: 'update', description: 'Xarajatlarni tahrirlash va tuzatish' },
      { code: 'expenses:confirm', action: 'confirm', description: 'Xarajatni tasdiqlash va kassaga chiqarish' },
      { code: 'expenses:cancel', action: 'cancel', description: 'Xarajatni bekor qilish' },
      { code: 'expenses:manage_categories', action: 'manage_categories', description: 'Xarajat toifalarini boshqarish va oylik limit belgilash' },
      { code: 'expenses:manage_limits', action: 'manage_limits', description: 'Xodimlar kunlik limitlarini boshqarish' },
      { code: 'expenses:view_employee_expenses', action: 'view_employee_expenses', description: 'Xodimlar kesimidagi xarajatlarni ko\'rish' }
    ];

    for (const ep of expensePermissions) {
      const permId = `perm-${ep.code.replace(':', '-')}`;
      if (!db.findById('permissions', permId)) {
        const perm: Permission = {
          id: permId,
          module: 'expenses',
          action: ep.action,
          code: ep.code,
          description: ep.description
        };
        db.insert('permissions', perm);
      }
    }

    // Also register dot syntax codes if desired so both work identically
    for (const ep of expensePermissions) {
      const dotCode = ep.code.replace(':', '.');
      const dotPermId = `perm-${dotCode.replace('.', '-')}`;
      if (!db.findById('permissions', dotPermId)) {
        db.insert('permissions', {
          id: dotPermId,
          module: 'expenses',
          action: ep.action,
          code: dotCode,
          description: ep.description
        });
      }
    }

    // 2. Assign to roles
    const allPerms = db.getTable('permissions');
    const phase3Perms = allPerms.filter(p => p.code.startsWith('expenses:') || p.code.startsWith('expenses.'));

    // SUPER_ADMIN & ADMIN get ALL
    for (const roleId of ['role-superadmin', 'role-admin']) {
      for (const p of phase3Perms) {
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

    // CASHIER gets view, create, confirm, view_employee_expenses
    const cashierAllowed = [
      'expenses:view', 'expenses.view',
      'expenses:create', 'expenses.create',
      'expenses:confirm', 'expenses.confirm',
      'expenses:view_employee_expenses', 'expenses.view_employee_expenses'
    ];
    for (const p of phase3Perms) {
      if (cashierAllowed.includes(p.code)) {
        const rpId = `rp-role-cashier-${p.id}`;
        if (!db.findById('role_permissions', rpId)) {
          db.insert('role_permissions', {
            id: rpId,
            role_id: 'role-cashier',
            permission_id: p.id
          });
        }
      }
    }

    // AGENT & DELIVERY get view_employee_expenses
    const agentAllowed = ['expenses:view_employee_expenses', 'expenses.view_employee_expenses'];
    for (const roleId of ['role-agent', 'role-delivery']) {
      for (const p of phase3Perms) {
        if (agentAllowed.includes(p.code)) {
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
    }

    // 3. Seed Expense Categories with monthly limits
    const initialCategories: ExpenseCategory[] = [
      {
        id: 'cat-office',
        company_id: companyId,
        name: 'Ofis va Ma\'muriy',
        description: 'Kantselyariya, ofis jihozlari va ma\'muriy xarajatlar',
        monthly_limit: 15_000_000,
        is_active: true,
        created_at: now,
        updated_at: now
      },
      {
        id: 'cat-fuel',
        company_id: companyId,
        name: 'Transport va Yoqilg\'i',
        description: 'Yetkazib berish transporti yoqilg\'isi, texnik xizmat va ta\'mirlash',
        monthly_limit: 25_000_000,
        is_active: true,
        created_at: now,
        updated_at: now
      },
      {
        id: 'cat-food',
        company_id: companyId,
        name: 'Oshxona va Xodimlar ta\'minoti',
        description: 'Kunlik tushlik, choy-qahva va xodimlarga kunlik kompensatsiya',
        monthly_limit: 8_000_000,
        is_active: true,
        created_at: now,
        updated_at: now
      },
      {
        id: 'cat-rent',
        company_id: companyId,
        name: 'Ijara va Kommunal to\'lovlar',
        description: 'Baza va ofis ijarasi, elektr energiya, gaz va suv to\'lovlari',
        monthly_limit: 40_000_000,
        is_active: true,
        created_at: now,
        updated_at: now
      },
      {
        id: 'cat-marketing',
        company_id: companyId,
        name: 'Reklama va Marketing',
        description: 'Tashqi reklama, flayerlar, bannerlar va market promo aksiyalar',
        monthly_limit: 30_000_000,
        is_active: true,
        created_at: now,
        updated_at: now
      },
      {
        id: 'cat-other',
        company_id: companyId,
        name: 'Boshqa kompaniya xarajatlari',
        description: 'Bank komissiyalari, litsenziyalar, aloqa/internet to\'lovlari',
        monthly_limit: 20_000_000,
        is_active: true,
        created_at: now,
        updated_at: now
      }
    ];

    for (const cat of initialCategories) {
      if (!db.findById('expense_categories', cat.id)) {
        db.insert('expense_categories', cat);
      }
    }
  }
};

