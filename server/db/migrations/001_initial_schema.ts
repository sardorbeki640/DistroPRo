import bcrypt from 'bcryptjs';
import { db } from '../database.ts';
import type { Migration } from '../migrator.ts';
import type { 
  Company, 
  Role, 
  Permission, 
  PermissionModule, 
  PermissionAction, 
  RolePermission, 
  Territory, 
  CashRegister,
  ExpenseCategory,
  Integration
} from '../schema.ts';

export const initialSchemaMigration: Migration = {
  id: '001_initial_schema_and_rbac',
  name: 'Initialize Master Companies, RBAC Matrix, Categories and Registers',
  up: async () => {
    // 1. Master Company
    const companyId = 'comp-apex-001';
    const existingCompany = db.findById('companies', companyId);
    if (!existingCompany) {
      const company: Company = {
        id: companyId,
        name: 'Apex Distribution LLC',
        tax_id: '309876541',
        currency: 'UZS',
        address: 'Toshkent sh., Chilonzor tumani, Bunyodkor shoh ko\'chasi, 42-uy',
        phone: '+998 71 200 44 88',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      db.insert('companies', company);
    }

    // 2. Roles
    const roles: Role[] = [
      {
        id: 'role-superadmin',
        company_id: companyId,
        name: 'SUPER_ADMIN',
        description: 'Tizimning to\'liq boshqaruvchisi. Barcha huquqlarga ega.',
        is_system: true,
        created_at: new Date().toISOString()
      },
      {
        id: 'role-admin',
        company_id: companyId,
        name: 'ADMIN',
        description: 'Tashkilot administratori. Xodimlar va kundalik boshqaruv huquqiga ega.',
        is_system: true,
        created_at: new Date().toISOString()
      },
      {
        id: 'role-cashier',
        company_id: companyId,
        name: 'CASHIER',
        description: 'Kassir. Kassa kunlarini ochish/yopish va to\'lovlarni qabul qilish.',
        is_system: true,
        created_at: new Date().toISOString()
      },
      {
        id: 'role-agent',
        company_id: companyId,
        name: 'AGENT',
        description: 'Savdo agenti. Buyurtmalar va mijoz balansini kuzatish.',
        is_system: true,
        created_at: new Date().toISOString()
      },
      {
        id: 'role-delivery',
        company_id: companyId,
        name: 'DELIVERY',
        description: 'Yetkazib beruvchi / haydovchi. Buyurtma yetkazish va qabul.',
        is_system: true,
        created_at: new Date().toISOString()
      }
    ];

    for (const r of roles) {
      if (!db.findById('roles', r.id)) {
        db.insert('roles', r);
      }
    }

    // 3. Permissions Matrix: module + action
    const modules: PermissionModule[] = [
      'cash',
      'expense',
      'customer',
      'balance',
      'employee',
      'salary',
      'reports',
      'integration',
      'settings'
    ];

    const actions: PermissionAction[] = [
      'view',
      'create',
      'update',
      'delete',
      'close',
      'export',
      'import'
    ];

    const permissions: Permission[] = [];
    for (const m of modules) {
      for (const a of actions) {
        permissions.push({
          id: `perm-${m}-${a}`,
          module: m,
          action: a,
          code: `${m}:${a}`,
          description: `${m.toUpperCase()} modulida "${a.toUpperCase()}" amalini bajarish`
        });
      }
    }

    for (const p of permissions) {
      if (!db.findById('permissions', p.id)) {
        db.insert('permissions', p);
      }
    }

    // 4. Role-Permission mappings
    // SUPER_ADMIN gets all permissions
    for (const p of permissions) {
      const rpId = `rp-superadmin-${p.id}`;
      if (!db.findById('role_permissions', rpId)) {
        db.insert('role_permissions', {
          id: rpId,
          role_id: 'role-superadmin',
          permission_id: p.id
        });
      }
    }

    // ADMIN gets all except deleting audit or changing superadmin
    for (const p of permissions) {
      const rpId = `rp-admin-${p.id}`;
      if (!db.findById('role_permissions', rpId)) {
        db.insert('role_permissions', {
          id: rpId,
          role_id: 'role-admin',
          permission_id: p.id
        });
      }
    }

    // CASHIER permissions
    const cashierCodes = [
      'cash:view', 'cash:create', 'cash:update', 'cash:close', 'cash:export',
      'customer:view', 'customer:create',
      'balance:view', 'balance:create',
      'expense:view', 'expense:create',
      'reports:view'
    ];
    for (const code of cashierCodes) {
      const perm = permissions.find(p => p.code === code);
      if (perm) {
        const rpId = `rp-cashier-${perm.id}`;
        if (!db.findById('role_permissions', rpId)) {
          db.insert('role_permissions', {
            id: rpId,
            role_id: 'role-cashier',
            permission_id: perm.id
          });
        }
      }
    }

    // AGENT permissions
    const agentCodes = [
      'customer:view', 'customer:create',
      'balance:view',
      'reports:view'
    ];
    for (const code of agentCodes) {
      const perm = permissions.find(p => p.code === code);
      if (perm) {
        const rpId = `rp-agent-${perm.id}`;
        if (!db.findById('role_permissions', rpId)) {
          db.insert('role_permissions', {
            id: rpId,
            role_id: 'role-agent',
            permission_id: perm.id
          });
        }
      }
    }

    // 5. Territory & Cash Register
    const territory: Territory = {
      id: 'terr-tashkent-01',
      company_id: companyId,
      name: 'Toshkent Markaziy Hudud',
      code: 'TERR-TAS-01',
      description: 'Chilonzor, Shayxontohur va Yakkasaroy savdo nuqtalari',
      created_at: new Date().toISOString()
    };
    if (!db.findById('territories', territory.id)) {
      db.insert('territories', territory);
    }

    const cashRegister: CashRegister = {
      id: 'reg-main-01',
      company_id: companyId,
      name: 'Asosiy Bosh Kassa №1',
      code: 'REG-MAIN-01',
      currency: 'UZS',
      status: 'ACTIVE',
      created_at: new Date().toISOString()
    };
    if (!db.findById('cash_registers', cashRegister.id)) {
      db.insert('cash_registers', cashRegister);
    }

    // 6. Expense categories
    const now = new Date().toISOString();
    const categories: ExpenseCategory[] = [
      { id: 'exp-cat-logistics', company_id: companyId, name: 'Logistika va Yoqilg\'i', code: 'LOGISTICS', monthly_limit: 15_000_000, is_active: true, created_at: now, updated_at: now },
      { id: 'exp-cat-office', company_id: companyId, name: 'Ofis va Ma\'muriy xarajatlar', code: 'OFFICE', monthly_limit: 8_000_000, is_active: true, created_at: now, updated_at: now },
      { id: 'exp-cat-marketing', company_id: companyId, name: 'Marketing va Reklama', code: 'MARKETING', monthly_limit: 10_000_000, is_active: true, created_at: now, updated_at: now },
      { id: 'exp-cat-salary', company_id: companyId, name: 'Xodimlar Oylik Maoshi', code: 'SALARY', monthly_limit: 50_000_000, is_active: true, created_at: now, updated_at: now },
      { id: 'exp-cat-misc', company_id: companyId, name: 'Boshqa xo\'jalik xarajatlari', code: 'MISCELLANEOUS', monthly_limit: 5_000_000, is_active: true, created_at: now, updated_at: now }
    ];
    for (const cat of categories) {
      if (!db.findById('expense_categories', cat.id)) {
        db.insert('expense_categories', cat);
      }
    }

    // 7. Integration registrations (Adapter foundation)
    const integrations: Integration[] = [
      {
        id: 'integ-1c-01',
        company_id: companyId,
        provider_type: 'DISTRIBUTION',
        provider_name: '1C_ENTERPRISE_ERP',
        status: 'CONNECTED',
        config: {
          endpoint: 'https://erp.distro-apex.uz/api/v2/finance',
          auto_sync_interval_mins: 15,
          sync_orders: true,
          sync_returns: true
        },
        last_sync_at: new Date().toISOString(),
        created_at: new Date().toISOString()
      },
      {
        id: 'integ-excel-01',
        company_id: companyId,
        provider_type: 'EXCEL',
        provider_name: 'EXCEL_ADAPTER',
        status: 'CONNECTED',
        config: {
          supported_formats: ['.xlsx', '.xls', '.csv'],
          template_version: '2026.1'
        },
        last_sync_at: new Date().toISOString(),
        created_at: new Date().toISOString()
      },
      {
        id: 'integ-manual-01',
        company_id: companyId,
        provider_type: 'MANUAL',
        provider_name: 'MANUAL_OPERATOR_ADAPTER',
        status: 'CONNECTED',
        config: {
          audit_mandatory_reason: true
        },
        last_sync_at: new Date().toISOString(),
        created_at: new Date().toISOString()
      },
      {
        id: 'integ-salesdoc-01',
        company_id: companyId,
        provider_type: 'DISTRIBUTION',
        provider_name: 'SALESDOC',
        status: 'DISCONNECTED',
        config: {
          auth_type: 'SERVER_CREDENTIALS',
          server_url: 'https://server.salesdoctor.uz/api/v2',
          sync_interval: '1h',
          auto_sync: false
        },
        last_sync_at: null,
        created_at: new Date().toISOString()
      }
    ];
    for (const integ of integrations) {
      if (!db.findById('integrations', integ.id)) {
        db.insert('integrations', integ);
      }
    }
  }
};
