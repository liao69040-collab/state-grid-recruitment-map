import { z } from 'zod';
import { gridChecksum } from './grid-query.js';
import { normalizedDataset } from './grid-query-import.js';
import { adaptRosterHandoff } from './grid-roster-adapter.js';

const key=z.string().regex(/^[A-Za-z0-9_.:-]{1,160}$/);
const text=z.string().max(12000).refine(v=>!/(?:^|\D)1[3-9]\d{9}(?:\D|$)|\b\d{17}[0-9Xx]\b/.test(v),'Personal identifiers are not permitted');
const label=text.refine(v=>v.length<=500);
const url=z.string().url().refine(v=>/^https?:\/\//.test(v));
const nullableLabel=label.nullable();
const adcode=z.string().regex(/^\d{6}$/).nullable();
const coordinateSystem=z.enum(['WGS84','GCJ02','BD09']).nullable();
export const mapSchoolAliasSchema=z.object({
  rawName:label,parentSchoolKey:key,campusKey:key,schoolName:label,campusName:label,tier:label,level:label,ownership:label,schoolProvince:label,
  schoolCode:label,is985:z.boolean().nullable(),is211:z.boolean().nullable(),isDoubleFirst:z.boolean().nullable(),kind:label,matchStatus:label,notes:text,
  sourceUrls:z.array(url),historicalLevel:label,industryTags:text,
}).strict();
export const mapUnitAliasSchema=z.object({
  grid:z.enum(['国网','南网']),unit:label,category:label,company_group:label,province:label,region:label,standardized_unit:label,notes:text,
  source_urls:z.array(url),evidence_status:text,companyKeys:z.array(key),
}).strict();
export const mapSchoolGeographySchema=z.object({
  campusKey:key,parentSchoolKey:key,schoolName:label,campusName:label,schoolCode:nullableLabel,province:nullableLabel,provinceAdcode:adcode,
  city:nullableLabel,cityAdcode:adcode,longitude:z.number().min(-180).max(180).nullable(),latitude:z.number().min(-90).max(90).nullable(),
  precision:z.enum(['campus','city','unlocated']),coordinateSystem,address:nullableLabel,sourceUrls:z.array(url),sourceLabel:text,note:text,
  locationStatus:label,pendingReason:nullableLabel,
  // Optional: adding a sourced profile must not change legacy catalog hashes.
  introduction:z.object({text,sourceUrls:z.array(url).min(1),status:z.enum(['verified','reference']),asOf:z.iso.date().nullable(),note:text}).strict().optional(),
}).strict().superRefine((row,ctx)=>{
  if((row.longitude===null)!==(row.latitude===null))ctx.addIssue({code:'custom',message:'Coordinate pair must be jointly present or absent'});
  if(row.precision==='unlocated'&&(row.longitude!==null||row.latitude!==null))ctx.addIssue({code:'custom',message:'Unlocated schools cannot have guessed coordinates'});
  if(row.precision!=='unlocated'&&(row.longitude===null||row.latitude===null))ctx.addIssue({code:'custom',message:'Located schools require coordinates'});
  if(row.precision==='city'&&(!row.city||!row.cityAdcode))ctx.addIssue({code:'custom',message:'City precision requires a sourced city'});
  if(row.precision==='campus'&&(!row.address?.trim()||!row.sourceUrls.length||!row.coordinateSystem||!row.sourceLabel.trim()))ctx.addIssue({code:'custom',message:'Campus precision requires address, explicit coordinate system and source evidence'});
});
export const mapRegionSchema=z.object({
  adcode:z.string().regex(/^\d{6}$/),provinceAdcode:adcode.default(null),name:label,longitude:z.number().min(-180).max(180).nullable(),latitude:z.number().min(-90).max(90).nullable(),
  coordinateSystem,precision:z.enum(['province','city']),sourceLabel:text,sourceFile:text,sourceProperty:nullableLabel,sourceUrl:url.nullable().default(null),
}).strict();
const catalogSourceSchema=z.object({sourceKey:key,title:label,sourceUrl:url.nullable(),note:text}).strict();
export const companyCandidateReferenceSchema=z.object({
  factKey:key,sourceKey:key,inputId:key,cohortYear:z.number().int().min(2000).max(2100).nullable(),batchCode:z.enum(['batch_1','batch_2','batch_3']),batchRaw:z.enum(['一批','二批','三批']),
  applicationCount:z.number().int().nonnegative(),metricType:z.literal('application_record_count_reference'),measureUnit:z.literal('人次'),dataStatus:z.enum(['reference','pending','conflict','quarantined']),sourceScope:z.literal('company'),sourceTable:z.literal('html_application_units'),
}).strict();
export const companyCandidateSchema=z.object({candidateKey:z.string().regex(/^company\.candidate\.[0-9a-f]{32}$/),grid:z.literal('sgcc'),province:nullableLabel,city:nullableLabel,companyRegion:label,name:label,
  entityStatus:z.literal('unverified_candidate'),cityEvidenceStatus:z.enum(['lexical_reference','unknown']),references:z.array(companyCandidateReferenceSchema).min(1),
}).strict();
export const companyCandidatePackageSchema=z.object({schemaVersion:z.literal('national-company-candidates-1'),version:key,title:label,
  sources:z.array(z.object({title:label,sha256:z.string().regex(/^[a-f0-9]{64}$/),sourceKey:key,sourceType:z.literal('user_material')}).strict()).min(1),
  candidates:z.array(companyCandidateSchema).min(1).max(20000),notes:z.array(text).min(1),
}).strict().superRefine((pack,ctx)=>{
  if(new Set(pack.candidates.map(row=>row.candidateKey)).size!==pack.candidates.length)ctx.addIssue({code:'custom',message:'Duplicate candidate key'});
  const references=pack.candidates.flatMap(row=>row.references.map(ref=>`${ref.sourceKey}:${ref.factKey}`));
  if(new Set(references).size!==references.length)ctx.addIssue({code:'custom',message:'A fact must belong to one candidate'});
  const sources=new Set(pack.sources.map(source=>source.sourceKey));
  for(const candidate of pack.candidates){
    if(candidate.cityEvidenceStatus==='unknown'&&candidate.city!==null)ctx.addIssue({code:'custom',message:'Unknown city cannot be populated'});
    if(candidate.references.some(ref=>!sources.has(ref.sourceKey)))ctx.addIssue({code:'custom',message:'Candidate source missing'});
  }
});
export const gridMapCatalogSchema=z.object({
  schemaVersion:z.literal('grid-map-catalog-1'),datasetKey:key,rosterVersion:key,version:key,rosterChecksumSha256:z.string().regex(/^[a-f0-9]{64}$/),
  schoolAliases:z.array(mapSchoolAliasSchema).max(10000),unitAliases:z.array(mapUnitAliasSchema).max(5000),
  schoolGeography:z.array(mapSchoolGeographySchema).max(10000),provinces:z.array(mapRegionSchema).max(100),cities:z.array(mapRegionSchema).max(2000),sources:z.array(catalogSourceSchema).max(1000),
  companyCandidates:companyCandidatePackageSchema.nullable().default(null),
}).strict().superRefine((catalog,ctx)=>{
  for(const [kind,rows,field] of [['schoolGeography',catalog.schoolGeography,'campusKey'],['provinces',catalog.provinces,'adcode'],['cities',catalog.cities,'adcode']] as const){
    const keys=rows.map(row=>(row as Record<string,unknown>)[field]);
    if(new Set(keys).size!==keys.length)ctx.addIssue({code:'custom',message:`Duplicate ${kind} key`});
  }
  const aliases=new Map(catalog.schoolAliases.map(row=>[row.campusKey,row.parentSchoolKey]));
  for(const row of catalog.schoolGeography)if(aliases.get(row.campusKey)!==row.parentSchoolKey)ctx.addIssue({code:'custom',message:'Geography campus must match roster alias identity'});
});
export type GridMapCatalog=z.infer<typeof gridMapCatalogSchema>;
export type MapSchoolAlias=z.infer<typeof mapSchoolAliasSchema>;
export type MapSchoolGeography=z.infer<typeof mapSchoolGeographySchema>;
export type MapRegion=z.infer<typeof mapRegionSchema>;
export type MapCompanyCandidate=z.infer<typeof companyCandidateSchema>;

export function normalizeGridMapCatalog(input:unknown):GridMapCatalog {
  const result=gridMapCatalogSchema.parse(input);
  result.schoolAliases.sort((a,b)=>a.campusKey.localeCompare(b.campusKey)||a.rawName.localeCompare(b.rawName));
  result.unitAliases.sort((a,b)=>a.grid.localeCompare(b.grid)||a.unit.localeCompare(b.unit));
  result.schoolGeography.sort((a,b)=>a.campusKey.localeCompare(b.campusKey));
  result.provinces.sort((a,b)=>a.adcode.localeCompare(b.adcode));result.cities.sort((a,b)=>a.adcode.localeCompare(b.adcode));
  result.sources.sort((a,b)=>a.sourceKey.localeCompare(b.sourceKey));
  if(result.companyCandidates){result.companyCandidates.candidates.sort((a,b)=>a.candidateKey.localeCompare(b.candidateKey));for(const row of result.companyCandidates.candidates)row.references.sort((a,b)=>a.factKey.localeCompare(b.factKey));result.companyCandidates.sources.sort((a,b)=>a.sourceKey.localeCompare(b.sourceKey));}
  return result;
}

export function buildGridMapCatalog(rosterInput:unknown,geographyInput:unknown,version?:string,candidatesInput?:unknown):GridMapCatalog {
  const dataset=normalizedDataset(adaptRosterHandoff(rosterInput));
  const roster=z.object({schoolAliases:z.array(mapSchoolAliasSchema),unitAliases:z.array(mapUnitAliasSchema.omit({companyKeys:true})),
    aggregates:z.array(z.object({grid:label,unitRaw:label,unitName:label,unitKey:key}))}).parse(rosterInput);
  const geography=z.object({datasetKey:key,schoolGeography:z.array(mapSchoolGeographySchema),provinces:z.array(mapRegionSchema),cities:z.array(mapRegionSchema),
    sources:z.array(z.object({sourceKey:key,title:label,sourceUrl:url.nullable(),note:text})).default([])}).parse(geographyInput);
  const activeCampuses=new Set(dataset.schoolOutcomes.map(row=>row.campusKey));
  const geoKeys=new Set(geography.schoolGeography.map(row=>row.campusKey));
  if([...activeCampuses].some(campus=>!geoKeys.has(campus)))throw new Error('GRID_MAP_GEOGRAPHY_CAMPUS_MISSING');
  const unitAliases=roster.unitAliases.map(row=>({...row,companyKeys:[...new Set(roster.aggregates.filter(a=>a.grid===row.grid&&(a.unitRaw===row.unit||a.unitName===row.standardized_unit)).map(a=>a.unitKey))].sort()}));
  const unitKeys=new Set(unitAliases.flatMap(row=>row.companyKeys));
  if(dataset.schoolOutcomes.some(row=>!unitKeys.has(row.companyKey)))throw new Error('GRID_MAP_UNIT_ALIAS_MISSING');
  const companyCandidates=candidatesInput?companyCandidatePackageSchema.parse(candidatesInput):null;
  return normalizeGridMapCatalog({schemaVersion:'grid-map-catalog-1',datasetKey:dataset.datasetKey,rosterVersion:dataset.version,version:version??`map-${gridChecksum({geography,companyCandidates}).slice(0,24)}`,
    rosterChecksumSha256:gridChecksum(dataset),schoolAliases:roster.schoolAliases,unitAliases,schoolGeography:geography.schoolGeography,provinces:geography.provinces,cities:geography.cities,sources:geography.sources,companyCandidates});
}
