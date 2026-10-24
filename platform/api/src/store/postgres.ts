import { and, asc, count, desc, eq, getTableColumns, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { Database } from '../db/client.js';
import { gridDatasetVersions, gridQuerySources, gridPolicyFacts, gridSchoolOutcomes } from '../db/grid-query-schema.js';
import { gridMapCatalogs } from '../db/grid-map-schema.js';
import { normalizeGridMapCatalog, type GridMapCatalog } from '../lib/grid-map-catalog.js';
import { gridReleasedCells } from '../lib/grid-query.js';
import type { GridDataset, GridSnapshot } from '../lib/grid-query.js';
import {
  admins,
  adminSessions,
  auditEvents,
  cities,
  companies,
  dataRevisions,
  earlyBatchPolicies,
  provinces,
  recruitmentBatches,
  recruitmentEvents,
  recruitmentMetrics,
  recruitmentRequirements,
  resourceTables,
  schools,
  sourceDocuments,
  users,
  userSessions,
  type ResourceName,
} from '../db/schema.js';
import { canonicalResourceName } from '../resources.js';
import { ApiError } from '../lib/http.js';
import { buildProvinceRecruitmentProfile } from '../lib/province-recruitment-profile.js';
import { PRIVATE_SOURCE_PREFIX, containsPrivateSourceReference, privateSourceIndex, publicSourceRows, sourceReferenceValues, type PrivateSourceIndex } from '../lib/private-source-boundary.js';
import {
  enrichAdministrativeRows,
  enrichMetricRows,
  enrichSchoolRows,
  overlayPrivateDashboard,
  overlayPublicDashboard,
} from '../lib/dashboard-overlay.js';
import type {
  AdminRecord,
  AdminSessionRecord,
  AuditInput,
  DataStore,
  EarlyBatchPolicyRecord,
  EarlyBatchSchoolRecord,
  ResourceListInput,
  SessionInput,
  UserCreateInput,
  UserListInput,
  UserRecord,
  UserSessionRecord,
} from './types.js';

type DynamicTable = PgTable & {
  id: AnyPgColumn;
  updatedAt?: AnyPgColumn;
  createdByAdminId?: AnyPgColumn;
  name?: AnyPgColumn;
  title?: AnyPgColumn;
  code?: AnyPgColumn;
  schoolKey?: AnyPgColumn;
  companyKey?: AnyPgColumn;
  sourceKey?: AnyPgColumn;
  revisionKey?: AnyPgColumn;
  cohortYear?: AnyPgColumn;
  batchCode?: AnyPgColumn;
  status?: AnyPgColumn;
  publicationStatus?: AnyPgColumn;
  dataStatus?: AnyPgColumn;
  provinceId?: AnyPgColumn;
  cityId?: AnyPgColumn;
  companyId?: AnyPgColumn;
  schoolId?: AnyPgColumn;
  eventType?: AnyPgColumn;
  category?: AnyPgColumn;
  destinationScope?: AnyPgColumn;
  disciplineGroup?: AnyPgColumn;
  disciplineEvidenceStatus?: AnyPgColumn;
  majorCategory?: AnyPgColumn;
  majorEvidenceStatus?: AnyPgColumn;
  startsOn?: AnyPgColumn;
  startsAt?: AnyPgColumn;
  endsOn?: AnyPgColumn;
  endsAt?: AnyPgColumn;
  evidenceLocator?: AnyPgColumn;
  sortOrder?: AnyPgColumn;
};

const { contentText: _sourceBody, ...sourceListColumns } = getTableColumns(sourceDocuments);

const resourceSearchFields: Record<string, string[]> = {
  provinces: ['name', 'shortName', 'adcode'],
  cities: ['name', 'adcode'],
  schools: ['name', 'schoolKey'],
  companies: ['name', 'companyKey'],
  'recruitment-batches': ['name', 'code', 'unitScope'],
  'recruitment-events': ['title', 'eventType', 'unitScope'],
  'recruitment-requirements': ['title', 'category', 'unitScope', 'excerpt'],
  'recruitment-metrics': ['metricType', 'unitScope', 'batchCode'],
  sources: ['title', 'sourceKey', 'publisher', 'contentText'],
  revisions: ['title', 'revisionKey'],
  'early-batch-policies': ['targetName', 'targetCode', 'policyKey', 'recruitmentRequirements'],
};

// List enrichment and province profiles only display source summaries. Keep
// full text on the dedicated source list/detail paths instead of loading every
// archived announcement for each unrelated resource request.
const sourceSummaryColumns = {
  id: sourceDocuments.id,
  sourceKey: sourceDocuments.sourceKey,
  title: sourceDocuments.title,
  sourceType: sourceDocuments.sourceType,
  publisher: sourceDocuments.publisher,
  officialUrl: sourceDocuments.officialUrl,
  publishedAt: sourceDocuments.publishedAt,
  accessedAt: sourceDocuments.accessedAt,
  status: sourceDocuments.status,
  notes: sourceDocuments.notes,
  metadata: sourceDocuments.metadata,
};

// A search term is a literal, not a pattern. Without escaping, a query of "%"
// matched every published row (and "_" matched any single character), which
// both leaked full listings through the search box and made the in-memory
// store — which matches literally — disagree with production.
function likeContains(value: string): string {
  return `%${value.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

function normalizeResourceInput(input: Record<string, unknown>): Record<string, unknown> {
  const normalized = { ...input };
  for (const [key, value] of Object.entries(normalized)) {
    if (key.endsWith('At') && typeof value === 'string') normalized[key] = new Date(value);
  }
  return normalized;
}

function tableFor(resource: ResourceName): DynamicTable {
  const canonical = canonicalResourceName(resource);
  return resourceTables[canonical] as unknown as DynamicTable;
}

function cleanUndefined<T extends Record<string, unknown>>(input: T): T {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as T;
}

export class PostgresStore implements DataStore {
  private gridMapCatalogCache: {signature:string;catalogs:GridMapCatalog[]} | null = null;
  async gridMapCatalogSnapshot():Promise<GridMapCatalog[]> {
    const rows=await this.db.select({id:gridMapCatalogs.id,checksum:gridMapCatalogs.checksumSha256}).from(gridMapCatalogs)
      .innerJoin(gridDatasetVersions,eq(gridDatasetVersions.id,gridMapCatalogs.datasetVersionId))
      .where(and(eq(gridMapCatalogs.active,true),eq(gridDatasetVersions.active,true))).orderBy(asc(gridMapCatalogs.id));
    const signature=rows.map(row=>`${row.id}:${row.checksum}`).join('|');
    if(this.gridMapCatalogCache?.signature===signature)return this.gridMapCatalogCache.catalogs;
    const catalogs=rows.length?(await this.db.select({payload:gridMapCatalogs.payload}).from(gridMapCatalogs).where(inArray(gridMapCatalogs.id,rows.map(row=>row.id)))).map(row=>normalizeGridMapCatalog(row.payload)):[];
    this.gridMapCatalogCache={signature,catalogs};return catalogs;
  }
  private gridSnapshotCache: { signature:string; snapshot:GridSnapshot } | null = null;
  private gridSnapshotFlight: { signature:string; promise:Promise<GridSnapshot> } | null = null;
  async gridQuerySnapshot(): Promise<GridSnapshot> {
    const versions=await this.db.select().from(gridDatasetVersions).where(eq(gridDatasetVersions.active,true)).orderBy(asc(gridDatasetVersions.datasetKey));
    const signature=versions.map(v=>`${v.id}:${v.checksumSha256}`).join('|');
    if(this.gridSnapshotCache?.signature===signature)return this.gridSnapshotCache.snapshot;
    if(this.gridSnapshotFlight?.signature===signature)return this.gridSnapshotFlight.promise;
    const promise=(async()=>{
    const ids=versions.map(v=>v.id);
    const [sources,facts,outcomes]=ids.length?await Promise.all([
      this.db.select().from(gridQuerySources).where(inArray(gridQuerySources.versionId,ids)),
      this.db.select().from(gridPolicyFacts).where(inArray(gridPolicyFacts.versionId,ids)),
      this.db.select().from(gridSchoolOutcomes).where(inArray(gridSchoolOutcomes.versionId,ids)),
    ]):[[],[],[]];
    const datasets:GridDataset[]=versions.map(v=>({schemaVersion:'grid-query-1',datasetKey:v.datasetKey,version:v.version,title:v.title,createdAt:v.createdAt.toISOString(),notes:v.notes,
      sources:sources.filter(r=>r.versionId===v.id).map(r=>r.payload),policyFacts:facts.filter(r=>r.versionId===v.id).map(r=>r.payload),schoolOutcomes:outcomes.filter(r=>r.versionId===v.id).map(r=>r.payload)}));
    const snapshot:GridSnapshot={datasets,versions:versions.map(({id:_id,active:_active,importedAt:_importedAt,...v})=>({...v,createdAt:v.createdAt.toISOString()}))};
    this.gridSnapshotCache={signature,snapshot};
    return snapshot;
    })();
    this.gridSnapshotFlight={signature,promise};
    try{return await promise;}finally{if(this.gridSnapshotFlight?.promise===promise)this.gridSnapshotFlight=null;}
  }
  constructor(private readonly db: Database) {}

  private async sourceSummariesFor(
    rows: Record<string, unknown>[],
    additionalSourceKeys: unknown[] = [],
  ) {
    const nonemptyStrings = (values: unknown[]): string[] =>
      [...new Set(values.filter((value): value is string => typeof value === 'string' && Boolean(value)))];
    const nestedReferences = sourceReferenceValues(rows);
    const ids = nonemptyStrings([
      ...rows.map((row) => row.sourceDocumentId),
      ...nestedReferences.filter(value => /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value)),
    ]);
    const keys = nonemptyStrings([
      ...rows.flatMap((row) => Array.isArray(row.sourceKeys) ? row.sourceKeys : []),
      ...nestedReferences,
      ...additionalSourceKeys,
    ]);
    const references: SQL[] = [];
    if (ids.length) references.push(inArray(sourceDocuments.id, ids));
    if (keys.length) references.push(inArray(sourceDocuments.sourceKey, keys));
    if (!references.length) return [];
    return this.db.select(sourceSummaryColumns).from(sourceDocuments).where(or(...references));
  }

  async health(): Promise<void> {
    await this.db.execute(sql`select 1`);
  }

  async findAdminByUsername(username: string): Promise<AdminRecord | null> {
    const [row] = await this.db.select().from(admins).where(eq(admins.username, username)).limit(1);
    return (row as AdminRecord | undefined) ?? null;
  }

  async findAdminById(id: string): Promise<AdminRecord | null> {
    const [row] = await this.db.select().from(admins).where(eq(admins.id, id)).limit(1);
    return (row as AdminRecord | undefined) ?? null;
  }

  async upsertAdmin(input: {
    username: string;
    displayName: string;
    passwordHash: string;
    role?: string;
  }): Promise<AdminRecord> {
    const [row] = await this.db
      .insert(admins)
      .values({ ...input, role: input.role ?? 'superadmin' })
      .onConflictDoUpdate({
        target: admins.username,
        set: {
          displayName: input.displayName,
          passwordHash: input.passwordHash,
          role: input.role ?? 'superadmin',
          enabled: true,
          updatedAt: new Date(),
        },
      })
      .returning();
    if (!row) throw new Error('ADMIN_UPSERT_FAILED');
    return row as AdminRecord;
  }

  async markAdminLogin(id: string): Promise<void> {
    await this.db.update(admins).set({ lastLoginAt: new Date(), updatedAt: new Date() }).where(eq(admins.id, id));
  }

  async createAdminSession(adminId: string, input: SessionInput): Promise<void> {
    await this.db.insert(adminSessions).values({ adminId, ...input });
  }

  async findAdminSession(tokenHash: string): Promise<AdminSessionRecord | null> {
    const [row] = await this.db
      .select({ session: adminSessions, admin: admins })
      .from(adminSessions)
      .innerJoin(admins, eq(adminSessions.adminId, admins.id))
      .where(eq(adminSessions.tokenHash, tokenHash))
      .limit(1);
    return row ? ({ ...row.session, admin: row.admin } as AdminSessionRecord) : null;
  }

  async revokeAdminSession(tokenHash: string): Promise<void> {
    await this.db
      .update(adminSessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(adminSessions.tokenHash, tokenHash), isNull(adminSessions.revokedAt)));
  }

  async revokeAllAdminSessions(adminId: string): Promise<void> {
    await this.db
      .update(adminSessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(adminSessions.adminId, adminId), isNull(adminSessions.revokedAt)));
  }

  async findUserByPhoneHash(phoneLookupHash: string): Promise<UserRecord | null> {
    const [row] = await this.db
      .select()
      .from(users)
      .where(and(eq(users.phoneLookupHash, phoneLookupHash), isNull(users.deletedAt)))
      .limit(1);
    return (row as UserRecord | undefined) ?? null;
  }

  async findUserById(id: string): Promise<UserRecord | null> {
    const [row] = await this.db
      .select()
      .from(users)
      .where(and(eq(users.id, id), isNull(users.deletedAt)))
      .limit(1);
    return (row as UserRecord | undefined) ?? null;
  }

  async listUsers(input: UserListInput): Promise<{ items: UserRecord[]; total: number }> {
    const conditions: SQL[] = [isNull(users.deletedAt)];
    if (input.enabled !== undefined) conditions.push(eq(users.enabled, input.enabled));
    if (input.phoneLookupHash) conditions.push(eq(users.phoneLookupHash, input.phoneLookupHash));
    if (input.phoneLast4) conditions.push(eq(users.phoneLast4, input.phoneLast4));
    if (input.displayName) conditions.push(ilike(users.displayName, likeContains(input.displayName)));
    const where = and(...conditions);
    const [items, totalRows] = await Promise.all([
      this.db.select().from(users).where(where).orderBy(desc(users.createdAt)).limit(input.limit).offset(input.offset),
      this.db.select({ value: count() }).from(users).where(where),
    ]);
    return { items: items as UserRecord[], total: Number(totalRows[0]?.value ?? 0) };
  }

  async createUser(input: UserCreateInput): Promise<UserRecord> {
    const [row] = await this.db.insert(users).values(input).returning();
    if (!row) throw new Error('USER_CREATE_FAILED');
    return row as UserRecord;
  }

  async updateUser(
    id: string,
    patch: { enabled?: boolean; displayName?: string | null },
  ): Promise<UserRecord | null> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx.update(users)
        .set({ ...cleanUndefined(patch), updatedAt: new Date() })
        .where(and(eq(users.id, id), isNull(users.deletedAt))).returning();
      // Account changes and session invalidation must commit together. A
      // failed second statement must not leave a changed account and live cookie.
      if (row && patch.enabled === false) await tx.update(userSessions)
        .set({ revokedAt: new Date() })
        .where(and(eq(userSessions.userId, id), isNull(userSessions.revokedAt)));
      return (row as UserRecord | undefined) ?? null;
    });
  }

  async resetUserPassword(id: string, passwordHash: string): Promise<UserRecord | null> {
    return this.db.transaction(async (tx) => {
      const now = new Date();
      const [row] = await tx.update(users)
        .set({ passwordHash, passwordChangedAt: now, updatedAt: now })
        .where(and(eq(users.id, id), isNull(users.deletedAt))).returning();
      if (row) await tx.update(userSessions).set({ revokedAt: now })
        .where(and(eq(userSessions.userId, id), isNull(userSessions.revokedAt)));
      return (row as UserRecord | undefined) ?? null;
    });
  }

  async softDeleteUser(id: string): Promise<UserRecord | null> {
    return this.db.transaction(async (tx) => {
      const now = new Date();
      const [row] = await tx.update(users)
        .set({ enabled: false, deletedAt: now, updatedAt: now })
        .where(and(eq(users.id, id), isNull(users.deletedAt))).returning();
      if (row) await tx.update(userSessions).set({ revokedAt: now })
        .where(and(eq(userSessions.userId, id), isNull(userSessions.revokedAt)));
      return (row as UserRecord | undefined) ?? null;
    });
  }

  async markUserLogin(id: string): Promise<void> {
    await this.db.update(users).set({ lastLoginAt: new Date(), updatedAt: new Date() }).where(eq(users.id, id));
  }

  async createUserSession(userId: string, input: SessionInput, verifiedPasswordHash?: string): Promise<void> {
    if (verifiedPasswordHash === undefined) {
      await this.db.insert(userSessions).values({ userId, ...input });
      return;
    }
    await this.db.transaction(async (tx) => {
      // The password was checked before entering this transaction. Lock the
      // account against concurrent resets/disables and recheck the exact hash
      // so a late login cannot resurrect access after those changes commit.
      const [user] = await tx.select({ enabled: users.enabled, deletedAt: users.deletedAt, passwordHash: users.passwordHash })
        .from(users).where(eq(users.id, userId)).limit(1).for('update');
      if (!user || !user.enabled || user.deletedAt || user.passwordHash !== verifiedPasswordHash) {
        throw new ApiError(401, 'AUTH_STATE_CHANGED', '账户状态已更新，请重新登录');
      }
      await tx.insert(userSessions).values({ userId, ...input });
    });
  }

  async findUserSession(tokenHash: string): Promise<UserSessionRecord | null> {
    const [row] = await this.db
      .select({ session: userSessions, user: users })
      .from(userSessions)
      .innerJoin(users, eq(userSessions.userId, users.id))
      .where(eq(userSessions.tokenHash, tokenHash))
      .limit(1);
    return row ? ({ ...row.session, user: row.user } as UserSessionRecord) : null;
  }

  async revokeUserSession(tokenHash: string): Promise<void> {
    await this.db
      .update(userSessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(userSessions.tokenHash, tokenHash), isNull(userSessions.revokedAt)));
  }

  async revokeAllUserSessions(userId: string): Promise<void> {
    await this.db
      .update(userSessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(userSessions.userId, userId), isNull(userSessions.revokedAt)));
  }

  async listResource(
    resource: ResourceName,
    input: ResourceListInput,
  ): Promise<{ items: Record<string, unknown>[]; total: number }> {
    const canonical = canonicalResourceName(resource);
    const table = tableFor(resource) as any;
    const conditions: SQL[] = [];
    if (
      canonical === 'schools' &&
      (input.cohortYear !== undefined || input.destinationProvinceId || input.destinationCompanyId)
    ) {
      const metricConditions: SQL[] = [
        eq(recruitmentMetrics.publicationStatus, 'published'),
        eq(recruitmentMetrics.metricType, 'public_notice_record_count'),
        eq(recruitmentMetrics.batchCode, 'all'),
        eq(recruitmentMetrics.disciplineGroup, 'all'),
      ];
      if (input.cohortYear !== undefined) {
        metricConditions.push(eq(recruitmentMetrics.cohortYear, input.cohortYear));
      }
      if (input.destinationProvinceId) {
        metricConditions.push(eq(recruitmentMetrics.provinceId, input.destinationProvinceId));
      }
      if (input.destinationCompanyId) {
        metricConditions.push(eq(recruitmentMetrics.companyId, input.destinationCompanyId));
      }
      const matchingSchools = await this.db
        .select({ schoolId: recruitmentMetrics.schoolId })
        .from(recruitmentMetrics)
        .where(and(...metricConditions))
        .groupBy(recruitmentMetrics.schoolId);
      const schoolIds = matchingSchools
        .map((row) => row.schoolId)
        .filter((id): id is string => typeof id === 'string');
      conditions.push(schoolIds.length ? inArray(schools.id, schoolIds) : sql`false`);
    }
    if (input.q) {
      const terms: SQL[] = (resourceSearchFields[canonical] ?? [])
        .map((field) => table[field] as AnyPgColumn | undefined)
        .filter((column): column is AnyPgColumn => Boolean(column))
        .map((column) => ilike(column, likeContains(input.q!)));
      if (canonical === 'recruitment-metrics') {
        const term = likeContains(input.q);
        const [schoolMatches, companyMatches, sourceMatches] = await Promise.all([
          this.db.select({ id: schools.id }).from(schools).where(ilike(schools.name, term)),
          this.db.select({ id: companies.id }).from(companies).where(ilike(companies.name, term)),
          this.db.select({ id: sourceDocuments.id }).from(sourceDocuments).where(ilike(sourceDocuments.title, term)),
        ]);
        if (schoolMatches.length) terms.push(inArray(recruitmentMetrics.schoolId, schoolMatches.map((row) => row.id)));
        if (companyMatches.length) terms.push(inArray(recruitmentMetrics.companyId, companyMatches.map((row) => row.id)));
        if (sourceMatches.length)
          terms.push(inArray(recruitmentMetrics.sourceDocumentId, sourceMatches.map((row) => row.id)));
      }
      if (terms.length) conditions.push(or(...terms) as SQL);
    }
    if (canonical !== 'schools' && input.cohortYear !== undefined && table.cohortYear)
      conditions.push(eq(table.cohortYear, input.cohortYear));
    if (input.batchCode) {
      if (table.batchCode) conditions.push(eq(table.batchCode, input.batchCode));
      else if (canonical === 'recruitment-batches' && table.code)
        conditions.push(eq(table.code, input.batchCode));
    }
    if (input.status && table.status) conditions.push(eq(table.status, input.status));
    if (input.statusPrefix && table.status) conditions.push(ilike(table.status, `${input.statusPrefix}%`));
    if (input.publicationStatus && table.publicationStatus)
      conditions.push(eq(table.publicationStatus, input.publicationStatus));
    if (input.dataStatus && table.dataStatus) conditions.push(eq(table.dataStatus, input.dataStatus));
    if (input.provinceId && table.provinceId) conditions.push(eq(table.provinceId, input.provinceId));
    if (input.cityId && table.cityId) conditions.push(eq(table.cityId, input.cityId));
    if (input.companyId && table.companyId) conditions.push(eq(table.companyId, input.companyId));
    if (input.eventType && table.eventType) conditions.push(eq(table.eventType, input.eventType));
    if (input.category && table.category) {
      conditions.push(
        canonical === 'recruitment-requirements'
          ? (or(
              eq(recruitmentRequirements.category, input.category),
              sql`${recruitmentRequirements.categoryTags} @> ${JSON.stringify([input.category])}::jsonb`,
            ) as SQL)
          : eq(table.category, input.category),
      );
    }
    if (input.destinationScope && table.destinationScope)
      conditions.push(eq(table.destinationScope, input.destinationScope));
    if (input.disciplineGroup && table.disciplineGroup)
      conditions.push(eq(table.disciplineGroup, input.disciplineGroup));
    if (input.disciplineEvidenceStatus && table.disciplineEvidenceStatus)
      conditions.push(eq(table.disciplineEvidenceStatus, input.disciplineEvidenceStatus));
    if (input.majorCategory && table.majorCategory)
      conditions.push(eq(table.majorCategory, input.majorCategory));
    if (input.majorEvidenceStatus && table.majorEvidenceStatus)
      conditions.push(eq(table.majorEvidenceStatus, input.majorEvidenceStatus));
    const where = conditions.length ? and(...conditions) : undefined;
    const provinceBusinessOrder = table.provinceId
      ? sql`coalesce((select ${provinces.sortOrder} from ${provinces} where ${provinces.id} = ${table.provinceId}), 9999)`
      : sql`9999`;
    const provinceNameOrder = table.provinceId
      ? sql`coalesce((select ${provinces.name} from ${provinces} where ${provinces.id} = ${table.provinceId}), '')`
      : sql`''`;
    const companyNameOrder = table.companyId
      ? sql`coalesce((select ${companies.name} from ${companies} where ${companies.id} = ${table.companyId}), '')`
      : sql`''`;
    const cityNameOrder = table.cityId
      ? sql`coalesce((select ${cities.name} from ${cities} where ${cities.id} = ${table.cityId}), '')`
      : sql`''`;
    const schoolNameOrder = table.id && canonical === 'schools'
      ? sql`coalesce(${schools.name}, '')`
      : table.schoolId
        ? sql`coalesce((select ${schools.name} from ${schools} where ${schools.id} = ${table.schoolId}), '')`
        : sql`''`;
    const batchBusinessOrder = table.batchCode
      ? sql`case ${table.batchCode} when 'campus' then 0 when 'batch_1' then 1 when 'batch_2' then 2 when 'batch_3' then 3 when 'all' then 4 else 9 end`
      : sql`9`;
    const orderBy =
      canonical === 'schools'
        ? [provinceBusinessOrder, provinceNameOrder, cityNameOrder, asc(schools.name), asc(schools.id)]
        : canonical === 'companies'
          ? [provinceBusinessOrder, provinceNameOrder, cityNameOrder, asc(companies.name), asc(companies.id)]
          : canonical === 'recruitment-batches'
            ? [
                provinceBusinessOrder,
                provinceNameOrder,
                companyNameOrder,
                batchBusinessOrder,
                asc(recruitmentBatches.sortOrder),
                asc(recruitmentBatches.name),
                asc(recruitmentBatches.id),
              ]
            : canonical === 'recruitment-metrics'
              ? [
                  provinceBusinessOrder,
                  provinceNameOrder,
                  companyNameOrder,
                  batchBusinessOrder,
                  schoolNameOrder,
                  asc(recruitmentMetrics.metricType),
                  asc(recruitmentMetrics.disciplineGroup),
                  asc(recruitmentMetrics.id),
                ]
              : canonical === 'recruitment-events'
        ? [
            provinceBusinessOrder,
            provinceNameOrder,
            companyNameOrder,
            batchBusinessOrder,
            sql`coalesce(${table.startsOn}, (${table.startsAt} at time zone 'Asia/Shanghai')::date, ${table.endsOn}, (${table.endsAt} at time zone 'Asia/Shanghai')::date) asc nulls last`,
            sql`case ${table.eventType}
              when 'campus_presentation' then 0
              when 'campus_recruitment_period' then 1
              when 'recruitment_activity' then 1
              when 'application_start' then 2
              when 'application' then 3
              when 'application_deadline' then 4
              when 'application_end' then 4
              when 'qualification_review' then 5
              when 'qualification' then 5
              when 'onsite_qualification_review' then 5
              when 'exam_notification' then 6
              when 'exam_notice_confirmation' then 6
              when 'written_exam' then 7
              when 'assessment' then 8
              when 'physical_test' then 9
              when 'interview' then 10
              when 'medical_or_onboarding_check' then 11
              when 'signing_or_confirmation' then 12
              when 'public_notice' then 13
              when 'announcement' then 13
              when 'public_notice_end' then 13
              when 'onboarding' then 14
              else 99 end`,
            asc(table.id),
          ]
        : canonical === 'recruitment-requirements'
          ? [
              provinceBusinessOrder,
              provinceNameOrder,
              companyNameOrder,
              batchBusinessOrder,
              sql`case ${table.category}
                when 'application_materials' then 0
                when 'major' then 1
                when 'education' then 2
                when 'academic_verification' then 3
                when 'health' then 4
                when 'age' then 5
                when 'cohort' then 6
                when 'language_and_computer' then 7
                when 'overseas_education' then 8
                when 'special_obligation' then 9
                when 'integrity' then 10
                when 'training_mode' then 11
                else 99 end`,
              sql`${table.evidenceLocator} asc nulls last`,
              asc(table.id),
            ]
              : canonical === 'cities'
                ? [provinceBusinessOrder, provinceNameOrder, asc(table.sortOrder!), asc(table.name!), asc(table.id)]
                : [desc(table.updatedAt ?? table.id)];
    const selection = canonical === 'sources' ? this.db.select(sourceListColumns).from(table) : this.db.select().from(table);
    const [items, totals] = await Promise.all([
      selection.where(where).orderBy(...orderBy).limit(input.limit).offset(input.offset),
      this.db.select({ value: count() }).from(table).where(where),
    ]);
    let enrichedItems = items as Record<string, unknown>[];
    if (canonical === 'schools') {
      const [metricRows, provinceRows, cityRows, companyRows] = await Promise.all([
        this.db
          .select()
          .from(recruitmentMetrics)
          .where(eq(recruitmentMetrics.publicationStatus, 'published')),
        this.db.select().from(provinces),
        this.db.select().from(cities),
        this.db.select().from(companies),
      ]);
      enrichedItems = enrichSchoolRows(
        enrichedItems,
        metricRows as Record<string, unknown>[],
        {
          provinces: provinceRows as Record<string, unknown>[],
          cities: cityRows as Record<string, unknown>[],
          companies: companyRows as Record<string, unknown>[],
        },
        {
          ...(input.cohortYear !== undefined ? { cohortYear: input.cohortYear } : {}),
          ...(input.destinationProvinceId
            ? { destinationProvinceId: input.destinationProvinceId }
            : {}),
          ...(input.destinationCompanyId
            ? { destinationCompanyId: input.destinationCompanyId }
            : {}),
        },
      );
    } else if (canonical === 'recruitment-metrics') {
      const [schoolRows, companyRows, provinceRows, cityRows, batchRows, sourceRows] = await Promise.all([
        this.db.select().from(schools),
        this.db.select().from(companies),
        this.db.select().from(provinces),
        this.db.select().from(cities),
        this.db.select().from(recruitmentBatches),
        this.sourceSummariesFor(enrichedItems),
      ]);
      enrichedItems = enrichMetricRows(enrichedItems, {
        schools: schoolRows as Record<string, unknown>[],
        companies: companyRows as Record<string, unknown>[],
        provinces: provinceRows as Record<string, unknown>[],
        cities: cityRows as Record<string, unknown>[],
        batches: batchRows as Record<string, unknown>[],
        sources: sourceRows as Record<string, unknown>[],
      });
    } else if (
      ['cities', 'companies', 'recruitment-batches', 'recruitment-events', 'recruitment-requirements'].includes(
        canonical,
      )
    ) {
      const [companyRows, provinceRows, cityRows, batchRows, sourceRows] = await Promise.all([
        this.db.select().from(companies),
        this.db.select().from(provinces),
        this.db.select().from(cities),
        this.db.select().from(recruitmentBatches),
        this.sourceSummariesFor(enrichedItems),
      ]);
      enrichedItems = enrichAdministrativeRows(enrichedItems, {
        companies: companyRows as Record<string, unknown>[],
        provinces: provinceRows as Record<string, unknown>[],
        cities: cityRows as Record<string, unknown>[],
        batches: batchRows as Record<string, unknown>[],
        sources: sourceRows as Record<string, unknown>[],
      });
    }
    return { items: enrichedItems, total: Number(totals[0]?.value ?? 0) };
  }

  async getResource(resource: ResourceName, id: string): Promise<Record<string, unknown> | null> {
    const table = tableFor(resource) as any;
    const [row] = await this.db.select().from(table).where(eq(table.id, id)).limit(1);
    return (row as Record<string, unknown> | undefined) ?? null;
  }

  async findSourceByKey(sourceKey: string): Promise<Record<string, unknown> | null> {
    const [row] = await this.db
      .select()
      .from(sourceDocuments)
      .where(eq(sourceDocuments.sourceKey, sourceKey))
      .limit(1);
    return (row as Record<string, unknown> | undefined) ?? null;
  }

  async adminOnlySources(): Promise<Record<string, unknown>[]> {
    return this.db.select({
      id: sourceDocuments.id,
      sourceKey: sourceDocuments.sourceKey,
      metadata: sql<Record<string, unknown>>`jsonb_build_object('visibility', 'admin_only')`,
    }).from(sourceDocuments).where(or(
      sql`${sourceDocuments.sourceKey} like ${PRIVATE_SOURCE_PREFIX + '%'}`,
      sql`${sourceDocuments.metadata}->>'visibility' = 'admin_only'`,
    ));
  }

  async createResource(
    resource: ResourceName,
    input: Record<string, unknown>,
    adminId: string,
  ): Promise<Record<string, unknown>> {
    const table = tableFor(resource) as any;
    const values = normalizeResourceInput(input);
    if (canonicalResourceName(resource) === 'revisions') values.createdByAdminId = adminId;
    const rows = (await this.db
      .insert(table)
      .values(values as any)
      .returning()) as unknown as Record<string, unknown>[];
    const row = rows[0];
    if (!row) throw new Error('RESOURCE_CREATE_FAILED');
    return row as Record<string, unknown>;
  }

  async updateResource(
    resource: ResourceName,
    id: string,
    patch: Record<string, unknown>,
  ): Promise<Record<string, unknown> | null> {
    const table = tableFor(resource) as any;
    const values = normalizeResourceInput(patch);
    values.updatedAt = new Date();
    const rows = (await this.db
      .update(table)
      .set(values as any)
      .where(eq(table.id, id))
      .returning()) as unknown as Record<string, unknown>[];
    const row = rows[0];
    return (row as Record<string, unknown> | undefined) ?? null;
  }

  async deleteResource(resource: ResourceName, id: string): Promise<boolean> {
    const table = tableFor(resource) as any;
    const rows = (await this.db
      .delete(table)
      .where(eq(table.id, id))
      .returning({ id: table.id })) as unknown as Array<{ id: string }>;
    return rows.length > 0;
  }

  private async hydrateEarlyBatchPolicies(
    policyRows: Array<typeof earlyBatchPolicies.$inferSelect>,
  ): Promise<EarlyBatchPolicyRecord[]> {
    const privateIndex = privateSourceIndex(await this.adminOnlySources());
    policyRows = publicSourceRows(policyRows, privateIndex);
    if (!policyRows.length) return [];
    const provinceIds = [
      ...new Set(
        policyRows
          .flatMap((row) => [row.provinceId, row.parentProvinceId])
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const sourceIds = [...new Set(policyRows.map((row) => row.sourceDocumentId))];
    const revisionIds = [...new Set(policyRows.map((row) => row.revisionId))];
    const [provinceRows, sourceRows, revisionRows] = await Promise.all([
      provinceIds.length
        ? this.db.select().from(provinces).where(inArray(provinces.id, provinceIds))
        : Promise.resolve([]),
      this.db.select().from(sourceDocuments).where(inArray(sourceDocuments.id, sourceIds)),
      this.db.select().from(dataRevisions).where(inArray(dataRevisions.id, revisionIds)),
    ]);
    const provinceById = new Map(provinceRows.map((row) => [row.id, row]));
    const sourceById = new Map(sourceRows.map((row) => [row.id, row]));
    const revisionById = new Map(revisionRows.map((row) => [row.id, row]));
    return policyRows.filter(row => !containsPrivateSourceReference(revisionById.get(row.revisionId), privateIndex)).map((row) => {
      const source = sourceById.get(row.sourceDocumentId);
      const revision = revisionById.get(row.revisionId);
      return {
        ...row,
        targetKind: row.targetKind as 'province' | 'unit',
        provinceAdcode: row.provinceId
          ? (provinceById.get(row.provinceId)?.adcode ?? null)
          : null,
        parentProvinceAdcode: row.parentProvinceId
          ? (provinceById.get(row.parentProvinceId)?.adcode ?? null)
          : null,
        sourceDocumentTitle: source?.title ?? '',
        sourceDocumentKey: source?.sourceKey ?? '',
        sourceDocumentOfficialUrl: source?.officialUrl ?? null,
        revisionKey: revision?.revisionKey ?? '',
        revisionDataStatus: revision?.dataStatus ?? row.sourceStatus,
      };
    });
  }

  async listEarlyBatchPolicies(year: number): Promise<EarlyBatchPolicyRecord[]> {
    const rows = await this.db
      .select()
      .from(earlyBatchPolicies)
      .where(
        and(
          eq(earlyBatchPolicies.cohortYear, year),
          eq(earlyBatchPolicies.publicationStatus, 'published'),
          eq(earlyBatchPolicies.status, 'active'),
        ),
      )
      .orderBy(asc(earlyBatchPolicies.sortOrder), asc(earlyBatchPolicies.targetName));
    return this.hydrateEarlyBatchPolicies(rows);
  }

  async findEarlyBatchPolicy(
    targetCode: string,
    year: number,
  ): Promise<EarlyBatchPolicyRecord | null> {
    const rows = await this.db
      .select()
      .from(earlyBatchPolicies)
      .where(
        and(
          eq(earlyBatchPolicies.targetCode, targetCode),
          eq(earlyBatchPolicies.cohortYear, year),
          eq(earlyBatchPolicies.publicationStatus, 'published'),
          eq(earlyBatchPolicies.status, 'active'),
        ),
      )
      .limit(1);
    return (await this.hydrateEarlyBatchPolicies(rows))[0] ?? null;
  }

  private async earlyBatchSchoolRows(
    rows: Array<typeof schools.$inferSelect>,
  ): Promise<EarlyBatchSchoolRecord[]> {
    rows = publicSourceRows(rows, privateSourceIndex(await this.adminOnlySources()));
    const provinceIds = [
      ...new Set(rows.map((row) => row.provinceId).filter((id): id is string => Boolean(id))),
    ];
    const provinceRows = provinceIds.length
      ? await this.db.select().from(provinces).where(inArray(provinces.id, provinceIds))
      : [];
    const provinceById = new Map(provinceRows.map((row) => [row.id, row.adcode]));
    return rows.map((row) => ({
      id: row.id,
      schoolKey: row.schoolKey,
      name: row.name,
      provinceId: row.provinceId,
      provinceAdcode: row.provinceId ? (provinceById.get(row.provinceId) ?? null) : null,
      nature: row.nature,
      educationLevel: row.educationLevel,
      status: row.status,
      publicationStatus: row.publicationStatus,
      metadata: row.metadata,
    }));
  }

  async findEarlyBatchSchool(schoolKey: string): Promise<EarlyBatchSchoolRecord | null> {
    const rows = await this.db
      .select()
      .from(schools)
      .where(and(eq(schools.schoolKey, schoolKey), eq(schools.publicationStatus, 'published')))
      .limit(1);
    return (await this.earlyBatchSchoolRows(rows))[0] ?? null;
  }

  async searchEarlyBatchSchools(query: string, limit: number): Promise<EarlyBatchSchoolRecord[]> {
    // trim() to match the in-memory store, which normalises before comparing.
    const trimmed = query.trim();
    const term = likeContains(trimmed);
    const rows = await this.db
      .select()
      .from(schools)
      .where(
        and(
          eq(schools.publicationStatus, 'published'),
          or(ilike(schools.name, term), ilike(schools.schoolKey, term)),
        ),
      )
      .orderBy(
        sql`case when lower(${schools.name}) = lower(${trimmed}) then 0 else 1 end`,
        asc(schools.name),
      )
      .limit(limit);
    return this.earlyBatchSchoolRows(rows);
  }

  async listAudit(input: {
    limit: number;
    offset: number;
    actorType?: string;
    action?: string;
  }): Promise<{ items: Record<string, unknown>[]; total: number }> {
    const conditions: SQL[] = [];
    if (input.actorType) conditions.push(eq(auditEvents.actorType, input.actorType));
    if (input.action) conditions.push(ilike(auditEvents.action, `%${input.action}%`));
    const where = conditions.length ? and(...conditions) : undefined;
    const [items, totals] = await Promise.all([
      this.db.select().from(auditEvents).where(where).orderBy(desc(auditEvents.createdAt)).limit(input.limit).offset(input.offset),
      this.db.select({ value: count() }).from(auditEvents).where(where),
    ]);
    return { items, total: Number(totals[0]?.value ?? 0) };
  }

  async audit(input: AuditInput): Promise<void> {
    await this.db.insert(auditEvents).values({
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      action: input.action,
      resourceType: input.resourceType ?? null,
      resourceId: input.resourceId ?? null,
      outcome: input.outcome,
      requestId: input.requestId ?? null,
      ipHash: input.ipHash ?? null,
      userAgentHash: input.userAgentHash ?? null,
      metadata: input.metadata ?? {},
    });
  }

  private async publishedSnapshot(revisionKey: string, privateIndex: PrivateSourceIndex): Promise<Record<string, unknown> | null> {
    const [row] = await this.db
      .select({ payload: dataRevisions.payload, sourceDocumentId: dataRevisions.sourceDocumentId, metadata: dataRevisions.metadata })
      .from(dataRevisions)
      .where(and(eq(dataRevisions.revisionKey, revisionKey), eq(dataRevisions.status, 'published')))
      .limit(1);
    // An old snapshot may contain derived totals. Drop it whole if private
    // provenance is present rather than removing a row but keeping its totals.
    return row && !containsPrivateSourceReference(row, privateIndex) ? row.payload : null;
  }

  // `region_unmapped_public_notice_records` calls itself a derived_aggregate but
  // was published as a frozen literal, so it drifted from the roster it claims to
  // summarise: it read 3745 while the State Grid rows with no destination province
  // total 2446. The sibling figures in that block are State Grid scoped, so this
  // one is too. Derive it from the same roster the rest of the public tier reads
  // instead of restating a number nothing can recompute.
  private async derivedRegionUnmapped(cohortYear: number): Promise<number> {
    const cells = gridReleasedCells(await this.gridQuerySnapshot(), true);
    return cells
      .filter((row) => row.cohortYear === cohortYear && row.grid === 'sgcc' && !(row.province ?? '').trim())
      .reduce((total, row) => total + row.recordCount, 0);
  }

  private async withDerivedNationalOverview(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const overview = payload.national_overview as Record<string, unknown> | undefined;
    const metric = overview?.region_unmapped_public_notice_records as Record<string, unknown> | undefined;
    if (!overview || !metric || typeof metric.value !== 'number') return payload;
    const sync = payload.data_sync as { cohort_year?: unknown } | undefined;
    const cohortYear = typeof sync?.cohort_year === 'number' ? sync.cohort_year : 2026;
    const value = await this.derivedRegionUnmapped(cohortYear);
    if (value === metric.value) return payload;
    return {
      ...payload,
      national_overview: { ...overview, region_unmapped_public_notice_records: { ...metric, value } },
    };
  }

  async publicDashboard(): Promise<Record<string, unknown>> {
    const privateIndex = privateSourceIndex(await this.adminOnlySources());
    const snapshot = await this.publishedSnapshot('public-dashboard', privateIndex);
    if (snapshot) {
      const [hubei] = await this.db.select().from(provinces).where(eq(provinces.adcode, '420000')).limit(1);
      if (hubei) {
        let [schoolRows, metricRows, batchRows] = await Promise.all([
          this.db.select().from(schools).where(eq(schools.publicationStatus, 'published')),
          this.db
            .select()
            .from(recruitmentMetrics)
            .where(
              and(
                or(
                  eq(recruitmentMetrics.provinceId, hubei.id),
                  sql`${recruitmentMetrics.metadata}->'source_ids' @> '["public-selection-aggregate-2026"]'::jsonb`,
                ),
                eq(recruitmentMetrics.publicationStatus, 'published'),
              ),
            ),
          this.db
            .select()
            .from(recruitmentBatches)
            .where(
              and(
                or(
                  eq(recruitmentBatches.provinceId, hubei.id),
                  sql`${recruitmentBatches.metadata}->>'province_id' = 'PROV-CN-420000'`,
                ),
                eq(recruitmentBatches.publicationStatus, 'published'),
              ),
            ),
        ]);
        schoolRows = publicSourceRows(schoolRows, privateIndex);
        metricRows = publicSourceRows(metricRows, privateIndex);
        batchRows = publicSourceRows(batchRows, privateIndex);
        if (
          metricRows.some(
            (row) =>
              row.metricType === 'public_notice_record_count' &&
              row.aggregationGrain === 'cohort_school' &&
              row.batchCode === 'all',
          )
        ) {
          return this.withDerivedNationalOverview(overlayPublicDashboard(snapshot, {
            schools: schoolRows as Record<string, unknown>[],
            metrics: metricRows as Record<string, unknown>[],
            batches: batchRows as Record<string, unknown>[],
          }));
        }
      }
      return this.withDerivedNationalOverview(snapshot);
    }

    const [provinceRows, schoolTotal, companyTotal, batchRows, sourceTotal] = await Promise.all([
      this.db.select().from(provinces).where(eq(provinces.enabled, true)).orderBy(asc(provinces.sortOrder), asc(provinces.adcode)),
      this.db.select({ value: count() }).from(schools).where(eq(schools.publicationStatus, 'published')),
      this.db.select({ value: count() }).from(companies).where(eq(companies.publicationStatus, 'published')),
      this.db.select().from(recruitmentBatches).where(eq(recruitmentBatches.publicationStatus, 'published')).orderBy(desc(recruitmentBatches.cohortYear), asc(recruitmentBatches.sortOrder)),
      this.db.select({ value: count() }).from(sourceDocuments).where(sql`not (${sourceDocuments.sourceKey} like ${PRIVATE_SOURCE_PREFIX + '%'}) and coalesce(${sourceDocuments.metadata}->>'visibility', '') <> 'admin_only'`),
    ]);
    return {
      schema_version: '2.0.0',
      dataset_id: 'state-grid-recruitment-dashboard-relational-fallback',
      generated_at: new Date().toISOString(),
      data_status: 'fallback_relational',
      summary: {
        province_count: provinceRows.length,
        school_count: Number(schoolTotal[0]?.value ?? 0),
        company_count: Number(companyTotal[0]?.value ?? 0),
        source_count: Number(sourceTotal[0]?.value ?? 0),
      },
      provinces: provinceRows,
      recruitment_batches: publicSourceRows(batchRows, privateIndex),
    };
  }

  async provinceDashboard(
    adcode: string,
    filters: { cohortYear?: number; batchCode?: string },
  ): Promise<Record<string, unknown> | null> {
    const privateIndex = privateSourceIndex(await this.adminOnlySources());
    const snapshot = await this.publishedSnapshot(`province-${adcode}-dashboard`, privateIndex);
    const [province] = await this.db.select().from(provinces).where(eq(provinces.adcode, adcode)).limit(1);
    if (!province) return snapshot;
    const metricConditions: SQL[] = [
      or(
        eq(recruitmentMetrics.provinceId, province.id),
        sql`${recruitmentMetrics.metadata}->>'province_id' = ${String(province.provinceKey ?? '')}`,
        ...(adcode === '420000'
          ? [sql`${recruitmentMetrics.metadata}->'source_ids' @> '["public-selection-aggregate-2026"]'::jsonb`]
          : []),
      ) as SQL,
      eq(recruitmentMetrics.publicationStatus, 'published'),
    ];
    const eventConditions: SQL[] = [
      eq(recruitmentEvents.provinceId, province.id),
      eq(recruitmentEvents.publicationStatus, 'published'),
    ];
    if (filters.cohortYear !== undefined) {
      metricConditions.push(eq(recruitmentMetrics.cohortYear, filters.cohortYear));
      eventConditions.push(eq(recruitmentEvents.cohortYear, filters.cohortYear));
    }
    if (filters.batchCode) {
      metricConditions.push(eq(recruitmentMetrics.batchCode, filters.batchCode));
      eventConditions.push(eq(recruitmentEvents.batchCode, filters.batchCode));
    }
    let [cityRows, schoolRows, companyRows, metricRows, eventRows, batchRows] = await Promise.all([
      this.db.select().from(cities).where(eq(cities.provinceId, province.id)).orderBy(asc(cities.sortOrder), asc(cities.adcode)),
      this.db.select().from(schools).where(eq(schools.publicationStatus, 'published')).orderBy(asc(schools.name)),
      this.db.select().from(companies).where(and(eq(companies.provinceId, province.id), eq(companies.publicationStatus, 'published'))).orderBy(asc(companies.name)),
      this.db.select().from(recruitmentMetrics).where(and(...metricConditions)).orderBy(desc(recruitmentMetrics.cohortYear)),
      this.db.select().from(recruitmentEvents).where(and(...eventConditions)).orderBy(desc(recruitmentEvents.cohortYear), asc(recruitmentEvents.startsAt)),
      this.db
        .select()
        .from(recruitmentBatches)
        .where(
          and(
            or(
              eq(recruitmentBatches.provinceId, province.id),
              sql`${recruitmentBatches.metadata}->>'province_id' = ${String(province.provinceKey ?? '')}`,
            ),
            eq(recruitmentBatches.publicationStatus, 'published'),
          ),
        )
        .orderBy(desc(recruitmentBatches.cohortYear), asc(recruitmentBatches.sortOrder)),
    ]);
    cityRows = publicSourceRows(cityRows, privateIndex);
    schoolRows = publicSourceRows(schoolRows, privateIndex);
    companyRows = publicSourceRows(companyRows, privateIndex);
    metricRows = publicSourceRows(metricRows, privateIndex);
    eventRows = publicSourceRows(eventRows, privateIndex);
    batchRows = publicSourceRows(batchRows, privateIndex);
    if (snapshot && filters.cohortYear === undefined && !filters.batchCode) {
      if (
        metricRows.some(
          (row) =>
            row.metricType === 'public_notice_record_count' &&
            row.aggregationGrain === 'cohort_school' &&
            row.batchCode === 'all',
        )
      ) {
        return overlayPrivateDashboard(snapshot, {
          schools: schoolRows as Record<string, unknown>[],
          metrics: metricRows as Record<string, unknown>[],
          batches: batchRows as Record<string, unknown>[],
        });
      }
      return snapshot;
    }
    const privacySafeMetrics = metricRows.map((row) => {
      if (row.privacySuppressed || (row.sampleSize !== null && row.sampleSize < 5)) {
        return { ...row, value: null, displayValue: '<5', privacySuppressed: true };
      }
      return row;
    });
    return {
      schema_version: '2.0.0',
      dataset_id: `province-${adcode}-dashboard-relational-fallback`,
      generated_at: new Date().toISOString(),
      data_status: 'fallback_relational',
      privacy: { minimum_cell_count: 5, mode: 'aggregate_only' },
      province,
      cities: cityRows,
      schools: schoolRows,
      companies: companyRows,
      recruitment_metrics: privacySafeMetrics,
      recruitment_events: eventRows,
      recruitment_batches: batchRows,
    };
  }

  async provinceRecruitmentProfile(
    adcode: string,
    filters: { cohortYear?: number; batchCode?: string; companyKey?: string } = {},
  ): Promise<Record<string, unknown> | null> {
    const cohortYear = filters.cohortYear ?? 2026;
    const [province] = await this.db.select().from(provinces).where(eq(provinces.adcode, adcode)).limit(1);
    if (!province) return null;
    const companyRows = await this.db
      .select()
      .from(companies)
      .where(
        and(
          eq(companies.provinceId, province.id),
          eq(companies.companyType, 'state_grid_provincial_unit'),
          eq(companies.publicationStatus, 'published'),
        ),
      )
      .orderBy(asc(companies.name));
    if (!companyRows.length) return null;
    const companyIds = companyRows.map((row) => row.id);
    const [batchRows, eventRows, requirementRows, metricRows, revisionRows] = await Promise.all([
      this.db
        .select()
        .from(recruitmentBatches)
        .where(
          and(
            inArray(recruitmentBatches.companyId, companyIds),
            eq(recruitmentBatches.cohortYear, cohortYear),
            eq(recruitmentBatches.publicationStatus, 'published'),
          ),
        )
        .orderBy(asc(recruitmentBatches.sortOrder)),
      this.db
        .select()
        .from(recruitmentEvents)
        .where(
          and(
            inArray(recruitmentEvents.companyId, companyIds),
            eq(recruitmentEvents.cohortYear, cohortYear),
            eq(recruitmentEvents.publicationStatus, 'published'),
          ),
        )
        .orderBy(asc(recruitmentEvents.startsOn), asc(recruitmentEvents.startsAt)),
      this.db
        .select()
        .from(recruitmentRequirements)
        .where(
          and(
            inArray(recruitmentRequirements.companyId, companyIds),
            eq(recruitmentRequirements.cohortYear, cohortYear),
            eq(recruitmentRequirements.publicationStatus, 'published'),
          ),
        )
        .orderBy(asc(recruitmentRequirements.batchCode), asc(recruitmentRequirements.category)),
      this.db
        .select()
        .from(recruitmentMetrics)
        .where(
          and(
            inArray(recruitmentMetrics.companyId, companyIds),
            eq(recruitmentMetrics.cohortYear, cohortYear),
            eq(recruitmentMetrics.metricType, 'planned_headcount_raw_mention'),
            eq(recruitmentMetrics.publicationStatus, 'published'),
          ),
        )
        .orderBy(asc(recruitmentMetrics.batchCode), asc(recruitmentMetrics.metricKey)),
      this.db
        .select()
        .from(dataRevisions)
        .where(
          and(
            eq(dataRevisions.cohortYear, cohortYear),
            eq(dataRevisions.status, 'published'),
            sql`${dataRevisions.metadata}->>'dataset_id' = 'sgcc-provincial-recruitment-2026-v1'`,
            sql`${dataRevisions.metadata}->>'province_adcode' = ${adcode}`,
          ),
        ),
    ]);
    const revisionSourceKeys = revisionRows.flatMap((row) =>
      [row.metadata.source_keys, row.metadata.sourceKeys, row.payload.sourceKeys]
        .flatMap((value) => Array.isArray(value) ? value : []),
    );
    const sourceRows = await this.sourceSummariesFor(
      [province, ...companyRows, ...batchRows, ...eventRows, ...requirementRows, ...metricRows, ...revisionRows],
      revisionSourceKeys,
    );
    // Discover entity provenance before the profile DTO drops a company's
    // sourceDocumentId. A private province gates the whole profile; private
    // companies and their child facts are filtered by the builder below.
    if (!publicSourceRows([province], privateSourceIndex(sourceRows)).length) return null;
    return buildProvinceRecruitmentProfile({
      province,
      companies: companyRows,
      batches: batchRows,
      events: eventRows,
      requirements: requirementRows,
      metrics: metricRows,
      revisions: revisionRows,
      sources: sourceRows,
      filters,
    });
  }
}
