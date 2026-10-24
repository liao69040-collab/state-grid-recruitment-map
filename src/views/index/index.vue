<script setup lang="ts">
import SiteFiling from '@/components/SiteFiling.vue';
import RecruitmentReferenceSection from '@/views/information/RecruitmentReferenceSection.vue';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import {
  ArrowLeftBold,
  DataLine,
  Document,
  Lock,
  OfficeBuilding,
  School,
  User,
  Search,
  ArrowRight,
  Location,
  Close,
  Guide,
} from "@element-plus/icons-vue";
import CenterMap from "./center-map.vue";
import EarlyBatchEligibilityDialog from "./EarlyBatchEligibilityDialog.vue";
import { isPositiveRecruitmentResult } from './recruitment-match-display';
import GridInformationPortal from "./GridInformationPortal.vue";
import GridInformationModalHost from "../information/GridInformationModalHost.vue";
import GridMapDetail from "./GridMapDetail.vue";
import GridBatchStatistics from "./GridBatchStatistics.vue";
import AllSchoolDataDialog from './AllSchoolDataDialog.vue';
import { schoolDataBatchColumns, schoolProfileTags, type SchoolDataTotals } from './school-data-display';
import MapContextPreview from "./MapContextPreview.vue";
import { buildProvincePreview, buildNationalPreview, buildSchoolPreview, buildSchoolRecruitmentPreview, previewCountText, type MapContextPreviewData } from './map-context-preview';
import { APPLICANT_COHORT_OPTIONS, DEFAULT_APPLICANT_COHORT, referenceCohortYear } from '@/config/recruitment-cohorts';
import ProvinceRecruitmentProfile from "./ProvinceRecruitmentProfile.vue";
import ProvinceEarlyBatchCard from "./ProvinceEarlyBatchCard.vue";
import {
  batchSuppressionLabel,
  compareSchoolsForBatch,
  resolveBatchResultMetric,
  resolveEntityMetric,
  resolveSchoolMetric,
  schoolMatchesBatch,
} from "./display-metrics";
import type { MetricKind, SchoolBatchKey } from "./display-metrics";
import { authState, bootstrapAuth, login, logout } from "@/services/auth";
import { navigateInformationPage } from "@/services/information-navigation";
import { fetchGridRankings, type GridRankingRow } from "@/services/grid-information";
import { fetchTopSchoolRankings, provinceSchoolRankingQuery } from "./school-ranking-query";
import type { MapPreviewRanking, MapPreviewRankingRequest, MapPreviewConditions, MapPreviewSchoolDetail } from "./MapContextPreview.vue";
import type { EarlyBatchCatalog } from "@/services/early-batch";
import type { RecruitmentEvaluation, RecruitmentApplicant, RecruitmentInitialApplicant, RecruitmentBatchCode } from "@/services/recruitment-eligibility";
import {
  fetchProvinceRecruitmentProfile,
  type ProvinceRecruitmentProfile as ProvinceRecruitmentProfileData,
} from "@/services/provincial-recruitment";
import { getGridTerritory } from "@/data/grid-territories";
import {
  fetchGridMapOverview, fetchGridMapSchool, fetchGridMapCompany,
  type GridMapOverview, type GridMapSchool, type GridMapCompany, type GridMapDetail as GridMapDetailData,
} from "@/services/grid-map";
import {
  gridMapBatchOptions, gridMapBatchOptionsFor, gridMapBatchGrid, gridMapScopeLabel, mapSchoolName, mapCountText, schoolMapId, companyMapId,
  validMapCoordinates, buildSchoolMapPoints, buildCompanyMapPoints, companyLocationKey, schoolTooltipSections, summarizeCompanyRecruitment,
} from "./grid-map-display";

type MapLevel = "national" | "province";
type DialogName = "login" | "sources" | "calendar" | "provinceProfile" | "gridInformation" | "allSchoolData" | "";
type DashboardMode = "school" | "company";
type RoamDirection = "in" | "out" | "pan" | "reset";

interface GeoRoamPayload {
  zoom: number;
  center: [number, number] | null;
  focus: [number, number] | null;
  focusRegion: string;
  direction: RoamDirection;
}
type BatchState = "provisional" | "suppressed" | "unpublished" | "unverified" | "not-applicable";

interface BatchResult {
  name: string;
  officialName: string;
  value: number | null;
  state: BatchState;
  note: string;
  metricKind?: MetricKind;
  approximate?: boolean;
}

interface RecruitingUnit {
  unitName: string;
  sectionName: string;
  locationLabel: string;
  locationPrecision: string;
  headcountStatus: string;
}

interface MapEntity {
  id: string;
  type: DashboardMode;
  name: string;
  shortName: string;
  city: string;
  coordinates: [number, number];
  symbolOffset?: [number, number];
  labelShow?: boolean;
  category: string;
  level: string;
  locationLabel: string;
  positionStatus: string;
  metricValue: number | null;
  metricKind: MetricKind;
  metricApproximate?: boolean;
  metricLabel: string;
  valueStatus: string;
  batchResults: BatchResult[];
  tags: string[];
  note: string;
  recruitingUnits?: RecruitingUnit[];
}

interface RegionMetric {
  name: string;
  value: number | null;
  coverage: "演示" | "待接入" | "已接入";
  metricLabel?: string;
}

interface BatchCell {
  value: number | null;
  suppressed: boolean;
  suppressionReason: "primary_small_cell" | "complementary_protection" | string | null;
  zeroConfirmed: boolean;
  share: number | null;
}

interface SchoolItem extends MapEntity {
  schoolId: string;
  province: string;
  domesticOverseas: string;
  educationLevel: string;
  institutionCategory: string;
  schoolNature: string;
  natureStatus: string;
  natureBasis: string;
  authority: string;
  recordCount: number | null;
  batch: Record<"batch_1" | "batch_2" | "batch_3", BatchCell>;
  tierTags: string[];
  sourceIds: string[];
  sourceVariants: string[];
  aggregationStatus: string;
  mappingStatus: string;
  detailsLoaded: boolean;
}

interface SourceItem {
  source_id: string;
  title: string;
  published_at?: string;
  source_type: string;
  official_url?: string | null;
  status: string;
  status_note?: string;
}

type ExamBatchCode = "campus" | "batch_1" | "batch_2" | "batch_3";

interface ExamSession {
  label: string;
  time: string;
}

interface ExamMilestone {
  event_id: string;
  stage: string;
  date_text: string;
  precision: "date" | "date_time" | string;
  detail: string;
  sessions?: ExamSession[];
  source_ids: string[];
}

interface ElectricalReferenceMetric {
  label: string;
  value: string;
}

interface ElectricalReferenceGroup {
  label: string;
  metrics: ElectricalReferenceMetric[];
}

interface ElectricalReference {
  scope_label: string;
  status_label: string;
  groups: ElectricalReferenceGroup[];
  notes: string[];
  source_id: string;
}

interface ExamBatchDetail {
  batch_code: ExamBatchCode;
  ui_alias: string;
  official_label: string;
  tone: "early" | "first" | "second" | "third" | string;
  countdown_enabled: boolean;
  period_summary_2026: string;
  boundary_note: string;
  milestones_2026: ExamMilestone[];
  electrical_reference_2026?: ElectricalReference;
  source_ids: string[];
}

interface ProvinceItem {
  name: string;
  adcode: string;
}

interface PendingProvinceAccess {
  item: ProvinceItem;
  trigger: "click" | "zoom";
}

const provinceItems: ProvinceItem[] = [
  ["北京市", "110000"], ["天津市", "120000"], ["河北省", "130000"], ["山西省", "140000"],
  ["内蒙古自治区", "150000"], ["辽宁省", "210000"], ["吉林省", "220000"], ["黑龙江省", "230000"],
  ["上海市", "310000"], ["江苏省", "320000"], ["浙江省", "330000"], ["安徽省", "340000"],
  ["福建省", "350000"], ["江西省", "360000"], ["山东省", "370000"], ["河南省", "410000"],
  ["湖北省", "420000"], ["湖南省", "430000"], ["广东省", "440000"], ["广西壮族自治区", "450000"],
  ["海南省", "460000"], ["重庆市", "500000"], ["四川省", "510000"], ["贵州省", "520000"],
  ["云南省", "530000"], ["西藏自治区", "540000"], ["陕西省", "610000"], ["甘肃省", "620000"],
  ["青海省", "630000"], ["宁夏回族自治区", "640000"], ["新疆维吾尔自治区", "650000"],
  ["台湾省", "710000"], ["香港特别行政区", "810000"], ["澳门特别行政区", "820000"],
].map(([name, adcode]) => ({ name, adcode }));

const cityCoordinates: Record<string, [number, number]> = {
  武汉市: [114.3055, 30.5928], 黄石市: [115.0389, 30.1995], 十堰市: [110.7989, 32.6292],
  宜昌市: [111.2865, 30.6919], 襄阳市: [112.1224, 32.009], 鄂州市: [114.8949, 30.3911],
  荆门市: [112.1993, 31.0354], 孝感市: [113.9266, 30.9264], 荆州市: [112.2381, 30.3269],
  黄冈市: [114.8723, 30.4537], 咸宁市: [114.3225, 29.8413], 随州市: [113.3825, 31.6902],
  恩施土家族苗族自治州: [109.4882, 30.2722], 神农架林区: [110.6759, 31.7451],
};

const nationalRegionMetrics: RegionMetric[] = [{ name: "湖北省", value: null, coverage: "待接入" }];
const hubeiRegionMetrics: RegionMetric[] = [
  "武汉市", "黄石市", "十堰市", "宜昌市", "襄阳市", "鄂州市", "荆门市", "孝感市", "荆州市",
  "黄冈市", "咸宁市", "随州市", "恩施土家族苗族自治州", "仙桃市", "潜江市", "天门市", "神农架林区",
].map((name) => ({ name, value: null, coverage: "待接入" as const }));

const HUBEI_ENTER_ZOOM = 1.55;
const PROVINCE_EXIT_ZOOM = 0.76;
const MAP_TRANSITION_COOLDOWN = 850;
const PROVINCE_AUTH_RECHECK_MS = 60_000;

const mapLevel = ref<MapLevel>("national");
const provinceName = ref("");
const provinceAdcode = ref("");
const mapZoom = ref(1);
const mapCenter = ref<[number, number] | null>(null);
const mapAnnouncement = ref("");
const mode = ref<DashboardMode>("school");
const companyLayer = ref<"system" | "hierarchy" | "municipal" | "zhengyuan" | "service">("system");
const batchFilter = ref("all");
const searchText = ref("");
const liveMode = ref(true);
const leftOpen = ref(false);
const rightOpen = ref(false);
const route = useRoute();
const targetCohortYear = ref<number>(APPLICANT_COHORT_OPTIONS.includes(Number(route.query.targetCohortYear)) ? Number(route.query.targetCohortYear) : DEFAULT_APPLICANT_COHORT);
const referenceYear = computed(() => referenceCohortYear(targetCohortYear.value));
const quickGraduationYear = ref<number>(DEFAULT_APPLICANT_COHORT);
const quickDegree = ref<RecruitmentApplicant['degree'] | ''>('');
const quickMajor = ref<RecruitmentApplicant['majorCategory'] | ''>('');
const quickOriginalHukouProvinceAdcode = ref('');
// Intended destination province: narrows the quick filter to one place.
const quickTargetProvinceAdcode = ref('');
const quickApplicant = ref<RecruitmentInitialApplicant>({});
const quickBatch = ref<RecruitmentBatchCode | ''>('');
const globalSearch = ref('');
const searchOpen = ref(false);
const previewProvinceAdcode = ref('');
const pinnedProvinceAdcode = ref('');
const schoolPreview = ref<MapContextPreviewData | null>(null);
const schoolPreviewLoading = ref(false);
const schoolPreviewError = ref('');
let schoolPreviewTimer: number | undefined;
let schoolPreviewController: AbortController | null = null;
let schoolPreviewRequestId = 0;
let publicGridController: AbortController | null = null;
let panelStateBeforeEligibility: { left: boolean; right: boolean } | null = null;
const activeRegion = ref("");
const activeEntityId = ref("");
const activeEntity = ref<MapEntity | SchoolItem | null>(null);
const pendingEntityId = ref("");
const pendingProvinceAccess = ref<PendingProvinceAccess | null>(null);
const pendingEligibilityAccess = ref(false);
const pendingGridInformationAccess = ref(false);
const pendingAllSchoolAccess = ref(false);
const allSchoolOverview = ref<GridMapOverview | null>(null);
const allSchoolOverviewError = ref('');
const allSchoolOverviewLoading = ref(false);
let allSchoolOverviewController: AbortController | null = null;
const gridInformationContext = ref({ province: "", city: "", initialTab: "facts" as "facts" | "rankings", original: false });
const eligibilityActive = ref(false);
const eligibilityCatalog = ref<EarlyBatchCatalog | null>(null);
const eligibilityEvaluation = ref<RecruitmentEvaluation | null>(null);
const hoveredProvinceAdcode = ref("");
const selectedEligibilityProvinceAdcode = ref("");
const detailOpen = ref(false);
const dialog = ref<DialogName>("");
const activeExamBatch = ref<ExamBatchCode>("campus");
const dataLoading = ref(true);
const dataError = ref("");
const protectedDataLoading = ref(false);
const protectedDataError = ref("");
const sessionError = ref("");
const publicData = ref<any>(null);
const hubeiData = ref<any>(null);
const provinceRecruitmentData = ref<ProvinceRecruitmentProfileData | null>(null);
const provinceRecruitmentLoading = ref(false);
const provinceRecruitmentError = ref("");
const publicSchools = ref<SchoolItem[]>([]);
const protectedSchools = ref<SchoolItem[]>([]);
const publicSources = ref<SourceItem[]>([]);
const protectedSources = ref<SourceItem[]>([]);
const publicGridMap = ref<GridMapOverview | null>(null);
const publicGridLoading = ref(false);
const publicGridError = ref("");
const nationalGridMap = ref<GridMapOverview | null>(null);
const nationalGridLoading = ref(false);
const nationalGridError = ref("");
const gridMapData = ref<GridMapOverview | null>(null);
const gridMapLoading = ref(false);
const gridMapError = ref("");
const gridMapGrid = ref("");
const gridMapBatch = ref("");
const activeGridDetail = ref<GridMapDetailData | null>(null);
const activeGridDetailQuery = ref<Parameters<typeof fetchGridMapSchool>[1] | null>(null);
const activeGridDetailFilterLabel = computed(() => activeGridDetailQuery.value
  ? gridMapScopeLabel(activeGridDetailQuery.value) : gridFilterLabel.value);
const gridDetailLoading = ref(false);
const gridSourcePageSize = ref(80);
const gridCompanyPageSize = ref(80);
const gridSchoolPageSize = ref(80);
const gridCompanyLocation = ref("");
const phone = ref("");
const password = ref("");
const loginBusy = ref(false);
const loginError = ref("");
const fullScreen = ref(false);
const touchPerformanceMode = ref(
  typeof document !== "undefined"
    && document.documentElement.classList.contains("touch-performance-mode"),
);
const mapRef = ref<InstanceType<typeof CenterMap> | null>(null);
const dialogRef = ref<HTMLElement | null>(null);
const detailRef = ref<HTMLElement | null>(null);
let returnCooldownUntil = 0;
let mapAnnouncementTimer: number | undefined;
let provinceAuthTimer: number | undefined;
let restoreFocusElement: HTMLElement | null = null;
let restoreDetailFocusElement: HTMLElement | null = null;
let protectedDataPromise: Promise<void> | null = null;
let provinceRecruitmentController: AbortController | null = null;
let provinceRecruitmentRequestId = 0;
let gridMapController: AbortController | null = null;
let nationalGridController: AbortController | null = null;
let gridDetailController: AbortController | null = null;
let gridMapRequestId = 0;
let gridMapFiltersUpdating = false;

const isHubei = computed(() => mapLevel.value === "province" && provinceAdcode.value === "420000");
// The legacy Hubei dashboard is a fixed, dated archive, not a cross-year API.
const legacyArchiveAvailable = computed(() => referenceYear.value === 2026);
const protectedDataReady = computed(() => authState.authenticated && legacyArchiveAvailable.value && Boolean(hubeiData.value));
// The province panel lists每批次要求 in place, so a candidate can read 提前批 /
// 一批 / 二批 / 三批 / 南网 conditions without leaving the map.
const PROVINCE_BATCH_LABELS: Array<[string, string]> = [
  ['campus', '国网提前批'], ['batch_1', '国网第一批'], ['batch_2', '国网第二批'], ['batch_3', '国网第三批'],
  ['csg_campus', '南网提前批'], ['csg_autumn', '南网秋招'], ['csg_spring', '南网春招'], ['impc_campus', '蒙西校园招聘'],
];
const expandedRequirementBatch = ref('');
const provinceBatchRequirements = computed(() => {
  const rows = (provinceRecruitmentData.value?.units ?? []).flatMap(unit => unit.requirements ?? []);
  if (!rows.length) return [] as Array<{ code: string; label: string; rows: typeof rows }>;
  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = row.batchCode || 'unlabelled';
    const bucket = groups.get(key);
    if (bucket) bucket.push(row); else groups.set(key, [row]);
  }
  const ordered = PROVINCE_BATCH_LABELS.filter(([code]) => groups.has(code))
    .map(([code, label]) => ({ code, label, rows: groups.get(code)! }));
  for (const key of groups.keys()) {
    if (PROVINCE_BATCH_LABELS.some(([code]) => code === key)) continue;
    ordered.push({ code: key, label: key === 'unlabelled' ? '未标注批次' : key, rows: groups.get(key)! });
  }
  return ordered;
});
const toggleRequirementBatch = (code: string) => {
  expandedRequirementBatch.value = expandedRequirementBatch.value === code ? '' : code;
};

const provinceRecruitmentReady = computed(() => (
  authState.authenticated
  && provinceRecruitmentData.value?.province?.adcode === provinceAdcode.value
  && Boolean(provinceRecruitmentData.value?.units?.length)
));
const schools = computed(() => !legacyArchiveAvailable.value ? [] : protectedDataReady.value ? protectedSchools.value : publicSchools.value);
const sources = computed(() => {
  const merged = [...publicSources.value, ...(protectedDataReady.value ? protectedSources.value : [])];
  return [...new Map(merged.map((source) => [source.source_id, source])).values()];
});
const title = computed(() => {
  if (mapLevel.value === "national") return "全国电网招聘数据地图";
  const shortProvinceName = provinceName.value.replace(/省$|市$|自治区$|特别行政区$/, "");
  return `电网招聘数据地图（${shortProvinceName || "省级"}）`;
});
const mapSceneKey = computed(() => `${mapLevel.value}:${provinceAdcode.value || "national"}`);
const mapMotionKey = computed(() => `${mapSceneKey.value}:${mode.value}`);

const statusText = computed(() => {
  if (mapLevel.value === "national") {
    return authState.authenticated
      ? (eligibilityActive.value ? "全国全批次筛选 · 填写信息查看报考条件" : "全国总览 · 选择省份查看详情")
      : "全国总览公开 · 进入省级地图需账号权限";
  }
  if (gridMapLoading.value) return "正在加载学校与招聘单位…";
  if (gridMapReady.value) return `${referenceYear.value}届 · 点击学校或单位查看录用情况`;
  if (!isHubei.value) {
    if (provinceRecruitmentLoading.value) return "正在加载该省招聘要求与时间线";
    if (provinceRecruitmentReady.value) return `${referenceYear.value}届 · 查看本省报考要求与招聘时间`;
    return "请选择招聘信息查看本省条件";
  }
  if (protectedDataReady.value) return "登录明细已加载 · 点击学校或单位查看详情";
  return "公开总览 · 单校批次与单位明细登录后查看";
});

const gridTerritoryByAdcode = Object.fromEntries(provinceItems.map((province) => [
  province.adcode,
  getGridTerritory(province.adcode),
]));
const isStateGridEntryEnabled = (adcode: string) => {
  const territory = getGridTerritory(adcode);
  // A province being outside SGCC is not a reason to disable its own operator.
  return Boolean(territory && territory.operator !== "not_applicable");
};

const eligibilityLabelByDecision: Record<string, string> = {
  initial_match: "已比对基础条件匹配",
  reference_match: "参考条件匹配",
  reference_mismatch: "与参考条件不符",
  not_matched: "已比对条件不匹配",
  needs_confirmation: "查看单位与岗位条件",
  missing_input: "补充信息后继续比对",
};

const provinceInsights = computed(() => Object.fromEntries(provinceItems.map((province) => {
  const territory = gridTerritoryByAdcode[province.adcode];
  const results = eligibilityEvaluation.value?.results?.filter((result) => (
    result.provinceAdcode === province.adcode && isPositiveRecruitmentResult(result)
  )) ?? [];
  const decision = results.find((result) => result.decision === "initial_match")?.decision
    ?? results.find((result) => result.decision === "reference_match")?.decision;
  const catalogItems = (eligibilityCatalog.value?.items ?? []).filter((item) => (
    item.target.provinceAdcode === province.adcode || item.target.parentProvinceAdcode === province.adcode
  ));
  const planned = catalogItems.map((item) => item.plannedHeadcount).filter((value): value is string => Boolean(value));
  const eligibilityLabel = decision ? eligibilityLabelByDecision[decision]
    : eligibilityActive.value && eligibilityEvaluation.value ? '暂无参考匹配项'
    : eligibilityActive.value ? (territory?.operator === "csg" ? "查看南网招聘条件" : "填写信息查看招聘条件")
      : territory?.operator === "csg" ? "南方电网资料 · 登录后可查" : "登录后可查";
  return [province.adcode, {
    adcode: province.adcode,
    name: province.name,
    operatorLabel: territory?.operatorLabel || "经营区待核验",
    scopeNote: territory?.scopeNote || "经营范围待补",
    entryEnabled: isStateGridEntryEnabled(province.adcode),
    eligibilityLabel,
    eligibilityTone: decision || (isStateGridEntryEnabled(province.adcode) ? "pending" : "disabled"),
    plannedHeadcount: planned.length ? planned.join(" / ") : "待补",
    applicationCount: "待补",
    examAttendance: "待补",
    admissionCount: authState.authenticated && nationalGridMap.value ? mapCountText(nationalGridMap.value.provinceSummaries.find(item => item.adcode === province.adcode)?.recordCount, 'complete_anonymous_aggregates') : '',
    sourceYear: "2026历史参考",
    sourceStatus: !eligibilityActive.value && nationalGridMap.value ? "完整匿名公示聚合" : catalogItems[0]?.source?.status === "official_verified"
      ? "官方已核验"
      : catalogItems.length ? "上传表格·未官方核验" : "待补",
  }];
})));

const companyLayerLabel = computed(() => ({
  system: "省公司 + 地市供电公司",
  hierarchy: "省公司 + 地市供电公司",
  municipal: "14家地市供电公司",
  zhengyuan: "正源所属企业地域",
  service: "供电服务公司",
})[companyLayer.value]);

const normalizedSearch = computed(() => searchText.value.trim().toLowerCase());
const batchKey = computed<SchoolBatchKey>(() => {
  if (batchFilter.value === "第一批") return "batch_1";
  if (batchFilter.value === "第二批") return "batch_2";
  if (batchFilter.value === "第三批") return "batch_3";
  return "all";
});

const displayMetricForEntity = (entity: MapEntity | SchoolItem) => (
  entity.type === "school"
    ? resolveSchoolMetric(entity as SchoolItem, batchKey.value)
    : resolveEntityMetric(entity)
);

const mapDisplayPoint = (entity: MapEntity | SchoolItem) => {
  const display = displayMetricForEntity(entity);
  return {
    ...entity,
    metricValue: display.numericValue,
    metricLabel: display.metricLabel,
    metricText: display.text,
    valueStatus: display.valueStatus,
  };
};

const filteredSchools = computed(() => schools.value.filter((school) => {
  const keyword = normalizedSearch.value;
  const matchesSearch = !keyword || [school.name, school.city, school.province, ...school.tierTags]
    .join(" ").toLowerCase().includes(keyword);
  if (!matchesSearch) return false;
  if (!protectedDataReady.value) return true;
  return schoolMatchesBatch(school, batchKey.value);
}));

const hubeiSchools = computed(() => filteredSchools.value
  .filter((item) => item.province === "湖北省" && Boolean(cityCoordinates[item.city]))
  .sort((a, b) => compareSchoolsForBatch(a, b, batchKey.value)));

const outsideSchools = computed(() => filteredSchools.value
  .filter((item) => item.province !== "湖北省")
  .sort((a, b) => compareSchoolsForBatch(a, b, batchKey.value)));

const protectedBatches = computed<any[]>(() => hubeiData.value?.batches ?? []);
const thirdBatchSubjects = computed<any[]>(() => hubeiData.value?.company_hierarchy?.third_batch_subjects ?? []);
const zhengyuanSubject = computed(() => thirdBatchSubjects.value.find((item) => item.unit_kind === "zhengyuan_affiliate") ?? null);
const serviceSubject = computed(() => thirdBatchSubjects.value.find((item) => item.unit_kind === "power_supply_service_company") ?? null);

const zhengyuanLocationPoints = computed<MapEntity[]>(() => {
  if (!protectedDataReady.value) return [];
  const locations = hubeiData.value?.company_hierarchy?.zhengyuan_company_map?.locations ?? [];
  const subjectPlan = safeNumber(zhengyuanSubject.value?.plan_count);
  return locations.flatMap((location: any, index: number) => {
    const coordinates = cityCoordinates[location.region_name];
    if (!coordinates) return [];
    return [{
      id: `company-zhengyuan-region-${index + 1}`,
      type: "company" as const,
      name: `${location.region_name}正源所属招聘单位`,
      shortName: `${location.region_name.replace("土家族苗族自治州", "恩施").replace("神农架林区", "神农架").replace("市", "")}正源`,
      city: location.region_name,
      coordinates,
      category: "正源所属企业地域分布",
      level: "官方附件地域",
      locationLabel: `${location.region_name}级质心展示`,
      positionStatus: "附件给出单位所在地；点位不是办公地址",
      metricValue: safeNumber(location.recruiting_unit_count),
      metricKind: "unit-count",
      metricApproximate: false,
      metricLabel: "附件列出的招聘单位数",
      valueStatus: "逐单位招聘人数未单列",
      batchResults: [
        { name: "提前批", officialName: "校园招聘", value: null, state: "not-applicable", note: "不适用" },
        { name: "一批", officialName: "第一批", value: null, state: "not-applicable", note: "不适用" },
        { name: "二批", officialName: "第二批", value: null, state: "not-applicable", note: "不适用" },
        { name: "三批", officialName: "第三批", value: null, state: "unpublished", note: "该地区逐单位人数官方未单列" },
      ],
      tags: ["第三批", `${location.recruiting_unit_count}家招聘单位`, "逐单位人数未单列"],
      note: `官方附件在${location.region_name}列出 ${location.recruiting_unit_count} 家招聘单位；正源所属企业全省公告计划${subjectPlan === null ? "待补" : `约 ${subjectPlan} 人`}，不能分摊到本地区或单个单位。`,
      recruitingUnits: (location.recruiting_units ?? []).map((unit: any) => ({
        unitName: unit.unit_name,
        sectionName: unit.section_name,
        locationLabel: unit.location_label,
        locationPrecision: unit.location_precision,
        headcountStatus: "官方未单列",
      })),
    } satisfies MapEntity];
  });
});

const municipalCompanyPoints = computed<MapEntity[]>(() => {
  if (!protectedDataReady.value) return [];
  const items = hubeiData.value?.company_hierarchy?.municipal_supply_companies ?? [];
  const municipalCount = safeNumber(hubeiData.value?.company_hierarchy?.province_company?.municipal_supply_company_count);
  return items.flatMap((item: any, index: number) => {
    const city = String(item.city ?? "");
    const coordinates = cityCoordinates[city];
    if (!coordinates) return [];
    const name = String(item.display_name ?? `${city}供电公司`);
    return [{
      id: `company-city-${item.city_adcode ?? index + 1}`,
      type: "company" as const,
      name,
      shortName: name.replace("供电公司", "供电"),
      city,
      coordinates,
      category: "地市供电公司",
      level: "省公司直属单位",
      locationLabel: `${city}市级质心展示`,
      positionStatus: "官方招聘页列名；地图点位为城市质心，非办公地址",
      metricValue: null,
      metricKind: "planned-headcount",
      metricLabel: "单位招聘人数",
      valueStatus: "官方未按地市单列",
      batchResults: [
        { name: "提前批", officialName: "校园招聘", value: null, state: "unpublished", note: "未按地市单列" },
        { name: "一批", officialName: "第一批", value: null, state: "unpublished", note: "未按地市单列" },
        { name: "二批", officialName: "第二批", value: null, state: "unpublished", note: "未按地市单列" },
        { name: "三批", officialName: "第三批", value: null, state: "not-applicable", note: "招聘主体口径不同" },
      ],
      tags: ["官方列名", `${municipalCount ?? items.length}家地市供电公司`, "人数未单列"],
      note: "官方校园招聘页面列出的地市供电公司。现有公示聚合没有具体单位城市，不得把省级记录分摊到该公司。",
    } satisfies MapEntity];
  });
});

const provinceCompanyEntity = computed<MapEntity | null>(() => {
  if (!protectedDataReady.value) return null;
  const raw = hubeiData.value?.company_hierarchy?.province_company;
  if (!raw) return null;
  const batchResults = protectedBatches.value.map((batch: any) => ({
    name: batch.batch_code === "campus" ? "提前批" : batch.batch_code === "batch_1" ? "一批" : batch.batch_code === "batch_2" ? "二批" : "三批",
    officialName: batch.ui_alias ?? batch.official_batch_title ?? "批次",
    value: safeNumber(batch.plan_count),
    state: batch.batch_code === "campus" ? "not-applicable" as const : "provisional" as const,
    note: batch.batch_code === "campus" ? "已并入第一批公告计划，不重复相加" : "公告计划约数；非公示记录数",
    metricKind: "planned-headcount" as const,
    approximate: batch.batch_code !== "campus" && batch.is_approximate !== false,
  }));
  const planTotal = protectedBatches.value.reduce((sum: number, batch: any) => sum + (batch.batch_code === "campus" ? 0 : (safeNumber(batch.plan_count) ?? 0)), 0);
  return {
    id: "company-hubei-grid",
    type: "company",
    name: raw.display_name ?? "国网湖北省电力有限公司",
    shortName: "国网湖北",
    city: "武汉市",
    coordinates: cityCoordinates.武汉市,
    category: "省级招聘主体",
    level: `${safeNumber(raw.direct_unit_count) ?? "待补"}家直属单位`,
    locationLabel: "湖北省级范围点",
    positionStatus: "用于展示省级招聘主体，不代表办公地址",
    metricValue: planTotal || null,
    metricKind: "planned-headcount",
    metricApproximate: true,
    metricLabel: "三批公告计划约数合计",
    valueStatus: "提前批已并入第一批",
    batchResults,
    tags: ["省级招聘主体", "公告计划与公示记录分开", "单位人数不分摊"],
    note: "省级总体只用于解释湖北招聘主体口径；不能把全省计划或公示记录直接当作某一家地市公司的招聘人数。",
  };
});

const supplyServiceEntity = computed<MapEntity | null>(() => {
  if (!protectedDataReady.value || !serviceSubject.value) return null;
  const planCount = safeNumber(serviceSubject.value.plan_count);
  const batchThree = protectedBatches.value.find((batch: any) => batch.batch_code === "batch_3");
  const recordCount = safeNumber(batchThree?.recruiting_subjects?.find((item: any) => item.subject_raw === serviceSubject.value.display_name)?.public_notice_record_count);
  return {
    id: "company-supply-service",
    type: "company",
    name: `${serviceSubject.value.display_name}（第三批招聘主体）`,
    shortName: serviceSubject.value.display_name,
    city: "湖北省各乡镇",
    coordinates: [112.2713, 30.9875],
    category: "第三批招聘主体",
    level: "具体法人和逐市人数待补",
    locationLabel: "湖北省级质心展示，不代表实际办公地址",
    positionStatus: "官方公告只披露工作地点为各乡镇，不能分摊到具体城市",
    metricValue: planCount,
    metricKind: "planned-headcount",
    metricApproximate: serviceSubject.value.is_approximate !== false,
    metricLabel: "第三批公告计划约数",
    valueStatus: recordCount === null ? "公示记录待补" : `公示记录 ${recordCount} 条`,
    batchResults: [
      { name: "提前批", officialName: "校园招聘", value: null, state: "not-applicable", note: "不适用" },
      { name: "一批", officialName: "第一批", value: null, state: "not-applicable", note: "不适用" },
      { name: "二批", officialName: "第二批", value: null, state: "not-applicable", note: "不适用" },
      { name: "三批", officialName: "第三批", value: planCount, state: "provisional", note: "公告计划约数；官方未披露逐市人数", metricKind: "planned-headcount", approximate: serviceSubject.value.is_approximate !== false },
    ],
    tags: ["湖北官方原名", "第三批", planCount === null ? "计划待补" : `计划约${planCount}人`, "各乡镇"],
    note: "第三批公告使用原名“供电服务公司”，工作地点为各乡镇。具体法人全名与逐市人数待补，不使用其他省份名称替代。",
  };
});

const companyPoints = computed<MapEntity[]>(() => {
  if (!protectedDataReady.value) return [];
  if (companyLayer.value === "municipal") return municipalCompanyPoints.value;
  if (companyLayer.value === "zhengyuan") return zhengyuanLocationPoints.value;
  if (companyLayer.value === "service") return supplyServiceEntity.value ? [supplyServiceEntity.value] : [];
  return provinceCompanyEntity.value ? [provinceCompanyEntity.value, ...municipalCompanyPoints.value] : municipalCompanyPoints.value;
});

const gridMapReady = computed(() => authState.authenticated && mapLevel.value === "province"
  && gridMapData.value?.referenceDataAvailable !== false
  && gridMapData.value?.selection.cohortYear === referenceYear.value
  && gridMapData.value?.selection.provinceAdcode === provinceAdcode.value);
const showNationwideEntities = computed(() => mapLevel.value === "province"
  && (mode.value === "school" || !isHubei.value || companyLayer.value === "system"));
const legacyDataError = computed(() => pendingEntityId.value
  || (detailOpen.value && !activeGridDetail.value)
  || (mapLevel.value === "province" && isHubei.value && !showNationwideEntities.value)
  ? protectedDataError.value : "");
const gridMapQuery = () => ({ provinceAdcode: provinceAdcode.value, cohortYear: referenceYear.value,
  grid: gridMapGrid.value || undefined, batchCode: gridMapBatch.value || undefined });
// Switching grid must not leave a batch selected that belongs to the other
// operator — that combination always returns an empty map.
const availableBatchOptions = computed(() => gridMapBatchOptionsFor(gridMapGrid.value));
watch(gridMapGrid, grid => {
  const current = gridMapBatch.value;
  if (current && grid && gridMapBatchGrid[current] !== grid) gridMapBatch.value = '';
});
const gridFilterLabel = computed(() => gridMapScopeLabel({ grid: gridMapGrid.value, batchCode: gridMapBatch.value }));
const matchesGridSchool = (school: GridMapSchool) => !normalizedSearch.value
  || [mapSchoolName(school), school.schoolName, school.city, school.province, school.schoolTier, ...school.rawNames].join(" ").toLowerCase().includes(normalizedSearch.value);
const gridLocalSchools = computed(() => !gridMapReady.value || gridMapData.value?.rosterDataAvailable === false ? [] : (gridMapData.value?.localSchools || [])
  .filter(school => matchesGridSchool(school) && (!activeRegion.value || school.city === activeRegion.value)));
const gridSourceSchools = computed(() => !gridMapReady.value || gridMapData.value?.rosterDataAvailable === false ? [] : (gridMapData.value?.sourceSchools || [])
  .filter(matchesGridSchool));
const gridUnlocatedSchools = computed(() => [...new Map([
  ...gridSourceSchools.value.filter(school => !validMapCoordinates(school.coordinates)),
  ...(gridMapReady.value && gridMapData.value?.rosterDataAvailable !== false ? gridMapData.value?.unassignedSchools || [] : []).filter(matchesGridSchool),
].map(school => [school.campusKey, school])).values()]);
const allGridCompanies = computed(() => !gridMapReady.value ? [] : (gridMapData.value?.companies || [])
  .filter(company => !normalizedSearch.value || [company.company, company.province, company.companyGroup].join(" ").toLowerCase().includes(normalizedSearch.value)));
const gridCompanies = computed(() => allGridCompanies.value.filter(company => gridCompanyLocation.value
  ? companyLocationKey(company) === gridCompanyLocation.value : !activeRegion.value || company.companyCity === activeRegion.value
    || Boolean(company.companyCityAdcode && company.companyCityAdcode === gridCities.value.find(city => city.name === activeRegion.value)?.adcode)));
const companyRecruitmentSummary = computed(() => summarizeCompanyRecruitment(gridMapData.value?.rosterDataAvailable === false ? [] : allGridCompanies.value));
const gridUnassignedCompanies = computed(() => !gridMapReady.value ? [] : (gridMapData.value?.unassignedCompanies || [])
  .filter(company => !normalizedSearch.value || company.company.toLowerCase().includes(normalizedSearch.value)));
const clearMapRegion = () => { activeRegion.value = ""; gridCompanyLocation.value = ""; };
const selectMapRegion = (name: string) => { activeRegion.value = name; gridCompanyLocation.value = ""; };
const gridCities = computed(() => gridMapReady.value && gridMapData.value?.rosterDataAvailable !== false ? gridMapData.value?.cities || [] : []);
const gridMapSummary = computed(() => gridMapReady.value ? gridMapData.value?.provinceSummaries.find(item => item.adcode === provinceAdcode.value) : null);

const loadGridMap = async () => {
  if (!authState.authenticated || mapLevel.value !== "province") return;
  gridMapController?.abort();
  gridDetailController?.abort();
  const controller = new AbortController();
  const requestId = ++gridMapRequestId;
  gridMapController = controller;
  gridMapLoading.value = true;
  gridMapError.value = "";
  gridMapData.value = null;
  gridSourcePageSize.value = 80;
  gridCompanyPageSize.value = 80;
  gridSchoolPageSize.value = 80;
  activeGridDetail.value = null;
  detailOpen.value = false;
  try {
    const payload = await fetchGridMapOverview(gridMapQuery(), controller.signal);
    if (!controller.signal.aborted && requestId === gridMapRequestId && authState.authenticated && payload.selection.cohortYear === referenceYear.value) gridMapData.value = payload;
  } catch (error) {
    if (!controller.signal.aborted && requestId === gridMapRequestId) gridMapError.value = error instanceof Error ? error.message : "地图数据加载失败";
  } finally {
    if (requestId === gridMapRequestId) { gridMapLoading.value = false; gridMapController = null; }
  }
};
const clearGridMap = () => {
  gridMapController?.abort(); gridDetailController?.abort(); gridMapRequestId += 1;
  gridMapController = null; gridDetailController = null; gridMapData.value = null;
  activeGridDetail.value = null; gridMapLoading.value = false; gridDetailLoading.value = false; gridMapError.value = "";
  gridCompanyLocation.value = "";
};
const loadPublicGridMap = async () => {
  publicGridController?.abort();
  const controller = new AbortController();
  publicGridController = controller;
  publicGridMap.value = null;
  publicGridLoading.value = true;
  publicGridError.value = '';
  try {
    const payload = await fetchGridMapOverview({ cohortYear: referenceYear.value, grid: gridMapGrid.value || undefined, batchCode: gridMapBatch.value || undefined }, controller.signal, true);
    if (!controller.signal.aborted && publicGridController === controller && payload.selection.cohortYear === referenceYear.value) {
      publicGridMap.value = payload;
      // The public projection ships its own leaderboard; anonymous visitors
      // see it without signing in.
      const top = (payload as { topSchools?: TopSchoolRow[] }).topSchools;
      if (!authState.authenticated) nationalTopSchools.value = Array.isArray(top) ? top : [];
    }
  } catch {
    if (!controller.signal.aborted && publicGridController === controller) {
      publicGridMap.value = null;
      publicGridError.value = '全国公开统计暂时无法加载，请检查网络后重试。';
    }
  } finally {
    if (publicGridController === controller) { publicGridLoading.value = false; publicGridController = null; }
  }
};
const loadNationalGridMap = async () => {
  if (!authState.authenticated) return;
  nationalGridController?.abort();
  const controller = new AbortController();
  nationalGridController = controller;
  nationalGridMap.value = null;
  nationalGridLoading.value = true; nationalGridError.value = '';
  try {
    const payload = await fetchGridMapOverview({ cohortYear: referenceYear.value, grid: gridMapGrid.value || undefined, batchCode: gridMapBatch.value || undefined }, controller.signal);
    if (!controller.signal.aborted && nationalGridController === controller && authState.authenticated && payload.selection.cohortYear === referenceYear.value) nationalGridMap.value = payload;
  } catch (error) {
    if (!controller.signal.aborted) nationalGridError.value = error instanceof Error ? error.message : '全国统计读取失败';
  } finally {
    if (nationalGridController === controller) { nationalGridLoading.value = false; nationalGridController = null; }
  }
};
const selectGridSchool = (school: GridMapSchool) => {
  if (school.provinceAdcode === provinceAdcode.value && school.city) selectMapRegion(school.city);
  void openGridEntity('school', school.campusKey);
};
const openGridEntity = async (kind: "school" | "company", key: string, query: Parameters<typeof fetchGridMapSchool>[1] = gridMapQuery()) => {
  if (!authState.authenticated) { openDialog("login"); return; }
  gridDetailController?.abort();
  const controller = new AbortController();
  gridDetailController = controller;
  gridDetailLoading.value = true;
  sessionError.value = "";
  try {
    const detail = kind === "school" ? await fetchGridMapSchool(key, query, controller.signal)
      : await fetchGridMapCompany(key, query, controller.signal);
    if (controller.signal.aborted || !authState.authenticated) return;
    activeGridDetail.value = detail;
    activeGridDetailQuery.value = { ...query };
    const school = "school" in detail ? detail.school : null;
    const company = "company" in detail ? detail.company : null;
    await showEntity({
      id: school ? schoolMapId(school) : companyMapId(company!), type: kind,
      name: school ? mapSchoolName(school) : company!.company, shortName: "",
      city: school ? school.city || "" : company!.province || "",
      coordinates: (school?.coordinates || company?.coordinates || [0, 0]) as [number, number],
      category: school ? "学校所在地与录用去向" : "招聘去向公司", level: `${referenceYear.value}届`,
      locationLabel: school?.locationNote || "省级范围示意点", positionStatus: school?.locationNote || "非办公地址",
      metricValue: school?.recordCount ?? company?.recordCount ?? null, metricKind: "public-records",
      metricLabel: "可展示公示记录", valueStatus: "公示聚合记录", batchResults: [], tags: [], note: detail.disclaimer,
    });
  } catch (error) {
    if (!controller.signal.aborted) sessionError.value = error instanceof Error ? error.message : "实体详情加载失败";
  } finally {
    if (gridDetailController === controller) { gridDetailLoading.value = false; gridDetailController = null; }
  }
};

const mapPoints = computed<any[]>(() => {
  if (showNationwideEntities.value) {
    if (mode.value === "school") {
      const byId = new Map(gridLocalSchools.value.map(school => [schoolMapId(school), school]));
      const destinations = new Map((gridMapData.value?.sourceSchools || []).map(school => [school.campusKey, school]));
      return buildSchoolMapPoints(gridLocalSchools.value, activeRegion.value || (normalizedSearch.value ? 'search' : '')).map(point => {
        const school = byId.get(point.id);
        return { ...point, tooltipSections: school ? schoolTooltipSections(school, destinations.get(school.campusKey), provinceName.value, gridMapData.value!.selection) : [] };
      });
    }
    return buildCompanyMapPoints(allGridCompanies.value);
  }
  if (!isHubei.value) return [];
  if (mode.value === "company") return companyPoints.value.map(mapDisplayPoint);
  const cityOccurrences = new Map<string, number>();
  const offsets: Array<[number, number]> = [[0, 0], [18, -16], [-18, -16], [22, 13], [-22, 13], [0, 24], [30, -2], [-30, -2]];
  return hubeiSchools.value.map((school) => {
    const occurrence = cityOccurrences.get(school.city) ?? 0;
    cityOccurrences.set(school.city, occurrence + 1);
    return mapDisplayPoint({ ...school, symbolOffset: offsets[occurrence % offsets.length], labelShow: occurrence < 2 });
  });
});

const regionMetrics = computed<RegionMetric[]>(() => {
  if (mapLevel.value === "national") return nationalRegionMetrics;
  if (showNationwideEntities.value) return gridCities.value.map(city => ({ name: city.name,
    value: mode.value === "school" ? (gridMapData.value?.localSchools || []).filter(school => school.city === city.name).length : null,
    coverage: "已接入" as const, metricLabel: mode.value === "school" ? "本市学校" : "" }));
  if (!isHubei.value) return [];
  const counts = new Map<string, number>();
  if (mode.value === "school") {
    for (const school of hubeiSchools.value) counts.set(school.city, (counts.get(school.city) ?? 0) + 1);
  } else {
    for (const item of companyPoints.value) {
      if (cityCoordinates[item.city]) counts.set(item.city, (counts.get(item.city) ?? 0) + 1);
    }
  }
  return hubeiRegionMetrics.map((item) => ({ ...item, value: counts.get(item.name) ?? null }));
});

const listEntities = computed<(SchoolItem | MapEntity)[]>(() => {
  if (!isHubei.value) return [];
  if (mode.value === "school") return hubeiSchools.value.slice(0, 60);
  const keyword = normalizedSearch.value;
  return companyPoints.value.filter((entity) => !keyword || [entity.name, entity.city, entity.category].join(" ").toLowerCase().includes(keyword));
});

const summaryCards = computed(() => {
  if (mapLevel.value === "national") {
    return [
      { label: "可查看地区", value: String(provinceItems.filter(item => isStateGridEntryEnabled(item.adcode)).length), note: "国网与南网" },
      // The public projection now carries nationalSummary too, so an anonymous
      // visitor sees the same headline instead of a dash beside province rows
      // that already add up to most of it.
      ...(nationalOverview.value?.nationalSummary && nationalOverview.value.rosterDataAvailable !== false ? [
        { label: "全国院校", value: String(nationalOverview.value.nationalSummary.campusCount), note: "含独立统计校区" },
        ...(nationalOverview.value.nationalSummary.recordCount !== null ? [{ label: "全国录用公示", value: mapCountText(nationalOverview.value.nationalSummary.recordCount, nationalOverview.value.nationalSummary.countBasis), note: "各批次合计" }] : []),
      ] : []),
    ];
  }
  if (showNationwideEntities.value) return !gridMapReady.value ? [] : [
    ...(gridMapData.value?.rosterDataAvailable === false ? [] : [
      ...(gridMapSummary.value?.recordCount != null ? [{ label: "本省录用公示", value: mapCountText(gridMapSummary.value.recordCount, gridMapSummary.value.countBasis), note: "本省招聘单位" }] : []),
      { label: "本省学校", value: String(gridMapData.value?.localSchools?.length || 0), note: "按学校所在省份" },
    ]),
    { label: "单位目录", value: String(gridMapData.value?.companies?.length || 0), note: "点击查看招聘信息" },
  ];
  if (!isHubei.value) {
    const summary = provinceRecruitmentData.value?.summary ?? {};
    return [
      { label: "招聘单位", value: provinceRecruitmentReady.value ? formatSummaryValue(summary.unitCount) : provinceRecruitmentLoading.value ? "加载中" : "未加载", note: provinceAdcode.value === "150000" ? "仅蒙东" : provinceName.value },
      { label: "招聘安排", value: provinceRecruitmentReady.value ? formatSummaryValue(summary.eventCount) : "—", note: "报名与考试时间" },
    ].filter(card => card.value !== '待补');
  }
  const counts = ['batch_1', 'batch_2', 'batch_3'].map(code => safeNumber(publicBatchItems.value.find((item: any) => item.batch_code === code)?.public_notice_record_count));
  const totalRecords = counts.every((value): value is number => value !== null) ? counts.reduce((sum, value) => sum + value, 0) : null;
  return [
    ...(totalRecords === null ? [] : [{ label: "录用公示", value: formatSummaryValue(totalRecords), note: "各批次合计" }]),
    ...(legacyArchiveAvailable.value ? [{ label: "可查看学校", value: formatSummaryValue(publicSchools.value.length), note: "点击查看详情" }] : []),
    { label: "详细查询", value: protectedDataReady.value ? "已开通" : "登录后", note: "批次 / 学校 / 单位" },
  ];
});

const publicBatchItems = computed<any[]>(() => legacyArchiveAvailable.value ? publicData.value?.hubei?.batch_summary?.items ?? [] : []);
const currentBatchItems = computed<any[]>(() => protectedDataReady.value ? protectedBatches.value : publicBatchItems.value);
const batchTone = (code: string) => code === "campus" ? "early" : code === "batch_2" ? "second" : code === "batch_3" ? "third" : "first";
const batchName = (item: any) => item.batch_code === "campus" ? "提前批" : item.batch_code === "batch_1" ? "第一批" : item.batch_code === "batch_2" ? "第二批" : "第三批";
const overallBatchSummary = computed(() => currentBatchItems.value.map((item: any) => ({
  batch: batchName(item),
  plan: item.batch_code === "campus" ? "并入一批" : formatApproximate(item.plan_count, item.is_approximate),
  records: formatRecordCount(item.public_notice_record_count),
  tone: batchTone(item.batch_code),
  note: item.batch_code === "campus" ? "名额已包含在第一批内" : "全省汇总",
})));

const subjectBatchSummary = (kind: "zhengyuan_affiliate" | "power_supply_service_company") => {
  const subject = thirdBatchSubjects.value.find((item) => item.unit_kind === kind);
  if (!subject) return [];
  const batchThree = protectedBatches.value.find((item: any) => item.batch_code === "batch_3");
  const needle = kind === "zhengyuan_affiliate" ? "正源" : "供电服务";
  const publicRecordCount = safeNumber(batchThree?.recruiting_subjects?.find((item: any) => String(item.subject_raw ?? "").includes(needle))?.public_notice_record_count);
  return [{
    batch: kind === "zhengyuan_affiliate" ? "第三批·正源" : "第三批·供服",
    plan: formatApproximate(subject.plan_count, subject.is_approximate),
    records: formatRecordCount(publicRecordCount),
    tone: "third",
    note: "该招聘主体的全省汇总",
  }];
};

const visibleBatchSummary = computed(() => {
  if (mode.value === "school" || ["system", "hierarchy"].includes(companyLayer.value)) return overallBatchSummary.value;
  if (!protectedDataReady.value) return [];
  if (companyLayer.value === "zhengyuan") return subjectBatchSummary("zhengyuan_affiliate");
  if (companyLayer.value === "service") return subjectBatchSummary("power_supply_service_company");
  return [];
});

const batchContextLabel = computed(() => {
  if (mode.value === "school") return "湖北全省总体批次";
  if (["system", "hierarchy"].includes(companyLayer.value)) return "湖北全省总体（省公司 + 招聘主体）";
  if (companyLayer.value === "municipal") return "地市供电公司口径";
  if (companyLayer.value === "zhengyuan") return "正源所属企业全省口径";
  return "供电服务公司全省口径";
});

const examBatchFallbacks: ExamBatchDetail[] = [
  { batch_code: "campus", ui_alias: "提前批", official_label: "湖北校园招聘", tone: "early", countdown_enabled: false, period_summary_2026: "2026届实际节点", boundary_note: "具体安排以该批次已归档公告为准。", milestones_2026: [], source_ids: [] },
  { batch_code: "batch_1", ui_alias: "第一批", official_label: "第一批招聘", tone: "first", countdown_enabled: false, period_summary_2026: "2026届实际节点", boundary_note: "具体安排以该批次已归档公告为准。", milestones_2026: [], source_ids: [] },
  { batch_code: "batch_2", ui_alias: "第二批", official_label: "第二批招聘", tone: "second", countdown_enabled: false, period_summary_2026: "2026届实际节点", boundary_note: "具体安排以该批次已归档公告为准。", milestones_2026: [], source_ids: [] },
  { batch_code: "batch_3", ui_alias: "第三批", official_label: "第三批招聘", tone: "third", countdown_enabled: false, period_summary_2026: "2026届实际节点", boundary_note: "具体安排以该批次已归档公告为准。", milestones_2026: [], source_ids: [] },
];

const examBatchItems = computed<ExamBatchDetail[]>(() => {
  if (!legacyArchiveAvailable.value) return [];
  const rawItems = publicData.value?.hubei?.recruitment_timeline?.items;
  if (!Array.isArray(rawItems) || !rawItems.length) return examBatchFallbacks;
  return examBatchFallbacks.map((fallback) => {
    const item = rawItems.find((candidate: any) => candidate?.batch_code === fallback.batch_code);
    return item ? { ...fallback, ...item } as ExamBatchDetail : fallback;
  });
});

const countdowns = computed(() => examBatchItems.value.map((item) => ({
  code: item.batch_code,
  batch: item.ui_alias,
  title: `2026届${item.official_label}`,
  date: "查看时间",
  state: "已归档",
})));

const activeExamBatchDetail = computed(() => examBatchItems.value.find((item) => item.batch_code === activeExamBatch.value)
  ?? examBatchItems.value[0]);

const activeExamSources = computed<SourceItem[]>(() => {
  const sourceIds = [
    ...(activeExamBatchDetail.value?.source_ids ?? []),
    activeExamBatchDetail.value?.electrical_reference_2026?.source_id,
  ].filter((sourceId): sourceId is string => Boolean(sourceId));
  return sourceIds.map((sourceId) => sources.value.find((source) => source.source_id === sourceId))
    .filter((source): source is SourceItem => Boolean(source));
});

const companyPlanText = (value: unknown) => {
  const count = safeNumber(value);
  return count === null ? "计划待补" : `计划约${count.toLocaleString("zh-CN")}人`;
};

const companyStructure = computed(() => {
  if (!protectedDataReady.value) return [];
  const province = hubeiData.value?.company_hierarchy?.province_company ?? {};
  return [
    { name: province.display_name ?? "省公司", meta: "省级招聘主体", value: `${safeNumber(province.direct_unit_count) ?? "待补"}家直属单位` },
    { name: "地市供电公司", meta: "官方逐家列名", value: `${safeNumber(province.municipal_supply_company_count) ?? "待补"}家` },
    { name: "县级供电企业", meta: "官方披露总数", value: `${safeNumber(province.county_supply_enterprise_count) ?? "待补"}家` },
    { name: zhengyuanSubject.value?.display_name ?? "正源所属企业", meta: "第三批招聘主体", value: companyPlanText(zhengyuanSubject.value?.plan_count) },
    { name: serviceSubject.value?.display_name ?? "供电服务公司", meta: "第三批招聘主体 · 各乡镇", value: companyPlanText(serviceSubject.value?.plan_count) },
  ];
});

const directUnits = computed<string[]>(() => protectedDataReady.value
  ? (hubeiData.value?.company_hierarchy?.selected_direct_units ?? []).map((item: any) => String(item.display_name)).filter(Boolean)
  : []);

const zhengyuanCoverage = computed(() => ({
  regions: safeNumber(zhengyuanSubject.value?.covered_prefecture_level_region_count),
  units: safeNumber(zhengyuanSubject.value?.attachment_recruiting_unit_count),
}));

const totalPublicRecordCount = computed(() => publicBatchItems.value.reduce((sum: number, item: any) => sum + (safeNumber(item.public_notice_record_count) ?? 0), 0));

const entityListDisplay = (entity: MapEntity | SchoolItem) => displayMetricForEntity(entity);

const activeSchoolMetric = computed(() => !activeGridDetail.value && activeEntity.value?.type === "school"
  ? resolveSchoolMetric(activeEntity.value as SchoolItem, batchKey.value)
  : null);

const entitySubtitle = (entity: MapEntity | SchoolItem) => entity.type === "school" && !(entity as SchoolItem).detailsLoaded
  ? `${entity.city} · 公开总览`
  : `${entity.city} · ${entity.level}`;

const safeNumber = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;
const formatSummaryValue = (value: unknown) => {
  const number = safeNumber(value);
  return number === null ? "待补" : number.toLocaleString("zh-CN");
};
const formatApproximate = (value: unknown, approximate = true) => {
  const number = safeNumber(value);
  return number === null ? "待补" : `${approximate ? "约 " : ""}${number.toLocaleString("zh-CN")}`;
};
const formatRecordCount = (value: unknown) => {
  const number = safeNumber(value);
  return number === null ? "未单列" : number.toLocaleString("zh-CN");
};
const batchCell = (raw: any, share: unknown): BatchCell => ({
  value: safeNumber(raw?.record_count ?? raw),
  suppressed: Boolean(raw?.suppressed ?? raw?.privacy_suppressed),
  suppressionReason: raw?.suppression_reason ?? null,
  zeroConfirmed: Boolean(raw?.zero_confirmed),
  share: safeNumber(share),
});

const suppressionLabel = (cell: BatchCell) => batchSuppressionLabel(cell);

const tierLabels = (raw: any) => {
  const labels: string[] = [];
  const tags = raw?.tags ?? {};
  const is985 = tags.is_985 ?? tags.legacy_985;
  const is211 = tags.is_211 ?? tags.legacy_211;
  const isDoubleFirstClass = tags.is_double_first_class ?? tags.double_first_class;
  if (is985 === true) labels.push("原985");
  if (is211 === true) labels.push("原211");
  if (isDoubleFirstClass === true) labels.push("第二轮双一流");
  if (is985 === false && is211 === false) labels.push("非原985/211");
  if (isDoubleFirstClass === false) labels.push("第二轮双一流名单未列");
  if (Array.isArray(tags.industry_history)) labels.push(...tags.industry_history);
  else if (typeof tags.industry_history === "string" && tags.industry_history) labels.push(tags.industry_history);
  return [...new Set(labels)];
};

const makeSchool = (raw: any, index: number): SchoolItem => {
  const name = raw.display_name ?? raw.standard_name ?? raw.school_name ?? `学校${index + 1}`;
  const city = raw.city ?? raw.school_city ?? "城市待补";
  const province = raw.province ?? (cityCoordinates[city] ? "湖北省" : "地域待补");
  const total = safeNumber(raw.record_count);
  const coordinates = cityCoordinates[city] ?? [0, 0];
  const b1 = batchCell(raw.batch_counts?.batch_1 ?? raw.batch_counts?.第一批, raw.batch_share?.batch_1);
  const b2 = batchCell(raw.batch_counts?.batch_2 ?? raw.batch_counts?.第二批, raw.batch_share?.batch_2);
  const b3 = batchCell(raw.batch_counts?.batch_3 ?? raw.batch_counts?.第三批, raw.batch_share?.batch_3);
  const tierTags = tierLabels(raw);
  const institutionLabels: Record<string, string> = {
    ordinary_higher_education_institution: "普通高等学校",
    research_institute: "科研培养单位",
    overseas_institution: "境外高校",
    overseas_higher_education_institution: "境外高校",
  };
  const institutionCategory = institutionLabels[raw.institution_category] ?? "机构类型待补";
  const schoolNature = raw.school_nature ?? "学校性质待补";
  const sourceVariants = Array.isArray(raw.source_variants)
    ? raw.source_variants.map((item: any) => typeof item === "string" ? item : item?.source_label).filter(Boolean)
    : [name];
  return {
    id: raw.school_id ?? raw.school_code ?? `school-v3-${index + 1}`,
    schoolId: raw.school_id ?? raw.school_code ?? `school-v3-${index + 1}`,
    type: "school",
    name,
    shortName: name.replace("职业技术学院", "职院").replace("职业学院", "职院"),
    city,
    province,
    coordinates,
    category: schoolNature,
    level: raw.education_level ?? "办学层次待补",
    educationLevel: raw.education_level ?? "待补",
    institutionCategory,
    schoolNature,
    natureStatus: raw.nature_status ?? "pending",
    natureBasis: raw.nature_basis ?? "学校性质来源待补。",
    authority: raw.supervising_authority ?? "主管部门待补",
    domesticOverseas: raw.domestic_overseas === "mainland" ? "中国内地" : raw.domestic_overseas === "overseas" ? "境外" : (raw.domestic_overseas ?? (province === "湖北省" ? "中国内地" : "省外/境外")),
    locationLabel: province === "湖北省" ? `${city}市级质心` : `${province} · ${city}`,
    positionStatus: province === "湖北省" ? "学校所在地映射；点位为城市质心，非精确校址" : "外省/境外学校在右侧表格展示",
    metricValue: total,
    metricKind: "public-records",
    metricApproximate: false,
    metricLabel: "2026届湖北公示记录",
    valueStatus: "统计复核完成；官方逐源映射待补",
    recordCount: total,
    batch: { batch_1: b1, batch_2: b2, batch_3: b3 },
    batchResults: [
      { name: "提前批", officialName: "校园招聘（并入一批计划）", value: null, state: "not-applicable", note: "学校维度未单列" },
      { name: "一批", officialName: "第一批", value: b1.value, state: b1.suppressed ? "suppressed" : (b1.value !== null || b1.zeroConfirmed) ? "provisional" : "unverified", note: b1.suppressed ? suppressionLabel(b1) : (b1.value !== null || b1.zeroConfirmed) ? "公示记录数" : "该批次未单列", metricKind: "public-records", approximate: false },
      { name: "二批", officialName: "第二批", value: b2.value, state: b2.suppressed ? "suppressed" : (b2.value !== null || b2.zeroConfirmed) ? "provisional" : "unverified", note: b2.suppressed ? suppressionLabel(b2) : (b2.value !== null || b2.zeroConfirmed) ? "公示记录数" : "该批次未单列", metricKind: "public-records", approximate: false },
      { name: "三批", officialName: "第三批", value: b3.value, state: b3.suppressed ? "suppressed" : (b3.value !== null || b3.zeroConfirmed) ? "provisional" : "unverified", note: b3.suppressed ? suppressionLabel(b3) : (b3.value !== null || b3.zeroConfirmed) ? "公示记录数" : "该批次未单列", metricKind: "public-records", approximate: false },
    ],
    tierTags,
    tags: tierTags,
    sourceIds: raw.source_ids ?? ["public-selection-aggregate-2026", "moe-national-colleges-2026"],
    sourceVariants: sourceVariants.length ? sourceVariants : [name],
    aggregationStatus: raw.status?.aggregation_status ?? "verified",
    mappingStatus: raw.status?.official_source_mapping_status ?? "pending",
    detailsLoaded: true,
    note: `${name}的办学地点与层次优先使用教育部高校主数据；批次值是进入湖北招聘主体的脱敏公示记录统计，不是报名人数、录取率或最终到岗人数。`,
  };
};

const emptyBatchCell = (): BatchCell => ({
  value: null,
  suppressed: false,
  suppressionReason: null,
  zeroConfirmed: false,
  share: null,
});

const makePublicSchool = (raw: any, index: number): SchoolItem => {
  const name = String(raw.display_name ?? `学校${index + 1}`);
  const city = String(raw.city ?? "城市待补");
  const province = String(raw.province ?? "地域待补");
  const total = safeNumber(raw.record_count);
  const coordinates = cityCoordinates[city] ?? [0, 0];
  return {
    id: String(raw.school_id ?? `public-school-${index + 1}`),
    schoolId: String(raw.school_id ?? `public-school-${index + 1}`),
    type: "school",
    name,
    shortName: name.replace("职业技术学院", "职院").replace("职业学院", "职院"),
    city,
    province,
    coordinates,
    category: "登录后查看",
    level: "登录后查看",
    educationLevel: "登录后查看",
    institutionCategory: "登录后查看",
    schoolNature: "登录后查看",
    natureStatus: "protected",
    natureBasis: "登录后查看学校性质口径。",
    authority: "登录后查看",
    domesticOverseas: "登录后查看",
    locationLabel: `${province} · ${city}`,
    positionStatus: raw.location_precision === "city" ? "公开摘要仅到城市级；点位不是精确校址" : "公开摘要位置精度待补",
    metricValue: total,
    metricKind: "public-records",
    metricApproximate: false,
    metricLabel: "2026届湖北公示记录",
    valueStatus: "公开学校总览；批次明细登录后查看",
    recordCount: total,
    batch: { batch_1: emptyBatchCell(), batch_2: emptyBatchCell(), batch_3: emptyBatchCell() },
    batchResults: [],
    tierTags: [],
    tags: [],
    sourceIds: [],
    sourceVariants: [],
    aggregationStatus: "public_summary",
    mappingStatus: "protected",
    detailsLoaded: false,
    note: "公开页仅展示学校名称、真实地域与总公示记录；逐校批次、标签、主管部门和来源变体登录后加载。",
  };
};

const readApiError = async (response: Response, fallback: string) => {
  try {
    const payload = await response.json();
    return typeof payload?.error === "string" ? payload.error : fallback;
  } catch {
    return fallback;
  }
};

const apiBaseUrl = String(import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
const apiUrl = (path: string) => `${apiBaseUrl}${path}`;

const loadPublicData = async () => {
  dataLoading.value = true;
  dataError.value = "";
  try {
    // The public dashboard already ships max-age=60, stale-while-revalidate=300;
    // forcing no-store here discarded that on every load and remount.
    const response = await fetch(apiUrl("/api/v2/public/dashboard"), {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`公开总览加载失败（${response.status}）`);
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("json")) throw new Error("公开总览返回格式无效");
    const responsePayload = await response.json();
    const payload = responsePayload?.payload ?? responsePayload;
    publicData.value = payload;
    publicSources.value = Array.isArray(payload?.source_catalog) ? payload.source_catalog : [];
    const rawSchools = payload?.hubei?.school_summary?.items;
    publicSchools.value = Array.isArray(rawSchools) ? rawSchools.map(makePublicSchool) : [];
  } catch (error) {
    publicData.value = null;
    publicSchools.value = [];
    publicSources.value = [];
    dataError.value = error instanceof Error ? error.message : "公开总览加载失败";
  } finally {
    dataLoading.value = false;
  }
};

const loadProtectedData = async (force = false) => {
  if (!authState.authenticated) throw new Error("请先登录后查看详细数据。");
  if (!legacyArchiveAvailable.value) return;
  if (protectedDataReady.value && !force) return;
  if (protectedDataPromise && !force) return protectedDataPromise;
  protectedDataPromise = (async () => {
    protectedDataLoading.value = true;
    protectedDataError.value = "";
    try {
      const response = await fetch(apiUrl("/api/v2/private/provinces/420000/dashboard"), {
        credentials: "include",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (response.status === 401) {
        await bootstrapAuth().catch(() => undefined);
        throw new Error("登录状态已失效，请重新登录。");
      }
      if (!response.ok) throw new Error(await readApiError(response, "详细数据加载失败，请稍后重试。"));
      const responsePayload = await response.json();
      const payload = responsePayload?.payload ?? responsePayload;
      if (!Array.isArray(payload?.schools) || !payload?.company_hierarchy) throw new Error("详细数据格式无效，请联系管理员更新数据。");
      if (!legacyArchiveAvailable.value || !authState.authenticated) return;
      hubeiData.value = payload;
      protectedSchools.value = payload.schools.map(makeSchool);
      protectedSources.value = Array.isArray(payload.source_catalog) ? payload.source_catalog : [];
      sessionError.value = "";
    } catch (error) {
      protectedDataError.value = error instanceof Error ? error.message : "详细数据加载失败，请稍后重试。";
      throw error;
    } finally {
      protectedDataLoading.value = false;
      protectedDataPromise = null;
    }
  })();
  return protectedDataPromise;
};

const loadProvinceRecruitmentData = async (adcode = provinceAdcode.value, force = false) => {
  if (!authState.authenticated) throw new Error("请先登录后查看省级招聘资料。");
  if (!adcode) return;
  if (provinceRecruitmentData.value?.province?.adcode === adcode && !force) return;

  provinceRecruitmentController?.abort();
  const controller = new AbortController();
  const requestId = ++provinceRecruitmentRequestId;
  provinceRecruitmentController = controller;
  provinceRecruitmentLoading.value = true;
  provinceRecruitmentError.value = "";
  try {
    const payload = await fetchProvinceRecruitmentProfile(adcode, referenceYear.value, controller.signal);
    if (requestId !== provinceRecruitmentRequestId) return;
    provinceRecruitmentData.value = payload;
    sessionError.value = "";
  } catch (error) {
    if (controller.signal.aborted || requestId !== provinceRecruitmentRequestId) return;
    provinceRecruitmentData.value = null;
    provinceRecruitmentError.value = error instanceof Error ? error.message : "省级招聘资料加载失败，请稍后重试。";
    throw error;
  } finally {
    if (requestId === provinceRecruitmentRequestId) {
      provinceRecruitmentLoading.value = false;
      provinceRecruitmentController = null;
    }
  }
};

const clearProvinceRecruitmentData = () => {
  provinceRecruitmentController?.abort();
  provinceRecruitmentController = null;
  provinceRecruitmentRequestId += 1;
  provinceRecruitmentData.value = null;
  provinceRecruitmentLoading.value = false;
  provinceRecruitmentError.value = "";
};

const clearProtectedData = () => {
  hubeiData.value = null;
  protectedSchools.value = [];
  protectedSources.value = [];
  protectedDataError.value = "";
  pendingEntityId.value = "";
  activeEntityId.value = "";
  activeEntity.value = null;
  detailOpen.value = false;
  companyLayer.value = "system";
  batchFilter.value = "all";
};

const showMapAnnouncement = (message: string) => {
  mapAnnouncement.value = message;
  if (mapAnnouncementTimer !== undefined) window.clearTimeout(mapAnnouncementTimer);
  mapAnnouncementTimer = window.setTimeout(() => {
    mapAnnouncement.value = "";
    mapAnnouncementTimer = undefined;
  }, 3200);
};

const resolveProvinceItem = (payload: string | { name?: string; adcode?: string }) => {
  const name = typeof payload === "string" ? payload : payload?.name ?? "";
  const adcode = typeof payload === "object" ? payload.adcode : "";
  return provinceItems.find((province) => province.name === name || province.adcode === adcode) ?? null;
};

const commitProvinceEntry = (
  item: ProvinceItem,
  trigger: "click" | "zoom",
) => {
  pendingProvinceAccess.value = null;
  dialog.value = "";
  loginError.value = "";
  returnCooldownUntil = Date.now() + MAP_TRANSITION_COOLDOWN;
  gridMapFiltersUpdating = true;
  gridMapGrid.value = "";
  gridMapBatch.value = "";
  gridMapFiltersUpdating = false;
  mapLevel.value = "province";
  // Every new province starts with the requested school view and readable panels.
  mode.value = "school";
  leftOpen.value = true;
  rightOpen.value = true;
  provinceName.value = item.name;
  provinceAdcode.value = item.adcode;
  mapZoom.value = 1.04;
  mapCenter.value = null;
  activeEntity.value = null;
  activeEntityId.value = "";
  activeRegion.value = "";
  clearGridMap();
  void loadGridMap();
  if (item.adcode === "420000" && !protectedDataReady.value) void loadProtectedData().catch(() => undefined);
  if (getGridTerritory(item.adcode)?.canEnterStateGridMap) {
    void loadProvinceRecruitmentData(item.adcode, true).catch(() => undefined);
  } else clearProvinceRecruitmentData();
  showMapAnnouncement(trigger === "zoom" && item.adcode === "420000"
    ? "权限已验证，自动进入湖北地级市地图"
    : `权限已验证，已进入${item.name}地图`);
};

const enterProvince = async (
  payload: string | { name?: string; adcode?: string },
  trigger: "click" | "zoom" = "click",
) => {
  const item = resolveProvinceItem(payload);
  if (!item) return;
  const territory = gridTerritoryByAdcode[item.adcode];
  if (!isStateGridEntryEnabled(item.adcode)) {
    hoveredProvinceAdcode.value = item.adcode;
    showMapAnnouncement(territory?.scopeNote || `${item.name}不在本国网报考地图的可进入范围内`);
    return;
  }
  sessionError.value = "";
  await bootstrapAuth().catch(() => undefined);
  if (!authState.authenticated) {
    pendingProvinceAccess.value = { item, trigger };
    showMapAnnouncement(`进入${item.name}需要已开通的账号权限`);
    openDialog("login");
    return;
  }
  if (eligibilityActive.value && mapLevel.value === "national") {
    selectedEligibilityProvinceAdcode.value = item.adcode;
    hoveredProvinceAdcode.value = item.adcode;
    showMapAnnouncement(`已选择${item.name}，右侧显示该地区的各批次招聘条件`);
    return;
  }
  commitProvinceEntry(item, trigger);
};

const returnNational = async (trigger: "button" | "zoom" = "button") => {
  if (mapLevel.value === "national") return;
  returnCooldownUntil = Date.now() + MAP_TRANSITION_COOLDOWN;
  mapLevel.value = "national";
  // Entering a province opens both panels; the national view is meant to lead
  // with the map, so collapse them again on the way back.
  leftOpen.value = false;
  rightOpen.value = false;
  gridMapFiltersUpdating = true;
  gridMapGrid.value = ''; gridMapBatch.value = '';
  gridMapFiltersUpdating = false;
  if (authState.authenticated) void loadNationalGridMap(); else void loadPublicGridMap();
  provinceName.value = "";
  provinceAdcode.value = "";
  clearProvinceRecruitmentData();
  clearGridMap();
  mapZoom.value = 1;
  mapCenter.value = null;
  activeEntity.value = null;
  activeEntityId.value = "";
  activeRegion.value = "";
  showMapAnnouncement(trigger === "zoom" ? "已缩小返回全国总览" : "已返回全国总览");
  await nextTick();
  mapRef.value?.resetView?.();
};

const handleGeoRoam = (payload: GeoRoamPayload) => {
  if (Date.now() <= returnCooldownUntil) return;
  if (
    mapLevel.value === "national"
    && payload.direction === "in"
    && payload.zoom >= HUBEI_ENTER_ZOOM
    && payload.focusRegion === "湖北省"
  ) {
    void enterProvince({ name: "湖北省", adcode: "420000" }, "zoom");
    return;
  }
  if (
    mapLevel.value === "province"
    && payload.direction === "out"
    && payload.zoom <= PROVINCE_EXIT_ZOOM
  ) void returnNational("zoom");
};

const resetMapView = async () => {
  mapZoom.value = mapLevel.value === "national" ? 1 : 1.04;
  mapCenter.value = null;
  await nextTick();
  mapRef.value?.resetView?.();
};

const closeDetail = () => {
  gridDetailController?.abort();
  activeGridDetail.value = null;
  detailOpen.value = false;
  activeEntity.value = null;
  void nextTick(() => restoreDetailFocusElement?.focus());
};

const setMode = (nextMode: DashboardMode) => {
  if (detailOpen.value) closeDetail();
  eligibilityActive.value = false;
  mode.value = nextMode;
  activeEntityId.value = "";
};

const focusDialog = async () => {
  await nextTick();
  const first = dialogRef.value?.querySelector<HTMLElement>("[data-autofocus], input, button, a[href], [tabindex]:not([tabindex='-1'])");
  first?.focus();
};

const openDialog = (name: DialogName) => {
  restoreFocusElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  dialog.value = name;
  focusDialog();
};

const loadAllSchoolOverview = async () => {
  allSchoolOverviewController?.abort();
  allSchoolOverview.value = null;
  allSchoolOverviewError.value = '';
  const current = nationalOverview.value;
  if (current && current.selection.cohortYear === referenceYear.value && !current.selection.grid
    && !current.selection.batchCode && !current.selection.provinceAdcode) {
    allSchoolOverview.value = current;
    allSchoolOverviewLoading.value = false;
    return;
  }
  const controller = new AbortController();
  allSchoolOverviewController = controller;
  allSchoolOverviewLoading.value = true;
  const sourceYear = referenceYear.value;
  try {
    const data = await fetchGridMapOverview({ cohortYear: sourceYear }, controller.signal);
    if (!controller.signal.aborted && authState.authenticated && referenceYear.value === sourceYear
      && dialog.value === 'allSchoolData') allSchoolOverview.value = data;
  } catch {
    if (!controller.signal.aborted) allSchoolOverviewError.value = '全国合计暂时无法加载';
  } finally {
    if (allSchoolOverviewController === controller) { allSchoolOverviewLoading.value = false; allSchoolOverviewController = null; }
  }
};
const openAllSchoolData = async () => {
  await ensureAuthReady();
  if (!authState.authenticated) { pendingAllSchoolAccess.value = true; openDialog('login'); return; }
  openDialog('allSchoolData');
  void loadAllSchoolOverview();
};
const handleAllSchoolUnauthorized = () => {
  allSchoolOverviewController?.abort(); allSchoolOverview.value = null;
  pendingAllSchoolAccess.value = true;
  openDialog('login');
};
const openAllSchoolDetail = async (campusKey: string) => {
  closeDialog();
  await nextTick();
  await openGridEntity('school', campusKey, { cohortYear: referenceYear.value });
};
const openRelatedGridEntity = (kind: 'school' | 'company', key: string) =>
  openGridEntity(kind, key, activeGridDetailQuery.value || gridMapQuery());

const openExamBatch = (batchCode?: ExamBatchCode) => {
  if (!legacyArchiveAvailable.value) { void openGridInformation('', 'facts', true); return; }
  if (batchCode) activeExamBatch.value = batchCode;
  openDialog("calendar");
};

const openProvinceRecruitmentProfile = () => {
  if (!provinceAdcode.value) return;
  openDialog("provinceProfile");
  void loadProvinceRecruitmentData(provinceAdcode.value).catch(() => undefined);
};

const retryProvinceRecruitmentProfile = () => {
  if (!provinceAdcode.value) return;
  void loadProvinceRecruitmentData(provinceAdcode.value, true).catch(() => undefined);
};

const openGridInformation = async (city = "", initialTab: "facts" | "rankings" = "facts", original = false) => {
  navigateInformationPage({
    province: initialTab === "rankings" || original ? "" : provinceName.value,
    city: initialTab === "rankings" || original ? "" : city,
    tab: initialTab === "rankings" ? "schools" : original ? "batches" : "regions",
    targetCohortYear: targetCohortYear.value,
  });
};

const handleGridInformationUnauthorized = () => {
  pendingGridInformationAccess.value = true;
  openDialog("login");
};

const closeDialog = () => {
  if (dialog.value === 'allSchoolData') { allSchoolOverviewController?.abort(); allSchoolOverview.value = null; }
  const cancelledProvinceAccess = dialog.value === "login" && Boolean(pendingProvinceAccess.value);
  if (dialog.value === "login") {
    pendingEntityId.value = "";
    pendingProvinceAccess.value = null;
    pendingEligibilityAccess.value = false;
    pendingGridInformationAccess.value = false;
    pendingAllSchoolAccess.value = false;
  }
  dialog.value = "";
  loginError.value = "";
  if (cancelledProvinceAccess) void resetMapView();
  nextTick(() => restoreFocusElement?.focus());
};

const ensureAuthReady = async () => {
  if (authState.ready) return;
  await bootstrapAuth().catch(() => undefined);
};

const loginDialogTitle = computed(() => {
  if (pendingAllSchoolAccess.value) return '登录后查看全部学校数据';
  if (pendingGridInformationAccess.value) return "登录后查询电网信息与全国院校榜";
  if (pendingProvinceAccess.value) return `登录后进入${pendingProvinceAccess.value.item.name}地图`;
  if (pendingEligibilityAccess.value) return "登录后查询提前批资格参考";
  return "登录后查看学校与单位详情";
});

const loginDialogDescription = computed(() => {
  if (pendingAllSchoolAccess.value) return '查看各校国网一、二、三批与南网春秋招的脱敏公示汇总。';
  if (pendingGridInformationAccess.value) return "需使用已开通手机号登录。政策、历史分数与待遇按来源原文参考；院校榜仅展示脱敏公示汇总，不含个人名单。";
  if (pendingProvinceAccess.value) {
    return `全国地图和公开总览可直接查看；进入国网或南网省级地图需使用已开通账号。登录成功后将自动进入${pendingProvinceAccess.value.item.name}。`;
  }
  if (pendingEligibilityAccess.value) {
    return `登录成功后返回报考条件查询。${targetCohortYear.value}届报考参考${referenceYear.value}届资料，不代替当届资格审查。`;
  }
  return "全国地图和公开总览可直接查看；进入国网或南网省级地图、查看详细批次、学校标签与单位信息需由老师开通账号权限。";
});

const loginSubmitLabel = computed(() => {
  if (loginBusy.value) return "正在验证…";
  if (pendingGridInformationAccess.value) return "登录并打开电网资料库";
  if (pendingProvinceAccess.value) return `登录并进入${pendingProvinceAccess.value.item.name}`;
  if (pendingEligibilityAccess.value) return "登录并开始资格查询";
  return authState.authenticated ? "重新加载明细" : "登录并查看详情";
});

const activateEligibility = () => {
  if (!eligibilityActive.value) {
    panelStateBeforeEligibility = { left: leftOpen.value, right: rightOpen.value };
  }
  eligibilityActive.value = true;
  leftOpen.value = true;
  rightOpen.value = true;
};

const closeEligibility = () => {
  eligibilityActive.value = false;
  eligibilityCatalog.value = null;
  eligibilityEvaluation.value = null;
  hoveredProvinceAdcode.value = "";
  selectedEligibilityProvinceAdcode.value = "";
  if (panelStateBeforeEligibility) {
    leftOpen.value = panelStateBeforeEligibility.left;
    rightOpen.value = panelStateBeforeEligibility.right;
    panelStateBeforeEligibility = null;
  }
};

const openEligibility = async () => {
  sessionError.value = "";
  pendingProvinceAccess.value = null;
  pendingEntityId.value = "";
  if (eligibilityActive.value) {
    closeEligibility();
    return;
  }
  await ensureAuthReady();
  if (!authState.authenticated) {
    pendingEligibilityAccess.value = true;
    openDialog("login");
    return;
  }
  pendingEligibilityAccess.value = false;
  activateEligibility();
  if (mapLevel.value !== "national") await returnNational("button");
};

// Hover only raises the province on the map. The context card is opened by a
// click, so moving the pointer across the map no longer swaps its contents.
const handleProvincePreview = (payload: { adcode?: string; name?: string } | string) => {
  const item = resolveProvinceItem(payload);
  hoveredProvinceAdcode.value = item?.adcode ?? "";
};

const clearProvincePreview = () => {
  if (!selectedEligibilityProvinceAdcode.value) hoveredProvinceAdcode.value = "";
};

// School rankings are an authenticated tier: the public projection only
// carries province totals, so these stay behind canOpenDetails.
const cardRanking = ref<MapPreviewRanking | null>(null);
type TopSchoolRow = { rank: number | null; campusKey: string; schoolName: string; campusName?: string | null;
  recordCount: number | null; gridCounts: { sgcc: number | null; csg: number | null } };
const nationalTopSchools = ref<TopSchoolRow[]>([]);
const nationalTopSchoolsLoading = ref(false);
const nationalTopSchoolsError = ref('');
let nationalTopSchoolsToken = 0;
const clearNationalTopSchools = () => {
  nationalTopSchoolsToken += 1; nationalTopSchools.value = [];
  nationalTopSchoolsLoading.value = false; nationalTopSchoolsError.value = '';
};
let cardRankingToken = 0;
const cardSchoolDetail = ref<MapPreviewSchoolDetail | null>(null);
let cardSchoolToken = 0;
const clearCardRanking = () => {
  cardRankingToken += 1; cardRanking.value = null;
  cardSchoolToken += 1; cardSchoolDetail.value = null;
};
const requestCardRanking = async (request: MapPreviewRankingRequest) => {
  if (!authState.authenticated) return;
  const item = resolveProvinceItem({ adcode: activeContextPreview.value?.provinceAdcode || provinceAdcode.value });
  if (!item) return;
  const token = ++cardRankingToken;
  const sourceYear = referenceYear.value;
  const scope = request.scope ?? 'destination';
  const title = scope === 'school_location' ? `${item.name}高校 · 全国电网录用排名` : `全国高校 · 进入${item.name}电网排名`;
  const state = { title, scope, batchCode: request.batchCode };
  cardSchoolToken += 1; cardSchoolDetail.value = null;
  cardRanking.value = { ...state, rows: [], loading: true, error: '' };
  try {
    const result = await fetchTopSchoolRankings(provinceSchoolRankingQuery(item, scope, sourceYear, request.batchCode));
    if (token !== cardRankingToken || !authState.authenticated || sourceYear !== referenceYear.value) return;
    cardRanking.value = { ...state, rows: result.items, total: result.total, loading: false, error: '' };
  } catch (error) {
    if (token !== cardRankingToken || !authState.authenticated || sourceYear !== referenceYear.value) return;
    cardRanking.value = { ...state, rows: [], loading: false, error: error instanceof Error ? error.message : '学校排名加载失败，请重试。' };
  }
};
// Keep both pages of the Top 200 bound to one authenticated request/cohort.
const loadNationalTopSchools = async () => {
  if (!authState.authenticated) return;
  const token = ++nationalTopSchoolsToken;
  const sourceYear = referenceYear.value;
  nationalTopSchools.value = []; nationalTopSchoolsLoading.value = true; nationalTopSchoolsError.value = '';
  try {
    const result = await fetchTopSchoolRankings({ view: 'campus', cohortYear: sourceYear });
    if (token !== nationalTopSchoolsToken || !authState.authenticated || sourceYear !== referenceYear.value) return;
    nationalTopSchools.value = result.items.map(row => ({ rank: row.rank, campusKey: row.schoolKey,
      schoolName: row.schoolName, campusName: row.campusName ?? null, recordCount: row.recordCount, gridCounts: row.gridCounts }));
  } catch {
    if (token === nationalTopSchoolsToken && authState.authenticated && sourceYear === referenceYear.value)
      nationalTopSchoolsError.value = '学校排名暂时未加载，请重试。';
  } finally {
    if (token === nationalTopSchoolsToken) nationalTopSchoolsLoading.value = false;
  }
};

// A batch-filtered row counts just that batch; detail keeps the same geographic
// direction while removing the batch filter to show all five batches.
const requestCardSchoolDetail = async (row: GridRankingRow) => {
  const item = resolveProvinceItem({ adcode: activeContextPreview.value?.provinceAdcode || provinceAdcode.value });
  if (!item || !authState.authenticated) return;
  const token = ++cardSchoolToken;
  const sourceYear = referenceYear.value;
  const scope = cardRanking.value?.scope ?? 'destination';
  cardSchoolDetail.value = { schoolKey: row.schoolKey, recordCount: null, batchCounts: {}, gridCounts: {}, loading: true, error: '' };
  try {
    const result = await fetchGridRankings({ ...provinceSchoolRankingQuery(item, scope, sourceYear), q: row.schoolName, pageSize: 100 });
    if (token !== cardSchoolToken || !authState.authenticated || sourceYear !== referenceYear.value) return;
    const full = result.items.find(candidate => candidate.schoolKey === row.schoolKey);
    cardSchoolDetail.value = full
      ? { schoolKey: row.schoolKey, recordCount: full.recordCount, batchCounts: full.batchCounts, gridCounts: full.gridCounts, loading: false, error: '' }
      : { schoolKey: row.schoolKey, recordCount: null, batchCounts: {}, gridCounts: {}, loading: false, error: '未取到该校完整统计，请重试。' };
  } catch (error) {
    if (token !== cardSchoolToken || !authState.authenticated || sourceYear !== referenceYear.value) return;
    cardSchoolDetail.value = { schoolKey: row.schoolKey, recordCount: null, batchCounts: {}, gridCounts: {}, loading: false,
      error: error instanceof Error ? error.message : '该校完整统计加载失败，请重试。' };
  }
};

// The card shows per-batch conditions in place, so it borrows the same
// province recruitment profile the left panel uses.
const cardConditions = ref<MapPreviewConditions | null>(null);
let cardConditionsToken = 0;
const clearCardConditions = () => { cardConditionsToken += 1; cardConditions.value = null; };
const requestCardConditions = async () => {
  const item = resolveProvinceItem({ adcode: activeContextPreview.value?.provinceAdcode || provinceAdcode.value });
  if (!item) return;
  if (!authState.authenticated) { openProtectedAccess(); return; }
  const token = ++cardConditionsToken;
  const title = `${item.name} · 各批次条件`;
  cardConditions.value = { title, groups: [], loading: true, error: '' };
  try {
    await loadProvinceRecruitmentData(item.adcode, true);
    if (token !== cardConditionsToken) return;
    const groups = provinceBatchRequirements.value.map(group => ({
      code: group.code, label: group.label,
      rows: group.rows.map(row => ({ title: row.title || row.category || '报考要求', excerpt: row.excerpt, applicability: row.applicability })),
    }));
    cardConditions.value = { title, groups, loading: false, error: '' };
  } catch (error) {
    if (token !== cardConditionsToken) return;
    cardConditions.value = { title, groups: [], loading: false, error: error instanceof Error ? error.message : '各批次条件加载失败，请重试。' };
  }
};

// A single map click pins the province so its context card survives the
// pointer leaving the shape; entering the province takes a double click.
const selectMapProvince = (payload: { adcode?: string; name?: string }) => {
  const item = resolveProvinceItem(payload);
  if (!item || eligibilityActive.value) return;
  cancelSchoolPreview();
  schoolPreview.value = null;
  previewProvinceAdcode.value = item.adcode;
  pinnedProvinceAdcode.value = item.adcode;
  hoveredProvinceAdcode.value = item.adcode;
  rightOpen.value = false;
};

const handleUnavailableProvince = (name: string) => {
  const territory = getGridTerritory(name);
  showMapAnnouncement(territory?.scopeNote || `${name}当前不在国家电网省级招聘地图的可进入范围内`);
};

const handleEligibilityUnauthorized = () => {
  pendingEligibilityAccess.value = true;
  sessionError.value = "登录状态已失效，请重新登录后继续资格查询。";
  openDialog("login");
};

const findProtectedEntity = (id: string) => [...protectedSchools.value, ...companyPoints.value]
  .find((item) => item.id === id) ?? null;

const showEntity = async (entity: MapEntity | SchoolItem, trigger?: HTMLElement | null) => {
  restoreDetailFocusElement = trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
  activeEntity.value = entity;
  activeEntityId.value = entity.id;
  detailOpen.value = true;
  await nextTick();
  detailRef.value?.focus();
};

const openProtectedAccess = async () => {
  sessionError.value = "";
  await ensureAuthReady();
  if (!authState.authenticated) {
    openDialog("login");
    return;
  }
  try {
    if (mapLevel.value === "national") await loadNationalGridMap();
    else if (showNationwideEntities.value) await loadGridMap();
    else await loadProtectedData();
  } catch (error) {
    sessionError.value = error instanceof Error ? error.message : "详细数据加载失败，请稍后重试。";
  }
};

const openEntity = async (entityOrId: string | MapEntity | SchoolItem) => {
  const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const id = typeof entityOrId === "string" ? entityOrId : entityOrId.id;
  if (!id) return;
  if (id.startsWith("grid-city:")) { selectMapRegion(id.slice("grid-city:".length)); return; }
  if (id.startsWith("grid-company-location:")) {
    gridCompanyLocation.value = id.slice("grid-company-location:".length);
    const cityKey = gridCompanyLocation.value.startsWith("city:") ? gridCompanyLocation.value.slice(5) : "";
    activeRegion.value = cityKey ? gridCities.value.find(city => city.adcode === cityKey)?.name || cityKey : "";
    gridCompanyPageSize.value = 80;
    activeEntityId.value = id;
    return;
  }
  if (id.startsWith("grid-school:")) { await openGridEntity("school", id.slice("grid-school:".length)); return; }
  if (id.startsWith("grid-company:")) { await openGridEntity("company", id.slice("grid-company:".length)); return; }
  activeGridDetail.value = null;
  activeEntityId.value = id;
  pendingEntityId.value = id;
  sessionError.value = "";
  await ensureAuthReady();
  if (!authState.authenticated) {
    openDialog("login");
    return;
  }
  try {
    await loadProtectedData();
    const entity = findProtectedEntity(id);
    if (!entity) throw new Error("该学校或单位的详细数据暂未接入。");
    pendingEntityId.value = "";
    await showEntity(entity, trigger);
  } catch (error) {
    sessionError.value = error instanceof Error ? error.message : "详细数据加载失败，请稍后重试。";
  }
};

const submitLogin = async () => {
  loginBusy.value = true;
  loginError.value = "";
  try {
    if (!authState.authenticated) await login(phone.value, password.value);
    if (pendingAllSchoolAccess.value) {
      pendingAllSchoolAccess.value = false;
      openDialog('allSchoolData');
      void loadAllSchoolOverview();
      return;
    }
    if (pendingGridInformationAccess.value) {
      pendingGridInformationAccess.value = false;
      openDialog("gridInformation");
      return;
    }
    if (pendingEligibilityAccess.value) {
      pendingEligibilityAccess.value = false;
      pendingProvinceAccess.value = null;
      pendingEntityId.value = "";
      dialog.value = "";
      activateEligibility();
      return;
    }
    const requestedProvince = pendingProvinceAccess.value;
    if (requestedProvince) {
      dialog.value = "";
      pendingProvinceAccess.value = null;
      pendingEntityId.value = "";
      commitProvinceEntry(requestedProvince.item, requestedProvince.trigger);
      return;
    }
    const requestedId = pendingEntityId.value;
    // The legacy Hubei dashboard is needed only to resolve a legacy entity.
    // Its availability must not determine whether a national-map login succeeds.
    if (requestedId) await loadProtectedData(true);
    const requestedEntity = requestedId ? findProtectedEntity(requestedId) : null;
    if (requestedId && !requestedEntity) throw new Error("登录成功，但该实体详细数据暂未接入。");
    dialog.value = "";
    pendingEntityId.value = "";
    if (requestedEntity) {
      await showEntity(requestedEntity, restoreFocusElement);
    } else {
      // The auth watcher normally starts this refresh. An already authenticated
      // retry still needs it; overview errors remain in the statistics panel.
      if (!nationalGridLoading.value) void loadNationalGridMap();
      await nextTick();
      restoreFocusElement?.focus();
    }
  } catch (error) {
    loginError.value = error instanceof Error ? error.message : "登录失败，请检查手机号是否已开通";
  } finally {
    loginBusy.value = false;
  }
};

const handleLogout = async () => {
  sessionError.value = "";
  try {
    await logout();
  } catch (error) {
    sessionError.value = error instanceof Error ? error.message : "退出失败，请稍后重试。";
  } finally {
    // Clear unconditionally: a failed logout must never leave protected data
    // rendered on a screen the presenter is sharing.
    clearProtectedData();
    clearProvinceRecruitmentData();
    clearGridMap();
  }
};

const openSourcesFromDetail = () => {
  closeDetail();
  void nextTick(() => openDialog("sources"));
};

const formatCell = (cell: BatchCell | undefined) => {
  if (!cell) return "未单列";
  if (cell.suppressed) return suppressionLabel(cell);
  if (cell.value === null && !cell.zeroConfirmed) return "未单列";
  return `${cell.value ?? 0}条`;
};

const companyBatchDisplay = (batch: BatchResult) => resolveBatchResultMetric(batch).text;

const formatShare = (cell: BatchCell | undefined) => {
  if (!cell || cell.suppressed || cell.share === null) return "—";
  const percentage = cell.share <= 1 ? cell.share * 100 : cell.share;
  return `${percentage.toFixed(1)}%`;
};

const fullscreenDocument = (): Document => {
  try {
    if (window.parent !== window && window.parent.document.documentElement.classList.contains("touch-desktop-host")) {
      return window.parent.document;
    }
  } catch { /* An unrelated cross-origin embedding cannot control its parent. */ }
  return document;
};

const toggleFullScreen = async () => {
  const target = fullscreenDocument();
  try {
    if (!target.fullscreenElement) {
      if (!target.documentElement.requestFullscreen) {
        showMapAnnouncement("当前浏览器不支持全屏，可横屏查看完整地图");
        return;
      }
      await target.documentElement.requestFullscreen();
    } else await target.exitFullscreen();
  } catch {
    showMapAnnouncement("未能进入全屏，可横屏查看完整地图");
  } finally {
    fullScreen.value = Boolean(target.fullscreenElement);
  }
};

const handleFullscreenChange = () => {
  fullScreen.value = Boolean(fullscreenDocument().fullscreenElement);
};

const trapFocus = (event: KeyboardEvent) => {
  if (event.defaultPrevented) return;
  const root = dialog.value ? dialogRef.value : detailRef.value;
  // A nested information sheet owns its own keyboard boundary.
  const nearestDialog = event.target instanceof Element ? event.target.closest('[role="dialog"], [role="alertdialog"]') : null;
  if (nearestDialog && nearestDialog !== root) return;
  if (event.key === "Escape") {
    if (dialog.value) closeDialog();
    else if (detailOpen.value) closeDetail();
    return;
  }
  if (event.key !== "Tab" || (!dialog.value && !detailOpen.value)) return;
  const focusable = [...(root?.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex='-1'])") ?? [])]
    .filter(item => item.getClientRects().length && !item.closest('[inert]'));
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (!root?.contains(document.activeElement)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
    return;
  }
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
};

const handleResize = () => {
  if (mapLevel.value === 'national' && window.innerWidth < 1024) {
    leftOpen.value = false;
    rightOpen.value = false;
  }
};

const stopProvinceAuthHeartbeat = () => {
  if (provinceAuthTimer === undefined) return;
  window.clearInterval(provinceAuthTimer);
  provinceAuthTimer = undefined;
};

const verifyActiveProvinceSession = async () => {
  if (mapLevel.value !== "province") return;
  await bootstrapAuth().catch(() => undefined);
};

const syncProvinceAuthHeartbeat = (level: MapLevel) => {
  stopProvinceAuthHeartbeat();
  if (level !== "province") return;
  provinceAuthTimer = window.setInterval(() => {
    void verifyActiveProvinceSession();
  }, PROVINCE_AUTH_RECHECK_MS);
};

const handleVisibilityChange = () => {
  if (document.visibilityState === "visible") void verifyActiveProvinceSession();
};
const refreshInformationSession = () => { void bootstrapAuth().catch(() => undefined); };

// Planning reads the latest reviewed complete archive before its target cohort.
// A source-year change clears all prior-source results; applicant graduation is independent.
// The applicant's own graduation year stays independent from both.
const nationalOverview = computed(() => authState.authenticated ? nationalGridMap.value : publicGridMap.value);
const allSchoolTotals = computed<SchoolDataTotals | undefined>(() => {
  const overview = allSchoolOverview.value;
  if (!overview || overview.rosterDataAvailable === false || !authState.authenticated) return undefined;
  const batchCounts = Object.fromEntries(schoolDataBatchColumns.map(({ key }) => [key,
    overview.exactCards?.find(card => card.batchCode === key)?.publicNotice.value ?? null])) as SchoolDataTotals['batchCounts'];
  const sum = (keys: Array<keyof SchoolDataTotals['batchCounts']>) => keys.every(key => batchCounts[key] !== null)
    ? keys.reduce((total, key) => total + (batchCounts[key] as number), 0) : null;
  return { recordCount: overview.nationalSummary?.recordCount ?? null, batchCounts,
    gridCounts: { sgcc: sum(['batch_1', 'batch_2', 'batch_3']), csg: sum(['csg_autumn', 'csg_spring']) } };
});
// The API has always sent a `disclaimer` describing how these counts are built;
// nothing rendered it, so anonymous visitors saw exact figures with no caveat.
const activeDisclaimer = computed(() => (mapLevel.value === 'province' ? gridMapData.value : nationalOverview.value)?.disclaimer ?? null);
const previewOverview = computed(() => mapLevel.value === 'province' ? gridMapData.value : nationalOverview.value);
const missingReferenceYear = computed(() => previewOverview.value?.referenceDataAvailable === false ? referenceYear.value : null);
const missingRosterYear = computed(() => previewOverview.value?.rosterDataAvailable === false ? referenceYear.value : null);
const nationalPreview = computed(() => {
  const overview = nationalOverview.value;
  const batchCounts = Object.fromEntries((overview?.rosterDataAvailable === false ? [] : overview?.exactCards || []).map(card => [card.batchCode, card.publicNotice.value]));
  return buildNationalPreview({ recordCount: overview?.rosterDataAvailable === false ? null : overview?.nationalSummary?.recordCount ?? null, batchCounts,
    countBasis: overview?.privacy.countBasis || 'released_cells_only',
    selection: overview?.selection || { cohortYear: referenceYear.value, provinceAdcode: null, grid: gridMapGrid.value || null, batchCode: gridMapBatch.value || null },
    targetCohortYear: targetCohortYear.value });
});
const activeContextPreview = computed(() => {
  if (schoolPreview.value) return { ...schoolPreview.value, targetCohortYear: targetCohortYear.value };
  const overview = previewOverview.value;
  const adcode = mapLevel.value === 'province' ? provinceAdcode.value : previewProvinceAdcode.value;
  const province = overview?.provinceSummaries.find(row => row.adcode === adcode);
  return province && overview ? buildProvincePreview(province, overview.selection, targetCohortYear.value) : nationalPreview.value;
});
const contextLoading = computed(() => schoolPreview.value ? schoolPreviewLoading.value
  : mapLevel.value === 'province' ? gridMapLoading.value
    : authState.authenticated ? nationalGridLoading.value : publicGridLoading.value);
// Display only scope-specific, fixed wording. Unexpected network/JSON errors
// can contain internal URLs or technical details that do not belong in cards.
const contextError = computed(() => {
  if (schoolPreview.value) return schoolPreviewError.value ? '学校录用去向暂时无法加载，请重试。' : '';
  if (mapLevel.value === 'province') return gridMapError.value ? '本省地图数据暂时无法加载，请重试。' : '';
  if (authState.authenticated) return nationalGridError.value ? '全国录用统计暂时无法加载，请重试。' : '';
  return publicGridError.value ? '全国公开统计暂时无法加载，请检查网络后重试。' : '';
});
const retryContextPreview = () => {
  if (contextLoading.value) return;
  if (schoolPreview.value) {
    const school = gridLocalSchools.value.find(item => item.campusKey === schoolPreview.value?.campusKey);
    if (school) { handleSchoolPreview(schoolMapId(school)); return; }
    cancelSchoolPreview(); schoolPreview.value = null;
  }
  if (mapLevel.value === 'province') void loadGridMap();
  else if (authState.authenticated) void loadNationalGridMap();
  else void loadPublicGridMap();
};
const nationalGridTotals = computed(() => {
  if (nationalOverview.value?.rosterDataAvailable === false) return [];
  const cards = nationalOverview.value?.exactCards || [];
  return (['sgcc', 'csg'] as const).flatMap(grid => {
    const subset = cards.filter(card => card.grid === grid);
    return subset.length && subset.every(card => card.publicNotice.value !== null)
      ? [{ label: grid === 'sgcc' ? '国网' : '南网', value: subset.reduce((total, card) => total + card.publicNotice.value!, 0) }] : [];
  });
});
const searchProvinces = computed(() => provinceItems.filter(item => !globalSearch.value.trim()
  || item.name.includes(globalSearch.value.trim())).slice(0, 34));
const searchSchools = computed(() => {
  if (!globalSearch.value.trim() || !authState.authenticated) return [];
  const overview = previewOverview.value;
  if (overview?.rosterDataAvailable === false) return [];
  const list = [...(overview?.localSchools || []), ...(overview?.sourceSchools || [])];
  return [...new Map(list.map(school => [school.campusKey, school])).values()]
    .filter(school => mapSchoolName(school).includes(globalSearch.value.trim())).slice(0, 8);
});
const chooseSearchProvince = (item: ProvinceItem) => {
  searchOpen.value = false; globalSearch.value = '';
  cancelSchoolPreview(); schoolPreview.value = null;
  previewProvinceAdcode.value = item.adcode; pinnedProvinceAdcode.value = item.adcode;
};
const chooseSearchSchool = (school: GridMapSchool) => {
  searchOpen.value = false; void openGridEntity('school', school.campusKey);
};
const changeProvinceSelection = (event: Event) => {
  const adcode = (event.target as HTMLSelectElement).value;
  if (!adcode) void returnNational(); else void enterProvince({ adcode });
};
const cancelSchoolPreview = () => {
  if (schoolPreviewTimer !== undefined) window.clearTimeout(schoolPreviewTimer);
  schoolPreviewTimer = undefined;
  schoolPreviewController?.abort(); schoolPreviewController = null;
  schoolPreviewRequestId += 1; schoolPreviewLoading.value = false; schoolPreviewError.value = '';
};
const handleSchoolPreview = (id: string) => {
  if (eligibilityActive.value || mode.value !== 'school' || !gridMapReady.value) return;
  const school = gridLocalSchools.value.find(item => schoolMapId(item) === id);
  if (!school) return;
  cancelSchoolPreview();
  schoolPreview.value = buildSchoolPreview(school, gridMapData.value!.selection, targetCohortYear.value,
    { adcode: provinceAdcode.value, name: provinceName.value });
  const requestId = schoolPreviewRequestId;
  // Only a stable hover requests one school's all-batch, dual-grid summary.
  // No whole authenticated overview is fetched or cached on pointer movement.
  schoolPreviewTimer = window.setTimeout(async () => {
    const controller = new AbortController(); schoolPreviewController = controller;
    schoolPreviewLoading.value = true;
    try {
      const detail = await fetchGridMapSchool(school.campusKey, { cohortYear: referenceYear.value, provinceAdcode: provinceAdcode.value }, controller.signal);
      if (controller.signal.aborted || requestId !== schoolPreviewRequestId || !authState.authenticated) return;
      if (detail.recruitmentSummary) schoolPreview.value = buildSchoolRecruitmentPreview(detail.school, detail.recruitmentSummary, targetCohortYear.value);
    } catch (error) {
      if (!controller.signal.aborted && requestId === schoolPreviewRequestId) schoolPreviewError.value = error instanceof Error ? error.message : '学校去向暂时无法读取';
    } finally {
      if (requestId === schoolPreviewRequestId) { schoolPreviewLoading.value = false; schoolPreviewController = null; }
    }
  }, 180);
};
const closeContextPreview = () => {
  clearCardRanking(); clearCardConditions(); cardSchoolToken += 1; cardSchoolDetail.value = null;
  cancelSchoolPreview(); schoolPreview.value = null; previewProvinceAdcode.value = ''; hoveredProvinceAdcode.value = ''; pinnedProvinceAdcode.value = '';
};
const startQuickEligibility = async () => {
  quickBatch.value = '';
  quickApplicant.value = { ...(quickDegree.value ? { degree: quickDegree.value } : {}),
    ...(quickMajor.value ? { majorCategory: quickMajor.value } : {}),
    originalHukouProvinceAdcode: quickOriginalHukouProvinceAdcode.value || null,
    graduationYear: quickGraduationYear.value };
  await openEligibility();
  if (quickTargetProvinceAdcode.value) selectedEligibilityProvinceAdcode.value = quickTargetProvinceAdcode.value;
};
const openPreviewEligibility = async (request: { provinceAdcode: string | null; batchCode?: 'campus' | 'csg_campus' }) => {
  await startQuickEligibility();
  selectedEligibilityProvinceAdcode.value = request.provinceAdcode || '';
  quickBatch.value = request.batchCode || '';
};
const handleGlassEscape = (event: KeyboardEvent) => {
  if (event.key !== 'Escape' || dialog.value || detailOpen.value || eligibilityActive.value) return;
  searchOpen.value = false; closeContextPreview(); leftOpen.value = false; rightOpen.value = false;
};

watch([mapLevel, provinceAdcode, mode, gridMapGrid, gridMapBatch], closeContextPreview);
watch(() => route.query.targetCohortYear, value => {
  const year = Number(value);
  targetCohortYear.value = APPLICANT_COHORT_OPTIONS.includes(year) ? year : DEFAULT_APPLICANT_COHORT;
});
watch(referenceYear, () => {
  clearNationalTopSchools();
  allSchoolOverviewController?.abort(); allSchoolOverview.value = null;
  if (dialog.value === 'allSchoolData') void loadAllSchoolOverview();
  closeContextPreview();
  publicGridController?.abort(); publicGridMap.value = null; publicGridLoading.value = false; publicGridError.value = '';
  nationalGridController?.abort(); nationalGridMap.value = null; nationalGridLoading.value = false; nationalGridError.value = '';
  clearGridMap(); clearProtectedData(); clearProvinceRecruitmentData();
  activeGridDetail.value = null; detailOpen.value = false;
  if (dialog.value === 'calendar' || dialog.value === 'provinceProfile') closeDialog();
  eligibilityEvaluation.value = null;
  if (authState.authenticated) {
    void loadNationalTopSchools();
    void loadNationalGridMap();
    if (mapLevel.value === 'province') {
      void loadGridMap();
      void loadProvinceRecruitmentData().catch(() => undefined);
      if (isHubei.value && legacyArchiveAvailable.value) void loadProtectedData().catch(() => undefined);
    }
  } else void loadPublicGridMap();
}, { flush: 'sync' });

watch(mode, () => { batchFilter.value = "all"; searchText.value = ""; gridCompanyLocation.value = ""; });
watch([gridMapGrid, gridMapBatch], () => {
  if (gridMapFiltersUpdating) return;
  // Changing the grid and clearing the batch it invalidates are two separate
  // reactive writes, and this watcher is sync while the clearing one is pre — so
  // it runs once on the intermediate pair. Requesting that pair is a guaranteed
  // 400, so wait for the clear instead of firing a doomed request per switch.
  const batch = gridMapBatch.value;
  if (batch && gridMapGrid.value && gridMapBatchGrid[batch] !== gridMapGrid.value) return;
  if (mapLevel.value === 'province') void loadGridMap();
  else if (authState.authenticated) void loadNationalGridMap();
  else void loadPublicGridMap();
}, { flush: "sync" });
watch([searchText, activeRegion], () => { gridSourcePageSize.value = 80; gridCompanyPageSize.value = 80; gridSchoolPageSize.value = 80; });
watch(searchText, () => { if (showNationwideEntities.value && mode.value === 'school') clearMapRegion(); });
watch(mapLevel, syncProvinceAuthHeartbeat);
watch(() => authState.authenticated, (authenticated) => {
  if (authenticated) { void loadNationalGridMap(); void loadNationalTopSchools(); return; }
  clearNationalTopSchools();
  allSchoolOverviewController?.abort(); allSchoolOverview.value = null;
  if (dialog.value === 'allSchoolData') handleAllSchoolUnauthorized();
  clearCardRanking();
  closeContextPreview();
  nationalGridController?.abort(); nationalGridMap.value = null; nationalGridLoading.value = false; nationalGridError.value = '';
  clearGridMap();
  if (hubeiData.value) clearProtectedData();
  if (provinceRecruitmentData.value || provinceRecruitmentLoading.value) clearProvinceRecruitmentData();
  pendingProvinceAccess.value = null;
  if (eligibilityActive.value) closeEligibility();
  pendingEligibilityAccess.value = false;
  if (dialog.value === "gridInformation") {
    pendingGridInformationAccess.value = true;
    openDialog("login");
  }
  if (mapLevel.value === "province") {
    void returnNational("button").then(() => showMapAnnouncement("登录已失效，省级地图需重新登录"));
  } else {
    // The authenticated filters may differ from the pre-login public snapshot.
    void loadPublicGridMap();
  }
});

onMounted(async () => {
  // The national view opens on Hubei so the context card is never empty.
  previewProvinceAdcode.value = '420000';
  pinnedProvinceAdcode.value = '420000';
  if (authState.authenticated) void loadNationalTopSchools();
  window.addEventListener('keydown', handleGlassEscape);
  window.addEventListener("resize", handleResize);
  window.addEventListener("keydown", trapFocus);
  document.addEventListener("fullscreenchange", handleFullscreenChange);
  window.addEventListener("map-host-fullscreenchange", handleFullscreenChange);
  window.addEventListener("grid-information-auth-refresh", refreshInformationSession);
  document.addEventListener("visibilitychange", handleVisibilityChange);
  handleResize();
  await Promise.allSettled([loadPublicData(), loadPublicGridMap(), bootstrapAuth()]);
  if (authState.authenticated && !nationalGridMap.value && !nationalGridLoading.value) void loadNationalGridMap();
});

onBeforeUnmount(() => {
  clearNationalTopSchools(); closeContextPreview();
  allSchoolOverviewController?.abort();
  window.removeEventListener('keydown', handleGlassEscape);
  cancelSchoolPreview(); publicGridController?.abort();
  window.removeEventListener("grid-information-auth-refresh", refreshInformationSession);
  window.removeEventListener("resize", handleResize);
  window.removeEventListener("keydown", trapFocus);
  document.removeEventListener("fullscreenchange", handleFullscreenChange);
  window.removeEventListener("map-host-fullscreenchange", handleFullscreenChange);
  document.removeEventListener("visibilitychange", handleVisibilityChange);
  stopProvinceAuthHeartbeat();
  provinceRecruitmentController?.abort();
  gridMapController?.abort();
  nationalGridController?.abort();
  gridDetailController?.abort();
  if (mapAnnouncementTimer !== undefined) window.clearTimeout(mapAnnouncementTimer);
});
</script>

<template>
  <div
    class="dashboard-shell glass-map"
    :class="{
      'live-mode': liveMode,
      'left-panel-open': leftOpen,
      'touch-performance-mode': touchPerformanceMode,
      'eligibility-view': eligibilityActive,
      'province-view': mapLevel === 'province',
    }"
    data-page="recruitment-map-v3"
  >
    <section class="map-layer" aria-label="全国电网招聘数据地图交互区域">
      <Transition name="map-stage" mode="out-in">
        <div :key="mapSceneKey" class="map-scene">
          <CenterMap
            ref="mapRef"
            :level="mapLevel"
            :province-name="provinceName"
            :province-adcode="provinceAdcode"
            :mode="mode"
            :points="mapPoints"
            :region-metrics="regionMetrics"
            :active-entity-id="activeEntityId"
            :active-region="activeRegion"
            :zoom="mapZoom"
            :center="mapCenter"
            :province-insights="provinceInsights"
            :eligibility-mode="eligibilityActive"
            :active-province-adcode="hoveredProvinceAdcode"
            :selected-province-adcode="pinnedProvinceAdcode"
            context-preview
            @province-click="enterProvince"
            @province-select="selectMapProvince"
            @region-preview="handleProvincePreview"
            @region-preview-end="clearProvincePreview"
            @entity-preview="handleSchoolPreview"
            @entity-preview-end="cancelSchoolPreview"
            @unavailable-province="handleUnavailableProvince"
            @select-entity="openEntity"
            @select-region="selectMapRegion"
            @georoam="handleGeoRoam"
          />
        </div>
      </Transition>
    </section>

    <header class="top-shell">
      <div class="brand-block">
        <DataLine class="brand-icon" aria-hidden="true" />
        <span class="brand-copy">
          <strong>电网招聘数据查询台</strong>
          <small>统计来源：国网、南网招聘公示汇总</small>
        </span>
      </div>

      <nav class="glass-navigation" aria-label="主要查询入口">
        <button :class="{ active: !eligibilityActive }" :aria-pressed="!eligibilityActive" @click="closeEligibility">
          <Location aria-hidden="true" /><span>招聘地图</span>
        </button>
        <button @click="openGridInformation('', 'rankings')"><School aria-hidden="true" /><span>院校去向</span></button>
        <button :class="{ active: eligibilityActive }" :aria-pressed="eligibilityActive" @click="openEligibility">
          <Guide aria-hidden="true" /><span>报考条件</span>
        </button>
      </nav>

      <div class="top-actions" role="toolbar" aria-label="资料查询与账户操作（窄屏可横向滑动）">
        <label class="applicant-cohort"><select v-model.number="targetCohortYear" aria-label="报考届别"><option v-for="year in APPLICANT_COHORT_OPTIONS" :key="year" :value="year">{{ year }} 届</option></select><small>报考届别</small></label>
        <button v-if="!authState.authenticated" class="login-entry" :disabled="!authState.ready" @click="openProtectedAccess">
          <User aria-hidden="true" />{{ authState.ready ? "登录" : "连接中" }}
        </button>
        <button v-if="authState.authenticated" @click="handleLogout">退出</button>
      </div>
    </header>

    <section v-if="!eligibilityActive" class="glass-explorer" aria-label="查找地区与历史录用筛选">
      <form class="glass-search" @submit.prevent="searchOpen = true">
        <Search aria-hidden="true" />
        <input v-model="globalSearch" aria-label="搜索省份或学校" placeholder="搜索省份、学校，找到你的报考方向" @focus="searchOpen = true" @keydown.esc.stop="searchOpen = false" />
        <button v-if="globalSearch" type="button" aria-label="清空搜索" @click="globalSearch = ''"><Close aria-hidden="true" /></button>
        <button type="submit">搜索</button>
      </form>
      <label class="glass-filter"><span>地区</span><select aria-label="地区" :value="mapLevel === 'province' ? provinceAdcode : ''" @change="changeProvinceSelection"><option value="">全国</option><option v-for="item in provinceItems" :key="item.adcode" :value="item.adcode">{{ item.name }}</option></select></label>
      <label class="glass-filter"><span>电网</span><select aria-label="电网" v-model="gridMapGrid"><option value="">国网 · 南网</option><option value="sgcc">国家电网</option><option value="csg">南方电网</option></select></label>
      <label class="glass-filter"><span>录用批次</span><select aria-label="录用批次" v-model="gridMapBatch"><option v-for="[code,label] in availableBatchOptions" :key="code" :value="code">{{ label }}</option></select></label>
      <button class="history-entry" @click="openGridInformation('', 'facts', true)">历史录用 · {{ referenceYear }}届 <ArrowRight aria-hidden="true" /></button>
      <div v-if="searchOpen" class="glass-search-results">
        <header><strong>{{ globalSearch ? '查询结果' : '选择省份' }}</strong><button type="button" aria-label="关闭搜索结果" @click="searchOpen = false"><Close aria-hidden="true" /></button></header>
        <div class="search-province-grid"><button v-for="item in searchProvinces" :key="item.adcode" @mouseenter="handleProvincePreview(item)" @focus="handleProvincePreview(item)" @mouseleave="clearProvincePreview" @blur="clearProvincePreview" @click="chooseSearchProvince(item)">{{ item.name }}</button></div>
        <button v-for="school in searchSchools" :key="school.campusKey" class="search-school-row" @click="chooseSearchSchool(school)"><School aria-hidden="true" />{{ mapSchoolName(school) }}<ArrowRight aria-hidden="true" /></button>
        <p v-if="globalSearch && !searchProvinces.length && !searchSchools.length">当前地图范围没有匹配项。</p>
        <button class="search-ranking-link" @click="searchOpen = false; openGridInformation('', 'rankings')">打开全国院校榜，查询更多学校 <ArrowRight aria-hidden="true" /></button>
      </div>
    </section>

    <div v-if="!eligibilityActive" class="glass-map-heading">
      <button v-if="mapLevel === 'province'" class="glass-back" aria-label="返回全国地图" @click="returnNational()"><ArrowLeftBold aria-hidden="true" />全国</button>
      <div><p>{{ targetCohortYear }}届报考 · 参考{{ referenceYear }}届数据</p><h1>{{ mapLevel === 'province' ? provinceName : '从这里，看见你的电网方向' }}</h1><span>先看录用去向，再按自己的条件找机会</span></div>
      <nav v-if="mapLevel === 'province'" class="glass-layer-tabs" aria-label="地图图层"><button :class="{active:mode === 'school'}" :aria-pressed="mode === 'school'" @click="setMode('school')"><School aria-hidden="true" />学校</button><button :class="{active:mode === 'company'}" :aria-pressed="mode === 'company'" @click="setMode('company')"><OfficeBuilding aria-hidden="true" />电网公司</button></nav>
    </div>

    <aside v-if="!eligibilityActive && !rightOpen" class="glass-context-card">
      <MapContextPreview :preview="activeContextPreview" :loading="contextLoading" :error="contextError" :unavailable-year="missingRosterYear || missingReferenceYear" :can-open-details="authState.authenticated" :ranking="cardRanking" :conditions="cardConditions" :school-detail="cardSchoolDetail" :disclaimer="activeDisclaimer"
        @request-ranking="requestCardRanking" @clear-ranking="clearCardRanking"
        @request-conditions="requestCardConditions" @clear-conditions="clearCardConditions"
        @request-school-detail="requestCardSchoolDetail" @close="closeContextPreview" @open-province="enterProvince({adcode:$event})" @open-school="openGridEntity('school',$event)" @eligibility="openPreviewEligibility" @login="openProtectedAccess" />
      <button v-if="contextError" type="button" class="context-more context-retry" :disabled="contextLoading" @click="retryContextPreview">重新加载</button>
      <button class="context-more" @click="rightOpen = true">查看完整统计与院校去向 <ArrowRight aria-hidden="true" /></button>
    </aside>



    <form v-if="!eligibilityActive" class="glass-quick-start" @submit.prevent="startQuickEligibility">
      <div class="quick-intro"><Guide aria-hidden="true" /><div><strong>我能报哪里？</strong><small>学历、专业与家乡一起看</small></div></div>
      <label><span>最高学历</span><select v-model="quickDegree" aria-label="快捷筛选最高学历"><option value="">选择学历</option><option value="junior_college">专科</option><option value="bachelor">本科</option><option value="master">硕士</option><option value="doctor">博士</option></select></label>
      <label><span>专业类别</span><select v-model="quickMajor" aria-label="快捷筛选专业类别"><option value="">选择专业</option><option value="electrical">电工类</option><option value="communication">通信类</option><option value="computer">计算机类</option><option value="finance">财会类</option><option value="other">其他专业</option></select></label>
      <label><span>原户籍地</span><select v-model="quickOriginalHukouProvinceAdcode" aria-label="快捷筛选原户籍地"><option value="">暂不填写</option><option v-for="item in provinceItems" :key="item.adcode" :value="item.adcode">{{ item.name }}</option></select></label>
      <label><span>意向省份</span><select v-model="quickTargetProvinceAdcode" aria-label="快捷筛选意向报考省份"><option value="">全国</option><option v-for="item in provinceItems" :key="item.adcode" :value="item.adcode">{{ item.name }}</option></select></label>
      <label><span>毕业届别</span><select v-model.number="quickGraduationYear" aria-label="快捷筛选毕业届别"><option v-for="year in APPLICANT_COHORT_OPTIONS" :key="year" :value="year">{{ year }} 届</option></select></label>
      <button class="quick-primary" type="submit">按我的条件找机会 <ArrowRight aria-hidden="true" /></button>
    </form>

    <div v-if="eligibilityActive" class="hero-stack">
      <Transition name="level-guide" mode="out-in">
        <button
          v-if="mapLevel === 'province'"
          :key="provinceAdcode"
          class="hero-return"
          type="button"
          :aria-label="`返回全国总览，当前为${provinceName}`"
          title="返回全国总览"
          @click="returnNational()"
        >
          <ArrowLeftBold aria-hidden="true" />
        </button>
      </Transition>
      <Transition name="title-swap" mode="out-in">
        <div :key="`${title}:${statusText}`" class="title-block" aria-live="polite">
          <h1>{{ title }}</h1>
          <p><span class="status-dot"></span>{{ statusText }}</p>
        </div>
      </Transition>
    </div>

    <Transition name="map-toast">
      <div v-if="mapAnnouncement" class="map-announcement" role="status" aria-live="polite" aria-atomic="true">
        {{ mapAnnouncement }}
      </div>
    </Transition>

    <aside v-if="!eligibilityActive" class="overlay-card left-panel" :class="{ closed: !leftOpen && mapLevel !== 'national', 'national-switch-panel': mapLevel === 'national' }" :inert="!leftOpen && mapLevel !== 'national'" :aria-hidden="!leftOpen && mapLevel !== 'national'" tabindex="0" :aria-label="mapLevel === 'national' ? '全国数据与筛选' : '地图筛选与实体列表'">
    <section v-if="mapLevel === 'national'" v-show="!leftOpen" class="glass-national-total" aria-label="历史全国录用总览">
      <small>{{ referenceYear }} 届全国录用公示</small>
      <div class="national-total-value"><strong>{{ nationalOverview?.rosterDataAvailable === false ? '暂无资料' : previewCountText(nationalPreview.total) }}</strong><button class="all-schools-entry" type="button" @click="openAllSchoolData">查看全部学校数据 <span aria-hidden="true">↗</span></button></div>
      <span class="national-public-note">{{ nationalPreview.scopeLabel }}{{ nationalPreview.countBasis === 'released_cells_only' ? ' · 公开可见部分' : '' }}</span>
      <div v-if="nationalGridTotals.length"><span v-for="item in nationalGridTotals" :key="item.label">{{ item.label }} <b>{{ previewCountText(item.value) }}</b></span></div>
      <span v-else-if="!authState.authenticated" class="national-public-note">登录后查看完整匿名汇总</span>
      <span v-else-if="nationalOverview?.rosterDataAvailable === false" class="national-public-note">暂无{{ referenceYear }}届录用资料</span>
      <div class="national-ranking-heading"><b>{{ authState.authenticated ? '全国高校 · 前 200' : '全国高校 · 公开预览' }}</b><span>国网+南网 · 全批次</span></div>
      <p v-if="nationalTopSchoolsLoading" class="national-ranking-state" role="status">正在加载学校排名…</p>
      <p v-else-if="nationalTopSchoolsError" class="national-ranking-state" role="alert">{{ nationalTopSchoolsError }} <button type="button" @click="loadNationalTopSchools">重试</button></p>
      <ol v-if="nationalTopSchools.length" class="national-top-schools" :aria-label="authState.authenticated ? '全国录用人数前200院校' : '全国院校公开预览'" tabindex="0">
        <li v-for="(row, i) in nationalTopSchools" :key="row.campusKey">
          <span class="top-rank">{{ row.rank ?? i + 1 }}</span>
          <span class="top-school"><span class="top-name">{{ row.campusName || row.schoolName }}</span><small v-if="schoolProfileTags(row).length" class="top-school-tags">{{ schoolProfileTags(row).join(' · ') }}</small></span>
          <span class="top-split">
            <b>{{ previewCountText(row.recordCount) }}</b>
            <small>国网 {{ previewCountText(row.gridCounts?.sgcc ?? null) }} · 南网 {{ previewCountText(row.gridCounts?.csg ?? null) }}</small>
          </span>
        </li>
      </ol>
      <button v-if="!authState.authenticated" class="national-ranking-login" type="button" @click="openProtectedAccess()">登录查看前 200 所学校</button>
      <p v-else-if="!nationalTopSchoolsLoading && !nationalTopSchoolsError && !nationalTopSchools.length" class="national-ranking-state">暂无该届学校录用资料</p>
    </section>
      <div v-show="mapLevel !== 'national' || leftOpen" class="national-filter-content">
      <div class="panel-head">
        <div>
          <span class="eyebrow">{{ referenceYear }}届电网招聘</span>
          <h2>{{ mapLevel === "national" ? "筛选与列表" : `${provinceName}数据面板` }}</h2>
        </div>
        <button v-if="mapLevel !== 'national'" class="plain-button" @click="leftOpen = false" aria-label="收起左侧面板">收起</button>
      </div>
      <button v-if="mapLevel === 'province'" class="grid-city-query" type="button" @click="openGridInformation(activeRegion)">
        <strong>{{ activeRegion || provinceName }} · 招聘要求与历史分数</strong>
        <span>按批次查看学历、专业、证书与招聘安排</span>
      </button>

      <section v-if="mapLevel === 'province' && provinceBatchRequirements.length" class="batch-requirements" aria-label="各批次报考要求">
        <div class="section-label"><span>各批次要求</span><small>点击批次展开</small></div>
        <div v-for="group in provinceBatchRequirements" :key="group.code" class="batch-requirement-group">
          <button type="button" class="batch-requirement-head" :aria-expanded="expandedRequirementBatch === group.code"
            @click="toggleRequirementBatch(group.code)">
            <b>{{ group.label }}</b>
            <span>{{ group.rows.length }} 条</span>
            <i :class="{ open: expandedRequirementBatch === group.code }" aria-hidden="true">›</i>
          </button>
          <ul v-if="expandedRequirementBatch === group.code" class="batch-requirement-list">
            <li v-for="(row, i) in group.rows" :key="row.requirementKey || i">
              <strong>{{ row.title || row.category || '报考要求' }}</strong>
              <p v-if="row.excerpt">{{ row.excerpt }}</p>
              <small v-if="row.applicability">适用：{{ row.applicability }}</small>
            </li>
          </ul>
        </div>
        <p class="batch-requirement-note">要求摘自已收录资料，不代替当届官方公告与资格审查。</p>
      </section>

      <div v-if="summaryCards.length" class="summary-grid">
        <div v-for="card in summaryCards" :key="card.label" class="summary-card">
          <span>{{ card.label }}</span>
          <strong>{{ card.value }}</strong>
          <small>{{ card.note }}</small>
        </div>
      </div>

      <template v-if="mapLevel === 'national'">
        <button class="national-information-hint" type="button" @click="openGridInformation()">国网南网录用公示 · 选择省份查看学校与公司 ↗</button>
        <div class="section-label"><span>选择省份</span><small>{{ authState.authenticated ? "账号已登录，点击进入" : "进入任一省份需登录" }}</small></div>
        <div class="province-list beautify-scroll-def">
          <button
            v-for="province in provinceItems"
            :key="province.adcode"
            :class="{ unavailable: !isStateGridEntryEnabled(province.adcode), mixed: gridTerritoryByAdcode[province.adcode]?.operator === 'mixed' }"
            :aria-disabled="!isStateGridEntryEnabled(province.adcode)"
            @mouseenter="handleProvincePreview(province)"
            @mouseleave="clearProvincePreview"
            @focus="handleProvincePreview(province)"
            @click="enterProvince(province)"
          >
            <span>{{ province.name }}</span>
            <b :class="{ ready: authState.authenticated }">
              <Lock v-if="!authState.authenticated && isStateGridEntryEnabled(province.adcode)" class="province-access-icon" aria-hidden="true" />
              {{ !isStateGridEntryEnabled(province.adcode) ? '不适用' : authState.authenticated ? (gridTerritoryByAdcode[province.adcode]?.operator === 'csg' ? '南网学校+公司' : province.adcode === '150000' ? '蒙东资料+院校' : '学校+招聘公司') : '登录进入' }}
            </b>
          </button>
        </div>
      </template>

      <template v-else-if="showNationwideEntities">
        <ProvinceEarlyBatchCard v-if="authState.authenticated" :adcode="provinceAdcode" :province="provinceName" :target-cohort-year="targetCohortYear" />
        <button class="province-profile-entry" type="button" @click="openGridInformation(activeRegion)"><span><Document aria-hidden="true" /><b>{{ provinceName }}招聘指南</b></span><small>报考条件 · 考试分数 · 招聘安排</small></button>
        <label class="search-box"><span class="sr-only">搜索地图学校或公司</span><input v-model="searchText" :placeholder="mode === 'school' ? '搜索学校或城市' : '搜索招聘单位'" /></label>
        <div class="grid-map-filters">
          <label>电网<select v-model="gridMapGrid"><option value="">国网 + 南网</option><option value="sgcc">国家电网</option><option value="csg">南方电网</option></select></label>
          <label>批次<select v-model="gridMapBatch"><option v-for="item in availableBatchOptions" :key="item[0]" :value="item[0]">{{ item[1] }}</option></select></label>
          <label v-if="mode === 'school'">学校城市<select v-model="activeRegion"><option value="">全省学校</option><option v-for="city in gridCities" :key="city.adcode" :value="city.name">{{ city.name }}（{{ city.schoolCount }}校）</option></select></label>
        </div>
        <div v-if="mode === 'company' && isHubei && protectedDataReady" class="batch-filter company-layer-filter" aria-label="湖北公司组织层级"><button class="active">录用单位</button><button @click="companyLayer = 'hierarchy'">组织</button><button @click="companyLayer = 'zhengyuan'">正源</button><button @click="companyLayer = 'service'">供服</button></div>
        <p class="boundary-note">{{ mode === 'school' ? '点击学校查看本省、其他省份及全国录用情况。' : '左侧查看单位目录，右侧查看已收录的录用情况。' }}</p>
        <button v-if="activeRegion || gridCompanyLocation" class="national-information-hint" @click="clearMapRegion">当前范围：{{ activeRegion || '省级范围单位' }} · 返回全省</button>
        <p v-if="gridMapLoading" class="table-empty" role="status">正在读取本省地图数据…</p>
        <div v-else-if="gridMapError" class="access-card"><p role="alert">{{ gridMapError }}</p><button @click="loadGridMap">重新加载</button></div>
        <template v-else>
          <div class="section-label"><span>{{ mode === 'school' ? '本省学校 · 全国录用' : '本省单位目录' }}</span><small>{{ mode === 'school' ? gridLocalSchools.length + '所' : gridCompanies.length + '家' }}</small></div>
          <p v-if="mode === 'school'" class="boundary-note">全国去向 · {{ gridFilterLabel }}</p>
          <div class="entity-list beautify-scroll-def" data-qa="nationwide-map-entities">
            <template v-if="mode === 'school'"><button v-for="(school, index) in gridLocalSchools.slice(0, gridSchoolPageSize)" :key="school.campusKey" :class="{ active: activeEntityId === schoolMapId(school) }" @click="selectGridSchool(school)"><span class="rank">{{ index + 1 }}</span><span class="entity-copy"><strong>{{ mapSchoolName(school) }}</strong><small>{{ [school.city, school.schoolTier].filter(Boolean).join(' · ') }}{{ school.locationPrecision === 'campus' ? '' : ' · 城市位置示意' }}</small></span><span v-if="school.recordCount !== null" class="entity-value grid-map-count">{{ mapCountText(school.recordCount, school.countBasis) }}</span></button><button v-if="gridLocalSchools.length > gridSchoolPageSize" @click="gridSchoolPageSize += 80">继续显示（{{ gridSchoolPageSize }} / {{ gridLocalSchools.length }}所）</button></template>
            <template v-else><button v-for="(company, index) in gridCompanies.slice(0, gridCompanyPageSize)" :key="company.companyKey" :class="{ active: activeEntityId === companyMapId(company) }" @click="openGridEntity('company', company.companyKey)"><span class="rank">{{ index + 1 }}</span><span class="entity-copy"><strong>{{ company.company }}</strong><small><template v-if="company.companyCity || company.province">{{ company.companyCity || company.province }} · </template>{{ company.recordCount === null ? '查看招聘与报名信息' : `${company.schoolCount}所毕业院校` }}</small></span><span v-if="company.recordCount !== null" class="entity-value grid-map-count">{{ mapCountText(company.recordCount, company.countBasis) }}</span></button><button v-if="gridCompanies.length > gridCompanyPageSize" @click="gridCompanyPageSize += 80">继续显示（{{ gridCompanyPageSize }} / {{ gridCompanies.length }}家）</button></template>
            <p v-if="!(mode === 'school' ? gridLocalSchools.length : gridCompanies.length)" class="table-empty">没有找到符合筛选条件的{{ mode === 'school' ? '学校' : '单位' }}。</p>
          </div>
        </template>
      </template>

      <template v-else-if="isHubei">
        <button class="province-profile-entry" type="button" @click="openProvinceRecruitmentProfile">
          <span><Document aria-hidden="true" /><b>2026届湖北招聘要求与时间线</b></span>
          <small v-if="provinceRecruitmentReady">
            {{ provinceRecruitmentData?.summary?.eventCount ?? 0 }}个节点 · {{ provinceRecruitmentData?.summary?.requirementCount ?? 0 }}条要求 · A/B/C来源分级
          </small>
          <small v-else-if="provinceRecruitmentLoading">正在加载省级官方资料…</small>
          <small v-else>点击加载全国统一口径的省级资料面板</small>
        </button>
        <label class="search-box">
          <span class="sr-only">搜索学校或公司</span>
          <input v-model="searchText" :placeholder="mode === 'school' ? '搜索学校、城市或层次' : '搜索单位'" />
        </label>
        <div v-if="mode === 'school' && protectedDataReady" class="batch-filter" aria-label="批次筛选">
          <button v-for="item in ['all', '第一批', '第二批', '第三批']" :key="item" :class="{ active: batchFilter === item }" :aria-pressed="batchFilter === item" @click="batchFilter = item">
            {{ item === "all" ? "全部" : item }}
          </button>
        </div>
        <div v-else-if="mode === 'school'" class="access-inline">
          <span>单校批次筛选登录后可用</span><button @click="openProtectedAccess">登录</button>
        </div>
        <div v-else-if="protectedDataReady" class="batch-filter company-layer-filter" aria-label="公司层级筛选">
          <button v-for="item in [
            ['system', '录用'], ['hierarchy', '省+地市'], ['municipal', '地市'], ['zhengyuan', '正源'], ['service', '供服']
          ]" :key="item[0]" :class="{ active: companyLayer === item[0] }" :aria-pressed="companyLayer === item[0]" @click="companyLayer = item[0] as 'system' | 'hierarchy' | 'municipal' | 'zhengyuan' | 'service'">
            {{ item[1] }}
          </button>
        </div>
        <div v-else class="access-card compact">
          <strong>登录后查看国网公司明细</strong>
          <p>公开页保留湖北总体批次；地市公司、正源地域和供服主体明细由受保护接口加载。</p>
          <button @click="openProtectedAccess">登录加载公司图层</button>
        </div>
        <button v-if="mode === 'school'" class="national-information-hint" type="button" @click="openGridInformation('', 'rankings')">当前为湖北来源院校视图 · 查看全国国网南网院校全榜 ↗</button>
        <div v-if="mode === 'school' || protectedDataReady" class="section-label"><span>{{ mode === "school" ? "湖北省内院校" : companyLayerLabel }}</span><small>{{ listEntities.length }} 项</small></div>
        <div v-if="mode === 'school' || protectedDataReady" class="entity-list beautify-scroll-def">
          <button v-for="(entity, index) in listEntities" :key="entity.id" :class="{ active: activeEntityId === entity.id }" @click="openEntity(entity)">
            <span class="rank">{{ String(index + 1).padStart(2, "0") }}</span>
            <span class="entity-copy">
              <strong>{{ entity.name }}</strong>
              <small>{{ entitySubtitle(entity) }}</small>
            </span>
            <span class="entity-value">{{ entityListDisplay(entity).value }}<small>{{ entityListDisplay(entity).unit }}</small></span>
          </button>
        </div>
      </template>

      <ProvinceRecruitmentProfile
        v-else
        :data="provinceRecruitmentData"
        :loading="provinceRecruitmentLoading"
        :error="provinceRecruitmentError"
        :province-name="provinceName"
        :province-adcode="provinceAdcode"
        variant="panel"
        @retry="retryProvinceRecruitmentProfile"
        @open-full="openProvinceRecruitmentProfile"
      />
      </div>
      <nav v-if="mapLevel === 'national'" class="national-total-tabs" aria-label="全国概览视图">
        <button type="button" :class="{ active: !leftOpen }" :aria-pressed="!leftOpen" @click="leftOpen = false">总数据</button>
        <button type="button" :class="{ active: leftOpen }" :aria-pressed="leftOpen" @click="leftOpen = true">筛选与列表</button>
      </nav>
    </aside>

    <aside v-if="!eligibilityActive" class="overlay-card right-panel" :class="{ closed: !rightOpen }" :inert="!rightOpen" :aria-hidden="!rightOpen" tabindex="0" aria-label="批次统计与跨省来源">
      <div class="panel-head">
        <div>
          <span class="eyebrow">{{ referenceYear }}届招聘概览</span>
          <h2>{{ mapLevel === 'national' ? '全国各批次统计' : showNationwideEntities ? (mode === 'company' ? '招聘单位与录用情况' : '录用情况与毕业院校') : isHubei ? (mode === "school" ? "湖北批次与院校" : "湖北招聘单位") : "招聘概览" }}</h2>
        </div>
        <button class="plain-button" @click="rightOpen = false" aria-label="收起右侧面板">收起</button>
      </div>

      <template v-if="mapLevel === 'national'">
        <div v-if="!authState.authenticated" class="access-card"><strong>登录查看全国统计</strong><p>查看国网各批次、南网春秋招及院校录用情况。</p><button @click="openDialog('login')">登录查看全国统计</button></div>
        <p v-else-if="nationalGridLoading" class="table-empty" role="status">正在读取全国各批次统计…</p>
        <div v-else-if="nationalGridError" class="access-card"><p role="alert">{{ nationalGridError }}</p><button @click="loadNationalGridMap">重新加载全国统计</button></div>
        <p v-else-if="nationalGridMap?.rosterDataAvailable === false" class="table-empty">暂无{{ referenceYear }}届录用资料</p><GridBatchStatistics v-else :cards="nationalGridMap?.exactCards || []" :scope="`全国国网 / 南网`" :cohort-year="referenceYear" />
        <button v-if="authState.authenticated" class="national-information-hint" @click="openGridInformation()">查询批次、地区与全国院校 ↗</button>
      </template>
      <template v-else-if="showNationwideEntities">
        <p v-if="gridMapData?.rosterDataAvailable === false" class="table-empty">暂无{{ referenceYear }}届录用资料</p><GridBatchStatistics v-else compact :cards="gridMapData?.exactCards || []" :scope="provinceName" :cohort-year="referenceYear" />
        <section v-if="mode === 'company'" class="company-recruitment-summary" aria-label="招聘单位录用情况">
          <div class="section-label"><span>招聘单位录用公示</span><small>{{ companyRecruitmentSummary.rankedCompanies.length }}家</small></div>
          <div class="outside-table beautify-scroll-def">
            <button v-for="company in companyRecruitmentSummary.rankedCompanies" :key="company.companyKey" @click="openGridEntity('company', company.companyKey)">
              <span><strong>{{ company.company }}</strong><small>{{ gridFilterLabel }}</small></span>
              <b>{{ mapCountText(company.recordCount, company.countBasis) }}</b>
            </button>
            <p v-if="!companyRecruitmentSummary.rankedCompanies.length" class="table-empty">当前筛选暂无单位录用统计。</p>
          </div>
          <template v-if="companyRecruitmentSummary.cityTotals.length">
            <div class="section-label"><span>录用城市</span></div>
            <div class="outside-table"><div v-for="city in companyRecruitmentSummary.cityTotals" :key="`${city.grid}:${city.city}`"><strong>{{ city.city }}</strong><b>{{ city.recordCount.toLocaleString('zh-CN') }}</b></div></div>
          </template>
        </section>
        <div class="method-card"><span>{{ provinceName }} · {{ gridFilterLabel }}</span><strong>谁被本省单位录用？</strong><p>下方按毕业院校查看，点击学校可比较本省、其他省份和全国情况。</p></div>
        <div class="section-label"><span>进入本省招聘单位的来源院校</span><small>{{ gridSourceSchools.length }}项</small></div>
        <div class="outside-table beautify-scroll-def" data-qa="destination-source-schools"><button v-for="school in gridSourceSchools.slice(0, gridSourcePageSize)" :key="school.campusKey" @click="openGridEntity('school', school.campusKey)"><span><strong>{{ mapSchoolName(school) }}</strong><small v-if="school.province || school.city">{{ [school.province, school.city].filter(Boolean).join(' · ') }}</small></span><b>{{ mapCountText(school.recordCount, school.countBasis) }}</b></button><button v-if="gridSourceSchools.length > gridSourcePageSize" @click="gridSourcePageSize += 80">继续显示（已显示{{ gridSourcePageSize }} / {{ gridSourceSchools.length }}项）</button><p v-if="!gridSourceSchools.length" class="table-empty">当前筛选暂无可展示来源院校。</p></div>
        <details v-if="gridUnlocatedSchools.length" class="map-legacy-details"><summary>其他院校 {{ gridUnlocatedSchools.length }}所</summary><div class="outside-table beautify-scroll-def"><button v-for="school in gridUnlocatedSchools.slice(0, gridSourcePageSize)" :key="school.campusKey" @click="openGridEntity('school', school.campusKey)"><span><strong>{{ mapSchoolName(school) }}</strong><small v-if="gridMapData?.unassignedSchools?.some(item => item.campusKey === school.campusKey)">全国院校，不计入本省统计</small></span></button><button v-if="gridUnlocatedSchools.length > gridSourcePageSize" @click="gridSourcePageSize += 80">继续显示全部院校</button></div></details>
        <details v-if="gridUnassignedCompanies.length" class="map-legacy-details"><summary>其他招聘单位 {{ gridUnassignedCompanies.length }}家</summary><div class="outside-table beautify-scroll-def"><button v-for="company in gridUnassignedCompanies.slice(0, gridCompanyPageSize)" :key="company.companyKey" @click="openGridEntity('company', company.companyKey)"><span><strong>{{ company.company }}</strong></span></button><button v-if="gridUnassignedCompanies.length > gridCompanyPageSize" @click="gridCompanyPageSize += 80">继续显示全部单位</button></div></details>
        <p v-if="activeRegion" class="boundary-note">{{ activeRegion }}：当前没有可单独展示的城市录用人数。</p>
        <button class="national-information-hint" @click="openGridInformation('', 'rankings')">查看全国院校 ↗</button>
        <button v-if="isHubei" class="national-information-hint" @click="openProvinceRecruitmentProfile">查看湖北招聘安排 ↗</button>
      </template>

      <template v-else-if="isHubei">
        <div v-if="mode === 'school' || protectedDataReady" class="section-label batch-context"><span>{{ batchContextLabel }}</span></div>
        <div v-if="mode === 'school' || protectedDataReady" class="batch-stack">
          <article v-for="row in visibleBatchSummary" :key="row.batch" :class="['batch-row', row.tone]">
            <span class="batch-name">{{ row.batch }}</span>
            <div><small>招聘名额</small><strong>{{ row.plan }}</strong></div>
            <div><small>录用公示</small><strong>{{ row.records }}</strong></div>
            <p>{{ row.note }}</p>
          </article>
        </div>

        <template v-if="mode === 'school'">
          <div class="section-label"><span>省外 / 港澳台 / 国外院校</span><small>按学校真实地域</small></div>
          <div class="outside-table beautify-scroll-def">
            <button v-for="school in outsideSchools.slice(0, 24)" :key="school.id" @click="openEntity(school)">
              <span>
                <strong>{{ school.name }}</strong>
                <small>{{ school.province }} · {{ school.city }}</small>
              </span>
              <b>{{ entityListDisplay(school).text }}</b>
            </button>
            <p v-if="!outsideSchools.length" class="table-empty">暂无可展示院校。</p>
          </div>
        </template>

        <template v-else-if="protectedDataReady">
          <div class="section-label"><span>招聘组织关系</span></div>
          <div class="company-tree">
            <article v-for="(item, index) in companyStructure" :key="item.name">
              <span class="tree-index">{{ index + 1 }}</span>
              <div><strong>{{ item.name }}</strong><small>{{ item.meta }}</small></div>
              <b>{{ item.value }}</b>
            </article>
          </div>
          <template v-if="companyLayer === 'system' || companyLayer === 'hierarchy'">
            <div class="section-label compact"><span>直属单位</span><small>已列{{ directUnits.length }}家</small></div>
            <div class="direct-unit-chips"><span v-for="unit in directUnits" :key="unit">{{ unit }}</span></div>
          </template>
          <template v-else-if="companyLayer === 'zhengyuan'">
            <div class="section-label compact"><span>正源单位分布</span><small v-if="zhengyuanCoverage.units != null">{{ zhengyuanCoverage.units }}家单位</small></div>
            <div class="zhengyuan-region-list">
              <button v-for="entity in zhengyuanLocationPoints" :key="entity.id" @click="openEntity(entity)">
                <span>{{ entity.city }}</span><b>{{ entityListDisplay(entity).text }}</b>
              </button>
            </div>
          </template>
          <p v-else-if="companyLayer === 'service'" class="boundary-note">供电服务公司招聘面向乡镇岗位。</p>
          <p class="boundary-note">当前展示全省统计，没有可单独展示的城市录用人数。</p>
        </template>
        <div v-else class="access-card">
          <strong>公司层级与单位名称登录后查看</strong>
          <p>公开页仅展示全省总体；登录后可切换省+地市、正源地域和供服图层。</p>
          <button @click="openProtectedAccess">登录加载公司明细</button>
        </div>
      </template>

      <div v-else class="province-method-stack">
        <div v-if="provinceAdcode === '150000'" class="territory-method-note">
          <strong>仅国网蒙东</strong>
          <p>内蒙古页面不代表全自治区，不包含蒙西电网招聘。</p>
        </div>
        <div class="method-card province-method-card">
          <span>{{ referenceYear }}届招聘指南</span>
          <strong>{{ provinceRecruitmentReady ? '报考条件与招聘安排' : provinceRecruitmentLoading ? '正在加载…' : '点击查看招聘指南' }}</strong>
          <p v-if="provinceRecruitmentReady">
            按批次查看学历、专业、证书要求和报名时间。
          </p>
          <p v-else>{{ provinceRecruitmentError || '查看本省招聘单位与报考条件。' }}</p>
          <button class="province-profile-open" type="button" @click="openProvinceRecruitmentProfile">查看招聘指南</button>
        </div>
      </div>
    </aside>

    <GridInformationModalHost @unauthorized="handleGridInformationUnauthorized" />

    <EarlyBatchEligibilityDialog
      v-if="eligibilityActive"
      embedded
      :province-options="provinceItems"
      :selected-province-adcode="selectedEligibilityProvinceAdcode"
      :cohort-year="targetCohortYear"
      :initial-applicant="quickApplicant"
      :initial-batch="quickBatch"
      @close="closeEligibility"
      @unauthorized="handleEligibilityUnauthorized"
      @catalog-change="eligibilityCatalog = $event"
      @recruitment-evaluation="eligibilityEvaluation = $event"
    />

    <!-- The national view moves 筛选与列表 into the total card's own switcher,
         so only the province view still needs a floating launcher. -->
    <div v-if="mapLevel === 'province'" class="panel-launchers" :class="{ 'left-is-open': leftOpen }" aria-label="展开数据面板">
      <button v-if="!leftOpen" @click="leftOpen = true">筛选与列表</button>
      <button v-if="!rightOpen" @click="rightOpen = true">完整统计</button>
    </div>

    <div class="map-controls" aria-label="地图缩放控制">
      <button aria-label="放大地图" @click="mapRef?.zoomIn?.()">放大</button>
      <button aria-label="缩小地图" @click="mapRef?.zoomOut?.()">缩小</button>
      <button aria-label="重置地图视图" @click="resetMapView">重置</button>
      <button :aria-pressed="fullScreen" :aria-label="fullScreen ? '退出全屏' : '进入全屏'" @click="toggleFullScreen">{{ fullScreen ? "退出全屏" : "全屏" }}</button>
    </div>

    <footer class="source-foot">
      <SiteFiling />
      <span>Hengzhen Grid Atlas · 开源演示</span>
      <button @click="openExamBatch()">{{ referenceYear }}届招聘时间</button>
      <RecruitmentReferenceSection :cohort-year="referenceYear" :province-adcode="mapLevel === 'province' ? provinceAdcode : ''" :grid="gridMapGrid" :batch-code="gridMapBatch" docked />
      <button @click="openDialog('sources')">统计说明</button>
    </footer>

    <div v-if="dataLoading" class="data-toast" role="status">正在加载公开学校总览…</div>
    <div v-else-if="protectedDataLoading || provinceRecruitmentLoading || gridMapLoading || gridDetailLoading" class="data-toast" role="status">正在加载登录明细…</div>
    <div v-else-if="dataError" class="data-toast error" role="alert">{{ dataError }}</div>
    <div v-else-if="legacyDataError || sessionError" class="data-toast error" role="alert">{{ sessionError || legacyDataError }}</div>

    <Transition name="modal-pop">
      <div v-if="dialog" class="modal-backdrop" @mousedown.self="closeDialog">
        <section ref="dialogRef" :class="['modal-card', { 'calendar-modal': dialog === 'calendar', 'province-profile-modal': dialog === 'provinceProfile', 'grid-information-modal': dialog === 'gridInformation', 'all-school-modal': dialog === 'allSchoolData' }]" role="dialog" aria-modal="true" :aria-labelledby="`${dialog}-title`">
        <button class="modal-close" aria-label="关闭" @click="closeDialog">关闭</button>

        <template v-if="dialog === 'login'">
          <div class="login-layout">
            <div class="login-copy">
              <span class="eyebrow">DETAIL ACCESS</span>
              <h2 id="login-title">{{ loginDialogTitle }}</h2>
              <p>{{ loginDialogDescription }}</p>
              <form @submit.prevent="submitLogin">
                <label>手机号码<input v-model.trim="phone" inputmode="numeric" autocomplete="username" placeholder="请输入已开通的手机号" required /></label>
                <label>登录密码<input v-model="password" type="password" autocomplete="current-password" placeholder="请输入密码" required /></label>
                <p class="password-hint">演示账号见项目 README；正式部署请使用管理员开通的账号。</p>
                <p v-if="loginError || authState.error" class="form-error" role="alert">{{ loginError || authState.error }}</p>
                <button class="primary-button" type="submit" :disabled="loginBusy">{{ loginSubmitLabel }}</button>
              </form>
            </div>
            <div class="qr-card"><h3>Hengzhen Grid Atlas</h3><p>本地演示使用虚构数据。登录方式见项目 README。</p></div>
          </div>
        </template>

        <template v-else-if="dialog === 'allSchoolData'">
          <AllSchoolDataDialog :cohort-year="referenceYear" :totals="allSchoolTotals"
            :roster-data-available="allSchoolOverview?.rosterDataAvailable"
            @unauthorized="handleAllSchoolUnauthorized" @school="openAllSchoolDetail" />
          <p v-if="allSchoolOverviewLoading" class="school-totals-status" role="status">正在读取全国合计…</p>
          <p v-else-if="allSchoolOverviewError" class="school-totals-status" role="alert">{{ allSchoolOverviewError }} <button type="button" @click="loadAllSchoolOverview">重试</button></p>
        </template>

        <GridInformationPortal
          v-else-if="dialog === 'gridInformation'"
          :province="gridInformationContext.province"
          :city="gridInformationContext.city"
          :initial-tab="gridInformationContext.initialTab"
          :initial-original="gridInformationContext.original" :target-cohort-year="targetCohortYear"
          @unauthorized="handleGridInformationUnauthorized"
        />

        <template v-else-if="dialog === 'sources'">
          <h2 id="sources-title">统计说明</h2>
          <p class="modal-lead">录用数据按招聘公示汇总；同一人可能出现在不同批次或电网中，因此不能直接视为最终到岗人数。</p>
          <div class="method-card"><strong>学校与录用去向</strong><p>地图帮助查找院校和单位。学校所在地不等于录用工作地，城市位置不代表具体校区。</p></div>
          <div class="method-card"><strong>报考条件筛选</strong><p>筛选用于比对已列出的报名条件，不保证网申通过或录取。岗位选择、资格审查和体检等仍需分别满足。</p></div>
          <div class="method-card"><strong>隐私保护</strong><p>页面只展示汇总信息，不展示个人录用名单。</p></div>
          <a class="image-source-link" href="/assets/grid-atmosphere/credits.html" target="_blank" rel="noopener noreferrer">图片来源与许可</a>
        </template>

        <template v-else-if="dialog === 'provinceProfile'">
          <ProvinceRecruitmentProfile
            :data="provinceRecruitmentData"
            :loading="provinceRecruitmentLoading"
            :error="provinceRecruitmentError"
            :province-name="provinceName"
            :province-adcode="provinceAdcode"
            variant="dialog"
            heading-id="provinceProfile-title"
            @retry="retryProvinceRecruitmentProfile"
          />
        </template>

        <template v-else-if="dialog === 'calendar'">
          <span class="eyebrow">2026届 · 湖北招聘安排</span>
          <h2 id="calendar-title">国网考试批次详细信息</h2>
          <p class="modal-lead">按批次查看湖北2026届报名、资格审查、笔试与面试安排。时间均为北京时间。</p>

          <div class="exam-batch-tabs" role="tablist" aria-label="选择国网考试批次">
            <button
              v-for="item in examBatchItems"
              :key="item.batch_code"
              type="button"
              role="tab"
              :class="['exam-batch-tab', `tone-${item.tone}`, { active: activeExamBatch === item.batch_code }]"
              :aria-selected="activeExamBatch === item.batch_code"
              :data-autofocus="activeExamBatch === item.batch_code ? '' : undefined"
              @click="activeExamBatch = item.batch_code"
            >
              <b>{{ item.ui_alias }}</b>
              <span>{{ item.official_label }}</span>
            </button>
          </div>

          <div v-if="activeExamBatchDetail" class="year-reference-grid">
            <article class="year-reference-card current-year">
              <span class="year-status verified">2026届 · 湖北</span>
              <strong>{{ activeExamBatchDetail.ui_alias }}｜{{ activeExamBatchDetail.official_label }}</strong>
              <p>{{ activeExamBatchDetail.period_summary_2026 }}</p>
              <small>该届招聘周期已经结束，因此不显示倒计时。</small>
            </article>
          </div>

          <section v-if="activeExamBatchDetail" class="exam-timeline-section" aria-label="2026届湖北历史时间线">
            <header>
              <div>
                <span class="eyebrow">招聘时间线</span>
                <h3>报名、资格审查、笔试与面试</h3>
              </div>
              <span class="timezone-chip">北京时间</span>
            </header>
            <div v-if="activeExamBatchDetail.milestones_2026.length" class="exam-milestone-list">
              <article v-for="(milestone, index) in activeExamBatchDetail.milestones_2026" :key="milestone.event_id">
                <span class="milestone-index">{{ String(index + 1).padStart(2, '0') }}</span>
                <div class="milestone-copy">
                  <b>{{ milestone.stage }}</b>
                  <strong>{{ milestone.date_text }}</strong>
                  <p>{{ milestone.detail }}</p>
                  <div v-if="milestone.sessions?.length" class="exam-session-grid">
                    <span v-for="session in milestone.sessions" :key="`${milestone.event_id}-${session.label}`">
                      <b>{{ session.time }}</b><small>{{ session.label }}</small>
                    </span>
                  </div>
                </div>
              </article>
            </div>
            <p v-else class="table-empty">历史节点正在加载，请稍后刷新。</p>
          </section>

          <section v-if="activeExamBatchDetail?.electrical_reference_2026" class="electrical-reference-section" aria-label="湖北电网2026届电工类考情参考">
            <header>
              <div>
                <span class="eyebrow">考情参考</span>
                <h3>{{ activeExamBatchDetail.electrical_reference_2026.scope_label }}</h3>
              </div>
              <span class="reference-status">{{ activeExamBatchDetail.electrical_reference_2026.status_label }}</span>
            </header>
            <div class="electrical-reference-groups">
              <article v-for="group in activeExamBatchDetail.electrical_reference_2026.groups" :key="group.label">
                <h4>{{ group.label }}</h4>
                <dl>
                  <div v-for="metric in group.metrics" :key="`${group.label}-${metric.label}`">
                    <dt>{{ metric.label }}</dt>
                    <dd>{{ metric.value }}</dd>
                  </div>
                </dl>
              </article>
            </div>
            <ul class="reference-notes">
              <li v-for="note in activeExamBatchDetail.electrical_reference_2026.notes" :key="note">{{ note }}</li>
            </ul>
          </section>

          <div class="calendar-boundary-note">
            <strong>报考参考</strong>
            <span>报名人次包含不同志愿；考情分数仅作准备参考，不代表录取概率。</span>
          </div>
        </template>
        </section>
      </div>
    </Transition>

    <Transition name="drawer-slide">
      <div v-if="detailOpen && activeEntity" class="drawer-backdrop" @mousedown.self="closeDetail">
        <aside ref="detailRef" class="detail-drawer" role="dialog" aria-modal="true" aria-labelledby="detail-title" tabindex="-1">
        <button class="drawer-close" @click="closeDetail">关闭详情</button>
        <span class="eyebrow">{{ activeEntity.type === "school" ? "SCHOOL PROFILE" : "COMPANY PROFILE" }}</span>
        <h2 id="detail-title">{{ activeEntity.name }}</h2>
        <p class="detail-meta">{{ activeEntity.city }} · {{ activeEntity.level }} · {{ activeEntity.category }}</p>

        <GridMapDetail v-if="activeGridDetail" :detail="activeGridDetail" :province-name="activeGridDetailQuery?.provinceAdcode ? provinceName : ''" :filter-label="activeGridDetailFilterLabel" :cohort-year="referenceYear" @open-school="openRelatedGridEntity('school', $event)" @open-company="openRelatedGridEntity('company', $event)" />
        <template v-else-if="activeEntity.type === 'school'">
          <div class="tier-tags">
            <span v-for="tag in (activeEntity as SchoolItem).tierTags" :key="tag">{{ tag }}</span>
          </div>
          <div class="detail-hero">
            <span>{{ activeSchoolMetric?.metricLabel }}</span>
            <strong>{{ activeSchoolMetric?.text }}</strong>
          </div>
          <div class="batch-detail-grid">
            <article v-for="entry in [
              ['第一批', 'batch_1'], ['第二批', 'batch_2'], ['第三批', 'batch_3']
            ]" :key="entry[1]">
              <span>{{ entry[0] }}</span>
              <strong>{{ formatCell((activeEntity as SchoolItem).batch[entry[1] as 'batch_1' | 'batch_2' | 'batch_3']) }}</strong>
              <small>占本校三批合计 {{ formatShare((activeEntity as SchoolItem).batch[entry[1] as 'batch_1' | 'batch_2' | 'batch_3']) }}</small>
            </article>
          </div>
          <dl class="detail-facts">
            <div><dt>学校真实地域</dt><dd>{{ (activeEntity as SchoolItem).province }} · {{ activeEntity.city }}</dd></div>
            <div><dt>办学层次</dt><dd>{{ (activeEntity as SchoolItem).educationLevel }}</dd></div>
            <div><dt>办学性质</dt><dd>{{ (activeEntity as SchoolItem).schoolNature }}</dd></div>
            <div><dt>机构类型</dt><dd>{{ (activeEntity as SchoolItem).institutionCategory }}</dd></div>
            <div><dt>主管部门</dt><dd>{{ (activeEntity as SchoolItem).authority }}</dd></div>
          </dl>
        </template>

        <template v-else>
          <div class="tier-tags"><span v-for="tag in activeEntity.tags" :key="tag">{{ tag }}</span></div>
          <div class="company-detail-list">
            <article v-for="batch in activeEntity.batchResults" :key="batch.name">
              <span>{{ batch.name }}</span><strong>{{ companyBatchDisplay(batch) }}</strong><small>{{ batch.note }}</small>
            </article>
          </div>
          <div v-if="activeEntity.recruitingUnits?.length" class="recruiting-unit-list">
            <div class="section-label compact"><span>招聘单位</span></div>
            <article v-for="unit in activeEntity.recruitingUnits" :key="unit.unitName">
              <strong>{{ unit.unitName }}</strong><small>{{ unit.sectionName }} · {{ unit.locationLabel }}</small>
            </article>
          </div>
        </template>

        <div v-if="!activeGridDetail" class="detail-source">
          <button @click="openSourcesFromDetail">统计说明</button>
        </div>
        </aside>
      </div>
    </Transition>
  </div>
</template>

<style scoped lang="scss">
.grid-map-filters { display: flex; flex-wrap: wrap; gap: 7px; margin: 10px 0; }
.grid-map-filters label { display: grid; flex: 1 1 90px; gap: 5px; color: #6b8496; font-size: 10px; }
.grid-map-filters select { width: 100%; min-width: 0; padding: 8px 5px; border: 1px solid #c3dfea; border-radius: 7px; color: #285f7c; background: #f8fdff; font-size: 11px; }
.grid-map-count { font-size: 12px !important; white-space: nowrap; }
.map-legacy-details { margin: 12px 0; color: #476b82; font-size: 11px; }
.map-legacy-details summary { padding: 10px 0; cursor: pointer; font-weight: 750; }
.dashboard-shell {
  --ink: #153d58;
  --muted: #5e7b8f;
  --line: rgba(83, 164, 215, 0.42);
  --glass: rgba(248, 253, 255, 0.92);
  --glass-strong: rgba(255, 255, 255, 0.96);
  --blue: #086fcb;
  --cyan: #18b7e7;
  --green: #0f9c81;
  --left-panel-width: clamp(300px, 23vw, 382px);
  --right-panel-width: clamp(330px, 25vw, 430px);
  position: fixed;
  inset: 0;
  isolation: isolate;
  width: 100vw;
  height: 100dvh;
  min-width: 320px;
  overflow: hidden;
  color: var(--ink);
  background: #e4f3fb;
}

.map-layer { position: absolute; inset: 0; z-index: 0; }
.map-scene { position: absolute; inset: 0; }
.ion-layer {
  position: absolute;
  z-index: 2;
  top: 246px;
  right: calc(var(--right-panel-width) + 28px);
  bottom: 58px;
  left: calc(var(--left-panel-width) + 28px);
  overflow: hidden;
  pointer-events: none;
  opacity: .78;
}

.dashboard-shell::after {
  content: "";
  position: absolute;
  inset: 0;
  z-index: 1;
  pointer-events: none;
  background: linear-gradient(180deg, rgba(230, 246, 255, .22), transparent 56%, rgba(220, 241, 251, .68));
}

button, a { -webkit-tap-highlight-color: transparent; }
button { border: 0; cursor: pointer; }
button:disabled { cursor: wait; opacity: .62; }
button:focus-visible, a:focus-visible {
  outline: 3px solid #0876d1;
  outline-offset: 3px;
}

.top-shell {
  position: absolute;
  z-index: 30;
  top: 0;
  left: 0;
  right: 0;
  height: 72px;
  display: flex;
  align-items: center;
  padding: 0 22px;
  border-bottom: 1px solid rgba(74, 184, 243, .56);
  background: linear-gradient(100deg, #073b7a 0%, #062e64 45%, #031f4e 100%);
  box-shadow: 0 14px 40px rgba(15, 68, 119, .24), inset 0 -1px 0 rgba(104, 215, 255, .18);
}

.brand-block { position: relative; z-index: 2; display: flex; align-items: center; gap: 12px; line-height: 1.15; color: white; }
.brand-icon { width: 31px; height: 31px; padding: 6px; border: 1px solid rgba(90, 213, 255, .5); border-radius: 50%; color: #72dcff; filter: drop-shadow(0 0 8px rgba(39, 190, 255, .5)); }
.brand-copy { display: flex; flex-direction: column; }
.brand-copy small { margin-top: 4px; font-size: 10px; color: #b8deef; letter-spacing: .15px; white-space: nowrap; }
.eyebrow { color: #4583a8; font-size: 10px; font-weight: 800; letter-spacing: .16em; }
.brand-block strong { font-size: 18px; letter-spacing: .06em; }

.mode-tabs {
  position: absolute;
  z-index: 3;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 0;
  padding: 2px;
  border: 1px solid rgba(112, 185, 233, .32);
  border-radius: 11px;
  background: rgba(255, 255, 255, .08);
}
.mode-tabs button {
  position: relative;
  z-index: 1;
  flex: 1 1 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-width: 150px;
  padding: 12px 22px;
  border-radius: 9px;
  color: #c5dded;
  background: transparent;
  font-size: 15px;
  font-weight: 800;
  transition: color .22s ease, background .22s ease, box-shadow .22s ease, transform .22s ease;
}
.mode-tabs button svg { width: 17px; height: 17px; }
.mode-tabs button:hover { color: white; }
.mode-tabs button.active { color: white; background: transparent; }
.mode-tab-thumb { position: absolute; pointer-events: none; top: 2px; bottom: 2px; left: 2px; width: calc((100% - 4px) / 2); border-radius: 9px; background: linear-gradient(135deg, #0878d5, #18b7e7); box-shadow: 0 0 0 1px rgba(132,225,255,.48), 0 6px 18px rgba(0,137,226,.28), inset 0 1px 0 rgba(255,255,255,.28); transition: transform .32s cubic-bezier(.22,.8,.25,1); }
.company-selected .mode-tab-thumb { transform: translateX(100%); }

.top-actions { position: relative; z-index: 2; display: flex; justify-content: flex-start; gap: 8px; align-items: center; margin-left: auto; max-width: calc(50% - 174px); overflow-x: auto; scrollbar-width: none; }
.top-actions::-webkit-scrollbar { display: none; }
.top-actions > button { flex-shrink: 0; white-space: nowrap; }
.top-actions button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 38px;
  padding: 9px 12px;
  border: 1px solid rgba(184, 221, 243, .72);
  border-radius: 9px;
  color: #183f5d;
  background: rgba(255, 255, 255, .94);
  font-size: 12px;
  font-weight: 800;
  text-decoration: none;
  box-shadow: 0 7px 18px rgba(0, 20, 56, .14);
  transition: transform .2s ease, box-shadow .2s ease, border-color .2s ease;
}
.top-actions button:hover { transform: translateY(-1px); border-color: #59c8f2; box-shadow: 0 9px 22px rgba(0, 23, 62, .2); }
.top-actions svg { width: 14px; height: 14px; }
.top-actions .login-entry { color: white; border-color: #2aa8ed; background: linear-gradient(135deg, #0878d5, #149ee0); box-shadow: 0 8px 22px rgba(0, 137, 226, .34); }
.top-actions .eligibility-action.active { color: white; border-color: #4ac6ef; background: linear-gradient(135deg, #0878d5, #18a8c9); }
.top-actions .grid-information-action { color: #0a719c; border-color: #9fd7ed; background: #eaf8ff; }
.grid-city-query { display: grid; width: 100%; gap: 3px; padding: 10px 12px; margin: 8px 0 12px; border: 1px solid #b6d9ed; border-radius: 10px; color: #1b6289; background: #edf8ff; text-align: left; }
.grid-city-query strong { font-size: 12px; }
.grid-city-query span { font-size: 10px; color: #6a889b; line-height: 1.5; }
.national-information-hint { padding: 7px 0; color: #277ea6; background: transparent; font-size: 11px; text-align: left; }

.hero-stack {
  position: absolute;
  z-index: 20;
  top: 88px;
  left: 50%;
  display: block;
  width: min(900px, calc(100vw - var(--left-panel-width) - var(--right-panel-width) - 92px));
  transform: translateX(-50%);
  pointer-events: none;
}
.title-block {
  min-height: 50px;
  padding: 0 52px;
  text-align: center;
  white-space: nowrap;
}
.title-block h1 { margin: 0; color: #0a3c70; font-size: clamp(29px, 2vw, 38px); line-height: 1.12; font-weight: 900; letter-spacing: .08em; text-shadow: 0 2px 0 rgba(255,255,255,.9), 0 8px 24px rgba(23, 96, 151, .12); }
.title-block p { margin: 7px 0 0; color: #587a91; font-size: 11px; line-height: 1.2; font-weight: 700; letter-spacing: .045em; }
.status-dot { display: inline-block; width: 7px; height: 7px; margin-right: 8px; border-radius: 50%; background: #10a785; box-shadow: 0 0 0 4px rgba(16,167,133,.12), 0 0 12px rgba(16,167,133,.36); }

.countdown-strip {
  position: absolute;
  z-index: 2;
  top: 9px;
  right: calc(50% + 174px);
  left: clamp(246px, 17vw, 438px);
  display: flex;
  align-items: center;
  gap: 8px;
  height: 54px;
  min-width: 0;
  padding: 5px 7px;
  border: 1px solid rgba(93, 190, 238, .34);
  border-radius: 10px;
  overflow: hidden;
  color: #e8f7ff;
  background: rgba(255,255,255,.075);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.12), 0 8px 24px rgba(0,18,56,.14);
  backdrop-filter: blur(12px) saturate(130%);
  text-align: left;
  transition: transform .22s ease, border-color .22s ease, box-shadow .22s ease;
}
.countdown-strip:hover { transform: translateY(-1px); border-color: rgba(91, 206, 255, .72); box-shadow: inset 0 1px 0 rgba(255,255,255,.18), 0 10px 28px rgba(0,18,56,.2); }
.countdown-heading { display: flex; flex: 0 0 auto; flex-direction: column; gap: 2px; padding: 0 6px; border: 0; color: white; background: transparent; font: inherit; cursor: pointer; }
.countdown-heading strong { font-size: 11px; letter-spacing: .08em; }
.countdown-heading small { color: #9bc6df; font-size: 8px; font-weight: 700; white-space: nowrap; }
.countdown-cells { display: grid; min-width: 0; flex: 1; grid-template-columns: repeat(4, minmax(0, 1fr)); }
.countdown-item { position: relative; display: flex; min-width: 0; flex-direction: column; align-items: center; justify-content: center; gap: 3px; padding: 4px 5px; border: 0; border-right: 1px solid rgba(132, 204, 240, .24); color: inherit; background: transparent; font: inherit; cursor: pointer; transition: background .18s ease, box-shadow .18s ease; }
.countdown-item:last-child { border-right: 0; }
.countdown-item b { padding: 3px 6px; border-radius: 6px; color: #dff6ff; background: rgba(17, 157, 224, .28); font-size: 9px; white-space: nowrap; box-shadow: inset 0 0 0 1px rgba(128, 218, 255, .14); }
.countdown-item strong { max-width: 100%; overflow: hidden; color: #a9cee2; font-size: 8px; text-overflow: ellipsis; white-space: nowrap; }
.countdown-heading:hover, .countdown-item:hover { background: rgba(82, 197, 244, .1); }
.countdown-heading:focus-visible, .countdown-item:focus-visible { outline: 2px solid #7fdcff; outline-offset: -2px; }

.hero-return {
  position: absolute;
  z-index: 2;
  top: 3px;
  left: 0;
  display: grid;
  place-items: center;
  width: 42px;
  height: 42px;
  border: 1px solid rgba(85, 176, 227, .7);
  border-radius: 12px;
  color: white;
  background: linear-gradient(135deg, #0876d1, #0aa7df);
  box-shadow: 0 9px 22px rgba(0, 111, 200, .24), inset 0 1px 0 rgba(255,255,255,.22);
  pointer-events: auto;
  transition: transform .2s ease, box-shadow .2s ease;
}
.hero-return:hover { transform: translateX(-2px); box-shadow: 0 12px 28px rgba(0, 102, 191, .32), inset 0 1px 0 rgba(255,255,255,.25); }
.hero-return svg { width: 21px; height: 21px; }

.map-announcement {
  position: absolute;
  z-index: 35;
  top: 150px;
  left: 50%;
  max-width: 380px;
  padding: 10px 14px;
  border: 1px solid rgba(67, 164, 218, .52);
  border-radius: 11px;
  color: #0b5c8e;
  background: rgba(248, 253, 255, .96);
  box-shadow: 0 12px 28px rgba(32, 102, 148, .18);
  font-size: 12px;
  font-weight: 800;
  pointer-events: none;
  transform: translateX(-50%);
}

.overlay-card {
  position: absolute;
  z-index: 15;
  top: 90px;
  bottom: 58px;
  display: flex;
  flex-direction: column;
  width: var(--left-panel-width);
  padding: 16px;
  border: 1px solid rgba(95, 174, 220, .44);
  border-radius: 15px;
  overflow: hidden;
  background: var(--glass);
  box-shadow: 0 20px 48px rgba(39, 102, 145, .16), inset 0 1px 0 rgba(255,255,255,.9);
  backdrop-filter: blur(22px) saturate(132%);
  transition: transform .34s cubic-bezier(.2,.8,.2,1), opacity .24s ease, box-shadow .24s ease;
}
.left-panel { left: 18px; }
.right-panel { right: 18px; width: var(--right-panel-width); overflow-y: auto; }
.left-panel.closed { transform: translateX(calc(-100% - 30px)); opacity: 0; pointer-events: none; }
.right-panel.closed { transform: translateX(calc(100% + 30px)); opacity: 0; pointer-events: none; }

.panel-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 13px; }
.panel-head h2 { margin: 4px 0 0; font-size: 19px; letter-spacing: .03em; }
.plain-button { padding: 7px 8px; border-radius: 8px; color: #688396; background: #edf6fb; font-size: 10px; font-weight: 700; }

.summary-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 7px; }
.summary-card { min-width: 0; padding: 10px 9px; border: 1px solid rgba(121, 184, 217, .25); border-radius: 12px; background: rgba(255,255,255,.68); }
.summary-card span, .summary-card small { display: block; overflow: hidden; color: #6d8798; font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }
.summary-card strong { display: block; margin: 4px 0 2px; color: #166d9e; font-size: 19px; }
.eligibility-panel-entry { display: grid; width: 100%; gap: 4px; margin-top: 10px; padding: 10px 12px; border: 1px solid rgba(40, 150, 207, .38); border-radius: 11px; color: #1a628b; background: linear-gradient(135deg, rgba(232, 247, 254, .96), rgba(241, 252, 255, .9)); box-shadow: inset 0 1px 0 rgba(255,255,255,.9); text-align: left; }
.eligibility-panel-entry > span { display: flex; align-items: center; gap: 7px; }
.eligibility-panel-entry svg { width: 14px; height: 14px; color: #0d86c5; }
.eligibility-panel-entry b { font-size: 11px; }
.eligibility-panel-entry small { color: #6f8999; font-size: 8px; line-height: 1.45; }
.eligibility-panel-entry:hover { border-color: #3ea6d7; background: white; }
.province-profile-entry { display: grid; width: 100%; gap: 4px; margin-top: 10px; padding: 10px 12px; border: 1px solid rgba(37, 148, 183, .38); border-radius: 11px; color: #145f82; background: linear-gradient(135deg, rgba(230, 248, 250, .96), rgba(239, 250, 255, .92)); text-align: left; }
.province-profile-entry > span { display: flex; align-items: center; gap: 7px; }
.province-profile-entry svg { width: 14px; height: 14px; color: #0b8e9b; }
.province-profile-entry b { font-size: 11px; }
.province-profile-entry small { color: #6d8796; font-size: 8px; line-height: 1.45; }
.province-profile-entry:hover { border-color: #35a6bf; background: white; }

.section-label { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; margin: 16px 2px 8px; }
.section-label span { font-size: 13px; font-weight: 850; }
.section-label small { color: #7b92a1; font-size: 9px; }

.province-list, .entity-list, .outside-table, .source-list { min-height: 0; overflow-y: auto; }
.province-list { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; }
.province-list button { display: flex; align-items: center; justify-content: space-between; min-height: 38px; padding: 8px 9px; border: 1px solid rgba(111, 177, 213, .24); border-radius: 9px; color: #315d76; background: rgba(255,255,255,.66); text-align: left; }
.province-list button:hover { border-color: #6cb7df; background: white; }
.province-list button.unavailable { color: #7d8f9a; border-color: rgba(134,151,164,.24); background: rgba(227,233,237,.8); }
.province-list button.unavailable:hover { border-color: rgba(109,143,165,.42); background: #edf2f5; }
.province-list button.unavailable b { color: #778995; white-space: normal; text-align: right; }
.province-list button.mixed { border-style: dashed; background: rgba(221,235,244,.9); }
.province-list span { font-size: 11px; font-weight: 750; }
.province-list b { display: inline-flex; align-items: center; gap: 3px; color: #8a9ba7; font-size: 8px; white-space: nowrap; }
.province-list b.ready { color: #087d69; }
.province-access-icon { width: 10px; height: 10px; }

.search-box { display: block; margin-top: 13px; }
.search-box input { width: 100%; padding: 11px 12px; border: 1px solid rgba(105, 171, 207, .35); border-radius: 11px; color: var(--ink); background: rgba(255,255,255,.84); outline: none; }
.search-box input:focus { border-color: #2e91c7; box-shadow: 0 0 0 3px rgba(46,145,199,.12); }

.batch-filter { display: grid; grid-template-columns: repeat(4, 1fr); gap: 5px; margin-top: 8px; }
.batch-filter button { padding: 7px 4px; border-radius: 8px; color: #607e91; background: #edf6fb; font-size: 10px; font-weight: 750; }
.batch-filter button.active { color: white; background: #1680ba; }
.company-layer-filter button.active { background: #0f937e; }
.access-inline { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 8px; padding: 8px 10px; border-radius: 9px; color: #607e91; background: #edf6fb; font-size: 10px; }
.access-inline button { padding: 6px 9px; border-radius: 7px; color: white; background: #1680ba; font-size: 10px; font-weight: 800; }

.entity-list { display: flex; flex-direction: column; gap: 6px; }
.entity-list button { display: grid; grid-template-columns: 28px 1fr auto; align-items: center; gap: 8px; padding: 9px; border: 1px solid transparent; border-radius: 11px; color: var(--ink); background: rgba(255,255,255,.64); text-align: left; }
.entity-list button:hover, .entity-list button.active { border-color: #64b4dd; background: rgba(255,255,255,.94); }
.rank { color: #74a2be; font-size: 10px; font-weight: 850; }
.entity-copy { min-width: 0; }
.entity-copy strong, .entity-copy small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.entity-copy strong { font-size: 12px; }
.entity-copy small { margin-top: 3px; color: #78909f; font-size: 9px; }
.entity-value { color: #1479ad; font-size: 17px; font-weight: 850; }
.entity-value small { margin-left: 2px; font-size: 8px; }

.empty-state, .method-card, .access-card { margin: auto 0; padding: 22px; border: 1px solid rgba(104, 174, 210, .3); border-radius: 16px; background: rgba(255,255,255,.66); }
.access-card.compact { margin: 12px 0 0; padding: 15px; }
.empty-state strong, .method-card strong, .access-card strong { display: block; font-size: 17px; }
.empty-state p, .method-card p, .access-card p { color: #688497; font-size: 12px; line-height: 1.75; }
.empty-state button, .access-card button { padding: 10px 12px; border-radius: 9px; color: white; background: var(--blue); font-weight: 750; }
.province-method-stack { display: grid; gap: 10px; margin: 0; }
.province-method-stack .method-card { margin: 0; }
.province-method-card { border-color: rgba(41, 153, 184, .34); background: linear-gradient(145deg, rgba(255,255,255,.84), rgba(235,249,252,.8)); }
.province-profile-open { margin-top: 10px; padding: 9px 11px; border-radius: 8px; color: white; background: #1785ab; font-size: 10px; font-weight: 850; }
.territory-method-note { padding: 12px 14px; border-left: 4px solid #d08b3c; border-radius: 0 10px 10px 0; background: #fff5e5; }
.territory-method-note strong { color: #95591d; font-size: 12px; }
.territory-method-note p { margin: 4px 0 0; color: #80694f; font-size: 9px; line-height: 1.6; }
.evidence-method-card { display: grid; gap: 6px; padding: 15px; border: 1px solid rgba(111, 177, 213, .25); border-radius: 13px; background: rgba(255,255,255,.7); }
.evidence-method-card strong { margin-bottom: 2px; font-size: 12px; }
.evidence-method-card > span { width: fit-content; padding: 4px 7px; border-radius: 6px; font-size: 8px; font-weight: 850; }
.evidence-method-card .evidence-a { color: #08715f; background: #e3f5ef; }
.evidence-method-card .evidence-b { color: #9a621e; background: #fff0d8; }
.evidence-method-card .evidence-c { color: #9a493b; background: #ffe8e1; }
.evidence-method-card p { margin: 3px 0 0; color: #6e8492; font-size: 9px; line-height: 1.55; }

.batch-stack { display: grid; gap: 7px; }
.batch-context { margin-top: 0; }
.batch-row { display: grid; grid-template-columns: 58px 1fr 1fr; gap: 7px; padding: 9px; border: 1px solid rgba(112, 177, 212, .24); border-radius: 11px; background: rgba(255,255,255,.66); }
.batch-name { display: grid; place-items: center; border-radius: 8px; color: white; background: #4a9bc6; font-size: 11px; font-weight: 850; }
.batch-row.early .batch-name { background: #8c74c5; }
.batch-row.second .batch-name { background: #18a08a; }
.batch-row.third .batch-name { background: #db8b40; }
.batch-row div { display: flex; flex-direction: column; }
.batch-row small { color: #7790a0; font-size: 8px; }
.batch-row strong { margin-top: 2px; font-size: 15px; }
.batch-row p { grid-column: 2 / -1; margin: -1px 0 0; color: #7c929f; font-size: 8px; line-height: 1.4; }

.outside-table { display: flex; flex-direction: column; gap: 6px; }
.outside-table button { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 9px 10px; border: 1px solid rgba(113, 178, 211, .22); border-radius: 10px; color: var(--ink); background: rgba(255,255,255,.64); text-align: left; }
.outside-table span { min-width: 0; }
.outside-table strong, .outside-table small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.outside-table strong { font-size: 11px; }
.outside-table small { margin-top: 3px; color: #7c919f; font-size: 8px; }
.outside-table b { flex: 0 0 auto; color: #1376aa; font-size: 12px; }
.table-empty { color: #728b9c; font-size: 11px; line-height: 1.6; }

.company-tree { display: flex; flex-direction: column; gap: 7px; }
.company-tree article { display: grid; grid-template-columns: 24px 1fr auto; align-items: center; gap: 8px; padding: 9px; border-radius: 10px; background: rgba(255,255,255,.66); }
.tree-index { display: grid; place-items: center; width: 23px; height: 23px; border-radius: 7px; color: white; background: #1b88ba; font-size: 9px; font-weight: 850; }
.company-tree strong, .company-tree small { display: block; }
.company-tree strong { font-size: 11px; }
.company-tree small { margin-top: 3px; color: #78909f; font-size: 8px; }
.company-tree b { color: #1678a9; font-size: 10px; }
.boundary-note { margin: 10px 0 0; padding: 10px; border-left: 3px solid #f0a147; border-radius: 0 8px 8px 0; color: #657f91; background: rgba(255,247,232,.72); font-size: 9px; line-height: 1.65; }
.section-label.compact { margin-top: 11px; }
.direct-unit-chips { display: flex; flex-wrap: wrap; gap: 5px; }
.direct-unit-chips span { padding: 5px 7px; border: 1px solid rgba(104,169,207,.3); border-radius: 7px; color: #3b6d88; background: rgba(255,255,255,.68); font-size: 8px; }
.zhengyuan-region-list { display: grid; grid-template-columns: repeat(2, 1fr); gap: 5px; }
.zhengyuan-region-list button { display: flex; justify-content: space-between; gap: 6px; padding: 7px; border-radius: 8px; color: #426c84; background: rgba(255,255,255,.7); font-size: 8px; text-align: left; }
.zhengyuan-region-list b { color: #0d8b76; }

.panel-launchers { position: absolute; z-index: 17; left: 18px; top: 156px; display: flex; gap: 8px; }
.panel-launchers.left-is-open { left: calc(var(--left-panel-width) + 30px); }
.panel-launchers button { padding: 10px 12px; border: 1px solid var(--line); border-radius: 10px; color: #22668e; background: rgba(255,255,255,.9); font-size: 11px; font-weight: 800; box-shadow: 0 10px 24px rgba(60,121,157,.12); }

.map-controls { position: absolute; z-index: 17; right: clamp(372px, calc(25vw + 42px), 466px); bottom: 66px; display: flex; gap: 5px; padding: 5px; border: 1px solid var(--line); border-radius: 12px; background: rgba(250,253,255,.9); box-shadow: 0 12px 30px rgba(54,115,150,.14); backdrop-filter: blur(14px); }
.map-controls button { padding: 8px 9px; border-radius: 8px; color: #2e6687; background: #eaf5fb; font-size: 10px; font-weight: 800; }
.right-panel.closed ~ .map-controls { right: 18px; }

.source-foot { position: absolute; z-index: 16; left: 18px; right: 18px; bottom: 12px; display: flex; align-items: center; justify-content: center; gap: 18px; min-height: 36px; padding: 7px 14px; border: 1px solid rgba(104, 169, 207, .28); border-radius: 12px; color: #648093; background: rgba(247,252,255,.86); font-size: 9px; box-shadow: 0 10px 25px rgba(67,127,160,.1); backdrop-filter: blur(14px); }
.source-foot b { color: #326d8f; }
.source-foot button { padding: 6px 8px; border-radius: 7px; color: white; background: #338ab7; font-size: 9px; font-weight: 750; }

.data-toast { position: absolute; z-index: 30; left: 50%; bottom: 62px; transform: translateX(-50%); padding: 9px 13px; border-radius: 10px; color: #226384; background: rgba(255,255,255,.94); box-shadow: 0 12px 30px rgba(53,112,147,.14); font-size: 11px; }
.data-toast.error { color: #9a5628; }

.modal-backdrop, .drawer-backdrop { position: fixed; inset: 0; z-index: 80; display: grid; place-items: center; padding: 26px; background: rgba(22, 55, 76, .34); backdrop-filter: blur(10px); }
.modal-card { position: relative; width: min(920px, 94vw); max-height: 88dvh; padding: 28px; border: 1px solid rgba(118, 182, 216, .45); border-radius: 24px; overflow: auto; background: #f8fcff; box-shadow: 0 35px 90px rgba(17,58,83,.3); }
.grid-information-modal { width: min(1560px, 96vw); max-height: 94dvh; overscroll-behavior: contain; }
.all-school-modal { width: min(1180px, 94vw); overscroll-behavior: contain; }
.school-totals-status { color: #587f94; font-size: 12px; }
.modal-card h2 { margin: 7px 0 10px; font-size: 28px; }
.modal-lead { max-width: 760px; margin: 0 0 18px; color: #617f92; font-size: 13px; line-height: 1.75; }
.modal-close { position: absolute; top: 18px; right: 18px; padding: 8px 10px; border-radius: 9px; color: #527286; background: #e7f2f8; font-size: 11px; font-weight: 800; }

.login-layout { display: grid; grid-template-columns: 1.35fr .65fr; gap: 30px; align-items: center; }
.login-copy > p { max-width: 570px; color: #648093; line-height: 1.75; }
.login-copy form { display: grid; gap: 12px; margin-top: 20px; }
.login-copy label { display: grid; gap: 6px; color: #345d75; font-size: 12px; font-weight: 750; }
.login-copy input { width: 100%; padding: 13px 14px; border: 1px solid #bfd9e7; border-radius: 11px; color: var(--ink); background: white; outline: 0; }
.login-copy input:focus { border-color: #268cc3; box-shadow: 0 0 0 4px rgba(38,140,195,.12); }
.password-hint { margin: -5px 0 0; padding: 8px 10px; border: 1px solid #c8e2ef; border-radius: 8px; color: #176f9e; background: #edf8fd; font-size: 12px; font-weight: 850; letter-spacing: .02em; }
.form-error { margin: 0; color: #b84e51; font-size: 11px; }
.primary-button { padding: 13px 16px; border-radius: 11px; color: white; background: linear-gradient(135deg, #157ab8, #20a6c1); font-weight: 850; box-shadow: 0 12px 25px rgba(22,128,183,.22); }
.primary-button:disabled { opacity: .6; cursor: wait; }
.qr-card { padding: 18px; border: 1px solid #c9e0ec; border-radius: 18px; background: white; text-align: center; }
.qr-card img { display: block; width: min(220px, 100%); height: auto; margin: 0 auto; border-radius: 10px; object-fit: contain; }

.source-list { display: flex; flex-direction: column; gap: 8px; max-height: 50dvh; }
.source-list article { display: grid; grid-template-columns: 74px 1fr auto; align-items: start; gap: 12px; padding: 13px; border: 1px solid #d6e7f0; border-radius: 12px; background: white; }
.source-status { padding: 5px 7px; border-radius: 7px; color: #a26525; background: #fff1dd; font-size: 9px; font-weight: 850; text-align: center; }
.source-status.verified { color: #087963; background: #e0f6f0; }
.source-status.derived { color: #236fa1; background: #e5f2fa; }
.source-list strong, .source-list small { display: block; }
.source-list strong { font-size: 12px; }
.source-list small { margin-top: 4px; color: #78909f; font-size: 9px; }
.source-list p { margin: 5px 0 0; color: #778c99; font-size: 9px; }
.source-list a { padding: 7px 8px; border-radius: 8px; color: #1878ab; background: #edf6fb; font-size: 9px; font-weight: 800; text-decoration: none; }
.privacy-callout { display: flex; gap: 12px; margin-top: 14px; padding: 13px; border-left: 4px solid #e49a44; border-radius: 0 10px 10px 0; color: #657d8c; background: #fff7eb; font-size: 11px; line-height: 1.6; }
.privacy-callout strong { flex: 0 0 auto; color: #9b642b; }

.timeline-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
.timeline-grid article { display: flex; flex-direction: column; gap: 7px; padding: 16px; border: 1px solid #d4e7f1; border-radius: 13px; background: white; }
.timeline-grid b { color: #287ca8; font-size: 12px; }
.timeline-grid strong { font-size: 18px; }
.timeline-grid span { color: #6b8494; font-size: 11px; }
.history-note { padding: 10px 12px; border-radius: 9px; color: #7c684c; background: #fff5e7; font-size: 10px; }

.calendar-modal { width: min(1160px, 96vw); max-height: 92dvh; padding: 28px 30px 30px; }
.province-profile-modal { width: min(1240px, 96vw); max-height: 94dvh; padding: 28px 30px 30px; }
.eligibility-modal { width: min(1280px, 96vw); max-height: 94dvh; padding: 25px 27px 27px; }
.calendar-modal .modal-lead { max-width: 930px; margin-bottom: 14px; }
.exam-batch-tabs { position: sticky; z-index: 3; top: -28px; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin: 0 -2px 14px; padding: 12px 2px 10px; background: rgba(248, 252, 255, .96); backdrop-filter: blur(14px); }
.exam-batch-tab { display: flex; min-height: 55px; flex-direction: column; align-items: flex-start; justify-content: center; gap: 3px; padding: 9px 13px; border: 1px solid #cfe3ed; border-radius: 11px; color: #416b83; background: white; text-align: left; transition: transform .18s ease, border-color .18s ease, box-shadow .18s ease, background .18s ease; }
.exam-batch-tab b { font-size: 13px; }
.exam-batch-tab span { color: #7893a3; font-size: 9px; }
.exam-batch-tab:hover { transform: translateY(-1px); border-color: #86c6e7; box-shadow: 0 8px 18px rgba(41, 111, 149, .1); }
.exam-batch-tab.active { border-color: #178dd0; color: #075b92; background: #e9f6fd; box-shadow: inset 0 0 0 1px rgba(23, 141, 208, .16), 0 9px 22px rgba(35, 118, 163, .12); }
.exam-batch-tab.tone-early.active { border-color: #8c6bc4; color: #684b9b; background: #f3eefb; }
.exam-batch-tab.tone-second.active { border-color: #1b9c89; color: #087662; background: #e9f8f4; }
.exam-batch-tab.tone-third.active { border-color: #dd9140; color: #a7621b; background: #fff4e7; }
.exam-batch-tab:focus-visible { outline: 3px solid rgba(26, 133, 196, .24); outline-offset: 2px; }

.year-reference-grid { display: grid; grid-template-columns: .78fr 1.22fr; gap: 10px; margin-bottom: 12px; }
.year-reference-card { display: flex; min-height: 128px; flex-direction: column; gap: 7px; padding: 15px 17px; border: 1px solid #d6e7ef; border-radius: 14px; background: white; }
.year-reference-card.current-year { border-color: #d9d0ee; background: #fbf9ff; }
.year-reference-card.history-year { border-color: #bfe0ec; background: #f4fbfe; }
.year-reference-card > strong { color: #173f5b; font-size: 17px; }
.year-reference-card p { margin: 0; color: #587689; font-size: 11px; line-height: 1.6; }
.year-reference-card small { margin-top: auto; color: #8195a1; font-size: 9px; line-height: 1.5; }
.year-status { align-self: flex-start; padding: 4px 7px; border-radius: 6px; font-size: 9px; font-weight: 850; }
.year-status.pending { color: #785ba2; background: #eee7f9; }
.year-status.verified { color: #087866; background: #dff5ef; }

.exam-timeline-section, .electrical-reference-section, .calendar-source-section { margin-top: 12px; padding: 16px; border: 1px solid #d3e5ee; border-radius: 15px; background: #fff; }
.exam-timeline-section > header, .electrical-reference-section > header, .calendar-source-section > header { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; margin-bottom: 12px; }
.exam-timeline-section h3, .electrical-reference-section h3, .calendar-source-section h3 { margin: 3px 0 0; color: #173f5b; font-size: 18px; }
.timezone-chip, .reference-status { flex: 0 0 auto; padding: 6px 8px; border-radius: 8px; color: #176e99; background: #e8f5fb; font-size: 9px; font-weight: 850; }
.reference-status { color: #9b5c2a; background: #fff0dc; }
.exam-milestone-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.exam-milestone-list > article { display: grid; grid-template-columns: 28px 1fr; gap: 10px; padding: 12px; border: 1px solid #dceaf1; border-radius: 12px; background: #f9fcfe; }
.milestone-index { display: grid; width: 28px; height: 28px; place-items: center; border-radius: 8px; color: white; background: #2c8fc0; font-size: 9px; font-weight: 900; }
.milestone-copy { min-width: 0; }
.milestone-copy > b, .milestone-copy > strong { display: block; }
.milestone-copy > b { color: #2a7ea8; font-size: 10px; }
.milestone-copy > strong { margin-top: 3px; color: #173f5b; font-size: 14px; line-height: 1.35; }
.milestone-copy > p { margin: 5px 0 0; color: #6d8797; font-size: 9px; line-height: 1.6; }
.exam-session-grid { display: grid; gap: 5px; margin-top: 8px; }
.exam-session-grid > span { display: grid; grid-template-columns: minmax(86px, auto) 1fr; gap: 8px; padding: 7px 8px; border-left: 3px solid #52acd1; border-radius: 0 7px 7px 0; background: #edf7fb; }
.exam-session-grid b { color: #0f6f9b; font-size: 9px; white-space: nowrap; }
.exam-session-grid small { color: #617f91; font-size: 9px; line-height: 1.45; }

.electrical-reference-section { border-color: #edd6b9; background: #fffdfa; }
.electrical-reference-groups { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.electrical-reference-groups > article { padding: 12px; border: 1px solid #eadfce; border-radius: 11px; background: white; }
.electrical-reference-groups > article:last-child:nth-child(odd) { grid-column: 1 / -1; }
.electrical-reference-groups h4 { margin: 0 0 8px; color: #905a2b; font-size: 13px; }
.electrical-reference-groups dl { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; margin: 0; }
.electrical-reference-groups dl > div { min-width: 0; padding: 8px; border-radius: 8px; background: #fff8ef; }
.electrical-reference-groups dt { color: #8d7966; font-size: 8px; line-height: 1.4; }
.electrical-reference-groups dd { margin: 4px 0 0; color: #533a25; font-size: 10px; font-weight: 800; line-height: 1.45; word-break: break-word; }
.reference-notes { margin: 10px 0 0; padding: 9px 10px 9px 26px; border-radius: 9px; color: #846f59; background: #fff5e8; font-size: 9px; line-height: 1.65; }

.calendar-source-section > header span { color: #7a8f9c; font-size: 9px; }
.calendar-source-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px; }
.calendar-source-list article { display: grid; grid-template-columns: 66px 1fr auto; align-items: start; gap: 8px; padding: 10px; border: 1px solid #dce9ef; border-radius: 10px; background: #f9fcfe; }
.calendar-source-list strong, .calendar-source-list small { display: block; }
.calendar-source-list strong { color: #315f77; font-size: 9px; line-height: 1.45; }
.calendar-source-list small { margin-top: 3px; color: #8194a0; font-size: 8px; line-height: 1.45; }
.calendar-source-list a { padding: 5px 7px; border-radius: 6px; color: #1477aa; background: #e6f3f9; font-size: 8px; font-weight: 850; text-decoration: none; white-space: nowrap; }
.calendar-boundary-note { display: flex; gap: 10px; margin-top: 12px; padding: 11px 13px; border-left: 4px solid #d89143; border-radius: 0 10px 10px 0; color: #765f47; background: #fff5e7; font-size: 9px; line-height: 1.65; }
.calendar-boundary-note strong { flex: 0 0 auto; color: #9b5c22; }

.drawer-backdrop { place-items: stretch end; padding: 0; }
.detail-drawer { width: min(520px, 100vw); height: 100dvh; padding: 28px; overflow-y: auto; background: #f8fcff; box-shadow: -30px 0 80px rgba(18,58,81,.28); }
.detail-drawer:focus { outline: 3px solid rgba(29,112,170,.34); outline-offset: -3px; }
.drawer-close { float: right; padding: 8px 10px; border-radius: 9px; color: #527286; background: #e7f2f8; font-size: 11px; font-weight: 800; }
.detail-drawer h2 { margin: 8px 0 5px; padding-right: 75px; font-size: 29px; }
.detail-meta { margin: 0 0 14px; color: #6b8494; font-size: 12px; }
.tier-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 16px; }
.tier-tags span { padding: 6px 8px; border: 1px solid #b9d9e9; border-radius: 8px; color: #246d93; background: #eaf6fc; font-size: 10px; font-weight: 750; }
.detail-hero { padding: 20px; border-radius: 16px; color: white; background: linear-gradient(135deg, #176fa9, #21a5be); box-shadow: 0 18px 40px rgba(20,120,169,.2); }
.detail-hero span, .detail-hero small { display: block; opacity: .82; }
.detail-hero strong { display: block; margin: 4px 0; font-size: 42px; }
.batch-detail-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 12px; }
.batch-detail-grid article { padding: 12px; border: 1px solid #d0e4ee; border-radius: 12px; background: white; }
.batch-detail-grid span, .batch-detail-grid small { display: block; color: #708a9a; font-size: 9px; }
.batch-detail-grid strong { display: block; margin: 5px 0; color: #176f9e; font-size: 19px; }
.ratio-warning { margin: 13px 0; padding: 12px; border-left: 4px solid #eba04a; border-radius: 0 10px 10px 0; color: #6b7e89; background: #fff7ea; font-size: 11px; line-height: 1.7; }
.ratio-warning b { color: #9d642b; }
.detail-facts { margin: 0; border-top: 1px solid #d7e7ef; }
.detail-facts div { display: grid; grid-template-columns: 115px 1fr; gap: 12px; padding: 11px 0; border-bottom: 1px solid #dfeaf0; }
.detail-facts dt { color: #708897; font-size: 10px; }
.detail-facts dd { margin: 0; font-size: 11px; font-weight: 700; }
.company-detail-list { display: grid; gap: 8px; }
.company-detail-list article { display: grid; grid-template-columns: 70px 1fr; gap: 5px 10px; padding: 12px; border: 1px solid #d8e8f0; border-radius: 11px; background: white; }
.company-detail-list strong { color: #1675a6; }
.company-detail-list small { grid-column: 2; color: #748c9a; }
.recruiting-unit-list { display: grid; gap: 6px; margin-top: 12px; }
.recruiting-unit-list article { padding: 10px; border: 1px solid #d8e8f0; border-radius: 10px; background: white; }
.recruiting-unit-list strong, .recruiting-unit-list small { display: block; }
.recruiting-unit-list strong { font-size: 11px; }
.recruiting-unit-list small { margin-top: 4px; color: #748b99; font-size: 9px; }
.detail-source { margin-top: 18px; padding: 14px; border: 1px solid #cee2ec; border-radius: 12px; background: #eef8fc; }
.detail-source p { color: #668193; font-size: 10px; line-height: 1.65; }
.detail-source button { padding: 8px 10px; border-radius: 8px; color: white; background: #2f88b5; font-size: 10px; font-weight: 800; }

.map-stage-enter-active, .map-stage-leave-active { transition: opacity .38s ease, transform .48s cubic-bezier(.2,.8,.2,1), filter .38s ease; }
.map-stage-enter-from { opacity: 0; transform: scale(.955); filter: blur(7px) saturate(.75); }
.map-stage-leave-to { opacity: 0; transform: scale(1.035); filter: blur(6px) saturate(.78); }
.title-swap-enter-active, .title-swap-leave-active { transition: opacity .24s ease, transform .3s cubic-bezier(.2,.8,.2,1); }
.title-swap-enter-from { opacity: 0; transform: translateY(8px); }
.title-swap-leave-to { opacity: 0; transform: translateY(-6px); }
.level-guide-enter-active, .level-guide-leave-active { transition: opacity .24s ease, transform .32s cubic-bezier(.2,.8,.2,1); }
.level-guide-enter-from, .level-guide-leave-to { opacity: 0; transform: translateX(-18px) scale(.98); }
.map-toast-enter-active, .map-toast-leave-active { transition: opacity .2s ease, transform .28s cubic-bezier(.2,.8,.2,1); }
.map-toast-enter-from, .map-toast-leave-to { opacity: 0; transform: translateY(-7px); }
.modal-pop-enter-active, .modal-pop-leave-active { transition: opacity .24s ease, backdrop-filter .24s ease; }
.modal-pop-enter-active .modal-card, .modal-pop-leave-active .modal-card { transition: opacity .24s ease, transform .32s cubic-bezier(.2,.8,.2,1); }
.modal-pop-enter-from, .modal-pop-leave-to { opacity: 0; backdrop-filter: blur(0); }
.modal-pop-enter-from .modal-card, .modal-pop-leave-to .modal-card { opacity: 0; transform: translateY(16px) scale(.975); }
.drawer-slide-enter-active, .drawer-slide-leave-active { transition: opacity .24s ease; }
.drawer-slide-enter-active .detail-drawer, .drawer-slide-leave-active .detail-drawer { transition: transform .36s cubic-bezier(.2,.8,.2,1), box-shadow .3s ease; }
.drawer-slide-enter-from, .drawer-slide-leave-to { opacity: 0; }
.drawer-slide-enter-from .detail-drawer, .drawer-slide-leave-to .detail-drawer { transform: translateX(100%); box-shadow: none; }

.left-panel { animation: panel-in-left .56s cubic-bezier(.2,.8,.2,1) both; }
.right-panel { animation: panel-in-right .56s cubic-bezier(.2,.8,.2,1) both; }
@keyframes panel-in-left { from { opacity: 0; transform: translateX(-24px); } }
@keyframes panel-in-right { from { opacity: 0; transform: translateX(24px); } }

.live-mode { font-size: 108%; }
.live-mode .panel-head h2 { font-size: 21px; }
.live-mode .section-label span { font-size: 14px; }
.live-mode .entity-copy strong, .live-mode .outside-table strong, .live-mode .company-tree strong { font-size: 14px; }
.live-mode .entity-copy small, .live-mode .outside-table small, .live-mode .company-tree small { font-size: 11px; }
.live-mode .entity-value { font-size: 20px; }
.live-mode .summary-card strong { font-size: 24px; }
.live-mode .batch-row strong { font-size: 17px; }
.live-mode .countdown-heading strong { font-size: 13px; }
.live-mode .countdown-item b { font-size: 11px; }
.live-mode .exam-batch-tab { min-height: 58px; }
.live-mode .exam-batch-tab b { font-size: 15px; }
.live-mode .year-reference-card > strong, .live-mode .exam-timeline-section h3, .live-mode .electrical-reference-section h3 { font-size: 20px; }
.live-mode .year-reference-card p, .live-mode .milestone-copy > strong { font-size: 14px; }
.live-mode .milestone-copy > p, .live-mode .exam-session-grid small, .live-mode .electrical-reference-groups dd { font-size: 12px; }
@media (max-width: 1440px) {
  .dashboard-shell { --left-panel-width: 300px; --right-panel-width: 330px; }
  .top-shell { padding: 0 14px; }
  .brand-icon { width: 28px; height: 28px; }
  .brand-block strong { font-size: 16px; }
  .mode-tabs button { min-width: 118px; padding: 11px 16px; }
  .top-actions { flex-wrap: wrap; justify-content: flex-end; gap: 4px; overflow: visible; max-width: calc(50% - 132px); }
  .top-actions button { min-height: 27px; padding: 5px 7px; font-size: 10px; }
  .hero-stack { width: min(760px, calc(100vw - var(--left-panel-width) - var(--right-panel-width) - 66px)); }
  .countdown-heading small { display: none; }
  .countdown-heading { padding: 0 3px; }
  .countdown-item { padding: 4px 3px; }
  .ion-layer { top: 150px; right: calc(var(--right-panel-width) + 24px); left: calc(var(--left-panel-width) + 24px); }
  .map-controls { right: 366px; }
}

@media (min-width: 1201px) and (max-width: 1440px) {
  .countdown-heading, .countdown-item strong { display: none; }
  .countdown-item b { padding: 5px 3px; }
}

@media (max-width: 1200px) {
  .top-shell { height: 64px; padding: 0 10px; }
  .brand-block { display: none; }
  .countdown-strip { top: 7px; right: calc(50% + 174px); left: 10px; height: 50px; }
  .hero-stack { top: 76px; width: calc(100vw - 24px); }
  .title-block h1 { font-size: clamp(25px, 3vw, 34px); }
  .overlay-card { top: 88px; bottom: 56px; width: min(360px, calc(100vw - 24px)); }
  .left-panel { left: 12px; }
  .right-panel { right: 12px; }
  .ion-layer { top: 138px; right: 12px; left: 12px; }
  .panel-launchers { top: 146px; left: 12px; }
  .panel-launchers.left-is-open { right: 12px; left: auto; }
  .map-controls, .right-panel.closed ~ .map-controls { right: 12px; bottom: 58px; }
  .source-foot { left: 10px; right: 10px; gap: 8px; }
  .source-foot span:nth-child(2) { display: none; }
}

@media (max-width: 720px) {
  .top-shell { height: 58px; padding: 0 8px; }
  .mode-tabs button { min-width: 84px; padding: 9px 10px; }
  .live-mode-action, .source-action { display: none; }
  .top-actions button { min-height: 36px; padding: 8px 9px; }
  .top-actions { max-width: calc(50% - 100px); }
  .countdown-strip { top: 7px; right: calc(50% + 102px); left: 8px; height: 44px; justify-content: center; padding: 4px; }
  .countdown-heading { align-items: center; padding: 0; }
  .countdown-heading strong { font-size: 10px; }
  .countdown-heading small { display: block; font-size: 7px; }
  .countdown-cells { display: none; }
  .hero-stack { top: 69px; width: calc(100vw - 20px); }
  .title-block { min-height: 36px; white-space: normal; }
  .title-block h1 { font-size: 20px; }
  .title-block p { display: none; }
  .hero-return { top: 0; width: 36px; height: 36px; border-radius: 10px; }
  .hero-return svg { width: 18px; height: 18px; }
  .map-announcement { top: 112px; right: 10px; left: 50%; max-width: calc(100vw - 20px); text-align: center; }
  .overlay-card { top: 116px; bottom: 54px; }
  .ion-layer { top: 108px; right: 0; left: 0; }
  .panel-launchers { top: 124px; flex-direction: column; }
  .panel-launchers.left-is-open { right: 10px; left: auto; }
  .map-controls { left: 50%; right: auto !important; bottom: 51px; transform: translateX(-50%); }
  .map-controls button { padding: 7px; font-size: 9px; }
  .source-foot { justify-content: space-between; }
  .source-foot span { display: none; }
  .source-foot span:first-child { display: block; }
  .login-layout { grid-template-columns: 1fr; }
  .qr-card img { width: 170px; }
  .modal-card { padding: 22px 18px; }
  .modal-card h2 { font-size: 23px; }
  .timeline-grid { grid-template-columns: 1fr; }
  .calendar-modal { width: calc(100vw - 14px); max-height: 94dvh; padding: 22px 15px 20px; }
  .province-profile-modal { width: calc(100vw - 14px); max-height: 96dvh; padding: 22px 15px 20px; }
  .eligibility-modal { width: calc(100vw - 10px); max-height: 96dvh; padding: 18px 10px 14px; }
  .exam-batch-tabs { top: -22px; gap: 5px; margin-bottom: 10px; padding-top: 10px; }
  .exam-batch-tab { min-height: 48px; padding: 7px 8px; }
  .exam-batch-tab b { font-size: 11px; }
  .exam-batch-tab span { display: none; }
  .year-reference-grid, .exam-milestone-list, .electrical-reference-groups, .calendar-source-list { grid-template-columns: 1fr; }
  .electrical-reference-groups > article:last-child:nth-child(odd) { grid-column: auto; }
  .exam-timeline-section, .electrical-reference-section, .calendar-source-section { padding: 12px; }
  .exam-session-grid > span { grid-template-columns: 1fr; gap: 3px; }
  .calendar-source-list article { grid-template-columns: 62px 1fr; }
  .calendar-source-list a { grid-column: 2; justify-self: start; }
  .source-list article { grid-template-columns: 64px 1fr; }
  .source-list a { grid-column: 2; justify-self: start; }
  .detail-drawer { padding: 22px 18px; }
  .batch-detail-grid { grid-template-columns: 1fr; }
}

@media (max-width: 420px) {
  .mode-tabs button { min-width: 72px; gap: 4px; padding: 9px 7px; font-size: 12px; }
  .mode-tabs button svg { display: none; }
  .top-actions button { padding: 8px; font-size: 10px; }
  .top-actions button svg { display: none; }
  .title-block { padding: 0 39px; }
  .title-block h1 { font-size: 17px; }
  .source-foot { min-height: 34px; padding: 5px 8px; }
  .source-foot button { padding: 5px 7px; }
  .exam-batch-tabs { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .electrical-reference-groups dl { grid-template-columns: 1fr; }
  .calendar-boundary-note { display: grid; }
}

:global(html.touch-desktop-canvas),
:global(html.touch-desktop-canvas body),
:global(html.touch-desktop-canvas #app) {
  background: #d9edf8;
}

/* Keep recruitment dates next to the right-hand details, never over the title. */
.countdown-strip.recruitment-node-dock {
  z-index: 19; top: 84px; right: 18px; left: auto;
  width: var(--right-panel-width); height: 48px; box-sizing: border-box;
  gap: 3px; padding: 4px 6px; border-color: #b4d8ec;
  color: #246184; background: rgba(245,252,255,.97); backdrop-filter: none;
  box-shadow: 0 5px 16px rgba(25,100,144,.1);
}
.recruitment-node-dock .countdown-heading { display: flex; color: #21597a; padding: 0 5px; }
.recruitment-node-dock .countdown-heading strong { font-size: 10px; }
.recruitment-node-dock .countdown-heading small { display: none; }
.recruitment-node-dock .countdown-cells { display: grid; }
.recruitment-node-dock .countdown-item { min-height: 36px; padding: 3px; border-color: #d3e8f3; }
.recruitment-node-dock .countdown-item b { color: #237393; background: #e5f4fc; padding: 3px 4px; }
.recruitment-node-dock .countdown-item strong { display: block; color: #658b9f; }
.dashboard-shell .right-panel { top: 144px; }
.dashboard-shell :deep(.embedded .result-panel) { top: 144px; }
@media (max-width: 1200px) {
  .countdown-strip.recruitment-node-dock { top: 116px; right: 12px; width: min(360px, calc(100% - 24px)); }
  .dashboard-shell .right-panel, .dashboard-shell :deep(.embedded .result-panel) { top: 174px; }
}

.touch-performance-mode .overlay-card,
.touch-performance-mode .countdown-strip,
.touch-performance-mode .map-controls,
.touch-performance-mode .source-foot,
.touch-performance-mode .modal-backdrop,
.touch-performance-mode .drawer-backdrop,
.touch-performance-mode .exam-batch-tabs {
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
}

.touch-performance-mode .overlay-card { background: rgba(248, 253, 255, .98); }
.touch-performance-mode .left-panel.closed,
.touch-performance-mode .right-panel.closed { visibility: hidden; }
.touch-performance-mode .map-stage-enter-active,
.touch-performance-mode .map-stage-leave-active { transition: opacity .2s ease, transform .24s ease; }
.touch-performance-mode .map-stage-enter-from,
.touch-performance-mode .map-stage-leave-to { filter: none; }

@media (prefers-reduced-motion: reduce) {
  .mode-tab-thumb, .mode-tabs button { transition: none; }
  .left-panel, .right-panel { animation: none; }
  .ion-layer { opacity: .42; }
  .map-stage-enter-active, .map-stage-leave-active,
  .title-swap-enter-active, .title-swap-leave-active,
  .level-guide-enter-active, .level-guide-leave-active,
  .map-toast-enter-active, .map-toast-leave-active,
  .modal-pop-enter-active, .modal-pop-leave-active,
  .modal-pop-enter-active .modal-card, .modal-pop-leave-active .modal-card,
  .drawer-slide-enter-active, .drawer-slide-leave-active,
  .drawer-slide-enter-active .detail-drawer, .drawer-slide-leave-active .detail-drawer,
  .hero-return { transition: none; }
  .map-stage-enter-from, .map-stage-leave-to,
  .level-guide-enter-from, .level-guide-leave-to,
  .map-toast-enter-from, .map-toast-leave-to,
  .modal-pop-enter-from .modal-card, .modal-pop-leave-to .modal-card,
  .drawer-slide-enter-from .detail-drawer, .drawer-slide-leave-to .detail-drawer { transform: none; filter: none; }
}
</style>
<style src="./glass-map-shell.css"></style>
