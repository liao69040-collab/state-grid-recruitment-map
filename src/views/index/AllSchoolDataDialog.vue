<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { authState } from '@/services/auth';
import { fetchGridRankings, GridInformationUnauthorized, type GridRankingResult } from '@/services/grid-information';
import { schoolAdmissionProvinces2026, schoolAdmissions2026Metadata, getSchoolAdmissionQueryLink2026 } from '../../data/school-admissions-2026.ts';
import {
  assertSchoolDataPage, SCHOOL_DATA_PAGE_SIZE, schoolDataBatchColumns, schoolDataCell,
  schoolDataName, schoolDataQuery, schoolPublicProfile, schoolPublicProfileMetadata, type SchoolDataTotals,
  schoolDataAdmissionReferences, schoolDataAdmissionPreview, schoolAdmissionScoreText, schoolAdmissionMetricLabel,
} from './school-data-display';

const props = withDefaults(defineProps<{
  cohortYear: number;
  totals?: SchoolDataTotals;
  rosterDataAvailable?: boolean;
  headingId?: string;
}>(), { headingId: 'allSchoolData-title' });
const emit = defineEmits<{ unauthorized: []; school: [campusKey: string] }>();
const keyword = ref('');
const submittedKeyword = ref('');
const view = ref<'parent' | 'campus'>('campus');
const admissionProvince = ref('');
const page = ref(1);
const jumpPage = ref(1);
const result = ref<GridRankingResult | null>(null);
const schoolRows = computed(() => result.value?.items.map(row => {
  const profile = schoolPublicProfile(row);
  const admissions = schoolDataAdmissionReferences(row, admissionProvince.value);
  const admissionLink = admissionProvince.value && profile && (view.value === 'campus' || (row.campusKeys?.length ?? 0) <= 1)
    ? getSchoolAdmissionQueryLink2026(profile.schoolName, profile.campusName, admissionProvince.value) : null;
  return { ...row, profile, admissions, admissionPreview: schoolDataAdmissionPreview(admissions), admissionLink };
}) ?? []);
const loading = ref(false);
const error = ref('');
const resultTop = ref<HTMLElement | null>(null);
const totalPages = computed(() => Math.max(1, Math.ceil((result.value?.total ?? 0) / SCHOOL_DATA_PAGE_SIZE)));
const summaryVisible = computed(() => authState.authenticated && props.rosterDataAvailable !== false && !!props.totals);
let controller: AbortController | null = null;
let sequence = 0;
let disposed = false;

function clearResults() {
  sequence += 1;
  controller?.abort();
  result.value = null;
  loading.value = false;
  error.value = '';
  page.value = 1;
  jumpPage.value = 1;
}
async function search(nextPage = 1, useSubmitted = false) {
  if (!authState.authenticated) { clearResults(); emit('unauthorized'); return; }
  if (props.rosterDataAvailable === false) { clearResults(); return; }
  controller?.abort();
  const active = new AbortController();
  controller = active;
  const token = ++sequence;
  const requestView = view.value;
  const query = useSubmitted ? submittedKeyword.value : keyword.value.trim();
  submittedKeyword.value = query;
  page.value = nextPage;
  jumpPage.value = nextPage;
  result.value = null;
  error.value = '';
  loading.value = true;
  try {
    const data = await fetchGridRankings(schoolDataQuery(props.cohortYear, query, requestView, nextPage), active.signal);
    if (disposed || active.signal.aborted || token !== sequence || !authState.authenticated) return;
    assertSchoolDataPage(data, nextPage, requestView);
    result.value = data;
    resultTop.value?.scrollIntoView({ block: 'nearest', behavior: 'auto' });
  } catch (failure) {
    if (disposed || active.signal.aborted || token !== sequence) return;
    if (failure instanceof GridInformationUnauthorized || !authState.authenticated) {
      clearResults();
      emit('unauthorized');
    } else error.value = failure instanceof Error ? failure.message : '学校数据暂时无法读取，请重试。';
  } finally { if (token === sequence) loading.value = false; }
}
function resetSearch() { keyword.value = ''; void search(1); }
function goToPage() {
  const selected = Number(jumpPage.value);
  if (Number.isInteger(selected) && selected >= 1 && selected <= totalPages.value) void search(selected, true);
}
watch(view, () => { void search(1); });
watch(() => authState.authenticated, authenticated => {
  clearResults();
  if (disposed) return;
  if (authenticated) void search(1);
  else emit('unauthorized');
});
watch(() => props.cohortYear, () => {
  clearResults();
  keyword.value = '';
  submittedKeyword.value = '';
  if (authState.authenticated && !disposed) void search(1);
});
watch(() => props.rosterDataAvailable, (available, prior) => {
  if (available === false) clearResults();
  else if (prior === false && authState.authenticated && !disposed) void search(1);
});
onMounted(() => { void search(1); });
onBeforeUnmount(() => { disposed = true; clearResults(); });
</script>

<template>
  <section class="school-data" data-qa="all-school-data" :data-school-profile-schema="schoolPublicProfileMetadata.schemaVersion" :data-school-admissions-schema="schoolAdmissions2026Metadata.schemaVersion" :aria-labelledby="headingId">
    <header class="school-data-heading">
      <span>{{ cohortYear }}届 · 全国录用公示</span>
      <h2 :id="headingId">全部学校数据</h2>
      <p>国网、南网全部批次 · 按公示记录合计排序</p>
    </header>
    <template v-if="authState.authenticated">
      <form v-if="rosterDataAvailable !== false" class="school-data-search" aria-label="查找学校数据" @submit.prevent="search(1)">
        <label class="school-data-keyword"><span class="sr-only">学校或校区名称</span><input v-model="keyword" type="search" maxlength="120" placeholder="搜索学校或校区" /></label>
        <button type="submit" class="school-data-primary" :disabled="loading">搜索</button>
        <button v-if="submittedKeyword || keyword" type="button" class="school-data-reset" @click="resetSearch">全部学校</button>
        <label class="school-data-view"><span class="sr-only">统计视角</span><select v-model="view"><option value="campus">校区明细</option><option value="parent">母校合并</option></select></label>
        <label class="school-data-admission-province"><span class="sr-only">高考招生省份</span><select v-model="admissionProvince"><option value="">高考招生省份</option><option v-for="province in schoolAdmissionProvinces2026" :key="province.adcode" :value="province.adcode">{{ province.name }} · 2026高考</option></select></label>
      </form>
      <p v-if="admissionProvince" class="school-data-admission-note">2026高考分数按招生省份、科类及专业查看；录用统计保持全国口径。仅显示已有官方分数，未收录的学校可查招生官网。</p>
      <div ref="resultTop" class="school-data-result-heading" aria-live="polite">
        <span v-if="result">{{ submittedKeyword ? `“${submittedKeyword}” · ` : '' }}{{ result.total.toLocaleString('zh-CN') }} {{ view === 'campus' ? '个学校 / 校区' : '所学校' }}</span>
        <span v-if="result && result.total">第 {{ page }} / {{ totalPages }} 页</span>
      </div>
      <p v-if="rosterDataAvailable === false" class="school-data-empty" role="status">{{ cohortYear }}届录用公示名册尚未接入，学校统计暂不可用。</p>
      <p v-else-if="loading" class="school-data-empty" role="status">正在读取学校数据…</p>
      <div v-else-if="error" class="school-data-empty school-data-error" role="alert"><p>{{ error }}</p><button type="button" @click="search(page, true)">重试</button></div>
      <p v-else-if="result && !result.total" class="school-data-empty">{{ submittedKeyword ? '没有找到对应学校，请尝试学校全称或校区名称。' : '当前届别暂无可展示的学校公示数据。' }}</p>
      <template v-else-if="result?.items.length">
        <div class="school-data-table-scroll" tabindex="0" aria-label="学校分批数据表，可横向滚动">
          <table class="school-data-table">
            <caption class="sr-only">{{ cohortYear }}届全国{{ view === 'campus' ? '学校校区明细' : '母校合并' }}，所有批次及电网合计</caption>
            <thead><tr><th scope="col">排名</th><th scope="col" class="school-data-name">学校 / 校区</th><th v-for="column in schoolDataBatchColumns.slice(0, 3)" :key="column.key" scope="col">{{ column.label }}</th><th scope="col">国网合计</th><th v-for="column in schoolDataBatchColumns.slice(3)" :key="column.key" scope="col">{{ column.label }}</th><th scope="col">南网合计</th><th scope="col">总计</th></tr></thead>
            <tbody>
              <tr v-for="row in schoolRows" :key="row.schoolKey">
                <td class="school-data-rank">{{ row.rank ?? '—' }}</td>
                <th scope="row" class="school-data-name">
                  <button v-if="view === 'campus'" type="button" class="school-data-school" @click="emit('school', row.schoolKey)">{{ schoolDataName(row) }}</button><span v-else>{{ row.schoolName }}</span>
                  <div v-if="row.profile?.tags.length" class="school-data-tags" aria-label="学校性质"><span v-for="tag in row.profile.tags" :key="tag">{{ tag }}</span></div>
                  <details v-if="row.admissions.length" class="school-data-admissions"><summary><template v-if="row.admissionPreview"><span>2026 · {{ row.admissionPreview.provinceName }} · {{ row.admissionPreview.subjectCategory }}</span><span>{{ row.admissionPreview.programmeName }} · {{ schoolAdmissionMetricLabel(row.admissionPreview.scoreKind) }} <b>{{ schoolAdmissionScoreText(row.admissionPreview.minScore) }}分</b></span></template><span v-else>2026高考专业分数 · {{ row.admissions.length }}条</span><em>分项与来源</em></summary><div v-for="(record, index) in row.admissions" :key="index" class="school-data-admission-record"><strong>{{ record.programmeName }}<span v-if="record.sourceProgrammeCode"> · 代号{{ record.sourceProgrammeCode }}</span></strong><span>{{ record.year }} · {{ record.provinceName }} · {{ record.subjectCategory }}</span><span>{{ record.admissionBatch }} · {{ record.admissionType }}</span><span>{{ schoolAdmissionMetricLabel(record.scoreKind) }} <b>{{ schoolAdmissionScoreText(record.minScore) }}分</b><template v-if="record.rank !== null"> · 位次{{ schoolDataCell(record.rank) }}</template></span><a :href="record.sourceUrl" target="_blank" rel="noopener noreferrer" :title="record.sourceTitle">官方来源 ↗</a></div></details>
                  <a v-else-if="row.admissionLink" class="school-data-admission-link" :href="row.admissionLink.url" target="_blank" rel="noopener noreferrer" :title="row.admissionLink.title">招生分数官网 ↗</a>
                  <small v-if="view === 'parent' && (row.campusKeys?.length ?? 0) > 1">含 {{ row.campusKeys?.length }} 个校区<span v-if="admissionProvince"> · 分数请切换校区明细</span></small>
                </th>
                <td v-for="column in schoolDataBatchColumns.slice(0, 3)" :key="column.key">{{ schoolDataCell(row.batchCounts[column.key]) }}</td><td class="school-data-grid-total">{{ schoolDataCell(row.gridCounts.sgcc) }}</td><td v-for="column in schoolDataBatchColumns.slice(3)" :key="column.key">{{ schoolDataCell(row.batchCounts[column.key]) }}</td><td class="school-data-grid-total">{{ schoolDataCell(row.gridCounts.csg) }}</td><td class="school-data-row-total">{{ schoolDataCell(row.recordCount) }}</td>
              </tr>
            </tbody>
            <tfoot v-if="summaryVisible"><tr><th scope="row" colspan="2">全国全部学校合计</th><td v-for="column in schoolDataBatchColumns.slice(0, 3)" :key="column.key">{{ schoolDataCell(totals?.batchCounts[column.key]) }}</td><td class="school-data-grid-total">{{ schoolDataCell(totals?.gridCounts.sgcc) }}</td><td v-for="column in schoolDataBatchColumns.slice(3)" :key="column.key">{{ schoolDataCell(totals?.batchCounts[column.key]) }}</td><td class="school-data-grid-total">{{ schoolDataCell(totals?.gridCounts.csg) }}</td><td class="school-data-row-total">{{ schoolDataCell(totals?.recordCount) }}</td></tr></tfoot>
          </table>
        </div>
        <div class="school-data-mobile" aria-label="学校分批数据列表">
          <article v-for="row in schoolRows" :key="row.schoolKey" class="school-data-card">
            <div class="school-data-card-title"><span class="school-data-rank">{{ row.rank ?? '—' }}</span><button v-if="view === 'campus'" type="button" class="school-data-school" @click="emit('school', row.schoolKey)">{{ schoolDataName(row) }}</button><strong v-else>{{ row.schoolName }}</strong><div class="school-data-card-total"><strong>{{ schoolDataCell(row.recordCount) }}</strong><small>总计</small></div></div>
            <div v-if="row.profile?.tags.length" class="school-data-tags" aria-label="学校性质"><span v-for="tag in row.profile.tags" :key="tag">{{ tag }}</span></div>
            <details v-if="row.admissions.length" class="school-data-admissions"><summary><template v-if="row.admissionPreview"><span>2026 · {{ row.admissionPreview.provinceName }} · {{ row.admissionPreview.subjectCategory }}</span><span>{{ row.admissionPreview.programmeName }} · {{ schoolAdmissionMetricLabel(row.admissionPreview.scoreKind) }} <b>{{ schoolAdmissionScoreText(row.admissionPreview.minScore) }}分</b></span></template><span v-else>2026高考专业分数 · {{ row.admissions.length }}条</span><em>分项与来源</em></summary><div v-for="(record, index) in row.admissions" :key="index" class="school-data-admission-record"><strong>{{ record.programmeName }}<span v-if="record.sourceProgrammeCode"> · 代号{{ record.sourceProgrammeCode }}</span></strong><span>{{ record.year }} · {{ record.provinceName }} · {{ record.subjectCategory }}</span><span>{{ record.admissionBatch }} · {{ record.admissionType }}</span><span>{{ schoolAdmissionMetricLabel(record.scoreKind) }} <b>{{ schoolAdmissionScoreText(record.minScore) }}分</b><template v-if="record.rank !== null"> · 位次{{ schoolDataCell(record.rank) }}</template></span><a :href="record.sourceUrl" target="_blank" rel="noopener noreferrer" :title="record.sourceTitle">官方来源 ↗</a></div></details>
            <a v-else-if="row.admissionLink" class="school-data-admission-link" :href="row.admissionLink.url" target="_blank" rel="noopener noreferrer" :title="row.admissionLink.title">招生分数官网 ↗</a>
            <small v-if="view === 'parent' && (row.campusKeys?.length ?? 0) > 1" class="school-data-campus-count">含 {{ row.campusKeys?.length }} 个校区</small>
            <div class="school-data-card-grid"><strong>国网 <span>{{ schoolDataCell(row.gridCounts.sgcc) }}</span></strong><dl><div v-for="column in schoolDataBatchColumns.slice(0, 3)" :key="column.key"><dt>{{ column.label.replace('国网', '') }}</dt><dd>{{ schoolDataCell(row.batchCounts[column.key]) }}</dd></div></dl></div>
            <div class="school-data-card-grid"><strong>南网 <span>{{ schoolDataCell(row.gridCounts.csg) }}</span></strong><dl><div v-for="column in schoolDataBatchColumns.slice(3)" :key="column.key"><dt>{{ column.label.replace('南网', '') }}</dt><dd>{{ schoolDataCell(row.batchCounts[column.key]) }}</dd></div></dl></div>
          </article>
        </div>
      </template>
      <nav v-if="result && result.total > SCHOOL_DATA_PAGE_SIZE" class="school-data-pagination" aria-label="学校数据分页">
        <button type="button" :disabled="loading || page <= 1" @click="search(page - 1, true)">上一页</button>
        <form class="school-data-jump" @submit.prevent="goToPage"><label><span class="sr-only">跳转到第几页</span><input v-model.number="jumpPage" type="number" min="1" :max="totalPages" inputmode="numeric" /></label><span>/ {{ totalPages }}</span><button type="submit" :disabled="loading">跳转</button></form>
        <button type="button" :disabled="loading || page >= totalPages" @click="search(page + 1, true)">下一页</button>
      </nav>
      <aside v-if="summaryVisible" :class="['school-data-summary', { 'summary-table-present': !loading && !!result?.items.length && !error }]" aria-label="全国全部学校合计">
        <div><strong>全国全部学校合计</strong><span> {{ schoolDataCell(totals?.recordCount) }} <small>条公示记录</small></span></div>
        <p>国网 {{ schoolDataCell(totals?.gridCounts.sgcc) }} · 南网 {{ schoolDataCell(totals?.gridCounts.csg) }}</p>
        <dl><div v-for="column in schoolDataBatchColumns" :key="column.key"><dt>{{ column.label }}</dt><dd>{{ schoolDataCell(totals?.batchCounts[column.key]) }}</dd></div></dl>
        <small v-if="submittedKeyword">全国合计包含全部学校，不随学校搜索改变。</small>
      </aside>
      <p class="school-data-note">{{ view === 'parent' ? '母校合并包含所属校区，与校区明细是同一批记录的两种视角。' : '同一大学的不同校区分别展示，可切换母校合并。' }} — 表示该项暂无可用数据。公示记录数不等于最终入职人数。学校性质按{{ schoolPublicProfileMetadata.directoryAsOf }}学校目录；985、211为历史工程身份，本科、专科指学校办学层次。</p>
    </template>
    <div v-else class="school-data-empty"><p>登录后查看各校完整批次数据。</p><button type="button" class="school-data-primary" @click="emit('unauthorized')">登录并查看</button></div>
  </section>
</template>

<style scoped>
.school-data { color: #193f5b; font-size: 14px; line-height: 1.55; min-width: 0; }
.school-data-heading { padding-right: 40px; }
.school-data-heading > span { color: #587e96; font-size: 12px; }
.school-data-heading h2 { margin: 4px 0 5px; font-size: clamp(22px, 2.3vw, 30px); color: #113f63; }
.school-data-heading p { margin: 0; color: #628295; font-size: 12px; }
.school-data-search { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin: 18px 0 12px; }
.school-data-keyword { min-width: 160px; flex: 1; }
.school-data-search input, .school-data-search select, .school-data-jump input { width: 100%; box-sizing: border-box; height: 42px; border: 1px solid rgba(114, 163, 188, .35); border-radius: 10px; padding: 8px 12px; background: rgba(255, 255, 255, .65); color: #224f68; font: inherit; }
button { min-height: 42px; padding: 8px 14px; border: 1px solid rgba(114, 163, 188, .35); border-radius: 10px; color: #245e7b; background: rgba(247, 253, 255, .7); cursor: pointer; font: inherit; font-weight: 650; }
button:disabled { opacity: .5; cursor: default; }
button:focus-visible, input:focus-visible, select:focus-visible, .school-data-table-scroll:focus-visible { outline: 3px solid #058ab9; outline-offset: 2px; }
button.school-data-primary { color: white; background: #137a9e; border-color: transparent; }
.school-data-view { width: 126px; }
.school-data-admission-province { width: 164px; }
.school-data-admission-note { color: #668296; font-size: 11px; margin: -3px 0 10px; }
.school-data-result-heading { display: flex; justify-content: space-between; gap: 12px; min-height: 24px; margin-bottom: 10px; color: #628294; font-size: 12px; }
.school-data-empty { margin: 12px 0; padding: 32px 15px; border: 1px dashed rgba(129, 176, 200, .55); border-radius: 14px; background: rgba(255, 255, 255, .4); text-align: center; }
.school-data-error { color: #9b4c40; }
.school-data-table-scroll { overflow-x: auto; max-width: 100%; border: 1px solid rgba(173, 203, 216, .6); border-radius: 14px; }
.school-data-table { width: 100%; min-width: 940px; border-collapse: collapse; background: rgba(255, 255, 255, .42); }
.school-data-table th, .school-data-table td { padding: 12px 11px; white-space: nowrap; text-align: right; border-bottom: 1px solid rgba(160, 191, 208, .28); font-variant-numeric: tabular-nums; }
.school-data-table thead th { background: rgba(227, 242, 248, .7); color: #5c7e94; font-size: 12px; }
.school-data-table .school-data-name { text-align: left; min-width: 220px; white-space: normal; }
.school-data-table .school-data-name small { display: block; font-size: 11px; color: #6e8a9c; font-weight: 400; }
.school-data-tags { display: flex; flex-wrap: wrap; gap: 3px 7px; margin-top: 2px; color: #5c7e8f; font-size: 11px; line-height: 1.5; font-weight: 450; }
.school-data-tags > span { white-space: nowrap; }
.school-data-admissions { margin-top: 5px; font-size: 11px; line-height: 1.6; color: #5f7d90; font-weight: 400; }
.school-data-admissions summary { cursor: pointer; }
.school-data-admissions summary > span { display: block; }
.school-data-admissions summary em { font-style: normal; color: #19789a; }
.school-data-admissions b { color: #186685; font-weight: 700; }
.school-data-admission-record { display: grid; gap: 1px; margin-top: 8px; padding-top: 7px; border-top: 1px solid rgba(158, 190, 208, .3); }
.school-data-admission-record strong { font-size: 11px; color: #305d76; }
.school-data-admission-record a, .school-data-admission-link { color: #19789a; font-size: 11px; text-decoration: none; }
.school-data-admission-record a:hover, .school-data-admission-link:hover { text-decoration: underline; }
.school-data-admission-link { display: inline-block; margin-top: 4px; }
.school-data-table .school-data-rank { text-align: center; width: 38px; }
.school-data-table tbody tr:nth-child(even) { background: rgba(237, 246, 250, .35); }
.school-data-grid-total { font-weight: 650; color: #33687e; }
.school-data-row-total { font-weight: 750; color: #126988; }
.school-data-table tfoot { background: rgba(216, 238, 248, .55); font-weight: 700; }
.school-data-table tfoot th { text-align: left; }
button.school-data-school { border: 0; border-radius: 5px; padding: 2px 0; color: #174f6d; background: transparent; text-align: left; }
button.school-data-school:hover { color: #0b7b9f; text-decoration: underline; }
.school-data-pagination { display: flex; justify-content: center; align-items: center; gap: 12px; margin: 18px 0; }
.school-data-jump { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #6b899c; }
.school-data-jump label { width: 54px; }
.school-data-jump input { padding: 6px; text-align: center; }
.school-data-jump button { padding: 6px 10px; }
.school-data-summary { margin-top: 18px; padding: 14px 16px; border: 1px solid rgba(156, 194, 212, .5); border-radius: 14px; background: rgba(221, 241, 249, .44); }
.school-data-summary > div { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px; align-items: center; }
.school-data-summary > div > span { font-size: 23px; font-weight: 750; color: #156c88; }
.school-data-summary small { color: #6b8799; font-size: 11px; font-weight: 400; }
.school-data-summary > p { margin: 4px 0 9px; color: #557e94; font-size: 12px; }
.school-data-summary dl { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px; margin: 0; font-size: 12px; }
.school-data-summary dt { color: #6c8797; }
.school-data-summary dd { margin: 2px 0 0; font-weight: 650; font-variant-numeric: tabular-nums; }
.school-data-note { color: #738b9a; font-size: 11px; margin: 12px 0 0; }
.school-data-mobile { display: none; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
@media (min-width: 721px) { .school-data-summary.summary-table-present { display: none; } }
@media (max-width: 720px) {
  .school-data-table-scroll { display: none; }
  .school-data-mobile { display: grid; gap: 10px; }
  .school-data-card { padding: 12px; border: 1px solid rgba(165, 194, 210, .5); border-radius: 14px; background: rgba(255, 255, 255, .52); }
  .school-data-card-title { display: flex; gap: 8px; align-items: center; }
  .school-data-card-title > .school-data-rank { font-size: 12px; color: #6c8b9c; flex: none; }
  .school-data-card-title > .school-data-school, .school-data-card-title > strong { flex: 1; min-width: 0; font-size: 14px; overflow-wrap: anywhere; }
  .school-data-card-total { flex: none; text-align: right; }
  .school-data-card-total strong { font-size: 20px; color: #126a89; font-variant-numeric: tabular-nums; }
  .school-data-card-total small { display: block; font-size: 10px; color: #72909f; }
  .school-data-campus-count { color: #7994a2; margin-left: 20px; font-size: 10px; }
  .school-data-card > .school-data-tags { margin: 0 0 3px 20px; font-size: 10px; }
  .school-data-card > .school-data-admissions, .school-data-card > .school-data-admission-link { margin-left: 20px; }
  .school-data-card-grid { display: flex; gap: 14px; align-items: center; margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(178, 199, 211, .35); }
  .school-data-card-grid > strong { font-size: 12px; flex: none; width: 68px; }
  .school-data-card-grid > strong span { display: block; color: #326d84; font-size: 14px; }
  .school-data-card-grid dl { flex: 1; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 7px; margin: 0; font-size: 12px; }
  .school-data-card-grid dt { color: #7a909d; font-size: 11px; }
  .school-data-card-grid dd { margin: 1px 0 0; font-weight: 650; font-variant-numeric: tabular-nums; }
  .school-data-search { gap: 6px; }
  .school-data-keyword { min-width: 150px; }
  .school-data-view, .school-data-admission-province { width: auto; min-width: 0; flex: 1 1 120px; }
  .school-data-result-heading { gap: 6px; flex-wrap: wrap; }
  .school-data-pagination { gap: 6px; }
  .school-data-pagination > button { padding: 6px 9px; font-size: 12px; }
  .school-data-jump { gap: 4px; }
  .school-data-jump label { width: 44px; }
  .school-data-jump button { padding: 6px; }
  .school-data-summary { padding: 12px; }
  .school-data-summary dl { grid-template-columns: repeat(3, minmax(0, 1fr)); row-gap: 10px; }
}
</style>
