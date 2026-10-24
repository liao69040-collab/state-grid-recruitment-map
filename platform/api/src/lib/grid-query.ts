import { createHash } from 'node:crypto';
import { z } from 'zod';
import { recruitmentDisplayText, recruitmentFactForDisplay } from './recruitment-display-text.js';

const key = z.string().regex(/^[A-Za-z0-9_.:-]{1,160}$/);
// This module accepts summary/policy material only, never roster identities.
const text = (max = 30000) => z.string().max(max).refine(
  (v) => !/(?:^|\D)1[3-9]\d{9}(?:\D|$)|\b\d{17}[0-9Xx]\b/.test(v),
  'Personal phone/identity patterns are not permitted in query material',
);
const label = text(240).min(1);
export const gridBatchSchema = z.enum(['campus', 'batch_1', 'batch_2', 'batch_3', 'csg_spring', 'csg_autumn', 'all', 'unspecified']);
export const gridKindSchema = z.enum(['sgcc', 'csg', 'other', 'unknown']);
export const gridOrgSchema = z.enum(['province_company', 'supply_bureau', 'direct_unit', 'headquarters', 'branch', 'branch_subunit', 'listed_company', 'industry', 'service', 'other', 'unknown']);
export const gridCategorySchema = z.enum(['student_origin', 'education', 'school', 'major', 'age', 'certificate', 'score', 'compensation', 'application', 'exam', 'headcount', 'other']);
export const gridSourceSchema = z.object({
  sourceKey: key, title: label,
  sourceType: z.enum(['user_material', 'official_reference', 'roster_aggregate']),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  sourceUrl: z.string().url().refine(v => /^https?:\/\//.test(v)).nullable(),
  note: text(),
}).strict();
export const gridFactSchema = z.object({
  factKey: key, sourceKey: key, cohortYear: z.number().int().min(2000).max(2100).nullable(),
  grid: gridKindSchema, batchCode: gridBatchSchema,
  scope: z.enum(['national', 'province', 'city', 'company']),
  province: label.nullable(), city: label.nullable(), company: label.nullable(),
  category: gridCategorySchema, title: label, text: text().min(1),
  educationLevel: label.nullable(), schoolTier: label.nullable(),
  evidenceLocator: text(2000).min(1),
  dataStatus: z.enum(['reference', 'conflict', 'pending', 'quarantined']),
  issueReason: text(2000).nullable().default(null),
  relatedOfficialSourceKey: key.nullable(),
}).strict().superRefine((v, ctx) => {
  if ((v.scope === 'province' || v.scope === 'city') && !v.province) ctx.addIssue({code:'custom', message:'Province evidence requires province'});
  if (v.scope === 'city' && !v.city) ctx.addIssue({code:'custom', message:'City-specific evidence requires city'});
  if (v.scope !== 'city' && v.scope !== 'company' && v.city !== null) ctx.addIssue({code:'custom', message:'Only city/company-specific evidence may carry city'});
  if (v.city && !v.province) ctx.addIssue({code:'custom', message:'City location requires its province'});
  if (v.scope === 'company' && !v.company) ctx.addIssue({code:'custom', message:'Company evidence requires company'});
  if (v.dataStatus === 'quarantined' && !v.issueReason) ctx.addIssue({code:'custom', message:'Quarantine reason required'});
});
export const gridOutcomeSchema = z.object({
  outcomeKey:key, sourceKey:key, cohortYear:z.number().int().min(2000).max(2100),
  grid:gridKindSchema, batchCode:gridBatchSchema, province:label.nullable(), city:z.null(),
  companyKey:key, company:label, orgCategory:gridOrgSchema,
  parentSchoolKey:key, schoolName:label, campusKey:key, campusName:label,
  schoolTier:label, educationLevel:label.nullable(), schoolOwnership:label.nullable(), schoolProvince:label.nullable(),industryTags:z.array(label).max(30).default([]),
  metricType:z.literal('public_notice_record_count'), recordCount:z.number().int().positive().max(1000000),
  evidenceLocator:text(2000).min(1),
}).strict();
export const gridDatasetSchema = z.object({
  schemaVersion:z.literal('grid-query-1'), datasetKey:key, version:key,
  title:label, createdAt:z.iso.datetime({offset:true}),
  sources:z.array(gridSourceSchema).min(1).max(1000),
  policyFacts:z.array(gridFactSchema).max(30000),
  schoolOutcomes:z.array(gridOutcomeSchema).max(100000),
  notes:z.array(text(4000)).max(100),
}).strict().superRefine((v, ctx) => {
  const unique = (rows: { [key:string]:unknown }[], field:string) => {
    const keys=rows.map(row=>row[field]);
    if(new Set(keys).size!==keys.length) ctx.addIssue({code:'custom', message:`Duplicate ${field}`});
  };
  unique(v.sources,'sourceKey'); unique(v.policyFacts,'factKey'); unique(v.schoolOutcomes,'outcomeKey');
  const sources=new Set(v.sources.map(row=>row.sourceKey));
  for(const row of [...v.policyFacts,...v.schoolOutcomes]) if(!sources.has(row.sourceKey)) ctx.addIssue({code:'custom',message:'Unresolved sourceKey'});
});
export type GridDataset = z.infer<typeof gridDatasetSchema>;
export type GridSource = z.infer<typeof gridSourceSchema>;
export type GridFact = z.infer<typeof gridFactSchema>;
export type GridOutcome = z.infer<typeof gridOutcomeSchema>;
export type GridVersion = Omit<GridDataset,'schemaVersion'|'sources'|'policyFacts'|'schoolOutcomes'> & {
  checksumSha256:string; sourceCount:number; factCount:number; outcomeCount:number;
};
export type GridSnapshot = { datasets:GridDataset[]; versions:GridVersion[] };

// Sort object keys: PostgreSQL jsonb ordering must not change content hashes.
export function gridCanonical(value:unknown):string {
  if(Array.isArray(value)) return `[${value.map(gridCanonical).join(',')}]`;
  if(value && typeof value==='object') return `{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${gridCanonical(v)}`).join(',')}}`;
  return JSON.stringify(value);
}
export function gridChecksum(value:unknown):string {return createHash('sha256').update(gridCanonical(value)).digest('hex');}
export function gridVersion(dataset:GridDataset):GridVersion {
  const {schemaVersion:_s,sources,policyFacts,schoolOutcomes,...metadata}=dataset;
  return {...metadata,checksumSha256:gridChecksum(dataset),sourceCount:sources.length,factCount:policyFacts.length,outcomeCount:schoolOutcomes.length};
}

const filterText=z.string().trim().min(1).max(120).optional();
const paging={page:z.coerce.number().int().min(1).max(10000).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(20)};
const commonFilters={q:filterText,province:filterText,company:filterText,cohortYear:z.union([z.literal('unknown'),z.coerce.number().int().min(2000).max(2100)]).optional(),grid:gridKindSchema.optional(),batchCode:gridBatchSchema.optional(),schoolTier:filterText,educationLevel:filterText};
export const gridFactQuerySchema=z.object({...paging,...commonFilters,city:filterText,category:gridCategorySchema.optional(),scope:z.enum(['national','province','city','company']).optional(),dataStatus:z.enum(['reference','conflict','pending','quarantined']).optional()}).strict();
export const gridRankingQuerySchema=z.object({...paging,...commonFilters,orgCategory:gridOrgSchema.optional(),industryTag:filterText,view:z.enum(['parent','campus']).default('parent')}).strict();
export const gridSourceQuerySchema=z.object({...paging,q:filterText}).strict();
export type GridFactQuery=z.infer<typeof gridFactQuerySchema>;
export type GridRankingQuery=z.infer<typeof gridRankingQuerySchema>;
const disclaimer='用户资料整理仅供参考，不等于官方报考资格或实际入职人数；年份、批次及适用地域以原文和官方当期公告为准。';
const privacyDisclaimer='固定最细统计单元中不足5条的记录不参与任何用户侧排名或筛选。显示为可展示记录数（下限），非全量，不能与全量主榜直接相减推断个人信息。';
const normalize=(v:string)=>v.replace(/(?:壮族自治区|回族自治区|维吾尔自治区|自治区|省|市)$/,'');
function placeMatches(actual:string|null,asked:string|undefined) {return !asked||actual===asked||(actual!==null && normalize(actual)===normalize(asked));}
function includes(v:string,q:string|undefined) {return !q||v.toLocaleLowerCase().includes(q.toLocaleLowerCase());}
function page<T>(items:T[],q:{page:number;pageSize:number}) {return {items:items.slice((q.page-1)*q.pageSize,q.page*q.pageSize),total:items.length,page:q.page,pageSize:q.pageSize};}
export function gridFactVisibleToMember(dataset:GridDataset,f:GridFact):boolean {
  if(f.dataStatus !== 'reference')return false;
  if(!recruitmentDisplayText(f.text))return false;
  // Raw booleans contradicted the detailed policy prose; retain them for
  // audit only. The reviewed JSON metric payloads have a typed overview UI.
  if(f.sourceKey.startsWith('html.') && ['提前批本科通道原始标记','提前批笔试原始标记'].includes(f.title))return false;
  if(dataset.datasetKey === 'mobile-info-reviewed-national-reference-20260922' && f.title.startsWith('移动汇总指标：'))return false;
  return true;
}
function visibleFacts(dataset:GridDataset,admin:boolean) {return dataset.policyFacts.filter(f=>admin||gridFactVisibleToMember(dataset,f));}

export function queryGridFacts(snapshot:GridSnapshot,q:GridFactQuery,admin=false) {
  const items=snapshot.datasets.flatMap(dataset=>visibleFacts(dataset,admin).filter(f=>
    placeMatches(f.province,q.province) && (!q.city || (f.city!==null&&placeMatches(f.city,q.city)) || f.scope==='province') &&
    (!q.company||f.company===q.company) && (q.cohortYear==='unknown'?f.cohortYear===null:!q.cohortYear||f.cohortYear===q.cohortYear) && (!q.grid||f.grid===q.grid) &&
    (!q.batchCode||f.batchCode===q.batchCode||f.batchCode==='all') && (!q.category||f.category===q.category) && (!q.scope||f.scope===q.scope) && (!q.dataStatus||f.dataStatus===q.dataStatus) &&
    (!q.schoolTier||f.schoolTier===q.schoolTier) && (!q.educationLevel||f.educationLevel===q.educationLevel) &&
    includes([f.title,f.text,f.province,f.city,f.company].filter(Boolean).join(' '),q.q)
  ).map(f=>({...(admin?f:recruitmentFactForDisplay(f)),source:dataset.sources.find(s=>s.sourceKey===f.sourceKey)!,datasetKey:dataset.datasetKey,version:dataset.version,
    applicability:q.city&&f.scope==='province'?'province_inherited':f.city!==null?'city_specific':'direct'})));
  // A city alone cannot inherit every province: require unambiguous matching city evidence.
  const cityProvinces=new Set(items.filter(f=>f.city!==null).map(f=>f.province));
  const scoped=items.filter(f=>!q.city||q.province||f.scope!=='province'||cityProvinces.has(f.province));
  scoped.sort((a,b)=>a.province?.localeCompare(b.province??'','zh-CN')|| (a.scope==='city'?-1:0)-(b.scope==='city'?-1:0)|| (b.cohortYear??0)-(a.cohortYear??0)||a.factKey.localeCompare(b.factKey));
  return {...page(scoped,q),disclaimer};
}

// Release cells are formed BEFORE arbitrary filters. No raw row/source locator,
// low-cell count or exact grand total is returned to users. School catalogue
// entries remain discoverable with null counts, per the explicit product contract.
const gridCellCache=new WeakMap<GridSnapshot,{all:GridOutcome[];released:GridOutcome[]}>();
export function gridReleasedCells(snapshot:GridSnapshot,admin=false):GridOutcome[] {
  const cached=gridCellCache.get(snapshot);
  if(cached)return admin?cached.all:cached.released;
  const cells=new Map<string,GridOutcome>();
  for(const dataset of snapshot.datasets) for(const row of dataset.schoolOutcomes) {
    const key=JSON.stringify([row.cohortYear,row.grid,row.batchCode,row.province,row.companyKey,row.company,row.orgCategory,
      row.parentSchoolKey,row.schoolName,row.campusKey,row.campusName,row.schoolTier,row.educationLevel,row.schoolOwnership,row.schoolProvince,row.industryTags]);
    const prior=cells.get(key);
    if(prior) prior.recordCount+=row.recordCount;
    else cells.set(key,{...row});
  }
  const all=[...cells.values()],released=all.filter(row=>row.recordCount>=5);
  gridCellCache.set(snapshot,{all,released});
  return admin?all:released;
}
export function queryGridRankings(snapshot:GridSnapshot,q:GridRankingQuery,admin=false,exact=false) {
  const matches=(f:GridOutcome)=>placeMatches(f.province,q.province)&&(!q.company||f.company===q.company)&&
    (!q.cohortYear||f.cohortYear===q.cohortYear)&&(!q.grid||f.grid===q.grid)&&(!q.batchCode||f.batchCode===q.batchCode)&&
    (!q.schoolTier||f.schoolTier===q.schoolTier)&&(!q.educationLevel||f.educationLevel===q.educationLevel)&&(!q.orgCategory||f.orgCategory===q.orgCategory)&&(!q.industryTag||f.industryTags.includes(q.industryTag));
  const cells=gridReleasedCells(snapshot,admin||exact).filter(matches);
  const groups=new Map<string,{schoolKey:string;schoolName:string;campusName:string|null;schoolTier:string;educationLevel:string|null;recordCount:number}>();
  for(const row of cells) {
    const key=q.view==='parent'?row.parentSchoolKey:row.campusKey;
    const prior=groups.get(key);
    if(prior) prior.recordCount+=row.recordCount;
    else groups.set(key,{schoolKey:key,schoolName:row.schoolName,campusName:q.view==='campus'?row.campusName:null,schoolTier:row.schoolTier,educationLevel:row.educationLevel,recordCount:row.recordCount});
  }
  const sorted=[...groups.values()].sort((a,b)=>b.recordCount-a.recordCount||a.schoolKey.localeCompare(b.schoolKey));
  let rank=0;
  const items:Array<{schoolKey:string;schoolName:string;campusName:string|null;schoolTier:string;educationLevel:string|null;recordCount:number|null;rank:number|null;metricType:'public_notice_record_count';countBasis:'all_aggregate_cells'|'released_cells_only'}>=sorted.map((row,i)=>{if(i===0||row.recordCount!==sorted[i-1]!.recordCount)rank=i+1;return {...row,rank,metricType:'public_notice_record_count' as const,countBasis:admin?'all_aggregate_cells' as const:'released_cells_only' as const};});
  // Preserve the complete school catalogue without exposing precise small-cell
  // counts, row keys, source positions or ranks for wholly suppressed schools.
  const suppressed=new Map<string,GridOutcome>();
  if(!admin&&!exact)for(const row of gridReleasedCells(snapshot,true).filter(matches)){
    const key=q.view==='parent'?row.parentSchoolKey:row.campusKey;
    if(!groups.has(key))suppressed.set(key,row);
  }
  for(const [schoolKey,row] of [...suppressed.entries()].sort(([a],[b])=>a.localeCompare(b)))items.push({schoolKey,schoolName:row.schoolName,campusName:q.view==='campus'?row.campusName:null,schoolTier:row.schoolTier,educationLevel:row.educationLevel,recordCount:null,rank:null,metricType:'public_notice_record_count',countBasis:'released_cells_only'});
  const allCells=gridReleasedCells(snapshot,true).filter(matches);
  const rowKey=(row:GridOutcome)=>q.view==='parent'?row.parentSchoolKey:row.campusKey;
  const detail=new Map<string,{batch:Map<string,number>;grid:Map<string,number>;batchPresent:Set<string>;gridPresent:Set<string>;levels:Set<string>;tiers:Set<string>;tags:Set<string>;campuses:Set<string>}>();
  for(const row of allCells){
    const key=rowKey(row);
    let d=detail.get(key);
    if(!d){d={batch:new Map(),grid:new Map(),batchPresent:new Set(),gridPresent:new Set(),levels:new Set(),tiers:new Set(),tags:new Set(),campuses:new Set()};detail.set(key,d);}
    d.campuses.add(row.campusKey);
    d.batchPresent.add(row.batchCode);d.gridPresent.add(row.grid);d.tiers.add(row.schoolTier);
    if(row.educationLevel)d.levels.add(row.educationLevel);
    for(const tag of row.industryTags)d.tags.add(tag);
  }
  for(const row of cells){const d=detail.get(rowKey(row))!;d.batch.set(row.batchCode,(d.batch.get(row.batchCode)??0)+row.recordCount);d.grid.set(row.grid,(d.grid.get(row.grid)??0)+row.recordCount);}
  const split=(d:NonNullable<ReturnType<typeof detail.get>>,field:'batch'|'grid',values:readonly string[])=>Object.fromEntries(values.map(value=>{
    const sum=d[field].get(value)??0,hasHidden=d[field==='batch'?'batchPresent':'gridPresent'].has(value);
    return [value,!admin&&!exact&&sum===0&&hasHidden?null:sum];
  }));
  // Pre-aggregate once, then decorate only the requested page. This avoids
  // repeatedly scanning 12k cells for every school/batch column on a 1-CPU host.
  // Searching a school locates it in the selected ranking; it must not turn
  // every single search result into an invented national number-one rank.
  const paged=page(items.filter(row=>includes(`${row.schoolName} ${row.campusName??''}`,q.q)),q);
  const decorated=paged.items.map(row=>{
    const d=detail.get(row.schoolKey)!;
    const educationLevels=[...d.levels].sort();
    const schoolTiers=[...d.tiers].sort();
    return {...row,
    educationLevel:educationLevels.length===1?educationLevels[0]!:null,educationLevels,
    schoolTier:schoolTiers.length===1?schoolTiers[0]!:'多层次（详见明细）',schoolTiers,
    batchCounts:split(d,'batch',['batch_1','batch_2','batch_3','csg_spring','csg_autumn']),
    gridCounts:split(d,'grid',['sgcc','csg']),
    industryTags:[...d.tags].sort(),
    campusKeys:[...d.campuses].sort(),
    countBasis:exact?'complete_anonymous_aggregates' as const:row.countBasis,
  };});
  return {...paged,items:decorated,view:q.view,privacy:{minimumCellCount:exact?null:5,suppressionApplied:!admin&&!exact,personalRecordsIncluded:false,basis:exact?'认证用户完整匿名汇总；不含个人行、姓名、电话或原始行号。':admin?'管理员完整脱敏汇总，无名单姓名电话及行号':privacyDisclaimer},disclaimer};
}
export function gridFacets(snapshot:GridSnapshot,admin=false) {
  const facts=snapshot.datasets.flatMap(d=>visibleFacts(d,admin)),cells=gridReleasedCells(snapshot,true);
  const rows=[...facts,...cells];
  const strings=(values:(string|null|undefined)[])=>[...new Set(values.filter((v):v is string=>typeof v==='string'&&v.length>0))].sort((a,b)=>a.localeCompare(b,'zh-CN'));
  const cityMap=new Map<string,{province:string;city:string}>();
  for(const f of facts)if(f.province&&f.city)cityMap.set(`${f.province}:${f.city}`,{province:f.province,city:f.city});
  return {schemaVersion:'grid-query-1',unknownYearAvailable:facts.some(f=>f.cohortYear===null),years:[...new Set(rows.map(r=>r.cohortYear).filter((v):v is number=>v!==null))].sort((a,b)=>b-a),
    provinces:strings(rows.map(r=>r.province)),cities:[...cityMap.values()],companies:strings(rows.map(r=>r.company)),grids:strings(rows.map(r=>r.grid)),
    batches:strings(rows.map(r=>r.batchCode)),schoolTiers:strings(rows.map(r=>r.schoolTier)),educationLevels:strings(rows.map(r=>r.educationLevel)),
    orgCategories:strings(cells.map(r=>r.orgCategory)),industryTags:strings(cells.flatMap(r=>r.industryTags)),versions:snapshot.versions,disclaimer};
}
export function queryGridSources(snapshot:GridSnapshot,q:z.infer<typeof gridSourceQuerySchema>) {
  return page(snapshot.datasets.flatMap(d=>d.sources.map(s=>({...s,datasetKey:d.datasetKey,version:d.version}))).filter(s=>includes(`${s.title} ${s.note}`,q.q)),q);
}
