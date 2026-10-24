import type { ResourceName } from '../db/schema.js';
import type { GridSnapshot } from '../lib/grid-query.js';
import type { GridMapCatalog } from '../lib/grid-map-catalog.js';

export type AdminRecord = {
  id: string;
  username: string;
  displayName: string;
  passwordHash: string;
  role: string;
  enabled: boolean;
};

export type AdminSessionRecord = {
  id: string;
  adminId: string;
  tokenHash: string;
  csrfHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  admin: AdminRecord;
};

export type UserRecord = {
  id: string;
  phoneLookupHash: string;
  phoneCiphertext: string;
  phoneLast4: string;
  displayName: string | null;
  passwordHash: string;
  enabled: boolean;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt: Date | null;
};

export type UserSessionRecord = {
  id: string;
  userId: string;
  tokenHash: string;
  csrfHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  user: UserRecord;
};

export type SessionInput = {
  tokenHash: string;
  csrfHash: string;
  expiresAt: Date;
  ipHash: string;
  userAgentHash: string;
};

export type UserCreateInput = {
  phoneLookupHash: string;
  phoneCiphertext: string;
  phoneLast4: string;
  displayName?: string | null;
  passwordHash: string;
  createdByAdminId: string;
};

export type UserListInput = {
  limit: number;
  offset: number;
  enabled?: boolean;
  phoneLookupHash?: string;
  phoneLast4?: string;
  displayName?: string;
};

export type ResourceListInput = {
  limit: number;
  offset: number;
  q?: string;
  cohortYear?: number;
  batchCode?: string;
  status?: string;
  statusPrefix?: string;
  publicationStatus?: string;
  dataStatus?: string;
  provinceId?: string;
  cityId?: string;
  companyId?: string;
  destinationProvinceId?: string;
  destinationCompanyId?: string;
  eventType?: string;
  category?: string;
  destinationScope?: string;
  disciplineGroup?: string;
  disciplineEvidenceStatus?: string;
  majorCategory?: string;
  majorEvidenceStatus?: string;
};

export type EarlyBatchPolicyRecord = {
  id: string;
  policyKey: string;
  cohortYear: number;
  batchCode: string;
  targetKind: 'province' | 'unit';
  targetCode: string;
  targetName: string;
  provinceId: string | null;
  parentProvinceId: string | null;
  provinceAdcode: string | null;
  parentProvinceAdcode: string | null;
  recruitmentRequirements: string;
  recruitmentProcess: string | null;
  plannedHeadcountDisplay: string | null;
  assessmentMethod: string | null;
  itineraryReference: string | null;
  siteQuotaDisplay: string | null;
  admissionRule: string | null;
  actualHeadcountDisplay: string | null;
  otherNotes: string | null;
  missingFields: string[];
  eligibilityModel: Record<string, unknown>;
  sourceLocator: string;
  evidenceAssets: Record<string, unknown>[];
  externalEvidence: Record<string, unknown>[];
  sourceStatus: string;
  sourceDocumentId: string;
  sourceDocumentTitle: string;
  sourceDocumentKey: string;
  sourceDocumentOfficialUrl: string | null;
  revisionId: string;
  revisionKey: string;
  revisionDataStatus: string;
  status: string;
  publicationStatus: string;
  sortOrder: number;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
};

export type EarlyBatchSchoolRecord = {
  id: string;
  schoolKey: string;
  name: string;
  provinceId: string | null;
  provinceAdcode: string | null;
  nature: string | null;
  educationLevel: string | null;
  status: string;
  publicationStatus: string;
  metadata: Record<string, unknown>;
};

export type AuditInput = {
  actorType: 'admin' | 'user' | 'system' | 'anonymous';
  actorId?: string | null;
  action: string;
  resourceType?: string | null;
  resourceId?: string | null;
  outcome: 'success' | 'failure';
  requestId?: string | null;
  ipHash?: string | null;
  userAgentHash?: string | null;
  metadata?: Record<string, unknown>;
};

export interface DataStore {
  gridMapCatalogSnapshot(): Promise<GridMapCatalog[]>;
  gridQuerySnapshot(): Promise<GridSnapshot>;
  health(): Promise<void>;

  findAdminByUsername(username: string): Promise<AdminRecord | null>;
  findAdminById(id: string): Promise<AdminRecord | null>;
  upsertAdmin(input: {
    username: string;
    displayName: string;
    passwordHash: string;
    role?: string;
  }): Promise<AdminRecord>;
  markAdminLogin(id: string): Promise<void>;
  createAdminSession(adminId: string, input: SessionInput): Promise<void>;
  findAdminSession(tokenHash: string): Promise<AdminSessionRecord | null>;
  revokeAdminSession(tokenHash: string): Promise<void>;
  revokeAllAdminSessions(adminId: string): Promise<void>;

  findUserByPhoneHash(phoneLookupHash: string): Promise<UserRecord | null>;
  findUserById(id: string): Promise<UserRecord | null>;
  listUsers(input: UserListInput): Promise<{ items: UserRecord[]; total: number }>;
  createUser(input: UserCreateInput): Promise<UserRecord>;
  updateUser(id: string, patch: { enabled?: boolean; displayName?: string | null }): Promise<UserRecord | null>;
  resetUserPassword(id: string, passwordHash: string): Promise<UserRecord | null>;
  softDeleteUser(id: string): Promise<UserRecord | null>;
  markUserLogin(id: string): Promise<void>;
  createUserSession(userId: string, input: SessionInput, verifiedPasswordHash?: string): Promise<void>;
  findUserSession(tokenHash: string): Promise<UserSessionRecord | null>;
  revokeUserSession(tokenHash: string): Promise<void>;
  revokeAllUserSessions(userId: string): Promise<void>;

  listResource(
    resource: ResourceName,
    input: ResourceListInput,
  ): Promise<{ items: Record<string, unknown>[]; total: number }>;
  getResource(resource: ResourceName, id: string): Promise<Record<string, unknown> | null>;
  findSourceByKey(sourceKey: string): Promise<Record<string, unknown> | null>;
  adminOnlySources(): Promise<Record<string, unknown>[]>;
  createResource(
    resource: ResourceName,
    input: Record<string, unknown>,
    adminId: string,
  ): Promise<Record<string, unknown>>;
  updateResource(
    resource: ResourceName,
    id: string,
    patch: Record<string, unknown>,
  ): Promise<Record<string, unknown> | null>;
  deleteResource(resource: ResourceName, id: string): Promise<boolean>;

  listEarlyBatchPolicies(year: number): Promise<EarlyBatchPolicyRecord[]>;
  findEarlyBatchPolicy(targetCode: string, year: number): Promise<EarlyBatchPolicyRecord | null>;
  findEarlyBatchSchool(schoolKey: string): Promise<EarlyBatchSchoolRecord | null>;
  searchEarlyBatchSchools(query: string, limit: number): Promise<EarlyBatchSchoolRecord[]>;

  listAudit(input: {
    limit: number;
    offset: number;
    actorType?: string;
    action?: string;
  }): Promise<{ items: Record<string, unknown>[]; total: number }>;
  audit(input: AuditInput): Promise<void>;

  publicDashboard(): Promise<Record<string, unknown>>;
  provinceDashboard(
    adcode: string,
    filters: { cohortYear?: number; batchCode?: string },
  ): Promise<Record<string, unknown> | null>;
  provinceRecruitmentProfile(
    adcode: string,
    filters: { cohortYear?: number; batchCode?: string; companyKey?: string },
  ): Promise<Record<string, unknown> | null>;
}
