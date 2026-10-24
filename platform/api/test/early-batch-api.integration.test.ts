import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import type { AppConfig } from '../src/config.js';
import {
  encryptPhone,
  hashPassword,
  normalizePhone,
  phoneLookupHash,
} from '../src/lib/crypto.js';
import { MemoryStore } from '../src/store/memory.js';

function sessionCookie(response: { headers: Record<string, unknown> }): string {
  const raw = response.headers['set-cookie'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') throw new Error('missing set-cookie');
  return value.split(';', 1)[0]!;
}

describe('private early-batch API', () => {
  let app: FastifyInstance;
  let store: MemoryStore;
  let config: AppConfig;
  let mapDir: string;
  let cookie: string;
  let csrfToken: string;

  beforeEach(async () => {
    mapDir = await mkdtemp(join(tmpdir(), 'early-batch-api-'));
    config = {
      nodeEnv: 'test',
      host: '127.0.0.1',
      port: 8792,
      trustProxyHops: 0,
      databaseUrl: 'postgresql://unused',
      publicOrigins: ['https://map.example.test'],
      cookieSecure: true,
      sessionTtlSeconds: 7200,
      sessionSecret: 'early-batch-session-'.padEnd(48, 's'),
      phonePepper: 'early-batch-phone-'.padEnd(48, 'p'),
      phoneEncryptionKey: Buffer.alloc(32, 11),
      mapGeojsonDir: mapDir,
      autoMigrate: false,
    };
    store = new MemoryStore();
    const admin = await store.upsertAdmin({
      username: 'rootadmin',
      displayName: '超级管理员',
      passwordHash: await hashPassword('AdminPassword123!'),
      role: 'superadmin',
    });
    const province = await store.createResource(
      'provinces',
      { provinceKey: 'PROV-CN-420000', adcode: '420000', name: '湖北省', publicationStatus: 'published' },
      admin.id,
    );
    const source = await store.createResource(
      'sources',
      {
        sourceKey: 'uploaded-workbook-2026-early-batch-test',
        title: '2026提前批情况.xlsx',
        sourceType: 'uploaded_workbook',
        officialUrl: null,
        status: 'uploaded_reference_unverified',
      },
      admin.id,
    );
    const revision = await store.createResource(
      'revisions',
      {
        revisionKey: 'EARLY-BATCH-2026-TEST',
        title: '2026提前批资格参考规则',
        status: 'published',
        dataStatus: 'uploaded_reference_unverified',
        payload: {},
      },
      admin.id,
    );
    await store.createResource(
      'early-batch-policies',
      {
        policyKey: 'EARLY-BATCH-2026-TEST:PROV-420000',
        cohortYear: 2026,
        batchCode: 'campus',
        targetKind: 'province',
        targetCode: 'PROV-420000',
        targetName: '湖北',
        provinceId: province.id,
        parentProvinceId: province.id,
        recruitmentRequirements: '985、211及原电力部直属院校的研究生或博士生',
        recruitmentProcess: null,
        plannedHeadcountDisplay: '300内',
        assessmentMethod: null,
        itineraryReference: null,
        siteQuotaDisplay: null,
        admissionRule: null,
        actualHeadcountDisplay: null,
        otherNotes: null,
        missingFields: [],
        eligibilityModel: {
          version: 1,
          confidence: 'structured_from_uploaded_reference',
          branches: [
            {
              key: 'graduate-school-tier',
              outcome: 'eligible_reference',
              reason: '学历与学校类别符合表内已列正向条件。',
              predicates: [
                {
                  field: 'degree',
                  operator: 'in',
                  value: ['master', 'doctor'],
                  label: '学历阶段',
                },
                {
                  field: 'schoolTags',
                  operator: 'contains_any',
                  value: ['legacy_985', 'legacy_211', 'former_power_ministry'],
                  label: '学校类别',
                },
                {
                  field: 'graduationYear',
                  operator: 'equals',
                  value: 2026,
                  label: '毕业届别',
                },
              ],
            },
          ],
        },
        sourceLocator: 'Sheet1!A3:K3',
        evidenceAssets: [],
        externalEvidence: [],
        sourceStatus: 'uploaded_reference_unverified',
        sourceDocumentId: source.id,
        revisionId: revision.id,
        status: 'active',
        publicationStatus: 'published',
        sortOrder: 2,
        metadata: {
          planned_headcount: { raw_text: '300内', max: 300, qualifier: 'at_most' },
        },
      },
      admin.id,
    );
    const school = await store.createResource(
      'schools',
      {
        schoolKey: 'SCHOOL-TEST-985',
        name: '测试985大学',
        provinceId: province.id,
        nature: '公办',
        educationLevel: '本科',
        status: 'verified',
        publicationStatus: 'published',
        metadata: {
          tags: { legacy_985: true, status: 'verified', source_ids: ['school-tag-source'] },
          nature_status: 'verified',
          nature_basis: '学校主数据已核验办学性质',
          nature_source_ids: ['school-nature-source'],
          source_ids: ['school-registry-source'],
        },
      },
      admin.id,
    );
    expect(school.id).toBeTruthy();
    const unverifiedTagSchool = await store.createResource(
      'schools',
      {
        schoolKey: 'SCHOOL-TEST-ROW-VERIFIED-ONLY',
        name: '仅学校记录已核验大学',
        provinceId: province.id,
        nature: '民办',
        educationLevel: '本科',
        status: 'verified',
        publicationStatus: 'published',
        metadata: {
          tags: { legacy_985: true, source_ids: ['unverified-school-tag-source'] },
          source_ids: ['school-registry-source'],
        },
      },
      admin.id,
    );
    expect(unverifiedTagSchool.id).toBeTruthy();

    const phone = normalizePhone('13700137000');
    await store.createUser({
      phoneLookupHash: phoneLookupHash(phone, config.phonePepper),
      phoneCiphertext: encryptPhone(phone, config.phoneEncryptionKey),
      phoneLast4: phone.slice(-4),
      displayName: '资格查询用户',
      passwordHash: await hashPassword('MemberPass123!'),
      createdByAdminId: admin.id,
    });
    app = await buildApp({ config, store });
    const login = await app.inject({
      method: 'POST',
      url: '/api/v2/auth/login',
      payload: { phone, password: 'MemberPass123!' },
    });
    expect(login.statusCode).toBe(200);
    cookie = sessionCookie(login);
    csrfToken = login.json().csrfToken as string;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
    await rm(mapDir, { recursive: true, force: true });
  });

  it('protects all-batch screening with user authentication, CSRF and no-store', async () => {
    const url = '/api/v2/private/recruitment-eligibility/evaluate';
    const payload = { cohortYear: 2026, applicant: { degree: 'bachelor', graduationYear: 2026 } };
    expect((await app.inject({ method: 'POST', url, payload })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url, headers: { cookie }, payload })).statusCode).toBe(403);
    const response = await app.inject({ method: 'POST', url, headers: { cookie, 'x-csrf-token': csrfToken }, payload });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toContain('no-store');
    expect(response.json().batchCodes).toEqual(['campus', 'batch_1', 'batch_2', 'batch_3', 'csg_campus', 'csg_autumn', 'csg_spring', 'impc_campus']);
    expect(response.json().notice).toContain('不代表');
  });

  it('does not globally reject overseas graduation windows and reports uncovered cohorts', async () => {
    const url = '/api/v2/private/recruitment-eligibility/evaluate';
    const headers = { cookie, 'x-csrf-token': csrfToken };
    const response = await app.inject({ method: 'POST', url, headers,
      payload: { cohortYear: 2026, batchCodes: ['batch_2'], applicant: {
        degree: 'master', graduationYear: 2025, educationLocation: 'overseas',
      } },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().batchCodes).toEqual(['batch_2']);
    const unsupported = await app.inject({ method: 'POST', url, headers,
      payload: { cohortYear: 2027, applicant: { degree: 'master', graduationYear: 2027 } },
    });
    expect(unsupported.statusCode).toBe(200);
    expect(unsupported.headers['cache-control']).toContain('no-store');
    expect(unsupported.json().coverage.status).toBe('not_loaded');
    expect(unsupported.json().results).toEqual([]);
    expect(unsupported.json().summary.notMatched).toBe(0);
  });

  it('keeps explicit historical reading separate from a current 2027 qualification judgment', async () => {
    const url = '/api/v2/private/recruitment-eligibility/evaluate';
    const headers = { cookie, 'x-csrf-token': csrfToken };
    const applicant = { degree: 'bachelor', graduationYear: 2027 };
    const current = await app.inject({ method: 'POST', url, headers, payload: { applicant } });
    expect(current.statusCode).toBe(200);
    expect(current.json().cohortYear).toBe(2027);
    expect(current.json().coverage.status).toBe('not_loaded');
    const historical = await app.inject({ method: 'POST', url, headers, payload: { cohortYear: 2026, comparisonMode: 'historical', applicant } });
    expect(historical.statusCode).toBe(200);
    expect(historical.headers['cache-control']).toContain('no-store');
    expect(historical.json().coverage.status).toBe('historical_only');
    expect(historical.json().results).toEqual([]);
    expect(historical.json().historicalResults.length).toBeGreaterThan(0);
    expect(historical.json().historicalResults[0]).not.toHaveProperty('decision');
  });

  it.each([2027, 2028])('loads the reviewed 2026 reference baseline for target %i and retains security guards', async target => {
    const url = '/api/v2/private/recruitment-eligibility/evaluate';
    const applicant = { degree: 'master', graduationYear: target, schoolTags: ['legacy_985'], schoolTagsConfirmed: true };
    const payload = { cohortYear: target, comparisonMode: 'reference', applicant };
    const policies = vi.spyOn(store, 'listEarlyBatchPolicies');
    const resources = vi.spyOn(store, 'listResource');
    expect((await app.inject({ method: 'POST', url, payload })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url, headers: { cookie }, payload })).statusCode).toBe(403);
    const response = await app.inject({ method: 'POST', url, headers: { cookie, 'x-csrf-token': csrfToken }, payload });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toContain('no-store');
    expect(response.json()).toMatchObject({ targetCohortYear: target, referenceCohortYear: 2026, sourceCohortYear: 2026,
      referenceSelection: { policy: 'latest_reviewed_complete_before_target', basis: 'reviewed_complete_roster', availableCompleteCohortYears: [2026] },
      coverage: { status: 'reference_only' } });
    expect(policies).toHaveBeenCalledWith(2026);
    expect(resources).toHaveBeenCalledWith('recruitment-requirements', expect.objectContaining({ cohortYear: 2026 }));
    expect(policies).not.toHaveBeenCalledWith(2027);
    const campus = response.json().results.find((row: any) => row.batchCode === 'campus');
    expect(campus?.decision).toBe('reference_match');
    expect(campus.checks.some((c: any) => c.field === 'graduationYear')).toBe(false);
    expect(applicant.graduationYear).toBe(target);
    const prior = await app.inject({ method: 'POST', url, headers: { cookie, 'x-csrf-token': csrfToken }, payload: { ...payload, cohortYear: 2026 } });
    expect(prior.json()).toMatchObject({ sourceCohortYear: 2025,
      referenceSelection: { basis: 'previous_year_documents' }, coverage: { status: 'not_loaded' }, results: [] });
    expect(policies).toHaveBeenLastCalledWith(2025);
  });

  it('loads every published page rather than silently evaluating a truncated catalog', async () => {
    const original = store.listResource.bind(store);
    const list = vi.spyOn(store, 'listResource').mockImplementation(async (resource, input) => {
      // A province alone is not a SGCC recruitment target. Keep real scoped
      // unit identities on both pages so this tests pagination, not empty-card
      // fallback behavior (CSG-only / unsupported provinces have no SGCC card).
      if (resource === 'companies') return { total: 2, items: input.offset === 0
        ? [{ id: 'company-one', companyKey: 'sgcc-unit:10450001', provinceId: 'page-one', name: '国网湖北省电力有限公司', publicationStatus: 'published' }]
        : [{ id: 'company-two', companyKey: 'sgcc-unit:10578000', provinceId: 'page-two', name: '国网山西省电力公司', publicationStatus: 'published' }] };
      if (resource !== 'provinces') return original(resource, input);
      return { total: 2, items: input.offset === 0
        ? [{ id: 'page-one', adcode: '420000', name: '湖北省', publicationStatus: 'published' }]
        : [{ id: 'page-two', adcode: '140000', name: '山西省', publicationStatus: 'published' }] };
    });
    const response = await app.inject({ method: 'POST', url: '/api/v2/private/recruitment-eligibility/evaluate',
      headers: { cookie, 'x-csrf-token': csrfToken }, payload: { cohortYear: 2026, batchCodes: ['batch_1'], applicant: { degree: 'bachelor' } },
    });
    expect(response.statusCode).toBe(200);
    expect(new Set(response.json().results.map((row: { provinceAdcode: string }) => row.provinceAdcode)))
      .toEqual(new Set(['420000', '140000']));
    expect(response.json().results).toHaveLength(2);
    expect(list).toHaveBeenCalledWith('provinces', expect.objectContaining({ offset: 1, publicationStatus: 'published' }));
    expect(list).toHaveBeenCalledWith('companies', expect.objectContaining({ offset: 1, publicationStatus: 'published' }));
  });

  it('fails closed when a published page is unexpectedly empty', async () => {
    const original = store.listResource.bind(store);
    vi.spyOn(store, 'listResource').mockImplementation(async (resource, input) => resource === 'provinces'
      ? { items: [], total: 2 } : original(resource, input));
    const response = await app.inject({ method: 'POST', url: '/api/v2/private/recruitment-eligibility/evaluate',
      headers: { cookie, 'x-csrf-token': csrfToken }, payload: { applicant: { degree: 'bachelor' } },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe('RECRUITMENT_DATA_INCOMPLETE');
  });

  it('does not present an empty foundation catalog as no eligible destinations', async () => {
    const original = store.listResource.bind(store);
    vi.spyOn(store, 'listResource').mockImplementation(async (resource, input) => resource === 'provinces'
      ? { items: [], total: 0 } : original(resource, input));
    const response = await app.inject({ method: 'POST', url: '/api/v2/private/recruitment-eligibility/evaluate',
      headers: { cookie, 'x-csrf-token': csrfToken }, payload: { applicant: { degree: 'bachelor' } },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe('RECRUITMENT_DATA_UNAVAILABLE');
    expect(response.json()).not.toHaveProperty('results');
  });

  it('gates catalog/detail and returns exact source locators and workbook status', async () => {
    const anonymous = await app.inject({
      method: 'GET',
      url: '/api/v2/private/early-batch/catalog?year=2026',
    });
    expect(anonymous.statusCode).toBe(401);

    const catalog = await app.inject({
      method: 'GET',
      url: '/api/v2/private/early-batch/catalog?year=2026',
      headers: { cookie },
    });
    expect(catalog.statusCode).toBe(200);
    expect(catalog.headers['cache-control']).toContain('no-store');
    expect(catalog.json()).toMatchObject({
      year: 2026,
      cohortYear: 2026,
      dataStatus: 'uploaded_reference_unverified',
      sourceStatus: 'uploaded_reference_unverified',
      items: [
        {
          target: { code: 'PROV-420000', provinceAdcode: '420000' },
          plannedHeadcount: '300内',
          source: {
            status: 'uploaded_reference_unverified',
            range: 'Sheet1!A3:K3',
            locators: { requirements: 'Sheet1!C3', plannedHeadcount: 'Sheet1!E3' },
          },
        },
      ],
    });

    const wrongYearCatalog = await app.inject({
      method: 'GET',
      url: '/api/v2/private/early-batch/catalog?policyReferenceYear=2026&targetCohortYear=2027',
      headers: { cookie },
    });
    expect(wrongYearCatalog.statusCode).toBe(422);
    expect(wrongYearCatalog.json()).toMatchObject({
      error: { code: 'EARLY_BATCH_YEAR_NOT_AVAILABLE' },
    });

    const detail = await app.inject({
      method: 'GET',
      url: '/api/v2/private/early-batch/targets/PROV-420000?year=2026',
      headers: { cookie },
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().policy.metadata.planned_headcount).toMatchObject({
      raw_text: '300内',
      max: 300,
      qualifier: 'at_most',
    });

    const provinceDetail = await app.inject({
      method: 'GET',
      url: '/api/v2/private/early-batch/provinces/420000?cohortYear=2026',
      headers: { cookie },
    });
    expect(provinceDetail.statusCode).toBe(200);
  });

  it('requires POST plus CSRF for school input and identifies verified tag provenance', async () => {
    const getSearch = await app.inject({
      method: 'GET',
      url: '/api/v2/private/early-batch/schools/search?q=%E6%B5%8B%E8%AF%95',
      headers: { cookie },
    });
    expect(getSearch.statusCode).toBe(404);

    const rejected = await app.inject({
      method: 'POST',
      url: '/api/v2/private/early-batch/schools/search',
      headers: { cookie },
      payload: { q: '测试985大学' },
    });
    expect(rejected.statusCode).toBe(403);

    const search = await app.inject({
      method: 'POST',
      url: '/api/v2/private/early-batch/schools/search',
      headers: { cookie, 'x-csrf-token': csrfToken },
      payload: { q: '测试985大学' },
    });
    expect(search.statusCode).toBe(200);
    expect(search.json().items[0]).toMatchObject({
      schoolKey: 'SCHOOL-TEST-985',
      schoolTags: ['legacy_985', 'public_institution'],
      tagSourceStatus: 'verified',
      requiresConfirmation: false,
    });
  });

  it('distinguishes dataset-verified tags from user-confirmed overrides and never audits applicant input', async () => {
    const endpoint = '/api/v2/private/early-batch/evaluate';
    const headers = { cookie, 'x-csrf-token': csrfToken };
    const applicant = {
      schoolKey: 'SCHOOL-TEST-985',
      degree: 'master',
      graduationYear: 2026,
    } as const;

    const verifiedByKey = await app.inject({
      method: 'POST',
      url: endpoint,
      headers,
      payload: {
        cohortYear: 2026,
        targetCodes: ['PROV-420000'],
        applicant: { ...applicant, schoolTagsConfirmed: false },
      },
    });
    expect(verifiedByKey.statusCode).toBe(200);
    expect(verifiedByKey.json().results[0].decision).toBe('eligible_under_workbook_rule');
    expect(verifiedByKey.json().schoolResolution).toMatchObject({
      status: 'matched_by_key',
      tagBasis: 'dataset_verified',
      tagsConfirmed: true,
      userConfirmedTags: false,
    });

    const verifiedByExactName = await app.inject({
      method: 'POST',
      url: endpoint,
      headers,
      payload: {
        cohortYear: 2026,
        targetCodes: ['PROV-420000'],
        applicant: {
          schoolName: '测试985大学',
          degree: 'master',
          graduationYear: 2026,
        },
      },
    });
    expect(verifiedByExactName.statusCode).toBe(200);
    expect(verifiedByExactName.json().schoolResolution).toMatchObject({
      status: 'matched_by_exact_name',
      tagBasis: 'dataset_verified',
      tagsConfirmed: true,
      userConfirmedTags: false,
    });

    const ignoredUnconfirmedOverride = await app.inject({
      method: 'POST',
      url: endpoint,
      headers,
      payload: {
        cohortYear: 2026,
        targetCodes: ['PROV-420000'],
        applicant: {
          ...applicant,
          schoolTags: [],
          schoolTagsConfirmed: false,
        },
      },
    });
    expect(ignoredUnconfirmedOverride.json().results[0].decision).toBe(
      'eligible_under_workbook_rule',
    );
    expect(ignoredUnconfirmedOverride.json().schoolResolution.tagBasis).toBe('dataset_verified');

    const explicitlyCleared = await app.inject({
      method: 'POST',
      url: endpoint,
      headers,
      payload: {
        cohortYear: 2026,
        targetCodes: ['PROV-420000'],
        applicant: {
          ...applicant,
          schoolTags: [],
          schoolTagsConfirmed: true,
        },
      },
    });
    expect(explicitlyCleared.statusCode).toBe(200);
    expect(explicitlyCleared.json().results[0].decision).toBe(
      'ineligible_under_workbook_rule',
    );
    expect(explicitlyCleared.json().schoolResolution).toMatchObject({
      tagBasis: 'user_confirmed',
      tagsConfirmed: true,
      userConfirmedTags: true,
    });

    const eligible = await app.inject({
      method: 'POST',
      url: endpoint,
      headers,
      payload: {
        cohortYear: 2026,
        targetCodes: ['PROV-420000'],
        applicant: { ...applicant, schoolTagsConfirmed: true },
      },
    });
    expect(eligible.statusCode).toBe(200);
    expect(eligible.json().results[0].decision).toBe('eligible_under_workbook_rule');
    expect(eligible.json().schoolResolution).toMatchObject({
      status: 'matched_by_key',
      tagBasis: 'dataset_verified',
      tagsConfirmed: true,
      userConfirmedTags: true,
    });

    const rowVerifiedOnly = await app.inject({
      method: 'POST',
      url: endpoint,
      headers,
      payload: {
        cohortYear: 2026,
        targetCodes: ['PROV-420000'],
        applicant: {
          schoolKey: 'SCHOOL-TEST-ROW-VERIFIED-ONLY',
          degree: 'master',
          graduationYear: 2026,
        },
      },
    });
    expect(rowVerifiedOnly.statusCode).toBe(200);
    expect(rowVerifiedOnly.json().results[0].decision).toBe('missing_input');
    expect(rowVerifiedOnly.json().schoolResolution).toMatchObject({
      status: 'matched_by_key',
      tagBasis: 'unresolved',
      tagsConfirmed: false,
      userConfirmedTags: false,
      selected: {
        schoolTags: [],
        tagSourceStatus: 'pending',
        requiresConfirmation: true,
      },
    });

    const rowVerifiedUserConfirmed = await app.inject({
      method: 'POST',
      url: endpoint,
      headers,
      payload: {
        cohortYear: 2026,
        targetCodes: ['PROV-420000'],
        applicant: {
          schoolKey: 'SCHOOL-TEST-ROW-VERIFIED-ONLY',
          schoolTags: ['legacy_985'],
          schoolTagsConfirmed: true,
          degree: 'master',
          graduationYear: 2026,
        },
      },
    });
    expect(rowVerifiedUserConfirmed.json().results[0].decision).toBe(
      'eligible_under_workbook_rule',
    );
    expect(rowVerifiedUserConfirmed.json().schoolResolution).toMatchObject({
      tagBasis: 'user_confirmed',
      tagsConfirmed: true,
      userConfirmedTags: true,
    });

    const bachelor = await app.inject({
      method: 'POST',
      url: endpoint,
      headers,
      payload: {
        cohortYear: 2026,
        targetCodes: ['PROV-420000'],
        applicant: { ...applicant, degree: 'bachelor', schoolTagsConfirmed: true },
      },
    });
    expect(bachelor.json().results[0].decision).toBe('ineligible_under_workbook_rule');
    expect(bachelor.json().disclaimer).toContain('不代表国家电网或招聘单位官方资格审查结论');

    const wrongYearEvaluation = await app.inject({
      method: 'POST',
      url: endpoint,
      headers,
      payload: {
        policyReferenceYear: 2026,
        targetCohortYear: 2027,
        targetCodes: ['PROV-420000'],
        applicant: {
          ...applicant,
          graduationYear: 2027,
          schoolTagsConfirmed: true,
        },
      },
    });
    expect(wrongYearEvaluation.statusCode).toBe(422);
    expect(wrongYearEvaluation.json()).toMatchObject({
      error: { code: 'EARLY_BATCH_YEAR_NOT_AVAILABLE' },
    });

    const mismatchedApplicantCohort = await app.inject({
      method: 'POST',
      url: endpoint,
      headers,
      payload: {
        cohortYear: 2026,
        targetCodes: ['PROV-420000'],
        applicant: {
          ...applicant,
          graduationYear: 2027,
          schoolTagsConfirmed: true,
        },
      },
    });
    expect(mismatchedApplicantCohort.statusCode).toBe(409);
    expect(mismatchedApplicantCohort.json()).toMatchObject({
      error: { code: 'EARLY_BATCH_APPLICANT_COHORT_MISMATCH' },
    });

    const audits = await store.listAudit({ limit: 100, offset: 0 });
    const serialized = JSON.stringify(audits);
    expect(serialized).not.toContain('测试985大学');
    expect(serialized).not.toContain('SCHOOL-TEST-985');
    expect(serialized).not.toContain('master');
    expect(serialized).not.toContain('2027');
  });
});
