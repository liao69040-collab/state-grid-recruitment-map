import { recruitmentEventTypeLabel } from './recruitment-event-taxonomy.js';

type Row = Record<string, unknown>;

type Dimensions = {
  schools?: Row[];
  companies?: Row[];
  provinces?: Row[];
  cities?: Row[];
  batches?: Row[];
  sources?: Row[];
};

export type SchoolOutcomeSelection = {
  cohortYear?: number;
  destinationProvinceId?: string;
  destinationCompanyId?: string;
};

const SCHOOL_BATCH_CODES = ['batch_1', 'batch_2', 'batch_3'] as const;

function objectValue(value: unknown): Row {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Row) : {};
}

function rowsValue(value: unknown): Row[] {
  return Array.isArray(value) ? value.filter((item): item is Row => Boolean(item) && typeof item === 'object') : [];
}

function stringArrayFromMetadata(row: Row, key: string): string[] {
  const metadata = objectValue(row.metadata);
  const value = metadata[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

function cloneJson<T extends Row>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function numericValue(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function cohortYearFrom(snapshot: Row, metrics: Row[]): number | null {
  const scope = objectValue(snapshot.scope);
  const hubei = objectValue(snapshot.hubei);
  for (const candidate of [scope.cohort, hubei.cohort]) {
    const match = String(candidate ?? '').match(/20\d{2}/);
    if (match) return Number(match[0]);
  }
  const schoolTotalYears = metrics
    .filter(
      (row) =>
        row.metricType === 'public_notice_record_count' &&
        row.aggregationGrain === 'cohort_school' &&
        row.batchCode === 'all',
    )
    .map((row) => numericValue(row.cohortYear))
    .filter((value): value is number => value !== null);
  if (schoolTotalYears.length) return Math.max(...schoolTotalYears);
  const years = metrics
    .map((row) => numericValue(row.cohortYear))
    .filter((value): value is number => value !== null);
  return years.length ? Math.max(...years) : null;
}

function currentMetrics(metrics: Row[], cohortYear: number | null): Row[] {
  return cohortYear === null
    ? metrics
    : metrics.filter((row) => numericValue(row.cohortYear) === cohortYear);
}

function metricNumber(metric: Row | undefined): number | null {
  if (!metric || metric.privacySuppressed === true) return null;
  return numericValue(metric.value);
}

function metricDisplay(metric: Row | undefined): string | number | null {
  if (!metric) return null;
  if (metric.privacySuppressed === true) return '<5';
  return numericValue(metric.value) ?? (typeof metric.displayValue === 'string' ? metric.displayValue : null);
}

function schoolMetricsFor(metrics: Row[], schoolId: unknown): Row[] {
  return metrics.filter((row) => row.schoolId === schoolId);
}

function destinationScope(row: Row): string {
  return typeof row.destinationScope === 'string' ? row.destinationScope : 'province_company';
}

function disciplineGroup(row: Row): string {
  return typeof row.disciplineGroup === 'string' ? row.disciplineGroup : 'all';
}

function evidenceStatus(row: Row | undefined, field: 'discipline' | 'major'): string {
  if (!row) return 'source_not_provided';
  const key = field === 'discipline' ? 'disciplineEvidenceStatus' : 'majorEvidenceStatus';
  return typeof row[key] === 'string' ? String(row[key]) : 'source_not_provided';
}

function aggregateEvidenceStatus(rows: Row[], field: 'discipline' | 'major'): string {
  if (!rows.length) return 'source_not_provided';
  const statuses = new Set(rows.map((row) => evidenceStatus(row, field)));
  if (statuses.size === 1) return [...statuses][0]!;
  if (statuses.has('pending_verification')) return 'pending_verification';
  if (statuses.has('partial_source') || statuses.has('source_not_provided')) return 'partial_source';
  return 'verified_source';
}

function professionalEvidenceLabel(value: string): string {
  const labels: Record<string, string> = {
    verified_source: '已核验来源',
    partial_source: '仅部分来源',
    source_not_provided: '源数据未提供·待补',
    pending_verification: '待核验',
  };
  return labels[value] ?? '待核验';
}

function findMetric(
  metrics: Row[],
  metricType: string,
  batchCode: string,
  aggregationGrain?: string,
  options: { destinationScope?: string; disciplineGroup?: string } = {},
): Row | undefined {
  return metrics.find(
    (row) =>
      row.metricType === metricType &&
      row.batchCode === batchCode &&
      (!aggregationGrain || row.aggregationGrain === aggregationGrain) &&
      (!options.destinationScope || destinationScope(row) === options.destinationScope) &&
      (!options.disciplineGroup || disciplineGroup(row) === options.disciplineGroup),
  );
}

function labelMap(rows: Row[] | undefined, labelField: string): Map<unknown, unknown> {
  return new Map((rows ?? []).map((row) => [row.id, row[labelField]]));
}

function isHubeiMetric(row: Row, dimensions: Dimensions): boolean {
  if (destinationScope(row) === 'network_total') return false;
  const province = (dimensions.provinces ?? []).find((candidate) => candidate.id === row.provinceId);
  if (province?.adcode === '420000' || province?.name === '湖北省') return true;
  const company = (dimensions.companies ?? []).find((candidate) => candidate.id === row.companyId);
  const companyName = String(company?.name ?? '');
  const unitScope = String(row.unitScope ?? '');
  return /(国网)?湖北(省)?电力/.test(companyName) || /(国网)?湖北(省)?电力/.test(unitScope);
}

function targetMetrics(
  metrics: Row[],
  dimensions: Dimensions,
  selection: SchoolOutcomeSelection,
): Row[] {
  return metrics.filter((row) => {
    if (destinationScope(row) === 'network_total') return false;
    if (selection.destinationCompanyId && row.companyId !== selection.destinationCompanyId) {
      return false;
    }
    if (selection.destinationProvinceId && row.provinceId !== selection.destinationProvinceId) {
      return false;
    }
    if (selection.destinationCompanyId || selection.destinationProvinceId) return true;
    return isHubeiMetric(row, dimensions);
  });
}

function matchingMetrics(
  metrics: Row[],
  batchCode: string,
  aggregationGrain: string,
  group = 'all',
): Row[] {
  return metrics.filter(
    (row) =>
      row.metricType === 'public_notice_record_count' &&
      row.batchCode === batchCode &&
      row.aggregationGrain === aggregationGrain &&
      disciplineGroup(row) === group,
  );
}

function aggregateMetricDisplay(metrics: Row[]): string | number | null {
  if (!metrics.length) return null;
  if (metrics.length === 1) return metricDisplay(metrics[0]);
  if (metrics.some((row) => row.privacySuppressed === true)) {
    return '含小样本隐藏·省级合计待补';
  }
  const values = metrics.map((row) => numericValue(row.value));
  return values.every((value): value is number => value !== null)
    ? values.reduce((sum, value) => sum + value, 0)
    : null;
}

function professionalSummary(metrics: Row[]): Row {
  const totalRows = matchingMetrics(metrics, 'all', 'cohort_school');
  const electricalRows = matchingMetrics(metrics, 'all', 'cohort_school', 'electrical');
  const nonElectricalRows = matchingMetrics(metrics, 'all', 'cohort_school', 'non_electrical');
  const disciplineRows = metrics.filter(
    (row) =>
      row.metricType === 'public_notice_record_count' &&
      row.batchCode === 'all' &&
      disciplineGroup(row) !== 'all',
  );
  const majorRows = disciplineRows.filter(
    (row) => typeof row.majorCategory === 'string' && row.majorCategory.trim(),
  );
  const disciplineEvidenceStatus = disciplineRows.length
    ? aggregateEvidenceStatus(disciplineRows, 'discipline')
    : totalRows.length
      ? aggregateEvidenceStatus(totalRows, 'discipline')
      : 'source_not_provided';
  const majorEvidenceStatus = majorRows.length
    ? aggregateEvidenceStatus(majorRows, 'major')
    : totalRows.length
      ? aggregateEvidenceStatus(totalRows, 'major')
      : 'source_not_provided';
  const majorCategories = [...new Set(majorRows.map((row) => String(row.majorCategory).trim()))]
    .sort((left, right) => left.localeCompare(right, 'zh-CN'));
  return {
    total: aggregateMetricDisplay(totalRows),
    campus: aggregateMetricDisplay(matchingMetrics(metrics, 'campus', 'cohort_batch_school')),
    batch1: aggregateMetricDisplay(matchingMetrics(metrics, 'batch_1', 'cohort_batch_school')),
    batch2: aggregateMetricDisplay(matchingMetrics(metrics, 'batch_2', 'cohort_batch_school')),
    batch3: aggregateMetricDisplay(matchingMetrics(metrics, 'batch_3', 'cohort_batch_school')),
    electrical: aggregateMetricDisplay(electricalRows),
    nonElectrical: aggregateMetricDisplay(nonElectricalRows),
    disciplineEvidenceStatus,
    majorEvidenceStatus,
    majorCategories,
    majorBreakdownStatus:
      disciplineRows.length && disciplineEvidenceStatus === 'verified_source'
        ? majorRows.length && majorEvidenceStatus === 'verified_source'
          ? '专业大类与细分专业已有来源'
          : '专业大类已有来源·细分专业待补'
        : professionalEvidenceLabel(String(disciplineEvidenceStatus)),
  };
}

function targetDestinationLabels(
  metrics: Row[],
  dimensions: Dimensions,
  selection: SchoolOutcomeSelection,
): Row {
  const provincesById = new Map((dimensions.provinces ?? []).map((row) => [row.id, row]));
  const companiesById = new Map((dimensions.companies ?? []).map((row) => [row.id, row]));
  const companyIds = [...new Set(metrics.map((row) => row.companyId).filter(Boolean))];
  const explicitCompany = selection.destinationCompanyId
    ? companiesById.get(selection.destinationCompanyId)
    : undefined;
  const company = explicitCompany;
  const provinceId =
    selection.destinationProvinceId ??
    company?.provinceId ??
    metrics.find((row) => row.provinceId)?.provinceId;
  const province = provinceId
    ? provincesById.get(provinceId)
    : (dimensions.provinces ?? []).find((row) => row.adcode === '420000' || row.name === '湖北省');
  const provinceName = province?.name ?? (selection.destinationProvinceId ? '目标省份待补' : '湖北省');
  const companyName = company?.name ?? null;
  const mappingMethods = [
    ...new Set(metrics.flatMap((row) => stringArrayFromMetadata(row, 'mapping_methods'))),
  ].sort((left, right) => left.localeCompare(right, 'zh-CN'));
  const sourceUnitLabels = [
    ...new Set(metrics.flatMap((row) => stringArrayFromMetadata(row, 'source_unit_labels'))),
  ].sort((left, right) => left.localeCompare(right, 'zh-CN'));
  const includesParentScopeMapping = mappingMethods.includes('source_unit_region_to_parent_scope');
  const explicitCompanyScope = Boolean(selection.destinationCompanyId);
  return {
    targetDestinationProvinceName: provinceName,
    targetDestinationCompanyName: companyName,
    targetDestinationName: explicitCompanyScope
      ? includesParentScopeMapping
        ? `${companyName ?? '目标单位待补'}关联省级去向汇总`
        : companyName ?? '目标单位待补'
      : `${provinceName}国网相关单位去向汇总`,
    targetDestinationScope: explicitCompanyScope
      ? includesParentScopeMapping
        ? '单位关联的省级映射汇总口径'
        : '单位映射口径'
      : '省级去向汇总口径',
    targetDestinationMappingStatus: includesParentScopeMapping
      ? '包含省级范围映射'
      : sourceUnitLabels.length
        ? '按源单位标签映射'
        : '源单位标签待补',
    targetDestinationMappingNote: explicitCompanyScope
      ? includesParentScopeMapping
        ? '该单位维度包含映射到省级范围的源单位标签，不能解读为全部由省公司本部录用。'
        : '按当前单位映射汇总；公示记录不等于签约、到岗或最终录用人数。'
      : '按目标省份汇总相关单位去向；不能解读为全部由省公司本部录用。',
    targetDestinationSourceUnitLabels: sourceUnitLabels.length ? sourceUnitLabels.join('、') : null,
  };
}

function schoolSummary(
  school: Row,
  metrics: Row[],
  cohortYear: number | null,
  dimensions: Dimensions,
  selection: SchoolOutcomeSelection,
): Row {
  const scoped = schoolMetricsFor(currentMetrics(metrics, cohortYear), school.id);
  const national = scoped.filter((row) => destinationScope(row) === 'network_total');
  const hubei = scoped.filter((row) => isHubeiMetric(row, dimensions));
  const target = targetMetrics(scoped, dimensions, selection);
  const nationalTotal = findMetric(
    national,
    'public_notice_record_count',
    'all',
    'cohort_school',
    { destinationScope: 'network_total', disciplineGroup: 'all' },
  );
  const hubeiTotal = findMetric(
    hubei,
    'public_notice_record_count',
    'all',
    'cohort_school',
    { disciplineGroup: 'all' },
  );
  const hubeiSummary = professionalSummary(hubei);
  const selectedSummary = professionalSummary(target);
  return {
    metricCohortYear: cohortYear,
    nationalGridRecordCount: metricDisplay(nationalTotal),
    nationalGridDataStatus: nationalTotal
      ? '已有当前规范映射学校的全国去向口径'
      : '待补全国去向口径',
    nationalGridCoverageNote:
      '仅统计已完成学校标准名映射的公示记录，不是全国全部学校榜单，不等于唯一自然人、签约或到岗人数。',
    ...targetDestinationLabels(target, dimensions, selection),
    targetGridRecordCount: selectedSummary.total,
    targetCampusRecordCount: selectedSummary.campus,
    targetCampusDataStatus: selectedSummary.campus === null ? '源数据未提供·待补' : '已有来源',
    targetBatch1RecordCount: selectedSummary.batch1,
    targetBatch2RecordCount: selectedSummary.batch2,
    targetBatch3RecordCount: selectedSummary.batch3,
    targetElectricalRecordCount: selectedSummary.electrical,
    targetNonElectricalRecordCount: selectedSummary.nonElectrical,
    targetDisciplineEvidenceStatus: professionalEvidenceLabel(
      String(selectedSummary.disciplineEvidenceStatus),
    ),
    targetMajorEvidenceStatus: professionalEvidenceLabel(String(selectedSummary.majorEvidenceStatus)),
    targetMajorCategories: (selectedSummary.majorCategories as string[]).length
      ? (selectedSummary.majorCategories as string[]).join('、')
      : null,
    targetMajorBreakdownStatus: selectedSummary.majorBreakdownStatus,
    hubeiGridRecordCount: metricDisplay(hubeiTotal),
    hubeiBatch1RecordCount: metricDisplay(
      findMetric(hubei, 'public_notice_record_count', 'batch_1', undefined, {
        disciplineGroup: 'all',
      }),
    ),
    hubeiBatch2RecordCount: metricDisplay(
      findMetric(hubei, 'public_notice_record_count', 'batch_2', undefined, {
        disciplineGroup: 'all',
      }),
    ),
    hubeiBatch3RecordCount: metricDisplay(
      findMetric(hubei, 'public_notice_record_count', 'batch_3', undefined, {
        disciplineGroup: 'all',
      }),
    ),
    hubeiCampusRecordCount: hubeiSummary.campus,
    hubeiElectricalRecordCount: hubeiSummary.electrical,
    hubeiNonElectricalRecordCount: hubeiSummary.nonElectrical,
    hubeiDisciplineEvidenceStatus: professionalEvidenceLabel(
      String(hubeiSummary.disciplineEvidenceStatus),
    ),
    hubeiMajorEvidenceStatus: professionalEvidenceLabel(String(hubeiSummary.majorEvidenceStatus)),
    hubeiMajorCategories: (hubeiSummary.majorCategories as string[]).length
      ? (hubeiSummary.majorCategories as string[]).join('、')
      : null,
    majorBreakdownStatus: hubeiSummary.majorBreakdownStatus,
    // Kept only for older clients. New admin screens must use the explicit Hubei field.
    allRecordCount: metricDisplay(hubeiTotal),
    batch1RecordCount: metricDisplay(
      findMetric(hubei, 'public_notice_record_count', 'batch_1', undefined, {
        disciplineGroup: 'all',
      }),
    ),
    batch2RecordCount: metricDisplay(
      findMetric(hubei, 'public_notice_record_count', 'batch_2', undefined, {
        disciplineGroup: 'all',
      }),
    ),
    batch3RecordCount: metricDisplay(
      findMetric(hubei, 'public_notice_record_count', 'batch_3', undefined, {
        disciplineGroup: 'all',
      }),
    ),
  };
}

export function enrichSchoolRows(
  schools: Row[],
  metrics: Row[],
  dimensions: Dimensions = {},
  selection: SchoolOutcomeSelection = {},
): Row[] {
  const cohortYear = Number.isInteger(selection.cohortYear)
    ? Number(selection.cohortYear)
    : cohortYearFrom({}, metrics);
  const provinceNames = labelMap(dimensions.provinces, 'name');
  const cityNames = labelMap(dimensions.cities, 'name');
  return schools.map((school) => ({
    ...school,
    schoolProvinceName: provinceNames.get(school.provinceId) ?? null,
    schoolCityName: cityNames.get(school.cityId) ?? null,
    ...schoolSummary(school, metrics, cohortYear, dimensions, selection),
  }));
}

export function enrichAdministrativeRows(rows: Row[], dimensions: Dimensions): Row[] {
  const companyNames = labelMap(dimensions.companies, 'name');
  const provinceNames = labelMap(dimensions.provinces, 'name');
  const cityNames = labelMap(dimensions.cities, 'name');
  const batchNames = labelMap(dimensions.batches, 'name');
  const sourcesById = new Map((dimensions.sources ?? []).map((source) => [source.id, source]));
  return rows.map((row) => ({
    ...row,
    ...(row.eventType ? { eventTypeLabel: recruitmentEventTypeLabel(row.eventType) } : {}),
    provinceName: provinceNames.get(row.provinceId) ?? null,
    cityName: cityNames.get(row.cityId) ?? null,
    companyName: companyNames.get(row.companyId) ?? null,
    batchName: batchNames.get(row.batchId) ?? null,
    sourceTitle: sourcesById.get(row.sourceDocumentId)?.title ?? null,
    sourcePublisher: sourcesById.get(row.sourceDocumentId)?.publisher ?? null,
    sourcePublishedAt: sourcesById.get(row.sourceDocumentId)?.publishedAt ?? null,
    sourceOfficialUrl: sourcesById.get(row.sourceDocumentId)?.officialUrl ?? null,
    sourceStatus: sourcesById.get(row.sourceDocumentId)?.status ?? null,
    sourceType: sourcesById.get(row.sourceDocumentId)?.sourceType ?? null,
  }));
}

export function enrichMetricRows(
  metrics: Row[],
  dimensions: Dimensions,
): Row[] {
  const schoolNames = labelMap(dimensions.schools, 'name');
  return enrichAdministrativeRows(metrics, dimensions).map((row) => ({
    ...row,
    schoolName: schoolNames.get(row.schoolId) ?? null,
    disciplineEvidenceLabel: professionalEvidenceLabel(evidenceStatus(row, 'discipline')),
    majorEvidenceLabel: professionalEvidenceLabel(evidenceStatus(row, 'major')),
  }));
}

function snapshotSchool(
  school: Row,
  base: Row,
  metrics: Row[],
  cohortYear: number | null,
): Row {
  const metadata = objectValue(school.metadata);
  const scoped = schoolMetricsFor(currentMetrics(metrics, cohortYear), school.id).filter(
    (row) => isHubeiMetric(row, {}) && disciplineGroup(row) === 'all',
  );
  const totalMetric = findMetric(scoped, 'public_notice_record_count', 'all', 'cohort_school');
  const total = metricNumber(totalMetric);
  const batchCounts: Row = {};
  const batchShare: Row = {};
  for (const code of SCHOOL_BATCH_CODES) {
    const count = findMetric(scoped, 'public_notice_record_count', code, 'cohort_batch_school');
    const share = findMetric(scoped, 'batch_share', code, 'cohort_batch_school');
    batchCounts[code] = {
      ...objectValue(objectValue(base.batch_counts)[code]),
      record_count: metricNumber(count),
      suppressed: count?.privacySuppressed === true,
      privacy_suppressed: count?.privacySuppressed === true,
      suppression_reason: count?.suppressionReason ?? null,
      suppressed_range: count?.suppressedRange ?? null,
      zero_confirmed: count?.zeroConfirmed === true,
    };
    batchShare[code] = metricNumber(share);
  }

  return {
    ...metadata,
    ...base,
    school_id: school.schoolKey ?? metadata.school_id,
    standard_name: school.name ?? metadata.standard_name,
    display_name: school.name ?? metadata.display_name,
    school_nature: school.nature ?? metadata.school_nature ?? null,
    education_level: school.educationLevel ?? metadata.education_level ?? null,
    record_count: total,
    metric_type: 'public_notice_record_count',
    batch_share_denominator: total,
    batch_counts: batchCounts,
    batch_share: batchShare,
    source_ids: Array.isArray(totalMetric?.sourceKeys)
      ? totalMetric.sourceKeys
      : Array.isArray(school.sourceKeys)
        ? school.sourceKeys
      : Array.isArray(metadata.source_ids)
        ? metadata.source_ids
        : [],
    updated_at: totalMetric?.updatedAt ?? school.updatedAt ?? metadata.updated_at ?? null,
  };
}

function snapshotSchools(snapshot: Row, schools: Row[], metrics: Row[], cohortYear: number | null): Row[] {
  const existing = new Map(rowsValue(snapshot.schools).map((row) => [row.school_id, row]));
  return schools
    .filter((row) => row.publicationStatus === 'published')
    .filter((school) => {
      const scoped = schoolMetricsFor(currentMetrics(metrics, cohortYear), school.id).filter(
        (row) => isHubeiMetric(row, {}),
      );
      return Boolean(
        findMetric(
          scoped,
          'public_notice_record_count',
          'all',
          'cohort_school',
          { disciplineGroup: 'all' },
        ),
      );
    })
    .map((school) => snapshotSchool(school, existing.get(school.schoolKey) ?? {}, metrics, cohortYear))
    .sort((left, right) => (numericValue(right.record_count) ?? -1) - (numericValue(left.record_count) ?? -1))
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

function overlayBatchRows(snapshotRows: Row[], batches: Row[], metrics: Row[], cohortYear: number | null): Row[] {
  const existing = new Map(snapshotRows.map((row) => [row.batch_code, row]));
  const currentBatches = batches.filter(
    (row) => row.publicationStatus === 'published' && numericValue(row.cohortYear) === cohortYear,
  );
  if (!currentBatches.length) return snapshotRows;
  const batchesByCode = new Map<string, Row[]>();
  for (const batch of currentBatches) {
    const code = String(batch.code ?? '');
    if (!code) continue;
    const grouped = batchesByCode.get(code) ?? [];
    grouped.push(batch);
    batchesByCode.set(code, grouped);
  }
  return [...batchesByCode.entries()]
    .map(([code, candidates]) => {
      const ranked = candidates
        .map((batch) => {
          const scoped = currentMetrics(metrics, cohortYear).filter(
            (metric) =>
              metric.batchId === batch.id &&
              metric.aggregationGrain === 'cohort_batch_company' &&
              disciplineGroup(metric) === 'all',
          );
          const plan = scoped.find((metric) => metric.metricType === 'plan_count');
          const records = scoped.find((metric) => metric.metricType === 'public_notice_record_count');
          return { batch, plan, records, score: Number(Boolean(plan)) * 2 + Number(Boolean(records)) };
        })
        .sort((left, right) => right.score - left.score || String(left.batch.id ?? '').localeCompare(String(right.batch.id ?? '')));
      const { batch, plan, records } = ranked[0]!;
      const existingRow = objectValue(existing.get(code));
      const metadata = objectValue(batch.metadata);
      const sourceIds = [...new Set(candidates.flatMap((candidate) =>
        Array.isArray(candidate.sourceKeys)
          ? candidate.sourceKeys.filter((key): key is string => typeof key === 'string')
          : Array.isArray(objectValue(candidate.metadata).source_ids)
            ? (objectValue(candidate.metadata).source_ids as unknown[]).filter((key): key is string => typeof key === 'string')
            : [],
      ))];
      return {
        ...metadata,
        ...existingRow,
        batch_code: code,
        ui_alias: batch.name,
        plan_count: metricNumber(plan) ?? numericValue(existingRow.plan_count),
        is_approximate: plan ? plan.isApproximate === true : existingRow.is_approximate === true,
        public_notice_record_count: metricNumber(records) ?? numericValue(existingRow.public_notice_record_count),
        source_ids: sourceIds,
        updated_at: batch.updatedAt ?? metadata.updated_at ?? null,
      };
    })
    .sort((left, right) => {
      const order = ['campus', 'batch_1', 'batch_2', 'batch_3'];
      return order.indexOf(String(left.batch_code)) - order.indexOf(String(right.batch_code));
    });
}

export function overlayPrivateDashboard(
  snapshot: Row,
  input: { schools: Row[]; metrics: Row[]; batches: Row[] },
): Row {
  const result = cloneJson(snapshot);
  const cohortYear = cohortYearFrom(result, input.metrics);
  result.schools = snapshotSchools(result, input.schools, input.metrics, cohortYear);
  result.batches = overlayBatchRows(rowsValue(result.batches), input.batches, input.metrics, cohortYear);
  result.data_sync = {
    source: 'canonical_relational_tables',
    cohort_year: cohortYear,
    school_count: rowsValue(result.schools).length,
  };
  return result;
}

export function overlayPublicDashboard(
  snapshot: Row,
  input: { schools: Row[]; metrics: Row[]; batches: Row[] },
): Row {
  const result = cloneJson(snapshot);
  const cohortYear = cohortYearFrom(result, input.metrics);
  const hubei = objectValue(result.hubei);
  const schoolSummaryBlock = objectValue(hubei.school_summary);
  const publicSchools = snapshotSchools(
    { schools: rowsValue(schoolSummaryBlock.items) },
    input.schools,
    input.metrics,
    cohortYear,
  ).map((row) => ({
    school_id: row.school_id,
    display_name: row.display_name,
    province: row.province ?? null,
    province_adcode: row.province_adcode ?? null,
    city: row.city ?? null,
    city_adcode: row.city_adcode ?? null,
    location_precision: row.location_precision ?? 'pending',
    record_count: row.record_count,
  }));
  const batchSummary = objectValue(hubei.batch_summary);
  hubei.school_summary = { ...schoolSummaryBlock, items: publicSchools };
  hubei.batch_summary = {
    ...batchSummary,
    items: overlayBatchRows(rowsValue(batchSummary.items), input.batches, input.metrics, cohortYear),
  };
  result.hubei = hubei;
  result.data_sync = {
    source: 'canonical_relational_tables',
    cohort_year: cohortYear,
    school_count: publicSchools.length,
  };
  return result;
}
