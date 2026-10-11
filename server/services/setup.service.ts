import bcrypt from 'bcryptjs';
import { db } from '../db/database.ts';
import { randomUUID } from 'node:crypto';

export class SetupService {
  static required(): boolean {
    return !db.findById('_migrations', 'local_owner_setup_v1');
  }
  static createOwner(email: string, password: string): void {
    if (!this.required()) throw new Error('Dastlabki sozlash bajarilgan');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200 || password.length < 12 || password.length > 128) throw new Error('Email va kamida 12 belgili parol kiriting');
    if (['SuperAdmin123!', 'Admin123!', 'Cashier123!', 'Agent123!'].includes(password)) throw new Error('Yangi, noyob parol tanlang');
    const company = db.getTable('companies')[0];
    if (!company) throw new Error('Kompaniya topilmadi');
    const role = db.findOne('roles', r => r.company_id === company.id && r.name === 'SUPER_ADMIN');
    if (!role) throw new Error('Administrator roli topilmadi');
    const hash = bcrypt.hashSync(password, 12);
    db.transaction(() => {
      for (const id of ['usr-superadmin-01','usr-admin-01','usr-cashier-01','usr-agent-01']) {
        const user = db.findById('users',id);
        if (user) db.update('users',id,{status:'INACTIVE'});
      }
      if (db.findOne('users', u => u.email.toLowerCase() === email.toLowerCase())) throw new Error('Bu email avval mavjud. Boshqa email tanlang.');
      const id = randomUUID(), now = new Date().toISOString();
      db.insert('users',{id,company_id:company.id,email:email.toLowerCase(),full_name:'Korxona egasi',password_hash:hash,status:'ACTIVE',created_at:now,updated_at:now});
      db.insert('user_roles',{id:randomUUID(),user_id:id,role_id:role.id});
      db.insert('_migrations',{id:'local_owner_setup_v1',name:'Owner account configured',applied_at:now});
    });
  }
}
