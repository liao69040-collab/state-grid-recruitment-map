import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { gridChecksum } from '../src/lib/grid-query.js';
import { importGridDataset } from '../src/lib/grid-query-import.js';
import { normalizedGridInformationSupplement } from '../src/lib/grid-information-import.js';

const args=process.argv.slice(2), apply=args.includes('--apply'), files=args.filter(a=>!a.startsWith('--'));
if(files.length !== 1 || args.some(a=>a.startsWith('--') && a !== '--apply')) throw new Error('Usage: import-grid-information /absolute/reviewed-supplement.json [--apply]');
const dataset=normalizedGridInformationSupplement(JSON.parse(await readFile(resolve(files[0]!),'utf8')));
const receipt={mode:apply?'apply':'validate_only',datasetKey:dataset.datasetKey,version:dataset.version,factCount:dataset.policyFacts.length,outcomeCount:0,checksumSha256:gridChecksum(dataset)};
if(!apply)process.stdout.write(`${JSON.stringify(receipt)}\n`);
else {
  if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL required for --apply');
  const pool=new Pool({connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:5000});
  const client=await pool.connect();
  try{process.stdout.write(`${JSON.stringify({...receipt,...await importGridDataset(client,dataset)})}\n`);}
  finally{client.release();await pool.end();}
}
