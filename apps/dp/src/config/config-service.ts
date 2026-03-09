import type { Logger } from 'pino';

/**
 * Configuration fetched from the Control Plane
 */
export interface SystemConfig {
  // System settings
  system: {
    heartbeat_interval_ms: number;
    heartbeat_timeout_ms: number;
    config_refresh_interval_ms: number;
    sync_poll_interval_ms: number;
    max_agents_per_worker: number;
    default_async_agent_count: number;
    default_sync_agent_count: number;
    default_scout_agent_count: number;
    max_concurrent_jobs: number;
  };
  // Job settings
  job: {
    max_retries: number;
    default_priority: number;
    lock_timeout_ms: number;
    retry_slot_delay_min_ms: number;
    retry_slot_delay_max_ms: number;
  };
  // Queue settings
  queue: {
    rate_limit_max: number;
    rate_limit_window_ms: number;
    completed_retention_hours: number;
    completed_max_count: number;
    failed_retention_hours: number;
    failed_max_count: number;
  };
  // Portal defaults
  portal: {
    navigation_timeout_ms: number;
    action_timeout_ms: number;
    selector_timeout_ms: number;
    pacing_min_delay_ms: number;
    pacing_max_delay_ms: number;
    pacing_jitter: number;
    rate_limit_actions_per_minute: number;
    rate_limit_burst: number;
  };
  // Slot hunt settings
  slot_hunt: {
    max_polls: number;
    poll_delay_min_ms: number;
    poll_delay_max_ms: number;
  };
  // HITL settings
  hitl: {
    task_timeout_minutes: number;
    max_wait_seconds: number;
  };
  // Notification settings (from system_settings; action token/url for Telegram buttons)
  notify: {
    dedupe_slot_open_ttl_seconds: number;
    dedupe_booking_ttl_seconds: number;
    dedupe_slot_closed_ttl_seconds: number;
    slot_status_ttl_seconds: number;
    notify_action_token: string;
    notify_action_base_url: string;
  };
  // Browser settings
  browser: {
    viewport_width: number;
    viewport_height: number;
  };
  // Feature flags
  features: {
    watcher_enabled: boolean;
    hitl_enabled: boolean;
    notifications_enabled: boolean;
  };
  // FSM settings
  fsm: {
    state_transition_delay_ms: number;
  };
  // Mock portal settings
  mock: {
    enabled: boolean;
    default_base_url: string;
  };
}

/** Required categories and their keys; CP must return all of these (no runtime defaults). */
const REQUIRED_CATEGORIES: Record<keyof SystemConfig, string[]> = {
  system: ['heartbeat_interval_ms', 'heartbeat_timeout_ms', 'config_refresh_interval_ms', 'sync_poll_interval_ms', 'max_agents_per_worker', 'default_async_agent_count', 'default_sync_agent_count', 'default_scout_agent_count', 'max_concurrent_jobs'],
  job: ['max_retries', 'default_priority', 'lock_timeout_ms', 'retry_slot_delay_min_ms', 'retry_slot_delay_max_ms'],
  queue: ['rate_limit_max', 'rate_limit_window_ms', 'completed_retention_hours', 'completed_max_count', 'failed_retention_hours', 'failed_max_count'],
  portal: ['navigation_timeout_ms', 'action_timeout_ms', 'selector_timeout_ms', 'pacing_min_delay_ms', 'pacing_max_delay_ms', 'pacing_jitter', 'rate_limit_actions_per_minute', 'rate_limit_burst'],
  slot_hunt: ['max_polls', 'poll_delay_min_ms', 'poll_delay_max_ms'],
  hitl: ['task_timeout_minutes', 'max_wait_seconds'],
  notify: ['dedupe_slot_open_ttl_seconds', 'dedupe_booking_ttl_seconds', 'dedupe_slot_closed_ttl_seconds', 'slot_status_ttl_seconds', 'notify_action_token', 'notify_action_base_url'],
  browser: ['viewport_width', 'viewport_height'],
  features: ['watcher_enabled', 'hitl_enabled', 'notifications_enabled'],
  fsm: ['state_transition_delay_ms'],
  mock: ['enabled', 'default_base_url'],
};

function parseNumber(v: unknown): number {
  if (typeof v === 'number' && !Number.isNaN(v)) return v;
  const n = parseFloat(String(v));
  if (Number.isNaN(n)) throw new Error(`Expected number, got ${typeof v}`);
  return n;
}

function parseBoolean(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  if (v === 'true' || v === '1') return true;
  if (v === 'false' || v === '0') return false;
  throw new Error(`Expected boolean, got ${typeof v}`);
}

function parseString(v: unknown): string {
  return String(v ?? '');
}

/**
 * Build and validate full SystemConfig from CP response. Throws if any required category/key is missing.
 */
function buildConfigFromCP(data: Record<string, Record<string, unknown>>): SystemConfig {
  const config: Record<string, Record<string, unknown>> = {};

  // Optional categories with defaults (not required to be in DB)
  const OPTIONAL_CATEGORY_DEFAULTS: Partial<Record<keyof SystemConfig, Record<string, unknown>>> = {
    mock: { enabled: false, default_base_url: '' },
  };

  for (const [cat, keys] of Object.entries(REQUIRED_CATEGORIES)) {
    const raw = data[cat];
    if (!raw || typeof raw !== 'object') {
      // If category is optional, use defaults
      if (cat in OPTIONAL_CATEGORY_DEFAULTS) {
        config[cat] = { ...OPTIONAL_CATEGORY_DEFAULTS[cat as keyof SystemConfig] };
        continue;
      }
      throw new Error(`CP config missing required category: ${cat}. Run migration 010_system_settings.`);
    }
    const out: Record<string, unknown> = {};
    const optionalKeys = new Set(['default_scout_agent_count']);
    for (const key of keys) {
      const v = raw[key];
      if (v === undefined) {
        if (optionalKeys.has(key)) {
          out[key] = key === 'default_scout_agent_count' ? 0 : undefined;
          continue;
        }
        // For optional categories, fall back to default for missing keys
        if (cat in OPTIONAL_CATEGORY_DEFAULTS) {
          out[key] = OPTIONAL_CATEGORY_DEFAULTS[cat as keyof SystemConfig]?.[key];
          continue;
        }
        throw new Error(`CP config missing ${cat}.${key}. Ensure system_settings has this key.`);
      }
      if (cat === 'features' && (key === 'watcher_enabled' || key === 'hitl_enabled' || key === 'notifications_enabled')) {
        out[key] = parseBoolean(v);
      } else if (cat === 'notify' && (key === 'notify_action_token' || key === 'notify_action_base_url')) {
        out[key] = parseString(v);
      } else if (cat === 'mock' && key === 'enabled') {
        out[key] = parseBoolean(v);
      } else if (cat === 'mock' && key === 'default_base_url') {
        out[key] = parseString(v);
      } else {
        out[key] = parseNumber(v);
      }
    }
    config[cat] = out;
  }
  return config as unknown as SystemConfig;
}

/**
 * ConfigService fetches and caches configuration from the Control Plane API.
 * No default config: initial state is empty; first successful refresh must return full config or we throw.
 */
export class ConfigService {
  private config: SystemConfig | null = null;
  private cpApiUrl: string;
  private tenantId: string;
  private logger: Logger;
  private lastFetchedAt: Date | null = null;
  private lastConfigUpdatedAt: string | null = null;
  private refreshIntervalId: NodeJS.Timeout | null = null;

  constructor(options: {
    cpApiUrl: string;
    tenantId: string;
    logger: Logger;
  }) {
    this.cpApiUrl = options.cpApiUrl;
    this.tenantId = options.tenantId;
    this.logger = options.logger.child({ component: 'ConfigService' });
  }

  /**
   * Initialize the config service - fetch initial config
   */
  async initialize(): Promise<void> {
    this.logger.info('Initializing ConfigService');
    await this.refresh();
    this.logger.info({ lastFetchedAt: this.lastFetchedAt }, 'ConfigService initialized');
  }

  /**
   * Start automatic config refresh
   */
  startAutoRefresh(intervalMs?: number): void {
    if (!this.config) throw new Error('ConfigService: config not loaded yet');
    const refreshInterval = intervalMs ?? this.config.system.config_refresh_interval_ms;
    
    if (this.refreshIntervalId) {
      clearInterval(this.refreshIntervalId);
    }

    this.refreshIntervalId = setInterval(async () => {
      try {
        await this.refresh();
      } catch (err) {
        this.logger.error({ err }, 'Failed to refresh config');
      }
    }, refreshInterval);

    this.logger.debug({ refreshInterval }, 'Started auto-refresh');
  }

  /**
   * Stop automatic config refresh
   */
  stopAutoRefresh(): void {
    if (this.refreshIntervalId) {
      clearInterval(this.refreshIntervalId);
      this.refreshIntervalId = null;
      this.logger.debug('Stopped auto-refresh');
    }
  }

  /**
   * Refresh configuration from the Control Plane.
   * Sends X-Config-Updated-At when present; on 304 skips refetch (config unchanged).
   * On initial load (no successful fetch yet), throws if CP fails or system category is missing.
   */
  async refresh(): Promise<void> {
    const isInitialLoad = this.lastFetchedAt === null;

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'x-tenant-id': this.tenantId,
      };
      if (this.lastConfigUpdatedAt) {
        headers['X-Config-Updated-At'] = this.lastConfigUpdatedAt;
      }

      const response = await fetch(`${this.cpApiUrl}/cp/settings`, { headers });

      if (response.status === 304) {
        this.logger.trace('Config unchanged (304), skip merge');
        return;
      }

      if (!response.ok) {
        const msg = `Failed to fetch config: ${response.status} ${response.statusText}`;
        if (isInitialLoad) throw new Error(msg);
        this.logger.warn({ status: response.status }, msg);
        return;
      }

      const data = await response.json() as {
        success: boolean;
        data?: Record<string, Record<string, unknown>>;
        config_updated_at?: string;
      };

      if (!data.success || !data.data) {
        const msg = 'CP returned no config data';
        if (isInitialLoad) throw new Error(msg);
        this.logger.warn(msg);
        return;
      }

      const built = buildConfigFromCP(data.data);
      this.config = built;
      this.lastFetchedAt = new Date();
      if (data.config_updated_at) {
        this.lastConfigUpdatedAt = data.config_updated_at;
      }
      this.logger.debug('Config refreshed from CP');
    } catch (err) {
      if (isInitialLoad) throw err;
      this.logger.warn({ err }, 'Failed to refresh config from CP, using cached values');
    }
  }

  /**
   * Get the current configuration (throws if not yet loaded)
   */
  getConfig(): SystemConfig {
    if (!this.config) throw new Error('ConfigService: config not loaded. Call initialize() first.');
    return this.config;
  }

  /**
   * Get a specific category of configuration
   */
  get<K extends keyof SystemConfig>(category: K): SystemConfig[K] {
    return this.getConfig()[category];
  }

  /**
   * Get a specific configuration value
   */
  getValue<K extends keyof SystemConfig, V extends keyof SystemConfig[K]>(
    category: K,
    key: V
  ): SystemConfig[K][V] {
    return this.getConfig()[category][key];
  }

  /**
   * Check if config has been fetched recently
   */
  isStale(maxAgeMs: number = 300000): boolean {
    if (!this.lastFetchedAt) return true;
    return Date.now() - this.lastFetchedAt.getTime() > maxAgeMs;
  }
}

// Singleton instance
let configServiceInstance: ConfigService | null = null;

/**
 * Get or create the ConfigService singleton
 */
export function getConfigService(options?: {
  cpApiUrl: string;
  tenantId: string;
  logger: Logger;
}): ConfigService {
  if (!configServiceInstance && options) {
    configServiceInstance = new ConfigService(options);
  }
  if (!configServiceInstance) {
    throw new Error('ConfigService not initialized. Call with options first.');
  }
  return configServiceInstance;
}

/**
 * Get the current system config (convenience function)
 */
export function getSystemConfig(): SystemConfig {
  return getConfigService().getConfig();
}
