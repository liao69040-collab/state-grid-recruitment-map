<script setup lang="ts">
import SiteFiling from '@/components/SiteFiling.vue';
import { useRoute, useRouter } from 'vue-router';
import { createMobileNavigation, encodeTrail, isInformationView, queryText, queryTrail, type InformationView } from '../mobile/mobile-navigation';
import { createSwipeBack } from '../mobile/swipe-back';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { ArrowLeft, ArrowRight, Close, CopyDocument, DataAnalysis, House, School } from '@element-plus/icons-vue';
import informationLightning from '@/assets/icons/information-lightning.svg';
import { authState, bootstrapAuth, login } from '@/services/auth';
import { DEFAULT_APPLICANT_COHORT, referenceCohortYear } from '@/config/recruitment-cohorts';
import { navigateMapPage } from '@/services/information-navigation';
import { fetchGridFacets, fetchGridFacts, fetchGridRankings, GridInformationUnauthorized, type GridFacets, type GridFactResult, type GridRankingResult, type GridRankingRow } from '@/services/grid-information';
import { fetchGridMapSchool, fetchGridMapCompany, type GridMapDetail, type GridMapSchool } from '@/services/grid-map';
import { fetchInformationOverview, fetchInformationProvince, type InformationOverview, type InformationProvince, type InformationProvinceDetail, type InformationCard } from '@/services/mobile-information';
import { gridBatchLabels, gridLabels, gridCombinedLabels, sameGridRegion } from '../index/grid-information-display';
import { informationRankingTitle } from './information-filter-options';
import { mapSchoolName } from '../index/grid-map-display';
import { defaultInformationFilters, informationBrand, informationContact, informationCount, informationError, informationMetricUnit, informationQuery, informationTabs, initialInformationTab, prioritizeInformationFacts, hasInformationMetric, hasInformationProvinceContent, informationMetricText, populatedInformationMetrics, primaryInformationMetric, informationRankingComposition, type InformationTab } from './information-display';
import InformationFilters from './InformationFilters.vue';
import InformationFactList from './InformationFactList.vue';
import InformationEntityDetail from './InformationEntityDetail.vue';
import InformationEducationDistribution from './InformationEducationDistribution.vue';
import InformationRegionInsights from './InformationRegionInsights.vue';
import RecruitmentReferencePanel from './RecruitmentReferencePanel.vue';
import MobileRecruitmentArchive from '../mobile/MobileRecruitmentArchive.vue';
import ProvincePhotoSupplement from '@/components/ProvincePhotoSupplement.vue';
import { isMobileInformationMode, mobileInformationModes, mobileInformationTab, type MobileInformationMode, type DirectRegionMode } from './mobile-information-navigation';
import './information-mobile.css';

const props = withDefaults(defineProps<{ province?: string; city?: string; initialTab?: string; initialOriginal?: boolean; standalone?: boolean; targetCohortYear?: number; compactRegions?: boolean; hideBatchOverview?: boolean; flatMode?: MobileInformationMode }>(), { province: '', city: '', initialTab: 'batches', initialOriginal: false, standalone: false, targetCohortYear: DEFAULT_APPLICANT_COHORT, compactRegions: false, hideBatchOverview: false });
const route = useRoute();
const navigation = createMobileNavigation(useRouter());
const historyEnabled = computed(() => route.name === 'mobile-query' || props.standalone && route.name === 'information');
const referenceYear = computed(() => referenceCohortYear(props.targetCohortYear));
const emit = defineEmits<{ unauthorized: [] }>();
function routeFlatMode(): MobileInformationMode {
  const requested = queryText(route.query, 'infoMode');
  if (isMobileInformationMode(requested)) return requested;
  const legacy = queryText(route.query, 'infoTab') || queryText(route.query, 'tab') || props.initialTab;
  if (legacy === 'schools') return 'schools';
  if (legacy === 'batches' && (queryText(route.query, 'infoTab') || queryText(route.query, 'tab'))) return 'education';
  const insight = queryText(route.query, 'insightMode');
  if (insight === 'early') return 'early';
  if (['salary', 'written', 'admission', 'difficulty'].includes(insight)) return 'salary-score';
  return 'city';
}
const standaloneMode = ref<MobileInformationMode>(routeFlatMode());
const effectiveFlatMode = computed(() => props.flatMode || (props.standalone ? standaloneMode.value : undefined));
const tab = ref<InformationTab>(effectiveFlatMode.value ? mobileInformationTab(effectiveFlatMode.value) : initialInformationTab(props.initialTab, props.province, props.initialOriginal));
const directRegionMode = computed<DirectRegionMode | undefined>(() => effectiveFlatMode.value === 'city' || effectiveFlatMode.value === 'early' || effectiveFlatMode.value === 'salary-score' ? effectiveFlatMode.value : undefined);
const arrangementOpen = ref(false);
const overview = ref<InformationOverview | null>(null);
const facets = ref<GridFacets | null>(null);
const loading = ref(false);
const directoryError = ref('');
const filters = ref({ ...defaultInformationFilters(referenceYear.value), province: props.province, city: props.city });
// Opening a province guide must never silently scope the national school table.
const schoolFilters = ref(defaultInformationFilters(referenceYear.value));
const facts = ref<GridFactResult | null>(null);
const rankings = ref<GridRankingResult | null>(null);
const submittedFacts = ref<Record<string, string>>({});
const submittedSchools = ref<Record<string, string>>({});
const queryLoading = ref(false);
const queryError = ref('');
const schoolPage = ref(1);
const factsPage = ref(1);
const page = computed(() => sheet.value === 'facts' || sheet.value === 'province' ? factsPage.value : schoolPage.value);
const referenceLimit = ref(5);
const contactMessage = ref('');
const phone = ref('');
const password = ref('');
const loginLoading = ref(false);
const loginError = ref('');
const content = ref<HTMLElement | null>(null);
const sheetElement = ref<HTMLElement | null>(null);
const sheet = ref<'province' | 'facts' | 'entity' | 'campuses' | 'metric' | null>(null);
const sheetTitle = ref('');
const provinceDetail = ref<InformationProvinceDetail | null>(null);
const activeProvince = ref<InformationProvince | null>(null);
const detail = ref<GridMapDetail | null>(null);
const campuses = ref<GridMapSchool[]>([]);
const detailLoading = ref(false);
const detailError = ref('');
const activeMetric = ref<InformationCard | null>(null);
const entityYear = ref(`${referenceYear.value}届`);
const entityProvince = ref('');
const batchSection = ref('campus');
let directoryController: AbortController | null = null;
let queryController: AbortController | null = null;
let detailController: AbortController | null = null;
let generation = 0;
let queryGeneration = 0;
let detailGeneration = 0;
let disposed = false;
let returnFocus: HTMLElement | null = null;
const icons = { batches: DataAnalysis, regions: House, schools: School };
const result = computed(() => sheet.value === 'province' || sheet.value === 'facts' ? facts.value : rankings.value);
const totalPages = computed(() => Math.max(1, Math.ceil((result.value?.total || 0) / 20)));
const currentProvinceFacts = computed(() => {
  if (!provinceDetail.value) return [];
  if (batchSection.value === 'campus') return prioritizeInformationFacts(provinceDetail.value.earlyBatch.facts);
  if (batchSection.value === 'history') return prioritizeInformationFacts([...provinceDetail.value.historicalFacts, ...provinceDetail.value.earlyBatch.historicalFacts]);
  if (batchSection.value === 'general') return prioritizeInformationFacts(provinceDetail.value.generalFacts || []);
  return prioritizeInformationFacts(provinceDetail.value.batches.find(item => item.batchCode === batchSection.value)?.facts || []);
});
const historicalEarlyFacts = computed(() => prioritizeInformationFacts(provinceDetail.value?.earlyBatch.historicalFacts || []));
const provinceTabs = computed(() => !provinceDetail.value ? [] : [
  ...(provinceDetail.value.earlyBatch.policies.length || provinceDetail.value.earlyBatch.facts.length ? [{ batchCode: 'campus', title: '提前批' }] : []),
  ...provinceDetail.value.batches.filter(item => item.facts.length),
  ...(provinceDetail.value.generalFacts?.length ? [{ batchCode: 'general', title: '通用条件' }] : []),
  ...(provinceDetail.value.historicalFacts.length || historicalEarlyFacts.value.length ? [{ batchCode: 'history', title: '历年信息' }] : []),
]);
const metricRows = populatedInformationMetrics;
const metricText = informationMetricText;
const primaryMetric = primaryInformationMetric;
const populatedCards = computed(() => overview.value?.rosterDataAvailable === false ? [] : (overview.value?.cards || []).filter(card => hasInformationMetric(card.publicNotice)));
const applicationCards = computed(() => (overview.value?.cards || []).filter(card => hasInformationMetric(card.applications)));
function clearPrivateData() {
  generation++; queryGeneration++; detailGeneration++;
  directoryController?.abort(); queryController?.abort(); detailController?.abort();
  overview.value = null; facets.value = null; facts.value = null; rankings.value = null; detail.value = null; provinceDetail.value = null; campuses.value = []; activeMetric.value = null;
  loading.value = false; queryLoading.value = false; detailLoading.value = false; sheet.value = null;
}
function handleUnauthorized(error: unknown) {
  if (error instanceof GridInformationUnauthorized || !authState.authenticated) { clearPrivateData(); emit('unauthorized'); return true; }
  return false;
}
function archiveUnauthorized() { clearPrivateData(); emit('unauthorized'); }
async function loadDirectory() {
  directoryController?.abort();
  const controller = new AbortController(); directoryController = controller;
  const request = ++generation; loading.value = true; directoryError.value = ''; overview.value = null;
  const requestedYear = referenceYear.value;
  const settled = await Promise.allSettled([fetchInformationOverview(controller.signal, requestedYear), fetchGridFacets(controller.signal)]);
  if (disposed || controller.signal.aborted || request !== generation || !authState.authenticated) return;
  for (const outcome of settled) if (outcome.status === 'rejected' && handleUnauthorized(outcome.reason)) return;
  if (settled[0].status === 'fulfilled' && settled[0].value.cohortYear === requestedYear) overview.value = settled[0].value;
  if (settled[1].status === 'fulfilled') {
    facets.value = settled[1].value;
    filters.value.province = facets.value.provinces.find(item => sameGridRegion(item, filters.value.province)) || filters.value.province;
    filters.value.city = facets.value.cities.find(item => sameGridRegion(item.province, filters.value.province) && sameGridRegion(item.city, filters.value.city))?.city || filters.value.city;
  }
  directoryError.value = settled.filter(item => item.status === 'rejected').map(item => informationError((item as PromiseRejectedResult).reason)).join(' ');
  loading.value = false;
  if (historyEnabled.value) restoreSchoolQuery();
  if (tab.value === 'schools') void search('rankings', schoolPageFromRoute(), false, true);
  if (historyEnabled.value && queryTrail(route.query, 'infoTrail', isInformationView).length) { void restoreRouteSheet(); return; }
  else if (tab.value !== 'schools' && props.province && !props.initialOriginal && (!historyEnabled.value || queryText(route.query, 'infoScopedSeen') !== '1')) {
    const selected = overview.value?.provinces.find(item => sameGridRegion(item.name, props.province));
    if (selected) { if (historyEnabled.value) void navigation.replace({ infoTrail: encodeTrail([{ kind: 'province', adcode: selected.adcode }]), infoScopedSeen: '1' }); else void openProvince(selected); }
    else if (historyEnabled.value) void navigation.replace({ infoTrail: encodeTrail([{ kind: 'facts', title: props.province, query: informationQuery(filters.value, 'facts') }]), infoScopedSeen: '1' });
    else { sheetTitle.value = props.province; showSheet('facts'); void search('facts'); }
  }
}
async function submitLogin() {
  loginLoading.value = true; loginError.value = '';
  try { await login(phone.value.trim(), password.value); password.value = ''; }
  catch (error) { loginError.value = informationError(error); }
  finally { loginLoading.value = false; }
}
async function search(kind: 'facts' | 'rankings', nextPage = 1, reuseSubmitted = false, fromRoute = false) {
  const query = reuseSubmitted ? (kind === 'facts' ? submittedFacts.value : submittedSchools.value) : informationQuery(kind === 'facts' ? filters.value : schoolFilters.value, kind);
  if (historyEnabled.value && !fromRoute) {
    if (kind === 'facts' && sheet.value === 'facts') {
      const trail = queryTrail(route.query, 'infoTrail', isInformationView);
      const current = trail[trail.length - 1];
      if (current?.kind === 'facts') {
        const next = { ...current, query, page: nextPage };
        if (JSON.stringify(next) !== JSON.stringify(current)) { trail[trail.length - 1] = next; await navigation.replace({ infoTrail: encodeTrail(trail) }); return; }
      }
    } else if (kind === 'rankings') {
      // A draft keyword must not become the restored query when paging the
      // already submitted results. Preserve both the applied query and page.
      await navigation.replace({ infoSchoolQuery: JSON.stringify(query), infoSchoolPage: nextPage > 1 ? nextPage : null });
    }
  }
  queryController?.abort(); const controller = new AbortController(); queryController = controller;
  const request = ++queryGeneration;
  if (kind === 'facts') submittedFacts.value = query; else submittedSchools.value = query;
  if (kind === 'facts') factsPage.value = nextPage; else schoolPage.value = nextPage;
  queryLoading.value = true; queryError.value = '';
  if (kind === 'facts') facts.value = null; else rankings.value = null;
  try {
    const data = kind === 'facts' ? await fetchGridFacts({ ...query, page: nextPage, pageSize: 20 }, controller.signal) : await fetchGridRankings({ ...query, page: nextPage, pageSize: 20 }, controller.signal);
    if (disposed || controller.signal.aborted || request !== queryGeneration || !authState.authenticated) return;
    if (kind === 'facts') facts.value = data as GridFactResult; else rankings.value = data as GridRankingResult;
  } catch (error) { if (!controller.signal.aborted && request === queryGeneration && !handleUnauthorized(error)) queryError.value = informationError(error); }
  finally { if (request === queryGeneration) queryLoading.value = false; }
}
function resetFilters(kind: 'facts' | 'rankings') { if (kind === 'facts') filters.value = defaultInformationFilters(referenceYear.value); else schoolFilters.value = defaultInformationFilters(referenceYear.value); void search(kind); }
function selectTab(value: InformationTab) {
  if (historyEnabled.value) { void navigation.push({ ...(route.name === 'mobile-query' ? { mqGuide: value === 'regions' ? null : value } : { infoTab: value }), infoTrail: null }); return; }
  clearSheetView(); tab.value = value; content.value?.scrollTo({ top: 0 }); if (value === 'schools') void search('rankings');
}
function selectStandaloneMode(value: MobileInformationMode) {
  if (historyEnabled.value) { void navigation.push({ infoMode: value, infoTab: mobileInformationTab(value), infoTrail: null, insightMode: null, insightGroup: null }); return; }
  standaloneMode.value = value;
}
function showSheet(value: NonNullable<typeof sheet.value>) {
  if (!sheet.value) returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  sheet.value = value; void nextTick(() => sheetElement.value?.focus());
}
function closeSheet() {
  if (historyEnabled.value) { void navigation.previousOr({ infoTrail: encodeTrail(queryTrail(route.query, 'infoTrail', isInformationView).slice(0, -1)) }); return; }
  clearSheetView();
}
function closeAllSheets() { if (historyEnabled.value) void navigation.returnTo({ infoTrail: null }); else clearSheetView(); }
const standaloneSwipe = createSwipeBack({
  canGoBack: () => props.standalone && (Boolean(sheet.value) || navigation.hasPrevious() || standaloneMode.value !== 'city'),
  goBack: () => { if (sheet.value) closeSheet(); else void navigation.previousOr({ infoMode: 'city', infoTab: 'regions', infoTrail: null }); },
});
function clearSheetView() { detailGeneration++; detailController?.abort(); detail.value = null; campuses.value = []; detailError.value = ''; detailLoading.value = false; arrangementOpen.value = false; sheet.value = null; void nextTick(() => returnFocus?.focus()); }
function sheetKeys(event: KeyboardEvent) {
  // This sheet can be nested inside the map's information dialog. Only the
  // top layer owns Escape/Tab; the map must not close or move focus as well.
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeSheet(); return; }
  if (event.key !== 'Tab') return;
  event.stopPropagation();
  const items = Array.from(sheetElement.value?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], summary, [tabindex="0"]') || []).filter(item => item.getClientRects().length && !item.closest('[inert]'));
  const first = items[0], last = items[items.length - 1];
  if (!first) { event.preventDefault(); return; }
  if (event.shiftKey && (document.activeElement === first || document.activeElement === sheetElement.value)) { event.preventDefault(); last?.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}
async function openProvince(province: InformationProvince, fromRoute = false) {
  if (!hasInformationProvinceContent(province)) return;
  if (historyEnabled.value && !fromRoute) { pushSheet({ kind: 'province', adcode: province.adcode }); return; }
  activeProvince.value = province; sheetTitle.value = `${province.name} · 招聘指南`; provinceDetail.value = null; batchSection.value = 'campus';
  arrangementOpen.value = false;
  filters.value.province = facets.value?.provinces.find(item => sameGridRegion(item, province.name)) || province.name;
  filters.value.city = sameGridRegion(props.province, province.name) ? facets.value?.cities.find(item => sameGridRegion(item.province, province.name) && sameGridRegion(item.city, props.city))?.city || props.city : '';
  detailController?.abort(); const controller = new AbortController(); detailController = controller;
  const request = ++detailGeneration; detailLoading.value = true; detailError.value = ''; showSheet('province');
  facts.value = null;
  try { const data = await fetchInformationProvince(province.adcode, controller.signal, referenceYear.value); if (!controller.signal.aborted && request === detailGeneration && authState.authenticated && data.cohortYear === referenceYear.value) { provinceDetail.value = data; batchSection.value = provinceTabs.value[0]?.batchCode || 'campus'; } }
  catch (error) { if (!controller.signal.aborted && request === detailGeneration && !handleUnauthorized(error)) detailError.value = informationError(error); }
  finally { if (request === detailGeneration) detailLoading.value = false; }
}
function openProvinceByAdcode(adcode: string) {
  const province = overview.value?.provinces.find(item => item.adcode === adcode);
  if (province) void openProvince(province);
}
function showMetric(card: InformationCard, fromRoute = false) { if (historyEnabled.value && !fromRoute) { pushSheet({ kind: 'metric', key: card.key }); return; } activeMetric.value = card; sheetTitle.value = `${card.title} · 招聘概况`; showSheet('metric'); }
function showBatchFacts(card: InformationCard) { if (historyEnabled.value) { pushSheet({ kind: 'facts', query: informationQuery({ ...defaultInformationFilters(card.cohortYear), grid: card.grid, batchCode: card.batchCode }, 'facts'), title: `${card.title} · 各地招聘` }); return; } filters.value = { ...defaultInformationFilters(card.cohortYear), grid: card.grid, batchCode: card.batchCode }; sheetTitle.value = `${card.title} · 各地招聘`; showSheet('facts'); void search('facts'); }
function searchProvinceFacts() { if (historyEnabled.value) { const next = { ...filters.value, batchCode: ['campus', 'batch_1', 'batch_2', 'batch_3', 'csg_spring', 'csg_autumn'].includes(batchSection.value) ? batchSection.value : '' }; pushSheet({ kind: 'facts', query: informationQuery(next, 'facts'), title: `${activeProvince.value?.name || filters.value.province} · 条件检索` }); return; } filters.value.batchCode = ['campus', 'batch_1', 'batch_2', 'batch_3', 'csg_spring', 'csg_autumn'].includes(batchSection.value) ? batchSection.value : ''; sheetTitle.value = `${activeProvince.value?.name || filters.value.province} · 条件检索`; showSheet('facts'); void search('facts'); }
function detailQuery() {
  const basis = submittedSchools.value;
  const province = overview.value?.provinces.find(item => sameGridRegion(item.name, basis.province || ''));
  const sourceYear = Number(basis.cohortYear) || referenceYear.value;
  entityYear.value = `${sourceYear}届`; entityProvince.value = province?.name || '';
  return { cohortYear: sourceYear, grid: basis.grid || '', batchCode: basis.batchCode || '', provinceAdcode: province?.adcode || '' };
}
async function openEntity(kind: 'school' | 'company', key: string, fromRoute = false) {
  if (historyEnabled.value && !fromRoute) { pushSheet({ kind: 'entity', entity: { kind, key }, query: { ...submittedSchools.value } }); return; }
  detailController?.abort(); const controller = new AbortController(); detailController = controller; const request = ++detailGeneration;
  detailLoading.value = true; detailError.value = ''; detail.value = null; sheetTitle.value = kind === 'school' ? '院校详情' : '单位详情'; showSheet('entity');
  try {
    const data = kind === 'school' ? await fetchGridMapSchool(key, detailQuery(), controller.signal) : await fetchGridMapCompany(key, detailQuery(), controller.signal);
    if (!controller.signal.aborted && request === detailGeneration && authState.authenticated) { detail.value = data; sheetTitle.value = 'school' in data ? mapSchoolName(data.school) : data.company.company; }
  } catch (error) { if (!controller.signal.aborted && request === detailGeneration && !handleUnauthorized(error)) detailError.value = informationError(error); }
  finally { if (request === detailGeneration) detailLoading.value = false; }
}
async function openRanking(row: GridRankingRow) {
  if (rankings.value?.view === 'campus') { void openEntity('school', row.schoolKey); return; }
  const keys = row.campusKeys || [];
  if (keys.length === 1) { void openEntity('school', keys[0]); return; }
  if (historyEnabled.value) { pushSheet({ kind: 'campuses', keys, title: `${row.schoolName} · 校区`, query: { ...submittedSchools.value } }); return; }
  await loadCampuses(keys, `${row.schoolName} · 校区`);
}
async function loadCampuses(keys: string[], title: string) {
  showSheet('campuses'); sheetTitle.value = title; detailError.value = ''; campuses.value = [];
  if (!keys.length) { detailError.value = '该母校暂未提供校区关联，请切换“独立校区”视角查询。'; return; }
  detailController?.abort(); const controller = new AbortController(); detailController = controller; const request = ++detailGeneration; detailLoading.value = true;
  try { const data = await Promise.all(keys.map(key => fetchGridMapSchool(key, detailQuery(), controller.signal))); if (!controller.signal.aborted && request === detailGeneration && authState.authenticated) campuses.value = data.map(item => item.school); }
  catch (error) { if (!controller.signal.aborted && request === detailGeneration && !handleUnauthorized(error)) detailError.value = informationError(error); }
  finally { if (request === detailGeneration) detailLoading.value = false; }
}
function pushSheet(view: InformationView) {
  if (!isInformationView(view)) return;
  const trail = queryTrail(route.query, 'infoTrail', isInformationView);
  if (trail.length >= 32 || JSON.stringify(trail[trail.length - 1]) === JSON.stringify(view)) return;
  void navigation.push({ infoTrail: encodeTrail([...trail, view]) });
}
function restoreSchoolQuery() {
  const raw = queryText(route.query, 'infoSchoolQuery');
  try {
    const entityView = queryTrail(route.query, 'infoTrail', isInformationView).findLast(item => (item.kind === 'entity' || item.kind === 'campuses') && item.query);
    const query = entityView?.query || (raw ? JSON.parse(raw) : null);
    if (!query) return;
    if (isInformationView({ kind: 'facts', query })) schoolFilters.value = { ...defaultInformationFilters(referenceYear.value), ...query };
  } catch { /* Invalid deep links never become API parameters. */ }
}
function schoolPageFromRoute() {
  if (!historyEnabled.value) return 1;
  const value = Number(queryText(route.query, 'infoSchoolPage'));
  return Number.isInteger(value) && value >= 1 && value <= 10000 ? value : 1;
}
let sheetRouteGeneration = 0;
async function restoreRouteSheet() {
  if (!historyEnabled.value || !authState.authenticated || !overview.value) return;
  const request = ++sheetRouteGeneration;
  const nextTab = queryText(route.query, route.name === 'mobile-query' ? 'mqGuide' : 'infoTab');
  tab.value = effectiveFlatMode.value ? mobileInformationTab(effectiveFlatMode.value) : ['batches', 'regions', 'schools'].includes(nextTab) ? nextTab as InformationTab : initialInformationTab(props.initialTab, props.province, props.initialOriginal);
  const trail = queryTrail(route.query, 'infoTrail', isInformationView);
  const current = trail[trail.length - 1];
  if (!current) { clearSheetView(); return; }
  if (current.kind === 'province') {
    const province = overview.value.provinces.find(item => item.adcode === current.adcode);
    if (!province || !hasInformationProvinceContent(province)) { clearSheetView(); return; }
    if (sheet.value === 'province' && activeProvince.value?.adcode === current.adcode && provinceDetail.value) {
      if (current.batch && provinceTabs.value.some(item => item.batchCode === current.batch)) batchSection.value = current.batch;
      return;
    }
    await openProvince(province, true);
    if (request === sheetRouteGeneration && current.batch && provinceTabs.value.some(item => item.batchCode === current.batch)) batchSection.value = current.batch;
  } else if (current.kind === 'metric') {
    const card = overview.value.cards.find(item => item.key === current.key);
    if (card) showMetric(card, true); else clearSheetView();
  } else if (current.kind === 'facts') {
    detailGeneration++; detailController?.abort(); detailLoading.value = false; detailError.value = '';
    filters.value = { ...defaultInformationFilters(referenceYear.value), ...current.query };
    submittedFacts.value = informationQuery(filters.value, 'facts'); sheetTitle.value = current.title || '条件检索';
    showSheet('facts'); await search('facts', current.page || 1, true, true);
  } else {
    submittedSchools.value = { ...current.query };
    if (current.kind === 'entity' && current.entity) await openEntity(current.entity.kind, current.entity.key, true);
    else if (current.kind === 'campuses') await loadCampuses(current.keys || [], current.title || '院校校区');
  }
}
function selectProvinceBatch(value: string) {
  batchSection.value = value;
  if (!historyEnabled.value) return;
  const trail = queryTrail(route.query, 'infoTrail', isInformationView);
  if (trail[trail.length - 1]?.kind === 'province') { trail[trail.length - 1] = { ...trail[trail.length - 1], batch: value }; void navigation.replace({ infoTrail: encodeTrail(trail) }); }
}
watch(() => route.query.infoTrail, () => { void restoreRouteSheet(); });
watch(() => [route.query.infoMode, route.query.infoTab, route.query.tab], () => { if (props.standalone && !props.flatMode) standaloneMode.value = routeFlatMode(); });
watch(() => route.query.infoTab, () => { if (historyEnabled.value && route.name === 'information' && !effectiveFlatMode.value) { void restoreRouteSheet(); if (queryText(route.query, 'infoTab') === 'schools') void search('rankings'); } });
watch(effectiveFlatMode, value => {
  if (!value) return;
  clearSheetView(); tab.value = mobileInformationTab(value); content.value?.scrollTo({ top: 0 });
  if (tab.value === 'schools' && authState.authenticated && overview.value) {
    if (historyEnabled.value) restoreSchoolQuery();
    void search('rankings', schoolPageFromRoute(), false, true);
  }
});
async function copyContact() { if (!informationContact) return; try { await navigator.clipboard.writeText(informationContact); contactMessage.value = '联系方式已复制'; } catch { contactMessage.value = `请手动复制：${informationContact}`; } }
watch(() => authState.authenticated, (value, previous) => { if (!value) clearPrivateData(); else if (!previous) void loadDirectory(); });
watch(referenceYear, () => {
  clearPrivateData();
  filters.value = { ...defaultInformationFilters(referenceYear.value), province: props.province, city: props.city };
  schoolFilters.value = defaultInformationFilters(referenceYear.value);
  submittedFacts.value = {}; submittedSchools.value = {}; queryError.value = ''; detailError.value = '';
  referenceLimit.value = 5; schoolPage.value = 1; factsPage.value = 1; activeProvince.value = null;
  if (authState.authenticated) void loadDirectory();
}, { flush: 'sync' });
onMounted(async () => { if (!authState.ready) { await bootstrapAuth().catch(error => { loginError.value = informationError(error); }); } else if (authState.authenticated) void loadDirectory(); });
onBeforeUnmount(() => { disposed = true; standaloneSwipe.cancel(); clearPrivateData(); });
</script>

<template>
  <main class="information-mobile" :class="{ 'is-standalone': standalone, 'is-school-view': tab === 'schools', 'is-compact': compactRegions || Boolean(effectiveFlatMode), 'is-flat': Boolean(effectiveFlatMode) }" data-qa="mobile-information" @touchstart="standalone && standaloneSwipe.start($event)" @touchmove="standalone && standaloneSwipe.move($event)" @touchend="standalone && standaloneSwipe.end($event)" @touchcancel="standalone && standaloneSwipe.cancel()">
    <div ref="content" class="info-scroll" :inert="Boolean(sheet)">
      <div class="info-body">
        <header v-if="!compactRegions && !effectiveFlatMode" class="info-header"><div class="info-brand-icon"><img :src="informationLightning" alt="" aria-hidden="true" /></div><div class="info-header-copy"><h1 id="gridInformation-title">{{ referenceYear }}届电网信息汇总</h1><p>{{ targetCohortYear }}届报考 · 参考{{ referenceYear }}届数据</p></div><button v-if="standalone" type="button" class="info-map-link" @click="navigateMapPage"><ArrowLeft aria-hidden="true" />地图</button></header>
        <div v-if="informationContact && !compactRegions && !effectiveFlatMode" class="info-contact"><button type="button" @click="copyContact"><CopyDocument aria-hidden="true" /><span>{{ informationBrand }} · 联系维护者：{{ informationContact }}</span></button><span v-if="contactMessage" class="info-contact-status" role="status">{{ contactMessage }}</span></div>
        <div v-if="standalone && !flatMode" class="info-direct-context"><span>{{ targetCohortYear }}届报考 · 参考{{ referenceYear }}届</span><button type="button" class="info-secondary" @click="navigateMapPage">返回地图</button></div>
        <template v-if="!authState.ready"><p class="info-empty" role="status">正在确认账号权限…</p></template>
        <form v-else-if="!authState.authenticated" class="info-card info-login" @submit.prevent="submitLogin"><h2>登录查看电网资料</h2><p class="info-caption">使用已开通账号查询国网、南网招聘条件与录用情况。</p><label>手机号<input v-model="phone" type="tel" inputmode="numeric" autocomplete="username" maxlength="11" required /></label><label>密码<input v-model="password" type="password" autocomplete="current-password" required /></label><p v-if="loginError" class="info-error" role="alert">{{ loginError }}</p><button class="info-primary" type="submit" :disabled="loginLoading">{{ loginLoading ? '正在登录…' : '登录并查看' }}</button><p class="info-caption">{{ informationContact ? `账号咨询：${informationContact}` : '本地演示账号见项目 README；正式部署请使用管理员开通的账号。' }}</p></form>
        <template v-else>
          <nav v-if="standalone && !flatMode" class="info-direct-nav" aria-label="报考指南" data-swipe-ignore><button v-for="item in mobileInformationModes" :key="item.key" type="button" :aria-pressed="effectiveFlatMode === item.key" @click="selectStandaloneMode(item.key)">{{ item.label }}</button></nav>
          <div v-if="directoryError" class="info-error" role="alert">{{ directoryError }} <button class="info-secondary" @click="loadDirectory">重新加载</button></div>
          <p v-if="loading" class="info-empty" role="status">正在加载招聘信息…</p><p v-else-if="overview?.referenceDataAvailable === false" class="info-empty" role="status">暂无{{ referenceYear }}届资料，不以其他届别数据替代。</p>
          <section v-if="effectiveFlatMode === 'education' && overview?.referenceDataAvailable !== false" role="tabpanel" aria-label="学历要求"><RecruitmentReferencePanel v-if="overview" :overview="overview" :sections="['education']" /><ProvincePhotoSupplement v-if="overview?.photoUnitRequirements" :unit-requirements="overview.photoUnitRequirements" requirements-only /></section>
          <section v-else-if="tab === 'batches' && !effectiveFlatMode && overview?.referenceDataAvailable !== false" role="tabpanel" aria-label="批次资料">
            <div v-if="!hideBatchOverview" class="info-section-heading"><h2>电网批次总览</h2><small>{{ referenceYear }} 届</small></div>
            <p v-if="overview?.rosterDataAvailable === false" class="info-empty" role="status">暂无{{ referenceYear }}届录用资料，以下展示已收录的报考条件与其他招聘资料。</p>
            <div v-if="!hideBatchOverview" class="info-metric-grid"><button v-for="card in populatedCards" :key="card.key" type="button" class="info-card" @click="showMetric(card)"><span>{{ card.title }}</span><strong>{{ metricText(primaryMetric(card)) }}</strong><span v-if="primaryMetric(card).value !== null" class="info-metric-unit">{{ informationMetricUnit(primaryMetric(card)) }}</span><small>点击查看招聘概况</small></button></div>
            <article v-if="applicationCards.length && !overview?.nationalApplicationReferences?.length" class="info-card" style="margin-top:16px"><h3 style="margin-top:0">报名与竞争参考</h3><dl class="info-data-rows"><div v-for="card in applicationCards" :key="card.key"><dt>{{ card.title }}</dt><dd>{{ metricText(card.applications) }}<small>{{ card.applications.measureUnit }}</small></dd></div></dl></article>
            <RecruitmentReferencePanel v-if="overview" :overview="overview" :sections="compactRegions ? ['national', 'education'] : ['national']" />
            <InformationEducationDistribution v-if="overview && !compactRegions" :key="referenceYear" :overview="overview" @open-province="openProvinceByAdcode" />
            <details v-if="overview?.applicationReferences.length" class="info-card info-evidence"><summary>地区报名情况</summary><InformationFactList :items="overview.applicationReferences.slice(0, referenceLimit)" /><button v-if="referenceLimit < overview.applicationReferences.length" class="info-secondary" @click="referenceLimit += 10">继续显示（{{ referenceLimit }} / {{ overview.applicationReferences.length }}）</button></details>
            <article v-if="overview && !compactRegions" class="info-card"><h3 style="margin-top:0">各批次报考条件</h3><p class="info-caption">选择省份，按批次查看报考条件、招聘数量与考试安排。</p><button class="info-primary" @click="selectTab('regions')">选择地区</button></article>
            <p v-if="!compactRegions" class="info-reading-note">录用公示与最终入职人数不同；报名数量按人数或人次分别展示。</p>
          </section>
          <section v-else-if="tab === 'regions' && overview?.referenceDataAvailable !== false" role="tabpanel" aria-label="地区资料"><InformationRegionInsights v-if="overview" :key="referenceYear" :overview="overview" :compact="compactRegions || Boolean(effectiveFlatMode)" :direct-mode="directRegionMode" @open-province="openProvinceByAdcode" /></section>
          <section v-else-if="tab === 'schools'" role="tabpanel" aria-label="全国院校查询">
            <div class="info-section-heading"><h2>全国院校录用排名</h2><small>北京、保定校区独立排名</small></div>
            <InformationFilters v-model="schoolFilters" :applied="submittedSchools" :reference-year="referenceYear" :facets="facets" kind="rankings" :loading="queryLoading" @search="search('rankings')" @reset="resetFilters('rankings')" />
            <div v-if="queryLoading" class="info-empty" role="status">正在查询院校…</div>
            <p v-else-if="queryError" class="info-error" role="alert">{{ queryError }} <button class="info-secondary" @click="search('rankings')">重试</button></p>
            <template v-else-if="rankings">
              <div class="info-ranking-context" role="status" aria-live="polite" aria-atomic="true"><strong>{{ informationRankingTitle(submittedSchools, gridBatchLabels, gridLabels) }}</strong><span>{{ submittedSchools.cohortYear || '全部年份' }}{{ submittedSchools.cohortYear ? '届' : '' }} · {{ rankings.total }} {{ rankings.view === 'parent' ? '所学校' : '所院校 / 校区' }} · 同数并列</span></div>
              <div class="info-ranking">
                <button v-for="row in rankings.items" :key="row.schoolKey" class="info-ranking-row" :class="{ 'is-top-three': row.rank !== null && row.rank <= 3 }" @click="openRanking(row)">
                  <span class="info-rank">{{ row.rank === null ? '—' : String(row.rank).padStart(2, '0') }}</span>
                  <span class="info-ranking-copy"><strong>{{ row.campusName || row.schoolName }}</strong><span class="info-ranking-badges"><small>{{ gridCombinedLabels(row.schoolTiers, row.schoolTier, '') }}</small><small>{{ gridCombinedLabels(row.educationLevels, row.educationLevel, '') }}</small><small v-if="row.industryTags.some(tag => /^原电力部院校/.test(tag))">原电力直属</small></span><span v-if="informationRankingComposition(row)" class="info-ranking-composition">{{ informationRankingComposition(row) }}</span></span>
                  <span v-if="row.recordCount !== null" class="info-ranking-value">{{ informationCount(row.recordCount) }}<small>{{ submittedSchools.province ? '本省录用' : '录用合计' }}</small><ArrowRight aria-hidden="true" /></span>
                </button>
              </div>
              <div v-if="!rankings.total" class="info-empty"><p>{{ overview?.rosterDataAvailable === false && submittedSchools.cohortYear === String(referenceYear) ? `暂无${referenceYear}届录用资料` : '没有符合当前条件的学校，请减少筛选条件。' }}</p><button type="button" class="info-secondary" @click="resetFilters('rankings')">清除条件，查看全国排名</button></div>
              <nav v-if="rankings.total > 20" class="info-pagination" aria-label="院校结果分页"><button :disabled="page <= 1" @click="search('rankings', page - 1, true)">上一页</button><span>{{ page }} / {{ totalPages }}</span><button :disabled="page >= totalPages" @click="search('rankings', page + 1, true)">下一页</button></nav>
            </template>
          </section>
        </template>
        <SiteFiling v-if="standalone || compactRegions" />
      </div>
    </div>
    <nav v-if="!compactRegions && !effectiveFlatMode" class="info-bottom-nav" role="tablist" aria-label="电网信息导航" :inert="Boolean(sheet)"><button v-for="item in informationTabs" :key="item.key" role="tab" :aria-selected="tab === item.key" @click="selectTab(item.key)"><component :is="icons[item.key]" aria-hidden="true" /><span>{{ item.label }}</span></button></nav>
    <div v-if="sheet && authState.authenticated" class="info-sheet-overlay" @click.self="closeSheet"><section ref="sheetElement" class="info-sheet" role="dialog" aria-modal="true" aria-labelledby="information-sheet-title" tabindex="-1" @keydown="sheetKeys"><header class="info-sheet-header"><button v-if="historyEnabled" type="button" aria-label="返回上一层" @click="closeSheet"><ArrowLeft aria-hidden="true" /></button><h2 id="information-sheet-title">{{ sheetTitle }}</h2><button type="button" aria-label="关闭详情" @click="closeAllSheets"><Close aria-hidden="true" /></button></header><div class="info-sheet-scroll">
      <p v-if="detailLoading" class="info-empty" role="status">正在读取详情…</p><p v-if="detailError" class="info-error" role="alert">{{ detailError }}</p>
      <template v-if="sheet === 'metric' && activeMetric"><p class="info-reading-note">{{ activeMetric.cohortYear }}届 · {{ activeMetric.scopeLabel }}</p><article v-for="row in metricRows(activeMetric)" :key="row.label" class="info-card"><span>{{ row.label }}</span><strong class="info-big-number">{{ metricText(row.metric) }}</strong><small>{{ informationMetricUnit(row.metric) }}<template v-if="row.metric.sourceYear"> · {{ row.metric.sourceYear }}年</template></small><p>{{ row.metric.scopeLabel }}</p></article><button class="info-primary" @click="showBatchFacts(activeMetric)">查看本批次各地条件</button></template>
      <template v-if="sheet === 'province' && provinceDetail">
        <div class="info-province-intro"><strong>{{ provinceDetail.cohortYear }}届招聘指南</strong><span>先选择批次，再按主题查看</span></div>
        <div class="info-batch-tabs" role="group" aria-label="地区招聘批次"><button v-for="batch in provinceTabs" :key="batch.batchCode" :aria-pressed="batchSection === batch.batchCode" @click="selectProvinceBatch(batch.batchCode)">{{ batch.title }}</button></div>
        <ProvincePhotoSupplement :supplement="provinceDetail.photoSupplement" />
        <template v-if="batchSection === 'campus'">
          <article v-for="policy in provinceDetail.earlyBatch.policies" :key="policy.policyKey" class="info-card info-policy-card">
            <div class="info-section-heading"><h3>{{ policy.target.name }}</h3><small>{{ policy.cohortYear }}届 · 提前批</small></div>
            <h4>报考条件</h4><p class="fact-copy">{{ policy.requirements }}</p>
            <dl class="info-definition"><template v-for="[key, label] in [['process', '招聘流程'], ['plannedHeadcount', '招聘名额'], ['assessmentMethod', '考核方式'], ['itinerary', '招聘行程'], ['siteQuota', '站点名额'], ['admissionRule', '录用规则'], ['actualHeadcount', '录用数量'], ['notes', '补充条件']]" :key="key"><div v-if="policy[key as keyof typeof policy]"><dt>{{ label }}</dt><dd>{{ policy[key as keyof typeof policy] }}</dd></div></template></dl>
          </article>
        </template>
        <InformationFactList :items="currentProvinceFacts" />
        <details v-if="effectiveFlatMode && overview && activeProvince" class="info-card info-flat-full-reference"><summary>市局、待遇与分数完整资料</summary><RecruitmentReferencePanel :overview="overview" :province-adcode="activeProvince.adcode" :sections="['province']" /></details>
        <details v-if="effectiveFlatMode && activeProvince" class="info-card info-flat-arrangements" @toggle="arrangementOpen=($event.target as HTMLDetailsElement).open"><summary>招聘安排与历史节点</summary><MobileRecruitmentArchive v-if="arrangementOpen" :key="activeProvince.adcode" :province-options="[{name:activeProvince.name,adcode:activeProvince.adcode}]" :initial-province-adcode="activeProvince.adcode" :reference-year="referenceYear" @unauthorized="archiveUnauthorized" /></details>
        <p v-if="!currentProvinceFacts.length && !(batchSection === 'campus' && provinceDetail.earlyBatch.policies.length)" class="info-empty">当前批次没有可展示内容，请选择其他批次。</p>
        <div class="info-search-more"><span>想查某个城市、公司或专业？</span><button class="info-secondary" @click="searchProvinceFacts">按条件检索</button></div>
      </template>
      <template v-if="sheet === 'facts'"><InformationFilters v-model="filters" :reference-year="referenceYear" :facets="facets" kind="facts" :loading="queryLoading" @search="search('facts')" @reset="resetFilters('facts')" /><p v-if="queryLoading" class="info-empty" role="status">正在检索资料…</p><p v-else-if="queryError" class="info-error" role="alert">{{ queryError }} <button class="info-secondary" @click="search('facts')">重试</button></p><template v-else-if="facts"><p class="info-caption">{{ submittedFacts.province || '全国' }} {{ submittedFacts.city }} · {{ facts.total }} 条资料</p><InformationFactList :items="facts.items" /><p v-if="!facts.total" class="info-empty">当前筛选暂无资料，请调整条件。</p><nav v-if="facts.total > 20" class="info-pagination" aria-label="资料结果分页"><button :disabled="page <= 1" @click="search('facts', page - 1, true)">上一页</button><span>{{ page }} / {{ totalPages }}</span><button :disabled="page >= totalPages" @click="search('facts', page + 1, true)">下一页</button></nav></template></template>
      <template v-if="sheet === 'entity' && detail"><p class="info-caption">{{ !submittedSchools.cohortYear ? `${referenceYear}届详情` : '' }}</p><InformationEntityDetail :detail="detail" :province="entityProvince" :year="entityYear" @school="openEntity('school', $event)" @company="openEntity('company', $event)" /></template>
      <template v-if="sheet === 'campuses'"><p class="info-caption">母校合并视角下选择具体校区；各校区独立展示，不与母校值相加。</p><div class="info-records"><button v-for="campus in campuses" :key="campus.campusKey" @click="openEntity('school', campus.campusKey)"><span>{{ mapSchoolName(campus) }}<small>{{ [campus.province, campus.city].filter(Boolean).join(' · ') }}</small></span><ArrowRight aria-hidden="true" /></button></div></template>
    </div></section></div>
  </main>
</template>

<style scoped>
.information-mobile.is-flat .info-section-heading{margin:5px 0 8px}.information-mobile.is-flat .info-section-heading h2{font-size:17px}.info-flat-full-reference>summary,.info-flat-arrangements>summary{min-height:44px;box-sizing:border-box;padding:10px 0;font-size:14px;color:#174c5d;cursor:pointer}.info-flat-arrangements :deep(.mobile-archive){padding:0;overflow:visible}.info-flat-full-reference :deep(.reference-province){padding:0;border:0;background:transparent}.information-mobile.is-flat :deep(.reference-education){margin-top:0}
.information-mobile.is-standalone.is-flat{height:100dvh;min-height:0}
.info-direct-context{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px;color:#456371;margin-bottom:6px}.info-direct-context>.info-secondary{min-height:44px;padding:7px 10px}.info-direct-nav{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 10px}.info-direct-nav>button{flex:1 1 90px;min-height:44px;font:inherit;font-size:13px;padding:8px 10px;border:1px solid #b9d5df;border-radius:10px;background:#f1f8fb;color:#16495c;cursor:pointer}.info-direct-nav>button[aria-pressed=true]{color:#fff;background:#12627a;border-color:#12627a}.info-direct-nav>button:focus-visible{outline:3px solid #3295b5;outline-offset:2px}@media(max-width:360px){.info-direct-nav{gap:5px}.info-direct-nav>button{flex-basis:80px;padding:7px 8px;font-size:12px}}
</style>
