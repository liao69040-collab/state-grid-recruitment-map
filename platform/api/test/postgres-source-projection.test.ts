import { describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import type { Database } from '../src/db/client.js';
import { PostgresStore } from '../src/store/postgres.js';

type Row = Record<string, unknown>;
type CapturedQuery = { text: string; values: unknown[] };

// Exercise the real Drizzle SQL builder and row decoder without a database.
// Only the pg transport is replaced; fixtures contain no personal data.
function storeWithRows(tables: Record<string, Row[]>) {
  const queries: CapturedQuery[] = [];
  const client = {
    async query(config: { text: string; rowMode?: string }, values: unknown[] = []) {
      const text = config.text;
      queries.push({ text, values });
      const table = /\bfrom "([^"]+)"/.exec(text)?.[1] ?? '';
      let rows = tables[table] ?? [];
      if (table === 'source_documents' && /\bwhere\b/.test(text)) {
        rows = rows.filter((row) => values.includes(row.id) || values.includes(row.sourceKey));
      }
      if (/^select count\(\*\)/.test(text)) return { rows: [[rows.length]] };
      const projection = text.slice('select '.length, text.indexOf(' from '));
      const columns = [...projection.matchAll(/"([^"]+)"/g)].map((match) => match[1]!);
      return {
        rows: rows.map((row) => columns.map((column) => {
          const key = column.replace(/_([a-z])/g, (_, character: string) => character.toUpperCase());
          return row[key] ?? null;
        })),
      };
    },
  };
  const db = drizzle(client as unknown as Pool) as unknown as Database;
  return { store: new PostgresStore(db), queries };
}

const source = (id: string, sourceKey: string) => ({
  id,
  sourceKey,
  title: `来源 ${sourceKey}`,
  sourceType: 'current_official_page',
  publisher: '招聘单位',
  officialUrl: `https://example.test/${sourceKey}`,
  publishedAt: '2026-01-01T00:00:00.000Z',
  accessedAt: '2026-01-02T00:00:00.000Z',
  status: 'verified',
  notes: '来源注释',
  metadata: { evidenceTier: 'A', checksum: 'retained-evidence' },
  contentText: '仅来源正文接口需要的全文'.repeat(100),
});

function assertBoundedSummaryQuery(query: CapturedQuery) {
  const projection = query.text.slice(0, query.text.indexOf(' from '));
  expect(projection).not.toContain('content_text');
  expect(query.text).toMatch(/from "source_documents" where /);
  expect(query.values.length).toBeGreaterThan(0);
}

describe('Postgres source summary queries', () => {
  it.each([
    ['recruitment-events', 'recruitment_events'],
    ['recruitment-requirements', 'recruitment_requirements'],
    ['recruitment-metrics', 'recruitment_metrics'],
  ] as const)('loads only referenced source summaries for %s', async (resource, table) => {
    const { store, queries } = storeWithRows({
      [table]: [{ id: 'row-1', title: '待展示记录', sourceDocumentId: 's-1', sourceKeys: ['key-1'] }],
      source_documents: [source('s-1', 'key-1'), source('s-unrelated', 'key-unrelated')],
    });
    const result = await store.listResource(resource, { limit: 20, offset: 0 });
    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({
      sourceDocumentId: 's-1',
      sourceTitle: '来源 key-1',
      sourcePublisher: '招聘单位',
      sourceOfficialUrl: 'https://example.test/key-1',
      sourceStatus: 'verified',
      sourceType: 'current_official_page',
    });
    const sourceQueries = queries.filter((query) => /from "source_documents"/.test(query.text));
    expect(sourceQueries).toHaveLength(1);
    assertBoundedSummaryQuery(sourceQueries[0]!);
    expect(sourceQueries[0]!.values).not.toContain('s-unrelated');
    expect(JSON.stringify(result)).not.toContain('仅来源正文接口需要的全文');
  });

  it('does not query source documents when a page has no source references', async () => {
    const { store, queries } = storeWithRows({
      recruitment_events: [{ id: 'event-without-source', title: '来源待补' }],
    });
    const result = await store.listResource('recruitment-events', { limit: 20, offset: 0 });
    expect(result.items[0]?.sourceTitle).toBeNull();
    expect(queries.filter((query) => /from "source_documents"/.test(query.text))).toHaveLength(0);
  });

  it('preserves every profile reference channel, including national and revision sources', async () => {
    const rows = {
      provinces: [{ id: 'p-1', adcode: '420000', name: '湖北省' }],
      companies: [{ id: 'c-1', companyKey: 'UNIT-HUBEI', name: '省级单位', companyType: 'state_grid_provincial_unit' }],
      recruitment_batches: [{ id: 'b-1', companyId: 'c-1', cohortYear: 2026, code: 'batch_1', sourceKeys: ['key-batch'] }],
      recruitment_events: [{ id: 'e-1', companyId: 'c-1', cohortYear: 2026, batchCode: 'batch_1', sourceDocumentId: 's-id-only' }],
      recruitment_requirements: [{ id: 'r-1', companyId: 'c-1', cohortYear: 2026, batchCode: 'batch_1', sourceKeys: ['key-requirement'] }],
      recruitment_metrics: [{ id: 'm-1', companyId: 'c-1', cohortYear: 2026, batchCode: 'batch_1', metricType: 'planned_headcount_raw_mention', sourceKeys: ['key-metric'], metadata: {} }],
      data_revisions: [{
        id: 'revision-1',
        metadata: { unit_key: 'UNIT-HUBEI', source_keys: ['key-national'], sourceKeys: ['key-revision-camel'] },
        payload: { sourceKeys: ['key-profile'] },
      }],
      source_documents: [
        source('s-batch', 'key-batch'), source('s-id-only', 'key-id-only'),
        source('s-requirement', 'key-requirement'), source('s-metric', 'key-metric'),
        source('s-national', 'key-national'), source('s-revision-camel', 'key-revision-camel'),
        source('s-profile', 'key-profile'), source('s-unrelated', 'key-unrelated'),
      ],
    };
    const { store, queries } = storeWithRows(rows);
    const result = await store.provinceRecruitmentProfile('420000');
    const units = result?.units as Array<{ sources: Row[] }>;
    expect(units[0]!.sources.map((item) => item.sourceKey).sort()).toEqual([
      'key-batch', 'key-id-only', 'key-metric', 'key-national', 'key-profile', 'key-requirement', 'key-revision-camel',
    ]);
    expect(units[0]!.sources.find((item) => item.sourceKey === 'key-national')).toMatchObject({
      notes: '来源注释', metadata: { evidenceTier: 'A' },
    });
    const sourceQueries = queries.filter((query) => /from "source_documents"/.test(query.text));
    expect(sourceQueries).toHaveLength(1);
    assertBoundedSummaryQuery(sourceQueries[0]!);
    expect(sourceQueries[0]!.values).toContain('s-id-only');
    expect(sourceQueries[0]!.values).toContain('key-national');
    expect(sourceQueries[0]!.values).not.toContain('key-unrelated');
    expect(JSON.stringify(result)).not.toContain('仅来源正文接口需要的全文');
  });

  it('omits full text from the source list SQL but retains it on source detail paths', async () => {
    const fullSource = source('s-1', 'key-1');
    const { store, queries } = storeWithRows({ source_documents: [fullSource] });
    const listed = (await store.listResource('sources', { limit: 20, offset: 0 })).items[0];
    expect(listed).not.toHaveProperty('contentText');
    expect(listed?.metadata).toEqual(fullSource.metadata);
    expect(queries[0]?.text.split(' from ')[0]).not.toContain('content_text');
    expect((await store.getResource('sources', 's-1'))?.contentText).toBe(fullSource.contentText);
    expect((await store.findSourceByKey('key-1'))?.contentText).toBe(fullSource.contentText);
  });
});
