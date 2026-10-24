import { describe, expect, it } from 'vitest';
import { recruitmentOriginReferences, reviewedOfficialOriginPins, reviewedOriginWorkbookPins } from '../src/lib/recruitment-origin-reference.js';

describe('public origin references require verified evidence', () => {
  it('does not distribute private workbook interpretations', () => expect(reviewedOriginWorkbookPins).toEqual([]));
  it('does not create eligibility or origin claims from a province alone', () => {
    expect(recruitmentOriginReferences({ sourceCohortYear: 2026, unitKey: 'sgcc-unit:10450001', batchCode: 'batch_3', applicant: { originalHukouProvinceAdcode: '420000' }, referenceFacts: [], sources: [] })).toEqual([]);
  });
  it.each(reviewedOfficialOriginPins)('keeps official $scope evidence separate from eligibility', pin => {
    const source = { sourceKey: pin.key, checksumSha256: pin.sha256, cohortYear: 2026, batchCode: pin.batch, unitScope: pin.unitScope, sourceType: 'current_official_page', status: 'archived_current_official', contentText: pin.excerpt };
    const input = { sourceCohortYear: 2026, unitKey: pin.unitKey, batchCode: pin.batch, applicant: {}, referenceFacts: [], sources: [source] };
    const result = recruitmentOriginReferences(input);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ affectsEligibility: false, affectsRanking: false, assessment: 'county_confirmation_required' });
    expect(recruitmentOriginReferences({ ...input, sourceCohortYear: 2027 })).toEqual([]);
    expect(recruitmentOriginReferences({ ...input, sources: [{ ...source, checksumSha256: 'unverified' }] })).toEqual([]);
  });
});
