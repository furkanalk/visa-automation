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

export interface PortalConfig {
  portalId: PortalId;
  baseUrl: string;

  timeouts: PortalTimeouts;
  pacing: PortalPacing;
  rateLimit: PortalRateLimit;
  proxy: PortalProxy;
  hitl: PortalHitl;

  selectorsVersion: string;
}
