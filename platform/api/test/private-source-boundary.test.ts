import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import type { AppConfig } from '../src/config.js';
import { hashPassword } from '../src/lib/crypto.js';
import { PRIVATE_SOURCE_PREFIX, containsPrivateSourceReference, pinPrivateSource, privateSourceIndex, publicSourceMetadata, stripPrivateSourceMaterial } from '../src/lib/private-source-boundary.js';
import { buildProvinceRecruitmentProfile } from '../src/lib/province-recruitment-profile.js';
import { MemoryStore } from '../src/store/memory.js';

type Row = Record<string, any>;
const secretMarker = 'PRIVATE_SOURCE_BODY_MUST_NOT_REACH_MEMBERS';
const privateSource = (extra: Row = {}): Row => ({
  id: randomUUID(), sourceKey: PRIVATE_SOURCE_PREFIX + 'ARTICLE-TEST',
  sourceType: 'reference', title: '待核验原文', contentText: secretMarker,
  status: 'pending_reference_verification',
  metadata: { visibility: 'admin_only', publicMetricEligible: false, eligibilityEngineEligible: false },
  ...extra,
});
const cookieOf = (response: { headers: Record<string, unknown> }) => {
  const raw = response.headers['set-cookie'];
  return String(Array.isArray(raw) ? raw[0] : raw).split(';', 1)[0]!;
};
const policy = (source: Row, revisionId: string, suffix = 'SAFE'): Row => ({
  policyKey: `POLICY-${suffix}`, targetCode: `UNIT-${suffix}`, targetKind: 'unit', targetName: `测试${suffix}`,
  cohortYear: 2026, batchCode: 'campus', recruitmentRequirements: '仅上传表参考规则',
  eligibilityModel: { version: 1, confidence: 'structured_from_uploaded_reference', branches: [{
    key: 'degree', outcome: 'eligible_reference', reason: '符合参考表学历条件',
    predicates: [{ field: 'degree', operator: 'in', value: ['master'], label: '学历' }],
  }] }, sourceLocator: 'Sheet1!A3:K3', sourceStatus: 'uploaded_reference_unverified',
  sourceDocumentId: source.id, revisionId, status: 'active', publicationStatus: 'published',
  missingFields: [], evidenceAssets: [], externalEvidence: [], metadata: {},
});

describe('admin-only source marker contract', () => {
  it('recognizes either marker and nested direct/supplementary ID/key channels, not ordinary D-tier references', () => {
    const prefix = privateSource({ metadata: {} });
    const marked = privateSource({ sourceKey: 'private-marked-without-reserved-prefix' });
    const index = privateSourceIndex([prefix, marked]);
    for (const ref of [
      { sourceDocumentId: prefix.id }, { source_id: marked.id }, { sourceKeys: [marked.sourceKey] },
      { metadata: { source_ids: [prefix.sourceKey] } },
      { metadata: { nested: { nature_source_ids: [marked.sourceKey] } } },
      { payload: { sourceKeys: [PRIVATE_SOURCE_PREFIX + 'NOT-YET-REGISTERED'] } },
    ]) expect(containsPrivateSourceReference(ref, index)).toBe(true);
    expect(containsPrivateSourceReference({ sourceType: 'uploaded_workbook', status: 'uploaded_reference_unverified', metadata: { source_ids: ['old-excel'] } }, index)).toBe(false);
    expect(containsPrivateSourceReference({ notes: 'Ordinary prose mentioning the archive is not an identifier.' }, index)).toBe(false);
  });

  it('pins visibility-only and prefix-only sources across metadata/status/sourceKey patches', () => {
    for (const existing of [privateSource(), privateSource({ sourceKey: 'private-marker-only' })]) {
      const updated = pinPrivateSource({ metadata: { visibility: 'public', publicMetricEligible: true }, status: 'verified', officialUrl: 'https://example.test/' }, existing);
      expect(updated).toMatchObject({ officialUrl: null, status: 'pending_reference_verification', metadata: {
        visibility: 'admin_only', publicMetricEligible: false, eligibilityEngineEligible: false,
      } });
      expect(() => pinPrivateSource({ sourceKey: 'renamed-to-public' }, existing)).toThrow('PRIVATE_SOURCE_KEY_IMMUTABLE');
    }
  });

  it('keeps safe source-summary metadata only and drops restricted rows without deleting their safe siblings', () => {
    const hidden = privateSource();
    const index = privateSourceIndex([hidden]);
    expect(publicSourceMetadata({ evidenceTier: 'A', dataset_id: 'historical', sourceUrl: 'https://private.example.test/', token: 'do-not-copy', archivePath: '/private/fixture', contentText: secretMarker, nested: { token: 'hidden' } })).toEqual({ evidenceTier: 'A', dataset_id: 'historical' });
    expect(stripPrivateSourceMaterial({ items: [{ value: 10, sourceKey: 'safe' }, { value: 999, sourceDocumentId: hidden.id }] }, index)).toEqual({ items: [{ value: 10, sourceKey: 'safe' }] });
  });
});

describe('private-source API and audience isolation', () => {
  let app: FastifyInstance;
  let store: MemoryStore;
  let headers: Record<string, string>;
  let userHeaders: Record<string, string>;
  let hidden: Row;
  let legacy: Row;
  let revision: Row;
  let province: Row;
  let company: Row;

  beforeEach(async () => {
    store = new MemoryStore();
    const config: AppConfig = {
      nodeEnv: 'test', host: '127.0.0.1', port: 8799, trustProxyHops: 0, databaseUrl: 'postgresql://unused',
      publicOrigins: ['https://admin.example.test'], cookieSecure: true, sessionTtlSeconds: 7200,
      sessionSecret: 'source-boundary-test-'.padEnd(48, 's'), phonePepper: 'source-boundary-'.padEnd(48, 'p'),
      phoneEncryptionKey: Buffer.alloc(32, 7), mapGeojsonDir: '/nonexistent-test-map', autoMigrate: false,
    };
    const admin = await store.upsertAdmin({ username: 'test-admin', displayName: '测试管理员', passwordHash: await hashPassword('SyntheticTestPassword!'), role: 'superadmin' });
    hidden = await store.createResource('sources', privateSource(), admin.id);
    legacy = await store.createResource('sources', { sourceKey: 'old-excel-2026', title: '既有上传表', sourceType: 'uploaded_workbook', status: 'uploaded_reference_unverified', contentText: 'LEGACY_BODY', metadata: {} }, admin.id);
    revision = await store.createResource('revisions', { revisionKey: 'OLD-REFERENCE', title: '既有规则', status: 'published', payload: {} }, admin.id);
    province = await store.createResource('provinces', { adcode: '420000', name: '湖北省', provinceKey: 'PROV-CN-420000' }, admin.id);
    company = await store.createResource('companies', { companyKey: 'UNIT-HUBEI', name: '湖北单位', provinceId: province.id, companyType: 'state_grid_provincial_unit', publicationStatus: 'published' }, admin.id);
    app = await buildApp({ config, store });
    const adminLogin = await app.inject({ method: 'POST', url: '/api/v2/admin/auth/login', payload: { username: 'test-admin', password: 'SyntheticTestPassword!' } });
    headers = { cookie: cookieOf(adminLogin), 'x-csrf-token': adminLogin.json().csrfToken };
    const member = await app.inject({ method: 'POST', url: '/api/v2/admin/users', headers, payload: { phone: '13800138000', password: 'SyntheticMemberPassword!' } });
    expect(member.statusCode).toBe(201);
    const userLogin = await app.inject({ method: 'POST', url: '/api/v2/auth/login', payload: { phone: '13800138000', password: 'SyntheticMemberPassword!' } });
    userHeaders = { cookie: cookieOf(userLogin), 'x-csrf-token': userLogin.json().csrfToken };
  });
  afterEach(async () => { await app.close(); });

  it('lists metadata without full text, allows administrator detail, and refuses anonymous/member source access', async () => {
    const list = await app.inject({ method: 'GET', url: '/api/v2/admin/sources', headers });
    expect(list.statusCode).toBe(200);
    expect(list.json().items.every((row: Row) => !('contentText' in row))).toBe(true);
    expect(list.json().items.find((row: Row) => row.id === hidden.id).metadata.visibility).toBe('admin_only');
    const detail = await app.inject({ method: 'GET', url: `/api/v2/admin/sources/${hidden.id}`, headers });
    expect(detail.json().item.contentText).toBe(secretMarker);
    for (const h of [{}, userHeaders]) {
      expect((await app.inject({ method: 'GET', url: `/api/v2/admin/sources/${hidden.id}`, headers: h })).statusCode).toBe(401);
    }
  });

  it('cannot unlock an existing source via metadata, status, source type, or key edits', async () => {
    const patched = await app.inject({ method: 'PATCH', url: `/api/v2/admin/sources/${hidden.id}`, headers, payload: { status: 'verified', metadata: {} } });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().item).toMatchObject({ status: 'pending_reference_verification', metadata: { visibility: 'admin_only', publicMetricEligible: false, eligibilityEngineEligible: false } });
    for (const payload of [{ sourceKey: 'now-public' }, { sourceType: 'current_official_page' }]) {
      expect((await app.inject({ method: 'PATCH', url: `/api/v2/admin/sources/${hidden.id}`, headers, payload })).statusCode).toBe(400);
    }
    const created = await app.inject({ method: 'POST', url: '/api/v2/admin/sources', headers, payload: { sourceKey: PRIVATE_SOURCE_PREFIX + 'NEW', title: 'new', sourceType: 'reference', status: 'verified', metadata: { visibility: 'public' } } });
    expect(created.statusCode).toBe(201);
    expect(created.json().item.metadata.visibility).toBe('admin_only');
  });

  it('rejects both primary and supplemental references on all business writes, including nested revision payloads', async () => {
    const shared = { cohortYear: 2026, unitScope: '测试单位', provinceId: province.id, companyId: company.id, sourceDocumentId: hidden.id, sourceKeys: [hidden.sourceKey] };
    const cases: Array<[string, Row]> = [
      ['schools', { schoolKey: 'SCHOOL-PRIVATE', name: '测试院校', sourceDocumentId: hidden.id }],
      ['companies', { companyKey: 'COMPANY-PRIVATE', name: '测试单位', metadata: { source_ids: [hidden.sourceKey] } }],
      ['recruitment-batches', { ...shared, code: 'batch_1', name: '第一批' }],
      ['recruitment-events', { ...shared, batchCode: 'batch_1', eventType: 'written_exam', title: '考试' }],
      ['recruitment-requirements', { ...shared, batchCode: 'batch_1', requirementKey: 'R-PRIVATE', category: 'education', title: '条件', excerpt: '待核' }],
      ['recruitment-metrics', { ...shared, batchCode: 'not_applicable', metricKey: 'M-PRIVATE', metricType: 'planned_headcount', valueKind: 'count', aggregationGrain: 'cohort_company', value: 999, unit: 'people' }],
      ['early-batch-policies', policy(hidden, revision.id, 'PRIVATE')],
      ['revisions', { revisionKey: 'PRIVATE-REV', title: '不可发布', status: 'published', payload: { nested: { source_keys: [hidden.sourceKey] } } }],
    ];
    for (const [resource, payload] of cases) {
      const result = await app.inject({ method: 'POST', url: `/api/v2/admin/${resource}`, headers, payload });
      expect(result.statusCode, `${resource}: ${result.body}`).toBe(400);
      expect(result.json().error.code, resource).toBe('SOURCE_ADMIN_ONLY');
    }
    const supplemental = await app.inject({ method: 'POST', url: '/api/v2/admin/recruitment-events', headers, payload: { ...shared, sourceDocumentId: legacy.id, sourceKeys: [legacy.sourceKey, hidden.sourceKey], batchCode: 'batch_1', eventType: 'written_exam', title: '补充来源不绕过' } });
    expect(supplemental.json().error.code).toBe('SOURCE_ADMIN_ONLY');
  });

  it('preserves existing D-tier Excel reference eligibility while withholding privately sourced rules on reads', async () => {
    const allowed = await app.inject({ method: 'POST', url: '/api/v2/admin/early-batch-policies', headers, payload: policy(legacy, revision.id) });
    expect(allowed.statusCode, allowed.body).toBe(201);
    // Simulates out-of-band historical data, bypassing the new API write guard.
    await store.createResource('early-batch-policies', policy(hidden, revision.id, 'PRIVATE'), 'system');
    const catalog = await app.inject({ method: 'GET', url: '/api/v2/private/early-batch/catalog', headers: userHeaders });
    expect(catalog.json().items).toHaveLength(1);
    expect(catalog.json().items[0].source.documentKey).toBe(legacy.sourceKey);
    const evaluate = await app.inject({ method: 'POST', url: '/api/v2/private/early-batch/evaluate', headers: userHeaders, payload: { cohortYear: 2026, applicant: { degree: 'master', graduationYear: 2026 } } });
    expect(evaluate.statusCode, evaluate.body).toBe(200);
    expect(evaluate.json().summary.total).toBe(1);
    expect(JSON.stringify(evaluate.json())).not.toContain('POLICY-PRIVATE');
    expect((await app.inject({ method: 'GET', url: '/api/v2/private/early-batch/targets/UNIT-PRIVATE', headers: userHeaders })).statusCode).toBe(404);
    const directPatch = await app.inject({ method: 'PATCH', url: `/api/v2/admin/early-batch-policies/${allowed.json().item.id}`, headers, payload: { sourceDocumentId: hidden.id } });
    expect(directPatch.json().error.code).toBe('SOURCE_ADMIN_ONLY');
  });

  it('withholds private snapshots/metrics before output and leaves unrelated safe data intact', async () => {
    await store.createResource('revisions', { revisionKey: 'public-dashboard', status: 'published', sourceDocumentId: hidden.id, payload: { leaked: secretMarker } }, 'system');
    await store.createResource('recruitment-metrics', { metricKey: 'SAFE-METRIC', provinceId: province.id, publicationStatus: 'published', cohortYear: 2026, batchCode: 'batch_1', value: 5, sourceDocumentId: legacy.id }, 'system');
    await store.createResource('recruitment-metrics', { metricKey: 'PRIVATE-METRIC', provinceId: province.id, publicationStatus: 'published', cohortYear: 2026, batchCode: 'batch_1', value: 999, sourceDocumentId: hidden.id }, 'system');
    const publicResult = await app.inject({ method: 'GET', url: '/api/v2/public/dashboard' });
    expect(publicResult.statusCode).toBe(200);
    expect(publicResult.body).not.toContain(secretMarker);
    const privateResult = await app.inject({ method: 'GET', url: '/api/v2/private/provinces/420000/dashboard?cohortYear=2026&batchCode=batch_1', headers: userHeaders });
    expect(privateResult.json().recruitment_metrics.map((row: Row) => row.metricKey)).toEqual(['SAFE-METRIC']);
  });

  it('removes private source records and linked facts from province DTOs and allowlists summary metadata', () => {
    const base = { companyId: company.id, cohortYear: 2026, batchCode: 'batch_1' };
    const dto = buildProvinceRecruitmentProfile({ province, companies: [company], batches: [],
      events: [{ ...base, eventKey: 'SAFE', sourceDocumentId: legacy.id, sourceKeys: [legacy.sourceKey] }, { ...base, eventKey: 'PRIVATE', sourceDocumentId: hidden.id, sourceKeys: [hidden.sourceKey] }],
      requirements: [], revisions: [], sources: [hidden, { ...legacy, metadata: { evidenceTier: 'D', token: 'never-expose', archivePath: '/private/fixture', ocr: secretMarker } }],
    });
    expect(dto.units[0].events.map((row: Row) => row.eventKey)).toEqual(['SAFE']);
    expect(dto.units[0].sources).toHaveLength(1);
    expect(dto.units[0].sources[0].metadata).toEqual({ evidenceTier: 'D' });
    expect(JSON.stringify(dto)).not.toContain(secretMarker);
    expect(JSON.stringify(dto)).not.toContain('never-expose');
  });
});
