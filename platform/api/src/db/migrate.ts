import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Database } from './client.js';

export async function runMigrations(db: Database): Promise<void> {
  const sourceLayout = fileURLToPath(new URL('../../drizzle', import.meta.url));
  const compiledLayout = fileURLToPath(new URL('../../../drizzle', import.meta.url));
  const migrationsFolder = existsSync(sourceLayout) ? sourceLayout : compiledLayout;
  await migrate(db, { migrationsFolder });
}
