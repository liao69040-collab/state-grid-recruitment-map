import { fetchGridRankings, type GridQuery, type GridRankingResult } from '@/services/grid-information';

export type SchoolRankingScope = 'destination' | 'school_location';
export function provinceSchoolRankingQuery(province: { name: string; adcode: string }, scope: SchoolRankingScope,
  cohortYear: number, batchCode?: string): GridQuery {
  return { view: 'campus', cohortYear,
    ...(scope === 'school_location' ? { schoolProvinceAdcode: province.adcode } : { province: province.name }),
    ...(batchCode ? { batchCode } : {}),
  };
}

/** API caps each page at 100. Publish a complete, consistent Top 200, never a partial failed page. */
export async function fetchTopSchoolRankings(query: GridQuery,
  request: typeof fetchGridRankings = fetchGridRankings): Promise<GridRankingResult> {
  const readPage = async (page: number) => {
    const result = await request({ ...query, view: 'campus', page, pageSize: 100 });
    if (result.view !== 'campus' || result.page !== page || result.pageSize !== 100 || !Number.isInteger(result.total)
      || result.total < 0 || !Array.isArray(result.items)
      || result.items.length !== Math.min(100, Math.max(0, result.total - (page - 1) * 100))
      || (query.schoolProvinceAdcode && result.scope?.schoolProvinceAdcode !== query.schoolProvinceAdcode)) {
      throw new Error('排名范围未确认，请刷新后重试。');
    }
    return result;
  };
  const first = await readPage(1);
  const second = first.total > 100 ? await readPage(2) : null;
  if (second && second.total !== first.total) throw new Error('排名数据正在更新，请重试。');
  const items = [...first.items, ...(second?.items ?? [])];
  if (new Set(items.map(row => row.schoolKey)).size !== items.length) throw new Error('排名数据正在更新，请重试。');
  return { ...first, items };
}
