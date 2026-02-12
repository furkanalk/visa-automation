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
  // Notification settings
  notify: {
    dedupe_slot_open_ttl_seconds: number;
    dedupe_booking_ttl_seconds: number;
    dedupe_slot_closed_ttl_seconds: number;
    slot_status_ttl_seconds: number;
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
}

/**
 * Default configuration values (used as fallback)
 */
export const DEFAULT_CONFIG: SystemConfig = {
  system: {
    heartbeat_interval_ms: 10000,
    heartbeat_timeout_ms: 30000,
    config_refresh_interval_ms: 60000,
    sync_poll_interval_ms: 5000,
    max_agents_per_worker: 100,
    default_async_agent_count: 2,
    default_sync_agent_count: 0,
    max_concurrent_jobs: 50,
  },
  job: {
    max_retries: 3,
    default_priority: 50,
    lock_timeout_ms: 300000,
    retry_slot_delay_min_ms: 30000,
    retry_slot_delay_max_ms: 90000,
  },
  queue: {
    rate_limit_max: 10,
    rate_limit_window_ms: 1000,
    completed_retention_hours: 24,
    completed_max_count: 1000,
    failed_retention_hours: 168,
    failed_max_count: 5000,
  },
  portal: {
    navigation_timeout_ms: 45000,
    action_timeout_ms: 15000,
    selector_timeout_ms: 30000,
    pacing_min_delay_ms: 250,
    pacing_max_delay_ms: 900,
    pacing_jitter: 0.35,
    rate_limit_actions_per_minute: 30,
    rate_limit_burst: 6,
  },
  slot_hunt: {
    max_polls: 12,
    poll_delay_min_ms: 1500,
    poll_delay_max_ms: 3000,
  },
  hitl: {
    task_timeout_minutes: 30,
    max_wait_seconds: 180,
  },
  notify: {
    dedupe_slot_open_ttl_seconds: 600,
    dedupe_booking_ttl_seconds: 86400,
    dedupe_slot_closed_ttl_seconds: 1800,
    slot_status_ttl_seconds: 172800,
  },
  browser: {
    viewport_width: 1366,
    viewport_height: 768,
  },
  features: {
    watcher_enabled: true,
    hitl_enabled: true,
    notifications_enabled: true,
  },
  fsm: {
    state_transition_delay_ms: 500,
  },
};

/**
 * ConfigService fetches and caches configuration from the Control Plane API
 */
export class ConfigService {
  private config: SystemConfig = DEFAULT_CONFIG;
  private cpApiUrl: string;
  private tenantId: string;
  private logger: Logger;
  private lastFetchedAt: Date | null = null;
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

    this.logger.info({ refreshInterval }, 'Started auto-refresh');
  }

  /**
   * Stop automatic config refresh
   */
  stopAutoRefresh(): void {
    if (this.refreshIntervalId) {
      clearInterval(this.refreshIntervalId);
      this.refreshIntervalId = null;
      this.logger.info('Stopped auto-refresh');
    }
  }

  /**
   * Refresh configuration from the Control Plane
   */
  async refresh(): Promise<void> {
    try {
      const response = await fetch(`${this.cpApiUrl}/cp/settings`, {
        headers: {
          'Content-Type': 'application/json',
          'x-tenant-id': this.tenantId,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch config: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as { 
        success: boolean; 
        data?: Record<string, Record<string, unknown>> 
      };
      
      if (data.success && data.data) {
        this.mergeConfig(data.data);
        this.lastFetchedAt = new Date();
        this.logger.debug('Config refreshed from CP');
      }
    } catch (err) {
      this.logger.warn({ err }, 'Failed to fetch config from CP, using cached/default values');
      // Don't throw - use cached/default values
    }
  }

  /**
   * Merge fetched config with current config (deep merge)
   */
  private mergeConfig(fetched: Record<string, Record<string, unknown>>): void {
    for (const [category, values] of Object.entries(fetched)) {
      if (category in this.config) {
        const categoryConfig = this.config[category as keyof SystemConfig];
        if (typeof categoryConfig === 'object' && categoryConfig !== null) {
          for (const [key, value] of Object.entries(values)) {
            if (key in categoryConfig) {
              (categoryConfig as Record<string, unknown>)[key] = value;
            }
          }
        }
      }
    }
  }

  /**
   * Get the current configuration
   */
  getConfig(): SystemConfig {
    return this.config;
  }

  /**
   * Get a specific category of configuration
   */
  get<K extends keyof SystemConfig>(category: K): SystemConfig[K] {
    return this.config[category];
  }

  /**
   * Get a specific configuration value
   */
  getValue<K extends keyof SystemConfig, V extends keyof SystemConfig[K]>(
    category: K,
    key: V
  ): SystemConfig[K][V] {
    return this.config[category][key];
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
