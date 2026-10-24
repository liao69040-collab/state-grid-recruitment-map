import { describe, expect, it } from 'vitest';
import {
  REVIEWED_COMPLETE_COHORTS,
  REVIEWED_COMPLETE_ROSTER_DATASETS,
  resolveRecruitmentReferenceCohort,
} from '../src/lib/recruitment-reference-cohorts.js';

describe('reviewed complete roster reference policy', () => {
  it('pins the approved complete import, not any latest fact year', () => {
    expect(REVIEWED_COMPLETE_COHORTS).toEqual([2026]);
    expect(REVIEWED_COMPLETE_ROSTER_DATASETS).toEqual([{
      cohortYear: 2026,
      datasetKey: '2026-roster-reconciled-20260922',
      version: 'roster-handoff-1',
      checksumSha256: 'ed57e312e14349e6cb1543ab820102332f28ec49435bbe6e41b2917fc4abf46b',
    }]);
    expect(Object.isFrozen(REVIEWED_COMPLETE_COHORTS)).toBe(true);
    expect(Object.isFrozen(REVIEWED_COMPLETE_ROSTER_DATASETS[0])).toBe(true);
  });
  it.each([2027, 2028, 2030, 2100])('selects 2026 for later target %i', target => {
    expect(resolveRecruitmentReferenceCohort(target)).toEqual({ referenceCohortYear: 2026,
      referenceSelection: { policy: 'latest_reviewed_complete_before_target', basis: 'reviewed_complete_roster', availableCompleteCohortYears: [2026] } });
  });
  it.each([2020, 2025, 2026])('keeps target %i on earlier documents without inventing complete roster coverage', target => {
    const out = resolveRecruitmentReferenceCohort(target);
    expect(out.referenceCohortYear).toBe(target - 1);
    expect(out.referenceSelection.basis).toBe('previous_year_documents');
    expect(out.referenceCohortYear).toBeLessThan(target);
  });
  it('does not let a consumer mutate the shared reviewed cohort list', () => {
    const first = resolveRecruitmentReferenceCohort(2028);
    first.referenceSelection.availableCompleteCohortYears.push(2027);
    expect(resolveRecruitmentReferenceCohort(2028).referenceCohortYear).toBe(2026);
    expect(resolveRecruitmentReferenceCohort(2028).referenceSelection.availableCompleteCohortYears).toEqual([2026]);
  });
  it.each([NaN, Infinity, -Infinity, 2027.1, 2019, 2101])('rejects unsupported internal target %s', target => {
    expect(() => resolveRecruitmentReferenceCohort(target)).toThrow(RangeError);
  });
});
