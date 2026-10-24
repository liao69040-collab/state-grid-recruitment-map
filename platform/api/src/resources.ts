import { z } from 'zod';
import type { ResourceName } from './db/schema.js';

const uuid = z.uuid();
const nullableUuid = uuid.nullable().optional();
const nullableText = z.string().trim().max(5000).nullable().optional();
const nullableShortText = z.string().trim().max(240).nullable().optional();
const year = z.number().int().min(2000).max(2100);
const recruitmentBatchCode = z.enum(['campus', 'batch_1', 'batch_2', 'batch_3']);
const dashboardBatchCode = z.enum([
  'campus',
  'batch_1',
  'batch_2',
  'batch_3',
  'all',
  'not_applicable',
]);
const metricUnit = z.enum([
  'public_notice_records',
  'people',
  'ratio',
  'entities',
  'records',
  'count',
  'regions',
  'sections',
  'as_provided',
]);
const metricDestinationScope = z.enum([
  'network_total',
  'province_company',
  'province',
  'company',
  'unknown',
]);
const metricDisciplineGroup = z.enum(['all', 'electrical', 'non_electrical', 'unknown']);
const metricProfessionalEvidenceStatus = z.enum([
  'verified_source',
  'partial_source',
  'source_not_provided',
  'pending_verification',
]);
const recruitmentScopeKind = z.enum(['province_company', 'national', 'special_unit']);
// Canonical data carries exact evidence-boundary values such as
// partially_verified, reference_only and verified_name_only. Do not collapse them.
const status = z.string().trim().min(1).max(80).regex(/^[a-z0-9_-]+$/);
const publication = z.enum(['draft', 'published', 'archived']);
const timestamp = z.iso.datetime({ offset: true }).or(z.iso.datetime()).nullable().optional();
const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional();
const coordinate = z.union([z.string(), z.number()]).nullable().optional();
const metadata = z.record(z.string(), z.unknown()).optional();
const sourceKeys = z.array(z.string().trim().min(1).max(160)).min(1);

const earlyBatchPredicate = z
  .object({
    field: z.string().trim().min(1).max(80),
    operator: z.enum([
      'in',
      'equals',
      'contains_any',
      'matches_any',
      'meets_degree_rule',
      'lte',
      'requires_manual_review',
    ]),
    value: z.unknown(),
    label: z.string().trim().min(1).max(120),
  })
  .strict();

export const earlyBatchEligibilityModel = z
  .object({
    version: z.literal(1),
    confidence: z.string().trim().min(1).max(100),
    branches: z
      .array(
        z
          .object({
            key: z.string().trim().min(1).max(120),
            outcome: z.enum(['eligible_reference', 'manual_review']),
            reason: z.string().trim().min(1).max(1000),
            predicates: z.array(earlyBatchPredicate).min(1),
            notes: z.array(z.string().trim().min(1).max(1000)).optional(),
          })
          .strict(),
      )
      .min(1),
    notes: z.array(z.string().trim().min(1).max(1000)).optional(),
  })
  .strict();

const recruitmentMetricState = z
  .object({
    cohortYear: year,
    batchId: uuid.nullable().optional(),
    batchCode: dashboardBatchCode,
    provinceId: uuid.nullable().optional(),
    cityId: uuid.nullable().optional(),
    schoolId: uuid.nullable().optional(),
    companyId: uuid.nullable().optional(),
    destinationScope: metricDestinationScope.default('province_company'),
    disciplineGroup: metricDisciplineGroup.default('all'),
    disciplineEvidenceStatus: metricProfessionalEvidenceStatus.default('source_not_provided'),
    majorCategory: z.string().trim().max(80).nullable().optional(),
    majorEvidenceStatus: metricProfessionalEvidenceStatus.default('source_not_provided'),
    unitScope: z.string().trim().min(1).max(200),
    metricType: z.string(),
    aggregationGrain: z.string(),
    value: z.union([z.string(), z.number()]).nullable().optional(),
    displayValue: z.string().nullable().optional(),
    unit: metricUnit,
    privacySuppressed: z.boolean().optional(),
    zeroConfirmed: z.boolean().optional(),
    sourceKeys,
    publicationStatus: publication.optional(),
  })
  .passthrough()
  .superRefine((row, context) => {
    const expectedUnit =
      row.metricType === 'public_notice_record_count'
        ? 'public_notice_records'
        : row.metricType === 'batch_share'
          ? 'ratio'
          : row.metricType === 'plan_count' || row.metricType.endsWith('_plan_count') || row.metricType === 'planned_headcount_raw_mention'
            ? 'people'
            : null;
    if (expectedUnit && row.unit !== expectedUnit) {
      context.addIssue({
        code: 'custom',
        path: ['unit'],
        message: `${row.metricType} 的单位必须为 ${expectedUnit}`,
      });
    }
    const isBatchGrain =
      row.aggregationGrain.startsWith('cohort_batch_') ||
      row.aggregationGrain === 'provided_image_group' ||
      ['stated_batch_or_scope_total', 'announcement_row_or_subscope'].includes(row.aggregationGrain);
    if (row.aggregationGrain === 'cohort_school') {
      if (row.batchCode !== 'all' || row.batchId != null) {
        context.addIssue({
          code: 'custom',
          path: ['batchCode'],
          message: 'cohort_school 总计必须使用 all 且不关联批次 ID',
        });
      }
    } else if (isBatchGrain) {
      if (
        (row.destinationScope !== 'network_total' && !row.batchId) ||
        !recruitmentBatchCode.safeParse(row.batchCode).success
      ) {
        context.addIssue({
          code: 'custom',
          path: ['batchId'],
          message: '省份/单位分批指标必须关联批次 ID；全国总口径使用 canonical 批次编码但不绑定单一批次 ID',
        });
      }
    } else if (row.batchCode !== 'not_applicable') {
      context.addIssue({
        code: 'custom',
        path: ['batchCode'],
        message: '非批次指标必须使用 not_applicable',
      });
    }
    if (row.privacySuppressed && row.value != null) {
      context.addIssue({
        code: 'custom',
        path: ['value'],
        message: '隐私抑制指标不得保留数值',
      });
    }
    if (row.zeroConfirmed && Number(row.value) !== 0) {
      context.addIssue({
        code: 'custom',
        path: ['zeroConfirmed'],
        message: '只有数值为 0 时才能确认零值',
      });
    }
    if (
      row.schoolId &&
      ['public_notice_record_count', 'batch_share'].includes(row.metricType) &&
      row.destinationScope !== 'network_total' &&
      (!row.provinceId || !row.companyId)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['provinceId'],
        message: '已发布学校事实必须保留招聘省份和招聘单位维度',
      });
    }
    if (row.disciplineGroup === 'all' && row.majorCategory) {
      context.addIssue({
        code: 'custom',
        path: ['majorCategory'],
        message: '全专业合计不得同时填写单一专业类别',
      });
    }
    if (
      row.disciplineGroup !== 'all' &&
      row.disciplineEvidenceStatus === 'source_not_provided'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['disciplineEvidenceStatus'],
        message: '专业大类拆分值必须声明已核验、部分来源或待核验证据状态',
      });
    }
    if (row.majorCategory && row.majorEvidenceStatus === 'source_not_provided') {
      context.addIssue({
        code: 'custom',
        path: ['majorEvidenceStatus'],
        message: '填写细分专业后不得将专业证据标记为源数据未提供',
      });
    }
    if (
      row.publicationStatus === 'published' &&
      row.disciplineGroup !== 'all' &&
      row.disciplineEvidenceStatus === 'pending_verification'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['disciplineEvidenceStatus'],
        message: '待核验的专业大类拆分不得直接发布',
      });
    }
    if (
      row.publicationStatus === 'published' &&
      row.majorCategory &&
      row.majorEvidenceStatus === 'pending_verification'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['majorEvidenceStatus'],
        message: '待核验的细分专业拆分不得直接发布',
      });
    }
    if (
      row.schoolId &&
      ['public_notice_record_count', 'batch_share'].includes(row.metricType) &&
      !row.sourceKeys.includes('public-selection-aggregate-2026')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['sourceKeys'],
        message: '学校公示指标必须关联公示汇总事实来源',
      });
    }
  });

const dataBoundary = {
  cohortYear: year.nullable().optional(),
  batchCode: dashboardBatchCode.nullable().optional(),
  unitScope: nullableShortText,
  sourceDocumentId: nullableUuid,
  status: status.optional(),
  publicationStatus: publication.optional(),
  notes: nullableText,
  metadata,
};

const schemas = {
  provinces: z
    .object({
      provinceKey: z.string().trim().max(160).nullable().optional(),
      adcode: z.string().regex(/^\d{6}$/),
      name: z.string().trim().min(1).max(80),
      shortName: z.string().trim().max(40).nullable().optional(),
      region: z.string().trim().max(40).nullable().optional(),
      mapClickable: z.boolean().optional(),
      mapCenter: z.tuple([z.number(), z.number()]).nullable().optional(),
      mapCentroid: z.tuple([z.number(), z.number()]).nullable().optional(),
      mapChildrenCount: z.number().int().min(0).nullable().optional(),
      geometrySourceId: z.string().trim().max(200).nullable().optional(),
      businessDataStatus: z.string().trim().min(1).max(100).optional(),
      status: status.optional(),
      sortOrder: z.number().int().optional(),
      enabled: z.boolean().optional(),
      metadata,
    })
    .strict(),
  cities: z
    .object({
      provinceId: uuid,
      cityKey: z.string().trim().max(160).nullable().optional(),
      adcode: z.string().regex(/^\d{6}$/).nullable().optional(),
      name: z.string().trim().min(1).max(80),
      longitude: coordinate,
      latitude: coordinate,
      sortOrder: z.number().int().optional(),
      enabled: z.boolean().optional(),
      status: status.optional(),
      metadata,
    })
    .strict(),
  schools: z
    .object({
      schoolKey: z.string().trim().min(1).max(160),
      name: z.string().trim().min(1).max(240),
      provinceId: nullableUuid,
      cityId: nullableUuid,
      nature: nullableShortText,
      educationLevel: nullableShortText,
      address: nullableText,
      longitude: coordinate,
      latitude: coordinate,
      ...dataBoundary,
    })
    .strict(),
  companies: z
    .object({
      companyKey: z.string().trim().min(1).max(160),
      name: z.string().trim().min(1).max(240),
      parentCompanyId: nullableUuid,
      provinceId: nullableUuid,
      cityId: nullableUuid,
      companyType: nullableShortText,
      address: nullableText,
      longitude: coordinate,
      latitude: coordinate,
      ...dataBoundary,
    })
    .strict(),
  'recruitment-batches': z
    .object({
      batchKey: z.string().trim().max(160).nullable().optional(),
      cohortYear: year,
      code: recruitmentBatchCode,
      name: z.string().trim().min(1).max(120),
      sortOrder: z.number().int().optional(),
      unitScope: z.string().trim().min(1).max(200),
      provinceId: uuid,
      companyId: uuid,
      applicationStartsAt: timestamp,
      applicationEndsAt: timestamp,
      examStartsAt: timestamp,
      examEndsAt: timestamp,
      sourceDocumentId: uuid,
      sourceKeys,
      status: status.optional(),
      publicationStatus: publication.optional(),
      notes: nullableText,
      metadata,
    })
    .strict(),
  'recruitment-events': z
    .object({
      eventKey: z.string().trim().max(160).nullable().optional(),
      cohortYear: year,
      batchId: nullableUuid,
      batchCode: recruitmentBatchCode,
      provinceId: nullableUuid,
      cityId: nullableUuid,
      companyId: nullableUuid,
      scopeKind: recruitmentScopeKind.default('province_company'),
      unitScope: z.string().trim().min(1).max(200),
      eventType: z.string().trim().min(1).max(80),
      title: z.string().trim().min(1).max(2000),
      startsOn: calendarDate,
      endsOn: calendarDate,
      startsAt: timestamp,
      endsAt: timestamp,
      timezone: z.string().trim().max(64).optional(),
      rawTimeText: nullableText,
      datePrecision: z.string().trim().max(40).nullable().optional(),
      timeStatus: z.string().trim().max(80).nullable().optional(),
      certainty: z.string().trim().max(40).nullable().optional(),
      locationText: nullableText,
      locationKind: z.string().trim().max(60).nullable().optional(),
      evidenceExcerpt: nullableText,
      evidenceTier: z.string().trim().max(8).optional(),
      sourceKind: z.string().trim().max(60).optional(),
      sourceDocumentId: uuid,
      sourceKeys,
      status: status.optional(),
      publicationStatus: publication.optional(),
      notes: nullableText,
      metadata,
    })
    .strict(),
  'recruitment-requirements': z
    .object({
      requirementKey: z.string().trim().min(1).max(200),
      cohortYear: year,
      batchCode: recruitmentBatchCode,
      provinceId: nullableUuid,
      companyId: nullableUuid,
      scopeKind: recruitmentScopeKind.default('province_company'),
      unitScope: z.string().trim().min(1).max(200),
      category: z.string().trim().min(1).max(80),
      categoryTags: z.array(z.string().trim().min(1).max(80)).optional(),
      evidenceGroupKey: z.string().trim().max(200).nullable().optional(),
      applicabilityStatus: z
        .enum(['verified', 'needs_review', 'not_disclosed', 'not_reviewed'])
        .optional(),
      requirementKind: z.string().trim().min(1).max(80).optional(),
      title: z.string().trim().min(1).max(240),
      excerpt: z.string().trim().min(1).max(5000),
      applicability: nullableText,
      evidenceLocator: z.string().trim().max(240).nullable().optional(),
      evidenceTier: z.string().trim().max(8).optional(),
      sourceDocumentId: uuid,
      sourceKeys,
      status: status.optional(),
      publicationStatus: publication.optional(),
      notes: nullableText,
      metadata,
    })
    .strict(),
  'recruitment-metrics': z
    .object({
      metricKey: z.string().trim().min(1).max(160),
      cohortYear: year,
      batchId: nullableUuid,
      batchCode: dashboardBatchCode,
      provinceId: nullableUuid,
      cityId: nullableUuid,
      schoolId: nullableUuid,
      companyId: nullableUuid,
      destinationScope: metricDestinationScope.default('province_company'),
      disciplineGroup: metricDisciplineGroup.default('all'),
      disciplineEvidenceStatus: metricProfessionalEvidenceStatus.default('source_not_provided'),
      majorCategory: z.string().trim().max(80).nullable().optional(),
      majorEvidenceStatus: metricProfessionalEvidenceStatus.default('source_not_provided'),
      unitScope: z.string().trim().min(1).max(200),
      metricType: z.string().trim().min(1).max(100),
      valueKind: z.string().trim().min(1).max(100),
      aggregationGrain: z.string().trim().min(1).max(120),
      value: z.union([z.string(), z.number()]).nullable().optional(),
      displayValue: z.string().trim().max(120).nullable().optional(),
      unit: metricUnit,
      isApproximate: z.boolean().optional(),
      subjectScope: nullableText,
      sampleSize: z.number().int().min(0).nullable().optional(),
      privacySuppressed: z.boolean().optional(),
      suppressedRange: z.string().trim().max(80).nullable().optional(),
      suppressionReason: z.string().trim().max(120).nullable().optional(),
      zeroConfirmed: z.boolean().optional(),
      sourceDocumentId: uuid,
      sourceKeys,
      status: status.optional(),
      publicationStatus: publication.optional(),
      notes: nullableText,
      metadata,
    })
    .strict(),
  sources: z
    .object({
      sourceKey: z.string().trim().min(1).max(160),
      title: z.string().trim().min(1).max(5000),
      sourceType: z.string().trim().min(1).max(80),
      publisher: z.string().trim().max(200).nullable().optional(),
      officialUrl: z.url().nullable().optional(),
      archivePath: nullableText,
      checksumSha256: z.string().regex(/^[a-fA-F0-9]{64}$/).nullable().optional(),
      contentText: z.string().trim().max(20_000).nullable().optional(),
      publishedAt: timestamp,
      accessedAt: timestamp,
      cohortYear: year.nullable().optional(),
      batchCode: dashboardBatchCode.nullable().optional(),
      unitScope: nullableShortText,
      status: status.optional(),
      notes: nullableText,
      metadata,
    })
    .strict(),
  revisions: z
    .object({
      revisionKey: z.string().trim().min(1).max(160),
      title: z.string().trim().min(1).max(240),
      description: nullableText,
      cohortYear: year.nullable().optional(),
      batchCode: dashboardBatchCode.nullable().optional(),
      unitScope: nullableShortText,
      sourceDocumentId: nullableUuid,
      status: publication.optional(),
      dataStatus: status.optional(),
      payload: z.record(z.string(), z.unknown()).optional(),
      metadata,
      publishedAt: timestamp,
    })
    .strict(),
  'early-batch-policies': z
    .object({
      policyKey: z.string().trim().min(1).max(200),
      cohortYear: year,
      batchCode: z.literal('campus'),
      targetKind: z.enum(['province', 'unit']),
      targetCode: z.string().trim().min(1).max(120),
      targetName: z.string().trim().min(1).max(120),
      provinceId: nullableUuid,
      parentProvinceId: nullableUuid,
      recruitmentRequirements: z.string().trim().min(1).max(10000),
      recruitmentProcess: nullableText,
      plannedHeadcountDisplay: z.string().trim().max(120).nullable().optional(),
      assessmentMethod: nullableText,
      itineraryReference: nullableText,
      siteQuotaDisplay: nullableText,
      admissionRule: nullableText,
      actualHeadcountDisplay: z.string().trim().max(120).nullable().optional(),
      otherNotes: nullableText,
      missingFields: z.array(z.string().trim().min(1).max(240)).optional(),
      eligibilityModel: earlyBatchEligibilityModel,
      sourceLocator: z.string().trim().regex(/^Sheet1!A\d+:K\d+$/),
      evidenceAssets: z.array(z.record(z.string(), z.unknown())).optional(),
      externalEvidence: z.array(z.record(z.string(), z.unknown())).optional(),
      sourceStatus: status,
      sourceDocumentId: uuid,
      revisionId: uuid,
      status: status.optional(),
      publicationStatus: publication.optional(),
      sortOrder: z.number().int().min(0).optional(),
      metadata,
    })
    .strict(),
} as const;

export type CanonicalResourceName = keyof typeof schemas;

export function canonicalResourceName(input: ResourceName): CanonicalResourceName {
  if (input === 'source-documents') return 'sources';
  if (input === 'data-revisions') return 'revisions';
  return input;
}

export function parseResourceCreate(resource: ResourceName, input: unknown): Record<string, unknown> {
  const canonical = canonicalResourceName(resource);
  const parsed = schemas[canonical].parse(input) as Record<string, unknown>;
  if (
    canonical === 'recruitment-metrics' &&
    parsed.value == null &&
    parsed.displayValue == null
  ) {
    throw new Error('METRIC_VALUE_REQUIRED');
  }
  validateResourceState(resource, parsed);
  return parsed;
}

export function validateResourceState(
  resource: ResourceName,
  input: Record<string, unknown>,
): void {
  if (canonicalResourceName(resource) === 'recruitment-metrics') {
    recruitmentMetricState.parse(input);
  }
}

export function parseResourcePatch(resource: ResourceName, input: unknown): Record<string, unknown> {
  const canonical = canonicalResourceName(resource);
  const parsed = schemas[canonical].partial().parse(input) as Record<string, unknown>;
  if (Object.keys(parsed).length === 0) throw new z.ZodError([]);
  return parsed;
}

export const exposedResources = Object.keys(schemas) as CanonicalResourceName[];
