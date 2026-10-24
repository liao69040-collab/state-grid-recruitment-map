import { sql } from 'drizzle-orm';
export { gridDatasetVersions, gridQuerySources, gridPolicyFacts, gridSchoolOutcomes } from './grid-query-schema.js';
export { gridMapCatalogs } from './grid-map-schema.js';
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const publicationStatus = pgEnum('publication_status', [
  'draft',
  'published',
  'archived',
]);

export const auditOutcome = pgEnum('audit_outcome', ['success', 'failure']);

const auditTimestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

export const admins = pgTable(
  'admins',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    username: varchar('username', { length: 80 }).notNull(),
    displayName: varchar('display_name', { length: 120 }).notNull(),
    passwordHash: text('password_hash').notNull(),
    role: varchar('role', { length: 32 }).notNull().default('superadmin'),
    enabled: boolean('enabled').notNull().default(true),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    ...auditTimestamps,
  },
  (table) => [uniqueIndex('admins_username_uq').on(table.username)],
);

export const adminSessions = pgTable(
  'admin_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    adminId: uuid('admin_id')
      .notNull()
      .references(() => admins.id, { onDelete: 'cascade' }),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    csrfHash: varchar('csrf_hash', { length: 64 }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    ipHash: varchar('ip_hash', { length: 64 }),
    userAgentHash: varchar('user_agent_hash', { length: 64 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('admin_sessions_token_uq').on(table.tokenHash),
    index('admin_sessions_admin_idx').on(table.adminId),
    index('admin_sessions_expiry_idx').on(table.expiresAt),
  ],
);

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    phoneLookupHash: varchar('phone_lookup_hash', { length: 64 }).notNull(),
    phoneCiphertext: text('phone_ciphertext').notNull(),
    phoneLast4: varchar('phone_last4', { length: 4 }).notNull(),
    displayName: varchar('display_name', { length: 120 }),
    passwordHash: text('password_hash').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    createdByAdminId: uuid('created_by_admin_id').references(() => admins.id, {
      onDelete: 'set null',
    }),
    passwordChangedAt: timestamp('password_changed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    ...auditTimestamps,
  },
  (table) => [
    uniqueIndex('users_phone_lookup_uq')
      .on(table.phoneLookupHash)
      .where(sql`${table.deletedAt} is null`),
    index('users_enabled_idx').on(table.enabled),
  ],
);

export const userSessions = pgTable(
  'user_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    csrfHash: varchar('csrf_hash', { length: 64 }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    ipHash: varchar('ip_hash', { length: 64 }),
    userAgentHash: varchar('user_agent_hash', { length: 64 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('user_sessions_token_uq').on(table.tokenHash),
    index('user_sessions_user_idx').on(table.userId),
    index('user_sessions_expiry_idx').on(table.expiresAt),
  ],
);

export const sourceDocuments = pgTable(
  'source_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceKey: varchar('source_key', { length: 160 }).notNull(),
    title: text('title').notNull(),
    sourceType: varchar('source_type', { length: 80 }).notNull(),
    publisher: varchar('publisher', { length: 200 }),
    officialUrl: text('official_url'),
    archivePath: text('archive_path'),
    checksumSha256: varchar('checksum_sha256', { length: 64 }),
    contentText: text('content_text'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    accessedAt: timestamp('accessed_at', { withTimezone: true }),
    cohortYear: integer('cohort_year'),
    batchCode: varchar('batch_code', { length: 80 }),
    unitScope: varchar('unit_scope', { length: 200 }),
    status: varchar('status', { length: 80 }).notNull().default('pending'),
    notes: text('notes'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    ...auditTimestamps,
  },
  (table) => [
    uniqueIndex('source_documents_key_uq').on(table.sourceKey),
    index('source_documents_year_batch_idx').on(table.cohortYear, table.batchCode),
  ],
);

export const provinces = pgTable(
  'provinces',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provinceKey: varchar('province_key', { length: 160 }),
    adcode: varchar('adcode', { length: 6 }).notNull(),
    name: varchar('name', { length: 80 }).notNull(),
    shortName: varchar('short_name', { length: 40 }),
    region: varchar('region', { length: 40 }),
    mapClickable: boolean('map_clickable').notNull().default(false),
    mapCenter: jsonb('map_center').$type<[number, number] | null>(),
    mapCentroid: jsonb('map_centroid').$type<[number, number] | null>(),
    mapChildrenCount: integer('map_children_count'),
    geometrySourceId: varchar('geometry_source_id', { length: 200 }),
    businessDataStatus: varchar('business_data_status', { length: 100 }).notNull().default('pending'),
    status: varchar('status', { length: 80 }).notNull().default('pending'),
    sortOrder: integer('sort_order').notNull().default(0),
    enabled: boolean('enabled').notNull().default(true),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    ...auditTimestamps,
  },
  (table) => [
    uniqueIndex('provinces_adcode_uq').on(table.adcode),
    uniqueIndex('provinces_key_uq').on(table.provinceKey),
  ],
);

export const cities = pgTable(
  'cities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    cityKey: varchar('city_key', { length: 160 }),
    provinceId: uuid('province_id')
      .notNull()
      .references(() => provinces.id, { onDelete: 'restrict' }),
    adcode: varchar('adcode', { length: 6 }),
    name: varchar('name', { length: 80 }).notNull(),
    longitude: numeric('longitude', { precision: 10, scale: 7 }),
    latitude: numeric('latitude', { precision: 10, scale: 7 }),
    sortOrder: integer('sort_order').notNull().default(0),
    enabled: boolean('enabled').notNull().default(true),
    status: varchar('status', { length: 80 }).notNull().default('pending'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    ...auditTimestamps,
  },
  (table) => [
    uniqueIndex('cities_adcode_uq').on(table.adcode),
    uniqueIndex('cities_key_uq').on(table.cityKey),
    index('cities_province_idx').on(table.provinceId),
  ],
);

export const schools = pgTable(
  'schools',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    schoolKey: varchar('school_key', { length: 160 }).notNull(),
    name: varchar('name', { length: 240 }).notNull(),
    provinceId: uuid('province_id').references(() => provinces.id, { onDelete: 'set null' }),
    cityId: uuid('city_id').references(() => cities.id, { onDelete: 'set null' }),
    nature: varchar('nature', { length: 120 }),
    educationLevel: varchar('education_level', { length: 80 }),
    address: text('address'),
    longitude: numeric('longitude', { precision: 10, scale: 7 }),
    latitude: numeric('latitude', { precision: 10, scale: 7 }),
    cohortYear: integer('cohort_year'),
    batchCode: varchar('batch_code', { length: 80 }),
    unitScope: varchar('unit_scope', { length: 200 }),
    sourceDocumentId: uuid('source_document_id').references(() => sourceDocuments.id, {
      onDelete: 'set null',
    }),
    status: varchar('status', { length: 80 }).notNull().default('pending'),
    publicationStatus: publicationStatus('publication_status').notNull().default('draft'),
    notes: text('notes'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    ...auditTimestamps,
  },
  (table) => [
    uniqueIndex('schools_key_uq').on(table.schoolKey),
    index('schools_location_idx').on(table.provinceId, table.cityId),
    index('schools_year_batch_idx').on(table.cohortYear, table.batchCode),
  ],
);

export const companies = pgTable(
  'companies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyKey: varchar('company_key', { length: 160 }).notNull(),
    name: varchar('name', { length: 240 }).notNull(),
    parentCompanyId: uuid('parent_company_id'),
    provinceId: uuid('province_id').references(() => provinces.id, { onDelete: 'set null' }),
    cityId: uuid('city_id').references(() => cities.id, { onDelete: 'set null' }),
    companyType: varchar('company_type', { length: 100 }),
    address: text('address'),
    longitude: numeric('longitude', { precision: 10, scale: 7 }),
    latitude: numeric('latitude', { precision: 10, scale: 7 }),
    cohortYear: integer('cohort_year'),
    batchCode: varchar('batch_code', { length: 80 }),
    unitScope: varchar('unit_scope', { length: 200 }),
    sourceDocumentId: uuid('source_document_id').references(() => sourceDocuments.id, {
      onDelete: 'set null',
    }),
    status: varchar('status', { length: 80 }).notNull().default('pending'),
    publicationStatus: publicationStatus('publication_status').notNull().default('draft'),
    notes: text('notes'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    ...auditTimestamps,
  },
  (table) => [
    uniqueIndex('companies_key_uq').on(table.companyKey),
    index('companies_parent_idx').on(table.parentCompanyId),
    index('companies_location_idx').on(table.provinceId, table.cityId),
  ],
);

export const recruitmentBatches = pgTable(
  'recruitment_batches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    batchKey: varchar('batch_key', { length: 160 }),
    cohortYear: integer('cohort_year').notNull(),
    code: varchar('code', { length: 80 }).notNull(),
    name: varchar('name', { length: 120 }).notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    unitScope: varchar('unit_scope', { length: 200 }).notNull().default('国家电网'),
    provinceId: uuid('province_id')
      .notNull()
      .references(() => provinces.id, { onDelete: 'restrict' }),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    applicationStartsAt: timestamp('application_starts_at', { withTimezone: true }),
    applicationEndsAt: timestamp('application_ends_at', { withTimezone: true }),
    examStartsAt: timestamp('exam_starts_at', { withTimezone: true }),
    examEndsAt: timestamp('exam_ends_at', { withTimezone: true }),
    sourceDocumentId: uuid('source_document_id').references(() => sourceDocuments.id, {
      onDelete: 'set null',
    }),
    sourceKeys: jsonb('source_keys').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    status: varchar('status', { length: 80 }).notNull().default('pending'),
    publicationStatus: publicationStatus('publication_status').notNull().default('draft'),
    notes: text('notes'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    ...auditTimestamps,
  },
  (table) => [
    uniqueIndex('recruitment_batches_year_code_scope_uq').on(
      table.cohortYear,
      table.code,
      table.provinceId,
      table.companyId,
    ),
    uniqueIndex('recruitment_batches_key_uq').on(table.batchKey),
    index('recruitment_batches_scope_idx').on(table.provinceId, table.companyId),
  ],
);

export const recruitmentEvents = pgTable(
  'recruitment_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventKey: varchar('event_key', { length: 160 }),
    cohortYear: integer('cohort_year').notNull(),
    batchId: uuid('batch_id').references(() => recruitmentBatches.id, { onDelete: 'set null' }),
    batchCode: varchar('batch_code', { length: 80 }).notNull(),
    provinceId: uuid('province_id').references(() => provinces.id, { onDelete: 'set null' }),
    cityId: uuid('city_id').references(() => cities.id, { onDelete: 'set null' }),
    companyId: uuid('company_id').references(() => companies.id, { onDelete: 'set null' }),
    scopeKind: varchar('scope_kind', { length: 40 }).notNull().default('province_company'),
    unitScope: varchar('unit_scope', { length: 200 }).notNull(),
    eventType: varchar('event_type', { length: 80 }).notNull(),
    title: text('title').notNull(),
    startsOn: date('starts_on'),
    endsOn: date('ends_on'),
    startsAt: timestamp('starts_at', { withTimezone: true }),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    timezone: varchar('timezone', { length: 64 }).notNull().default('Asia/Shanghai'),
    rawTimeText: text('raw_time_text'),
    datePrecision: varchar('date_precision', { length: 40 }),
    timeStatus: varchar('time_status', { length: 80 }),
    certainty: varchar('certainty', { length: 40 }),
    locationText: text('location_text'),
    locationKind: varchar('location_kind', { length: 60 }),
    evidenceExcerpt: text('evidence_excerpt'),
    evidenceTier: varchar('evidence_tier', { length: 8 }).notNull().default('A'),
    sourceKind: varchar('source_kind', { length: 60 }).notNull().default('current_official'),
    sourceDocumentId: uuid('source_document_id').references(() => sourceDocuments.id, {
      onDelete: 'set null',
    }),
    sourceKeys: jsonb('source_keys').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    status: varchar('status', { length: 80 }).notNull().default('pending'),
    publicationStatus: publicationStatus('publication_status').notNull().default('draft'),
    notes: text('notes'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    ...auditTimestamps,
  },
  (table) => [
    index('recruitment_events_year_batch_idx').on(table.cohortYear, table.batchCode),
    index('recruitment_events_location_idx').on(table.provinceId, table.cityId),
    check(
      'recruitment_events_scope_kind_ck',
      sql`${table.scopeKind} in ('province_company', 'national', 'special_unit')`,
    ),
    uniqueIndex('recruitment_events_key_uq').on(table.eventKey),
  ],
);

export const recruitmentRequirements = pgTable(
  'recruitment_requirements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    requirementKey: varchar('requirement_key', { length: 200 }).notNull(),
    cohortYear: integer('cohort_year').notNull(),
    batchCode: varchar('batch_code', { length: 80 }).notNull(),
    provinceId: uuid('province_id').references(() => provinces.id, { onDelete: 'set null' }),
    companyId: uuid('company_id').references(() => companies.id, { onDelete: 'set null' }),
    scopeKind: varchar('scope_kind', { length: 40 }).notNull().default('province_company'),
    unitScope: varchar('unit_scope', { length: 200 }).notNull(),
    category: varchar('category', { length: 80 }).notNull(),
    categoryTags: jsonb('category_tags').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    evidenceGroupKey: varchar('evidence_group_key', { length: 200 }),
    applicabilityStatus: varchar('applicability_status', { length: 40 })
      .notNull()
      .default('not_reviewed'),
    requirementKind: varchar('requirement_kind', { length: 80 }).notNull().default('official_excerpt'),
    title: varchar('title', { length: 240 }).notNull(),
    excerpt: text('excerpt').notNull(),
    applicability: text('applicability'),
    evidenceLocator: varchar('evidence_locator', { length: 240 }),
    evidenceTier: varchar('evidence_tier', { length: 8 }).notNull().default('A'),
    sourceDocumentId: uuid('source_document_id')
      .notNull()
      .references(() => sourceDocuments.id, { onDelete: 'restrict' }),
    sourceKeys: jsonb('source_keys').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    status: varchar('status', { length: 80 }).notNull().default('pending'),
    publicationStatus: publicationStatus('publication_status').notNull().default('draft'),
    notes: text('notes'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    ...auditTimestamps,
  },
  (table) => [
    uniqueIndex('recruitment_requirements_key_uq').on(table.requirementKey),
    index('recruitment_requirements_scope_idx').on(
      table.cohortYear,
      table.batchCode,
      table.provinceId,
      table.companyId,
    ),
    index('recruitment_requirements_category_idx').on(table.category),
    index('recruitment_requirements_evidence_group_idx').on(table.evidenceGroupKey),
    check(
      'recruitment_requirements_scope_kind_ck',
      sql`${table.scopeKind} in ('province_company', 'national', 'special_unit')`,
    ),
  ],
);

export const recruitmentMetrics = pgTable(
  'recruitment_metrics',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    metricKey: varchar('metric_key', { length: 160 }),
    cohortYear: integer('cohort_year').notNull(),
    batchId: uuid('batch_id').references(() => recruitmentBatches.id, { onDelete: 'set null' }),
    batchCode: varchar('batch_code', { length: 80 }).notNull(),
    provinceId: uuid('province_id').references(() => provinces.id, { onDelete: 'set null' }),
    cityId: uuid('city_id').references(() => cities.id, { onDelete: 'set null' }),
    schoolId: uuid('school_id').references(() => schools.id, { onDelete: 'set null' }),
    companyId: uuid('company_id').references(() => companies.id, { onDelete: 'set null' }),
    destinationScope: varchar('destination_scope', { length: 40 })
      .notNull()
      .default('province_company'),
    disciplineGroup: varchar('discipline_group', { length: 40 }).notNull().default('all'),
    disciplineEvidenceStatus: varchar('discipline_evidence_status', { length: 40 })
      .notNull()
      .default('source_not_provided'),
    majorCategory: varchar('major_category', { length: 80 }),
    majorEvidenceStatus: varchar('major_evidence_status', { length: 40 })
      .notNull()
      .default('source_not_provided'),
    unitScope: varchar('unit_scope', { length: 200 }).notNull(),
    metricType: varchar('metric_type', { length: 100 }).notNull(),
    valueKind: varchar('value_kind', { length: 100 }).notNull().default('unspecified'),
    aggregationGrain: varchar('aggregation_grain', { length: 120 }).notNull().default('unspecified'),
    value: numeric('value', { precision: 18, scale: 4 }),
    displayValue: varchar('display_value', { length: 120 }),
    unit: varchar('unit', { length: 40 }).notNull().default('unspecified'),
    isApproximate: boolean('is_approximate').notNull().default(false),
    subjectScope: text('subject_scope'),
    sampleSize: integer('sample_size'),
    privacySuppressed: boolean('privacy_suppressed').notNull().default(false),
    suppressedRange: varchar('suppressed_range', { length: 80 }),
    suppressionReason: varchar('suppression_reason', { length: 120 }),
    zeroConfirmed: boolean('zero_confirmed').notNull().default(false),
    sourceDocumentId: uuid('source_document_id').references(() => sourceDocuments.id, {
      onDelete: 'set null',
    }),
    sourceKeys: jsonb('source_keys').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    status: varchar('status', { length: 80 }).notNull().default('pending'),
    publicationStatus: publicationStatus('publication_status').notNull().default('draft'),
    notes: text('notes'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    ...auditTimestamps,
  },
  (table) => [
    index('recruitment_metrics_year_batch_idx').on(table.cohortYear, table.batchCode),
    index('recruitment_metrics_dimensions_idx').on(
      table.provinceId,
      table.cityId,
      table.schoolId,
      table.companyId,
    ),
    index('recruitment_metrics_school_destination_idx').on(
      table.cohortYear,
      table.schoolId,
      table.destinationScope,
      table.provinceId,
      table.companyId,
      table.disciplineGroup,
      table.disciplineEvidenceStatus,
    ),
    check(
      'recruitment_metrics_destination_scope_ck',
      sql`${table.destinationScope} in ('network_total', 'province_company', 'province', 'company', 'unknown')`,
    ),
    check(
      'recruitment_metrics_discipline_group_ck',
      sql`${table.disciplineGroup} in ('all', 'electrical', 'non_electrical', 'unknown')`,
    ),
    check(
      'recruitment_metrics_discipline_evidence_status_ck',
      sql`${table.disciplineEvidenceStatus} in ('verified_source', 'partial_source', 'source_not_provided', 'pending_verification')`,
    ),
    check(
      'recruitment_metrics_major_evidence_status_ck',
      sql`${table.majorEvidenceStatus} in ('verified_source', 'partial_source', 'source_not_provided', 'pending_verification')`,
    ),
    check(
      'recruitment_metrics_value_or_display_ck',
      sql`${table.value} is not null or ${table.displayValue} is not null`,
    ),
    uniqueIndex('recruitment_metrics_key_uq').on(table.metricKey),
  ],
);

export const dataRevisions = pgTable(
  'data_revisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    revisionKey: varchar('revision_key', { length: 160 }).notNull(),
    title: varchar('title', { length: 240 }).notNull(),
    description: text('description'),
    cohortYear: integer('cohort_year'),
    batchCode: varchar('batch_code', { length: 80 }),
    unitScope: varchar('unit_scope', { length: 200 }),
    sourceDocumentId: uuid('source_document_id').references(() => sourceDocuments.id, {
      onDelete: 'set null',
    }),
    status: publicationStatus('status').notNull().default('draft'),
    dataStatus: varchar('data_status', { length: 80 }).notNull().default('pending'),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdByAdminId: uuid('created_by_admin_id').references(() => admins.id, {
      onDelete: 'set null',
    }),
    ...auditTimestamps,
  },
  (table) => [uniqueIndex('data_revisions_key_uq').on(table.revisionKey)],
);

export const earlyBatchPolicies = pgTable(
  'early_batch_policies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    policyKey: varchar('policy_key', { length: 200 }).notNull(),
    cohortYear: integer('cohort_year').notNull(),
    batchCode: varchar('batch_code', { length: 80 }).notNull().default('campus'),
    targetKind: varchar('target_kind', { length: 40 }).notNull(),
    targetCode: varchar('target_code', { length: 120 }).notNull(),
    targetName: varchar('target_name', { length: 120 }).notNull(),
    provinceId: uuid('province_id').references(() => provinces.id, { onDelete: 'set null' }),
    parentProvinceId: uuid('parent_province_id').references(() => provinces.id, { onDelete: 'set null' }),
    recruitmentRequirements: text('recruitment_requirements').notNull(),
    recruitmentProcess: text('recruitment_process'),
    plannedHeadcountDisplay: varchar('planned_headcount_display', { length: 120 }),
    assessmentMethod: text('assessment_method'),
    itineraryReference: text('itinerary_reference'),
    siteQuotaDisplay: text('site_quota_display'),
    admissionRule: text('admission_rule'),
    actualHeadcountDisplay: varchar('actual_headcount_display', { length: 120 }),
    otherNotes: text('other_notes'),
    missingFields: jsonb('missing_fields').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    eligibilityModel: jsonb('eligibility_model').$type<Record<string, unknown>>().notNull(),
    sourceLocator: varchar('source_locator', { length: 120 }).notNull(),
    evidenceAssets: jsonb('evidence_assets').$type<Record<string, unknown>[]>().notNull().default(sql`'[]'::jsonb`),
    externalEvidence: jsonb('external_evidence').$type<Record<string, unknown>[]>().notNull().default(sql`'[]'::jsonb`),
    sourceStatus: varchar('source_status', { length: 100 }).notNull(),
    sourceDocumentId: uuid('source_document_id')
      .notNull()
      .references(() => sourceDocuments.id, { onDelete: 'restrict' }),
    revisionId: uuid('revision_id')
      .notNull()
      .references(() => dataRevisions.id, { onDelete: 'restrict' }),
    status: varchar('status', { length: 80 }).notNull().default('active'),
    publicationStatus: publicationStatus('publication_status').notNull().default('draft'),
    sortOrder: integer('sort_order').notNull().default(0),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    ...auditTimestamps,
  },
  (table) => [
    uniqueIndex('early_batch_policies_key_uq').on(table.policyKey),
    uniqueIndex('early_batch_policies_target_revision_uq').on(
      table.cohortYear,
      table.targetCode,
      table.revisionId,
    ),
    index('early_batch_policies_year_publication_idx').on(
      table.cohortYear,
      table.publicationStatus,
    ),
    index('early_batch_policies_parent_province_idx').on(table.parentProvinceId),
  ],
);

export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorType: varchar('actor_type', { length: 32 }).notNull(),
    actorId: uuid('actor_id'),
    action: varchar('action', { length: 120 }).notNull(),
    resourceType: varchar('resource_type', { length: 100 }),
    resourceId: varchar('resource_id', { length: 100 }),
    outcome: auditOutcome('outcome').notNull(),
    requestId: varchar('request_id', { length: 100 }),
    ipHash: varchar('ip_hash', { length: 64 }),
    userAgentHash: varchar('user_agent_hash', { length: 64 }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('audit_events_created_idx').on(table.createdAt),
    index('audit_events_actor_idx').on(table.actorType, table.actorId),
    index('audit_events_resource_idx').on(table.resourceType, table.resourceId),
  ],
);

export const resourceTables = {
  provinces,
  cities,
  schools,
  companies,
  'recruitment-batches': recruitmentBatches,
  'recruitment-events': recruitmentEvents,
  'recruitment-requirements': recruitmentRequirements,
  'recruitment-metrics': recruitmentMetrics,
  sources: sourceDocuments,
  'source-documents': sourceDocuments,
  revisions: dataRevisions,
  'data-revisions': dataRevisions,
  'early-batch-policies': earlyBatchPolicies,
} as const;

export type ResourceName = keyof typeof resourceTables;
