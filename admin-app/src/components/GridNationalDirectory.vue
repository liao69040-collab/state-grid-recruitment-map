<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { queryString, request } from "@/lib/api";
import { displayText } from "@/lib/display";
import { directoryCount as count, directoryHasRosterCount, filterDirectoryRows } from "@/lib/directory-display";
import StructuredValue from "@/components/StructuredValue.vue";

type Row = Record<string, any>;
const overview = ref<Row | null>(null);
const province = ref("");
const city = ref("");
const grid = ref("");
const batch = ref("");
const mode = ref<"schools" | "companies">("schools");
const keyword = ref("");
const page = ref(1);
const loading = ref(false), detailLoading = ref(false);
const error = ref(""), detailError = ref("");
const detail = ref<Row | null>(null);
const selected = ref<Row | null>(null);
const detailPanel = ref<HTMLElement | null>(null);
const shownBatchCounts = computed(() => batch.value ? { [batch.value]: selected.value?.batchCounts?.[batch.value] ?? null } : selected.value?.batchCounts || {});
let generation = 0, detailGeneration = 0;
const query = () => ({ cohortYear: 2026, provinceAdcode: province.value, grid: grid.value, batchCode: batch.value });
const provinces = computed<Row[]>(() => overview.value?.provinceSummaries || []);
const cities = computed<Row[]>(() => (overview.value?.cities || []).filter((row: Row) => !province.value || row.provinceAdcode === province.value));
const allRows = computed<Row[]>(() => overview.value?.[mode.value === "schools" ? "localSchools" : "companies"] || []);
const rows = computed(() => filterDirectoryRows(allRows.value, mode.value, city.value, keyword.value));
const visibleRows = computed(() => rows.value.slice((page.value - 1) * 30, page.value * 30));
const pageCount = computed(() => Math.max(1, Math.ceil(rows.value.length / 30)));
const nameOf = (row: Row) => row.schoolName || row.name || row.company || "未命名";
const hasRosterCount = (row: Row) => directoryHasRosterCount(row, mode.value);
const load = async () => {
  const id = ++generation; detailGeneration++; detail.value = null; selected.value = null; detailLoading.value = false; detailError.value = "";
  loading.value = true; error.value = ""; page.value = 1;
  try { const result = await request<Row>(`/admin/grid-map/overview${queryString(query())}`); if (id === generation) overview.value = result; }
  catch (e) { if (id === generation) { overview.value = null; error.value = e instanceof Error ? e.message : "全国目录读取失败"; } }
  finally { if (id === generation) loading.value = false; }
};
const openDetail = async (row: Row) => {
  const id = ++detailGeneration;
  selected.value = row; detail.value = null; detailLoading.value = true; detailError.value = "";
  await nextTick(); detailPanel.value?.focus({ preventScroll: true }); detailPanel.value?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  const key = mode.value === "schools" ? row.campusKey : row.companyKey;
  if (!key) { detailLoading.value = false; detailError.value = "该条目缺少详情编号，请核对目录。"; return; }
  try { const result = await request<Row>(`/admin/grid-map/${mode.value}/${encodeURIComponent(key)}${queryString(query())}`); if (id === detailGeneration) detail.value = result; }
  catch (e) { if (id === detailGeneration) detailError.value = e instanceof Error ? e.message : "详情读取失败"; }
  finally { if (id === detailGeneration) detailLoading.value = false; }
};
const closeDetail = () => { detailGeneration++; selected.value = null; detail.value = null; detailLoading.value = false; detailError.value = ""; };
watch([province, grid, batch], () => { city.value = ""; void load(); });
watch([mode, city, keyword], () => { page.value = 1; closeDetail(); });
onMounted(load);
onBeforeUnmount(() => { generation++; detailGeneration++; overview.value = null; detail.value = null; });
</script>

<template>
  <section class="national-directory">
    <header><div><h3>2026 届 · 全国省市名录</h3><p>与前台地图共用目录。按省份、城市逐层查学校及单位，点击名称查看详细数据。</p></div><button class="button secondary compact" :disabled="loading" @click="load">刷新目录</button></header>
    <div class="directory-filters">
      <label>一级 · 省份<select v-model="province"><option value="">全国</option><option v-for="row in provinces" :key="row.adcode" :value="row.adcode">{{ row.name }}</option></select></label>
      <label>二级 · 城市<select v-model="city"><option value="">全部城市 / 省级单位</option><option v-for="row in cities" :key="row.adcode" :value="row.adcode">{{ row.name }}</option></select></label>
      <label>电网<select v-model="grid"><option value="">国网及南网</option><option value="sgcc">国家电网</option><option value="csg">南方电网</option></select></label>
      <label>批次<select v-model="batch"><option value="">全部批次</option><option v-for="key in ['batch_1','batch_2','batch_3','csg_autumn','csg_spring']" :key="key" :value="key">{{ displayText(key) }}</option></select></label>
      <label>查找名称<input v-model="keyword" placeholder="学校、校区或单位名称" maxlength="120" /></label>
    </div>
    <div class="directory-tabs"><button class="button" :class="mode === 'schools' ? 'primary' : 'secondary'" @click="mode = 'schools'">三级 · 学校与校区</button><button class="button" :class="mode === 'companies' ? 'primary' : 'secondary'" @click="mode = 'companies'">三级 · 招聘单位</button></div>
    <p class="directory-note">学校按校址所在地归类，学校公示数是当前电网与批次下的全国去向；单位按现有资料地区索引归类，城市索引不代表录用地点。缺少城市的单位保留省级归属。</p>
    <p v-if="loading" role="status">正在读取全国名录…</p><p v-else-if="error" role="alert" class="error">{{ error }}</p>
    <template v-else>
      <p>当前筛选 {{ count(rows.length) }} {{ mode === 'schools' ? '个学校 / 校区' : '个单位' }}</p>
      <section v-if="selected" ref="detailPanel" class="directory-detail" aria-label="名录详情" tabindex="-1">
        <header><h3>{{ nameOf(selected) }}</h3><button class="button secondary compact" @click="closeDetail">关闭详情</button></header>
        <p v-if="detailLoading" role="status">正在读取详情…</p><p v-if="detailError" role="alert" class="error">{{ detailError }} <button class="button secondary compact" @click="openDetail(selected)">重试</button></p>
        <template v-if="detail">
          <dl class="directory-summary"><div><dt>所属地区</dt><dd>{{ selected.province || '未注明' }} · {{ selected.city || selected.companyCity || '未单列城市' }}</dd></div><div><dt>{{ mode === 'schools' ? '全国录用公示' : '单位录用公示' }}</dt><dd>{{ hasRosterCount(selected) ? count(selected.recordCount) + ' 项' : '未提供名册统计' }}</dd></div><div><dt>位置精度</dt><dd>{{ ({ campus:'校园代表点',city:'城市参考点',province:'省级范围参考点',unlocated:'尚无确认位置' } as Record<string,string>)[selected.locationPrecision] || '未注明' }}</dd></div></dl>
          <details v-if="detail.school?.introduction" open><summary>学校介绍</summary><StructuredValue :value="detail.school.introduction" /></details>
          <details v-if="hasRosterCount(selected)" open><summary>{{ batch ? '当前批次录用公示' : '各批次录用公示' }}</summary><dl class="directory-summary"><div v-for="(value, key) in shownBatchCounts" :key="key"><dt>{{ displayText(key) }}</dt><dd>{{ count(value) }}{{ typeof value === 'number' ? ' 项' : '' }}</dd></div></dl></details>
          <details v-if="(detail.destinations || detail.schools || []).length" open><summary>{{ mode === 'schools' ? '录用去向单位' : '来源院校' }}</summary><div class="directory-table"><table><thead><tr><th>名称</th><th>省份</th><th>录用公示</th></tr></thead><tbody><tr v-for="row in detail.destinations || detail.schools || []" :key="row.companyKey || row.campusKey"><td>{{ nameOf(row) }}</td><td>{{ row.province || '未注明' }}</td><td>{{ count(row.recordCount) }}{{ typeof row.recordCount === 'number' ? ' 项' : '' }}</td></tr></tbody></table></div></details>
          <details v-if="detail.policyFacts?.length"><summary>招聘条件与资料（{{ detail.policyFacts.length }} 项）</summary><article v-for="row in detail.policyFacts" :key="row.factKey"><h4>{{ row.title }}</h4><p>{{ displayText(row.batchCode) }} · {{ row.cohortYear || '年份未注明' }}</p><p class="full-text">{{ row.text }}</p></article></details>
          <details><summary>内部关联与来源核对</summary><StructuredValue :value="{ aliases: detail.aliases, school: detail.school, company: detail.company, relatedCampuses: detail.relatedCampuses, sources: detail.sources, candidate: detail.candidate }" /></details>
        </template>
      </section>
      <div class="directory-table"><table><thead><tr><th>{{ mode === 'schools' ? '学校 / 校区' : '单位名称' }}</th><th>省份 / 城市</th><th>{{ mode === 'schools' ? '全国录用公示' : '单位录用公示' }}</th><th>{{ mode === 'schools' ? '办学层次' : '资料类型' }}</th></tr></thead><tbody><tr v-for="row in visibleRows" :key="row.campusKey || row.companyKey"><th scope="row"><button class="text-button" @click="openDetail(row)">{{ nameOf(row) }}</button><small v-if="row.campusName">{{ row.campusName }}</small></th><td>{{ row.province || '未注明' }}<small>{{ row.city || row.companyCity || '未单列城市' }}</small></td><td>{{ hasRosterCount(row) ? count(row.recordCount) + ' 项' : '未提供名册统计' }}</td><td>{{ displayText(mode === 'schools' ? row.educationLevel : row.candidateStatus) }}</td></tr><tr v-if="!rows.length"><td colspan="4">此筛选暂无名录，请调整城市、名称或批次。</td></tr></tbody></table></div>
      <footer><button class="button secondary compact" :disabled="page <= 1" @click="page--">上一页</button><span>{{ page }} / {{ pageCount }}</span><button class="button secondary compact" :disabled="page >= pageCount" @click="page++">下一页</button></footer>
    </template>
  </section>
</template>

<style scoped>
.national-directory{font-size:13px;color:var(--ink)}header{display:flex;justify-content:space-between;align-items:start;gap:16px}h3{font-size:18px;color:var(--ink-strong);margin:6px 0 9px}p{line-height:1.7}header p,.directory-note{color:var(--ink-muted)}.directory-filters{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin:18px 0;padding:16px;border:1px solid var(--line);background:white;border-radius:12px}label{display:grid;gap:7px;font-weight:600}select,input{width:100%;padding:10px;border:1px solid var(--line);border-radius:8px;background:white;color:var(--ink);font:inherit}.directory-tabs,footer{display:flex;gap:10px;align-items:center}.directory-table{overflow:auto;border:1px solid var(--line);border-radius:10px;background:white}table{width:100%;min-width:620px;border-collapse:collapse}th,td{padding:12px 15px;text-align:left;border-top:1px solid var(--line);vertical-align:top}thead{background:#edf7fd}small{display:block;color:var(--ink-muted);margin-top:5px;font-weight:400}.text-button{text-align:left;white-space:normal;line-height:1.5}footer{justify-content:flex-end;margin-top:16px}.directory-detail{padding:20px;margin:16px 0;background:white;border:1px solid #9dcedf;border-radius:14px}.directory-detail details{margin-top:14px}.directory-detail summary{cursor:pointer;padding:8px 0;font-weight:700;color:#276982}.directory-summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin:12px 0}.directory-summary>div{background:#f3f9fc;padding:12px;border-radius:9px}.directory-summary dt{color:var(--ink-muted);font-size:12px}.directory-summary dd{margin:7px 0 0;font-weight:700;line-height:1.5}.error{color:#a3482d;background:#fff3e8;padding:12px;border-radius:9px}.full-text{white-space:pre-wrap}.directory-detail article{padding:10px 0;border-top:1px solid var(--line)}@media(max-width:680px){header{flex-direction:column}.directory-filters{grid-template-columns:1fr 1fr}.directory-detail{padding:13px}}
</style>
