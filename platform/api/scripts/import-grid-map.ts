import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { buildGridMapCatalog } from '../src/lib/grid-map-catalog.js';
import { gridChecksum } from '../src/lib/grid-query.js';
import { importGridMapCatalog } from '../src/lib/grid-map-import.js';

const args=process.argv.slice(2),apply=args.includes('--apply'),files=args.filter(arg=>!arg.startsWith('--'));
if(![2,3].includes(files.length)||args.some(arg=>arg.startsWith('--')&&arg!=='--apply'))throw new Error('Usage: import-grid-map /absolute/roster_aggregates.json /absolute/school-geography.json [/absolute/company-candidates.json] [--apply]');
const [roster,geography,candidates]=await Promise.all(files.map(async path=>JSON.parse(await readFile(resolve(path),'utf8'))));
const catalog=buildGridMapCatalog(roster,geography,undefined,candidates);
const summary={mode:apply?'apply':'validate_only',datasetKey:catalog.datasetKey,version:catalog.version,checksumSha256:gridChecksum(catalog),schoolAliasCount:catalog.schoolAliases.length,unitAliasCount:catalog.unitAliases.length,schoolGeographyCount:catalog.schoolGeography.length,provinceCount:catalog.provinces.length,cityCount:catalog.cities.length,companyCandidateCount:catalog.companyCandidates?.candidates.length??0};
if(!apply)process.stdout.write(`${JSON.stringify(summary)}\n`);
else{
  if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL required for --apply');
  const pool=new Pool({connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:5000}),client=await pool.connect();
  try{process.stdout.write(`${JSON.stringify({...summary,...await importGridMapCatalog(client,catalog)})}\n`);}finally{client.release();await pool.end();}
}
