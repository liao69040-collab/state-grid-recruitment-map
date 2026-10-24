// Isolated local QA server. Never points at a production or shared database.
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { buildApp } from '../src/app.js';
import type { AppConfig } from '../src/config.js';
import { createDatabase } from '../src/db/client.js';
import { encryptPhone, hashPassword, phoneLookupHash } from '../src/lib/crypto.js';
import { PostgresStore } from '../src/store/postgres.js';

const databaseUrl=process.env.GRID_MAP_QA_DATABASE_URL;
if(!databaseUrl)throw new Error('GRID_MAP_QA_DATABASE_URL required');
const url=new URL(databaseUrl);
if(process.env.NODE_ENV==='production'||!['localhost','127.0.0.1'].includes(url.hostname)||!url.pathname.includes('integration'))throw new Error('Only an isolated loopback integration database may be used');
const password=process.env.GRID_MAP_QA_PASSWORD;
if(!password||password.length<12)throw new Error('GRID_MAP_QA_PASSWORD of at least 12 characters required');
const config:AppConfig={nodeEnv:'test',host:'127.0.0.1',port:Number(process.env.GRID_MAP_QA_PORT??8788),trustProxyHops:0,databaseUrl,
  publicOrigins:['http://127.0.0.1:4173','http://localhost:4173','http://127.0.0.1:4174','http://localhost:4174','http://127.0.0.1:5173','http://localhost:5173','http://127.0.0.1:8112','http://localhost:8112'],
  cookieSecure:false,sessionTtlSeconds:7200,sessionSecret:randomBytes(32).toString('hex'),phonePepper:'grid-map-local-qa-only-phone-pepper-2026',phoneEncryptionKey:Buffer.alloc(32,13),mapGeojsonDir:resolve('../../public/map-geojson'),autoMigrate:false};
const {db,pool}=createDatabase(databaseUrl),store=new PostgresStore(db);
const passwordHash=await hashPassword(password),admin=await store.upsertAdmin({username:'map-qa-admin',displayName:'本地地图验收',passwordHash});
const phone='13800138000',lookup=phoneLookupHash(phone,config.phonePepper);
const existing=await store.findUserByPhoneHash(lookup);
if(existing)await store.updateUser(existing.id,{enabled:true});
else await store.createUser({phoneLookupHash:lookup,phoneCiphertext:encryptPhone(phone,config.phoneEncryptionKey),phoneLast4:'8000',displayName:'本地地图验收',passwordHash,createdByAdminId:admin.id});
const app=await buildApp({config,store});await app.listen({host:config.host,port:config.port});
process.stdout.write(`GRID_MAP_LOCAL_QA_READY http://${config.host}:${config.port}\n`);
for(const signal of ['SIGTERM','SIGINT'] as const)process.on(signal,async()=>{await app.close();await pool.end();process.exit(0);});
