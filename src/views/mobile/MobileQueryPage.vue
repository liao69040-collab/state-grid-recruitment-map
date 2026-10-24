<script setup lang="ts">
import SiteFiling from '@/components/SiteFiling.vue';
import { projectContact } from '@/config/project-contact';
import RecruitmentReferenceSection from '@/views/information/RecruitmentReferenceSection.vue';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router';
import { createMobileNavigation, encodeTrail, isEntityLink, isInformationView, queryText, queryTrail } from './mobile-navigation';
import { authState, bootstrapAuth, login, logout } from '@/services/auth';
import { APPLICANT_COHORT_OPTIONS, DEFAULT_APPLICANT_COHORT, referenceCohortYear } from '@/config/recruitment-cohorts';
import { GRID_TERRITORIES, getGridTerritory } from '@/data/grid-territories';
import { fetchGridMapOverview, fetchGridMapSchool, fetchGridMapCompany } from '@/services/grid-map';
import type { GridMapOverview, GridMapSchool, GridMapCompany, GridMapDetail as DetailData } from '@/services/grid-map';
import type { RecruitmentApplicant, RecruitmentInitialApplicant, RecruitmentEvaluation } from '@/services/recruitment-eligibility';
import { gridLabels, gridOrgCategoryLabels } from '@/views/index/grid-information-display';
import { companyHasRecruitmentCount, gridMapBatchOptionsFor, gridMapScopeLabel, mapCountText, mapSchoolName } from '@/views/index/grid-map-display';
import GridMapDetail from '@/views/index/GridMapDetail.vue';
import { schoolProfileTags } from '@/views/index/school-data-display';
import EarlyBatchEligibilityDialog from '@/views/index/EarlyBatchEligibilityDialog.vue';
import GridInformationMobile from '@/views/information/GridInformationMobile.vue';
import { mobileInformationModes, isMobileInformationMode, mobileInformationTab, type MobileInformationMode } from '@/views/information/mobile-information-navigation';
import { createSwipeBack } from './swipe-back';
import informationLightning from '@/assets/icons/information-lightning.svg';
import { Search, Compass, Document, OfficeBuilding } from '@element-plus/icons-vue';

type MainTab = 'records' | 'eligibility' | 'information';
type GuideTab = MobileInformationMode | 'batches' | 'regions' | 'arrangements';
type EntityKind = 'school' | 'company';
const route = useRoute();
const navigation = createMobileNavigation(useRouter());
const initialYear = Number(route.query.targetCohortYear);
const targetYear = ref(APPLICANT_COHORT_OPTIONS.includes(initialYear) ? initialYear : DEFAULT_APPLICANT_COHORT);
const referenceYear = computed(() => referenceCohortYear(targetYear.value));
const provinceOptions = GRID_TERRITORIES.filter(item => item.operator !== 'not_applicable').map(item => ({ name: item.name, adcode: item.adcode }));
const initialProvince = typeof route.query.provinceAdcode === 'string' ? route.query.provinceAdcode : '';
const provinceCode = ref(provinceOptions.some(item => item.adcode === initialProvince) ? initialProvince : '');
const grid = ref('');
const batch = ref('');
const mainTab = ref<MainTab>('records');
const guideTab = ref<MobileInformationMode>('city');
const guideProvince = ref('');
const guideCity = ref('');
const guideGeneration = ref(0);
const entityKind = ref<EntityKind>('school');
const schoolScope = ref<'destination' | 'location'>('destination');
const city = ref('');
const tier = ref('');
const category = ref('');
const companyCity = ref('');
const keyword = ref('');
const submittedKeyword = ref('');
const showFilters = ref(false);
const listLimit = ref(30);
const otherListLimit = ref(30);
const overview = ref<GridMapOverview | null>(null);
const loading = ref(false);
const loadError = ref('');
const authChecking = ref(false);
const authError = ref('');
const loginOpen = ref(false);
const helpOpen = ref(false);
const phone = ref('');
const password = ref('');
const loginBusy = ref(false);
const loginError = ref('');
const contactStatus = ref('');
const logoutBusy = ref(false);
const quickDegree = ref<RecruitmentApplicant['degree'] | ''>('');
const quickMajor = ref<RecruitmentApplicant['majorCategory'] | ''>('');
const quickHukou = ref('');
const quickGraduationYear = ref<number>(DEFAULT_APPLICANT_COHORT);
const initialApplicant = ref<RecruitmentInitialApplicant>({});
const eligibilityKey = ref(0);
const detail = ref<DetailData | null>(null);
const detailBusy = ref(false);
const detailError = ref('');
const detailOpen = ref(false);
const detailTitle = ref('');
const detailTrail = ref<Array<{ kind: EntityKind; key: string }>>([]);
const loginSheet = ref<HTMLElement | null>(null);
const detailSheet = ref<HTMLElement | null>(null);
const helpSheet = ref<HTMLElement | null>(null);
const recordPanel = ref<HTMLElement | null>(null);
const eligibilityPanel = ref<HTMLElement | null>(null);
const scrollHost = ref<HTMLElement | null>(null);
let overviewController: AbortController | null = null;
let detailController: AbortController | null = null;
let overviewGeneration = 0;
let detailGeneration = 0;
let disposed = false;
let returnFocus: HTMLElement | null = null;
let pendingAction: (() => void) | null = null;

const provinceName = computed(() => provinceOptions.find(item => item.adcode === provinceCode.value)?.name || '全国');
const territory = computed(() => getGridTerritory(provinceCode.value));
const selectionQuery = computed(() => ({ cohortYear: referenceYear.value, provinceAdcode: provinceCode.value, grid: grid.value, batchCode: batch.value }));
const batchOptions = computed(() => gridMapBatchOptionsFor(grid.value));
const filterLabel = computed(() => gridMapScopeLabel({ grid: grid.value, batchCode: batch.value }));
const selectedProvince = computed(() => overview.value?.provinceSummaries.find(item => item.adcode === provinceCode.value));
const rosterAvailable = computed(() => overview.value?.rosterDataAvailable !== false);
const displayedTotal = computed(() => rosterAvailable.value ? provinceCode.value ? selectedProvince.value?.recordCount : overview.value?.nationalSummary?.recordCount : null);
const visibleCards = computed(() => rosterAvailable.value ? (overview.value?.exactCards || []).filter(card => typeof card.publicNotice.value === 'number') : []);
const publicProvinces = computed(() => (overview.value?.provinceSummaries || []).filter(item => provinceOptions.some(province => province.adcode === item.adcode)).sort((a, b) => (b.recordCount ?? -1) - (a.recordCount ?? -1)));
const allSchools = computed(() => {
  if (!authState.authenticated || !rosterAvailable.value) return [];
  const source = provinceCode.value && schoolScope.value === 'destination' ? overview.value?.sourceSchools : overview.value?.localSchools;
  return source || [];
});
const schoolCities = computed(() => [...new Set(allSchools.value.map(school => school.city).filter((name): name is string => Boolean(name)))].sort((a, b) => a.localeCompare(b, 'zh-CN')));
const allCompanies = computed(() => authState.authenticated ? overview.value?.companies || [] : []);
const companyCategories = computed(() => [...new Set(allCompanies.value.map(company => company.orgCategory).filter(code => code && code !== 'unknown'))]);
const companyCities = computed(() => [...new Set(allCompanies.value.map(company => company.companyCity).filter((name): name is string => Boolean(name)))].sort((a, b) => a.localeCompare(b, 'zh-CN')));
const cleanQuery = computed(() => submittedKeyword.value.trim().toLocaleLowerCase('zh-CN'));
const tierMatches = (school: GridMapSchool) => !tier.value || (tier.value === '985' ? school.is985 === true : tier.value === '211' ? school.is211 === true : tier.value === 'power' ? school.industryTags.some(tag => /原电力|电力部/.test(tag)) : tier.value === 'bachelor' ? /本科/.test(school.educationLevel || '') : tier.value === 'junior' ? /专科|高职/.test(school.educationLevel || '') : true);
const schools = computed(() => allSchools.value.filter(school => (!city.value || school.city === city.value) && tierMatches(school) && (!cleanQuery.value || [school.schoolName, school.campusName, school.province, school.city].filter(Boolean).join(' ').toLocaleLowerCase('zh-CN').includes(cleanQuery.value))));
const matchesCompany = (company: GridMapCompany) => (!category.value || company.orgCategory === category.value) && (!companyCity.value || company.companyCity === companyCity.value || companyCity.value === '__province__' && company.locationPrecision === 'province' || companyCity.value === '__unknown__' && !company.companyCity && company.locationPrecision !== 'province') && (!cleanQuery.value || [company.company, company.province, company.companyCity, company.companyGroup].filter(Boolean).join(' ').toLocaleLowerCase('zh-CN').includes(cleanQuery.value));
const companies = computed(() => allCompanies.value.filter(matchesCompany));
const otherSchools = computed(() => !authState.authenticated || !provinceCode.value || !rosterAvailable.value ? [] : (overview.value?.unassignedSchools || []).filter(school => tierMatches(school) && (!cleanQuery.value || [school.schoolName, school.campusName].filter(Boolean).join(' ').toLocaleLowerCase('zh-CN').includes(cleanQuery.value))));
const otherCompanies = computed(() => !authState.authenticated || !provinceCode.value ? [] : (overview.value?.unassignedCompanies || []).filter(matchesCompany));
const visibleSchools = computed(() => schools.value.slice(0, listLimit.value));
const visibleCompanies = computed(() => companies.value.slice(0, listLimit.value));
const resultCount = computed(() => entityKind.value === 'school' ? schools.value.length : companies.value.length);
const schoolMetricLabel = computed(() => provinceCode.value && schoolScope.value === 'destination' ? `进入${provinceName.value}` : '全国录用公示');
const scopeExplanation = computed(() => entityKind.value === 'company' ? `${provinceName.value}招聘单位，点击查看各批次和毕业院校。` : provinceCode.value && schoolScope.value === 'location' ? `位于${provinceName.value}的学校，数量为所选电网与批次的全国去向。` : provinceCode.value ? `进入${provinceName.value}招聘单位的毕业院校，包含省外学校。` : '全国院校按所选电网、批次录用公示排序；北京和保定等校区分别展示。');
const degrees = [{ value: 'junior_college', label: '专科' }, { value: 'bachelor', label: '本科' }, { value: 'master', label: '硕士' }, { value: 'doctor', label: '博士' }];
const majors = [{ value: 'electrical', label: '电工 / 电气类' }, { value: 'communication', label: '通信类' }, { value: 'computer', label: '计算机类' }, { value: 'electronic_information', label: '电子信息类' }, { value: 'artificial_intelligence', label: '人工智能类' }, { value: 'finance', label: '财务类' }, { value: 'human_resources', label: '人力资源类' }, { value: 'law', label: '法学类' }, { value: 'other_engineering', label: '其他工学' }, { value: 'other', label: '其他专业' }];
const numeral = (value: number | null | undefined, basis?: string) => mapCountText(value, basis || overview.value?.privacy.countBasis || 'released_cells_only');
const schoolGridCount = (school: GridMapSchool, operator: 'sgcc' | 'csg') => {
  const value = school.gridCounts[operator];
  // The complete roster omits absent operator keys, which means zero within
  // this known complete scope. Null/partial/missing-year values stay unknown.
  return value === undefined && school.countBasis === 'complete_anonymous_aggregates' && overview.value?.rosterDataAvailable === true ? 0 : value;
};
const schoolRank = (school: GridMapSchool, index: number) => typeof school.recordCount === 'number' ? schools.value.findIndex(item => item.recordCount === school.recordCount) + 1 : index + 1;
const errorText = (error: unknown, fallback = '查询暂时无法完成，请检查网络后重试。') => error instanceof Error && /[\u3400-\u9fff]/.test(error.message) ? error.message : fallback;
const cancelled = (error: unknown) => error instanceof DOMException && error.name === 'AbortError';
const rememberFocus = () => { returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null; };
function requireMember(action: () => void) {
  if (authState.authenticated) { action(); return; }
  pendingAction = action;
  showLogin();
}
function showLogin() { rememberFocus(); loginError.value = ''; loginOpen.value = true; void nextTick(() => loginSheet.value?.querySelector<HTMLInputElement>('input')?.focus()); }
function closeLogin() { if (loginBusy.value) return; loginOpen.value = false; password.value = ''; pendingAction = null; void nextTick(() => returnFocus?.focus()); }
function sheetKeydown(event: KeyboardEvent, sheet: HTMLElement | null, close: () => void) {
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
  if (event.key !== 'Tab') return;
  const items = Array.from(sheet?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), summary, [tabindex="0"]') || []).filter(item => item.getClientRects().length);
  if (!items.length) { event.preventDefault(); sheet?.focus(); return; }
  if (event.shiftKey && (document.activeElement === items[0] || document.activeElement === sheet)) { event.preventDefault(); items[items.length - 1]?.focus(); }
  else if (!event.shiftKey && document.activeElement === items[items.length - 1]) { event.preventDefault(); items[0]?.focus(); }
}
async function checkAuth() {
  authChecking.value = true; authError.value = '';
  try { await bootstrapAuth(); }
  catch (error) { authError.value = errorText(error, '暂时无法确认账号权限，请重试。'); }
  finally { authChecking.value = false; }
}
async function submitLogin() {
  if (loginBusy.value) return;
  loginBusy.value = true; loginError.value = '';
  try {
    await login(phone.value.trim(), password.value); password.value = ''; loginOpen.value = false;
    const nextAction = pendingAction; pendingAction = null; nextAction?.();
  } catch (error) { loginError.value = errorText(error, '登录失败，请检查账号后重试。'); }
  finally { loginBusy.value = false; }
}
async function submitLogout() {
  logoutBusy.value = true; authError.value = '';
  try { await logout(); }
  catch (error) { authError.value = errorText(error, '本机已退出，服务器暂时无法连接。'); }
  finally { logoutBusy.value = false; }
}
function clearData() {
  overviewGeneration++; detailGeneration++;
  overviewController?.abort(); detailController?.abort();
  overview.value = null; detail.value = null; detailOpen.value = false; detailTrail.value = [];
  loading.value = false; detailBusy.value = false;
}
async function loadOverview() {
  overviewController?.abort(); const controller = new AbortController(); overviewController = controller;
  const requestId = ++overviewGeneration;
  const authenticated = authState.authenticated;
  const query = { ...selectionQuery.value };
  loading.value = true; loadError.value = ''; overview.value = null;
  try {
    const data = await fetchGridMapOverview(query, controller.signal, !authenticated);
    if (disposed || controller.signal.aborted || requestId !== overviewGeneration || authenticated !== authState.authenticated) return;
    overview.value = data;
  } catch (error) {
    if (!controller.signal.aborted && requestId === overviewGeneration && !cancelled(error)) loadError.value = errorText(error);
  } finally { if (requestId === overviewGeneration) loading.value = false; }
}
function selectProvince(adcode: string) {
  const apply = () => { void navigation.push({ provinceAdcode: adcode, mqEntity: null, mqScope: null, mqCity: null, mqCompanyCity: null, mqTier: null, mqCategory: null, mqDetail: null }); };
  if (adcode) requireMember(apply); else apply();
}
function applySearch() { submittedKeyword.value = keyword.value; listLimit.value = 30; }
function clearSearch() { keyword.value = ''; submittedKeyword.value = ''; listLimit.value = 30; }
function resetQuery() { void navigation.push({ provinceAdcode: null, mqGrid: null, mqBatch: null, mqEntity: null, mqScope: null, mqCity: null, mqCompanyCity: null, mqTier: null, mqCategory: null, mqSearch: null, mqDetail: null }); }
function selectEntity(kind: EntityKind) { void navigation.push({ mqEntity: kind === 'school' ? null : kind, mqDetail: null }); }
function selectSchoolScope(scope: 'destination' | 'location') { void navigation.push({ mqScope: scope === 'destination' ? null : scope, mqCity: null, mqDetail: null }); }
function switchTab(tab: MainTab) {
  const apply = () => { void navigation.push({ mqTab: tab === 'records' ? null : tab, mqDetail: null, infoTrail: null }); void nextTick(() => scrollHost.value?.scrollTo({ top: 0, behavior: 'auto' })); };
  if (tab === 'records') apply(); else requireMember(apply);
}
function startQuickEligibility() {
  requireMember(() => {
    initialApplicant.value = { ...(quickDegree.value ? { degree: quickDegree.value } : {}), ...(quickMajor.value ? { majorCategory: quickMajor.value } : {}), graduationYear: quickGraduationYear.value, originalHukouProvinceAdcode: quickHukou.value || null };
    eligibilityKey.value++; switchTab('eligibility');
  });
}
function clearApplicantDraft() {
  quickDegree.value = ''; quickMajor.value = ''; quickHukou.value = '';
  quickGraduationYear.value = DEFAULT_APPLICANT_COHORT; initialApplicant.value = {};
  eligibilityKey.value++;
}
function showHelp() { rememberFocus(); helpOpen.value = true; void nextTick(() => helpSheet.value?.focus()); }
function closeHelp() { helpOpen.value = false; void nextTick(() => returnFocus?.focus()); }
function openGuide(tab: GuideTab, scoped = false) {
  const mode: MobileInformationMode = isMobileInformationMode(tab) ? tab : tab === 'batches' ? 'education' : tab === 'arrangements' ? 'early' : 'city';
  requireMember(() => {
    void navigation.push({ mqTab: 'information', mqGuide: mode === 'city' ? null : mode, mqGuideProvince: scoped && provinceCode.value ? provinceName.value : null, mqGuideCity: scoped ? city.value : null, mqDetail: null, infoTrail: null, infoScopedSeen: null });
  });
}
function scrollToResults(evaluation: RecruitmentEvaluation | null) {
  if (!evaluation) return;
  void nextTick(() => eligibilityPanel.value?.querySelector<HTMLElement>('.result-panel')?.scrollIntoView({ block: 'start', behavior: 'auto' }));
}
function handleUnauthorized() {
  clearApplicantDraft(); clearData(); mainTab.value = 'records'; pendingAction = null; showLogin(); void loadOverview();
}
async function openDetail(kind: EntityKind, key: string, replaceTrail = false) {
  if (!authState.authenticated) { requireMember(() => { void openDetail(kind, key, replaceTrail); }); return; }
  const item = { kind, key };
  if (!isEntityLink(item)) return;
  const trail = replaceTrail ? [item] : [...detailTrail.value, item];
  if (trail.length > 32 || JSON.stringify(trail) === JSON.stringify(detailTrail.value)) return;
  await navigation.push({ mqDetail: encodeTrail(trail) });
}
async function loadDetail(kind: EntityKind, key: string) {
  detailController?.abort(); const controller = new AbortController(); detailController = controller;
  const requestId = ++detailGeneration; detailBusy.value = true; detailError.value = ''; detail.value = null;
  const query = { ...selectionQuery.value };
  void nextTick(() => { detailSheet.value?.focus(); detailSheet.value?.querySelector<HTMLElement>('.mq-detail-scroll')?.scrollTo({ top: 0 }); });
  try {
    const data = kind === 'school' ? await fetchGridMapSchool(key, query, controller.signal) : await fetchGridMapCompany(key, query, controller.signal);
    if (disposed || controller.signal.aborted || requestId !== detailGeneration || !authState.authenticated) return;
    detail.value = data; detailTitle.value = 'school' in data ? mapSchoolName(data.school) : data.company.company;
  } catch (error) { if (!controller.signal.aborted && requestId === detailGeneration && !cancelled(error)) detailError.value = errorText(error); }
  finally { if (requestId === detailGeneration) detailBusy.value = false; }
}
function retryDetail() { const current = detailTrail.value[detailTrail.value.length - 1]; if (current) void loadDetail(current.kind, current.key); }
function backDetail() { void navigation.previousOr({ mqDetail: encodeTrail(detailTrail.value.slice(0, -1)) }); }
function closeDetail() { void navigation.returnTo({ mqDetail: null }); }
function clearDetailView() {
  detailGeneration++; detailController?.abort(); detail.value = null; detailOpen.value = false; detailBusy.value = false; detailError.value = ''; detailTrail.value = [];
  void nextTick(() => returnFocus?.focus());
}
let routeGeneration = 0;
function syncMobileRoute() {
  const request = ++routeGeneration;
  const year = Number(route.query.targetCohortYear);
  targetYear.value = APPLICANT_COHORT_OPTIONS.includes(year) ? year : DEFAULT_APPLICANT_COHORT;
  const province = queryText(route.query, 'provinceAdcode');
  provinceCode.value = provinceOptions.some(item => item.adcode === province) ? province : '';
  grid.value = ['sgcc', 'csg'].includes(queryText(route.query, 'mqGrid')) ? queryText(route.query, 'mqGrid') : '';
  batch.value = batchOptions.value.some(([code]) => code === queryText(route.query, 'mqBatch')) ? queryText(route.query, 'mqBatch') : '';
  entityKind.value = queryText(route.query, 'mqEntity') === 'company' ? 'company' : 'school';
  schoolScope.value = queryText(route.query, 'mqScope') === 'location' ? 'location' : 'destination';
  city.value = queryText(route.query, 'mqCity'); companyCity.value = queryText(route.query, 'mqCompanyCity');
  tier.value = queryText(route.query, 'mqTier'); category.value = queryText(route.query, 'mqCategory');
  submittedKeyword.value = queryText(route.query, 'mqSearch'); keyword.value = submittedKeyword.value;
  const requestedTab = queryText(route.query, 'mqTab');
  mainTab.value = authState.authenticated && (requestedTab === 'eligibility' || requestedTab === 'information') ? requestedTab : 'records';
  const requestedGuide = queryText(route.query, 'mqGuide');
  const nextGuide: MobileInformationMode = isMobileInformationMode(requestedGuide) ? requestedGuide : requestedGuide === 'batches' ? 'education' : requestedGuide === 'arrangements' ? 'early' : 'city';
  const nextProvince = queryText(route.query, 'mqGuideProvince'), nextCity = queryText(route.query, 'mqGuideCity');
  if (guideTab.value !== nextGuide || guideProvince.value !== nextProvince || guideCity.value !== nextCity) guideGeneration.value++;
  guideTab.value = nextGuide; guideProvince.value = nextProvince; guideCity.value = nextCity;
  const trail = queryTrail(route.query, 'mqDetail', isEntityLink);
  if (!trail.length || !authState.authenticated) { clearDetailView(); return; }
  void nextTick(() => {
    if (request !== routeGeneration || disposed || !authState.authenticated) return;
    const current = trail[trail.length - 1];
    if (!detailOpen.value) rememberFocus();
    detailTrail.value = trail; detailOpen.value = true; detailTitle.value = current.kind === 'school' ? '院校详情' : '招聘单位详情';
    void loadDetail(current.kind, current.key);
  });
}
// Real view history is the first choice. Direct links return to their parent view.
const swipe = createSwipeBack({
  canGoBack: () => loginOpen.value || helpOpen.value || detailOpen.value || Boolean(queryText(route.query, 'infoTrail')) || mainTab.value !== 'records' || Boolean(provinceCode.value) || navigation.hasPrevious(),
  goBack: () => {
    if (loginOpen.value) { closeLogin(); return; }
    if (helpOpen.value) { closeHelp(); return; }
    if (detailOpen.value) { backDetail(); return; }
    const informationTrail = queryTrail(route.query, 'infoTrail', isInformationView);
    if (informationTrail.length) { void navigation.previousOr({ infoTrail: encodeTrail(informationTrail.slice(0, -1)) }); return; }
    if (mainTab.value !== 'records') { void navigation.previousOr({ mqTab: null, mqGuide: null, infoTrail: null }); return; }
    void navigation.previousOr({ provinceAdcode: null, mqEntity: null, mqDetail: null });
  },
});
async function copyContact() {
  if (!projectContact) return;
  try { await navigator.clipboard.writeText(projectContact); contactStatus.value = '联系方式已复制'; }
  catch { contactStatus.value = `请手动复制：${projectContact}`; }
}
function viewDesktop() { window.location.hash = `/index?view=desktop&targetCohortYear=${targetYear.value}`; window.location.reload(); }
watch(grid, () => { if (batch.value && !batchOptions.value.some(([code]) => code === batch.value)) batch.value = ''; });
// Selection controls replace only the current view. Personal applicant fields
// deliberately stay in memory and never become URL/history values.
watch([targetYear, grid, batch, city, companyCity, tier, category, submittedKeyword], () => {
  const year = Number(route.query.targetCohortYear) || DEFAULT_APPLICANT_COHORT;
  const changedSelection = year !== targetYear.value || queryText(route.query, 'mqGrid') !== grid.value || queryText(route.query, 'mqBatch') !== batch.value;
  if (changedSelection) { city.value = ''; companyCity.value = ''; }
  void navigation.replace({ targetCohortYear: targetYear.value, mqGrid: grid.value, mqBatch: batch.value, mqCity: city.value, mqCompanyCity: companyCity.value, mqTier: tier.value, mqCategory: category.value, mqSearch: submittedKeyword.value, ...(changedSelection ? { mqDetail: null, infoTrail: null } : {}) });
});
watch([targetYear, provinceCode, grid, batch], () => { clearDetailView(); listLimit.value = 30; otherListLimit.value = 30; if (authState.ready) void loadOverview(); });
watch([entityKind, schoolScope, city, companyCity, tier, category, submittedKeyword], () => { listLimit.value = 30; otherListLimit.value = 30; });
watch(() => authState.authenticated, (authenticated, previous) => {
  if (authenticated === previous) return;
  clearData(); if (!authenticated) { clearApplicantDraft(); mainTab.value = 'records'; } else syncMobileRoute(); if (authState.ready) void loadOverview();
});
watch(() => route.fullPath, syncMobileRoute, { immediate: true });
onMounted(async () => { if (!authState.ready) await checkAuth(); syncMobileRoute(); if (!overview.value && !loading.value) void loadOverview(); if (!authState.authenticated && (queryText(route.query, 'mqTab') || queryTrail(route.query, 'mqDetail', isEntityLink).length)) requireMember(syncMobileRoute); });
onBeforeRouteLeave(() => {
  if (loginOpen.value) { closeLogin(); return false; }
  if (helpOpen.value) { closeHelp(); return false; }
  return true;
});
onBeforeUnmount(() => { disposed = true; clearData(); password.value = ''; });
</script>

<template>
  <div class="mobile-query" data-qa="mobile-query-page" @touchstart="swipe.start" @touchmove="swipe.move" @touchend="swipe.end" @touchcancel="swipe.cancel">
    <div class="mq-ambient" aria-hidden="true"><span class="mq-ion"></span><span class="mq-ion"></span><span class="mq-ion"></span><span class="mq-ion"></span><span class="mq-ion"></span><span class="mq-ion"></span></div>
    <div class="mq-layout" :inert="loginOpen || detailOpen || helpOpen">
      <header class="mq-header mq-compact-header">
        <div class="mq-brand"><span class="mq-brand-mark" aria-hidden="true"><img :src="informationLightning" alt=""></span><strong>电网招聘查询</strong></div>
        <label class="mq-cohort"><span>报考</span><select v-model.number="targetYear" aria-label="报考届别"><option v-for="year in APPLICANT_COHORT_OPTIONS" :key="year" :value="year">{{ year }}届</option></select></label>
      </header>
      <div class="mq-context-bar mq-compact-context">
        <span class="mq-reference">参考 {{ referenceYear }}届数据</span>
        <button class="mq-text-button" type="button" @click="viewDesktop">电脑版 ↗</button>
        <button v-if="authState.authenticated" class="mq-text-button" type="button" :disabled="logoutBusy" @click="submitLogout">{{ logoutBusy ? '退出中' : '退出' }}</button>
        <button v-else class="mq-text-button" type="button" :disabled="authChecking" @click="showLogin">登录</button>
      </div>
      <div v-if="authError" class="mq-auth-error" role="alert"><p>{{ authError }}</p><button class="mq-secondary" type="button" :disabled="authChecking" @click="checkAuth">{{ authChecking ? '正在确认…' : '重试账号连接' }}</button></div>
      <div v-show="mainTab !== 'information'" ref="scrollHost" class="mq-scroll">
        <section v-show="mainTab === 'records'" ref="recordPanel" class="mq-record-panel" aria-label="录用查询">
          <h1 class="mq-sr-only">院校与单位录用查询</h1>
          <form class="mq-search" role="search" @submit.prevent="applySearch">
            <Search class="mq-search-icon" aria-hidden="true" /><label class="mq-sr-only" for="mobile-entity-search">搜索学校、公司或城市</label><input id="mobile-entity-search" v-model="keyword" type="search" placeholder="学校、公司、城市" enterkeyhint="search" @input="!keyword && clearSearch()"><button v-if="keyword" type="button" class="mq-search-clear" aria-label="清空搜索" @click="clearSearch">×</button><button type="submit">搜索</button>
          </form>
          <div class="mq-filter-row mq-compact-filters">
            <label><span class="mq-sr-only">录用地区</span><select :value="provinceCode" aria-label="录用地区" @change="selectProvince(($event.target as HTMLSelectElement).value)"><option value="">全国</option><option v-for="province in provinceOptions" :key="province.adcode" :value="province.adcode">{{ province.name }}</option></select></label>
            <label><span class="mq-sr-only">电网</span><select v-model="grid" aria-label="录用电网"><option value="">全部电网</option><option value="sgcc">国家电网</option><option value="csg">南方电网</option></select></label>
            <label><span class="mq-sr-only">批次</span><select v-model="batch" aria-label="录用批次"><option v-for="[code, label] in batchOptions" :key="code" :value="code">{{ code ? label : '全部批次' }}</option></select></label>
          </div>
          <p v-if="territory?.operator === 'mixed'" class="mq-scope-note">内蒙古录用统计为国网蒙东；蒙西条件在「我能报哪」与报考指南中单独查看。</p>
          <template v-if="loading"><div class="mq-loading-card" aria-live="polite" role="status"><span class="mq-spinner" aria-hidden="true"></span><strong>正在查询{{ referenceYear }}届资料</strong><p>加载完成后显示所选地区、电网与批次。</p></div></template>
          <div v-else-if="loadError" class="mq-state mq-error" role="alert"><strong>资料暂时无法加载</strong><p>{{ loadError }}</p><button class="mq-primary" type="button" @click="loadOverview">重新查询</button></div>
          <template v-else-if="overview">
            <template v-if="overview.referenceDataAvailable === false || !rosterAvailable"><div class="mq-state"><strong>暂无{{ referenceYear }}届录用名册</strong><p>所选报考届需要参考{{ referenceYear }}届。目前不提供该届录用排名；可继续查看已收录的招聘条件。</p><button class="mq-primary" type="button" @click="openGuide('regions')">查看招聘条件</button></div><template v-if="authState.authenticated && companies.length"><div class="mq-heading"><h2>已收录的单位招聘条件</h2><span>{{ companies.length }}家</span></div><p class="mq-scope-note">以下是招聘单位目录，不是本届录用排名。没有名册的数量不显示为零。</p><div class="mq-entity-list"><button v-for="company in visibleCompanies" :key="company.companyKey" class="mq-entity-card" type="button" @click="openDetail('company', company.companyKey, true)"><OfficeBuilding class="mq-company-icon" aria-hidden="true" /><span class="mq-entity-copy"><strong>{{ company.company }}</strong><small>{{ [company.province, gridLabels[company.grid]].filter(Boolean).join(' · ') }}</small></span><span class="mq-entity-value"><small>查看要求</small><span aria-hidden="true">›</span></span></button></div><button v-if="companies.length > listLimit" class="mq-load-more mq-secondary" type="button" @click="listLimit += 30">继续查看单位（{{ Math.min(listLimit, companies.length) }} / {{ companies.length }}）</button></template></template>
            <template v-else>
              <section class="mq-summary mq-compact-summary" aria-label="当前范围录用统计"><div><span>{{ provinceName }} · {{ filterLabel }}</span><div class="mq-summary-value"><strong>{{ numeral(displayedTotal) }}</strong><small>{{ authState.authenticated ? '录用公示合计' : '公开录用统计' }}</small></div></div><button type="button" @click="openGuide('batches', Boolean(provinceCode))">学历要求 <span aria-hidden="true">↗</span></button></section>
              <div v-if="authState.authenticated && visibleCards.length" class="mq-metric-row mq-compact-metrics" :style="{ gridTemplateColumns: `repeat(${Math.min(5, visibleCards.length)}, minmax(0, 1fr))` }"><button v-for="card in visibleCards" :key="card.key" type="button" @click="batch = card.batchCode"><span>{{ card.title }}</span><strong>{{ numeral(card.publicNotice.value, card.publicNotice.countBasis) }}</strong></button></div>
              <section v-if="!authState.authenticated" class="mq-public-panel"><div class="mq-state mq-login-inline"><strong>完整去向需已开通账号</strong><button class="mq-primary" type="button" @click="showLogin">登录查询</button></div><div class="mq-heading"><h2>地区公开总览</h2><span>{{ referenceYear }}届</span></div><div class="mq-region-list"><button v-for="province in publicProvinces" :key="province.adcode" type="button" @click="selectProvince(province.adcode)"><strong>{{ province.name }}</strong><span>{{ numeral(province.recordCount, province.countBasis) }} <b aria-hidden="true">›</b></span></button></div></section>
              <template v-else>
                <div class="mq-results-toolbar"><div class="mq-segment" role="group" aria-label="查询对象"><button type="button" :aria-pressed="entityKind === 'school'" @click="selectEntity('school')">院校去向</button><button type="button" :aria-pressed="entityKind === 'company'" @click="selectEntity('company')">招聘单位</button></div><button type="button" class="mq-secondary mq-filter-toggle" @click="showFilters = !showFilters" :aria-expanded="showFilters" :aria-label="showFilters ? '收起更多筛选条件' : '展开更多筛选条件'">{{ showFilters ? '收起' : '筛选' }}</button><button type="button" class="mq-reset" @click="resetQuery" aria-label="重置查询条件">重置</button></div>
                <div v-if="entityKind === 'school' && provinceCode" class="mq-scope-tabs" role="group" aria-label="院校统计范围"><button type="button" :aria-pressed="schoolScope === 'destination'" @click="selectSchoolScope('destination')">进入本省的院校</button><button type="button" :aria-pressed="schoolScope === 'location'" @click="selectSchoolScope('location')">学校位于本省</button></div>
                <div v-if="showFilters" class="mq-more-filters">
                  <template v-if="entityKind === 'school'"><label><span>毕业院校所在城市</span><select v-model="city" aria-label="毕业院校所在城市"><option value="">全部城市</option><option v-for="name in schoolCities" :key="name" :value="name">{{ name }}</option></select></label><label><span>院校层级</span><select v-model="tier" aria-label="院校层级"><option value="">全部层级</option><option value="power">原电力部直属</option><option value="985">985</option><option value="211">211</option><option value="bachelor">本科</option><option value="junior">专科 / 高职</option></select></label></template>
                  <template v-else><label><span>单位所在城市</span><select v-model="companyCity" aria-label="单位所在城市"><option value="">全部城市与省级单位</option><option v-for="name in companyCities" :key="name" :value="name">{{ name }}</option><option value="__province__">省级单位</option><option value="__unknown__">其他单位</option></select></label><label><span>公司类别</span><select v-model="category" aria-label="公司类别"><option value="">全部类别</option><option v-for="code in companyCategories" :key="code" :value="code">{{ gridOrgCategoryLabels[code] || '其他单位' }}</option></select></label><p class="mq-scope-note">单位所在地用于找公司，不代表被录用人员的实际工作城市。</p></template>
                </div>
                <div class="mq-heading"><h2>{{ entityKind === 'school' ? '院校录用去向' : '招聘单位' }}</h2><span>{{ resultCount }}{{ entityKind === 'school' ? '所' : '家' }}</span></div><p class="mq-scope-note">{{ scopeExplanation }}</p>
                <p v-if="keyword.trim() !== submittedKeyword.trim()" class="mq-draft" role="status">关键词已修改，点击「搜索」查看结果。</p>
                <div v-if="!resultCount" class="mq-state"><strong>没有符合这些条件的结果</strong><p>试试清空关键词，或放宽地区、电网、批次与层级。</p><button class="mq-secondary" type="button" @click="resetQuery">重置为全国</button></div>
                <div v-else class="mq-entity-list">
                  <template v-if="entityKind === 'school'"><button v-for="(school, index) in visibleSchools" :key="school.campusKey" class="mq-entity-card" type="button" @click="openDetail('school', school.campusKey, true)"><span class="mq-rank" :aria-label="`录用数量排序第${schoolRank(school, index)}位，同数并列`">{{ schoolRank(school, index) }}</span><span class="mq-entity-copy"><strong>{{ mapSchoolName(school) }}</strong><small>{{ [school.province, school.city].filter(Boolean).join(' · ') }}</small><span v-if="schoolProfileTags(school).length" class="mq-tags"><b v-for="tag in schoolProfileTags(school)" :key="tag">{{ tag }}</b></span><small v-if="!provinceCode">国网 {{ numeral(schoolGridCount(school, 'sgcc'), school.countBasis) }} · 南网 {{ numeral(schoolGridCount(school, 'csg'), school.countBasis) }}</small></span><span class="mq-entity-value"><strong>{{ numeral(school.recordCount, school.countBasis) }}</strong><small>{{ schoolMetricLabel }}</small><span aria-hidden="true">›</span></span></button></template>
                  <template v-else><button v-for="company in visibleCompanies" :key="company.companyKey" class="mq-entity-card" type="button" @click="openDetail('company', company.companyKey, true)"><OfficeBuilding class="mq-company-icon" aria-hidden="true" /><span class="mq-entity-copy"><strong>{{ company.company }}</strong><small>{{ [company.province, gridLabels[company.grid]].filter(Boolean).join(' · ') }}</small><span class="mq-tags"><b v-if="company.companyCity">{{ company.companyCity }}</b></span></span><span class="mq-entity-value"><strong v-if="companyHasRecruitmentCount(company)">{{ numeral(company.recordCount, company.countBasis) }}</strong><small>{{ companyHasRecruitmentCount(company) ? '录用公示' : '查看招聘要求' }}</small><span aria-hidden="true">›</span></span></button></template>
                </div>
                <button v-if="resultCount > listLimit" class="mq-load-more mq-secondary" type="button" @click="listLimit += 30">继续查看（{{ Math.min(listLimit, resultCount) }} / {{ resultCount }}）</button>
                <details v-if="entityKind === 'school' ? otherSchools.length : otherCompanies.length" class="mq-other-list"><summary>{{ entityKind === 'school' ? `其他全国院校 ${otherSchools.length}所` : `其他招聘单位 ${otherCompanies.length}家` }}</summary><p>下列条目没有归属到当前省份，不计入本省统计；可打开查看全国去向或招聘条件。</p><template v-if="entityKind === 'school'"><button v-for="school in otherSchools.slice(0, otherListLimit)" :key="school.campusKey" type="button" @click="openDetail('school', school.campusKey, true)"><strong>{{ mapSchoolName(school) }}</strong><span aria-hidden="true">›</span></button><button v-if="otherSchools.length > otherListLimit" type="button" @click="otherListLimit += 30">继续查看全部院校</button></template><template v-else><button v-for="company in otherCompanies.slice(0, otherListLimit)" :key="company.companyKey" type="button" @click="openDetail('company', company.companyKey, true)"><strong>{{ company.company }}</strong><span aria-hidden="true">›</span></button><button v-if="otherCompanies.length > otherListLimit" type="button" @click="otherListLimit += 30">继续查看全部单位</button></template></details>
                <div class="mq-link-grid"><button type="button" @click="openGuide('schools')"><strong>完整院校榜</strong><span>按省份、批次与层级比较 ↗</span></button><button type="button" @click="openGuide('regions', Boolean(provinceCode))"><strong>地区招聘指南</strong><span>学历、待遇、难度与流程 ↗</span></button></div>
              </template>
            </template>
          </template>
          <RecruitmentReferenceSection :cohort-year="referenceYear" :province-adcode="provinceCode" :grid="grid" :batch-code="batch" />
          <section class="mq-quick-card" aria-labelledby="mobile-quick-title"><div class="mq-heading"><div><span class="mq-eyebrow">从你自己的条件出发</span><h2 id="mobile-quick-title">我能报哪里？</h2></div><span aria-hidden="true">↗</span></div><div class="mq-quick-fields"><label><span>最高学历</span><select v-model="quickDegree" aria-label="快捷最高学历"><option value="">请选择</option><option v-for="item in degrees" :key="item.value" :value="item.value">{{ item.label }}</option></select></label><label><span>专业</span><select v-model="quickMajor" aria-label="快捷专业类别"><option value="">暂不填写</option><option v-for="item in majors" :key="item.value" :value="item.value">{{ item.label }}</option></select></label><label><span>本人毕业年份</span><input v-model.number="quickGraduationYear" aria-label="快捷本人毕业年份" type="number" inputmode="numeric" min="2020" max="2100"></label><label><span>原户籍地</span><select v-model="quickHukou" aria-label="快捷原户籍地"><option value="">暂不填写</option><option v-for="province in provinceOptions" :key="province.adcode" :value="province.adcode">{{ province.name }}</option></select></label></div><button class="mq-primary" type="button" @click="startQuickEligibility">按我的条件找方向</button><p>参考{{ referenceYear }}届条件；生源、县域和单位限制在结果中分别查看。</p></section>
          <footer class="mq-footer"><SiteFiling /><p>{{ targetYear }}届报考参考{{ referenceYear }}届资料。录用公示与当届资格分别查看。</p><button type="button" @click="showHelp">统计说明与使用帮助</button><button v-if="projectContact" type="button" @click="copyContact">联系维护者：{{ projectContact }}</button><span v-if="contactStatus" role="status">{{ contactStatus }}</span></footer>
        </section>
        <section v-if="authState.authenticated" v-show="mainTab === 'eligibility'" ref="eligibilityPanel" class="mq-eligibility-panel" aria-label="我能报哪里"><div class="mq-page-title"><span class="mq-eyebrow">学历 · 专业 · 生源与户籍</span><h1>我能报哪里？</h1><p>补充实际条件，查看全国各单位、各批次的历史参考匹配。</p></div><EarlyBatchEligibilityDialog :key="eligibilityKey" :province-options="provinceOptions" :cohort-year="targetYear" :initial-applicant="initialApplicant" @unauthorized="handleUnauthorized" @recruitment-evaluation="scrollToResults" /><SiteFiling class="mq-site-filing" /></section>
      </div>
      <section v-if="mainTab === 'information' && authState.authenticated" class="mq-information-panel" aria-label="报考指南">
        <div class="mq-guide-tabs mq-flat-guide-tabs" role="group" aria-label="报考指南分类"><button v-for="mode in mobileInformationModes" :key="mode.key" type="button" :aria-pressed="guideTab === mode.key" @click="openGuide(mode.key)">{{ mode.label }}</button></div>
        <GridInformationMobile :key="`${targetYear}:${guideTab}:${guideGeneration}`" :initial-tab="mobileInformationTab(guideTab)" :flat-mode="guideTab" :province="guideProvince" :city="guideCity" :target-cohort-year="targetYear" :hide-batch-overview="true" :compact-regions="true" @unauthorized="handleUnauthorized" />
      </section>
      <nav class="mq-bottom-nav mq-compact-nav" aria-label="手机查询导航"><button type="button" :aria-current="mainTab === 'records' ? 'page' : undefined" @click="switchTab('records')"><Search aria-hidden="true" /><strong>录用查询</strong></button><button type="button" :aria-current="mainTab === 'eligibility' ? 'page' : undefined" @click="switchTab('eligibility')"><Compass aria-hidden="true" /><strong>我能报哪</strong></button><button type="button" :aria-current="mainTab === 'information' ? 'page' : undefined" @click="openGuide(guideTab)"><Document aria-hidden="true" /><strong>报考指南</strong></button></nav>
    </div>
    <div v-if="loginOpen" class="mq-overlay" @click.self="closeLogin"><section ref="loginSheet" class="mq-login-sheet" role="dialog" aria-modal="true" aria-labelledby="mobile-login-title" tabindex="-1" @keydown="sheetKeydown($event, loginSheet, closeLogin)"><header><div><span class="mq-eyebrow">已开通账号</span><h2 id="mobile-login-title">登录电网招聘查询</h2></div><button class="mq-icon-button" type="button" aria-label="关闭登录" :disabled="loginBusy" @click="closeLogin">×</button></header><p>登录后可查完整院校去向、招聘单位与个人报考条件。</p><form @submit.prevent="submitLogin"><label><span>手机号</span><input v-model="phone" type="tel" inputmode="numeric" autocomplete="username" maxlength="11" pattern="[0-9]{11}" required placeholder="请输入已开通手机号"></label><label><span>密码</span><input v-model="password" type="password" autocomplete="current-password" required placeholder="请输入密码"></label><p v-if="loginError" class="mq-error-text" role="alert">{{ loginError }}</p><button class="mq-primary" type="submit" :disabled="loginBusy">{{ loginBusy ? '正在验证…' : '登录并继续查询' }}</button></form><p class="mq-scope-note">{{ projectContact ? `账号咨询：${projectContact}` : '本地演示账号见项目 README；正式部署请使用管理员开通的账号。' }}</p></section></div>
    <div v-if="helpOpen" class="mq-overlay" @click.self="closeHelp"><section ref="helpSheet" class="mq-login-sheet mq-help-sheet" role="dialog" aria-modal="true" aria-labelledby="mobile-help-title" tabindex="-1" @keydown="sheetKeydown($event, helpSheet, closeHelp)"><header><h2 id="mobile-help-title">统计说明与使用帮助</h2><button class="mq-icon-button" type="button" aria-label="关闭帮助" @click="closeHelp">×</button></header><h3>先选录用地区，再看院校去向</h3><p>“进入本省的院校”统计被本省招聘单位录用的毕业院校，包含省外学校。“学校位于本省”查学校所在地，数量为该校全国去向。学校所在地、单位所在地和实际工作地不是同一口径。</p><h3>公示数量不是最终到岗人数</h3><p>同一人可能出现在不同批次或电网公示中；页面提供匿名汇总，不展示个人名单。公开统计可能隐藏小样本，未公开数值不会按零处理。</p><h3>历史条件与当届报名分别判断</h3><p>{{ targetYear }}届报考参考{{ referenceYear }}届。报考匹配用于比对已有学历、专业与其他限制，不保证网申通过或录取。本人毕业年份、原户籍、生源地与意向地需要分别填写。</p><h3>南网与内蒙古单独查</h3><p>南网保留校园、秋招、春招的原生批次。国网蒙东与蒙西电网的条件分别查看，不合并替代。</p><button class="mq-secondary" type="button" @click="closeHelp">返回查询</button></section></div>
    <div v-if="detailOpen" class="mq-overlay mq-detail-overlay"><section ref="detailSheet" class="mq-detail-sheet" role="dialog" aria-modal="true" aria-labelledby="mobile-detail-title" tabindex="-1" @keydown="sheetKeydown($event, detailSheet, closeDetail)"><header class="mq-detail-header"><button class="mq-icon-button" type="button" :aria-label="detailTrail.length > 1 ? '返回上一详情' : '返回录用查询'" @click="backDetail">‹</button><h2 id="mobile-detail-title">{{ detailTitle }}</h2><button class="mq-icon-button" type="button" aria-label="关闭详情" @click="closeDetail">×</button></header><div class="mq-detail-scroll"><p v-if="detailBusy" class="mq-state" role="status"><span class="mq-spinner" aria-hidden="true"></span>正在读取详情…</p><div v-else-if="detailError" class="mq-state mq-error" role="alert"><p>{{ detailError }}</p><button class="mq-primary" type="button" @click="retryDetail">重试详情</button></div><GridMapDetail v-else-if="detail && authState.authenticated" :detail="detail" :province-name="provinceName" :filter-label="filterLabel" :cohort-year="referenceYear" @open-school="openDetail('school', $event)" @open-company="openDetail('company', $event)" /><button class="mq-detail-return mq-secondary" type="button" @click="closeDetail">返回录用查询</button></div></section></div>
  </div>
</template>

<style scoped src="./mobile-query.css"></style>


<style scoped>
/* Search comes first; only the three supporting selects use shorter hit areas. */
.mobile-query .mq-compact-header { gap: 8px; min-height: 48px; padding-top: max(3px, env(safe-area-inset-top)); }
.mobile-query .mq-compact-header .mq-brand { gap: 6px; }
.mobile-query .mq-compact-header .mq-brand-mark { width: 28px; height: 30px; border-radius: 10px; }
.mobile-query .mq-compact-header .mq-brand-mark img { width: 18px; height: 23px; }
.mobile-query .mq-compact-header .mq-brand strong { font-size: 16px; letter-spacing: -.3px; }
.mobile-query .mq-compact-header .mq-cohort { flex: none; }
.mobile-query .mq-compact-header .mq-cohort > span { font-size: 12px; }
.mobile-query .mq-compact-header .mq-cohort select { font-size: 16px!important; min-height: 44px!important; }
.mobile-query .mq-compact-context { min-height: 40px; gap: 8px; padding-bottom: 0; }
.mobile-query .mq-compact-context .mq-text-button { padding: 2px 4px; }
.mobile-query .mq-record-panel { padding-top: 4px; }
.mobile-query .mq-search { margin-bottom: 7px; }
.mobile-query .mq-compact-filters { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
.mobile-query .mq-compact-filters label { padding: 0 4px; gap: 0; border-radius: 11px; }
.mobile-query .mq-compact-filters select { min-height: 40px!important; height: 40px; padding: 4px 0!important; line-height: 1.5; }
.mobile-query .mq-compact-summary { padding: 8px 11px; gap: 8px; margin: 8px 0 7px; border-radius: 15px; }
.mobile-query .mq-compact-summary > div { flex: 1; }
.mobile-query .mq-compact-summary > div > span { font-size: 12px; line-height: 1.4; overflow-wrap: anywhere; }
.mobile-query .mq-summary-value { display: flex; align-items: baseline; flex-wrap: wrap; gap: 1px 8px; }
.mobile-query .mq-compact-summary strong { display: inline; font-size: 27px; line-height: 1.25; margin: 2px 0 0; }
.mobile-query .mq-compact-summary small { font-size: 12px; }
.mobile-query .mq-compact-summary > button { min-height: 44px; font-size: 12px; padding: 4px 0; }
.mobile-query .mq-compact-summary > button span { display: inline; font-size: 16px; }
.mobile-query .mq-compact-metrics { gap: 4px; margin: 7px 0 8px; }
.mobile-query .mq-compact-metrics button { padding: 5px 3px; border-radius: 11px; text-align: center; }
.mobile-query .mq-compact-metrics span { font-size: 12px; line-height: 1.3; }
.mobile-query .mq-compact-metrics strong { font-size: 16px; line-height: 1.35; overflow-wrap: anywhere; }
.mobile-query .mq-results-toolbar { display: grid; grid-template-columns: minmax(0, 1fr) auto 44px; gap: 5px; align-items: center; margin: 8px 0; }
.mobile-query .mq-results-toolbar .mq-segment { margin-top: 0; padding: 2px; border-radius: 13px; }
.mobile-query .mq-results-toolbar .mq-segment button { padding: 5px 2px; font-size: 14px; }
.mobile-query .mq-results-toolbar .mq-filter-toggle { padding: 5px 9px; font-size: 13px; }
.mobile-query .mq-record-panel > .mq-heading { margin-top: 10px; }
.mobile-query .mq-login-inline { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 5px 9px; margin: 8px 0; border-radius: 13px; text-align: left; }
.mobile-query .mq-login-inline > strong { font-size: 13px; font-weight: 600; overflow-wrap: anywhere; }
.mobile-query .mq-login-inline .mq-primary { flex: none; padding: 6px 10px; font-size: 13px; }
.mobile-query .mq-flat-guide-tabs { grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 4px; padding-bottom: 5px; }
.mobile-query .mq-flat-guide-tabs button { padding: 7px 1px; font-size: 12px; line-height: 1.45; border-radius: 12px; }
.mobile-query .mq-footer { font-size: 11px; padding: 14px 0 8px; }
.mobile-query .mq-footer > p { font-size: 11px; margin: 4px 0; }
.mobile-query .mq-footer > button { font-size: 11px; padding: 5px; }
.mobile-query .mq-footer :deep(.site-filing) { background: transparent; border: 0; box-shadow: none; }
.mobile-query .mq-compact-nav { min-height: 52px; }
.mobile-query .mq-compact-nav > button { display: flex; align-items: center; justify-content: center; gap: 4px; min-height: 44px; padding: 5px 2px; }
.mobile-query .mq-compact-nav > button svg { width: 18px; height: 18px; flex: none; }
.mobile-query .mq-compact-nav > button strong { font-size: 13px; line-height: 1.4; }
@media (max-width: 350px) {
  .mobile-query .mq-compact-metrics strong { font-size: 14px; }
}
</style>
