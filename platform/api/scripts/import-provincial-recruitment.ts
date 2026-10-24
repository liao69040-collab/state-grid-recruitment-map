import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { loadConfig } from '../src/config.js';
import { createDatabase } from '../src/db/client.js';
import {
  auditEvents,
  companies,
  dataRevisions,
  provinces,
  recruitmentBatches,
  recruitmentEvents,
  recruitmentMetrics,
  recruitmentRequirements,
  sourceDocuments,
} from '../src/db/schema.js';
import { deterministicUuid } from '../src/import/canonical.js';

const env = z
  .object({
    PROVINCIAL_RECRUITMENT_SEED_PATH: z
      .string()
      .min(1)
      .default('../data-migration/provincial-recruitment-2026-v1.json'),
  })
  .parse(process.env);

const record = z.record(z.string(), z.unknown());
const seedSchema = z.object({
  schemaVersion: z.string(),
  datasetId: z.literal('sgcc-provincial-recruitment-2026-v1'),
  generatedAt: z.string(),
  asOf: z.string(),
  units: z.array(record).length(27),
  sources: z.array(record).min(309),
  batches: z.array(record).min(1),
  events: z.array(record).min(1),
  requirements: z.array(record),
  headcountFacts: z.array(record).min(300),
  profiles: z.array(record).length(27),
});

type Row = Record<string, unknown>;

const requiredString = (row: Row, key: string, label: string): string => {
  const value = row[key];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label}.${key} is required`);
  return value.trim();
};

const optionalString = (row: Row, key: string): string | null => {
  const value = row[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
};

const optionalRawString = (row: Row, key: string): string | null => {
  const value = row[key];
  return typeof value === 'string' && value.length ? value : null;
};

const optionalInteger = (row: Row, key: string): number | null => {
  const value = row[key];
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
};

const objectValue = (row: Row, key: string): Record<string, unknown> => {
  const value = row[key];
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
};

const stringArray = (row: Row, key: string, label: string): string[] => {
  const value = row[key];
  if (!Array.isArray(value)) throw new Error(`${label}.${key} must be an array`);
  const output = value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()));
  if (!output.length) throw new Error(`${label}.${key} must contain at least one source key`);
  return [...new Set(output)];
};

const dateTime = (row: Row, key: string): Date | null => {
  const value = optionalString(row, key);
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${key} is not a valid timestamp: ${value}`);
  return parsed;
};

const publicationDate = (row: Row, key: string): Date | null => {
  const value = optionalString(row, key);
  if (!value) return null;
  const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00+08:00` : value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${key} is not a valid date: ${value}`);
  return parsed;
};

const requirementCategoryPriority = [
  'application_materials',
  'major',
  'education',
  'academic_verification',
  'health',
  'age',
  'cohort',
  'language_and_computer',
  'overseas_education',
  'special_obligation',
  'integrity',
  'training_mode',
] as const;

function requirementEvidenceIdentity(row: Row, label: string): string {
  return [
    requiredString(row, 'unitKey', label),
    requiredString(row, 'batchCode', label),
    optionalString(row, 'evidenceLocator') ?? 'no-locator',
    requiredString(row, 'excerpt', label),
  ].join('|');
}

function stableEvidenceGroupKey(identity: string): string {
  return `requirement-evidence:${createHash('sha256').update(identity).digest('hex').slice(0, 24)}`;
}

function normalizedEvidenceText(value: string): string {
  return value.replace(/[\s\u3000]/g, '').replace(/[；;：:，,。．]/g, '');
}

function applicabilityAssessment(row: Row): {
  value: string | null;
  status: 'verified' | 'needs_review' | 'not_disclosed';
  original: string | null;
} {
  const original = optionalString(row, 'applicability');
  if (!original) return { value: null, status: 'not_disclosed', original: null };
  const afterScope = original.replace(/^[^；;]{1,20}[；;]\s*/, '');
  const numbered = afterScope.match(/^\d+[.\u3001\uff0e)]\s*(.+)$/s);
  if (!numbered) return { value: original, status: 'verified', original };
  const applicabilityText = normalizedEvidenceText(numbered[1] ?? '');
  const excerptText = normalizedEvidenceText(requiredString(row, 'excerpt', 'requirement'));
  const matchesEvidence =
    applicabilityText.length >= 8 &&
    (excerptText.includes(applicabilityText) || applicabilityText.includes(excerptText));
  return matchesEvidence
    ? { value: original, status: 'verified', original }
    : { value: null, status: 'needs_review', original };
}

const rawSeed = JSON.parse(await readFile(env.PROVINCIAL_RECRUITMENT_SEED_PATH, 'utf8')) as unknown;
const seed = seedSchema.parse(rawSeed);
const config = loadConfig();
const { db, pool } = createDatabase(config.databaseUrl);

const HUBEI_PROVINCIAL_UNIT_KEY = 'sgcc-unit:10450001';
const HUBEI_CANONICAL_COMPANY_KEY = 'COMPANY-SGCC-HUBEI';
const HUBEI_CANONICAL_BATCH_KEYS: Record<string, string> = {
  campus: 'BATCH-SGCC-HUBEI-2026-CAMPUS',
  batch_1: 'BATCH-SGCC-HUBEI-2026-BATCH_1',
  batch_2: 'BATCH-SGCC-HUBEI-2026-BATCH_2',
  batch_3: 'BATCH-SGCC-HUBEI-2026-BATCH_3',
};
const LEGACY_HUBEI_SUMMARY_EVENT_KEYS = [
  'EVENT-SGCC-HUBEI-2026-BATCH1-APPLICATION',
  'EVENT-SGCC-HUBEI-2026-BATCH1-CONFIRMATION',
  'EVENT-SGCC-HUBEI-2026-BATCH1-INTERVIEW',
  'EVENT-SGCC-HUBEI-2026-BATCH1-QUALIFICATION',
  'EVENT-SGCC-HUBEI-2026-BATCH1-RESULT',
  'EVENT-SGCC-HUBEI-2026-BATCH1-WRITTEN',
  'EVENT-SGCC-HUBEI-2026-BATCH2-APPLICATION',
  'EVENT-SGCC-HUBEI-2026-BATCH2-CONFIRMATION',
  'EVENT-SGCC-HUBEI-2026-BATCH2-INTERVIEW',
  'EVENT-SGCC-HUBEI-2026-BATCH2-QUALIFICATION',
  'EVENT-SGCC-HUBEI-2026-BATCH2-RESULT',
  'EVENT-SGCC-HUBEI-2026-BATCH2-WRITTEN',
  'EVENT-SGCC-HUBEI-2026-BATCH3-APPLICATION',
  'EVENT-SGCC-HUBEI-2026-BATCH3-CONFIRMATION',
  'EVENT-SGCC-HUBEI-2026-BATCH3-INTERVIEW',
  'EVENT-SGCC-HUBEI-2026-BATCH3-QUALIFICATION',
  'EVENT-SGCC-HUBEI-2026-BATCH3-RESULT',
  'EVENT-SGCC-HUBEI-2026-BATCH3-WRITTEN',
  'EVENT-SGCC-HUBEI-2026-CAMPUS-ANNOUNCEMENT',
  'EVENT-SGCC-HUBEI-2026-CAMPUS-APPLICATION',
  'EVENT-SGCC-HUBEI-2026-CAMPUS-ROADSHOW-INTERVIEW',
] as const;

function canonicalCompanyKey(unitKey: string): string {
  return unitKey === HUBEI_PROVINCIAL_UNIT_KEY ? HUBEI_CANONICAL_COMPANY_KEY : unitKey;
}

function companyIdFor(unitKey: string): string {
  return deterministicUuid(canonicalCompanyKey(unitKey));
}

function canonicalBatchKey(unitKey: string, batchCode: string, fallback: string): string {
  return unitKey === HUBEI_PROVINCIAL_UNIT_KEY
    ? (HUBEI_CANONICAL_BATCH_KEYS[batchCode] ?? fallback)
    : fallback;
}

function batchIdFor(unitKey: string, batchCode: string, fallback: string): string {
  return deterministicUuid(canonicalBatchKey(unitKey, batchCode, fallback));
}

const sourceKeys = new Set(seed.sources.map((row, index) => requiredString(row, 'sourceKey', `sources[${index}]`)));
const unitKeys = new Set(seed.units.map((row, index) => requiredString(row, 'unitKey', `units[${index}]`)));
const batchKeys = new Set(seed.batches.map((row, index) => requiredString(row, 'batchKey', `batches[${index}]`)));
const batchKeyByUnitAndCode = new Map(
  seed.batches.map((row, index) => [
    `${requiredString(row, 'unitKey', `batches[${index}]`)}|${requiredString(row, 'code', `batches[${index}]`)}`,
    requiredString(row, 'batchKey', `batches[${index}]`),
  ]),
);

const requirementGroups = new Map<string, Row[]>();
for (const [index, row] of seed.requirements.entries()) {
  const identity = requirementEvidenceIdentity(row, `requirements[${index}]`);
  const group = requirementGroups.get(identity) ?? [];
  group.push(row);
  requirementGroups.set(identity, group);
}

const groupedRequirements = [...requirementGroups.entries()].map(([identity, rows]) => {
  const ranked = [...rows].sort((left, right) => {
    const leftRank = requirementCategoryPriority.indexOf(
      requiredString(left, 'category', 'requirement') as (typeof requirementCategoryPriority)[number],
    );
    const rightRank = requirementCategoryPriority.indexOf(
      requiredString(right, 'category', 'requirement') as (typeof requirementCategoryPriority)[number],
    );
    return (leftRank < 0 ? 99 : leftRank) - (rightRank < 0 ? 99 : rightRank);
  });
  const primary = ranked[0]!;
  const categoryTags = [...new Set(rows.map((row) => requiredString(row, 'category', 'requirement')))]
    .sort((left, right) => {
      const leftRank = requirementCategoryPriority.indexOf(left as (typeof requirementCategoryPriority)[number]);
      const rightRank = requirementCategoryPriority.indexOf(right as (typeof requirementCategoryPriority)[number]);
      return (leftRank < 0 ? 99 : leftRank) - (rightRank < 0 ? 99 : rightRank);
    });
  return {
    identity,
    primary,
    categoryTags,
    originalRequirementKeys: rows.map((row) => requiredString(row, 'requirementKey', 'requirement')),
    sourceKeys: [...new Set(rows.flatMap((row) => stringArray(row, 'sourceKeys', 'requirement')))],
  };
});

function assertReferences(rows: Row[], collection: string): void {
  rows.forEach((row, index) => {
    const label = `${collection}[${index}]`;
    const unitKey = requiredString(row, 'unitKey', label);
    if (!unitKeys.has(unitKey)) throw new Error(`${label}.unitKey does not exist: ${unitKey}`);
    for (const key of stringArray(row, 'sourceKeys', label)) {
      if (!sourceKeys.has(key)) throw new Error(`${label}.sourceKeys contains missing source: ${key}`);
    }
  });
}

assertReferences(seed.batches, 'batches');
assertReferences(seed.events, 'events');
assertReferences(seed.requirements, 'requirements');
assertReferences(seed.headcountFacts, 'headcountFacts');
assertReferences(seed.profiles, 'profiles');

try {
  const provinceRows = await db.select().from(provinces);
  const provinceByAdcode = new Map(provinceRows.map((row) => [row.adcode, row]));
  const missingAdcodes = [...new Set(seed.units.map((row) => requiredString(row, 'provinceAdcode', 'unit')))]
    .filter((adcode) => !provinceByAdcode.has(adcode));
  if (missingAdcodes.length) throw new Error(`Canonical provinces missing: ${missingAdcodes.join(', ')}`);

  await db.transaction(async (tx) => {
    for (const [index, row] of seed.sources.entries()) {
      const label = `sources[${index}]`;
      const sourceKey = requiredString(row, 'sourceKey', label);
      const values = {
        id: deterministicUuid(sourceKey),
        sourceKey,
        title: requiredString(row, 'title', label),
        sourceType: requiredString(row, 'sourceType', label),
        publisher: optionalString(row, 'publisher'),
        officialUrl: optionalString(row, 'officialUrl'),
        archivePath: optionalString(row, 'archivePath'),
        checksumSha256: optionalString(row, 'checksumSha256'),
        contentText: optionalRawString(row, 'contentText'),
        publishedAt: publicationDate(row, 'publishedAt'),
        accessedAt: publicationDate(row, 'accessedAt'),
        cohortYear: optionalInteger(row, 'cohortYear'),
        batchCode: optionalString(row, 'batchCode'),
        unitScope: optionalString(row, 'unitScope'),
        status: optionalString(row, 'status') ?? 'verified_official',
        notes: optionalString(row, 'notes'),
        metadata: { ...objectValue(row, 'metadata'), dataset_id: seed.datasetId },
        updatedAt: new Date(),
      };
      await tx
        .insert(sourceDocuments)
        .values(values)
        .onConflictDoUpdate({ target: sourceDocuments.id, set: values });
    }

    for (const [index, row] of seed.units.entries()) {
      const label = `units[${index}]`;
      const unitKey = requiredString(row, 'unitKey', label);
      const companyKey = canonicalCompanyKey(unitKey);
      const provinceAdcode = requiredString(row, 'provinceAdcode', label);
      const province = provinceByAdcode.get(provinceAdcode)!;
      const values = {
        id: companyIdFor(unitKey),
        companyKey,
        name: requiredString(row, 'unitName', label),
        parentCompanyId: null,
        provinceId: province.id,
        cityId: null,
        companyType: 'state_grid_provincial_unit',
        cohortYear: 2026,
        batchCode: null,
        unitScope: requiredString(row, 'unitName', label),
        sourceDocumentId: null,
        status: 'verified_official_unit',
        publicationStatus: 'published' as const,
        notes: optionalString(row, 'notes'),
        metadata: {
          ...objectValue(row, 'metadata'),
          dataset_id: seed.datasetId,
          official_unit_id: requiredString(row, 'unitId', label),
          province_adcode: provinceAdcode,
        },
        updatedAt: new Date(),
      };
      await tx.insert(companies).values(values).onConflictDoUpdate({ target: companies.id, set: values });
    }

    for (const [index, row] of seed.batches.entries()) {
      const label = `batches[${index}]`;
      const batchKey = requiredString(row, 'batchKey', label);
      const unitKey = requiredString(row, 'unitKey', label);
      const provinceAdcode = requiredString(row, 'provinceAdcode', label);
      const sourceKeyList = stringArray(row, 'sourceKeys', label);
      const batchCode = requiredString(row, 'code', label);
      const storedBatchKey = canonicalBatchKey(unitKey, batchCode, batchKey);
      const values = {
        id: batchIdFor(unitKey, batchCode, batchKey),
        batchKey: storedBatchKey,
        cohortYear: optionalInteger(row, 'cohortYear') ?? 2026,
        code: batchCode,
        name: requiredString(row, 'name', label),
        sortOrder: optionalInteger(row, 'sortOrder') ?? 0,
        unitScope: seed.units.find((unit) => unit.unitKey === unitKey)?.unitName as string,
        provinceId: provinceByAdcode.get(provinceAdcode)!.id,
        companyId: companyIdFor(unitKey),
        applicationStartsAt: dateTime(row, 'applicationStartsAt'),
        applicationEndsAt: dateTime(row, 'applicationEndsAt'),
        examStartsAt: dateTime(row, 'examStartsAt'),
        examEndsAt: dateTime(row, 'examEndsAt'),
        sourceDocumentId: deterministicUuid(sourceKeyList[0]!),
        sourceKeys: sourceKeyList,
        status: optionalString(row, 'status') ?? 'verified_official',
        publicationStatus: 'published' as const,
        notes: optionalString(row, 'notes'),
        metadata: { ...objectValue(row, 'metadata'), dataset_id: seed.datasetId },
        updatedAt: new Date(),
      };
      await tx
        .insert(recruitmentBatches)
        .values(values)
        .onConflictDoUpdate({ target: recruitmentBatches.id, set: values });
    }

    // Replace this dataset's source-level timeline as one audited unit. An
    // upsert alone would leave stale rows behind when a corrected seed removes
    // or splits an event.
    await tx
      .delete(recruitmentEvents)
      .where(sql`${recruitmentEvents.metadata}->>'dataset_id' = ${seed.datasetId}`);

    for (const [index, row] of seed.events.entries()) {
      const label = `events[${index}]`;
      const eventKey = requiredString(row, 'eventKey', label);
      const unitKey = requiredString(row, 'unitKey', label);
      const provinceAdcode = requiredString(row, 'provinceAdcode', label);
      const sourceKeyList = stringArray(row, 'sourceKeys', label);
      const batchCode = requiredString(row, 'batchCode', label);
      const batchKey = batchKeyByUnitAndCode.get(`${unitKey}|${batchCode}`);
      if (!batchKey || !batchKeys.has(batchKey)) throw new Error(`${label} has no batch for ${unitKey}/${batchCode}`);
      const values = {
        id: deterministicUuid(eventKey),
        eventKey,
        cohortYear: optionalInteger(row, 'cohortYear') ?? 2026,
        batchId: batchIdFor(unitKey, batchCode, batchKey),
        batchCode,
        provinceId: provinceByAdcode.get(provinceAdcode)!.id,
        cityId: null,
        companyId: companyIdFor(unitKey),
        scopeKind: 'province_company',
        unitScope: seed.units.find((unit) => unit.unitKey === unitKey)?.unitName as string,
        eventType: requiredString(row, 'eventType', label),
        title: requiredString(row, 'title', label),
        startsOn: optionalString(row, 'startsOn'),
        endsOn: optionalString(row, 'endsOn'),
        startsAt: dateTime(row, 'startsAt'),
        endsAt: dateTime(row, 'endsAt'),
        timezone: 'Asia/Shanghai',
        rawTimeText: optionalString(row, 'rawTimeText'),
        datePrecision: optionalString(row, 'datePrecision'),
        timeStatus: optionalString(row, 'timeStatus'),
        certainty: optionalString(row, 'certainty'),
        locationText: optionalString(row, 'locationText'),
        locationKind: optionalString(row, 'locationKind'),
        evidenceExcerpt: optionalString(row, 'evidenceExcerpt'),
        evidenceTier: optionalString(row, 'evidenceTier') ?? 'A',
        sourceKind: optionalString(row, 'sourceKind') ?? 'current_official',
        sourceDocumentId: deterministicUuid(sourceKeyList[0]!),
        sourceKeys: sourceKeyList,
        status: optionalString(row, 'status') ?? 'verified_official',
        publicationStatus: 'published' as const,
        notes: optionalString(row, 'notes'),
        metadata: {
          ...objectValue(row, 'metadata'),
          dataset_id: seed.datasetId,
          parent_event_key: optionalString(row, 'parentEventKey'),
        },
        updatedAt: new Date(),
      };
      await tx
        .insert(recruitmentEvents)
        .values(values)
        .onConflictDoUpdate({ target: recruitmentEvents.id, set: values });
    }

    await tx
      .delete(recruitmentRequirements)
      .where(sql`${recruitmentRequirements.metadata}->>'dataset_id' = ${seed.datasetId}`);

    for (const [index, group] of groupedRequirements.entries()) {
      const row = group.primary;
      const label = `groupedRequirements[${index}]`;
      const evidenceGroupKey = stableEvidenceGroupKey(group.identity);
      const requirementKey = evidenceGroupKey;
      const unitKey = requiredString(row, 'unitKey', label);
      const provinceAdcode = requiredString(row, 'provinceAdcode', label);
      const sourceKeyList = group.sourceKeys;
      const applicability = applicabilityAssessment(row);
      const values = {
        id: deterministicUuid(requirementKey),
        requirementKey,
        cohortYear: optionalInteger(row, 'cohortYear') ?? 2026,
        batchCode: requiredString(row, 'batchCode', label),
        provinceId: provinceByAdcode.get(provinceAdcode)!.id,
        companyId: companyIdFor(unitKey),
        scopeKind: 'province_company',
        unitScope: seed.units.find((unit) => unit.unitKey === unitKey)?.unitName as string,
        category: requiredString(row, 'category', label),
        categoryTags: group.categoryTags,
        evidenceGroupKey,
        applicabilityStatus: applicability.status,
        requirementKind: optionalString(row, 'requirementKind') ?? 'official_excerpt',
        title: requiredString(row, 'title', label),
        excerpt: requiredString(row, 'excerpt', label),
        applicability: applicability.value,
        evidenceLocator: optionalString(row, 'evidenceLocator'),
        evidenceTier: optionalString(row, 'evidenceTier') ?? 'A',
        sourceDocumentId: deterministicUuid(sourceKeyList[0]!),
        sourceKeys: sourceKeyList,
        status: optionalString(row, 'status') ?? 'verified_official_excerpt',
        publicationStatus: 'published' as const,
        notes: optionalString(row, 'notes'),
        metadata: {
          ...objectValue(row, 'metadata'),
          dataset_id: seed.datasetId,
          original_requirement_keys: group.originalRequirementKeys,
          category_tags: group.categoryTags,
          ...(applicability.status === 'needs_review'
            ? { original_applicability_pending_review: applicability.original }
            : {}),
        },
        updatedAt: new Date(),
      };
      await tx
        .insert(recruitmentRequirements)
        .values(values)
        .onConflictDoUpdate({ target: recruitmentRequirements.id, set: values });
    }

    const [importedRequirementSummary] = await tx
      .select({
        rows: sql<number>`count(*)::int`,
        evidenceGroups: sql<number>`count(distinct ${recruitmentRequirements.evidenceGroupKey})::int`,
        primaryCategories: sql<number>`count(distinct ${recruitmentRequirements.category})::int`,
      })
      .from(recruitmentRequirements)
      .where(sql`${recruitmentRequirements.metadata}->>'dataset_id' = ${seed.datasetId}`);
    const requirementRows = Number(importedRequirementSummary?.rows ?? 0);
    const requirementEvidenceGroups = Number(importedRequirementSummary?.evidenceGroups ?? 0);
    const requirementPrimaryCategories = Number(importedRequirementSummary?.primaryCategories ?? 0);
    if (
      groupedRequirements.length !== 799 ||
      requirementRows !== 799 ||
      requirementEvidenceGroups !== 799 ||
      requirementPrimaryCategories !== 12
    ) {
      throw new Error(
        `requirement import invariant failed: grouped=${groupedRequirements.length}, rows=${requirementRows}, evidenceGroups=${requirementEvidenceGroups}, primaryCategories=${requirementPrimaryCategories}`,
      );
    }

    for (const [index, row] of seed.headcountFacts.entries()) {
      const label = `headcountFacts[${index}]`;
      const headcountKey = requiredString(row, 'headcountKey', label);
      const unitKey = requiredString(row, 'unitKey', label);
      const provinceAdcode = requiredString(row, 'provinceAdcode', label);
      const sourceKeyList = stringArray(row, 'sourceKeys', label);
      const batchCode = requiredString(row, 'batchCode', label);
      const batchKey = batchKeyByUnitAndCode.get(`${unitKey}|${batchCode}`);
      if (!batchKey || !batchKeys.has(batchKey)) throw new Error(`${label} has no batch for ${unitKey}/${batchCode}`);
      const value = optionalInteger(row, 'value');
      if (value === null || value <= 0) throw new Error(`${label}.value must be a positive integer`);
      const values = {
        id: deterministicUuid(headcountKey),
        metricKey: headcountKey,
        cohortYear: optionalInteger(row, 'cohortYear') ?? 2026,
        batchId: batchIdFor(unitKey, batchCode, batchKey),
        batchCode,
        provinceId: provinceByAdcode.get(provinceAdcode)!.id,
        cityId: null,
        schoolId: null,
        companyId: companyIdFor(unitKey),
        destinationScope: 'province_company',
        disciplineGroup: 'all',
        majorCategory: null,
        unitScope: seed.units.find((unit) => unit.unitKey === unitKey)?.unitName as string,
        metricType: requiredString(row, 'metricType', label),
        valueKind: requiredString(row, 'valueKind', label),
        aggregationGrain: requiredString(row, 'aggregationGrain', label),
        value: String(value),
        displayValue: requiredString(row, 'displayValue', label),
        unit: requiredString(row, 'unit', label),
        isApproximate: row.isApproximate === true,
        subjectScope: requiredString(row, 'subjectScope', label),
        sampleSize: null,
        privacySuppressed: false,
        suppressedRange: null,
        suppressionReason: null,
        zeroConfirmed: false,
        sourceDocumentId: deterministicUuid(sourceKeyList[0]!),
        sourceKeys: sourceKeyList,
        status: optionalString(row, 'status') ?? 'verified_current_official_mention',
        publicationStatus: 'published' as const,
        notes: optionalString(row, 'notes'),
        metadata: {
          ...objectValue(row, 'metadata'),
          dataset_id: seed.datasetId,
          evidence_excerpt: optionalString(row, 'evidenceExcerpt'),
          evidence_locator: optionalString(row, 'evidenceLocator'),
          sum_safe: row.sumSafe === true,
          relation_hint: optionalString(row, 'relationHint'),
        },
        updatedAt: new Date(),
      };
      await tx.insert(recruitmentMetrics).values(values).onConflictDoUpdate({ target: recruitmentMetrics.id, set: values });
    }

    for (const [index, row] of seed.profiles.entries()) {
      const label = `profiles[${index}]`;
      const revisionKey = requiredString(row, 'revisionKey', label);
      const sourceKeyList = stringArray(row, 'sourceKeys', label);
      const unitKey = requiredString(row, 'unitKey', label);
      const values = {
        id: deterministicUuid(revisionKey),
        revisionKey,
        title: requiredString(row, 'title', label),
        description: `2026届省级招聘资料标准化档案，数据截至${seed.asOf}`,
        cohortYear: optionalInteger(row, 'cohortYear') ?? 2026,
        batchCode: null,
        unitScope: seed.units.find((unit) => unit.unitKey === unitKey)?.unitName as string,
        sourceDocumentId: deterministicUuid(sourceKeyList[0]!),
        status: 'published' as const,
        dataStatus: optionalString(row, 'dataStatus') ?? 'source_traced_historical_archive',
        payload: objectValue(row, 'payload'),
        metadata: {
          ...objectValue(row, 'metadata'),
          dataset_id: seed.datasetId,
          unit_key: unitKey,
          province_adcode: requiredString(row, 'provinceAdcode', label),
          as_of: seed.asOf,
          source_keys: sourceKeyList,
        },
        publishedAt: new Date(seed.generatedAt),
        updatedAt: new Date(),
      };
      await tx.insert(dataRevisions).values(values).onConflictDoUpdate({ target: dataRevisions.id, set: values });
    }

    // The canonical seed used to carry a 21-row Hubei summary timeline while
    // this provincial archive carries the source-level timeline. Keep only the
    // source-level events and merge Hubei onto the canonical company/batch IDs.
    await tx
      .delete(recruitmentEvents)
      .where(inArray(recruitmentEvents.eventKey, [...LEGACY_HUBEI_SUMMARY_EVENT_KEYS]));

    const [importedEventCount] = await tx
      .select({ value: sql<number>`count(*)::int` })
      .from(recruitmentEvents)
      .where(sql`${recruitmentEvents.metadata}->>'dataset_id' = ${seed.datasetId}`);
    const sourceLevelEventCount = Number(importedEventCount?.value ?? 0);
    if (sourceLevelEventCount !== seed.events.length) {
      throw new Error(
        `event import invariant failed: expected ${seed.events.length} source-level rows, got ${sourceLevelEventCount}`,
      );
    }

    const [legacyHubeiEventCount] = await tx
      .select({ value: sql<number>`count(*)::int` })
      .from(recruitmentEvents)
      .where(inArray(recruitmentEvents.eventKey, [...LEGACY_HUBEI_SUMMARY_EVENT_KEYS]));
    if (Number(legacyHubeiEventCount?.value ?? 0) !== 0) {
      throw new Error('legacy Hubei summary timeline was not fully removed');
    }

    const legacyHubeiBatchIds = seed.batches
      .filter((row) => requiredString(row, 'unitKey', 'batch') === HUBEI_PROVINCIAL_UNIT_KEY)
      .map((row) => deterministicUuid(requiredString(row, 'batchKey', 'batch')))
      .filter((id) => !Object.values(HUBEI_CANONICAL_BATCH_KEYS).map(deterministicUuid).includes(id));
    if (legacyHubeiBatchIds.length) {
      await tx.delete(recruitmentBatches).where(inArray(recruitmentBatches.id, legacyHubeiBatchIds));
    }
    const legacyHubeiCompanyId = deterministicUuid(HUBEI_PROVINCIAL_UNIT_KEY);
    if (legacyHubeiCompanyId !== companyIdFor(HUBEI_PROVINCIAL_UNIT_KEY)) {
      await tx.delete(companies).where(sql`${companies.id} = ${legacyHubeiCompanyId}`);
    }

    await tx.insert(auditEvents).values({
      actorType: 'system',
      actorId: null,
      action: 'provincial-recruitment.import',
      resourceType: 'data_revision',
      resourceId: seed.datasetId,
      outcome: 'success',
      metadata: {
        datasetId: seed.datasetId,
        asOf: seed.asOf,
        units: seed.units.length,
        sources: seed.sources.length,
        batches: seed.batches.length,
        events: seed.events.length,
        sourceLevelEventsStored: sourceLevelEventCount,
        legacyHubeiSummaryEventsStored: 0,
        requirementsRaw: seed.requirements.length,
        requirementsGrouped: groupedRequirements.length,
        headcountFacts: seed.headcountFacts.length,
        profiles: seed.profiles.length,
      },
    });
  });

  process.stdout.write(
    `Imported ${seed.datasetId}: units=${seed.units.length}, sources=${seed.sources.length}, batches=${seed.batches.length}, events=${seed.events.length}, requirementsRaw=${seed.requirements.length}, requirementsGrouped=${groupedRequirements.length}, headcountFacts=${seed.headcountFacts.length}, profiles=${seed.profiles.length}.\n`,
  );
} finally {
  await pool.end();
}
