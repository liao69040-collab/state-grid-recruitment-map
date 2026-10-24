import { bootstrapAuth, getAuthSessionEpoch } from "@/services/auth";

export type EvidenceTier = "A" | "B" | "C" | string;

export interface ProvincialRecruitmentSource {
  sourceKey?: string;
  source_id?: string;
  title?: string;
  sourceType?: string;
  source_type?: string;
  publisher?: string;
  officialUrl?: string | null;
  official_url?: string | null;
  publishedOn?: string | null;
  publishedAt?: string | null;
  published_at?: string | null;
  status?: string;
  evidenceTier?: EvidenceTier;
  metadata?: Record<string, unknown> | null;
}

export interface ProvincialRecruitmentEvent {
  eventKey?: string;
  batchCode?: string | null;
  title?: string;
  eventType?: string | null;
  startsOn?: string | null;
  endsOn?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  rawTimeText?: string | null;
  datePrecision?: string | null;
  timeStatus?: string | null;
  certainty?: string | null;
  locationText?: string | null;
  locationKind?: string | null;
  evidenceExcerpt?: string | null;
  notes?: string | null;
  evidenceTier?: EvidenceTier;
  sourceKind?: string | null;
  sourceKeys?: string[];
  metadata?: Record<string, any> | null;
}

export interface ProvincialRecruitmentRequirement {
  requirementKey?: string;
  category?: string;
  title?: string;
  excerpt?: string;
  applicability?: string | null;
  evidenceTier?: EvidenceTier;
  batchCode?: string | null;
  sourceKeys?: string[];
}

export interface ProvincialRecruitmentHeadcountFact {
  headcountKey?: string;
  batchCode?: string | null;
  value?: number | null;
  displayValue?: string | null;
  valueKind?: string | null;
  aggregationGrain?: string | null;
  unit?: string | null;
  isApproximate?: boolean | null;
  subjectScope?: string | null;
  sumSafe?: boolean;
  relationHint?: string | null;
  evidenceExcerpt?: string | null;
  evidenceLocator?: string | null;
  evidenceTier?: EvidenceTier;
  sourceKeys?: string[];
  sourceDocumentId?: string | null;
  status?: string | null;
}

export interface ProvincialRecruitmentBatch {
  batchCode?: string;
  code?: string;
  name?: string;
  officialName?: string;
  title?: string;
  status?: string;
  [key: string]: unknown;
}

export interface ProvincialRecruitmentUnit {
  company?: {
    companyKey?: string;
    name?: string;
    metadata?: Record<string, unknown> | null;
  };
  revision?: Record<string, unknown> | null;
  profile?: Record<string, unknown> | null;
  summary?: Record<string, unknown> | null;
  batches?: ProvincialRecruitmentBatch[];
  events?: ProvincialRecruitmentEvent[];
  requirements?: ProvincialRecruitmentRequirement[];
  headcountFacts?: ProvincialRecruitmentHeadcountFact[];
  sources?: ProvincialRecruitmentSource[];
}

export interface ProvinceRecruitmentProfile {
  schemaVersion?: string;
  datasetId?: string;
  dataAsOf?: string;
  cohortYear?: number;
  province?: {
    adcode?: string;
    name?: string;
  };
  summary?: {
    unitCount?: number;
    batchCount?: number;
    eventCount?: number;
    requirementCount?: number;
    headcountMentionCount?: number;
    sourceCount?: number;
  };
  units?: ProvincialRecruitmentUnit[];
  boundaries?: unknown;
}

const apiBaseUrl = String(import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");

const readError = async (response: Response) => {
  try {
    const body = await response.json();
    if (typeof body?.error === "string") return body.error;
    return typeof body?.error?.message === "string" ? body.error.message : "";
  } catch {
    return "";
  }
};

const REQUEST_TIMEOUT_MS = 12_000;

export const fetchProvinceRecruitmentProfile = async (
  adcode: string,
  cohortYear = 2026,
  signal?: AbortSignal,
): Promise<ProvinceRecruitmentProfile> => {
  const params = new URLSearchParams({ cohortYear: String(cohortYear) });
  // Without a deadline a half-open connection left the panel spinning on
  // "正在加载该省招聘要求与时间线" forever, with no error the presenter could see.
  const timeoutController = new AbortController();
  const timeout = window.setTimeout(() => timeoutController.abort(), REQUEST_TIMEOUT_MS);
  const abortSignal = signal
    ? AbortSignal.any([signal, timeoutController.signal])
    : timeoutController.signal;

  const epoch = getAuthSessionEpoch();
  try {
    const response = await fetch(`${apiBaseUrl}/api/v2/private/provinces/${encodeURIComponent(adcode)}/recruitment-profile?${params}`, {
      credentials: "include",
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: abortSignal,
    });

    if (response.status === 401) {
      // An old request must not trigger a refresh during a newer login/logout.
      if (!abortSignal.aborted && epoch === getAuthSessionEpoch()) {
        void bootstrapAuth().catch(() => undefined);
      }
      throw new Error("登录状态已失效，请重新登录。");
    }
    if (!response.ok) {
      throw new Error(await readError(response) || `省级招聘资料加载失败（${response.status}）`);
    }
    const body = await response.json();
    const payload = (body?.payload ?? body) as ProvinceRecruitmentProfile;
    if (!payload || !Array.isArray(payload.units)) throw new Error("省级招聘资料返回格式无效。");
    return payload;
  } catch (error) {
    if (timeoutController.signal.aborted) {
      throw new Error("省级招聘资料请求超时，请检查网络后重试。");
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
};
