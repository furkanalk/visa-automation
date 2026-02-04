/**
 * Evidence Pack - sealed proof of completed work
 */
export interface EvidencePack {
  id: string;
  job_id: string;
  tenant_id: string;
  storage_path: string;
  checksum: string;
  size_bytes: number;
  sealed_at: Date;
  expires_at?: Date;
  contents: EvidencePackContents;
}

export interface EvidencePackContents {
  screenshots: string[];
  html_snapshots: string[];
  timeline: EvidenceTimelineEntry[];
  confirmation_number?: string;
  appointment_details?: AppointmentDetails;
}

export interface EvidenceTimelineEntry {
  timestamp: Date;
  state: string;
  message: string;
  screenshot_ref?: string;
}

export interface AppointmentDetails {
  date: string;
  time: string;
  location: string;
  reference_number: string;
}
