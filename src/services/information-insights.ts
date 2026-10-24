/** Authenticated reading projections; not eligibility decisions or personal records. */
export interface InsightEvidence {
  key: string; adcode: string | null; province: string; region: string; company: string | null;
  grid: string; batchCode: string; year: number | null; title: string; text: string;
  qualifiers: string[]; nature: 'condition_reference' | 'experience_reference';
  sourceKeys: string[]; evidenceLocators: string[];
  noticeSource?: {kind:string;url:string;reviewedAt:string;bodySha256:string|null};
}
export interface EducationBatchDistribution {
  key: string; grid: string; batchCode: string; title: string; regionCount: number;
  groups: { key: string; label: string; regionCount: number; entries: InsightEvidence[] }[];
}
export interface EducationDistribution {
  cohortYear: number; batches: EducationBatchDistribution[]; historicalBatches: EducationBatchDistribution[];
}
export interface SalaryReference extends InsightEvidence {
  amount: string; location: string; minimum: number | null; maximum: number | null;
  sortValue: number | null; comparisonKey: string | null; comparisonLabel: string;
}
export interface ScoreReference extends InsightEvidence {
  value: number | null; displayValue: string; kind: 'written' | 'admission'; comparisonKey: string; comparisonLabel: string;
}
export interface RegionInsights {
  cohortYear: number; undergraduateCity: InsightEvidence[]; undergraduateEarly: InsightEvidence[];
  salaries: SalaryReference[]; scores: ScoreReference[];
  recruitmentNotices?: InsightEvidence[];
}
