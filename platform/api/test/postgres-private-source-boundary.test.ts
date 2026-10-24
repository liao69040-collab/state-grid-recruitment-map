import { describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import type { Database } from '../src/db/client.js';
import { PostgresStore } from '../src/store/postgres.js';
import { isAdminOnlySource, PRIVATE_SOURCE_PREFIX } from '../src/lib/private-source-boundary.js';

type Row = Record<string, any>;
// Real Drizzle SQL construction/decoding with an explicitly bounded fake pg
// transport. This is not a live PostgreSQL latency/integration measurement.
function fixture(tables: Record<string, Row[]>) {
  const queries: string[] = [];
  const client = {
    async query(config: { text: string }, values: unknown[] = []) {
      const text = config.text;
      queries.push(text);
      const table = /\bfrom "([^"]+)"/.exec(text)?.[1] ?? '';
      let rows = tables[table] ?? [];
      if (table === 'source_documents') {
        if (text.includes('jsonb_build_object')) {
          return { rows: rows.filter(isAdminOnlySource).map(row => [row.id, row.sourceKey, { visibility: 'admin_only' }]) };
        }
        if (text.includes('coalesce(')) rows = rows.filter(row => !isAdminOnlySource(row));
        else if (text.includes(' where ')) rows = rows.filter(row => values.includes(row.id) || values.includes(row.sourceKey));
      }
      if (table === 'data_revisions' && text.includes('"revision_key" =')) rows = rows.filter(row => values.includes(row.revisionKey));
      if (/^select count\(\*\)/.test(text)) return { rows: [[rows.length]] };
      const fields = [...text.slice('select '.length, text.indexOf(' from ')).matchAll(/"([^"]+)"/g)].map(match => match[1]!);
      return { rows: rows.map(row => fields.map(field => row[field.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())] ?? null)) };
    },
  };
  return { store: new PostgresStore(drizzle(client as unknown as Pool) as unknown as Database), queries };
}

const hidden = { id: '12345678-1234-4123-a123-123456789001', sourceKey: PRIVATE_SOURCE_PREFIX + 'TEST', sourceType: 'reference', contentText: 'PRIVATE_RAW_BODY', metadata: {} };
const marked = { id: '12345678-1234-4123-a123-123456789002', sourceKey: 'explicitly-marked-source', sourceType: 'reference', metadata: { visibility: 'admin_only' } };
const safe = { id: '12345678-1234-4123-a123-123456789003', sourceKey: 'old-excel', sourceType: 'uploaded_workbook', metadata: {}, contentText: 'SAFE_BODY' };

describe('Postgres private-source reads', () => {
  it('looks up isolation identifiers without selecting bodies, paths, tokens, or full metadata', async () => {
    const { store, queries } = fixture({ source_documents: [hidden, marked, safe] });
    expect(await store.adminOnlySources()).toEqual([
      { id: hidden.id, sourceKey: hidden.sourceKey, metadata: { visibility: 'admin_only' } },
      { id: marked.id, sourceKey: marked.sourceKey, metadata: { visibility: 'admin_only' } },
    ]);
    expect(queries[0]).toContain('jsonb_build_object');
    const selection = queries[0]!.split(' from ')[0]!;
    expect(selection).not.toMatch(/content_text|archive_path|official_url|"metadata"/);
    expect(queries[0]).toContain("->>'visibility' = 'admin_only'");
    expect(queries[0]).toContain(' like ');
  });

  it('filters primary, supplementary and metadata-only sources before province metrics leave the store', async () => {
    const { store } = fixture({
      source_documents: [hidden, marked, safe], provinces: [{ id: 'p', adcode: '420000', name: '湖北省' }],
      recruitment_metrics: [
        { id: 'safe', sourceDocumentId: safe.id, value: '5' },
        { id: 'private-id', sourceDocumentId: hidden.id, value: '999' },
        { id: 'private-key', sourceDocumentId: safe.id, sourceKeys: [marked.sourceKey], value: '999' },
        { id: 'private-meta', metadata: { source_ids: [marked.sourceKey] }, value: '999' },
      ],
    });
    const result = await store.provinceDashboard('420000', { cohortYear: 2026 });
    expect((result?.recruitment_metrics as Row[]).map(row => row.id)).toEqual(['safe']);
  });

  it('excludes private source documents from public source counts', async () => {
    const { store, queries } = fixture({ source_documents: [hidden, marked, safe] });
    expect((await store.publicDashboard()).summary).toMatchObject({ source_count: 1 });
    expect(queries.find(query => query.startsWith('select count(*)') && query.includes('source_documents'))).toContain("<> 'admin_only'");
  });

  it('removes private policy sources and indirectly private revisions before eligibility hydration', async () => {
    const { store } = fixture({ source_documents: [hidden, marked, safe],
      early_batch_policies: [
        { id: 'allowed', sourceDocumentId: safe.id, revisionId: 'safe-revision' },
        { id: 'private-source', sourceDocumentId: hidden.id, revisionId: 'safe-revision' },
        { id: 'private-revision', sourceDocumentId: safe.id, revisionId: 'private-revision' },
      ],
      data_revisions: [
        { id: 'safe-revision', revisionKey: 'legacy-reference', metadata: {} },
        { id: 'private-revision', metadata: { source_keys: [marked.sourceKey] } },
      ],
    });
    expect((await store.listEarlyBatchPolicies(2026)).map(row => row.id)).toEqual(['allowed']);
  });

  it('resolves metadata-only provenance for profiles before calculating audience summaries', async () => {
    const { store } = fixture({ source_documents: [hidden, marked, safe],
      provinces: [{ id: 'p', adcode: '420000', name: '湖北省' }],
      companies: [{ id: 'c', companyKey: 'UNIT-HUBEI', name: '湖北单位' }],
      recruitment_events: [
        { id: 'e-safe', companyId: 'c', cohortYear: 2026, batchCode: 'batch_1', sourceDocumentId: safe.id },
        { id: 'e-private', companyId: 'c', cohortYear: 2026, batchCode: 'batch_1', metadata: { source_ids: [marked.sourceKey] } },
      ],
    });
    const result = await store.provinceRecruitmentProfile('420000');
    expect(result?.summary).toMatchObject({ eventCount: 1 });
    expect((result?.units as Row[])[0]?.events.map((row: Row) => row.id)).toEqual(['e-safe']);
  });

  it('discovers company provenance before dropping source IDs from the audience DTO', async () => {
    const { store } = fixture({
      source_documents: [hidden, marked, safe],
      provinces: [{ id: 'p', adcode: '420000', name: '湖北省' }],
      companies: [
        { id: 'c-safe', companyKey: 'SAFE-COMPANY', name: '安全单位', sourceDocumentId: safe.id },
        { id: 'c-private-id', companyKey: 'PRIVATE-COMPANY-ID', name: 'PRIVATE_COMPANY_NAME', sourceDocumentId: hidden.id },
        { id: 'c-private-meta', companyKey: 'PRIVATE-COMPANY-META', name: 'PRIVATE_COMPANY_METADATA', metadata: { source_ids: [marked.sourceKey] } },
      ],
      // All child rows deliberately cite the safe source. The company itself is
      // the only link to the private source, which must gate its complete unit.
      recruitment_events: [
        { id: 'e-safe', companyId: 'c-safe', cohortYear: 2026, batchCode: 'batch_1', sourceDocumentId: safe.id },
        { id: 'e-private-id', companyId: 'c-private-id', cohortYear: 2026, batchCode: 'batch_1', sourceDocumentId: safe.id },
        { id: 'e-private-meta', companyId: 'c-private-meta', cohortYear: 2026, batchCode: 'batch_1', sourceDocumentId: safe.id },
      ],
    });
    const result = await store.provinceRecruitmentProfile('420000');
    expect(result?.summary).toMatchObject({ unitCount: 1, eventCount: 1 });
    expect((result?.units as Row[]).map(unit => unit.company.companyKey)).toEqual(['SAFE-COMPANY']);
    expect(JSON.stringify(result)).not.toContain('PRIVATE_COMPANY');
    expect(JSON.stringify(result)).not.toContain('e-private');
  });

  it.each([
    { geometrySourceId: marked.sourceKey },
    { metadata: { source_ids: [marked.id] } },
    { metadata: { nested: { source_keys: [hidden.sourceKey] } } },
    { metadata: { visibility: 'admin_only' } },
  ])('withholds a province profile whose own provenance is private: %j', async (provenance) => {
    const { store } = fixture({
      source_documents: [hidden, marked, safe],
      provinces: [{ id: 'p', adcode: '420000', name: 'PRIVATE_PROVINCE_NAME', ...provenance }],
      companies: [{ id: 'c', companyKey: 'SAFE-COMPANY', name: '安全单位', sourceDocumentId: safe.id }],
    });
    expect(await store.provinceRecruitmentProfile('420000')).toBeNull();
  });

  it('retains ordinary historical province and company references', async () => {
    const { store } = fixture({
      source_documents: [hidden, marked, safe],
      provinces: [{ id: 'p', adcode: '420000', name: '湖北省', geometrySourceId: safe.sourceKey, metadata: { source_ids: [safe.id] } }],
      companies: [{ id: 'c', companyKey: 'SAFE-COMPANY', name: '安全单位', sourceDocumentId: safe.id }],
    });
    const result = await store.provinceRecruitmentProfile('420000');
    expect(result?.summary).toMatchObject({ unitCount: 1 });
    expect((result?.province as Row).name).toBe('湖北省');
  });
});

describe('public dashboard derived national overview', () => {
  const cell = (over: Record<string, unknown>) => ({
    cohortYear: 2026, grid: 'sgcc', batchCode: 'batch_1', province: '湖北', city: null,
    companyKey: 'c1', company: '国网湖北电力', orgCategory: 'province_company',
    parentSchoolKey: 's1', schoolName: '测试大学', campusKey: 'c-1', campusName: '测试大学',
    schoolTier: '211', educationLevel: '本科', schoolOwnership: '公办', schoolProvince: '湖北',
    industryTags: [], metricType: 'public_notice_record_count', recordCount: 10,
    outcomeKey: 'o1', sourceKey: 'roster', evidenceLocator: '脱敏聚合', ...over,
  });
  const dashboard = (value: number) => ({
    id: 'rev-1', revisionKey: 'public-dashboard', status: 'published', sourceDocumentId: null, metadata: {},
    payload: {
      data_sync: { cohort_year: 2026 },
      national_overview: {
        state_grid_public_notice_records: { value: 40478 },
        region_unmapped_public_notice_records: { value, unit: 'public_notice_records', value_kind: 'derived_aggregate', display_label: '单位地区未标注' },
      },
    },
  });
  const roster = (cells: Record<string, unknown>[]) => ({
    grid_dataset_versions: [{ id: 'v1', datasetKey: 'd1', version: 'v1', title: 't', createdAt: new Date('2026-01-01T00:00:00Z'), notes: [], checksumSha256: 'a'.repeat(64), active: true }],
    grid_query_sources: [], grid_policy_facts: [],
    grid_school_outcomes: cells.map((payload, index) => ({ id: `o${index}`, versionId: 'v1', payload })),
  });

  it('republishes the stale frozen literal as the figure the roster actually holds', async () => {
    // 7 + 9 State Grid rows with no province = 16; the stored snapshot says 3745.
    const { store } = fixture({
      data_revisions: [dashboard(3745)],
      ...roster([
        cell({ outcomeKey: 'p1', recordCount: 100 }),
        cell({ outcomeKey: 'u1', province: null, companyKey: 'direct', recordCount: 7 }),
        cell({ outcomeKey: 'u2', province: '   ', companyKey: 'direct2', recordCount: 9 }),
        cell({ outcomeKey: 'u3', province: null, grid: 'csg', batchCode: 'csg_autumn', companyKey: 'csg-direct', recordCount: 40 }),
        cell({ outcomeKey: 'u4', province: null, cohortYear: 2025, companyKey: 'old', recordCount: 500 }),
      ]),
    });
    const overview = (await store.publicDashboard()).national_overview as Record<string, any>;
    expect(overview.region_unmapped_public_notice_records.value).toBe(16);
    // Southern Grid rows and other cohorts belong to different scopes and must
    // not be folded into a State-Grid-scoped figure.
    expect(overview.region_unmapped_public_notice_records.value).not.toBe(56);
    expect(overview.region_unmapped_public_notice_records.value).not.toBe(516);
    // Everything else in the block is left exactly as published.
    expect(overview.state_grid_public_notice_records.value).toBe(40478);
    expect(overview.region_unmapped_public_notice_records.display_label).toBe('单位地区未标注');
  });

  it('leaves the payload untouched when the stored figure already matches', async () => {
    const { store } = fixture({ data_revisions: [dashboard(16)], ...roster([
      cell({ outcomeKey: 'u1', province: null, companyKey: 'direct', recordCount: 16 }),
    ]) });
    const payload = await store.publicDashboard();
    expect((payload.national_overview as Record<string, any>).region_unmapped_public_notice_records.value).toBe(16);
  });
});
