import { readFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { z, ZodError } from 'zod';
import type { AppConfig } from './config.js';
import type { ResourceName } from './db/schema.js';
import {
  csrfForSession,
  decryptPhone,
  encryptPhone,
  hashPassword,
  maskPhone,
  normalizePhone,
  phoneLookupHash,
  randomToken,
  safeEqual,
  secretDigest,
  sha256,
  verifyPassword,
} from './lib/crypto.js';
import { ApiError, noStore, paginationFromQuery } from './lib/http.js';
import { gridFacets, gridFactQuerySchema, gridRankingQuerySchema, gridSourceQuerySchema, queryGridFacts, queryGridRankings, queryGridSources, gridFactVisibleToMember } from './lib/grid-query.js';
import { gridMapCoverage, gridMapQuerySchema, queryGridMapCompany, queryGridMapOverview, queryGridMapSchool } from './lib/grid-map.js';
import { GRID_ORIGINAL_SHA256, readGridOriginalDocument } from './lib/grid-original-html.js';
import { buildGridInformationOverview, buildGridInformationProvince, gridInformationQuerySchema, loadGridInformation } from './lib/grid-information.js';
import { gridAggregateRankingQuerySchema, queryExactGridCompany, queryExactGridOverview, queryExactGridRankings, queryExactGridSchool, queryExactInformation } from './lib/grid-aggregates.js';
import { gridCatalogsForMemberSources, gridSnapshotForMemberSources } from './lib/grid-source-visibility.js';
import { containsPrivateSourceReference, pinPrivateSource, privateSourceIndex, stripPrivateSourceMaterial } from './lib/private-source-boundary.js';
import { readPrivateSourceAsset } from './lib/private-source-asset.js';
import { evaluateRecruitmentEligibility, recruitmentEligibilityRequestSchema } from './lib/recruitment-eligibility.js';
import { resolveRecruitmentReferenceCohort } from './lib/recruitment-reference-cohorts.js';
import {
  describeEarlyBatchSchool,
  earlyBatchSchoolTags,
  evaluateEarlyBatchPolicy,
  normalizeSchoolName,
  sourceLocators,
  type EarlyBatchApplicant,
  type EarlyBatchSchoolTagBasis,
  type EarlyBatchSchoolDescriptor,
} from './lib/early-batch.js';
import {
  exposedResources,
  parseResourceCreate,
  parseResourcePatch,
  validateResourceState,
  type CanonicalResourceName,
} from './resources.js';
import type {
  AdminSessionRecord,
  DataStore,
  EarlyBatchPolicyRecord,
  ResourceListInput,
  UserRecord,
  UserSessionRecord,
} from './store/types.js';

const ADMIN_COOKIE = 'hz_admin_session';
const USER_COOKIE = 'hz_user_session';
const RECRUITMENT_EVENT_TYPES = new Set([
  'application',
  'application_deadline',
  'assessment',
  'campus_presentation',
  'exam_notification',
  'interview',
  'medical_or_onboarding_check',
  'onboarding',
  'other_recruitment_event',
  'physical_test',
  'public_notice',
  'qualification_review',
  'recruitment_activity',
  'signing_or_confirmation',
  'written_exam',
  // Explicit legacy aliases remain readable/editable while new imports use the
  // canonical values above. Arbitrary free-text values are no longer accepted.
  'application_start',
  'application_end',
  'qualification',
  'announcement',
  'other',
  'campus_recruitment_period',
  'exam_notice_confirmation',
  'onsite_qualification_review',
  'public_notice_end',
]);
const RECRUITMENT_REQUIREMENT_CATEGORIES = new Set([
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
]);
const CONCRETE_RECRUITMENT_BATCHES = new Set(['campus', 'batch_1', 'batch_2', 'batch_3']);

type AdminContext = { record: AdminSessionRecord; rawToken: string; csrfToken: string };
type UserContext = { record: UserSessionRecord; rawToken: string; csrfToken: string };

declare module 'fastify' {
  interface FastifyRequest {
    adminContext: AdminContext | null;
    userContext: UserContext | null;
  }
}

const adminLoginSchema = z
  .object({
    username: z.string().trim().min(1).max(80),
    password: z.string().min(8).max(256),
  })
  .strict();

const userLoginSchema = z
  .object({ phone: z.string().min(1).max(40), password: z.string().min(8).max(256) })
  .strict();

const userCreateSchema = z
  .object({
    phone: z.string().min(1).max(40),
    password: z.string().min(8).max(256),
    displayName: z.string().trim().min(1).max(120).nullable().optional(),
  })
  .strict();

const userPatchSchema = z
  .object({
    enabled: z.boolean().optional(),
    displayName: z.string().trim().min(1).max(120).nullable().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, 'empty patch');

const resetPasswordSchema = z
  .object({
    password: z.string().min(8).max(256),
  })
  .strict();
const idParamsSchema = z.object({ id: z.uuid() });
const resourceListQuerySchema = z.object({
  q: z.string().max(240).optional(),
  cohortYear: z.coerce.number().int().min(2000).max(2100).optional(),
  provinceId: z.uuid().optional(),
  cityId: z.uuid().optional(),
  companyId: z.uuid().optional(),
  destinationProvinceId: z.uuid().optional(),
  destinationCompanyId: z.uuid().optional(),
}).passthrough();

const earlyBatchYearQuerySchema = z
  .object({
    cohortYear: z.coerce.number().int().min(2020).max(2100).optional(),
    year: z.coerce.number().int().min(2020).max(2100).optional(),
    // Kept temporarily so older bookmarked URLs fail with a clear data-year error
    // instead of silently projecting 2026 rules into another cohort.
    policyReferenceYear: z.coerce.number().int().min(2020).max(2100).optional(),
    targetCohortYear: z.coerce.number().int().min(2020).max(2100).optional(),
  })
  .passthrough();

const earlyBatchSchoolSearchSchema = z
  .object({
    q: z.string().trim().min(1).max(100),
    limit: z.number().int().min(1).max(20).default(10),
  })
  .strict();

const earlyBatchApplicantSchema = z
  .object({
    schoolKey: z.string().trim().min(1).max(160).optional(),
    schoolName: z.string().trim().min(1).max(240).optional(),
    schoolProvinceAdcode: z.string().regex(/^\d{6}$/).optional(),
    schoolTags: z.array(z.enum(earlyBatchSchoolTags)).max(4).optional(),
    schoolTagsConfirmed: z.boolean().optional(),
    degree: z.enum(['bachelor', 'master', 'doctor']),
    majorCategory: z
      .enum([
        'electrical',
        'computer',
        'communication',
        'electronic_information',
        'artificial_intelligence',
        'finance',
        'human_resources',
        'law',
        'other_engineering',
        'other',
      ])
      .optional(),
    freshGraduate: z.boolean().optional(),
    graduationYear: z.number().int().min(2020).max(2100).optional(),
    fullTime: z.boolean().optional(),
    computerLevel2: z.boolean().optional(),
    cet4OrHigher: z.boolean().optional(),
    cet6OrHigher: z.boolean().optional(),
    certificatesObtainedBeforeApplication: z.boolean().optional(),
    nationalUnifiedAdmission: z.boolean().optional(),
    majorMatchesEnrollment: z.boolean().optional(),
    age: z.number().int().min(16).max(80).optional(),
    hasFailedCourses: z.boolean().optional(),
    gradesAcceptable: z.boolean().optional(),
  })
  .strict();

const earlyBatchEvaluateSchema = z
  .object({
    cohortYear: z.number().int().min(2020).max(2100).optional(),
    year: z.number().int().min(2020).max(2100).optional(),
    // Deprecated compatibility inputs; any non-2026 value is rejected below.
    policyReferenceYear: z.number().int().min(2020).max(2100).optional(),
    targetCohortYear: z.number().int().min(2020).max(2100).optional(),
    targetCodes: z
      .array(z.string().trim().min(3).max(120).regex(/^[A-Z0-9-]+$/))
      .max(30)
      .optional(),
    applicant: earlyBatchApplicantSchema,
  })
  .strict();

const EARLY_BATCH_DISCLAIMER =
  '结果仅表示是否符合上传的2026年业务参考表中已列条件，不代表国家电网或招聘单位官方资格审查结论；请以当批官方公告为准。';
const EARLY_BATCH_COHORT_YEAR = 2026;

type EarlyBatchTemporalContext = {
  cohortYear: typeof EARLY_BATCH_COHORT_YEAR;
  dataStatus: 'uploaded_reference_unverified';
};

function earlyBatchTemporalContext(input: unknown): EarlyBatchTemporalContext {
  const parsed = earlyBatchYearQuerySchema.parse(input ?? {});
  const requestedYears = [
    parsed.cohortYear,
    parsed.year,
    parsed.policyReferenceYear,
    parsed.targetCohortYear,
  ].filter((value): value is number => value !== undefined);
  if (requestedYears.some((value) => value !== EARLY_BATCH_COHORT_YEAR)) {
    throw new ApiError(
      422,
      'EARLY_BATCH_YEAR_NOT_AVAILABLE',
      '当前仅收录2026届提前批上传表；其他届别须取得对应官方材料后再录入。',
    );
  }
  return {
    cohortYear: EARLY_BATCH_COHORT_YEAR,
    dataStatus: 'uploaded_reference_unverified',
  };
}

function earlyBatchDisclaimer(_context: EarlyBatchTemporalContext): string {
  return EARLY_BATCH_DISCLAIMER;
}

function cookieOptions(config: AppConfig, path: string) {
  return {
    path,
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'strict' as const,
    maxAge: config.sessionTtlSeconds,
  };
}

function clearCookieOptions(config: AppConfig, path: string) {
  return {
    path,
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'strict' as const,
  };
}

function isSessionActive(session: { revokedAt: Date | null; expiresAt: Date }): boolean {
  return !session.revokedAt && session.expiresAt.getTime() > Date.now();
}

function publicAdmin(session: AdminSessionRecord) {
  return {
    id: session.admin.id,
    username: session.admin.username,
    role: session.admin.role,
  };
}

function publicUser(user: UserRecord, config: AppConfig) {
  let phone: string | undefined;
  try {
    phone = decryptPhone(user.phoneCiphertext, config.phoneEncryptionKey);
  } catch {
    phone = undefined;
  }
  return {
    id: user.id,
    phoneMasked: phone ? maskPhone(phone) : `***${user.phoneLast4}`,
    displayName: user.displayName,
    enabled: user.enabled,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

function requestFingerprint(request: FastifyRequest, config: AppConfig) {
  return {
    ipHash: secretDigest(request.ip, config.sessionSecret),
    userAgentHash: sha256(String(request.headers['user-agent'] ?? 'unknown')),
  };
}

function adminSessionResponse(context: AdminContext) {
  return {
    authenticated: true,
    admin: publicAdmin(context.record),
    csrfToken: context.csrfToken,
    expiresAt: context.record.expiresAt.toISOString(),
  };
}

function userSessionResponse(context: UserContext, config: AppConfig) {
  return {
    authenticated: true,
    user: publicUser(context.record.user, config),
    csrfToken: context.csrfToken,
    expiresAt: context.record.expiresAt.toISOString(),
  };
}

function earlyBatchSource(policy: EarlyBatchPolicyRecord) {
  return {
    status: policy.sourceStatus,
    documentKey: policy.sourceDocumentKey,
    documentTitle: policy.sourceDocumentTitle,
    officialUrl: policy.sourceDocumentOfficialUrl,
    range: policy.sourceLocator,
    locators: sourceLocators(policy.sourceLocator),
    revisionKey: policy.revisionKey,
    revisionDataStatus: policy.revisionDataStatus,
  };
}

function earlyBatchTarget(policy: EarlyBatchPolicyRecord) {
  return {
    kind: policy.targetKind,
    code: policy.targetCode,
    name: policy.targetName,
    provinceAdcode: policy.provinceAdcode,
    parentProvinceAdcode: policy.parentProvinceAdcode,
  };
}

function earlyBatchPolicyPayload(
  policy: EarlyBatchPolicyRecord,
  context?: EarlyBatchTemporalContext,
) {
  return {
    id: policy.id,
    policyKey: policy.policyKey,
    year: policy.cohortYear,
    ...(context
      ? {
          cohortYear: context.cohortYear,
          dataStatus: context.dataStatus,
        }
      : {}),
    batchCode: policy.batchCode,
    target: earlyBatchTarget(policy),
    requirements: policy.recruitmentRequirements,
    process: policy.recruitmentProcess,
    plannedHeadcount: policy.plannedHeadcountDisplay,
    assessmentMethod: policy.assessmentMethod,
    itinerary: policy.itineraryReference,
    siteQuota: policy.siteQuotaDisplay,
    admissionRule: policy.admissionRule,
    actualHeadcount: policy.actualHeadcountDisplay,
    notes: policy.otherNotes,
    missingFields: policy.missingFields,
    eligibilityModel: policy.eligibilityModel,
    evidenceAssets: policy.evidenceAssets,
    externalEvidence: policy.externalEvidence,
    source: earlyBatchSource(policy),
    metadata: policy.metadata,
    updatedAt: policy.updatedAt,
  };
}

async function auditRequest(
  store: DataStore,
  config: AppConfig,
  request: FastifyRequest,
  input: {
    actorType: 'admin' | 'user' | 'system' | 'anonymous';
    actorId?: string | null;
    action: string;
    resourceType?: string | null;
    resourceId?: string | null;
    outcome: 'success' | 'failure';
    metadata?: Record<string, unknown>;
  },
) {
  await store.audit({
    ...input,
    requestId: request.id,
    ...requestFingerprint(request, config),
  });
}

export async function buildApp(options: {
  config: AppConfig;
  store: DataStore;
  logger?: boolean;
}): Promise<FastifyInstance> {
  const { config, store } = options;
  const app = Fastify({
    logger: options.logger ?? false,
    // Express semantics: TRUST_PROXY_HOPS=N trusts the N nearest hops. Using
    // `<=` trusted one hop too many, so behind a single Caddy the client's own
    // X-Forwarded-For entry became request.ip — letting anyone mint a fresh
    // rate-limit bucket per request and brute-force the login endpoints.
    trustProxy: (_address: string, hop: number) => hop < config.trustProxyHops,
    bodyLimit: 2 * 1024 * 1024,
    requestIdHeader: 'x-request-id',
  });
  app.decorateRequest('adminContext', null);
  app.decorateRequest('userContext', null);

  // Authentication, parsing and rate-limit failures can finish before a route
  // handler runs. Apply the policy at the response boundary so both those
  // responses and unknown routes cannot be cached by a browser or proxy.
  app.addHook('onSend', async (_request, reply, payload) => {
    noStore(reply);
    return payload;
  });

  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-site' },
  });
  await app.register(cors, {
    credentials: true,
    origin(origin, callback) {
      if (!origin || config.publicOrigins.includes(origin)) callback(null, true);
      else callback(null, false);
    },
    allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'X-Request-Id'],
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });
  await app.register(rateLimit, {
    global: true,
    max: 240,
    timeWindow: '1 minute',
    keyGenerator: (request) => secretDigest(request.ip, config.sessionSecret),
  });

  app.addHook('onRequest', async (request) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return;
    const origin = request.headers.origin;
    if (origin && !config.publicOrigins.includes(origin)) {
      throw new ApiError(403, 'ORIGIN_NOT_ALLOWED', '请求来源不受信任');
    }
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) {
      return reply.status(error.statusCode).send({ error: { code: error.code, message: error.message } });
    }
    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: '请求参数无效', details: error.issues },
      });
    }
    // Drizzle wraps pg errors in Error.cause and includes query parameters in
    // its message. Resolve only SQLSTATE; never log the wrapper's SQL/params.
    let databaseCode: string | undefined;
    let databaseError: unknown = error;
    for (let depth = 0; depth < 5 && databaseError && typeof databaseError === 'object'; depth += 1) {
      const item = databaseError as { code?: unknown; cause?: unknown };
      if (typeof item.code === 'string' && /^[0-9A-Z]{5}$/.test(item.code)) {
        databaseCode = item.code;
        break;
      }
      databaseError = item.cause;
    }
    if (databaseCode === '23505') {
      return reply.status(409).send({ error: { code: 'CONFLICT', message: '数据已存在' } });
    }
    if (databaseCode === '23503' || databaseCode === '23001') {
      return reply
        .status(409)
        .send({ error: { code: 'RESOURCE_IN_USE', message: '该数据仍被其他记录引用，无法删除' } });
    }
    if (databaseCode) {
      request.log.error({ databaseCode }, 'database request failed');
      return reply.status(500).send({ error: { code: 'INTERNAL_ERROR', message: '服务暂时不可用' } });
    }
    // Framework errors (rate limit 429, body limit 413, malformed JSON 400)
    // carry their own statusCode. Falling straight through to 500 hid them
    // from callers and logged every throttled request at error level.
    const frameworkStatus = (error as { statusCode?: number }).statusCode;
    if (typeof frameworkStatus === 'number' && frameworkStatus >= 400 && frameworkStatus < 500) {
      const code =
        frameworkStatus === 429
          ? 'RATE_LIMITED'
          : ((error as { code?: string }).code ?? 'BAD_REQUEST');
      const message =
        frameworkStatus === 429
          ? '请求过于频繁，请稍后再试'
          : frameworkStatus === 413
            ? '请求内容过大'
            : '请求无效';
      request.log.warn({ err: error, statusCode: frameworkStatus }, 'request rejected');
      return reply.status(frameworkStatus).send({ error: { code, message } });
    }
    request.log.error({ err: error }, 'request failed');
    return reply.status(500).send({ error: { code: 'INTERNAL_ERROR', message: '服务暂时不可用' } });
  });

  const fakePasswordHash = hashPassword(randomToken());

  async function requireAdmin(request: FastifyRequest): Promise<void> {
    const rawToken = request.cookies[ADMIN_COOKIE];
    if (!rawToken) throw new ApiError(401, 'ADMIN_AUTH_REQUIRED', '需要管理员登录');
    const record = await store.findAdminSession(secretDigest(rawToken, config.sessionSecret));
    if (!record || !isSessionActive(record) || !record.admin.enabled) {
      throw new ApiError(401, 'ADMIN_SESSION_INVALID', '管理员会话已失效');
    }
    request.adminContext = {
      record,
      rawToken,
      csrfToken: csrfForSession(rawToken, config.sessionSecret),
    };
  }

  // Defense in depth for old snapshots or newly added audience routes. Static
  // GeoJSON is intentionally excluded: it contains no source material and is
  // large enough that walking every coordinate would hurt touch interaction.
  app.addHook('preSerialization', async (request, reply, payload) => {
    // Error envelopes have already been reduced to safe public messages by
    // setErrorHandler. Loading source metadata for a rejected request adds a
    // needless DB dependency and can replace a clean 401 with a raw DB error.
    if (reply.statusCode >= 400) return payload;
    const path = request.url.split('?', 1)[0] ?? '';
    if (!/^\/api\/v2\/(?:public|private)\//.test(path) || path.startsWith('/api/v2/private/map-geojson/')) return payload;
    const index = privateSourceIndex(await store.adminOnlySources());
    return stripPrivateSourceMaterial(payload, index) ?? {};
  });

  async function validateResourceRelations(
    resource: ResourceName,
    state: Record<string, unknown>,
  ): Promise<void> {
    if (resource !== 'sources' && resource !== 'source-documents') {
      const index = privateSourceIndex(await store.adminOnlySources());
      const indirect = await Promise.all([
        typeof state.revisionId === 'string' ? store.getResource('revisions', state.revisionId) : null,
        typeof state.batchId === 'string' ? store.getResource('recruitment-batches', state.batchId) : null,
      ]);
      if (containsPrivateSourceReference([state, ...indirect], index)) {
        throw new ApiError(400, 'SOURCE_ADMIN_ONLY', '该来源仅供管理员核验，不能关联业务事实或报考资格规则');
      }
    }
    if (
      ![
        'schools',
        'companies',
        'recruitment-batches',
        'recruitment-metrics',
        'recruitment-events',
        'recruitment-requirements',
      ].includes(resource)
    ) {
      return;
    }

    const scopeKind = String(state.scopeKind ?? 'province_company');
    const destinationScope = String(state.destinationScope ?? 'province_company');
    const effectiveScope = resource === 'recruitment-metrics' ? destinationScope : scopeKind;
    const provinceId = typeof state.provinceId === 'string' ? state.provinceId : null;
    const cityId = typeof state.cityId === 'string' ? state.cityId : null;
    const companyId = typeof state.companyId === 'string' ? state.companyId : null;

    if (
      resource === 'recruitment-events' &&
      !RECRUITMENT_EVENT_TYPES.has(String(state.eventType ?? ''))
    ) {
      throw new ApiError(
        400,
        'RECRUITMENT_EVENT_TYPE_INVALID',
        '时间节点类型不在可维护的招聘节点分类中',
      );
    }
    if (resource === 'recruitment-requirements') {
      const category = String(state.category ?? '');
      if (!RECRUITMENT_REQUIREMENT_CATEGORIES.has(category)) {
        throw new ApiError(
          400,
          'REQUIREMENT_CATEGORY_INVALID',
          '招聘要求类别不在标准分类中',
        );
      }
      const rawTags = Array.isArray(state.categoryTags) ? state.categoryTags : [];
      const tags = [...new Set(rawTags.map((value) => String(value)))];
      if (!tags.length) tags.push(category);
      if (
        tags.some((tag) => !RECRUITMENT_REQUIREMENT_CATEGORIES.has(tag)) ||
        !tags.includes(category)
      ) {
        throw new ApiError(
          400,
          'REQUIREMENT_CATEGORY_TAGS_INVALID',
          '同组要求标签必须使用标准分类且包含主类别',
        );
      }
      state.categoryTags = tags;
    }

    const isScopedRecruitmentResource = [
      'recruitment-metrics',
      'recruitment-events',
      'recruitment-requirements',
    ].includes(resource);
    if (isScopedRecruitmentResource && effectiveScope === 'province_company' && (!provinceId || !companyId)) {
      throw new ApiError(
        400,
        'RECRUITMENT_SCOPE_INCOMPLETE',
        '省份/单位口径必须同时填写省份和国网单位',
      );
    }
    if (isScopedRecruitmentResource && effectiveScope === 'province' && !provinceId) {
      throw new ApiError(400, 'PROVINCE_SCOPE_REQUIRED', '省份口径必须选择省份');
    }
    if (isScopedRecruitmentResource && effectiveScope === 'province' && companyId) {
      throw new ApiError(400, 'PROVINCE_SCOPE_MUST_NOT_BIND_COMPANY', '省份总口径不得绑定单一单位');
    }
    if (isScopedRecruitmentResource && effectiveScope === 'company' && !companyId) {
      throw new ApiError(400, 'COMPANY_SCOPE_REQUIRED', '单位口径必须选择国网单位');
    }
    if (isScopedRecruitmentResource && effectiveScope === 'special_unit' && !companyId) {
      throw new ApiError(400, 'SPECIAL_UNIT_COMPANY_REQUIRED', '直属/特殊单位口径必须选择单位');
    }
    if (isScopedRecruitmentResource && ['national', 'network_total'].includes(effectiveScope) && (provinceId || companyId)) {
      throw new ApiError(
        400,
        'NATIONAL_SCOPE_MUST_NOT_BIND_PROVINCE',
        '全国口径不得绑定单一省份或单位',
      );
    }
    if (isScopedRecruitmentResource && effectiveScope === 'unknown' && (provinceId || companyId)) {
      throw new ApiError(400, 'UNKNOWN_SCOPE_MUST_NOT_BIND_LOCATION', '去向待核口径不得绑定未证实的省份或单位');
    }

    const [province, city, company] = await Promise.all([
      provinceId ? store.getResource('provinces', provinceId) : Promise.resolve(null),
      cityId ? store.getResource('cities', cityId) : Promise.resolve(null),
      companyId ? store.getResource('companies', companyId) : Promise.resolve(null),
    ]);
    if (provinceId && !province) {
      throw new ApiError(400, 'RECRUITMENT_PROVINCE_NOT_FOUND', '招聘省份不存在');
    }
    if (companyId && !company) {
      throw new ApiError(400, 'RECRUITMENT_COMPANY_NOT_FOUND', '招聘单位不存在');
    }
    if (cityId && !provinceId) {
      throw new ApiError(400, 'CITY_REQUIRES_PROVINCE', '选择城市时必须同时保留所属省份');
    }
    if (cityId && !city) {
      throw new ApiError(400, 'RECRUITMENT_CITY_NOT_FOUND', '城市不存在');
    }
    if (provinceId && city?.provinceId && city.provinceId !== provinceId) {
      throw new ApiError(400, 'RECRUITMENT_CITY_PROVINCE_MISMATCH', '城市与所选省份不一致');
    }
    if (provinceId && company?.provinceId && company.provinceId !== provinceId) {
      throw new ApiError(
        400,
        'RECRUITMENT_COMPANY_PROVINCE_MISMATCH',
        '招聘单位与所选省份不一致',
      );
    }

    if (resource === 'recruitment-batches' && (!provinceId || !companyId)) {
      throw new ApiError(400, 'RECRUITMENT_SCOPE_INCOMPLETE', '招聘批次必须同时关联省份和单位');
    }

    const sourceDocumentId =
      typeof state.sourceDocumentId === 'string' ? state.sourceDocumentId : null;
    const primarySource = sourceDocumentId
      ? await store.getResource('sources', sourceDocumentId)
      : null;
    if (sourceDocumentId && !primarySource) {
      throw new ApiError(400, 'RECRUITMENT_SOURCE_NOT_FOUND', '关联的来源文档不存在');
    }

    const sourceBoundResources = [
      'recruitment-batches',
      'recruitment-metrics',
      'recruitment-events',
      'recruitment-requirements',
    ];
    if (sourceBoundResources.includes(resource) && primarySource) {
      const rawSourceKeys = Array.isArray(state.sourceKeys)
        ? state.sourceKeys.map((value) => String(value))
        : [];
      const sourceKeys = [...new Set(rawSourceKeys)];
      const primarySourceKey = String(primarySource.sourceKey ?? '');
      if (!primarySourceKey || !sourceKeys.includes(primarySourceKey)) {
        throw new ApiError(
          400,
          'RECRUITMENT_PRIMARY_SOURCE_KEY_MISSING',
          '全部来源键必须包含主要来源文档的唯一键',
        );
      }
      const resolvedSources = await Promise.all(
        sourceKeys.map(async (sourceKey) => ({
          sourceKey,
          source: await store.findSourceByKey(sourceKey),
        })),
      );
      const missingSource = resolvedSources.find((entry) => !entry.source);
      if (missingSource) {
        throw new ApiError(
          400,
          'RECRUITMENT_SOURCE_KEY_NOT_FOUND',
          `来源键未关联已登记来源：${missingSource.sourceKey}`,
        );
      }
      const factYear = typeof state.cohortYear === 'number' ? state.cohortYear : null;
      const factBatch = typeof state.batchCode === 'string'
        ? state.batchCode
        : typeof state.code === 'string'
          ? state.code
          : null;
      for (const entry of resolvedSources) {
        const source = entry.source!;
        const sourceYear = typeof source.cohortYear === 'number' ? source.cohortYear : null;
        if (factYear !== null && sourceYear !== null && factYear !== sourceYear) {
          throw new ApiError(
            400,
            'RECRUITMENT_SOURCE_YEAR_MISMATCH',
            '来源文档届别与招聘事实届别不一致',
          );
        }
        const sourceBatch = typeof source.batchCode === 'string' ? source.batchCode : null;
        if (
          factBatch &&
          sourceBatch &&
          CONCRETE_RECRUITMENT_BATCHES.has(factBatch) &&
          CONCRETE_RECRUITMENT_BATCHES.has(sourceBatch) &&
          factBatch !== sourceBatch
        ) {
          throw new ApiError(
            400,
            'RECRUITMENT_SOURCE_BATCH_MISMATCH',
            '来源文档批次与招聘事实批次不一致',
          );
        }
      }
      state.sourceKeys = sourceKeys;
    }

    const batchId = typeof state.batchId === 'string' ? state.batchId : null;
    if (batchId) {
      const batch = await store.getResource('recruitment-batches', batchId);
      if (
        !batch ||
        batch.code !== state.batchCode ||
        batch.cohortYear !== state.cohortYear ||
        (state.provinceId && batch.provinceId !== state.provinceId) ||
        (state.companyId && batch.companyId !== state.companyId)
      ) {
        throw new ApiError(
          400,
          'RECRUITMENT_BATCH_SCOPE_INVALID',
          '年份、批次、省份和单位必须与关联批次一致',
        );
      }
    }
    if (resource === 'recruitment-events' && scopeKind === 'province_company' && !batchId) {
      throw new ApiError(400, 'EVENT_BATCH_REQUIRED', '省级时间节点必须关联对应批次');
    }
    if (resource === 'recruitment-requirements' && scopeKind === 'province_company') {
      const batches = await store.listResource('recruitment-batches', {
        limit: 2,
        offset: 0,
        cohortYear: Number(state.cohortYear),
        batchCode: String(state.batchCode),
        ...(provinceId ? { provinceId } : {}),
        ...(companyId ? { companyId } : {}),
      });
      if (!batches.total) {
        throw new ApiError(
          400,
          'REQUIREMENT_BATCH_SCOPE_INVALID',
          '招聘要求的届别、批次、省份和单位没有对应批次记录',
        );
      }
    }

    if (resource !== 'recruitment-metrics') return;
    const isSchoolPublicFact =
      typeof state.schoolId === 'string' &&
      ['public_notice_record_count', 'batch_share'].includes(String(state.metricType));
    if (!isSchoolPublicFact) return;
    if (!Array.isArray(state.sourceKeys) || !state.sourceKeys.includes('public-selection-aggregate-2026')) {
      throw new ApiError(
        400,
        'SCHOOL_FACT_SOURCE_INVALID',
        '学校公示指标必须关联脱敏公示汇总来源',
      );
    }
  }

  async function requireAdminCsrf(request: FastifyRequest): Promise<void> {
    if (!request.adminContext) await requireAdmin(request);
    const supplied = String(request.headers['x-csrf-token'] ?? '');
    if (!request.adminContext || !safeEqual(supplied, request.adminContext.csrfToken)) {
      throw new ApiError(403, 'CSRF_INVALID', '安全校验失败');
    }
  }

  async function requireUser(request: FastifyRequest): Promise<void> {
    const rawToken = request.cookies[USER_COOKIE];
    if (!rawToken) throw new ApiError(401, 'AUTH_REQUIRED', '需要登录');
    const record = await store.findUserSession(secretDigest(rawToken, config.sessionSecret));
    if (!record || !isSessionActive(record) || !record.user.enabled || record.user.deletedAt) {
      throw new ApiError(401, 'SESSION_INVALID', '用户会话已失效');
    }
    request.userContext = {
      record,
      rawToken,
      csrfToken: csrfForSession(rawToken, config.sessionSecret),
    };
  }

  async function requireUserCsrf(request: FastifyRequest): Promise<void> {
    if (!request.userContext) await requireUser(request);
    const supplied = String(request.headers['x-csrf-token'] ?? '');
    if (!request.userContext || !safeEqual(supplied, request.userContext.csrfToken)) {
      throw new ApiError(403, 'CSRF_INVALID', '安全校验失败');
    }
  }

  async function resolveEarlyBatchApplicant(input: EarlyBatchApplicant): Promise<{
    applicant: EarlyBatchApplicant;
    school: {
      status:
        | 'matched_by_key'
        | 'matched_by_exact_name'
        | 'ambiguous'
        | 'not_found'
        | 'not_provided';
      selected: EarlyBatchSchoolDescriptor | null;
      candidates: EarlyBatchSchoolDescriptor[];
      tagBasis: EarlyBatchSchoolTagBasis;
      tagsConfirmed: boolean;
      userConfirmedTags: boolean;
    };
  }> {
    let selected: EarlyBatchSchoolDescriptor | null = null;
    let candidates: EarlyBatchSchoolDescriptor[] = [];
    let status: 'matched_by_key' | 'matched_by_exact_name' | 'ambiguous' | 'not_found' | 'not_provided' =
      'not_provided';
    if (input.schoolKey) {
      const row = await store.findEarlyBatchSchool(input.schoolKey);
      if (row) {
        selected = describeEarlyBatchSchool(row);
        status = 'matched_by_key';
      } else {
        status = 'not_found';
      }
    } else if (input.schoolName) {
      const rows = await store.searchEarlyBatchSchools(input.schoolName, 20);
      candidates = rows.map(describeEarlyBatchSchool);
      const wanted = normalizeSchoolName(input.schoolName);
      const exact = candidates.filter((item) => normalizeSchoolName(item.name) === wanted);
      if (exact.length === 1) {
        selected = exact[0]!;
        status = 'matched_by_exact_name';
      } else if (exact.length > 1) {
        status = 'ambiguous';
      } else {
        status = 'not_found';
      }
    }

    const userConfirmedTags = input.schoolTagsConfirmed === true;
    const selectedTags = [...new Set(selected?.schoolTags ?? [])];
    const hasExplicitTags = input.schoolTags !== undefined;
    const explicitTags = [...new Set(input.schoolTags ?? [])];
    const selectedTagsVerified = selected?.tagSourceStatus === 'verified';
    const explicitMatchesDataset = hasExplicitTags
      && explicitTags.length === selectedTags.length
      && explicitTags.every((tag) => selectedTags.includes(tag));
    let resolvedTags: EarlyBatchApplicant['schoolTags'];
    let tagBasis: EarlyBatchSchoolTagBasis = 'unresolved';

    if (selectedTagsVerified && (!userConfirmedTags || !hasExplicitTags || explicitMatchesDataset)) {
      resolvedTags = selectedTags;
      tagBasis = 'dataset_verified';
    } else if (userConfirmedTags) {
      resolvedTags = hasExplicitTags ? explicitTags : selectedTags;
      tagBasis = 'user_confirmed';
    }
    const { schoolTags: _ignoredSchoolTags, ...withoutTags } = input;
    const applicant: EarlyBatchApplicant = {
      ...withoutTags,
      ...(selected ? { schoolKey: selected.schoolKey, schoolName: selected.name } : {}),
      ...(selected?.provinceAdcode
        ? { schoolProvinceAdcode: selected.provinceAdcode }
        : {}),
      ...(resolvedTags !== undefined ? { schoolTags: resolvedTags } : {}),
    };
    return {
      applicant,
      school: {
        status,
        selected,
        candidates,
        tagBasis,
        tagsConfirmed: tagBasis !== 'unresolved',
        userConfirmedTags,
      },
    };
  }

  app.get('/healthz', async () => {
    await store.health();
    return { ok: true, service: 'recruitment-platform-api', version: '2.0.0' };
  });
  app.get('/api/v2/healthz', async () => {
    await store.health();
    return { ok: true, service: 'recruitment-platform-api', version: '2.0.0' };
  });

  app.post(
    '/api/v2/admin/auth/login',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (request, reply) => {
      noStore(reply);
      const body = adminLoginSchema.parse(request.body);
      const admin = await store.findAdminByUsername(body.username);
      const valid = await verifyPassword(admin?.passwordHash ?? (await fakePasswordHash), body.password);
      if (!admin || !admin.enabled || !valid) {
        await auditRequest(store, config, request, {
          actorType: 'anonymous',
          action: 'admin.login',
          outcome: 'failure',
          metadata: { usernameHash: sha256(body.username.toLowerCase()) },
        });
        throw new ApiError(401, 'INVALID_CREDENTIALS', '账号或密码错误');
      }
      const rawToken = randomToken();
      const csrfToken = csrfForSession(rawToken, config.sessionSecret);
      const expiresAt = new Date(Date.now() + config.sessionTtlSeconds * 1000);
      await store.createAdminSession(admin.id, {
        tokenHash: secretDigest(rawToken, config.sessionSecret),
        csrfHash: secretDigest(csrfToken, config.sessionSecret),
        expiresAt,
        ...requestFingerprint(request, config),
      });
      await store.markAdminLogin(admin.id);
      await auditRequest(store, config, request, {
        actorType: 'admin',
        actorId: admin.id,
        action: 'admin.login',
        outcome: 'success',
      });
      reply.setCookie(ADMIN_COOKIE, rawToken, cookieOptions(config, '/api/v2/admin'));
      const record = await store.findAdminSession(secretDigest(rawToken, config.sessionSecret));
      if (!record) throw new ApiError(500, 'SESSION_CREATE_FAILED', '会话创建失败');
      return adminSessionResponse({ record, rawToken, csrfToken });
    },
  );

  app.get('/api/v2/admin/auth/me', { preHandler: requireAdmin }, async (request, reply) => {
    noStore(reply);
    return adminSessionResponse(request.adminContext!);
  });

  app.post(
    '/api/v2/admin/auth/logout',
    { preHandler: [requireAdmin, requireAdminCsrf] },
    async (request, reply) => {
      await store.revokeAdminSession(secretDigest(request.adminContext!.rawToken, config.sessionSecret));
      await auditRequest(store, config, request, {
        actorType: 'admin',
        actorId: request.adminContext!.record.admin.id,
        action: 'admin.logout',
        outcome: 'success',
      });
      reply.clearCookie(ADMIN_COOKIE, clearCookieOptions(config, '/api/v2/admin'));
      return reply.status(204).send();
    },
  );

  app.get('/api/v2/admin/users', { preHandler: requireAdmin }, async (request, reply) => {
    noStore(reply);
    const query = (request.query ?? {}) as Record<string, unknown>;
    const { limit, offset } = paginationFromQuery(query);
    const enabled = query.enabled === 'true' ? true : query.enabled === 'false' ? false : undefined;
    const rawQ = typeof query.q === 'string' ? query.q.trim() : '';
    let phoneHash: string | undefined;
    let phoneLast4: string | undefined;
    let displayName: string | undefined;
    if (rawQ.length > 120) throw new ApiError(400, 'INVALID_USER_SEARCH', '搜索内容最多120个字符');
    if (rawQ) {
      try {
        phoneHash = phoneLookupHash(normalizePhone(rawQ), config.phonePepper);
      } catch {
        if (/^\d{4}$/.test(rawQ)) phoneLast4 = rawQ;
        else if (/^[\d\s+()-]+$/.test(rawQ)) {
          throw new ApiError(400, 'INVALID_USER_SEARCH', '请输入完整手机号或4位尾号');
        } else displayName = rawQ;
      }
    }
    const result = await store.listUsers({
      limit,
      offset,
      ...(enabled === undefined ? {} : { enabled }),
      ...(phoneHash ? { phoneLookupHash: phoneHash } : {}),
      ...(phoneLast4 ? { phoneLast4 } : {}),
      ...(displayName ? { displayName } : {}),
    });
    return { items: result.items.map((user) => publicUser(user, config)), total: result.total, limit, offset };
  });

  app.post(
    '/api/v2/admin/users',
    { preHandler: [requireAdmin, requireAdminCsrf] },
    async (request, reply) => {
      const body = userCreateSchema.parse(request.body);
      let phone: string;
      try {
        phone = normalizePhone(body.phone);
      } catch {
        throw new ApiError(400, 'INVALID_PHONE', '手机号格式无效');
      }
      const passwordHash = await hashPassword(body.password);
      const user = await store.createUser({
        phoneLookupHash: phoneLookupHash(phone, config.phonePepper),
        phoneCiphertext: encryptPhone(phone, config.phoneEncryptionKey),
        phoneLast4: phone.slice(-4),
        ...(body.displayName === undefined ? {} : { displayName: body.displayName }),
        passwordHash,
        createdByAdminId: request.adminContext!.record.admin.id,
      });
      await auditRequest(store, config, request, {
        actorType: 'admin',
        actorId: request.adminContext!.record.admin.id,
        action: 'user.create',
        resourceType: 'user',
        resourceId: user.id,
        outcome: 'success',
        metadata: { phoneLast4: user.phoneLast4 },
      });
      return reply.status(201).send({ user: publicUser(user, config) });
    },
  );

  app.patch(
    '/api/v2/admin/users/:id',
    { preHandler: [requireAdmin, requireAdminCsrf] },
    async (request) => {
      const { id } = idParamsSchema.parse(request.params);
      const patch = userPatchSchema.parse(request.body);
      const storePatch: { enabled?: boolean; displayName?: string | null } = {};
      if (patch.enabled !== undefined) storePatch.enabled = patch.enabled;
      if (patch.displayName !== undefined) storePatch.displayName = patch.displayName;
      const user = await store.updateUser(id, storePatch);
      if (!user) throw new ApiError(404, 'USER_NOT_FOUND', '用户不存在');
      await auditRequest(store, config, request, {
        actorType: 'admin',
        actorId: request.adminContext!.record.admin.id,
        action: patch.enabled === false ? 'user.disable' : patch.enabled === true ? 'user.enable' : 'user.update',
        resourceType: 'user',
        resourceId: id,
        outcome: 'success',
      });
      return { user: publicUser(user, config) };
    },
  );

  app.post(
    '/api/v2/admin/users/:id/reset-password',
    { preHandler: [requireAdmin, requireAdminCsrf] },
    async (request) => {
      const { id } = idParamsSchema.parse(request.params);
      const body = resetPasswordSchema.parse(request.body ?? {});
      const user = await store.resetUserPassword(id, await hashPassword(body.password));
      if (!user) throw new ApiError(404, 'USER_NOT_FOUND', '用户不存在');
      await auditRequest(store, config, request, {
        actorType: 'admin',
        actorId: request.adminContext!.record.admin.id,
        action: 'user.reset-password',
        resourceType: 'user',
        resourceId: id,
        outcome: 'success',
      });
      return { user: publicUser(user, config) };
    },
  );

  app.delete(
    '/api/v2/admin/users/:id',
    { preHandler: [requireAdmin, requireAdminCsrf] },
    async (request, reply) => {
      const { id } = idParamsSchema.parse(request.params);
      const user = await store.softDeleteUser(id);
      if (!user) throw new ApiError(404, 'USER_NOT_FOUND', '用户不存在');
      await auditRequest(store, config, request, {
        actorType: 'admin',
        actorId: request.adminContext!.record.admin.id,
        action: 'user.delete',
        resourceType: 'user',
        resourceId: id,
        outcome: 'success',
      });
      return reply.status(204).send();
    },
  );

  const resources: CanonicalResourceName[] = exposedResources;
  for (const resource of resources) registerResourceRoutes(app, resource);

  app.get('/api/v2/admin/sources/:id/asset', { preHandler: requireAdmin }, async (request, reply) => {
    noStore(reply);
    reply.header('X-Content-Type-Options', 'nosniff');
    const { id } = idParamsSchema.parse(request.params);
    const source = await store.getResource('sources', id);
    if (!source) throw new ApiError(404, 'SOURCE_ASSET_NOT_FOUND', '该来源没有可读取的归档原图');
    const image = await readPrivateSourceAsset(source, config.privateSourceAssetDir);
    reply.type(image.contentType);
    return reply.send(image.bytes);
  });

  app.get('/api/v2/admin/dashboard', { preHandler: requireAdmin }, async (_request, reply) => {
    noStore(reply);
    const pendingByStatus = new Set<CanonicalResourceName>([
      'provinces',
      'cities',
      'schools',
      'companies',
      'recruitment-batches',
      'recruitment-events',
      'recruitment-requirements',
      'recruitment-metrics',
      'sources',
    ]);
    const resourceSummaries = await Promise.all(
      resources.map(async (resource) => {
        const [all, pending] = await Promise.all([
          store.listResource(resource as ResourceName, { limit: 1, offset: 0 }),
          resource === 'revisions'
            ? store.listResource(resource as ResourceName, {
                limit: 1,
                offset: 0,
                dataStatus: 'pending',
              })
            : pendingByStatus.has(resource)
              ? store.listResource(resource as ResourceName, {
                  limit: 1,
                  offset: 0,
                  statusPrefix: 'pending',
                })
              : Promise.resolve({ items: [], total: 0 }),
        ]);
        return {
          resource,
          total: all.total,
          pending: pending.total,
          updatedAt: all.items[0]?.updatedAt ?? null,
        };
      }),
    );
    const [userSummary, auditSummary, revisionSummary] = await Promise.all([
      store.listUsers({ limit: 1, offset: 0 }),
      store.listAudit({ limit: 1, offset: 0 }),
      store.listResource('revisions', { limit: 1, offset: 0 }),
    ]);
    return {
      resources: resourceSummaries,
      users: { total: userSummary.total, updatedAt: userSummary.items[0]?.updatedAt ?? null },
      auditEvents: {
        total: auditSummary.total,
        updatedAt: auditSummary.items[0]?.createdAt ?? null,
      },
      latestRevision: revisionSummary.items[0] ?? null,
      generatedAt: new Date().toISOString(),
    };
  });

  function registerResourceRoutes(instance: FastifyInstance, resource: CanonicalResourceName) {
    const path = `/api/v2/admin/${resource}`;
    instance.get(path, { preHandler: requireAdmin }, async (request, reply) => {
      noStore(reply);
      const query = resourceListQuerySchema.parse(request.query ?? {});
      const { limit, offset } = paginationFromQuery(query);
      const cohortYear = query.cohortYear === undefined ? undefined : Number(query.cohortYear);
      const filters: ResourceListInput = {
        limit,
        offset,
        ...(typeof query.q === 'string' && query.q ? { q: query.q } : {}),
        ...(typeof cohortYear === 'number' && Number.isInteger(cohortYear) ? { cohortYear } : {}),
        ...(typeof query.batchCode === 'string' ? { batchCode: query.batchCode } : {}),
        ...(typeof query.status === 'string' ? { status: query.status } : {}),
        ...(typeof query.statusPrefix === 'string' ? { statusPrefix: query.statusPrefix } : {}),
        ...(typeof query.publicationStatus === 'string'
          ? { publicationStatus: query.publicationStatus }
          : {}),
        ...(typeof query.dataStatus === 'string' ? { dataStatus: query.dataStatus } : {}),
        ...(typeof query.provinceId === 'string' ? { provinceId: query.provinceId } : {}),
        ...(typeof query.cityId === 'string' ? { cityId: query.cityId } : {}),
        ...(typeof query.companyId === 'string' ? { companyId: query.companyId } : {}),
        ...(typeof query.destinationProvinceId === 'string'
          ? { destinationProvinceId: query.destinationProvinceId }
          : {}),
        ...(typeof query.destinationCompanyId === 'string'
          ? { destinationCompanyId: query.destinationCompanyId }
          : {}),
        ...(typeof query.eventType === 'string' ? { eventType: query.eventType } : {}),
        ...(typeof query.category === 'string' ? { category: query.category } : {}),
        ...(typeof query.destinationScope === 'string'
          ? { destinationScope: query.destinationScope }
          : {}),
        ...(typeof query.disciplineGroup === 'string'
          ? { disciplineGroup: query.disciplineGroup }
          : {}),
        ...(typeof query.disciplineEvidenceStatus === 'string'
          ? { disciplineEvidenceStatus: query.disciplineEvidenceStatus }
          : {}),
        ...(typeof query.majorCategory === 'string' ? { majorCategory: query.majorCategory } : {}),
        ...(typeof query.majorEvidenceStatus === 'string'
          ? { majorEvidenceStatus: query.majorEvidenceStatus }
          : {}),
      };
      const result = await store.listResource(resource as ResourceName, filters);
      return { items: result.items, total: result.total, limit, offset };
    });

    instance.get(`${path}/:id`, { preHandler: requireAdmin }, async (request, reply) => {
      noStore(reply);
      const { id } = idParamsSchema.parse(request.params);
      const item = await store.getResource(resource as ResourceName, id);
      if (!item) throw new ApiError(404, 'RESOURCE_NOT_FOUND', '数据不存在');
      return { item };
    });

    instance.post(
      path,
      { preHandler: [requireAdmin, requireAdminCsrf] },
      async (request, reply) => {
        let body: Record<string, unknown>;
        try {
          body = parseResourceCreate(resource as ResourceName, request.body);
        } catch (error) {
          if (error instanceof ZodError) throw error;
          if ((error as Error).message === 'METRIC_VALUE_REQUIRED') {
            throw new ApiError(400, 'METRIC_VALUE_REQUIRED', '指标必须填写 value 或 displayValue');
          }
          throw error;
        }
        await validateResourceRelations(resource as ResourceName, body);
        if (resource === 'sources') body = pinnedSource(body);
        const item = await store.createResource(
          resource as ResourceName,
          body,
          request.adminContext!.record.admin.id,
        );
        await auditRequest(store, config, request, {
          actorType: 'admin',
          actorId: request.adminContext!.record.admin.id,
          action: 'resource.create',
          resourceType: resource,
          resourceId: String(item.id),
          outcome: 'success',
        });
        return reply.status(201).send({ item });
      },
    );

    instance.patch(
      `${path}/:id`,
      { preHandler: [requireAdmin, requireAdminCsrf] },
      async (request) => {
        const { id } = idParamsSchema.parse(request.params);
        let patch = parseResourcePatch(resource as ResourceName, request.body);
        const existing = await store.getResource(resource as ResourceName, id);
        if (!existing) throw new ApiError(404, 'RESOURCE_NOT_FOUND', '数据不存在');
        if (resource === 'sources') patch = pinnedSource(patch, existing);
        const nextState = { ...existing, ...patch };
        validateResourceState(resource as ResourceName, nextState);
        await validateResourceRelations(resource as ResourceName, nextState);
        if (resource === 'recruitment-requirements') {
          patch.categoryTags = nextState.categoryTags;
        }
        if (
          [
            'recruitment-batches',
            'recruitment-metrics',
            'recruitment-events',
            'recruitment-requirements',
          ].includes(resource)
        ) {
          patch.sourceKeys = nextState.sourceKeys;
        }
        const item = await store.updateResource(resource as ResourceName, id, patch);
        if (!item) throw new ApiError(404, 'RESOURCE_NOT_FOUND', '数据不存在');
        await auditRequest(store, config, request, {
          actorType: 'admin',
          actorId: request.adminContext!.record.admin.id,
          action: 'resource.update',
          resourceType: resource,
          resourceId: id,
          outcome: 'success',
        });
        return { item };
      },
    );

    instance.delete(
      `${path}/:id`,
      { preHandler: [requireAdmin, requireAdminCsrf] },
      async (request, reply) => {
        const { id } = idParamsSchema.parse(request.params);
        if (!(await store.deleteResource(resource as ResourceName, id))) {
          throw new ApiError(404, 'RESOURCE_NOT_FOUND', '数据不存在');
        }
        await auditRequest(store, config, request, {
          actorType: 'admin',
          actorId: request.adminContext!.record.admin.id,
          action: 'resource.delete',
          resourceType: resource,
          resourceId: id,
          outcome: 'success',
        });
        return reply.status(204).send();
      },
    );
  }

  function pinnedSource(input: Record<string, unknown>, existing?: Record<string, unknown>) {
    try { return pinPrivateSource(input, existing); }
    catch (error) {
      if ((error as Error).message === 'PRIVATE_SOURCE_KEY_IMMUTABLE') {
        throw new ApiError(400, 'PRIVATE_SOURCE_KEY_IMMUTABLE', '私有待核来源唯一键不能修改');
      }
      throw new ApiError(400, 'PRIVATE_SOURCE_TYPE_INVALID', '私有待核来源只能登记为参考资料或非官方图片');
    }
  }

  app.get('/api/v2/admin/audit-events', { preHandler: requireAdmin }, async (request, reply) => {
    noStore(reply);
    const query = (request.query ?? {}) as Record<string, unknown>;
    const { limit, offset } = paginationFromQuery(query);
    const result = await store.listAudit({
      limit,
      offset,
      ...(typeof query.actorType === 'string' ? { actorType: query.actorType } : {}),
      ...(typeof query.action === 'string' ? { action: query.action } : {}),
    });
    return { items: result.items, total: result.total, limit, offset };
  });

  app.post(
    '/api/v2/auth/login',
    { config: { rateLimit: { max: 8, timeWindow: '1 minute' } } },
    async (request, reply) => {
      noStore(reply);
      const body = userLoginSchema.parse(request.body);
      let phoneHash: string;
      try {
        phoneHash = phoneLookupHash(normalizePhone(body.phone), config.phonePepper);
      } catch {
        phoneHash = sha256(body.phone);
      }
      const user = await store.findUserByPhoneHash(phoneHash);
      const verifiedPasswordHash = user?.passwordHash ?? (await fakePasswordHash);
      const valid = await verifyPassword(verifiedPasswordHash, body.password);
      if (!user || !user.enabled || user.deletedAt || !valid) {
        await auditRequest(store, config, request, {
          actorType: 'anonymous',
          action: 'user.login',
          outcome: 'failure',
          metadata: { phoneInputHash: sha256(body.phone) },
        });
        throw new ApiError(401, 'INVALID_CREDENTIALS', '手机号或密码错误');
      }
      const rawToken = randomToken();
      const csrfToken = csrfForSession(rawToken, config.sessionSecret);
      const expiresAt = new Date(Date.now() + config.sessionTtlSeconds * 1000);
      await store.createUserSession(user.id, {
        tokenHash: secretDigest(rawToken, config.sessionSecret),
        csrfHash: secretDigest(csrfToken, config.sessionSecret),
        expiresAt,
        ...requestFingerprint(request, config),
      }, verifiedPasswordHash);
      await store.markUserLogin(user.id);
      await auditRequest(store, config, request, {
        actorType: 'user',
        actorId: user.id,
        action: 'user.login',
        outcome: 'success',
      });
      reply.setCookie(USER_COOKIE, rawToken, cookieOptions(config, '/api/v2'));
      const record = await store.findUserSession(secretDigest(rawToken, config.sessionSecret));
      if (!record) throw new ApiError(500, 'SESSION_CREATE_FAILED', '会话创建失败');
      return userSessionResponse({ record, rawToken, csrfToken }, config);
    },
  );

  app.get('/api/v2/auth/me', { preHandler: requireUser }, async (request, reply) => {
    noStore(reply);
    return userSessionResponse(request.userContext!, config);
  });

  app.post(
    '/api/v2/auth/logout',
    { preHandler: [requireUser, requireUserCsrf] },
    async (request, reply) => {
      await store.revokeUserSession(secretDigest(request.userContext!.rawToken, config.sessionSecret));
      await auditRequest(store, config, request, {
        actorType: 'user',
        actorId: request.userContext!.record.user.id,
        action: 'user.logout',
        outcome: 'success',
      });
      reply.clearCookie(USER_COOKIE, clearCookieOptions(config, '/api/v2'));
      return reply.status(204).send();
    },
  );

  app.get('/api/v2/public/dashboard', async (_request, reply) => {
    reply.header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    return store.publicDashboard();
  });

  app.get(
    '/api/v2/private/early-batch/catalog',
    { preHandler: requireUser },
    async (request, reply) => {
      noStore(reply);
      const context = earlyBatchTemporalContext(request.query);
      const policies = await store.listEarlyBatchPolicies(context.cohortYear);
      return {
        schemaVersion: '1.0.0',
        year: context.cohortYear,
        ...context,
        batchCode: 'campus',
        basis: 'uploaded_workbook_rule',
        disclaimer: earlyBatchDisclaimer(context),
        sourceStatus: policies[0]?.sourceStatus ?? 'not_loaded',
        revisionKey: policies[0]?.revisionKey ?? null,
        items: policies.map((policy) => ({
          policyKey: policy.policyKey,
          target: earlyBatchTarget(policy),
          requirements: policy.recruitmentRequirements,
          plannedHeadcount: policy.plannedHeadcountDisplay,
          missingFields: policy.missingFields,
          source: earlyBatchSource(policy),
          updatedAt: policy.updatedAt,
        })),
      };
    },
  );

  app.get(
    '/api/v2/private/early-batch/targets/:targetCode',
    { preHandler: requireUser },
    async (request, reply) => {
      noStore(reply);
      const { targetCode } = z
        .object({ targetCode: z.string().trim().min(3).max(120).regex(/^[A-Z0-9-]+$/) })
        .parse(request.params);
      const context = earlyBatchTemporalContext(request.query);
      const policy = await store.findEarlyBatchPolicy(targetCode, context.cohortYear);
      if (!policy) throw new ApiError(404, 'EARLY_BATCH_TARGET_NOT_FOUND', '提前批目标不存在');
      return {
        schemaVersion: '1.0.0',
        year: context.cohortYear,
        ...context,
        basis: 'uploaded_workbook_rule',
        disclaimer: earlyBatchDisclaimer(context),
        policy: earlyBatchPolicyPayload(policy, context),
      };
    },
  );

  app.get(
    '/api/v2/private/early-batch/provinces/:adcode',
    { preHandler: requireUser },
    async (request, reply) => {
      noStore(reply);
      const { adcode } = z.object({ adcode: z.string().regex(/^\d{6}$/) }).parse(request.params);
      const context = earlyBatchTemporalContext(request.query);
      const policy = await store.findEarlyBatchPolicy(
        `PROV-${adcode}`,
        context.cohortYear,
      );
      if (!policy) throw new ApiError(404, 'EARLY_BATCH_TARGET_NOT_FOUND', '该省提前批数据不存在');
      return {
        schemaVersion: '1.0.0',
        year: context.cohortYear,
        ...context,
        basis: 'uploaded_workbook_rule',
        disclaimer: earlyBatchDisclaimer(context),
        policy: earlyBatchPolicyPayload(policy, context),
      };
    },
  );

  app.post(
    '/api/v2/private/early-batch/schools/search',
    {
      preHandler: [requireUser, requireUserCsrf],
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      noStore(reply);
      const body = earlyBatchSchoolSearchSchema.parse(request.body);
      const rows = await store.searchEarlyBatchSchools(body.q, body.limit);
      return {
        items: rows.map(describeEarlyBatchSchool),
        total: rows.length,
        limit: body.limit,
      };
    },
  );

  app.post('/api/v2/private/recruitment-eligibility/evaluate', {
    preHandler: [requireUser, requireUserCsrf],
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    noStore(reply);
    const body = recruitmentEligibilityRequestSchema.parse(request.body);
    const sourceCohortYear = body.comparisonMode === 'reference'
      ? resolveRecruitmentReferenceCohort(body.cohortYear).referenceCohortYear : body.cohortYear;
    const loadPublished = async (resource: ResourceName, filters: Partial<ResourceListInput> = {}) => {
      const rows: Record<string, unknown>[] = [];
      for (let offset = 0; ; ) {
        const page = await store.listResource(resource, { ...filters, publicationStatus: 'published', limit: 500, offset });
        rows.push(...page.items);
        offset += page.items.length;
        if (offset >= page.total) return rows;
        if (!page.items.length) throw new ApiError(503, 'RECRUITMENT_DATA_INCOMPLETE', '招聘条件加载不完整，请稍后重试。');
      }
    };
    const [provinces, companies, requirements, sources, restrictedSources, earlyPolicies, snapshot] = await Promise.all([
      loadPublished('provinces'), loadPublished('companies'),
      loadPublished('recruitment-requirements', { cohortYear: sourceCohortYear }),
      loadPublished('sources'), store.adminOnlySources(), store.listEarlyBatchPolicies(sourceCohortYear), store.gridQuerySnapshot(),
    ]);
    if (!provinces.length) throw new ApiError(503, 'RECRUITMENT_DATA_UNAVAILABLE', '招聘条件暂时无法读取，请稍后重试。');
    // School identity/tags are resolved with the existing trusted directory;
    // degree is the applicant's own qualification, never inferred from school.
    const resolved = await resolveEarlyBatchApplicant({ ...body.applicant,
      degree: body.applicant.degree === 'junior_college' ? 'bachelor' : body.applicant.degree });
    const referenceFacts = gridSnapshotForMemberSources(snapshot, privateSourceIndex(restrictedSources)).datasets.flatMap(dataset =>
      dataset.policyFacts.filter(fact => gridFactVisibleToMember(dataset, fact)).map(fact => ({ ...fact,
        datasetKey: dataset.datasetKey, version: dataset.version })));
    return { ...evaluateRecruitmentEligibility({
      applicant: { ...body.applicant, ...resolved.applicant, degree: body.applicant.degree },
      cohortYear: body.cohortYear, batchCodes: body.batchCodes,
      comparisonMode: body.comparisonMode,
      provinces, companies, requirements, sources: [...sources, ...restrictedSources], earlyPolicies, referenceFacts,
    }), schoolResolution: resolved.school };
  });

  app.post(
    '/api/v2/private/early-batch/evaluate',
    {
      preHandler: [requireUser, requireUserCsrf],
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      noStore(reply);
      const body = earlyBatchEvaluateSchema.parse(request.body);
      const context = earlyBatchTemporalContext(body);
      if (
        body.applicant.graduationYear !== undefined
        && body.applicant.graduationYear !== context.cohortYear
      ) {
        throw new ApiError(
          409,
          'EARLY_BATCH_APPLICANT_COHORT_MISMATCH',
          '当前规则仅对应2026届申请人；其他毕业年份不能套用本表判断。',
        );
      }
      const allPolicies = await store.listEarlyBatchPolicies(context.cohortYear);
      const requestedCodes = body.targetCodes ? [...new Set(body.targetCodes)] : null;
      const policies = requestedCodes
        ? allPolicies.filter((policy) => requestedCodes.includes(policy.targetCode))
        : allPolicies;
      if (requestedCodes) {
        const found = new Set(policies.map((policy) => policy.targetCode));
        if (requestedCodes.some((code) => !found.has(code))) {
          throw new ApiError(404, 'EARLY_BATCH_TARGET_NOT_FOUND', '一个或多个提前批目标不存在');
        }
      }
      const resolved = await resolveEarlyBatchApplicant(body.applicant);
      const results = policies.map((policy) => {
        const evaluation = evaluateEarlyBatchPolicy(policy, resolved.applicant);
        return {
          policyKey: policy.policyKey,
          target: earlyBatchTarget(policy),
          ...evaluation,
          sourceStatus: policy.sourceStatus,
          source: earlyBatchSource(policy),
        };
      });
      const count = (decision: (typeof results)[number]['decision']) =>
        results.filter((result) => result.decision === decision).length;
      return {
        schemaVersion: '1.0.0',
        year: context.cohortYear,
        ...context,
        basis: 'uploaded_workbook_rule',
        disclaimer: earlyBatchDisclaimer(context),
        schoolResolution: resolved.school,
        summary: {
          total: results.length,
          eligibleUnderWorkbookRule: count('eligible_under_workbook_rule'),
          ineligibleUnderWorkbookRule: count('ineligible_under_workbook_rule'),
          missingInput: count('missing_input'),
          manualReview: count('manual_review'),
        },
        results,
      };
    },
  );

  // Complete anonymous aggregates are available only through this authenticated
  // contract; neither query parameters nor public routes can enable it.
  app.get('/api/v2/private/grid-aggregates/information',{preHandler:requireUser},async(request,reply)=>{
    noStore(reply);const {cohortYear}=gridInformationQuerySchema.parse(request.query??{});
    return queryExactInformation(await loadGridInformation(store,cohortYear),cohortYear);
  });
  app.get('/api/v2/private/grid-aggregates/rankings',{preHandler:requireUser},async(request,reply)=>{
    noStore(reply);const query=gridAggregateRankingQuerySchema.parse(request.query??{});
    const input=await loadGridInformation(store,typeof query.cohortYear==='number'?query.cohortYear:2026);
    if(query.schoolProvinceAdcode&&!input.catalogs.some(c=>c.provinces.some(p=>p.adcode===query.schoolProvinceAdcode)))throw new ApiError(404,'GRID_AGGREGATES_SCHOOL_PROVINCE_NOT_FOUND','学校所在省级目录尚未接入');
    return queryExactGridRankings(input,query);
  });
  app.get('/api/v2/private/grid-aggregates/overview',{preHandler:requireUser},async(request,reply)=>{
    noStore(reply);const query=gridMapQuerySchema.parse(request.query??{}),input=await loadGridInformation(store,query.cohortYear);
    if(query.provinceAdcode&&!input.catalogs.some(c=>c.provinces.some(p=>p.adcode===query.provinceAdcode)))throw new ApiError(404,'GRID_AGGREGATES_PROVINCE_NOT_FOUND','省级地理目录尚未接入');
    return queryExactGridOverview(input,query);
  });
  for(const kind of ['schools','companies'] as const)app.get(`/api/v2/private/grid-aggregates/${kind}/:key`,{preHandler:requireUser},async(request,reply)=>{
    noStore(reply);const {key}=z.object({key:z.string().regex(/^[A-Za-z0-9_.:-]{1,160}$/)}).parse(request.params);
    const query=gridMapQuerySchema.parse(request.query??{}),input=await loadGridInformation(store,query.cohortYear);
    if(query.provinceAdcode&&!input.catalogs.some(c=>c.provinces.some(p=>p.adcode===query.provinceAdcode)))throw new ApiError(404,'GRID_AGGREGATES_PROVINCE_NOT_FOUND','省级地理目录尚未接入');
    const result=kind==='schools'?queryExactGridSchool(input,key,query):queryExactGridCompany(input,key,query);
    if(!result)throw new ApiError(404,'GRID_AGGREGATES_ENTITY_NOT_FOUND','匿名聚合实体不存在');
    return result;
  });

  app.get('/api/v2/private/grid-information/overview',{preHandler:requireUser},async(request,reply)=>{
    noStore(reply);
    const {cohortYear}=gridInformationQuerySchema.parse(request.query??{});
    return buildGridInformationOverview(await loadGridInformation(store,cohortYear),cohortYear);
  });
  app.get('/api/v2/private/grid-information/provinces/:adcode',{preHandler:requireUser},async(request,reply)=>{
    noStore(reply);
    const {adcode}=z.object({adcode:z.string().regex(/^\d{6}$/)}).parse(request.params);
    const {cohortYear}=gridInformationQuerySchema.parse(request.query??{});
    const result=buildGridInformationProvince(await loadGridInformation(store,cohortYear),cohortYear,adcode);
    if(!result)throw new ApiError(404,'GRID_INFORMATION_PROVINCE_NOT_FOUND','省级资料目录尚未接入');
    return result;
  });

  // Final response redaction cannot undo sums or fixed-cell suppression. Load
  // an immutable audience projection before any legacy grid query runs.
  async function gridSnapshotForAudience(admin: boolean) {
    if (admin) return store.gridQuerySnapshot();
    const [snapshot, sources] = await Promise.all([store.gridQuerySnapshot(), store.adminOnlySources()]);
    return gridSnapshotForMemberSources(snapshot, privateSourceIndex(sources));
  }
  async function gridMapForAudience(admin: boolean) {
    const [snapshot, catalogs, sources] = await Promise.all([
      store.gridQuerySnapshot(), store.gridMapCatalogSnapshot(), admin ? Promise.resolve([]) : store.adminOnlySources(),
    ]);
    if (admin) return { snapshot, catalogs };
    const index = privateSourceIndex(sources), safeSnapshot = gridSnapshotForMemberSources(snapshot, index);
    return { snapshot: safeSnapshot, catalogs: gridCatalogsForMemberSources(catalogs, safeSnapshot, index) };
  }
  app.get('/api/v2/public/grid-map/overview',async(request,reply)=>{
    noStore(reply);
    // Reject malformed filters before loading a potentially cold snapshot.
    const query=gridMapQuerySchema.parse(request.query??{});
    const {snapshot,catalogs}=await gridMapForAudience(false);
    return queryGridMapOverview(snapshot,catalogs,query,false,true);
  });
  for(const audience of ['private','admin'] as const){
    const admin=audience==='admin',guard=admin?requireAdmin:requireUser,prefix=`/api/v2/${audience}/grid-map`;
    app.get(`${prefix}/overview`,{preHandler:guard},async(request,reply)=>{
      noStore(reply);const query=gridMapQuerySchema.parse(request.query??{});
      const {snapshot,catalogs}=await gridMapForAudience(admin);
      if(query.provinceAdcode&&!catalogs.some(catalog=>catalog.provinces.some(province=>province.adcode===query.provinceAdcode)))throw new ApiError(404,'GRID_MAP_PROVINCE_NOT_FOUND','省级地理目录尚未接入');
      return queryGridMapOverview(snapshot,catalogs,query,admin);
    });
    for(const kind of ['schools','companies'] as const)app.get(`${prefix}/${kind}/:key`,{preHandler:guard},async(request,reply)=>{
      noStore(reply);const {key}=z.object({key:z.string().regex(/^[A-Za-z0-9_.:-]{1,160}$/)}).parse(request.params);
      const query=gridMapQuerySchema.parse(request.query??{}),{snapshot,catalogs}=await gridMapForAudience(admin);
      const result=kind==='schools'?queryGridMapSchool(snapshot,catalogs,key,query,admin):queryGridMapCompany(snapshot,catalogs,key,query,admin);
      if(!result)throw new ApiError(404,'GRID_MAP_ENTITY_NOT_FOUND','地图实体不存在或当前筛选无可用资料');return result;
    });
  }
  app.get('/api/v2/admin/grid-map/coverage',{preHandler:requireAdmin},async(_request,reply)=>{
    noStore(reply);const [snapshot,catalogs]=await Promise.all([store.gridQuerySnapshot(),store.gridMapCatalogSnapshot()]);return gridMapCoverage(snapshot,catalogs);
  });

  for (const audience of ['private', 'admin'] as const) {
    const admin=audience==='admin';
    const guard=admin?requireAdmin:requireUser;
    const prefix=`/api/v2/${audience}/grid-query`;
    app.get(`${prefix}/original-html`,{
      onRequest:async(_request,reply)=>{
        noStore(reply);
        reply.header('X-Content-Type-Options','nosniff');
        reply.header('Content-Security-Policy',"default-src 'none'; base-uri 'none'; object-src 'none'; form-action 'none'; sandbox; frame-ancestors 'none';");
      },
      preHandler:guard,
    },async(_request,reply)=>{
      noStore(reply);
      let document:{html:string;csp:string};
      try{document=await readGridOriginalDocument();}catch{throw new ApiError(503,'GRID_ORIGINAL_UNAVAILABLE','原版历史资料尚未配置或校验未通过');}
      reply.type('text/html; charset=utf-8');
      reply.header('X-Content-Type-Options','nosniff');reply.header('X-Original-Source-SHA256',GRID_ORIGINAL_SHA256);reply.header('Content-Security-Policy',document.csp);
      return document.html;
    });
    app.get(`${prefix}/facets`,{preHandler:guard},async(_request,reply)=>{
      noStore(reply); return gridFacets(await gridSnapshotForAudience(admin),admin);
    });
    app.get(`${prefix}/facts`,{preHandler:guard},async(request,reply)=>{
      noStore(reply); return queryGridFacts(await gridSnapshotForAudience(admin),gridFactQuerySchema.parse(request.query??{}),admin);
    });
    app.get(`${prefix}/rankings`,{preHandler:guard},async(request,reply)=>{
      noStore(reply); return queryGridRankings(await gridSnapshotForAudience(admin),gridRankingQuerySchema.parse(request.query??{}),admin);
    });
    app.get(`${prefix}/versions`,{preHandler:guard},async(_request,reply)=>{
      noStore(reply); return {items:(await gridSnapshotForAudience(admin)).versions};
    });
  }
  app.get('/api/v2/admin/grid-query/sources',{preHandler:requireAdmin},async(request,reply)=>{
    noStore(reply); return queryGridSources(await store.gridQuerySnapshot(),gridSourceQuerySchema.parse(request.query??{}));
  });

  app.get(
    '/api/v2/private/provinces/:adcode/dashboard',
    { preHandler: requireUser },
    async (request, reply) => {
      noStore(reply);
      const params = z.object({ adcode: z.string().regex(/^\d{6}$/) }).parse(request.params);
      const query = (request.query ?? {}) as Record<string, unknown>;
      const cohortYear = query.cohortYear === undefined ? undefined : Number(query.cohortYear);
      const dashboardFilters: { cohortYear?: number; batchCode?: string } = {
        ...(typeof cohortYear === 'number' && Number.isInteger(cohortYear) ? { cohortYear } : {}),
        ...(typeof query.batchCode === 'string' && query.batchCode
          ? { batchCode: query.batchCode }
          : {}),
      };
      const result = await store.provinceDashboard(params.adcode, dashboardFilters);
      if (!result) throw new ApiError(404, 'PROVINCE_NOT_FOUND', '省级数据不存在');
      return result;
    },
  );

  app.get(
    '/api/v2/private/provinces/:adcode/recruitment-profile',
    { preHandler: requireUser },
    async (request, reply) => {
      noStore(reply);
      const params = z.object({ adcode: z.string().regex(/^\d{6}$/) }).parse(request.params);
      const query = z
        .object({
          cohortYear: z.coerce.number().int().min(2000).max(2100).optional(),
          batchCode: z.enum(['campus', 'batch_1', 'batch_2', 'batch_3']).optional(),
          companyKey: z.string().trim().min(1).max(160).optional(),
        })
        .parse(request.query ?? {});
      const cohortYear = query.cohortYear ?? 2026;
      if (cohortYear !== 2026) {
        throw new ApiError(
          422,
          'PROVINCIAL_RECRUITMENT_YEAR_NOT_AVAILABLE',
          '当前省级招聘资料库仅收录2026届历史资料；其他届别须取得对应官方材料后再录入。',
        );
      }
      const profileFilters: { cohortYear?: number; batchCode?: string; companyKey?: string } = {
        cohortYear,
        ...(query.batchCode ? { batchCode: query.batchCode } : {}),
        ...(query.companyKey ? { companyKey: query.companyKey } : {}),
      };
      const result = await store.provinceRecruitmentProfile(params.adcode, profileFilters);
      if (!result) {
        throw new ApiError(404, 'PROVINCE_RECRUITMENT_PROFILE_NOT_FOUND', '该省招聘资料尚未入库');
      }
      return result;
    },
  );

  app.get(
    '/api/v2/private/map-geojson/:adcode',
    { preHandler: requireUser },
    async (request, reply) => {
      noStore(reply);
      const { adcode } = z.object({ adcode: z.string().regex(/^\d{6}$/) }).parse(request.params);
      const root = resolve(config.mapGeojsonDir);
      const file = resolve(root, `${adcode}.json`);
      if (dirname(file) !== root) throw new ApiError(400, 'INVALID_ADCODE', '行政区代码无效');
      try {
        const fileStat = await stat(file);
        if (!fileStat.isFile() || fileStat.size > 25 * 1024 * 1024) {
          throw new ApiError(413, 'MAP_TOO_LARGE', '地图数据不可用');
        }
        const raw = await readFile(file, 'utf8');
        const parsed = JSON.parse(raw) as unknown;
        if (!parsed || typeof parsed !== 'object') throw new Error('invalid geojson');
        reply.type('application/json; charset=utf-8');
        return parsed;
      } catch (error) {
        if (error instanceof ApiError) throw error;
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') throw new ApiError(404, 'MAP_NOT_FOUND', '省级地图不存在');
        throw new ApiError(503, 'MAP_INVALID', '省级地图暂时不可用');
      }
    },
  );

  await app.ready();
  return app;
}
