<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { authState } from "@/services/auth";
import { DEFAULT_APPLICANT_COHORT, referenceCohortYear } from '@/config/recruitment-cohorts';
import { recruitmentDisplayText, recruitmentDisplayTitle } from '@/utils/recruitment-display';
import {
  fetchGridFacets, fetchGridFacts, fetchGridRankings, GridInformationUnauthorized,
  type GridFacets, type GridFactResult, type GridRankingResult,
} from "@/services/grid-information";
import {
  gridBatchLabels, gridCategoryLabels, gridCombinedLabels, gridCountCell, gridCountLabel, gridFactScopeLabel, gridLabels,
  gridOrgCategoryLabels, gridYearLabel, safeGridSourceUrl, sameGridRegion,
} from "./grid-information-display";

const props = withDefaults(defineProps<{ province?: string; city?: string; headingId?: string; initialTab?: "facts" | "rankings"; targetCohortYear?: number }>(), {
  province: "", city: "", headingId: "gridInformation-title", initialTab: "facts", targetCohortYear: DEFAULT_APPLICANT_COHORT,
});
const referenceYear = computed(() => referenceCohortYear(props.targetCohortYear));
const emit = defineEmits<{ unauthorized: [] }>();
const activeTab = ref<"facts" | "rankings">(props.initialTab);
const facets = ref<GridFacets | null>(null);
const yearOptions = computed(() => [...new Set([referenceYear.value, ...(facets.value?.years || [])])].sort((a, b) => b - a));
const facts = ref<GridFactResult | null>(null);
const rankings = ref<GridRankingResult | null>(null);
const directoryLoading = ref(false);
const loading = ref(false);
const error = ref("");
const directoryError = ref("");
const page = ref(1);
const resultTop = ref<HTMLElement | null>(null);
const filters = reactive({
  q: "", province: props.province, city: props.city, company: "", cohortYear: String(referenceYear.value), grid: "", batchCode: "",
  schoolTier: "", educationLevel: "", category: "", orgCategory: "", industryTag: "", view: "parent",
});
const submittedFilters = ref<Record<string, string>>({});
let queryController: AbortController | null = null;
let directoryController: AbortController | null = null;
let sequence = 0;
let disposed = false;
const cityOptions = computed(() => (facets.value?.cities || []).filter((item) => !filters.province || sameGridRegion(item.province, filters.province)));
const total = computed(() => (activeTab.value === "facts" ? facts.value?.total : rankings.value?.total) ?? 0);
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / 20)));
const loadedResult = computed(() => activeTab.value === "facts" ? facts.value : rankings.value);
const displayCountLabel = computed(() => gridCountLabel(rankings.value?.items[0]?.countBasis || "released_cells_only"));
const scopeCaption = computed(() => [submittedFilters.value.province, activeTab.value === "facts" ? submittedFilters.value.city : ""].filter(Boolean).join(" / ") || "全国");

const clearPrivateResults = () => {
  sequence += 1;
  queryController?.abort();
  directoryController?.abort();
  facts.value = null;
  rankings.value = null;
  facets.value = null;
  loading.value = false;
  directoryLoading.value = false;
};
watch(() => authState.authenticated, (authenticated) => { if (!authenticated) clearPrivateResults(); });

function handleFailure(failure: unknown) {
  if (failure instanceof GridInformationUnauthorized) {
    clearPrivateResults();
    emit("unauthorized");
    return;
  }
  error.value = failure instanceof Error ? failure.message : "资料暂时无法读取，请重试。";
}

async function loadDirectory() {
  directoryController?.abort();
  const controller = new AbortController();
  directoryController = controller;
  directoryLoading.value = true;
  directoryError.value = "";
  try {
    const data = await fetchGridFacets(controller.signal);
    if (!disposed && !controller.signal.aborted && authState.authenticated) {
      facets.value = data;
      filters.province = data.provinces.find((item) => sameGridRegion(item, filters.province)) || filters.province;
      filters.city = cityOptions.value.find((item) => sameGridRegion(item.city, filters.city))?.city || filters.city;
    }
  } catch (failure) {
    if (failure instanceof GridInformationUnauthorized) handleFailure(failure);
    else if (!controller.signal.aborted) directoryError.value = failure instanceof Error ? failure.message : "筛选目录加载失败。";
  } finally {
    if (directoryController === controller) directoryLoading.value = false;
  }
}

async function search(nextPage = 1, useSubmitted = false) {
  queryController?.abort();
  const controller = new AbortController();
  queryController = controller;
  const request = ++sequence;
  const tab = activeTab.value;
  const base: Record<string, string> = {
    q: filters.q.trim(), province: filters.province, company: filters.company, cohortYear: filters.cohortYear,
    grid: filters.grid, batchCode: filters.batchCode, schoolTier: filters.schoolTier, educationLevel: filters.educationLevel,
  };
  const query = useSubmitted ? submittedFilters.value : tab === "facts" ? { ...base, city: filters.city, category: filters.category }
    : { ...base, orgCategory: filters.orgCategory, industryTag: filters.industryTag, view: filters.view };
  submittedFilters.value = query;
  page.value = nextPage;
  facts.value = null;
  rankings.value = null;
  error.value = "";
  loading.value = true;
  try {
    const result = tab === "facts" ? await fetchGridFacts({ ...query, page: nextPage, pageSize: 20 }, controller.signal)
      : await fetchGridRankings({ ...query, page: nextPage, pageSize: 20 }, controller.signal);
    if (disposed || controller.signal.aborted || request !== sequence || !authState.authenticated) return;
    if (tab === "facts") facts.value = result as GridFactResult;
    else rankings.value = result as GridRankingResult;
    resultTop.value?.scrollIntoView({ block: "nearest", behavior: "auto" });
  } catch (failure) {
    if (failure instanceof GridInformationUnauthorized) handleFailure(failure);
    else if (!controller.signal.aborted && request === sequence) handleFailure(failure);
  } finally {
    if (request === sequence) loading.value = false;
  }
}

function switchTab(tab: "facts" | "rankings") {
  if (activeTab.value === tab) return;
  activeTab.value = tab;
  // Category and city are policy-only. Every other shared filter remains explicit.
  void search(1);
}
function changeProvince() { filters.city = ""; }
function changeCity() {
  const selected = cityOptions.value.find((item) => item.city === filters.city);
  if (selected) filters.province = selected.province;
}
function clearFilters() {
  Object.assign(filters, { q: "", province: "", city: "", company: "", cohortYear: String(referenceYear.value), grid: "", batchCode: "", schoolTier: "", educationLevel: "", category: "", orgCategory: "", industryTag: "", view: "parent" });
  void search(1);
}
onMounted(() => { void loadDirectory(); void search(); });
watch(referenceYear, () => { clearPrivateResults(); filters.cohortYear = String(referenceYear.value); submittedFilters.value = {}; if (authState.authenticated) { void loadDirectory(); void search(); } }, { flush: 'sync' });
onBeforeUnmount(() => { disposed = true; clearPrivateResults(); });
</script>

<template>
  <div class="grid-information" data-qa="grid-information-query">
    <header class="query-heading">
      <span class="query-eyebrow">GRID INFORMATION · 登录资料库</span>
      <h2 :id="headingId">{{ activeTab === 'facts' ? `${referenceYear}届电网信息汇总` : '全国国网南网院校全榜' }}</h2>
      <p>{{ targetCohortYear }}届报考 · 参考{{ referenceYear }}届数据。国网与南网按省市查询，历史资料不代替当届资格审查。</p>
    </header>
    <div class="query-tabs" role="group" aria-label="选择查询内容">
      <button type="button" :aria-pressed="activeTab === 'facts'" :class="{ selected: activeTab === 'facts' }" @click="switchTab('facts')">政策与历史考情</button>
      <button type="button" :aria-pressed="activeTab === 'rankings'" :class="{ selected: activeTab === 'rankings' }" @click="switchTab('rankings')">全国院校全榜</button>
    </div>

    <form class="query-filters" aria-label="电网资料查询条件" @submit.prevent="search(1)">
      <label class="keyword-filter">{{ activeTab === 'facts' ? '关键词' : '学校关键词' }}
        <input v-model="filters.q" type="search" maxlength="120" :placeholder="activeTab === 'facts' ? '省市、公司、学历、专业、分数…' : '输入学校或校区名称'" />
      </label>
      <label>电网<select v-model="filters.grid"><option value="">全部电网</option><option v-for="item in facets?.grids || []" :key="item" :value="item">{{ gridLabels[item] || item }}</option></select></label>
      <label>{{ activeTab === 'facts' ? '省份' : '招聘目的省份' }}<select v-model="filters.province" @change="changeProvince"><option value="">全国</option><option v-if="filters.province && !facets?.provinces.includes(filters.province)" :value="filters.province">{{ filters.province }}</option><option v-for="item in facets?.provinces || []" :key="item" :value="item">{{ item }}</option></select></label>
      <label v-if="activeTab === 'facts'">城市<select v-model="filters.city" @change="changeCity"><option value="">全部城市 / 省级</option><option v-if="filters.city && !cityOptions.some(item => item.city === filters.city)" :value="filters.city">{{ filters.city }}（城市资料待补）</option><option v-for="item in cityOptions" :key="`${item.province}:${item.city}`" :value="item.city">{{ item.city }}</option></select></label>
      <label>年份<select v-model="filters.cohortYear"><option value="">全部年份（含未标明）</option><option value="unknown">原文未标明年份</option><option v-for="item in yearOptions" :key="item" :value="String(item)">{{ item }}届 / 年</option></select></label>
      <label>批次<select v-model="filters.batchCode"><option value="">全部批次</option><option v-for="item in facets?.batches || []" :key="item" :value="item">{{ gridBatchLabels[item] || item }}</option></select></label>
      <label>公司<select v-model="filters.company"><option value="">全部公司</option><option v-for="item in facets?.companies || []" :key="item" :value="item">{{ item }}</option></select></label>
      <label>院校层次<select v-model="filters.schoolTier"><option value="">全部院校层次</option><option v-for="item in facets?.schoolTiers || []" :key="item" :value="item">{{ item }}</option></select></label>
      <label>{{ activeTab === 'facts' ? '学历要求' : '办学层次' }}<select v-model="filters.educationLevel"><option value="">{{ activeTab === 'facts' ? '全部学历要求' : '全部办学层次' }}</option><option v-for="item in facets?.educationLevels || []" :key="item" :value="item">{{ item }}</option></select></label>
      <label v-if="activeTab === 'facts'">资料类别<select v-model="filters.category"><option value="">全部类别</option><option v-for="(label, key) in gridCategoryLabels" :key="key" :value="key">{{ label }}</option></select></label>
      <template v-else>
        <label>招聘单位类别<select v-model="filters.orgCategory"><option value="">全部互斥类别</option><option v-for="item in facets?.orgCategories || []" :key="item" :value="item">{{ gridOrgCategoryLabels[item] || item }}</option></select></label>
        <label>电力院校标签<select v-model="filters.industryTag"><option value="">全部院校标签</option><option v-for="item in facets?.industryTags || []" :key="item" :value="item">{{ item }}</option></select></label>
        <label>院校统计视角<select v-model="filters.view"><option value="parent">母校合并</option><option value="campus">校区明细</option></select></label>
      </template>
      <div class="query-submit"><button type="submit" class="primary" :disabled="loading">{{ loading ? '查询中…' : '查询' }}</button><button type="button" @click="clearFilters">重置</button></div>
    </form>
    <p v-if="directoryLoading" class="directory-status" role="status">正在读取筛选目录…</p>
    <p v-else-if="directoryError" class="query-error" role="alert">{{ directoryError }} <button type="button" @click="loadDirectory">重试目录</button></p>

    <aside class="query-boundary" aria-label="数据使用边界">
      <strong>{{ activeTab === 'facts' ? '参考资料，不替代官方公告' : '公示记录数口径 · 隐私保护' }}</strong>
      <p v-if="activeTab === 'facts'">省级适用规则与城市专属证据分别标注；年份不明不推算。历史分数不代表本届分数线；待遇保留原文与地域年份，不以最高值作起薪承诺，也不自动生成报考结论。</p>
      <p v-else>同数并列排名；母校合并与校区明细为两种视角，不相加。省份指招聘目的地，不是学校所在地。学校办学层次来自院校目录，不代表公示人员学历。少于5条的固定明细格先隐藏，再筛选与汇总，因此可展示记录数是下限，不能视为全量人数。</p>
      <p v-if="loadedResult?.disclaimer">{{ loadedResult.disclaimer }}</p>
    </aside>
    <div ref="resultTop" class="query-result-heading" aria-live="polite">
      <h3>{{ scopeCaption }} <span>{{ activeTab === 'facts' ? '资料结果' : '院校榜' }}</span></h3>
      <span v-if="!loading && loadedResult">{{ total.toLocaleString('zh-CN') }} {{ activeTab === 'facts' ? '条资料' : '所 / 项' }} · 第 {{ page }} / {{ totalPages }} 页</span>
    </div>
    <div v-if="loading" class="query-empty" role="status">正在查询已授权资料…</div>
    <div v-else-if="error" class="query-empty query-error" role="alert"><p>{{ error }}</p><button type="button" @click="search(page)">重新查询</button></div>
    <div v-else-if="loadedResult && !total" class="query-empty">
      <strong>当前条件暂无可展示资料</strong>
      <p>不代表没有招聘、不能报考或人数为零。请调整筛选，或等待来源核验补充。</p>
    </div>
    <section v-else-if="activeTab === 'facts'" class="fact-list" aria-label="政策与历史考情查询结果">
      <article v-for="item in (facts?.items || []).filter(item => recruitmentDisplayText(item.text))" :key="`${item.datasetKey}:${item.version}:${item.factKey}`" class="fact-card">
        <div class="fact-tags">
          <span class="scope-tag" :class="item.applicability">{{ gridFactScopeLabel(item) }}</span>
          <span>{{ gridCategoryLabels[item.category] || item.category }}</span><span>{{ gridYearLabel(item.cohortYear) }}</span>
          <span>{{ gridLabels[item.grid] || item.grid }} · {{ gridBatchLabels[item.batchCode] || item.batchCode }}</span>
          <span class="reference-tag">{{ item.dataStatus === 'reference' ? '资料参考 · 未提升为官方' : '待核验资料' }}</span>
        </div>
        <h4>{{ recruitmentDisplayTitle(item.title) }}</h4>
        <p v-if="item.company" class="fact-company">{{ item.company }}</p>
        <p class="fact-original">{{ recruitmentDisplayText(item.text) }}</p>
        <details class="fact-evidence">
          <summary>查看来源与原文定位 · {{ item.source.title }}</summary>
          <dl><dt>证据定位</dt><dd>{{ item.evidenceLocator }}</dd><dt>来源性质</dt><dd>{{ item.source.sourceType === 'user_material' ? '用户提供资料' : item.source.sourceType === 'roster_aggregate' ? '脱敏公示汇总' : '官方来源参考（不代表本条已核验）' }}</dd><dt>来源说明</dt><dd>{{ item.source.note || '未补充说明' }}</dd><dt>资料版本</dt><dd>{{ item.datasetKey }} / {{ item.version }}</dd></dl>
          <p v-if="item.relatedOfficialSourceKey">已关联官方来源索引：{{ item.relatedOfficialSourceKey }}（关联不等同本条通过官方核验）</p>
          <a v-if="safeGridSourceUrl(item.source.sourceUrl)" :href="safeGridSourceUrl(item.source.sourceUrl)!" target="_blank" rel="noopener noreferrer">打开来源网页 ↗</a>
        </details>
      </article>
    </section>
    <section v-else class="ranking-section" aria-label="全国院校公示记录排名">
      <div class="ranking-scroll">
        <table><caption>{{ submittedFilters.view === 'campus' ? '校区明细' : '母校合并' }} · 按{{ displayCountLabel }}降序排列</caption>
          <thead><tr><th scope="col">并列排名</th><th scope="col">学校 / 校区</th><th scope="col">院校层次 / 办学层次</th><th scope="col" class="numeric">国网一批</th><th scope="col" class="numeric">国网二批</th><th scope="col" class="numeric">国网三批</th><th scope="col" class="numeric">国网合计</th><th scope="col" class="numeric">南网春招</th><th scope="col" class="numeric">南网秋招</th><th scope="col" class="numeric">南网合计</th><th scope="col" class="numeric">{{ displayCountLabel }}</th></tr></thead>
          <tbody><tr v-for="item in rankings?.items || []" :key="`${item.schoolKey}:${item.campusName || ''}:${item.educationLevel || ''}`"><td class="rank-number">{{ item.rank ?? '—' }}</td><th scope="row">{{ item.schoolName }}<small v-if="item.campusName">{{ item.campusName }}</small><small v-if="item.industryTags?.length">{{ item.industryTags.join(' · ') }}</small></th><td>{{ gridCombinedLabels(item.schoolTiers, item.schoolTier, '待核') }}<small>{{ gridCombinedLabels(item.educationLevels, item.educationLevel, '办学层次未注明') }}</small></td><td class="numeric">{{ gridCountCell(item.batchCounts?.batch_1) }}</td><td class="numeric">{{ gridCountCell(item.batchCounts?.batch_2) }}</td><td class="numeric">{{ gridCountCell(item.batchCounts?.batch_3) }}</td><td class="numeric">{{ gridCountCell(item.gridCounts?.sgcc) }}</td><td class="numeric">{{ gridCountCell(item.batchCounts?.csg_spring) }}</td><td class="numeric">{{ gridCountCell(item.batchCounts?.csg_autumn) }}</td><td class="numeric">{{ gridCountCell(item.gridCounts?.csg) }}</td><td class="numeric"><strong>{{ gridCountCell(item.recordCount) }}</strong><small>条公示记录</small></td></tr></tbody>
        </table>
      </div>
      <p class="ranking-privacy">{{ rankings?.privacy.basis }} 该榜不与 HTML 中另一来源的院校数字混加；不展示个人名单或手机号。</p>
    </section>
    <nav v-if="loadedResult && total > 20" class="query-pagination" aria-label="查询结果分页">
      <button type="button" :disabled="page <= 1 || loading" @click="search(page - 1, true)">上一页</button><span>第 {{ page }} / {{ totalPages }} 页</span><button type="button" :disabled="page >= totalPages || loading" @click="search(page + 1, true)">下一页</button>
    </nav>
    <details v-if="facets?.versions.length" class="dataset-versions">
      <summary>已接入数据版本与口径</summary>
      <article v-for="version in facets.versions" :key="`${version.datasetKey}:${version.version}`"><strong>{{ version.title }}</strong><span>{{ version.version }} · {{ version.sourceCount }} 个来源</span><p v-for="(note, index) in version.notes" :key="index">{{ note }}</p></article>
    </details>
  </div>
</template>

<style scoped>
.grid-information { color: #164563; font-size: 14px; line-height: 1.6; min-width: 0; }
.query-heading { padding-right: 54px; }
.query-eyebrow { color: #3089b4; font-size: 11px; font-weight: 750; letter-spacing: .12em; }
.query-heading h2 { margin: 5px 0 8px; color: #0f4679; font-size: clamp(24px, 2.4vw, 34px); }
.query-heading p { margin: 0; color: #53748b; }
.query-tabs { display: flex; width: fit-content; padding: 4px; margin: 18px 0; gap: 4px; border: 1px solid #c7e1f1; border-radius: 12px; background: #eaf5fc; }
button { min-height: 38px; padding: 8px 16px; border: 1px solid #c3ddec; border-radius: 8px; color: #245a7a; background: #fff; cursor: pointer; font: inherit; font-weight: 650; }
button:disabled { opacity: .6; cursor: wait; }
button:focus-visible, input:focus-visible, select:focus-visible, summary:focus-visible, a:focus-visible { outline: 3px solid #078bcd; outline-offset: 2px; }
.query-tabs button { border: none; background: transparent; }
.query-tabs button.selected, button.primary { color: #fff; background: #087eae; }
.query-filters { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 12px; padding: 18px; border: 1px solid #c9e1ee; border-radius: 14px; background: #f0f8fd; }
.query-filters label { display: grid; align-content: end; gap: 5px; color: #52728a; font-size: 12px; font-weight: 650; min-width: 0; }
.query-filters input, .query-filters select { box-sizing: border-box; width: 100%; min-height: 40px; padding: 8px 10px; border: 1px solid #bedcea; border-radius: 8px; color: #234d66; background: white; font: inherit; font-size: 14px; }
.keyword-filter { grid-column: span 2; }
.query-submit { display: flex; align-items: end; justify-content: end; gap: 8px; grid-column: 1 / -1; }
.query-submit .primary { min-width: 92px; }
.directory-status, .query-error { margin: 12px 0; }
.query-error { color: #a54436; }
.query-boundary { padding: 12px 16px; margin: 16px 0; border-left: 3px solid #60adce; border-radius: 4px 10px 10px 4px; background: #edf7fb; font-size: 12px; }
.query-boundary p { margin: 3px 0 0; color: #56788f; }
.query-result-heading { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin: 18px 0 12px; }
.query-result-heading h3 { margin: 0; color: #194d70; font-size: 20px; }
.query-result-heading h3 span, .query-result-heading > span { color: #648398; font-size: 13px; font-weight: 450; }
.query-empty { padding: 40px 20px; text-align: center; border: 1px dashed #b9d9ec; border-radius: 12px; background: #f9fcff; }
.query-empty p { color: #6a8292; }
.fact-list { display: grid; gap: 14px; }
.fact-card { padding: 20px; border: 1px solid #cae1ee; border-radius: 12px; background: #fff; }
.fact-tags { display: flex; flex-wrap: wrap; gap: 6px; }
.fact-tags span { padding: 2px 8px; color: #4d748c; border-radius: 5px; background: #f0f7fb; font-size: 11px; }
.fact-tags .scope-tag { color: #1a739d; background: #e4f3ff; }
.fact-tags .province_inherited, .fact-tags .reference-tag { color: #825d23; background: #fff5df; }
.fact-card h4 { margin: 13px 0 5px; font-size: 18px; color: #184d75; }
.fact-company { margin: 0 0 9px; font-size: 12px; color: #62849b; }
.fact-original { white-space: pre-wrap; overflow-wrap: anywhere; margin: 10px 0 15px; line-height: 1.85; }
.fact-evidence { border-top: 1px solid #e2edf4; padding-top: 10px; color: #57778d; font-size: 12px; }
summary { cursor: pointer; overflow-wrap: anywhere; }
.fact-evidence dl { display: grid; grid-template-columns: 80px minmax(0, 1fr); gap: 5px 12px; margin: 12px 0; }
.fact-evidence dt { color: #8095a4; }
.fact-evidence dd { margin: 0; overflow-wrap: anywhere; white-space: pre-wrap; }
.fact-evidence a { color: #047baa; font-weight: 650; }
.ranking-scroll { overflow-x: auto; border: 1px solid #cce2ee; border-radius: 12px; }
table { width: 100%; min-width: 1160px; border-collapse: collapse; background: #fff; }
caption { text-align: left; padding: 13px 18px; background: #f1f9fd; font-weight: 700; }
th, td { padding: 13px 12px; text-align: left; border-top: 1px solid #e3edf4; }
thead { color: #648599; background: #f7fbfe; font-size: 12px; }
tbody th { color: #235372; font-size: 14px; }
tbody tr:nth-child(even) { background: #f8fcff; }
.numeric { text-align: right; white-space: nowrap; }
.numeric strong { color: #057ead; font-size: 19px; font-variant-numeric: tabular-nums; }
td small, th small { display: block; color: #7892a3; font-size: 11px; font-weight: 450; }
.rank-number { width: 75px; font-variant-numeric: tabular-nums; color: #3c809f; }
.ranking-privacy { color: #698294; font-size: 12px; }
.query-pagination { display: flex; justify-content: center; align-items: center; gap: 18px; margin: 20px 0; color: #6d889a; font-size: 13px; }
.dataset-versions { padding: 14px 16px; margin-top: 18px; border: 1px solid #d3e5ef; border-radius: 10px; color: #587d94; font-size: 12px; }
.dataset-versions article { display: grid; gap: 4px; padding: 12px 0; border-top: 1px solid #dceaf2; margin-top: 8px; }
.dataset-versions p { margin: 0; white-space: pre-wrap; }
@media (max-width: 1100px) { .query-filters { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
@media (max-width: 700px) {
  .query-filters { grid-template-columns: repeat(2, minmax(0, 1fr)); padding: 12px; gap: 10px; }
  .query-heading { padding-right: 28px; }
  .query-tabs { width: 100%; }
  .query-tabs button { flex: 1; padding: 8px; }
  .query-result-heading { align-items: start; gap: 5px; flex-direction: column; }
  .fact-card { padding: 14px; }
  table { min-width: 1160px; }
  th, td { padding: 10px 12px; }
}
</style>
