import 'dotenv/config';
import { z } from 'zod';

const booleanFromEnv = z
  .enum(['true', 'false'])
  .default('true')
  .transform((value) => value === 'true');

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8790),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(1),
  DATABASE_URL: z.string().min(1),
  PUBLIC_ORIGINS: z.string().default('http://127.0.0.1:4173,http://127.0.0.1:4174'),
  COOKIE_SECURE: booleanFromEnv,
  SESSION_TTL_SECONDS: z.coerce.number().int().min(300).max(86400).default(7200),
  SESSION_SECRET: z.string().min(32),
  PHONE_PEPPER: z.string().min(32),
  PHONE_ENCRYPTION_KEY: z.string().min(40),
  MAP_GEOJSON_DIR: z.string().default('/app/data/map-geojson'),
  PRIVATE_SOURCE_ASSET_DIR: z.string().min(1).optional(),
  AUTO_MIGRATE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});

export type AppConfig = {
  nodeEnv: 'development' | 'test' | 'production';
  host: string;
  port: number;
  trustProxyHops: number;
  databaseUrl: string;
  publicOrigins: string[];
  cookieSecure: boolean;
  sessionTtlSeconds: number;
  sessionSecret: string;
  phonePepper: string;
  phoneEncryptionKey: Buffer;
  mapGeojsonDir: string;
  privateSourceAssetDir?: string;
  autoMigrate: boolean;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = configSchema.parse(env);
  const phoneEncryptionKey = Buffer.from(parsed.PHONE_ENCRYPTION_KEY, 'base64');
  if (phoneEncryptionKey.length !== 32) {
    throw new Error('PHONE_ENCRYPTION_KEY must be a Base64-encoded 32-byte key');
  }

  return {
    nodeEnv: parsed.NODE_ENV,
    host: parsed.HOST,
    port: parsed.PORT,
    trustProxyHops: parsed.TRUST_PROXY_HOPS,
    databaseUrl: parsed.DATABASE_URL,
    publicOrigins: parsed.PUBLIC_ORIGINS.split(',')
      .map((value) => value.trim())
      .filter(Boolean),
    cookieSecure: parsed.COOKIE_SECURE,
    sessionTtlSeconds: parsed.SESSION_TTL_SECONDS,
    sessionSecret: parsed.SESSION_SECRET,
    phonePepper: parsed.PHONE_PEPPER,
    phoneEncryptionKey,
    mapGeojsonDir: parsed.MAP_GEOJSON_DIR,
    ...(parsed.PRIVATE_SOURCE_ASSET_DIR ? { privateSourceAssetDir: parsed.PRIVATE_SOURCE_ASSET_DIR } : {}),
    autoMigrate: parsed.AUTO_MIGRATE,
  };
}
