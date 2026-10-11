import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { db } from '../db/database.ts';
import { initialSchemaMigration } from '../db/migrations/001_initial_schema.ts';
import { crmAndStaffAccountsMigration } from '../db/migrations/007_crm_and_staff_accounts.ts';
import { AuthService } from '../services/auth.service.ts';
import { StaffService } from '../services/staff.service.ts';
import { CrmService } from '../services/crm.service.ts';
import { businessToday, addDays } from '../utils/date.ts';

const C = 'comp-apex-001';
const today = businessToday();
let owner: { userId: string; email: string; companyId: string };

beforeEach(async () => {
  db.init(); db.reset();
  await initialSchemaMigration.up();
  crmAndStaffAccountsMigration.up();
  const now = new Date().toISOString();
  db.insert('users', { id: 'owner', company_id: C, email: 'owner@example.test', full_name: 'Egasi', password_hash: bcrypt.hashSync('Owner-pass-1', 4), status: 'ACTIVE', created_at: now, updated_at: now } as any);
  db.insert('user_roles', { id: 'ur-owner', user_id: 'owner', role_id: 'role-superadmin' });
  owner = { userId: 'owner', email: 'owner@example.test', companyId: C };
  for (const [id, name] of [['e1', 'Ali'], ['e2', 'Vali']]) db.insert('employees', { id, company_id: C, full_name: name, position: 'Agent', phone: '', salary_type: 'FIXED', status: 'ACTIVE', created_at: now } as any);
  db.insert('agents', { id: 'a1', company_id: C, employee_id: 'e1', code: 'd0_1', full_name: 'Ali', phone: '', commission_rate: 0, status: 'ACTIVE', created_at: now } as any);
  db.insert('customers', { id: 'k1', company_id: C, code: 'K1', name: 'Alining mijozi', phone: '901', agent_id: 'a1', current_balance: 500, credit_limit: 0, status: 'ACTIVE', is_active: true, created_at: now } as any);
  db.insert('customers', { id: 'k2', company_id: C, code: 'K2', name: 'Boshqa mijoz', phone: '902', current_balance: 0, credit_limit: 0, status: 'ACTIVE', is_active: true, created_at: now } as any);
});

function staff(employeeId: string, login: string) {
  const acc = StaffService.createAccount(owner, employeeId, { login, role_id: 'role-employee' });
  const actor = { userId: acc.user_id, email: `${login}@xodim.local`, companyId: C };
  return { acc, actor };
}

test('owner gives a staff login with a short password; changing it at first sign-in is optional; login works by short login', async () => {
  const { acc } = staff('e1', '901234567');
  assert.match(acc.temporary_password, /^\d{6}$/, 'six digits when the owner leaves the password empty');
  const first = await AuthService.login('901234567', acc.temporary_password);
  assert.equal(first.user.must_change_password, false, 'no forced change unless the owner asks');
  assert.equal(first.user.employee_id, 'e1');
  assert.throws(() => AuthService.changePassword(acc.user_id, 'wrong', 'NewPass-2026'), /noto/);
  assert.throws(() => AuthService.changePassword(acc.user_id, acc.temporary_password, '123'), /6 belgi/);
  AuthService.changePassword(acc.user_id, acc.temporary_password, '777888');
  assert.equal((await AuthService.login('901234567', '777888')).user.must_change_password, false);
  // The owner may type the password and ask for a change at first sign-in.
  db.insert('employees', { id: 'e4', company_id: C, full_name: 'D', position: 'x', phone: '', salary_type: 'FIXED', status: 'ACTIVE', created_at: today } as any);
  const typed = StaffService.createAccount(owner, 'e4', { login: 'dilshod', role_id: 'role-employee', password: 'dil2026', must_change: true });
  assert.equal(typed.temporary_password, 'dil2026');
  assert.equal((await AuthService.login('dilshod', 'dil2026')).user.must_change_password, true);
  assert.throws(() => StaffService.createAccount(owner, 'e2', { login: '901234567', role_id: 'role-employee' }), /band/);
  assert.throws(() => StaffService.createAccount(owner, 'e1', { login: 'ali2', role_id: 'role-employee' }), /allaqachon/);
  assert.equal(db.findById('agents', 'a1')!.user_id, acc.user_id, 'agent card linked to the account');
});

test('an admin cannot hand out owner rights; blocked account cannot sign in; reset issues a new temporary password', async () => {
  const { acc: admin } = staff('e2', 'vali');
  StaffService.setRole(owner, admin.user_id, 'role-admin');
  const adminActor = { userId: admin.user_id, email: 'vali@xodim.local', companyId: C };
  db.insert('employees', { id: 'e3', company_id: C, full_name: 'G', position: 'x', phone: '', salary_type: 'FIXED', status: 'ACTIVE', created_at: today } as any);
  assert.throws(() => StaffService.createAccount(adminActor, 'e3', { login: 'g1', role_id: 'role-superadmin' }), /SUPER_ADMIN/);
  assert.throws(() => StaffService.setStatus(adminActor, 'owner', 'INACTIVE'), /egasi/i);
  StaffService.setStatus(owner, admin.user_id, 'INACTIVE');
  await assert.rejects(() => AuthService.login('vali', admin.temporary_password), /bloklangan/);
  StaffService.setStatus(owner, admin.user_id, 'ACTIVE');
  const reset = StaffService.resetPassword(owner, admin.user_id, { password: 'vali-new1' });
  assert.equal(reset.temporary_password, 'vali-new1');
  await assert.rejects(() => AuthService.login('vali', admin.temporary_password), /noto/, 'the old password stops working');
  assert.equal((await AuthService.login('vali', 'vali-new1')).user.must_change_password, false);
  assert.match(StaffService.resetPassword(owner, admin.user_id).temporary_password, /^\d{6}$/);
});

test('a short password cannot be guessed from many addresses: 20 wrong tries lock the login everywhere', async () => {
  const { acc } = staff('e1', 'sardor');
  for (let i = 0; i < 20; i++) await assert.rejects(() => AuthService.login('sardor', String(100000 + i), `10.0.0.${i}`));
  await assert.rejects(() => AuthService.login('sardor', acc.temporary_password, '10.9.9.9'), /urinish/);
});

test('ten wrong passwords lock the login for a while', async () => {
  const { acc } = staff('e1', 'ali');
  for (let i = 0; i < 10; i++) await assert.rejects(() => AuthService.login('ali', 'wrong-pass', '1.2.3.4'));
  await assert.rejects(() => AuthService.login('ali', acc.temporary_password, '1.2.3.4'), /urinish/);
  assert.ok(await AuthService.login('ali', acc.temporary_password, '5.6.7.8'), 'another device is not locked');
});

test('staff see only their own customers, tasks and deals; the owner sees everything', () => {
  const { actor: ali } = staff('e1', 'ali');
  const { actor: vali } = staff('e2', 'vali');
  assert.deepEqual(CrmService.searchCustomers(ali, '').map(c => c.id), ['k1']);
  assert.equal(CrmService.searchCustomers(vali, '').length, 0);
  assert.equal(CrmService.searchCustomers(owner, '').length, 2);
  assert.throws(() => CrmService.customerOverview(vali, 'k1'), /topilmadi/);
  assert.equal(CrmService.customerOverview(ali, 'k1').debt.total, 500);

  CrmService.createTask(ali, { title: 'Qarzni eslatish', customer_id: 'k1', due_date: today });
  assert.throws(() => CrmService.createTask(ali, { title: 'Valiga', assignee_user_id: vali.userId }), /rahbar/);
  CrmService.createTask(owner, { title: 'Valiga vazifa', assignee_user_id: vali.userId, due_date: addDays(today, -1) });
  assert.equal(CrmService.listTasks(ali, {}).length, 1);
  assert.equal(CrmService.listTasks(vali, {})[0].overdue, true);
  assert.equal(CrmService.listTasks(owner, { scope: 'all' }).length, 2);
  const valiTask = CrmService.listTasks(vali, {})[0];
  assert.throws(() => CrmService.updateTask(ali, valiTask.id, { status: 'DONE' }), /tegishli emas/);
  assert.equal(CrmService.updateTask(vali, valiTask.id, { status: 'DONE' }).status, 'DONE');
});

test('a planned next step in the contact log becomes a task', () => {
  const { actor: ali } = staff('e1', 'ali');
  const activity = CrmService.logActivity(ali, { customer_id: 'k1', type: 'CALL', result: 'PAYMENT_PROMISE', note: 'Juma kuni to‘laydi', next_step: 'To‘lovni tekshirish', next_action_date: addDays(today, 2) });
  const task = db.findById('crm_tasks', activity.follow_up_task_id!)!;
  assert.equal(task.assignee_user_id, ali.userId);
  assert.equal(task.due_date, addDays(today, 2));
  assert.throws(() => CrmService.logActivity(ali, { customer_id: 'k2', type: 'CALL', result: 'REACHED', note: 'begona mijoz' }), /topilmadi/);
  assert.equal(CrmService.customerOverview(owner, 'k1').activities.length, 1);
});

test('pipeline: stages from settings, lost needs a reason, weighted value by probability', () => {
  const { actor: ali } = staff('e1', 'ali');
  const stages = CrmService.stages(C);
  assert.equal(stages.length, 6);
  const deal = CrmService.saveDeal(ali, { title: 'Yangi do‘kon', contact_name: 'Jasur', contact_phone: '90', amount: 1_000_000 });
  assert.equal(deal.status, 'OPEN');
  const offer = stages.find(s => s.name === 'Taklif yuborildi')!;
  CrmService.saveDeal(ali, { stage_id: offer.id }, deal.id);
  const summary = CrmService.listDeals(ali, {}).summary.find(s => s.stage_id === offer.id)!;
  assert.equal(summary.weighted, 500_000);
  const lost = stages.find(s => s.kind === 'LOST')!;
  assert.throws(() => CrmService.saveDeal(ali, { stage_id: lost.id }, deal.id), /sabab/);
  assert.equal(CrmService.saveDeal(ali, { stage_id: lost.id, lost_reason: 'Narx qimmat' }, deal.id).status, 'LOST');
  assert.throws(() => CrmService.saveStage(ali, { name: 'X', probability: 10, kind: 'OPEN' }), /rahbar/);
  assert.throws(() => CrmService.deleteStage(owner, lost.id), /bitimlar bor/);
});

test('personal cabinet shows only own customers, tasks and expenses', () => {
  const { actor: ali } = staff('e1', 'ali');
  CrmService.createTask(ali, { title: 'Bugungi tashrif', due_date: today });
  const cabinet = StaffService.cabinet(ali.userId, C);
  assert.equal(cabinet.employee_linked, true);
  assert.deepEqual(cabinet.customers.map(c => c.id), ['k1']);
  assert.equal(cabinet.customers_debt_total, 500);
  assert.equal(cabinet.tasks.length, 1);
});
