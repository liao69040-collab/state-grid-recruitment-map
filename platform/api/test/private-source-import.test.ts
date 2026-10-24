import { describe, expect, it, vi } from 'vitest';
import { types as pgTypes } from 'pg';
import {
  EXPECTED_SCHEMA, IMPORT_SQL, PRIVATE_CAPTURE_SHA, PRIVATE_DATASET, PRIVATE_PREFIX, SOURCE_COLUMNS,
  applyPrivateSources, canonicalJson, parseImportOptions, parsePrivateManifest, planPrivateSources,
  sha256, sourceInsert, sourceRow, validateDatabaseUrl, verifyImportSchema,
  type ImportClient, type PrivateManifest, type Row, type SourceInput,
} from '../src/lib/private-source-import.js';

const source = (suffix = 'INDEX'): SourceInput => ({
  sourceKey: PRIVATE_PREFIX + suffix, title: '待核资料测试', sourceType: 'reference',
  publisher: '用户提供的飞书汇编（未核验）', officialUrl: null,
  contentText: '合成测试文字，不是招聘事实', accessedAt: '2026-09-05T11:00:00+00:00',
  status: 'pending_reference_verification',
  metadata: { visibility: 'admin_only', publicMetricEligible: false, eligibilityEngineEligible: false, datasetId: PRIVATE_DATASET },
});
const manifest = (): PrivateManifest => ({ schemaVersion: 'feishu-admin-sources-v1', datasetId: PRIVATE_DATASET, captureSha256: PRIVATE_CAPTURE_SHA, sourcePrefix: PRIVATE_PREFIX, sources: [source(),source('BODY-0022')] });
const bytes = (value: unknown) => Buffer.from(JSON.stringify(value));
const parse = (value: unknown) => parsePrivateManifest(bytes(value),sha256(bytes(value)));
// Exercise node-postgres's actual timestamptz text decoder without connecting
// to PostgreSQL; this yields the same Date objects as live query readback.
const pgTimestamp = (value: string): Date => pgTypes.getTypeParser(1184, 'text')(value.replace('T', ' ').replace(/Z$/, '+00')) as Date;
const validSchema = (): Row[] => Object.entries(EXPECTED_SCHEMA).map(([name,columns]) => ({
  name, relkind: 'r', relpersistence: 'p', relrowsecurity: false, relforcerowsecurity: false,
  relispartition: false, inheritance: 0, user_triggers: 0, rules: 0, locked: true,
  columns: structuredClone(columns), unique_columns: name === 'source_documents' ? [['id'],['source_key']] : [['id']], audit_enum: ['success','failure'],
}));
function fakeDatabase(initial: Row[] = []) {
  let rows = structuredClone(initial), audits: Row[] = [], snapshot: [Row[],Row[]] | null = null;
  const queries: {text: string; values: unknown[]}[] = [];
  let schema = validSchema(), failOn = '', readbackCorrupt = false, sourceInserts = 0;
  let timestampDates = false, timestampShiftMillis = 0;
  const client: ImportClient = { async query(text, values = []) {
    queries.push({text, values});
    if (text === failOn) throw new Error('SECRET driver detail and body must not escape');
    if (text === IMPORT_SQL.begin) snapshot = [structuredClone(rows),structuredClone(audits)];
    if (text === IMPORT_SQL.schema) return {rows: structuredClone(schema)};
    if (text === IMPORT_SQL.existing) return {rows: readbackCorrupt && sourceInserts ? [] : structuredClone(rows).map(row => {
      if (timestampDates && row.accessedAt != null) {
        const iso = row.accessedAt instanceof Date ? row.accessedAt.toISOString() : String(row.accessedAt);
        row.accessedAt = pgTimestamp(iso);
        if (timestampShiftMillis) row.accessedAt = new Date((row.accessedAt as Date).getTime() + timestampShiftMillis);
      }
      return row;
    })};
    if (text === IMPORT_SQL.auditExisting) return {rows: audits.filter(row => row.id === values[0])};
    if (text.startsWith('INSERT INTO public.source_documents ')) {
      const inserted: Row[] = [];
      for (let n=0;n<values.length;n+=SOURCE_COLUMNS.length) {
        const row: Row = {};
        SOURCE_COLUMNS.forEach(([key],i) => {row[key] = key === 'metadata' ? JSON.parse(String(values[n+i])) : values[n+i];});
        rows.push(row); inserted.push({id: row.id});
      }
      sourceInserts++;
      return {rows: inserted};
    }
    if (text === IMPORT_SQL.auditInsert) {
      const keys = ['id','actor_type','actor_id','action','resource_type','resource_id','outcome','request_id','ip_hash','user_agent_hash','metadata'];
      const row: Row = {};
      keys.forEach((key,i) => {row[key] = key === 'metadata' ? JSON.parse(String(values[i])) : values[i];});
      audits.push(row); return {rows: [{id:row.id}]};
    }
    if (text === 'ROLLBACK' && snapshot) [rows,audits] = structuredClone(snapshot);
    return {rows: []};
  }};
  return {client,queries,get rows(){return rows;},get audits(){return audits;},set schema(value: Row[]){schema=value;},set failOn(value: string){failOn=value;},set readbackCorrupt(value: boolean){readbackCorrupt=value;},set timestampDates(value: boolean){timestampDates=value;},set timestampShiftMillis(value: number){timestampShiftMillis=value;}};
}

describe('private-source strict offline validation', () => {
  it('validates fixed dataset, SHA and all protected flags without data promotion', () => {
    expect(parse(manifest())).toEqual(manifest());
    expect(() => parsePrivateManifest(bytes(manifest()),'0'.repeat(64))).toThrow('MANIFEST_SHA_MISMATCH');
    expect(() => parsePrivateManifest(Buffer.from('{'),sha256('{'))).toThrow('INVALID_JSON');
  });
  it.each([
    ['top-level extra', (m: any) => {m.revisions=[];}],
    ['bad dataset', (m: any) => {m.datasetId='other';}],
    ['bad capture', (m: any) => {m.captureSha256='0'.repeat(64);}],
    ['source unknown', (m: any) => {m.sources[0].published=true;}],
    ['source ID supplied', (m: any) => {m.sources[0].id='injected';}],
    ['official URL', (m: any) => {m.sources[0].officialUrl='https://example.test';}],
    ['archive path', (m: any) => {m.sources[0].archivePath='/private/path';}],
    ['public status', (m: any) => {m.sources[0].status='verified';}],
    ['public flag', (m: any) => {m.sources[0].metadata.publicMetricEligible=true;}],
    ['eligibility flag', (m: any) => {m.sources[0].metadata.eligibilityEngineEligible=true;}],
    ['missing protection', (m: any) => {delete m.sources[0].metadata.visibility;}],
    ['metadata unknown', (m: any) => {m.sources[0].metadata.originalPath='/private/file';}],
    ['oversized text', (m: any) => {m.sources[0].contentText='x'.repeat(20001);}],
    ['unreviewed year promotion', (m: any) => {m.sources[0].cohortYear=2027;}],
    ['bad prefix', (m: any) => {m.sources[0].sourceKey='OFFICIAL-1';}],
  ])('rejects %s', (_label, change) => {const m=manifest();change(m);expect(() => parse(m)).toThrow('INVALID_PAYLOAD');});
  it('rejects duplicate keys, NUL/prototype keys and mismatched content checksum', () => {
    const m=manifest();m.sources.push(source());expect(() => parse(m)).toThrow('DUPLICATE_SOURCE_KEY');
    const unsafe=JSON.parse('{"__proto__":{"secret":"value"}}');expect(() => parse(unsafe)).toThrow('UNSAFE_JSON');
    const nul=manifest();nul.sources[0]!.contentText='a\0b';expect(() => parse(nul)).toThrow('UNSAFE_JSON');
    const badHash=manifest();badHash.sources[0]!.metadata.contentSha256='0'.repeat(64);expect(() => parse(badHash)).toThrow('CONTENT_SHA_MISMATCH');
  });
  it('permits the actual large-image sizes, explicit null formulas and known review metadata', () => {
    const m=manifest();m.sources[0]!.metadata.imageBytes=3_460_795;m.sources[0]!.metadata.rawFormula=null;
    expect(parse(m).sources).toHaveLength(2);
  });
  it('requires explicit SHA and paired apply/database-env; rejects ambiguous options', () => {
    const basic=['--manifest','/explicit/import.json','--sha256','a'.repeat(64)];
    expect(parseImportOptions(basic).apply).toBe(false);
    expect(parseImportOptions([...basic,'--apply','--database-url-env','PRIVATE_SOURCE_DATABASE_URL']).apply).toBe(true);
    for(const extra of [['--apply'],['--database-url-env','DATABASE_URL'],['--apply','--apply'],['--database-url','secret'],['--unknown']]) expect(() => parseImportOptions([...basic,...extra])).toThrow();
    expect(() => parseImportOptions(['--manifest','relative','--sha256','a'.repeat(64)])).toThrow('MANIFEST_AND_SHA_REQUIRED');
    expect(() => validateDatabaseUrl(undefined)).toThrow('DATABASE_URL_REQUIRED');
    expect(() => validateDatabaseUrl('https://user:secret@example.test/db')).toThrow('INVALID_DATABASE_URL');
  });
});

describe('pure source-only plans', () => {
  it('has deterministic IDs and compares all fields, including canonical metadata ordering', () => {
    const m=manifest(),p=planPrivateSources(m);expect(p.insert).toHaveLength(2);
    expect(planPrivateSources(m).incoming).toEqual(p.incoming);
    const existing=structuredClone(p.incoming);existing[0]!.metadata={datasetId:PRIVATE_DATASET,eligibilityEngineEligible:false,publicMetricEligible:false,visibility:'admin_only'};
    existing[0]!.accessedAt=new Date(String(existing[0]!.accessedAt));
    expect(planPrivateSources(m,existing).skip).toHaveLength(2);
  });
  it.each([
    ['2026-09-05T11:04:10.953Z', '2026-09-05T11:04:10.953Z'],
    ['2026-09-05T19:04:10.001+08:00', '2026-09-05T11:04:10.001Z'],
    ['2026-09-05T04:04:10.999-07:00', '2026-09-05T11:04:10.999Z'],
  ])('preserves nonzero milliseconds from actual pg Date decoding for %s', (value, expected) => {
    const m=manifest();m.sources[0]!.accessedAt=value;
    const row=sourceRow(m.sources[0]!);row.accessedAt=pgTimestamp(value);
    expect(row.accessedAt).toBeInstanceOf(Date);
    expect((row.accessedAt as Date).toISOString()).toBe(expected);
    expect(planPrivateSources(m,[row]).skip).toHaveLength(1);
    expect(planPrivateSources(m,[row]).incoming[0]!.accessedAt).toBe(expected);
  });
  it.each(['2026-09-05T11:04:10.952Z','2026-09-05T11:04:10.954Z','2026-09-05T11:04:10.000Z'])('rejects a genuinely different pg Date instant %s', value => {
    const m=manifest();m.sources[0]!.accessedAt='2026-09-05T11:04:10.953Z';
    const row=sourceRow(m.sources[0]!);row.accessedAt=pgTimestamp(value);
    expect(() => planPrivateSources(m,[row])).toThrow('SOURCE_CONTENT_CONFLICT');
  });
  it('does not relax body equality when pg Date milliseconds match', () => {
    const m=manifest();m.sources[0]!.accessedAt='2026-09-05T11:04:10.953Z';
    const row=sourceRow(m.sources[0]!);row.accessedAt=pgTimestamp(m.sources[0]!.accessedAt!);row.contentText='different source text';
    expect(() => planPrivateSources(m,[row])).toThrow('SOURCE_CONTENT_CONFLICT');
  });
  it.each(SOURCE_COLUMNS.map(([key])=>key))('rejects a conflict in %s rather than overwrite', key => {
    const m=manifest(),row=sourceRow(m.sources[0]!);row[key]=key==='accessedAt'?'2025-01-01T00:00:00.000Z':key==='metadata'?{}:'DIFFERENT';
    expect(() => planPrivateSources(m,[row])).toThrow('SOURCE_CONTENT_CONFLICT');
  });
  it('never interpolates body into SQL, updates, deletes or inserts into facts/revisions/accounts', () => {
    const m=manifest();m.sources[0]!.contentText="'); DELETE FROM users;--";
    const statement=sourceInsert(planPrivateSources(m).incoming);
    expect(statement.text).toMatch(/^INSERT INTO public.source_documents /);
    expect(statement.text).not.toContain('DELETE');expect(statement.values).toContain("'); DELETE FROM users;--");
    expect(statement.text).not.toMatch(/ON CONFLICT|UPDATE|CREATE|DROP|TRUNCATE/);
  });
});

describe('catalog gate and bounded source-only transaction (fake transport, no DB)', () => {
  it('accepts exact schema independent of physical column order', () => {
    const rows=validSchema();(rows[0]!.columns as unknown[]).reverse();expect(() => verifyImportSchema(rows)).not.toThrow();
  });
  it('requires locks on the same exact catalog OIDs before any write', () => {
    const rows=validSchema();rows[0]!.locked=false;
    expect(() => verifyImportSchema(rows,true)).toThrow('SCHEMA_OBJECT_NOT_LOCKED');
  });
  it('rejects duplicate keys through the exported apply entry before BEGIN', async () => {
    const db=fakeDatabase(),m=manifest();m.sources.push(source());
    await expect(applyPrivateSources(db.client,m,sha256(bytes(m)))).rejects.toThrow('DUPLICATE_SOURCE_KEY');
    expect(db.queries).toHaveLength(0);
  });
  it.each(['relkind','relpersistence','relrowsecurity','relispartition','inheritance','user_triggers','rules','columns','unique_columns','audit_enum'])('fails closed on changed schema %s', key => {
    const rows=validSchema();rows[0]![key]=null;expect(() => verifyImportSchema(rows)).toThrow();
  });
  it('inserts source rows and one aggregate audit atomically; exact repeat is idempotent', async () => {
    const db=fakeDatabase(),m=manifest(),digest=sha256(bytes(m));
    expect(await applyPrivateSources(db.client,m,digest)).toMatchObject({inserted:2,skipped:0,auditInserted:1});
    expect(db.rows).toHaveLength(2);expect(db.audits).toHaveLength(1);
    expect(await applyPrivateSources(db.client,m,digest)).toMatchObject({inserted:0,skipped:2,auditInserted:0});
    expect(db.audits).toHaveLength(1);
    const writes=db.queries.filter(q=>q.text.startsWith('INSERT '));expect(writes).toHaveLength(2);
    expect(writes.every(q=>q.text.startsWith('INSERT INTO public.source_documents ')||q.text===IMPORT_SQL.auditInsert)).toBe(true);
    expect(db.queries.findIndex(q=>q.text===IMPORT_SQL.lock)).toBeLessThan(db.queries.findIndex(q=>q.text.startsWith('INSERT ')));
    expect(db.queries.filter(q=>q.text===IMPORT_SQL.schema)).toHaveLength(4);
    expect(JSON.stringify(db.audits[0]!.metadata)).not.toContain('合成测试');
  });
  it('roundtrips fractional timestamps through real pg Date decoding and remains idempotent', async () => {
    const db=fakeDatabase(),m=manifest();db.timestampDates=true;
    m.sources[0]!.accessedAt='2026-09-05T11:04:10.953Z';m.sources[1]!.accessedAt=null;
    const digest=sha256(bytes(m));
    expect(await applyPrivateSources(db.client,m,digest)).toMatchObject({inserted:2,skipped:0,auditInserted:1});
    expect(await applyPrivateSources(db.client,m,digest)).toMatchObject({inserted:0,skipped:2,auditInserted:0});
    expect(db.rows[0]!.accessedAt).toBe('2026-09-05T11:04:10.953Z');
    expect(db.rows[1]!.accessedAt).toBeNull();
    expect(db.audits).toHaveLength(1);
    expect(db.queries.filter(query=>query.text==='COMMIT')).toHaveLength(2);
  });
  it('rolls back an INSERT whose pg Date readback differs by one millisecond', async () => {
    const db=fakeDatabase(),m=manifest();db.timestampDates=true;db.timestampShiftMillis=1;
    m.sources[0]!.accessedAt='2026-09-05T11:04:10.953Z';
    await expect(applyPrivateSources(db.client,m,sha256(bytes(m)))).rejects.toThrow('SOURCE_CONTENT_CONFLICT');
    expect(db.queries.some(query=>query.text.startsWith('INSERT INTO public.source_documents '))).toBe(true);
    expect(db.queries.at(-1)?.text).toBe('ROLLBACK');
    expect(db.queries.some(query=>query.text==='COMMIT')).toBe(false);
    expect(db.rows).toHaveLength(0);expect(db.audits).toHaveLength(0);
  });
  it('conflict aborts the whole batch before any INSERT', async () => {
    const m=manifest(),existing=sourceRow(m.sources[1]!);existing.title='different';const db=fakeDatabase([existing]);
    await expect(applyPrivateSources(db.client,m,sha256(bytes(m)))).rejects.toThrow('SOURCE_CONTENT_CONFLICT');
    expect(db.queries.at(-1)?.text).toBe('ROLLBACK');expect(db.queries.some(q=>q.text.startsWith('INSERT '))).toBe(false);
  });
  it('audit failure rolls back all inserted sources and sanitizes driver errors', async () => {
    const db=fakeDatabase();db.failOn=IMPORT_SQL.auditInsert;const m=manifest();
    await expect(applyPrivateSources(db.client,m,sha256(bytes(m)))).rejects.toThrow(/^DATABASE_OPERATION_FAILED$/);
    expect(db.rows).toHaveLength(0);expect(db.audits).toHaveLength(0);
  });
  it('bad catalog or failed content readback cannot commit', async () => {
    const m=manifest(),db=fakeDatabase();db.schema=[];
    await expect(applyPrivateSources(db.client,m,sha256(bytes(m)))).rejects.toThrow('SCHEMA_OBJECT_COUNT');
    expect(db.queries.some(q=>q.text.startsWith('INSERT '))).toBe(false);
    const other=fakeDatabase();other.readbackCorrupt=true;
    await expect(applyPrivateSources(other.client,m,sha256(bytes(m)))).rejects.toThrow('SOURCE_READBACK_INCOMPLETE');
    expect(other.rows).toHaveLength(0);
  });
  it('reports ambiguous COMMIT honestly, not confirmed rollback', async () => {
    const db=fakeDatabase();db.failOn='COMMIT';const m=manifest();
    await expect(applyPrivateSources(db.client,m,sha256(bytes(m)))).rejects.toThrow('COMMIT_OUTCOME_UNKNOWN');
  });
});

describe('CLI default path has no database dependency or credential reads', () => {
  it('returns only a count/hash summary and never reads env or imports pg in dry-run', async () => {
    const m=manifest(),payload=bytes(m);
    vi.doMock('node:fs/promises',()=>({open:async()=>({stat:async()=>({isFile:()=>true,size:payload.length}),readFile:async()=>payload,close:async()=>{}})}));
    vi.doMock('pg',()=>{throw new Error('pg must not load in dry-run');});
    const {runPrivateSourceImport}=await import('../scripts/import-private-sources.js');
    const env=new Proxy({}, {get(){throw new Error('credentials must not be read');}});
    const result=await runPrivateSourceImport(['--manifest','/explicit/test.json','--sha256',sha256(payload)],env);
    expect(result).toMatchObject({mode:'dry-run',databaseConnected:false,existingRowsChecked:false,validatedSources:2,writeExecuted:false});
    expect(canonicalJson(result)).not.toContain('合成测试');
    vi.doUnmock('node:fs/promises');vi.doUnmock('pg');
  });
});
