import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type {
  Database,
  WatcherConfigRow,
  NewWatcherConfig,
  WatcherConfigUpdate,
  WatcherRunHistoryRow,
  NewWatcherRunHistory,
  PortalSnapshotRow,
  PortalSnapshotUpdate,
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
    const values: Record<string, unknown> = { ...config };
    if (Array.isArray(values.portals)) {
      values.portals = sql`${JSON.stringify(values.portals)}::jsonb`;
    }
    return this.db
      .insertInto('watcher_config')
      .values(values as NewWatcherConfig)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async updateConfig(tenantId: string, updates: WatcherConfigUpdate): Promise<WatcherConfigRow | undefined> {
    const setObj: Record<string, unknown> = {
      ...updates,
      updated_at: new Date(),
    };
    if (setObj.portals !== undefined && Array.isArray(setObj.portals)) {
      setObj.portals = sql`${JSON.stringify(setObj.portals)}::jsonb`;
    }
    return this.db
      .updateTable('watcher_config')
      .set(setObj as WatcherConfigUpdate)
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

  /** Latest archived snapshot for a portal (for diff base). Optionally exclude a snapshot id so diff has a different base. */
  async findLatestArchivedSnapshot(
    tenantId: string,
    portalId: string,
    excludeSnapshotId?: string | null
  ): Promise<PortalSnapshotRow | undefined> {
    let qb = this.db
      .selectFrom('portal_snapshots')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('portal_id', '=', portalId)
      .where('archived', '=', true)
      .orderBy('archived_at', 'desc')
      .limit(1);
    if (excludeSnapshotId) {
      qb = qb.where('id', '!=', excludeSnapshotId);
    }
    return qb.executeTakeFirst();
  }

  async findSnapshots(
    tenantId: string,
    options: {
      portalId?: string;
      from?: Date;
      to?: Date;
      severity?: DiffSeverity | DiffSeverity[];
      archived?: boolean;
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<PortalSnapshotRow[]> {
    let qb = this.db
      .selectFrom('portal_snapshots')
      .selectAll()
      .where('tenant_id', '=', tenantId);

    if (options.portalId) qb = qb.where('portal_id', '=', options.portalId);
    if (options.from) qb = qb.where('captured_at', '>=', options.from);
    if (options.to) qb = qb.where('captured_at', '<=', options.to);
    if (options.archived !== undefined) qb = qb.where('archived', '=', options.archived);
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

  /** Count snapshots with same filters as findSnapshots (for list total) */
  async countSnapshotsWithFilters(
    tenantId: string,
    options: { portalId?: string; from?: Date; to?: Date; severity?: DiffSeverity | DiffSeverity[]; archived?: boolean } = {}
  ): Promise<number> {
    let qb = this.db
      .selectFrom('portal_snapshots')
      .select(({ fn }) => fn.count<number>('id').as('count'))
      .where('tenant_id', '=', tenantId);
    if (options.portalId) qb = qb.where('portal_id', '=', options.portalId);
    if (options.from) qb = qb.where('captured_at', '>=', options.from);
    if (options.to) qb = qb.where('captured_at', '<=', options.to);
    if (options.archived !== undefined) qb = qb.where('archived', '=', options.archived);
    if (options.severity) {
      const severities = Array.isArray(options.severity) ? options.severity : [options.severity];
      qb = qb.where('diff_severity', 'in', severities);
    }
    const result = await qb.executeTakeFirst();
    return result?.count ?? 0;
  }

  async setArchived(
    tenantId: string,
    snapshotId: string,
    archived: boolean,
    archiveSummary?: string | null
  ): Promise<PortalSnapshotRow | undefined> {
    const setPayload: Record<string, unknown> = {
      archived,
      archived_at: archived ? new Date() : null,
    };
    if (archiveSummary !== undefined) setPayload.archive_summary = archiveSummary;
    return this.db
      .updateTable('portal_snapshots')
      .set(setPayload as PortalSnapshotUpdate)
      .where('id', '=', snapshotId)
      .where('tenant_id', '=', tenantId)
      .returningAll()
      .executeTakeFirst();
  }

  async createSnapshot(snapshot: NewPortalSnapshot): Promise<PortalSnapshotRow> {
    return this.db
      .insertInto('portal_snapshots')
      .values(snapshot)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /** Delete non-archived snapshots older than given date (7-day retention). Archived snapshots are kept. */
  async deleteOldSnapshots(tenantId: string, olderThan: Date): Promise<number> {
    const result = await this.db
      .deleteFrom('portal_snapshots')
      .where('tenant_id', '=', tenantId)
      .where('captured_at', '<', olderThan)
      .where('archived', '=', false)
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

  // ============================================
  // Watcher Run History (7-day retention)
  // ============================================

  async createRunHistory(tenantId: string, payload: {
    portals_checked: string[];
    jobs_created: number;
    up_portal_ids: string[];
    down_portal_ids: string[];
    up_portals_with_no_customers: string[];
    message: string | null;
  }): Promise<WatcherRunHistoryRow> {
    const values: Record<string, unknown> = {
      tenant_id: tenantId,
      run_at: new Date(),
      portals_checked: sql`${JSON.stringify(payload.portals_checked)}::jsonb`,
      jobs_created: payload.jobs_created,
      up_portal_ids: sql`${JSON.stringify(payload.up_portal_ids)}::jsonb`,
      down_portal_ids: sql`${JSON.stringify(payload.down_portal_ids)}::jsonb`,
      up_portals_with_no_customers: sql`${JSON.stringify(payload.up_portals_with_no_customers)}::jsonb`,
      message: payload.message,
    };
    return this.db
      .insertInto('watcher_run_history')
      .values(values as NewWatcherRunHistory)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async findRunHistory(tenantId: string, limit = 50): Promise<WatcherRunHistoryRow[]> {
    return this.db
      .selectFrom('watcher_run_history')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .orderBy('run_at', 'desc')
      .limit(limit)
      .execute();
  }

  /** Delete run history older than given date (7-day retention). */
  async deleteOldRunHistory(tenantId: string, olderThan: Date): Promise<number> {
    const result = await this.db
      .deleteFrom('watcher_run_history')
      .where('tenant_id', '=', tenantId)
      .where('run_at', '<', olderThan)
      .executeTakeFirst();
    return Number(result.numDeletedRows ?? 0n);
  }

  /** Delete all run history for tenant (manual clear). */
  async deleteAllRunHistory(tenantId: string): Promise<number> {
    const result = await this.db
      .deleteFrom('watcher_run_history')
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();
    return Number(result.numDeletedRows ?? 0n);
  }

  /** Delete all snapshots for tenant (manual clear). */
  async deleteAllSnapshots(tenantId: string): Promise<number> {
    const result = await this.db
      .deleteFrom('portal_snapshots')
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();
    return Number(result.numDeletedRows ?? 0n);
  }
}
