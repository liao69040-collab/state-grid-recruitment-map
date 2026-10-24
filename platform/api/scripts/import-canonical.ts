import { readFile } from 'node:fs/promises';
import { inArray } from 'drizzle-orm';
import { z } from 'zod';
import { loadConfig } from '../src/config.js';
import { createDatabase } from '../src/db/client.js';
import {
  auditEvents,
  cities,
  companies,
  dataRevisions,
  provinces,
  recruitmentBatches,
  recruitmentEvents,
  recruitmentMetrics,
  schools,
  sourceDocuments,
} from '../src/db/schema.js';
import {
  arrayStrings,
  canonicalMetricColumns,
  deterministicUuid,
  nullableString,
  numberValue,
  primarySourceKey,
  requiredInteger,
  requiredString,
  stringValue,
  type CanonicalRow,
} from '../src/import/canonical.js';

const env = z
  .object({
    CANONICAL_SEED_PATH: z.string().min(1).default('../data-migration/canonical-seed-v2.json'),
  })
  .parse(process.env);

type JsonRow = CanonicalRow;

const LEGACY_REFERENCE_BATCH_KEYS = [
  'BATCH-SGCC-HUBEI-2027-BATCH_1',
  'BATCH-SGCC-HUBEI-2027-BATCH_2',
  'BATCH-SGCC-HUBEI-2027-BATCH_3',
  'BATCH-SGCC-HUBEI-2027-CAMPUS',
] as const;
const LEGACY_REFERENCE_EVENT_KEYS = [
  'EVENT-SGCC-HUBEI-2027-BATCH_1-REFERENCE-WINDOW',
  'EVENT-SGCC-HUBEI-2027-BATCH_2-REFERENCE-WINDOW',
  'EVENT-SGCC-HUBEI-2027-BATCH_3-REFERENCE-WINDOW',
  'EVENT-SGCC-HUBEI-2027-CAMPUS-REFERENCE-WINDOW',
] as const;

const seedSchema = z.object({
  dataset_id: z.string(),
  schema_version: z.string(),
  generated_at: z.string(),
  network: z.string(),
  provinces: z.array(z.record(z.string(), z.unknown())),
  cities: z.array(z.record(z.string(), z.unknown())),
  schools: z.array(z.record(z.string(), z.unknown())),
  companies: z.array(z.record(z.string(), z.unknown())),
  recruitment_batches: z.array(z.record(z.string(), z.unknown())),
  recruitment_events: z.array(z.record(z.string(), z.unknown())),
  recruitment_metrics: z.array(z.record(z.string(), z.unknown())),
  source_documents: z.array(z.record(z.string(), z.unknown())),
  data_revisions: z.array(z.record(z.string(), z.unknown())),
});

function dateValue(row: JsonRow, key: string): Date | null {
  const value = nullableString(row, key);
  if (!value) return null;
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00+08:00` : value;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function numericString(value: number | null): string | null {
  return value === null ? null : String(value);
}

function notesValue(row: JsonRow): string | null {
  const notes = row.notes;
  if (typeof notes === 'string') return notes;
  if (Array.isArray(notes)) return notes.filter((item) => typeof item === 'string').join('\n') || null;
  const detail = row.detail;
  return typeof detail === 'string' ? detail : null;
}

const rawSeed = JSON.parse(await readFile(env.CANONICAL_SEED_PATH, 'utf8')) as unknown;
const seed = seedSchema.parse(rawSeed);
const config = loadConfig();
const { db, pool } = createDatabase(config.databaseUrl);

for (const row of [...seed.recruitment_batches, ...seed.recruitment_events, ...seed.recruitment_metrics]) {
  if (requiredInteger(row, 'year', 'canonical business record') !== 2026) {
    throw new Error('Canonical import accepts only 2026 business facts in this release');
  }
}

const sourceKeys = new Set(seed.source_documents.map((row) => stringValue(row, 'source_id')));
const provinceKeys = new Set(seed.provinces.map((row) => stringValue(row, 'province_id')));
const cityKeys = new Set(seed.cities.map((row) => stringValue(row, 'city_id')));
const schoolKeys = new Set(seed.schools.map((row) => stringValue(row, 'school_id')));
const companyKeys = new Set(seed.companies.map((row) => stringValue(row, 'company_id')));
const batchKeys = new Set(seed.recruitment_batches.map((row) => stringValue(row, 'batch_id')));
const batchCodeById = new Map(
  seed.recruitment_batches.map((row) => [stringValue(row, 'batch_id'), stringValue(row, 'batch_code', 'pending')]),
);
const companyNameById = new Map(
  seed.companies.map((row) => [stringValue(row, 'company_id'), stringValue(row, 'company_name')]),
);

type SourceContext = {
  cohortYears: Set<number>;
  batchCodes: Set<string>;
  unitScopes: Set<string>;
};
const sourceContexts = new Map<string, SourceContext>();

function addSourceContext(row: JsonRow, rowLabel: string): void {
  const sourceKey = primarySourceKey(row, rowLabel);
  const context = sourceContexts.get(sourceKey) ?? {
    cohortYears: new Set<number>(),
    batchCodes: new Set<string>(),
    unitScopes: new Set<string>(),
  };
  const cohortYear = numberValue(row, 'year');
  if (cohortYear !== null && Number.isInteger(cohortYear)) context.cohortYears.add(cohortYear);
  const batchExternalId = nullableString(row, 'batch_id');
  if (batchExternalId) {
    const batchCode = batchCodeById.get(batchExternalId);
    if (batchCode) context.batchCodes.add(batchCode);
  }
  context.unitScopes.add(scopedUnitName(row));
  sourceContexts.set(sourceKey, context);
}

for (const row of seed.recruitment_batches) {
  addSourceContext(row, `recruitment_batches.${stringValue(row, 'batch_id', 'unknown')}`);
}
for (const row of seed.recruitment_events) {
  addSourceContext(row, `recruitment_events.${stringValue(row, 'event_id', 'unknown')}`);
}
for (const row of seed.recruitment_metrics) {
  addSourceContext(row, `recruitment_metrics.${stringValue(row, 'metric_id', 'unknown')}`);
}

function referenceId(key: unknown, available: Set<string>): string | null {
  return typeof key === 'string' && available.has(key) ? deterministicUuid(key) : null;
}

function firstSourceId(row: JsonRow): string | null {
  const key = arrayStrings(row, 'source_ids').find((sourceId) => sourceKeys.has(sourceId));
  return key ? deterministicUuid(key) : null;
}

function requiredSourceId(row: JsonRow, rowLabel: string): string {
  const key = primarySourceKey(row, rowLabel);
  if (!sourceKeys.has(key)) throw new Error(`${rowLabel}.source_ids references unknown source ${key}`);
  return deterministicUuid(key);
}

function scopedUnitName(row: JsonRow): string {
  const companyId = nullableString(row, 'company_id');
  return (companyId ? companyNameById.get(companyId) : undefined) ?? seed.network;
}

function referencedBatchCode(batchExternalId: string | null, rowLabel: string): string {
  if (!batchExternalId) return 'not_applicable';
  const code = batchCodeById.get(batchExternalId);
  if (!code) throw new Error(`${rowLabel}.batch_id references unknown batch ${batchExternalId}`);
  return code;
}

async function upsert(tx: any, table: any, values: Record<string, unknown>): Promise<void> {
  const set = { ...values };
  delete set.id;
  await tx.insert(table).values(values).onConflictDoUpdate({ target: table.id, set });
}

try {
  await db.transaction(async (tx) => {
    // The previous release inserted four synthetic 2027 reference rows. They are
    // not business facts and an upsert-only import cannot remove them, so clean
    // up only these explicitly named legacy keys before loading the 2026 dataset.
    const deletedLegacyEvents = await tx
      .delete(recruitmentEvents)
      .where(inArray(recruitmentEvents.eventKey, [...LEGACY_REFERENCE_EVENT_KEYS]))
      .returning({ id: recruitmentEvents.id });
    const deletedLegacyBatches = await tx
      .delete(recruitmentBatches)
      .where(inArray(recruitmentBatches.batchKey, [...LEGACY_REFERENCE_BATCH_KEYS]))
      .returning({ id: recruitmentBatches.id });

    for (const row of seed.source_documents) {
      const sourceKey = stringValue(row, 'source_id');
      const sourceContext = sourceContexts.get(sourceKey);
      await upsert(tx, sourceDocuments, {
        id: deterministicUuid(sourceKey),
        sourceKey,
        title: stringValue(row, 'title', sourceKey),
        sourceType: stringValue(row, 'source_type', 'unknown'),
        publisher: nullableString(row, 'publisher'),
        officialUrl: nullableString(row, 'source_url'),
        archivePath: nullableString(row, 'local_relative_path'),
        checksumSha256: nullableString(row, 'file_sha256'),
        publishedAt: dateValue(row, 'published_at'),
        accessedAt: dateValue(row, 'data_as_of'),
        cohortYear:
          sourceContext?.cohortYears.size === 1 ? [...sourceContext.cohortYears][0]! : null,
        batchCode:
          sourceContext?.batchCodes.size === 1 ? [...sourceContext.batchCodes][0]! : null,
        unitScope:
          sourceContext?.unitScopes.size === 1 ? [...sourceContext.unitScopes][0]! : null,
        status: stringValue(row, 'verification_status', 'pending'),
        notes: nullableString(row, 'status_note'),
        metadata: row,
        updatedAt: dateValue(row, 'updated_at') ?? new Date(),
      });
    }

    for (const row of seed.provinces) {
      const key = stringValue(row, 'province_id');
      const mapCenter = Array.isArray(row.map_center) ? row.map_center : null;
      const mapCentroid = Array.isArray(row.map_centroid) ? row.map_centroid : null;
      await upsert(tx, provinces, {
        id: deterministicUuid(key),
        provinceKey: key,
        adcode: stringValue(row, 'province_adcode'),
        name: stringValue(row, 'province_name', key),
        shortName: null,
        region: nullableString(row, 'country_region'),
        mapClickable: row.map_clickable === true,
        mapCenter,
        mapCentroid,
        mapChildrenCount: numberValue(row, 'map_children_count'),
        geometrySourceId: nullableString(row, 'geometry_source_id'),
        businessDataStatus: stringValue(row, 'business_data_status', 'pending'),
        status: stringValue(row, 'verification_status', 'pending'),
        enabled: true,
        metadata: row,
        updatedAt: dateValue(row, 'updated_at') ?? new Date(),
      });
    }

    for (const row of seed.cities) {
      const key = stringValue(row, 'city_id');
      const provinceId = referenceId(row.province_id, provinceKeys);
      if (!provinceId) throw new Error(`City ${key} references an unknown province`);
      await upsert(tx, cities, {
        id: deterministicUuid(key),
        cityKey: key,
        provinceId,
        adcode: nullableString(row, 'city_adcode'),
        name: stringValue(row, 'city_name', key),
        longitude: null,
        latitude: null,
        enabled: true,
        status: stringValue(row, 'verification_status', 'pending'),
        metadata: row,
        updatedAt: dateValue(row, 'updated_at') ?? new Date(),
      });
    }

    for (const row of seed.schools) {
      const key = stringValue(row, 'school_id');
      await upsert(tx, schools, {
        id: deterministicUuid(key),
        schoolKey: key,
        name: stringValue(row, 'display_name', stringValue(row, 'standard_name', key)),
        provinceId: referenceId(row.province_id, provinceKeys),
        cityId: referenceId(row.city_id, cityKeys),
        nature: nullableString(row, 'school_nature'),
        educationLevel: nullableString(row, 'education_level'),
        address: nullableString(row, 'official_note'),
        longitude: numericString(numberValue(row, 'longitude')),
        latitude: numericString(numberValue(row, 'latitude')),
        cohortYear: null,
        batchCode: null,
        unitScope: nullableString(row, 'country_region'),
        sourceDocumentId: firstSourceId(row),
        status: stringValue(row, 'verification_status', 'pending'),
        publicationStatus: 'published',
        notes: notesValue(row),
        metadata: row,
        updatedAt: dateValue(row, 'updated_at') ?? new Date(),
      });
    }

    for (const row of seed.companies) {
      const key = stringValue(row, 'company_id');
      await upsert(tx, companies, {
        id: deterministicUuid(key),
        companyKey: key,
        name: stringValue(row, 'company_name', key),
        parentCompanyId: referenceId(row.parent_company_id, companyKeys),
        provinceId: referenceId(row.province_id, provinceKeys),
        cityId: referenceId(row.city_id, cityKeys),
        companyType: nullableString(row, 'company_type'),
        address: nullableString(row, 'location_label'),
        longitude: numericString(numberValue(row, 'longitude')),
        latitude: numericString(numberValue(row, 'latitude')),
        cohortYear: null,
        batchCode: null,
        unitScope: nullableString(row, 'network'),
        sourceDocumentId: firstSourceId(row),
        status: stringValue(row, 'verification_status', 'pending'),
        publicationStatus: 'published',
        notes: notesValue(row),
        metadata: row,
        updatedAt: dateValue(row, 'updated_at') ?? new Date(),
      });
    }

    for (const row of seed.recruitment_batches) {
      const key = requiredString(row, 'batch_id', 'recruitment_batches');
      const rowLabel = `recruitment_batches.${key}`;
      const provinceId = referenceId(row.province_id, provinceKeys);
      const companyId = referenceId(row.company_id, companyKeys);
      if (!provinceId) throw new Error(`${rowLabel}.province_id is required and must exist`);
      if (!companyId) throw new Error(`${rowLabel}.company_id is required and must exist`);
      await upsert(tx, recruitmentBatches, {
        id: deterministicUuid(key),
        batchKey: key,
        cohortYear: requiredInteger(row, 'year', rowLabel),
        code: requiredString(row, 'batch_code', rowLabel),
        name: stringValue(row, 'ui_alias', stringValue(row, 'official_batch_title', key)),
        unitScope: scopedUnitName(row),
        provinceId,
        companyId,
        applicationStartsAt: dateValue(row, 'announcement_published_at'),
        applicationEndsAt: dateValue(row, 'application_deadline'),
        examStartsAt: dateValue(row, 'exam_at'),
        examEndsAt: null,
        sourceDocumentId: requiredSourceId(row, rowLabel),
        sourceKeys: arrayStrings(row, 'source_ids'),
        status: stringValue(row, 'verification_status', 'pending'),
        publicationStatus: 'published',
        notes: notesValue(row),
        metadata: row,
        updatedAt: dateValue(row, 'updated_at') ?? new Date(),
      });
    }

    for (const row of seed.recruitment_events) {
      const key = requiredString(row, 'event_id', 'recruitment_events');
      const rowLabel = `recruitment_events.${key}`;
      const batchExternalId = nullableString(row, 'batch_id');
      await upsert(tx, recruitmentEvents, {
        id: deterministicUuid(key),
        eventKey: key,
        cohortYear: requiredInteger(row, 'year', rowLabel),
        batchId: referenceId(batchExternalId, batchKeys),
        batchCode: referencedBatchCode(batchExternalId, rowLabel),
        provinceId: referenceId(row.province_id, provinceKeys),
        cityId: null,
        companyId: referenceId(row.company_id, companyKeys),
        scopeKind: 'province_company',
        unitScope: scopedUnitName(row),
        eventType: stringValue(row, 'event_type', 'unknown'),
        title: stringValue(row, 'stage', stringValue(row, 'date_text', key)),
        startsAt: dateValue(row, 'start_at'),
        endsAt: dateValue(row, 'end_at') ?? dateValue(row, 'target_at'),
        timezone: 'Asia/Shanghai',
        sourceDocumentId: requiredSourceId(row, rowLabel),
        sourceKeys: arrayStrings(row, 'source_ids'),
        status: stringValue(row, 'verification_status', 'pending'),
        publicationStatus: 'published',
        notes: notesValue(row),
        metadata: row,
        updatedAt: dateValue(row, 'updated_at') ?? new Date(),
      });
    }

    for (const row of seed.recruitment_metrics) {
      const metricColumns = canonicalMetricColumns(row, {
        network: seed.network,
        batchCodeById,
        companyNameById,
      });
      const key = metricColumns.metricKey;
      const rowLabel = `recruitment_metrics.${key}`;
      const batchExternalId = nullableString(row, 'batch_id');
      await upsert(tx, recruitmentMetrics, {
        id: deterministicUuid(key),
        ...metricColumns,
        batchId: referenceId(batchExternalId, batchKeys),
        provinceId: referenceId(row.province_id, provinceKeys),
        cityId: referenceId(row.city_id, cityKeys),
        schoolId: referenceId(row.school_id, schoolKeys),
        companyId: referenceId(row.company_id, companyKeys),
        destinationScope: 'province_company',
        disciplineGroup: 'all',
        majorCategory: null,
        sampleSize: null,
        sourceDocumentId: requiredSourceId(row, rowLabel),
        status: stringValue(row, 'verification_status', 'pending'),
        publicationStatus: 'published',
        notes: notesValue(row),
        metadata: row,
        updatedAt: dateValue(row, 'updated_at') ?? new Date(),
      });
    }

    for (const row of seed.data_revisions) {
      const key = stringValue(row, 'revision_id', `${seed.dataset_id}-${seed.generated_at}`);
      await upsert(tx, dataRevisions, {
        id: deterministicUuid(key),
        revisionKey: key,
        title: `${stringValue(row, 'dataset_id', seed.dataset_id)} ${stringValue(row, 'schema_version', seed.schema_version)}`,
        description: `Canonical seed imported from ${env.CANONICAL_SEED_PATH}`,
        cohortYear: null,
        batchCode: null,
        unitScope: seed.network,
        sourceDocumentId: firstSourceId(row),
        status: 'published',
        dataStatus: stringValue(row, 'verification_status', 'validated_after_build'),
        payload: row,
        metadata: {
          seedDatasetId: seed.dataset_id,
          seedSchemaVersion: seed.schema_version,
          seedGeneratedAt: seed.generated_at,
        },
        publishedAt: dateValue(row, 'generated_at') ?? new Date(),
        updatedAt: dateValue(row, 'updated_at') ?? new Date(),
      });
    }

    await upsert(tx, auditEvents, {
      id: deterministicUuid(`AUDIT-CANONICAL:${seed.dataset_id}:${seed.generated_at}`),
      actorType: 'system',
      action: 'canonical-seed.import',
      resourceType: 'dataset',
      resourceId: seed.dataset_id,
      outcome: 'success',
      metadata: {
        schemaVersion: seed.schema_version,
        generatedAt: seed.generated_at,
        cleanup: {
          legacyReferenceEventsRemoved: deletedLegacyEvents.length,
          legacyReferenceBatchesRemoved: deletedLegacyBatches.length,
        },
        counts: {
          provinces: seed.provinces.length,
          cities: seed.cities.length,
          schools: seed.schools.length,
          companies: seed.companies.length,
          recruitmentBatches: seed.recruitment_batches.length,
          recruitmentEvents: seed.recruitment_events.length,
          recruitmentMetrics: seed.recruitment_metrics.length,
          sourceDocuments: seed.source_documents.length,
        },
      },
    });
  });
  process.stdout.write(`Canonical seed ${seed.dataset_id} imported idempotently.\n`);
} finally {
  await pool.end();
}
