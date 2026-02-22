export type PortalId = 'as-visa';

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends (infer U)[]
    ? U[]
    : T[K] extends object
      ? DeepPartial<T[K]>
      : T[K];
};

export interface PortalTimeouts {
  navigationMs: number;
  actionMs: number;
}

export interface PortalPacing {
  minDelayMs: number;
  maxDelayMs: number;
  jitter: number; // 0..1
}

export interface PortalRateLimit {
  enabled: boolean;
  actionsPerMinute: number;
  burst: number;
}

export type ProxyStrategy = 'off' | 'static' | 'rotating' | 'sticky-session';

export interface ProxyProvider {
  name: string;              // e.g. "oxylabs", "smartproxy"
  type: 'http' | 'socks5';
  endpoints: string[];       // host:port list or full URLs
  username?: string;
  password?: string;
}

export interface PortalProxy {
  enabled: boolean;
  strategy: ProxyStrategy;
  providers: ProxyProvider[];
}

export type OtpMode = 'pause' | 'auto' | 'skip';
export type CaptchaMode = 'hitl' | 'solver' | 'skip';

export interface PortalHitl {
  otpMode: OtpMode;
  captchaMode: CaptchaMode;
  maxWaitSeconds: number;
}

/** Portal-specific: how many availability polls and delay between them. */
export interface PortalSlotHunt {
  maxPolls: number;
  pollDelayMinMs: number;
  pollDelayMaxMs: number;
}

export interface PortalConfig {
  portalId: PortalId;
  baseUrl: string;

  timeouts: PortalTimeouts;
  pacing: PortalPacing;
  rateLimit: PortalRateLimit;
  proxy: PortalProxy;
  hitl: PortalHitl;

  selectorsVersion: string;

  /** Optional: slot availability polling (portal-specific). Defaults applied in loader if missing. */
  slotHunt?: PortalSlotHunt;

  /** Optional: minimum total run duration in ms (e.g. 40500). If run finishes earlier, sleep until this. */
  minRunDurationMs?: number;
  /** Optional: interval in ms to perform a small mouse move (e.g. 10000). Keeps session "active". */
  mouseMoveIntervalMs?: number;
  /** Optional: human-like mouse – waypoint count min/max, jitter px, steps min/max, delay min/max. */
  mouseMoveSegmentsMin?: number;
  mouseMoveSegmentsMax?: number;
  mouseMoveJitterPx?: number;
  mouseMoveStepsMin?: number;
  mouseMoveStepsMax?: number;
  mouseMoveDelayMinMs?: number;
  mouseMoveDelayMaxMs?: number;
}
