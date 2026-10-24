import { randomUUID } from 'node:crypto';
import { gridDatasetSchema, gridVersion, type GridSnapshot } from '../lib/grid-query.js';
import { normalizeGridMapCatalog, type GridMapCatalog } from '../lib/grid-map-catalog.js';
import type { ResourceName } from '../db/schema.js';
import { buildProvinceRecruitmentProfile } from '../lib/province-recruitment-profile.js';
import { containsPrivateSourceReference, isAdminOnlySource, privateSourceIndex } from '../lib/private-source-boundary.js';
import {
  enrichAdministrativeRows,
  enrichMetricRows,
  enrichSchoolRows,
  overlayPrivateDashboard,
  overlayPublicDashboard,
} from '../lib/dashboard-overlay.js';
import { canonicalResourceName } from '../resources.js';
import { ApiError } from '../lib/http.js';
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

type MemoryAdmin = AdminRecord & { lastLoginAt: Date | null };
type MemoryAdminSession = Omit<AdminSessionRecord, 'admin'>;
type MemoryUserSession = Omit<UserSessionRecord, 'user'>;

export class MemoryStore implements DataStore {
  private gridMapCatalogs: GridMapCatalog[] = [];
  seedGridMapCatalog(input:unknown):void {
    const catalog=normalizeGridMapCatalog(input);
    this.gridMapCatalogs=[...this.gridMapCatalogs.filter(row=>row.datasetKey!==catalog.datasetKey),catalog];
  }
  async gridMapCatalogSnapshot():Promise<GridMapCatalog[]> { return this.gridMapCatalogs; }
  private readonly gridDatasets = new Map<string, ReturnType<typeof gridDatasetSchema.parse>>();
  seedGridDataset(input: unknown): void {
    const dataset=gridDatasetSchema.parse(input);
    this.gridDatasets.set(dataset.datasetKey, dataset);
  }
  async gridQuerySnapshot(): Promise<GridSnapshot> {
    const datasets=[...this.gridDatasets.values()];
    return {datasets,versions:datasets.map(gridVersion)};
  }
  private readonly admins = new Map<string, MemoryAdmin>();
  private readonly adminSessions = new Map<string, MemoryAdminSession>();
  private readonly users = new Map<string, UserRecord>();
  private readonly userSessions = new Map<string, MemoryUserSession>();
  private readonly resources = new Map<string, Map<string, Record<string, unknown>>>();
  private readonly audits: Record<string, unknown>[] = [];

  async health(): Promise<void> {}

  async findAdminByUsername(username: string): Promise<AdminRecord | null> {
    return [...this.admins.values()].find((row) => row.username === username) ?? null;
  }

  async findAdminById(id: string): Promise<AdminRecord | null> {
    return this.admins.get(id) ?? null;
  }

  async upsertAdmin(input: {
    username: string;
    displayName: string;
    passwordHash: string;
    role?: string;
  }): Promise<AdminRecord> {
    const existing = await this.findAdminByUsername(input.username);
    const row: MemoryAdmin = {
      id: existing?.id ?? randomUUID(),
      username: input.username,
      displayName: input.displayName,
      passwordHash: input.passwordHash,
      role: input.role ?? 'superadmin',
      enabled: true,
      lastLoginAt: null,
    };
    this.admins.set(row.id, row);
    return row;
  }

  async markAdminLogin(id: string): Promise<void> {
    const row = this.admins.get(id);
    if (row) row.lastLoginAt = new Date();
  }

  async createAdminSession(adminId: string, input: SessionInput): Promise<void> {
    this.adminSessions.set(input.tokenHash, { id: randomUUID(), adminId, revokedAt: null, ...input });
  }

  async findAdminSession(tokenHash: string): Promise<AdminSessionRecord | null> {
    const session = this.adminSessions.get(tokenHash);
    const admin = session ? this.admins.get(session.adminId) : null;
    return session && admin ? { ...session, admin } : null;
  }

  async revokeAdminSession(tokenHash: string): Promise<void> {
    const row = this.adminSessions.get(tokenHash);
    if (row) row.revokedAt = new Date();
  }

  async revokeAllAdminSessions(adminId: string): Promise<void> {
    for (const row of this.adminSessions.values()) if (row.adminId === adminId) row.revokedAt = new Date();
  }

  async findUserByPhoneHash(phoneLookupHash: string): Promise<UserRecord | null> {
    return [...this.users.values()].find((row) => row.phoneLookupHash === phoneLookupHash && !row.deletedAt) ?? null;
  }

  async findUserById(id: string): Promise<UserRecord | null> {
    const row = this.users.get(id);
    return row && !row.deletedAt ? row : null;
  }

  async listUsers(input: UserListInput): Promise<{ items: UserRecord[]; total: number }> {
    let rows = [...this.users.values()].filter((row) => !row.deletedAt);
    if (input.enabled !== undefined) rows = rows.filter((row) => row.enabled === input.enabled);
    if (input.phoneLookupHash) rows = rows.filter((row) => row.phoneLookupHash === input.phoneLookupHash);
    if (input.phoneLast4) rows = rows.filter((row) => row.phoneLast4 === input.phoneLast4);
    if (input.displayName) rows = rows.filter((row) => row.displayName?.toLowerCase().includes(input.displayName!.toLowerCase()));
    rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return { items: rows.slice(input.offset, input.offset + input.limit), total: rows.length };
  }

  async createUser(input: UserCreateInput): Promise<UserRecord> {
    if (await this.findUserByPhoneHash(input.phoneLookupHash)) throw Object.assign(new Error('duplicate'), { code: '23505' });
    const now = new Date();
    const row: UserRecord = {
      id: randomUUID(),
      ...input,
      displayName: input.displayName ?? null,
      enabled: true,
      deletedAt: null,
      lastLoginAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.users.set(row.id, row);
    return row;
  }

  async updateUser(
    id: string,
    patch: { enabled?: boolean; displayName?: string | null },
  ): Promise<UserRecord | null> {
    const row = await this.findUserById(id);
    if (!row) return null;
    if (patch.enabled !== undefined) row.enabled = patch.enabled;
    if (patch.displayName !== undefined) row.displayName = patch.displayName;
    row.updatedAt = new Date();
    if (patch.enabled === false) await this.revokeAllUserSessions(id);
    return row;
  }

  async resetUserPassword(id: string, passwordHash: string): Promise<UserRecord | null> {
    const row = await this.findUserById(id);
    if (!row) return null;
    row.passwordHash = passwordHash;
    row.updatedAt = new Date();
    await this.revokeAllUserSessions(id);
    return row;
  }

  async softDeleteUser(id: string): Promise<UserRecord | null> {
    const row = await this.findUserById(id);
    if (!row) return null;
    row.enabled = false;
    row.deletedAt = new Date();
    row.updatedAt = new Date();
    await this.revokeAllUserSessions(id);
    return row;
  }

  async markUserLogin(id: string): Promise<void> {
    const row = this.users.get(id);
    if (row) row.lastLoginAt = new Date();
  }

  async createUserSession(userId: string, input: SessionInput, verifiedPasswordHash?: string): Promise<void> {
    if (verifiedPasswordHash !== undefined) {
      const user = this.users.get(userId);
      if (!user || !user.enabled || user.deletedAt || user.passwordHash !== verifiedPasswordHash) {
        throw new ApiError(401, 'AUTH_STATE_CHANGED', '账户状态已更新，请重新登录');
      }
    }
    this.userSessions.set(input.tokenHash, { id: randomUUID(), userId, revokedAt: null, ...input });
  }

  async findUserSession(tokenHash: string): Promise<UserSessionRecord | null> {
    const session = this.userSessions.get(tokenHash);
    const user = session ? this.users.get(session.userId) : null;
    return session && user ? { ...session, user } : null;
  }

  async revokeUserSession(tokenHash: string): Promise<void> {
    const row = this.userSessions.get(tokenHash);
    if (row) row.revokedAt = new Date();
  }

  async revokeAllUserSessions(userId: string): Promise<void> {
    for (const row of this.userSessions.values()) if (row.userId === userId) row.revokedAt = new Date();
  }

  private bucket(resource: ResourceName): Map<string, Record<string, unknown>> {
    const key = canonicalResourceName(resource);
    let bucket = this.resources.get(key);
    if (!bucket) {
      bucket = new Map();
      this.resources.set(key, bucket);
    }
    return bucket;
  }

  async listResource(
    resource: ResourceName,
    input: ResourceListInput,
  ): Promise<{ items: Record<string, unknown>[]; total: number }> {
    const canonical = canonicalResourceName(resource);
    let rows = [...this.bucket(resource).values()];
    if (canonical === 'schools') {
      const publishedMetrics = [...this.bucket('recruitment-metrics').values()].filter(
        (row) => row.publicationStatus === 'published',
      );
      rows = enrichSchoolRows(
        rows,
        publishedMetrics,
        {
          provinces: [...this.bucket('provinces').values()],
          cities: [...this.bucket('cities').values()],
          companies: [...this.bucket('companies').values()],
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
      if (input.cohortYear !== undefined || input.destinationProvinceId || input.destinationCompanyId) {
        const matchingSchoolIds = new Set(
          publishedMetrics
            .filter(
              (row) =>
                row.metricType === 'public_notice_record_count' &&
                row.batchCode === 'all' &&
                String(row.disciplineGroup ?? 'all') === 'all' &&
                (input.cohortYear === undefined || row.cohortYear === input.cohortYear) &&
                (!input.destinationProvinceId || row.provinceId === input.destinationProvinceId) &&
                (!input.destinationCompanyId || row.companyId === input.destinationCompanyId),
            )
            .map((row) => row.schoolId)
            .filter((id): id is string => typeof id === 'string'),
        );
        rows = rows.filter((row) => matchingSchoolIds.has(String(row.id)));
      }
    } else if (canonical === 'recruitment-metrics') {
      rows = enrichMetricRows(rows, {
        schools: [...this.bucket('schools').values()],
        companies: [...this.bucket('companies').values()],
        provinces: [...this.bucket('provinces').values()],
        cities: [...this.bucket('cities').values()],
        batches: [...this.bucket('recruitment-batches').values()],
        sources: [...this.bucket('sources').values()],
      });
    } else if (
      ['cities', 'companies', 'recruitment-batches', 'recruitment-events', 'recruitment-requirements'].includes(
        canonical,
      )
    ) {
      rows = enrichAdministrativeRows(rows, {
        companies: [...this.bucket('companies').values()],
        provinces: [...this.bucket('provinces').values()],
        cities: [...this.bucket('cities').values()],
        batches: [...this.bucket('recruitment-batches').values()],
        sources: [...this.bucket('sources').values()],
      });
    }
    if (input.q) {
      const q = input.q.toLowerCase();
      rows = rows.filter((row) => JSON.stringify(row).toLowerCase().includes(q));
    }
    for (const key of [
      'cohortYear',
      'batchCode',
      'status',
      'publicationStatus',
      'dataStatus',
      'provinceId',
      'cityId',
      'companyId',
      'eventType',
      'destinationScope',
      'disciplineGroup',
      'disciplineEvidenceStatus',
      'majorCategory',
      'majorEvidenceStatus',
    ] as const) {
      const wanted = input[key];
      if (wanted !== undefined) {
        if (canonical === 'schools' && key === 'cohortYear') continue;
        rows = rows.filter((row) =>
          key === 'batchCode' && canonical === 'recruitment-batches'
            ? row.code === wanted
            : row[key] === wanted,
        );
      }
    }
    if (input.category !== undefined) {
      rows = rows.filter(
        (row) =>
          row.category === input.category ||
          (Array.isArray(row.categoryTags) && row.categoryTags.includes(input.category)),
      );
    }
    if (input.statusPrefix) {
      rows = rows.filter((row) => String(row.status ?? '').startsWith(input.statusPrefix!));
    }
    const compareText = (left: unknown, right: unknown) =>
      String(left ?? '').localeCompare(String(right ?? ''), 'zh-CN');
    const compareNumber = (left: unknown, right: unknown, fallback = 9999) => {
      const leftNumber = Number(left);
      const rightNumber = Number(right);
      return (Number.isFinite(leftNumber) ? leftNumber : fallback) -
        (Number.isFinite(rightNumber) ? rightNumber : fallback);
    };
    const provincesById = new Map(
      [...this.bucket('provinces').values()].map((row) => [String(row.id), row]),
    );
    const citiesById = new Map(
      [...this.bucket('cities').values()].map((row) => [String(row.id), row]),
    );
    const schoolsById = new Map(
      [...this.bucket('schools').values()].map((row) => [String(row.id), row]),
    );
    const provinceOf = (row: Record<string, unknown>) =>
      row.provinceId ? provincesById.get(String(row.provinceId)) : undefined;
    const cityOf = (row: Record<string, unknown>) =>
      row.cityId ? citiesById.get(String(row.cityId)) : undefined;
    const compareProvinceGroup = (a: Record<string, unknown>, b: Record<string, unknown>) =>
      compareNumber(provinceOf(a)?.sortOrder, provinceOf(b)?.sortOrder) ||
      compareText(
        a.schoolProvinceName ?? a.provinceName ?? provinceOf(a)?.name,
        b.schoolProvinceName ?? b.provinceName ?? provinceOf(b)?.name,
      );
    const compareCityGroup = (a: Record<string, unknown>, b: Record<string, unknown>) =>
      compareText(
        a.schoolCityName ?? a.cityName ?? cityOf(a)?.name,
        b.schoolCityName ?? b.cityName ?? cityOf(b)?.name,
      );
    const compareCompanyGroup = (a: Record<string, unknown>, b: Record<string, unknown>) =>
      compareText(a.companyName, b.companyName);
    const batchOrder = ['campus', 'batch_1', 'batch_2', 'batch_3', 'all', 'not_applicable'];
    const batchRank = (value: unknown) => {
      const index = batchOrder.indexOf(String(value));
      return index < 0 ? 99 : index;
    };
    const requirementOrder = [
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
    ];
    const requirementRank = (value: unknown) => {
      const index = requirementOrder.indexOf(String(value));
      return index < 0 ? 99 : index;
    };
    const eventOrder: Record<string, number> = {
      campus_presentation: 0,
      campus_recruitment_period: 1,
      recruitment_activity: 1,
      application_start: 2,
      application: 3,
      application_deadline: 4,
      application_end: 4,
      qualification_review: 5,
      qualification: 5,
      onsite_qualification_review: 5,
      exam_notification: 6,
      exam_notice_confirmation: 6,
      written_exam: 7,
      assessment: 8,
      physical_test: 9,
      interview: 10,
      medical_or_onboarding_check: 11,
      signing_or_confirmation: 12,
      public_notice: 13,
      announcement: 13,
      public_notice_end: 13,
      onboarding: 14,
      other_recruitment_event: 99,
      other: 99,
    };
    const eventRank = (value: unknown) => eventOrder[String(value)] ?? 99;
    const compareId = (a: Record<string, unknown>, b: Record<string, unknown>) =>
      compareText(a.id, b.id);

    if (canonical === 'schools') {
      rows.sort((a, b) =>
        compareProvinceGroup(a, b) ||
        compareCityGroup(a, b) ||
        compareText(a.name, b.name) ||
        compareId(a, b),
      );
    } else if (canonical === 'companies') {
      rows.sort((a, b) =>
        compareProvinceGroup(a, b) ||
        compareCityGroup(a, b) ||
        compareText(a.name, b.name) ||
        compareId(a, b),
      );
    } else if (canonical === 'cities') {
      rows.sort((a, b) =>
        compareProvinceGroup(a, b) ||
        compareNumber(a.sortOrder, b.sortOrder) ||
        compareText(a.name, b.name) ||
        compareId(a, b),
      );
    } else if (canonical === 'recruitment-batches') {
      rows.sort((a, b) =>
        compareProvinceGroup(a, b) ||
        compareCompanyGroup(a, b) ||
        batchRank(a.code) - batchRank(b.code) ||
        compareNumber(a.sortOrder, b.sortOrder) ||
        compareText(a.name, b.name) ||
        compareId(a, b),
      );
    } else if (canonical === 'recruitment-metrics') {
      rows.sort((a, b) =>
        compareProvinceGroup(a, b) ||
        compareCompanyGroup(a, b) ||
        batchRank(a.batchCode) - batchRank(b.batchCode) ||
        compareText(
          a.schoolName ?? (a.schoolId ? schoolsById.get(String(a.schoolId))?.name : ''),
          b.schoolName ?? (b.schoolId ? schoolsById.get(String(b.schoolId))?.name : ''),
        ) ||
        compareText(a.metricType, b.metricType) ||
        compareText(a.disciplineGroup, b.disciplineGroup) ||
        compareId(a, b),
      );
    } else if (canonical === 'recruitment-events') {
      const eventDate = (row: Record<string, unknown>) =>
        row.startsOn ?? row.startsAt ?? row.endsOn ?? row.endsAt ?? '9999-12-31';
      rows.sort((a, b) =>
        compareProvinceGroup(a, b) ||
        compareCompanyGroup(a, b) ||
        batchRank(a.batchCode) - batchRank(b.batchCode) ||
        compareText(eventDate(a), eventDate(b)) ||
        eventRank(a.eventType) - eventRank(b.eventType) ||
        compareId(a, b),
      );
    } else if (canonical === 'recruitment-requirements') {
      rows.sort((a, b) =>
        compareProvinceGroup(a, b) ||
        compareCompanyGroup(a, b) ||
        batchRank(a.batchCode) - batchRank(b.batchCode) ||
        requirementRank(a.category) - requirementRank(b.category) ||
        compareText(a.evidenceLocator, b.evidenceLocator) ||
        compareId(a, b),
      );
    } else {
      // String(Date) renders as 'Wed Sep 02 2026 …', so comparing the strings
      // sorted by weekday abbreviation instead of by time. Compare timestamps.
      rows.sort(
        (a, b) =>
          new Date(String(b.updatedAt)).getTime() - new Date(String(a.updatedAt)).getTime() ||
          compareId(a, b),
      );
    }
    const page = rows.slice(input.offset, input.offset + input.limit);
    return {
      items: canonical === 'sources' ? page.map(({ contentText: _body, ...summary }) => summary) : page,
      total: rows.length,
    };
  }

  async getResource(resource: ResourceName, id: string): Promise<Record<string, unknown> | null> {
    return this.bucket(resource).get(id) ?? null;
  }

  async findSourceByKey(sourceKey: string): Promise<Record<string, unknown> | null> {
    return [...this.bucket('sources').values()].find((row) => row.sourceKey === sourceKey) ?? null;
  }

  async adminOnlySources(): Promise<Record<string, unknown>[]> {
    return [...this.bucket('sources').values()].filter(isAdminOnlySource).map(row => ({
      id: row.id, sourceKey: row.sourceKey, metadata: { visibility: 'admin_only' },
    }));
  }

  private audienceRows(resource: ResourceName): Record<string, unknown>[] {
    const index = privateSourceIndex([...this.bucket('sources').values()]);
    return [...this.bucket(resource).values()].filter(row => {
      if (containsPrivateSourceReference(row, index)) return false;
      const revision = typeof row.revisionId === 'string' ? this.bucket('revisions').get(row.revisionId) : null;
      return !containsPrivateSourceReference(revision, index);
    });
  }

  async createResource(
    resource: ResourceName,
    input: Record<string, unknown>,
    adminId: string,
  ): Promise<Record<string, unknown>> {
    const now = new Date();
    const row: Record<string, unknown> = { id: randomUUID(), ...input, createdAt: now, updatedAt: now };
    if (canonicalResourceName(resource) === 'revisions') row.createdByAdminId = adminId;
    this.bucket(resource).set(String(row.id), row);
    return row;
  }

  async updateResource(
    resource: ResourceName,
    id: string,
    patch: Record<string, unknown>,
  ): Promise<Record<string, unknown> | null> {
    const row = this.bucket(resource).get(id);
    if (!row) return null;
    Object.assign(row, patch, { updatedAt: new Date() });
    return row;
  }

  async deleteResource(resource: ResourceName, id: string): Promise<boolean> {
    return this.bucket(resource).delete(id);
  }

  private earlyBatchPolicy(row: Record<string, unknown>): EarlyBatchPolicyRecord {
    const province = row.provinceId
      ? [...this.bucket('provinces').values()].find((item) => item.id === row.provinceId)
      : null;
    const parentProvince = row.parentProvinceId
      ? [...this.bucket('provinces').values()].find((item) => item.id === row.parentProvinceId)
      : null;
    const source = [...this.bucket('sources').values()].find(
      (item) => item.id === row.sourceDocumentId,
    );
    const revision = [...this.bucket('revisions').values()].find((item) => item.id === row.revisionId);
    return {
      ...(row as Omit<
        EarlyBatchPolicyRecord,
        | 'provinceAdcode'
        | 'parentProvinceAdcode'
        | 'sourceDocumentTitle'
        | 'sourceDocumentKey'
        | 'sourceDocumentOfficialUrl'
        | 'revisionKey'
        | 'revisionDataStatus'
      >),
      provinceAdcode: typeof province?.adcode === 'string' ? province.adcode : null,
      parentProvinceAdcode:
        typeof parentProvince?.adcode === 'string' ? parentProvince.adcode : null,
      sourceDocumentTitle: String(source?.title ?? ''),
      sourceDocumentKey: String(source?.sourceKey ?? ''),
      sourceDocumentOfficialUrl:
        typeof source?.officialUrl === 'string' ? source.officialUrl : null,
      revisionKey: String(revision?.revisionKey ?? ''),
      revisionDataStatus: String(revision?.dataStatus ?? row.sourceStatus ?? 'pending'),
    };
  }

  async listEarlyBatchPolicies(year: number): Promise<EarlyBatchPolicyRecord[]> {
    return this.audienceRows('early-batch-policies')
      .filter(
        (row) =>
          row.cohortYear === year &&
          row.publicationStatus === 'published' &&
          row.status === 'active',
      )
      .sort((a, b) => Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0))
      .map((row) => this.earlyBatchPolicy(row));
  }

  async findEarlyBatchPolicy(
    targetCode: string,
    year: number,
  ): Promise<EarlyBatchPolicyRecord | null> {
    const row = this.audienceRows('early-batch-policies').find(
      (item) =>
        item.targetCode === targetCode &&
        item.cohortYear === year &&
        item.publicationStatus === 'published' &&
        item.status === 'active',
    );
    return row ? this.earlyBatchPolicy(row) : null;
  }

  private earlyBatchSchool(row: Record<string, unknown>): EarlyBatchSchoolRecord {
    const province = row.provinceId
      ? [...this.bucket('provinces').values()].find((item) => item.id === row.provinceId)
      : null;
    return {
      id: String(row.id),
      schoolKey: String(row.schoolKey),
      name: String(row.name),
      provinceId: typeof row.provinceId === 'string' ? row.provinceId : null,
      provinceAdcode: typeof province?.adcode === 'string' ? province.adcode : null,
      nature: typeof row.nature === 'string' ? row.nature : null,
      educationLevel: typeof row.educationLevel === 'string' ? row.educationLevel : null,
      status: String(row.status ?? 'pending'),
      publicationStatus: String(row.publicationStatus ?? 'draft'),
      metadata:
        row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
          ? (row.metadata as Record<string, unknown>)
          : {},
    };
  }

  async findEarlyBatchSchool(schoolKey: string): Promise<EarlyBatchSchoolRecord | null> {
    const row = this.audienceRows('schools').find(
      (item) => item.schoolKey === schoolKey && item.publicationStatus === 'published',
    );
    return row ? this.earlyBatchSchool(row) : null;
  }

  async searchEarlyBatchSchools(query: string, limit: number): Promise<EarlyBatchSchoolRecord[]> {
    const normalized = query.trim().toLocaleLowerCase('zh-CN');
    return this.audienceRows('schools')
      .filter(
        (row) =>
          row.publicationStatus === 'published' &&
          (String(row.name).toLocaleLowerCase('zh-CN').includes(normalized) ||
            String(row.schoolKey).toLocaleLowerCase('zh-CN').includes(normalized)),
      )
      .sort((a, b) => {
        const aExact = String(a.name).toLocaleLowerCase('zh-CN') === normalized ? 0 : 1;
        const bExact = String(b.name).toLocaleLowerCase('zh-CN') === normalized ? 0 : 1;
        return aExact - bExact || String(a.name).localeCompare(String(b.name), 'zh-CN');
      })
      .slice(0, limit)
      .map((row) => this.earlyBatchSchool(row));
  }

  async listAudit(input: {
    limit: number;
    offset: number;
    actorType?: string;
    action?: string;
  }): Promise<{ items: Record<string, unknown>[]; total: number }> {
    let rows = [...this.audits].reverse();
    if (input.actorType) rows = rows.filter((row) => row.actorType === input.actorType);
    if (input.action) rows = rows.filter((row) => String(row.action).includes(input.action!));
    return { items: rows.slice(input.offset, input.offset + input.limit), total: rows.length };
  }

  async audit(input: AuditInput): Promise<void> {
    this.audits.push({ id: randomUUID(), ...input, createdAt: new Date() });
  }

  async publicDashboard(): Promise<Record<string, unknown>> {
    const revision = this.audienceRows('revisions').find(
      (row) => row.revisionKey === 'public-dashboard' && row.status === 'published',
    );
    const snapshot = revision?.payload as Record<string, unknown> | undefined;
    const metrics = this.audienceRows('recruitment-metrics').filter(
      (row) => row.publicationStatus === 'published',
    );
    if (
      snapshot &&
      metrics.some(
        (row) =>
          row.metricType === 'public_notice_record_count' &&
          row.aggregationGrain === 'cohort_school' &&
          row.batchCode === 'all',
      )
    ) {
      return overlayPublicDashboard(snapshot, {
        schools: this.audienceRows('schools'),
        metrics,
        batches: this.audienceRows('recruitment-batches'),
      });
    }
    return snapshot ?? {
      schema_version: '2.0.0',
      dataset_id: 'memory-public-dashboard',
      data_status: 'fallback_relational',
    };
  }

  async provinceDashboard(
    adcode: string,
    filters: { cohortYear?: number; batchCode?: string } = {},
  ): Promise<Record<string, unknown> | null> {
    const revision = this.audienceRows('revisions').find(
      (row) => row.revisionKey === `province-${adcode}-dashboard` && row.status === 'published',
    );
    const province = this.audienceRows('provinces').find((row) => row.adcode === adcode);
    if (!province)
      return (revision?.payload as Record<string, unknown> | undefined) ?? null;
    const sourceInScope = (row: Record<string, unknown>) => {
      const metadata = row.metadata as Record<string, unknown> | undefined;
      const metadataSources = Array.isArray(metadata?.source_ids) ? metadata.source_ids : [];
      return (
        row.provinceId === province.id ||
        metadata?.province_id === province.provinceKey ||
        (adcode === '420000' && metadataSources.includes('public-selection-aggregate-2026'))
      );
    };
    let metrics = this.audienceRows('recruitment-metrics').filter(
      (row) => row.publicationStatus === 'published' && sourceInScope(row),
    );
    if (filters.cohortYear !== undefined)
      metrics = metrics.filter((row) => row.cohortYear === filters.cohortYear);
    if (filters.batchCode) metrics = metrics.filter((row) => row.batchCode === filters.batchCode);
    const batches = this.audienceRows('recruitment-batches').filter(
      (row) => row.publicationStatus === 'published' && sourceInScope(row),
    );
    if (
      revision?.payload &&
      filters.cohortYear === undefined &&
      !filters.batchCode &&
      metrics.some(
        (row) =>
          row.metricType === 'public_notice_record_count' &&
          row.aggregationGrain === 'cohort_school' &&
          row.batchCode === 'all',
      )
    ) {
      return overlayPrivateDashboard(revision.payload as Record<string, unknown>, {
        schools: this.audienceRows('schools'),
        metrics,
        batches,
      });
    }
    if (revision?.payload && filters.cohortYear === undefined && !filters.batchCode)
      return revision.payload as Record<string, unknown>;
    return {
      schema_version: '2.0.0',
      dataset_id: `province-${adcode}-dashboard-relational-fallback`,
      province,
      schools: this.audienceRows('schools'),
      recruitment_metrics: metrics,
      recruitment_batches: batches,
    };
  }

  async provinceRecruitmentProfile(
    adcode: string,
    filters: { cohortYear?: number; batchCode?: string; companyKey?: string } = {},
  ): Promise<Record<string, unknown> | null> {
    const province = [...this.bucket('provinces').values()].find((row) => row.adcode === adcode);
    if (!province) return null;
    const published = (row: Record<string, unknown>) => row.publicationStatus === 'published';
    const companies = [...this.bucket('companies').values()].filter(
      (row) =>
        row.provinceId === province.id &&
        published(row) &&
        row.companyType === 'state_grid_provincial_unit',
    );
    if (!companies.length) return null;
    const companyIds = new Set(companies.map((row) => row.id));
    const revisions = [...this.bucket('revisions').values()].filter((row) => {
      const metadata = row.metadata as Record<string, unknown> | undefined;
      return (
        row.status === 'published' &&
        row.cohortYear === (filters.cohortYear ?? 2026) &&
        metadata?.dataset_id === 'sgcc-provincial-recruitment-2026-v1' &&
        metadata?.province_adcode === adcode
      );
    });
    return buildProvinceRecruitmentProfile({
      province,
      companies,
      batches: [...this.bucket('recruitment-batches').values()].filter(
        (row) => companyIds.has(row.companyId) && published(row),
      ),
      events: [...this.bucket('recruitment-events').values()].filter(
        (row) => companyIds.has(row.companyId) && published(row),
      ),
      requirements: [...this.bucket('recruitment-requirements').values()].filter(
        (row) => companyIds.has(row.companyId) && published(row),
      ),
      metrics: [...this.bucket('recruitment-metrics').values()].filter(
        (row) => companyIds.has(row.companyId) && published(row),
      ),
      revisions,
      sources: [...this.bucket('sources').values()],
      filters,
    });
  }
}
