import type { PortalId } from '../config/types.js';

// ŞİMDİLİK DOKUNMA ama not al:

// 1️⃣ PortalDriver interface’ini
// apps/worker/src/portals/types.ts içine taşıyacağız
// (registry sadece registry olacak)

// 2️⃣ any’ler bilinçli TODO olarak kalsın
// Driver’lar oturunca:

// portalConfig: PortalConfig

// jobData: JobQueuePayload

export interface PortalDriver {
  portalId: PortalId;
  run(payload: {
    jobId: string;
    tenantId: string;
    // effective portal config
    portalConfig: any;
    // job-specific config/applicant etc. (şimdilik any)
    // Not: portalConfig:any / jobData:any şu an intentional. Portal driver interface’i stabil oturduktan sonra sıkı type’a çeviririz.
    jobData: any;
  }): Promise<{ confirmationNumber?: string }>;
}

const drivers = new Map<PortalId, PortalDriver>();

export function registerPortal(driver: PortalDriver) {
  if (drivers.has(driver.portalId)) {
    throw new Error(`portal already registered: ${driver.portalId}`);
  }
  drivers.set(driver.portalId, driver);
}


export function getPortal(portalId: PortalId): PortalDriver {
  const d = drivers.get(portalId);
  if (!d) throw new Error(`portal not registered: ${portalId}`);
  return d;
}
