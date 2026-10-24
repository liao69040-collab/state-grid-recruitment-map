import { createHash } from 'node:crypto';

type Row = Record<string, unknown>;
type OriginApplicant = { originalHukouProvinceAdcode?: string | undefined; studentOriginProvinceAdcode?: string | undefined };
export type RecruitmentOriginReference = {
  id: string; sourceCohortYear: number; evidenceKind: 'archived_official' | 'workbook_experience';
  label: string; scope: string; summary: string; applicantContext: string;
  assessment: 'historical_reference_only' | 'county_confirmation_required';
  affectsEligibility: false; affectsRanking: false;
};
type WorkbookPin = {
  key: string; sourceKey: string; textSha256: string; locator: string; province: string;
  company: string; unitKey: string; batch: string; scope: string; summary: string;
};
// Public edition does not redistribute private workbook interpretations.
// Source owners may supply reviewed entries with an appropriate data license.
export const reviewedOriginWorkbookPins: readonly WorkbookPin[] = [];
export const reviewedOfficialOriginPins = [
  { key: 'sgcc-page:e80934a5c84c4632bab222a30e8bcd11', sha256: 'ade71faed677c11e1bd4a1ce57bd4068d04e67f2774cc90549841f67a5781e5e', unitKey: 'sgcc-unit:10450001', batch: 'batch_3', unitScope: '国网湖北省电力有限公司',
    excerpt: '对报考供电服务公司的毕业生，同等条件下，县域属地农村生源优先',
    scope: '湖北 · 第三批 · 供电服务公司', summary: '该届公告规定：同等条件下，县域属地农村生源优先。须核对具体县域、农村生源身份及拟报供电服务公司；不适用于所有湖北岗位。' },
  { key: 'sgcc-page:6738baedd7884c0a8582b8e9fb48eb28', sha256: '47eb24a2b335c9c6731a1b1bc4620757d794d3347e6965ab5741128cdd3e75bc', unitKey: 'sgcc-unit:10220000', batch: 'batch_3', unitScope: '国网福建省电力有限公司',
    excerpt: '属地生源（以身份证或户口簿为准）优先。',
    scope: '福建 · 第三批 · 市供电服务公司及县（区）分公司', summary: '该届公告规定属地生源优先，并按户籍所在市、县（区）选择意向单位；厦门生源只填报厦门市供电服务公司。须核对户籍和具体单位，省份相同不足以认定满足。' },
] as const;

const originAreasByUnit: Record<string, { codes: string[]; label: string }> = {
  'sgcc-unit:10554018': { codes: ['370000'], label: '山东' }, 'sgcc-unit:10522000': { codes: ['410000'], label: '河南' },
  'sgcc-unit:10450001': { codes: ['420000'], label: '湖北' }, 'sgcc-unit:10175326': { codes: ['430000'], label: '湖南' },
  'sgcc-unit:10416705': { codes: ['210000', '220000', '230000'], label: '东三省' },
  'sgcc-unit:10040352': { codes: ['210000', '220000'], label: '吉林、辽宁' },
  'sgcc-unit:10000029': { codes: ['120000'], label: '天津' }, 'sgcc-unit:10130000': { codes: ['210000'], label: '辽宁' },
  'sgcc-unit:10220000': { codes: ['350000'], label: '福建' },
};
function applicantContext(applicant: OriginApplicant, unitKey: string, official: boolean): string {
  const area = originAreasByUnit[unitKey];
  const parts: string[] = [];
  if (applicant.originalHukouProvinceAdcode && area) {
    parts.push(unitKey === 'sgcc-unit:10040352' && applicant.originalHukouProvinceAdcode === '150000'
      ? '你填写原户籍为内蒙古，仍须区分蒙东与蒙西'
      : area.codes.includes(applicant.originalHukouProvinceAdcode) ? `你填写的原户籍省份属于${area.label}范围` : `你填写的原户籍省份不在${area.label}范围，不据此判断不可报`);
  }
  if (applicant.studentOriginProvinceAdcode) parts.push(official && area
    ? `生源省份${area.codes.includes(applicant.studentOriginProvinceAdcode) ? '与该省相同' : '与该省不同'}，仍须按该届定义核对具体县域`
    : '生源地已单独填写，不据此推定原户籍地');
  return parts.length ? `${parts.join('；')}。省份信息不代表已取得优先资格。`
    : '原户籍地、生源地与现居地、就学省份分别填写，不能相互代替。';
}

/** Inputs MUST already be filtered through publicSourceRows at every request.
 * No cache, ranking points or eligibility changes are produced by this helper. */
export function recruitmentOriginReferences(input: {
  sourceCohortYear: number; unitKey: string; batchCode: string; applicant: OriginApplicant;
  referenceFacts: Row[]; sources: Row[];
}): RecruitmentOriginReference[] {
  if (input.sourceCohortYear !== 2026) return [];
  const notes: RecruitmentOriginReference[] = [];
  for (const pin of reviewedOriginWorkbookPins.filter(p => p.unitKey === input.unitKey && p.batch === input.batchCode)) {
    const found = input.referenceFacts.some(r => r.datasetKey === 'user-materials-2026-grid-query' && r.version === '2026.09.22.2'
      && r.factKey === pin.key && r.sourceKey === pin.sourceKey && r.evidenceLocator === pin.locator && r.cohortYear === 2026
      && r.grid === 'sgcc' && r.batchCode === pin.batch && r.province === pin.province && r.company === pin.company
      && r.scope === 'province' && r.dataStatus === 'reference' && !r.issueReason && typeof r.text === 'string'
      && createHash('sha256').update(r.text).digest('hex') === pin.textSha256);
    if (found) notes.push({ id: pin.key, sourceCohortYear: 2026, evidenceKind: 'workbook_experience', label: '2026届地域经验',
      scope: pin.scope, summary: pin.summary, applicantContext: applicantContext(input.applicant, pin.unitKey, false), assessment: 'historical_reference_only', affectsEligibility: false, affectsRanking: false });
  }
  for (const pin of reviewedOfficialOriginPins.filter(p => p.unitKey === input.unitKey && p.batch === input.batchCode)) {
    // Source-list queries deliberately omit contentText. A checksum binds the
    // reviewed archive even in that projection; if a body is present, verify it.
    const found = input.sources.some(s => s.sourceKey === pin.key && s.checksumSha256 === pin.sha256 && s.cohortYear === 2026
      && s.batchCode === pin.batch && s.unitScope === pin.unitScope && s.sourceType === 'current_official_page'
      && s.status === 'archived_current_official'
      && (s.contentText === undefined || s.contentText === null || typeof s.contentText === 'string' && s.contentText.includes(pin.excerpt)));
    if (found) notes.push({ id: pin.key, sourceCohortYear: 2026, evidenceKind: 'archived_official', label: '2026届属地条款',
      scope: pin.scope, summary: pin.summary, applicantContext: applicantContext(input.applicant, pin.unitKey, true), assessment: 'county_confirmation_required', affectsEligibility: false, affectsRanking: false });
  }
  return notes;
}
