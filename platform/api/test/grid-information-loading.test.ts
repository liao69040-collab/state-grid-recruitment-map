import { describe, expect, it, vi } from 'vitest';
import { loadGridInformation } from '../src/lib/grid-information.js';
import type { DataStore } from '../src/store/types.js';
import { informationEducationPins } from '../src/lib/information-education-pins.js';

// Public regression fixtures: exercise source loading without distributing the
// customer-specific approval catalog or its original text/checksums.
vi.mock('../src/lib/information-education-pins.js', () => ({
  informationEducationPins: Array.from({ length: 3 }, (_, i) => ({
    key: `synthetic-pin-${i}`, unitKey: `synthetic-unit-${i}`, province: '演示省',
    batch: 'batch_1', sha256: 'a'.repeat(64), sourceKeys: [`synthetic-source-${i}`],
    scope: { sourceKey: `synthetic-source-${i}`, bodySha256: 'b'.repeat(64), text: '合成测试文本' },
  })),
}));

describe('information published condition loading', () => {
  it('loads every published page and keeps private source metadata for exclusion', async () => {
    const calls: Array<{ resource: string; query: Record<string, unknown> }> = [];
    const store = {
      gridQuerySnapshot: async () => ({ datasets: [], versions: [] }),
      gridMapCatalogSnapshot: async () => [], listEarlyBatchPolicies: async () => [],
      adminOnlySources: async () => [{ sourceKey: 'restricted', metadata: { visibility: 'admin_only' } }],
      listResource: async (resource: string, query: Record<string, unknown>) => {
        calls.push({ resource, query });
        if (resource === 'recruitment-requirements') return {
          items: query.offset === 0 ? Array.from({ length: 500 }, (_, i) => ({ id: `r${i}` })) : [{ id: 'r500' }], total: 501,
        };
        return { items: [], total: 0 };
      },
    } as unknown as DataStore;
    const result = await loadGridInformation(store, 2026);
    expect(result.requirements).toHaveLength(501);
    expect(calls.filter(c => c.resource === 'recruitment-requirements').map(c => c.query.offset)).toEqual([0, 500]);
    expect(calls.filter(c => !['sources','provinces'].includes(c.resource)).every(c => c.query.publicationStatus === 'published')).toBe(true);
    expect(calls.filter(c => ['sources','provinces'].includes(c.resource)).every(c => c.query.publicationStatus === undefined)).toBe(true);
    expect(calls.filter(c => c.resource === 'recruitment-requirements').every(c => c.query.cohortYear === 2026)).toBe(true);
    expect(result.sources).toEqual([{ sourceKey: 'restricted', metadata: { visibility: 'admin_only' } }]);
  });

  it('fails explicitly when a reported page is unavailable, rather than claiming zero conditions', async () => {
    const store = {
      gridQuerySnapshot: async () => ({ datasets: [], versions: [] }),
      gridMapCatalogSnapshot: async () => [], listEarlyBatchPolicies: async () => [], adminOnlySources: async () => [],
      listResource: async (resource: string) => ({ items: [], total: resource === 'recruitment-requirements' ? 1 : 0 }),
    } as unknown as DataStore;
    await expect(loadGridInformation(store, 2026)).rejects.toThrow('招聘信息加载不完整');
  });

  it('hydrates only published public scope documents and rechecks full-row visibility', async () => {
    const pins = informationEducationPins.filter(pin => 'scope' in pin);
    const keys = [...new Set(pins.map(pin => pin.scope.sourceKey))].slice(0, 3);
    expect(keys).toHaveLength(3);
    const rows: Array<{ id: string; sourceKey: string; cohortYear: number }> = keys.map((sourceKey, i) => ({ id: `scope-${i}`, sourceKey, cohortYear: 2026 }));
    rows.push({ id: 'unneeded', sourceKey: 'unneeded', cohortYear: 2026 });
    const fetched: string[] = [];
    const store = {
      gridQuerySnapshot: async () => ({ datasets: [], versions: [] }),
      gridMapCatalogSnapshot: async () => [], listEarlyBatchPolicies: async () => [],
      adminOnlySources: async () => [{ ...rows[1], metadata: { visibility: 'admin_only' } }],
      listResource: async (resource: string) => ({ items: resource === 'sources' ? rows : [], total: resource === 'sources' ? rows.length : 0 }),
      getResource: async (_: string, id: string) => { fetched.push(id); return { ...rows.find(row => row.id === id), contentText: '原文仅内部核对', ...(id === 'scope-2' ? { metadata: { visibility: 'admin_only' } } : {}) }; },
    } as unknown as DataStore;
    const input = await loadGridInformation(store, 2026);
    expect(fetched.sort()).toEqual(['scope-0','scope-2']);
    expect(input.sources?.find(row => row.id === 'scope-0')?.contentText).toBe('原文仅内部核对');
    expect(input.sources?.find(row => row.id === 'scope-2')?.contentText).toBeUndefined();
  });
});
