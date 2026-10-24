import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../platform/api/src/app.ts';
import type { AppConfig } from '../platform/api/src/config.ts';
import { encryptPhone, hashPassword, phoneLookupHash } from '../platform/api/src/lib/crypto.ts';
import { MemoryStore } from '../platform/api/src/store/memory.ts';
import { createDemoData, demoRegions } from './data.ts';

export const DEMO_USER_PHONE = '13800138000';
export const DEMO_ADMIN_USERNAME = 'demo-admin';
export const DEMO_PASSWORD = 'GridAtlasDemo123!';

export async function createDemoApp() {
  if (process.env.NODE_ENV === 'production') throw new Error('The in-memory demo cannot run in production.');
  const config: AppConfig = {
    nodeEnv: 'test', host: '127.0.0.1', port: Number(process.env.GRID_ATLAS_DEMO_API_PORT || 8788),
    trustProxyHops: 0, databaseUrl: 'memory://synthetic-demo',
    publicOrigins: ['http://127.0.0.1:8112', 'http://127.0.0.1:4173', 'http://127.0.0.1:4174'],
    cookieSecure: false, sessionTtlSeconds: 7200,
    sessionSecret: randomBytes(48).toString('base64url'), phonePepper: randomBytes(48).toString('base64url'),
    phoneEncryptionKey: randomBytes(32),
    mapGeojsonDir: fileURLToPath(new URL('../public/map-geojson', import.meta.url)), autoMigrate: false,
  };
  const store = new MemoryStore();
  const data = createDemoData();
  store.seedGridDataset(data.dataset);
  store.seedGridMapCatalog(data.catalog);
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const admin = await store.upsertAdmin({ username: DEMO_ADMIN_USERNAME, displayName: '公开演示管理员', passwordHash, role: 'superadmin' });
  await store.createUser({ phoneLookupHash: phoneLookupHash(DEMO_USER_PHONE, config.phonePepper),
    phoneCiphertext: encryptPhone(DEMO_USER_PHONE, config.phoneEncryptionKey), phoneLast4: '8000',
    passwordHash, displayName: '合成演示用户', createdByAdminId: admin.id });
  for (const region of demoRegions) {
    await store.createResource('provinces', { provinceKey: `demo.province.${region.adcode}`, adcode: region.adcode,
      name: region.name, mapClickable: true, businessDataStatus: 'synthetic', status: 'active',
      publicationStatus: 'published', metadata: { synthetic: true } }, admin.id);
  }
  const app = await buildApp({ config, store, logger: false });
  return { app, config, data };
}
