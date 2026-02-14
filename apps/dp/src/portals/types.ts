import type { Logger } from 'pino';
import type { JobQueuePayload } from '@visa-automation/shared';
import type { PortalConfig, PortalId } from '../config/types.js';

export interface PortalRunContext {
  jobId: string;
  tenantId: string;
  portalConfig: PortalConfig;
  jobData: JobQueuePayload;
  logger?: Logger;
}

export interface PortalRunResult {
  confirmationNumber?: string;
  meta?: Record<string, unknown>;
}

export interface PortalDriver {
  portalId: PortalId;
  run(ctx: PortalRunContext): Promise<PortalRunResult>;
}
