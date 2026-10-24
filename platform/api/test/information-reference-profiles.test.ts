import { describe, expect, it } from 'vitest';
import { buildNationalApplicationReferences } from '../src/lib/information-national-references.js';
import { htmlCityFlags } from '../src/lib/information-html-city-flags.js';
import { buildReferenceProfiles } from '../src/lib/information-reference-profiles.js';
import type { GridInformationInput } from '../src/lib/grid-information.js';
const emptyInput: GridInformationInput = { snapshot: { datasets: [], versions: [] }, catalogs: [], policies: [], provinces: [], sources: [], metrics: [] };

describe('public edition has no customer material snapshots', () => {
  it('ships no customer city classifications', () => expect(htmlCityFlags).toEqual([]));
  it('does not fabricate national counts or ratios without licensed source evidence', () => {
    const rows = buildNationalApplicationReferences(emptyInput, 2026, []);
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.applications.value).toBeNull();
      expect(row.applications.observations).toEqual([]);
      expect(row.planReferences).toEqual([]);
      expect(row.ratios.every(ratio => ratio.value === null && !ratio.comparable)).toBe(true);
    }
  });
  it('does not project missing customer facts into references', () => expect(buildReferenceProfiles([], [])).toEqual([]));
  it('does not move historical evidence to an unreviewed year', () => expect(buildNationalApplicationReferences(emptyInput, 2027, [])).toEqual([]));
});
