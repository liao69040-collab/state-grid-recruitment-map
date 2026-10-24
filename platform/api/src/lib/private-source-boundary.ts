// Only this explicit collection/marker is isolated. Historical D-tier Excel
// references remain usable by the existing reference-only eligibility engine.
export const PRIVATE_SOURCE_PREFIX = 'DEMO-PRIVATE-';
type Row = Record<string, unknown>;
const object = (value: unknown): Row =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};

export function isAdminOnlySource(row: Row): boolean {
  return String(row.sourceKey ?? row.source_key ?? row.source_id ?? '').startsWith(PRIVATE_SOURCE_PREFIX) ||
    object(row.metadata).visibility === 'admin_only';
}

export type PrivateSourceIndex = { ids: Set<string>; keys: Set<string> };
export function privateSourceIndex(rows: Row[]): PrivateSourceIndex {
  const restricted = rows.filter(isAdminOnlySource);
  return {
    ids: new Set(restricted.flatMap(row => typeof row.id === 'string' ? [row.id] : [])),
    keys: new Set(restricted.flatMap(row => typeof row.sourceKey === 'string' ? [row.sourceKey] : [])),
  };
}

const sourceReferenceField = (key: string) =>
  /source(?:document)?(?:id|ids|key|keys)$/.test(key.replace(/_/g, '').toLowerCase());

export function sourceReferenceValues(value: unknown): string[] {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap(sourceReferenceValues);
  return Object.entries(value).flatMap(([key, entry]) => [
    ...(sourceReferenceField(key) ? (Array.isArray(entry) ? entry : [entry]).filter((item): item is string => typeof item === 'string') : []),
    ...sourceReferenceValues(entry),
  ]);
}

// Walk source-reference fields only; never classify prose or arbitrary numbers
// as identifiers. Nested metadata/profile/payload references are included.
export function containsPrivateSourceReference(value: unknown, index: PrivateSourceIndex): boolean {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(item => containsPrivateSourceReference(item, index));
  const row = value as Row;
  if (isAdminOnlySource(row)) return true;
  return Object.entries(row).some(([key, entry]) => {
    if (sourceReferenceField(key)) {
      const values = Array.isArray(entry) ? entry : [entry];
      if (values.some(item => typeof item === 'string' &&
        (item.startsWith(PRIVATE_SOURCE_PREFIX) || index.ids.has(item) || index.keys.has(item)))) return true;
    }
    return containsPrivateSourceReference(entry, index);
  });
}

// A row's own provenance (including its metadata) gates the whole row. Containers
// are traversed independently, so one rejected metric does not erase safe peers.
export function isPrivateMaterialRow(row: Row, index: PrivateSourceIndex): boolean {
  if (isAdminOnlySource(row)) return true;
  const provenance = Object.fromEntries(Object.entries(row).filter(([key]) =>
    sourceReferenceField(key) || key === 'metadata'));
  return containsPrivateSourceReference(provenance, index);
}

export function publicSourceRows<T extends Row>(rows: T[], index: PrivateSourceIndex): T[] {
  return rows.filter(row => !isPrivateMaterialRow(row, index));
}

export function stripPrivateSourceMaterial(value: unknown, index: PrivateSourceIndex): unknown {
  if (Array.isArray(value)) return value.map(item => stripPrivateSourceMaterial(item, index)).filter(item => item !== undefined);
  if (!value || typeof value !== 'object' || value instanceof Date) return value;
  const row = value as Row;
  if (isPrivateMaterialRow(row, index)) return undefined;
  return Object.fromEntries(Object.entries(row).flatMap(([key, entry]) => {
    const safe = stripPrivateSourceMaterial(entry, index);
    return safe === undefined ? [] : [[key, safe]];
  }));
}

export function pinPrivateSource(input: Row, existing?: Row | null): Row {
  if (!isAdminOnlySource(input) && !isAdminOnlySource(existing ?? {})) return input;
  if (existing && input.sourceKey !== undefined && input.sourceKey !== existing.sourceKey) {
    throw new Error('PRIVATE_SOURCE_KEY_IMMUTABLE');
  }
  const sourceType = input.sourceType ?? existing?.sourceType;
  if (!['reference', 'provided_nonofficial_image'].includes(String(sourceType))) {
    throw new Error('PRIVATE_SOURCE_TYPE_INVALID');
  }
  return {
    ...input,
    officialUrl: null,
    status: 'pending_reference_verification',
    metadata: {
      ...object(existing?.metadata), ...object(input.metadata),
      visibility: 'admin_only', publicMetricEligible: false, eligibilityEngineEligible: false,
    },
  };
}

// Source summaries reach ordinary authorized users. Never spread arbitrary
// archive metadata: download URLs, tokens, paths, OCR and raw cells stay admin-only.
export function publicSourceMetadata(value: unknown): Row {
  const metadata = object(value);
  const result: Row = {};
  for (const key of ['dataset_id', 'evidenceTier', 'evidence_tier', 'sourceKind', 'mediaType', 'mimeType']) {
    if (typeof metadata[key] === 'string') result[key] = metadata[key];
  }
  for (const key of ['pageCount', 'bytes', 'officialEvidenceVerified']) {
    if (typeof metadata[key] === 'number' || typeof metadata[key] === 'boolean') result[key] = metadata[key];
  }
  return result;
}
