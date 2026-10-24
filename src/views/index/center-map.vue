<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { getMap, registerMap } from "echarts/core";
import { createProvinceBaseSeries, createProvinceElevationSeries, provinceElevationMode, provinceFaceFromMap,
  provinceFacesFromMap, provinceMapLayout, provinceReliefTarget, provinceKeyboardTarget,
  PROVINCE_ELEVATION_SERIES_ID } from "./map-elevation";
import {
  GRID_TERRITORIES,
  getGridTerritory,
  type GridTerritory,
  type ProvinceInsight,
  type ProvinceInsights,
} from "@/data/grid-territories";

type MapLevel = "national" | "hubei" | "province";
type MapCenter = [number, number];
type PointKind = "entity" | "city";
type DashboardMode = "school" | "company";

interface RegionMetric {
  name: string;
  value: number | null;
  coverage: "演示" | "待接入" | "已接入";
  metricLabel?: string;
}

interface GeoJsonGeometry {
  type?: string;
  coordinates?: unknown;
}

interface GeoJsonFeature {
  geometry?: GeoJsonGeometry;
}

interface GeoJsonCollection {
  features?: GeoJsonFeature[];
}

interface CompatibleMapPoint {
  id?: string | number;
  name?: string;
  shortName?: string;
  city?: string;
  category?: string;
  metricLabel?: string;
  metricValue?: number | null;
  metricText?: string;
  valueStatus?: string;
  positionStatus?: string;
  coordinates?: MapCenter;
  value?: Array<number | string | null>;
  symbolOffset?: [number, number];
  labelShow?: boolean;
  tooltipSections?: { label: string; value: string }[];
  adcode?: string | number;
}

interface NormalizedMapPoint {
  id: string;
  name: string;
  fullName: string;
  city: string;
  category: string;
  metricLabel: string;
  metricText: string;
  valueStatus: string;
  positionStatus: string;
  tooltipSections: { label: string; value: string }[];
  pointKind: PointKind;
  sourcePoint: CompatibleMapPoint;
  symbolOffset?: [number, number];
  label?: { show: boolean };
  value: [number, number, number | null];
  itemStyle: Record<string, unknown>;
}

interface ChartExposed {
  $el?: HTMLElement;
  // vue-echarts exposes the ECharts instance publicly. Its component setOption
  // wrapper is deliberately disabled unless the entire chart is manual-update.
  chart?: {
    setOption: (option: Record<string, unknown>, options?: { lazyUpdate?: boolean }) => void;
    isDisposed: () => boolean;
  };
  getOption?: () => {
    geo?: Array<{
      zoom?: number;
      center?: MapCenter;
    }>;
  };
  dispatchAction?: (
    payload: Record<string, unknown>,
    options?: { silent?: boolean; flush?: boolean },
  ) => void;
  convertFromPixel?: (finder: { geoIndex: number }, value: [number, number]) => unknown;
}

type RoamDirection = "in" | "out" | "pan" | "reset";

interface GeoRoamPayload {
  zoom: number;
  center: MapCenter | null;
  focus: MapCenter | null;
  focusRegion: string;
  direction: RoamDirection;
}

interface GeoRoamEvent {
  geoId?: string;
  zoom?: number;
  originX?: number;
  originY?: number;
  dx?: number;
  dy?: number;
}

interface ZrPinchEvent {
  pinchScale?: number;
  pinchX?: number;
  pinchY?: number;
  __ecRoamConsumed?: boolean;
  event?: {
    cancelable?: boolean;
    preventDefault?: () => void;
  };
}

interface ProvinceClickPayload {
  name: string;
  adcode?: string;
}

interface ProvincePreviewPayload extends ProvinceClickPayload {
  territory: GridTerritory;
  insight: ProvinceInsight;
}

interface RegionClickPayload extends ProvinceClickPayload {
  provinceName?: string;
}

interface EntityClickPayload {
  id: string;
  name: string;
  pointKind: PointKind;
  point: CompatibleMapPoint;
}

const provinceAdcodes: Record<string, string> = Object.fromEntries(
  GRID_TERRITORIES.map((territory) => [territory.name, territory.adcode]),
);

const provinceAliases: Record<string, string> = Object.fromEntries(
  GRID_TERRITORIES.flatMap((territory) => [
    [territory.name, territory.adcode],
    [territory.shortName, territory.adcode],
  ]),
);

const props = withDefaults(
  defineProps<{
    level?: MapLevel;
    provinceName?: string;
    provinceAdcode?: string | number;
    zoom?: number;
    center?: MapCenter | null;
    points?: CompatibleMapPoint[];
    cityPoints?: CompatibleMapPoint[];
    mode?: DashboardMode;
    eligibilityMode?: boolean;
    regionMetrics?: RegionMetric[];
    provinceInsights?: ProvinceInsights;
    activeEntityId?: string;
    activeRegion?: string;
    // Undefined keeps map-local hover; an explicit empty string clears a parent-controlled preview.
    activeProvinceAdcode?: string;
    // A selected/filter province remains raised after transient hover/focus ends.
    selectedProvinceAdcode?: string;
    contextPreview?: boolean;
    ariaLabel?: string;
  }>(),
  {
    level: "national",
    provinceName: "",
    provinceAdcode: "",
    points: () => [],
    cityPoints: () => [],
    mode: "school",
    eligibilityMode: false,
    regionMetrics: () => [],
    provinceInsights: () => ({}),
    activeEntityId: "",
    activeRegion: "",
    selectedProvinceAdcode: "",
    contextPreview: false,
    ariaLabel: "",
  },
);

const emit = defineEmits<{
  (event: "province-click", payload: ProvinceClickPayload): void;
  (event: "province-select", payload: ProvinceClickPayload): void;
  (event: "region-click", payload: RegionClickPayload): void;
  (event: "entity-click", payload: EntityClickPayload): void;
  (event: "georoam", payload: GeoRoamPayload): void;
  (event: "region-preview", payload: ProvincePreviewPayload): void;
  (event: "region-preview-end", payload: ProvincePreviewPayload | null): void;
  (event: "entity-preview", id: string): void;
  (event: "entity-preview-end", id: string | null): void;
  // Legacy events kept while the parent dashboard migrates to the new API.
  (event: "drill-hubei"): void;
  (event: "select-entity", id: string): void;
  (event: "select-region", name: string): void;
  (event: "unavailable-province", name: string): void;
}>();

const chartRef = ref<ChartExposed | null>(null);
const option = ref<Record<string, unknown>>({});
const loading = ref(true);
const loadError = ref("");
const internalZoom = ref(1);
const internalCenter = ref<MapCenter | null>(null);
const touchPerformanceMode = typeof document !== "undefined"
  && document.documentElement.classList.contains("touch-performance-mode");
const touchDesktopCanvas = typeof document !== "undefined"
  && document.documentElement.classList.contains("touch-desktop-canvas");
// A tablet needs a canvas close to its physical width rather than an
// oversampled one, but the same downsample on a large touch all-in-one just
// renders a blurry map. Scale by the actual display instead of a constant, and
// never drop below 1 device pixel on a wide screen.
const displayPixelRatio = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
const wideDisplay = typeof window !== 'undefined' && window.innerWidth >= 1600;
const canvasPixelRatio = !touchPerformanceMode
  ? Math.min(displayPixelRatio, 2)
  : touchDesktopCanvas && !wideDisplay
    ? 0.65
    : Math.min(Math.max(displayPixelRatio, 1), 2);
const chartInitOptions = { devicePixelRatio: canvasPixelRatio };
const chartAutoresize = touchPerformanceMode ? { throttle: 180 } : true;
const minZoom = touchPerformanceMode ? 0.72 : 0.55;
const maxZoom = 8;
const MAP_REQUEST_TIMEOUT_MS = 15_000;
let refreshSequence = 0;
let activeMapRequest: AbortController | null = null;
let mapRequestTimeout: number | undefined;
let roamFrameId = 0;
let pendingRoamEvent: GeoRoamEvent | null = null;
let roamSettleTimer: number | undefined;
let nativeRoamPending = false;
let pendingPinchScale = 1;
let pendingPinchOrigin: [number, number] | null = null;
let lastPinchDispatchAt = 0;
let pinchTrailingTimer: number | undefined;
let hubeiGeometryCache: any = null;
const hoveredProvinceAdcode = ref("");
const keyboardProvinceAdcode = ref("");
const keyboardProvinceAnnouncement = ref("");
const elevationSuspended = ref(false);
const documentHidden = ref(typeof document !== "undefined" && document.hidden);
const motionPreference = typeof window !== "undefined" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
const hoverPreference = typeof window !== "undefined" ? window.matchMedia("(any-hover: hover) and (any-pointer: fine)") : null;
const reduceElevationMotion = ref(motionPreference?.matches ?? false);
const allowPointerElevation = ref(hoverPreference?.matches ?? false);
const narrowMapViewport = ref(typeof window !== 'undefined' && window.innerWidth <= 800);
const activeProvinceAdcode = computed(() => props.activeProvinceAdcode ?? hoveredProvinceAdcode.value);
const reliefTarget = computed(() => provinceReliefTarget(activeProvinceAdcode.value,
  props.selectedProvinceAdcode, elevationSuspended.value));
let elevationFrameId = 0;
let pointerIsDown = false;

const resolvedProvinceAdcode = computed(() => {
  if (props.level === "national") return "";
  if (props.level === "hubei") return "420000";
  const explicitAdcode = String(props.provinceAdcode || "").trim();
  if (/^\d{6}$/.test(explicitAdcode)) return explicitAdcode;
  return provinceAliases[props.provinceName.trim()] ?? "";
});
const mapKey = computed(() => (props.level === "national" ? "china" : resolvedProvinceAdcode.value));
const mapFile = computed(() => (props.level === "national" ? "china.json" : `${resolvedProvinceAdcode.value}.json`));
const apiBaseUrl = String(import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
const currentProvinceName = computed(() => {
  if (props.level === "national") return "全国";
  if (props.level === "hubei") return "湖北省";
  return props.provinceName || "省级地图";
});
const mapAriaLabel = computed(() => {
  if (props.ariaLabel) return props.ariaLabel;
  if (props.level === "national") {
    return "全国电网招聘数据地图；国家电网和南方电网按经营区区分，进入省级地图需账号权限";
  }
  return `${currentProvinceName.value}电网招聘数据地图，继续缩小可自动返回全国，点击地图点位可查看详情`;
});

const clampZoom = (zoom: number) => Math.min(maxZoom, Math.max(minZoom, zoom));
const defaultZoom = () => (props.level === "national" ? 1 : 1.04);
const normalizeCenter = (center: unknown): MapCenter | null => {
  if (!Array.isArray(center) || center.length < 2) return null;
  const longitude = Number(center[0]);
  const latitude = Number(center[1]);
  return Number.isFinite(longitude) && Number.isFinite(latitude) ? [longitude, latitude] : null;
};

const pointInRing = ([longitude, latitude]: MapCenter, ring: unknown): boolean => {
  if (!Array.isArray(ring) || ring.length < 3) return false;
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const currentPoint = normalizeCenter(ring[index]);
    const previousPoint = normalizeCenter(ring[previous]);
    if (!currentPoint || !previousPoint) continue;
    const [currentLongitude, currentLatitude] = currentPoint;
    const [previousLongitude, previousLatitude] = previousPoint;
    const intersects = (currentLatitude > latitude) !== (previousLatitude > latitude)
      && longitude < ((previousLongitude - currentLongitude) * (latitude - currentLatitude))
        / (previousLatitude - currentLatitude) + currentLongitude;
    if (intersects) inside = !inside;
  }
  return inside;
};

const pointInPolygon = (point: MapCenter, polygon: unknown): boolean => {
  if (!Array.isArray(polygon) || !pointInRing(point, polygon[0])) return false;
  return !polygon.slice(1).some((hole) => pointInRing(point, hole));
};

const pointInGeometry = (point: MapCenter, geometry: any): boolean => {
  if (geometry?.type === "Polygon") return pointInPolygon(point, geometry.coordinates);
  if (geometry?.type === "MultiPolygon" && Array.isArray(geometry.coordinates)) {
    return geometry.coordinates.some((polygon: unknown) => pointInPolygon(point, polygon));
  }
  return false;
};

const regionAtCoordinate = (point: MapCenter | null): string => {
  if (!point || props.level !== "national") return "";
  if (!hubeiGeometryCache) {
    const registeredMap = getMap(mapKey.value);
    const geoJson = registeredMap?.geoJSON ?? registeredMap?.geoJson;
    const hubeiFeature = Array.isArray(geoJson?.features)
      ? geoJson.features.find((candidate: any) => String(candidate?.properties?.name ?? "") === "湖北省")
      : null;
    hubeiGeometryCache = hubeiFeature?.geometry ?? null;
  }
  return hubeiGeometryCache && pointInGeometry(point, hubeiGeometryCache) ? "湖北省" : "";
};
const resetInternalCamera = () => {
  internalZoom.value = clampZoom(typeof props.zoom === "number" ? props.zoom : defaultZoom());
  internalCenter.value = normalizeCenter(props.center);
};

const ensureMap = async (signal: AbortSignal) => {
  const key = mapKey.value;
  if (!key) throw new Error(`未找到${props.provinceName || "当前省份"}的行政区划底图，请传入 provinceAdcode`);
  if (!getMap(key)) {
    const national = props.level === "national";
    const mapUrl = national
      ? `${import.meta.env.BASE_URL}map-geojson/${mapFile.value}`
      : `${apiBaseUrl}/api/v2/private/map-geojson/${resolvedProvinceAdcode.value}`;
    // The national outline is a public, static file the server already serves
    // with max-age=86400; forcing no-store re-downloaded 256 KB on every load.
    // Province geometry stays no-store: it is session-bound and must not sit in
    // a shared or persisted cache after access changes.
    const response = await fetch(mapUrl, {
      credentials: "include",
      ...(national ? {} : { cache: "no-store" as const }),
      headers: { Accept: "application/json" },
      signal,
    });
    if (!response.ok) throw new Error(`地图文件加载失败：${response.status}`);
    registerMap(key, await response.json());
  }
};

const cancelMapRequest = () => {
  if (mapRequestTimeout !== undefined) {
    window.clearTimeout(mapRequestTimeout);
    mapRequestTimeout = undefined;
  }
  activeMapRequest?.abort();
  activeMapRequest = null;
};

const escapeHtml = (value: unknown) => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const shortRegionName = (name: string) => name
  .replace("土家族苗族自治州", "").replace("维吾尔自治区", "")
  .replace("壮族自治区", "").replace("回族自治区", "")
  .replace("特别行政区", "").replace("自治区", "").replace(/省$|市$|林区$/, "");

const fallbackProvinceInsight = (territory: GridTerritory): ProvinceInsight => ({
  operatorLabel: territory.operatorLabel,
  scopeNote: territory.scopeNote,
  entryEnabled: territory.canEnterStateGridMap,
  eligibilityLabel: territory.qualificationLabel,
  eligibilityTone: territory.entryStatus,
  plannedHeadcount: "待补",
  applicationCount: "待补",
  examAttendance: "待补",
  admissionCount: "待补",
  sourceYear: "年份待补",
  sourceStatus: "官方来源待补",
});

const resolveProvinceInsight = (territory: GridTerritory): ProvinceInsight => ({
  ...fallbackProvinceInsight(territory),
  ...(props.provinceInsights[territory.adcode]
    ?? props.provinceInsights[territory.name]
    ?? props.provinceInsights[territory.shortName]
    ?? {}),
});

const resolveProvincePreview = (nameOrAdcode: string | number): ProvincePreviewPayload | null => {
  const territory = getGridTerritory(nameOrAdcode)
    ?? getGridTerritory(provinceAliases[String(nameOrAdcode).trim()]);
  if (!territory) return null;
  return {
    name: territory.name,
    adcode: territory.adcode,
    territory,
    insight: resolveProvinceInsight(territory),
  };
};

const cleanInsightText = (value: unknown) => {
  const text = String(value ?? "").trim();
  return text || "待补";
};

// Glass mode keeps every province close to the page background, but the three
// operators still need to read apart at a glance; the legend names them.
const GLASS_OPERATOR_FILL: Record<string, string> = {
  // Pulled further apart in hue and weight: the two main operators were too
  // close to tell apart against the same pale background.
  sgcc: 'rgba(104,160,206,.26)',
  csg: 'rgba(104,192,166,.30)',
  mixed: 'rgba(176,150,212,.28)',
  not_applicable: 'rgba(163,174,183,.10)',
};
const glassTerritoryFill = (territory: GridTerritory) =>
  GLASS_OPERATOR_FILL[territory.operator] ?? GLASS_OPERATOR_FILL.sgcc!;
const territoryAreaColor = (territory: GridTerritory) => {
  if (resolveProvinceInsight(territory).entryEnabled) return "#bdddf7";
  if (territory.entryStatus === "enabled") return "#bdddf7";
  if (territory.entryStatus === "mixed") return "#c8d9df";
  if (territory.entryStatus === "disabled") return "#d9e2e8";
  return "#e8edf0";
};

const territoryEmphasisColor = (territory: GridTerritory, insight: ProvinceInsight) => {
  if (insight.entryEnabled) return "#8fc8ee";
  if (territory.entryStatus === "mixed") return "#c2d3d9";
  if (territory.entryStatus === "disabled") return "#d4dde3";
  return "#e4e9ec";
};

const regionColor = (metric: RegionMetric | undefined, name: string) => {
  if (props.activeRegion === name) return "#529fd7";
  if (!metric || metric.value === null) return "#d1e7f6";
  if (metric.value >= 6) return "#8fc3e9";
  if (metric.value >= 3) return "#acd3ef";
  return "#c3e0f3";
};

const coordinatesOf = (point: CompatibleMapPoint): MapCenter | null => {
  const source = point.coordinates ?? point.value;
  if (!Array.isArray(source) || source.length < 2) return null;
  const longitude = Number(source[0]);
  const latitude = Number(source[1]);
  return Number.isFinite(longitude) && Number.isFinite(latitude) ? [longitude, latitude] : null;
};
const normalizePoint = (point: CompatibleMapPoint, index: number, pointKind: PointKind): NormalizedMapPoint | null => {
  const coordinates = coordinatesOf(point);
  if (!coordinates) return null;
  const metricValue = typeof point.metricValue === "number" ? point.metricValue
    : Array.isArray(point.value) && typeof point.value[2] === "number" ? point.value[2] : null;
  const metricText = typeof point.metricText === "string" && point.metricText.trim()
    ? point.metricText.trim()
    : metricValue === null ? String(point.valueStatus ?? "待接入") : String(metricValue);
  const id = String(point.id ?? point.adcode ?? `${pointKind}-${point.name ?? index}`);
  const name = String(point.shortName ?? point.name ?? (pointKind === "city" ? "城市点位" : "数据点位"));
  return {
    id,
    name,
    fullName: String(point.name ?? name),
    city: String(point.city ?? ""),
    category: String(point.category ?? (pointKind === "city" ? "城市" : "")),
    metricLabel: String(point.metricLabel ?? "当前数值"),
    metricText,
    valueStatus: String(point.valueStatus ?? ""),
    positionStatus: String(point.positionStatus ?? ""),
    tooltipSections: point.tooltipSections || [],
    pointKind,
    sourcePoint: point,
    symbolOffset: point.symbolOffset,
    label: { show: pointKind === "city" || point.labelShow === true || (point.labelShow !== false && (props.mode === "company" || index < 10)) },
    value: [coordinates[0], coordinates[1], metricValue],
    itemStyle: {
      color: props.activeEntityId === id ? "#ffb84d"
        : pointKind === "city" ? "#5da9d8" : props.mode === "school" ? "#1876bd" : "#0e9f8a",
      borderColor: "#ffffff",
      borderWidth: props.activeEntityId === id ? 3 : 2,
      shadowColor: "rgba(34, 111, 166, .25)",
      shadowBlur: touchPerformanceMode ? 0 : 10,
    },
  };
};

const applyCanvasAria = () => {
  void nextTick(() => {
    const root = chartRef.value?.$el;
    if (!(root instanceof HTMLElement)) return;
    Array.from(root.querySelectorAll("canvas")).forEach((canvas, index) => {
      if (index === 0) {
        if (canvas.getAttribute("role") !== "img") canvas.setAttribute("role", "img");
        if (canvas.getAttribute("aria-label") !== mapAriaLabel.value) canvas.setAttribute("aria-label", mapAriaLabel.value);
        if (canvas.getAttribute("tabindex") !== "0") canvas.setAttribute("tabindex", "0");
        if (canvas.hasAttribute("aria-hidden")) canvas.removeAttribute("aria-hidden");
      } else {
        if (canvas.getAttribute("role") !== "presentation") canvas.setAttribute("role", "presentation");
        if (canvas.getAttribute("aria-hidden") !== "true") canvas.setAttribute("aria-hidden", "true");
        if (canvas.getAttribute("tabindex") !== "-1") canvas.setAttribute("tabindex", "-1");
        if (canvas.hasAttribute("aria-label")) canvas.removeAttribute("aria-label");
      }
    });
  });
};

const provinceElevationSeries = () => {
  const registered = props.level === "national" ? getMap(mapKey.value) : null;
  const face = provinceFaceFromMap(registered?.geoJSON ?? registered?.geoJson, reliefTarget.value.key);
  const mode = provinceElevationMode({
    national: props.level === "national", active: Boolean(face),
    suspended: elevationSuspended.value && !reliefTarget.value.selected, hidden: documentHidden.value,
    touch: touchPerformanceMode || !allowPointerElevation.value,
    reducedMotion: reduceElevationMotion.value,
  });
  return createProvinceElevationSeries(face, mode, shortRegionName(face?.name ?? ""), {
    selected: reliefTarget.value.selected, compact: narrowMapViewport.value,
    interactive: props.contextPreview,
  });
};

const provinceReliefSeries = () => {
  const registered = getMap(mapKey.value);
  const faces = provinceFacesFromMap(registered?.geoJSON ?? registered?.geoJson);
  const active = provinceElevationSeries();
  return [createProvinceBaseSeries(faces, {
    enabled: props.contextPreview && !documentHidden.value,
    compact: narrowMapViewport.value || touchPerformanceMode,
  }), active];
};

// Terrain and flat focus share one native geo. Partial highlight patches never
// reset the camera or re-normalize school/company points. No polygon is lifted.
const queueProvinceElevation = () => {
  if (elevationFrameId || loading.value || loadError.value || props.level !== "national") return;
  elevationFrameId = window.requestAnimationFrame(() => {
    elevationFrameId = 0;
    if (loading.value || loadError.value || props.level !== "national") return;
    const chart = chartRef.value?.chart;
    if (chart && !chart.isDisposed()) chart.setOption({ series: provinceReliefSeries() }, { lazyUpdate: false });
  });
};

const suspendProvinceElevation = () => {
  elevationSuspended.value = true;
  handleRegionPreviewGlobalEnd();
  queueProvinceElevation();
};

const buildOption = () => {
  // Native dragging updates ECharts immediately, before the debounced parent
  // notification. A simultaneous data/selection refresh must use that camera.
  capturePendingCamera();
  const metricMap = new Map(props.regionMetrics.map((item) => [item.name, item]));
  const regions = props.level === "national"
    ? GRID_TERRITORIES.map((territory) => {
      const insight = resolveProvinceInsight(territory);
      const entryEnabled = insight.entryEnabled;
      return {
        name: territory.name,
        itemStyle: {
          areaColor: props.contextPreview ? glassTerritoryFill(territory) : territoryAreaColor(territory),
          borderColor: props.contextPreview ? "rgba(71,108,134,.82)" : entryEnabled ? "rgba(255,255,255,.95)" : "rgba(174,190,200,.9)",
          borderWidth: props.contextPreview ? 0.65 : 0.9,
        },
        label: { color: entryEnabled ? "#294f69" : "#7f909b", fontWeight: entryEnabled ? 700 : 650 },
        emphasis: {
          label: { color: entryEnabled ? "#123f61" : "#687b87", fontWeight: 800 },
          itemStyle: {
            areaColor: props.contextPreview ? "rgba(97,162,188,.12)" : territoryEmphasisColor(territory, insight),
            borderColor: props.contextPreview ? "#527f92" : entryEnabled ? "rgba(255,255,255,.98)" : "rgba(161,178,189,.95)",
            borderWidth: entryEnabled ? 1.25 : 0.95,
            shadowColor: entryEnabled ? "rgba(27,98,151,.08)" : "transparent",
            shadowBlur: props.contextPreview ? 0 : entryEnabled ? 4 : 0,
            shadowOffsetY: props.contextPreview ? 0 : entryEnabled ? 2 : 0,
          },
        },
      };
    })
    : props.regionMetrics.map((metric) => {
      const active = props.activeRegion === metric.name;
      return {
        name: metric.name,
        itemStyle: {
          areaColor: props.contextPreview ? active ? "rgba(80,143,180,.22)" : "rgba(137,178,207,.11)" : regionColor(metric, metric.name),
          borderColor: props.contextPreview ? active ? "#3f6d85" : "rgba(78,114,140,.72)" : "rgba(255,255,255,.94)",
          borderWidth: active ? 1.35 : props.contextPreview ? 0.65 : 0.95,
        },
        ...(active ? { label: { color: "#0b4f80", fontWeight: 800 } } : {}),
      };
    });
  const entityData = props.points.map((point, index) => normalizePoint(point, index, "entity"))
    .filter((point): point is NormalizedMapPoint => point !== null);
  const cityData = props.cityPoints.map((point, index) => normalizePoint(point, index, "city"))
    .filter((point): point is NormalizedMapPoint => point !== null);
  const reducedMotion = touchPerformanceMode
    || (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const mapLayout = provinceMapLayout({ national: props.level === 'national', contextPreview: props.contextPreview && !props.eligibilityMode,
    touch: touchPerformanceMode, reducedMotion, hoverCapable: allowPointerElevation.value, narrowViewport: narrowMapViewport.value });
  const mainGeo = {
    id: "main-map",
    map: mapKey.value,
    zlevel: 0,
    z: 3,
    roam: true,
    silent: false,
    zoom: internalZoom.value,
    // Explicit null is required: omitting center lets ECharts merge and retain
    // the previous pan offset, so “重置” would restore zoom but not position.
    center: internalCenter.value,
    scaleLimit: { min: minZoom, max: maxZoom },
    ...mapLayout,
    regions,
    label: {
      show: true,
      color: "#294f69",
      fontSize: props.level === "national" ? 11 : 13,
      fontWeight: 700,
      textBorderColor: "rgba(255,255,255,.9)",
      textBorderWidth: 2,
      formatter: (params: { name: string }) => shortRegionName(params.name),
    },
    itemStyle: {
      areaColor: props.contextPreview ? "rgba(137,178,207,.14)" : props.level === "national" ? "#d4e9f7" : "#d1e7f6",
      borderColor: props.contextPreview ? "rgba(71,108,134,.82)" : "rgba(255,255,255,.94)",
      borderWidth: props.contextPreview ? 0.65 : 0.95,
      shadowColor: "rgba(27, 98, 151, .08)",
      shadowBlur: props.contextPreview ? 0 : 4,
      shadowOffsetY: props.contextPreview ? 0 : 2,
    },
    emphasis: {
      label: { color: "#123f61", fontWeight: 800 },
      itemStyle: {
        areaColor: props.contextPreview ? "rgba(97,162,188,.12)" : "#9dccf0",
        borderColor: props.contextPreview ? "#527f92" : "rgba(255,255,255,.98)",
        borderWidth: 1.25,
        shadowColor: "rgba(27, 98, 151, .08)",
        shadowBlur: props.contextPreview ? 0 : 4,
        shadowOffsetY: props.contextPreview ? 0 : 2,
      },
    },
  };

  option.value = {
    // The terrain is a custom series rendered in screen coordinates. Animating
    // only the native geo transform separates borders/labels from that surface
    // for 280ms on button zoom/reset. Commit every map layer in the same frame.
    animation: false,
    animationDuration: reducedMotion ? 0 : 420,
    animationDurationUpdate: reducedMotion ? 0 : 280,
    animationEasing: "cubicOut",
    animationEasingUpdate: "cubicOut",
    tooltip: {
      trigger: "item",
      triggerOn: touchPerformanceMode ? "click" : "mousemove|click",
      confine: true,
      backgroundColor: "rgba(255,255,255,.97)",
      borderColor: "#a8d3ef",
      borderWidth: 1,
      padding: [10, 12],
      extraCssText: 'max-width:290px;white-space:normal;overflow-wrap:anywhere;line-height:1.55;',
      textStyle: { color: "#24445c", fontSize: 13 },
      formatter: (params: any) => {
        // The new context card owns these previews; company and city-cluster
        // tooltips retain their existing compact readout.
        if (props.contextPreview && (props.level === "national" && params.componentType === "geo"
          || props.mode === "school" && String(params.data?.id ?? "").startsWith("grid-school:"))) return "";
        if (["effectScatter", "scatter"].includes(params.seriesType) && params.data) {
          return [
            `<strong style="display:block;max-width:270px;color:#174f78;font-size:15px">${escapeHtml(params.data.fullName)}</strong>`,
            params.data.city ? `<span style="color:#718697">${escapeHtml(params.data.city)}</span>` : '',
            params.data.tooltipSections?.length ? `<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px 12px;margin-top:8px;padding:8px 0;border-top:1px solid #dbe9f2;border-bottom:1px solid #dbe9f2">${params.data.tooltipSections.map((row: { label: string; value: string }) => `<div><span style="font-size:11px;color:#718697">${escapeHtml(row.label)}</span><br/><b>${escapeHtml(row.value)}</b></div>`).join('')}</div>` : '',
            !params.data.tooltipSections?.length && params.data.metricText && !['无可展示值', '—'].includes(params.data.metricText) ? `<div style="margin-top:6px;padding-top:6px;border-top:1px solid #dbe9f2;color:#365e77">${escapeHtml(params.data.metricLabel)}：<b>${escapeHtml(params.data.metricText)}</b></div>` : '',
            '<div style="margin-top:8px;font-size:11px;color:#718697">点击查看批次与录用详情</div>',
          ].filter(Boolean).join("");
        }
        const name = String(params.name ?? "");
        const metric = metricMap.get(name);
        if (props.level === "national") {
          const preview = resolveProvincePreview(name);
          if (!preview) {
            return `<strong>${escapeHtml(name)}</strong>`;
          }
          const { territory, insight } = preview;
          const entryEnabled = insight.entryEnabled;
          const eligibilityColor = entryEnabled ? "#087861"
            : territory.entryStatus === "mixed" ? "#94621d" : "#6f7f89";
          return [
            `<strong style="color:#174f78;font-size:14px">${escapeHtml(territory.name)}</strong>`,
            `<span style="color:#527487">运营范围：${escapeHtml(insight.operatorLabel)}</span>`,
            ...[['招聘名额', insight.plannedHeadcount], ['报名人数', insight.applicationCount], ['参考人数', insight.examAttendance], ['录用公示', insight.admissionCount]].filter(([, value]) => value && !/^(待补|待核|未单列|无可展示值|≥|—)/.test(String(value))).map(([label, value]) => `<span style="color:#365e77">${label}：${escapeHtml(cleanInsightText(value))}</span>`),
            `<b style="color:${eligibilityColor}">${entryEnabled ? (props.eligibilityMode ? "点击查看本地区报考条件" : "点击进入省级地图") : "当前区域不可进入"}</b>`,
          ].filter(Boolean).join("<br/>");
        }
        return [
          `<strong>${escapeHtml(name)}</strong>`,
          metric?.value != null ? `${escapeHtml(metric.metricLabel || "数量")}：${escapeHtml(metric.value)}` : '',
          '<span style="color:#7890a2">点击查看本市学校与单位</span>',
        ].filter(Boolean).join("<br/>");
      },
    },
    geo: [mainGeo],
    series: [
      ...provinceReliefSeries(),
      ...(cityData.length ? [{
        name: "城市点位", type: "scatter", coordinateSystem: "geo", geoIndex: 0, data: cityData,
        symbol: "circle", symbolSize: 12, zlevel: touchPerformanceMode ? 0 : 2, z: 5,
        label: { show: true, position: "right", distance: 6, formatter: "{b}", color: "#315d77",
          fontSize: 11, backgroundColor: "rgba(255,255,255,.8)", borderRadius: 4, padding: [2, 4] },
        emphasis: { scale: 1.1 },
      }] : []),
      ...(entityData.length ? [{
        name: props.mode === "school" ? "学校点位" : "电网公司点位",
        type: touchPerformanceMode ? "scatter" : "effectScatter", coordinateSystem: "geo", geoIndex: 0, data: entityData,
        symbol: props.mode === "school" ? "pin" : "diamond",
        symbolSize: (value: Array<number | null>) => {
          const metric = value[2];
          return typeof metric === "number" ? Math.max(18, Math.min(26, 17 + metric / 24)) : 19;
        },
        ...(touchPerformanceMode ? {} : {
          showEffectOn: reducedMotion ? "emphasis" : "render",
          rippleEffect: { scale: 1.65, brushType: "stroke" },
        }),
        // Multiple zlevels mean multiple canvases. Keep every touch-only series
        // on zlevel 0 and use z for ordering to avoid costly layer compositing.
        zlevel: touchPerformanceMode ? 0 : 3,
        z: 6,
        label: { show: true, position: "right", distance: 7, formatter: "{b}", color: "#124b76",
          fontSize: 12, fontWeight: 700, backgroundColor: "rgba(255,255,255,.92)", borderColor: "rgba(77, 163, 218, .28)", borderWidth: 1, borderRadius: 5, padding: [4, 6] },
        labelLayout: { hideOverlap: true },
        emphasis: { scale: 1.1 },
      }] : []),
    ],
  };
  applyCanvasAria();
};

const refreshMap = async () => {
  cancelCameraWork();
  suspendProvinceElevation();
  const sequence = ++refreshSequence;
  cancelMapRequest();
  const controller = new AbortController();
  let timedOut = false;
  activeMapRequest = controller;
  mapRequestTimeout = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, MAP_REQUEST_TIMEOUT_MS);
  loading.value = true;
  loadError.value = "";
  resetInternalCamera();
  hubeiGeometryCache = null;
  try {
    await ensureMap(controller.signal);
    if (sequence !== refreshSequence) return;
    buildOption();
    await nextTick();
    applyCanvasAria();
  } catch (error) {
    if (sequence !== refreshSequence) return;
    loadError.value = timedOut
      ? "地图加载超时，请检查网络后重试"
      : error instanceof Error ? error.message : "地图加载失败";
  } finally {
    if (activeMapRequest === controller) {
      if (mapRequestTimeout !== undefined) window.clearTimeout(mapRequestTimeout);
      mapRequestTimeout = undefined;
      activeMapRequest = null;
    }
    if (sequence === refreshSequence) loading.value = false;
  }
};

const readCameraFromChart = (): Pick<GeoRoamPayload, "zoom" | "center"> => {
  const geoOption = chartRef.value?.getOption?.()?.geo?.[0];
  const zoom = clampZoom(Number(geoOption?.zoom ?? internalZoom.value));
  const center = normalizeCenter(geoOption?.center) ?? internalCenter.value;
  return { zoom, center };
};
const capturePendingCamera = () => {
  if (!nativeRoamPending) return;
  const camera = readCameraFromChart();
  internalZoom.value = camera.zoom;
  internalCenter.value = camera.center;
  nativeRoamPending = false;
};
const cancelCameraWork = () => {
  if (roamFrameId) window.cancelAnimationFrame(roamFrameId);
  roamFrameId = 0;
  pendingRoamEvent = null;
  if (roamSettleTimer !== undefined) window.clearTimeout(roamSettleTimer);
  roamSettleTimer = undefined;
  if (pinchTrailingTimer !== undefined) window.clearTimeout(pinchTrailingTimer);
  pinchTrailingTimer = undefined;
  pendingPinchScale = 1;
  pendingPinchOrigin = null;
  nativeRoamPending = false;
};
const directionFromEvent = (event?: GeoRoamEvent): RoamDirection => {
  if (typeof event?.zoom === "number") {
    if (event.zoom > 1) return "in";
    if (event.zoom < 1) return "out";
  }
  if (typeof event?.dx === "number" || typeof event?.dy === "number") return "pan";
  return "reset";
};
const focusFromEvent = (event?: GeoRoamEvent): MapCenter | null => {
  if (typeof event?.originX !== "number" || typeof event?.originY !== "number") return null;
  return normalizeCenter(chartRef.value?.convertFromPixel?.(
    { geoIndex: 0 },
    [event.originX, event.originY],
  ));
};
const emitCamera = (
  event?: GeoRoamEvent,
  directionOverride?: RoamDirection,
  settled = false,
) => {
  const direction = directionOverride ?? directionFromEvent(event);
  const camera = settled
    ? readCameraFromChart()
    : { zoom: internalZoom.value, center: internalCenter.value };
  if (settled) {
    internalZoom.value = camera.zoom;
    internalCenter.value = camera.center;
    nativeRoamPending = false;
  }
  const shouldResolveFocus = props.level === "national"
    && direction === "in"
    && camera.zoom >= 1.35;
  const focus = shouldResolveFocus ? focusFromEvent(event) : null;
  emit("georoam", {
    ...camera,
    focus,
    focusRegion: regionAtCoordinate(focus),
    direction,
  });
};
const handleGeoRoam = (event: GeoRoamEvent) => {
  nativeRoamPending = true;
  suspendProvinceElevation();
  const direction = directionFromEvent(event);
  if (typeof event.zoom === "number" && Number.isFinite(event.zoom)) {
    internalZoom.value = clampZoom(internalZoom.value * event.zoom);
  }
  // Keep the zoom event when pinch/wheel and pan land in the same frame so the
  // drill-down direction and zoom origin are not lost.
  if (!pendingRoamEvent || typeof event.zoom === "number" || typeof pendingRoamEvent.zoom !== "number") {
    pendingRoamEvent = { ...event };
  }
  if (!roamFrameId) {
    roamFrameId = window.requestAnimationFrame(() => {
      roamFrameId = 0;
      const nextEvent = pendingRoamEvent ?? undefined;
      pendingRoamEvent = null;
      // Pan has no threshold consumer. Let ECharts render it immediately and
      // publish one accurate camera snapshot after the gesture settles.
      if (directionFromEvent(nextEvent) !== "pan") emitCamera(nextEvent);
    });
  }
  if (roamSettleTimer !== undefined) window.clearTimeout(roamSettleTimer);
  roamSettleTimer = window.setTimeout(() => {
    roamSettleTimer = undefined;
    emitCamera(event, direction, true);
  }, touchPerformanceMode ? 120 : 80);
};

const dispatchPendingPinch = () => {
  const frameScale = pendingPinchScale;
  const frameOrigin = pendingPinchOrigin;
  pendingPinchScale = 1;
  pendingPinchOrigin = null;
  // Even a 0.1% adjacent-frame change is real movement: discarding it after
  // resetting the accumulator makes a slow, continuous pinch appear frozen.
  // Rate-limit dispatch, never the distance travelled by the fingers.
  if (!frameOrigin || frameScale === 1) return;
  lastPinchDispatchAt = performance.now();
  chartRef.value?.dispatchAction?.({
    type: "geoRoam",
    componentType: "geo",
    geoId: "main-map",
    zoom: frameScale,
    originX: frameOrigin[0],
    originY: frameOrigin[1],
  });
};

const handleTouchPinch = (event: ZrPinchEvent) => {
  if (!touchPerformanceMode) return;
  const rawScale = Number(event.pinchScale);
  if (!Number.isFinite(rawScale) || rawScale <= 0) return;

  // ECharts 6 converts every pinch frame to a fixed 10% jump. Consume that
  // default handler and retain ZRender's real adjacent-frame ratio. WeChat may
  // pause requestAnimationFrame while a finger is moving, so use a 60fps time
  // gate instead of making the interaction depend on rAF.
  event.__ecRoamConsumed = true;
  if (event.event?.cancelable !== false) event.event?.preventDefault?.();
  // Multiplication preserves all adjacent-frame ratios while events wait for
  // the next render budget. ECharts' scaleLimit constrains the final camera;
  // clipping individual input ratios here would permanently lose distance.
  pendingPinchScale *= rawScale;
  pendingPinchOrigin = [Number(event.pinchX ?? 0), Number(event.pinchY ?? 0)];

  const frameBudget = 17;
  const elapsed = performance.now() - lastPinchDispatchAt;
  if (!lastPinchDispatchAt || elapsed >= frameBudget) {
    if (pinchTrailingTimer !== undefined) {
      window.clearTimeout(pinchTrailingTimer);
      pinchTrailingTimer = undefined;
    }
    dispatchPendingPinch();
    return;
  }
  if (pinchTrailingTimer === undefined) {
    pinchTrailingTimer = window.setTimeout(() => {
      pinchTrailingTimer = undefined;
      dispatchPendingPinch();
    }, Math.max(0, frameBudget - elapsed));
  }
};

const flushPendingPinch = () => {
  if (pinchTrailingTimer !== undefined) {
    window.clearTimeout(pinchTrailingTimer);
    pinchTrailingTimer = undefined;
  }
  dispatchPendingPinch();
};

let activeProvincePreview: ProvincePreviewPayload | null = null;
let activeSchoolPreviewId: string | null = null;

const schoolPreviewIdFromEvent = (params: any): string | null => {
  if (props.mode !== "school" || !["effectScatter", "scatter"].includes(params?.seriesType)) return null;
  const id = String(params.data?.id ?? "");
  // grid-city markers summarize several schools and are never a school detail request.
  return params.data?.sourcePoint && id.startsWith("grid-school:") ? id : null;
};

const clearSchoolPreview = () => {
  if (!activeSchoolPreviewId) return;
  const previous = activeSchoolPreviewId;
  activeSchoolPreviewId = null;
  emit("entity-preview-end", previous);
};

const previewFromChartEvent = (params: any): ProvincePreviewPayload | null => {
  if (props.level !== "national" || (params?.componentType !== "geo"
    && params?.seriesId !== PROVINCE_ELEVATION_SERIES_ID)) return null;
  const name = String(params?.name ?? "").trim();
  return name ? resolveProvincePreview(name) : null;
};

const handleRegionPreview = (params: any) => {
  if (pointerIsDown) return;
  const schoolId = schoolPreviewIdFromEvent(params);
  if (schoolId) {
    if (activeSchoolPreviewId !== schoolId) {
      clearSchoolPreview();
      activeSchoolPreviewId = schoolId;
      emit("entity-preview", schoolId);
    }
    return;
  }
  clearSchoolPreview();
  const preview = previewFromChartEvent(params);
  if (!preview || activeProvincePreview?.adcode === preview.adcode) return;
  elevationSuspended.value = false;
  hoveredProvinceAdcode.value = preview.adcode ?? "";
  activeProvincePreview = preview;
  emit("region-preview", preview);
};

const handleRegionPreviewEnd = (params: any) => {
  if (schoolPreviewIdFromEvent(params) === activeSchoolPreviewId) clearSchoolPreview();
  const preview = previewFromChartEvent(params) ?? activeProvincePreview;
  if (!preview) return;
  if (activeProvincePreview?.adcode === preview.adcode) {
    activeProvincePreview = null;
    hoveredProvinceAdcode.value = "";
  }
  emit("region-preview-end", preview);
};

const handleRegionPreviewGlobalEnd = () => {
  clearSchoolPreview();
  const preview = activeProvincePreview;
  activeProvincePreview = null;
  hoveredProvinceAdcode.value = "";
  emit("region-preview-end", preview);
};

const handleMapPointerDown = () => {
  pointerIsDown = true;
};
const handleMapPointerUp = () => {
  pointerIsDown = false;
  flushPendingPinch();
};
const handleVisibilityChange = () => {
  documentHidden.value = document.hidden;
  if (document.hidden) handleMapBlur();
};
const handleMapBlur = () => {
  pointerIsDown = false;
  suspendProvinceElevation();
};
const handleMotionPreference = () => {
  reduceElevationMotion.value = motionPreference?.matches ?? false;
  allowPointerElevation.value = hoverPreference?.matches ?? false;
};

// A single click on a province only selects it, so the context card can show
// its figures in place; entering the province needs a double click (or the
// keyboard Enter path, whose announcement already promises entry).
const handleClick = (params: any, activate = false) => {
  if (["effectScatter", "scatter"].includes(params.seriesType) && params.data?.sourcePoint) {
    const payload: EntityClickPayload = {
      id: String(params.data.id),
      name: String(params.data.fullName ?? params.data.name ?? ""),
      pointKind: params.data.pointKind === "city" ? "city" : "entity",
      point: params.data.sourcePoint,
    };
    emit("entity-click", payload);
    emit("select-entity", payload.id);
    return;
  }
  const name = String(params.name ?? "");
  if (!name) return;
  if (props.level === "national") {
    const preview = resolveProvincePreview(name);
    if (!preview || !preview.insight.entryEnabled) {
      emit("unavailable-province", preview?.name ?? name);
      return;
    }
    if (!activate) { emit("province-select", { name: preview.name, adcode: preview.adcode }); return; }
    emit("province-click", { name: preview.name, adcode: preview.adcode });
    if (preview.adcode === "420000") emit("drill-hubei");
    return;
  }
  const regionAdcode = params.data?.adcode ? String(params.data.adcode) : undefined;
  emit("region-click", { name, ...(regionAdcode ? { adcode: regionAdcode } : {}), provinceName: currentProvinceName.value });
  emit("select-region", name);
};

const handleDoubleClick = (params: any) => handleClick(params, true);

const handleProvinceKeyboard = (event: KeyboardEvent) => {
  if (props.level !== "national" || loading.value || loadError.value || event.target !== event.currentTarget) return;
  const registered = getMap(mapKey.value);
  const available = new Set(provinceFacesFromMap(registered?.geoJSON ?? registered?.geoJson).map(face => face.key));
  const territories = GRID_TERRITORIES.filter(territory => available.has(territory.adcode));
  const current = keyboardProvinceAdcode.value || activeProvinceAdcode.value || props.selectedProvinceAdcode;
  const next = provinceKeyboardTarget(territories.map(territory => territory.adcode), current, event.key);
  if (next) {
    const territory = territories.find(item => item.adcode === next)!;
    event.preventDefault();
    keyboardProvinceAdcode.value = next;
    keyboardProvinceAnnouncement.value = `${territory.name}，按回车进入省级地图`;
    handleRegionPreview({ componentType: "geo", name: territory.name });
  } else if ((event.key === "Enter" || event.key === " ") && current) {
    const territory = territories.find(item => item.adcode === current);
    if (!territory) return;
    event.preventDefault();
    handleClick({ componentType: "geo", name: territory.name }, true);
  } else if (event.key === "Escape") {
    event.preventDefault();
    handleProvinceKeyboardBlur();
  }
};

const handleProvinceKeyboardBlur = () => {
  if (!keyboardProvinceAdcode.value) return;
  keyboardProvinceAdcode.value = "";
  keyboardProvinceAnnouncement.value = "";
  handleRegionPreviewGlobalEnd();
};

const setCamera = (zoom: number, center: MapCenter | null, notify = true, direction: RoamDirection = "reset") => {
  const nextZoom = clampZoom(zoom);
  const nextCenter = normalizeCenter(center);
  const alreadyAtBoundary = direction !== "reset"
    && Math.abs(nextZoom - internalZoom.value) <= 0.0001
    && JSON.stringify(nextCenter) === JSON.stringify(internalCenter.value);
  // At min/max zoom, repeated button taps used to rebuild the complete map
  // option even though the camera could no longer move. Ignore that no-op so
  // "zoom all the way out" stays responsive on touch devices.
  if (alreadyAtBoundary) return;

  cancelCameraWork();
  suspendProvinceElevation();
  internalZoom.value = nextZoom;
  internalCenter.value = nextCenter;
  buildOption();
  void nextTick(() => {
    applyCanvasAria();
    if (notify) emit("georoam", {
      zoom: internalZoom.value,
      center: internalCenter.value,
      focus: internalCenter.value,
      focusRegion: regionAtCoordinate(internalCenter.value),
      direction,
    });
  });
};
const zoomIn = () => {
  capturePendingCamera();
  setCamera(internalZoom.value * 1.25, internalCenter.value, true, "in");
};
const zoomOut = () => {
  capturePendingCamera();
  setCamera(internalZoom.value / 1.25, internalCenter.value, true, "out");
};
const resetView = () => setCamera(defaultZoom(), null, true, "reset");
defineExpose({ zoomIn, zoomOut, resetView });

// A narrow desktop window may still report a fine hover pointer. Refit when
// crossing the shell's 800px breakpoint, without resetting zoom or pan state.
const handleMapViewportResize = () => {
  const narrow = window.innerWidth <= 800;
  if (narrow === narrowMapViewport.value) return;
  narrowMapViewport.value = narrow;
  if (!loading.value && !loadError.value) buildOption();
};

watch(() => [props.level, props.provinceName, props.provinceAdcode], refreshMap, { immediate: true });
watch(
  () => [props.mode, props.points, props.cityPoints, props.regionMetrics, props.provinceInsights, props.activeEntityId, props.activeRegion, props.contextPreview, props.eligibilityMode],
  () => { if (!loading.value && !loadError.value) buildOption(); },
  { deep: true },
);
watch(() => props.zoom, (zoom) => {
  if (typeof zoom === "number" && Math.abs(zoom - internalZoom.value) > 0.0001) setCamera(zoom, internalCenter.value, false);
});
watch(() => props.center, (center) => {
  const normalized = normalizeCenter(center);
  if (JSON.stringify(normalized) !== JSON.stringify(internalCenter.value)) setCamera(internalZoom.value, normalized, false);
}, { deep: true });
watch(mapAriaLabel, applyCanvasAria);
watch(() => props.activeProvinceAdcode, (adcode, previous) => {
  // A fresh keyboard/focus target is a new intent; camera events alone are not.
  if (adcode && adcode !== previous && !pointerIsDown) elevationSuspended.value = false;
});
watch([activeProvinceAdcode, () => props.selectedProvinceAdcode, elevationSuspended, documentHidden,
  reduceElevationMotion, allowPointerElevation], queueProvinceElevation);
onMounted(() => {
  motionPreference?.addEventListener("change", handleMotionPreference);
  hoverPreference?.addEventListener("change", handleMotionPreference);
  document.addEventListener("visibilitychange", handleVisibilityChange);
  // Releasing a drag outside the canvas must not leave hover permanently suspended.
  window.addEventListener("pointerup", handleMapPointerUp);
  window.addEventListener("pointercancel", handleMapPointerUp);
  window.addEventListener("blur", handleMapBlur);
  window.addEventListener("resize", handleMapViewportResize);
});
onBeforeUnmount(() => {
  refreshSequence += 1;
  cancelMapRequest();
  cancelCameraWork();
  if (elevationFrameId) window.cancelAnimationFrame(elevationFrameId);
  motionPreference?.removeEventListener("change", handleMotionPreference);
  hoverPreference?.removeEventListener("change", handleMotionPreference);
  document.removeEventListener("visibilitychange", handleVisibilityChange);
  window.removeEventListener("pointerup", handleMapPointerUp);
  window.removeEventListener("pointercancel", handleMapPointerUp);
  window.removeEventListener("blur", handleMapBlur);
  window.removeEventListener("resize", handleMapViewportResize);
  pendingPinchScale = 1;
  pendingPinchOrigin = null;
});
</script>

<template>
  <div class="map-shell" role="region" :aria-label="mapAriaLabel"
    :tabindex="props.level === 'national' ? 0 : -1"
    :aria-describedby="props.level === 'national' ? 'province-keyboard-help' : undefined"
    @keydown="handleProvinceKeyboard" @blur="handleProvinceKeyboardBlur">
    <span v-if="props.level === 'national'" id="province-keyboard-help" class="map-sr-only">
      方向键切换省份预览，回车进入省级地图，Escape 结束临时预览。Home 和 End 可到首尾省份。
    </span>
    <span class="map-sr-only" role="status" aria-live="polite">{{ keyboardProvinceAnnouncement }}</span>
    <div v-if="loading" class="map-state" role="status" aria-live="polite">
      <span class="loading-dot" aria-hidden="true"></span>
      正在加载行政区边界
    </div>
    <div v-else-if="loadError" class="map-state map-error" role="alert">
      <span>{{ loadError }}</span>
      <button type="button" @click="refreshMap">重新加载</button>
    </div>
    <v-chart
      v-if="!loading && !loadError"
      ref="chartRef"
      class="chart"
      :option="option"
      :init-options="chartInitOptions"
      :aria-label="mapAriaLabel"
      :autoresize="chartAutoresize"
      @click="handleClick"
      @dblclick="handleDoubleClick"
      @mouseover="handleRegionPreview"
      @mousemove="handleRegionPreview"
      @mouseout="handleRegionPreviewEnd"
      @globalout="handleRegionPreviewGlobalEnd"
      @georoam="handleGeoRoam"
      @zr:pinch="handleTouchPinch"
      @zr:mousedown="handleMapPointerDown"
      @zr:mouseup="handleMapPointerUp"
    />
    <div v-if="contextPreview && level === 'national'" class="grid-legend" aria-label="电网范围图例">
      <span><i style="background:rgba(104,160,206,.72)"></i>国家电网</span>
      <span><i style="background:rgba(104,192,166,.78)"></i>南方电网</span>
      <span><i style="background:rgba(176,150,212,.75)"></i>蒙东国网 / 蒙西内蒙古电力</span>
    </div>
    <div class="map-source">点击学校或单位查看详情</div>
  </div>
</template>

<style scoped lang="scss">
.map-shell {
  position: relative;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: #eaf3f7;
}

.map-shell:focus-visible {
  outline: 2px solid #397cba;
  outline-offset: -3px;
  border-radius: 12px;
}

.map-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}

.map-shell {
  touch-action: none;
  overscroll-behavior: contain;
}

.chart {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  outline: none;
}

.chart {
  z-index: 0;
}

.chart:focus-visible,
.chart :deep(canvas:focus-visible) {
  outline: 3px solid #1d70aa;
  outline-offset: -4px;
}

.map-state {
  position: absolute;
  z-index: 4;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: #56788f;
  font-size: 15px;
}

.loading-dot {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  background: #3f9bd8;
  box-shadow: 0 0 0 6px rgba(63, 155, 216, 0.12);
  animation: breathe 1.2s ease-in-out infinite;
}

.map-error {
  color: #b64b54;
}

.map-error button {
  padding: 8px 12px;
  border: 1px solid rgba(50, 135, 182, .35);
  border-radius: 9px;
  color: #21698f;
  background: rgba(255,255,255,.9);
  font-size: 12px;
  font-weight: 800;
}

.map-source {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

@keyframes breathe {
  50% { transform: scale(0.75); opacity: 0.65; }
}

@media (prefers-reduced-motion: reduce) {
  .loading-dot { animation: none; }
}

</style>
