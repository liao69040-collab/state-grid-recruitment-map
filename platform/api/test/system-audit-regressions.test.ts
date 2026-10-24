import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { createDatabase } from '../src/db/client.js';
import type { AppConfig } from '../src/config.js';
import { hashPassword, secretDigest, encryptPhone, phoneLookupHash } from '../src/lib/crypto.js';
import { MemoryStore } from '../src/store/memory.js';

const config: AppConfig = {
  nodeEnv: 'test', host: '127.0.0.1', port: 8790, trustProxyHops: 0,
  databaseUrl: 'postgresql://unused', publicOrigins: ['https://audit.example.test'],
  cookieSecure: true, sessionTtlSeconds: 7200, sessionSecret: 'audit-test-'.padEnd(48, 's'),
  phonePepper: 'audit-test-'.padEnd(48, 'p'), phoneEncryptionKey: Buffer.alloc(32, 9),
  mapGeojsonDir: '/tmp/unused-system-audit-map', autoMigrate: false,
};

describe('2026-10-11 API audit regressions', () => {
  let app: FastifyInstance;
  let store: MemoryStore;
  beforeEach(async () => {
    store = new MemoryStore();
    app = await buildApp({ config, store });
  });
  afterEach(async () => { await app.close(); vi.restoreAllMocks(); });

  it.each([
    '/api/v2/private/grid-information/overview',
    '/api/v2/private/grid-information/provinces/420000',
    '/api/v2/private/map-geojson/420000',
    '/api/v2/admin/users',
    '/api/v2/auth/me',
    '/api/v2/public/not-a-real-endpoint',
  ])('does not cache authentication and not-found responses: %s', async (url) => {
    const response = await app.inject({ url });
    expect([401, 404]).toContain(response.statusCode);
    expect(response.headers['cache-control']).toContain('no-store');
  });

  it('does not cache malformed, denied-origin, oversized or throttled requests', async () => {
    const options = { method: 'POST' as const, url: '/api/v2/admin/auth/login' };
    for (const [headers, payload, status] of [
      [{ 'content-type': 'application/json' }, '{"username":', 400],
      [{ origin: 'https://untrusted.example.test' }, {}, 403],
      [{ 'content-type': 'application/json' }, 'a'.repeat(2 * 1024 * 1024 + 1), 413],
    ] as const) {
      const response = await app.inject({ ...options, headers, payload });
      expect(response.statusCode).toBe(status);
      expect(response.headers['cache-control']).toContain('no-store');
    }
    let limited;
    for (let attempt = 0; attempt < 6; attempt++) {
      limited = await app.inject({ ...options, payload: {} });
      if (limited.statusCode === 429) break;
    }
    expect(limited?.statusCode).toBe(429);
    expect(limited?.headers['cache-control']).toContain('no-store');
  });

  it('rejects unauthenticated access without reading the source database', async () => {
    const lookup = vi.spyOn(store, 'adminOnlySources').mockRejectedValue(new Error('database unavailable'));
    const response = await app.inject({ url: '/api/v2/private/grid-information/overview' });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('AUTH_REQUIRED');
    expect(lookup).not.toHaveBeenCalled();
  });

  it('rejects malformed resource scope filters before querying the store', async () => {
    const admin = await store.upsertAdmin({ username: 'filter-admin', displayName: '测试管理', passwordHash: 'unused', role: 'superadmin' });
    await store.createAdminSession(admin.id, { tokenHash: secretDigest('filter-token', config.sessionSecret), csrfHash: 'test-only', expiresAt: new Date(Date.now() + 60_000), ipHash: 'test-only', userAgentHash: 'test-only' });
    const queryStore = vi.spyOn(store, 'listResource');
    for (const query of ['provinceId=not-a-uuid', 'companyId=not-a-uuid', 'cityId=none', 'cohortYear=oops', 'cohortYear=3000']) {
      const response = await app.inject({ url: `/api/v2/admin/recruitment-metrics?${query}`, headers: { cookie: 'hz_admin_session=filter-token' } });
      expect(response.statusCode).toBe(400);
    }
    expect(queryStore).not.toHaveBeenCalled();
  });

  it('keeps wrapped database SQL and parameter values out of error logs', async () => {
    vi.spyOn(store, 'health').mockRejectedValue(new Error('SQL with sensitive-parameter-value', { cause: Object.assign(new Error('sensitive-parameter-value'), { code: '57014' }) }));
    const logged = vi.spyOn(app.log, 'error').mockImplementation(() => {});
    const response = await app.inject({ url: '/healthz' });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: { code: 'INTERNAL_ERROR', message: '服务暂时不可用' } });
    expect(logged).toHaveBeenCalledWith({ databaseCode: '57014' }, 'database request failed');
    expect(JSON.stringify(logged.mock.calls)).not.toContain('sensitive-parameter-value');
  });

  it('searches member display names literally without returning unrelated users', async () => {
    const admin = await store.upsertAdmin({ username: 'test-admin', displayName: '测试管理', passwordHash: await hashPassword('test-only-pass'), role: 'superadmin' });
    await store.createAdminSession(admin.id, { tokenHash: secretDigest('test-only-token', config.sessionSecret), csrfHash: 'test-only', expiresAt: new Date(Date.now() + 60_000), ipHash: 'test-only', userAgentHash: 'test-only' });
    for (const [phone, displayName] of [['19900001111', '湖北测试会员'], ['19900002222', '湖南测试会员'], ['19900003333', '100%_测试会员']] as const) {
      await store.createUser({ phoneLookupHash: phoneLookupHash(phone, config.phonePepper), phoneCiphertext: encryptPhone(phone, config.phoneEncryptionKey), phoneLast4: phone.slice(-4), displayName, passwordHash: 'not-used', createdByAdminId: admin.id });
    }
    const search = (q: string) => app.inject({ url: `/api/v2/admin/users?q=${encodeURIComponent(q)}`, headers: { cookie: 'hz_admin_session=test-only-token' } });
    for (const [term, expected] of [['湖北', '湖北测试会员'], ['%_', '100%_测试会员'], ['2222', '湖南测试会员'], ['19900001111', '湖北测试会员']] as const) {
      const response = await search(term);
      expect(response.statusCode).toBe(200);
      expect(response.json().items.map((row: { displayName: string }) => row.displayName)).toEqual([expected]);
    }
    expect((await search('不存在的备注名')).json().total).toBe(0);
    expect((await search('123')).statusCode).toBe(400);
  });

  it('does not issue a login cookie when the password changes after verification', async () => {
    const phone = '19900006666';
    const password = 'synthetic-original-pass';
    const admin = await store.upsertAdmin({ username: 'login-audit', displayName: '测试管理', passwordHash: 'unused' });
    await store.createUser({ phoneLookupHash: phoneLookupHash(phone, config.phonePepper), phoneCiphertext: encryptPhone(phone, config.phoneEncryptionKey), phoneLast4: '6666', passwordHash: await hashPassword(password), createdByAdminId: admin.id });
    const createSession = store.createUserSession.bind(store);
    vi.spyOn(store, 'createUserSession').mockImplementation(async (id, session, verifiedPasswordHash) => {
      await store.resetUserPassword(id, 'changed-before-session');
      return createSession(id, session, verifiedPasswordHash);
    });
    const response = await app.inject({ method: 'POST', url: '/api/v2/auth/login', payload: { phone, password } });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('AUTH_STATE_CHANGED');
    expect(response.headers['set-cookie']).toBeUndefined();
  });
});

describe('Postgres connection lifecycle', () => {
  it('handles idle connection loss without crashing or logging connection secrets', async () => {
    const logger = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { pool } = createDatabase('postgresql://unused');
    try {
      const error = Object.assign(new Error('password and host must not leak'), { code: '57P01' });
      expect(() => pool.emit('error', error)).not.toThrow();
      expect(logger.mock.calls.flat().join(' ')).toContain('57P01');
      expect(logger.mock.calls.flat().join(' ')).not.toContain('password');
    } finally { await pool.end(); logger.mockRestore(); }
  });
});
