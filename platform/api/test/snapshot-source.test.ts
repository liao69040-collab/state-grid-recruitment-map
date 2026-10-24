import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseSnapshotSource } from '../src/lib/snapshot-source.js';

describe('snapshot source hashing', () => {
  it('returns the SHA-256 of the exact imported bytes with the parsed payload', () => {
    const source = Buffer.from('{"nested":{"value":1},"items":["a","b"]}\n', 'utf8');
    const result = parseSnapshotSource(source, 'snapshot.json');

    expect(result.payload).toEqual({ nested: { value: 1 }, items: ['a', 'b'] });
    expect(result.sourceSha256).toBe(createHash('sha256').update(source).digest('hex'));
    expect(result.sourceSha256).toHaveLength(64);
  });

  it('rejects non-object JSON snapshots', () => {
    expect(() => parseSnapshotSource(Buffer.from('[1,2,3]'), 'snapshot.json')).toThrow(
      'Snapshot must be a JSON object: snapshot.json',
    );
  });
});
