import { createHash } from 'node:crypto';
import type { InsightEvidence } from './grid-information-insights.js';
import { informationEducationPins } from './information-education-pins.js';
import { privateSourceIndex, publicSourceRows } from './private-source-boundary.js';

type Row = Record<string, unknown>;
export type InformationRequirementContext = {
  requirements: Row[]; companies: Row[]; sources: Row[]; provinces: Row[];
};
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const object = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const strings = (value: unknown) => Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
const distinct = (values: string[]) => [...new Set(values.filter(Boolean))];
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const normalize = (value: string) => value.replace(/(?:壮族自治区|回族自治区|维吾尔自治区|自治区|省|市)$/u, '');
const datasetId = 'sgcc-provincial-recruitment-2026-v1';
const companyKey = (row: Row) => {
  const key = text(row.companyKey ?? row.unitKey), metadata = object(row.metadata);
  return key === 'COMPANY-SGCC-HUBEI' && metadata.dataset_id === datasetId && metadata.official_unit_id === '10450001' && metadata.province_adcode === '420000' ? 'sgcc-unit:10450001' : key;
};
const aliases = (row: Row) => {
  const key = text(row.requirementKey), metadata = object(row.metadata);
  return /^requirement-evidence:/.test(key) && metadata.dataset_id === datasetId
    ? strings(metadata.original_requirement_keys) : [key];
};

/** Reading projection, not an eligibility rule. Pinned source clauses must still
 * exist in this request's published relational data, with every source visible.
 * Row, province, company and source restrictions apply before grouping. */
export function normativeEducationEntries(input: InformationRequirementContext, year: number): InsightEvidence[] {
  if (year !== 2026) return [];
  const privacy = privateSourceIndex(input.sources);
  const sources = publicSourceRows(input.sources, privacy).filter(row => Number(row.cohortYear) === year
    && ['current_official_page', 'official_attachment', 'national_official_page', 'national_official_attachment'].includes(text(row.sourceType)));
  const sourceByKey = new Map(sources.flatMap(row => distinct([text(row.sourceKey), text(row.id)]).map(key => [key, row] as const)));
  const scopedText = (pin: typeof informationEducationPins[number]) => {
    if (!('scope' in pin)) return '';
    const source = sourceByKey.get(pin.scope.sourceKey), body = source?.contentText;
    if (typeof body !== 'string' || sha256(body) !== pin.scope.bodySha256
      || !pin.scope.text.split('\n').every(part=>body.includes(part))) return null;
    return pin.scope.text;
  };
  const provinces = publicSourceRows(input.provinces, privacy);
  const companies = publicSourceRows(input.companies, privacy).filter(row => row.publicationStatus === 'published');
  const provinceCode = (row: Row) => text(row.provinceAdcode) || text(provinces.find(p => p.id && p.id === row.provinceId)?.adcode);
  const rows = publicSourceRows(input.requirements, privacy).filter(row => {
    const company = companies.find(c => (row.companyId && c.id === row.companyId) || (row.unitKey && companyKey(c) === row.unitKey));
    const refs = distinct([...strings(row.sourceKeys), text(row.sourceDocumentId)]);
    return company && /^sgcc-unit:/.test(companyKey(company)) && Number(row.cohortYear) === year
      && row.publicationStatus === 'published' && row.evidenceTier === 'A' && row.status === 'verified_current_official_excerpt'
      && ['campus', 'batch_1', 'batch_2', 'batch_3'].includes(text(row.batchCode))
      && provinceCode(row) !== '' && provinceCode(row) === provinceCode(company)
      && provinces.some(p => text(p.adcode) === provinceCode(row))
      && refs.length > 0 && refs.every(key => sourceByKey.has(key)
        && sourceByKey.get(key)!.batchCode === row.batchCode);
  });
  const grouped = new Map<string, { rows: Row[]; company: Row; province: Row }>();
  for (const row of rows) {
    const company = companies.find(c => (row.companyId && c.id === row.companyId) || (row.unitKey && companyKey(c) === row.unitKey))!;
    const key = `${companyKey(company)}|${text(row.batchCode)}`;
    const group = grouped.get(key) ?? { rows: [], company, province: provinces.find(p => text(p.adcode) === provinceCode(row))! };
    group.rows.push(row); grouped.set(key, group);
  }
  return [...grouped.values()].flatMap(group => {
    const code = text(group.province.adcode), unitKey = companyKey(group.company), batchCode = text(group.rows[0]!.batchCode);
    const rejectedScopedTexts = new Set<string>(informationEducationPins.filter(pin => pin.unitKey === unitKey && pin.province === code
      && pin.batch === batchCode && 'scope' in pin && scopedText(pin) === null).map(pin=>pin.sha256));
    const clausePins = new Map(group.rows.flatMap(row => {
      const pin = informationEducationPins.find(pin => pin.unitKey === unitKey && pin.province === code
      && pin.batch === batchCode && aliases(row).includes(pin.key)
      && pin.sourceKeys.every(key => strings(row.sourceKeys).includes(key))
      && sha256(text(row.excerpt)) === pin.sha256 && scopedText(pin) !== null);
      return pin ? [[row,pin] as const] : [];
    }));
    const clauses = [...clausePins.keys()];
    if (!clauses.length) return [];
    const region = normalize(text(group.province.name));
    const company = unitKey === 'sgcc-unit:10683000' ? '冀北' : unitKey === 'sgcc-unit:10040352' ? '蒙东' : region;
    const scopeRows = group.rows.filter(row => !rejectedScopedTexts.has(sha256(text(row.excerpt)))
      && (['recruitment_scope', 'scope', 'major', 'education', 'age', 'cohort', 'training_mode', 'language_and_computer', 'overseas_education', 'academic_verification', 'special_obligation', 'health'].includes(text(row.category)) || strings(row.categoryTags).some(tag => ['education', 'major', 'age', 'language_and_computer', 'recruitment_scope'].includes(tag))));
    // Only reviewed context from the authorized full source is used. The old
    // extractor's contextHeading can be an unrelated preceding paragraph.
    const clauseText = distinct(clauses.map(row => {
      const excerpt = text(row.excerpt), scope = scopedText(clausePins.get(row)!)!;
      return scope ? `${scope}\n${excerpt}` : excerpt;
    })).join('\n\n');
    const qualifiers = distinct([
      `招聘主体：${text(group.company.name ?? group.company.unitName)}。分岗位条款分别适用，不表示该省全部岗位采用同一学历门槛。`,
      ...scopeRows.filter(row => !clauses.some(clause => text(clause.excerpt) === text(row.excerpt))).map(row => text(row.excerpt)),
    ]);
    const refs = distinct([...clauses, ...scopeRows].flatMap(row => [...strings(row.sourceKeys), text(row.sourceDocumentId)]));
    return [{ key:`normative-education:${unitKey}:${batchCode}:${year}`, adcode:code, province:region, region:company === region ? region : `${company} · ${region}`, company,
      grid:'sgcc', batchCode, year, title:'学历与岗位要求', text:clauseText, qualifiers,
      nature:'condition_reference' as const, sourceKeys:distinct(refs.map(key => text(sourceByKey.get(key)?.sourceKey))),
      evidenceLocators:distinct([...clauses, ...scopeRows].map(row => text(row.evidenceLocator))) }];
  });
}
