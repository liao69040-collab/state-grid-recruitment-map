import { z } from 'zod';
import { buildGridInformationOverview, type GridInformationInput, type InformationMetric } from './grid-information.js';
import { GRID_MAP_BATCHES, queryGridMapCompany, queryGridMapOverview, queryGridMapSchool, type GridMapQuery } from './grid-map.js';
import type { GridMapCatalog } from './grid-map-catalog.js';
import { gridFactVisibleToMember, gridRankingQuerySchema, gridReleasedCells, queryGridRankings, type GridOutcome, type GridSnapshot } from './grid-query.js';
import { containsPrivateSourceReference, privateSourceIndex } from './private-source-boundary.js';

export const EXACT_AGGREGATE_BASIS='complete_anonymous_aggregates' as const;
// School location and the hiring company's destination province are separate
// dimensions. The legacy/suppressed ranking contract must not silently accept
// this filter without a geography catalog.
export const gridAggregateRankingQuerySchema=gridRankingQuerySchema.extend({
  schoolProvinceAdcode:z.string().regex(/^\d{6}$/).optional(),
});
export type GridAggregateRankingQuery=z.infer<typeof gridAggregateRankingQuerySchema>;
const normalize=(s:string|null|undefined)=>(s??'').replace(/(?:壮族自治区|回族自治区|维吾尔自治区|自治区|省|市)$/,'');
const sum=(rows:GridOutcome[])=>rows.reduce((n,r)=>n+r.recordCount,0);
const unique=(items:string[])=>[...new Set(items)].sort();
const privacy={audience:'authenticated_user' as const,minimumCellCount:null,suppressionApplied:false,countBasis:EXACT_AGGREGATE_BASIS,personalRecordsIncluded:false,
  basis:'完整已入库匿名汇总；不含姓名、电话、个人行、行号。公开接口不使用此契约。'};
const cache=new WeakMap<GridSnapshot,{catalogs:GridMapCatalog[];sourceSignature:string;snapshot:GridSnapshot;safeCatalogs:GridMapCatalog[]}>();

/** Exact counts do not grant admin access to quarantined/private policy material. */
function authorizedInput(input:GridInformationInput) {
  const index=privateSourceIndex(input.sources??[]),sourceSignature=[...index.ids,...index.keys].sort().join('|');
  const prior=cache.get(input.snapshot);
  if(prior?.catalogs===input.catalogs&&prior.sourceSignature===sourceSignature)return {...input,snapshot:prior.snapshot,catalogs:prior.safeCatalogs};
  const snapshot:GridSnapshot={versions:input.snapshot.versions,datasets:input.snapshot.datasets.map(d=>({...d,
    sources:d.sources.filter(s=>!containsPrivateSourceReference(s,index)),
    schoolOutcomes:d.schoolOutcomes.filter(r=>!containsPrivateSourceReference(r,index)),
    policyFacts:d.policyFacts.filter(f=>gridFactVisibleToMember(d,f)&&!containsPrivateSourceReference(f,index)),
  }))};
  const safeCatalogs=input.catalogs.map(c=>({...c,companyCandidates:c.companyCandidates?{...c.companyCandidates,candidates:c.companyCandidates.candidates.flatMap(candidate=>{
    const references=candidate.references.filter(ref=>ref.dataStatus==='reference'&&!containsPrivateSourceReference(ref,index));
    return references.length?[{...candidate,references}]:[];
  })}:null}));
  cache.set(input.snapshot,{catalogs:input.catalogs,sourceSignature,snapshot,safeCatalogs});
  return {...input,snapshot,catalogs:safeCatalogs};
}
function metrics(rows:GridOutcome[]) {
  const batchCodes=unique([...GRID_MAP_BATCHES,...rows.map(r=>r.batchCode)]);
  return {recordCount:sum(rows),batchCounts:Object.fromEntries(batchCodes.map(batch=>[batch,sum(rows.filter(r=>r.batchCode===batch))])),
    gridCounts:{sgcc:sum(rows.filter(r=>r.grid==='sgcc')),csg:sum(rows.filter(r=>r.grid==='csg')),other:sum(rows.filter(r=>!['sgcc','csg'].includes(r.grid)))} };
}
function selectedRows(input:GridInformationInput,q:GridMapQuery,allBatches=false) {
  return gridReleasedCells(input.snapshot,true).filter(r=>r.cohortYear===q.cohortYear&&(!q.grid||r.grid===q.grid)&&(allBatches||!q.batchCode||q.batchCode==='all'||r.batchCode===q.batchCode));
}
function regionMap(input:GridInformationInput) {return new Map(input.catalogs.flatMap(c=>c.provinces).map(p=>[normalize(p.name),p]));}
function destinations(input:GridInformationInput,rows:GridOutcome[]) {
  const regions=regionMap(input),groups=new Map<string,GridOutcome[]>();
  for(const row of rows){const region=regions.get(normalize(row.province)),key=region?.adcode??`unassigned:${row.province??''}`;const group=groups.get(key)??[];group.push(row);groups.set(key,group);}
  return [...groups.values()].map(group=>{const region=regions.get(normalize(group[0]!.province));return {provinceAdcode:region?.adcode??null,provinceName:region?.name??group[0]!.province,
    destinationStatus:region?'assigned' as const:'unassigned' as const,...metrics(group)};}).sort((a,b)=>b.recordCount-a.recordCount||(a.provinceAdcode??'').localeCompare(b.provinceAdcode??''));
}
function summary(input:GridInformationInput,rows:GridOutcome[],q:GridMapQuery) {
  const regions=regionMap(input),province=[...regions.values()].find(p=>p.adcode===q.provinceAdcode),national=metrics(rows);
  const targetRows=province?rows.filter(r=>regions.get(normalize(r.province))?.adcode===province.adcode):[];
  const otherRows=province?rows.filter(r=>regions.get(normalize(r.province))?.adcode!==province.adcode):[];
  const targetProvince=province?{adcode:province.adcode,name:province.name,...metrics(targetRows)}:null,otherProvinces=province?metrics(otherRows):null;
  const distribution=destinations(input,rows);
  return {cohortYear:q.cohortYear,grid:q.grid??null,scope:'all_batches' as const,metricType:'public_notice_record_count' as const,measureUnit:'条公示记录',countBasis:EXACT_AGGREGATE_BASIS,
    national,targetProvince,otherProvinces,destinations:distribution,unassignedDestination:metrics(rows.filter(r=>!regions.has(normalize(r.province)))),
    equations:{targetPlusOtherEqualsNational:targetProvince&&otherProvinces?targetProvince.recordCount+otherProvinces.recordCount===national.recordCount:null,
      destinationSumEqualsNational:distribution.reduce((n,r)=>n+r.recordCount,0)===national.recordCount,batchSumEqualsNational:Object.values(national.batchCounts).reduce((n,v)=>n+v,0)===national.recordCount},
    note:'目的省来自入库招聘单位归属，未知目的省仍计入全国与其他省，不根据学校地址推断。批次表忽略单批筛选，始终展示该届所选电网的全部批次。'};
}
function taggedMetric(m:InformationMetric,exact=false){return {...m,countBasis:exact?EXACT_AGGREGATE_BASIS:m.status==='reference'?'source_reference':m.status==='available'?'published_metric':'not_available'};}
function unavailable(m:InformationMetric):InformationMetric {return {...m,value:null,displayValue:'待核',status:'missing',sourceKeys:[],evidenceLocators:[],note:'当前目标省缺少同年、同批次、同主体范围的可用指标；不搬用全国参考数。'};}
function usable(m:InformationMetric){return m.value!==null||m.status==='reference'&&m.displayValue!=='待核';}
export function queryExactInformation(input:GridInformationInput,year:number) {
  // The information builder separately checks source visibility for reviewed
  // metrics. Keep those structured facts available to its dedicated projection.
  const result=buildGridInformationOverview(input,year,true);
  const cards=result.cards.filter(c=>[c.plan,c.publicNotice,c.applications,c.competition].some(usable)).map(c=>({...c,
    plan:taggedMetric(c.plan),publicNotice:taggedMetric(c.publicNotice,true),applications:taggedMetric(c.applications),competition:taggedMetric(c.competition)}));
  return {...result,schemaVersion:'grid-aggregates-1' as const,cards,privacy,countBasis:EXACT_AGGREGATE_BASIS};
}
export function queryExactGridOverview(input:GridInformationInput,q:GridMapQuery) {
  const safe=authorizedInput(input),base=queryGridMapOverview(safe.snapshot,safe.catalogs,q,false,false,true),all=selectedRows(safe,q,true),regions=regionMap(safe);
  const province=[...regions.values()].find(p=>p.adcode===q.provinceAdcode);
  const exactCards=queryExactInformation(input,q.cohortYear).cards.filter(c=>(!q.grid||c.grid===q.grid)&&(!q.batchCode||q.batchCode==='all'||c.batchCode===q.batchCode)).flatMap(c=>{
    if(!province)return [c];
    const rows=all.filter(r=>r.grid===c.grid&&r.batchCode===c.batchCode&&regions.get(normalize(r.province))?.adcode===province.adcode);
    if(!rows.length)return [];
    return [{...c,scopeLabel:`${province.name}招聘目的省 · 完整入库匿名记录`,plan:taggedMetric(unavailable(c.plan)),applications:taggedMetric(unavailable(c.applications)),competition:taggedMetric(unavailable(c.competition)),
      publicNotice:{...c.publicNotice,value:sum(rows),displayValue:sum(rows).toLocaleString('zh-CN'),scopeLabel:`${province.name}招聘目的省 · 完整入库匿名记录`,sourceKeys:unique(rows.map(r=>r.sourceKey))}}];
  });
  const current=selectedRows(safe,q),yearAvailable=gridReleasedCells(safe.snapshot,true).some(r=>r.cohortYear===q.cohortYear&&(!q.grid||r.grid===q.grid));
  const nationalSummary={cohortYear:q.cohortYear,grid:q.grid??null,batchCode:q.batchCode??null,recordCount:yearAvailable?sum(current):null,
    schoolCount:new Set(current.map(r=>r.parentSchoolKey)).size,campusCount:new Set(current.map(r=>r.campusKey)).size,companyCount:new Set(current.map(r=>r.companyKey)).size,
    unassignedDestinationRecordCount:yearAvailable?sum(current.filter(r=>!regions.has(normalize(r.province)))):null,
    metricType:'public_notice_record_count' as const,measureUnit:'条公示记录',scopeLabel:'全国完整入库匿名记录（包含未归属目的省）',countBasis:EXACT_AGGREGATE_BASIS,
    dataStatus:yearAvailable?'available' as const:'not_loaded' as const,sourceKeys:unique(current.map(r=>r.sourceKey))};
  return {...base,schemaVersion:'grid-aggregates-1' as const,privacy,countBasis:EXACT_AGGREGATE_BASIS,exactCards,nationalSummary,recruitmentSummary:yearAvailable?summary(safe,all,q):null};
}
export function queryExactGridSchool(input:GridInformationInput,campusKey:string,q:GridMapQuery) {
  const safe=authorizedInput(input),base=queryGridMapSchool(safe.snapshot,safe.catalogs,campusKey,q,false,true);
  if(!base||!gridReleasedCells(safe.snapshot,true).some(r=>r.cohortYear===q.cohortYear&&(!q.grid||r.grid===q.grid)))return null;
  const rows=selectedRows(safe,q,true).filter(r=>r.campusKey===campusKey);
  return {...base,schemaVersion:'grid-aggregates-1' as const,privacy,countBasis:EXACT_AGGREGATE_BASIS,recruitmentSummary:summary(safe,rows,q),
    schoolProfile:{schoolName:base.school.schoolName,campusName:base.school.campusName,schoolCode:base.school.schoolCode,educationLevel:base.school.educationLevel,ownership:base.school.ownership,
      is985:base.school.is985,is211:base.school.is211,isDoubleFirst:base.school.isDoubleFirst,industryTags:base.school.industryTags,introduction:base.school.introduction,
      locationStatus:base.geography?.locationStatus??'pending',precision:base.school.locationPrecision,coordinateSystem:base.school.coordinateSystem,sourceUrls:base.school.sourceUrls}};
}
export function queryExactGridCompany(input:GridInformationInput,companyKey:string,q:GridMapQuery) {
  const safe=authorizedInput(input),base=queryGridMapCompany(safe.snapshot,safe.catalogs,companyKey,q,false,true);
  return base?{...base,schemaVersion:'grid-aggregates-1' as const,privacy,countBasis:EXACT_AGGREGATE_BASIS}:null;
}
const schoolProvinceSnapshots=new WeakMap<GridSnapshot,{catalogs:GridMapCatalog[];byProvince:Map<string,GridSnapshot>}>();
function schoolProvinceSnapshot(input:GridInformationInput,adcode:string):GridSnapshot {
  let cached=schoolProvinceSnapshots.get(input.snapshot);
  if(!cached||cached.catalogs!==input.catalogs){cached={catalogs:input.catalogs,byProvince:new Map()};schoolProvinceSnapshots.set(input.snapshot,cached);}
  const prior=cached.byProvince.get(adcode);if(prior)return prior;
  // Use canonical campus geography, never the parent university or recruiting
  // destination. Explicitly unknown or conflicting campus locations stay out.
  const provincesByCampus=new Map<string,Set<string|null>>();
  for(const catalog of input.catalogs)for(const row of catalog.schoolGeography){
    const provinces=provincesByCampus.get(row.campusKey)??new Set<string|null>();
    provinces.add(row.provinceAdcode);provincesByCampus.set(row.campusKey,provinces);
  }
  const campuses=new Set([...provincesByCampus].filter(([,provinces])=>provinces.size===1&&provinces.has(adcode)).map(([key])=>key));
  const snapshot:GridSnapshot={versions:input.snapshot.versions,datasets:input.snapshot.datasets.map(dataset=>({...dataset,
    schoolOutcomes:dataset.schoolOutcomes.filter(row=>campuses.has(row.campusKey)),
  }))};
  cached.byProvince.set(adcode,snapshot);return snapshot;
}
export function queryExactGridRankings(input:GridInformationInput,q:GridAggregateRankingQuery) {
  const safe=authorizedInput(input);
  const snapshot=q.schoolProvinceAdcode?schoolProvinceSnapshot(safe,q.schoolProvinceAdcode):safe.snapshot;
  return {...queryGridRankings(snapshot,q,false,true),schemaVersion:'grid-aggregates-1' as const,privacy,countBasis:EXACT_AGGREGATE_BASIS,
    scope:{schoolProvinceAdcode:q.schoolProvinceAdcode??null,destinationProvince:q.province??null}};
}
