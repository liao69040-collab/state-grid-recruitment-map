import { createHash } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { z } from 'zod';
import { deterministicUuid } from '../import/canonical.js';

export const PRIVATE_DATASET = 'demo-private-material-v1';
export const PRIVATE_PREFIX = 'DEMO-PRIVATE-';
export const PRIVATE_CAPTURE_SHA = '526fb6ff5049b08e3333d9686b28d2ca892a3beba360d0878a58d51fc676ab66';
export const MAX_MANIFEST_BYTES = 32 * 1024 * 1024;
const shaPattern = /^[a-f0-9]{64}$/;
const hash = z.string().regex(shaPattern);
const count = z.number().int().min(0).max(1_000_000);
const blockId = z.union([z.string().regex(/^\d+$/).max(10), count]);
const nonempty = (max: number) => z.string().min(1).max(max).refine(value => value.trim().length > 0 && !value.includes('\0'));
const metadataSchema = z.object({
  visibility: z.literal('admin_only'), publicMetricEligible: z.literal(false), eligibilityEngineEligible: z.literal(false),
  sourceKind: z.literal('user_compilation_unverified').optional(),
  evidenceReviewStatus: nonempty(100).optional(), datasetId: z.literal(PRIVATE_DATASET).optional(),
  documentKey: z.literal('demo-document').optional(),
  parentSourceKey: z.string().startsWith(PRIVATE_PREFIX).max(160).optional(),
  blockId: blockId.optional(), recordId: nonempty(120).optional(), sectionStartBlockId: blockId.optional(),
  ordinal: count.optional(), materialKind: nonempty(100).optional(), scopeNote: nonempty(5000).optional(),
  rawFormula: z.string().max(5000).nullable().optional(), issueCodes: z.array(nonempty(160)).max(100).optional(),
  lineCount: count.optional(), lowConfidenceCount: count.optional(), overlapDeduplicated: z.boolean().optional(),
  ocrStatus: z.enum(['ok', 'no_text', 'partial', 'error', 'not_applicable', 'skipped_decorative']).optional(),
  imageSha256: hash.optional(), imageBytes: z.number().int().min(0).max(64 * 1024 * 1024).optional(),
  imageWidth: count.max(50_000).optional(), imageHeight: count.max(50_000).optional(),
  contentSha256: hash.optional(), partIndex: count.optional(), partCount: count.optional(),
  blockIds: z.array(blockId).max(2000).optional(), yearsMentioned: z.array(z.number().int().min(2000).max(2100)).max(100).optional(),
  coverageCounts: z.object({ textBlocks: z.literal(1277), imagePositions: z.literal(232), contentImages: z.literal(173), embeddedTables: z.literal(7) }).strict().optional(),
  originalTextRedactedContactCount: count.optional(),
}).strict();
const timestamp = z.iso.datetime({ offset: true }).nullable().optional();
const sourceSchema = z.object({
  sourceKey: z.string().regex(/^DEMO-PRIVATE-[A-Za-z0-9_-]+$/).max(160),
  title: nonempty(5000), sourceType: z.enum(['reference', 'provided_nonofficial_image']),
  publisher: z.literal('用户提供的飞书汇编（未核验）'),
  officialUrl: z.null(), archivePath: z.null().optional(), checksumSha256: hash.nullable().optional(),
  contentText: z.string().max(20_000).refine(value => !value.includes('\0')).nullable().optional(),
  publishedAt: z.null().optional(), accessedAt: timestamp, cohortYear: z.null().optional(),
  batchCode: z.enum(['batch_1', 'batch_2']).nullable().optional(), unitScope: z.string().max(200).nullable().optional(),
  status: z.literal('pending_reference_verification'), notes: z.string().max(5000).nullable().optional(), metadata: metadataSchema,
}).strict();
const manifestSchema = z.object({
  schemaVersion: z.literal('feishu-admin-sources-v1'), datasetId: z.literal(PRIVATE_DATASET),
  captureSha256: z.literal(PRIVATE_CAPTURE_SHA), sourcePrefix: z.literal(PRIVATE_PREFIX),
  sources: z.array(sourceSchema).min(1).max(3000),
}).strict();
export type PrivateManifest = z.infer<typeof manifestSchema>;
export type SourceInput = z.infer<typeof sourceSchema>;
export type Row = Record<string, unknown>;
export class PrivateImportError extends Error {
  constructor(public readonly code: string) { super(code); }
}
function fail(code: string): never { throw new PrivateImportError(code); }
export function sha256(bytes: string | Buffer): string { return createHash('sha256').update(bytes).digest('hex'); }
function safeJson(value: unknown, depth = 0): boolean {
  if (depth > 12) return false;
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'string') return !value.includes('\0');
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.length <= 5000 && value.every(item => safeJson(item, depth + 1));
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return false;
  return Object.entries(value).every(([key, item]) => !['__proto__', 'prototype', 'constructor'].includes(key) && safeJson(item, depth + 1));
}
export function parsePrivateManifest(bytes: Buffer, expectedSha: string): PrivateManifest {
  if (!shaPattern.test(expectedSha)) fail('INVALID_MANIFEST_SHA');
  if (!bytes.length || bytes.length > MAX_MANIFEST_BYTES) fail('MANIFEST_SIZE_LIMIT');
  if (sha256(bytes) !== expectedSha) fail('MANIFEST_SHA_MISMATCH');
  let raw: unknown;
  try { raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { fail('INVALID_JSON'); }
  return validatePrivateManifestValue(raw);
}
function validatePrivateManifestValue(raw: unknown): PrivateManifest {
  if (!safeJson(raw)) fail('UNSAFE_JSON');
  const parsed = manifestSchema.safeParse(raw);
  if (!parsed.success) fail('INVALID_PAYLOAD'); // Never log Zod issues or source contents.
  const data = parsed.data;
  if (new Set(data.sources.map(source => source.sourceKey)).size !== data.sources.length) fail('DUPLICATE_SOURCE_KEY');
  for (const source of data.sources) {
    if (Buffer.byteLength(JSON.stringify(source.metadata)) > 64 * 1024) fail('METADATA_SIZE_LIMIT');
    if (source.metadata.contentSha256 && source.metadata.contentSha256 !== sha256(source.contentText ?? '')) fail('CONTENT_SHA_MISMATCH');
  }
  return data;
}

// Only these source fields participate in the import. ID is deterministic;
// created_at/updated_at are database bookkeeping, not incoming payload fields.
export const SOURCE_COLUMNS = [
  ['id', 'id'], ['sourceKey', 'source_key'], ['title', 'title'], ['sourceType', 'source_type'],
  ['publisher', 'publisher'], ['officialUrl', 'official_url'], ['archivePath', 'archive_path'],
  ['checksumSha256', 'checksum_sha256'], ['contentText', 'content_text'], ['publishedAt', 'published_at'],
  ['accessedAt', 'accessed_at'], ['cohortYear', 'cohort_year'], ['batchCode', 'batch_code'],
  ['unitScope', 'unit_scope'], ['status', 'status'], ['notes', 'notes'], ['metadata', 'metadata'],
] as const;
export function canonicalJson(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalJson((value as Row)[key])).join(',') + '}';
  return JSON.stringify(value) ?? 'null';
}
function canonicalTimestamp(value: unknown): string {
  // pg returns timestamptz as Date. Date.toString() discards milliseconds;
  // normalize the Date itself so strict readback preserves the original instant.
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}
export function sourceRow(source: SourceInput): Row {
  const row: Row = {};
  for (const [key] of SOURCE_COLUMNS) row[key] = key === 'id' ? deterministicUuid(source.sourceKey) : source[key as keyof SourceInput] ?? null;
  if (row.accessedAt !== null) row.accessedAt = canonicalTimestamp(row.accessedAt);
  return row;
}
export function planPrivateSources(manifest: PrivateManifest, existing: Row[] = []) {
  const incoming = manifest.sources.map(sourceRow);
  const byKey = new Map<string, Row>(), byId = new Map<string, Row>();
  for (const row of existing) {
    if (byKey.has(String(row.sourceKey)) || byId.has(String(row.id))) fail('DUPLICATE_DATABASE_SOURCE');
    byKey.set(String(row.sourceKey), row); byId.set(String(row.id), row);
  }
  const insert: Row[] = [], skip: Row[] = [];
  for (const row of incoming) {
    const sameKey = byKey.get(String(row.sourceKey)), sameId = byId.get(String(row.id));
    if (sameKey && sameId && sameKey !== sameId) fail('SOURCE_ID_CONFLICT');
    const prior = sameKey ?? sameId;
    if (!prior) { insert.push(row); continue; }
    for (const [key] of SOURCE_COLUMNS) {
      const old = key === 'accessedAt' && prior[key] != null ? canonicalTimestamp(prior[key]) : prior[key] ?? null;
      if (canonicalJson(old) !== canonicalJson(row[key])) fail('SOURCE_CONTENT_CONFLICT');
    }
    skip.push(row);
  }
  return { incoming, insert, skip };
}

export interface ImportClient { query(text: string, values?: unknown[]): Promise<{ rows: Row[]; rowCount?: number | null }>; }
const selectColumns = SOURCE_COLUMNS.map(([key, column]) => `"${column}" AS "${key}"`).join(', ');
export const IMPORT_SQL = {
  // Locks serialize both target tables; READ COMMITTED lets the second catalog
  // read observe any DDL that committed before the locks were acquired.
  begin: 'BEGIN ISOLATION LEVEL READ COMMITTED',
  limits: "SET LOCAL search_path = pg_catalog; SET LOCAL statement_timeout = '10s'; SET LOCAL lock_timeout = '5s'; SET LOCAL idle_in_transaction_session_timeout = '15s'",
  lock: 'LOCK TABLE public.source_documents, public.audit_events IN SHARE ROW EXCLUSIVE MODE',
  schema: `SELECT c.relname AS name, c.relkind, c.relpersistence, c.relrowsecurity, c.relforcerowsecurity, c.relispartition,
    EXISTS(SELECT 1 FROM pg_catalog.pg_locks l WHERE l.pid=pg_catalog.pg_backend_pid() AND l.relation=c.oid AND l.mode='ShareRowExclusiveLock' AND l.granted) AS locked,
    (SELECT count(*)::int FROM pg_catalog.pg_inherits h WHERE h.inhrelid=c.oid OR h.inhparent=c.oid) AS inheritance,
    (SELECT count(*)::int FROM pg_catalog.pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal) AS user_triggers,
    (SELECT count(*)::int FROM pg_catalog.pg_rewrite r WHERE r.ev_class=c.oid) AS rules,
    (SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',t.typname,'namespace',tn.nspname,'modifier',a.atttypmod,'notNull',a.attnotnull,'identity',a.attidentity,'generated',a.attgenerated,'default',pg_catalog.pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum)
      FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_type t ON t.oid=a.atttypid JOIN pg_catalog.pg_namespace tn ON tn.oid=t.typnamespace LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped) AS columns,
    (SELECT jsonb_agg((SELECT jsonb_agg(a.attname ORDER BY k.ord) FROM unnest(i.indkey) WITH ORDINALITY k(attnum,ord) JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid AND a.attnum=k.attnum)) FROM pg_catalog.pg_index i WHERE i.indrelid=c.oid AND i.indisunique AND i.indisvalid AND i.indisready AND i.indpred IS NULL AND i.indexprs IS NULL) AS unique_columns,
    (SELECT jsonb_agg(e.enumlabel ORDER BY e.enumsortorder) FROM pg_catalog.pg_enum e JOIN pg_catalog.pg_type t ON t.oid=e.enumtypid JOIN pg_catalog.pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typname='audit_outcome') AS audit_enum
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('source_documents','audit_events') ORDER BY c.relname`,
  existing: `SELECT ${selectColumns} FROM public.source_documents WHERE source_key = ANY($1::varchar[]) OR id = ANY($2::uuid[]) FOR UPDATE`,
  auditExisting: 'SELECT id, actor_type, actor_id, action, resource_type, resource_id, outcome, request_id, ip_hash, user_agent_hash, metadata FROM public.audit_events WHERE id=$1::uuid FOR UPDATE',
  auditInsert: 'INSERT INTO public.audit_events (id,actor_type,actor_id,action,resource_type,resource_id,outcome,request_id,ip_hash,user_agent_hash,metadata) VALUES ($1::uuid,$2,$3::uuid,$4,$5,$6,$7::public.audit_outcome,$8,$9,$10,$11::jsonb) RETURNING id',
} as const;
type Column = { name: string; type: string; namespace: string; modifier: number; notNull: boolean; identity: string; generated: string; default: string | null };
const column = (name: string, type: string, notNull: boolean, length = -1, defaultValue: string | null = null): Column => ({ name, type, namespace: type === 'audit_outcome' ? 'public' : 'pg_catalog', modifier: length < 0 ? -1 : length + 4, notNull, identity: '', generated: '', default: defaultValue });
// Exact table/column/type/default contract, independently checked against the
// catalog under locks immediately before any conditional INSERT. No migration.
export const EXPECTED_SCHEMA = {
  source_documents: [column('id','uuid',true,-1,'gen_random_uuid()'),column('source_key','varchar',true,160),column('title','text',true),column('source_type','varchar',true,80),column('publisher','varchar',false,200),column('official_url','text',false),column('archive_path','text',false),column('checksum_sha256','varchar',false,64),column('content_text','text',false),column('published_at','timestamptz',false),column('accessed_at','timestamptz',false),column('cohort_year','int4',false),column('batch_code','varchar',false,80),column('unit_scope','varchar',false,200),column('status','varchar',true,80,"'pending'::character varying"),column('notes','text',false),column('metadata','jsonb',true,-1,"'{}'::jsonb"),column('created_at','timestamptz',true,-1,'now()'),column('updated_at','timestamptz',true,-1,'now()')],
  audit_events: [column('id','uuid',true,-1,'gen_random_uuid()'),column('actor_type','varchar',true,32),column('actor_id','uuid',false),column('action','varchar',true,120),column('resource_type','varchar',false,100),column('resource_id','varchar',false,100),column('outcome','audit_outcome',true),column('request_id','varchar',false,100),column('ip_hash','varchar',false,64),column('user_agent_hash','varchar',false,64),column('metadata','jsonb',true,-1,"'{}'::jsonb"),column('created_at','timestamptz',true,-1,'now()')],
} as const;
export function verifyImportSchema(rows: Row[], requireLocks = false): void {
  if (rows.length !== 2) fail('SCHEMA_OBJECT_COUNT');
  for (const [name, columns] of Object.entries(EXPECTED_SCHEMA)) {
    const row = rows.find(item => item.name === name);
    if (!row || row.relkind !== 'r' || row.relpersistence !== 'p' || row.relrowsecurity !== false || row.relforcerowsecurity !== false || row.relispartition !== false || row.inheritance !== 0 || row.user_triggers !== 0 || row.rules !== 0) fail('UNEXPECTED_SCHEMA_OBJECT');
    if (requireLocks && row.locked !== true) fail('SCHEMA_OBJECT_NOT_LOCKED');
    const actualColumns = (row.columns as Column[] | undefined)?.slice().sort((a,b) => a.name.localeCompare(b.name));
    if (canonicalJson(actualColumns) !== canonicalJson(columns.slice().sort((a,b) => a.name.localeCompare(b.name)))) fail('SCHEMA_COLUMN_CONFLICT');
    const keys = row.unique_columns as string[][] | undefined;
    if (!keys?.some(key => canonicalJson(key) === '["id"]') || (name === 'source_documents' && !keys?.some(key => canonicalJson(key) === '["source_key"]'))) fail('SCHEMA_UNIQUENESS_MISSING');
    if (canonicalJson(row.audit_enum) !== '["success","failure"]') fail('SCHEMA_ENUM_CONFLICT');
  }
}
export function sourceInsert(rows: Row[]) {
  if (!rows.length || rows.length > 100) fail('INSERT_BATCH_LIMIT');
  const values: unknown[] = [];
  const tuples = rows.map(row => '(' + SOURCE_COLUMNS.map(([key]) => { values.push(key === 'metadata' ? JSON.stringify(row[key]) : row[key]); return '$' + values.length; }).join(',') + ')');
  return { text: `INSERT INTO public.source_documents (${SOURCE_COLUMNS.map(([,column]) => '"' + column + '"').join(',')}) VALUES ${tuples.join(',')} RETURNING id`, values };
}
export async function applyPrivateSources(client: ImportClient, manifest: PrivateManifest, manifestSha: string) {
  if (!shaPattern.test(manifestSha)) fail('INVALID_MANIFEST_SHA');
  // This exported entry remains safe if a caller bypasses the CLI parser.
  manifest = validatePrivateManifestValue(manifest);
  const incoming = planPrivateSources(manifest).incoming;
  const keys = incoming.map(row => row.sourceKey), ids = incoming.map(row => row.id);
  const auditId = deterministicUuid('private-source-import:' + manifest.datasetId + ':' + manifestSha);
  let started = false, committing = false;
  try {
    await client.query(IMPORT_SQL.begin); started = true;
    await client.query(IMPORT_SQL.limits);
    verifyImportSchema((await client.query(IMPORT_SQL.schema)).rows);
    await client.query(IMPORT_SQL.lock);
    verifyImportSchema((await client.query(IMPORT_SQL.schema)).rows, true);
    const plan = planPrivateSources(manifest, (await client.query(IMPORT_SQL.existing, [keys,ids])).rows);
    const oldAudits = (await client.query(IMPORT_SQL.auditExisting, [auditId])).rows;
    const stableAudit = { importKind: 'source_only', datasetId: manifest.datasetId, sourcePrefix: manifest.sourcePrefix, manifestSha256: manifestSha, captureSha256: manifest.captureSha256, sourceCount: incoming.length, sourceIdsSha256: sha256(ids.slice().sort().join('\n')), visibility: 'admin_only' };
    const auditFields = { id: auditId, actor_type: 'system', actor_id: null, action: 'private_sources.import', resource_type: 'sources', resource_id: manifest.datasetId, outcome: 'success', request_id: manifestSha, ip_hash: null, user_agent_hash: null };
    if (oldAudits.length > 1) fail('AUDIT_CONFLICT');
    if (oldAudits[0]) {
      const old = oldAudits[0], metadata = old.metadata as Row;
      for (const [key,value] of Object.entries(auditFields)) if (old[key] !== value) fail('AUDIT_CONFLICT');
      if (!metadata || Object.keys(metadata).length !== Object.keys(stableAudit).length + 2) fail('AUDIT_CONFLICT');
      for (const [key,value] of Object.entries(stableAudit)) if (metadata[key] !== value) fail('AUDIT_CONFLICT');
      if (!Number.isInteger(metadata.insertedCount) || !Number.isInteger(metadata.skippedCount) || Number(metadata.insertedCount) < 0 || Number(metadata.skippedCount) < 0 || Number(metadata.insertedCount) + Number(metadata.skippedCount) !== incoming.length || plan.insert.length) fail('AUDIT_CONFLICT');
    }
    for (let index = 0; index < plan.insert.length; index += 100) {
      const rows = plan.insert.slice(index,index+100), statement = sourceInsert(rows);
      const result = await client.query(statement.text, statement.values);
      if (canonicalJson(result.rows.map(row => row.id).sort()) !== canonicalJson(rows.map(row => row.id).sort())) fail('INSERT_READBACK_MISMATCH');
    }
    const readback = planPrivateSources(manifest, (await client.query(IMPORT_SQL.existing,[keys,ids])).rows);
    if (readback.insert.length || readback.skip.length !== incoming.length) fail('SOURCE_READBACK_INCOMPLETE');
    if (!oldAudits.length) {
      const metadata = { ...stableAudit, insertedCount: plan.insert.length, skippedCount: plan.skip.length };
      const values = [...Object.values(auditFields), JSON.stringify(metadata)];
      const result = await client.query(IMPORT_SQL.auditInsert, values);
      if (result.rows.length !== 1 || result.rows[0]?.id !== auditId) fail('AUDIT_READBACK_MISMATCH');
    }
    committing = true;
    await client.query('COMMIT');
    return { mode: 'apply', datasetId: manifest.datasetId, manifestSha256: manifestSha, total: incoming.length, inserted: plan.insert.length, skipped: plan.skip.length, auditInserted: oldAudits.length ? 0 : 1, sourceOnly: true };
  } catch (error) {
    if (started) { try { await client.query('ROLLBACK'); } catch { fail(committing ? 'COMMIT_OUTCOME_UNKNOWN' : 'ROLLBACK_UNCONFIRMED'); } }
    if (committing) fail('COMMIT_OUTCOME_UNKNOWN');
    if (error instanceof PrivateImportError) throw error;
    fail('DATABASE_OPERATION_FAILED'); // Never echo driver detail, URL or source body.
  }
}

export type ImportOptions = { manifestPath: string; expectedSha: string; apply: boolean; databaseUrlEnv?: string };
export function parseImportOptions(args: string[]): ImportOptions {
  const result: ImportOptions = { manifestPath: '', expectedSha: '', apply: false };
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index++) {
    const key = args[index]!;
    if (seen.has(key)) fail('DUPLICATE_OPTION'); seen.add(key);
    if (key === '--apply') result.apply = true;
    else if (['--manifest','--sha256','--database-url-env'].includes(key)) {
      const value = args[++index]; if (!value || value.startsWith('--')) fail('MISSING_OPTION_VALUE');
      if (key === '--manifest') result.manifestPath = value;
      if (key === '--sha256') result.expectedSha = value;
      if (key === '--database-url-env') result.databaseUrlEnv = value;
    } else fail('UNKNOWN_OPTION');
  }
  if (!isAbsolute(result.manifestPath) || !shaPattern.test(result.expectedSha)) fail('MANIFEST_AND_SHA_REQUIRED');
  if (result.apply !== Boolean(result.databaseUrlEnv)) fail('APPLY_AND_DATABASE_ENV_REQUIRED');
  if (result.databaseUrlEnv && !/^[A-Z][A-Z0-9_]{2,79}$/.test(result.databaseUrlEnv)) fail('INVALID_DATABASE_ENV');
  return result;
}
export function validateDatabaseUrl(value: string | undefined): string {
  if (!value) fail('DATABASE_URL_REQUIRED');
  try {
    const url = new URL(value);
    if (!['postgres:','postgresql:'].includes(url.protocol) || !url.hostname || !url.username || !url.pathname || url.pathname === '/' || url.hash) fail('INVALID_DATABASE_URL');
    return value;
  } catch { fail('INVALID_DATABASE_URL'); }
}
