// PostgreSQL connection pool + schema bootstrap.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Pool, types, type PoolClient, type QueryResultRow } from 'pg';

// DATE columns come back as 'YYYY-MM-DD' strings, not JS Dates shifted by the local timezone.
types.setTypeParser(1082, (v: string) => v);

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Copy api/.env.example to api/.env and fill it in (see README → Database).');
  process.exit(1);
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.PG_POOL_MAX) || 10,
  idleTimeoutMillis: 30_000,
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: process.env.PGSSL_STRICT !== 'false' } : undefined
});
pool.on('error', err => console.error('Postgres pool error:', err.message));

export function query<R extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]) {
  return pool.query<R>(text, params);
}

export async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

// db/ sits next to src/ (dev) and next to dist/ (build).
const DB_DIR = path.join(__dirname, '..', 'db');

// Runs db/schema.sql (idempotent), then any db/migrations/*.sql not yet applied, then seeds settings.
export async function migrate(): Promise<void> {
  await pool.query(fs.readFileSync(path.join(DB_DIR, 'schema.sql'), 'utf8'));
  const migDir = path.join(DB_DIR, 'migrations');
  if (fs.existsSync(migDir)) {
    const done = new Set((await pool.query<{ version: string }>('SELECT version FROM schema_migrations')).rows.map(r => r.version));
    for (const f of fs.readdirSync(migDir).filter(f => f.endsWith('.sql')).sort()) {
      if (done.has(f)) continue;
      await tx(async c => {
        await c.query(fs.readFileSync(path.join(migDir, f), 'utf8'));
        await c.query('INSERT INTO schema_migrations(version) VALUES ($1)', [f]);
      });
      console.log('Applied migration', f);
    }
  }
  await pool.query(
    'INSERT INTO app_settings (id, session_secret) VALUES (true, $1) ON CONFLICT (id) DO NOTHING',
    [crypto.randomBytes(32).toString('hex')]
  );
}

// Multi-row INSERT, chunked to stay under Postgres' 65,535-parameter limit.
export async function insertMany(client: PoolClient, table: string, cols: string[], rows: unknown[][]): Promise<void> {
  if (!rows.length) return;
  const per = Math.max(1, Math.floor(60_000 / cols.length));
  for (let i = 0; i < rows.length; i += per) {
    const chunk = rows.slice(i, i + per);
    const params: unknown[] = [];
    const values = chunk.map(r => '(' + r.map(v => { params.push(v); return '$' + params.length; }).join(',') + ')');
    await client.query(`INSERT INTO ${table} (${cols.join(',')}) VALUES ${values.join(',')}`, params);
  }
}
