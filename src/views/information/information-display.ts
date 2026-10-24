/** Display vocabulary only. Every recruitment value is supplied by the API. */
import type { InformationCard, InformationMetric } from '@/services/mobile-information';
import type { GridFact, GridRankingRow } from '@/services/grid-information';
import { DEFAULT_APPLICANT_COHORT, referenceCohortYear } from '../../config/recruitment-cohorts.ts';
import { recruitmentDisplayText, recruitmentDisplayTitle } from '../../../platform/api/src/lib/recruitment-display-text.ts';
import { projectName, projectContact } from '../../config/project-contact';

/** Only explicitly exact totals or source references are suitable for number cards. */
export function hasInformationMetric(metric: InformationMetric): boolean {
  if (!metric || !['available', 'reference'].includes(metric.status)) return false;
  if (metric.metricType === 'public_notice_record_count' && metric.countBasis !== 'complete_anonymous_aggregates') return false;
  return Number.isFinite(metric.value) || (metric.status === 'reference' && /\d/.test(metric.displayValue));
}
export function informationMetricText(metric: InformationMetric): string {
  return hasInformationMetric(metric) ? metric.displayValue || String(metric.value?.toLocaleString('zh-CN')) : '';
}
export function populatedInformationMetrics(card: InformationCard) {
  return [{ label: '招聘名额', metric: card.plan }, { label: '录用公示', metric: card.publicNotice },
    { label: '报名数量', metric: card.applications }, { label: '报名竞争', metric: card.competition }].filter(row => hasInformationMetric(row.metric));
}
export function primaryInformationMetric(card: InformationCard): InformationMetric {
  return card.publicNotice;
}
export type InformationTab = "batches" | "regions" | "schools";
export const informationTabs = [
  { key: "batches", label: "批次" }, { key: "regions", label: "地区" }, { key: "schools", label: "院校" },
] as const;
export const informationBrand = projectName;
export const informationContact = projectContact;
/** Reading-directory coverage only. This never changes geographic map shapes. */
export function hasInformationProvinceContent(province: { earlyBatchAvailable: boolean; factCount: number }): boolean {
  return province.earlyBatchAvailable === true || (Number.isFinite(province.factCount) && province.factCount > 0);
}
export const defaultInformationFilters = (sourceYear = referenceCohortYear(DEFAULT_APPLICANT_COHORT)) => ({
  q: "", province: "", city: "", company: "", cohortYear: String(sourceYear), grid: "", batchCode: "",
  schoolTier: "", educationLevel: "", category: "", orgCategory: "", industryTag: "", view: "campus",
});
export const informationSchoolLevels = [
  { key: '', label: '全部层次' }, { key: 'power', label: '原电力直属' },
  { key: '985', label: '985' }, { key: '211', label: '211' },
  { key: '本科', label: '本科' }, { key: '专科', label: '专科' },
] as const;
export function selectInformationSchoolLevel(filters: ReturnType<typeof defaultInformationFilters>, level: string, industryTags: string[] = []) {
  const next = { ...filters, schoolTier: '', educationLevel: '', industryTag: '' };
  if (level === '985' || level === '211') next.schoolTier = level;
  if (level === '本科' || level === '专科') next.educationLevel = level;
  if (level === 'power') next.industryTag = industryTags.find(tag => /^原电力部院校/.test(tag)) || '原电力部院校（校史）';
  return next;
}
export function selectedInformationSchoolLevel(filters: ReturnType<typeof defaultInformationFilters>) {
  if (filters.industryTag && /^原电力部院校/.test(filters.industryTag) && !filters.schoolTier && !filters.educationLevel) return 'power';
  if (!filters.industryTag && !filters.educationLevel && ['985', '211'].includes(filters.schoolTier)) return filters.schoolTier;
  if (!filters.industryTag && !filters.schoolTier && ['本科', '专科'].includes(filters.educationLevel)) return filters.educationLevel;
  return !filters.schoolTier && !filters.educationLevel && !filters.industryTag ? '' : 'custom';
}
/** A composition is shown only when the exact same-query components reconcile. */
export function informationRankingComposition(row: Pick<GridRankingRow, 'recordCount' | 'gridCounts' | 'countBasis'>): string {
  const { sgcc, csg } = row.gridCounts;
  if (row.countBasis !== 'complete_anonymous_aggregates' || row.recordCount === null || sgcc === null || csg === null || sgcc + csg !== row.recordCount) return '';
  return `国网 ${informationCount(sgcc)} + 南网 ${informationCount(csg)} = ${informationCount(row.recordCount)}`;
}
export function informationCount(value: number | null | undefined, lowerBound = false): string {
  return value === null || value === undefined ? "暂无展示值" : `${lowerBound ? "≥" : ""}${value.toLocaleString("zh-CN")}`;
}
export function informationMetricUnit(metric: { metricType: string; measureUnit: string }): string {
  return metric.metricType === 'public_notice_record_count' ? '项录用公示'
    : metric.metricType === 'plan_count' ? `${metric.measureUnit.replace(/（计划）|\(计划\)/g, '')} · 招聘名额` : metric.measureUnit;
}
export function informationError(error: unknown): string {
  return error instanceof Error ? error.message : "资料暂时无法读取，请稍后重试。";
}
export function initialInformationTab(tab?: string, province?: string, original = false): InformationTab {
  if (tab === "rankings" || tab === "schools") return "schools";
  if (tab === "regions") return "regions";
  if (tab === "batches") return "batches";
  return province && !original ? "regions" : "batches";
}
export function informationQuery(filters: ReturnType<typeof defaultInformationFilters>, kind: "facts" | "rankings") {
  const { q, province, company, cohortYear, grid, batchCode, schoolTier, educationLevel } = filters;
  const common = { q: q.trim(), province, company, cohortYear, grid, batchCode, schoolTier, educationLevel };
  return kind === "facts" ? { ...common, city: filters.city, category: filters.category }
    : { ...common, orgCategory: filters.orgCategory, industryTag: filters.industryTag, view: filters.view };
}
export function isInformationTopicIndex(item: { title: string }): boolean {
  return /原文条款|主题索引|条款索引/.test(item.title);
}
export function prioritizeInformationFacts<T extends { title: string }>(items: T[]): T[] {
  const priority = (item: T) => isInformationTopicIndex(item) ? 100
    : /招聘要求|提前批要求|学历要求|院校要求/.test(item.title) ? 0
    : /流程|考核|考察方式|笔试|面试/.test(item.title) ? 1
    : /计划|录取|录用|名额/.test(item.title) ? 2 : 3;
  return items.map((item, index) => ({ item, index })).sort((a, b) => priority(a.item) - priority(b.item) || a.index - b.index).map(entry => entry.item);
}

/** Reading labels do not change source or audit metadata. */
export function informationYear(year: number | null): string { return year === null ? '年份未注明' : `${year}届`; }
export function informationFactTitle(title: string): string {
  return recruitmentDisplayTitle(title);
}
/** Importer annotations are retained in storage, not repeated in reading copy. */
export function informationFactDisplayText(text: string): string {
  return recruitmentDisplayText(text);
}
export function informationFactPreview(text: string): string[] {
  const body = informationFactDisplayText(text);
  const lines = body.split(/\n+/).map(line => line.trim()).filter(Boolean);
  return lines.slice(0, 3).map(line => line.length > 100 ? `${line.slice(0, 100)}…` : line);
}
export function isInformationExperience(item: { title: string; text?: string }): boolean {
  return /经验|主观|竞争梯队/.test(item.title)
    || /校招经验分享|单位竞争情况|【用户经验资料摘录|有同学被卡|似乎要求|大概率也被刷/.test(item.text || '');
}
export function informationFactContext(item: Pick<GridFact, 'cohortYear' | 'city' | 'province' | 'scope' | 'educationLevel' | 'schoolTier' | 'company' | 'batchCode' | 'grid'>): string {
  const batch = ({ campus: '提前批', batch_1: '第一批', batch_2: '第二批', batch_3: '第三批', csg_spring: '春招', csg_autumn: '秋招', all: '各批次通用' } as Record<string, string>)[item.batchCode];
  const grid = ({ sgcc: '国网', csg: '南网' } as Record<string, string>)[item.grid];
  const place = item.scope === 'city' ? item.city : item.scope === 'national' ? '全国' : item.province;
  return [...new Set([informationYear(item.cohortYear), place, item.company, grid, batch, item.educationLevel, item.schoolTier].filter(Boolean))].join(' · ');
}
export const informationFactGroups = [
  { key: 'requirements', title: '报考条件', description: '学历、院校、专业、年龄与证书' },
  { key: 'numbers', title: '招聘与报名', description: '招聘名额、录用与报名数量分别查看' },
  { key: 'scores', title: '考试分数', description: '按年份、专业与学历区分' },
  { key: 'schedule', title: '时间与流程', description: '报名、笔试、面试与招聘安排' },
  { key: 'experience', title: '经验参考', description: '校招经历与竞争情况，不作为报名门槛' },
  { key: 'benefits', title: '薪酬待遇', description: '按地区与年份查看' },
  { key: 'other', title: '其他信息', description: '补充条件与招聘说明' },
] as const;
export function informationFactGroup(item: Pick<GridFact, 'category' | 'title'> & { text?: string }): typeof informationFactGroups[number]['key'] {
  if (isInformationExperience(item)) return 'experience';
  if (item.category === 'score' || /分数|分数线|笔试线|综合线/.test(item.title)) return 'scores';
  if (item.category === 'headcount' || /人数|人次|名额|数量|录用对照|报名汇总/.test(item.title)) return 'numbers';
  if (item.category === 'compensation' || /薪酬|待遇|工资/.test(item.title)) return 'benefits';
  if (item.category === 'exam' || /时间|日期|流程|行程|考核方式|考察方式/.test(item.title)) return 'schedule';
  if (['student_origin', 'education', 'school', 'major', 'age', 'certificate', 'application'].includes(item.category) || /要求|条件|资格/.test(item.title)) return 'requirements';
  return 'other';
}
export function summarizeInformationFacts<T extends GridFact | Omit<GridFact, 'source'>>(items: T[]) {
  // Keyword indexes repeat full paragraphs; they are not additional criteria.
  const seen = new Set<string>();
  const scope = (item: T) => JSON.stringify([item.cohortYear, item.grid, item.batchCode, item.province, item.city, item.company, item.scope, item.applicability, item.educationLevel, item.schoolTier]);
  const readingItems = prioritizeInformationFacts(items).filter(item => !/原始标记/.test(item.title));
  const complete = readingItems.filter(item => !isInformationTopicIndex(item));
  const compactText = (item: T) => informationFactDisplayText(item.text).replace(/\s+/g, '');
  const unique = readingItems.filter(item => {
    const text = compactText(item);
    if (!text) return false;
    // An index is dispensable only when every character already appears in the
    // full same-scope reading. Different years, places and employers never merge.
    if (isInformationTopicIndex(item) && complete.some(full => scope(full) === scope(item) && compactText(full).includes(text))) return false;
    const key = JSON.stringify([scope(item), isInformationExperience(item), text]);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
  return informationFactGroups.map(group => ({ ...group, items: unique.filter(item => informationFactGroup(item) === group.key) })).filter(group => group.items.length);
}
export const informationCategoryLabels: Record<string, string> = {
  student_origin: '学籍与生源', education: '学历条件', school: '院校条件', major: '专业条件', age: '年龄条件',
  certificate: '证书条件', score: '考试分数', compensation: '薪酬待遇', application: '报名条件', exam: '考试安排', headcount: '招聘与报名数量', other: '其他信息',
};
