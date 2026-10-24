import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { adaptRosterHandoff } from '../src/lib/grid-roster-adapter.js';
import { gridChecksum } from '../src/lib/grid-query.js';
import { importGridDataset, normalizedDataset } from '../src/lib/grid-query-import.js';

const args=process.argv.slice(2);
const apply=args.includes('--apply');
const files=args.filter(arg=>!arg.startsWith('--'));
if(files.length!==1||args.some(arg=>arg.startsWith('--')&&arg!=='--apply'))throw new Error('Usage: import-grid-query /absolute/summary-package.json [--apply]');
const raw=JSON.parse(await readFile(resolve(files[0]!),'utf8'));
const dataset=normalizedDataset(raw.schemaVersion==='roster-handoff-1'?adaptRosterHandoff(raw):raw);
const summary={mode:apply?'apply':'validate_only',datasetKey:dataset.datasetKey,version:dataset.version,sourceCount:dataset.sources.length,factCount:dataset.policyFacts.length,outcomeCount:dataset.schoolOutcomes.length,checksumSha256:gridChecksum(dataset)};
if(!apply){process.stdout.write(`${JSON.stringify(summary)}\n`);}else{
  if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL required for --apply');
  const pool=new Pool({connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:5000});
  const client=await pool.connect();
  try {process.stdout.write(`${JSON.stringify({...summary,...await importGridDataset(client,dataset)})}\n`);}
  finally{client.release();await pool.end();}
}
