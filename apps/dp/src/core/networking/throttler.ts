import type { PortalPacing } from '../../config/types.js';
import { jitteredDelay, sleep } from '../utils/time.js';

export class Throttler {
  constructor(private pacing: PortalPacing) {}

  async beforeAction(): Promise<void> {
    const ms = jitteredDelay(this.pacing.minDelayMs, this.pacing.maxDelayMs, this.pacing.jitter);
    await sleep(ms);
  }
}