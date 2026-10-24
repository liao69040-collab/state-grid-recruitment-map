import { z } from 'zod';
import { loadConfig } from '../src/config.js';
import { createDatabase } from '../src/db/client.js';
import { hashPassword } from '../src/lib/crypto.js';
import { PostgresStore } from '../src/store/postgres.js';

const input = z
  .object({
    SUPERADMIN_USERNAME: z.string().trim().min(3).max(80),
    SUPERADMIN_PASSWORD: z.string().min(12).max(256),
    SUPERADMIN_DISPLAY_NAME: z.string().trim().min(1).max(120).default('超级管理员'),
  })
  .parse(process.env);

const config = loadConfig();
const { db, pool } = createDatabase(config.databaseUrl);
const store = new PostgresStore(db);

try {
  const admin = await store.upsertAdmin({
    username: input.SUPERADMIN_USERNAME,
    displayName: input.SUPERADMIN_DISPLAY_NAME,
    passwordHash: await hashPassword(input.SUPERADMIN_PASSWORD),
    role: 'superadmin',
  });
  await store.revokeAllAdminSessions(admin.id);
  process.stdout.write(`Superadmin ${admin.username} created or rotated; existing sessions revoked.\n`);
} finally {
  await pool.end();
}
