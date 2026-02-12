import type { Kysely } from 'kysely';
import type { Database, NotifySettingsRow, NewNotifySettings, NotifySettingsUpdate } from '../schema.js';

export class NotifyRepository {
  constructor(private db: Kysely<Database>) {}

  async findByTenantId(tenantId: string): Promise<NotifySettingsRow | undefined> {
    return this.db
      .selectFrom('notify_settings')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();
  }

  async findById(id: string): Promise<NotifySettingsRow | undefined> {
    return this.db
      .selectFrom('notify_settings')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
  }

  async create(settings: NewNotifySettings): Promise<NotifySettingsRow> {
    return this.db
      .insertInto('notify_settings')
      .values(settings)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async update(tenantId: string, updates: NotifySettingsUpdate): Promise<NotifySettingsRow | undefined> {
    return this.db
      .updateTable('notify_settings')
      .set({
        ...updates,
        updated_at: new Date(),
      })
      .where('tenant_id', '=', tenantId)
      .returningAll()
      .executeTakeFirst();
  }

  async upsert(tenantId: string, updates: Partial<NewNotifySettings>): Promise<NotifySettingsRow> {
    const existing = await this.findByTenantId(tenantId);
    
    if (existing) {
      const updated = await this.update(tenantId, updates);
      return updated!;
    }

    return this.create({
      tenant_id: tenantId,
      ...updates,
    });
  }

  async setTelegramEnabled(tenantId: string, enabled: boolean): Promise<NotifySettingsRow | undefined> {
    return this.update(tenantId, { telegram_enabled: enabled });
  }

  async setEmailEnabled(tenantId: string, enabled: boolean): Promise<NotifySettingsRow | undefined> {
    return this.update(tenantId, { email_enabled: enabled });
  }

  async setWebhookEnabled(tenantId: string, enabled: boolean): Promise<NotifySettingsRow | undefined> {
    return this.update(tenantId, { webhook_enabled: enabled });
  }

  async updateTelegramSettings(
    tenantId: string,
    botToken?: string,
    chatIds?: string[]
  ): Promise<NotifySettingsRow | undefined> {
    const updates: NotifySettingsUpdate = {};
    if (botToken !== undefined) updates.telegram_bot_token = botToken;
    if (chatIds !== undefined) updates.telegram_chat_ids = chatIds;
    return this.update(tenantId, updates);
  }

  async updateSmtpSettings(
    tenantId: string,
    settings: {
      host?: string;
      port?: number;
      user?: string;
      pass?: string;
      from?: string;
      secure?: boolean;
    }
  ): Promise<NotifySettingsRow | undefined> {
    const updates: NotifySettingsUpdate = {};
    if (settings.host !== undefined) updates.smtp_host = settings.host;
    if (settings.port !== undefined) updates.smtp_port = settings.port;
    if (settings.user !== undefined) updates.smtp_user = settings.user;
    if (settings.pass !== undefined) updates.smtp_pass = settings.pass;
    if (settings.from !== undefined) updates.smtp_from = settings.from;
    if (settings.secure !== undefined) updates.smtp_secure = settings.secure;
    return this.update(tenantId, updates);
  }

  async updateWebhookSettings(
    tenantId: string,
    url?: string,
    secret?: string
  ): Promise<NotifySettingsRow | undefined> {
    const updates: NotifySettingsUpdate = {};
    if (url !== undefined) updates.webhook_url = url;
    if (secret !== undefined) updates.webhook_secret = secret;
    return this.update(tenantId, updates);
  }
}
