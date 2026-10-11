import { randomUUID } from 'node:crypto';
import { db } from '../db/database.ts';

/** The territory with this name (case and spaces ignored), created on first use; null for an empty name. */
export function territoryIdFor(companyId: string, name: string | null | undefined): string | null {
  const clean = String(name || '').replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  const key = clean.toLowerCase();
  const found = db.findOne('territories', t => t.company_id === companyId && String(t.name || '').replace(/\s+/g, ' ').trim().toLowerCase() === key);
  if (found) return found.id;
  return db.insert('territories', { id: randomUUID(), company_id: companyId, name: clean.slice(0, 120), code: clean.slice(0, 40), created_at: new Date().toISOString() }).id;
}
