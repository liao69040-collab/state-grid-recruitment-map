/** Product reference baselines, not a claim that every official hiring record
 * nationwide is present. Each entry represents a reviewed, complete import of
 * the supplied roster. A newer fact or partial roster must never promote a year.
 *
 * Before adding a cohort: audit its full roster, source scope, import identity
 * and reference links; update the frontend REVIEWED_COMPLETE_COHORTS in the
 * same release. Runtime source visibility and per-year data availability remain
 * enforced by their existing routes, independently of this selection policy.
 */
export const REVIEWED_COMPLETE_ROSTER_DATASETS = Object.freeze([
  Object.freeze({
    cohortYear: 2026,
    datasetKey: '2026-roster-reconciled-20260922',
    version: 'roster-handoff-1',
    checksumSha256: 'ed57e312e14349e6cb1543ab820102332f28ec49435bbe6e41b2917fc4abf46b',
  }),
]);

export const REVIEWED_COMPLETE_COHORTS: readonly number[] = Object.freeze(
  REVIEWED_COMPLETE_ROSTER_DATASETS.map(dataset => dataset.cohortYear),
);

export function resolveRecruitmentReferenceCohort(targetCohortYear: number) {
  if (!Number.isInteger(targetCohortYear) || targetCohortYear < 2020 || targetCohortYear > 2100) {
    throw new RangeError('Unsupported recruitment target cohort');
  }
  // A target's own or a future cohort cannot serve as its historical baseline.
  const priorComplete = REVIEWED_COMPLETE_COHORTS.filter(year => year < targetCohortYear);
  const referenceCohortYear = priorComplete.length ? Math.max(...priorComplete) : targetCohortYear - 1;
  return {
    referenceCohortYear,
    referenceSelection: {
      policy: 'latest_reviewed_complete_before_target' as const,
      basis: priorComplete.length ? 'reviewed_complete_roster' as const : 'previous_year_documents' as const,
      // This is the reviewed product baseline list, not audience-specific
      // availability. Never use it to invent counts for an absent/hidden roster.
      availableCompleteCohortYears: [...REVIEWED_COMPLETE_COHORTS],
    },
  };
}
