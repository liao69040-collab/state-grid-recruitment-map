import { describe, expect, it } from 'vitest';
import { photoMaterialsData } from '../src/lib/photo-materials-data-20261005.js';
import { photoCardScores, photoProvinceSupplement, photoUnitRequirements } from '../src/lib/photo-materials-20261005.js';

describe('public edition excludes private paper references', () => {
  it('contains no uploaded photographs, transcriptions, source identifiers or scores', () => {
    expect(photoMaterialsData).toEqual({ schemaVersion: 'grid-photo-material-data-1', sources: [], units: [] });
  });
  it.each([2025, 2026, 2027, 2028])('does not invent private evidence for %s', year => {
    expect(photoProvinceSupplement(year, '420000')).toBeNull();
    expect(photoUnitRequirements(year)).toBeNull();
    expect(photoCardScores(year)).toEqual([]);
  });
});
