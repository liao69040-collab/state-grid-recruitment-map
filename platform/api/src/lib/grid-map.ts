import { createHash } from 'node:crypto';
import { z } from 'zod';
import { gridBatchSchema, gridKindSchema, gridReleasedCells, type GridFact, type GridOutcome, type GridSnapshot } from './grid-query.js';
import type { GridMapCatalog, MapSchoolAlias, MapSchoolGeography, MapRegion, MapCompanyCandidate } from './grid-map-catalog.js';
import { recruitmentDisplayText, recruitmentFactForDisplay } from './recruitment-display-text.js';

/** A batch belongs to exactly one operator; the two never co-occur. */
export const GRID_MAP_BATCH_OWNER:Record<string,'sgcc'|'csg'>={batch_1:'sgcc',batch_2:'sgcc',batch_3:'sgcc',csg_spring:'csg',csg_autumn:'csg'};
export const gridMapQuerySchema=z.object({provinceAdcode:z.string().regex(/^\d{6}$/).optional(),cohortYear:z.coerce.number().int().min(2000).max(2100).default(2026),grid:gridKindSchema.optional(),batchCode:gridBatchSchema.optional()}).strict()
  // Asking for a State Grid batch inside Southern Grid (or the reverse) used to
  // answer 200 with an all-null map while still claiming the roster year exists,
  // so the caller could not tell "no such combination" from "no data".
  .refine(q=>!q.grid||!q.batchCode||GRID_MAP_BATCH_OWNER[q.batchCode]===q.grid,
    {message:'batchCode 不属于所选 grid',path:['batchCode']});
export type GridMapQuery=z.infer<typeof gridMapQuerySchema>;
export const GRID_MAP_BATCHES=['batch_1','batch_2','batch_3','csg_spring','csg_autumn'] as const;
const normalize=(value:string|null|undefined)=>(value??'').replace(/(?:壮族自治区|回族自治区|维吾尔自治区|自治区|省|市)$/,'');
const unique=(values:(string|null|undefined)[])=>[...new Set(values.filter((v):v is string=>Boolean(v)))].sort((a,b)=>a.localeCompare(b,'zh-CN'));
const sum=(rows:GridOutcome[])=>rows.length?rows.reduce((total,row)=>total+row.recordCount,0):null;
const countBasis=(admin:boolean,exact=false)=>exact?'complete_anonymous_aggregates' as const:admin?'all_aggregate_cells' as const:'released_cells_only' as const;
const batchCounts=(rows:GridOutcome[])=>Object.fromEntries(GRID_MAP_BATCHES.map(batch=>[batch,sum(rows.filter(row=>row.batchCode===batch))]));
// The public projection sums complete cells, so a province/batch figure is no
// longer a lower bound. It still never publishes a group smaller than the
// minimum cell size: an aggregate under it stays hidden rather than exposing
// a handful of people who happen to be the only ones in that slice.
const MINIMUM_PUBLIC_GROUP=5;
const PUBLIC_TOP_SCHOOLS=5;
const publicFloor=(value:number|null)=>value===null||value>=MINIMUM_PUBLIC_GROUP?value:null;
// Flooring each cell on its own still leaks it: the province total is published
// complete, so `total - sum(published cells)` returns a lone hidden cell exactly.
// Suppress the whole group once any cell falls under the floor, so the residual
// spans an unknown split instead of naming one cell. Today no province trips
// this, so the published breakdown is unchanged; it only engages on small cells.
const flooredGroup=(raw:Array<[string,number|null]>)=>{
  const breaches=raw.some(([,value])=>value!==null&&value>0&&value<MINIMUM_PUBLIC_GROUP);
  return Object.fromEntries(raw.map(([key,value])=>[key,breaches?null:publicFloor(value)]));
};
const flooredBatchCounts=(rows:GridOutcome[])=>flooredGroup(GRID_MAP_BATCHES.map(batch=>[batch,sum(rows.filter(row=>row.batchCode===batch))]));
const gridCounts=(rows:GridOutcome[])=>({sgcc:sum(rows.filter(row=>row.grid==='sgcc')),csg:sum(rows.filter(row=>row.grid==='csg'))});
const coordinates=(row:{longitude:number|null;latitude:number|null}|undefined):[number,number]|null=>row&&row.longitude!==null&&row.latitude!==null?[row.longitude,row.latitude]:null;
const disclaimer='公示记录汇总来自用户提供资料，未逐条官网复核，不等于自然人数或实际入职人数；学校位置与招聘单位去向分别展示。名单未提供录用城市，不能按校址推断工作地点。';
const privacy=(admin:boolean,exact=false,publicOnly=false)=>({
  // The public projection sums complete cells but still refuses to publish an
  // aggregate below the minimum group size, so it reports both.
  minimumCellCount:publicOnly?MINIMUM_PUBLIC_GROUP:exact?null:5,
  suppressionApplied:publicOnly?true:!admin&&!exact,
  countBasis:countBasis(admin,exact),personalRecordsIncluded:false,
  basis:publicOnly?'公开省级与批次汇总为完整匿名统计；人数类汇总不足5人时整批隐藏为空值（同组其他格子一并隐藏，避免用总数相减还原），学校/单位/资料条目的个数不属于人数口径、按实际值公布；学校级明细需登录后查看。':exact?'仅认证用户：完整已入库匿名汇总，不包含姓名、电话、个人行或原始行号。':admin?'管理员完整脱敏汇总；不包含名单姓名、电话或原始行号':'固定最细统计单元不足5条的记录先隐藏，再汇总；可展示记录数是下限，空值表示无可展示数据，不能与全量差减推断个人。'});

type FactWithSource=GridFact&{source:GridSnapshot['datasets'][number]['sources'][number];datasetKey:string;version:string};
type CompanyIdentity={companyKey:string;company:string;grid:string;orgCategory:string;province:string|null;companyGroup:string|null;candidate?:MapCompanyCandidate};
type Index={all:GridOutcome[];released:GridOutcome[];allByCampus:Map<string,GridOutcome[]>;releasedByCampus:Map<string,GridOutcome[]>;allByCompany:Map<string,GridOutcome[]>;releasedByCompany:Map<string,GridOutcome[]>;aliases:Map<string,MapSchoolAlias[]>;geo:Map<string,MapSchoolGeography>;provinces:Map<string,MapRegion>;cities:Map<string,MapRegion>;provinceNames:Map<string,MapRegion>;cityNames:Map<string,MapRegion>;companies:Map<string,CompanyIdentity>;facts:FactWithSource[];companyFactRows:Map<string,FactWithSource[]>;catalogs:GridMapCatalog[]};
function groupCells(rows:GridOutcome[],field:'campusKey'|'companyKey'){
  const result=new Map<string,GridOutcome[]>();for(const row of rows){const group=result.get(row[field])??[];group.push(row);result.set(row[field],group);}return result;
}
const cached=new WeakMap<GridSnapshot,{catalogs:GridMapCatalog[];index:Index}>();
function indexFor(snapshot:GridSnapshot,catalogs:GridMapCatalog[]):Index {
  const prior=cached.get(snapshot);if(prior?.catalogs===catalogs)return prior.index;
  const all=gridReleasedCells(snapshot,true),released=gridReleasedCells(snapshot),aliases=new Map<string,MapSchoolAlias[]>(),geo=new Map<string,MapSchoolGeography>(),provinces=new Map<string,MapRegion>(),cities=new Map<string,MapRegion>();
  for(const catalog of catalogs){
    for(const row of catalog.schoolAliases){const rows=aliases.get(row.campusKey)??[];rows.push(row);aliases.set(row.campusKey,rows);}
    for(const row of catalog.schoolGeography)geo.set(row.campusKey,row);
    for(const row of catalog.provinces)provinces.set(row.adcode,row);
    for(const row of catalog.cities)cities.set(row.adcode,row);
  }
  // Index the aliases once rather than rebuilding and rescanning the flattened
  // list for every company; first match in catalog order still wins.
  const unitByCompany=new Map<string,string|null>();
  for(const catalog of catalogs)for(const unit of catalog.unitAliases)for(const key of unit.companyKeys)if(!unitByCompany.has(key))unitByCompany.set(key,unit.company_group||null);
  const companies=new Map<string,CompanyIdentity>();
  for(const row of all)if(!companies.has(row.companyKey)){
    companies.set(row.companyKey,{companyKey:row.companyKey,company:row.company,grid:row.grid,orgCategory:row.orgCategory,province:row.province,companyGroup:unitByCompany.get(row.companyKey)??null});
  }
  const facts=snapshot.datasets.flatMap(dataset=>dataset.policyFacts.map(fact=>({...fact,source:dataset.sources.find(source=>source.sourceKey===fact.sourceKey)!,datasetKey:dataset.datasetKey,version:dataset.version})));
  const candidateByFact=new Map<string,MapCompanyCandidate>();
  for(const catalog of catalogs)for(const candidate of catalog.companyCandidates?.candidates??[]){
    companies.set(candidate.candidateKey,{companyKey:candidate.candidateKey,company:candidate.name,grid:candidate.grid,orgCategory:'other',province:candidate.province,companyGroup:candidate.companyRegion,candidate});
    for(const ref of candidate.references)candidateByFact.set(`${ref.sourceKey}:${ref.factKey}`,candidate);
  }
  const companyFactRows=new Map<string,FactWithSource[]>();
  for(const fact of facts){
    if(!fact.company)continue;
    const candidate=candidateByFact.get(`${fact.sourceKey}:${fact.factKey}`);
    if(candidate){const rows=companyFactRows.get(candidate.candidateKey)??[];rows.push(fact);companyFactRows.set(candidate.candidateKey,rows);continue;}
    const alias=catalogs.flatMap(c=>c.unitAliases).find(unit=>(unit.standardized_unit===fact.company||unit.unit===fact.company)&&(!fact.province||normalize(unit.province)===normalize(fact.province)));
    const existing=[...companies.values()].find(company=>!company.candidate&&(company.company===fact.company||alias?.companyKeys.includes(company.companyKey))&&(!fact.province||normalize(company.province)===normalize(fact.province)));
    const key=existing?.companyKey??`policy_company_${createHash('sha256').update(JSON.stringify([fact.grid,fact.province,fact.company])).digest('hex').slice(0,24)}`;
    if(!companies.has(key))companies.set(key,{companyKey:key,company:fact.company,grid:fact.grid,orgCategory:'other',province:fact.province,companyGroup:null});
    const rows=companyFactRows.get(key)??[];rows.push(fact);companyFactRows.set(key,rows);
  }
  const provinceNames=new Map([...provinces.values()].map(p=>[normalize(p.name),p])),cityNames=new Map([...cities.values()].map(c=>[`${c.provinceAdcode}:${normalize(c.name)}`,c]));
  const index={all,released,allByCampus:groupCells(all,'campusKey'),releasedByCampus:groupCells(released,'campusKey'),allByCompany:groupCells(all,'companyKey'),releasedByCompany:groupCells(released,'companyKey'),aliases,geo,provinces,cities,provinceNames,cityNames,companies,facts,companyFactRows,catalogs};cached.set(snapshot,{catalogs,index});return index;
}
function outcomeMatches(row:GridOutcome,q:GridMapQuery){return row.cohortYear===q.cohortYear&&(!q.grid||row.grid===q.grid)&&(!q.batchCode||q.batchCode==='all'||row.batchCode===q.batchCode);}
function factMatches(row:GridFact,q:GridMapQuery,admin:boolean){return (admin||row.dataStatus==='reference')&&(row.cohortYear===q.cohortYear||row.cohortYear===null)&&(!q.grid||row.grid===q.grid)&&(!q.batchCode||q.batchCode==='all'||row.batchCode===q.batchCode||row.batchCode==='all');}
function provinceFor(index:Index,name:string|null|undefined){return index.provinceNames.get(normalize(name));}
function selectedProvince(index:Index,q:GridMapQuery){return q.provinceAdcode?index.provinces.get(q.provinceAdcode):undefined;}
function inProvince(name:string|null,province:MapRegion|undefined){return province?normalize(name)===normalize(province.name):true;}
function selection(q:GridMapQuery){return {provinceAdcode:q.provinceAdcode??null,cohortYear:q.cohortYear,grid:q.grid??null,batchCode:q.batchCode??null};}
function sourceList(snapshot:GridSnapshot,rows:GridOutcome[],facts:FactWithSource[]=[]){
  const keys=new Set([...rows.map(row=>row.sourceKey),...facts.map(fact=>fact.sourceKey)]);
  const sources=snapshot.datasets.flatMap(dataset=>dataset.sources.filter(source=>keys.has(source.sourceKey)));
  return [...new Map(sources.map(source=>[`${source.sourceKey}:${source.sha256}`,source])).values()];
}
function singleValue(values:(string|null|undefined)[]):string|null {const valuesUnique=unique(values);return valuesUnique.length===1?valuesUnique[0]!:null;}

function schoolSummary(index:Index,campusKey:string,q:GridMapQuery,admin:boolean,mode:'national'|'destination'='national',companyKey?:string,exact=false){
  const campusRows=index.allByCampus.get(campusKey)??[];
  const all=campusRows.filter(row=>outcomeMatches(row,q));
  const identity=campusRows[0];
  if(!identity)return null;
  const aliases=index.aliases.get(campusKey)??[],alias=aliases[0],geo=index.geo.get(campusKey),province=selectedProvince(index,q);
  const national=(admin||exact?campusRows:index.releasedByCampus.get(campusKey)??[]).filter(row=>outcomeMatches(row,q));
  const destination=national.filter(row=>inProvince(row.province,province));
  const rows=companyKey?national.filter(row=>row.companyKey===companyKey):mode==='destination'?destination:national;
  const flags=(field:'is985'|'is211'|'isDoubleFirst')=>aliases.some(row=>row[field]===true)?true:aliases.length&&aliases.every(row=>row[field]===false)?false:null;
  return {campusKey,parentSchoolKey:identity.parentSchoolKey,schoolName:alias?.schoolName??identity.schoolName,campusName:alias?.campusName??identity.campusName,
    schoolCode:singleValue(aliases.map(row=>row.schoolCode)),rawNames:unique(aliases.map(row=>row.rawName)),schoolTier:singleValue(aliases.map(row=>row.tier))??identity.schoolTier,
    educationLevel:singleValue(aliases.map(row=>row.level))??identity.educationLevel,ownership:singleValue(aliases.map(row=>row.ownership))??identity.schoolOwnership,
    is985:flags('is985'),is211:flags('is211'),isDoubleFirst:flags('isDoubleFirst'),kind:singleValue(aliases.map(row=>row.kind)),matchStatus:singleValue(aliases.map(row=>row.matchStatus)),
    industryTags:unique([...aliases.flatMap(row=>row.industryTags.split(/[、,，;；]/)),...all.flatMap(row=>row.industryTags)]),
    province:geo?geo.province:alias?.schoolProvince??identity.schoolProvince,provinceAdcode:geo?geo.provinceAdcode:provinceFor(index,alias?.schoolProvince??identity.schoolProvince)?.adcode??null,
    city:geo?.city??null,cityAdcode:geo?.cityAdcode??null,coordinates:coordinates(geo),locationPrecision:geo?.precision??'unlocated',coordinateSystem:geo?.coordinateSystem??null,address:geo?.address??null,
    locationNote:geo?.note||geo?.pendingReason||'尚无核验位置，不绘制推测校址。',sourceUrls:unique([...aliases.flatMap(row=>row.sourceUrls),...(geo?.sourceUrls??[])]),
    introduction:geo?.introduction??null,
    recordCount:sum(rows),nationalRecordCount:sum(national),destinationProvinceRecordCount:province?sum(destination):null,batchCounts:batchCounts(rows),gridCounts:gridCounts(rows),countBasis:countBasis(admin,exact)};
}
export type GridMapSchool=NonNullable<ReturnType<typeof schoolSummary>>;
function companyFacts(index:Index,companyKey:string,q:GridMapQuery,admin:boolean){return (index.companyFactRows.get(companyKey)??[]).filter(fact=>factMatches(fact,q,admin)&&(admin||Boolean(recruitmentDisplayText(fact.text)))).map(fact=>admin?fact:recruitmentFactForDisplay(fact));}
function companySummary(index:Index,companyKey:string,q:GridMapQuery,admin:boolean,campusKey?:string,exact=false){
  const identity=index.companies.get(companyKey);if(!identity)return null;
  const rows=((admin||exact?index.allByCompany:index.releasedByCompany).get(companyKey)??[]).filter(row=>outcomeMatches(row,q)&&(!campusKey||row.campusKey===campusKey));
  const all=(index.allByCompany.get(companyKey)??[]).filter(row=>outcomeMatches(row,q)&&(!campusKey||row.campusKey===campusKey));
  const province=provinceFor(index,identity.province);
  const facts=companyFacts(index,companyKey,q,admin),candidate=identity.candidate;
  const companyCity=candidate?.city??(!all.length?singleValue(facts.map(fact=>fact.city)):null);
  const city=companyCity&&province?index.cityNames.get(`${province.adcode}:${normalize(companyCity)}`):undefined;
  const {candidate:_candidate,...publicIdentity}=identity;
  return {...publicIdentity,provinceAdcode:province?.adcode??null,coordinates:coordinates(city)??coordinates(province),locationPrecision:coordinates(city)?'city':province?'province':'unlocated',destinationCity:null,
    candidateStatus:candidate?'reference_candidate':index.allByCompany.has(companyKey)?'roster_unit':'policy_reference',companyCity,companyCityAdcode:city?.adcode??null,cityEvidenceStatus:candidate?.cityEvidenceStatus??(companyCity?'source_reference':'unknown'),
    locationNote:candidate?'资料中的单位地域线索，仅供参考；尚未核验实体和办公地址，不代表录用去向城市。':'招聘统计范围参考点，不表示单位办公地址或录用城市。',
    recordCount:sum(rows),batchCounts:batchCounts(rows),schoolCount:new Set(all.map(row=>row.campusKey)).size,policyFactCount:facts.length,countBasis:countBasis(admin,exact)};
}
const byRecords=(a:{recordCount:number|null},b:{recordCount:number|null})=>(b.recordCount??-1)-(a.recordCount??-1);

// The overview rescans every outcome once per province, so it costs far more
// than the other map routes and it reruns on every anonymous homepage hit. The
// public projection is a pure function of the query for one snapshot/catalog
// pair, and stays a few KB because it stops at provinceSummaries, so memoise
// just that one. The authenticated shape carries every school, company and
// city instead — tens of MB per query, well past the container limit — so it
// keeps recomputing. The snapshot passed in is already the audience
// projection, so a source visibility change yields a new snapshot object and
// leaves this cache behind instead of serving a stale projection. Bounded
// because provinceAdcode/cohortYear accept far more values than really exist.
const overviewCache=new WeakMap<GridSnapshot,{catalogs:GridMapCatalog[];results:Map<string,ReturnType<typeof computeGridMapOverview>>}>();
// Real key space is cohortYear x grid x batchCode restricted to legal pairs:
// 16 per cohort with roster data. 64 leaves headroom at ~10 KB per public body.
const OVERVIEW_CACHE_LIMIT=64;
export function queryGridMapOverview(snapshot:GridSnapshot,catalogs:GridMapCatalog[],q:GridMapQuery,admin=false,publicOnly=false,exact=false){
  // The public projection stops at provinceSummaries, whose cells are province
  // x batch totals in the hundreds or thousands — the national 48,807 split is
  // already published — so it reports complete anonymous aggregates. Cell
  // suppression still guards every finer authenticated shape below, and
  // admin-only source filtering is applied to the snapshot before this call.
  // A public projection still cannot opt into administrator scope.
  if(publicOnly){exact=true;admin=false;}
  if(!publicOnly)return computeGridMapOverview(snapshot,catalogs,q,admin,publicOnly,exact);
  // provinceAdcode never reaches the public projection — it only echoes back in
  // `selection` — so keying on it let one payload occupy 900k distinct keys
  // (the schema accepts any six digits) and miss a 32-entry cache every time.
  // Key on what actually varies, and decline to cache cohort years the snapshot
  // has no roster for, so the key space is bounded by real data rather than by
  // everything the schema will parse. A cohort with no rows is already cheap.
  const index=indexFor(snapshot,catalogs);
  if(!index.all.some(row=>row.cohortYear===q.cohortYear))return computeGridMapOverview(snapshot,catalogs,q,admin,publicOnly,exact);
  const key=[q.cohortYear,q.grid??'',q.batchCode??''].join('\0');
  let entry=overviewCache.get(snapshot);
  if(entry?.catalogs!==catalogs){entry={catalogs,results:new Map()};overviewCache.set(snapshot,entry);}
  let result=entry.results.get(key);
  if(!result){
    result=computeGridMapOverview(snapshot,catalogs,q,admin,publicOnly,exact);
    if(entry.results.size>=OVERVIEW_CACHE_LIMIT)entry.results.delete(entry.results.keys().next().value!);
    entry.results.set(key,result);
  }
  // The cached body is shared; only the echoed selection is per-request.
  return {...result,selection:selection(q)};
}
function computeGridMapOverview(snapshot:GridSnapshot,catalogs:GridMapCatalog[],q:GridMapQuery,admin:boolean,publicOnly:boolean,exact:boolean){
  const index=indexFor(snapshot,catalogs),province=selectedProvince(index,q),all=index.all.filter(row=>outcomeMatches(row,q)),released=(admin||exact?index.all:index.released).filter(row=>outcomeMatches(row,q));
  const activeCompanyKeys=new Set(all.map(row=>row.companyKey));
  const facts=index.facts.filter(fact=>factMatches(fact,q,admin));
  const provinceSummaries=[...index.provinces.values()].map(region=>{
    const allRows=all.filter(row=>inProvince(row.province,region)),rows=released.filter(row=>inProvince(row.province,region));
    const regionCompanyKeys=new Set(allRows.map(row=>row.companyKey));
    return {adcode:region.adcode,name:region.name,recordCount:publicOnly?publicFloor(sum(rows)):sum(rows),schoolCount:new Set(allRows.map(row=>row.campusKey)).size,
      companyCount:[...index.companies.values()].filter(company=>inProvince(company.province,region)&&(regionCompanyKeys.has(company.companyKey)||companyFacts(index,company.companyKey,q,admin).length>0)).length,
      policyFactCount:facts.filter(fact=>inProvince(fact.province,region)).length,batchCounts:publicOnly?flooredBatchCounts(rows):batchCounts(rows),countBasis:countBasis(admin,exact)};
  });
  // Coverage is about the requested source cohort, not an empty filter result.
  // Inspect the already audience-projected snapshot before small-cell suppression;
  // a protected count is not a missing year. Unknown-year facts never fill a year.
  const rosterDataAvailable=index.all.some(row=>row.cohortYear===q.cohortYear);
  const referenceDataAvailable=rosterDataAvailable||index.facts.some(fact=>fact.cohortYear===q.cohortYear&&(admin||fact.dataStatus==='reference'));
  const base={schemaVersion:'grid-map-1' as const,selection:selection(q),referenceDataAvailable,rosterDataAvailable,privacy:privacy(admin,exact,publicOnly),disclaimer,provinceSummaries};
  if(publicOnly){
    // A short public leaderboard: campus totals are hundreds-scale, and the
    // same minimum-group floor applies, so no small cohort becomes visible.
    // Anything deeper (per-batch or per-province school ranking) stays behind
    // the authenticated routes.
    const byCampus=new Map<string,{campusKey:string;schoolName:string;campusName:string|null;recordCount:number;sgcc:number;csg:number}>();
    for(const row of all){
      const entry=byCampus.get(row.campusKey)??{campusKey:row.campusKey,schoolName:row.schoolName,campusName:row.campusName,recordCount:0,sgcc:0,csg:0};
      entry.recordCount+=row.recordCount;
      if(row.grid==='csg')entry.csg+=row.recordCount;else entry.sgcc+=row.recordCount;
      byCampus.set(row.campusKey,entry);
    }
    const topSchools=[...byCampus.values()].filter(row=>row.recordCount>=MINIMUM_PUBLIC_GROUP)
      .sort((a,b)=>b.recordCount-a.recordCount).slice(0,PUBLIC_TOP_SCHOOLS)
      // Two campuses of one university are two rows here. Without the campus
      // label they render as the same school twice with different numbers.
      .map((row,index)=>({rank:index+1,campusKey:row.campusKey,schoolName:row.schoolName,campusName:row.campusName,recordCount:row.recordCount,
        gridCounts:flooredGroup([['sgcc',row.sgcc],['csg',row.csg]]) as {sgcc:number|null;csg:number|null}}));
    // Anonymous visitors already see every province total and the campus
    // leaderboard that make up this figure, so withholding the national total
    // hid nothing and only left the headline reading as a dash.
    const nationalSummary={cohortYear:q.cohortYear,grid:q.grid??null,batchCode:q.batchCode??null,
      recordCount:publicFloor(sum(all)),campusCount:new Set(all.map(row=>row.campusKey)).size,
      countBasis:countBasis(admin,exact)};
    return {...base,nationalSummary,topSchools};
  }
  const schoolKeys=[...new Set(all.map(row=>row.campusKey))];
  const localSchools=schoolKeys.map(key=>schoolSummary(index,key,q,admin,'national',undefined,exact)).filter((school):school is GridMapSchool=>Boolean(school)&&(!q.provinceAdcode||school!.provinceAdcode===q.provinceAdcode)).sort(byRecords);
  const sourceKeys=[...new Set(all.filter(row=>inProvince(row.province,province)).map(row=>row.campusKey))];
  const sourceSchools=sourceKeys.map(key=>schoolSummary(index,key,q,admin,'destination',undefined,exact)).filter((school):school is GridMapSchool=>Boolean(school)).sort(byRecords);
  const companies=[...index.companies.values()].filter(company=>inProvince(company.province,province)).map(company=>companySummary(index,company.companyKey,q,admin,undefined,exact)).filter(company=>company&&(activeCompanyKeys.has(company.companyKey)||company.policyFactCount>0)).sort((a,b)=>byRecords(a!,b!));
  // Count each entity/fact once instead of rescanning every fact for every city.
  const schoolCityCounts=new Map<string,number>(),companyCityCounts=new Map<string,number>(),factCityCounts=new Map<string,number>();
  for(const row of localSchools)if(row.cityAdcode)schoolCityCounts.set(row.cityAdcode,(schoolCityCounts.get(row.cityAdcode)??0)+1);
  for(const row of companies)if(row?.companyCityAdcode)companyCityCounts.set(row.companyCityAdcode,(companyCityCounts.get(row.companyCityAdcode)??0)+1);
  for(const row of facts)if(row.city){const key=`${normalize(row.province)}:${normalize(row.city)}`;factCityCounts.set(key,(factCityCounts.get(key)??0)+1);}
  const cities=[...index.cities.values()].filter(city=>!q.provinceAdcode||city.provinceAdcode===q.provinceAdcode).map(city=>({adcode:city.adcode,provinceAdcode:city.provinceAdcode,name:city.name,coordinates:coordinates(city),
    schoolCount:schoolCityCounts.get(city.adcode)??0,policyFactCount:factCityCounts.get(`${normalize(index.provinces.get(city.provinceAdcode??'')?.name)}:${normalize(city.name)}`)??0,
    companyCount:companyCityCounts.get(city.adcode)??0,recordCount:null,destinationCityStatus:'source_not_provided' as const}));
  const unassignedCompanies=q.provinceAdcode?[...index.companies.values()].filter(company=>!provinceFor(index,company.province)).map(company=>companySummary(index,company.companyKey,q,admin,undefined,exact)).filter(company=>company&&(activeCompanyKeys.has(company.companyKey)||company.policyFactCount>0)):[];
  const unassignedSchools=schoolKeys.filter(key=>{
    const geo=index.geo.get(key);return !geo?.provinceAdcode&&!(index.allByCampus.get(key)??[]).some(row=>outcomeMatches(row,q)&&provinceFor(index,row.province));
  }).map(key=>schoolSummary(index,key,q,admin,'national',undefined,exact)).filter((school):school is GridMapSchool=>Boolean(school));
  return {...base,localSchools,sourceSchools,companies,cities,unassignedCompanies,unassignedSchools,locationNotice:'学校城市点是校址所在城市的参考位置；公司省级点表示招聘单位统计范围，均不表示录用城市。'};
}

export function queryGridMapSchool(snapshot:GridSnapshot,catalogs:GridMapCatalog[],campusKey:string,q:GridMapQuery,admin=false,exact=false){
  const index=indexFor(snapshot,catalogs),school=schoolSummary(index,campusKey,q,admin,'national',undefined,exact);if(!school)return null;
  const all=index.all.filter(row=>row.campusKey===campusKey&&outcomeMatches(row,q));
  const released=(admin||exact?index.all:index.released).filter(row=>row.campusKey===campusKey&&outcomeMatches(row,q));
  const destinations=[...new Set(all.map(row=>row.companyKey))].map(key=>companySummary(index,key,q,admin,campusKey,exact)).filter(Boolean).sort((a,b)=>byRecords(a!,b!));
  const relatedCampuses=[...new Set(index.all.filter(row=>row.parentSchoolKey===school.parentSchoolKey).map(row=>row.campusKey))].map(key=>schoolSummary(index,key,q,admin,'national',undefined,exact)).filter(Boolean);
  return {schemaVersion:'grid-map-1',selection:selection(q),school,aliases:index.aliases.get(campusKey)??[],geography:index.geo.get(campusKey)??null,relatedCampuses,destinations,sources:sourceList(snapshot,released),privacy:privacy(admin,exact),disclaimer};
}
export function queryGridMapCompany(snapshot:GridSnapshot,catalogs:GridMapCatalog[],companyKey:string,q:GridMapQuery,admin=false,exact=false){
  const index=indexFor(snapshot,catalogs),company=companySummary(index,companyKey,q,admin,undefined,exact);if(!company)return null;
  const all=index.all.filter(row=>row.companyKey===companyKey&&outcomeMatches(row,q)),released=(admin||exact?index.all:index.released).filter(row=>row.companyKey===companyKey&&outcomeMatches(row,q));
  const policyFacts=companyFacts(index,companyKey,q,admin);
  // Quarantined-only company names are not discoverable through the user detail route.
  if(!admin&&!all.length&&!policyFacts.length)return null;
  const schools=[...new Set(all.map(row=>row.campusKey))].map(key=>schoolSummary(index,key,q,admin,'national',companyKey,exact)).filter((school):school is GridMapSchool=>Boolean(school)).sort(byRecords);
  const candidate=index.companies.get(companyKey)?.candidate;
  const references=candidate?.references.filter(ref=>(!q.grid||candidate.grid===q.grid)&&(admin||ref.dataStatus==='reference')&&(ref.cohortYear===q.cohortYear||ref.cohortYear===null)&&(!q.batchCode||q.batchCode==='all'||ref.batchCode===q.batchCode))??[];
  return {schemaVersion:'grid-map-1',selection:selection(q),company,aliases:catalogs.flatMap(catalog=>catalog.unitAliases).filter(alias=>alias.companyKeys.includes(companyKey)),candidate:candidate?{candidateKey:candidate.candidateKey,companyRegion:candidate.companyRegion,entityStatus:candidate.entityStatus,cityEvidenceStatus:candidate.cityEvidenceStatus,references}:null,schools,policyFacts,sources:sourceList(snapshot,released,policyFacts),privacy:privacy(admin,exact),disclaimer};
}
export function gridMapCoverage(snapshot:GridSnapshot,catalogs:GridMapCatalog[]){
  const index=indexFor(snapshot,catalogs),campuses=[...new Set(index.all.map(row=>row.campusKey))],geography=campuses.map(key=>index.geo.get(key));
  const provinces=[...index.provinces.values()].map(province=>({adcode:province.adcode,name:province.name,schoolCount:geography.filter(geo=>geo?.provinceAdcode===province.adcode).length,
    companyCount:[...index.companies.values()].filter(company=>inProvince(company.province,province)).length,
    policyCityCount:new Set(index.facts.filter(fact=>inProvince(fact.province,province)&&fact.city).map(fact=>normalize(fact.city))).size,
    recordCount:sum(index.all.filter(row=>inProvince(row.province,province)))}));
  return {schemaVersion:'grid-map-1',catalogVersion:catalogs[0]?.version??null,sourceDatasetKey:catalogs[0]?.datasetKey??null,
    recordCount:sum(index.all),unassignedDestinationRecordCount:sum(index.all.filter(row=>!provinceFor(index,row.province))),
    schoolAliasCount:catalogs.reduce((total,catalog)=>total+catalog.schoolAliases.length,0),unitAliasCount:catalogs.reduce((total,catalog)=>total+catalog.unitAliases.length,0),
    schoolCount:new Set(index.all.map(row=>row.parentSchoolKey)).size,campusCount:campuses.length,companyCount:index.companies.size,
    rosterCompanyCount:new Set(index.all.map(row=>row.companyKey)).size,policyCompanyCount:[...index.companies.keys()].filter(key=>!index.allByCompany.has(key)&&!index.companies.get(key)?.candidate).length,candidateCompanyCount:[...index.companies.values()].filter(row=>row.candidate).length,
    locationCounts:{campus:geography.filter(row=>row?.precision==='campus').length,city:geography.filter(row=>row?.precision==='city').length,unlocated:geography.filter(row=>!row||row.precision==='unlocated').length},
    provinces,unlocatedSchools:campuses.filter(key=>!index.geo.get(key)||index.geo.get(key)?.precision==='unlocated').map(key=>{const row=index.all.find(row=>row.campusKey===key)!,geo=index.geo.get(key);return {campusKey:key,parentSchoolKey:row.parentSchoolKey,name:row.schoolName,campusName:row.campusName,province:geo?geo.province:row.schoolProvince,reason:geo?.pendingReason??'未取得可核验地理数据'};}),
    notes:[disclaimer,'地理字典只决定学校位置和行政区参考点；不会新增招聘去向城市。','母校统计与校区统计为不同粒度，不能相加。'],sources:catalogs.flatMap(catalog=>catalog.sources),catalogs:catalogs.map(({version,datasetKey,rosterVersion,rosterChecksumSha256})=>({version,datasetKey,rosterVersion,rosterChecksumSha256}))};
}
