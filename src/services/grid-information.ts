import { authState, getAuthSessionEpoch, clearAuthSessionIfCurrent } from "@/services/auth";
import { gridQueryString } from "@/views/index/grid-information-display";

export interface GridSource {
  sourceKey: string;
  title: string;
  sourceType: "user_material" | "official_reference" | "roster_aggregate";
  sha256: string;
  sourceUrl: string | null;
  note: string;
}

export interface GridFact {
  factKey: string;
  sourceKey: string;
  cohortYear: number | null;
  grid: string;
  batchCode: string;
  scope: string;
  province: string | null;
  city: string | null;
  company: string | null;
  category: string;
  title: string;
  text: string;
  educationLevel: string | null;
  schoolTier: string | null;
  evidenceLocator: string;
  dataStatus: "reference" | "conflict" | "pending";
  relatedOfficialSourceKey: string | null;
  source: GridSource;
  applicability: "city_specific" | "province_inherited" | "direct";
  datasetKey: string;
  version: string;
}

export interface GridVersion {
  datasetKey: string;
  version: string;
  title: string;
  createdAt: string;
  sourceCount: number;
  factCount: number;
  outcomeCount: number;
  checksumSha256: string;
  notes: string[];
}

export interface GridFacets {
  schemaVersion: "grid-query-1";
  years: number[];
  unknownYearAvailable: boolean;
  provinces: string[];
  cities: { province: string; city: string }[];
  companies: string[];
  grids: string[];
  batches: string[];
  schoolTiers: string[];
  educationLevels: string[];
  orgCategories: string[];
  industryTags: string[];
  versions: GridVersion[];
  disclaimer: string;
}

export interface GridFactResult { items: GridFact[]; total: number; page: number; pageSize: number; disclaimer: string }
export interface GridRankingRow {
  rank: number | null;
  schoolKey: string;
  schoolName: string;
  campusName: string | null;
  campusKeys?: string[];
  schoolTier: string;
  schoolTiers?: string[];
  educationLevel: string | null;
  educationLevels?: string[];
  recordCount: number | null;
  batchCounts: Record<"batch_1" | "batch_2" | "batch_3" | "csg_spring" | "csg_autumn", number | null>;
  gridCounts: { sgcc: number | null; csg: number | null };
  industryTags: string[];
  metricType: "public_notice_record_count";
  countBasis: "released_cells_only" | "all_aggregate_cells" | "complete_anonymous_aggregates";
}
export interface GridRankingResult {
  items: GridRankingRow[];
  total: number;
  page: number;
  pageSize: number;
  view: "parent" | "campus";
  scope?: { schoolProvinceAdcode: string | null; destinationProvince: string | null };
  privacy: { minimumCellCount: number | null; suppressionApplied: boolean; basis: string; countBasis?: string; personalRecordsIncluded?: boolean };
  disclaimer: string;
}
export type GridQuery = Record<string, string | number | undefined> & {
  grid?: string;
  batchCode?: string;
  /** Campus location; independent from province, which filters hiring destinations. */
  schoolProvinceAdcode?: string;
};

export class GridInformationUnauthorized extends Error {
  constructor() { super("登录已失效，请重新登录后查看汇总资料。"); }
}

const apiBaseUrl = String(import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");

async function requestGridInformation<T>(route: string, query: GridQuery, signal?: AbortSignal): Promise<T> {
  if (!authState.authenticated) throw new GridInformationUnauthorized();
  const epoch = getAuthSessionEpoch();
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener("abort", abort, { once: true });
  let timedOut = false;
  const timeout = window.setTimeout(() => { timedOut = true; controller.abort(); }, 15_000);
  try {
    const response = await fetch(`${apiBaseUrl}/api/v2/private/${route === 'rankings' ? 'grid-aggregates' : 'grid-query'}/${route}?${gridQueryString(query)}`, {
      signal: controller.signal, credentials: "include", cache: "no-store", headers: { Accept: "application/json" },
    });
    if (controller.signal.aborted || epoch !== getAuthSessionEpoch()) throw new DOMException("已取消查询", "AbortError");
    if (response.status === 401 || response.status === 403) {
      // Clear existing private views immediately, even if a later /me check is unavailable.
      clearAuthSessionIfCurrent(epoch, controller.signal);
      throw new GridInformationUnauthorized();
    }
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      const message = typeof body?.error === "string" ? body.error : body?.error?.message;
      throw new Error(message || `资料查询失败（${response.status}），请重试。`);
    }
    if (!(response.headers.get("content-type") || "").includes("application/json")) throw new Error("资料接口未返回有效数据，请联系管理员检查部署版本。");
    const payload = await response.json();
    if (signal?.aborted || epoch !== getAuthSessionEpoch()) throw new DOMException("已取消查询", "AbortError");
    if (!authState.authenticated) throw new GridInformationUnauthorized();
    if (!payload || typeof payload !== "object") throw new Error("资料返回格式无效。");
    if (route === "facets") {
      if (payload.schemaVersion !== "grid-query-1" || !Array.isArray(payload.provinces) || !Array.isArray(payload.versions)) throw new Error("查询目录版本无效。");
    } else if (!Array.isArray(payload.items) || !Number.isInteger(payload.total)) throw new Error("查询结果格式无效。");
    if (route === 'rankings' && (payload.schemaVersion !== 'grid-aggregates-1' || payload.privacy?.countBasis !== 'complete_anonymous_aggregates' || payload.privacy?.personalRecordsIncluded !== false)) throw new Error('院校匿名聚合口径未确认，请检查部署版本。');
    return payload as T;
  } catch (error) {
    if (timedOut) throw new Error("资料请求超时，请检查网络后重试。");
    throw error;
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}

export const fetchGridFacets = (signal?: AbortSignal) => requestGridInformation<GridFacets>("facets", {}, signal);
export const fetchGridFacts = (query: GridQuery, signal?: AbortSignal) => requestGridInformation<GridFactResult>("facts", query, signal);
export const fetchGridRankings = (query: GridQuery, signal?: AbortSignal) => requestGridInformation<GridRankingResult>("rankings", query, signal);
