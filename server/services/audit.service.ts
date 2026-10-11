import { db } from '../db/database.ts';
import type { AuditLog, AuditAction } from '../db/schema.ts';

export interface LogActionParams {
  company_id: string;
  user_id: string;
  user_email: string;
  action: AuditAction;
  entity: string;
  entity_id: string;
  old_value?: any;
  new_value?: any;
  reason?: string | null;
}

export class AuditService {
  /**
   * Records an immutable audit log entry for critical system events.
   */
  public static log(params: LogActionParams): AuditLog {
    const id = `audit-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const record: AuditLog = {
      id,
      company_id: params.company_id,
      user_id: params.user_id,
      user_email: params.user_email,
      action: params.action,
      entity: params.entity,
      entity_id: params.entity_id,
      old_value: params.old_value !== undefined ? JSON.stringify(params.old_value) : null,
      new_value: params.new_value !== undefined ? JSON.stringify(params.new_value) : null,
      reason: params.reason || null,
      timestamp: new Date().toISOString()
    };

    db.insert('audit_logs', record);
    return record;
  }

  /**
   * Retrieves audit logs for a company with optional filters.
   */
  public static getLogs(company_id: string, filters?: {
    entity?: string;
    action?: AuditAction;
    user_id?: string;
    limit?: number;
  }): AuditLog[] {
    const all = db.find('audit_logs', (log) => log.company_id === company_id);

    let filtered = all;
    if (filters?.entity) {
      filtered = filtered.filter(l => l.entity.toLowerCase() === filters.entity!.toLowerCase());
    }
    if (filters?.action) {
      filtered = filtered.filter(l => l.action === filters.action);
    }
    if (filters?.user_id) {
      filtered = filtered.filter(l => l.user_id === filters.user_id);
    }

    // Sort descending by timestamp
    filtered.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    if (filters?.limit) {
      return filtered.slice(0, filters.limit);
    }
    return filtered;
  }
}
