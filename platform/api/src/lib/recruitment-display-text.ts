/** Pure reading projection shared by API and browser. Source text stays immutable. */
const formula = /(?:=_xlfn\.|=)?(?:DISPIMG|IMAGE)\s*\(\s*["'][^"'\r\n]+["']\s*(?:[,，][^\r\n)]*)?\)/gi;
const spreadsheetError = /(?<![A-Za-z0-9])#(?:REF!|VALUE!|DIV\/0!|NAME\?|N\/A|NUM!|NULL!|SPILL!|CALC!)(?=[\s;；，。,]|$)/i;
const brokenEncoding = /\uFFFD|(?:[ÃÂ][\u0080-\u00BF]|â€|锟斤拷)/u;
const controlCharacters = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200D\uFEFF]/g;

export function recruitmentTextIssues(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  const issues: string[] = [];
  if (/(?:DISPIMG|(?:=_xlfn\.)?IMAGE)\s*\(/i.test(value)) issues.push('spreadsheet_image_formula');
  if (spreadsheetError.test(value)) issues.push('spreadsheet_error');
  if (brokenEncoding.test(value)) issues.push('encoding_artifact');
  if (/\[object Object\]|\b(?:undefined|NaN)\b/.test(value)) issues.push('serialized_placeholder');
  return issues;
}

/** Remove machine-only fragments, never interpret a formula or invent its image content. */
export function recruitmentDisplayText(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return String(value).replace(controlCharacters, '').replace(/\r\n?/g, '\n').split('\n').flatMap(raw => {
    let line = raw.replace(formula, '').trim();
    // A corrupt line cannot be repaired by dropping arbitrary bytes. Keep the
    // original in audit storage and omit it from the public reading projection.
    if (!line || recruitmentTextIssues(line).length) return [];
    if (/^(?:【条款说明】同一原文条款|【用户经验资料摘录|【资料年份】资料背景涉及|【适用说明】保留共同城市组|城市仅作为查询索引；|本段年份未明确或包含混合时间，不套用工作簿|与名单主榜分开，不相加、不覆盖。|报招比：报名人次\/计划数（按渲染器标签）)/.test(line)) return [];
    line = line.replace(/【完整原文】/g, '完整内容：')
      .replace(/（按渲染器标签）|\(按渲染器标签\)/g, '')
      .replace(/(?:^|[；;])\s*(?:计划|资料录用|报名|比值|报录比原文)\s*未提供(?=[；;。.]|$)/g, '')
      .replace(/资料录用/g, '录用').replace(/报录比原文/g, '报录比')
      .replace(/；\s*；/g, '；').replace(/^[；;\s]+|[；;\s]+$/g, '').trim();
    return line && !/^[。.,，;；：:\s]+$/.test(line) ? [line] : [];
  }).join('\n').trim();
}

export function recruitmentDisplayTitle(value: string): string {
  return recruitmentDisplayText(value)
    .replace(/HTML批次计划\/录用对照/g, '招聘与录用数量')
    .replace(/HTML报名汇总参考/g, '报名数量')
    .replace(/HTML院校人数对照[：:]?/g, '院校录用数量：')
    .replace(/^原文条款[：:]\s*([^/]+?)\s*\/\s*/, '$1 · ')
    .replace(/(?:\s*[（(]未核官方[）)]|\s*[（(]以原文为准[）)])/g, '')
    .replace(/原文条款|主题索引|条款索引/g, '补充条件')
    .replace(/原文参考|原文摘录|经验摘录|原文/g, '').replace(/\s*[··]\s*$/, '').trim();
}

export function recruitmentFactForDisplay<T extends { title: string; text: string }>(fact: T): T {
  // Index/experience classification still uses the original semantic title;
  // the final renderer applies recruitmentDisplayTitle after grouping.
  const title = /原文条款|主题索引|条款索引|经验摘录/.test(fact.title)
    ? recruitmentDisplayText(fact.title) : recruitmentDisplayTitle(fact.title);
  return { ...fact, title, text: recruitmentDisplayText(fact.text) };
}
