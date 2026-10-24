import type { RecruitmentDecision, RecruitmentResult } from '@/services/recruitment-eligibility';

export type RecruitmentResultFilter = 'positive' | 'other' | RecruitmentDecision;

// Only the primary assessment can put a unit/batch into the matching view.
// A supplemental reference comparison must not promote missing/unknown results.
export const isPositiveRecruitmentResult = (row: Pick<RecruitmentResult, 'decision'>) =>
  row.decision === 'initial_match' || row.decision === 'reference_match';

export const matchesRecruitmentResultFilter = (row: Pick<RecruitmentResult, 'decision'>, filter: RecruitmentResultFilter) =>
  filter === 'positive' ? isPositiveRecruitmentResult(row)
    : filter === 'other' ? !isPositiveRecruitmentResult(row)
      : row.decision === filter;
