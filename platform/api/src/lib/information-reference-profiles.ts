import type { InformationFact } from './grid-information.js';
import { salaryReference, scoreReference, type InsightEvidence, type SalaryReference } from './grid-information-insights.js';
import { htmlCityFlags, htmlCityFlagSourceKey } from './information-html-city-flags.js';

export type ReferenceClause = InsightEvidence & {
  scope: string; city: string | null; origin: 'database' | 'html_fallback';
  yearBasis: 'explicit' | 'mixed_historical' | 'unknown';
};
export type ProfileScoreReference = InsightEvidence & {
  value: number | null; displayValue: string;
  kind: 'written' | 'admission' | 'interview_threshold_reference';
  audienceLabel: string; comparable: boolean;
  comparisonKey: string | null; comparisonLabel: string;
};
export type ReferenceProfile = {
  key: string; adcode: string | null; province: string; region: string; company: string | null;
  grid: string; cohortYear: number | null; batchCode: string; scope: string; city: string | null;
  sourceKeys: string[]; evidenceLocators: string[];
  yearBasis: ReferenceClause['yearBasis']; yearNote: string;
  undergraduateCity: {
    sourceFlag: 0 | 1 | 2 | null; flagMeaning: 'original_list_filter';
    scopeClauses: ReferenceClause[]; conditionClauses: ReferenceClause[];
  };
  schoolTierClauses: ReferenceClause[]; outsideRegionClauses: ReferenceClause[];
  ageCertificateClauses: ReferenceClause[]; educationClauses: ReferenceClause[];
  earlyBatchClauses: ReferenceClause[]; assignmentClauses: ReferenceClause[];
  scores: ProfileScoreReference[]; salaries: SalaryReference[];
};
const unique = (values: string[]) => [...new Set(values)];
const clean = (value: string) => value.split(/\r?\n/).filter(line => !/^【资料年份】/.test(line)).join('\n').trim();
const normalize = (value: string) => value.replace(/(?:壮族自治区|回族自治区|维吾尔自治区|自治区|省|市)$/u, '');
const aliases: Record<string,string> = { 冀北:'河北', 蒙东:'内蒙古', 蒙西:'内蒙古', 深圳:'广东' };
const yearBasis = (year: number | null, text: string): ReferenceClause['yearBasis'] => year !== null ? 'explicit'
  : /2025.?26届|2025[—–-]2026/.test(text) ? 'mixed_historical' : 'unknown';

/** Full clauses are reading references, including negatives and exceptions.
 * Inputs have already passed source privacy, reference status and DB priority.
 * Grouping additionally keeps source, year, batch and recruiting scope apart. */
export function buildReferenceProfiles(facts: InformationFact[], provinces: { adcode:string; name:string }[], reviewedClauses: InsightEvidence[] = []): ReferenceProfile[] {
  const codes = new Map(provinces.map(row => [normalize(row.name),row.adcode]));
  const groupKey = (e: ReferenceClause) => JSON.stringify([e.adcode ?? e.province,e.grid,e.company,e.city,e.year,e.batchCode,e.scope,[...e.sourceKeys].sort()]);
  const groups = new Map<string,{ clauses:ReferenceClause[]; facts:InformationFact[] }>();
  const add = (clause: ReferenceClause, fact?: InformationFact) => {
    const key = groupKey(clause), group = groups.get(key) ?? {clauses:[],facts:[]};
    if (!group.clauses.some(row => row.key === clause.key)) group.clauses.push(clause);
    if (fact) group.facts.push(fact);
    groups.set(key,group);
  };
  for (const fact of facts) {
    if (fact.dataStatus !== 'reference' || !['province','company'].includes(fact.scope)
      || (['application','headcount','school_outcome'].includes(fact.category) && !/分配|定岗|选岗|调剂/.test(fact.title))
      || /原始标记|原文条款|本市提及原文/.test(fact.title) || !clean(fact.text)
      || /^(?:[—\-/\s]+|原资料空白\/未提供[。.]?)$/.test(clean(fact.text))) continue;
    const name = normalize(fact.province ?? ''), province = fact.province ?? '';
    add({key:fact.factKey,adcode:codes.get(aliases[name] ?? name) ?? null,province,
      region:fact.company && normalize(fact.company) !== name ? `${fact.company} · ${province}` : province || fact.company || '',
      company:fact.company,grid:fact.grid,batchCode:fact.batchCode,year:fact.cohortYear,
      title:fact.title,text:clean(fact.text),qualifiers:[],
      nature:fact.origin === 'html_fallback' || /经验|主观|竞争梯队/.test(fact.title) ? 'experience_reference' : 'condition_reference',
      sourceKeys:[fact.sourceKey],evidenceLocators:[fact.evidenceLocator],scope:fact.scope,city:fact.city,origin:fact.origin,
      yearBasis:yearBasis(fact.cohortYear,fact.text)},fact);
  }
  // These entries are the existing authorized normative/native education
  // projection, after its pinned body/position and per-company priority checks.
  for (const entry of reviewedClauses) if (entry.noticeSource?.kind !== 'directory') {
    add({...entry,scope:'company',city:null,origin:'database',yearBasis:yearBasis(entry.year,entry.text)});
  }
  return [...groups.entries()].flatMap(([key,group]) => {
    const clauses = group.clauses, first = clauses[0]!;
    const take = (test: (row: ReferenceClause) => boolean) => clauses.filter(test);
    const scopeClauses = take(row => /地区\/生源范围/.test(row.title) || group.facts.some(f => f.factKey === row.key && f.category === 'student_origin'));
    const conditionClauses = take(row => /本科市局条件/.test(row.title));
    const sourceFlag = (() => {
      const fact = group.facts.find(f => f.sourceKey === htmlCityFlagSourceKey && f.origin === 'html_fallback'
        && f.cohortYear === null && f.batchCode === 'unspecified' && /本科市局条件/.test(f.title));
      const match = fact?.evidenceLocator.match(/^PROVINCES\[(\d+)\]\["shiju"\]/);
      const index = match ? Number(match[1]) : -1, flag = htmlCityFlags[index];
      if (!fact || !flag || flag[0] !== fact.company || fact.scope !== (flag[0] === '深圳' ? 'company' : 'province')
        || fact.grid !== (index >= 27 ? 'csg' : 'sgcc') || !group.facts.some(f => f.sourceKey === fact.sourceKey
          && f.evidenceLocator.startsWith(`PROVINCES[${index}]["scope"]`))) return null;
      return flag[1];
    })();
    const educationClauses = take(row => /学历|招聘要求|提前批(?:招聘)?要求|岗位要求/.test(row.title)
      || !!row.noticeSource && row.noticeSource.kind !== 'directory');
    const earlyBatchClauses = take(row => /^(?:csg_)?campus$/.test(row.batchCode) || /提前批/.test(row.title));
    const policyClauses = clauses.filter(row => !group.facts.some(f => f.factKey === row.key && ['score','compensation','application','headcount','school_outcome'].includes(f.category)));
    const clauseContext = (row:ReferenceClause) => [row.text,...row.qualifiers].join('\n');
    const schoolTierClauses = policyClauses.filter(row => /985|211|一本|二本|院校|原电力|电力部/.test(clauseContext(row)));
    const outsideRegionClauses = policyClauses.filter(row => /外地|省外|外省|本地|本省|户籍|生源|籍贯|跨省/.test(clauseContext(row)));
    const ageCertificateClauses = policyClauses.filter(row => /年龄|周岁|证书|英语|四级|六级|计算机|CET/i.test(clauseContext(row))
      || group.facts.some(f => f.factKey === row.key && ['age','certificate'].includes(f.category)));
    const assignmentClauses = take(row => /分配|定岗|选岗|调剂/.test(row.title));
    const salaries = group.facts.filter(f => f.category === 'compensation').map(f => salaryReference(f,clauses.find(row => row.key === f.factKey)!));
    const rawScores = group.facts.filter(f => f.category === 'score').flatMap(f => {
      const evidence = clauses.find(row => row.key === f.factKey)!;
      const typed = scoreReference(f,evidence);
      if (typed) return [{...typed,audienceLabel:'电工类本科',comparable:true} as ProfileScoreReference];
      // Preserve source interview thresholds without assigning an exam stage.
      if (f.cohortYear === null || f.grid !== 'sgcc' || !/^batch_[123]$/.test(f.batchCode)) return [];
      if (f.sourceKey !== htmlCityFlagSourceKey || f.origin !== 'html_fallback'
        || !/^PROVINCES\[\d+\]\["fs"\]\["y[123]"\]/.test(f.evidenceLocator)
        || !/进面线（原文称谓）$/.test(f.title)) return [];
      const m = clean(f.text).match(/^([^：:\n]+)[：:]\s*([^；;\n]+)[；;]类别、岗位或单位以此原文为准。/);
      if (!m || !/电本/.test(m[1]!) || /电研|电硕|电专/.test(m[1]!)) return [];
      const raw = m[2]!.trim(), number = /^\d+(?:\.\d+)?$/.test(raw) ? Number(raw) : null;
      return [{...evidence,value:number !== null && number > 0 && number <= 100 ? number : null,
        displayValue:raw,kind:'interview_threshold_reference' as const,audienceLabel:m[1]!.trim(),comparable:false,
        comparisonKey:null,comparisonLabel:`${f.cohortYear} 届 · ${f.batchCode} · ${m[1]!.trim()} · 原资料进面线（笔试/综合类型未核）`}];
    });
    const typedScores = new Map<string,ProfileScoreReference[]>();
    for (const score of rawScores) if (score.comparable && score.comparisonKey) {
      typedScores.set(score.comparisonKey,[...(typedScores.get(score.comparisonKey) ?? []),score]);
    }
    const scores = [...rawScores.filter(score => !score.comparable),...[...typedScores.values()].map(rows => {
      const first = rows[0]!, values = unique(rows.map(row => row.displayValue)), conflict = values.length > 1;
      return {...first,value:conflict ? null : first.value,displayValue:values.join(' / '),comparable:!conflict,
        comparisonKey:conflict ? null : first.comparisonKey,
        text:unique(rows.map(row => row.text)).join('\n\n'),sourceKeys:unique(rows.flatMap(row => row.sourceKeys)),
        evidenceLocators:unique(rows.flatMap(row => row.evidenceLocators)),
        qualifiers:unique(rows.flatMap(row => row.qualifiers)).concat(conflict ? ['同来源、年份、批次、招聘主体及分数类型出现不同数值；保留原文，不参与数值比较。'] : []),
        comparisonLabel:first.comparisonLabel + (conflict ? ' · 同范围多值待核' : '')};
    })];
    if (![scopeClauses,conditionClauses,educationClauses,earlyBatchClauses,schoolTierClauses,outsideRegionClauses,ageCertificateClauses,assignmentClauses,salaries,scores].some(rows => rows.length)) return [];
    const basis = clauses.some(row => row.yearBasis === 'mixed_historical') ? 'mixed_historical' : first.yearBasis;
    return [{key:`reference-profile:${key}`,adcode:first.adcode,province:first.province,region:first.region,company:first.company,
      grid:first.grid,cohortYear:first.year,batchCode:first.batchCode,scope:first.scope,city:first.city,
      sourceKeys:unique(clauses.flatMap(row => row.sourceKeys)),evidenceLocators:unique(clauses.flatMap(row => row.evidenceLocators)),yearBasis:basis,
      yearNote:basis === 'explicit' ? `${first.year} 届资料；各条款分别按原招聘主体及岗位适用。`
        : basis === 'mixed_historical' ? '2025—2026 背景历史经验；生效年份未核，不视为当前届政策。' : '年份未注明；保持历史/待核参考，不视为当前届政策。',
      undergraduateCity:{sourceFlag,flagMeaning:'original_list_filter' as const,scopeClauses,conditionClauses},
      schoolTierClauses,outsideRegionClauses,ageCertificateClauses,educationClauses,earlyBatchClauses,assignmentClauses,scores,salaries}];
  }).sort((a,b) => (a.adcode ?? '').localeCompare(b.adcode ?? '') || a.region.localeCompare(b.region,'zh-CN')
    || (b.cohortYear ?? 0)-(a.cohortYear ?? 0) || a.batchCode.localeCompare(b.batchCode) || a.key.localeCompare(b.key));
}
