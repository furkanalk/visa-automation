import type { Kysely } from 'kysely';
import type { Database, Tenant, NewTenant, TenantUpdate } from '../schema.js';

export class TenantRepository {
  constructor(private db: Kysely<Database>) {}

  async findById(id: string): Promise<Tenant | undefined> {
    return this.db
      .selectFrom('tenants')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
  }

  async findBySlug(slug: string): Promise<Tenant | undefined> {
    return this.db
      .selectFrom('tenants')
      .selectAll()
      .where('slug', '=', slug)
      .executeTakeFirst();
  }

  async create(tenant: NewTenant): Promise<Tenant> {
    return this.db
      .insertInto('tenants')
      .values(tenant)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async update(id: string, updates: TenantUpdate): Promise<Tenant | undefined> {
    const updateData = {
      ...updates,
      updated_at: new Date(),
    };

    return this.db
      .updateTable('tenants')
      .set(updateData)
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();
  }

  async findAll(status?: 'ACTIVE' | 'SUSPENDED' | 'DELETED'): Promise<Tenant[]> {
    let query = this.db.selectFrom('tenants').selectAll();
    
    if (status) {
      query = query.where('status', '=', status);
    }
    
    return query.orderBy('name', 'asc').execute();
  }
}
