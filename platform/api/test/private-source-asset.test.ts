import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import type { AppConfig } from '../src/config.js';
import { hashPassword } from '../src/lib/crypto.js';
import { MAX_PRIVATE_SOURCE_IMAGE_BYTES, readPrivateSourceAsset } from '../src/lib/private-source-asset.js';
import { PRIVATE_SOURCE_PREFIX } from '../src/lib/private-source-boundary.js';
import { MemoryStore } from '../src/store/memory.js';

type Row = Record<string, any>;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9sAAAAASUVORK5CYII=', 'base64');
// Synthetic signature fixture: this endpoint verifies signature + archive hash,
// not image decoding. No real document image or personal data is copied here.
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xd9]);
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const sourceFor = (bytes = png): Row => ({
  id: randomUUID(), sourceKey: PRIVATE_SOURCE_PREFIX + 'IMAGE-TEST', sourceType: 'provided_nonofficial_image', title: '测试原图',
  metadata: { visibility: 'admin_only', materialKind: 'image_ocr', ordinal: 1, recordId: 'RecordTest123', imageBytes: bytes.length, imageSha256: digest(bytes) },
});
const filename = (extension = '.png') => `001-RecordTest123${extension}`;

describe('private source asset reader', () => {
  let root: string;
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'private-source-asset-')); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it.each([['.png', png, 'image/png'], ['.jpg', jpeg, 'image/jpeg']] as const)('reads exact hash-checked %s bytes without changing originals', async (extension, bytes, contentType) => {
    await writeFile(join(root, filename(extension)), bytes);
    const result = await readPrivateSourceAsset(sourceFor(bytes), root);
    expect(result.contentType).toBe(contentType);
    expect(result.bytes.equals(bytes)).toBe(true);
    expect((await readFile(join(root, filename(extension)))).equals(bytes)).toBe(true);
  });

  it('reports missing configuration and missing files with bounded codes', async () => {
    await expect(readPrivateSourceAsset(sourceFor())).rejects.toMatchObject({ statusCode: 503, code: 'SOURCE_ASSET_NOT_CONFIGURED' });
    await expect(readPrivateSourceAsset(sourceFor(), root)).rejects.toMatchObject({ statusCode: 404, code: 'SOURCE_ASSET_NOT_FOUND' });
  });

  it('rejects public sources, non-image materials, and another source type', async () => {
    for (const source of [
      { ...sourceFor(), sourceKey: 'public-source', metadata: { ...sourceFor().metadata, visibility: 'public' } },
      { ...sourceFor(), metadata: { ...sourceFor().metadata, materialKind: 'body_section' } },
      { ...sourceFor(), sourceType: 'reference' },
    ]) await expect(readPrivateSourceAsset(source, root)).rejects.toMatchObject({ code: 'SOURCE_ASSET_NOT_FOUND' });
  });

  it('rejects traversal, URLs, invalid ordinals, missing hash, and over-limit metadata before reading a file', async () => {
    for (const patch of [
      { recordId: '../../outside' }, { recordId: 'https://example.test/a' }, { recordId: '/absolute' },
      { recordId: 'a\\b' }, { ordinal: 0 }, { ordinal: 233 }, { ordinal: '1' },
      { imageSha256: 'not-a-hash' }, { imageBytes: MAX_PRIVATE_SOURCE_IMAGE_BYTES + 1 },
    ]) await expect(readPrivateSourceAsset({ ...sourceFor(), metadata: { ...sourceFor().metadata, ...patch } }, root)).rejects.toMatchObject({ code: 'SOURCE_ASSET_INVALID' });
    await expect(readPrivateSourceAsset(sourceFor(), 'relative/path')).rejects.toMatchObject({ code: 'SOURCE_ASSET_INVALID' });
  });

  it('rejects mismatched size, hash, and format/signature', async () => {
    await writeFile(join(root, filename()), png);
    for (const patch of [{ imageBytes: png.length + 1 }, { imageSha256: '0'.repeat(64) }]) {
      await expect(readPrivateSourceAsset({ ...sourceFor(), metadata: { ...sourceFor().metadata, ...patch } }, root)).rejects.toMatchObject({ code: 'SOURCE_ASSET_INVALID' });
    }
    await writeFile(join(root, filename()), jpeg);
    await expect(readPrivateSourceAsset(sourceFor(jpeg), root)).rejects.toMatchObject({ code: 'SOURCE_ASSET_INVALID' });
    const html = Buffer.from('<html>not an image</html>');
    await writeFile(join(root, filename()), html);
    await expect(readPrivateSourceAsset(sourceFor(html), root)).rejects.toMatchObject({ code: 'SOURCE_ASSET_INVALID' });
  });

  it('rejects duplicate candidates, symbolic links and directories', async () => {
    await writeFile(join(root, filename()), png);
    await writeFile(join(root, filename('.jpg')), jpeg);
    await expect(readPrivateSourceAsset(sourceFor(), root)).rejects.toMatchObject({ code: 'SOURCE_ASSET_INVALID' });
    await rm(join(root, filename('.jpg')));
    await rm(join(root, filename()));
    await writeFile(join(root, 'outside.png'), png);
    await symlink(join(root, 'outside.png'), join(root, filename()));
    await expect(readPrivateSourceAsset(sourceFor(), root)).rejects.toMatchObject({ code: 'SOURCE_ASSET_INVALID' });
    await rm(join(root, filename()));
    await mkdir(join(root, filename()));
    await expect(readPrivateSourceAsset(sourceFor(), root)).rejects.toMatchObject({ code: 'SOURCE_ASSET_INVALID' });
    const linkRoot = join(root, 'linked-root');
    await symlink(root, linkRoot);
    await expect(readPrivateSourceAsset(sourceFor(), linkRoot)).rejects.toMatchObject({ code: 'SOURCE_ASSET_INVALID' });
  });
});

describe('administrator-only asset route', () => {
  let root: string;
  let app: FastifyInstance;
  let store: MemoryStore;
  let source: Row;
  let adminHeaders: Record<string, string>;
  let memberHeaders: Record<string, string>;
  const cookie = (response: any) => String(Array.isArray(response.headers['set-cookie']) ? response.headers['set-cookie'][0] : response.headers['set-cookie']).split(';')[0]!;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'private-source-asset-api-'));
    await writeFile(join(root, filename()), png);
    const config: AppConfig = {
      nodeEnv: 'test', host: '127.0.0.1', port: 8799, trustProxyHops: 0, databaseUrl: 'postgresql://unused',
      publicOrigins: ['https://admin.example.test'], cookieSecure: true, sessionTtlSeconds: 7200,
      sessionSecret: 'source-asset-test-'.padEnd(48, 's'), phonePepper: 'source-asset-'.padEnd(48, 'p'),
      phoneEncryptionKey: Buffer.alloc(32, 7), mapGeojsonDir: '/nonexistent-test-map', autoMigrate: false,
      privateSourceAssetDir: root,
    };
    store = new MemoryStore();
    const admin = await store.upsertAdmin({ username: 'test-admin', displayName: '测试管理员', passwordHash: await hashPassword('SyntheticAssetTestPassword!'), role: 'superadmin' });
    source = await store.createResource('sources', sourceFor(), admin.id);
    app = await buildApp({ config, store });
    const login = await app.inject({ method: 'POST', url: '/api/v2/admin/auth/login', payload: { username: 'test-admin', password: 'SyntheticAssetTestPassword!' } });
    adminHeaders = { cookie: cookie(login), 'x-csrf-token': login.json().csrfToken };
    await app.inject({ method: 'POST', url: '/api/v2/admin/users', headers: adminHeaders, payload: { phone: '13800138000' } });
    const member = await app.inject({ method: 'POST', url: '/api/v2/auth/login', payload: { phone: '13800138000', password: '12345678' } });
    memberHeaders = { cookie: cookie(member) };
  });
  afterEach(async () => { await app.close(); await rm(root, { recursive: true, force: true }); });

  it('serves an inline no-store nosniff PNG only to an authenticated administrator', async () => {
    const url = `/api/v2/admin/sources/${source.id}/asset`;
    for (const headers of [{}, memberHeaders]) expect((await app.inject({ method: 'GET', url, headers })).statusCode).toBe(401);
    const result = await app.inject({ method: 'GET', url, headers: adminHeaders });
    expect(result.statusCode).toBe(200);
    expect(result.headers['content-type']).toBe('image/png');
    expect(result.headers['cache-control']).toContain('no-store');
    expect(result.headers['x-content-type-options']).toBe('nosniff');
    expect(result.rawPayload.equals(png)).toBe(true);
  });

  it('does not leak host paths on invalid metadata or missing source records', async () => {
    await store.updateResource('sources', source.id, { metadata: { ...source.metadata, recordId: '../../outside' } });
    const result = await app.inject({ method: 'GET', url: `/api/v2/admin/sources/${source.id}/asset`, headers: adminHeaders });
    expect(result.statusCode).toBe(503);
    expect(result.json().error.code).toBe('SOURCE_ASSET_INVALID');
    expect(result.body).not.toContain(root);
    const missing = await app.inject({ method: 'GET', url: `/api/v2/admin/sources/${randomUUID()}/asset`, headers: adminHeaders });
    expect(missing.statusCode).toBe(404);
  });
});
