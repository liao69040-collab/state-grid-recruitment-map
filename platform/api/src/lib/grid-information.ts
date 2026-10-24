import { z } from 'zod';
import type { DataStore, EarlyBatchPolicyRecord, ResourceListInput } from '../store/types.js';
import type { ResourceName } from '../db/schema.js';
import { ApiError } from './http.js';
import type { GridMapCatalog } from './grid-map-catalog.js';
import { gridFactVisibleToMember, gridReleasedCells, type GridFact, type GridSnapshot, type GridSource } from './grid-query.js';
import { containsPrivateSourceReference, privateSourceIndex, publicSourceRows } from './private-source-boundary.js';
import { informationEducationPins } from './information-education-pins.js';
import { gridSnapshotForMemberSources } from './grid-source-visibility.js';
import { buildInformationInsights } from './grid-information-insights.js';
import { nativeReviewed2026Notices } from './native-grid-recruitment-2026.js';
import { recruitmentDisplayText, recruitmentFactForDisplay } from './recruitment-display-text.js';
import { buildNationalApplicationReferences } from './information-national-references.js';
import { photoCardScores, photoProvinceSupplement, photoUnitRequirements } from './photo-materials-20261005.js';

export const gridInformationQuerySchema = z.object({ cohortYear: z.coerce.number().int().min(2000).max(2100).default(2026) }).strict();
export type InformationSource = Pick<GridSource, 'sourceKey' | 'title' | 'sourceType' | 'sourceUrl' | 'note'>;
export type InformationFact = GridFact & { source: InformationSource; datasetKey: string; version: string; origin: 'database' | 'html_fallback'; yearLabel: string };
export type InformationMetric = {
  value: number | null; displayValue: string; measureUnit: string; metricType: string;
  sourceYear: number | null; status: 'available' | 'reference' | 'missing' | 'suppressed';
  scopeLabel: string; sourceKeys: string[]; evidenceLocators: string[]; note: string;
};
export const GRID_INFORMATION_SUPPLEMENT_KEY = 'mobile-info-reviewed-national-reference-20260922';
export const GRID_INFORMATION_HTML_SOURCE_KEY = 'demo.html.reference';
export const GRID_INFORMATION_HTML_SHA256 = '208c1f838eb70e7d249c536c0075426dd7028dd949c48631fdcf1908eed0981f';
export const summaryMetricSchema = z.object({schema:z.literal('grid-information-metric-1'),metricType:z.enum(['plan_count','application_entries_reference']),
  value:z.number().nonnegative().nullable(),measureUnit:z.string().min(1).max(80),scopeLabel:z.string().min(1).max(500),sourceYear:z.number().int().min(2000).max(2100),note:z.string().max(4000),
  segment:z.enum(['yp','ep','nd','sc','all'])}).strict();
type Row = Record<string, unknown>;
export type GridInformationInput = { snapshot: GridSnapshot; catalogs: GridMapCatalog[]; policies: EarlyBatchPolicyRecord[]; metrics?: Row[]; sources?: Row[]; provinces?: Row[]; requirements?: Row[]; companies?: Row[] };
const batches = [
  { key: 'sgcc-campus', grid: 'sgcc', batchCode: 'campus', title: '国网提前批' },
  { key: 'sgcc-batch_1', grid: 'sgcc', batchCode: 'batch_1', title: '国网第一批' },
  { key: 'sgcc-batch_2', grid: 'sgcc', batchCode: 'batch_2', title: '国网第二批' },
  { key: 'sgcc-batch_3', grid: 'sgcc', batchCode: 'batch_3', title: '国网第三批' },
  { key: 'csg-csg_autumn', grid: 'csg', batchCode: 'csg_autumn', title: '南网秋招' },
  { key: 'csg-csg_spring', grid: 'csg', batchCode: 'csg_spring', title: '南网春招' },
] as const;
const normalize = (s: string) => s.replace(/(?:壮族自治区|回族自治区|维吾尔自治区|自治区|省|市)$/u, '');
const uniq = (s: string[]) => [...new Set(s)].sort();
const source = (s: GridSource): InformationSource => ({ sourceKey:s.sourceKey, title:s.title, sourceType:s.sourceType, sourceUrl:s.sourceUrl, note:s.note });
const html = (s: InformationSource) => s.sourceKey.startsWith('html.') || /\.html?$/i.test(s.title);
const notes = [
  '全部内容通过认证后从数据库读取；工作簿及已核资料优先，HTML 仅用于相同主题缺项的历史参考，不覆盖数据库已有内容。',
  '公示记录数不是实际入职人数；用户侧仅合计固定最细单元不少于 5 条的可展示记录，为下限，不提供全量与隐去量的差额。',
  '计划、报名人次、公示记录的范围可能不同，不能相加或直接求录取率；年份不明确的材料保持年份待核。',
  '提前批为历史上传资料参考，不自动判定报考资格；具体资格与时间以对应届别官方公告为准。',
];
const factCache = new WeakMap<GridInformationInput, InformationFact[]>();

function factsFor(input: GridInformationInput): InformationFact[] {
  const cached = factCache.get(input);
  if (cached) return cached;
  const restricted = privateSourceIndex(input.sources ?? []);
  const rows = input.snapshot.datasets.flatMap(d => d.policyFacts.flatMap(f => {
    const s = d.sources.find(s => s.sourceKey === f.sourceKey);
    if (!s || !gridFactVisibleToMember(d,f) || containsPrivateSourceReference(f, restricted)) return [];
    return [{ ...f, source: source(s), datasetKey: d.datasetKey, version: d.version,
      origin: html(s) ? 'html_fallback' as const : 'database' as const,
      yearLabel: f.cohortYear === null ? '年份待核（不视为当前届政策）' : `${f.cohortYear} 届资料` }];
  }));
  // Explicit semantic fields only: never suppress an unrelated fact merely
  // because its broad category (e.g. education) happens to match.
  const topic = (f: InformationFact) => /^(招聘要求|提前批要求|提前批招聘要求)$/.test(f.title) ? 'requirements'
    : /^(招聘流程|提前批流程)$/.test(f.title) ? 'process'
    : /^(考察方式（有无笔试、专业课、面试形式等）|考核方式)$/.test(f.title) ? 'assessment' : f.title;
  const identity = (f: InformationFact) => [f.cohortYear, f.grid, f.batchCode, f.scope, normalize(f.province ?? ''), f.city, f.scope === 'company' ? f.company : '', topic(f)].join('|');
  const databaseKeys = new Set(rows.filter(f => f.origin === 'database').map(identity));
  const selected = rows.filter(f => f.origin === 'database' || !databaseKeys.has(identity(f)));
  factCache.set(input, selected);
  return selected;
}
function regions(input: GridInformationInput) {
  const all = new Map<string, { adcode: string; name: string }>();
  for (const row of input.provinces ?? []) if (typeof row.adcode === 'string' && typeof row.name === 'string') all.set(row.adcode, { adcode: row.adcode, name: row.name });
  for (const catalog of input.catalogs) for (const row of catalog.provinces) all.set(row.adcode, { adcode: row.adcode, name: row.name });
  for (const policy of input.policies) if (policy.targetKind === 'province' && policy.provinceAdcode && !all.has(policy.provinceAdcode)) all.set(policy.provinceAdcode, { adcode: policy.provinceAdcode, name: policy.targetName });
  return [...all.values()].sort((a,b) => a.adcode.localeCompare(b.adcode));
}
const policyIn = (p: EarlyBatchPolicyRecord, adcode: string) => p.provinceAdcode === adcode || p.parentProvinceAdcode === adcode;
function validPolicies(input: GridInformationInput, year: number) {
  const restricted = privateSourceIndex(input.sources ?? []);
  return input.policies.filter(p => p.cohortYear === year && p.publicationStatus === 'published' && p.status === 'active' && !containsPrivateSourceReference(p, restricted));
}
function missing(type: string, unit: string, year: number, note: string): InformationMetric {
  return { value:null, displayValue:'待核', measureUnit:unit, metricType:type, sourceYear:year, status:'missing', scopeLabel:'全国同届同批次（尚无完整可比口径）', sourceKeys:[], evidenceLocators:[], note };
}
function nationalMetric(input: GridInformationInput, year: number, batchCode: string, grid: string, type: string, unit: string) {
  const empty = missing(type, unit, year, '未发现已发布的同年、同批次、同电网全国指标；不累加不同主体或范围不明的省级资料。');
  const restricted = privateSourceIndex(input.sources ?? []);
  const rows = (input.metrics ?? []).filter(m => m.cohortYear === year && m.batchCode === batchCode && m.metricType === type && m.publicationStatus === 'published'
    && m.aggregationGrain === 'national' && !m.provinceId && !m.companyId && !m.schoolId && !m.cityId
    && (m.metadata as Row | undefined)?.grid === grid && !containsPrivateSourceReference(m, restricted));
  if (rows.length > 1) return empty; // Multiple rows may be overlapping evidence, never a sum.
  if (rows.length === 0) return auditedSummaryMetric(input,year,batchCode,grid,type) ?? empty;
  const m = rows[0]!;
  if (m.privacySuppressed === true) return { ...empty, status:'suppressed' as const, displayValue:'已保护', note:'来源指标已隐私保护，数值与派生比例均不展示。' };
  const value = m.value === null || m.value === undefined || m.value === '' ? null : Number(m.value);
  if (value === null || !Number.isFinite(value) || value < 0 || (value === 0 && m.zeroConfirmed !== true)) return empty;
  return { ...empty, value, displayValue:String(m.displayValue ?? value), measureUnit:String(m.unit ?? unit), status:'available' as const,
    sourceKeys:Array.isArray(m.sourceKeys) ? m.sourceKeys.filter((s):s is string => typeof s === 'string') : [],
    scopeLabel:String(m.subjectScope ?? '全国同届同批次'), note:String(m.notes ?? '数据库已发布指标；保留原计量单位。') };
}

function auditedSummaryMetric(input: GridInformationInput, year: number, batchCode: string, grid: string, type: string): InformationMetric | null {
  if(containsPrivateSourceReference({sourceKey:GRID_INFORMATION_HTML_SOURCE_KEY},privateSourceIndex(input.sources ?? []))) return null;
  const approved = input.snapshot.datasets.filter(d=>d.datasetKey === GRID_INFORMATION_SUPPLEMENT_KEY && d.sources.some(s=>s.sourceKey === GRID_INFORMATION_HTML_SOURCE_KEY && s.sha256 === GRID_INFORMATION_HTML_SHA256));
  const rows = approved.flatMap(d=>d.policyFacts).filter(f => ['reference','conflict'].includes(f.dataStatus) && f.sourceKey === GRID_INFORMATION_HTML_SOURCE_KEY && f.scope === 'national' && f.cohortYear === year && f.batchCode === batchCode && f.grid === grid && f.title.startsWith('移动汇总指标：'))
    .flatMap(f => {
      let value:unknown;try { value=JSON.parse(f.text); } catch { return []; }
      const parsed=summaryMetricSchema.safeParse(value);
      if(!parsed.success || parsed.data.metricType !== type || parsed.data.sourceYear !== year) return [];
      return [{ fact:f, metric:parsed.data }];
    });
  if(!rows.length || new Set(rows.map(r=>r.metric.segment)).size !== rows.length) return null;
  if(rows.length > 1 && !(type === 'plan_count' && batchCode === 'batch_3' && rows.length === 2 && rows.some(r=>r.metric.segment==='nd') && rows.some(r=>r.metric.segment==='sc'))) return null;
  const first=rows[0]!;
  if(rows.some(r=>r.metric.value === null || r.fact.dataStatus === 'conflict')) return { ...missing(type,first.metric.measureUnit,year,'来源存在冲突，未采用任一总数。'),
    sourceKeys:uniq(rows.map(r=>r.fact.sourceKey)),evidenceLocators:uniq(rows.map(r=>r.fact.evidenceLocator)),scopeLabel:first.metric.scopeLabel,note:rows.map(r=>r.metric.note).join('；') };
  return { value:rows.length === 1 ? first.metric.value : null,
    displayValue:rows.length === 1 ? first.metric.value!.toLocaleString('zh-CN') : ['nd','sc'].map(segment=>{const m=rows.find(r=>r.metric.segment===segment)!.metric;return `${segment==='nd'?'农电':'三产'} ${m.value!.toLocaleString('zh-CN')}`;}).join(' / '),
    measureUnit:first.metric.measureUnit, metricType:type, sourceYear:year, status:'reference', scopeLabel:uniq(rows.map(r=>r.metric.scopeLabel)).join('；'),
    sourceKeys:uniq(rows.map(r=>r.fact.sourceKey)), evidenceLocators:uniq(rows.map(r=>r.fact.evidenceLocator)), note:uniq(rows.map(r=>r.metric.note)).join('；') };
}

export function buildGridInformationOverview(input: GridInformationInput, year: number, exact=false) {
  const facts = factsFor(input), policies = validPolicies(input, year);
  const restricted = privateSourceIndex(input.sources ?? []);
  const safeSnapshot = gridSnapshotForMemberSources(input.snapshot, restricted);
  const released = gridReleasedCells(safeSnapshot,exact), all = gridReleasedCells(safeSnapshot, true);
  const cards = batches.map(batch => {
    const cells = released.filter(r => r.cohortYear === year && r.grid === batch.grid && r.batchCode === batch.batchCode);
    const exists = all.some(r => r.cohortYear === year && r.grid === batch.grid && r.batchCode === batch.batchCode);
    const value = cells.length ? cells.reduce((n,r) => n + r.recordCount, 0) : null;
    const publicNotice: InformationMetric = { value, displayValue:value === null ? (exists ? '已保护' : '未单列') : value.toLocaleString('zh-CN'), measureUnit:'条公示记录', metricType:'public_notice_record_count', sourceYear:year,
      status:value === null ? (exists ? 'suppressed' : 'missing') : 'available', scopeLabel:exact?'完整已入库匿名公示记录（全单位类别）':'已接入名册全体系的可展示记录（下限）', sourceKeys:uniq(cells.map(r => r.sourceKey)), evidenceLocators:[],
      note:batch.batchCode === 'campus' ? '提前批未独立成名册统计，不从第一批倒推或重复相加。' : exact?'按完整入库记录精确聚合；含未归属目的省及所有单位类别，不等于自然人数或实际入职人数。':'固定最细单元少于 5 条的不参与合计；含相应电网资料中的各单位类别，不等于仅省公司或实际入职人数。' };
    return { ...batch, cohortYear:year, scopeLabel:publicNotice.scopeLabel,
      plan:nationalMetric(input,year,batch.batchCode,batch.grid,'plan_count','人（计划）'), publicNotice,
      applications:nationalMetric(input,year,batch.batchCode,batch.grid,'application_entries_reference','人次'),
      competition:missing('application_to_plan_ratio','报名人次/计划名额',year,'仅当年份、主体范围与计量口径完全一致时才可比较；不使用隐私下限或历史经验数计算报录比。') };
  });
  const provinces = regions(input).map(p => ({ ...p, earlyBatchAvailable:policies.some(row => policyIn(row,p.adcode)) || facts.some(f => normalize(f.province ?? '') === normalize(p.name) && f.batchCode === 'campus' && f.cohortYear === year), factCount:facts.filter(f => f.cohortYear === year && normalize(f.province ?? '') === normalize(p.name)).length }));
  // Only compact province-level references here; thousands of candidate-company
  // observations stay behind the existing paginated grid-query API.
  const applicationReferences = facts.filter(f => f.scope === 'province' && (f.cohortYear === year || f.cohortYear === null) && /^(HTML批次计划\/录用对照|HTML报名汇总参考|报名人数|报名人次|报录比)$/.test(f.title));
  const nativeNotices = nativeReviewed2026Notices.filter(notice => {
    // A reviewed URL can be registered under another source key. Resolve that
    // provenance before the shared key/id boundary, just as eligibility does.
    const linkedSources = (input.sources ?? []).filter(row =>
      row.sourceKey === notice.key || row.officialUrl === notice.sourceUrl);
    return !containsPrivateSourceReference({
      sourceKey: notice.key,
      sourceKeys: linkedSources.flatMap(row => [row.sourceKey, row.id].filter(value => typeof value === 'string')),
    }, restricted);
  });
  const rosterDataAvailable=all.some(row=>row.cohortYear===year);
  const referenceDataAvailable=rosterDataAvailable||facts.some(fact=>fact.cohortYear===year)||policies.length>0
    ||cards.some(card=>card.plan.value!==null||card.applications.value!==null);
  return { schemaVersion:'grid-information-1' as const, cohortYear:year, referenceDataAvailable, rosterDataAvailable,
    years:[...new Set(safeSnapshot.datasets.flatMap(d => [...d.policyFacts,...d.schoolOutcomes].flatMap(r => r.cohortYear === null ? [] : [r.cohortYear])))].sort((a,b) => b-a),
    cards, provinces, nationalApplicationReferences:buildNationalApplicationReferences(input,year,facts), applicationReferences:applicationReferences.map(recruitmentFactForDisplay), ...buildInformationInsights(facts,provinces,year,nativeNotices, { requirements:input.requirements??[], companies:input.companies??[], sources:input.sources??[], provinces:input.provinces??[] }),
    photoCardScores:photoCardScores(year,input.sources), photoUnitRequirements:photoUnitRequirements(year,input.sources),
    sources:informationSources(input,facts), privacy:{ minimumCellCount:exact?null:5, suppressionApplied:!exact, personalRecordsIncluded:false,countBasis:exact?'complete_anonymous_aggregates' as const:'released_cells_only' as const }, notes:exact?notes.filter(note=>!note.includes('不少于 5 条')).concat('仅认证用户可查看完整入库匿名计数；不含个人行、姓名、电话或原始行号。'):notes };
}
function informationSources(input: GridInformationInput, facts: InformationFact[]) {
  const restricted = privateSourceIndex(input.sources ?? []);
  const keys = new Set([...facts.map(f => f.sourceKey), ...gridReleasedCells(gridSnapshotForMemberSources(input.snapshot,restricted)).map(r => r.sourceKey),
    ...input.snapshot.datasets.filter(d=>d.datasetKey===GRID_INFORMATION_SUPPLEMENT_KEY).flatMap(d=>d.sources.filter(s=>!containsPrivateSourceReference(s,restricted)).map(s=>s.sourceKey))]);
  return [...new Map(input.snapshot.datasets.flatMap(d => d.sources.filter(s => keys.has(s.sourceKey)).map(s => [s.sourceKey, source(s)] as const))).values()];
}
function policyPayload(p: EarlyBatchPolicyRecord) {
  return { policyKey:p.policyKey, cohortYear:p.cohortYear, batchCode:p.batchCode, target:{ kind:p.targetKind, code:p.targetCode, name:p.targetName },
    requirements:recruitmentDisplayText(p.recruitmentRequirements), process:recruitmentDisplayText(p.recruitmentProcess), plannedHeadcount:recruitmentDisplayText(p.plannedHeadcountDisplay), assessmentMethod:recruitmentDisplayText(p.assessmentMethod),
    itinerary:recruitmentDisplayText(p.itineraryReference), siteQuota:recruitmentDisplayText(p.siteQuotaDisplay), admissionRule:recruitmentDisplayText(p.admissionRule), actualHeadcount:recruitmentDisplayText(p.actualHeadcountDisplay), notes:recruitmentDisplayText(p.otherNotes),
    missingFields:p.missingFields, source:{ sourceKey:p.sourceDocumentKey, title:p.sourceDocumentTitle, sourceUrl:p.sourceDocumentOfficialUrl,
      evidenceLocator:p.sourceLocator, status:p.sourceStatus, revisionKey:p.revisionKey }, dataStatus:'uploaded_reference_unverified' as const };
}
export function buildGridInformationProvince(input: GridInformationInput, year: number, adcode: string) {
  const province = regions(input).find(p => p.adcode === adcode);
  if (!province) return null;
  const facts = factsFor(input).filter(f => normalize(f.province ?? '') === normalize(province.name)).map(recruitmentFactForDisplay);
  const current = facts.filter(f => f.cohortYear === year);
  const policies = validPolicies(input,year).filter(p => policyIn(p,adcode)).map(policyPayload);
  const earlyOrder = (f: InformationFact) => f.title === '招聘要求' ? 0 : ['education','school','major','age','certificate','student_origin'].includes(f.category) ? 1 : /流程|考察|考核/.test(f.title) ? 2 : 3;
  const sortEarly = (a: InformationFact,b: InformationFact) => earlyOrder(a)-earlyOrder(b) || (a.origin === b.origin ? 0 : a.origin === 'database' ? -1 : 1) || a.factKey.localeCompare(b.factKey);
  const earlyFacts = current.filter(f => f.batchCode === 'campus').sort(sortEarly);
  const historicalEarlyFacts = facts.filter(f => f.batchCode === 'campus' && f.cohortYear !== year).sort(sortEarly);
  return { schemaVersion:'grid-information-1' as const, province, cohortYear:year,
    earlyBatch:{ policies, facts:earlyFacts, historicalFacts:historicalEarlyFacts, missing:policies.length === 0 && earlyFacts.length === 0, historicalOnly:policies.length === 0 && earlyFacts.length === 0 && historicalEarlyFacts.length > 0 },
    batches:batches.filter(b => b.batchCode !== 'campus').map(b => ({ batchCode:b.batchCode, title:b.title, facts:current.filter(f => f.grid === b.grid && (f.batchCode === b.batchCode || f.batchCode === 'all')) })),
    generalFacts:current.filter(f=>f.batchCode === 'unspecified'),
    historicalFacts:facts.filter(f => f.cohortYear !== year), photoSupplement:photoProvinceSupplement(year,adcode,input.sources), sources:informationSources(input,facts), notes };
}

/** Read-only adapter. Existing imported versions are the only material source. */
export async function loadGridInformation(store: DataStore, year: number): Promise<GridInformationInput> {
  // The information page must use the same published requirements as screening.
  // Pagination is mandatory: a first-page projection silently omits regions.
  const published = async (resource: ResourceName, filters: Partial<ResourceListInput> = {}) => {
    const rows: Row[] = [];
    for (let offset = 0; ; ) {
      const hasPublicationStatus = !['sources','provinces'].includes(resource);
      const page = await store.listResource(resource, { ...filters, ...(hasPublicationStatus ? { publicationStatus:'published' } : {}), limit:500, offset });
      rows.push(...page.items);
      offset += page.items.length;
      if (offset >= page.total) return rows;
      if (!page.items.length) throw new ApiError(503, 'INFORMATION_DATA_INCOMPLETE', '招聘信息加载不完整，请稍后重试。');
    }
  };
  const [snapshot,catalogs,policies,restricted,provinces,plans,applications,requirements,companies,sources] = await Promise.all([
    store.gridQuerySnapshot(), store.gridMapCatalogSnapshot(), store.listEarlyBatchPolicies(year), store.adminOnlySources(),
    published('provinces'), published('recruitment-metrics',{cohortYear:year,q:'plan_count'}),
    published('recruitment-metrics',{cohortYear:year,q:'application_entries_reference'}),
    published('recruitment-requirements',{cohortYear:year}), published('companies'), published('sources'),
  ]);
  // List endpoints intentionally omit full documents. Load only the public
  // documents needed to bind reviewed sub-company/job scopes, internally.
  const scopeKeys = new Set<string>(informationEducationPins.flatMap(pin => 'scope' in pin ? [pin.scope.sourceKey] : []));
  const privacy = privateSourceIndex([...sources,...restricted]);
  const publicSources = new Set(publicSourceRows(sources, privacy));
  const scopedSources = await Promise.all(sources.map(async row => {
    if (!publicSources.has(row) || !scopeKeys.has(String(row.sourceKey)) || Number(row.cohortYear) !== year || typeof row.id !== 'string') return row;
    const full = await store.getResource('sources',row.id);
    // source_documents has no publication_status column; requirements/companies
    // carry publication gates. Do not invent a source status that hides all rows.
    if (!full || full.sourceKey !== row.sourceKey || (full.publicationStatus !== undefined && full.publicationStatus !== 'published') || Number(full.cohortYear) !== year || !publicSourceRows([full],privacy).length) return row;
    return { ...row, contentText: full.contentText };
  }));
  return { snapshot,catalogs,policies,sources:[...scopedSources,...restricted],provinces,metrics:[...plans,...applications],requirements,companies };
}
