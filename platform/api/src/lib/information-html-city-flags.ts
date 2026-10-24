import type { InformationFact } from './grid-information.js';

/** Public edition contains no customer HTML classification table.
 * Applications may add reviewed source-specific flags under their own license. */
export const htmlCityFlagSourceKey = 'demo.html.reference';
export const htmlCityFlags: readonly (readonly [string, 0 | 1 | 2])[] = [];
const clean = (value: string) => value.split(/\r?\n/).filter(line => !/^【资料年份】/.test(line)).join('\n').trim();
export function htmlCityRoute(fact: InformationFact, authorizedFacts: InformationFact[]) {
  if (fact.sourceKey !== htmlCityFlagSourceKey || fact.origin !== 'html_fallback' || fact.cohortYear !== null
    || fact.batchCode !== 'unspecified' || !['province','company'].includes(fact.scope) || fact.dataStatus !== 'reference') return null;
  const match = fact.evidenceLocator.match(/^PROVINCES\[(\d+)\]\["shiju"\]/);
  if (!match) return null;
  const index = Number(match[1]), entry = htmlCityFlags[index];
  if (!entry || entry[0] !== fact.company || entry[1] === 0 || entry[0] === '山西'
    || fact.scope !== (entry[0] === '深圳' ? 'company' : 'province')
    || fact.grid !== (index >= 27 ? 'csg' : 'sgcc')) return null;
  const scopes = authorizedFacts.filter(row => row.sourceKey === fact.sourceKey && row.origin === 'html_fallback'
    && row.dataStatus === 'reference' && row.cohortYear === null && row.batchCode === 'unspecified'
    && row.scope === fact.scope && row.grid === fact.grid && row.company === fact.company && row.province === fact.province
    && row.evidenceLocator.startsWith(`PROVINCES[${index}]["scope"]`));
  if (scopes.length !== 1 || /基本不招|完全不招/.test(clean(scopes[0]!.text))) return null;
  return { scope:scopes[0]!, flag:entry[1], label:entry[1] === 2 ? '本科市局参考（有院校限制）' : '本科市局参考',
    text:`适用地区：${clean(scopes[0]!.text)}\n市局条件：${clean(fact.text)}`,
    locators:[`PROVINCES[${index}]["bs"]`, scopes[0]!.evidenceLocator, fact.evidenceLocator, 'HTML第1143行：bsOK筛选'] };
}
