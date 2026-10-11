import bcrypt from 'bcryptjs';
import { db } from '../database.ts';
import type { Migration } from '../migrator.ts';
import type { User, UserRole } from '../schema.ts';

export const seedInitialDataMigration: Migration = {
  id: '002_seed_initial_users_and_records',
  name: 'Seed Standard Seed Users and User Roles',
  up: async () => {
    const companyId = 'comp-apex-001';

    // 1. Password hashing
    const saltRounds = 10;
    const superAdminHash = bcrypt.hashSync('SuperAdmin123!', saltRounds);
    const adminHash = bcrypt.hashSync('Admin123!', saltRounds);
    const cashierHash = bcrypt.hashSync('Cashier123!', saltRounds);
    const agentHash = bcrypt.hashSync('Agent123!', saltRounds);

    const users: User[] = [
      {
        id: 'usr-superadmin-01',
        company_id: companyId,
        email: 'superadmin@distro.uz',
        password_hash: superAdminHash,
        full_name: 'Akmal Rustamov (Super Admin)',
        phone: '+998 90 123 45 67',
        status: 'ACTIVE',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      },
      {
        id: 'usr-admin-01',
        company_id: companyId,
        email: 'admin@distro.uz',
        password_hash: adminHash,
        full_name: 'Nodira Salimova (Moliyaviy Rahbar)',
        phone: '+998 90 234 56 78',
        status: 'ACTIVE',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      },
      {
        id: 'usr-cashier-01',
        company_id: companyId,
        email: 'cashier@distro.uz',
        password_hash: cashierHash,
        full_name: 'Dilnoza Karimova (Bosh Kassir)',
        phone: '+998 93 345 67 89',
        status: 'ACTIVE',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      },
      {
        id: 'usr-agent-01',
        company_id: companyId,
        email: 'agent@distro.uz',
        password_hash: agentHash,
        full_name: 'Farhod Aliyev (Savdo Agenti)',
        phone: '+998 97 456 78 90',
        status: 'ACTIVE',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }
    ];

    for (const u of users) {
      if (!db.findById('users', u.id)) {
        db.insert('users', u);
      }
    }

    // 2. User Roles mapping
    const userRoles: UserRole[] = [
      { id: 'ur-1', user_id: 'usr-superadmin-01', role_id: 'role-superadmin' },
      { id: 'ur-2', user_id: 'usr-admin-01', role_id: 'role-admin' },
      { id: 'ur-3', user_id: 'usr-cashier-01', role_id: 'role-cashier' },
      { id: 'ur-4', user_id: 'usr-agent-01', role_id: 'role-agent' }
    ];

    for (const ur of userRoles) {
      if (!db.findById('user_roles', ur.id)) {
        db.insert('user_roles', ur);
      }
    }
  }
};
