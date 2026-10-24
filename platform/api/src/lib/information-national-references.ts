import { createHash } from 'node:crypto';
import { GRID_INFORMATION_HTML_SHA256, GRID_INFORMATION_HTML_SOURCE_KEY, GRID_INFORMATION_SUPPLEMENT_KEY, summaryMetricSchema, type GridInformationInput, type InformationFact } from './grid-information.js';
import { containsPrivateSourceReference, privateSourceIndex } from './private-source-boundary.js';

export type ReferenceCount = {
  value: number | null; status: 'reference' | 'conflict' | 'missing'; measureUnit: string;
  scopeLabel: string; sourceKeys: string[]; evidenceLocators: string[]; note: string;
  observations: {kind:'source_overview'|'province_sum'|'unit_sum';value:number;scopeLabel:string;sourceKeys:string[];evidenceLocators:string[]}[];
};
type ReferenceSegment = 'yp' | 'ep' | 'nd' | 'sc';
export type NationalApplicationReference = {
  key: string; cohortYear: number; grid: 'sgcc'; batchCode: string; title: string;
  applications: ReferenceCount;
  planReferences: (ReferenceCount & {segment:ReferenceSegment})[];
  materialAdmissionReferences: (ReferenceCount & {segment:ReferenceSegment})[];
  reportedRatioText: string | null; reportedRatioNote: string;
  reportedRatioSourceKeys: string[]; reportedRatioEvidenceLocators: string[];
  ratios: {kind:'applications_to_plan'|'applications_to_material_admissions';value:number|null;status:'missing';comparable:false;
    reasonCode:'scope_not_verified'|'missing_denominator'|'conflicting_numerator';note:string}[];
};
// Public edition has no customer-source approval pins. Deployment owners can
// add their own reviewed pins after obtaining rights to their source dataset.
const pins: Readonly<Record<string, string>> = {};
const emptyCount = (note:string):ReferenceCount => ({value:null,status:'missing',measureUnit:'报名人次',scopeLabel:'全国资料参考（主体与覆盖范围待核）',sourceKeys:[],evidenceLocators:[],note,observations:[]});

/** Derived reading contract; no import, recomputation of isolated rows, roster
 * denominator, privacy lower bound or qualification decision is introduced. */
export function buildNationalApplicationReferences(input: GridInformationInput, year: number, authorizedFacts: InformationFact[]): NationalApplicationReference[] {
  if (year !== 2026) return [];
  const restricted = privateSourceIndex(input.sources ?? []);
  if (containsPrivateSourceReference({sourceKey:GRID_INFORMATION_HTML_SOURCE_KEY},restricted)) return [];
  const datasets = input.snapshot.datasets.filter(d => d.datasetKey === GRID_INFORMATION_SUPPLEMENT_KEY && d.version === '2026.09.22.1'
    && d.sources.length === 1 && d.sources[0]!.sourceKey === GRID_INFORMATION_HTML_SOURCE_KEY
    && d.sources[0]!.sha256 === GRID_INFORMATION_HTML_SHA256 && !containsPrivateSourceReference(d.sources[0],restricted));
  const read = (key:keyof typeof pins, batchCode:string, metricType:'plan_count'|'application_entries_reference', segment:string) => {
    const rows = datasets.flatMap(d => d.policyFacts).filter(f => f.factKey === key);
    if (rows.length !== 1) return null;
    const f = rows[0]!;
    const conflict = metricType === 'application_entries_reference' && batchCode !== 'batch_2';
    if (f.sourceKey !== GRID_INFORMATION_HTML_SOURCE_KEY || f.cohortYear !== year || f.grid !== 'sgcc' || f.batchCode !== batchCode
      || f.scope !== 'national' || f.province !== null || f.company !== null || f.city !== null || f.relatedOfficialSourceKey !== null
      || f.dataStatus !== (conflict ? 'conflict' : 'reference') || (conflict && !f.issueReason)
      || f.category !== (metricType === 'plan_count' ? 'headcount' : 'application')
      || f.title !== (metricType === 'plan_count' ? '移动汇总指标：计划人数' : '移动汇总指标：报名人次')
      || createHash('sha256').update(JSON.stringify([f.text,f.evidenceLocator,f.issueReason])).digest('hex') !== pins[key] || containsPrivateSourceReference(f,restricted)) return null;
    let raw:unknown; try {raw=JSON.parse(f.text);} catch {return null;}
    const parsed = summaryMetricSchema.safeParse(raw);
    if (!parsed.success || parsed.data.sourceYear !== year || parsed.data.metricType !== metricType || parsed.data.segment !== segment
      || (conflict ? parsed.data.value !== null : parsed.data.value === null)) return null;
    return {fact:f,metric:parsed.data};
  };
  const count = (row:NonNullable<ReturnType<typeof read>>):ReferenceCount => ({value:row.metric.value,
    status:row.fact.dataStatus === 'conflict' ? 'conflict' : 'reference',measureUnit:row.metric.measureUnit,
    scopeLabel:row.metric.scopeLabel,sourceKeys:[row.fact.sourceKey],evidenceLocators:[row.fact.evidenceLocator],note:row.metric.note,observations:[]});
  return (['batch_1','batch_2','batch_3'] as const).map((batchCode,index) => {
    const row = read(`mobile.reference.html-national-applications-batch-${index+1}` as keyof typeof pins,batchCode,'application_entries_reference','all');
    const applications = row ? count(row) : emptyCount('未发现原身份、正文摘要及状态均匹配的已审报名资料；不读取隔离事实补数。');
    // Do not bake private source-overview counts into public source code.
    // Source observations must come from an independently authorized dataset.
    const segments:ReferenceSegment[] = batchCode === 'batch_1' ? ['yp'] : batchCode === 'batch_2' ? ['ep'] : ['nd','sc'];
    const planReferences = segments.flatMap(segment => {
      const plan = read(`mobile.reference.html-national-plan-${segment}`,batchCode,'plan_count',segment);
      return plan ? [{...count(plan),segment}] : [];
    });
    const reported = authorizedFacts.filter(f => f.dataStatus === 'reference' && f.cohortYear === year && f.grid === 'sgcc'
      && f.batchCode === batchCode && f.scope === 'national' && f.province === null && f.city === null && f.company === null
      && f.title === '报录比' && !containsPrivateSourceReference(f,restricted))
      .flatMap(f => {const match=f.text.trim().match(/^(?:报录比[：:]\s*)?(\d+(?:\.\d+)?\s*[:：]\s*1)\s*$/);return match ? [{text:match[1]!,fact:f}] : [];});
    const reportedRatioText = reported.length === 1 ? reported[0]!.text : null;
    return {key:`sgcc-${batchCode}-applications-reference`,cohortYear:year,grid:'sgcc' as const,batchCode,title:`国网第${['一','二','三'][index]}批报名参考`,
      applications,planReferences,materialAdmissionReferences:[],reportedRatioText,
      reportedRatioSourceKeys:reportedRatioText ? [reported[0]!.fact.sourceKey] : [],
      reportedRatioEvidenceLocators:reportedRatioText ? [reported[0]!.fact.evidenceLocator] : [],
      reportedRatioNote:reportedRatioText ? '原资料自报比值；主体范围与计量口径未核，不作为计算结果或正式录取率。' : '现有已审安全全国条目未提供可展示的原资料自报比值。',
      ratios:([
        {kind:'applications_to_plan',reasonCode:applications.status === 'conflict' ? 'conflicting_numerator' : 'scope_not_verified',
          note:'报名人次是否包含供服等范围未核；计划分项范围不同，不计算报名人次/计划名额。'},
        {kind:'applications_to_material_admissions',reasonCode:'missing_denominator',
          note:'缺少同届同批同招聘主体范围的已审资料录用指标；不从隔离混合事实、公示名册或可展示下限取分母。'},
      ] as const).map(ratio => ({...ratio,value:null,status:'missing' as const,comparable:false as const}))};
  });
}
