import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.js';

export function createDatabase(databaseUrl: string) {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 12,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  // pg already removes a broken idle client. An unhandled pool error would
  // nevertheless terminate Node, taking healthy requests down with it. Keep
  // the pool available for replacement connections and log only SQLSTATE.
  pool.on('error', (error: Error & { code?: string }) => {
    const code = typeof error.code === 'string' && /^[A-Z0-9]{5}$/.test(error.code)
      ? error.code
      : 'UNKNOWN';
    console.error('POSTGRES_IDLE_CONNECTION_ERROR', code);
  });
  const db = drizzle(pool, { schema });
  return { db, pool };
}

export type Database = ReturnType<typeof createDatabase>['db'];
