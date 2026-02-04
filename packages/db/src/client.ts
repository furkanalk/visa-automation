import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import type { Database } from './schema.js';

let dbInstance: Kysely<Database> | null = null;

/**
 * Get database configuration from environment
 */
function getDbConfig() {
  return {
    host: process.env.DB_HOST ?? 'localhost',
    port: parseInt(process.env.DB_PORT ?? '5432', 10),
    database: process.env.DB_NAME ?? 'visa_automation',
    user: process.env.DB_USER ?? 'postgres',
    password: process.env.DB_PASSWORD ?? 'postgres',
    max: parseInt(process.env.DB_POOL_SIZE ?? '10', 10),
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
