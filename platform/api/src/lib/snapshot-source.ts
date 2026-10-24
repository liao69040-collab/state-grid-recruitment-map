import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export interface SnapshotSource {
  payload: Record<string, unknown>;
  sourceSha256: string;
}

export function parseSnapshotSource(source: Uint8Array, path: string): SnapshotSource {
  const parsed = JSON.parse(Buffer.from(source).toString('utf8')) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Snapshot must be a JSON object: ${path}`);
  }
  return {
    payload: parsed as Record<string, unknown>,
    sourceSha256: createHash('sha256').update(source).digest('hex'),
  };
}

export async function readSnapshotSource(path: string): Promise<SnapshotSource> {
  return parseSnapshotSource(await readFile(path), path);
}
