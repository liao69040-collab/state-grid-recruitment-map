import type { GridMapCatalog } from './grid-map-catalog.js';
import type { GridSnapshot } from './grid-query.js';
import { containsPrivateSourceReference, type PrivateSourceIndex } from './private-source-boundary.js';

// Source visibility belongs before grouping, privacy thresholds and pagination.
// Never mutate an imported snapshot: administrators and checksum verification
// must retain the original data. Visibility can change without an import, so it
// is part of both projection cache keys, not just the dataset version.
const signature = (index: PrivateSourceIndex) => JSON.stringify([
  [...index.ids].sort(), [...index.keys].sort(),
]);
const snapshotCache = new WeakMap<GridSnapshot, { signature: string; result: GridSnapshot }>();
export function gridSnapshotForMemberSources(snapshot: GridSnapshot, index: PrivateSourceIndex): GridSnapshot {
  const key = signature(index), cached = snapshotCache.get(snapshot);
  if (cached?.signature === key) return cached.result;
  const unchangedVersions = new Set<string>();
  let changed = false;
  const datasets = snapshot.datasets.flatMap(dataset => {
    const sources = dataset.sources.filter(row => !containsPrivateSourceReference(row, index));
    const sourceKeys = new Set(sources.map(row => row.sourceKey));
    const allowed = (row: { sourceKey: string }) => sourceKeys.has(row.sourceKey) && !containsPrivateSourceReference(row, index);
    const policyFacts = dataset.policyFacts.filter(allowed);
    const schoolOutcomes = dataset.schoolOutcomes.filter(allowed);
    if (sources.length === dataset.sources.length && policyFacts.length === dataset.policyFacts.length && schoolOutcomes.length === dataset.schoolOutcomes.length) {
      unchangedVersions.add(`${dataset.datasetKey}\0${dataset.version}`);
      return [dataset];
    }
    changed = true;
    return sources.length ? [{ ...dataset, sources, policyFacts, schoolOutcomes }] : [];
  });
  // Original version counts/checksums describe the complete import, not this
  // audience projection. Omit affected version metadata rather than expose
  // restricted row counts or invent a replacement import checksum.
  const result = changed ? { datasets, versions: snapshot.versions.filter(row => unchangedVersions.has(`${row.datasetKey}\0${row.version}`)) } : snapshot;
  snapshotCache.set(snapshot, { signature: key, result });
  return result;
}

const catalogCache = new WeakMap<GridMapCatalog[], { snapshot: GridSnapshot; signature: string; result: GridMapCatalog[] }>();
export function gridCatalogsForMemberSources(catalogs: GridMapCatalog[], snapshot: GridSnapshot, index: PrivateSourceIndex): GridMapCatalog[] {
  const key = signature(index), cached = catalogCache.get(catalogs);
  if (cached?.snapshot === snapshot && cached.signature === key) return cached.result;
  const factKeys = new Set(snapshot.datasets.flatMap(dataset => dataset.policyFacts.map(row => `${row.sourceKey}\0${row.factKey}`)));
  let changed = false;
  const result = catalogs.map(catalog => {
    const sources = catalog.sources.filter(row => !containsPrivateSourceReference(row, index));
    const pack = catalog.companyCandidates;
    let companyCandidates = pack;
    if (pack) {
      const candidateSources = pack.sources.filter(row => !containsPrivateSourceReference(row, index));
      const sourceKeys = new Set(candidateSources.map(row => row.sourceKey));
      let referencesChanged = false;
      const candidates = pack.candidates.flatMap(candidate => {
        const references = candidate.references.filter(row => sourceKeys.has(row.sourceKey) &&
          factKeys.has(`${row.sourceKey}\0${row.factKey}`) && !containsPrivateSourceReference(row, index));
        if (references.length === candidate.references.length) return [candidate];
        referencesChanged = true;
        return references.length ? [{ ...candidate, references }] : [];
      });
      if (referencesChanged || candidateSources.length !== pack.sources.length) {
        companyCandidates = candidates.length ? { ...pack, sources: candidateSources, candidates } : null;
      }
    }
    if (sources.length === catalog.sources.length && companyCandidates === pack) return catalog;
    changed = true;
    return { ...catalog, sources, companyCandidates };
  });
  const projected = changed ? result : catalogs;
  catalogCache.set(catalogs, { snapshot, signature: key, result: projected });
  return projected;
}
