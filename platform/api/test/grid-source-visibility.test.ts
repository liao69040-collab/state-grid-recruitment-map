import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import type { AppConfig } from '../src/config.js';
import { secretDigest } from '../src/lib/crypto.js';
import { buildGridInformationOverview } from '../src/lib/grid-information.js';
import { normalizeGridMapCatalog } from '../src/lib/grid-map-catalog.js';
import { gridChecksum, gridDatasetSchema, gridFacets, gridFactQuerySchema, gridRankingQuerySchema, gridVersion, queryGridFacts, queryGridRankings, type GridSnapshot } from '../src/lib/grid-query.js';
import { gridMapCoverage, gridMapQuerySchema, queryGridMapCompany, queryGridMapOverview, queryGridMapSchool } from '../src/lib/grid-map.js';
import { gridCatalogsForMemberSources, gridSnapshotForMemberSources } from '../src/lib/grid-source-visibility.js';
import { PRIVATE_SOURCE_PREFIX, privateSourceIndex } from '../src/lib/private-source-boundary.js';
import { MemoryStore } from '../src/store/memory.js';

const restrictedKey = 'synthetic-metadata-restricted';
const prefixedKey = `${PRIVATE_SOURCE_PREFIX}SYNTHETIC`;
const candidateKey = `company.candidate.${'a'.repeat(32)}`;
const privateCandidateKey = `company.candidate.${'b'.repeat(32)}`;
const restrictedSources = [{ id: 'synthetic-source-id', sourceKey: restrictedKey, metadata: { visibility: 'admin_only' } }];
const config: AppConfig = {
  nodeEnv: 'test', host: '127.0.0.1', port: 8799, trustProxyHops: 0, databaseUrl: 'postgresql://unused',
  publicOrigins: ['https://example.test'], cookieSecure: true, sessionTtlSeconds: 7200,
  sessionSecret: 'source-projection-test-'.padEnd(48, 's'), phonePepper: 'source-projection-test-'.padEnd(48, 'p'),
  phoneEncryptionKey: Buffer.alloc(32, 7), mapGeojsonDir: '/nonexistent-test-map', autoMigrate: false,
};

function fixture(reverse = false) {
  const source = (sourceKey: string) => ({ sourceKey, title: sourceKey, sourceType: 'user_material', sha256: 'a'.repeat(64), sourceUrl: null, note: '合成来源' });
  const outcome = { outcomeKey: 'safe-large', sourceKey: 'safe', cohortYear: 2026, grid: 'sgcc', batchCode: 'batch_1', province: '湖北', city: null,
    companyKey: 'company', company: '湖北测试单位', orgCategory: 'province_company', parentSchoolKey: 'school', schoolName: '合成大学', campusKey: 'campus', campusName: '合成大学',
    schoolTier: '211', educationLevel: '本科', schoolOwnership: '公办', schoolProvince: '湖北', industryTags: [], metricType: 'public_notice_record_count', recordCount: 10, evidenceLocator: '脱敏合成汇总' };
  const low = { ...outcome, outcomeKey: 'safe-low', parentSchoolKey: 'low-school', schoolName: '低计数合成大学', campusKey: 'low-campus', campusName: '低计数合成大学', companyKey: 'low-company', company: '低计数单位', recordCount: 4 };
  const hidden = { ...outcome, outcomeKey: 'private-only', sourceKey: restrictedKey, parentSchoolKey: 'private-school', schoolName: 'RESTRICTED_SCHOOL', campusKey: 'private-campus', campusName: 'RESTRICTED_SCHOOL', companyKey: 'private-company', company: 'RESTRICTED_COMPANY', recordCount: 30 };
  const fact = { factKey: 'safe-fact-1', sourceKey: 'safe', cohortYear: 2026, grid: 'sgcc', batchCode: 'batch_1', scope: 'company', province: '湖北', city: '武汉市', company: '参考候选单位',
    category: 'application', title: '报名资料参考', text: '安全合成事实，不是录用人数。', educationLevel: null, schoolTier: null, evidenceLocator: '合成资料', dataStatus: 'reference', issueReason: null, relatedOfficialSourceKey: null };
  const dataset = gridDatasetSchema.parse({ schemaVersion: 'grid-query-1', datasetKey: 'mixed', version: 'v1', title: '混合来源合成版本', createdAt: '2026-09-22T00:00:00.000Z', notes: [],
    sources: [source('safe'), source(restrictedKey), source(prefixedKey)],
    schoolOutcomes: [outcome, { ...outcome, outcomeKey: 'hidden-large', sourceKey: restrictedKey, recordCount: 20 }, low,
      { ...low, outcomeKey: 'hidden-low', sourceKey: restrictedKey, recordCount: 6 }, hidden,
      { ...hidden, outcomeKey: 'prefixed-only', sourceKey: prefixedKey, campusKey: 'prefixed-campus', parentSchoolKey: 'prefixed-school', recordCount: 40 },
      { ...outcome, outcomeKey: 'safe-unassigned', province: null, companyKey: 'national', company: '未归属单位', orgCategory: 'direct_unit', recordCount: 1 },
    ],
    policyFacts: [fact, { ...fact, factKey: 'safe-fact-2' },
      { ...fact, factKey: 'private-candidate-fact', sourceKey: restrictedKey },
      { ...fact, factKey: 'private-only-fact', sourceKey: restrictedKey, company: 'RESTRICTED_CANDIDATE', city: 'RESTRICTED_CITY', cohortYear: 2025 },
      { ...fact, factKey: 'prefixed-fact', sourceKey: prefixedKey, text: 'PREFIX_RESTRICTED_BODY' },
      { ...fact, factKey: 'secondary-source', relatedOfficialSourceKey: restrictedKey, text: 'SECONDARY_RESTRICTED_BODY' },
      { ...fact, factKey: 'quarantined-safe-source', dataStatus: 'quarantined', issueReason: '合成隔离', text: 'QUARANTINED_BODY' },
    ],
  });
  if (reverse) dataset.schoolOutcomes.reverse();
  const privateDataset = gridDatasetSchema.parse({ ...dataset, datasetKey: 'private-dataset', sources: [source(restrictedKey)],
    schoolOutcomes: [{ ...hidden, outcomeKey: 'private-year', cohortYear: 2024, recordCount: 2 }], policyFacts: [] });
  const safeDataset = gridDatasetSchema.parse({ ...dataset, datasetKey: 'safe-dataset', sources: [source('safe-empty')], schoolOutcomes: [], policyFacts: [] });
  const datasets = [dataset, privateDataset, safeDataset], snapshot: GridSnapshot = { datasets, versions: datasets.map(gridVersion) };
  const reference = (factKey: string, sourceKey: string, count: number) => ({ factKey, sourceKey, inputId: factKey, cohortYear: 2026, batchCode: 'batch_1', batchRaw: '一批',
    applicationCount: count, metricType: 'application_record_count_reference', measureUnit: '人次', dataStatus: 'reference', sourceScope: 'company', sourceTable: 'html_application_units' });
  const candidate = { candidateKey, grid: 'sgcc', province: '湖北', city: '武汉市', companyRegion: '湖北', name: '参考候选单位', entityStatus: 'unverified_candidate', cityEvidenceStatus: 'lexical_reference',
    references: [reference('safe-fact-1', 'safe', 100), reference('private-candidate-fact', restrictedKey, 999)] };
  const catalog = normalizeGridMapCatalog({ schemaVersion: 'grid-map-catalog-1', datasetKey: 'mixed', rosterVersion: 'v1', version: 'geo-v1', rosterChecksumSha256: gridChecksum(dataset),
    schoolAliases: [], unitAliases: [], schoolGeography: [], cities: [], sources: [],
    provinces: [{ adcode: '420000', provinceAdcode: null, name: '湖北省', longitude: null, latitude: null, coordinateSystem: null, precision: 'province', sourceLabel: '合成地区', sourceFile: 'fixture', sourceProperty: null }],
    companyCandidates: { schemaVersion: 'national-company-candidates-1', version: 'v1', title: '合成候选目录', notes: ['报名参考非录用'], sources: [source('safe'), source(restrictedKey)].map(({ sourceUrl: _url, note: _note, ...row }) => row),
      candidates: [candidate, { ...candidate, candidateKey: privateCandidateKey, name: 'RESTRICTED_CANDIDATE', references: [reference('private-only-fact', restrictedKey, 888)] }] },
  });
  return { snapshot, catalog };
}

describe('immutable pre-aggregation source projection', () => {
  it('refreshes cached projections on visibility changes without mutating import checksums or administrator inputs', () => {
    const { snapshot, catalog } = fixture(), catalogs = [catalog], before = gridChecksum(snapshot);
    const open = privateSourceIndex([]), restricted = privateSourceIndex(restrictedSources);
    const first = gridSnapshotForMemberSources(snapshot, open);
    expect(first.datasets[0]?.schoolOutcomes.some(row => row.sourceKey === restrictedKey)).toBe(true);
    expect(first.datasets[0]?.schoolOutcomes.some(row => row.sourceKey === prefixedKey)).toBe(false);
    const safe = gridSnapshotForMemberSources(snapshot, restricted);
    expect(safe).not.toBe(first);
    expect(gridSnapshotForMemberSources(snapshot, privateSourceIndex([...restrictedSources]))).toBe(safe);
    expect(safe.datasets.flatMap(row => row.schoolOutcomes).reduce((sum, row) => sum + row.recordCount, 0)).toBe(15);
    expect(safe.versions).toEqual([snapshot.versions[2]]);
    const safeCatalogs = gridCatalogsForMemberSources(catalogs, safe, restricted);
    expect(gridCatalogsForMemberSources(catalogs, safe, restricted)).toBe(safeCatalogs);
    expect(safeCatalogs[0]?.companyCandidates?.candidates).toHaveLength(1);
    expect(safeCatalogs[0]?.companyCandidates?.candidates[0]?.references).toHaveLength(1);
    expect(gridChecksum(snapshot)).toBe(before);
    expect(catalog.companyCandidates?.candidates).toHaveLength(2);
    expect(gridSnapshotForMemberSources(snapshot, open).datasets[0]?.schoolOutcomes.some(row => row.sourceKey === restrictedKey)).toBe(true);
  });

  it.each([false, true])('information builder filters before merged-cell release, reverse=%s', reverse => {
    const { snapshot, catalog } = fixture(reverse), input = { snapshot, catalogs: [catalog], policies: [], sources: restrictedSources };
    const old = buildGridInformationOverview(input, 2026), exact = buildGridInformationOverview(input, 2026, true);
    expect(old.cards.find(row => row.key === 'sgcc-batch_1')?.publicNotice.value).toBe(10);
    expect(exact.cards.find(row => row.key === 'sgcc-batch_1')?.publicNotice.value).toBe(15);
    expect(old.years).toEqual([2026]);
    expect(old.privacy.countBasis).toBe('released_cells_only');
    expect(exact.privacy.countBasis).toBe('complete_anonymous_aggregates');
  });
});

describe.each([false, true])('MemoryStore audience boundary, reverse outcome order=%s', reverse => {
  const { snapshot, catalog } = fixture(reverse);
  const store = new MemoryStore();
  let app: Awaited<ReturnType<typeof buildApp>>;
  const member = { cookie: 'hz_user_session=projection-member' }, adminHeaders = { cookie: 'hz_admin_session=projection-admin' };
  beforeAll(async () => {
    for (const dataset of snapshot.datasets) store.seedGridDataset(dataset);
    store.seedGridMapCatalog(catalog);
    // Model Postgres's stable version cache, so mutable source visibility must
    // invalidate the audience projection even without a new dataset import.
    vi.spyOn(store, 'gridQuerySnapshot').mockResolvedValue(snapshot);
    const admin = await store.upsertAdmin({ username: 'projection-admin', displayName: '合成测试', passwordHash: 'synthetic' });
    const user = await store.createUser({ phoneLookupHash: 'projection-user', phoneCiphertext: 'opaque', phoneLast4: '0000', passwordHash: 'synthetic', createdByAdminId: admin.id });
    const session = { csrfHash: 'synthetic', expiresAt: new Date(Date.now() + 60000), ipHash: 'synthetic', userAgentHash: 'synthetic' };
    await store.createUserSession(user.id, { ...session, tokenHash: secretDigest('projection-member', config.sessionSecret) });
    await store.createAdminSession(admin.id, { ...session, tokenHash: secretDigest('projection-admin', config.sessionSecret) });
    await store.createResource('sources', restrictedSources[0]!, admin.id);
    app = await buildApp({ config, store });
  });
  afterAll(async () => { await app.close(); });

  it('filters public/member maps before summing, preserves safe low-count identities and prevents private-only discovery', async () => {
    // The public projection now sums complete cells (10 + the 4-record cell),
    // while the member grid-map route keeps the released-cells lower bound.
    const audiences = [
      ['public', 14, 'complete_anonymous_aggregates'],
      ['private', 10, 'released_cells_only'],
    ] as const;
    for (const [audience, recordCount, countBasis] of audiences) {
      const response = await app.inject({ url: `/api/v2/${audience}/grid-map/overview?provinceAdcode=420000`, headers: member });
      expect(response.statusCode).toBe(200);
      expect(response.json().provinceSummaries[0]).toMatchObject({ recordCount, schoolCount: 2, countBasis });
      expect(response.body).not.toMatch(/RESTRICTED_|PREFIX_RESTRICTED|SECONDARY_RESTRICTED/);
      expect(response.headers['cache-control']).toContain('no-store');
    }
    const school = await app.inject({ url: '/api/v2/private/grid-map/schools/campus', headers: member });
    expect(school.json().school.recordCount).toBe(10);
    for (const path of ['schools/low-campus', 'companies/low-company']) {
      const response = await app.inject({ url: `/api/v2/private/grid-map/${path}`, headers: member });
      expect(response.statusCode).toBe(200);
      expect(response.json()[path.startsWith('schools') ? 'school' : 'company'].recordCount).toBeNull();
    }
    for (const path of ['schools/private-campus', 'schools/prefixed-campus', 'companies/private-company', `companies/${privateCandidateKey}`]) {
      expect((await app.inject({ url: `/api/v2/private/grid-map/${path}`, headers: member })).statusCode).toBe(404);
    }
    const candidate = await app.inject({ url: `/api/v2/private/grid-map/companies/${candidateKey}`, headers: member });
    expect(candidate.json().candidate.references).toHaveLength(1);
    expect(candidate.json().candidate.references[0].applicationCount).toBe(100);
    expect(candidate.json().company.recordCount).toBeNull();
  });

  it('filters before fact pagination, facets, version metadata and ranking filters', async () => {
    for (const page of [1, 2]) {
      const response = await app.inject({ url: `/api/v2/private/grid-query/facts?pageSize=1&page=${page}`, headers: member });
      expect(response.json()).toMatchObject({ total: 2, page, pageSize: 1 });
      expect(response.json().items).toHaveLength(1);
      expect(response.json().items[0].sourceKey).toBe('safe');
    }
    const facts = await app.inject({ url: '/api/v2/private/grid-query/facts?q=RESTRICTED', headers: member });
    expect(facts.json()).toMatchObject({ items: [], total: 0 });
    const facets = await app.inject({ url: '/api/v2/private/grid-query/facets', headers: member });
    expect(facets.json().years).toEqual([2026]);
    expect(facets.body).not.toMatch(/RESTRICTED_|private-dataset/);
    expect(facets.json().versions).toEqual([snapshot.versions[2]]);
    expect((await app.inject({ url: '/api/v2/private/grid-query/versions', headers: member })).json().items).toEqual([snapshot.versions[2]]);
    const rankings = await app.inject({ url: '/api/v2/private/grid-query/rankings?view=campus', headers: member });
    expect(rankings.json().total).toBe(2);
    expect(rankings.json().items.find((row: { schoolKey: string }) => row.schoolKey === 'campus').recordCount).toBe(10);
    expect(rankings.json().items.find((row: { schoolKey: string }) => row.schoolKey === 'low-campus')).toMatchObject({ recordCount: null, rank: null });
    expect((await app.inject({ url: '/api/v2/private/grid-query/rankings?q=RESTRICTED', headers: member })).json().total).toBe(0);
  });

  it('retains exact safe aggregates including small/unknown-destination cells while old information remains a lower bound', async () => {
    const old = await app.inject({ url: '/api/v2/private/grid-information/overview', headers: member });
    expect(old.json().cards.find((row: { key: string }) => row.key === 'sgcc-batch_1').publicNotice.value).toBe(10);
    const exact = await app.inject({ url: '/api/v2/private/grid-aggregates/overview?provinceAdcode=420000', headers: member });
    expect(exact.json().nationalSummary).toMatchObject({ recordCount: 15, unassignedDestinationRecordCount: 1, countBasis: 'complete_anonymous_aggregates' });
    expect(exact.json().recruitmentSummary).toMatchObject({ national: { recordCount: 15 }, targetProvince: { recordCount: 14 }, otherProvinces: { recordCount: 1 },
      equations: { targetPlusOtherEqualsNational: true, destinationSumEqualsNational: true, batchSumEqualsNational: true } });
    const information = await app.inject({ url: '/api/v2/private/grid-aggregates/information', headers: member });
    expect(information.json().cards.find((row: { key: string }) => row.key === 'sgcc-batch_1').publicNotice.value).toBe(15);
    for (const path of ['schools/low-campus', 'companies/low-company']) {
      const response = await app.inject({ url: `/api/v2/private/grid-aggregates/${path}`, headers: member });
      expect(response.statusCode).toBe(200);
      expect(response.json()[path.startsWith('schools') ? 'school' : 'company'].recordCount).toBe(4);
    }
    const rankings = await app.inject({ url: '/api/v2/private/grid-aggregates/rankings?view=campus', headers: member });
    expect(rankings.json().items.map((row: { recordCount: number }) => row.recordCount)).toEqual([11, 4]);
    for (const body of [exact.body, information.body, rankings.body]) expect(body).not.toMatch(/RESTRICTED_|PREFIX_RESTRICTED|SECONDARY_RESTRICTED|outcomeKey|phoneCiphertext/);
    for (const route of ['grid-query/rankings', 'grid-map/overview', 'grid-aggregates/overview']) {
      expect((await app.inject({ url: `/api/v2/private/${route}` })).statusCode).toBe(401);
    }
  });

  it('leaves all administrator queries byte-equivalent to the original complete source contract', async () => {
    const catalogs = await store.gridMapCatalogSnapshot(), q = gridMapQuerySchema.parse({});
    const cases = [
      ['grid-map/overview', queryGridMapOverview(snapshot, catalogs, q, true)],
      ['grid-map/schools/campus', queryGridMapSchool(snapshot, catalogs, 'campus', q, true)],
      ['grid-map/companies/private-company', queryGridMapCompany(snapshot, catalogs, 'private-company', q, true)],
      [`grid-map/companies/${candidateKey}`, queryGridMapCompany(snapshot, catalogs, candidateKey, q, true)],
      ['grid-map/coverage', gridMapCoverage(snapshot, catalogs)],
      ['grid-query/rankings', queryGridRankings(snapshot, gridRankingQuerySchema.parse({}), true)],
      ['grid-query/facts', queryGridFacts(snapshot, gridFactQuerySchema.parse({}), true)],
      ['grid-query/facets', gridFacets(snapshot, true)],
      ['grid-query/versions', { items: snapshot.versions }],
    ] as const;
    for (const [route, expected] of cases) {
      const response = await app.inject({ url: `/api/v2/admin/${route}`, headers: adminHeaders });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(JSON.parse(JSON.stringify(expected)));
    }
    expect((await app.inject({ url: '/api/v2/admin/grid-map/coverage', headers: adminHeaders })).json().recordCount).toBe(113);
  });

  it('responds to a source visibility update without a dataset reimport or process restart', async () => {
    const before = gridChecksum(snapshot);
    // Ask one identical query on both sides of the change. The overview memoises
    // per query, so a cache that keys on anything but the projected snapshot
    // identity would replay this first answer after the source is restricted.
    const repeated = '/api/v2/public/grid-map/overview?provinceAdcode=420000';
    expect((await app.inject({ url: repeated })).json().provinceSummaries[0].recordCount).toBe(14);
    await store.createResource('sources', { sourceKey: 'safe', metadata: { visibility: 'admin_only' } }, 'synthetic-admin');
    expect((await app.inject({ url: repeated })).json().provinceSummaries[0].recordCount).toBeNull();
    const response = await app.inject({ url: '/api/v2/public/grid-map/overview' });
    expect(response.json().provinceSummaries[0]).toMatchObject({ recordCount: null, schoolCount: 0, companyCount: 0, policyFactCount: 0 });
    expect((await app.inject({ url: '/api/v2/private/grid-query/rankings', headers: member })).json().total).toBe(0);
    expect((await app.inject({ url: '/api/v2/private/grid-aggregates/overview', headers: member })).json().nationalSummary.recordCount).toBeNull();
    expect((await app.inject({ url: '/api/v2/admin/grid-map/coverage', headers: adminHeaders })).json().recordCount).toBe(113);
    expect(gridChecksum(snapshot)).toBe(before);
  });
});
