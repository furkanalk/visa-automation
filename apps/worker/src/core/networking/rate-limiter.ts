import type { PortalRateLimit } from '../../config/types.js';

export class RateLimiter {
  private tokens: number;
  private lastRefill: number;

  constructor(private cfg: PortalRateLimit) {
    this.tokens = cfg.burst;
    this.lastRefill = Date.now();
  }

  async take(): Promise<void> {
    if (!this.cfg.enabled) return;

    while (true) {
      this.refill();
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  private refill() {
    const now = Date.now();
    const elapsedMs = now - this.lastRefill;
    if (elapsedMs <= 0) return;

    const tokensPerMs = this.cfg.actionsPerMinute / 60_000;
    const add = elapsedMs * tokensPerMs;

    if (add >= 0.25) {
      this.tokens = Math.min(this.cfg.burst, this.tokens + add);
      this.lastRefill = now;
    }
  }
}