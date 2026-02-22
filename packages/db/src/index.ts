export { db, getDb, createDb, closeDb } from './client.js';
export type { Database } from './schema.js';
export * from './repositories/index.js';

// Re-export commonly used types from schema
export type {
  Customer,
  NewCustomer,
  CustomerUpdate,
  CustomerSecret,
  NewCustomerSecret,
  CustomerSecretUpdate,
  CustomerStatus,
  CustomerPreferences,
  CustomerFlags,
  SlotCheckPolicy,
  SystemSetting,
  NewSystemSetting,
  SystemSettingUpdate,
  SettingValueType,
  // Staff types
  StaffMember,
  NewStaffMember,
  StaffMemberUpdate,
  StaffActivityLog,
  NewStaffActivityLog,
  StaffSession,
  NewStaffSession,
  StaffRole,
  StaffStatus,
  StaffMetrics,
  StaffSettings,
  SessionStatus,
  AgentProfile,
  NewAgentProfile,
  AgentProfileUpdate,
} from './schema.js';
