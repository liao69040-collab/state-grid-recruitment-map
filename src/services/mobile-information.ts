import { authState, getAuthSessionEpoch, clearAuthSessionIfCurrent } from './auth';
import { GridInformationUnauthorized, type GridFact } from './grid-information';
import type { EducationDistribution, RegionInsights } from './information-insights';
import type { NationalApplicationReference, ReferenceProfile } from './recruitment-reference';
import type { PhotoCardScore, PhotoProvinceSupplement, PhotoUnitRequirements } from './photo-materials';
import { DEFAULT_APPLICANT_COHORT, referenceCohortYear } from '@/config/recruitment-cohorts';
export interface InformationSource { sourceKey: string; title: string; sourceType: string; sourceUrl: string | null; note: string }
export interface InformationMetric {
  countBasis?: 'complete_anonymous_aggregates' | 'source_reference' | 'not_available' | 'released_cells_only';
  value: number | null; displayValue: string; measureUnit: string; metricType: string;
  sourceYear: number | null; status: 'available' | 'reference' | 'missing' | 'suppressed';
  scopeLabel: string; sourceKeys: string[]; evidenceLocators: string[]; note: string;
}
export interface InformationFact extends Omit<GridFact, 'source'> { source: InformationSource; origin: 'database' | 'html_fallback'; yearLabel: string }
export interface InformationProvince { adcode: string; name: string; earlyBatchAvailable: boolean; factCount: number }
export interface InformationCard {
  key: string; title: string; grid: string; batchCode: string; cohortYear: number; scopeLabel: string;
  plan: InformationMetric; publicNotice: InformationMetric; applications: InformationMetric; competition: InformationMetric;
}
export interface InformationOverview {
  referenceDataAvailable?: boolean;
  rosterDataAvailable?: boolean;
  schemaVersion: 'grid-information-1' | 'grid-aggregates-1'; cohortYear: number; years: number[]; cards: InformationCard[];
  provinces: InformationProvince[]; applicationReferences: InformationFact[]; sources: InformationSource[];
  educationDistribution?: EducationDistribution; regionInsights?: RegionInsights;
  nationalApplicationReferences?: NationalApplicationReference[];
  referenceProfiles?: ReferenceProfile[];
  photoUnitRequirements?: PhotoUnitRequirements | null;
  photoCardScores?: PhotoCardScore[];
  privacy: { minimumCellCount: number | null; countBasis: 'released_cells_only' | 'complete_anonymous_aggregates' }; notes: string[];
}
export interface InformationPolicy {
  policyKey: string; cohortYear: number; batchCode: string; target: { kind: 'province' | 'unit'; code: string; name: string };
  requirements: string; process: string | null; plannedHeadcount: string | null; assessmentMethod: string | null;
  itinerary: string | null; siteQuota: string | null; admissionRule: string | null;
  actualHeadcount: string | null; notes: string | null; missingFields: string[];
  source: { sourceKey: string | null; title: string | null; sourceUrl: string | null; evidenceLocator: string; status: string; revisionKey: string | null };
  dataStatus: 'uploaded_reference_unverified';
}
export interface InformationProvinceDetail {
  schemaVersion: 'grid-information-1'; province: { adcode: string; name: string }; cohortYear: number;
  earlyBatch: { policies: InformationPolicy[]; facts: InformationFact[]; missing: boolean; historicalFacts: InformationFact[]; historicalOnly: boolean };
  batches: { batchCode: string; title: string; facts: InformationFact[] }[];
  generalFacts: InformationFact[]; historicalFacts: InformationFact[]; sources: InformationSource[]; notes: string[];
  photoSupplement?: PhotoProvinceSupplement | null;
}
const apiBaseUrl = String(import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
async function request<T>(route: string, signal?: AbortSignal, cohortYear = referenceCohortYear(DEFAULT_APPLICANT_COHORT)): Promise<T> {
  if (!authState.authenticated) throw new GridInformationUnauthorized();
  const epoch = getAuthSessionEpoch();
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort(); else signal?.addEventListener('abort', abort, { once: true });
  let timedOut = false;
  const timer = window.setTimeout(() => { timedOut = true; controller.abort(); }, 15000);
  try {
    const path = route === 'overview' ? 'grid-aggregates/information' : `grid-information/${route}`;
    const response = await fetch(`${apiBaseUrl}/api/v2/private/${path}?cohortYear=${encodeURIComponent(cohortYear)}`, { credentials: 'include', cache: 'no-store', signal: controller.signal, headers: { Accept: 'application/json' } });
    if (controller.signal.aborted || epoch !== getAuthSessionEpoch()) throw new DOMException('已取消查询', 'AbortError');
    if ([401, 403].includes(response.status)) { clearAuthSessionIfCurrent(epoch, controller.signal); throw new GridInformationUnauthorized(); }
    if (!response.ok) throw new Error(`资料暂时无法读取（${response.status}），请重试。`);
    if (!(response.headers.get('content-type') || '').includes('application/json')) throw new Error('资料返回格式无效，请检查部署版本。');
    const result = await response.json();
    if (result?.cohortYear !== cohortYear) throw new Error('返回资料的届别不一致，请刷新后重试。');
    if (result?.schemaVersion !== (route === 'overview' ? 'grid-aggregates-1' : 'grid-information-1') || (route === 'overview' && result.privacy?.countBasis !== 'complete_anonymous_aggregates')) throw new Error('资料版本或匿名聚合口径不匹配，请刷新后重试。');
    if (route === 'overview' ? !Array.isArray(result.cards) || !Array.isArray(result.provinces) || !Array.isArray(result.sources)
      : !result.province || !Array.isArray(result.earlyBatch?.policies) || !Array.isArray(result.earlyBatch?.facts) || !Array.isArray(result.batches)) throw new Error('资料内容格式无效，请重试。');
    if (signal?.aborted || controller.signal.aborted || epoch !== getAuthSessionEpoch()) throw new DOMException('已取消查询', 'AbortError');
    if (!authState.authenticated) throw new GridInformationUnauthorized();
    return result as T;
  } catch (error) { if (timedOut) throw new Error('资料读取超时，请检查网络后重试。'); throw error; }
  finally { window.clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
export const fetchInformationOverview = (signal?: AbortSignal, cohortYear = referenceCohortYear(DEFAULT_APPLICANT_COHORT)) => request<InformationOverview>('overview', signal, cohortYear);
export const fetchInformationProvince = (adcode: string, signal?: AbortSignal, cohortYear = referenceCohortYear(DEFAULT_APPLICANT_COHORT)) => request<InformationProvinceDetail>(`provinces/${encodeURIComponent(adcode)}`, signal, cohortYear);
