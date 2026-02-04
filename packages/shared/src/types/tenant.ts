/**
 * Tenant entity - represents a customer organization
 */
export interface Tenant {
  id: string;
  name: string;
  slug: string;
  config: TenantConfig;
  status: TenantStatus;
  created_at: Date;
  updated_at: Date;
}

export interface TenantConfig {
  max_concurrent_jobs: number;
  default_priority: number;
  notification_channels: NotificationChannel[];
  webhook_url?: string;
  hitl_timeout_minutes: number;
}

export type TenantStatus = 'ACTIVE' | 'SUSPENDED' | 'DELETED';

export type NotificationChannel = 'EMAIL' | 'WEBHOOK' | 'SMS';

/**
 * User entity - belongs to a tenant
 */
export interface User {
  id: string;
  tenant_id: string;
  email: string;
  name: string;
  role: UserRole;
  status: UserStatus;
  created_at: Date;
  updated_at: Date;
}

export type UserRole = 'admin' | 'operator' | 'viewer';
export type UserStatus = 'ACTIVE' | 'INACTIVE' | 'DELETED';
