/**
 * Run SQL migrations from packages/db/migrations.
 * Usage: node dist/migrate.js [up|down]
 * Env: DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD; optional SSL: DB_SSL_CA_PATH, DB_SSL_CERT_PATH, DB_SSL_KEY_PATH, DB_SSL
 */
import { Client } from 'pg';
import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { getSSLConfig } from './client.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

function requireEnv(name: string): string {
  const v = process.env[name];
  if (v === undefined || v === '') {
    throw new Error(`${name} is required (no default in production). Set it in environment.`);
  }
  return v;
}

function getConfig() {
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
    ...(ssl && { ssl }),
  };
}

async function ensureSchemaMigrations(client: Client): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

async function getApplied(client: Client): Promise<Set<string>> {
  const r = await client.query<{ filename: string }>('SELECT filename FROM schema_migrations');
  return new Set(r.rows.map((row) => row.filename));
}

async function up(client: Client, migrationsDir: string): Promise<void> {
  await ensureSchemaMigrations(client);
  const applied = await getApplied(client);
  const files = (await readdir(migrationsDir))
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const filename of files) {
    if (applied.has(filename)) {
      console.log('SKIP:', filename, '(already applied)');
      continue;
    }
    const filepath = join(migrationsDir, filename);
    const sql = await readFile(filepath, 'utf-8');
    console.log('APPLY:', filename);
    await client.query(sql);
    await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename]);
    console.log('✓ Applied:', filename);
  }
}

async function main(): Promise<void> {
  const cmd = process.argv[2] ?? 'up';
  const config = getConfig();
  const migrationsDir = join(__dirname, '..', 'migrations');
  const client = new Client(config);
  try {
    await client.connect();
    if (cmd === 'up') {
      await up(client, migrationsDir);
      console.log('Migrations completed.');
    } else if (cmd === 'down') {
      console.log('Down not implemented. Use SQL to revert if needed.');
    } else {
      console.log('Usage: node dist/migrate.js [up|down]');
      process.exit(1);
    }
  } catch (err) {
    console.error(err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
