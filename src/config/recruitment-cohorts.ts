/** Applicant planning and historical statistics are deliberately independent.
 * A new planning year does not relabel or clone published rules or rosters. */
export const DEFAULT_APPLICANT_COHORT = 2027;
export const HISTORICAL_ROSTER_COHORT = 2026;
export const APPLICANT_COHORT_OPTIONS: readonly number[] = [2027, 2028, 2026];
/** Reviewed complete historical rosters, not the maximum year in loose facts.
 * Add a cohort only after a complete import review, with the API manifest in the
 * same release. Never relabel historical outcomes as the applicant's cohort. */
export const REVIEWED_COMPLETE_COHORTS: readonly number[] = [2026];
export const referenceCohortYear = (targetYear: number) => {
  const eligible = REVIEWED_COMPLETE_COHORTS.filter(year => year < targetYear);
  // Older targets may have documents but no complete roster. Keep their actual
  // previous year and let coverage checks show missing outcomes, never zeros.
  return eligible.length ? Math.max(...eligible) : targetYear - 1;
};
// This is the locally reviewed evaluator's coverage, not a claim that notices
// for other cohorts have not been published. The API confirms actual coverage.
export const AVAILABLE_RULE_COHORTS: readonly number[] = [2026];
export const hasReviewedCohortRules = (year: number) => AVAILABLE_RULE_COHORTS.includes(year);

export type RecruitmentPlanningStage = {
  key: 'campus' | 'batch_1' | 'batch_2' | 'batch_3';
  label: string;
  period: string;
  kind: 'planning';
};

/** Relative planning windows only: no fabricated announcement/exam dates.
 * CSG autumn/spring and Mengxi remain separate recruitment channels. */
export function recruitmentPlanningStages(cohortYear = DEFAULT_APPLICANT_COHORT): RecruitmentPlanningStage[] {
  return [
    { key: 'campus', label: '国网提前批', period: `${cohortYear - 1}年秋季`, kind: 'planning' },
    { key: 'batch_1', label: '国网第一批', period: `${cohortYear - 1}年秋冬`, kind: 'planning' },
    { key: 'batch_2', label: '国网第二批', period: `${cohortYear}年春季`, kind: 'planning' },
    { key: 'batch_3', label: '国网第三批', period: `${cohortYear}年 · 看具体单位安排`, kind: 'planning' },
  ];
}
