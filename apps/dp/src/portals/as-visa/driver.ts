import type { PortalDriver } from '../types.js';
import { PORTAL_ID } from './config.js';

export const asVisaDriver: PortalDriver = {
  portalId: PORTAL_ID,

  async run({ tenantId, jobData }) {
    void tenantId; void jobData;
    return {};
  },
};