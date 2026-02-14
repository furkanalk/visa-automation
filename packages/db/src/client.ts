import { readFileSync } from 'fs';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import type { Database } from './schema.js';

let dbInstance: Kysely<Database> | null = null;

/**
 * Build SSL/mTLS options from env when DB_SSL_CA_PATH or DB_SSL=require is set.
 * DB_SSL_CA_PATH, DB_SSL_CERT_PATH, DB_SSL_KEY_PATH = paths to PEM files.
 * DB_SSL_REJECT_UNAUTHORIZED = false to skip server cert verify (dev only).
 * Exported for use by migrate and other callers.
 */
export function getSSLConfig(): import('pg').PoolConfig['ssl'] | undefined {
  const caPath = process.env.DB_SSL_CA_PATH;
  const certPath = process.env.DB_SSL_CERT_PATH;
  const keyPath = process.env.DB_SSL_KEY_PATH;
  const sslMode = process.env.DB_SSL; // require | verify-full | off

  if (!caPath && sslMode !== 'require' && sslMode !== 'verify-full') {
    return undefined;
  }

  const rejectUnauthorized = process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false';

  if (caPath) {
    const ssl: { ca: Buffer; cert?: Buffer; key?: Buffer; rejectUnauthorized: boolean } = {
      ca: readFileSync(caPath),
      rejectUnauthorized,
    };
    if (certPath) ssl.cert = readFileSync(certPath);
    if (keyPath) ssl.key = readFileSync(keyPath);
    return ssl;
  }

  return rejectUnauthorized ? { rejectUnauthorized: true } : { rejectUnauthorized: false };
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (v === undefined || v === '') {
    throw new Error(`${name} is required (no default in production). Set it in environment.`);
  }
  return v;
}

/**
 * Get database configuration from environment. Required: DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD.
 */
function getDbConfig(): import('pg').PoolConfig {
  const ssl = getSSLConfig();
  const port = parseInt(requireEnv('DB_PORT'), 10);
  if (Number.isNaN(port) || port < 1 || port > 65535) {
    throw new Error('DB_PORT must be a valid port number (1-65535).');
  }
  return {
    host: requireEnv('DB_HOST'),
    port,
    database: requireEnv('DB_NAME'),
    user: requireEnv('DB_USER'),
    password: requireEnv('DB_PASSWORD'),
    max: parseInt(process.env.DB_POOL_SIZE ?? '10', 10),
    ...(ssl && { ssl }),
  };
}

/**
 * Create a new database connection
 */
export function createDb(): Kysely<Database> {
  const config = getDbConfig();
  
  const dialect = new PostgresDialect({
    pool: new Pool(config),
  });
  
  return new Kysely<Database>({ dialect });
}

/**
 * Get or create database instance (singleton)
 */
export function getDb(): Kysely<Database> {
  if (!dbInstance) {
    dbInstance = createDb();
  }
  return dbInstance;
}

/**
 * Close database connection
 */
export async function closeDb(): Promise<void> {
  if (dbInstance) {
    await dbInstance.destroy();
    dbInstance = null;
  }
}

/**
 * Exported database instance
 */
export const db = {
  get instance(): Kysely<Database> {
    return getDb();
  },
};
