/**
 * Bootstrap super_admin script.
 * Runs once at startup (via docker compose bootstrap-admin service).
 * Creates a system super_admin account that is hidden from the staff list (is_system = true).
 *
 * Required env vars:
 *   BOOTSTRAP_ADMIN_EMAIL    – login email
 *   BOOTSTRAP_ADMIN_PASSWORD – plain-text password (min 8 chars)
 * Optional:
 *   BOOTSTRAP_ADMIN_NAME     – display name (default: "System Administrator")
 */

import bcrypt from 'bcryptjs';
import { getDb } from '@visa-automation/db';

const DEFAULT_TENANT_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const BCRYPT_ROUNDS = 10;

async function run() {
  const email = (process.env.BOOTSTRAP_ADMIN_EMAIL ?? '').trim().toLowerCase();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD ?? '';
  const name = (process.env.BOOTSTRAP_ADMIN_NAME ?? 'System Administrator').trim();

  if (!email || !password) {
    console.log('[bootstrap-admin] BOOTSTRAP_ADMIN_EMAIL / BOOTSTRAP_ADMIN_PASSWORD not set — skipping.');
    process.exit(0);
  }

  if (password.length < 8) {
    console.error('[bootstrap-admin] BOOTSTRAP_ADMIN_PASSWORD must be at least 8 characters.');
    process.exit(1);
  }

  const db = getDb();

  // Check if this system account already exists
  const existing = await db
    .selectFrom('staff_members')
    .select('id')
    .where('tenant_id', '=', DEFAULT_TENANT_ID)
    .where('email', '=', email)
    .executeTakeFirst();

  if (existing) {
    console.log(`[bootstrap-admin] Account <${email}> already exists — skipping.`);
    await db.destroy();
    process.exit(0);
  }

  const password_hash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  await db
    .insertInto('staff_members')
    .values({
      tenant_id: DEFAULT_TENANT_ID,
      email,
      name,
      role: 'super_admin',
      status: 'active',
      password_hash,
      permissions: JSON.stringify([]) as unknown as string[],
      settings: JSON.stringify({}) as unknown as Record<string, unknown>,
      metrics: JSON.stringify({}) as unknown as Record<string, unknown>,
      is_system: true,
    })
    .execute();

  console.log(`[bootstrap-admin] ✓ Super admin created: <${email}>`);
  await db.destroy();
  process.exit(0);
}

run().catch((err) => {
  console.error('[bootstrap-admin] Fatal error:', err);
  process.exit(1);
});
