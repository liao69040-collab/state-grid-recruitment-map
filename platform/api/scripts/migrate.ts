import { loadConfig } from '../src/config.js';
import { createDatabase } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrate.js';

const config = loadConfig();
const { db, pool } = createDatabase(config.databaseUrl);

try {
  await runMigrations(db);
  process.stdout.write('Database migrations completed.\n');
} finally {
  await pool.end();
}
