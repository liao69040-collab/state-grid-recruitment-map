export type SchoolBatchKey = "all" | "batch_1" | "batch_2" | "batch_3";

export type MetricKind = "public-records" | "planned-headcount" | "unit-count" | "unknown";

export type MetricDisplayStatus = "known" | "suppressed" | "unknown";

export interface BatchCellMetric {
  value: number | null;
  suppressed: boolean;
  suppressionReason: string | null;
  zeroConfirmed: boolean;
}

export interface SchoolMetricSource {
  name?: string;
  recordCount: number | null;
  batch: Partial<Record<Exclude<SchoolBatchKey, "all">, BatchCellMetric>>;
}

export interface EntityMetricSource {
  metricValue: number | null;
  metricKind: MetricKind;
  metricLabel: string;
  valueStatus: string;
  metricApproximate?: boolean;
}

export interface BatchResultMetricSource {
  value: number | null;
  state: "provisional" | "suppressed" | "unpublished" | "unverified" | "not-applicable";
  note: string;
  metricKind?: MetricKind;
  approximate?: boolean;
}

export interface MetricDisplay {
  value: string;
  unit: "条" | "人" | "家" | "";
  text: string;
  numericValue: number | null;
  metricLabel: string;
  valueStatus: string;
  status: MetricDisplayStatus;
  sortBucket: number;
}

const batchLabels: Record<Exclude<SchoolBatchKey, "all">, string> = {
  batch_1: "第一批",
  batch_2: "第二批",
  batch_3: "第三批",
};

const metricUnits: Record<MetricKind, MetricDisplay["unit"]> = {
  "public-records": "条",
  "planned-headcount": "人",
  "unit-count": "家",
  unknown: "",
};

const nonNegativeNumber = (value: unknown): number | null => (
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null
);

const formatNumber = (value: number) => value.toLocaleString("zh-CN");

const makeDisplay = (
  value: string,
  unit: MetricDisplay["unit"],
  numericValue: number | null,
  metricLabel: string,
  valueStatus: string,
  status: MetricDisplayStatus,
  sortBucket: number,
): MetricDisplay => ({
  value,
  unit,
  text: unit ? `${value}${unit}` : value,
  numericValue,
  metricLabel,
  valueStatus,
  status,
  sortBucket,
});

export const batchSuppressionLabel = (cell: Pick<BatchCellMetric, "suppressionReason">) => (
  cell.suppressionReason === "primary_small_cell" ? "<5 已隐藏" : "隐私保护已隐藏"
);

export const resolveSchoolMetric = (
  school: SchoolMetricSource,
  batchKey: SchoolBatchKey,
): MetricDisplay => {
  if (batchKey === "all") {
    const total = nonNegativeNumber(school.recordCount);
    if (total === null) {
      return makeDisplay(
        "未单列",
        "",
        null,
        "2026届三批公示记录合计",
        "该校公示记录总数未单列，不以批次值或其他指标回填",
        "unknown",
        0,
      );
    }
    return makeDisplay(
      formatNumber(total),
      "条",
      total,
      "2026届三批公示记录合计",
      "公示记录不等于报名人数、签约人数或最终入职人数",
      "known",
      total > 0 ? 3 : 1,
    );
  }

  const label = `${batchLabels[batchKey]}公示记录`;
  const cell = school.batch[batchKey];
  if (!cell) {
    return makeDisplay(
      "未单列",
      "",
      null,
      label,
      "该校该批次尚无可展示数值，不回退显示三批总数",
      "unknown",
      0,
    );
  }
  if (cell.suppressed) {
    return makeDisplay(
      batchSuppressionLabel(cell),
      "",
      null,
      label,
      "精确值按小样本隐私规则不公开，不回退显示三批总数",
      "suppressed",
      2,
    );
  }

  const numericValue = nonNegativeNumber(cell.value) ?? (cell.zeroConfirmed ? 0 : null);
  if (numericValue === null) {
    return makeDisplay(
      "未单列",
      "",
      null,
      label,
      "该校该批次尚无可展示数值，不回退显示三批总数",
      "unknown",
      0,
    );
  }
  return makeDisplay(
    formatNumber(numericValue),
    "条",
    numericValue,
    label,
    "当前筛选批次；公示记录不等于最终入职人数",
    "known",
    numericValue > 0 ? 3 : 1,
  );
};

export const schoolMatchesBatch = (school: SchoolMetricSource, batchKey: SchoolBatchKey) => {
  if (batchKey === "all") return true;
  const display = resolveSchoolMetric(school, batchKey);
  return display.status !== "known" || (display.numericValue ?? 0) > 0;
};

export const compareSchoolsForBatch = <T extends SchoolMetricSource>(
  left: T,
  right: T,
  batchKey: SchoolBatchKey,
) => {
  const leftDisplay = resolveSchoolMetric(left, batchKey);
  const rightDisplay = resolveSchoolMetric(right, batchKey);
  if (rightDisplay.sortBucket !== leftDisplay.sortBucket) {
    return rightDisplay.sortBucket - leftDisplay.sortBucket;
  }
  if (leftDisplay.numericValue !== null || rightDisplay.numericValue !== null) {
    return (rightDisplay.numericValue ?? -1) - (leftDisplay.numericValue ?? -1);
  }
  return String(left.name ?? "").localeCompare(String(right.name ?? ""), "zh-CN");
};

export const resolveEntityMetric = (entity: EntityMetricSource): MetricDisplay => {
  const numericValue = nonNegativeNumber(entity.metricValue);
  if (numericValue === null) {
    return makeDisplay(
      entity.valueStatus.includes("待补") || entity.valueStatus.includes("待核验") ? "待核验" : "未单列",
      "",
      null,
      entity.metricLabel,
      entity.valueStatus,
      "unknown",
      0,
    );
  }

  const unit = metricUnits[entity.metricKind];
  const approximate = entity.metricKind === "planned-headcount" && entity.metricApproximate !== false;
  const value = `${approximate ? "约" : ""}${formatNumber(numericValue)}`;
  return makeDisplay(value, unit, numericValue, entity.metricLabel, entity.valueStatus, "known", numericValue > 0 ? 3 : 1);
};

export const resolveBatchResultMetric = (batch: BatchResultMetricSource): MetricDisplay => {
  const metricKind = batch.metricKind ?? "planned-headcount";
  if (batch.state === "not-applicable") {
    return makeDisplay("不适用", "", null, "批次指标", batch.note, "unknown", 0);
  }
  if (batch.state === "suppressed") {
    return makeDisplay("<5 已隐藏", "", null, "批次公示记录", batch.note, "suppressed", 2);
  }

  const numericValue = nonNegativeNumber(batch.value);
  if (numericValue === null) {
    return makeDisplay(
      batch.state === "unverified" ? "待核验" : "未单列",
      "",
      null,
      "批次指标",
      batch.note,
      "unknown",
      0,
    );
  }

  return resolveEntityMetric({
    metricValue: numericValue,
    metricKind,
    metricLabel: "批次指标",
    valueStatus: batch.note,
    metricApproximate: batch.approximate,
  });
};
