import type { Kysely } from 'kysely';
import type {
  Database,
  WatcherConfigRow,
  NewWatcherConfig,
  WatcherConfigUpdate,
  PortalSnapshotRow,
  NewPortalSnapshot,
} from '../schema.js';
import type { DiffSeverity } from '@visa-automation/shared';

export class WatcherRepository {
  constructor(private db: Kysely<Database>) {}

  // ============================================
  // Watcher Config
  // ============================================

  async findConfigByTenantId(tenantId: string): Promise<WatcherConfigRow | undefined> {
    return this.db
      .selectFrom('watcher_config')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();
  }

  async createConfig(config: NewWatcherConfig): Promise<WatcherConfigRow> {
    return this.db
      .insertInto('watcher_config')
      .values(config)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async updateConfig(tenantId: string, updates: WatcherConfigUpdate): Promise<WatcherConfigRow | undefined> {
    return this.db
      .updateTable('watcher_config')
      .set({
        ...updates,
        updated_at: new Date(),
      })
      .where('tenant_id', '=', tenantId)
      .returningAll()
      .executeTakeFirst();
  }

  async upsertConfig(tenantId: string, updates: Partial<NewWatcherConfig>): Promise<WatcherConfigRow> {
    const existing = await this.findConfigByTenantId(tenantId);
    
    if (existing) {
      const updated = await this.updateConfig(tenantId, updates);
      return updated!;
    }

    return this.createConfig({
      tenant_id: tenantId,
      ...updates,
    });
  }

  async setEnabled(tenantId: string, enabled: boolean): Promise<WatcherConfigRow | undefined> {
    return this.updateConfig(tenantId, { enabled });
  }

  async updateLastRun(tenantId: string, nextScheduledAt?: Date): Promise<WatcherConfigRow | undefined> {
    return this.db
      .updateTable('watcher_config')
      .set({
        last_run_at: new Date(),
        next_scheduled_at: nextScheduledAt ?? null,
        updated_at: new Date(),
      })
      .where('tenant_id', '=', tenantId)
      .returningAll()
      .executeTakeFirst();
  }

  async findEnabledConfigs(): Promise<WatcherConfigRow[]> {
    return this.db
      .selectFrom('watcher_config')
      .selectAll()
      .where('enabled', '=', true)
      .execute();
  }

  // ============================================
  // Portal Snapshots
  // ============================================

  async findSnapshotById(id: string): Promise<PortalSnapshotRow | undefined> {
    return this.db
      .selectFrom('portal_snapshots')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
  }

  async findLatestSnapshot(tenantId: string, portalId: string): Promise<PortalSnapshotRow | undefined> {
    return this.db
      .selectFrom('portal_snapshots')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('portal_id', '=', portalId)
      .orderBy('captured_at', 'desc')
      .limit(1)
      .executeTakeFirst();
  }

  async findSnapshots(
    tenantId: string,
    options: {
      portalId?: string;
      from?: Date;
      to?: Date;
      severity?: DiffSeverity | DiffSeverity[];
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<PortalSnapshotRow[]> {
    let qb = this.db
      .selectFrom('portal_snapshots')
      .selectAll()
      .where('tenant_id', '=', tenantId);

    if (options.portalId) {
      qb = qb.where('portal_id', '=', options.portalId);
    }

    if (options.from) {
      qb = qb.where('captured_at', '>=', options.from);
    }

    if (options.to) {
      qb = qb.where('captured_at', '<=', options.to);
    }

    if (options.severity) {
      const severities = Array.isArray(options.severity) ? options.severity : [options.severity];
      qb = qb.where('diff_severity', 'in', severities);
    }

    return qb
      .orderBy('captured_at', 'desc')
      .limit(options.limit ?? 50)
      .offset(options.offset ?? 0)
      .execute();
  }

  async createSnapshot(snapshot: NewPortalSnapshot): Promise<PortalSnapshotRow> {
    return this.db
      .insertInto('portal_snapshots')
      .values(snapshot)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async deleteOldSnapshots(tenantId: string, olderThan: Date): Promise<number> {
    const result = await this.db
      .deleteFrom('portal_snapshots')
      .where('tenant_id', '=', tenantId)
      .where('captured_at', '<', olderThan)
      .executeTakeFirst();
    
    return Number(result.numDeletedRows ?? 0n);
  }

  async countSnapshots(tenantId: string, portalId?: string): Promise<number> {
    let qb = this.db
      .selectFrom('portal_snapshots')
      .select(({ fn }) => fn.count<number>('id').as('count'))
      .where('tenant_id', '=', tenantId);

    if (portalId) {
      qb = qb.where('portal_id', '=', portalId);
    }

    const result = await qb.executeTakeFirst();
    return result?.count ?? 0;
  }
}
