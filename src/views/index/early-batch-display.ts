import type {
  EarlyBatchEvaluation,
  EarlyBatchRequirement,
  EarlyBatchResult,
  EarlyBatchSchoolTagBasis,
  EarlyBatchTarget,
  EarlyBatchTargetDetail,
  EligibilityDecision,
} from "../../services/early-batch";

export const earlyBatchSchoolTagBasisCopy = (
  basis?: EarlyBatchSchoolTagBasis,
): { label: string; note: string } => {
  if (basis === "dataset_verified") {
    return {
      label: "已核验学校主数据",
      note: "判定使用已核验学校标签，不依赖本人勾选。",
    };
  }
  if (basis === "user_confirmed") {
    return {
      label: "本人确认的学校属性",
      note: "判定使用本人确认的学校属性，不当作已核验学校主数据。",
    };
  }
  return {
    label: "学校属性待确认",
    note: "未找到可自动采用的已核验标签，涉及学校类别的目标会显示信息不足。",
  };
};

export const earlyBatchDecisionOrder: EligibilityDecision[] = [
  "eligible_under_workbook_rule",
  "ineligible_under_workbook_rule",
  "manual_review",
  "missing_input",
];

// Map focus is deliberately not an input: a nationwide search stays nationwide.
export const nationwideEarlyBatchResults = (
  results: EarlyBatchResult[],
  decision: EligibilityDecision | "all" = "all",
  homeProvinceAdcode = "",
): EarlyBatchResult[] => {
  const priority: EligibilityDecision[] = [
    "eligible_under_workbook_rule", "missing_input", "manual_review", "ineligible_under_workbook_rule",
  ];
  return results.filter((result) => decision === "all" || result.decision === decision)
    .sort((left, right) => (
      Number(left.target.kind === "unit") - Number(right.target.kind === "unit")
      || priority.indexOf(left.decision) - priority.indexOf(right.decision)
      || Number(right.target.provinceAdcode === homeProvinceAdcode) - Number(left.target.provinceAdcode === homeProvinceAdcode)
      || left.target.name.localeCompare(right.target.name, "zh-CN")
    ));
};

const expectedLabels: Record<string, string> = {
  bachelor: "本科",
  master: "硕士研究生",
  doctor: "博士研究生",
  electrical: "电工类 / 电气类",
  computer: "计算机类",
  communication: "通信类 / 信息与通信工程",
  electronic_information: "电子信息类",
  artificial_intelligence: "人工智能类",
  finance: "财务类",
  human_resources: "人力资源管理类",
  law: "法学类",
  other_engineering: "其他工学类",
  other: "其他专业",
  legacy_985: "原985高校",
  legacy_211: "原211高校",
  former_power_ministry: "原电力部直属院校",
  public_institution: "公办院校",
};

const expectedText = (value: unknown): string => {
  if (Array.isArray(value)) return value.map(expectedText).join(" / ");
  if (value === true) return "需要满足";
  if (value === false) return "不应存在";
  if (value === null || value === undefined || value === "") return "需要补充";
  return expectedLabels[String(value)] ?? String(value);
};

export const formatEarlyBatchRequirement = (item: EarlyBatchRequirement | string): string => {
  if (typeof item === "string") return item;
  const expected = expectedText(item.expected);
  return expected ? `${item.label}：${expected}` : item.label;
};

export const earlyBatchResultRequirements = (
  result: EarlyBatchResult,
): Array<EarlyBatchRequirement | string> => [
  ...(result.missingInputs ?? []),
  ...(result.unmetRequirements ?? []),
  ...(result.manualReviewReasons ?? []),
].slice(0, 3);

export const earlyBatchResultCounts = (evaluation: EarlyBatchEvaluation | null) => ({
  eligible_under_workbook_rule: evaluation?.summary?.eligibleUnderWorkbookRule ?? 0,
  ineligible_under_workbook_rule: evaluation?.summary?.ineligibleUnderWorkbookRule ?? 0,
  manual_review: evaluation?.summary?.manualReview ?? 0,
  missing_input: evaluation?.summary?.missingInput ?? 0,
});

interface ProvinceOptionLike {
  name: string;
  adcode: string;
}

const excludedFromWorkbookProvinceScope = new Set(["710000", "810000", "820000"]);

export const findUncoveredWorkbookProvinces = (
  provinceOptions: ProvinceOptionLike[],
  targets: EarlyBatchTarget[],
): ProvinceOptionLike[] => {
  const covered = new Set(targets
    .filter((target) => target.kind === "province" && target.provinceAdcode)
    .map((target) => target.provinceAdcode));
  return provinceOptions.filter((province) => (
    !excludedFromWorkbookProvinceScope.has(province.adcode)
    && !covered.has(province.adcode)
  ));
};

export const earlyBatchActualHeadcountCaveat = (detail: EarlyBatchTargetDetail | null): string => (
  detail?.metadata?.suspected_miscolumn === true
    ? "原表如此填写，数值疑似错列，待人工核验；不作为确定实际录取人数。"
    : ""
);

export const safeEarlyBatchEvidenceUrl = (value?: string): string => {
  if (!value) return "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
  } catch {
    return "";
  }
};
