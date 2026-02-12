import type { Kysely } from 'kysely';
import type { Database, SystemSetting, SettingValueType } from '../schema.js';

export interface SettingsFilters {
  tenantId?: string | null;
  category?: string;
  includeGlobal?: boolean;
}

export interface ParsedSetting {
  category: string;
  key: string;
  value: unknown;
  valueType: SettingValueType;
  description: string | null;
  isSensitive: boolean;
  isGlobal: boolean;
}

export class SystemSettingsRepository {
  constructor(private db: Kysely<Database>) {}

  /**
   * Get all settings for a tenant (including global settings)
   */
  async findByTenant(tenantId: string | null, category?: string): Promise<SystemSetting[]> {
    let query = this.db
      .selectFrom('system_settings')
      .selectAll()
      .where((eb) =>
        eb.or([
          eb('tenant_id', '=', tenantId),
          eb('tenant_id', 'is', null), // Include global settings
        ])
      );

    if (category) {
      query = query.where('category', '=', category);
    }

    return query.orderBy('category').orderBy('key').execute();
  }

  /**
   * Get a specific setting value
   */
  async getValue(
    tenantId: string | null,
    category: string,
    key: string
  ): Promise<unknown | undefined> {
    // First try tenant-specific, then fall back to global
    const setting = await this.db
      .selectFrom('system_settings')
      .selectAll()
      .where('category', '=', category)
      .where('key', '=', key)
      .where((eb) =>
        eb.or([
          eb('tenant_id', '=', tenantId),
          eb('tenant_id', 'is', null),
        ])
      )
      .orderBy('tenant_id', 'desc') // Tenant-specific first (non-null)
      .executeTakeFirst();

    return setting?.value;
  }

  /**
   * Get typed setting value
   */
  async getNumber(tenantId: string | null, category: string, key: string, defaultValue?: number): Promise<number> {
    const value = await this.getValue(tenantId, category, key);
    if (value === undefined) return defaultValue ?? 0;
    return typeof value === 'number' ? value : parseFloat(String(value));
  }

  async getString(tenantId: string | null, category: string, key: string, defaultValue?: string): Promise<string> {
    const value = await this.getValue(tenantId, category, key);
    if (value === undefined) return defaultValue ?? '';
    return String(value);
  }

  async getBoolean(tenantId: string | null, category: string, key: string, defaultValue?: boolean): Promise<boolean> {
    const value = await this.getValue(tenantId, category, key);
    if (value === undefined) return defaultValue ?? false;
    if (typeof value === 'boolean') return value;
    return value === 'true' || value === '1';
  }

  async getJson<T>(tenantId: string | null, category: string, key: string, defaultValue?: T): Promise<T> {
    const value = await this.getValue(tenantId, category, key);
    if (value === undefined) return defaultValue as T;
    return value as T;
  }

  /**
   * Get all settings for a category as a flat object
   */
  async getCategoryAsObject(tenantId: string | null, category: string): Promise<Record<string, unknown>> {
    const settings = await this.findByTenant(tenantId, category);
    const result: Record<string, unknown> = {};

    for (const setting of settings) {
      // Tenant-specific overrides global
      if (setting.tenant_id !== null || result[setting.key] === undefined) {
        result[setting.key] = this.parseValue(setting.value, setting.value_type);
      }
    }

    return result;
  }

  /**
   * Get all settings grouped by category
   */
  async getAllGrouped(tenantId: string | null): Promise<Record<string, Record<string, unknown>>> {
    const settings = await this.findByTenant(tenantId);
    const result: Record<string, Record<string, unknown>> = {};

    for (const setting of settings) {
      if (!result[setting.category]) {
        result[setting.category] = {};
      }
      // Tenant-specific overrides global
      if (setting.tenant_id !== null || result[setting.category][setting.key] === undefined) {
        result[setting.category][setting.key] = this.parseValue(setting.value, setting.value_type);
      }
    }

    return result;
  }

  /**
   * Set a setting value (upsert)
   */
  async setValue(
    tenantId: string | null,
    category: string,
    key: string,
    value: unknown,
    options?: { valueType?: SettingValueType; description?: string; updatedBy?: string }
  ): Promise<SystemSetting> {
    const existing = await this.db
      .selectFrom('system_settings')
      .selectAll()
      .where('tenant_id', tenantId === null ? 'is' : '=', tenantId)
      .where('category', '=', category)
      .where('key', '=', key)
      .executeTakeFirst();

    if (existing) {
      const updated = await this.db
        .updateTable('system_settings')
        .set({
          value: JSON.stringify(value),
          updated_by: options?.updatedBy,
        })
        .where('id', '=', existing.id)
        .returningAll()
        .executeTakeFirstOrThrow();
      return updated;
    }

    return this.db
      .insertInto('system_settings')
      .values({
        tenant_id: tenantId,
        category,
        key,
        value: JSON.stringify(value),
        value_type: options?.valueType ?? this.inferValueType(value),
        description: options?.description,
        updated_by: options?.updatedBy,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /**
   * Bulk update settings
   */
  async bulkUpdate(
    tenantId: string | null,
    updates: Array<{ category: string; key: string; value: unknown }>,
    updatedBy?: string
  ): Promise<void> {
    for (const update of updates) {
      await this.setValue(tenantId, update.category, update.key, update.value, { updatedBy });
    }
  }

  /**
   * Delete a tenant-specific setting (falls back to global)
   */
  async deleteTenantSetting(tenantId: string, category: string, key: string): Promise<boolean> {
    const result = await this.db
      .deleteFrom('system_settings')
      .where('tenant_id', '=', tenantId)
      .where('category', '=', category)
      .where('key', '=', key)
      .executeTakeFirst();
    return (result.numDeletedRows ?? 0) > 0;
  }

  /**
   * Get all global settings
   */
  async getGlobalSettings(): Promise<SystemSetting[]> {
    return this.db
      .selectFrom('system_settings')
      .selectAll()
      .where('tenant_id', 'is', null)
      .orderBy('category')
      .orderBy('key')
      .execute();
  }

  /**
   * Get categories list
   */
  async getCategories(): Promise<string[]> {
    const result = await this.db
      .selectFrom('system_settings')
      .select('category')
      .distinct()
      .orderBy('category')
      .execute();
    return result.map((r) => r.category);
  }

  private parseValue(value: unknown, valueType: SettingValueType): unknown {
    if (value === null || value === undefined) return value;
    
    // Value is stored as JSONB, so it should already be parsed
    if (typeof value === 'object') return value;

    const strValue = String(value);
    
    switch (valueType) {
      case 'number':
        return parseFloat(strValue);
      case 'boolean':
        return strValue === 'true' || strValue === '1';
      case 'json':
      case 'array':
        try {
          return JSON.parse(strValue);
        } catch {
          return value;
        }
      default:
        return strValue;
    }
  }

  private inferValueType(value: unknown): SettingValueType {
    if (typeof value === 'number') return 'number';
    if (typeof value === 'boolean') return 'boolean';
    if (Array.isArray(value)) return 'array';
    if (typeof value === 'object' && value !== null) return 'json';
    return 'string';
  }
}
