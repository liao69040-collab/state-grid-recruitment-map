type DirectoryRow = Record<string, any>;
export type DirectoryMode = 'schools' | 'companies';
export const directoryCount = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('zh-CN') : '未提供';
export const directoryHasRosterCount = (row: DirectoryRow, mode: DirectoryMode) => typeof row.recordCount === 'number' && Number.isFinite(row.recordCount) && (mode === 'schools' || row.candidateStatus === 'roster_unit');
export const filterDirectoryRows = (rows: DirectoryRow[], mode: DirectoryMode, city: string, keyword: string) => rows.filter(row =>
  (!city || (mode === 'schools' ? row.cityAdcode : row.companyCityAdcode) === city)
  && (!keyword.trim() || [row.name, row.schoolName, row.company, row.campusName, row.city, row.companyCity].some(value => String(value || '').includes(keyword.trim()))));
