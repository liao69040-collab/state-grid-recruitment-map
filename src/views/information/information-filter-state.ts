export type FilterChip = { key: string; label: string };
type FilterValues = Record<string, string>;
type Vocabulary = { grids: Record<string, string>; batches: Record<string, string>; organizations: Record<string, string> };

/** Describe submitted filters, never pretend an unsubmitted draft is a result. */
export function informationActiveFilters(values: FilterValues, defaults: FilterValues, labels: Vocabulary): FilterChip[] {
  const definitions: [string, string, (value: string) => string][] = [
    ['q', '关键词', value => value], ['province', '录用省份', value => value],
    ['grid', '电网', value => labels.grids[value] || '其他电网'],
    ['batchCode', '批次', value => labels.batches[value] || '其他批次'],
    ['cohortYear', '年份', value => value === 'unknown' ? '年份未注明' : value ? `${value}届` : '全部年份'],
    ['company', '公司', value => value], ['schoolTier', '院校层次', value => value],
    ['educationLevel', '学校办学层次', value => value], ['industryTag', '电力院校标签', value => value],
    ['orgCategory', '单位类别', value => labels.organizations[value] || '其他单位'],
    ['view', '统计视角', value => value === 'parent' ? '母校合并' : '独立校区'],
  ];
  return definitions.flatMap(([key, name, format]) => {
    const value = values[key] ?? defaults[key] ?? '';
    return value === (defaults[key] ?? '') ? [] : [{ key, label: `${name}：${format(value)}` }];
  });
}

export function clearInformationFilter<T extends FilterValues>(values: T, key: string, defaults: T): T {
  return { ...values, [key]: defaults[key] ?? '', ...(key === 'province' ? { city: '' } : {}) };
}
