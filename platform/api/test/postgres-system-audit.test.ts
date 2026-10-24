import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { createDatabase } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrate.js';
import { PostgresStore } from '../src/store/postgres.js';
import { sha256 } from '../src/lib/crypto.js';
import { secretDigest, csrfForSession } from '../src/lib/crypto.js';
import { buildApp } from '../src/app.js';

const dbUrl = process.env.AUDIT_TEST_DATABASE_URL;
describe.runIf(Boolean(dbUrl))('audit fixes against isolated PostgreSQL', () => {
  let pool: Pool;
  let store: PostgresStore;
  let adminId: string;
  beforeAll(async () => {
    const url = new URL(dbUrl!);
    if (url.hostname !== '127.0.0.1' || url.pathname !== '/api_integration_audit') throw new Error('Isolated loopback audit database required');
    const connection = createDatabase(dbUrl!); pool = connection.pool; store = new PostgresStore(connection.db);
    await runMigrations(connection.db);
    adminId = (await store.upsertAdmin({ username: 'synthetic-audit', displayName: '测试管理', passwordHash: 'not-a-real-hash' })).id;
  });
  afterAll(async () => { if (pool) await pool.end(); });
  const newUser = (name: string) => store.createUser({ phoneLookupHash: sha256(randomUUID()), phoneCiphertext: 'synthetic-only', phoneLast4: '9000', displayName: name, passwordHash: 'old-test-only-hash', createdByAdminId: adminId });

  it('matches literal display names, percent/underscore and case consistently', async () => {
    await newUser('湖北 Audit 100%_会员');
    await newUser('湖南 Audit 普通会员');
    for (const displayName of ['湖北', '100%_', 'audit 100']) {
      const result = await store.listUsers({ limit: 10, offset: 0, displayName });
      expect(result.total).toBe(1);
      expect(result.items[0]?.displayName).toBe('湖北 Audit 100%_会员');
    }
    expect((await store.listUsers({ limit: 10, offset: 0, displayName: '未存在的名字' })).total).toBe(0);
  });

  it('returns a safe conflict response for real database uniqueness and foreign-key errors', async () => {
    const config = {
      nodeEnv: 'test' as const, host: '127.0.0.1', port: 8790, trustProxyHops: 0, databaseUrl: dbUrl!,
      publicOrigins: ['https://audit.example.test'], cookieSecure: true, sessionTtlSeconds: 7200,
      sessionSecret: 'isolated-test-'.padEnd(48, 's'), phonePepper: 'isolated-test-'.padEnd(48, 'p'),
      phoneEncryptionKey: Buffer.alloc(32, 9), mapGeojsonDir: '/tmp/unused-audit-map', autoMigrate: false,
    };
    const token = 'synthetic-integration-token';
    await store.createAdminSession(adminId, { tokenHash: secretDigest(token, config.sessionSecret), csrfHash: sha256('test'), expiresAt: new Date(Date.now() + 60_000), ipHash: sha256('test'), userAgentHash: sha256('test') });
    const app = await buildApp({ config, store });
    const headers = { cookie: `hz_admin_session=${token}`, 'x-csrf-token': csrfForSession(token, config.sessionSecret) };
    try {
      const create = () => app.inject({ method: 'POST', url: '/api/v2/admin/users', headers, payload: { phone: '19900005555', password: 'synthetic-test-only' } });
      expect((await create()).statusCode).toBe(201);
      const duplicate = await create();
      expect(duplicate.statusCode).toBe(409);
      expect(duplicate.json()).toEqual({ error: { code: 'CONFLICT', message: '数据已存在' } });
      const province = await store.createResource('provinces', { adcode: '990001', name: '合成省', shortName: '合成', sortOrder: 0 }, adminId);
      await store.createResource('cities', { adcode: '990101', name: '合成市', provinceId: province.id, sortOrder: 0 }, adminId);
      const inUse = await app.inject({ method: 'DELETE', url: `/api/v2/admin/provinces/${province.id}`, headers });
      expect(inUse.statusCode).toBe(409);
      expect(inUse.json().error.code).toBe('RESOURCE_IN_USE');
    } finally { await app.close(); }
  });

  it.each(['reset', 'disable', 'delete'] as const)('rolls back %s when session revocation fails', async (action) => {
    const user = await newUser(`事务测试 ${action}`);
    const tokenHash = sha256(randomUUID());
    await store.createUserSession(user.id, { tokenHash, csrfHash: sha256('test-only'), expiresAt: new Date(Date.now() + 60_000), ipHash: sha256('test'), userAgentHash: sha256('test') });
    await pool.query("CREATE OR REPLACE FUNCTION audit_fail_session_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'INJECTED_SESSION_FAILURE'; END $$");
    await pool.query('CREATE TRIGGER audit_session_failure BEFORE UPDATE ON user_sessions FOR EACH ROW EXECUTE FUNCTION audit_fail_session_update()');
    try {
      const mutate = () => action === 'reset' ? store.resetUserPassword(user.id, 'new-test-only-hash')
        : action === 'disable' ? store.updateUser(user.id, { enabled: false }) : store.softDeleteUser(user.id);
      await expect(mutate()).rejects.toThrow();
      const state = (await pool.query('SELECT password_hash, enabled, deleted_at FROM users WHERE id=$1', [user.id])).rows[0];
      expect(state).toEqual({ password_hash: 'old-test-only-hash', enabled: true, deleted_at: null });
    } finally { await pool.query('DROP TRIGGER audit_session_failure ON user_sessions'); }
    if (action === 'reset') await store.resetUserPassword(user.id, 'new-test-only-hash');
    else if (action === 'disable') await store.updateUser(user.id, { enabled: false });
    else await store.softDeleteUser(user.id);
    expect((await store.findUserSession(tokenHash))?.revokedAt).toBeInstanceOf(Date);
  });

  it('replaces a terminated idle database connection without taking the pool down', async () => {
    const capture = vi.spyOn(console, 'error').mockImplementation(() => {});
    const client = await pool.connect();
    const pid = (await client.query('SELECT pg_backend_pid() pid')).rows[0].pid;
    client.release();
    const observer = createDatabase(dbUrl!);
    const idleError = new Promise<Error>(resolve => pool.once('error', resolve));
    try {
      await observer.pool.query('SELECT pg_terminate_backend($1)', [pid]);
      expect((await idleError).message).toContain('terminating');
      expect((await pool.query('SELECT 1 AS alive')).rows[0].alive).toBe(1);
      expect(capture.mock.calls.flat().join(' ')).toContain('57P01');
    } finally { capture.mockRestore(); await observer.pool.end(); }
  });

  it('does not let an old password check create a session after a reset or account disable', async () => {
    const user = await newUser('并发登录检查');
    const session = { tokenHash: sha256(randomUUID()), csrfHash: sha256('test-only'), expiresAt: new Date(Date.now() + 60_000), ipHash: sha256('test'), userAgentHash: sha256('test') };
    await store.resetUserPassword(user.id, 'reset-test-only-hash');
    await expect(store.createUserSession(user.id, session, 'old-test-only-hash')).rejects.toMatchObject({ code: 'AUTH_STATE_CHANGED' });
    expect(await store.findUserSession(session.tokenHash)).toBeNull();
    await store.createUserSession(user.id, session, 'reset-test-only-hash');
    expect(await store.findUserSession(session.tokenHash)).not.toBeNull();
    await store.updateUser(user.id, { enabled: false });
    const disabledSession = { ...session, tokenHash: sha256(randomUUID()) };
    await expect(store.createUserSession(user.id, disabledSession, 'reset-test-only-hash')).rejects.toMatchObject({ code: 'AUTH_STATE_CHANGED' });
    expect(await store.findUserSession(disabledSession.tokenHash)).toBeNull();
  });

  it('waits for a concurrent password reset before authorizing a new session', async () => {
    const user = await newUser('真实并发锁测试');
    const session = { tokenHash: sha256(randomUUID()), csrfHash: sha256('test-only'), expiresAt: new Date(Date.now() + 60_000), ipHash: sha256('test'), userAgentHash: sha256('test') };
    const reset = await pool.connect();
    try {
      await reset.query('BEGIN');
      await reset.query('UPDATE users SET password_hash=$1 WHERE id=$2', ['new-concurrent-hash', user.id]);
      const attempt = store.createUserSession(user.id, session, 'old-test-only-hash').then(() => 'created', (error: { code: string }) => error.code);
      await vi.waitFor(async () => {
        const waiting = await pool.query("SELECT count(*)::int n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query ILIKE '%for update%'");
        expect(waiting.rows[0].n).toBeGreaterThan(0);
      }, { timeout: 3_000, interval: 10 });
      await reset.query('COMMIT');
      expect(await attempt).toBe('AUTH_STATE_CHANGED');
      expect(await store.findUserSession(session.tokenHash)).toBeNull();
    } finally { await reset.query('ROLLBACK'); reset.release(); }
  });
});
