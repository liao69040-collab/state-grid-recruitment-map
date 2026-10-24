import { z } from 'zod';

export const SCHOOL_DESTINATION_OUTCOMES_DATASET_ID =
  'school-destination-outcomes-2026-v1' as const;
export const SCHOOL_DESTINATION_SOURCE_KEY = 'public-selection-aggregate-2026' as const;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const nullableKey = z.string().min(1).nullable();
const nonNegativeInteger = z.number().int().min(0);

const coverageSchema = z
  .object({
    canonicalSchoolCount: nonNegativeInteger,
    canonicalSchoolsWithRecords: nonNegativeInteger,
    hubeiTotalForCanonicalSchools: nonNegativeInteger,
    mappedCanonicalSchoolRecordCount: nonNegativeInteger,
    mappedDestinationRecordCount: nonNegativeInteger,
    mappedRawSchoolLabelCount: nonNegativeInteger,
    mappedRawUnitLabelCount: nonNegativeInteger,
    networkTotalForCanonicalSchools: nonNegativeInteger,
    outcomeCount: nonNegativeInteger,
    rawSchoolLabelCount: nonNegativeInteger,
    rawUnitLabelCount: nonNegativeInteger,
    stateGridSourceRecordCount: nonNegativeInteger,
    unmappedCanonicalSchoolRecordCount: nonNegativeInteger,
    unmappedDestinationRecordCount: nonNegativeInteger,
    unmappedRawSchoolLabelCount: nonNegativeInteger,
    unmappedRawUnitLabelCount: nonNegativeInteger,
  })
  .strict();

const privacySchema = z
  .object({
    mode: z.literal('aggregate_only'),
    minimumCellCount: z.literal(5),
    primarySuppression: z.literal('1-4'),
    complementaryProtection: z.literal(true),
    recordLevelRowsIncluded: z.literal(false),
    personalFieldsIncluded: z.literal(false),
  })
  .strict();

const disciplineCoverageSchema = z
  .object({
    available: z.literal(false),
    sourceTableCoverage: z.literal('0/40'),
    generatedOutcomeGroups: z.tuple([z.literal('all')]),
    unavailableGroups: z.array(z.string().min(1)),
    displayStatus: z.string().min(1),
    disciplineEvidenceStatus: z.literal('source_not_provided'),
    majorEvidenceStatus: z.literal('source_not_provided'),
  })
  .strict();

const inputManifestSchema = z
  .object({
    inputType: z.string().min(1),
    fileName: z.string().min(1),
    sha256: sha256Schema,
  })
  .passthrough();

export const schoolDestinationOutcomeSchema = z
  .object({
    outcomeKey: z.string().min(1).max(160),
    cohortYear: z.literal(2026),
    network: z.literal('国家电网'),
    schoolKey: z.string().min(1).max(160),
    schoolName: z.string().min(1),
    originProvinceKey: nullableKey,
    originCityKey: nullableKey,
    destinationScope: z.enum(['network_total', 'province_company', 'unknown']),
    destinationProvinceKey: nullableKey,
    destinationProvinceAdcode: z.string().regex(/^\d{6}$/).nullable(),
    destinationProvinceName: z.string().min(1).nullable(),
    destinationCompanyKey: nullableKey,
    destinationUnitKey: nullableKey,
    destinationUnitName: z.string().min(1),
    batchCode: z.enum(['all', 'batch_1', 'batch_2', 'batch_3']),
    batchName: z.string().min(1),
    disciplineGroup: z.literal('all'),
    disciplineEvidenceStatus: z.literal('source_not_provided'),
    majorCategory: z.null(),
    majorEvidenceStatus: z.literal('source_not_provided'),
    metricType: z.literal('public_notice_record_count'),
    valueKind: z.literal('derived_aggregate'),
    aggregationGrain: z.enum(['cohort_school', 'cohort_batch_school']),
    value: nonNegativeInteger.nullable(),
    displayValue: z.string().min(1).max(120),
    unit: z.literal('public_notice_records'),
    privacySuppressed: z.boolean(),
    suppressedRange: z.enum(['1-4']).nullable(),
    suppressionReason: z.enum(['primary_small_cell', 'complementary_protection']).nullable(),
    suppressionContext: z.enum(['destination_total', 'batch_cell']).nullable(),
    zeroConfirmed: z.boolean(),
    coverageStatus: z.string().min(1),
    mappingMethods: z.array(z.string().min(1)),
    sourceUnitLabels: z.array(z.string().min(1)),
    sourceKeys: z.array(z.string().min(1)).min(1),
    sourceSha256: sha256Schema,
    verificationStatus: z.literal('pending_official_source_mapping'),
    notes: z.string().min(1),
  })
  .strict();

export const schoolDestinationOutcomeSeedSchema = z
  .object({
    schemaVersion: z.literal('1.1.0'),
    datasetId: z.literal(SCHOOL_DESTINATION_OUTCOMES_DATASET_ID),
    generatedAt: z.string().refine((value) => !Number.isNaN(new Date(value).getTime())),
    dataAsOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    timezone: z.literal('Asia/Shanghai'),
    network: z.literal('国家电网'),
    cohortYear: z.literal(2026),
    countSemantics: z.literal('public_notice_records'),
    verificationStatus: z.literal('pending_official_source_mapping'),
    boundaries: z.array(z.string().min(1)).min(1),
    privacy: privacySchema,
    disciplineCoverage: disciplineCoverageSchema,
    inputManifest: z.array(inputManifestSchema).min(1),
    coverage: coverageSchema,
    schoolMappings: z.array(z.record(z.string(), z.unknown())),
    unitMappingAudit: z.array(z.record(z.string(), z.unknown())),
    unmappedSchoolLabels: z.array(z.record(z.string(), z.unknown())),
    outcomes: z.array(schoolDestinationOutcomeSchema).min(1),
  })
  .strict()
  .superRefine((seed, context) => {
    const sourceManifest = seed.inputManifest.find(
      (row) => row.inputType === 'deidentified_public_selection_seed',
    );
    if (!sourceManifest) {
      context.addIssue({
        code: 'custom',
        path: ['inputManifest'],
        message: 'deidentified_public_selection_seed manifest is required',
      });
      return;
    }
    if (seed.coverage.outcomeCount !== seed.outcomes.length) {
      context.addIssue({
        code: 'custom',
        path: ['coverage', 'outcomeCount'],
        message: 'coverage.outcomeCount must equal outcomes.length',
      });
    }

    const outcomeKeys = new Set<string>();
    const identities = new Set<string>();
    const lineageGroups = new Map<
      string,
      Array<{ index: number; outcome: (typeof seed.outcomes)[number] }>
    >();
    for (const [index, outcome] of seed.outcomes.entries()) {
      if (outcomeKeys.has(outcome.outcomeKey)) {
        context.addIssue({
          code: 'custom',
          path: ['outcomes', index, 'outcomeKey'],
          message: 'outcomeKey must be unique',
        });
      }
      outcomeKeys.add(outcome.outcomeKey);
      const identity = [
        outcome.schoolKey,
        outcome.destinationScope,
        outcome.destinationCompanyKey ?? 'none',
        outcome.batchCode,
        outcome.disciplineGroup,
        outcome.metricType,
      ].join('|');
      if (identities.has(identity)) {
        context.addIssue({
          code: 'custom',
          path: ['outcomes', index],
          message: 'school/destination/batch metric identity must be unique',
        });
      }
      identities.add(identity);
      const lineageIdentity = [
        outcome.schoolKey,
        outcome.destinationScope,
        outcome.destinationCompanyKey ?? 'none',
      ].join('|');
      const lineageRows = lineageGroups.get(lineageIdentity) ?? [];
      lineageRows.push({ index, outcome });
      lineageGroups.set(lineageIdentity, lineageRows);

      if (outcome.sourceSha256 !== sourceManifest.sha256) {
        context.addIssue({
          code: 'custom',
          path: ['outcomes', index, 'sourceSha256'],
          message: 'outcome sourceSha256 must match the deidentified source manifest',
        });
      }
      if (!outcome.sourceKeys.includes(SCHOOL_DESTINATION_SOURCE_KEY)) {
        context.addIssue({
          code: 'custom',
          path: ['outcomes', index, 'sourceKeys'],
          message: `${SCHOOL_DESTINATION_SOURCE_KEY} is required`,
        });
      }

      if (outcome.destinationScope === 'network_total') {
        if (
          outcome.destinationProvinceKey !== null ||
          outcome.destinationProvinceAdcode !== null ||
          outcome.destinationProvinceName !== null ||
          outcome.destinationCompanyKey !== null ||
          outcome.destinationUnitKey !== null
        ) {
          context.addIssue({
            code: 'custom',
            path: ['outcomes', index, 'destinationScope'],
            message: 'network_total must not carry province/company destination keys',
          });
        }
        if (outcome.sourceUnitLabels.length) {
          context.addIssue({
            code: 'custom',
            path: ['outcomes', index, 'sourceUnitLabels'],
            message: 'network_total must not carry destination unit labels',
          });
        }
      } else if (outcome.destinationScope === 'province_company') {
        if (
          !outcome.destinationProvinceKey ||
          !outcome.destinationProvinceAdcode ||
          !outcome.destinationProvinceName ||
          !outcome.destinationCompanyKey ||
          !outcome.destinationUnitKey
        ) {
          context.addIssue({
            code: 'custom',
            path: ['outcomes', index, 'destinationScope'],
            message: 'province_company requires controlled province/company/unit keys',
          });
        }
      } else if (
        outcome.destinationProvinceKey !== null ||
        outcome.destinationProvinceAdcode !== null ||
        outcome.destinationProvinceName !== null ||
        outcome.destinationCompanyKey !== null ||
        outcome.destinationUnitKey !== null
      ) {
        context.addIssue({
          code: 'custom',
          path: ['outcomes', index, 'destinationScope'],
          message: 'unknown destination must not carry inferred province/company keys',
        });
      }

      if (outcome.privacySuppressed) {
        if (outcome.value !== null || !outcome.suppressionReason) {
          context.addIssue({
            code: 'custom',
            path: ['outcomes', index, 'privacySuppressed'],
            message: 'suppressed cells must hide value and declare a suppression reason',
          });
        }
        if (
          outcome.suppressionReason === 'primary_small_cell' &&
          (outcome.displayValue !== '<5' || outcome.suppressedRange !== '1-4')
        ) {
          context.addIssue({
            code: 'custom',
            path: ['outcomes', index, 'suppressedRange'],
            message: 'primary small cells must display <5 with range 1-4',
          });
        }
      } else {
        if (outcome.value === null || (outcome.value > 0 && outcome.value < 5)) {
          context.addIssue({
            code: 'custom',
            path: ['outcomes', index, 'value'],
            message: 'unsuppressed cells require a value and must not expose exact 1-4',
          });
        }
        if (
          outcome.suppressionReason !== null ||
          outcome.suppressionContext !== null ||
          outcome.suppressedRange !== null
        ) {
          context.addIssue({
            code: 'custom',
            path: ['outcomes', index, 'suppressionReason'],
            message: 'unsuppressed cells must not carry suppression metadata',
          });
        }
      }
      if (outcome.zeroConfirmed !== (outcome.value === 0)) {
        context.addIssue({
          code: 'custom',
          path: ['outcomes', index, 'zeroConfirmed'],
          message: 'zeroConfirmed must be true only for an explicit zero value',
        });
      }
      if (outcome.zeroConfirmed && outcome.sourceUnitLabels.length) {
        context.addIssue({
          code: 'custom',
          path: ['outcomes', index, 'sourceUnitLabels'],
          message: 'zero-valued batch cells must not carry destination unit labels',
        });
      }
      const uniqueUnitLabels = [...new Set(outcome.sourceUnitLabels)];
      const sortedUnitLabels = [...uniqueUnitLabels].sort((left, right) =>
        left.localeCompare(right, 'zh-CN'),
      );
      if (
        uniqueUnitLabels.length !== outcome.sourceUnitLabels.length ||
        JSON.stringify(sortedUnitLabels) !== JSON.stringify(outcome.sourceUnitLabels)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['outcomes', index, 'sourceUnitLabels'],
          message: 'sourceUnitLabels must be unique and sorted',
        });
      }
    }

    for (const lineageRows of lineageGroups.values()) {
      const totalRow = lineageRows.find(({ outcome }) => outcome.batchCode === 'all');
      if (!totalRow || totalRow.outcome.destinationScope === 'network_total') continue;
      const batchUnion = [
        ...new Set(
          lineageRows
            .filter(({ outcome }) => outcome.batchCode !== 'all')
            .flatMap(({ outcome }) => outcome.sourceUnitLabels),
        ),
      ].sort((left, right) => left.localeCompare(right, 'zh-CN'));
      if (JSON.stringify(batchUnion) !== JSON.stringify(totalRow.outcome.sourceUnitLabels)) {
        context.addIssue({
          code: 'custom',
          path: ['outcomes', totalRow.index, 'sourceUnitLabels'],
          message: 'all-batch sourceUnitLabels must equal the union of batch-level labels',
        });
      }
    }
  });

export type SchoolDestinationOutcomeSeed = z.infer<
  typeof schoolDestinationOutcomeSeedSchema
>;
export type SchoolDestinationOutcome = z.infer<typeof schoolDestinationOutcomeSchema>;

export type SchoolDestinationMetricReferences = {
  schoolId: string;
  provinceId: string | null;
  companyId: string | null;
  batchId: string | null;
  sourceDocumentId: string;
};

export function schoolDestinationMetricValues(
  seed: SchoolDestinationOutcomeSeed,
  outcome: SchoolDestinationOutcome,
  references: SchoolDestinationMetricReferences,
  artifactSha256: string,
) {
  const isProvinceCompany = outcome.destinationScope === 'province_company';
  return {
    metricKey: outcome.outcomeKey,
    cohortYear: outcome.cohortYear,
    batchId:
      isProvinceCompany && outcome.batchCode !== 'all' ? references.batchId : null,
    batchCode: outcome.batchCode,
    provinceId: isProvinceCompany ? references.provinceId : null,
    cityId: null,
    schoolId: references.schoolId,
    companyId: isProvinceCompany ? references.companyId : null,
    destinationScope: outcome.destinationScope,
    disciplineGroup: outcome.disciplineGroup,
    disciplineEvidenceStatus: outcome.disciplineEvidenceStatus,
    majorCategory: outcome.majorCategory,
    majorEvidenceStatus: outcome.majorEvidenceStatus,
    unitScope: outcome.destinationUnitName,
    metricType: 'public_notice_record_count',
    valueKind: 'derived_aggregate',
    aggregationGrain: outcome.aggregationGrain,
    value: outcome.value === null ? null : String(outcome.value),
    displayValue: outcome.displayValue,
    unit: 'public_notice_records',
    isApproximate: false,
    subjectScope: null,
    sampleSize: null,
    privacySuppressed: outcome.privacySuppressed,
    suppressedRange: outcome.suppressedRange,
    suppressionReason: outcome.suppressionReason,
    zeroConfirmed: outcome.zeroConfirmed,
    sourceDocumentId: references.sourceDocumentId,
    sourceKeys: outcome.sourceKeys,
    status: outcome.verificationStatus,
    publicationStatus: 'published' as const,
    notes: outcome.notes,
    metadata: {
      dataset_id: seed.datasetId,
      schema_version: seed.schemaVersion,
      artifact_sha256: artifactSha256,
      source_sha256: outcome.sourceSha256,
      source_hash_algorithm: 'sha256',
      count_semantics: seed.countSemantics,
      coverage_status: outcome.coverageStatus,
      dataset_coverage: seed.coverage,
      privacy_policy: seed.privacy,
      discipline_coverage: seed.disciplineCoverage,
      discipline_evidence_status: outcome.disciplineEvidenceStatus,
      major_evidence_status: outcome.majorEvidenceStatus,
      boundaries: seed.boundaries,
      input_manifest: seed.inputManifest,
      origin_province_key: outcome.originProvinceKey,
      origin_city_key: outcome.originCityKey,
      destination_province_key: outcome.destinationProvinceKey,
      destination_province_adcode: outcome.destinationProvinceAdcode,
      destination_company_key: outcome.destinationCompanyKey,
      destination_unit_key: outcome.destinationUnitKey,
      batch_name: outcome.batchName,
      mapping_methods: outcome.mappingMethods,
      source_unit_labels: outcome.sourceUnitLabels,
      suppression_context: outcome.suppressionContext,
      professional_counts_available: false,
    },
  };
}
