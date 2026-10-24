import { createHash } from 'node:crypto';

export type CanonicalRow = Record<string, unknown>;

export type CanonicalMetricContext = {
  network: string;
  batchCodeById: ReadonlyMap<string, string>;
  companyNameById: ReadonlyMap<string, string>;
};

export function stringValue(row: CanonicalRow, key: string, fallback = ''): string {
  const value = row[key];
  return typeof value === 'string' ? value : fallback;
}

export function requiredString(row: CanonicalRow, key: string, rowLabel: string): string {
  const value = stringValue(row, key).trim();
  if (!value) throw new Error(`${rowLabel}.${key} is required`);
  return value;
}

export function nullableString(row: CanonicalRow, key: string): string | null {
  const value = row[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export function numberValue(row: CanonicalRow, key: string): number | null {
  const value = row[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function requiredInteger(row: CanonicalRow, key: string, rowLabel: string): number {
  const value = numberValue(row, key);
  if (value === null || !Number.isInteger(value)) throw new Error(`${rowLabel}.${key} must be an integer`);
  return value;
}

export function arrayStrings(row: CanonicalRow, key: string): string[] {
  const value = row[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

export function deterministicUuid(key: string): string {
  const bytes = createHash('sha256').update(`hengzhen-canonical-v2:${key}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function canonicalBatchCode(
  row: CanonicalRow,
  batchCodeById: ReadonlyMap<string, string>,
  rowLabel: string,
): string {
  const batchId = nullableString(row, 'batch_id');
  if (batchId) {
    const code = batchCodeById.get(batchId);
    if (!code) throw new Error(`${rowLabel}.batch_id references unknown batch ${batchId}`);
    return code;
  }

  const grain = requiredString(row, 'aggregation_grain', rowLabel);
  if (grain.startsWith('cohort_batch_') || grain === 'provided_image_group') {
    throw new Error(`${rowLabel}.batch_id is required for grain ${grain}`);
  }
  return grain === 'cohort_school' ? 'all' : 'not_applicable';
}

export function primarySourceKey(row: CanonicalRow, rowLabel: string): string {
  const sourceKeys = arrayStrings(row, 'source_ids');
  if (!sourceKeys.length) throw new Error(`${rowLabel}.source_ids must contain at least one source`);

  const metricName = stringValue(row, 'metric_name');
  const valueKind = stringValue(row, 'value_kind');
  if (
    metricName === 'public_notice_record_count' ||
    metricName === 'batch_share' ||
    valueKind === 'data_quality_reconciliation'
  ) {
    const aggregate = sourceKeys.find((key) => key === 'public-selection-aggregate-2026');
    if (aggregate) return aggregate;
  }
  if (metricName === 'plan_count' || metricName.endsWith('_plan_count')) {
    const plan = sourceKeys.find((key) => /(?:^|-)plan(?:-|$)/.test(key));
    if (plan) return plan;
  }
  return sourceKeys[0]!;
}

export function metricUnitScope(row: CanonicalRow, context: CanonicalMetricContext): string {
  const companyId = nullableString(row, 'company_id');
  return (companyId ? context.companyNameById.get(companyId) : undefined) ?? context.network;
}

export function canonicalMetricColumns(row: CanonicalRow, context: CanonicalMetricContext) {
  const metricKey = requiredString(row, 'metric_id', 'recruitment_metrics');
  const rowLabel = `recruitment_metrics.${metricKey}`;
  const rawValue = numberValue(row, 'metric_value');
  const privacySuppressed = row.privacy_suppressed === true;
  const metricValueText = nullableString(row, 'metric_value_text');
  const displayValue = metricValueText ?? (privacySuppressed ? '<5' : rawValue === null ? '待补' : null);

  return {
    metricKey,
    cohortYear: requiredInteger(row, 'year', rowLabel),
    batchCode: canonicalBatchCode(row, context.batchCodeById, rowLabel),
    unitScope: metricUnitScope(row, context),
    metricType: requiredString(row, 'metric_name', rowLabel),
    valueKind: requiredString(row, 'value_kind', rowLabel),
    aggregationGrain: requiredString(row, 'aggregation_grain', rowLabel),
    value: privacySuppressed || rawValue === null ? null : String(rawValue),
    displayValue,
    unit: requiredString(row, 'metric_unit', rowLabel),
    isApproximate: row.is_approximate === true,
    subjectScope: nullableString(row, 'subject_scope'),
    privacySuppressed,
    suppressedRange: nullableString(row, 'suppressed_range'),
    suppressionReason: nullableString(row, 'suppression_reason'),
    zeroConfirmed: row.zero_confirmed === true,
    sourceKeys: arrayStrings(row, 'source_ids'),
  };
}
