import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { AppConfig } from '../src/config.js';
import { hashPassword } from '../src/lib/crypto.js';
import { MemoryStore } from '../src/store/memory.js';

function sessionCookie(response: { headers: Record<string, unknown> }): string {
  const raw = response.headers['set-cookie'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') throw new Error('missing set-cookie');
  return value.split(';', 1)[0]!;
}

describe('Fastify v2 API integration', () => {
  let app: FastifyInstance;
  let store: MemoryStore;
  let mapDir: string;
  let config: AppConfig;

  beforeEach(async () => {
    mapDir = await mkdtemp(join(tmpdir(), 'recruitment-api-map-'));
    await writeFile(
      join(mapDir, '420000.json'),
      JSON.stringify({ type: 'FeatureCollection', features: [] }),
      'utf8',
    );
    config = {
      nodeEnv: 'test',
      host: '127.0.0.1',
      port: 8790,
      trustProxyHops: 0,
      databaseUrl: 'postgresql://unused',
      publicOrigins: ['https://admin.example.test', 'https://map.example.test'],
      cookieSecure: true,
      sessionTtlSeconds: 7200,
      sessionSecret: 'session-secret-'.padEnd(48, 's'),
      phonePepper: 'phone-pepper-'.padEnd(48, 'p'),
      phoneEncryptionKey: Buffer.alloc(32, 7),
      mapGeojsonDir: mapDir,
      autoMigrate: false,
    };
    store = new MemoryStore();
    await store.upsertAdmin({
      username: 'rootadmin',
      displayName: '超级管理员',
      passwordHash: await hashPassword('AdminPassword123!'),
      role: 'superadmin',
    });
    app = await buildApp({ config, store });
  });

  afterEach(async () => {
    await app.close();
    await rm(mapDir, { recursive: true, force: true });
  });

  it('protects admin writes, manages a phone member and records audit events', async () => {
    const anonymous = await app.inject({ method: 'GET', url: '/api/v2/admin/users' });
    expect(anonymous.statusCode).toBe(401);

    const login = await app.inject({
      method: 'POST',
      url: '/api/v2/admin/auth/login',
      headers: { origin: 'https://admin.example.test' },
      payload: { username: 'rootadmin', password: 'AdminPassword123!' },
    });
    expect(login.statusCode).toBe(200);
    expect(login.headers['set-cookie']).toContain('HttpOnly');
    expect(login.headers['set-cookie']).toContain('Secure');
    expect(login.headers['set-cookie']).toContain('SameSite=Strict');
    const body = login.json();
    expect(body).toMatchObject({
      authenticated: true,
      admin: { username: 'rootadmin', role: 'superadmin' },
    });
    const cookie = sessionCookie(login);

    const rejected = await app.inject({
      method: 'POST',
      url: '/api/v2/admin/users',
      headers: { cookie, origin: 'https://admin.example.test' },
      payload: { phone: '13800138000', password: 'MemberPass123!' },
    });
    expect(rejected.statusCode).toBe(403);

    const created = await app.inject({
      method: 'POST',
      url: '/api/v2/admin/users',
      headers: {
        cookie,
        origin: 'https://admin.example.test',
        'x-csrf-token': body.csrfToken,
      },
      payload: { phone: '13800138000', password: 'MemberPass123!', displayName: '测试用户' },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().user).toMatchObject({
      phoneMasked: '138****8000',
      enabled: true,
    });
    expect(created.json().user).not.toHaveProperty('phone');
    const userId = created.json().user.id as string;

    const listed = await app.inject({
      method: 'GET',
      url: '/api/v2/admin/users?limit=20&offset=0',
      headers: { cookie },
    });
    expect(listed.json()).toMatchObject({ total: 1, limit: 20, offset: 0 });
    expect(listed.json().items).toHaveLength(1);
    expect(listed.json().items[0]).not.toHaveProperty('phone');

    const disabled = await app.inject({
      method: 'PATCH',
      url: `/api/v2/admin/users/${userId}`,
      headers: { cookie, 'x-csrf-token': body.csrfToken },
      payload: { enabled: false },
    });
    expect(disabled.json().user.enabled).toBe(false);

    const reset = await app.inject({
      method: 'POST',
      url: `/api/v2/admin/users/${userId}/reset-password`,
      headers: { cookie, 'x-csrf-token': body.csrfToken },
      payload: { password: 'NewMemberPass456!' },
    });
    expect(reset.statusCode).toBe(200);

    const audits = await app.inject({
      method: 'GET',
      url: '/api/v2/admin/audit-events?limit=50&offset=0',
      headers: { cookie },
    });
    expect(audits.statusCode).toBe(200);
    expect(audits.json().items.some((event: { action: string }) => event.action === 'user.create')).toBe(true);
    expect(JSON.stringify(audits.json())).not.toContain('13800138000');
    expect(JSON.stringify(audits.json())).not.toContain('MemberPass123!');

    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/v2/admin/users/${userId}`,
      headers: {
        cookie,
        origin: 'https://admin.example.test',
        'x-csrf-token': body.csrfToken,
      },
    });
    expect(removed.statusCode).toBe(204);

    const recreated = await app.inject({
      method: 'POST',
      url: '/api/v2/admin/users',
      headers: {
        cookie,
        origin: 'https://admin.example.test',
        'x-csrf-token': body.csrfToken,
      },
      payload: { phone: '13800138000', password: 'RecreatedPass789!', displayName: '重新授权用户' },
    });
    expect(recreated.statusCode).toBe(201);
    expect(recreated.json().user).toMatchObject({
      phoneMasked: '138****8000',
      displayName: '重新授权用户',
      enabled: true,
    });
    expect(recreated.json().user).not.toHaveProperty('phone');
    expect(recreated.json().user.id).not.toBe(userId);
  });

  it('requires explicit member passwords and revokes sessions after a successful reset', async () => {
    const rejectedAdminLogin = await app.inject({
      method: 'POST',
      url: '/api/v2/admin/auth/login',
      payload: { username: 'rootadmin', password: 'WrongAdminPassword123!' },
    });
    expect(rejectedAdminLogin.statusCode).toBe(401);

    const adminLogin = await app.inject({
      method: 'POST',
      url: '/api/v2/admin/auth/login',
      payload: { username: 'rootadmin', password: 'AdminPassword123!' },
    });
    expect(adminLogin.statusCode).toBe(200);
    const adminHeaders = {
      cookie: sessionCookie(adminLogin),
      'x-csrf-token': adminLogin.json().csrfToken as string,
    };

    const missingCreatePassword = await app.inject({
      method: 'POST',
      url: '/api/v2/admin/users',
      headers: adminHeaders,
      payload: { phone: '13600136000', displayName: '显式密码用户' },
    });
    expect(missingCreatePassword.statusCode).toBe(400);
    const afterRejectedCreate = await app.inject({
      method: 'GET', url: '/api/v2/admin/users', headers: adminHeaders,
    });
    expect(afterRejectedCreate.json().total).toBe(0);

    const created = await app.inject({
      method: 'POST',
      url: '/api/v2/admin/users',
      headers: adminHeaders,
      payload: { phone: '13600136000', password: 'InitialMemberPass123!', displayName: '显式密码用户' },
    });
    expect(created.statusCode).toBe(201);
    const userId = created.json().user.id as string;

    const initialLogin = await app.inject({
      method: 'POST',
      url: '/api/v2/auth/login',
      payload: { phone: '13600136000', password: 'InitialMemberPass123!' },
    });
    expect(initialLogin.statusCode).toBe(200);
    const oldUserCookie = sessionCookie(initialLogin);

    for (const payload of [undefined, {}]) {
      const missingResetPassword = await app.inject({
        method: 'POST',
        url: `/api/v2/admin/users/${userId}/reset-password`,
        headers: adminHeaders,
        ...(payload === undefined ? {} : { payload }),
      });
      expect(missingResetPassword.statusCode).toBe(400);
    }
    const sessionAfterRejectedReset = await app.inject({
      method: 'GET', url: '/api/v2/auth/me', headers: { cookie: oldUserCookie },
    });
    expect(sessionAfterRejectedReset.statusCode).toBe(200);
    const unchangedPasswordLogin = await app.inject({
      method: 'POST',
      url: '/api/v2/auth/login',
      payload: { phone: '13600136000', password: 'InitialMemberPass123!' },
    });
    expect(unchangedPasswordLogin.statusCode).toBe(200);
    const secondOldCookie = sessionCookie(unchangedPasswordLogin);

    const customReset = await app.inject({
      method: 'POST',
      url: `/api/v2/admin/users/${userId}/reset-password`,
      headers: adminHeaders,
      payload: { password: 'CustomMemberPass123!' },
    });
    expect(customReset.statusCode).toBe(200);
    expect(customReset.json().user).toMatchObject({ phoneMasked: '136****6000' });
    expect(customReset.json().user).not.toHaveProperty('phone');

    for (const cookie of [oldUserCookie, secondOldCookie]) {
      const revokedSession = await app.inject({
        method: 'GET', url: '/api/v2/auth/me', headers: { cookie },
      });
      expect(revokedSession.statusCode).toBe(401);
    }
    const staleInitialPassword = await app.inject({
      method: 'POST',
      url: '/api/v2/auth/login',
      payload: { phone: '13600136000', password: 'InitialMemberPass123!' },
    });
    expect(staleInitialPassword.statusCode).toBe(401);
    const customLogin = await app.inject({
      method: 'POST',
      url: '/api/v2/auth/login',
      payload: { phone: '13600136000', password: 'CustomMemberPass123!' },
    });
    expect(customLogin.statusCode).toBe(200);
  });

  it('publishes compatible snapshots through resource CRUD and gates province data', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/v2/admin/auth/login',
      payload: { username: 'rootadmin', password: 'AdminPassword123!' },
    });
    const adminCookie = sessionCookie(login);
    const csrfToken = login.json().csrfToken as string;
    const adminHeaders = { cookie: adminCookie, 'x-csrf-token': csrfToken };

    const publicPayload = {
      schema_version: '1.0.0',
      dataset_id: 'state-grid-recruitment-dashboard-v1',
      provinces: [{ adcode: '420000', name: '湖北省' }],
    };
    const publicRevision = await app.inject({
      method: 'POST',
      url: '/api/v2/admin/revisions',
      headers: adminHeaders,
      payload: {
        revisionKey: 'public-dashboard',
        title: '全国公开快照',
        status: 'published',
        dataStatus: 'verified',
        payload: publicPayload,
      },
    });
    expect(publicRevision.statusCode).toBe(201);

    const provincePayload = {
      schema_version: '3.0.0',
      dataset_id: 'hubei-v3',
      province: { adcode: '420000', name: '湖北省' },
    };
    await app.inject({
      method: 'POST',
      url: '/api/v2/admin/revisions',
      headers: adminHeaders,
      payload: {
        revisionKey: 'province-420000-dashboard',
        title: '湖北省受保护快照',
        status: 'published',
        dataStatus: 'verified',
        payload: provincePayload,
      },
    });

    const publicResponse = await app.inject({ method: 'GET', url: '/api/v2/public/dashboard' });
    expect(publicResponse.statusCode).toBe(200);
    expect(publicResponse.json()).toEqual(publicPayload);

    const privateAnonymous = await app.inject({
      method: 'GET',
      url: '/api/v2/private/provinces/420000/dashboard',
    });
    expect(privateAnonymous.statusCode).toBe(401);
    const profileAnonymous = await app.inject({
      method: 'GET',
      url: '/api/v2/private/provinces/420000/recruitment-profile?cohortYear=2026',
    });
    expect(profileAnonymous.statusCode).toBe(401);

    await app.inject({
      method: 'POST',
      url: '/api/v2/admin/users',
      headers: adminHeaders,
      payload: { phone: '13900139000', password: 'MemberPass123!' },
    });
    const userLogin = await app.inject({
      method: 'POST',
      url: '/api/v2/auth/login',
      payload: { phone: '13900139000', password: 'MemberPass123!' },
    });
    expect(userLogin.statusCode).toBe(200);
    const userCookie = sessionCookie(userLogin);
    const privateResponse = await app.inject({
      method: 'GET',
      url: '/api/v2/private/provinces/420000/dashboard',
      headers: { cookie: userCookie },
    });
    expect(privateResponse.statusCode).toBe(200);
    expect(privateResponse.json()).toEqual(provincePayload);
    const missingProfile = await app.inject({
      method: 'GET',
      url: '/api/v2/private/provinces/420000/recruitment-profile?cohortYear=2026',
      headers: { cookie: userCookie },
    });
    expect(missingProfile.statusCode).toBe(404);
    const unavailableYearProfile = await app.inject({
      method: 'GET',
      url: '/api/v2/private/provinces/420000/recruitment-profile?cohortYear=2027',
      headers: { cookie: userCookie },
    });
    expect(unavailableYearProfile.statusCode).toBe(422);
    expect(unavailableYearProfile.json()).toMatchObject({
      error: { code: 'PROVINCIAL_RECRUITMENT_YEAR_NOT_AVAILABLE' },
    });
  });

  it('provides full resource CRUD, exact evidence status and management dashboard totals', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/v2/admin/auth/login',
      payload: { username: 'rootadmin', password: 'AdminPassword123!' },
    });
    const headers = {
      cookie: sessionCookie(login),
      'x-csrf-token': login.json().csrfToken as string,
    };
    const province = await app.inject({
      method: 'POST',
      url: '/api/v2/admin/provinces',
      headers,
      payload: {
        provinceKey: 'PROV-CN-420000',
        adcode: '420000',
        name: '湖北省',
        mapClickable: true,
        mapCenter: [114.298572, 30.584355],
        businessDataStatus: 'available_hubei_recruitment_data',
        metadata: { pending_fields: [], source_ids: ['official-source'] },
      },
    });
    expect(province.statusCode).toBe(201);

    const created = await app.inject({
      method: 'POST',
      url: '/api/v2/admin/schools',
      headers,
      payload: {
        schoolKey: 'SCHOOL-QA-1',
        name: '验收学校',
        status: 'partially_verified_nonofficial',
        publicationStatus: 'draft',
        metadata: { pending_fields: ['official_source_mapping'], source_ids: ['qa-source'] },
      },
    });
    expect(created.statusCode).toBe(201);
    const schoolId = created.json().item.id as string;
    expect(created.json().item.status).toBe('partially_verified_nonofficial');

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/v2/admin/schools/${schoolId}`,
      headers,
      payload: { publicationStatus: 'published' },
    });
    expect(patched.json().item.publicationStatus).toBe('published');

    const list = await app.inject({
      method: 'GET',
      url: '/api/v2/admin/schools?limit=10&offset=0',
      headers: { cookie: headers.cookie },
    });
    expect(list.json()).toMatchObject({ total: 1, limit: 10, offset: 0 });
    expect(list.json().items[0].metadata.pending_fields).toEqual(['official_source_mapping']);

    const dashboard = await app.inject({
      method: 'GET',
      url: '/api/v2/admin/dashboard',
      headers: { cookie: headers.cookie },
    });
    expect(dashboard.statusCode).toBe(200);
    expect(dashboard.json().resources).toHaveLength(11);
    expect(
      dashboard.json().resources.find((row: { resource: string }) => row.resource === 'schools'),
    ).toMatchObject({ total: 1 });

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/v2/admin/schools/${schoolId}`,
      headers,
    });
    expect(deleted.statusCode).toBe(204);
    const missing = await app.inject({
      method: 'GET',
      url: `/api/v2/admin/schools/${schoolId}`,
      headers: { cookie: headers.cookie },
    });
    expect(missing.statusCode).toBe(404);
  });

  it('overlays canonical school batches onto the compatibility snapshot and reflects admin edits', async () => {
    const admin = await store.findAdminByUsername('rootadmin');
    if (!admin) throw new Error('missing test admin');
    const province = await store.createResource(
      'provinces',
      { provinceKey: 'PROV-CN-420000', adcode: '420000', name: '湖北省' },
      admin.id,
    );
    const company = await store.createResource(
      'companies',
      {
        companyKey: 'COMPANY-SGCC-HUBEI',
        name: '国网湖北省电力有限公司',
        provinceId: province.id,
        publicationStatus: 'published',
      },
      admin.id,
    );
    const school = await store.createResource(
      'schools',
      {
        schoolKey: 'MOE-4142011075',
        name: '三峡大学',
        publicationStatus: 'published',
      },
      admin.id,
    );
    const source = await store.createResource(
      'sources',
      {
        sourceKey: 'public-selection-aggregate-2026',
        title: '2026届湖北公示汇总',
        sourceType: 'provided_aggregate',
      },
      admin.id,
    );
    const batches = new Map<string, Record<string, unknown>>();
    for (const [code, name] of [
      ['batch_1', '第一批'],
      ['batch_2', '第二批'],
      ['batch_3', '第三批'],
    ] as const) {
      batches.set(
        code,
        await store.createResource(
          'recruitment-batches',
          {
            batchKey: `BATCH-SGCC-HUBEI-2026-${code.toUpperCase()}`,
            cohortYear: 2026,
            code,
            name,
            provinceId: province.id,
            companyId: company.id,
            unitScope: company.name,
            publicationStatus: 'published',
            sourceDocumentId: source.id,
            sourceKeys: ['public-selection-aggregate-2026'],
          },
          admin.id,
        ),
      );
    }
    const metricBase = {
      cohortYear: 2026,
      provinceId: province.id,
      cityId: null,
      schoolId: school.id,
      companyId: company.id,
      unitScope: company.name,
      metricType: 'public_notice_record_count',
      valueKind: 'derived_aggregate',
      unit: 'public_notice_records',
      sourceDocumentId: source.id,
      sourceKeys: ['public-selection-aggregate-2026'],
      status: 'verified',
      publicationStatus: 'published',
      privacySuppressed: false,
    };
    await store.createResource(
      'recruitment-metrics',
      {
        ...metricBase,
        metricKey: 'METRIC-SANXIA-2026-TOTAL',
        batchId: null,
        batchCode: 'all',
        aggregationGrain: 'cohort_school',
        value: 267,
      },
      admin.id,
    );
    let secondBatchMetric: Record<string, unknown> | null = null;
    for (const [code, value] of [
      ['batch_1', 190],
      ['batch_2', 49],
      ['batch_3', 28],
    ] as const) {
      const metric = await store.createResource(
        'recruitment-metrics',
        {
          ...metricBase,
          metricKey: `METRIC-SANXIA-2026-${code.toUpperCase()}`,
          batchId: batches.get(code)!.id,
          batchCode: code,
          aggregationGrain: 'cohort_batch_school',
          value,
        },
        admin.id,
      );
      if (code === 'batch_2') secondBatchMetric = metric;
    }
    await store.createResource(
      'revisions',
      {
        revisionKey: 'province-420000-dashboard',
        title: '湖北兼容快照',
        status: 'published',
        dataStatus: 'verified',
        payload: {
          schema_version: '3.0.0',
          dataset_id: 'hubei-v3-test',
          scope: { cohort: '2026届' },
          batches: [],
          schools: [
            {
              school_id: 'MOE-4142011075',
              display_name: '三峡大学',
              record_count: 267,
              batch_counts: {
                batch_1: { record_count: 267 },
                batch_2: { record_count: 267 },
                batch_3: { record_count: 267 },
              },
            },
          ],
        },
      },
      admin.id,
    );

    const adminLogin = await app.inject({
      method: 'POST',
      url: '/api/v2/admin/auth/login',
      payload: { username: 'rootadmin', password: 'AdminPassword123!' },
    });
    const adminHeaders = {
      cookie: sessionCookie(adminLogin),
      'x-csrf-token': adminLogin.json().csrfToken as string,
    };
    await app.inject({
      method: 'POST',
      url: '/api/v2/admin/users',
      headers: adminHeaders,
      payload: { phone: '13700137000', password: 'MemberPass123!' },
    });
    const userLogin = await app.inject({
      method: 'POST',
      url: '/api/v2/auth/login',
      payload: { phone: '13700137000', password: 'MemberPass123!' },
    });
    const userHeaders = { cookie: sessionCookie(userLogin) };

    const before = await app.inject({
      method: 'GET',
      url: '/api/v2/private/provinces/420000/dashboard',
      headers: userHeaders,
    });
    expect(before.statusCode).toBe(200);
    expect(before.json().schools[0]).toMatchObject({
      record_count: 267,
      batch_counts: {
        batch_1: { record_count: 190 },
        batch_2: { record_count: 49 },
        batch_3: { record_count: 28 },
      },
    });
    expect(before.json().data_sync.source).toBe('canonical_relational_tables');

    const schoolList = await app.inject({
      method: 'GET',
      url: '/api/v2/admin/schools?q=三峡大学&limit=10&offset=0',
      headers: { cookie: adminHeaders.cookie },
    });
    expect(schoolList.json().items[0]).toMatchObject({
      name: '三峡大学',
      allRecordCount: 267,
      batch1RecordCount: 190,
      batch2RecordCount: 49,
      batch3RecordCount: 28,
      hubeiDisciplineEvidenceStatus: '源数据未提供·待补',
      hubeiMajorEvidenceStatus: '源数据未提供·待补',
      hubeiMajorCategories: null,
      majorBreakdownStatus: '源数据未提供·待补',
    });
    const metricSearch = await app.inject({
      method: 'GET',
      url: '/api/v2/admin/recruitment-metrics?q=三峡大学&limit=10&offset=0',
      headers: { cookie: adminHeaders.cookie },
    });
    expect(metricSearch.json().total).toBe(4);
    expect(metricSearch.json().items.every((row: { schoolName: string }) => row.schoolName === '三峡大学')).toBe(true);

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/v2/admin/recruitment-metrics/${String(secondBatchMetric!.id)}`,
      headers: adminHeaders,
      payload: { value: 50 },
    });
    expect(patched.statusCode).toBe(200);
    const after = await app.inject({
      method: 'GET',
      url: '/api/v2/private/provinces/420000/dashboard',
      headers: userHeaders,
    });
    expect(after.json().schools[0].batch_counts.batch_2.record_count).toBe(50);
  });

  it('keeps province GeoJSON private, validates the adcode and sends no-store', async () => {
    const anonymous = await app.inject({
      method: 'GET',
      url: '/api/v2/private/map-geojson/420000',
    });
    expect(anonymous.statusCode).toBe(401);

    const adminLogin = await app.inject({
      method: 'POST',
      url: '/api/v2/admin/auth/login',
      payload: { username: 'rootadmin', password: 'AdminPassword123!' },
    });
    const adminHeaders = {
      cookie: sessionCookie(adminLogin),
      'x-csrf-token': adminLogin.json().csrfToken as string,
    };
    await app.inject({
      method: 'POST',
      url: '/api/v2/admin/users',
      headers: adminHeaders,
      payload: { phone: '13700137000', password: 'MemberPass123!' },
    });
    const userLogin = await app.inject({
      method: 'POST',
      url: '/api/v2/auth/login',
      payload: { phone: '13700137000', password: 'MemberPass123!' },
    });
    const cookie = sessionCookie(userLogin);

    const valid = await app.inject({
      method: 'GET',
      url: '/api/v2/private/map-geojson/420000',
      headers: { cookie },
    });
    expect(valid.statusCode).toBe(200);
    expect(valid.headers['cache-control']).toContain('no-store');
    expect(valid.json()).toEqual({ type: 'FeatureCollection', features: [] });

    const invalid = await app.inject({
      method: 'GET',
      url: '/api/v2/private/map-geojson/not-a-code',
      headers: { cookie },
    });
    expect(invalid.statusCode).toBe(400);
    const missing = await app.inject({
      method: 'GET',
      url: '/api/v2/private/map-geojson/430000',
      headers: { cookie },
    });
    expect(missing.statusCode).toBe(404);
  });

  it('rejects inconsistent recruitment scopes and filters merged requirement tags', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/v2/admin/auth/login',
      payload: { username: 'rootadmin', password: 'AdminPassword123!' },
    });
    const headers = {
      cookie: sessionCookie(login),
      'x-csrf-token': login.json().csrfToken as string,
    };
    const source = await store.createResource(
      'sources',
      { sourceKey: 'official-qa-source', title: '官方验收来源', sourceType: 'current_official_page' },
      'seed',
    );
    await store.createResource(
      'sources',
      { sourceKey: 'official-qa-supplement', title: '官方补充来源', sourceType: 'current_official_page' },
      'seed',
    );
    const wrongYearSource = await store.createResource(
      'sources',
      {
        sourceKey: 'official-qa-2025', title: '2025届官方来源', sourceType: 'current_official_page',
        cohortYear: 2025, batchCode: 'batch_1',
      },
      'seed',
    );
    const wrongBatchSource = await store.createResource(
      'sources',
      {
        sourceKey: 'official-qa-batch-2', title: '2026届第二批来源', sourceType: 'current_official_page',
        cohortYear: 2026, batchCode: 'batch_2',
      },
      'seed',
    );
    const provinceA = await store.createResource(
      'provinces',
      { provinceKey: 'PROV-QA-A', adcode: '420000', name: '湖北省', sortOrder: 1 },
      'seed',
    );
    const provinceB = await store.createResource(
      'provinces',
      { provinceKey: 'PROV-QA-B', adcode: '430000', name: '湖南省', sortOrder: 2 },
      'seed',
    );
    const companyA = await store.createResource(
      'companies',
      { companyKey: 'COMPANY-QA-A', name: '国网湖北省电力有限公司', provinceId: provinceA.id },
      'seed',
    );
    const companyB = await store.createResource(
      'companies',
      { companyKey: 'COMPANY-QA-B', name: '国网湖南省电力有限公司', provinceId: provinceB.id },
      'seed',
    );
    const cityB = await store.createResource(
      'cities',
      { cityKey: 'CITY-QA-B', name: '长沙市', provinceId: provinceB.id },
      'seed',
    );
    const batchA = await store.createResource(
      'recruitment-batches',
      {
        batchKey: 'BATCH-QA-A', cohortYear: 2026, code: 'batch_1', name: '第一批',
        provinceId: provinceA.id, companyId: companyA.id,
      },
      'seed',
    );

    const expectError = async (
      resource: string,
      payload: Record<string, unknown>,
      code: string,
    ) => {
      const response = await app.inject({
        method: 'POST',
        url: `/api/v2/admin/${resource}`,
        headers,
        payload,
      });
      expect(response.statusCode, response.body).toBe(400);
      expect(response.json()).toMatchObject({ error: { code } });
    };
    const eventBase = {
      eventKey: 'EVENT-QA-1', cohortYear: 2026, batchCode: 'batch_1',
      scopeKind: 'province_company', unitScope: '国网湖北省电力有限公司',
      eventType: 'written_exam', title: '笔试', sourceDocumentId: source.id,
      sourceKeys: ['official-qa-source'], status: 'verified', publicationStatus: 'published',
    };
    await expectError(
      'recruitment-events',
      { ...eventBase, provinceId: provinceA.id, companyId: companyB.id, batchId: batchA.id },
      'RECRUITMENT_COMPANY_PROVINCE_MISMATCH',
    );
    await expectError(
      'recruitment-events',
      { ...eventBase, eventKey: 'EVENT-QA-2', provinceId: provinceA.id, companyId: companyA.id },
      'EVENT_BATCH_REQUIRED',
    );
    await expectError(
      'recruitment-events',
      {
        ...eventBase, eventKey: 'EVENT-QA-BAD-TYPE', eventType: 'free_text_stage',
        provinceId: provinceA.id, companyId: companyA.id, batchId: batchA.id,
      },
      'RECRUITMENT_EVENT_TYPE_INVALID',
    );
    await expectError(
      'recruitment-events',
      {
        ...eventBase, eventKey: 'EVENT-QA-PRIMARY-SOURCE', provinceId: provinceA.id,
        companyId: companyA.id, batchId: batchA.id, sourceKeys: ['official-qa-supplement'],
      },
      'RECRUITMENT_PRIMARY_SOURCE_KEY_MISSING',
    );
    await expectError(
      'recruitment-events',
      {
        ...eventBase, eventKey: 'EVENT-QA-MISSING-SOURCE', provinceId: provinceA.id,
        companyId: companyA.id, batchId: batchA.id,
        sourceKeys: ['official-qa-source', 'official-qa-does-not-exist'],
      },
      'RECRUITMENT_SOURCE_KEY_NOT_FOUND',
    );
    await expectError(
      'recruitment-events',
      {
        ...eventBase, eventKey: 'EVENT-QA-SOURCE-YEAR', provinceId: provinceA.id,
        companyId: companyA.id, batchId: batchA.id, sourceDocumentId: wrongYearSource.id,
        sourceKeys: ['official-qa-2025'],
      },
      'RECRUITMENT_SOURCE_YEAR_MISMATCH',
    );
    await expectError(
      'recruitment-events',
      {
        ...eventBase, eventKey: 'EVENT-QA-SOURCE-BATCH', provinceId: provinceA.id,
        companyId: companyA.id, batchId: batchA.id, sourceDocumentId: wrongBatchSource.id,
        sourceKeys: ['official-qa-batch-2'],
      },
      'RECRUITMENT_SOURCE_BATCH_MISMATCH',
    );
    await expectError(
      'recruitment-batches',
      {
        batchKey: 'BATCH-QA-BAD', cohortYear: 2026, code: 'batch_2', name: '第二批',
        unitScope: '错配单位', provinceId: provinceA.id, companyId: companyB.id,
        sourceDocumentId: source.id, sourceKeys: ['official-qa-source'],
      },
      'RECRUITMENT_COMPANY_PROVINCE_MISMATCH',
    );
    await expectError(
      'schools',
      { schoolKey: 'SCHOOL-QA-BAD-CITY', name: '城市错配学校', provinceId: provinceA.id, cityId: cityB.id },
      'RECRUITMENT_CITY_PROVINCE_MISMATCH',
    );
    const metricBase = {
      metricKey: 'METRIC-QA-SCOPE', cohortYear: 2026, batchCode: 'all',
      disciplineGroup: 'all', unitScope: '国家电网', metricType: 'public_notice_record_count',
      valueKind: 'derived_aggregate', aggregationGrain: 'cohort_school', value: 10,
      unit: 'public_notice_records', sourceDocumentId: source.id,
      sourceKeys: ['public-selection-aggregate-2026'], status: 'derived', publicationStatus: 'published',
    };
    await expectError(
      'recruitment-metrics',
      { ...metricBase, destinationScope: 'network_total', provinceId: provinceA.id },
      'NATIONAL_SCOPE_MUST_NOT_BIND_PROVINCE',
    );
    await expectError(
      'recruitment-metrics',
      { ...metricBase, metricKey: 'METRIC-QA-PROVINCE', destinationScope: 'province', provinceId: provinceA.id, companyId: companyA.id },
      'PROVINCE_SCOPE_MUST_NOT_BIND_COMPANY',
    );
    await expectError(
      'recruitment-metrics',
      { ...metricBase, metricKey: 'METRIC-QA-COMPANY', destinationScope: 'company' },
      'COMPANY_SCOPE_REQUIRED',
    );
    await expectError(
      'recruitment-metrics',
      { ...metricBase, metricKey: 'METRIC-QA-UNKNOWN', destinationScope: 'unknown', provinceId: provinceA.id },
      'UNKNOWN_SCOPE_MUST_NOT_BIND_LOCATION',
    );
    await expectError(
      'recruitment-requirements',
      {
        requirementKey: 'REQ-QA-NO-BATCH', cohortYear: 2026, batchCode: 'batch_2',
        provinceId: provinceA.id, companyId: companyA.id, scopeKind: 'province_company',
        unitScope: '国网湖北省电力有限公司', category: 'education',
        title: '学历要求', excerpt: '以官方公告为准', sourceDocumentId: source.id,
        sourceKeys: ['official-qa-source'],
      },
      'REQUIREMENT_BATCH_SCOPE_INVALID',
    );
    await expectError(
      'recruitment-requirements',
      {
        requirementKey: 'REQ-QA-BAD-CATEGORY', cohortYear: 2026, batchCode: 'batch_1',
        provinceId: provinceA.id, companyId: companyA.id, scopeKind: 'province_company',
        unitScope: '国网湖北省电力有限公司', category: 'free_text_requirement',
        title: '非标准分类', excerpt: '官方原文', sourceDocumentId: source.id,
        sourceKeys: ['official-qa-source'],
      },
      'REQUIREMENT_CATEGORY_INVALID',
    );
    await expectError(
      'recruitment-requirements',
      {
        requirementKey: 'REQ-QA-BAD-TAGS', cohortYear: 2026, batchCode: 'batch_1',
        provinceId: provinceA.id, companyId: companyA.id, scopeKind: 'province_company',
        unitScope: '国网湖北省电力有限公司', category: 'education',
        categoryTags: ['major'], title: '学历要求', excerpt: '官方原文',
        sourceDocumentId: source.id, sourceKeys: ['official-qa-source'],
      },
      'REQUIREMENT_CATEGORY_TAGS_INVALID',
    );

    const normalizedRequirement = await app.inject({
      method: 'POST',
      url: '/api/v2/admin/recruitment-requirements',
      headers,
      payload: {
        requirementKey: 'REQ-QA-NORMALIZED-TAGS', cohortYear: 2026, batchCode: 'batch_1',
        provinceId: provinceA.id, companyId: companyA.id, scopeKind: 'province_company',
        unitScope: '国网湖北省电力有限公司', category: 'education',
        title: '学历要求', excerpt: '官方原文', sourceDocumentId: source.id,
        sourceKeys: ['official-qa-source'],
      },
    });
    expect(normalizedRequirement.statusCode, normalizedRequirement.body).toBe(201);
    expect(normalizedRequirement.json().item.categoryTags).toEqual(['education']);

    await store.createResource(
      'recruitment-requirements',
      {
        requirementKey: 'REQ-QA-TAGS', cohortYear: 2026, batchCode: 'batch_1',
        provinceId: provinceA.id, companyId: companyA.id, scopeKind: 'province_company',
        unitScope: '国网湖北省电力有限公司', category: 'cohort',
        categoryTags: ['cohort', 'education'], title: '应届生与学历要求', excerpt: '官方原文',
        sourceDocumentId: source.id, sourceKeys: ['official-qa-source'],
      },
      'seed',
    );
    const tagged = await app.inject({
      method: 'GET',
      url: '/api/v2/admin/recruitment-requirements?category=education&limit=20&offset=0',
      headers: { cookie: headers.cookie },
    });
    expect(tagged.statusCode).toBe(200);
    expect(tagged.json().items).toHaveLength(2);
    expect(
      tagged.json().items.find((item: { requirementKey: string }) => item.requirementKey === 'REQ-QA-TAGS')
        ?.categoryTags,
    ).toEqual(['cohort', 'education']);
  });
});
