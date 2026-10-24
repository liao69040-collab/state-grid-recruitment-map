import type { InsightEvidence, SalaryReference, ScoreReference } from '@/services/information-insights';
import type { ReferenceProfile } from '@/services/recruitment-reference';
import type { PhotoCardScore } from '@/services/photo-materials';
import type { DirectRegionMode } from './mobile-information-navigation';

export type RegionInsightMode = 'all' | 'city' | 'early' | 'salary' | 'difficulty' | 'written' | 'admission' | 'salary-score';
export const regionInsightModes = [
  { key:'all', label:'全国' }, { key:'city', label:'本科可进市局' }, { key:'early', label:'本科提前批' },
  { key:'salary', label:'待遇' }, { key:'written', label:'难度' }, { key:'admission', label:'录取难度' },
] as const;
export const compactRegionInsightModes = [
  { key:'all', label:'全国' }, { key:'city', label:'本科可进市局' }, { key:'early', label:'本科提前批' },
  { key:'salary', label:'待遇' }, { key:'difficulty', label:'难度' },
] as const;
export const scoreKindLabel = (kind: ScoreReference['kind']) => kind === 'written' ? '笔试线' : '综合录取线';
/** A single navigation entry still keeps written and admission scores in
 * separate comparison groups. Never sort the two score meanings together. */
export function difficultyComparisonRows(rows: ScoreReference[]): ScoreReference[] {
  return rows.map(row => ({ ...row,
    comparisonKey: row.comparisonKey ? `${row.kind}|${row.comparisonKey}` : row.comparisonKey,
    comparisonLabel: [scoreKindLabel(row.kind), row.comparisonLabel.replace(/\s*·\s*(?:笔试线|综合录取线)参考$/u, '')].filter(Boolean).join(' · '),
  }));
}
export const insightYear = (year: number | null) => year === null ? '历史参考 · 年份未注明' : `${year} 届参考`;
export function salaryAmountLabel(row: SalaryReference): string {
  if(row.minimum!==null&&row.maximum!==null)return `${row.minimum===row.maximum?row.minimum:`${row.minimum}—${row.maximum}`} 万元`;
  return row.amount.replace(/[wW]$/u,'万元').replace(/(?<=\d)万$/u,'万元');
}
export function educationPreview(text:string):string {
  const preview=text.replace(/qs前100国网院校/gi,'QS前100院校');
  return preview.length>48?`${preview.slice(0,48)}…`:preview;
}
export function insightContext(row: InsightEvidence): string {
  const batch: Record<string,string> = { campus:'提前批', batch_1:'第一批', batch_2:'第二批', batch_3:'第三批', csg_autumn:'秋招', csg_spring:'春招', csg_campus:'提前批',impc_campus:'校园招聘',all:'各批次通用', unspecified:'未单列批次' };
  const grid: Record<string,string> = { sgcc:'国网', csg:'南网', impc:'内蒙古电力（蒙西）',other:'其他电力企业', unknown:'电网体系未注明' };
  return [insightYear(row.year),grid[row.grid],batch[row.batchCode]].filter(Boolean).join(' · ');
}
export function comparisonOptions(rows: (SalaryReference | ScoreReference)[]) {
  return [...new Map(rows.filter(row=>row.comparisonKey).map(row=>[row.comparisonKey!,{key:row.comparisonKey!,label:row.comparisonLabel}])).values()]
    .sort((a,b)=>b.key.localeCompare(a.key));
}
/** Numeric order only inside one explicit comparable group. Ranges/conflicts stay unranked. */
export function sortedComparableRows<T extends SalaryReference | ScoreReference>(rows: T[], key: string, direction: 'asc' | 'desc'): T[] {
  const value = (r:T) => 'sortValue' in r ? r.sortValue : r.value;
  return rows.filter(r=>key === 'unmatched' ? !r.comparisonKey : r.comparisonKey===key).slice().sort((a,b)=>{
    const av=value(a),bv=value(b);
    if(av===null&&bv!==null)return 1;if(av!==null&&bv===null)return -1;
    return (av!==null&&bv!==null ? (direction==='desc'?bv-av:av-bv) : 0) || a.region.localeCompare(b.region,'zh-CN') || a.key.localeCompare(b.key);
  });
}
export function conditionEvidenceRows(rows: InsightEvidence[], cohortYear: number, includeHistorical: boolean) {
  return rows.filter(row=>includeHistorical || row.year===cohortYear).slice().sort((a,b)=>
    (a.year===cohortYear?0:1)-(b.year===cohortYear?0:1) || a.region.localeCompare(b.region,'zh-CN'));
}
export function matchesInsightProvince(province: {adcode:string;name:string}, rows: InsightEvidence[], filters: {q:string;provinceCode:string;grid:string}) {
  const q=filters.q.trim();
  return (!filters.provinceCode||province.adcode===filters.provinceCode)
    && (!filters.grid||rows.some(r=>r.adcode===province.adcode&&r.grid===filters.grid))
    && (!q||province.name.includes(q)||rows.some(r=>r.adcode===province.adcode&&(!filters.grid||r.grid===filters.grid)&&r.region.includes(q)));
}

export interface CompactRegionReference {
  key: string; adcode: string; region: string; company: string | null;
  grid: string; tags: string[]; summary: string; searchable: string;
  badges: { key: string; label: string; note: string; qualifier?: string }[];
}

/** Only shorten the visible preview. Original clauses remain in the province reader. */
const shortClause = (text: string, max = 34) => {
  const line = text.split('【资料年份】')[0]!.replace(/\s+/gu, ' ').trim();
  return line.length > max ? `${line.slice(0, max)}…` : line;
};
const uniqueClauses = (rows: InsightEvidence[]) => [...new Map(rows.map(row => [row.key, row])).values()];
const profileClauses = (profile: ReferenceProfile) => uniqueClauses([
  ...profile.undergraduateCity.scopeClauses, ...profile.undergraduateCity.conditionClauses,
  ...profile.schoolTierClauses, ...profile.outsideRegionClauses, ...profile.educationClauses,
  ...profile.earlyBatchClauses, ...profile.ageCertificateClauses, ...profile.assignmentClauses,
]);
const cityClauses = (profile: ReferenceProfile) => uniqueClauses([
  ...profile.undergraduateCity.scopeClauses, ...profile.undergraduateCity.conditionClauses,
]);
const profileTags = (profile: ReferenceProfile, evidence: InsightEvidence) => {
  const batch = ({ campus:'提前批',batch_1:'一批',batch_2:'二批',batch_3:'三批',csg_autumn:'秋招',csg_spring:'春招',csg_campus:'提前批',impc_campus:'校园招聘' } as Record<string,string>)[evidence.batchCode];
  return [({ sgcc:'国网',csg:'南网',impc:'蒙西',other:'地方电力' } as Record<string,string>)[profile.grid],
    evidence.year === null ? '历史参考' : `${evidence.year}届`, batch].filter((tag): tag is string => Boolean(tag));
};

/** One compact card per actual recruiting company/city. Never combine its qualification
 * preview with a different source/year profile or promote an original list flag to eligibility. */
const unitIdentity = (name: string) => name.trim().replace(/\s/gu, '')
  .replace(/^(?:国家电网|国网|中国南方电网|南方电网)/u, '')
  .replace(/(?:有限责任公司|有限公司)$/u, '')
  .replace(/(?:省|市)?(?:电力|供电)(?:公司)?$/u, '').replace(/(?:省|市)$/u, '');
const compactBadges = (profile: ReferenceProfile, candidates: ReferenceProfile[], mode: DirectRegionMode, year: number, photoScores: PhotoCardScore[]) => {
  const badges: CompactRegionReference['badges'] = [];
  const add = (key: string, label: string, note = '') => badges.push({ key, label, note });
  if (mode === 'city') {
    const original = cityClauses(profile).map(row => row.text).join('；');
    const kind = /985|211|外地|本地|户籍|生源/u.test(original) ? '院校/生源限制' : /仅.*硕士|只.*硕士|须.*研究生/u.test(original) ? '硕士条件参考' : /本科|一本|二本|电本/u.test(original) ? '本科条件参考' : '市局条件参考';
    add('city', kind, profile.yearNote);
  } else if (mode === 'early') add('early', '提前批参考', profile.yearNote);
  // Geographical identity alone cannot substitute for the recruiting company.
  const matched = photoScores.filter(row => !profile.city && profile.grid === 'sgcc' && row.adcode === profile.adcode
    && row.sourceYear === year && row.batchCode === 'batch_1' && row.label === '电工类本科'
    && unitIdentity(row.unitName) === unitIdentity(profile.company || profile.region)
    && Number.isFinite(row.score) && row.score > 0 && row.score <= 100);
  const written = candidates.flatMap(row => row.scores).filter(row => row.year === year && row.batchCode === 'batch_1'
    && row.kind === 'written' && row.comparable && row.value !== null && row.audienceLabel === '电工类本科');
  if (matched.length) {
    const values = new Set([...matched.map(row => row.score),...written.map(row => row.value)]);
    if (values.size !== 1) add('written', '笔试分数见详情', '同届、同招聘主体、同专业笔试资料分别保留原文');
    else {
      add('written', `一批笔试参考 ${matched[0]!.score}`, '2026届电工类本科笔试参考');
      const qualifiers = [...new Set(matched.map(row => row.qualifier).filter((value): value is string => Boolean(value)))];
      if (qualifiers.length) badges.at(-1)!.qualifier = qualifiers.join('；');
    }
  } else if (written.length) {
    if (new Set(written.map(row => row.value)).size === 1) add('written', `一批笔试参考 ${written[0]!.displayValue}`, '电工类本科笔试参考');
    else add('written', '笔试分数见详情', '同范围原文分别保留');
  }
  const salaries = candidates.flatMap(row => row.salaries).filter(row => row.amount && (row.year === null || row.year <= year))
    .sort((a,b) => (a.year === year ? 0 : 1) - (b.year === year ? 0 : 1) || (b.year || 0) - (a.year || 0) || a.key.localeCompare(b.key));
  if (salaries[0]) add('salary', `待遇参考 ${shortClause(salaries[0].amount, 12)}`, salaries[0].comparisonLabel);
  const age = profile.ageCertificateClauses[0];
  if (age) add('certificate', `年龄证书 ${shortClause(age.text, 16)}`, profile.yearNote);
  if (!badges.length && profile.scores.some(row => row.kind === 'interview_threshold_reference')) add('interview', '进面参考', '原资料未核笔试/综合类型');
  return badges.slice(0,4);
};
export function compactRegionReferences(profiles: ReferenceProfile[], mode: DirectRegionMode, cohortYear: number, photoScores: PhotoCardScore[] = []): CompactRegionReference[] {
  const groups = new Map<string, ReferenceProfile[]>();
  for (const profile of profiles) {
    if (!profile.adcode) continue;
    const hasData = mode === 'city' ? cityClauses(profile).length : mode === 'early' ? profile.earlyBatchClauses.length : profile.scores.length + profile.salaries.length;
    if (!hasData) continue;
    const key = [profile.adcode, profile.grid, profile.company || profile.region, profile.city || ''].join('|');
    groups.set(key, [...(groups.get(key) || []), profile]);
  }
  return [...groups].map(([key, candidates]) => {
    const sorted = candidates.slice().sort((a, b) => {
      if (mode === 'city') {
        const priority = (p: ReferenceProfile) => p.undergraduateCity.sourceFlag === 0 ? 0 : p.undergraduateCity.sourceFlag !== null ? 1 : 2;
        if (priority(a) !== priority(b)) return priority(a) - priority(b);
      }
      if (mode === 'salary-score') {
        const typed = (p: ReferenceProfile) => p.scores.some(row => row.year === cohortYear && row.kind !== 'interview_threshold_reference' && row.value !== null) ? 0 : 1;
        if (typed(a) !== typed(b)) return typed(a) - typed(b);
      }
      return (a.cohortYear === cohortYear ? 0 : 1) - (b.cohortYear === cohortYear ? 0 : 1) || (b.cohortYear || 0) - (a.cohortYear || 0) || a.key.localeCompare(b.key);
    });
    const profile = sorted[0]!;
    let evidence: InsightEvidence;
    let summary: string;
    if (mode === 'city') {
      const selected = uniqueClauses([profile.undergraduateCity.scopeClauses[0], profile.undergraduateCity.conditionClauses[0]].filter((row): row is NonNullable<typeof row> => Boolean(row)));
      evidence = selected[0]!;
      summary = selected.filter((row, index) => !selected.slice(0, index).some(previous => previous.text.includes(row.text))).map(row => shortClause(row.text)).join('；');
    } else if (mode === 'early') {
      evidence = profile.earlyBatchClauses[0]!;
      summary = shortClause(evidence.text, 68);
    } else {
      const typed = profile.scores.filter(row => row.kind !== 'interview_threshold_reference' && row.value !== null).slice(0, 2);
      if (typed.length) {
        evidence = typed[0]!;
        summary = `${typed[0]!.audienceLabel} · 各批次笔试与综合分数见详情`;
      } else if (profile.salaries.length) {
        const salary = profile.salaries[0]!;
        evidence = salary;
        summary = shortClause(salary.comparisonLabel || salary.text, 42);
      } else {
        evidence = profile.scores[0]!;
        summary = '原资料进面分数参考；笔试/综合类型见详情';
      }
    }
    return { key, adcode: profile.adcode!, region: profile.city ? `${profile.region} · ${profile.city}` : profile.region,
      company: profile.company, grid: profile.grid, tags: profileTags(profile, evidence), summary,
      badges: compactBadges(profile,profiles.filter(row=>row.adcode===profile.adcode&&row.grid===profile.grid&&row.city===profile.city&&unitIdentity(row.company||row.region)===unitIdentity(profile.company||profile.region)),mode,cohortYear,photoScores),
      searchable: candidates.flatMap(p => [p.region, p.company || '', p.city || '', ...profileClauses(p).map(row => row.text), ...p.scores.map(row => row.text), ...p.salaries.map(row => row.text)]).join(' ') };
  }).sort((a, b) => a.region.localeCompare(b.region, 'zh-CN') || a.key.localeCompare(b.key));
}
