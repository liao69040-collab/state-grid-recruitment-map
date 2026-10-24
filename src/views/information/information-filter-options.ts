/** Facets are shared with policy search. Do not use whole requirement clauses
 * or importer placeholders as school classification choices. Raw data is kept. */
const placeholder = /^(?:[\s/—–-]+|待核(?:验|定)?|未注明|未知|暂无.*)$/;
export function informationTierOptions(values: string[] = []): string[] {
  return [...new Set(values)].filter(value => value.trim() && !placeholder.test(value.trim()));
}
export function informationEducationOptions(values: string[] = [], kind: 'facts' | 'rankings'): string[] {
  const levels = new Set(['本科', '本科及研究生', '专科', '专科、本科及研究生', '研究生', '硕士', '硕士研究生', '博士', '博士研究生', '成人高等教育', '港澳院校', '海外院校']);
  return informationTierOptions(values).filter(value => kind === 'facts' ? value.length <= 24 && !/[\r\n]/.test(value) : levels.has(value));
}
export function informationRankingTitle(scope: Record<string, string>, batchLabels: Record<string, string>, gridLabels: Record<string, string>): string {
  const region = scope.province ? `进入${scope.province}的院校` : '全国院校';
  const batch = batchLabels[scope.batchCode ?? ''];
  const grid = gridLabels[scope.grid ?? ''];
  return `${region}${batch ? ` · ${batch}` : grid ? ` · ${grid}` : ''}录用${batch ? '' : '总数'}排名`;
}
