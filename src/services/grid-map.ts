import { authState, getAuthSessionEpoch, clearAuthSessionIfCurrent } from "@/services/auth";
import { gridQueryString } from "@/views/index/grid-information-display";
import type { GridFact, GridQuery, GridSource } from "@/services/grid-information";
import type { InformationCard } from "@/services/mobile-information";

export type GridMapBatch = "batch_1" | "batch_2" | "batch_3" | "csg_spring" | "csg_autumn";
export type GridMapCounts = Record<GridMapBatch, number | null> & Record<string, number | null>;
export type GridCountBasis = "released_cells_only" | "all_aggregate_cells" | "complete_anonymous_aggregates";
export interface GridMapPrivacy { minimumCellCount: number | null; suppressionApplied: boolean; basis?: string; countBasis?: GridCountBasis; personalRecordsIncluded?: boolean }
export interface GridSchoolIntroduction { text: string; sourceUrls: string[]; status: 'verified' | 'reference'; asOf: string | null; note: string }
export interface GridMapSchool {
  campusKey: string; parentSchoolKey: string; schoolName: string; campusName: string | null;
  schoolCode: string | null; rawNames: string[]; schoolTier: string; educationLevel: string | null;
  ownership: string | null; is985: boolean | null; is211: boolean | null; isDoubleFirst: boolean | null;
  kind: string | null; matchStatus: string | null; industryTags: string[];
  introduction?: GridSchoolIntroduction | null;
  province: string | null; provinceAdcode: string | null; city: string | null; cityAdcode: string | null;
  coordinates: [number, number] | null; locationPrecision: "campus" | "city" | "unlocated";
  coordinateSystem: string | null; address: string | null; locationNote: string; sourceUrls: string[];
  recordCount: number | null; nationalRecordCount: number | null; destinationProvinceRecordCount: number | null;
  batchCounts: GridMapCounts; gridCounts: { sgcc: number | null; csg: number | null };
  countBasis: GridCountBasis;
}
export interface GridMapCompany {
  companyKey: string; company: string; grid: string; orgCategory: string; companyGroup: string | null;
  province: string | null; provinceAdcode: string | null; coordinates: [number, number] | null;
  locationPrecision: "province" | "city" | "unlocated"; destinationCity: string | null; recordCount: number | null;
  candidateStatus?: "roster_unit" | "policy_reference" | "reference_candidate";
  companyCity?: string | null; companyCityAdcode?: string | null;
  cityEvidenceStatus?: string; locationNote?: string;
  batchCounts: GridMapCounts; schoolCount: number; policyFactCount: number;
  countBasis: GridCountBasis;
}
export interface GridMapCity {
  adcode: string; provinceAdcode: string; name: string; coordinates: [number, number] | null;
  schoolCount: number; policyFactCount: number; recordCount: null; destinationCityStatus: "source_not_provided";
}
export interface GridMapProvince {
  adcode: string; name: string; recordCount: number | null; schoolCount: number;
  companyCount: number; policyFactCount: number; batchCounts: GridMapCounts;
  countBasis: GridCountBasis;
}
export interface GridMapOverview {
  schemaVersion: "grid-map-1" | "grid-aggregates-1";
  referenceDataAvailable: boolean;
  rosterDataAvailable: boolean;
  selection: { provinceAdcode: string | null; cohortYear: number; grid: string | null; batchCode: string | null };
  provinceSummaries: GridMapProvince[];
  localSchools?: GridMapSchool[]; sourceSchools?: GridMapSchool[]; companies?: GridMapCompany[]; cities?: GridMapCity[];
  unassignedCompanies?: GridMapCompany[];
  unassignedSchools?: GridMapSchool[];
  exactCards?: InformationCard[];
  nationalSummary?: { recordCount: number | null; schoolCount: number; campusCount: number; companyCount: number; unassignedDestinationRecordCount: number | null; countBasis: 'complete_anonymous_aggregates'; scopeLabel: string };
  privacy: GridMapPrivacy; disclaimer: string;
}
export interface RecruitmentCounts { recordCount: number | null; batchCounts: GridMapCounts; gridCounts: { sgcc: number | null; csg: number | null } }
export interface SchoolRecruitmentSummary {
  cohortYear: number; grid: string | null; scope: 'all_batches'; national: RecruitmentCounts;
  targetProvince: (RecruitmentCounts & { adcode: string; name: string }) | null;
  otherProvinces: RecruitmentCounts | null;
  destinations: (RecruitmentCounts & { provinceAdcode: string | null; provinceName: string | null })[];
  equations: { targetPlusOtherEqualsNational: boolean | null; destinationSumEqualsNational: boolean; batchSumEqualsNational: boolean };
}
export interface GridMapSchoolDetail {
  schemaVersion: "grid-map-1" | "grid-aggregates-1"; school: GridMapSchool; aliases: unknown[]; relatedCampuses: GridMapSchool[];
  recruitmentSummary?: SchoolRecruitmentSummary;
  destinations: GridMapCompany[]; sources: GridSource[]; privacy: GridMapPrivacy; disclaimer: string;
}
export interface GridMapCompanyDetail {
  schemaVersion: "grid-map-1" | "grid-aggregates-1"; company: GridMapCompany; aliases: unknown[]; schools: GridMapSchool[];
  policyFacts: GridFact[]; sources: GridSource[]; privacy: GridMapPrivacy; disclaimer: string;
  candidate?: { candidateKey: string; companyRegion: string; entityStatus: string; cityEvidenceStatus: string;
    references: { factKey: string; sourceKey: string; cohortYear: number | null; batchCode: string;
      applicationCount: number; metricType: "application_record_count_reference"; measureUnit: "人次"; dataStatus: string }[] } | null;
}
export type GridMapDetail = GridMapSchoolDetail | GridMapCompanyDetail;
const apiBaseUrl = String(import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");

async function request<T>(route: string, query: GridQuery, signal?: AbortSignal, publicAccess = false): Promise<T> {
  if (!publicAccess && !authState.authenticated) throw new Error("请先登录后查看地图明细。");
  const epoch = getAuthSessionEpoch();
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener("abort", abort, { once: true });
  let timedOut = false;
  const timeout = window.setTimeout(() => { timedOut = true; controller.abort(); }, 15_000);
  try {
    const response = await fetch(`${apiBaseUrl}/api/v2/${publicAccess ? "public/grid-map" : "private/grid-aggregates"}/${route}?${gridQueryString(query)}`, {
      credentials: "include", cache: "no-store", signal: controller.signal, headers: { Accept: "application/json" },
    });
    if (controller.signal.aborted || (!publicAccess && epoch !== getAuthSessionEpoch())) throw new DOMException("已取消地图查询", "AbortError");
    if (!publicAccess && [401, 403].includes(response.status)) {
      clearAuthSessionIfCurrent(epoch, controller.signal);
      throw new Error("登录已失效，请重新登录后查看地图明细。");
    }
    if (!response.ok) throw new Error(`地图资料加载失败（${response.status}），请重试。`);
    if (!(response.headers.get("content-type") || "").includes("application/json")) throw new Error("地图资料格式无效，请检查部署版本。");
    const payload = await response.json();
    if (payload?.schemaVersion !== (publicAccess ? "grid-map-1" : "grid-aggregates-1")) throw new Error("地图资料版本无效，请检查部署版本。");
    if (!publicAccess && (payload.privacy?.countBasis !== 'complete_anonymous_aggregates' || payload.privacy?.personalRecordsIncluded !== false)) throw new Error("匿名聚合口径未确认，请检查部署版本。");
    if (signal?.aborted || (!publicAccess && (!authState.authenticated || epoch !== getAuthSessionEpoch()))) throw new DOMException("已取消地图查询", "AbortError");
    return payload as T;
  } catch (error) {
    if (timedOut) throw new Error("地图资料请求超时，请重试。");
    throw error;
  } finally { window.clearTimeout(timeout); signal?.removeEventListener("abort", abort); }
}
export const fetchGridMapOverview = (query: GridQuery, signal?: AbortSignal, publicAccess = false) => request<GridMapOverview>("overview", query, signal, publicAccess);
export const fetchGridMapSchool = (key: string, query: GridQuery, signal?: AbortSignal) => request<GridMapSchoolDetail>(`schools/${encodeURIComponent(key)}`, query, signal);
export const fetchGridMapCompany = (key: string, query: GridQuery, signal?: AbortSignal) => request<GridMapCompanyDetail>(`companies/${encodeURIComponent(key)}`, query, signal);
