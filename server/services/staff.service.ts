import { randomBytes, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { db } from '../db/database.ts';
import { AuthService } from './auth.service.ts';
import { AuditService } from './audit.service.ts';
import { SalaryService } from './salary.service.ts';
import { ExpenseService } from './expense.service.ts';
import { businessToday } from '../utils/date.ts';

// Six digits: easy to say and type on a phone. Guessing is stopped by the sign-in lockout.
function temporaryPassword(): string {
  const bytes = randomBytes(6);
  return Array.from(bytes, b => String(b % 10)).join('');
}

export interface ProfileInput { full_name?: string; phone?: string; position?: string; login?: string; email?: string }

/** Sign-in accounts for staff, attached to their employee card. */
export class StaffService {
  static list(companyId: string) {
    const users = db.find('users', u => u.company_id === companyId);
    const roles = new Map(db.find('roles', r => r.company_id === companyId).map(r => [r.id, r]));
    const userRoles = db.getTable('user_roles');
    return db.find('employees', e => e.company_id === companyId).map(e => {
      const user = users.find(u => u.id === e.user_id || u.employee_id === e.id) || null;
      const agent = db.findOne('agents', a => a.company_id === companyId && a.employee_id === e.id);
      return {
        employee: { id: e.id, full_name: e.full_name, position: e.position, phone: e.phone, status: e.status },
        agent_code: agent?.code || null,
        customers: agent ? db.find('customers', c => c.company_id === companyId && c.agent_id === agent.id).length : 0,
        account: user ? {
          user_id: user.id,
          login: user.login || user.email,
          email: user.email,
          status: user.status,
          roles: userRoles.filter(ur => ur.user_id === user.id).map(ur => roles.get(ur.role_id)).filter(Boolean).map(r => ({ id: r!.id, name: r!.name })),
          must_change_password: !!user.must_change_password,
          last_login_at: user.last_login_at || null
        } : null
      };
    });
  }

  private static assertRoleAllowed(operatorId: string, companyId: string, roleId: string) {
    const role = db.findById('roles', roleId);
    if (!role || role.company_id !== companyId) throw new Error('Rol topilmadi.');
    if (role.name === 'SUPER_ADMIN' && !AuthService.getUserPermissions(operatorId).is_super_admin) throw new Error('SUPER_ADMIN rolini faqat egasi beradi.');
    return role;
  }

  private static assertManageable(operatorId: string, companyId: string, userId: string) {
    const user = db.findById('users', userId);
    if (!user || user.company_id !== companyId) throw new Error('Foydalanuvchi topilmadi.');
    if (user.id === operatorId) throw new Error('O‘z hisobingizni bu yerda o‘zgartira olmaysiz.');
    const target = AuthService.getUserPermissions(userId);
    if (target.is_super_admin && !AuthService.getUserPermissions(operatorId).is_super_admin) throw new Error('Egasi hisobini faqat egasi boshqaradi.');
    return user;
  }

  /**
   * Creates the account with the password the owner typed (or 6 digits); it is shown once. The employee is asked to
   * change it at first sign-in only when the owner ticks that.
   */
  static createAccount(operator: { userId: string; email: string; companyId: string }, employeeId: string, input: { login: string; role_id: string; password?: string; must_change?: boolean }) {
    const employee = db.findById('employees', employeeId);
    if (!employee || employee.company_id !== operator.companyId) throw new Error('Xodim topilmadi.');
    if (employee.user_id && db.findById('users', employee.user_id)) throw new Error('Bu xodimda hisob allaqachon bor.');
    const login = input.login.trim().toLowerCase();
    if (db.findOne('users', u => u.email.toLowerCase() === login || (u.login || '').toLowerCase() === login)) throw new Error('Bu login band. Boshqasini tanlang.');
    const role = this.assertRoleAllowed(operator.userId, operator.companyId, input.role_id);
    const password = input.password || temporaryPassword();
    const now = new Date().toISOString();
    const id = randomUUID();
    db.transaction(() => {
      db.insert('users', {
        id, company_id: operator.companyId, email: login.includes('@') ? login : `${login}@xodim.local`, login,
        password_hash: bcrypt.hashSync(password, 12), full_name: employee.full_name, phone: employee.phone,
        status: 'ACTIVE', employee_id: employee.id, must_change_password: input.must_change === true, created_at: now, updated_at: now
      });
      db.insert('user_roles', { id: randomUUID(), user_id: id, role_id: role.id });
      db.update('employees', employee.id, { user_id: id });
      for (const agent of db.find('agents', a => a.company_id === operator.companyId && a.employee_id === employee.id)) db.update('agents', agent.id, { user_id: id });
    });
    AuditService.log({ company_id: operator.companyId, user_id: operator.userId, user_email: operator.email, action: 'CREATE', entity: 'User', entity_id: id, old_value: null, new_value: { login, role: role.name, employee_id: employee.id }, reason: `Xodimga kirish hisobi berildi: ${employee.full_name}` });
    return { user_id: id, login, role: role.name, temporary_password: password };
  }

  /** A new password: the one the owner typed, or 6 digits. */
  static resetPassword(operator: { userId: string; email: string; companyId: string }, userId: string, input: { password?: string; must_change?: boolean } = {}) {
    const user = this.assertManageable(operator.userId, operator.companyId, userId);
    const password = input.password || temporaryPassword();
    db.update('users', user.id, { password_hash: bcrypt.hashSync(password, 12), must_change_password: input.must_change === true });
    AuditService.log({ company_id: operator.companyId, user_id: operator.userId, user_email: operator.email, action: 'UPDATE', entity: 'User', entity_id: user.id, old_value: null, new_value: { password_reset: true }, reason: `Parol tiklandi: ${user.login || user.email}` });
    return { login: user.login || user.email, temporary_password: password };
  }

  static setStatus(operator: { userId: string; email: string; companyId: string }, userId: string, status: 'ACTIVE' | 'INACTIVE') {
    const user = this.assertManageable(operator.userId, operator.companyId, userId);
    db.update('users', user.id, { status });
    AuditService.log({ company_id: operator.companyId, user_id: operator.userId, user_email: operator.email, action: 'UPDATE', entity: 'User', entity_id: user.id, old_value: { status: user.status }, new_value: { status }, reason: status === 'ACTIVE' ? 'Hisob faollashtirildi' : 'Hisob bloklandi' });
  }

  static setRole(operator: { userId: string; email: string; companyId: string }, userId: string, roleId: string) {
    const user = this.assertManageable(operator.userId, operator.companyId, userId);
    const role = this.assertRoleAllowed(operator.userId, operator.companyId, roleId);
    db.transaction(() => {
      db.removeWhere('user_roles', ur => ur.user_id === user.id);
      db.insert('user_roles', { id: randomUUID(), user_id: user.id, role_id: role.id });
    });
    AuditService.log({ company_id: operator.companyId, user_id: operator.userId, user_email: operator.email, action: 'UPDATE', entity: 'UserRole', entity_id: user.id, old_value: null, new_value: { role: role.name }, reason: `Rol o‘zgartirildi: ${role.name}` });
  }

  // ---------- Profiles ----------

  private static cleanProfile(input: ProfileInput, companyId: string, userId: string | null) {
    const out: ProfileInput = {};
    if (input.full_name !== undefined) {
      const name = input.full_name.trim().replace(/\s+/g, ' ');
      if (name.length < 2 || name.length > 120) throw new Error('Ism 2–120 belgi bo‘lsin.');
      out.full_name = name;
    }
    if (input.phone !== undefined) {
      const phone = input.phone.trim();
      if (phone && !/^\+?[\d\s()\-]{7,20}$/.test(phone)) throw new Error('Telefon raqami noto‘g‘ri (masalan +998 90 123 45 67).');
      out.phone = phone;
    }
    if (input.position !== undefined) {
      const position = input.position.trim();
      if (position.length > 80) throw new Error('Lavozim 80 belgidan oshmasin.');
      out.position = position;
    }
    if (input.login !== undefined) {
      const login = input.login.trim().toLowerCase();
      if (!/^[a-z0-9._@+\-]{3,60}$/.test(login)) throw new Error('Login 3–60 belgi: lotin harflari, raqam, nuqta, chiziqcha.');
      if (db.findOne('users', u => u.id !== userId && ((u.login || '').toLowerCase() === login || u.email.toLowerCase() === login))) throw new Error('Bu login band. Boshqasini tanlang.');
      out.login = login;
    }
    if (input.email !== undefined) {
      const email = input.email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Email noto‘g‘ri.');
      if (db.findOne('users', u => u.id !== userId && (u.email.toLowerCase() === email || (u.login || '').toLowerCase() === email))) throw new Error('Bu email boshqa hisobda bor.');
      out.email = email;
    }
    void companyId;
    return out;
  }

  /** Same name and phone everywhere the person appears: account, employee card, agent. */
  private static applyProfile(companyId: string, userId: string | null, employeeId: string | null, p: ProfileInput) {
    db.transaction(() => {
      if (userId) {
        const patch: any = {};
        for (const k of ['full_name', 'phone', 'login', 'email'] as const) if (p[k] !== undefined) patch[k] = p[k];
        if (Object.keys(patch).length) db.update('users', userId, patch);
      }
      if (employeeId) {
        const patch: any = {};
        for (const k of ['full_name', 'phone', 'position'] as const) if (p[k] !== undefined) patch[k] = p[k];
        if (Object.keys(patch).length) db.update('employees', employeeId, patch);
      }
      for (const agent of db.find('agents', a => a.company_id === companyId && ((!!employeeId && a.employee_id === employeeId) || (!!userId && a.user_id === userId)))) {
        const patch: any = {};
        if (p.full_name !== undefined) patch.full_name = p.full_name;
        if (p.phone !== undefined) patch.phone = p.phone;
        if (Object.keys(patch).length) db.update('agents', agent.id, patch);
      }
    });
  }

  static myProfile(userId: string, companyId: string) {
    const user = db.findById('users', userId)!;
    const employee = user.employee_id ? db.findById('employees', user.employee_id) : db.findOne('employees', e => e.company_id === companyId && e.user_id === userId);
    return { full_name: user.full_name, phone: user.phone || employee?.phone || '', email: user.email, login: user.login || '', position: employee?.position || '', last_login_at: user.last_login_at || null };
  }

  /** Anyone signed in edits their own name, phone, login and email (position is set by the manager). */
  static updateMyProfile(actor: { userId: string; email: string; companyId: string }, input: ProfileInput) {
    const user = db.findById('users', actor.userId);
    if (!user || user.company_id !== actor.companyId) throw new Error('Foydalanuvchi topilmadi.');
    const { position: _ignored, ...rest } = input;
    const p = this.cleanProfile(rest, actor.companyId, user.id);
    const employeeId = user.employee_id || db.findOne('employees', e => e.company_id === actor.companyId && e.user_id === user.id)?.id || null;
    const before = this.myProfile(user.id, actor.companyId);
    this.applyProfile(actor.companyId, user.id, employeeId, p);
    AuditService.log({ company_id: actor.companyId, user_id: actor.userId, user_email: actor.email, action: 'UPDATE', entity: 'UserProfile', entity_id: user.id, old_value: before, new_value: p, reason: 'Foydalanuvchi o‘z profilini o‘zgartirdi' });
    return this.myProfile(user.id, actor.companyId);
  }

  /** The manager edits a staff member's card and account together. The owner's account is changed only by the owner. */
  static updateStaffProfile(operator: { userId: string; email: string; companyId: string }, employeeId: string, input: ProfileInput) {
    const employee = db.findById('employees', employeeId);
    if (!employee || employee.company_id !== operator.companyId) throw new Error('Xodim topilmadi.');
    const user = db.findOne('users', u => u.company_id === operator.companyId && (u.id === employee.user_id || u.employee_id === employee.id));
    if (user && user.id !== operator.userId && AuthService.getUserPermissions(user.id).is_super_admin && !AuthService.getUserPermissions(operator.userId).is_super_admin) {
      throw new Error('Egasi hisobini faqat egasi o‘zgartiradi.');
    }
    if (!user && (input.login !== undefined || input.email !== undefined)) throw new Error('Bu xodimda kirish hisobi yo‘q — avval hisob yarating.');
    const p = this.cleanProfile(input, operator.companyId, user?.id || null);
    const before = { full_name: employee.full_name, phone: employee.phone, position: employee.position, login: user?.login, email: user?.email };
    this.applyProfile(operator.companyId, user?.id || null, employee.id, p);
    AuditService.log({ company_id: operator.companyId, user_id: operator.userId, user_email: operator.email, action: 'UPDATE', entity: 'EmployeeProfile', entity_id: employee.id, old_value: before, new_value: p, reason: `Xodim profili o‘zgartirildi: ${p.full_name || employee.full_name}` });
    return this.list(operator.companyId).find(r => r.employee.id === employee.id);
  }

  /** Personal cabinet: only the signed-in person's own data. */
  static cabinet(userId: string, companyId: string, month?: string) {
    const user = db.findById('users', userId)!;
    const employeeId = user.employee_id || db.findOne('employees', e => e.company_id === companyId && e.user_id === userId)?.id || null;
    const today = businessToday();
    const tasks = db.find('crm_tasks', t => t.company_id === companyId && t.assignee_user_id === userId && (t.status === 'OPEN' || t.status === 'IN_PROGRESS' || (t.completed_at || '') >= `${today.slice(0, 7)}-01`))
      .sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999'));
    const agent = employeeId ? db.findOne('agents', a => a.company_id === companyId && a.employee_id === employeeId) : null;
    const customers = db.find('customers', c => c.company_id === companyId && ((agent && c.agent_id === agent.id) || c.owner_user_id === userId))
      .map(c => ({ id: c.id, name: c.name, phone: c.phone, address: c.address || '', debt: Math.max(0, c.current_balance || 0), credit_limit: c.credit_limit || 0 }))
      .sort((a, b) => b.debt - a.debt);
    let salary: any = null;
    let salaryError: string | null = null;
    if (employeeId) {
      try { salary = SalaryService.getEmployeePersonalCabinet(companyId, employeeId, month || today.slice(0, 7)); }
      catch (err: any) { salaryError = err.message; }
    }
    const monthPrefix = month || today.slice(0, 7);
    const expenses = db.find('expenses', e => e.company_id === companyId && e.created_by === userId && e.date.startsWith(monthPrefix))
      .map(e => ({ id: e.id, date: e.date, amount: e.amount, status: e.status, comment: e.comment, category: db.findById('expense_categories', e.category_id)?.name || 'Xarajat' }));
    return {
      user: { id: user.id, full_name: user.full_name, login: user.login || user.email },
      employee_linked: !!employeeId,
      employee: employeeId ? (() => { const e = db.findById('employees', employeeId); return e ? { full_name: e.full_name, position: e.position } : null; })() : null,
      month: monthPrefix,
      salary,
      salary_error: salaryError,
      tasks,
      overdue_tasks: tasks.filter(t => t.status !== 'DONE' && t.status !== 'CANCELLED' && t.due_date && t.due_date < today).length,
      customers,
      customers_debt_total: customers.reduce((s, c) => s + c.debt, 0),
      expenses,
      expenses_total: expenses.filter(e => e.status !== 'CANCELLED').reduce((s, e) => s + e.amount, 0),
      daily_expense_limit: employeeId ? ExpenseService.dailyLimitOf(employeeId) : null
    };
  }
}
