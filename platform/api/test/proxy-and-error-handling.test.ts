import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { AppConfig } from '../src/config.js';
import { MemoryStore } from '../src/store/memory.js';

// These cases pin behaviour that only shows up under the *production* proxy
// configuration (TRUST_PROXY_HOPS=1, one Caddy in front). The rest of the suite
// runs with trustProxyHops: 0, which is why the original defects were invisible.
describe('反向代理信任与框架错误映射', () => {
  let config: AppConfig;

  const newApp = async (): Promise<FastifyInstance> => {
    const app = await buildApp({ config, store: new MemoryStore(), logger: false });
    await app.ready();
    return app;
  };

  const login = (app: FastifyInstance, forwardedFor: string) =>
    app.inject({
      method: 'POST',
      url: '/api/v2/admin/auth/login',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': forwardedFor },
      payload: { username: 'nobody', password: 'whatever123' },
    });

  beforeEach(async () => {
    const mapDir = await mkdtemp(join(tmpdir(), 'proxy-trust-map-'));
    await writeFile(join(mapDir, '420000.json'), '{"type":"FeatureCollection","features":[]}', 'utf8');
    config = {
      nodeEnv: 'production',
      host: '127.0.0.1',
      port: 8790,
      trustProxyHops: 1,
      databaseUrl: 'postgresql://unused',
      publicOrigins: ['https://public.example.test', 'https://admin.example.test'],
      cookieSecure: true,
      sessionTtlSeconds: 7200,
      sessionSecret: 'session-secret-'.padEnd(48, 's'),
      phonePepper: 'phone-pepper-'.padEnd(48, 'p'),
      phoneEncryptionKey: Buffer.alloc(32, 7),
      mapGeojsonDir: mapDir,
      autoMigrate: false,
    };
  });

  it('伪造 X-Forwarded-For 不能绕过登录限流', async () => {
    const app = await newApp();
    const statuses: number[] = [];
    // A client that rotates its own X-Forwarded-For on every request. Caddy
    // appends the real peer address after it, so only the *last* entry may be
    // trusted with one proxy hop.
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const response = await login(app, `9.9.9.${attempt}, 203.0.113.5`);
      statuses.push(response.statusCode);
    }
    expect(statuses.filter((status) => status === 429).length).toBeGreaterThan(0);
  });

  it('同一真实客户端的限流仍然生效', async () => {
    const app = await newApp();
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const response = await login(app, '203.0.113.9');
      statuses.push(response.statusCode);
    }
    expect(statuses.filter((status) => status === 429).length).toBeGreaterThan(0);
  });

  it('限流返回 429 而不是 500', async () => {
    const app = await newApp();
    let limited: Awaited<ReturnType<typeof login>> | null = null;
    for (let attempt = 0; attempt < 9 && !limited; attempt += 1) {
      const response = await login(app, '198.51.100.7');
      if (response.statusCode !== 401) limited = response;
    }
    expect(limited?.statusCode).toBe(429);
    expect(JSON.parse(limited!.body).error.code).toBe('RATE_LIMITED');
  });

  it('畸形 JSON 返回 400 而不是 500', async () => {
    const app = await newApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v2/admin/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: '{"username":',
    });
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error.code).not.toBe('INTERNAL_ERROR');
  });

  it('请求体超过 bodyLimit 返回 413 而不是 500', async () => {
    const app = await newApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v2/admin/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ username: 'a'.repeat(3 * 1024 * 1024), password: 'x'.repeat(10) }),
    });
    expect(response.statusCode).toBe(413);
  });
});
