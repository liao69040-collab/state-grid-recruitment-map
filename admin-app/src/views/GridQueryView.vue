<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { queryString, request } from "@/lib/api";
import GridMapCoverage from "@/components/GridMapCoverage.vue";
import GridNationalDirectory from "@/components/GridNationalDirectory.vue";
import StructuredValue from "@/components/StructuredValue.vue";
import { displayText, dateText } from "@/lib/display";
import { useRoute, useRouter } from "vue-router";

type Row = Record<string, any>;
type Tab = "facts" | "rankings" | "sources" | "versions" | "map" | "directory";
const tabs: { key: Tab; label: string }[] = [
  { key: "facts", label: "政策与历史考情" },
  { key: "rankings", label: "完整院校全榜" },
  { key: "directory", label: "省市学校与单位" },
  { key: "sources", label: "来源与证据" },
  { key: "versions", label: "数据版本" },
  { key: "map", label: "全国地图与位置核对" },
];
const labels: Record<string, string> = {
  sgcc: "国家电网", csg: "南方电网", unknown: "待核", other: "其他",
  campus: "提前批", batch_1: "第一批", batch_2: "第二批", batch_3: "第三批",
  csg_spring: "南网春招", csg_autumn: "南网秋招", all: "全批次适用", unspecified: "批次未明确",
  student_origin: "学籍与生源", education: "学历", school: "院校", major: "专业",
  age: "年龄", certificate: "证书", score: "历史分数", compensation: "待遇参考",
  application: "网申", exam: "考试", headcount: "人数口径", province: "省级适用",
  city: "城市证据", company: "公司适用", national: "全国适用",
  city_specific: "该城市专属证据", province_inherited: "省级适用 · 非城市专属", direct: "直接匹配",
  reference: "用户资料参考", pending: "待核验", conflict: "来源冲突", quarantined: "已隔离",
  province_company: "省公司", direct_unit: "直属单位", headquarters: "总部", branch: "分部",
  industry: "省属产业单位", service: "供电服务公司", listed_company: "省属上市公司",
  supply_bureau: "供电局单列", branch_subunit: "分部所属单位",
  user_material: "用户资料", official_reference: "官方关联参考", roster_aggregate: "公示汇总资料",
};
const textOf = (value: unknown, fallback = "未注明") => value == null || value === "" ? fallback : labels[String(value)] || displayText(value, fallback);
const dimensionsOf = (values: unknown, fallback: unknown) => Array.isArray(values) && values.length
  ? [...new Set(values.map(value => textOf(value)).filter(Boolean))].join(" / ") : textOf(fallback);
const numberOf = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value.toLocaleString("zh-CN") : "—";
const route = useRoute(), router = useRouter();
const routeTab = () => tabs.find(item => item.key === route.query.tab)?.key || 'facts';
const tab = ref<Tab>(routeTab());
const initialFilters = { q: "", province: "", city: "", company: "", cohortYear: "2026", grid: "", batchCode: "", schoolTier: "", educationLevel: "", category: "", orgCategory: "", industryTag: "", dataStatus: "", view: "parent" };
const filters = reactive({ ...initialFilters });
const submitted = ref({ ...initialFilters });
const batchColumns = ["batch_1", "batch_2", "batch_3", "csg_autumn", "csg_spring"];
const facets = ref<Row>({});
const rows = ref<Row[]>([]);
const factGroups = computed(() => {
  const definitions = [
    { label: "报名与资格条件", categories: ["student_origin", "education", "school", "major", "age", "certificate"] },
    { label: "招聘与报名数量", categories: ["headcount"] },
    { label: "考试分数与安排", categories: ["score", "exam"] },
    { label: "报名流程与待遇参考", categories: ["application", "compensation"] },
  ];
  const known = new Set(definitions.flatMap(group => group.categories));
  return [...definitions.map(group => ({ label: group.label, items: rows.value.filter(row => group.categories.includes(row.category)) })),
    { label: "其他相关资料", items: rows.value.filter(row => !known.has(row.category)) }].filter(group => group.items.length);
});
const factPreview = (value: unknown) => {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > 160 ? `${text.slice(0, 160)}…` : text || "尚无正文";
};
const total = ref(0);
const page = ref(1);
const pageSize = 20;
const loading = ref(false);
const error = ref("");
const directoryError = ref("");
const disclaimer = ref("");
const detail = ref<Row | null>(null);
const detailDialog = ref<HTMLElement | null>(null);
let previousFocus: HTMLElement | null = null;
watch(detail, async (value) => {
  if (value) {
    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    await nextTick(); detailDialog.value?.focus();
  } else { previousFocus?.focus(); previousFocus = null; }
});
const handleDetailKey = (event: KeyboardEvent) => {
  if (event.key === "Escape") { event.preventDefault(); detail.value = null; return; }
  if (event.key !== "Tab" || !detailDialog.value) return;
  const items = [...detailDialog.value.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],[tabindex="0"]')];
  const first = items[0], last = items[items.length - 1];
  if (!first || !last) { event.preventDefault(); return; }
  if (event.shiftKey && (document.activeElement === first || document.activeElement === detailDialog.value)) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
};
let generation = 0;
let disposed = false;
const cities = computed(() => (facets.value.cities || []).filter((r: Row) => !filters.province || r.province === filters.province));
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / pageSize)));
const safeUrl = (value: unknown) => {
  try { const u = new URL(String(value)); return ["https:", "http:"].includes(u.protocol) ? u.href : null; } catch { return null; }
};
const params = () => {
  const f = submitted.value;
  if (tab.value === "versions") return {};
  if (tab.value === "sources") return { q: f.q, page: page.value, pageSize };
  const base: Row = { q: f.q, province: f.province, company: f.company, cohortYear: f.cohortYear,
    grid: f.grid, batchCode: f.batchCode, schoolTier: f.schoolTier,
    educationLevel: f.educationLevel, page: page.value, pageSize };
  return tab.value === "rankings" ? { ...base, orgCategory: f.orgCategory, industryTag: f.industryTag, view: f.view }
    : { ...base, city: f.city, category: f.category, dataStatus: f.dataStatus };
};
const load = async () => {
  const id = ++generation;
  loading.value = true; error.value = ""; rows.value = []; detail.value = null; total.value = 0;
  if (tab.value === "map" || tab.value === "directory") { loading.value = false; disclaimer.value = ""; return; }
  try {
    const response = await request<Row>(`/admin/grid-query/${tab.value}${queryString(params())}`);
    if (disposed || id !== generation) return;
    rows.value = Array.isArray(response.items) ? response.items : [];
    total.value = Number(response.total ?? rows.value.length);
    disclaimer.value = String(response.disclaimer || facets.value.disclaimer || "");
  } catch (e) {
    if (!disposed && id === generation) error.value = e instanceof Error ? e.message : "查询失败，请重试。";
  } finally { if (!disposed && id === generation) loading.value = false; }
};
const search = () => { submitted.value = { ...filters }; page.value = 1; void load(); };
const reset = () => { Object.assign(filters, initialFilters); search(); };
const flip = (next: number) => { page.value = next; void load(); };
watch(tab, value => { if (route.query.tab !== value) void router.replace({ query: { ...route.query, tab: value } }); search(); });
watch(() => route.query.tab, () => { tab.value = routeTab(); });
watch(() => filters.province, () => { filters.city = ""; });
onMounted(async () => {
  try { facets.value = await request<Row>("/admin/grid-query/facets"); } catch (e) { directoryError.value = e instanceof Error ? e.message : "筛选项加载失败"; }
  if (!disposed) await load();
});
onBeforeUnmount(() => { disposed = true; generation++; rows.value = []; detail.value = null; });
</script>

<template>
  <section class="grid-query-admin">
    <div class="gq-heading">
      <div><span class="eyebrow">全国资料 · 与前台共用数据</span><h2>电网招聘资料与全国名录</h2>
        <p>默认查看 2026 届，可切换年份、地区、电网与批次；原文和版本信息完整保留。</p></div>
      <span class="gq-admin-badge">管理员 · 完整脱敏汇总</span>
    </div>
    <div class="gq-boundary" role="note">这里与前台共用已入库资料和录用公示汇总。核对时请选择相同年份、电网、地区、批次和院校视角；管理员另可查看仅供内部核验的资料，因此资料条目可能不同。录用公示条数不等于去重入职人数。</div>
    <div class="gq-tabs" role="tablist" aria-label="电网信息管理栏目">
      <button v-for="item in tabs" :key="item.key" role="tab" :aria-selected="tab === item.key" :class="{ active: tab === item.key }" @click="tab = item.key">{{ item.label }}</button>
    </div>
    <GridMapCoverage v-if="tab === 'map'" />
    <GridNationalDirectory v-if="tab === 'directory'" />
    <form v-if="tab !== 'versions' && tab !== 'map' && tab !== 'directory'" class="gq-filters" @submit.prevent="search">
      <label class="gq-search">关键词<input v-model="filters.q" maxlength="120" placeholder="学校、公司、要求或原文关键词" /></label>
      <template v-if="tab === 'facts' || tab === 'rankings'">
        <label>招聘地区<select v-model="filters.province"><option value="">全部地区</option><option v-for="p in facets.provinces || []" :key="p">{{ p }}</option></select></label>
        <label v-if="tab === 'facts'">城市<select v-model="filters.city"><option value="">全部 / 省级</option><option v-for="c in cities" :key="`${c.province}:${c.city}`" :value="c.city">{{ c.city }}</option></select></label>
        <label>公司<select v-model="filters.company"><option value="">全部公司</option><option v-for="c in facets.companies || []" :key="c">{{ c }}</option></select></label>
        <label>集团<select v-model="filters.grid"><option value="">国网及南网</option><option v-for="g in facets.grids || []" :key="g" :value="g">{{ textOf(g) }}</option></select></label>
        <label>届别 / 历史年份<select v-model="filters.cohortYear"><option value="">全部年份（含未注明）</option><option value="unknown">年份未注明</option><option v-for="y in facets.years || []" :key="y" :value="y">{{ y }}</option></select></label>
        <label>批次<select v-model="filters.batchCode"><option value="">全部批次</option><option v-for="b in facets.batches || []" :key="b" :value="b">{{ textOf(b) }}</option></select></label>
        <label>院校层次<select v-model="filters.schoolTier"><option value="">全部层次</option><option v-for="s in facets.schoolTiers || []" :key="s">{{ s }}</option></select></label>
        <label>{{ tab === 'rankings' ? '办学层次' : '学历要求' }}<select v-model="filters.educationLevel"><option value="">{{ tab === 'rankings' ? '全部办学层次' : '全部学历要求' }}</option><option v-for="e in facets.educationLevels || []" :key="e">{{ e }}</option></select></label>
        <template v-if="tab === 'facts'">
          <label>资料类别<select v-model="filters.category"><option value="">全部资料</option><option v-for="c in ['student_origin','education','school','major','age','certificate','score','compensation','application','exam','headcount','other']" :key="c" :value="c">{{ textOf(c) }}</option></select></label>
          <label>核验状态<select v-model="filters.dataStatus"><option value="">全部（含隔离）</option><option v-for="s in ['reference','pending','conflict','quarantined']" :key="s" :value="s">{{ textOf(s) }}</option></select></label>
        </template>
        <template v-else>
          <label>组织类别<select v-model="filters.orgCategory"><option value="">全部互斥类别</option><option v-for="o in facets.orgCategories || []" :key="o" :value="o">{{ textOf(o) }}</option></select></label>
          <label>行业标签<select v-model="filters.industryTag"><option value="">全部行业</option><option v-for="tag in facets.industryTags || []" :key="tag" :value="tag">{{ tag }}</option></select></label>
          <label>院校视角<select v-model="filters.view"><option value="parent">母校合并</option><option value="campus">校区明细</option></select></label>
        </template>
      </template>
      <div class="gq-filter-actions"><button class="button primary" type="submit" :disabled="loading">查询</button><button class="button secondary" type="button" @click="reset">重置</button></div>
    </form>
    <div v-if="directoryError" role="alert" class="gq-error">筛选目录加载失败：{{ directoryError }}。可刷新页面重试；下方查询结果不受此提示替代。</div>
    <div v-if="error" role="alert" class="gq-error">{{ error }} <button class="button secondary compact" @click="load">重试</button></div>
    <div v-if="tab !== 'map' && tab !== 'directory'" class="gq-summary"><span aria-live="polite">{{ loading ? '正在查询…' : `${numberOf(total)} 条${tab === 'rankings' ? '院校结果' : '记录'}` }}</span><small v-if="tab === 'rankings'">完整公示记录 · 同数并列名次 · 不按学校所在地推定录用城市。学校办学层次不代表公示人员学历。</small></div>
    <div v-if="tab !== 'map' && tab !== 'directory' && !loading && !error && !rows.length" class="gq-empty">此筛选下暂无资料。暂无不代表不招聘、不符合条件或记录数为零。</div>
    <div v-if="tab === 'facts'" class="gq-fact-groups">
      <section v-for="group in factGroups" :key="group.label"><h3 class="gq-group-heading">{{ group.label }}<small>本页 {{ group.items.length }} 项</small></h3><div class="gq-facts">
      <article v-for="row in group.items" :key="`${row.datasetKey}:${row.factKey}`" :class="{ 'gq-isolated': row.dataStatus === 'quarantined' || row.dataStatus === 'conflict' }">
        <div class="gq-tags"><span>{{ row.cohortYear ?? '年份未注明' }}</span><span>{{ textOf(row.batchCode) }}</span><span>{{ textOf(row.applicability) }}</span><b>{{ textOf(row.dataStatus) }}</b></div>
        <h3>{{ row.title }}</h3><p class="gq-scope">{{ textOf(row.province, '全国 / 未注明地区') }} · {{ textOf(row.city, '无城市专属定位') }} · {{ textOf(row.company, '公司未注明') }}</p>
        <p class="gq-preview">{{ factPreview(row.text) }}</p>
        <details><summary>展开完整内容</summary><p class="gq-excerpt">{{ row.text }}</p></details>
        <p v-if="row.issueReason" class="gq-issue">隔离 / 问题说明：{{ row.issueReason }}</p>
        <footer><span>{{ row.source?.title || row.sourceKey }} · {{ row.evidenceLocator }}</span><button class="button secondary compact" @click="detail = row">查看证据</button></footer>
      </article>
      </div></section>
    </div>
    <div v-else-if="rows.length" class="gq-table-wrap">
      <table v-if="tab === 'rankings'" class="gq-ranking-table"><caption>完整脱敏院校公示记录榜（{{ submitted.view === 'parent' ? '母校合并' : '校区明细' }}）· 小计与批次列均遵循已提交筛选</caption><thead><tr><th>并列名次</th><th>院校 / 校区</th><th>院校层次 / 办学层次</th><th>行业标签</th><th v-for="batch in batchColumns" :key="batch" class="gq-number">{{ textOf(batch) }}</th><th class="gq-number">国网小计</th><th class="gq-number">南网小计</th><th class="gq-number">公示记录总数</th></tr></thead><tbody><tr v-for="row in rows" :key="row.schoolKey"><td>{{ row.rank ?? '—' }}</td><th scope="row">{{ row.schoolName }}<small>{{ textOf(row.campusName, '母校合并') }}</small></th><td>{{ dimensionsOf(row.schoolTiers, row.schoolTier) }}<small>{{ dimensionsOf(row.educationLevels, row.educationLevel) }}</small></td><td>{{ row.industryTags?.join('、') || '未标注' }}</td><td v-for="batch in batchColumns" :key="batch" class="gq-number">{{ numberOf(row.batchCounts?.[batch]) }}</td><td class="gq-number">{{ numberOf(row.gridCounts?.sgcc) }}</td><td class="gq-number">{{ numberOf(row.gridCounts?.csg) }}</td><td class="gq-number">{{ numberOf(row.recordCount) }} 条</td></tr></tbody></table>
      <table v-else-if="tab === 'sources'"><caption>来源及证据目录</caption><thead><tr><th>来源</th><th>类型</th><th>数据集 / 版本</th><th>操作</th></tr></thead><tbody><tr v-for="row in rows" :key="`${row.datasetKey}:${row.sourceKey}`"><th scope="row">{{ row.title }}<small>{{ row.sourceKey }}</small></th><td>{{ textOf(row.sourceType) }}</td><td>{{ row.datasetKey }}<small>{{ row.version }}</small></td><td><button class="button secondary compact" @click="detail = row">查看来源</button></td></tr></tbody></table>
      <table v-else><caption>追加式数据版本记录</caption><thead><tr><th>数据集 / 版本</th><th>建立时间（北京）</th><th>来源数</th><th>资料数</th><th>汇总单元</th><th>操作</th></tr></thead><tbody><tr v-for="row in rows" :key="`${row.datasetKey}:${row.version}`"><th scope="row">{{ row.title }}<small>{{ row.datasetKey }} · {{ row.version }}</small></th><td>{{ dateText(row.createdAt) }}</td><td>{{ numberOf(row.sourceCount) }}</td><td>{{ numberOf(row.factCount) }}</td><td>{{ numberOf(row.outcomeCount) }}</td><td><button class="button secondary compact" @click="detail = row">版本说明</button></td></tr></tbody></table>
    </div>
    <p v-if="disclaimer" class="gq-disclaimer">{{ disclaimer }}</p>
    <div v-if="tab !== 'versions' && tab !== 'map' && tab !== 'directory'" class="gq-pagination"><button class="button secondary compact" :disabled="page <= 1 || loading" @click="flip(page - 1)">上一页</button><span>{{ page }} / {{ pageCount }}</span><button class="button secondary compact" :disabled="page >= pageCount || loading" @click="flip(page + 1)">下一页</button></div>
    <div v-if="detail" class="gq-dialog-backdrop" @click.self="detail = null" @keydown="handleDetailKey">
      <section ref="detailDialog" class="gq-dialog" role="dialog" aria-modal="true" aria-labelledby="gq-detail-title" tabindex="-1">
        <header><h2 id="gq-detail-title">{{ detail.title || '资料与版本详情' }}</h2><button class="button secondary compact" autofocus @click="detail = null">关闭</button></header>
        <template v-if="detail.factKey"><p class="gq-boundary">{{ textOf(detail.dataStatus) }} · {{ textOf(detail.applicability) }} · 不进入自动资格判断</p><p class="gq-original">{{ detail.text }}</p><p v-if="detail.issueReason" class="gq-issue">{{ detail.issueReason }}</p><p>证据定位：{{ detail.evidenceLocator }}</p></template>
        <dl><dt>数据集 / 版本</dt><dd>{{ detail.datasetKey }} / {{ detail.version }}</dd><dt>来源</dt><dd>{{ detail.source?.title || detail.title }}<small>{{ detail.sourceKey }}</small></dd><dt>来源说明</dt><dd><StructuredValue :value="detail.source?.note || detail.note || '参见版本记录'" /></dd><dt>内容校验值</dt><dd class="gq-hash">{{ detail.source?.sha256 || detail.sha256 || detail.checksumSha256 || '未提供' }}</dd></dl>
        <a v-if="safeUrl(detail.source?.sourceUrl || detail.sourceUrl)" :href="safeUrl(detail.source?.sourceUrl || detail.sourceUrl)!" target="_blank" rel="noopener noreferrer" class="button secondary">打开来源链接</a>
        <StructuredValue v-if="detail.notes" :value="detail.notes" />
      </section>
    </div>
  </section>
</template>

<style scoped>
.grid-query-admin { max-width:1600px; margin:auto; }
.gq-heading { display:flex; gap:20px; justify-content:space-between; align-items:flex-start; margin-bottom:20px; }
h2 { margin:0 0 10px; font-size:24px; color:var(--ink-strong); } h3 { margin:14px 0 6px; font-size:17px; }
.gq-heading p,.gq-scope,.gq-disclaimer { color:var(--ink-muted); font-size:13px; line-height:1.7; }
.gq-admin-badge,.gq-tags span,.gq-tags b { padding:6px 10px; background:#e5f4fe; border-radius:8px; font-size:12px; }
.gq-admin-badge { white-space:nowrap; color:#0875ad; }
.gq-boundary { border:1px solid var(--line); background:#f4fbff; padding:15px 18px; border-radius:12px; font-size:13px; line-height:1.8; }
.gq-tabs { display:flex; gap:8px; margin:22px 0 16px; flex-wrap:wrap; }
.gq-tabs button { padding:12px 18px; border:1px solid var(--line); background:white; border-radius:10px; cursor:pointer; }
.gq-tabs button.active { background:#148cc7; color:white; border-color:#148cc7; }
.gq-filters { display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:12px; padding:18px; border:1px solid var(--line); border-radius:14px; background:white; }
.gq-filters label { display:flex; flex-direction:column; gap:7px; font-size:12px; font-weight:600; min-width:0; }
.gq-filters input,.gq-filters select { width:100%; padding:10px; border:1px solid var(--line); border-radius:8px; background:#faffff; color:var(--ink); min-height:40px; }
.gq-search { grid-column:span 2; }.gq-filter-actions { display:flex; gap:8px; align-items:flex-end; }
.gq-summary { display:flex; justify-content:space-between; gap:10px; margin:20px 0 12px; }.gq-summary small { color:var(--ink-muted); }
.gq-facts { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr)); gap:14px; }
.gq-fact-groups{display:grid;gap:20px}.gq-group-heading{display:flex;align-items:center;gap:14px;border-left:3px solid var(--primary);padding-left:10px}.gq-group-heading small{font-size:12px}.gq-preview{font-size:13px;line-height:1.8;overflow-wrap:anywhere}.gq-facts details{margin:8px 0 14px}.gq-facts summary{cursor:pointer;color:var(--primary-strong);font-size:12px;font-weight:600}
.gq-facts article { background:white; border:1px solid var(--line); border-radius:14px; padding:18px; min-width:0; }
.gq-facts article.gq-isolated { border-color:#e4b386; background:#fffaf5; }
.gq-tags { display:flex; flex-wrap:wrap; gap:6px; }.gq-tags b { background:#fff0cf; font-weight:500; }
.gq-excerpt { white-space:pre-wrap; overflow-wrap:anywhere; line-height:1.75; font-size:14px; max-height:180px; overflow:auto; }
.gq-facts footer { display:flex; gap:12px; justify-content:space-between; align-items:center; border-top:1px solid var(--line); padding-top:12px; }.gq-facts footer span { font-size:11px; color:var(--ink-muted); overflow-wrap:anywhere; }
.gq-issue,.gq-error { color:#a44721; background:#fff1df; border-radius:8px; padding:12px; line-height:1.7; }
.gq-table-wrap { overflow-x:auto; border:1px solid var(--line); border-radius:14px; background:white; }
.gq-ranking-table { min-width:1250px; }.gq-ranking-table th[scope="row"] { min-width:190px; }
table { border-collapse:collapse; width:100%; font-size:13px; } caption { text-align:left; padding:18px; color:var(--ink-muted); }th,td { padding:13px 16px; text-align:left; border-top:1px solid var(--line); vertical-align:top; }thead { background:#edf7fd; }.gq-number { text-align:right; font-variant-numeric:tabular-nums; font-weight:700; white-space:nowrap; }small { display:block; margin-top:5px; font-weight:400; color:var(--ink-muted); }
.gq-pagination { display:flex; justify-content:flex-end; gap:16px; align-items:center; margin-top:18px; }.gq-empty { text-align:center; padding:45px; border:1px dashed var(--line); border-radius:14px; }
.gq-dialog-backdrop { position:fixed; inset:0; z-index:100; background:#153f6166; display:flex; justify-content:center; align-items:center; padding:24px; }.gq-dialog { background:white; border-radius:18px; padding:24px; max-width:850px; width:100%; max-height:90dvh; overflow:auto; box-shadow:var(--shadow); }.gq-dialog header { display:flex; gap:20px; justify-content:space-between; align-items:flex-start; }.gq-original { white-space:pre-wrap; line-height:1.8; overflow-wrap:anywhere; }.gq-hash { overflow-wrap:anywhere; font-family:monospace; }dt { color:var(--ink-muted); font-size:12px; margin:16px 0 5px; }dd { margin:0; line-height:1.7; }
@media(max-width:700px) { .gq-heading { flex-direction:column; }.gq-heading h2 { font-size:20px; }.gq-filters { grid-template-columns:1fr 1fr; }.gq-search { grid-column:span 2; }.gq-summary { flex-direction:column; }.gq-dialog-backdrop { padding:10px; }.gq-dialog { padding:18px; } }
</style>
