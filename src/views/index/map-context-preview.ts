import type { GridCountBasis, GridMapBatch, GridMapCounts, GridMapOverview, GridMapProvince, GridMapSchool, SchoolRecruitmentSummary } from '../../services/grid-map';

export type MapPreviewSelection = GridMapOverview['selection'];
export interface MapPreviewMetric { key: string; label: string; value: number | null }
export interface MapPreviewBatch extends MapPreviewMetric { key: GridMapBatch }
export interface MapPreviewGridGroup { grid: 'sgcc' | 'csg'; label: string; batches: MapPreviewBatch[] }
export interface MapPreviewEligibilityRequest {
  provinceAdcode: string | null;
  batchCode?: 'campus' | 'csg_campus';
  targetCohortYear: number | null;
}
export interface MapContextPreviewData {
  kind: 'national' | 'province' | 'school';
  key: string;
  title: string;
  subtitle: string;
  provinceAdcode: string | null;
  campusKey: string | null;
  dataCohortYear: number | null;
  targetCohortYear: number | null;
  scopeLabel: string;
  countBasis: GridCountBasis;
  totalLabel: string;
  total: number | null;
  metrics: MapPreviewMetric[];
  batches: MapPreviewBatch[];
  gridGroups: MapPreviewGridGroup[];
}

const nativeBatches: ReadonlyArray<{ key: GridMapBatch; label: string; grid: 'sgcc' | 'csg' }> = [
  { key: 'batch_1', label: '国网第一批', grid: 'sgcc' },
  { key: 'batch_2', label: '国网第二批', grid: 'sgcc' },
  { key: 'batch_3', label: '国网第三批', grid: 'sgcc' },
  { key: 'csg_autumn', label: '南网秋招', grid: 'csg' },
  { key: 'csg_spring', label: '南网春招', grid: 'csg' },
];

/** No coercion, subtraction or summation: a suppressed/missing value stays missing. */
export const previewCount = (value: unknown): number | null => typeof value === 'number'
  && Number.isSafeInteger(value) && value >= 0 ? value : null;
export const previewCountText = (value: number | null) => previewCount(value)?.toLocaleString('zh-CN') ?? '—';
const cohort = (value: unknown): number | null => typeof value === 'number'
  && Number.isInteger(value) && value >= 2000 && value <= 2200 ? value : null;
const gridLabel = (grid: string | null) => !grid || grid === 'all' ? '国网 + 南网'
  : grid === 'sgcc' ? '国家电网' : grid === 'csg' ? '南方电网' : grid === 'impc' ? '内蒙古电力' : '所选电网';
export function previewScopeLabel(selection: MapPreviewSelection): string {
  const batch = !selection.batchCode || selection.batchCode === 'all' ? '全部批次'
    : nativeBatches.find(row => row.key === selection.batchCode)?.label
      || (selection.batchCode === 'campus' ? '提前批条件' : '所选批次');
  return `${gridLabel(selection.grid)} · ${batch}`;
}
export function previewNativeBatches(counts: Partial<GridMapCounts> | undefined, selection: MapPreviewSelection): MapPreviewBatch[] {
  return nativeBatches.flatMap(row => {
    if (selection.grid && selection.grid !== 'all' && selection.grid !== row.grid) return [];
    if (selection.batchCode && selection.batchCode !== 'all' && selection.batchCode !== row.key) return [];
    const value = previewCount(counts?.[row.key]);
    // Do not draw absent native batches as zero or turn campus into a sixth count.
    return value === null ? [] : [{ key: row.key, label: row.label, value }];
  });
}
/**
 * Groups the native batches by grid so 国网 and 南网 are always named
 * separately. Deliberately carries no subtotal: a suppressed batch would make
 * any sum a fabricated figure, so each row keeps its own value or stays blank.
 */
export function previewGridGroups(counts: Partial<GridMapCounts> | undefined, selection: MapPreviewSelection): MapPreviewGridGroup[] {
  const batches = previewNativeBatches(counts, selection);
  const wanted: ReadonlyArray<{ grid: 'sgcc' | 'csg'; label: string }> = [
    { grid: 'sgcc', label: '国家电网' }, { grid: 'csg', label: '南方电网' },
  ];
  const gridOf = (key: GridMapBatch) => nativeBatches.find(row => row.key === key)?.grid;
  return wanted.flatMap(group => {
    if (selection.grid && selection.grid !== 'all' && selection.grid !== group.grid) return [];
    return [{ ...group, batches: batches.filter(row => gridOf(row.key) === group.grid) }];
  });
}
const years = (selection: MapPreviewSelection, targetCohortYear: number | null) => ({
  dataCohortYear: cohort(selection.cohortYear), targetCohortYear: cohort(targetCohortYear),
});

export function buildProvincePreview(province: GridMapProvince, selection: MapPreviewSelection, targetCohortYear: number | null): MapContextPreviewData {
  return {
    kind: 'province', key: province.adcode, title: province.name, subtitle: '省份录用去向',
    provinceAdcode: province.adcode, campusKey: null, ...years(selection, targetCohortYear),
    scopeLabel: previewScopeLabel(selection), countBasis: province.countBasis,
    totalLabel: '录用公示合计', total: previewCount(province.recordCount),
    metrics: [], batches: previewNativeBatches(province.batchCounts, selection),
    gridGroups: previewGridGroups(province.batchCounts, selection),
  };
}

export function buildNationalPreview(input: {
  recordCount: number | null;
  batchCounts: Partial<GridMapCounts>;
  countBasis: GridCountBasis;
  selection: MapPreviewSelection;
  targetCohortYear: number | null;
}): MapContextPreviewData {
  return {
    kind: 'national', key: 'national', title: '全国电网', subtitle: '全国录用总览',
    provinceAdcode: null, campusKey: null, ...years(input.selection, input.targetCohortYear),
    scopeLabel: previewScopeLabel(input.selection), countBasis: input.countBasis,
    totalLabel: '录用公示合计', total: previewCount(input.recordCount),
    metrics: [], batches: previewNativeBatches(input.batchCounts, input.selection),
    gridGroups: previewGridGroups(input.batchCounts, input.selection),
  };
}

type PreviewSchool = Pick<GridMapSchool, 'campusKey' | 'schoolName' | 'campusName' | 'city' | 'province'
  | 'countBasis' | 'nationalRecordCount' | 'destinationProvinceRecordCount' | 'gridCounts' | 'batchCounts'>;
function schoolGridMetrics(counts: GridMapSchool['gridCounts'], selection: MapPreviewSelection): MapPreviewMetric[] {
  const selectedBatchGrid = nativeBatches.find(row => row.key === selection.batchCode)?.grid;
  return ([['sgcc', '国家电网'], ['csg', '南方电网']] as const).flatMap(([key, label]) => {
    if ((selection.grid && selection.grid !== 'all' && selection.grid !== key)
      || (selectedBatchGrid && selectedBatchGrid !== key)) return [];
    return [{ key, label, value: previewCount(counts[key]) }];
  });
}
export function buildSchoolPreview(school: PreviewSchool, selection: MapPreviewSelection, targetCohortYear: number | null,
  targetProvince?: { adcode: string; name: string } | null): MapContextPreviewData {
  const target = targetProvince && targetProvince.adcode === selection.provinceAdcode ? targetProvince : null;
  return {
    kind: 'school', key: school.campusKey, title: school.campusName || school.schoolName,
    subtitle: [school.province, school.city].filter(Boolean).join(' · '),
    provinceAdcode: target?.adcode || null, campusKey: school.campusKey, ...years(selection, targetCohortYear),
    scopeLabel: previewScopeLabel(selection), countBasis: school.countBasis,
    totalLabel: '全国录用去向', total: previewCount(school.nationalRecordCount),
    metrics: [
      ...(target ? [{ key: 'target', label: `进入${target.name}`, value: previewCount(school.destinationProvinceRecordCount) }] : []),
      ...schoolGridMetrics(school.gridCounts, selection),
    ],
    batches: previewNativeBatches(school.batchCounts, selection),
    gridGroups: previewGridGroups(school.batchCounts, selection),
  };
}

/** The detail summary is a separate all-batch scope; never fill it from the current filtered summary. */
export function buildSchoolRecruitmentPreview(school: PreviewSchool, summary: SchoolRecruitmentSummary,
  targetCohortYear: number | null): MapContextPreviewData {
  return buildSchoolPreview({ ...school,
    nationalRecordCount: summary.national.recordCount,
    destinationProvinceRecordCount: summary.targetProvince?.recordCount ?? null,
    gridCounts: summary.national.gridCounts, batchCounts: summary.national.batchCounts,
  }, { cohortYear: summary.cohortYear, grid: summary.grid, batchCode: null,
    provinceAdcode: summary.targetProvince?.adcode ?? null }, targetCohortYear, summary.targetProvince);
}
