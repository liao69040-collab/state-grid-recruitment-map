import { authState, bootstrapAuth } from './auth';
import { EarlyBatchApiError, type EarlyBatchApplicant } from './early-batch';
import { DEFAULT_APPLICANT_COHORT, REVIEWED_COMPLETE_COHORTS, referenceCohortYear } from '@/config/recruitment-cohorts';
export type RecruitmentBatchCode = 'campus' | 'batch_1' | 'batch_2' | 'batch_3' | 'csg_campus' | 'csg_autumn' | 'csg_spring' | 'impc_campus';
export type RecruitmentDecision = 'initial_match' | 'reference_match' | 'reference_mismatch' | 'not_matched' | 'missing_input' | 'needs_confirmation';
export type RecruitmentApplicant = Omit<EarlyBatchApplicant, 'degree'> & { degree: 'junior_college' | 'bachelor' | 'master' | 'doctor'; educationLocation?: 'domestic' | 'overseas'; qsTop100?: boolean; homeProvinceAdcode?: string; residenceProvinceAdcode?: string; originalHukouProvinceAdcode?: string; studentOriginProvinceAdcode?: string; nonEmployedDuringStudy?: boolean; hasDomesticEmployerSocialInsurance?: boolean; hasDomesticSocialInsurance?: boolean; qualificationsByDeadline?: boolean; graduationDate?: string; ageAtApplication?: number };
export type RecruitmentInitialApplicant = Pick<Partial<RecruitmentApplicant>, 'degree' | 'majorCategory' | 'graduationYear'> & {
  originalHukouProvinceAdcode?: string | null; studentOriginProvinceAdcode?: string | null;
};
export interface RecruitmentResult {
  id: string; provinceAdcode: string; provinceName: string; targetName: string; batchCode: RecruitmentBatchCode; batchLabel: string;
  grid: 'sgcc' | 'csg' | 'impc'; operatorScope: 'sgcc' | 'csg' | 'mengdong' | 'mengxi'; officialRecruitmentUrl?: string;
  decision: RecruitmentDecision; decisionLabel: string; summary: string;
  checks: Array<{ field: string; label: string; expected: string; state: 'pass' | 'fail' | 'missing' | 'confirm' }>;
  groups: Array<{ category: string; title: string; items: string[] }>;
  nextSteps: string[]; ruleScope: 'basic_conditions' | 'reference' | 'not_structured';
  referenceComparison?: { decision: RecruitmentDecision; label: string; summary: string; checks: RecruitmentResult['checks'] };
  originReferences?: Array<{ id: string; sourceCohortYear: number; evidenceKind: 'archived_official' | 'workbook_experience'; label: string; scope: string; summary: string; applicantContext: string; assessment: 'historical_reference_only' | 'county_confirmation_required'; affectsEligibility: false; affectsRanking: false }>;
}
export interface RecruitmentEvaluation {
  schemaVersion: string; cohortYear: number; batchCodes: RecruitmentBatchCode[]; notice: string;
  targetCohortYear?: number; referenceCohortYear?: number; sourceCohortYear?: number; comparisonMode?: 'current' | 'historical' | 'reference';
  referenceSelection?: { policy: 'latest_reviewed_complete_before_target'; basis: 'reviewed_complete_roster' | 'previous_year_documents'; availableCompleteCohortYears: number[] };
  coverage?: { status: 'available' | 'not_loaded' | 'cohort_mismatch' | 'historical_only' | 'reference_only'; ruleCohortYear: number | null; availableRuleCohorts: number[] };
  historicalResults?: Array<Pick<RecruitmentResult, 'id' | 'provinceAdcode' | 'provinceName' | 'targetName' | 'grid' | 'operatorScope' | 'officialRecruitmentUrl' | 'batchCode' | 'batchLabel' | 'groups' | 'ruleScope'>>;
  summary: { total: number; initialMatch: number; referenceMatch: number; referenceMismatch: number; notMatched: number; missingInput: number; needsConfirmation: number }; results: RecruitmentResult[];
}
export async function evaluateRecruitmentEligibility(applicant: RecruitmentApplicant, options: { cohortYear?: number; comparisonMode?: 'current' | 'historical' | 'reference' } = {}): Promise<RecruitmentEvaluation> {
  if (!authState.ready || !authState.authenticated || !authState.csrfToken) await bootstrapAuth();
  if (!authState.authenticated) throw new EarlyBatchApiError(401, '请先登录后再查询。');
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 15_000);
  const targetYear = options.cohortYear ?? DEFAULT_APPLICANT_COHORT;
  const comparisonMode = options.comparisonMode ?? 'reference';
  try {
    const base = String(import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
    const response = await fetch(`${base}/api/v2/private/recruitment-eligibility/evaluate`, {
      method: 'POST', credentials: 'include', cache: 'no-store', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': authState.csrfToken || '' },
      body: JSON.stringify({ cohortYear: targetYear, comparisonMode, applicant }),
    });
    if (!response.ok) { const payload = await response.json().catch(() => ({})); throw new EarlyBatchApiError(response.status, payload?.error?.message || payload?.message || '条件查询暂不可用，请重试。'); }
    const result: RecruitmentEvaluation = await response.json();
    const selection = result.referenceSelection;
    const referenceSelectionMatches = selection?.policy === 'latest_reviewed_complete_before_target'
      && selection.basis === (REVIEWED_COMPLETE_COHORTS.some(year => year < targetYear) ? 'reviewed_complete_roster' : 'previous_year_documents')
      && Array.isArray(selection.availableCompleteCohortYears)
      && [...selection.availableCompleteCohortYears].sort().join(',') === [...REVIEWED_COMPLETE_COHORTS].sort().join(',');
    if (comparisonMode === 'reference' && (!referenceSelectionMatches || result.targetCohortYear !== targetYear || result.referenceCohortYear !== referenceCohortYear(targetYear) || result.sourceCohortYear !== referenceCohortYear(targetYear) || result.comparisonMode !== 'reference' || !['reference_only', 'not_loaded'].includes(result.coverage?.status ?? '') || !Array.isArray(result.results) || result.results.some(row => ['initial_match', 'not_matched'].includes(row.decision)))) {
      throw new EarlyBatchApiError(502, '返回的参考届别或匹配方式不一致，请刷新后重试。');
    }
    return result;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw new EarlyBatchApiError(408, '查询超时，请重试。');
    throw error;
  } finally { window.clearTimeout(timer); }
}
