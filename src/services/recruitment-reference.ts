import type { InsightEvidence, SalaryReference } from './information-insights';

/** Reading projections from authorised source references, never eligibility decisions. */
export interface ReferenceCount {
  value: number | null;
  status: 'reference' | 'conflict' | 'missing';
  measureUnit: string;
  scopeLabel: string;
  sourceKeys: string[];
  evidenceLocators: string[];
  note: string;
  observations: {
    kind: 'source_overview' | 'province_sum' | 'unit_sum';
    value: number;
    scopeLabel: string;
    sourceKeys: string[];
    evidenceLocators: string[];
  }[];
}
export type ReferenceSegment = 'yp' | 'ep' | 'nd' | 'sc';
export interface NationalApplicationReference {
  key: string;
  cohortYear: number;
  grid: 'sgcc';
  batchCode: string;
  title: string;
  applications: ReferenceCount;
  planReferences: (ReferenceCount & { segment: ReferenceSegment })[];
  materialAdmissionReferences: (ReferenceCount & { segment: ReferenceSegment })[];
  reportedRatioText: string | null;
  reportedRatioNote: string;
  reportedRatioSourceKeys: string[];
  reportedRatioEvidenceLocators: string[];
  ratios: {
    kind: 'applications_to_plan' | 'applications_to_material_admissions';
    value: number | null;
    status: 'missing';
    comparable: false;
    reasonCode: 'scope_not_verified' | 'missing_denominator' | 'conflicting_numerator';
    note: string;
  }[];
}
export interface ReferenceClause extends InsightEvidence {
  city: string | null;
  scope: string;
  origin: 'database' | 'html_fallback';
  yearBasis: 'explicit' | 'mixed_historical' | 'unknown';
}
export interface ReferenceProfile {
  key: string;
  adcode: string | null;
  province: string;
  region: string;
  company: string | null;
  city: string | null;
  grid: string;
  cohortYear: number | null;
  batchCode: string;
  scope: string;
  sourceKeys: string[];
  evidenceLocators: string[];
  yearBasis: 'explicit' | 'mixed_historical' | 'unknown';
  yearNote: string;
  undergraduateCity: {
    sourceFlag: 0 | 1 | 2 | null;
    flagMeaning: 'original_list_filter';
    scopeClauses: ReferenceClause[];
    conditionClauses: ReferenceClause[];
  };
  schoolTierClauses: ReferenceClause[];
  outsideRegionClauses: ReferenceClause[];
  ageCertificateClauses: ReferenceClause[];
  educationClauses: ReferenceClause[];
  earlyBatchClauses: ReferenceClause[];
  assignmentClauses: ReferenceClause[];
  scores: (InsightEvidence & {
    value: number | null;
    displayValue: string;
    kind: 'written' | 'admission' | 'interview_threshold_reference';
    audienceLabel: string;
    comparable: boolean;
    comparisonKey: string | null;
    comparisonLabel: string;
  })[];
  salaries: SalaryReference[];
}
