import { randomUUID } from 'node:crypto';
import { db } from '../db/database.ts';
import type { SalesTeam } from '../db/schema.ts';
import { AuditService } from './audit.service.ts';

export const OTHER_TEAM = 'other';
const norm = (s: string) => String(s || '').replace(/\s+/g, ' ').trim();

/** Sales teams of a company: which product categories each team sells, and who the team is on each agent profile. */
export class TeamsService {
  static list(company_id: string): SalesTeam[] {
    return db.find('sales_teams', t => t.company_id === company_id).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
  }

  /** All product categories of the company (for choosing), with the team each is in. */
  static view(company_id: string) {
    const teams = this.list(company_id);
    const owner = new Map<string, string>();
    for (const t of teams) for (const c of t.categories) owner.set(c, t.id);
    const categories = Array.from(new Set(db.find('products', p => p.company_id === company_id).map(p => norm(p.category || '')).filter(Boolean))).sort((a, b) => a.localeCompare(b));
    const agents = db.find('agents', a => a.company_id === company_id && a.status !== 'INACTIVE').map(a => ({ id: a.id, name: a.full_name, code: a.code })).sort((a, b) => a.name.localeCompare(b.name));
    const employees = db.find('employees', e => e.company_id === company_id && e.status === 'ACTIVE').map(e => ({ id: e.id, name: e.full_name, position: e.position })).sort((a, b) => a.name.localeCompare(b.name));
    return { teams, categories: categories.map(name => ({ name, team_id: owner.get(name) || null })), agents, employees };
  }

  /**
   * Replaces the company's teams. A category may belong to one team only. A person on a shared agent profile is an
   * employee of their own: member_employees links one (an existing employee, or "NEW" = created from the typed name),
   * so each has their own attendance, pay and cabinet with the sales of their team's categories.
   */
  static save(company_id: string, input: { id?: string; name: string; categories: string[]; members?: Record<string, string>; member_employees?: Record<string, string> }[], actor: { id: string; email: string }) {
    const seen = new Map<string, string>();
    const names = new Set<string>();
    const taken = new Map<string, string>();   // employee -> "agent in team", one place per employee
    const clean = input.map((t, i) => {
      const name = norm(t.name);
      if (!name) throw new Error(`${i + 1}-komanda nomini yozing.`);
      if (names.has(name.toLowerCase())) throw new Error(`“${name}” nomi ikki marta yozilgan.`);
      names.add(name.toLowerCase());
      const categories = Array.from(new Set((t.categories || []).map(norm).filter(Boolean)));
      for (const c of categories) {
        if (seen.has(c)) throw new Error(`“${c}” kategoriyasi ikkita komandada: “${seen.get(c)}” va “${name}”. Bitta komandaga qoldiring.`);
        seen.set(c, name);
      }
      const members = Object.fromEntries(Object.entries(t.members || {}).map(([k, v]) => [k, norm(v).slice(0, 80)]).filter(([, v]) => v));
      const member_employees: Record<string, string> = {};
      for (const [agentId, emp] of Object.entries(t.member_employees || {})) {
        if (!emp) continue;
        const agent = db.findById('agents', agentId);
        if (!agent || agent.company_id !== company_id) throw new Error('Agent profili topilmadi.');
        if (emp === 'NEW') {
          if (!members[agentId]) throw new Error(`“${agent.full_name}” profilidagi “${name}” uchun yangi xodim ismini yozing.`);
          member_employees[agentId] = 'NEW';
          continue;
        }
        const e = db.findById('employees', emp);
        if (!e || e.company_id !== company_id) throw new Error('Xodim topilmadi.');
        const where = `${agent.full_name} — ${name}`;
        if (taken.has(emp)) throw new Error(`${e.full_name} ikki joyga biriktirilgan: “${taken.get(emp)}” va “${where}”.`);
        taken.set(emp, where);
        member_employees[agentId] = emp;
        members[agentId] = e.full_name;
      }
      return { id: t.id, name: name.slice(0, 60), categories, members, member_employees, sort: i };
    });
    const now = new Date().toISOString();
    const created: string[] = [];
    db.transaction(() => {
      // New people become employees (sales agents) before the teams point at them.
      for (const t of clean) for (const [agentId, emp] of Object.entries(t.member_employees)) {
        if (emp !== 'NEW') continue;
        const id = `emp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        db.insert('employees', { id, company_id, full_name: t.members[agentId], position: 'Savdo agenti', phone: '', salary_type: 'PIECEWORK', status: 'ACTIVE', created_at: now } as any);
        t.member_employees[agentId] = id;
        created.push(t.members[agentId]);
      }
      const keep = new Set(clean.map(t => t.id).filter(Boolean));
      db.removeWhere('sales_teams', t => t.company_id === company_id && !keep.has(t.id));
      for (const t of clean) {
        const old = t.id ? db.findById('sales_teams', t.id) : null;
        const fields = { name: t.name, categories: t.categories, members: t.members, member_employees: t.member_employees, sort: t.sort };
        if (old && old.company_id === company_id) db.update('sales_teams', old.id, { ...fields, updated_at: now });
        else db.insert('sales_teams', { id: randomUUID(), company_id, ...fields, created_at: now });
      }
      AuditService.log({ company_id, user_id: actor.id, user_email: actor.email, action: 'UPDATE', entity: 'SalesTeams', entity_id: company_id, old_value: null, new_value: { teams: clean.map(t => `${t.name}: ${t.categories.length} kategoriya, ${Object.keys(t.member_employees).length} xodim`), new_employees: created }, reason: 'Savdo komandalari sozlandi' });
    });
    return { ...this.view(company_id), created };
  }

  /** Where an employee works on shared profiles: the agent profile and the team (with its categories). */
  static placesOf(company_id: string, employee_id: string) {
    const out: { agent_id: string; team_id: string; team_name: string; categories: string[] }[] = [];
    for (const t of this.list(company_id)) for (const [agentId, emp] of Object.entries(t.member_employees || {})) {
      if (emp === employee_id) out.push({ agent_id: agentId, team_id: t.id, team_name: t.name, categories: t.categories });
    }
    return out;
  }

  /** Category -> team id, for splitting sales; unknown categories go to OTHER_TEAM. */
  static teamOfCategory(company_id: string): Map<string, string> {
    const map = new Map<string, string>();
    for (const t of this.list(company_id)) for (const c of t.categories) map.set(norm(c), t.id);
    return map;
  }
}
