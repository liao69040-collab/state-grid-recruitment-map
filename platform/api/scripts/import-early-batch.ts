import { readFile } from 'node:fs/promises';
import { and, count, eq, inArray, ne } from 'drizzle-orm';
import { z } from 'zod';
import { loadConfig } from '../src/config.js';
import { createDatabase } from '../src/db/client.js';
import {
  dataRevisions,
  earlyBatchPolicies,
  provinces,
  sourceDocuments,
} from '../src/db/schema.js';
import { deterministicUuid } from '../src/import/canonical.js';
import {
  earlyBatchSeedSchema,
  earlyBatchSourceMetadata,
} from '../src/import/early-batch-seed.js';

const env = z
  .object({
    EARLY_BATCH_SEED_PATH: z
      .string()
      .min(1)
      .default('../data-migration/early-batch-2026-v1.json'),
  })
  .parse(process.env);

async function upsert(tx: any, table: any, values: Record<string, unknown>): Promise<void> {
  const set = { ...values };
  delete set.id;
  await tx.insert(table).values(values).onConflictDoUpdate({ target: table.id, set });
}

const rawSeed = JSON.parse(await readFile(env.EARLY_BATCH_SEED_PATH, 'utf8')) as unknown;
const seed = earlyBatchSeedSchema.parse(rawSeed);
const policyKeys = seed.policies.map((policy) => policy.policy_key);
const targetCodes = seed.policies.map((policy) => policy.target_code);
if (new Set(policyKeys).size !== policyKeys.length) throw new Error('early-batch policy_key must be unique');
if (new Set(targetCodes).size !== targetCodes.length) throw new Error('early-batch target_code must be unique');
if (seed.policies.filter((policy) => policy.target_kind === 'province').length !== 21) {
  throw new Error('early-batch seed must contain exactly 21 province targets');
}
if (seed.policies.filter((policy) => policy.target_kind === 'unit').length !== 3) {
  throw new Error('early-batch seed must contain exactly 3 unit targets');
}
for (const policy of seed.policies) {
  if (policy.target_kind === 'province' && !policy.province_adcode) {
    throw new Error(`${policy.target_code} is a province target without an adcode`);
  }
  if (policy.target_kind === 'unit' && policy.province_adcode) {
    throw new Error(`${policy.target_code} must not masquerade as a province`);
  }
}

const config = loadConfig();
const { db, pool } = createDatabase(config.databaseUrl);
const sourceId = deterministicUuid(seed.source_document.source_key);
const revisionId = deterministicUuid(seed.revision.revision_key);

try {
  await db.transaction(async (tx) => {
    const adcodes = [
      ...new Set(
        seed.policies
          .flatMap((policy) => [policy.province_adcode, policy.parent_province_adcode])
          .filter((value): value is string => Boolean(value)),
      ),
    ];
    const provinceRows = adcodes.length
      ? await tx.select().from(provinces).where(inArray(provinces.adcode, adcodes))
      : [];
    const provinceByAdcode = new Map(provinceRows.map((province) => [province.adcode, province.id]));
    const missingAdcodes = adcodes.filter((adcode) => !provinceByAdcode.has(adcode));
    if (missingAdcodes.length) {
      throw new Error(`early-batch seed references missing provinces: ${missingAdcodes.join(', ')}`);
    }

    const importedAt = new Date(seed.generated_at);
    await upsert(tx, sourceDocuments, {
      id: sourceId,
      sourceKey: seed.source_document.source_key,
      title: seed.source_document.title,
      sourceType: seed.source_document.source_type,
      publisher: seed.source_document.publisher,
      officialUrl: seed.source_document.official_url,
      archivePath: seed.source_document.archive_path,
      checksumSha256: seed.source_document.checksum_sha256,
      accessedAt: importedAt,
      cohortYear: seed.source_document.cohort_year,
      batchCode: seed.source_document.batch_code,
      unitScope: seed.source_document.unit_scope,
      status: seed.source_document.status,
      notes: seed.source_document.notes,
      metadata: earlyBatchSourceMetadata(seed),
      updatedAt: importedAt,
    });

    await upsert(tx, dataRevisions, {
      id: revisionId,
      revisionKey: seed.revision.revision_key,
      title: seed.revision.title,
      description: seed.revision.description,
      cohortYear: seed.revision.cohort_year,
      batchCode: seed.revision.batch_code,
      unitScope: seed.revision.unit_scope,
      sourceDocumentId: sourceId,
      status: 'draft',
      dataStatus: seed.revision.data_status,
      payload: {
        schema_version: seed.schema_version,
        dataset_id: seed.dataset_id,
        data_quality: seed.data_quality,
      },
      metadata: {
        source_checksum_sha256: seed.source_document.checksum_sha256,
        source_locator: String(seed.data_quality.workbook_range ?? 'Sheet1!A1:K25'),
        expected_policy_count: 24,
      },
      publishedAt: null,
      updatedAt: importedAt,
    });

    for (const policy of seed.policies) {
      const policyId = deterministicUuid(policy.policy_key);
      await upsert(tx, earlyBatchPolicies, {
        id: policyId,
        policyKey: policy.policy_key,
        cohortYear: policy.cohort_year,
        batchCode: policy.batch_code,
        targetKind: policy.target_kind,
        targetCode: policy.target_code,
        targetName: policy.target_name,
        provinceId: policy.province_adcode
          ? (provinceByAdcode.get(policy.province_adcode) ?? null)
          : null,
        parentProvinceId: policy.parent_province_adcode
          ? (provinceByAdcode.get(policy.parent_province_adcode) ?? null)
          : null,
        recruitmentRequirements: policy.recruitment_requirements,
        recruitmentProcess: policy.recruitment_process,
        plannedHeadcountDisplay: policy.planned_headcount_display,
        assessmentMethod: policy.assessment_method,
        itineraryReference: policy.itinerary_reference,
        siteQuotaDisplay: policy.site_quota_display,
        admissionRule: policy.admission_rule,
        actualHeadcountDisplay: policy.actual_headcount_display,
        otherNotes: policy.other_notes,
        missingFields: policy.missing_fields,
        eligibilityModel: policy.eligibility_model,
        sourceLocator: policy.source_locator,
        evidenceAssets: policy.evidence_assets,
        externalEvidence: policy.external_evidence,
        sourceStatus: policy.source_status,
        sourceDocumentId: sourceId,
        revisionId,
        status: 'active',
        publicationStatus: 'draft',
        sortOrder: policy.sort_order,
        metadata: policy.metadata ?? {},
        updatedAt: importedAt,
      });
    }

    const [reconciliation] = await tx
      .select({ value: count() })
      .from(earlyBatchPolicies)
      .where(eq(earlyBatchPolicies.revisionId, revisionId));
    if (Number(reconciliation?.value ?? 0) !== 24) {
      throw new Error(`early-batch reconciliation failed: expected 24 policies`);
    }

    await tx
      .update(earlyBatchPolicies)
      .set({ publicationStatus: 'archived', status: 'archived', updatedAt: importedAt })
      .where(
        and(
          eq(earlyBatchPolicies.cohortYear, seed.revision.cohort_year),
          eq(earlyBatchPolicies.batchCode, seed.revision.batch_code),
          ne(earlyBatchPolicies.revisionId, revisionId),
          eq(earlyBatchPolicies.publicationStatus, 'published'),
        ),
      );
    await tx
      .update(dataRevisions)
      .set({ status: 'archived', updatedAt: importedAt })
      .where(
        and(
          eq(dataRevisions.cohortYear, seed.revision.cohort_year),
          eq(dataRevisions.batchCode, seed.revision.batch_code),
          ne(dataRevisions.id, revisionId),
          eq(dataRevisions.status, 'published'),
        ),
      );
    await tx
      .update(earlyBatchPolicies)
      .set({ publicationStatus: 'published', status: 'active', updatedAt: importedAt })
      .where(eq(earlyBatchPolicies.revisionId, revisionId));
    await tx
      .update(dataRevisions)
      .set({ status: 'published', publishedAt: importedAt, updatedAt: importedAt })
      .where(eq(dataRevisions.id, revisionId));
  });
  process.stdout.write(
    `Early-batch seed ${seed.dataset_id} imported and reconciled (24 policies).\n`,
  );
} finally {
  await pool.end();
}
