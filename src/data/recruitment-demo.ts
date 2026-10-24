export type DashboardMode = "school" | "company";
export type MapLevel = "national" | "hubei";
export type BatchState = "provisional" | "suppressed" | "unpublished" | "unverified" | "not-applicable";

export interface BatchResult {
  name: string;
  officialName: string;
  value: number | null;
  state: BatchState;
  note: string;
}

export interface OrganizationSummary {
  unitCount: number;
  regionCount: number;
  planApprox: number;
  sectionCount?: number;
  note: string;
}

export interface LocationSummary {
  recruitingUnitCount: number;
  precision: string;
  note: string;
}

export interface RecruitingUnit {
  unitName: string;
  sectionName: string;
  locationLabel: string;
  locationPrecision: string;
  headcountStatus: string;
}

export interface SchoolUnitFlow {
  unitName: string;
  cohort: string;
  batch: string;
  recordCount: number | null;
  status: string;
  privacySuppressed: boolean;
  suppressedRange: string | null;
  zeroConfirmed: boolean;
}

export interface MapEntity {
  id: string;
  type: DashboardMode;
  name: string;
  shortName: string;
  city: string;
  coordinates: [number, number];
  symbolOffset?: [number, number];
  category: string;
  level: string;
  locationLabel: string;
  positionStatus: string;
  metricValue: number | null;
  metricLabel: string;
  valueStatus: string;
  sourceLabel?: string;
  sourceUrl?: string;
  batchResults: BatchResult[];
  tags: string[];
  note: string;
  organizationSummary?: OrganizationSummary;
  locationSummary?: LocationSummary;
  recruitingUnits?: RecruitingUnit[];
  unitFlows?: SchoolUnitFlow[];
}

export interface RegionMetric {
  name: string;
  value: number | null;
  coverage: "演示" | "待接入";
}

export interface CalendarEvent {
  id: string;
  title: string;
  batch: string;
  scope: string;
  status: "待官方发布";
  dateText: string;
}

/** Public edition retains the legacy type contract only. Historical customer
 * aggregates were removed; the runnable synthetic dataset lives in /demo. */
export const calendarEvents: CalendarEvent[] = [];
export const nationalRegionMetrics: RegionMetric[] = [];
export const hubeiRegionMetrics: RegionMetric[] = [];
export const schoolEntities: MapEntity[] = [];
export const companyEntities: MapEntity[] = [];
export const hubeiPlanSnapshot: { name: string; value: number; note: string }[] = [];
export const hubeiNoticeSnapshot: { name: string; value: number; note: string }[] = [];
export const getEntitiesByMode = (mode: DashboardMode) =>
  mode === 'school' ? schoolEntities : companyEntities;
