import type { PoolClient } from 'pg';
import { gridCanonical, gridChecksum, gridDatasetSchema, type GridDataset } from './grid-query.js';
import { recruitmentTextIssues } from './recruitment-display-text.js';

type Client = Pick<PoolClient,'query'>;
async function storedDataset(client:Client,id:string):Promise<GridDataset> {
  const meta=(await client.query('SELECT dataset_key, version, title, created_at, notes, source_count, fact_count, outcome_count FROM grid_dataset_versions WHERE id=$1',[id])).rows[0];
  if(!meta)throw new Error('GRID_VERSION_NOT_FOUND');
  const sources=(await client.query('SELECT payload FROM grid_query_sources WHERE version_id=$1 ORDER BY source_key',[id])).rows.map(r=>r.payload);
  const policyFacts=(await client.query('SELECT payload FROM grid_policy_facts WHERE version_id=$1 ORDER BY fact_key',[id])).rows.map(r=>r.payload);
  const schoolOutcomes=(await client.query('SELECT payload FROM grid_school_outcomes WHERE version_id=$1 ORDER BY outcome_key',[id])).rows.map(r=>r.payload);
  if(meta.source_count!==sources.length||meta.fact_count!==policyFacts.length||meta.outcome_count!==schoolOutcomes.length)throw new Error('GRID_STORED_COUNT_MISMATCH');
  return normalizedDataset({schemaVersion:'grid-query-1',datasetKey:meta.dataset_key,version:meta.version,title:meta.title,createdAt:new Date(meta.created_at).toISOString(),notes:meta.notes,sources,policyFacts,schoolOutcomes});
}
export function normalizedDataset(input:unknown):GridDataset {
  const dataset=gridDatasetSchema.parse(input);
  dataset.createdAt=new Date(dataset.createdAt).toISOString();
  dataset.sources.sort((a,b)=>a.sourceKey.localeCompare(b.sourceKey));
  dataset.policyFacts.sort((a,b)=>a.factKey.localeCompare(b.factKey));
  dataset.schoolOutcomes.sort((a,b)=>a.outcomeKey.localeCompare(b.outcomeKey));
  return dataset;
}
// Every invocation owns its transaction. Additive tables only; no seed/reset,
// no calls to user, legacy source, metric, account or permission mutations.
export async function importGridDataset(client:Client,input:unknown) {
  const dataset=normalizedDataset(input),checksum=gridChecksum(dataset);
  await client.query('BEGIN');
  try {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('grid-query-import-v1'))");
    const prior=(await client.query('SELECT id,checksum_sha256,active FROM grid_dataset_versions WHERE dataset_key=$1 AND version=$2 FOR UPDATE',[dataset.datasetKey,dataset.version])).rows[0];
    if(prior){
      if(prior.checksum_sha256!==checksum)throw new Error('GRID_VERSION_CONTENT_CONFLICT');
      if(gridChecksum(await storedDataset(client,prior.id))!==checksum)throw new Error('GRID_STORED_CONTENT_MISMATCH');
      // Re-importing an old version does not silently roll the active one back.
      await client.query('COMMIT');
      return {datasetKey:dataset.datasetKey,version:dataset.version,checksumSha256:checksum,inserted:false,active:prior.active,sourceCount:dataset.sources.length,factCount:dataset.policyFacts.length,outcomeCount:dataset.schoolOutcomes.length};
    }
    // Never rewrite frozen source text or hashes. New versions must explicitly
    // quarantine unresolved images/errors instead of publishing a formula as prose.
    const invalid = dataset.policyFacts.filter(f => f.dataStatus === 'reference' &&
      [...recruitmentTextIssues(f.title), ...recruitmentTextIssues(f.text)].length);
    if(invalid.length)throw new Error(`GRID_TEXT_ARTIFACT_REQUIRES_QUARANTINE:${invalid.map(f=>f.factKey).join(',')}`);
    const outcomeSources=new Set(dataset.schoolOutcomes.map(row=>row.sourceKey));
    const outcomeHashes=dataset.sources.filter(source=>outcomeSources.has(source.sourceKey)).map(source=>source.sha256);
    if(outcomeHashes.length){
      const overlaps=await client.query(`SELECT DISTINCT s.source_key FROM grid_query_sources s JOIN grid_dataset_versions v ON v.id=s.version_id
        WHERE v.active=true AND v.dataset_key<>$1 AND s.payload->>'sha256'=ANY($2::text[])
        AND EXISTS(SELECT 1 FROM grid_school_outcomes o WHERE o.version_id=s.version_id AND o.source_key=s.source_key)`,[dataset.datasetKey,outcomeHashes]);
      if(overlaps.rowCount)throw new Error('GRID_ACTIVE_ROSTER_SOURCE_OVERLAP');
    }
    // A source claims provenance, never authority. Existing official records may
    // be linked only if they exist, are not admin-private and have official URL.
    for(const f of dataset.policyFacts)if(f.relatedOfficialSourceKey){
      const linked=(await client.query("SELECT source_key FROM source_documents WHERE source_key=$1 AND official_url LIKE 'https://%' AND source_type IN ('official_notice','official_announcement','official') AND COALESCE(metadata->>'visibility','') <> 'admin_only'",[f.relatedOfficialSourceKey])).rows;
      if(linked.length!==1)throw new Error('GRID_OFFICIAL_LINK_NOT_VERIFIED');
    }
    const version=(await client.query('INSERT INTO grid_dataset_versions(dataset_key,version,title,created_at,checksum_sha256,active,source_count,fact_count,outcome_count,notes) VALUES($1,$2,$3,$4,$5,false,$6,$7,$8,$9::jsonb) RETURNING id',[
      dataset.datasetKey,dataset.version,dataset.title,dataset.createdAt,checksum,dataset.sources.length,dataset.policyFacts.length,dataset.schoolOutcomes.length,JSON.stringify(dataset.notes),])).rows[0];
    const id=version.id as string;
    for(const source of dataset.sources)await client.query('INSERT INTO grid_query_sources(version_id,source_key,payload) VALUES($1,$2,$3::jsonb)',[id,source.sourceKey,JSON.stringify(source)]);
    for(let offset=0;offset<dataset.policyFacts.length;offset+=500){
      const chunk=dataset.policyFacts.slice(offset,offset+500);
      await client.query(`INSERT INTO grid_policy_facts(version_id,fact_key,source_key,cohort_year,province,city,batch_code,data_status,payload)
        SELECT $1::uuid,x->>'factKey',x->>'sourceKey',(x->>'cohortYear')::int,x->>'province',x->>'city',x->>'batchCode',x->>'dataStatus',x FROM jsonb_array_elements($2::jsonb) x`,[id,JSON.stringify(chunk)]);
    }
    for(let offset=0;offset<dataset.schoolOutcomes.length;offset+=500){
      const chunk=dataset.schoolOutcomes.slice(offset,offset+500);
      await client.query(`INSERT INTO grid_school_outcomes(version_id,outcome_key,source_key,cohort_year,grid,batch_code,province,org_category,parent_school_key,campus_key,record_count,payload)
        SELECT $1::uuid,x->>'outcomeKey',x->>'sourceKey',(x->>'cohortYear')::int,x->>'grid',x->>'batchCode',x->>'province',x->>'orgCategory',x->>'parentSchoolKey',x->>'campusKey',(x->>'recordCount')::int,x FROM jsonb_array_elements($2::jsonb) x`,[id,JSON.stringify(chunk)]);
    }
    const readback=await storedDataset(client,id);
    if(gridCanonical(readback)!==gridCanonical(dataset))throw new Error('GRID_IMPORT_READBACK_MISMATCH');
    await client.query('UPDATE grid_dataset_versions SET active=false WHERE dataset_key=$1 AND active=true',[dataset.datasetKey]);
    await client.query('UPDATE grid_dataset_versions SET active=true WHERE id=$1',[id]);
    await client.query('COMMIT');
    return {datasetKey:dataset.datasetKey,version:dataset.version,checksumSha256:checksum,inserted:true,active:true,sourceCount:dataset.sources.length,factCount:dataset.policyFacts.length,outcomeCount:dataset.schoolOutcomes.length};
  }catch(error){await client.query('ROLLBACK');throw error;}
}
