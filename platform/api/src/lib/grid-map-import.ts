import type { PoolClient } from 'pg';
import { gridChecksum } from './grid-query.js';
import { normalizeGridMapCatalog } from './grid-map-catalog.js';

export async function importGridMapCatalog(client:Pick<PoolClient,'query'>,input:unknown){
  const catalog=normalizeGridMapCatalog(input),checksum=gridChecksum(catalog);
  await client.query('BEGIN');
  try{
    await client.query("SELECT pg_advisory_xact_lock(hashtext('grid-map-catalog-import-v1'))");
    const dataset=(await client.query('SELECT id,checksum_sha256,active FROM grid_dataset_versions WHERE dataset_key=$1 AND version=$2 FOR SHARE',[catalog.datasetKey,catalog.rosterVersion])).rows[0];
    if(!dataset)throw new Error('GRID_MAP_ROSTER_VERSION_NOT_FOUND');
    if(dataset.checksum_sha256!==catalog.rosterChecksumSha256)throw new Error('GRID_MAP_ROSTER_CHECKSUM_MISMATCH');
    if(catalog.companyCandidates){
      const sourceKeys=catalog.companyCandidates.sources.map(source=>source.sourceKey);
      const sources=(await client.query('SELECT s.source_key,s.payload FROM grid_query_sources s JOIN grid_dataset_versions v ON v.id=s.version_id WHERE v.active=true AND s.source_key=ANY($1::text[])',[sourceKeys])).rows;
      for(const source of catalog.companyCandidates.sources)if(!sources.some(row=>row.source_key===source.sourceKey&&row.payload.sha256===source.sha256))throw new Error('GRID_MAP_CANDIDATE_SOURCE_MISMATCH');
      const facts=(await client.query('SELECT f.fact_key,f.source_key,f.payload FROM grid_policy_facts f JOIN grid_dataset_versions v ON v.id=f.version_id WHERE v.active=true AND f.source_key=ANY($1::text[])',[sourceKeys])).rows;
      const indexed=new Map(facts.map(row=>[`${row.source_key}:${row.fact_key}`,row.payload]));
      for(const candidate of catalog.companyCandidates.candidates)for(const ref of candidate.references){
        const fact=indexed.get(`${ref.sourceKey}:${ref.factKey}`);
        if(!fact||fact.company!==candidate.name||fact.cohortYear!==ref.cohortYear||fact.batchCode!==ref.batchCode||fact.dataStatus!==ref.dataStatus)throw new Error('GRID_MAP_CANDIDATE_FACT_MISMATCH');
      }
    }
    const prior=(await client.query('SELECT id,checksum_sha256,active,payload FROM grid_map_catalogs WHERE dataset_version_id=$1 AND version=$2 FOR UPDATE',[dataset.id,catalog.version])).rows[0];
    const summary={datasetKey:catalog.datasetKey,rosterVersion:catalog.rosterVersion,version:catalog.version,checksumSha256:checksum,schoolAliasCount:catalog.schoolAliases.length,unitAliasCount:catalog.unitAliases.length,schoolGeographyCount:catalog.schoolGeography.length,companyCandidateCount:catalog.companyCandidates?.candidates.length??0};
    if(prior){
      if(prior.checksum_sha256!==checksum)throw new Error('GRID_MAP_VERSION_CONTENT_CONFLICT');
      if(gridChecksum(normalizeGridMapCatalog(prior.payload))!==checksum)throw new Error('GRID_MAP_STORED_CONTENT_MISMATCH');
      await client.query('COMMIT');return {...summary,inserted:false,active:prior.active&&dataset.active};
    }
    const inserted=(await client.query('INSERT INTO grid_map_catalogs(dataset_version_id,version,checksum_sha256,active,payload) VALUES($1,$2,$3,false,$4::jsonb) RETURNING id,payload',[dataset.id,catalog.version,checksum,JSON.stringify(catalog)])).rows[0];
    if(gridChecksum(normalizeGridMapCatalog(inserted.payload))!==checksum)throw new Error('GRID_MAP_IMPORT_READBACK_MISMATCH');
    await client.query('UPDATE grid_map_catalogs SET active=false WHERE dataset_version_id=$1 AND active=true',[dataset.id]);
    await client.query('UPDATE grid_map_catalogs SET active=true WHERE id=$1',[inserted.id]);
    await client.query('COMMIT');return {...summary,inserted:true,active:dataset.active};
  }catch(error){await client.query('ROLLBACK');throw error;}
}
