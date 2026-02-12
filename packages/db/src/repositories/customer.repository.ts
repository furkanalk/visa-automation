import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type {
  Database,
  Customer,
  NewCustomer,
  CustomerUpdate,
  CustomerSecret,
  NewCustomerSecret,
  CustomerSecretUpdate,
  CustomerStatus,
} from '../schema.js';

export interface CustomerFilters {
  tenantId: string;
  status?: CustomerStatus | CustomerStatus[];
  portalId?: string;
  profileId?: string;
  tags?: string[];
  priority?: { min?: number; max?: number };
  search?: string;
  limit?: number;
  offset?: number;
}

export interface CustomerWithSecrets extends Customer {
  secrets?: CustomerSecret | null;
}

export class CustomerRepository {
  constructor(private db: Kysely<Database>) {}

  // =====================
  // Customer CRUD
  // =====================

  async findById(tenantId: string, id: string): Promise<Customer | undefined> {
    return this.db
      .selectFrom('customers')
      .selectAll()
      .where('id', '=', id)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();
  }

  async findByIdWithSecrets(tenantId: string, id: string): Promise<CustomerWithSecrets | undefined> {
    const customer = await this.findById(tenantId, id);
    if (!customer) return undefined;

    const secrets = await this.db
      .selectFrom('customer_secrets')
      .selectAll()
      .where('customer_id', '=', id)
      .executeTakeFirst();

    return { ...customer, secrets };
  }

  async findWithFilters(filters: CustomerFilters): Promise<{ items: Customer[]; total: number }> {
    let query = this.db
      .selectFrom('customers')
      .selectAll()
      .where('tenant_id', '=', filters.tenantId);

    // Status filter
    if (filters.status) {
      if (Array.isArray(filters.status)) {
        query = query.where('status', 'in', filters.status);
      } else {
        query = query.where('status', '=', filters.status);
      }
    }

    // Portal filter
    if (filters.portalId) {
      query = query.where('portal_id', '=', filters.portalId);
    }

    // Profile filter
    if (filters.profileId) {
      query = query.where('profile_id', '=', filters.profileId);
    }

    // Tags filter (any match)
    if (filters.tags && filters.tags.length > 0) {
      query = query.where('tags', '&&', filters.tags);
    }

    // Priority range
    if (filters.priority?.min !== undefined) {
      query = query.where('priority', '>=', filters.priority.min);
    }
    if (filters.priority?.max !== undefined) {
      query = query.where('priority', '<=', filters.priority.max);
    }

    // Search (display name or internal ref)
    if (filters.search) {
      const searchTerm = `%${filters.search}%`;
      query = query.where((eb) =>
        eb.or([
          eb('display_name', 'ilike', searchTerm),
          eb('internal_ref', 'ilike', searchTerm),
        ])
      );
    }

    // Count query
    const countResult = await this.db
      .selectFrom('customers')
      .select((eb) => eb.fn.countAll().as('count'))
      .where('tenant_id', '=', filters.tenantId)
      .$if(!!filters.status, (qb) => {
        if (Array.isArray(filters.status)) {
          return qb.where('status', 'in', filters.status!);
        }
        return qb.where('status', '=', filters.status!);
      })
      .$if(!!filters.portalId, (qb) => qb.where('portal_id', '=', filters.portalId!))
      .$if(!!filters.profileId, (qb) => qb.where('profile_id', '=', filters.profileId!))
      .$if(!!filters.search, (qb) => {
        const searchTerm = `%${filters.search}%`;
        return qb.where((eb) =>
          eb.or([
            eb('display_name', 'ilike', searchTerm),
            eb('internal_ref', 'ilike', searchTerm),
          ])
        );
      })
      .executeTakeFirst();

    const total = Number(countResult?.count ?? 0);

    // Apply pagination and ordering
    const items = await query
      .orderBy('priority', 'desc')
      .orderBy('created_at', 'desc')
      .limit(filters.limit ?? 20)
      .offset(filters.offset ?? 0)
      .execute();

    return { items, total };
  }

  async create(customer: NewCustomer): Promise<Customer> {
    return this.db
      .insertInto('customers')
      .values(customer)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async update(tenantId: string, id: string, updates: CustomerUpdate): Promise<Customer | undefined> {
    return this.db
      .updateTable('customers')
      .set(updates)
      .where('id', '=', id)
      .where('tenant_id', '=', tenantId)
      .returningAll()
      .executeTakeFirst();
  }

  async delete(tenantId: string, id: string): Promise<boolean> {
    const result = await this.db
      .deleteFrom('customers')
      .where('id', '=', id)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();
    return (result.numDeletedRows ?? 0) > 0;
  }

  async softDelete(tenantId: string, id: string, updatedBy?: string): Promise<Customer | undefined> {
    return this.update(tenantId, id, {
      status: 'cancelled',
      updated_by: updatedBy,
    });
  }

  // =====================
  // Status Operations
  // =====================

  async pause(tenantId: string, id: string, updatedBy?: string): Promise<Customer | undefined> {
    return this.update(tenantId, id, {
      status: 'paused',
      updated_by: updatedBy,
    });
  }

  async resume(tenantId: string, id: string, updatedBy?: string): Promise<Customer | undefined> {
    return this.update(tenantId, id, {
      status: 'active',
      updated_by: updatedBy,
    });
  }

  async markCompleted(tenantId: string, id: string, updatedBy?: string): Promise<Customer | undefined> {
    return this.update(tenantId, id, {
      status: 'completed',
      updated_by: updatedBy,
    });
  }

  // =====================
  // Secrets CRUD
  // =====================

  async getSecrets(customerId: string): Promise<CustomerSecret | undefined> {
    return this.db
      .selectFrom('customer_secrets')
      .selectAll()
      .where('customer_id', '=', customerId)
      .executeTakeFirst();
  }

  async createSecrets(secrets: NewCustomerSecret): Promise<CustomerSecret> {
    return this.db
      .insertInto('customer_secrets')
      .values(secrets)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async updateSecrets(customerId: string, updates: CustomerSecretUpdate): Promise<CustomerSecret | undefined> {
    return this.db
      .updateTable('customer_secrets')
      .set(updates)
      .where('customer_id', '=', customerId)
      .returningAll()
      .executeTakeFirst();
  }

  async upsertSecrets(customerId: string, secrets: Omit<NewCustomerSecret, 'customer_id'>): Promise<CustomerSecret> {
    const existing = await this.getSecrets(customerId);
    if (existing) {
      const updated = await this.updateSecrets(customerId, secrets);
      return updated!;
    }
    return this.createSecrets({ customer_id: customerId, ...secrets });
  }

  async deleteSecrets(customerId: string): Promise<boolean> {
    const result = await this.db
      .deleteFrom('customer_secrets')
      .where('customer_id', '=', customerId)
      .executeTakeFirst();
    return (result.numDeletedRows ?? 0) > 0;
  }

  // =====================
  // Bulk Operations
  // =====================

  async bulkUpdateStatus(
    tenantId: string,
    ids: string[],
    status: CustomerStatus,
    updatedBy?: string
  ): Promise<number> {
    const result = await this.db
      .updateTable('customers')
      .set({ status, updated_by: updatedBy })
      .where('tenant_id', '=', tenantId)
      .where('id', 'in', ids)
      .executeTakeFirst();
    return Number(result.numUpdatedRows ?? 0);
  }

  async bulkAssignProfile(
    tenantId: string,
    ids: string[],
    profileId: string | null,
    updatedBy?: string
  ): Promise<number> {
    const result = await this.db
      .updateTable('customers')
      .set({ profile_id: profileId, updated_by: updatedBy })
      .where('tenant_id', '=', tenantId)
      .where('id', 'in', ids)
      .executeTakeFirst();
    return Number(result.numUpdatedRows ?? 0);
  }

  // =====================
  // Stats & Queries
  // =====================

  async countByTenant(tenantId: string): Promise<Record<CustomerStatus, number>> {
    const result = await this.db
      .selectFrom('customers')
      .select(['status', (eb) => eb.fn.countAll().as('count')])
      .where('tenant_id', '=', tenantId)
      .groupBy('status')
      .execute();

    const counts: Record<CustomerStatus, number> = {
      active: 0,
      paused: 0,
      completed: 0,
      cancelled: 0,
    };

    for (const row of result) {
      counts[row.status as CustomerStatus] = Number(row.count);
    }

    return counts;
  }

  async getActiveForScheduling(tenantId: string, portalId?: string): Promise<Customer[]> {
    let query = this.db
      .selectFrom('customers')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('status', '=', 'active');

    if (portalId) {
      query = query.where('portal_id', '=', portalId);
    }

    return query
      .orderBy('priority', 'desc')
      .orderBy('last_job_at', 'asc') // Oldest first
      .execute();
  }

  async updateLastJobAt(tenantId: string, id: string): Promise<void> {
    await this.db
      .updateTable('customers')
      .set({
        last_job_at: new Date(),
        total_jobs: sql`total_jobs + 1`,
      })
      .where('id', '=', id)
      .where('tenant_id', '=', tenantId)
      .execute();
  }

  async updateLastSlotFound(tenantId: string, id: string): Promise<void> {
    await this.db
      .updateTable('customers')
      .set({ last_slot_found_at: new Date() })
      .where('id', '=', id)
      .where('tenant_id', '=', tenantId)
      .execute();
  }

  async incrementSuccessfulBookings(tenantId: string, id: string): Promise<void> {
    await this.db
      .updateTable('customers')
      .set({
        successful_bookings: sql`successful_bookings + 1`,
      })
      .where('id', '=', id)
      .where('tenant_id', '=', tenantId)
      .execute();
  }

  // =====================
  // Redacted View (for Staff)
  // =====================

  async getRedactedView(tenantId: string, id: string): Promise<Partial<Customer> | undefined> {
    const customer = await this.findById(tenantId, id);
    if (!customer) return undefined;

    // Redact sensitive fields
    return {
      id: customer.id,
      tenant_id: customer.tenant_id,
      display_name: customer.display_name,
      internal_ref: customer.internal_ref,
      tags: customer.tags,
      portal_id: customer.portal_id,
      status: customer.status,
      priority: customer.priority,
      // Redacted contact info
      notify_email: customer.notify_email ? this.redactEmail(customer.notify_email) : null,
      notify_phone: customer.notify_phone ? this.redactPhone(customer.notify_phone) : null,
      notify_telegram_chat_id: null, // Hidden
      // Preferences visible
      preferences: customer.preferences,
      flags: customer.flags,
      // Stats
      total_jobs: customer.total_jobs,
      successful_bookings: customer.successful_bookings,
      last_job_at: customer.last_job_at,
      last_slot_found_at: customer.last_slot_found_at,
      created_at: customer.created_at,
    };
  }

  private redactEmail(email: string): string {
    const [local, domain] = email.split('@');
    if (!local || !domain) return '***@***.***';
    const redactedLocal = local.length > 2 
      ? local[0] + '***' + local[local.length - 1]
      : '***';
    return `${redactedLocal}@${domain}`;
  }

  private redactPhone(phone: string): string {
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 4) return '****';
    return phone.slice(0, 4) + ' *** ** ' + phone.slice(-2);
  }
}
