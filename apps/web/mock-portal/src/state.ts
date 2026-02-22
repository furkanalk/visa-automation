/**
 * Mock Portal State Management
 * Controls behavior of simulated visa portals for testing
 */

export interface PortalConfig {
  // Portal identification
  portalId: string;
  enabled: boolean;

  // Behavior settings
  behavior: {
    pageLoadDelayMs: number;
    formSubmitDelayMs: number;
    slotSearchDelayMs: number;
    randomDelayMs: number; // Added random jitter
    errorRate: number; // 0-1, chance of random error
    maintenanceMode: boolean;
  };

  // Turnstile/CAPTCHA simulation
  captcha: {
    enabled: boolean;
    autoSolveDelayMs: number; // 0 = requires manual, >0 = auto-solve after delay
    failRate: number; // 0-1, chance of captcha rejection
  };

  // Security code (6-digit verification)
  security: {
    code: string; // Fixed code for testing, or 'random' for new code each time
  };

  // Slot availability
  slots: {
    availableDates: string[]; // YYYY-MM-DD format
    availableTimes: string[]; // HH:mm format
    randomizeAvailability: boolean;
    slotDisappearChance: number; // 0-1, chance slot disappears after being shown
  };

  // Form validation
  validation: {
    rejectInvalidPassport: boolean;
    rejectInvalidEmail: boolean;
    requireAllFields: boolean;
  };
}

export interface MockSession {
  id: string;
  portalId: string;
  createdAt: number;
  formData: Record<string, string>;
  captchaSolved: boolean;
  currentStep: 'form' | 'slots' | 'booking' | 'confirmation';
  /** Set after form submit for success page (agent scrape) */
  confirmationNumber?: string;
}

// Default configuration for as-visa portal
const defaultAsVisaConfig: PortalConfig = {
  portalId: 'as-visa',
  enabled: true,
  behavior: {
    pageLoadDelayMs: 500,
    formSubmitDelayMs: 1000,
    slotSearchDelayMs: 1500,
    randomDelayMs: 500,
    errorRate: 0,
    maintenanceMode: false,
  },
  captcha: {
    enabled: true,
    autoSolveDelayMs: 3000, // Auto-solve after 3s for testing
    failRate: 0,
  },
  security: {
    code: 'random', // Random 6-digit code each page load; set to fixed string (e.g. '123456') for testing
  },
  slots: {
    availableDates: getDefaultSlotDates(),
    availableTimes: ['09:00', '10:00', '11:00', '14:00', '15:00', '16:00'],
    randomizeAvailability: false,
    slotDisappearChance: 0,
  },
  validation: {
    rejectInvalidPassport: false,
    rejectInvalidEmail: false,
    requireAllFields: true,
  },
};

function getDefaultSlotDates(): string[] {
  const dates: string[] = [];
  const now = new Date();
  // Add slots for next 14 days (skipping weekends)
  for (let i = 3; i <= 17; i++) {
    const date = new Date(now);
    date.setDate(now.getDate() + i);
    const dayOfWeek = date.getDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      dates.push(date.toISOString().split('T')[0]);
    }
  }
  return dates;
}

class MockPortalState {
  private configs: Map<string, PortalConfig> = new Map();
  private sessions: Map<string, MockSession> = new Map();

  constructor() {
    // Initialize with default as-visa config
    this.configs.set('as-visa', { ...defaultAsVisaConfig });
  }

  // Portal Configuration
  getConfig(portalId: string): PortalConfig | null {
    return this.configs.get(portalId) || null;
  }

  setConfig(portalId: string, config: Partial<PortalConfig>): PortalConfig {
    const existing = this.configs.get(portalId) || { ...defaultAsVisaConfig, portalId };
    const updated: PortalConfig = {
      ...existing,
      ...config,
      behavior: { ...existing.behavior, ...config.behavior },
      captcha: { ...existing.captcha, ...config.captcha },
      security: { ...existing.security, ...config.security },
      slots: { ...existing.slots, ...config.slots },
      validation: { ...existing.validation, ...config.validation },
    };
    this.configs.set(portalId, updated);
    return updated;
  }

  resetConfig(portalId: string): PortalConfig {
    if (portalId === 'as-visa') {
      const config = { ...defaultAsVisaConfig };
      this.configs.set(portalId, config);
      return config;
    }
    this.configs.delete(portalId);
    return defaultAsVisaConfig;
  }

  getAllConfigs(): PortalConfig[] {
    return Array.from(this.configs.values());
  }

  // Sessions
  createSession(portalId: string): MockSession {
    const session: MockSession = {
      id: `sess-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      portalId,
      createdAt: Date.now(),
      formData: {},
      captchaSolved: false,
      currentStep: 'form',
    };
    this.sessions.set(session.id, session);
    return session;
  }

  getSession(sessionId: string): MockSession | null {
    return this.sessions.get(sessionId) || null;
  }

  updateSession(sessionId: string, updates: Partial<MockSession>): MockSession | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    Object.assign(session, updates);
    return session;
  }

  deleteSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  // Slot availability
  getAvailableSlots(portalId: string): { dates: string[]; times: string[] } {
    const config = this.configs.get(portalId);
    if (!config || !config.enabled) {
      return { dates: [], times: [] };
    }

    let dates = [...config.slots.availableDates];
    const times = [...config.slots.availableTimes];

    if (config.slots.randomizeAvailability) {
      // Randomly filter out some dates
      dates = dates.filter(() => Math.random() > 0.3);
    }

    return { dates, times };
  }

  // Behavior simulation helpers
  shouldError(portalId: string): boolean {
    const config = this.configs.get(portalId);
    return config ? Math.random() < config.behavior.errorRate : false;
  }

  async applyDelay(portalId: string, type: 'pageLoad' | 'formSubmit' | 'slotSearch'): Promise<void> {
    const config = this.configs.get(portalId);
    if (!config) return;

    let baseDelay = 0;
    switch (type) {
      case 'pageLoad':
        baseDelay = config.behavior.pageLoadDelayMs;
        break;
      case 'formSubmit':
        baseDelay = config.behavior.formSubmitDelayMs;
        break;
      case 'slotSearch':
        baseDelay = config.behavior.slotSearchDelayMs;
        break;
    }

    const jitter = Math.floor(Math.random() * config.behavior.randomDelayMs);
    const totalDelay = baseDelay + jitter;

    if (totalDelay > 0) {
      await new Promise((resolve) => setTimeout(resolve, totalDelay));
    }
  }

  // Stats
  getStats() {
    return {
      portals: this.configs.size,
      activeSessions: this.sessions.size,
      configs: Array.from(this.configs.keys()),
    };
  }

  // Reset all state
  reset(): void {
    this.sessions.clear();
    this.configs.clear();
    this.configs.set('as-visa', { ...defaultAsVisaConfig });
  }
}

export const mockState = new MockPortalState();
