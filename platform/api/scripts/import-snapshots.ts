import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { loadConfig } from '../src/config.js';
import { createDatabase } from '../src/db/client.js';
import { dataRevisions } from '../src/db/schema.js';
import { readSnapshotSource } from '../src/lib/snapshot-source.js';

const input = z
  .object({
    PUBLIC_DASHBOARD_PATH: z.string().min(1),
    PROVINCE_DASHBOARD_PATH: z.string().min(1),
    PROVINCE_ADCODE: z.string().regex(/^\d{6}$/).default('420000'),
    IMPORT_COHORT_YEAR: z.coerce.number().int().min(2000).max(2100).optional(),
  })
  .parse(process.env);

const config = loadConfig();
const { db, pool } = createDatabase(config.databaseUrl);

try {
  const [publicSource, provinceSource] = await Promise.all([
    readSnapshotSource(input.PUBLIC_DASHBOARD_PATH),
    readSnapshotSource(input.PROVINCE_DASHBOARD_PATH),
  ]);
  const snapshots = [
    {
      revisionKey: 'public-dashboard',
      title: '全国公开数据兼容快照',
      payload: publicSource.payload,
      metadata: {
        import_kind: 'compatibility_snapshot',
        source_hash_algorithm: 'sha256',
        source_sha256: publicSource.sourceSha256,
      },
    },
    {
      revisionKey: `province-${input.PROVINCE_ADCODE}-dashboard`,
      title: `${input.PROVINCE_ADCODE} 省级受保护数据兼容快照`,
      payload: provinceSource.payload,
      metadata: {
        import_kind: 'compatibility_snapshot',
        source_hash_algorithm: 'sha256',
        source_sha256: provinceSource.sourceSha256,
      },
    },
  ];
  await db.transaction(async (tx) => {
    for (const snapshot of snapshots) {
      const [existing] = await tx
        .select({ id: dataRevisions.id })
        .from(dataRevisions)
        .where(eq(dataRevisions.revisionKey, snapshot.revisionKey))
        .limit(1);
      const values = {
        ...snapshot,
        cohortYear: input.IMPORT_COHORT_YEAR ?? null,
        status: 'published' as const,
        dataStatus: 'verified' as const,
        publishedAt: new Date(),
        updatedAt: new Date(),
      };
      if (existing) await tx.update(dataRevisions).set(values).where(eq(dataRevisions.id, existing.id));
      else await tx.insert(dataRevisions).values(values);
    }
  });
  process.stdout.write('Public and province compatibility snapshots imported.\n');
} finally {
  await pool.end();
}
