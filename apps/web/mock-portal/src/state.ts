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

  /**
   * Scenario presets that change page behavior to emulate production constraints.
   */
  presets: {
    /**
     * true  -> strict real-site mode (no bot-detection bypass, no synthetic mouse simulation, info popup enabled)
     * false -> fast mock mode
     */
    strictRealMode: boolean;
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
    /**
     * REAL AS-VISA semantics: dateDisabled = list of OPEN days.
     * When true:  /TarihGetir returns next 30 weekdays (open days → slots available).
     * When false: /TarihGetir returns [] (no open days → no slots).
     */
    hasAvailability: boolean;
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

  /**
   * Mouse movement simulation inside the mock page.
   * Controls whether the page itself dispatches synthetic mousemove events —
   * so startSuspiciousCheck()'s userHasMovedMouse flag gets set.
   *
   * mode:
   *   'disabled'  — no simulation; startSuspiciousCheck runs as-is (bot → google.com redirect).
   *   'interval'  — dispatches a synthetic mousemove every intervalMs ms.
   *   'on-fill'   — dispatches a synthetic mousemove whenever any input/select value changes.
   */
  mouseSimulation: {
    mode: 'disabled' | 'interval' | 'on-fill';
    /** Used only when mode === 'interval'. Default: 3000 ms. */
    intervalMs: number;
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
  presets: {
    strictRealMode: false,
  },
  captcha: {
    enabled: true,
    autoSolveDelayMs: 3000, // Auto-solve after 3s for testing
    failRate: 0,
  },
  security: {
    code: 'random', // Her sayfa yüklenişinde yeni rastgele kod — browser context canlı kaldığı için güvenli
  },
  slots: {
    hasAvailability: true, // default: open slots available for testing
    availableTimes: ['09:00', '10:00', '11:00', '14:00', '15:00', '16:00'],
    randomizeAvailability: false,
    slotDisappearChance: 0,
  },
  validation: {
    rejectInvalidPassport: false,
    rejectInvalidEmail: false,
    requireAllFields: true,
  },
  mouseSimulation: {
    /**
     * 'interval' → synthetic mousemove every intervalMs ms (default: keeps suspicious-check happy).
     * 'on-fill'  → fires on every input/select change.
     * 'disabled' → no simulation; agent must move mouse or suspicious-check will redirect to google.
     */
    mode: 'interval',
    intervalMs: 3000,
  },
};

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
      presets: { ...existing.presets, ...config.presets },
      captcha: { ...existing.captcha, ...config.captcha },
      security: { ...existing.security, ...config.security },
      slots: { ...existing.slots, ...config.slots },
      validation: { ...existing.validation, ...config.validation },
      mouseSimulation: { ...existing.mouseSimulation, ...config.mouseSimulation },
    };
    this.configs.set(portalId, updated);
    return updated;
  }

  applyPreset(portalId: string, preset: 'strict-real-mode' | 'fast-mock'): PortalConfig {
    if (preset === 'strict-real-mode') {
      return this.setConfig(portalId, {
        presets: { strictRealMode: true },
        mouseSimulation: { mode: 'disabled' },
      });
    }
    return this.setConfig(portalId, {
      presets: { strictRealMode: false },
    });
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
  /**
   * Returns { openDates, times }.
   * openDates: YYYY-M-D list (no leading zeros) — REAL AS-VISA semantics:
   *   dateDisabled = list of OPEN days (confusingly named on real site).
   *   - hasAvailability=true  → next 30 weekdays (open → slots available)
   *   - hasAvailability=false → [] (no open days → no slots)
   * times: available time options in [{value, text}] format matching real SaatGetir response.
   */
  getAvailableSlots(portalId: string): { openDates: string[]; times: string[] } {
    const config = this.configs.get(portalId);
    if (!config || !config.enabled) {
      return { openDates: [], times: [] };
    }

    const times = [...config.slots.availableTimes];

    if (!config.slots.hasAvailability) {
      // No open days → no slots
      return { openDates: [], times };
    }

    // Return next 30 weekdays as open dates (YYYY-M-D, no leading zeros)
    const openDates: string[] = [];
    const now = new Date();
    for (let i = 1; openDates.length < 30; i++) {
      const d = new Date(now);
      d.setDate(now.getDate() + i);
      const day = d.getDay();
      if (day !== 0 && day !== 6) {
        openDates.push(`${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`);
      }
    }

    if (config.slots.randomizeAvailability) {
      return { openDates: openDates.filter(() => Math.random() > 0.3), times };
    }

    return { openDates, times };
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
