import type { LocationQuery, LocationQueryRaw, Router } from 'vue-router';

export type MobileQueryPatch = Record<string, string | number | string[] | null | undefined>;
export type MobileEntityLink = { kind: 'school' | 'company'; key: string };
export type InformationView = {
  kind: 'province' | 'facts' | 'entity' | 'campuses' | 'metric';
  adcode?: string; key?: string; entity?: MobileEntityLink;
  keys?: string[]; title?: string; query?: Record<string, string>; page?: number; batch?: string;
};
const historyKey = 'mobileViewAncestors';
const entityKey = /^[A-Za-z0-9_.:-]{1,160}$/;
const informationFilterKeys = new Set('q province city company cohortYear grid batchCode schoolTier educationLevel category orgCategory industryTag view'.split(' '));

export function queryText(query: LocationQuery, key: string): string {
  return typeof query[key] === 'string' ? query[key] as string : '';
}

export function queryTrail<T>(query: LocationQuery, key: string, valid: (value: unknown) => value is T): T[] {
  const raw = query[key];
  const values = Array.isArray(raw) ? raw : raw ? [raw] : [];
  if (values.length > 32) return [];
  try {
    const decoded: unknown[] = values.map(value => JSON.parse(value || 'null'));
    return decoded.every(valid) ? decoded as T[] : [];
  } catch { return []; }
}

export function isEntityLink(value: unknown): value is MobileEntityLink {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['kind', 'key'].includes(key))) return false;
  const item = value as MobileEntityLink;
  return (item.kind === 'school' || item.kind === 'company') && typeof item.key === 'string' && entityKey.test(item.key);
}

export function isInformationView(value: unknown): value is InformationView {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as InformationView;
  if (!['province', 'facts', 'entity', 'campuses', 'metric'].includes(item.kind)) return false;
  if (Object.keys(item).some(key => !['kind', 'adcode', 'key', 'entity', 'keys', 'title', 'query', 'page', 'batch'].includes(key))) return false;
  if (item.title !== undefined && (typeof item.title !== 'string' || item.title.length > 200)) return false;
  if (item.batch !== undefined && (typeof item.batch !== 'string' || item.batch.length > 60)) return false;
  if (item.page !== undefined && (!Number.isInteger(item.page) || item.page < 1 || item.page > 10000)) return false;
  if (item.query !== undefined && (!item.query || typeof item.query !== 'object' || Array.isArray(item.query) || Object.entries(item.query).some(([key, text]) => !informationFilterKeys.has(key) || typeof text !== 'string' || text.length > 300))) return false;
  if (item.kind === 'province') return typeof item.adcode === 'string' && /^\d{6}$/.test(item.adcode);
  if (item.kind === 'entity') return isEntityLink(item.entity);
  if (item.kind === 'campuses') return Array.isArray(item.keys) && item.keys.length <= 64 && item.keys.every(key => typeof key === 'string' && entityKey.test(key));
  if (item.kind === 'metric') return typeof item.key === 'string' && item.key.length > 0 && item.key.length <= 160;
  return item.kind === 'facts';
}

export function encodeTrail(values: unknown[]): string[] | null {
  return values.length ? values.map(value => JSON.stringify(value)) : null;
}

/** Vue Router owns push/pop/forward and refresh persistence. We add metadata
 * only to real user navigations, never a synthetic entry at the root. A direct
 * deep link has no trusted ancestor, so its return button replaces the URL with
 * its parent instead of guessing how far to go into another site's history. */
export function createMobileNavigation(router: Router) {
  function patched(patch: MobileQueryPatch) {
    const current = router.currentRoute.value;
    const query: LocationQueryRaw = { ...current.query };
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === undefined || value === '' || Array.isArray(value) && !value.length) delete query[key];
      else query[key] = value;
    }
    return { path: current.path, query, hash: current.hash };
  }
  function identity(fullPath: string): string {
    const route = router.resolve(fullPath);
    return JSON.stringify([route.path, route.hash, Object.keys(route.query).sort().map(key => [key, route.query[key]])]);
  }
  function ancestors(): string[] {
    const state = router.options.history.state;
    const raw = state[historyKey];
    if (!Array.isArray(raw) || raw.length > 64 || !raw.every(value => typeof value === 'string' && router.resolve(value).path === router.currentRoute.value.path)) return [];
    if (!raw.length || typeof state.back === 'string' && identity(raw[raw.length - 1] as string) !== identity(state.back)) return [];
    return raw as string[];
  }
  async function update(patch: MobileQueryPatch, replace = false) {
    const target = patched(patch);
    if (identity(router.resolve(target).fullPath) === identity(router.currentRoute.value.fullPath)) return;
    const previous = ancestors();
    if (replace) await router.replace({ ...target, state: { [historyKey]: previous } });
    else await router.push({ ...target, state: { [historyKey]: [...previous, router.currentRoute.value.fullPath].slice(-64) } });
  }
  async function returnTo(patch: MobileQueryPatch) {
    const target = patched(patch), wanted = identity(router.resolve(target).fullPath);
    if (wanted === identity(router.currentRoute.value.fullPath)) return;
    const previous = ancestors();
    const index = previous.findLastIndex(value => identity(value) === wanted);
    if (index >= 0) await goAndWait(index - previous.length);
    else await router.replace({ ...target, state: { [historyKey]: previous } });
  }
  function goAndWait(delta: number): Promise<void> {
    return new Promise(resolve => {
      const stop = router.afterEach(() => { stop(); resolve(); });
      router.go(delta);
    });
  }
  async function previousOr(patch: MobileQueryPatch) {
    if (ancestors().length) await goAndWait(-1);
    else await returnTo(patch);
  }
  return { hasPrevious: () => ancestors().length > 0, push: (patch: MobileQueryPatch) => update(patch), replace: (patch: MobileQueryPatch) => update(patch, true), returnTo, previousOr };
}
