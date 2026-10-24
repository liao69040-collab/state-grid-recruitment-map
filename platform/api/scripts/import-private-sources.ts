import { open } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import {
  MAX_MANIFEST_BYTES, PrivateImportError, applyPrivateSources, parseImportOptions,
  parsePrivateManifest, planPrivateSources, validateDatabaseUrl,
} from '../src/lib/private-source-import.js';

export async function runPrivateSourceImport(args: string[], env: NodeJS.ProcessEnv = process.env) {
  const options = parseImportOptions(args);
  const file = await open(options.manifestPath, 'r');
  let bytes: Buffer;
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > MAX_MANIFEST_BYTES) throw new PrivateImportError('MANIFEST_SIZE_LIMIT');
    bytes = await file.readFile();
  } finally { await file.close(); }
  const manifest = parsePrivateManifest(bytes, options.expectedSha);
  const plan = planPrivateSources(manifest);
  if (!options.apply) return {
    mode: 'dry-run', datasetId: manifest.datasetId, manifestSha256: options.expectedSha,
    validatedSources: plan.incoming.length, databaseConnected: false, existingRowsChecked: false,
    writeExecuted: false, sourceOnly: true,
  };
  const databaseUrl = validateDatabaseUrl(env[options.databaseUrlEnv!]);
  // Deliberately no config/dotenv/client/pg import in the default dry-run path.
  const { Client } = await import('pg');
  const client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5000, query_timeout: 15_000, application_name: 'private-source-import-v1' });
  try {
    await client.connect();
    return await applyPrivateSources(client, manifest, options.expectedSha);
  } catch (error) {
    if (error instanceof PrivateImportError) throw error;
    throw new PrivateImportError('DATABASE_OPERATION_FAILED');
  } finally { await client.end().catch(() => undefined); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(await runPrivateSourceImport(process.argv.slice(2)))); }
  catch (error) {
    console.error(JSON.stringify({ status: 'failed', code: error instanceof PrivateImportError ? error.code : 'LOCAL_INPUT_FAILED', bodyLogged: false }));
    process.exitCode = 1;
  }
}
