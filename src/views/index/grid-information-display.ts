/** Display-only vocabulary. Recruitment facts are loaded from the protected API. */
export const gridLabels: Record<string, string> = { sgcc: "国家电网", csg: "南方电网", other: "其他电网", unknown: "电网待核" };
export const gridBatchLabels: Record<string, string> = {
  campus: "提前批 / 校园招聘", batch_1: "国网第一批", batch_2: "国网第二批", batch_3: "国网第三批",
  csg_spring: "南网春招", csg_autumn: "南网秋招", all: "各批次通用", unspecified: "批次未标明",
};
export const gridCategoryLabels: Record<string, string> = {
  student_origin: "学籍与生源", education: "学历要求", school: "院校要求", major: "专业要求", age: "年龄要求",
  certificate: "证书要求", score: "历史考试分数", compensation: "待遇原文参考", application: "报名要求",
  exam: "考试安排", headcount: "人数口径对照", other: "其他资料",
};
export const gridOrgCategoryLabels: Record<string, string> = {
  province_company: "省公司", direct_unit: "直属单位", headquarters: "总部", branch: "分部",
  supply_bureau: "供电局单列", branch_subunit: "分部所属单位", listed_company: "省属上市公司",
  industry: "产业单位", service: "供服公司", other: "其他单位", unknown: "类别待核",
};
export const gridScopeLabels: Record<string, string> = { national: "全国适用", province: "省级资料", city: "城市专属资料", company: "公司资料" };

export function gridFactScopeLabel(item: { applicability: string; scope: string; province: string | null; city: string | null }): string {
  if (item.applicability === "province_inherited") return `${item.province || "该省"} · 省级适用（非城市专属）`;
  if (item.scope === "city") return `${item.city || "城市"} · 城市专属证据`;
  return [item.province, gridScopeLabels[item.scope] || "范围待核"].filter(Boolean).join(" · ");
}

export function gridYearLabel(year: number | null): string {
  return year === null ? "原文未标明年份" : `${year}届 / 年（以原文为准）`;
}

export function safeGridSourceUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function gridQueryString(values: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && String(value).trim() !== "") params.set(key, String(value));
  }
  return params.toString();
}

export function gridCountLabel(basis: string): string {
  return basis === "all_aggregate_cells" ? "公示记录数" : "可展示记录数";
}

export function gridCountCell(value: number | null | undefined): string {
  return value === null || value === undefined ? "隐私保护" : value.toLocaleString("zh-CN");
}

export function gridCombinedLabels(values: string[] | undefined, value: string | null | undefined, fallback: string): string {
  return values?.length ? values.join(" / ") : value || fallback;
}

export function sameGridRegion(left: string, right: string): boolean {
  const short = (value: string) => value.trim().replace(/(?:壮族自治区|回族自治区|维吾尔自治区|特别行政区|自治区|省|市)$/, "");
  return short(left) === short(right);
}
