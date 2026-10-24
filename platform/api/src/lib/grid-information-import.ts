import { normalizedDataset } from './grid-query-import.js';
import { GRID_INFORMATION_HTML_SHA256, GRID_INFORMATION_HTML_SOURCE_KEY, GRID_INFORMATION_SUPPLEMENT_KEY, summaryMetricSchema } from './grid-information.js';

/** A separate, additive reviewed-reference dataset, never a roster or seed replay. */
export function normalizedGridInformationSupplement(input: unknown) {
  const dataset=normalizedDataset(input);
  if(dataset.datasetKey !== GRID_INFORMATION_SUPPLEMENT_KEY || dataset.schoolOutcomes.length !== 0 || dataset.sources.length !== 1 || dataset.policyFacts.length !== 7) throw new Error('GRID_INFORMATION_SUPPLEMENT_SCOPE');
  const source=dataset.sources[0]!;
  if(source.sourceKey !== GRID_INFORMATION_HTML_SOURCE_KEY || source.sha256 !== GRID_INFORMATION_HTML_SHA256 || source.sourceType !== 'user_material') throw new Error('GRID_INFORMATION_SUPPLEMENT_SOURCE');
  const seen=new Set<string>();
  for(const fact of dataset.policyFacts){
    const metric=summaryMetricSchema.parse(JSON.parse(fact.text));
    if(!fact.title.startsWith('移动汇总指标：') || fact.category !== (metric.metricType === 'plan_count' ? 'headcount' : 'application')) throw new Error('GRID_INFORMATION_SUPPLEMENT_METRIC_TYPE');
    if(fact.scope !== 'national' || fact.province !== null || fact.city !== null || fact.company !== null || fact.grid !== 'sgcc' || fact.cohortYear !== 2026 || metric.sourceYear !== 2026 || fact.relatedOfficialSourceKey !== null) throw new Error('GRID_INFORMATION_SUPPLEMENT_FACT_SCOPE');
    const expected = metric.metricType === 'plan_count' ? ({yp:'batch_1',ep:'batch_2',nd:'batch_3',sc:'batch_3'} as Record<string,string>)[metric.segment] : metric.segment === 'all' && ['batch_1','batch_2','batch_3'].includes(fact.batchCode) ? fact.batchCode : undefined;
    if(!expected || expected !== fact.batchCode) throw new Error('GRID_INFORMATION_SUPPLEMENT_SEGMENT');
    const identity=`${metric.metricType}:${fact.batchCode}:${metric.segment}`;
    if(seen.has(identity)) throw new Error('GRID_INFORMATION_SUPPLEMENT_DUPLICATE');
    seen.add(identity);
    const conflict=metric.metricType === 'application_entries_reference' && fact.batchCode !== 'batch_2';
    if(conflict ? (fact.dataStatus !== 'conflict' || metric.value !== null || !fact.issueReason) : (fact.dataStatus !== 'reference' || metric.value === null)) throw new Error('GRID_INFORMATION_SUPPLEMENT_EVIDENCE_STATUS');
  }
  return dataset;
}
