import type { GridMapBatch } from '@/services/grid-map';
import type { GridRankingResult, GridRankingRow } from '@/services/grid-information';
import { schoolPublicProfiles, schoolPublicProfileSources } from '../../data/school-public-profiles-20261010.ts';
export { schoolPublicProfileMetadata } from '../../data/school-public-profiles-20261010.ts';
import { getSchoolAdmissions2026, type SchoolAdmission2026 } from '../../data/school-admissions-2026.ts';

/** Identity must be the exact reviewed school/campus, never a substring match. */
export interface SchoolProfileIdentity {
  schoolKey?: string;
  campusKey?: string;
  parentSchoolKey?: string;
  schoolName: string;
  campusName?: string | null;
  campusKeys?: readonly string[];
}
export interface SchoolPublicProfile {
  campusKey: string;
  parentSchoolKey: string;
  schoolName: string;
  campusName: string;
  schoolCode: string;
  tags: readonly string[];
  sourceUrls: readonly string[];
}
const publicProfilesByCampus = new Map<string, SchoolPublicProfile>();
const publicProfilesByParent = new Map<string, SchoolPublicProfile[]>();
for (const [campusKey, parentSchoolKey, schoolName, campusName, schoolCode, flags, ownership, level, historyTag, sourceIndices] of schoolPublicProfiles) {
  const tags = [
    ...(flags & 8 ? ['C9'] : []), ...(flags & 1 ? ['985'] : []), ...(flags & 2 ? ['211'] : []),
    ...(flags & 4 && !(flags & 3) ? ['双一流'] : []),
    ...(ownership ? [ownership] : []), ...(level ? [level] : []), ...(historyTag ? [historyTag] : []),
  ];
  const profile = { campusKey, parentSchoolKey, schoolName, campusName, schoolCode, tags,
    sourceUrls: sourceIndices.map(index => schoolPublicProfileSources[index]).filter(Boolean) };
  publicProfilesByCampus.set(campusKey, profile);
  const siblings = publicProfilesByParent.get(parentSchoolKey) ?? [];
  siblings.push(profile);
  publicProfilesByParent.set(parentSchoolKey, siblings);
}

export function schoolPublicProfile(row: SchoolProfileIdentity): SchoolPublicProfile | null {
  const key = row.campusKey || row.schoolKey;
  const campus = key ? publicProfilesByCampus.get(key) : undefined;
  if (campus) {
    if (row.schoolName !== campus.schoolName || (row.campusName ?? row.schoolName) !== campus.campusName
      || (row.schoolKey && row.schoolKey !== campus.campusKey)
      || (row.parentSchoolKey && row.parentSchoolKey !== campus.parentSchoolKey)) return null;
    return campus;
  }
  // A provided campus must never fall through to its mother's attributes.
  if (row.campusKey || key?.startsWith('campus_')) return null;
  const parentKey = row.parentSchoolKey || row.schoolKey;
  if (row.schoolKey && row.parentSchoolKey && row.schoolKey !== row.parentSchoolKey) return null;
  const siblings = parentKey ? publicProfilesByParent.get(parentKey) : undefined;
  if (!siblings?.length || siblings[0].schoolName !== row.schoolName
    || (row.campusName && row.campusName !== row.schoolName)) return null;
  if (row.campusKeys?.some(campusKey => publicProfilesByCampus.get(campusKey)?.parentSchoolKey !== parentKey)) return null;
  const first = siblings[0];
  if (siblings.some(profile => profile.schoolName !== first.schoolName || profile.schoolCode !== first.schoolCode
    || profile.tags.join('|') !== first.tags.join('|'))) return null;
  return { ...first, campusKey: '', campusName: row.schoolName,
    sourceUrls: [...new Set(siblings.flatMap(profile => profile.sourceUrls))] };
}

/** Unknown/ambiguous identities stay blank; independent colleges do not inherit. */
export function schoolProfileTags(row: SchoolProfileIdentity): readonly string[] {
  return schoolPublicProfile(row)?.tags ?? [];
}

/** Admissions scores may contain decimals; they are not recruitment record counts. */
export function schoolAdmissionScoreText(value: number | null | undefined): string | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? String(value) : null;
}
export function schoolAdmissionMetricLabel(kind: 'programme_admission_min' | 'programme_filing_score'): string {
  return kind === 'programme_filing_score' ? '专业投档最低' : kind === 'programme_admission_min' ? '专业录取最低' : '';
}
export function schoolDataAdmissionReferences(row: SchoolProfileIdentity, provinceAdcode: string): readonly SchoolAdmission2026[] {
  if (!provinceAdcode || (!row.campusKey && !row.schoolKey?.startsWith('campus_') && (row.campusKeys?.length ?? 0) > 1)) return [];
  const profile = schoolPublicProfile(row);
  if (!profile) return [];
  return getSchoolAdmissions2026(profile.schoolName, profile.campusName, provinceAdcode).filter(record =>
    record.year === 2026 && record.provinceAdcode === provinceAdcode && schoolAdmissionScoreText(record.minScore) !== null
    && !!schoolAdmissionMetricLabel(record.scoreKind) && record.sourceUrl.startsWith('https://'));
}
/** Select one exact standard programme for the compact line, never the lowest
 * number across programmes, subject categories, campuses or programme codes. */
export function schoolDataAdmissionPreview(records: readonly SchoolAdmission2026[]): SchoolAdmission2026 | null {
  const ordinary = records.filter(record => record.admissionType === '普通类');
  for (const name of ['电气工程及其自动化', '电气类']) {
    const exact = ordinary.filter(record => record.programmeName === name);
    if (exact.length === 1) return exact[0];
    if (exact.length > 1) return null;
  }
  return records.length === 1 ? records[0] : null;
}

/** The owning page supplies the same source-cohort national overview as its headline.
 * These are full-scope totals, never a sum of the currently visible school page. */
export interface SchoolDataTotals {
  recordCount: number | null;
  batchCounts: Record<GridMapBatch, number | null>;
  gridCounts: { sgcc: number | null; csg: number | null };
}

export const SCHOOL_DATA_PAGE_SIZE = 20;
export const schoolDataBatchColumns: ReadonlyArray<{ key: GridMapBatch; label: string }> = [
  { key: 'batch_1', label: '国网一批' },
  { key: 'batch_2', label: '国网二批' },
  { key: 'batch_3', label: '国网三批' },
  { key: 'csg_autumn', label: '南网秋招' },
  { key: 'csg_spring', label: '南网春招' },
];

/** Null is missing data in this exact authenticated projection, not a zero. */
export function schoolDataCell(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value.toLocaleString('zh-CN') : '—';
}

export function schoolDataName(row: Pick<GridRankingRow, 'schoolName' | 'campusName'>): string {
  if (!row.campusName || row.campusName === row.schoolName) return row.schoolName;
  return row.campusName.includes(row.schoolName) ? row.campusName : `${row.schoolName} · ${row.campusName}`;
}

export function schoolDataQuery(cohortYear: number, q: string, view: 'parent' | 'campus', page: number) {
  // Scope remains nationwide, both operators and all five source batches.
  // Search finds a school in that ranking; it must not change its national count.
  return { cohortYear, q: q.trim(), view, page, pageSize: SCHOOL_DATA_PAGE_SIZE };
}

export function assertSchoolDataPage(result: GridRankingResult, page: number, view: 'parent' | 'campus'): void {
  if (result.page !== page || result.pageSize !== SCHOOL_DATA_PAGE_SIZE || result.view !== view
    || result.items.length > SCHOOL_DATA_PAGE_SIZE || result.total < result.items.length
    || result.items.some(row => row.countBasis !== 'complete_anonymous_aggregates' || row.metricType !== 'public_notice_record_count')) {
    throw new Error('学校数据范围未确认，请重新查询。');
  }
}
