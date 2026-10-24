import type { GridMapSchool, GridMapCompany } from "../../services/grid-map";

export const gridMapBatchOptions = [
  ["", "全部"], ["batch_1", "国网一批"], ["batch_2", "国网二批"], ["batch_3", "国网三批"],
  ["csg_spring", "南网春招"], ["csg_autumn", "南网秋招"],
] as const;
/**
 * A batch belongs to exactly one operator, so the batch list must follow the
 * selected grid: picking 南方电网 must not keep offering 国网一批, and the
 * reverse. Only the five batch codes the dataset actually carries are offered —
 * an operator's real-world rounds that were never imported are not invented
 * here as选项 that would return nothing.
 */
export const gridMapBatchGrid: Record<string, 'sgcc' | 'csg'> = {
  batch_1: 'sgcc', batch_2: 'sgcc', batch_3: 'sgcc',
  csg_spring: 'csg', csg_autumn: 'csg',
};
export const gridMapBatchOptionsFor = (grid?: string | null) =>
  gridMapBatchOptions.filter(([code]) => !code || !grid || gridMapBatchGrid[code] === grid);
type MapSelectionScope = { grid?: string | null; batchCode?: string | null };
export const gridMapGridLabel = (grid?: string | null) => grid === 'sgcc' ? '国家电网' : grid === 'csg' ? '南方电网' : grid ? '其他电网' : '国网 + 南网';
const gridMapBatchLabel = (batch?: string | null) => !batch || batch === 'all' ? '全部批次' : gridMapBatchOptions.find(([key]) => key === batch)?.[1] || '其他批次';
/** National describes destinations; the selected grid and batch still apply. */
export const gridMapScopeLabel = (selection: MapSelectionScope) => `${gridMapGridLabel(selection.grid)} · ${gridMapBatchLabel(selection.batchCode)}`;
export const mapSchoolName = (school: GridMapSchool) => school.campusName || school.schoolName;
export const mapCountText = (value: number | null | undefined, basis = "released_cells_only") => (
  value === null || value === undefined || !Number.isFinite(value) ? "—" : `${basis === "released_cells_only" ? "公开部分 " : ""}${value.toLocaleString("zh-CN")}`
);
/** Keep numerical displays compact without claiming a de-duplicated employee count. */
export const schoolLocationLabel = (school: Pick<GridMapSchool, 'locationPrecision'>) => school.locationPrecision === 'campus'
  ? '校园位置' : school.locationPrecision === 'city' ? '学校所在城市（示意）' : '暂不显示地图位置';
export const companyHasRecruitmentCount = (company: GridMapCompany) => company.candidateStatus !== 'reference_candidate'
  && company.candidateStatus !== 'policy_reference' && typeof company.recordCount === 'number'
  && Number.isFinite(company.recordCount) && company.recordCount >= 0;
const exactCompany = (company: GridMapCompany) => companyHasRecruitmentCount(company) && company.countBasis !== 'released_cells_only';

/** Only roster destinations contribute; directory entries and application totals never do. */
export function summarizeCompanyRecruitment(companies: GridMapCompany[]) {
  const unique = [...new Map(companies.map(company => [company.companyKey, company])).values()];
  const rankedCompanies = unique.filter(companyHasRecruitmentCount).sort((a, b) => (b.recordCount! - a.recordCount!) || a.company.localeCompare(b.company, 'zh-CN'));
  const referenceCompanies = unique.filter(company => !companyHasRecruitmentCount(company));
  const exactCompanies = rankedCompanies.filter(exactCompany);
  const byBatch = gridMapBatchOptions.filter(([key]) => key).flatMap(([key, label]) => {
    const counts = exactCompanies.map(company => company.batchCounts?.[key]).filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    return counts.length ? [{ key, label, value: counts.reduce((total, value) => total + value, 0) }] : [];
  });
  const cities = new Map<string, { province: string | null; city: string; grid: string; recordCount: number; companyCount: number }>();
  for (const company of exactCompanies) {
    // A reference/address city or the company's name is not a recruitment city.
    const city = company.destinationCity?.trim();
    if (!city) continue;
    const key = JSON.stringify([company.provinceAdcode || company.province, city, company.grid]);
    const row = cities.get(key) || { province: company.province, city, grid: company.grid, recordCount: 0, companyCount: 0 };
    row.recordCount += company.recordCount!; row.companyCount += 1; cities.set(key, row);
  }
  return {
    rankedCompanies, referenceCompanies, exactCompanies,
    exactTotal: exactCompanies.length ? exactCompanies.reduce((total, company) => total + company.recordCount!, 0) : null,
    byBatch, cityTotals: [...cities.values()].sort((a, b) => b.recordCount - a.recordCount),
    hasPartialCounts: rankedCompanies.some(company => company.countBasis === 'released_cells_only'),
  };
}
export const schoolMapId = (school: GridMapSchool) => `grid-school:${school.campusKey}`;
export function schoolTooltipSections(school: GridMapSchool, destination: GridMapSchool | undefined, province: string, selection?: MapSelectionScope) {
  if (school.countBasis !== 'complete_anonymous_aggregates') return [];
  const rows: { label: string; value: string }[] = selection
    ? [{ label: '电网', value: gridMapGridLabel(selection.grid) }, { label: '批次', value: gridMapBatchLabel(selection.batchCode) }] : [];
  const national = school.nationalRecordCount;
  const target = school.destinationProvinceRecordCount;
  if (target !== null && target !== undefined) rows.push({ label: `去向 ${province}`, value: mapCountText(target, school.countBasis) });
  if (destination) for (const [key, label] of gridMapBatchOptions) {
    if (key && destination.batchCounts[key] !== null) rows.push({ label, value: mapCountText(destination.batchCounts[key], destination.countBasis) });
  }
  if (Number.isFinite(national) && Number.isFinite(target) && national! >= target!) rows.push({ label: '其他地区', value: mapCountText(national! - target!, school.countBasis) });
  if (national !== null && national !== undefined) rows.push({ label: '全国', value: mapCountText(national, school.countBasis) });
  return rows;
}
export const companyMapId = (company: GridMapCompany) => `grid-company:${company.companyKey}`;
export const companyLocationKey = (company: GridMapCompany) => company.locationPrecision === "city" && company.companyCity
  ? `city:${company.companyCityAdcode || company.companyCity}` : `province:${company.provinceAdcode || company.province || "unlocated"}`;
export const validMapCoordinates = (coordinates: unknown): coordinates is [number, number] => (
  Array.isArray(coordinates) && coordinates.length === 2 && coordinates.every(Number.isFinite)
  && coordinates[0] >= -180 && coordinates[0] <= 180 && coordinates[1] >= -90 && coordinates[1] <= 90
  && !(coordinates[0] === 0 && coordinates[1] === 0)
);
export const schoolMapPoint = (school: GridMapSchool) => ({
  id: schoolMapId(school), name: mapSchoolName(school), shortName: mapSchoolName(school),
  city: school.city || school.province || "", coordinates: school.coordinates!, category: "学校所在地 · 全国录用",
  metricValue: school.recordCount, metricText: mapCountText(school.recordCount, school.countBasis),
  metricLabel: school.countBasis === "released_cells_only" ? "全国公开部分" : "全国录用公示",
  valueStatus: "点击查看各省份、各批次录用情况", positionStatus: schoolLocationLabel(school),
});
export const companyMapPoint = (company: GridMapCompany) => ({
  id: companyMapId(company), name: company.company, shortName: company.company,
  city: company.companyCity || company.province || "", coordinates: company.coordinates!,
  category: companyHasRecruitmentCount(company) ? "招聘单位" : "公司目录",
  metricValue: company.recordCount, metricText: mapCountText(company.recordCount, company.countBasis),
  metricLabel: company.countBasis === "released_cells_only" ? "录用公示（公开部分）" : "录用公示",
  valueStatus: companyHasRecruitmentCount(company) ? "点击查看各批次与毕业院校" : "可查看招聘要求，暂无该单位录用人数",
  positionStatus: company.locationPrecision === "city" ? "单位所在城市（示意）" : "招聘单位所属省份",
});

/** City markers retain every matched school; clicking a cluster selects its full city list. */
export function buildSchoolMapPoints(schools: GridMapSchool[], activeCity = "") {
  const located = schools.filter((school) => validMapCoordinates(school.coordinates));
  const groups = new Map<string, GridMapSchool[]>();
  for (const school of located) {
    const key = school.locationPrecision === 'campus' ? school.campusKey : school.city || school.cityAdcode || school.campusKey;
    const group = groups.get(key) || [];
    group.push(school); groups.set(key, group);
  }
  return [...groups.entries()].flatMap(([city, group]) => {
    if (!activeCity && group.length > 1) return [{
      id: `grid-city:${city}`, name: `${city} · ${group.length}所院校`, shortName: `${city} · ${group.length}校`,
      city, coordinates: group[0].coordinates!, category: "院校分布 · 点击展开",
      metricValue: group.length, metricText: `${group.length}所`, metricLabel: "院校数量",
      valueStatus: "点击查看该城市的全部学校", positionStatus: "学校所在城市（示意）",
      symbolOffset: [0, 0] as [number, number], labelShow: true,
    }];
    return group.map((school, index) => {
      const ring = Math.floor(index / 8) + 1;
      const angle = index * Math.PI / 4;
      return { ...schoolMapPoint(school),
        symbolOffset: group.length > 1 ? [Math.round(Math.cos(angle) * ring * 20), Math.round(Math.sin(angle) * ring * 20)] as [number, number] : [0, 0] as [number, number],
        labelShow: true,
      };
    });
  });
}

/** Company locations describe source material geography, never inferred recruitment cities. */
export function buildCompanyMapPoints(companies: GridMapCompany[]) {
  const groups = new Map<string, GridMapCompany[]>();
  for (const company of companies) {
    if (!validMapCoordinates(company.coordinates)) continue;
    const key = companyLocationKey(company);
    const group = groups.get(key) || [];
    group.push(company); groups.set(key, group);
  }
  return [...groups.entries()].map(([key, group]) => {
    const summary = summarizeCompanyRecruitment(group);
    const atCity = key.startsWith("city:");
    const place = atCity ? group[0].companyCity! : `${group[0].province || "本省"} · 省公司及直属单位`;
    return {
      id: `grid-company-location:${key}`, name: `${place} · ${group.length}家单位`, shortName: `${place} · ${group.length}家`,
      city: atCity ? group[0].companyCity! : group[0].province || "", coordinates: group[0].coordinates!,
      category: summary.rankedCompanies.length ? "招聘单位" : "公司目录",
      metricValue: summary.exactTotal ?? group.length,
      metricText: summary.exactTotal !== null ? mapCountText(summary.exactTotal, 'complete_anonymous_aggregates') : `${group.length}家`,
      metricLabel: summary.exactTotal !== null ? "单位录用公示合计" : "单位数量",
      valueStatus: `点击查看 ${group.length} 家单位${summary.referenceCompanies.length ? '及招聘要求' : ''}`,
      positionStatus: atCity ? "单位所在城市（示意）" : "招聘单位所属省份",
      labelShow: true,
    };
  });
}
