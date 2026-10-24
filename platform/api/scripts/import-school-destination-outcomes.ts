import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { loadConfig } from '../src/config.js';
import { createDatabase } from '../src/db/client.js';
import {
  auditEvents,
  companies,
  provinces,
  recruitmentBatches,
  recruitmentMetrics,
  schools,
  sourceDocuments,
} from '../src/db/schema.js';
import { deterministicUuid } from '../src/import/canonical.js';
import {
  SCHOOL_DESTINATION_OUTCOMES_DATASET_ID,
  SCHOOL_DESTINATION_SOURCE_KEY,
  schoolDestinationMetricValues,
  schoolDestinationOutcomeSeedSchema,
  type SchoolDestinationOutcome,
} from '../src/import/school-destination-outcomes.js';

const env = z
  .object({
    SCHOOL_DESTINATION_OUTCOMES_PATH: z
      .string()
      .min(1)
      .default('../data-migration/school-destination-outcomes-2026-v1.json'),
  })
  .parse(process.env);

const source = await readFile(env.SCHOOL_DESTINATION_OUTCOMES_PATH);
const artifactSha256 = createHash('sha256').update(source).digest('hex');
const seed = schoolDestinationOutcomeSeedSchema.parse(
  JSON.parse(source.toString('utf8')) as unknown,
);
const config = loadConfig();
const { db, pool } = createDatabase(config.databaseUrl);

const chunk = <T>(rows: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let offset = 0; offset < rows.length; offset += size) {
    chunks.push(rows.slice(offset, offset + size));
  }
  return chunks;
};

const destinationBatchKey = (companyId: string, batchCode: string): string =>
  `${companyId}|${batchCode}`;

const HUBEI_PROVINCE_KEY = 'PROV-CN-420000';
const HUBEI_COMPANY_KEY = 'COMPANY-SGCC-HUBEI';

try {
  const [schoolRows, provinceRows, companyRows, batchRows, sourceRows] = await Promise.all([
    db.select().from(schools),
    db.select().from(provinces),
    db.select().from(companies),
    db.select().from(recruitmentBatches),
    db.select().from(sourceDocuments),
  ]);
  const schoolByKey = new Map(schoolRows.map((row) => [row.schoolKey, row]));
  const provinceByKey = new Map(
    provinceRows
      .filter((row) => row.provinceKey)
      .map((row) => [row.provinceKey as string, row]),
  );
  const companyByKey = new Map(companyRows.map((row) => [row.companyKey, row]));
  const sourceByKey = new Map(sourceRows.map((row) => [row.sourceKey, row]));
  const batchByCompanyAndCode = new Map<string, (typeof batchRows)[number]>();
  for (const row of batchRows) {
    if (!row.companyId) continue;
    const key = destinationBatchKey(row.companyId, row.code);
    if (batchByCompanyAndCode.has(key)) {
      throw new Error(`Duplicate destination batch in database: ${key}`);
    }
    batchByCompanyAndCode.set(key, row);
  }

  const aggregateSource = sourceByKey.get(SCHOOL_DESTINATION_SOURCE_KEY);
  if (!aggregateSource) {
    throw new Error(
      `Canonical source document must be imported first: ${SCHOOL_DESTINATION_SOURCE_KEY}`,
    );
  }

  const hubeiProvince = provinceByKey.get(HUBEI_PROVINCE_KEY);
  const hubeiCompany = companyByKey.get(HUBEI_COMPANY_KEY);
  if (!hubeiProvince || !hubeiCompany || hubeiCompany.provinceId !== hubeiProvince.id) {
    throw new Error('Controlled Hubei province/company references must be imported first');
  }
  const hubeiSchoolIds = [
    ...new Set(
      seed.outcomes
        .filter(
          (outcome) =>
            outcome.destinationScope === 'province_company' &&
            outcome.destinationProvinceKey === HUBEI_PROVINCE_KEY &&
            outcome.destinationCompanyKey === HUBEI_COMPANY_KEY,
        )
        .map((outcome) => schoolByKey.get(outcome.schoolKey)?.id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  if (hubeiSchoolIds.length !== seed.coverage.canonicalSchoolCount) {
    throw new Error(
      `Hubei destination scope must cover all canonical schools: ${hubeiSchoolIds.length}/${seed.coverage.canonicalSchoolCount}`,
    );
  }

  const values = seed.outcomes.map((outcome, index) => {
    const school = schoolByKey.get(outcome.schoolKey);
    if (!school) {
      throw new Error(`outcomes[${index}] references missing school: ${outcome.schoolKey}`);
    }

    let provinceId: string | null = null;
    let companyId: string | null = null;
    let batchId: string | null = null;
    if (outcome.destinationScope === 'province_company') {
      const province = provinceByKey.get(outcome.destinationProvinceKey!);
      if (!province) {
        throw new Error(
          `outcomes[${index}] references missing destination province: ${outcome.destinationProvinceKey}`,
        );
      }
      if (province.adcode !== outcome.destinationProvinceAdcode) {
        throw new Error(
          `outcomes[${index}] destination province key/adcode mismatch: ${outcome.destinationProvinceKey}/${outcome.destinationProvinceAdcode}`,
        );
      }
      const company = companyByKey.get(outcome.destinationCompanyKey!);
      if (!company) {
        throw new Error(
          `outcomes[${index}] references missing destination company: ${outcome.destinationCompanyKey}`,
        );
      }
      if (company.provinceId !== province.id) {
        throw new Error(
          `outcomes[${index}] destination company is not attached to ${outcome.destinationProvinceKey}`,
        );
      }
      provinceId = province.id;
      companyId = company.id;
      if (outcome.batchCode !== 'all') {
        const batch = batchByCompanyAndCode.get(
          destinationBatchKey(company.id, outcome.batchCode),
        );
        if (!batch) {
          throw new Error(
            `outcomes[${index}] destination company has no ${outcome.batchCode} batch: ${outcome.destinationCompanyKey}`,
          );
        }
        batchId = batch.id;
      }
    }

    return {
      id: deterministicUuid(outcome.outcomeKey),
      ...schoolDestinationMetricValues(
        seed,
        outcome,
        {
          schoolId: school.id,
          provinceId,
          companyId,
          batchId,
          sourceDocumentId: aggregateSource.id,
        },
        artifactSha256,
      ),
      updatedAt: new Date(seed.generatedAt),
    };
  });

  let removedCanonicalHubeiMetrics = 0;
  await db.transaction(async (tx) => {
    // Refuse to overwrite a row owned by another dataset even if a future
    // producer accidentally reuses one of our deterministic metric keys.
    for (const keyChunk of chunk(
      seed.outcomes.map((outcome) => outcome.outcomeKey),
      500,
    )) {
      const conflicts = await tx
        .select({ metricKey: recruitmentMetrics.metricKey, metadata: recruitmentMetrics.metadata })
        .from(recruitmentMetrics)
        .where(inArray(recruitmentMetrics.metricKey, keyChunk));
      for (const conflict of conflicts) {
        if (conflict.metadata.dataset_id !== SCHOOL_DESTINATION_OUTCOMES_DATASET_ID) {
          throw new Error(
            `Metric key belongs to another dataset and will not be overwritten: ${conflict.metricKey}`,
          );
        }
      }
    }

    // Start by replacing only this generated dataset. The narrowly scoped
    // canonical Hubei de-duplication below is the sole legacy exception.
    await tx
      .delete(recruitmentMetrics)
      .where(
        sql`${recruitmentMetrics.metadata}->>'dataset_id' = ${SCHOOL_DESTINATION_OUTCOMES_DATASET_ID}`,
      );

    // Canonical v2 historically materialized the same 62-school x
    // all/first/second/third Hubei public-notice cells. Replace only those
    // exact semantic rows so the management API cannot return two values for
    // the same school/destination/batch. Other canonical metrics (including
    // batch_share), provinces, companies and provincial datasets are kept.
    const removedCanonicalRows = await tx
      .delete(recruitmentMetrics)
      .where(
        and(
          eq(recruitmentMetrics.cohortYear, seed.cohortYear),
          inArray(recruitmentMetrics.schoolId, hubeiSchoolIds),
          eq(recruitmentMetrics.provinceId, hubeiProvince.id),
          eq(recruitmentMetrics.companyId, hubeiCompany.id),
          eq(recruitmentMetrics.destinationScope, 'province_company'),
          eq(recruitmentMetrics.disciplineGroup, 'all'),
          isNull(recruitmentMetrics.majorCategory),
          eq(recruitmentMetrics.metricType, 'public_notice_record_count'),
          inArray(recruitmentMetrics.batchCode, ['all', 'batch_1', 'batch_2', 'batch_3']),
          inArray(recruitmentMetrics.aggregationGrain, [
            'cohort_school',
            'cohort_batch_school',
          ]),
          eq(recruitmentMetrics.sourceDocumentId, aggregateSource.id),
          sql`${recruitmentMetrics.metadata}->>'dataset_id' is null`,
          sql`${recruitmentMetrics.metadata}->>'metric_id' = ${recruitmentMetrics.metricKey}`,
        ),
      )
      .returning({ metricKey: recruitmentMetrics.metricKey });
    removedCanonicalHubeiMetrics = removedCanonicalRows.length;
    const expectedCanonicalHubeiMetrics = hubeiSchoolIds.length * 4;
    if (
      removedCanonicalHubeiMetrics !== 0 &&
      removedCanonicalHubeiMetrics !== expectedCanonicalHubeiMetrics
    ) {
      throw new Error(
        `Refusing partial canonical Hubei metric replacement: ${removedCanonicalHubeiMetrics}/${expectedCanonicalHubeiMetrics}`,
      );
    }

    for (const valueChunk of chunk(values, 250)) {
      await tx
        .insert(recruitmentMetrics)
        .values(valueChunk)
        .onConflictDoUpdate({
          target: recruitmentMetrics.metricKey,
          set: {
            cohortYear: sql`excluded.cohort_year`,
            batchId: sql`excluded.batch_id`,
            batchCode: sql`excluded.batch_code`,
            provinceId: sql`excluded.province_id`,
            cityId: sql`excluded.city_id`,
            schoolId: sql`excluded.school_id`,
            companyId: sql`excluded.company_id`,
            destinationScope: sql`excluded.destination_scope`,
            disciplineGroup: sql`excluded.discipline_group`,
            disciplineEvidenceStatus: sql`excluded.discipline_evidence_status`,
            majorCategory: sql`excluded.major_category`,
            majorEvidenceStatus: sql`excluded.major_evidence_status`,
            unitScope: sql`excluded.unit_scope`,
            metricType: sql`excluded.metric_type`,
            valueKind: sql`excluded.value_kind`,
            aggregationGrain: sql`excluded.aggregation_grain`,
            value: sql`excluded.value`,
            displayValue: sql`excluded.display_value`,
            unit: sql`excluded.unit`,
            isApproximate: sql`excluded.is_approximate`,
            subjectScope: sql`excluded.subject_scope`,
            sampleSize: sql`excluded.sample_size`,
            privacySuppressed: sql`excluded.privacy_suppressed`,
            suppressedRange: sql`excluded.suppressed_range`,
            suppressionReason: sql`excluded.suppression_reason`,
            zeroConfirmed: sql`excluded.zero_confirmed`,
            sourceDocumentId: sql`excluded.source_document_id`,
            sourceKeys: sql`excluded.source_keys`,
            status: sql`excluded.status`,
            publicationStatus: sql`excluded.publication_status`,
            notes: sql`excluded.notes`,
            metadata: sql`excluded.metadata`,
            updatedAt: sql`excluded.updated_at`,
          },
        });
    }

    const auditMetadata = {
      datasetId: seed.datasetId,
      schemaVersion: seed.schemaVersion,
      artifactSha256,
      sourceSha256: seed.outcomes[0]!.sourceSha256,
      countSemantics: seed.countSemantics,
      outcomes: seed.outcomes.length,
      coverage: seed.coverage,
      privacy: seed.privacy,
      disciplineCoverage: seed.disciplineCoverage,
      removedCanonicalHubeiMetrics,
    };
    const auditId = deterministicUuid(`AUDIT:${seed.datasetId}:${artifactSha256}`);
    await tx
      .insert(auditEvents)
      .values({
        id: auditId,
        actorType: 'system',
        actorId: null,
        action: 'school-destination-outcomes.import',
        resourceType: 'recruitment_metrics',
        resourceId: seed.datasetId,
        outcome: 'success',
        metadata: auditMetadata,
      })
      .onConflictDoUpdate({
        target: auditEvents.id,
        set: {
          outcome: 'success',
          metadata: auditMetadata,
          createdAt: new Date(),
        },
      });
  });

  const networkTotals = seed.outcomes
    .filter((row) => row.destinationScope === 'network_total' && row.batchCode === 'all')
    .reduce((sum, row) => sum + (row.value ?? 0), 0);
  const hubeiTotals = seed.outcomes
    .filter(
      (row) =>
        row.destinationScope === 'province_company' &&
        row.destinationProvinceAdcode === '420000' &&
        row.batchCode === 'all',
    )
    .reduce((sum, row) => sum + (row.value ?? 0), 0);
  const readAnchor = (
    schoolKey: string,
    scope: SchoolDestinationOutcome['destinationScope'],
    provinceAdcode: string | null,
  ): number | null =>
    seed.outcomes.find(
      (row) =>
        row.schoolKey === schoolKey &&
        row.destinationScope === scope &&
        row.destinationProvinceAdcode === provinceAdcode &&
        row.batchCode === 'all',
    )?.value ?? null;

  process.stdout.write(
    `${JSON.stringify({
      datasetId: seed.datasetId,
      importedMetrics: values.length,
      artifactSha256,
      sourceSha256: seed.outcomes[0]!.sourceSha256,
      networkTotalForCanonicalSchools: networkTotals,
      hubeiTotalForCanonicalSchools: hubeiTotals,
      removedCanonicalHubeiMetrics,
      anchors: {
        sanxia: {
          nationwide: readAnchor('MOE-4142011075', 'network_total', null),
          hubei: readAnchor('MOE-4142011075', 'province_company', '420000'),
        },
        ncepu: {
          nationwide: readAnchor('MOE-4111010054', 'network_total', null),
          hubei: readAnchor('MOE-4111010054', 'province_company', '420000'),
        },
      },
    })}\n`,
  );
} finally {
  await pool.end();
}
