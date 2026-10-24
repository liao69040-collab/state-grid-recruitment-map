<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { createMobileNavigation, queryText } from './mobile-navigation';
import { authState, bootstrapAuth } from '@/services/auth';
import { fetchProvinceRecruitmentProfile, type ProvinceRecruitmentProfile as ProfileData } from '@/services/provincial-recruitment';
import ProvinceRecruitmentProfile from '@/views/index/ProvinceRecruitmentProfile.vue';

const props = defineProps<{ provinceOptions: Array<{ name: string; adcode: string }>; initialProvinceAdcode?: string; referenceYear: number }>();
const route = useRoute(), navigation = createMobileNavigation(useRouter());
const historyEnabled = computed(() => route.name === 'mobile-query');
const emit = defineEmits<{ unauthorized: [] }>();
const province = ref(props.initialProvinceAdcode || '');
const profile = ref<ProfileData | null>(null);
const loading = ref(false);
const error = ref('');
const missing = ref(false);
const archiveOpen = ref(false);
const archiveLoading = ref(false);
const archiveError = ref('');
const unitsError = ref('');
const batches = ref<ArchiveBatch[]>([]);
const activeBatch = ref('');
const hierarchy = ref<ArchiveHierarchy | null>(null);
let profileController: AbortController | null = null;
let archiveController: AbortController | null = null;
let profileSequence = 0;
let archiveSequence = 0;
let disposed = false;
const apiBase = String(import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
interface ArchiveBatch {
  batch_code: string; ui_alias: string; official_label: string; period_summary_2026: string;
  milestones_2026: Array<{ event_id: string; stage: string; date_text: string; detail: string; sessions?: Array<{ label: string; time: string }> }>;
  electrical_reference_2026?: { scope_label: string; status_label: string; groups: Array<{ label: string; metrics: Array<{ label: string; value: string }> }>; notes: string[] };
}
interface ArchiveHierarchy {
  province_company?: { display_name?: string; direct_unit_count?: number; municipal_supply_company_count?: number; county_supply_enterprise_count?: number };
  selected_direct_units?: Array<{ display_name?: string }>;
  municipal_supply_companies?: Array<{ city?: string; display_name?: string }>;
  third_batch_subjects?: Array<{ display_name?: string; plan_count?: number; is_approximate?: boolean }>;
  zhengyuan_company_map?: { locations?: Array<{ city?: string; unit_name?: string; display_name?: string }> };
}
const provinceName = computed(() => props.provinceOptions.find(item => item.adcode === province.value)?.name || '');
const selectedBatch = computed(() => batches.value.find(item => item.batch_code === activeBatch.value));
const safeText = (value: unknown) => typeof value === 'string' || typeof value === 'number' ? String(value) : '';
const validCount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const hierarchyRows = computed(() => {
  const company = hierarchy.value?.province_company;
  if (!company) return [];
  return [{ label: '直属单位', value: company.direct_unit_count }, { label: '地市供电公司', value: company.municipal_supply_company_count }, { label: '县级供电企业', value: company.county_supply_enterprise_count }].filter(item => validCount(item.value));
});
const friendlyError = (reason: unknown, fallback: string) => reason instanceof Error && /[\u3400-\u9fff]/.test(reason.message) ? reason.message : fallback;
function clearPrivate() { profile.value = null; hierarchy.value = null; batches.value = []; }
async function loadProfile() {
  profileController?.abort(); const controller = new AbortController(); profileController = controller;
  const sequence = ++profileSequence; profile.value = null; error.value = ''; missing.value = false;
  if (!province.value || !authState.authenticated) { loading.value = false; return; }
  const selectedProvince = province.value, year = props.referenceYear;
  loading.value = true;
  try {
    const result = await fetchProvinceRecruitmentProfile(selectedProvince, year, controller.signal);
    if (disposed || controller.signal.aborted || sequence !== profileSequence || !authState.authenticated) return;
    profile.value = result;
  } catch (reason) {
    if (!controller.signal.aborted && sequence === profileSequence) {
      const message = friendlyError(reason, '省级招聘安排暂时无法读取，请重试。');
      missing.value = /404|尚未收录|没有.*资料|未提供.*资料/.test(message);
      if (!missing.value) error.value = message;
      if (!authState.authenticated) emit('unauthorized');
    }
  } finally { if (sequence === profileSequence) loading.value = false; }
}
async function archiveRequest(path: string, controller: AbortController, privateRequest: boolean) {
  const response = await fetch(`${apiBase}${path}`, { credentials: 'include', cache: 'no-store', signal: controller.signal, headers: { Accept: 'application/json' } });
  if (privateRequest && [401, 403].includes(response.status)) {
    await bootstrapAuth().catch(() => undefined); emit('unauthorized'); throw new Error('登录已失效，请重新登录。');
  }
  if (!response.ok) throw new Error(`招聘资料加载失败（${response.status}），请重试。`);
  if (!(response.headers.get('content-type') || '').includes('application/json')) throw new Error('招聘资料格式无效，请联系管理员。');
  const body = await response.json();
  return body?.payload ?? body;
}
async function loadArchive() {
  archiveController?.abort(); const controller = new AbortController(); archiveController = controller;
  const sequence = ++archiveSequence; clearArchive();
  if (!authState.authenticated || props.referenceYear !== 2026) return;
  archiveLoading.value = true;
  const timeout = window.setTimeout(() => controller.abort(), 15_000);
  const results = await Promise.allSettled([
    archiveRequest('/api/v2/public/dashboard', controller, false),
    archiveRequest('/api/v2/private/provinces/420000/dashboard', controller, true),
  ]);
  window.clearTimeout(timeout);
  if (disposed || sequence !== archiveSequence || !authState.authenticated || props.referenceYear !== 2026) return;
  archiveLoading.value = false;
  if (controller.signal.aborted) { archiveError.value = '招聘资料读取超时，请重试。'; return; }
  const [timelineResult, unitResult] = results;
  const timeline = timelineResult.status === 'fulfilled' ? timelineResult.value?.hubei?.recruitment_timeline : null;
  if (timeline?.data_cohort === '2026届' && /湖北/.test(timeline?.scope || '') && timeline?.timezone === 'Asia/Shanghai' && Array.isArray(timeline?.items)) {
    batches.value = timeline.items.filter((item: ArchiveBatch) => item && typeof item.batch_code === 'string' && Array.isArray(item.milestones_2026));
    const requestedBatch = queryText(route.query, 'mqArchiveBatch');
    activeBatch.value = batches.value.some(item => item.batch_code === requestedBatch) ? requestedBatch : batches.value[0]?.batch_code || '';
  } else archiveError.value = timelineResult.status === 'rejected' ? friendlyError(timelineResult.reason, '时间与考情暂时无法读取，请重试。') : '归档的湖北2026届范围尚未确认，暂不展示时间与考情。';
  const unitPayload = unitResult.status === 'fulfilled' ? unitResult.value : null;
  if (unitPayload?.scope?.cohort === '2026届' && unitPayload?.scope?.province_adcode === '420000' && (!unitPayload.data_sync || unitPayload.data_sync.cohort_year === 2026) && unitPayload?.company_hierarchy) hierarchy.value = unitPayload.company_hierarchy;
  else unitsError.value = unitResult.status === 'rejected' ? friendlyError(unitResult.reason, '单位层级暂时无法读取，请重试。') : '归档的湖北2026届单位范围尚未确认，暂不展示单位层级。';
}
function clearArchive() { batches.value = []; activeBatch.value = ''; hierarchy.value = null; archiveError.value = ''; unitsError.value = ''; }
function toggleArchive() {
  if (historyEnabled.value) { if (archiveOpen.value) void navigation.returnTo({ mqArchiveOpen: null, mqArchiveBatch: null }); else void navigation.push({ mqArchiveOpen: '1' }); return; }
  archiveOpen.value = !archiveOpen.value; if (archiveOpen.value && !batches.value.length && !hierarchy.value) void loadArchive();
}
function selectProvince(value: string) { if (historyEnabled.value) void navigation.push({ mqArchiveProvince: value || 'all', mqArchiveOpen: null, mqArchiveBatch: null }); else province.value = value; }
function selectArchiveBatch(value: string) { activeBatch.value = value; if (historyEnabled.value) void navigation.replace({ mqArchiveBatch: value }); }
function restoreArchiveRoute() {
  if (!historyEnabled.value) return;
  const requested = queryText(route.query, 'mqArchiveProvince');
  const fallback = props.initialProvinceAdcode || '';
  province.value = requested === 'all' ? '' : props.provinceOptions.some(item => item.adcode === requested) ? requested : fallback;
  const open = queryText(route.query, 'mqArchiveOpen') === '1' && props.referenceYear === 2026;
  archiveOpen.value = open;
  if (open && !archiveLoading.value && !batches.value.length && !hierarchy.value) void loadArchive();
  const selected = queryText(route.query, 'mqArchiveBatch');
  if (batches.value.some(item => item.batch_code === selected)) activeBatch.value = selected;
}
watch(() => route.fullPath, restoreArchiveRoute, { immediate: true });
watch([province, () => props.referenceYear], () => { void loadProfile(); archiveController?.abort(); archiveSequence++; archiveLoading.value = false; clearArchive(); archiveOpen.value = false; void nextTick(restoreArchiveRoute); }, { immediate: true });
watch(() => authState.authenticated, authenticated => { if (!authenticated) { profileController?.abort(); archiveController?.abort(); profileSequence++; archiveSequence++; clearPrivate(); loading.value = false; archiveLoading.value = false; } });
onBeforeUnmount(() => { disposed = true; profileSequence++; archiveSequence++; profileController?.abort(); archiveController?.abort(); clearPrivate(); });
</script>

<template>
  <div class="mobile-archive">
    <header><span>{{ referenceYear }}届 · 单位与批次</span><h1>招聘安排</h1><p>先选省份，查看已收录的报名要求、时间与单位安排。历史日期不平移到报考当年。</p></header>
    <label class="archive-province"><span>查看省份</span><select :value="province" aria-label="招聘安排省份" @change="selectProvince(($event.target as HTMLSelectElement).value)"><option value="">请选择省份</option><option v-for="item in provinceOptions" :key="item.adcode" :value="item.adcode">{{ item.name }}</option></select></label>
    <p v-if="!province" class="archive-state">选择省份后显示各招聘单位的条件和节点。</p>
    <div v-else-if="missing" class="archive-state"><strong>暂无{{ provinceName }}{{ referenceYear }}届单位招聘安排</strong><p>可在「地区条件」继续查询已收录的招聘要求。这里不借用其他省份的安排。</p><button type="button" @click="loadProfile">重新查询</button></div>
    <ProvinceRecruitmentProfile v-else :data="profile" :loading="loading" :error="error" :province-name="provinceName" :province-adcode="province" variant="dialog" heading-id="mobile-province-arrangement-title" @retry="loadProfile" />
    <section v-if="referenceYear === 2026" class="hubei-archive">
      <button class="archive-toggle" type="button" :aria-expanded="archiveOpen" @click="toggleArchive"><span><strong>湖北2026届详细安排</strong><small>四批次时间 · 电工类考情 · 招聘单位层级</small></span><b aria-hidden="true">{{ archiveOpen ? '−' : '＋' }}</b></button>
      <template v-if="archiveOpen">
        <p class="archive-note">这是湖北2026届归档，既不是全国安排，也不是2027届实时节点。</p>
        <p v-if="archiveLoading" class="archive-state" role="status">正在读取时间线、考情与单位…</p>
        <div v-else>
          <div v-if="archiveError || unitsError" class="archive-state" role="alert"><p>{{ archiveError }}</p><p>{{ unitsError }}</p><button type="button" @click="loadArchive">重试详细安排</button></div>
          <div v-if="batches.length" class="archive-batches" role="group" aria-label="湖北归档批次"><button v-for="item in batches" :key="item.batch_code" type="button" :aria-pressed="activeBatch === item.batch_code" @click="selectArchiveBatch(item.batch_code)">{{ item.ui_alias || item.official_label }}</button></div>
          <template v-if="selectedBatch">
            <h2>{{ selectedBatch.ui_alias }} · {{ selectedBatch.official_label }}</h2><p>{{ selectedBatch.period_summary_2026 }}</p>
            <section class="archive-timeline"><h3>报名、资格审查与考试</h3><p>所有日期与时间为北京时间。</p><article v-for="(item, index) in selectedBatch.milestones_2026" :key="item.event_id || index"><span aria-hidden="true">{{ index + 1 }}</span><div><h4>{{ item.stage }}</h4><strong>{{ item.date_text }}</strong><p>{{ item.detail }}</p><ul v-if="item.sessions?.length"><li v-for="(session, sessionIndex) in item.sessions" :key="sessionIndex"><strong>{{ session.time }}</strong> {{ session.label }}</li></ul></div></article><p v-if="!selectedBatch.milestones_2026.length">该批次未收录详细时间节点。</p></section>
            <section v-if="selectedBatch.electrical_reference_2026" class="archive-exam"><h3>{{ selectedBatch.electrical_reference_2026.scope_label }}</h3><p>{{ selectedBatch.electrical_reference_2026.status_label }}</p><article v-for="(group, index) in selectedBatch.electrical_reference_2026.groups" :key="index"><h4>{{ group.label }}</h4><dl><div v-for="(metric, metricIndex) in group.metrics" :key="metricIndex"><dt>{{ metric.label }}</dt><dd>{{ metric.value }}</dd></div></dl></article><ul><li v-for="(note, index) in selectedBatch.electrical_reference_2026.notes" :key="index">{{ note }}</li></ul><p class="archive-note">历史分数仅用于准备考试，不代表录取概率。</p></section>
          </template>
          <section v-if="hierarchy" class="archive-hierarchy"><h3>{{ hierarchy.province_company?.display_name || '湖北招聘单位层级' }}</h3><dl><div v-for="row in hierarchyRows" :key="row.label"><dt>{{ row.label }}</dt><dd>{{ row.value }}家</dd></div></dl><details v-if="hierarchy.selected_direct_units?.length"><summary>省公司直属单位</summary><ul><li v-for="(unit, index) in hierarchy.selected_direct_units" :key="index">{{ safeText(unit.display_name) }}</li></ul></details><details v-if="hierarchy.municipal_supply_companies?.length"><summary>地市供电公司</summary><ul><li v-for="(unit, index) in hierarchy.municipal_supply_companies" :key="index">{{ safeText(unit.display_name) || `${safeText(unit.city)}供电公司` }}</li></ul></details><details v-if="hierarchy.third_batch_subjects?.length"><summary>第三批招聘主体</summary><article v-for="(unit, index) in hierarchy.third_batch_subjects" :key="index"><h4>{{ safeText(unit.display_name) }}</h4><p v-if="validCount(unit.plan_count)">招聘名额{{ unit.is_approximate === false ? '' : '约' }}{{ unit.plan_count }}人</p></article><p class="archive-note">招聘名额与录用公示分别查看，不相加。</p></details><details v-if="hierarchy.zhengyuan_company_map?.locations?.length"><summary>正源企业所在地</summary><ul><li v-for="(unit, index) in hierarchy.zhengyuan_company_map.locations" :key="index">{{ [safeText(unit.city), safeText(unit.unit_name || unit.display_name)].filter(Boolean).join(' · ') }}</li></ul></details><p class="archive-note">单位名录或单位所在地不等于具体工作地；不会把全省录用数分摊给地市单位。</p></section>
        </div>
      </template>
    </section>
  </div>
</template>

<style scoped>
.mobile-archive {
  flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch; scroll-padding: 12px;
  padding: 10px 12px 22px; color: var(--mq-ink, #163743);
  font-size: 15px; line-height: 1.6; background: transparent;
}
.mobile-archive * { box-sizing: border-box; }
.mobile-archive h1 { font-size: 24px; line-height: 1.25; letter-spacing: -.6px; margin: 4px 0 6px; }
.mobile-archive h2 { font-size: 20px; line-height: 1.4; margin: 18px 0 9px; }
.mobile-archive h3 { font-size: 18px; line-height: 1.4; margin: 14px 0 8px; }
.mobile-archive h4 { font-size: 15px; line-height: 1.5; margin: 2px 0 4px; }
.mobile-archive p { font-size: 14px; line-height: 1.65; margin: 8px 0; overflow-wrap: anywhere; }
.mobile-archive > header > span { font-size: 12px; line-height: 1.4; color: var(--mq-muted, #4b6470); }
.mobile-archive > header > p { font-size: 13px; line-height: 1.55; color: var(--mq-muted, #4b6470); margin: 0; }
.mobile-archive button, .mobile-archive select {
  font: inherit; font-size: 16px; min-height: 44px; border-radius: 13px;
  color: #195b74; background: var(--mq-glass, #f8fdff);
  border: 1px solid var(--mq-line, #c8dbe4); padding: 8px 11px;
  box-shadow: inset 0 1px 0 #ffffffad; touch-action: manipulation;
}
.mobile-archive button:focus-visible, .mobile-archive summary:focus-visible,
.mobile-archive select:focus-visible, .mobile-archive a:focus-visible { outline: 3px solid #2498bd; outline-offset: 3px; }
.archive-province { display: grid; gap: 4px; margin: 13px 0; }
.archive-province span { font-size: 13px; color: var(--mq-muted, #4b6470); }
.archive-province select { width: 100%; max-width: 100%; background: var(--mq-card, #f9fcfd); }
.archive-state { padding: 17px 14px; border: 1px solid var(--mq-line, #c8dbe4); border-radius: 18px; background: var(--mq-card, #f9fcfd); box-shadow: var(--mq-shadow); }
.archive-state strong { display: block; font-size: 17px; }
.hubei-archive { margin-top: 16px; border: 0; padding-top: 0; }
.archive-toggle { display: flex; justify-content: space-between; align-items: center; width: 100%; gap: 10px; text-align: left; border-radius: 17px!important; padding: 12px!important; background: var(--mq-card, #f9fcfd)!important; box-shadow: var(--mq-shadow)!important; }
.archive-toggle span { min-width: 0; }
.archive-toggle strong, .archive-toggle small { display: block; }
.archive-toggle strong { font-size: 15px; line-height: 1.5; }
.archive-toggle small { font-size: 13px; color: var(--mq-muted, #4b6470); font-weight: 400; line-height: 1.55; margin-top: 3px; }
.archive-toggle b { font-size: 23px; color: #286b81; flex: none; }
.archive-note { padding: 10px 11px; border: 1px solid var(--mq-line, #c8dbe4); background: var(--mq-glass, #f8fdff); border-radius: 12px; font-size: 13px!important; color: #426271; }
.archive-batches { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 6px; margin-top: 12px; }
.archive-batches button { font-size: 14px; line-height: 1.5; }
.archive-batches [aria-pressed=true] { color: #155a73; background: var(--mq-active-glass, #e3eff4); border-color: rgba(46,117,144,.3); font-weight: 750; box-shadow: inset 0 1px 0 #ffffffe0, 0 2px 7px #25536b10; }
.archive-timeline article { display: grid; grid-template-columns: 30px minmax(0,1fr); gap: 9px; padding: 13px 0; border-top: 1px solid var(--mq-line, #c8dbe4); }
.archive-timeline article > span { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 9px; background: #237b99; color: #fff; font-size: 14px; }
.archive-timeline article div { min-width: 0; }
.mobile-archive ul { padding-left: 20px; font-size: 14px; line-height: 1.7; overflow-wrap: anywhere; }
.archive-exam article, .archive-hierarchy { padding: 13px; border: 1px solid var(--mq-line, #c8dbe4); border-radius: 17px; background: var(--mq-card, #f9fcfd); margin: 11px 0; box-shadow: var(--mq-shadow); }
.mobile-archive dl { margin: 7px 0; }
.mobile-archive dl > div { display: grid; grid-template-columns: minmax(0,1fr); gap: 3px; border-bottom: 1px solid var(--mq-line, #c8dbe4); padding: 9px 0; }
.mobile-archive dt { font-size: 13px; color: var(--mq-muted, #4b6470); }
.mobile-archive dd { margin: 0; font-size: 17px; font-weight: 700; overflow-wrap: anywhere; }
.mobile-archive details summary { min-height: 44px; padding: 10px 0; font-size: 15px; line-height: 1.6; font-weight: 700; cursor: pointer; }

/* Shared province reader retains its source, dates and interaction state. */
.mobile-archive :deep(.province-recruitment-profile) { color: var(--mq-ink, #163743); background: transparent; }
.mobile-archive :deep(.variant-dialog) { gap: 11px; }
.mobile-archive :deep(.profile-head) { padding-right: 0; }
.mobile-archive :deep(h2) { font-size: 20px!important; line-height: 1.4; }
.mobile-archive :deep(h3) { font-size: 17px!important; line-height: 1.4; }
.mobile-archive :deep(.profile-eyebrow), .mobile-archive :deep(small), .mobile-archive :deep(p),
.mobile-archive :deep(.evidence-badge), .mobile-archive :deep(.applicability),
.mobile-archive :deep(.raw-time), .mobile-archive :deep(.certainty),
.mobile-archive :deep(.headcount-boundary), .mobile-archive :deep(.boundary-note),
.mobile-archive :deep(.profile-metrics dt), .mobile-archive :deep(.coverage-grid span),
.mobile-archive :deep(.coverage-grid b), .mobile-archive :deep(.scope-card > span),
.mobile-archive :deep(.scope-card > strong), .mobile-archive :deep(.tier-legend span),
.mobile-archive :deep(.compact-section ul), .mobile-archive :deep(.gap-section ul),
.mobile-archive :deep(.gap-section strong), .mobile-archive :deep(.boundary-note strong) { font-size: 13px!important; line-height: 1.65; }
.mobile-archive :deep(.profile-head p), .mobile-archive :deep(.profile-metrics dt),
.mobile-archive :deep(.section-heading > small), .mobile-archive :deep(.certainty),
.mobile-archive :deep(.source-list article small) { color: var(--mq-muted, #4b6470); }
.mobile-archive :deep(.profile-eyebrow) { color: #3b697c; font-size: 12px!important; letter-spacing: .01em; }
.mobile-archive :deep(.requirement-list article > strong), .mobile-archive :deep(.event-copy > strong),
.mobile-archive :deep(.event-copy > time) { font-size: 15px; }
.mobile-archive :deep(.event-copy > b), .mobile-archive :deep(.headcount-list article > b) { font-size: 13px; }
.mobile-archive :deep(.unit-tabs), .mobile-archive :deep(.batch-tabs) { display: flex; flex-wrap: wrap; gap: 6px; }
.mobile-archive :deep(button), .mobile-archive :deep(.open-full), .mobile-archive :deep(.more-button) { min-height: 44px; font-size: 14px; border-radius: 12px; padding: 8px 10px; }
.mobile-archive :deep(.unit-tabs button), .mobile-archive :deep(.batch-tabs button) {
  color: #426271; background: var(--mq-glass, #f8fdff); border: 1px solid var(--mq-line, #c8dbe4);
  white-space: normal; text-align: left; font-weight: 600; box-shadow: inset 0 1px 0 #ffffffad;
}
.mobile-archive :deep(.unit-tabs button.active), .mobile-archive :deep(.batch-tabs button.active) {
  color: #155a73; background: var(--mq-active-glass, #e3eff4); border-color: rgba(46,117,144,.3);
  font-weight: 750; box-shadow: inset 0 1px 0 #ffffffe0, 0 2px 7px #25536b10;
}
.mobile-archive :deep(.profile-metrics) { grid-template-columns: repeat(2,minmax(0,1fr)); gap: 7px; font-size: 13px; }
.mobile-archive :deep(.profile-metrics div) { padding: 10px; border: 1px solid var(--mq-line, #c8dbe4); border-radius: 14px; background: var(--mq-card, #f9fcfd); box-shadow: var(--mq-shadow); }
.mobile-archive :deep(.profile-metrics dt) { white-space: normal; }
.mobile-archive :deep(.profile-metrics dd), .mobile-archive :deep(.profile-metrics strong) { font-size: 24px; line-height: 1.35; color: #196a86; }
.mobile-archive :deep(.headcount-list), .mobile-archive :deep(.requirement-list),
.mobile-archive :deep(.event-list), .mobile-archive :deep(.source-list) { grid-template-columns: minmax(0,1fr); }
.mobile-archive :deep(.profile-section), .mobile-archive :deep(.scope-card), .mobile-archive :deep(.profile-state) {
  padding: 12px; border: 1px solid var(--mq-line, #c8dbe4); border-radius: 17px;
  background: var(--mq-card, #f9fcfd); box-shadow: var(--mq-shadow);
}
.mobile-archive :deep(.profile-state.error) { background: #fff8f0; border-color: #efd0b5; }
.mobile-archive :deep(.gap-section) { background: #fffaf1; border-color: #e6d3b8; }
.mobile-archive :deep(.headcount-list article), .mobile-archive :deep(.event-list li),
.mobile-archive :deep(.source-list article) { border-color: var(--mq-line, #c8dbe4); border-radius: 12px; background: var(--mq-glass, #f8fdff); }
.mobile-archive :deep(.requirement-group summary), .mobile-archive :deep(.raw-time summary) { font-size: 14px; min-height: 44px; padding: 10px 0; }
.mobile-archive :deep(.requirement-list p) { font-size: 14px!important; }
.mobile-archive :deep(.event-index) { font-size: 13px; width: 28px; height: 28px; background: #237b99; }
.mobile-archive :deep(.source-list article strong) { font-size: 14px; }
.mobile-archive :deep(.source-list article a), .mobile-archive :deep(.headcount-list article > a), .mobile-archive :deep(.no-link) { display: inline-flex; align-items: center; font-size: 13px; min-height: 44px; padding: 8px 10px; }
.mobile-archive :deep(.territory-warning) { font-size: 13px; line-height: 1.65; }
.mobile-archive :deep(.territory-warning strong) { font-size: 14px; }
.mobile-archive :deep(.profile-state strong) { font-size: 17px; }
.mobile-archive :deep(.section-heading) { align-items: flex-start; flex-wrap: wrap; }
@supports ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .archive-batches button, .mobile-archive :deep(.unit-tabs button), .mobile-archive :deep(.batch-tabs button) { -webkit-backdrop-filter: blur(12px) saturate(140%); backdrop-filter: blur(12px) saturate(140%); }
}
@media (min-width:600px) {
  .mobile-archive { padding: 12px 22px 24px; }
  .archive-batches { grid-template-columns: repeat(4,minmax(0,1fr)); }
  .mobile-archive dl > div { grid-template-columns: minmax(0,1fr) minmax(0,1fr); }
}
@media (prefers-reduced-transparency:reduce) {
  .archive-batches button, .mobile-archive :deep(.unit-tabs button), .mobile-archive :deep(.batch-tabs button) { -webkit-backdrop-filter: none; backdrop-filter: none; }
}
</style>
