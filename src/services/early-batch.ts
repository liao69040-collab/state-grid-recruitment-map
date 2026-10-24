import { authState, bootstrapAuth, getAuthSessionEpoch } from "@/services/auth";

export const EARLY_BATCH_COHORT_YEAR = 2026 as const;
export type EarlyBatchDataStatus = "uploaded_reference_unverified" | "official_verified";

export interface EarlyBatchTemporalContext {
  cohortYear: number;
  dataStatus: EarlyBatchDataStatus;
}

export interface EarlyBatchTemporalRequest {
  cohortYear?: number;
}

export type DegreeCode = "bachelor" | "master" | "doctor";
export type MajorCategoryCode =
  | "electrical"
  | "computer"
  | "communication"
  | "electronic_information"
  | "artificial_intelligence"
  | "finance"
  | "human_resources"
  | "law"
  | "other_engineering"
  | "other";
export type SchoolTagCode =
  | "legacy_985"
  | "legacy_211"
  | "former_power_ministry"
  | "public_institution";
export type EligibilityDecision =
  | "eligible_under_workbook_rule"
  | "ineligible_under_workbook_rule"
  | "manual_review"
  | "missing_input";
export type EarlyBatchSchoolTagBasis = "dataset_verified" | "user_confirmed" | "unresolved";

export interface EarlyBatchApplicant {
  schoolKey?: string;
  schoolName?: string;
  schoolProvinceAdcode?: string;
  schoolTags?: SchoolTagCode[];
  schoolTagsConfirmed?: boolean;
  degree: DegreeCode;
  majorCategory?: MajorCategoryCode;
  freshGraduate?: boolean;
  graduationYear?: number;
  fullTime?: boolean;
  computerLevel2?: boolean;
  cet4OrHigher?: boolean;
  cet6OrHigher?: boolean;
  certificatesObtainedBeforeApplication?: boolean;
  nationalUnifiedAdmission?: boolean;
  majorMatchesEnrollment?: boolean;
  age?: number;
  hasFailedCourses?: boolean;
  gradesAcceptable?: boolean;
}

export interface EarlyBatchSchoolMatch {
  schoolKey: string;
  name: string;
  provinceAdcode?: string | null;
  educationLevel?: string | null;
  nature?: string | null;
  natureStatus?: string;
  natureBasis?: string | null;
  schoolTags: SchoolTagCode[];
  tagSourceStatus?: string;
  requiresConfirmation: boolean;
  sourceKeys: string[];
}

export interface EarlyBatchTarget {
  kind: "province" | "unit";
  code: string;
  name: string;
  provinceAdcode?: string | null;
  parentProvinceAdcode?: string | null;
}

export interface EarlyBatchSourceLocator {
  status: string;
  documentKey?: string;
  documentTitle: string;
  officialUrl?: string | null;
  range: string;
  locators: Record<string, string>;
  revisionKey?: string;
  revisionDataStatus?: string;
}

export interface EarlyBatchRequirement {
  field: string;
  label: string;
  operator: string;
  expected: unknown;
}

export interface EarlyBatchResult {
  target: EarlyBatchTarget;
  decision: EligibilityDecision;
  decisionLabel?: string;
  basis: string;
  reason: string;
  matchedBranchKey?: string | null;
  missingInputs: EarlyBatchRequirement[];
  unmetRequirements: EarlyBatchRequirement[];
  manualReviewReasons: string[];
  contextNotes?: string[];
  source: EarlyBatchSourceLocator;
}

export interface EarlyBatchEvaluation extends EarlyBatchTemporalContext {
  year: number;
  basis: "uploaded_workbook_rule";
  summary: {
    total: number;
    eligibleUnderWorkbookRule: number;
    ineligibleUnderWorkbookRule: number;
    missingInput: number;
    manualReview: number;
  };
  results: EarlyBatchResult[];
  disclaimer: string;
  schoolResolution?: {
    status: "matched_by_key" | "matched_by_exact_name" | "ambiguous" | "not_found" | "not_provided";
    selected: EarlyBatchSchoolMatch | null;
    candidates: EarlyBatchSchoolMatch[];
    tagBasis: EarlyBatchSchoolTagBasis;
    tagsConfirmed: boolean;
    userConfirmedTags?: boolean;
  };
}

export interface EarlyBatchCatalogItem {
  target: EarlyBatchTarget;
  plannedHeadcount?: string | null;
  missingFields: string[];
  source: EarlyBatchSourceLocator;
  updatedAt?: string;
}

export interface EarlyBatchCatalog extends EarlyBatchTemporalContext {
  year: number;
  sourceStatus?: string;
  disclaimer?: string;
  items: EarlyBatchCatalogItem[];
  targets: EarlyBatchTarget[];
}

export interface EarlyBatchTargetDetail extends EarlyBatchTemporalContext {
  year: number;
  target: EarlyBatchTarget;
  requirements: string;
  process?: string | null;
  plannedHeadcount?: string | null;
  assessmentMethod?: string | null;
  itinerary?: string | null;
  siteQuota?: string | null;
  admissionRule?: string | null;
  actualHeadcount?: string | null;
  notes?: string | null;
  missingFields: string[];
  evidenceAssets?: Array<{
    anchor?: string;
    name?: string;
    sha256?: string;
    note?: string;
  }>;
  externalEvidence?: Array<{
    anchor?: string;
    kind?: string;
    url?: string;
    status?: string;
  }>;
  metadata?: {
    suspected_miscolumn?: boolean;
    verification?: string;
    [key: string]: unknown;
  };
  source: EarlyBatchSourceLocator;
}

interface ApiErrorBody {
  error?: string | { code?: string; message?: string };
  message?: string;
}

export class EarlyBatchApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "EarlyBatchApiError";
    this.status = status;
    this.code = code;
  }
}

const apiBaseUrl = String(import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
const apiUrl = (path: string) => `${apiBaseUrl}${path}`;
const REQUEST_TIMEOUT_MS = 12_000;

const readApiError = async (response: Response, fallback: string) => {
  try {
    const payload = (await response.json()) as ApiErrorBody;
    const nested = typeof payload.error === "object" ? payload.error : undefined;
    const message = typeof payload.error === "string" ? payload.error : nested?.message || payload.message;
    return new EarlyBatchApiError(response.status, message || fallback, nested?.code);
  } catch {
    return new EarlyBatchApiError(response.status, fallback);
  }
};

const ensureAuthenticated = async () => {
  if (!authState.ready || !authState.authenticated || !authState.csrfToken) {
    await bootstrapAuth().catch(() => undefined);
  }
  if (!authState.authenticated) {
    throw new EarlyBatchApiError(401, "登录状态已失效，请重新登录。", "AUTH_REQUIRED");
  }
};

const request = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  await ensureAuthenticated();
  const epoch = getAuthSessionEpoch();
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (init.method && !["GET", "HEAD"].includes(init.method.toUpperCase()) && authState.csrfToken) {
    headers.set("X-CSRF-Token", authState.csrfToken);
  }
  try {
    const response = await fetch(apiUrl(path), {
      ...init,
      credentials: "include",
      cache: "no-store",
      headers,
      signal: controller.signal,
    });
    if (response.status === 401 && !controller.signal.aborted && epoch === getAuthSessionEpoch()) await bootstrapAuth().catch(() => undefined);
    if (!response.ok) throw await readApiError(response, "提前批数据请求失败，请稍后再试。");
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new EarlyBatchApiError(408, "请求超时，请检查网络后重试。", "REQUEST_TIMEOUT");
    }
    if (error instanceof EarlyBatchApiError) throw error;
    throw new EarlyBatchApiError(0, error instanceof Error ? error.message : "网络连接失败，请稍后再试。");
  } finally {
    window.clearTimeout(timeout);
  }
};

const payloadOf = <T>(response: T | { payload: T }): T => {
  if (response && typeof response === "object" && "payload" in response) return response.payload;
  return response as T;
};

export const isEarlyBatchUnauthorized = (error: unknown) =>
  error instanceof EarlyBatchApiError && error.status === 401;

interface EarlyBatchCatalogResponse extends EarlyBatchTemporalContext {
  year: number;
  sourceStatus?: string;
  disclaimer?: string;
  items?: EarlyBatchCatalogItem[];
}

interface EarlyBatchTargetResponse extends EarlyBatchTemporalContext {
  policy: EarlyBatchTargetDetail;
}

const temporalQuery = ({ cohortYear = EARLY_BATCH_COHORT_YEAR }: EarlyBatchTemporalRequest = {}) => {
  const params = new URLSearchParams({ cohortYear: String(cohortYear) });
  return params.toString();
};

export const getEarlyBatchCatalog = async (
  cohortYear = EARLY_BATCH_COHORT_YEAR,
): Promise<EarlyBatchCatalog> => {
  const response = payloadOf(await request<EarlyBatchCatalogResponse | { payload: EarlyBatchCatalogResponse }>(
    `/api/v2/private/early-batch/catalog?${temporalQuery({ cohortYear })}`,
  ));
  const items = response.items ?? [];
  return {
    year: response.year,
    cohortYear: response.cohortYear,
    dataStatus: response.dataStatus,
    sourceStatus: response.sourceStatus,
    disclaimer: response.disclaimer,
    items,
    targets: items.map((item) => item.target).filter(Boolean),
  };
};

export const getEarlyBatchTarget = async (
  targetCode: string,
  cohortYear = EARLY_BATCH_COHORT_YEAR,
) => {
  const response = payloadOf(await request<EarlyBatchTargetResponse | { payload: EarlyBatchTargetResponse }>(
    `/api/v2/private/early-batch/targets/${encodeURIComponent(targetCode)}?${temporalQuery({ cohortYear })}`,
  ));
  return response.policy;
};

export const searchEarlyBatchSchools = async (query: string, limit = 8) => {
  const response = payloadOf(await request<
    { items: EarlyBatchSchoolMatch[] } | { payload: { items: EarlyBatchSchoolMatch[] } }
  >("/api/v2/private/early-batch/schools/search", {
    method: "POST",
    body: JSON.stringify({ q: query.trim(), limit }),
  }));
  return Array.isArray(response.items) ? response.items : [];
};

export const evaluateEarlyBatchEligibility = async (
  applicant: EarlyBatchApplicant,
  targetCodes?: string[],
  temporal: EarlyBatchTemporalRequest = {},
) => payloadOf(await request<EarlyBatchEvaluation | { payload: EarlyBatchEvaluation }>(
  "/api/v2/private/early-batch/evaluate",
  {
    method: "POST",
    body: JSON.stringify({
      cohortYear: temporal.cohortYear ?? EARLY_BATCH_COHORT_YEAR,
      ...(targetCodes?.length ? { targetCodes } : {}),
      applicant,
    }),
  },
));
