import { describe, expect, it } from 'vitest';
import { normalizedGridInformationSupplement } from '../src/lib/grid-information-import.js';
import { GRID_INFORMATION_HTML_SHA256, GRID_INFORMATION_HTML_SOURCE_KEY, GRID_INFORMATION_SUPPLEMENT_KEY } from '../src/lib/grid-information.js';

function supplement() {
  const specs=[['plan_count','batch_1','yp',100],['plan_count','batch_2','ep',50],['plan_count','batch_3','nd',20],['plan_count','batch_3','sc',10],['application_entries_reference','batch_1','all',null],['application_entries_reference','batch_2','all',1234],['application_entries_reference','batch_3','all',null]] as const;
  return {schemaVersion:'grid-query-1',datasetKey:GRID_INFORMATION_SUPPLEMENT_KEY,version:'test-v1',title:'审计参考包',createdAt:'2026-09-22T00:00:00Z',notes:[],schoolOutcomes:[],sources:[{sourceKey:GRID_INFORMATION_HTML_SOURCE_KEY,title:'历史.html',sourceType:'user_material',sha256:GRID_INFORMATION_HTML_SHA256,sourceUrl:null,note:'参考'}],
    policyFacts:specs.map(([metricType,batchCode,segment,value],i)=>({factKey:`reference.${i}`,sourceKey:GRID_INFORMATION_HTML_SOURCE_KEY,cohortYear:2026,grid:'sgcc',batchCode,scope:'national',province:null,city:null,company:null,category:metricType==='plan_count'?'headcount':'application',title:'移动汇总指标：参考',text:JSON.stringify({schema:'grid-information-metric-1',metricType,value,measureUnit:metricType==='plan_count'?'人':'人次',scopeLabel:'原材料明确范围',sourceYear:2026,note:'历史用户参考；不与名册混用。',segment}),educationLevel:null,schoolTier:null,evidenceLocator:`HTML/section/${i}`,dataStatus:value===null?'conflict':'reference',issueReason:value===null?'来源总量不一致':null,relatedOfficialSourceKey:null})),
  };
}
describe('reviewed information additive import contract',()=>{
  it('accepts seven explicitly scoped metrics and no roster data',()=>{
    const result=normalizedGridInformationSupplement(supplement());expect(result.policyFacts).toHaveLength(7);expect(result.schoolOutcomes).toEqual([]);expect(result.sources).toHaveLength(1);
  });
  it('rejects unrelated dataset, source checksum, year, segment and unsafe conflict promotion',()=>{
    const wrongDataset=supplement();wrongDataset.datasetKey='old-roster';expect(()=>normalizedGridInformationSupplement(wrongDataset)).toThrow('SCOPE');
    const wrongSource=supplement();wrongSource.sources[0]!.sha256='a'.repeat(64);expect(()=>normalizedGridInformationSupplement(wrongSource)).toThrow('SOURCE');
    const wrongYear=supplement();wrongYear.policyFacts[0]!.cohortYear=2027;expect(()=>normalizedGridInformationSupplement(wrongYear)).toThrow('FACT_SCOPE');
    const wrongSegment=supplement();const payload=JSON.parse(wrongSegment.policyFacts[0]!.text);payload.segment='nd';wrongSegment.policyFacts[0]!.text=JSON.stringify(payload);expect(()=>normalizedGridInformationSupplement(wrongSegment)).toThrow('SEGMENT');
    const falseResolution=supplement();falseResolution.policyFacts[4]!.dataStatus='reference';expect(()=>normalizedGridInformationSupplement(falseResolution)).toThrow('EVIDENCE_STATUS');
  });
  it('rejects numeric strings, extra unapproved fields and hidden roster identities',()=>{
    const input=supplement(),payload=JSON.parse(input.policyFacts[0]!.text);payload.value='100';input.policyFacts[0]!.text=JSON.stringify(payload);expect(()=>normalizedGridInformationSupplement(input)).toThrow();
    const extra=supplement(),p=JSON.parse(extra.policyFacts[0]!.text);p.ratio=28;extra.policyFacts[0]!.text=JSON.stringify(p);expect(()=>normalizedGridInformationSupplement(extra)).toThrow();
    expect(()=>normalizedGridInformationSupplement({...supplement(),rawRoster:[]})).toThrow();
  });
});
