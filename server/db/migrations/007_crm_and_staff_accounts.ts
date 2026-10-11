import { db } from '../database.ts';
import type { Migration } from '../migrator.ts';
import type { CrmStage, Permission, PermissionAction } from '../schema.ts';

const CRM_ACTIONS: PermissionAction[] = ['view', 'create', 'update', 'delete', 'manage'];

// Which CRM rights each role gets. "manage" = sees everybody's records and edits pipeline stages.
const ROLE_CRM: Record<string, PermissionAction[]> = {
  SUPER_ADMIN: CRM_ACTIONS,
  ADMIN: CRM_ACTIONS,
  CASHIER: ['view', 'create', 'update'],
  AGENT: ['view', 'create', 'update'],
  DELIVERY: ['view', 'update'],
  EMPLOYEE: ['view', 'update']
};

const DEFAULT_STAGES: Omit<CrmStage, 'id' | 'company_id' | 'created_at'>[] = [
  { name: 'Yangi', sort_order: 1, probability: 10, kind: 'OPEN' },
  { name: 'Aloqa o‘rnatildi', sort_order: 2, probability: 25, kind: 'OPEN' },
  { name: 'Taklif yuborildi', sort_order: 3, probability: 50, kind: 'OPEN' },
  { name: 'Muzokara', sort_order: 4, probability: 75, kind: 'OPEN' },
  { name: 'Yutildi', sort_order: 5, probability: 100, kind: 'WON' },
  { name: 'Yutqazildi', sort_order: 6, probability: 0, kind: 'LOST' }
];

export const crmAndStaffAccountsMigration: Migration = {
  id: '007_crm_and_staff_accounts',
  name: 'CRM (vazifalar, aloqa jurnali, voronka) va xodim kabinetlari',
  up: () => {
    const now = new Date().toISOString();
    // One audit row written by hand on 2026-09-30 used created_at and raw objects; bring it to the audit format.
    for (const log of db.getTable('audit_logs') as any[]) {
      if (!log.timestamp && log.created_at) {
        log.timestamp = log.created_at;
        if (log.new_value && typeof log.new_value !== 'string') log.new_value = JSON.stringify(log.new_value);
      }
    }
    db.transaction(() => {
      for (const action of CRM_ACTIONS) {
        const p: Permission = { id: `perm-crm-${action}`, module: 'crm', action, code: `crm:${action}`, description: `CRM: ${action}` };
        if (!db.findById('permissions', p.id)) db.insert('permissions', p);
      }
      for (const company of db.getTable('companies')) {
        // Self-service role: personal cabinet, own tasks and own contact log only.
        if (!db.findOne('roles', r => r.company_id === company.id && r.name === 'EMPLOYEE')) {
          db.insert('roles', { id: company.id === 'comp-apex-001' ? 'role-employee' : `role-employee-${company.id}`, company_id: company.id, name: 'EMPLOYEE', description: 'Xodim. Faqat o‘z kabineti, vazifalari va mijozlari.', is_system: true, created_at: now });
        }
        for (const role of db.find('roles', r => r.company_id === company.id)) {
          for (const action of ROLE_CRM[role.name] || []) {
            const id = `rp-${role.id}-crm-${action}`;
            if (!db.findById('role_permissions', id)) db.insert('role_permissions', { id, role_id: role.id, permission_id: `perm-crm-${action}` });
          }
        }
        // Orders loaded before this version carry no agent; download the history once more to link agents.
        for (const integration of db.find('integrations', i => i.company_id === company.id && /SALESDOC/.test(i.provider_name.toUpperCase()) && !!i.config?.history)) {
          db.update('integrations', integration.id, { config: { ...integration.config, history: { ...integration.config.history, refetch_all: true } } });
        }
        if (!db.findOne('crm_stages', s => s.company_id === company.id)) {
          DEFAULT_STAGES.forEach((s, i) => db.insert('crm_stages', { ...s, id: `stage-${company.id}-${i + 1}`, company_id: company.id, created_at: now }));
        }
      }
    });
  }
};
