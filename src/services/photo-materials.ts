/** Read-only historical material supplied by Hengzhen Education; not eligibility rules. */
export interface PhotoMaterialSource {
  sourceKey: string; title: string; cohortYear: number | null; note: string; sha256?: string;
}
export interface PhotoMaterialEvidence { sourceKey: string; evidenceLocator: string }
export interface PhotoExamLocation extends PhotoMaterialEvidence {
  unitKey: string; unitName: string; address: string; sourceYear: null; batchCode: null;
}
export interface PhotoScoreColumn extends PhotoMaterialEvidence {
  key: 'batch_1' | 'batch_2' | 'batch_3_sc' | 'supply_service';
  title: string; batchCode: string | null; segment: 'main' | 'sc' | 'supply_service';
  status: 'recorded' | 'slash' | 'empty' | 'not_threshold'; originalText: string;
  entries: { label: string; score: number; qualifier: string | null }[];
}
export interface PhotoRequirementItem extends PhotoMaterialEvidence {
  key: string; label: string; text: string; kind: 'material' | 'english' | 'computer';
  strength: 'required' | 'preferred' | 'reference';
}
export interface PhotoRequirementGroup {
  unitKey: string; unitName: string; items: PhotoRequirementItem[];
}
export interface PhotoProvinceSupplement {
  schemaVersion: 'grid-photo-supplement-1'; cohortYear: 2026; status: 'historical_reference';
  examLocations: PhotoExamLocation[];
  scoreGroups: { unitKey: string; unitName: string; columns: PhotoScoreColumn[] }[];
  requirementGroups: PhotoRequirementGroup[]; sources: PhotoMaterialSource[];
}
export interface PhotoUnitRequirements {
  schemaVersion: 'grid-photo-supplement-1'; cohortYear: 2026;
  groups: PhotoRequirementGroup[]; sources: PhotoMaterialSource[];
}
export interface PhotoCardScore {
  unitKey: string; unitName: string; adcode: string; sourceYear: 2026; batchCode: 'batch_1';
  label: string; score: number; qualifier: string | null; sourceKey: string;
}
