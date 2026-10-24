import { z } from 'zod';
import { photoMaterialsData } from './photo-materials-data-20261005.js';
import { containsPrivateSourceReference, privateSourceIndex } from './private-source-boundary.js';

// Server-only reading references. Never used by eligibility, official-policy
// matching, rankings, record counts or public routes. Original photos remain
// outside the website image mounts and client bundles.
const sourceSchema = z.object({ sourceKey: z.string().min(1), title: z.string().min(1),
  cohortYear: z.literal(2026).nullable(), sha256: z.string().regex(/^[a-f0-9]{64}$/), note: z.string().min(1) }).strict();
const evidenceSchema = z.object({ sourceKey: z.string().min(1), evidenceLocator: z.string().min(1) });
const entrySchema = z.object({ label: z.string().min(1), score: z.number().gt(0).max(100), qualifier: z.string().min(1).nullable() }).strict();
const columnSchema = evidenceSchema.extend({ key: z.enum(['batch_1','batch_2','batch_3_sc','supply_service']),
  title: z.string().min(1), batchCode: z.enum(['batch_1','batch_2','batch_3']).nullable(),
  segment: z.enum(['main','sc','supply_service']), status: z.enum(['recorded','slash','empty','not_threshold']),
  originalText: z.string(), entries: z.array(entrySchema) }).strict();
const itemSchema = evidenceSchema.extend({ key: z.string().min(1), label: z.string().min(1), text: z.string().min(1),
  kind: z.enum(['material','english','computer']), strength: z.enum(['required','preferred','reference']) }).strict();
const locationSchema = evidenceSchema.extend({ address: z.string().min(1), sourceYear: z.null(), batchCode: z.null() }).strict();
const unitSchema = z.object({ unitKey: z.string().min(1), unitName: z.string().min(1), adcode: z.string().regex(/^\d{6}$/).nullable(),
  examLocation: locationSchema.nullable(), columns: z.array(columnSchema), items: z.array(itemSchema) }).strict();
const dataSchema = z.object({ schemaVersion: z.literal('grid-photo-material-data-1'), sources: z.array(sourceSchema), units: z.array(unitSchema) }).strict();
const data = dataSchema.parse(photoMaterialsData);
const sourceKeys = new Set(data.sources.map(source => source.sourceKey));
if (sourceKeys.size !== data.sources.length || new Set(data.units.map(unit => unit.unitKey)).size !== data.units.length) throw new Error('Duplicate photo material identities');
for (const unit of data.units) {
  if (new Set(unit.columns.map(column => column.key)).size !== unit.columns.length || new Set(unit.items.map(item => item.key)).size !== unit.items.length) throw new Error('Duplicate photo material scope');
  for (const row of [...unit.columns,...unit.items,...(unit.examLocation ? [unit.examLocation] : [])]) if (!sourceKeys.has(row.sourceKey)) throw new Error('Unknown photo material source');
  for (const column of unit.columns) {
    const expected = column.key === 'supply_service' ? [null,'supply_service'] : column.key === 'batch_3_sc' ? ['batch_3','sc'] : [column.key,'main'];
    if (column.batchCode !== expected[0] || column.segment !== expected[1] || (column.status === 'recorded') !== (column.entries.length > 0)) throw new Error('Invalid written score stage or segment');
  }
}
type Sources = Record<string,unknown>[];
type PhotoSource = z.infer<typeof sourceSchema>;
type PhotoLocation = z.infer<typeof locationSchema> & { unitKey:string; unitName:string };
type PhotoScoreGroup = { unitKey:string; unitName:string; columns:z.infer<typeof columnSchema>[] };
export type PhotoRequirementGroup = { unitKey:string; unitName:string; items:z.infer<typeof itemSchema>[] };
export type PhotoProvinceSupplement = { schemaVersion:'grid-photo-supplement-1'; cohortYear:2026; status:'historical_reference';
  examLocations:PhotoLocation[]; scoreGroups:PhotoScoreGroup[]; requirementGroups:PhotoRequirementGroup[]; sources:PhotoSource[] };

function visible(sources:Sources) {
  const index = privateSourceIndex(sources);
  return (row:{sourceKey:string}) => !containsPrivateSourceReference(row,index);
}
function referencedSources(keys:string[], sources:Sources) {
  const keep = visible(sources), selected = new Set(keys);
  return data.sources.filter(source => selected.has(source.sourceKey) && keep(source)).map(source => ({...source}));
}

/** Same dated source is shown independently of existing workbook/official
 * evidence; it never overwrites it or expands a recruiting unit to its province. */
export function photoProvinceSupplement(year:number, adcode:string, sources:Sources=[]):PhotoProvinceSupplement|null {
  if (year !== 2026) return null;
  const keep = visible(sources), units = data.units.filter(unit => unit.adcode === adcode);
  const examLocations = units.flatMap(unit => unit.examLocation && keep(unit.examLocation) ? [{unitKey:unit.unitKey,unitName:unit.unitName,...unit.examLocation}] : []);
  const scoreGroups = units.flatMap(unit => {
    const columns = unit.columns.filter(keep).map(column => ({...column,entries:column.entries.map(entry => ({...entry}))}));
    return columns.length ? [{unitKey:unit.unitKey,unitName:unit.unitName,columns}] : [];
  });
  const requirementGroups = units.flatMap(unit => {
    const items = unit.items.filter(keep).map(item => ({...item}));
    return items.length ? [{unitKey:unit.unitKey,unitName:unit.unitName,items}] : [];
  });
  if (!examLocations.length && !scoreGroups.length && !requirementGroups.length) return null;
  const keys = [...examLocations,...scoreGroups.flatMap(group => group.columns),...requirementGroups.flatMap(group => group.items)].map(row => row.sourceKey);
  return {schemaVersion:'grid-photo-supplement-1',cohortYear:2026,status:'historical_reference',examLocations,scoreGroups,requirementGroups,sources:referencedSources(keys,sources)};
}

/** National units have no invented province. Only their materials appear in a
 * separate named-unit reference section on the authenticated education view. */
export function photoUnitRequirements(year:number, sources:Sources=[]) {
  if (year !== 2026) return null;
  const keep = visible(sources), groups = data.units.filter(unit => unit.adcode === null).flatMap(unit => {
    const items = unit.items.filter(keep).map(item => ({...item}));
    return items.length ? [{unitKey:unit.unitKey,unitName:unit.unitName,items}] : [];
  });
  return groups.length ? {schemaVersion:'grid-photo-supplement-1' as const,cohortYear:2026 as const,groups,
    sources:referencedSources(groups.flatMap(group => group.items.map(item => item.sourceKey)),sources)} : null;
}

/** One exact first-batch, electrical-bachelor reading reference for each named
 * unit. School-qualified alternatives stay in details; no sorting/decision. */
export function photoCardScores(year:number, sources:Sources=[]) {
  if (year !== 2026) return [];
  const keep = visible(sources);
  return data.units.flatMap(unit => {
    if (!unit.adcode) return [];
    const column = unit.columns.find(column => column.key === 'batch_1' && column.status === 'recorded' && keep(column));
    const entries = column?.entries.filter(entry => entry.label === '电工类本科' && entry.qualifier === null) ?? [];
    if (!column || entries.length !== 1) return [];
    return [{unitKey:unit.unitKey,unitName:unit.unitName,adcode:unit.adcode,sourceYear:2026 as const,batchCode:'batch_1' as const,
      label:entries[0]!.label,score:entries[0]!.score,qualifier:entries[0]!.qualifier,sourceKey:column.sourceKey}];
  });
}
