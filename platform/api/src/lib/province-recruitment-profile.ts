import { containsPrivateSourceReference, privateSourceIndex, publicSourceMetadata, publicSourceRows } from './private-source-boundary.js';

type Row = Record<string, any>;

export type ProvinceRecruitmentProfileInput = {
  province: Row;
  companies: Row[];
  batches: Row[];
  events: Row[];
  requirements: Row[];
  metrics?: Row[];
  revisions: Row[];
  sources: Row[];
  filters?: { cohortYear?: number; batchCode?: string; companyKey?: string };
};

const arrayStrings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && Boolean(item)) : [];

const metadataOf = (row: Row | undefined): Row =>
  row?.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata) ? row.metadata : {};

const payloadOf = (row: Row | undefined): Row =>
  row?.payload && typeof row.payload === 'object' && !Array.isArray(row.payload) ? row.payload : {};

const calendarDate = (value: unknown): string => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const raw = String(value ?? '').trim();
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(raw);
  return match?.[1] ?? '';
};

const instantValue = (value: unknown): number => {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? Number.MAX_SAFE_INTEGER : value.getTime();
  const parsed = Date.parse(String(value ?? ''));
  return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
};

const compareEvents = (left: Row, right: Row): number => {
  const leftDay = calendarDate(left.startsOn ?? left.endsOn ?? left.startsAt ?? left.endsAt) || '9999-12-31';
  const rightDay = calendarDate(right.startsOn ?? right.endsOn ?? right.startsAt ?? right.endsAt) || '9999-12-31';
  const dayOrder = leftDay.localeCompare(rightDay);
  if (dayOrder !== 0) return dayOrder;
  return instantValue(left.startsAt ?? left.endsAt) - instantValue(right.startsAt ?? right.endsAt);
};

const recruitmentBatchOrder = ['campus', 'batch_1', 'batch_2', 'batch_3', 'all'];
const requirementCategoryOrder = [
  'application_materials',
  'major',
  'education',
  'academic_verification',
  'health',
  'age',
  'cohort',
  'language_and_computer',
  'overseas_education',
  'special_obligation',
  'integrity',
  'training_mode',
];

const businessRank = (order: readonly string[], value: unknown): number => {
  const index = order.indexOf(String(value ?? ''));
  return index < 0 ? order.length : index;
};

const compareRequirements = (left: Row, right: Row): number =>
  businessRank(recruitmentBatchOrder, left.batchCode) - businessRank(recruitmentBatchOrder, right.batchCode) ||
  businessRank(requirementCategoryOrder, left.category) - businessRank(requirementCategoryOrder, right.category) ||
  String(left.evidenceLocator ?? '').localeCompare(String(right.evidenceLocator ?? ''), 'zh-CN') ||
  String(left.requirementKey ?? left.id ?? '').localeCompare(String(right.requirementKey ?? right.id ?? ''), 'zh-CN');

const compareSourcesNewestFirst = (left: Row, right: Row): number => {
  const leftInstant = instantValue(left.publishedAt ?? left.accessedAt);
  const rightInstant = instantValue(right.publishedAt ?? right.accessedAt);
  if (leftInstant !== rightInstant) return rightInstant - leftInstant;
  return String(right.sourceKey ?? '').localeCompare(String(left.sourceKey ?? ''));
};

const compactSource = (row: Row) => ({
  sourceKey: row.sourceKey,
  title: row.title,
  sourceType: row.sourceType,
  publisher: row.publisher,
  officialUrl: row.officialUrl,
  publishedAt: row.publishedAt,
  accessedAt: row.accessedAt,
  status: row.status,
  notes: row.notes,
  evidenceTier:
    row.sourceType === 'historical_supplement'
      ? metadataOf(row).evidenceTier ?? 'C'
      : ['current_official_page', 'official_attachment', 'national_official_page', 'national_official_attachment'].includes(
            String(row.sourceType),
          )
        ? 'A'
        : 'C',
  metadata: publicSourceMetadata(row.metadata),
});

export function buildProvinceRecruitmentProfile(input: ProvinceRecruitmentProfileInput): Row {
  const privateIndex = privateSourceIndex(input.sources);
  input = {
    ...input,
    sources: publicSourceRows(input.sources, privateIndex),
    companies: publicSourceRows(input.companies, privateIndex),
    batches: publicSourceRows(input.batches, privateIndex),
    events: publicSourceRows(input.events, privateIndex),
    requirements: publicSourceRows(input.requirements, privateIndex),
    metrics: publicSourceRows(input.metrics ?? [], privateIndex),
    revisions: input.revisions.filter(row => !containsPrivateSourceReference(row, privateIndex)),
  };
  const cohortYear = input.filters?.cohortYear ?? 2026;
  const requestedBatch = input.filters?.batchCode;
  const requestedCompany = input.filters?.companyKey;
  const companies = input.companies
    .filter((company) => !requestedCompany || company.companyKey === requestedCompany)
    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh-CN'));
  const sourceByKey = new Map(input.sources.map((source) => [String(source.sourceKey), source]));

  const units = companies.map((company) => {
    const revision = input.revisions.find((row) => metadataOf(row).unit_key === company.companyKey);
    const profile = payloadOf(revision);
    const batches = input.batches.filter(
      (row) =>
        row.companyId === company.id &&
        row.cohortYear === cohortYear &&
        (!requestedBatch || row.code === requestedBatch),
    );
    const batchIds = new Set(batches.map((row) => row.id));
    const events = input.events
      .filter(
        (row) =>
          row.companyId === company.id &&
          row.cohortYear === cohortYear &&
          (!requestedBatch || row.batchCode === requestedBatch || batchIds.has(row.batchId)),
      )
      .sort(compareEvents);
    const requirements = input.requirements
      .filter(
        (row) =>
          row.companyId === company.id &&
          row.cohortYear === cohortYear &&
          (!requestedBatch || row.batchCode === requestedBatch),
      )
      .sort(compareRequirements);
    const headcountFacts = (input.metrics ?? [])
      .filter(
        (row) =>
          row.companyId === company.id &&
          row.cohortYear === cohortYear &&
          row.metricType === 'planned_headcount_raw_mention' &&
          (!requestedBatch || row.batchCode === requestedBatch),
      )
      .sort((left, right) => {
        const batchOrder = String(left.batchCode ?? '').localeCompare(String(right.batchCode ?? ''));
        if (batchOrder !== 0) return batchOrder;
        const leftMeta = metadataOf(left);
        const rightMeta = metadataOf(right);
        const paragraphOrder = Number(leftMeta.paragraphIndex ?? 0) - Number(rightMeta.paragraphIndex ?? 0);
        if (paragraphOrder !== 0) return paragraphOrder;
        return String(left.metricKey ?? '').localeCompare(String(right.metricKey ?? ''));
      })
      .map((row) => ({
        headcountKey: row.metricKey,
        batchCode: row.batchCode,
        value: row.value == null ? null : Number(row.value),
        displayValue: row.displayValue,
        valueKind: row.valueKind,
        aggregationGrain: row.aggregationGrain,
        unit: row.unit,
        isApproximate: row.isApproximate,
        subjectScope: row.subjectScope,
        sumSafe: metadataOf(row).sum_safe === true,
        relationHint: metadataOf(row).relation_hint,
        evidenceExcerpt: metadataOf(row).evidence_excerpt,
        evidenceLocator: metadataOf(row).evidence_locator,
        evidenceTier: 'A',
        sourceKeys: arrayStrings(row.sourceKeys),
        sourceDocumentId: row.sourceDocumentId,
        status: row.status,
      }));
    const sourceKeys = new Set<string>();
    for (const row of [...batches, ...events, ...requirements, ...headcountFacts]) {
      arrayStrings(row.sourceKeys).forEach((key) => sourceKeys.add(key));
      if (row.sourceDocumentId) {
        const source = input.sources.find((candidate) => candidate.id === row.sourceDocumentId);
        if (source?.sourceKey) sourceKeys.add(String(source.sourceKey));
      }
    }
    arrayStrings(metadataOf(revision).source_keys).forEach((key) => sourceKeys.add(key));
    arrayStrings(metadataOf(revision).sourceKeys).forEach((key) => sourceKeys.add(key));
    arrayStrings(profile.sourceKeys).forEach((key) => sourceKeys.add(key));
    const sources = [...sourceKeys]
      .map((key) => sourceByKey.get(key))
      .filter((row): row is Row => Boolean(row))
      .map(compactSource)
      .sort(compareSourcesNewestFirst);
    const currentOfficialEventCount = events.filter(
      (row) =>
        row.evidenceTier === 'A' &&
        ['current_official', 'currentOfficialPage'].includes(String(row.sourceKind)),
    ).length;
    const historicalEventCount = events.length - currentOfficialEventCount;
    return {
      company: {
        id: company.id,
        companyKey: company.companyKey,
        name: company.name,
        companyType: company.companyType,
        unitScope: company.unitScope,
        status: company.status,
        metadata: metadataOf(company),
      },
      revision: revision
        ? {
            revisionKey: revision.revisionKey,
            title: revision.title,
            dataStatus: revision.dataStatus,
            publishedAt: revision.publishedAt,
          }
        : null,
      profile,
      summary: {
        batchCount: batches.length,
        eventCount: events.length,
        currentOfficialEventCount,
        historicalEventCount,
        preciseTimeEventCount: events.filter((row) => Boolean(row.startsAt || row.endsAt)).length,
        locationKnownEventCount: events.filter((row) => Boolean(row.locationText)).length,
        requirementCount: requirements.length,
        headcountMentionCount: headcountFacts.length,
        sourceCount: sources.length,
      },
      batches,
      events,
      requirements,
      headcountFacts,
      sources,
    };
  });

  const dataAsOf = input.revisions
    .map((revision) => metadataOf(revision).as_of)
    .filter(Boolean)
    .sort()
    .at(-1) ?? null;
  return {
    schemaVersion: '1.0.0',
    datasetId: 'sgcc-provincial-recruitment-2026-v1',
    generatedAt: new Date().toISOString(),
    dataAsOf,
    cohortYear,
    filters: {
      batchCode: requestedBatch ?? null,
      companyKey: requestedCompany ?? null,
    },
    province: input.province,
    summary: {
      unitCount: units.length,
      batchCount: units.reduce((sum, unit) => sum + unit.summary.batchCount, 0),
      eventCount: units.reduce((sum, unit) => sum + unit.summary.eventCount, 0),
      requirementCount: units.reduce((sum, unit) => sum + unit.summary.requirementCount, 0),
      headcountMentionCount: units.reduce((sum, unit) => sum + unit.summary.headcountMentionCount, 0),
      sourceCount: new Set(units.flatMap((unit) => unit.sources.map((source: Row) => source.sourceKey))).size,
    },
    units,
    boundaries: [
      '本页是2026届历史招聘周期资料，不代表下一届公告已经发布。',
      '管理城市、宣讲城市、资格审查/考试地点和工作地点分开记录，不相互推定。',
      '公告未写具体时刻时保持“官方未公开”，不补成00:00或24:00。',
      'B/C级资料为历史恢复证据，不能当作当前官网仍可读取的A级资料。',
      '招聘人数条目按官方原文逐处记录，可能同时包含批次总数、主体分项、岗位分项或专业分项；默认不可跨条相加。',
      '河北与冀北按两个招聘主体分别展示；内蒙古仅覆盖国家电网蒙东范围。',
    ],
  };
}
