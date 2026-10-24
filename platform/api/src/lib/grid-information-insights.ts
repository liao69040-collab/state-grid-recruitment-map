import type { InformationFact } from './grid-information.js';
import type { NativeNotice } from './native-grid-recruitment-2026.js';
import { htmlCityFlagSourceKey, htmlCityRoute } from './information-html-city-flags.js';
import { normativeEducationEntries, type InformationRequirementContext } from './information-normative-education.js';
import { buildReferenceProfiles } from './information-reference-profiles.js';
export type { InformationRequirementContext } from './information-normative-education.js';

/** Read-only projections of already-authorized facts. No eligibility is inferred. */
export type InsightEvidence = {
  key: string; adcode: string | null; province: string; region: string; company: string | null;
  grid: string; batchCode: string; year: number | null; title: string; text: string;
  qualifiers: string[]; nature: 'condition_reference' | 'experience_reference';
  sourceKeys: string[]; evidenceLocators: string[];
  noticeSource?: {kind:string;url:string;reviewedAt:string;bodySha256:string|null};
};
const batchDefinitions = [
  ['sgcc', 'campus', '国网提前批'], ['sgcc', 'batch_1', '国网第一批'],
  ['sgcc', 'batch_2', '国网第二批'], ['sgcc', 'batch_3', '国网第三批'],
  ['csg', 'csg_autumn', '南网秋招'], ['csg', 'csg_spring', '南网春招'],
  ['csg', 'csg_campus', '南网提前批'],
] as const;
const clean = (s: string) => s.split(/\r?\n/).filter(line => !/^【资料年份】/.test(line)).join('\n').trim();
const normalize = (s: string) => s.replace(/(?:壮族自治区|回族自治区|维吾尔自治区|自治区|省|市)$/u, '');
const uniq = (a: string[]) => [...new Set(a)];
const placeIdentity = (f: InformationFact) => [normalize(f.province ?? ''), f.company ?? '', f.city ?? '', f.scope].join('|');
const meaningful = (s: string) => !!s && !/^(?:[—\-/\s]+|原资料空白\/未提供[。.]?|南网批次安排不同，以招聘公告为准)$/.test(s);
const experience = (f: InformationFact) => /经验|主观|竞争梯队/.test(f.title) || /【用户经验资料摘录|校招经验分享|似乎要求/.test(f.text);
const education = (f: InformationFact) => !experience(f) && /^(?:招聘要求|提前批(?:招聘)?要求|学历要求|[一二三]批学历范围|供服\/农网学历范围|提前批院校要求)/.test(f.title);
const qualifier = (f: InformationFact) => ['major', 'age', 'certificate', 'student_origin'].includes(f.category)
  || /^(?:其他补充|网申通过的潜在政策|年龄\/证书|地区\/生源范围)/.test(f.title);
const degreeGroups = [
  ['mixed', '分学历 / 岗位条件'], ['bachelor', '涉及本科的条件'],
  ['graduate', '硕博条件'], ['associate', '专科 / 岗位例外'], ['other', '院校与岗位条件'],
] as const;
/** Positive clauses only. Mentioning a bachelor's age or a master's prior degree is not a route. */
export function mentionsBachelorRoute(text: string, city = false): boolean {
  if (/(?:不招|不收|不接收|不接受|不面向|仅招硕士|仅限硕士|只招硕士).{0,12}本科|本科.{0,12}(?:不招|不收|不能|不可|不得|不接受|无法|不参加)|本科(?:生)?[≤<＜]|本科.{0,3}年龄/.test(text)) return false;
  if (city) return /(?:本科(?:生)?.{0,12}(?:可报|可进|可签|可投|可参加)|(?:985|211|华电|原电|9)本(?:科)?(?:[\/、，]|及以上|可|$))/.test(text) && !/本科.*硕士.*(?:以上|起步|要求)/.test(text);
  if (!/本科|一本|二本|电本/.test(text)) return false;
  if (/硕士.{0,12}[（(]本科.{0,10}专业[）)]/.test(text)) return false;
  return /本科(?:生)?(?:及以上|可投|可报|可参加|可签约)|(?:高校|院校|专业|电工类|学历|放宽至).{0,4}本科|(?:公办|民办).{0,4}(?:一本|二本|本科)|电工本科|电本/.test(text);
}
function degreeGroup(text: string) {
  const bachelor = /本科|一本|二本|电本/.test(text), graduate = /硕士|研究生|博士|电硕/.test(text), associate = /专科|大专|委培/.test(text);
  // These labels describe clauses, never the population eligible to apply.
  return Number(bachelor) + Number(graduate) + Number(associate) > 1 ? 'mixed' : associate ? 'associate' : bachelor ? 'bachelor' : graduate ? 'graduate' : 'other';
}
export type SalaryReference = InsightEvidence & {
  amount: string; location: string; minimum: number | null; maximum: number | null;
  sortValue: number | null; comparisonKey: string | null; comparisonLabel: string;
};
export type ScoreReference = InsightEvidence & {
  value: number | null; displayValue: string; kind: 'written' | 'admission';
  comparisonKey: string; comparisonLabel: string;
};
/** Exact amount only; ranges/approximate amounts are retained, never ranked by a bound. */
export function salaryReference(f: InformationFact, evidence: InsightEvidence): SalaryReference {
  const amount = f.text.match(/数值原文[：:]\s*([^。\n；;]+)/)?.[1]?.trim() ?? '';
  const location = f.text.match(/地区原文[：:]\s*([^；;\n]+)/)?.[1]?.trim() ?? f.city ?? f.company ?? f.province ?? '';
  const match = amount.match(/^(\d+(?:\.\d+)?)(?:\s*[-—–~～至]\s*(\d+(?:\.\d+)?))?\s*(w|万|万元|元)$/i);
  const factor = match && match[3] === '元' ? 0.0001 : 1;
  const minimum = match ? Number(match[1]) * factor : null;
  const maximum = match ? Number(match[2] ?? match[1]) * factor : null;
  const basis = /三年后到手年薪/.test(f.text) ? 'after_three_years_net_annual'
    : /税前年薪/.test(f.text) ? 'gross_annual' : /到手年薪|税后年薪/.test(f.text) ? 'net_annual' : null;
  const period = f.cohortYear === null && /2025.?26届|2025[—–-]2026/.test(f.text) ? 'historical_2025_2026' : f.cohortYear === null ? 'undated' : String(f.cohortYear);
  const comparisonKey = basis && period !== 'undated' ? `${period}|${basis}|wan_cny` : null;
  const basisLabel = basis === 'after_three_years_net_annual' ? '三年后到手年薪' : basis === 'gross_annual' ? '税前年薪' : basis === 'net_annual' ? '到手年薪' : '计量口径未注明';
  return { ...evidence, amount: amount || clean(f.text), location, minimum, maximum,
    sortValue: comparisonKey && minimum !== null && minimum === maximum ? minimum : null,
    comparisonKey, comparisonLabel: `${period === 'historical_2025_2026' ? '2025—2026 背景历史参考' : period === 'undated' ? '年份未注明' : `${period} 年参考`} · ${basisLabel}（万元）` };
}
/** Conservative common sample: one cohort/batch, electrical bachelor, same exam stage. */
export function scoreReference(f: InformationFact, evidence: InsightEvidence): ScoreReference | null {
  if (f.cohortYear === null || f.grid !== 'sgcc' || !/^batch_[123]$/.test(f.batchCode) || f.scope !== 'province') return null;
  const m = clean(f.text).match(/^对象[：:]\s*电工类\s*\/\s*本科(?:生)?[。.]?\s*\n\s*(\d+(?:\.\d+)?)\s*$/);
  const explicitStage=/笔试线|笔试分数线|综合(?:录取)?(?:分数)?线/.test(f.title);
  const writtenSheet=/^[\d一二三批届]*分数线$/.test(f.title)&&/^笔试分数线!/.test(f.evidenceLocator);
  if (!m || (!explicitStage&&!writtenSheet) || (f.educationLevel!==null&&!/^本科(?:生)?$/.test(f.educationLevel))) return null;
  const kind = /综合/.test(f.title) ? 'admission' : 'written';
  const value = Number(m[1]);
  if (!Number.isFinite(value) || value <= 0 || value > 100) return null;
  return { ...evidence, value, displayValue:String(value), kind,
    comparisonKey:[f.cohortYear, f.grid, f.batchCode, 'electrical_bachelor', kind].join('|'),
    comparisonLabel:`${f.cohortYear} 届 · 国网第${({ batch_1:'一',batch_2:'二',batch_3:'三' } as Record<string,string>)[f.batchCode]}批 · 电工类本科 · ${kind === 'written' ? '笔试线' : '综合录取线'}参考` };
}
export function buildInformationInsights(facts: InformationFact[], provinces: { adcode: string; name: string }[], year: number, notices: readonly NativeNotice[] = [], normative?: InformationRequirementContext) {
  const regionCodes = new Map(provinces.map(p => [normalize(p.name), p.adcode]));
  const alias: Record<string,string> = { 冀北:'河北', 蒙东:'内蒙古', 蒙西:'内蒙古', 深圳:'广东' };
  const safe = facts.filter(f => f.dataStatus === 'reference' && !/原始标记|原文条款|本市提及原文/.test(f.title)
    && ['province', 'company'].includes(f.scope) && meaningful(clean(f.text)));
  const evidence = (f: InformationFact): InsightEvidence => {
    const province = f.province ?? '', name = normalize(province), company = f.company;
    const region = company && normalize(company) !== name ? `${company} · ${province}` : province || company || '全国';
    const qualifiers = safe.filter(q => qualifier(q) && q.cohortYear === f.cohortYear && q.grid === f.grid && q.batchCode === f.batchCode && placeIdentity(q) === placeIdentity(f)).map(q => clean(q.text));
    return { key:f.factKey, adcode:regionCodes.get(alias[name] ?? name) ?? null, province, region, company,
      grid:f.grid, batchCode:f.batchCode, year:f.cohortYear, title:f.title, text:clean(f.text), qualifiers:uniq(qualifiers),
      nature:experience(f) ? 'experience_reference' : 'condition_reference', sourceKeys:[f.sourceKey], evidenceLocators:[f.evidenceLocator] };
  };
  const regionKey = (e: InsightEvidence) => [e.adcode ?? e.province,e.grid,e.company ?? e.province].join('|');
  const preferred = safe.filter(education).filter(f => f.origin === 'database' || !safe.some(d => education(d) && d.origin === 'database'
    && d.cohortYear === f.cohortYear && d.grid === f.grid && d.batchCode === f.batchCode && placeIdentity(d) === placeIdentity(f)));
  const uniqueEvidence = (rows: InformationFact[]) => [...new Map(rows.map(f => {
    const e = evidence(f); return [[regionKey(e),e.year,e.batchCode,e.text].join('|'),e] as const;
  })).values()];
  // Shared reviewed notices supply missing native-batch reading, not a new eligibility engine.
  const native = notices.filter(n=>n.cohortYear===year).map((n):InsightEvidence=>({
    key:n.key,adcode:n.provinceAdcode,province:n.provinceName,region:`${n.targetName} · ${n.provinceName}`,company:n.targetName,
    grid:n.grid,batchCode:n.batchCode,year:n.cohortYear,title:n.title,
    text:[n.positions.length?`岗位方向：${n.positions.join('；')}`:'',n.sourceKind!=='directory'?'学历与专业按具体岗位分别规定。':'',...(n.notes??[]),n.scopeNote??''].filter(Boolean).join('\n'),
    qualifiers:[],nature:'condition_reference',sourceKeys:[n.key],evidenceLocators:[n.title],
    noticeSource:{kind:n.sourceKind,url:n.sourceUrl,reviewedAt:n.reviewedAt,bodySha256:n.bodySha256??null},
  }));
  const normativeEntries = normative ? normativeEducationEntries(normative,year) : [];
  const educationBatches = (historical: boolean) => batchDefinitions.map(([grid,batchCode,title]) => {
    const official = historical ? [] : normativeEntries.filter(e=>e.grid===grid&&e.batchCode===batchCode);
    const entries = uniqueEvidence(preferred.filter(f => f.grid === grid && f.batchCode === batchCode && (historical ? f.cohortYear !== year : f.cohortYear === year)))
      .filter(entry=>!official.some(o=>regionKey(o)===regionKey(entry)));
    entries.push(...official);
    if(!historical) for(const n of native.filter(n=>n.grid===grid&&n.batchCode===batchCode&&n.noticeSource?.kind!=='directory')) {
      // Do not overwrite a database's same-company native-batch condition.
      const sameCompany=(e:InsightEvidence)=>e.company===n.company || (n.company===`${n.province}电网有限责任公司`&&[n.province,`${n.province}电网`].includes(e.company??''));
      if(!entries.some(e=>e.adcode===n.adcode&&sameCompany(e)))entries.push(n);
    }
    const grouped=new Map<string,InsightEvidence[]>();
    for(const entry of entries){const key=[regionKey(entry),entry.year].join('|');grouped.set(key,[...(grouped.get(key)??[]),entry]);}
    const combined=[...grouped.values()].map(rows=>rows.length===1?rows[0]!:{...rows[0]!,
      text:rows.map((e,index)=>`条款 ${index+1}：\n${e.text}`).join('\n\n'),qualifiers:uniq(rows.flatMap(e=>e.qualifiers)),
      sourceKeys:uniq(rows.flatMap(e=>e.sourceKeys)),evidenceLocators:uniq(rows.flatMap(e=>e.evidenceLocators))});
    return { key:`${grid}-${batchCode}`, grid, batchCode, title, regionCount:new Set(entries.map(regionKey)).size,
      groups:degreeGroups.map(([key,label]) => { const members=combined.filter(e => (e.noticeSource?'other':degreeGroup(e.text)) === key);return { key,label,regionCount:new Set(members.map(regionKey)).size,entries:members }; }).filter(g => g.entries.length) };
  });
  const educationDistribution = { cohortYear:year, batches:educationBatches(false).filter(b=>b.groups.length), historicalBatches:educationBatches(true).filter(b=>b.groups.length) };
  const city = safe.filter(f => /本科市局条件/.test(f.title)).flatMap(f => {
    const route = htmlCityRoute(f,safe);
    if (route) return [{...evidence(f),title:route.label,text:route.text,nature:'experience_reference' as const,
      qualifiers:evidence(f).qualifiers.filter(value=>value!==clean(route.scope.text)),evidenceLocators:route.locators}];
    // The source's negative/excluded flags cannot be overridden by a regex.
    return f.sourceKey!==htmlCityFlagSourceKey&&mentionsBachelorRoute(clean(f.text),true) ? [evidence(f)] : [];
  });
  const currentEarly = normativeEntries.filter(e=>e.batchCode==='campus');
  const early = uniqueEvidence(preferred.filter(f => f.batchCode === 'campus' && mentionsBachelorRoute(clean(f.text))))
    .filter(entry=>entry.year!==year||!currentEarly.some(o=>regionKey(o)===regionKey(entry)));
  early.push(...currentEarly.filter(e=>mentionsBachelorRoute(e.text)));
  const salaries = safe.filter(f => f.category === 'compensation').map(f=>salaryReference(f,evidence(f)));
  const rawScores = safe.filter(f => f.category === 'score').flatMap(f=>{ const s=scoreReference(f,evidence(f));return s?[s]:[]; });
  const scoreGroups = new Map<string,ScoreReference[]>();
  for (const s of rawScores) {const key=[regionKey(s),s.comparisonKey].join('|');scoreGroups.set(key,[...(scoreGroups.get(key)??[]),s]);}
  const scores = [...scoreGroups.values()].map(rows => {
    const row=rows[0]!; const values=uniq(rows.map(s=>s.displayValue));
    return {...row, value:values.length===1?row.value:null, displayValue:values.join(' / '), sourceKeys:uniq(rows.flatMap(s=>s.sourceKeys)),
      evidenceLocators:uniq(rows.flatMap(s=>s.evidenceLocators)), qualifiers:values.length===1?row.qualifiers:[...row.qualifiers,'同范围分数存在不同数值，未纳入数值排序。']};
  });
  const reviewedProfileClauses = educationDistribution.batches.flatMap(batch => batch.groups.flatMap(group => group.entries))
    .filter(entry => !safe.some(fact => fact.factKey === entry.key));
  const profileFacts = safe.filter(fact => (fact.cohortYear === null || fact.cohortYear <= year)
    && (!education(fact) || preferred.includes(fact)));
  return { educationDistribution, referenceProfiles:buildReferenceProfiles(profileFacts,provinces,reviewedProfileClauses), regionInsights:{ cohortYear:year, undergraduateCity:city, undergraduateEarly:early, salaries, scores, recruitmentNotices:native } };
}
