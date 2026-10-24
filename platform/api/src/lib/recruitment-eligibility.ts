import { z } from 'zod';
import { evaluateEarlyBatchPolicy, eligibilityModel, type EarlyBatchApplicant } from './early-batch.js';
import { privateSourceIndex, publicSourceRows } from './private-source-boundary.js';
import type { EarlyBatchPolicyRecord } from '../store/types.js';
import { nativeReviewed2026Notices, type NativeNotice } from './native-grid-recruitment-2026.js';
import { recruitmentDisplayText } from './recruitment-display-text.js';
import { resolveRecruitmentReferenceCohort } from './recruitment-reference-cohorts.js';
import { recruitmentOriginReferences, type RecruitmentOriginReference } from './recruitment-origin-reference.js';

/** Only explicitly reviewed conditions run. Prose classification is presentation,
 * never an admission rule; a source change invalidates its reviewed rule. */
export const recruitmentBatchCodes = ['campus', 'batch_1', 'batch_2', 'batch_3', 'csg_campus', 'csg_autumn', 'csg_spring', 'impc_campus'] as const;
export type RecruitmentBatchCode = typeof recruitmentBatchCodes[number];
export const recruitmentBatchLabels: Record<RecruitmentBatchCode, string> = {
  campus: '提前批', batch_1: '第一批', batch_2: '第二批', batch_3: '第三批',
  csg_campus: '南网提前批', csg_autumn: '南网秋招', csg_spring: '南网春招', impc_campus: '蒙西校园招聘',
};
const degreeCodes = ['junior_college', 'bachelor', 'master', 'doctor'] as const;
export const recruitmentEligibilityRequestSchema = z.object({
  cohortYear: z.number().int().min(2020).max(2100).default(2027),
  comparisonMode: z.enum(['current', 'historical', 'reference']).default('current'),
  batchCodes: z.array(z.enum(recruitmentBatchCodes)).min(1).max(recruitmentBatchCodes.length).optional(),
  applicant: z.object({
    schoolKey: z.string().trim().max(160).optional(),
    schoolName: z.string().trim().max(160).optional(),
    schoolProvinceAdcode: z.string().regex(/^\d{6}$/).optional(),
    homeProvinceAdcode: z.string().regex(/^\d{6}$/).optional(),
    residenceProvinceAdcode: z.string().regex(/^\d{6}$/).optional(),
    originalHukouProvinceAdcode: z.string().regex(/^\d{6}$/).optional(),
    studentOriginProvinceAdcode: z.string().regex(/^\d{6}$/).optional(),
    schoolTags: z.array(z.enum(['legacy_985', 'legacy_211', 'former_power_ministry', 'public_institution'])).max(4).optional(),
    schoolTagsConfirmed: z.boolean().optional(),
    degree: z.enum(degreeCodes),
    educationLocation: z.enum(['domestic', 'overseas']).optional(),
    qsTop100: z.boolean().optional(),
    majorCategory: z.enum(['electrical', 'computer', 'communication', 'electronic_information', 'artificial_intelligence', 'finance', 'human_resources', 'law', 'other_engineering', 'other']).optional(),
    freshGraduate: z.boolean().optional(), graduationYear: z.number().int().min(2020).max(2100).optional(),
    fullTime: z.boolean().optional(), computerLevel2: z.boolean().optional(),
    cet4OrHigher: z.boolean().optional(), cet6OrHigher: z.boolean().optional(),
    certificatesObtainedBeforeApplication: z.boolean().optional(), nationalUnifiedAdmission: z.boolean().optional(),
    majorMatchesEnrollment: z.boolean().optional(), age: z.number().int().min(16).max(80).optional(),
    hasFailedCourses: z.boolean().optional(), gradesAcceptable: z.boolean().optional(),
    nonEmployedDuringStudy: z.boolean().optional(), hasDomesticEmployerSocialInsurance: z.boolean().optional(),
    hasDomesticSocialInsurance: z.boolean().optional(), qualificationsByDeadline: z.boolean().optional(),
    graduationDate: z.iso.date().optional(), ageAtApplication: z.number().int().min(16).max(80).optional(),
  }).strict(),
}).strict();
export type RecruitmentApplicant = z.infer<typeof recruitmentEligibilityRequestSchema>['applicant'];
type Row = Record<string, unknown>;
export type RecruitmentDecision = 'initial_match' | 'reference_match' | 'reference_mismatch' | 'not_matched' | 'missing_input' | 'needs_confirmation';
type Check = { field: string; label: string; state: 'pass' | 'fail' | 'missing' | 'confirm'; expected: string };
type Group = { category: string; title: string; items: string[] };
export type RecruitmentResult = { id: string; provinceAdcode: string; provinceName: string; targetName: string; grid: 'sgcc' | 'csg' | 'impc'; operatorScope: 'sgcc' | 'csg' | 'mengdong' | 'mengxi'; officialRecruitmentUrl?: string; batchCode: RecruitmentBatchCode; batchLabel: string; decision: RecruitmentDecision; decisionLabel: string; summary: string; checks: Check[]; groups: Group[]; nextSteps: string[]; ruleScope: 'basic_conditions' | 'reference' | 'not_structured'; referenceComparison?: ReferenceComparison; originReferences?: RecruitmentOriginReference[] };
type Rule = { key: string; excerpt: string; province: string; batch: RecruitmentBatchCode; domesticOnly?: boolean; minimumDegree?: RecruitmentApplicant['degree']; fresh?: boolean; unified?: boolean; majors?: RecruitmentApplicant['majorCategory'][]; electricalDiploma?: boolean; otherMajorsBachelor?: boolean; mainMajor?: boolean; grades?: boolean; crossDegreeMajor?: boolean; requiresJobReview?: boolean; sourceKey?: string; sourceChecksum?: string };

// Manual, source-pinned interpretations of the domestic general education gate.
// These do NOT cover job attachments, alternative certificates, health or hiring
// discretion. Passing them is only a labelled partial comparison, never
// "eligible"/"admitted"; remaining job conditions remain attached to the result.
export const reviewedRecruitmentRules: Rule[] = [
  // This exact announcement establishes a necessary degree gate only.
  // Passing it cannot by itself establish that a particular major/job matches.
  { key: 'requirement:ba221a8ea457d430242c98d5', province: '120000', batch: 'campus', minimumDegree: 'master', fresh: true, requiresJobReview: true,
    sourceKey: 'sgcc-page:2bdef125d31f4b02ad073e57b8fbd1e6', sourceChecksum: '05d82c8074d2c233e16a78a30f966e4ad29082997536011f6a6b633931802bb5',
    excerpt: '3.2026年应届硕士研究生及以上学历毕业生，于报到前（预计2026年7月）取得相应的毕业证、学位证等各类证书和材料。' },
  { key: 'requirement:debdb6228e89843d193e6f12', province: '420000', batch: 'batch_1', domesticOnly: true, minimumDegree: 'bachelor', unified: true,
    excerpt: '1.应聘的国内院校毕业生，要求为国家统招计划内的普通高等院校2026届大学本科及以上学历毕业生，毕业生一般需在2026年8月31日前取得毕业证、学位证等证书，相关信息在中国高等教育学历信息网可查。' },
  { key: 'requirement:18a75cacb163a27c885aa1be', province: '420000', batch: 'batch_2', domesticOnly: true, minimumDegree: 'junior_college', fresh: true, unified: true,
    excerpt: '1.应聘的国内院校毕业生，要求为国家统招计划内的普通高等院校2026年应届大学专科及以上学历毕业生，毕业生一般需在2026年8月31日前取得毕业证、学位证等证书，相关信息在中国高等教育学历信息网可查；' },
  { key: 'requirement:b4498ba95135c9979003a6ba', province: '420000', batch: 'batch_3', domesticOnly: true, minimumDegree: 'junior_college', fresh: true, unified: true,
    excerpt: '1.应聘的国内院校毕业生，要求为国家统招计划内的普通高等院校2026年应届大学专科及以上学历毕业生，一般需在2026年8月31日前取得毕业证、学位证等证书，相关信息在中国高等教育学历信息网可查；' },
  { key: 'requirement:b9d20644b8b2fef9dc5fc0ce', province: '140000', batch: 'batch_1', domesticOnly: true, minimumDegree: 'bachelor', fresh: true,
    excerpt: '（二）学历学位：国内普通高校2026年应届大学本科及以上学历毕业生，毕业证、学位证原则上应于2026年7月31日前取得。国（境）外院校毕业生原则上应于2025年7月1日至2026年6月30日期间毕业，并于2026年7月31日前取得教育部留学服务中心学历认证。' },
  { key: 'requirement:b02c4a736be1340f8599a693', province: '140000', batch: 'batch_2', domesticOnly: true, minimumDegree: 'bachelor', fresh: true,
    excerpt: '（二）学历学位：国内普通高校2026年应届大学本科及以上学历毕业生，毕业证、学位证原则上应于2026年7月31日前取得。国（境）外院校毕业生应于2025年7月1日至2026年6月30日期间毕业，并于2026年7月31日前取得教育部留学服务中心学历认证。' },
  { key: 'requirement:9aa48e01fde728ac7a1ab144', province: '140000', batch: 'batch_3', domesticOnly: true, minimumDegree: 'bachelor', fresh: true, electricalDiploma: true,
    excerpt: '（二）学历学位：国内普通高校2026年应届毕业生中，电工类专业应具备大学专科及以上学历，电子信息类、其他工学类专业应具备大学本科及以上学历。毕业证、学位证原则上应于2026年7月31日前取得。国（境）外院校毕业生应于2025年7月1日至2026年6月30日期间毕业，并于2026年7月31日前取得教育部留学服务中心学历认证。' },
  { key: 'requirement:3a5342f19378f56fb7a97f4f', province: '310000', batch: 'batch_1', domesticOnly: true, minimumDegree: 'bachelor', unified: true,
    excerpt: '1.应聘的国内院校学生是国家统招计划内普通高等院校2026届本科及以上学历毕业生。' },
  { key: 'requirement:e378ac8ec05dd61cafb8aa27', province: '310000', batch: 'batch_2', domesticOnly: true, minimumDegree: 'bachelor', fresh: true, unified: true,
    excerpt: '1.应聘的国内院校学生是国家统招计划内普通高等院校2026年应届本科及以上学历毕业生。' },
  { key: 'requirement:db94611024c4bb26d253fa57', province: '310000', batch: 'batch_3', minimumDegree: 'bachelor', fresh: true,
    excerpt: '1.应聘毕业生为2026年应届大学本科及以上学历毕业生。招聘专业包括电气类、计算机类、自动化类等专业。' },
  { key: 'requirement:63efea8210b4b8076d0b1a4a', province: '350000', batch: 'batch_1', domesticOnly: true, minimumDegree: 'bachelor', fresh: true, unified: true,
    excerpt: '（1）国内院校毕业生，要求为国家统招计划内的普通高等院校2026年应届大学本科及以上学历毕业生，原则上须在2026年7月底前取得毕业证、学位证等证书，相关信息在中国高等教育学历信息网（https://www.chsi.com.cn）可查证。' },
  { key: 'requirement:a410c0c614d2ea9366a45b7e', province: '230000', batch: 'batch_1', domesticOnly: true, minimumDegree: 'bachelor', fresh: true,
    excerpt: '2.国内普通高校2026年应届大学本科及以上学历毕业生，毕业证、学位证原则上应于2026年7月31日前取得；国（境）外院校毕业生原则上应于2025年7月1日至2026年6月30日期间毕业，并于2026年7月31日前获得教育部留学服务中心学历认证。' },
  { key: 'requirement:5bcaaa59763e193905f7dec0', province: '230000', batch: 'batch_2', domesticOnly: true, minimumDegree: 'junior_college', fresh: true,
    excerpt: '2.国内普通高校2026年应届大学专科及以上学历毕业生，2026年7月31日前取得毕业证，大学本科及以上学历应聘人员应同时取得相应学位。学历与学位信息在“中国高等教育学生信息网”（学信网，https://www.chsi.com.cn）可查。国（境）外院校毕业生原则上应于2025年7月1日至2026年6月30日期间毕业，并于2026年7月31日前获得教育部留学服务中心学历认证。' },
  { key: 'requirement:134acad5b14e39741468e004', province: '230000', batch: 'batch_3', domesticOnly: true, minimumDegree: 'bachelor', fresh: true,
    excerpt: '2.国内普通高校2026年应届大学本科及以上学历毕业生，2026年7月31日前取得毕业证、学位证。学历、学位信息在“学信网”可查。国（境）外院校毕业生原则上应于2025年7月1日至2026年6月30日期间毕业，并于2026年7月31日前获得教育部留学服务中心学历认证。' },
  { key: 'requirement:4bc4c657c63c912a84e2c42c', province: '640000', batch: 'batch_1', domesticOnly: true, minimumDegree: 'bachelor', unified: true,
    excerpt: '2.应聘的国内院校毕业生，要求为国家统招计划内的普通高等院校2026届大学本科及以上学历毕业生。' },
  { key: 'requirement:ccb744aa7d100fa26858bebf', province: '640000', batch: 'batch_2', domesticOnly: true, minimumDegree: 'bachelor', fresh: true, unified: true,
    excerpt: '2.应聘的国内院校毕业生，要求为国家统招计划内的普通高等院校2026年应届大学本科及以上学历毕业生。' },
  { key: 'requirement:a379e08e3e0a35bf8ddf6dc8', province: '620000', batch: 'batch_1', domesticOnly: true, minimumDegree: 'bachelor', unified: true,
    excerpt: '2.应聘的国内院校毕业生，要求为国家统招计划内的普通高等院校2026届大学本科及以上学历毕业生。应聘的国（境）外留学生一般应于2025年7月1日至2026年6月30日期间毕业，于2026年8月31日前取得国家教育部学历学位认证证书。' },
  { key: 'requirement:fba733c36512fb64229bace1', province: '350000', batch: 'batch_3', domesticOnly: true, minimumDegree: 'bachelor', fresh: true, unified: true, electricalDiploma: true, otherMajorsBachelor: true,
    excerpt: '1.国内院校毕业生，要求为国家统招计划内的普通高等院校2026年应届毕业生，电工类大学专科及以上学历，非电工类大学本科及以上学历。毕业生原则上须在2026年7月底前取得毕业证、学位证等证书，相关信息在中国高等教育学历信息网（https://www.chsi.com.cn）可查证。' },
  { key: 'requirement:4f2d860a730fe8006cf2a03a', province: '430000', batch: 'batch_2', domesticOnly: true, minimumDegree: 'junior_college', fresh: true, grades: true,
    excerpt: '1.应聘的国内高校毕业生，应为普通高校2026年应届毕业生，大学专科及以上学历，成绩合格，且一般应于2026年7月31日前取得学位证、毕业证。应聘的国（境）外院校留学生，一般应于2025年7月1日至2026年6月30日之间毕业且获得学位证，并于2026年8月31日前取得国家教育部留学服务中心国外学历学位认证报告。' },
  { key: 'requirement:f965bd2685236ea143c0956b', province: '320000', batch: 'batch_2', domesticOnly: true, minimumDegree: 'bachelor', fresh: true, unified: true, crossDegreeMajor: true,
    excerpt: '2. 应聘的境内院校学生必须是国家统招计划内普通高等院校2026年应届本科及以上学历毕业，具体招聘专业见需求信息。本科阶段所学专业应与研究生阶段相同或相近，或为公司所需的专业。' },
  { key: 'requirement:c00f1c7e58385b82097e0075', province: '320000', batch: 'batch_3', domesticOnly: true, minimumDegree: 'bachelor', fresh: true, unified: true, crossDegreeMajor: true,
    excerpt: '2. 应聘的境内院校学生必须是国家统招计划内普通高等院校2026年应届本科及以上学历毕业，具体招聘专业见需求信息。本科阶段所学专业应与研究生阶段相同或相近，或为公司所需的专业。' },
  { key: 'requirement:01dfb993c510b645374f9575', province: '540000', batch: 'batch_2', minimumDegree: 'junior_college', mainMajor: true,
    excerpt: '大学专科及以上学历2026届高校毕业生，专业要求详见附件。招聘专业指主修专业，不包含辅修专业及第二学位专业，且与教育部学籍在线验证报告中专业一致。' },
];

const categoryLabels: Record<string, string> = {
  education: '学历要求', major: '专业要求', cohort: '毕业届别', training_mode: '培养方式',
  age: '年龄要求', language_and_computer: '英语与计算机', overseas_education: '境外学历',
  academic_verification: '学籍与学历', application_materials: '报名材料', health: '体检要求',
  special_obligation: '岗位与服务约定', integrity: '品行要求',
};
const cleanText = (value: unknown) => String(value ?? '').trim();
const officialDatasetId = 'sgcc-provincial-recruitment-2026-v1';
function rowMetadata(row: Row): Row {
  return row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata) ? row.metadata as Row : {};
}
/** The audited importer groups duplicate evidence and retains original keys.
 * Never infer an alias from text alone or from another dataset's metadata. */
function hasReviewedRequirementKey(row: Row, key: string): boolean {
  if (row.requirementKey === key) return true;
  const metadata = rowMetadata(row);
  return /^requirement-evidence:/.test(cleanText(row.requirementKey)) && metadata.dataset_id === officialDatasetId &&
    Array.isArray(metadata.original_requirement_keys) && metadata.original_requirement_keys.includes(key);
}
function eligibilityUnitKey(row: Row | undefined): string {
  if (!row) return '';
  const key = cleanText(row.companyKey ?? row.unitKey);
  const metadata = rowMetadata(row);
  // The importer deliberately reuses the existing Hubei provincial company.
  if (key === 'COMPANY-SGCC-HUBEI' && metadata.dataset_id === officialDatasetId &&
      metadata.official_unit_id === '10450001' && metadata.province_adcode === '420000') return 'sgcc-unit:10450001';
  return key;
}
const unique = (values: string[]) => [...new Set(values.filter(Boolean))];
const degreeLabel: Record<string, string> = { junior_college: '专科', bachelor: '本科', master: '硕士', doctor: '博士' };
const expectedValueLabels: Record<string, string> = {
  ...degreeLabel,
  legacy_985: '原985院校', legacy_211: '原211院校', former_power_ministry: '原电力部直属院校', public_institution: '公办院校',
  electrical: '电工类', computer: '计算机类', communication: '通信类', electronic_information: '电子信息类',
  artificial_intelligence: '人工智能类', finance: '财务类', human_resources: '人力资源类', law: '法学类', other_engineering: '其他工学类', other: '其他专业',
  domestic: '中国内地院校', overseas: '境外院校', true: '是', false: '否',
};
function expectedValueText(value: unknown): string {
  if (Array.isArray(value)) return value.map(expectedValueText).join(' / ');
  if (value === null || value === undefined) return '请查看具体条件';
  if (typeof value === 'object') return '请查看具体条件';
  return expectedValueLabels[String(value)] ?? String(value);
}
const reviewedUnitKeys: Record<string, string> = { '120000': 'sgcc-unit:10000029', '420000': 'sgcc-unit:10450001', '140000': 'sgcc-unit:10578000', '310000': 'sgcc-unit:10010000', '350000': 'sgcc-unit:10220000', '230000': 'sgcc-unit:10416705', '640000': 'sgcc-unit:10605000', '620000': 'sgcc-unit:10769004', '430000': 'sgcc-unit:10175326', '320000': 'sgcc-unit:10430000', '540000': 'sgcc-unit:10520000' };
// Additional hard / discretionary gates are bound to exact official excerpts,
// not activated merely because an arbitrary paragraph contains "25" or "专科".
const supplementalRules = [
  { key: 'requirement:7f445aec3bb5056f9ca9dc1f', kind: 'electrical_diploma', excerpt: '招聘专业均指主修专业。电工类专业要求大学专科及以上学历，电子信息类、其他工学类、财务会计类、管理类、其他专业等要求大学本科及以上学历。' },
  { key: 'requirement:68f3bb11a3f2592010152926', kind: 'age', excerpt: '2.应聘毕业生年龄：本科生一般不超过25周岁，硕士研究生一般不超过28周岁，博士研究生一般不超过33周岁。年龄计算的截止时间为2026年6月30日。条件特别优秀的可适当放宽。' },
  { key: 'requirement:5fefab31767aca1e02941d3d', kind: 'age', excerpt: '2.应聘毕业生年龄：专科生一般不超过23周岁，本科生一般不超过25周岁，硕士研究生一般不超过28周岁，博士研究生一般不超过33周岁。年龄计算的截止时间为2026年6月30日。条件特别优秀的可适当放宽。' },
  { key: 'requirement:3a26cc4bba3980fbfc381ff3', kind: 'age', excerpt: '2.应聘毕业生年龄：专科生一般不超过23周岁，本科生一般不超过25周岁，硕士研究生一般不超过28周岁，博士研究生一般不超过33周岁。年龄计算的截止时间为2026年6月30日。' },
  { key: 'requirement:173fe61a5be4998c913db823', kind: 'age', excerpt: '（五）年龄：大学本科生一般不超过25周岁，硕士研究生一般不超过28周岁，博士研究生一般不超过33周岁。毕业生年龄计算截止日期为2026年6月30日。' },
  { key: 'requirement:d0eba6f0e093d18bbf14eae6', kind: 'age', excerpt: '（五）年龄：大学本科生一般不超过25周岁，硕士研究生一般不超过28周岁，博士研究生一般不超过33周岁。毕业生年龄计算截止日期为2026年6月30日。' },
  { key: 'requirement:c2b91fc7c9d91328d47fd6c8', kind: 'age', excerpt: '（五）年龄：大学专科生一般不超过23周岁，大学本科生一般不超过25周岁，硕士研究生一般不超过28周岁，博士研究生一般不超过33周岁。毕业生年龄计算截止日期为2026年6月30日。' },
  { key: 'requirement:ab3ca108fd19695c45df2973', kind: 'main_major', excerpt: '（三）专业：主要招聘电工类、电子信息类、财务会计类、其他工学类、管理类专业。应聘专业为主修专业（不含辅修专业和第二学位），且与教育部学籍在线验证报告完全一致。' },
  { key: 'requirement:4672489e84144721a8041174', kind: 'main_major', excerpt: '（三）专业：主要招聘电工类、其他工学类、管理类、其他专业类专业。应聘专业为主修专业（不含辅修专业和第二学位），且与教育部学籍在线验证报告完全一致。' },
  { key: 'requirement:8221872cb350c598debc4461', kind: 'main_major', excerpt: '（三）专业：主要招聘电工类、电子信息类、其他工学类专业。应聘专业为主修专业（不含辅修专业和第二学位），且与教育部学籍在线验证报告完全一致。' },
];

function supplementalChecks(rows: Row[], applicant: RecruitmentApplicant): Check[] {
  return supplementalRules.flatMap<Check>(rule => {
    if (!rows.some(row => hasReviewedRequirementKey(row, rule.key) && cleanText(row.excerpt) === rule.excerpt)) return [];
    if (rule.kind === 'age') {
      const maximum = { junior_college: 23, bachelor: 25, master: 28, doctor: 33 }[applicant.degree];
      return [{ field: 'age', label: '年龄', expected: `2026年6月30日一般不超过${maximum}周岁；放宽情形单独确认`, state: applicant.age === undefined ? 'missing' : applicant.age > maximum ? 'confirm' : 'pass' } satisfies Check];
    }
    if (rule.kind === 'main_major') return [{ field: 'majorMatchesEnrollment', label: '主修专业', expected: '与学籍报告一致，非辅修或第二学位', state: applicant.majorMatchesEnrollment === undefined ? 'missing' : applicant.majorMatchesEnrollment ? 'pass' : 'fail' } satisfies Check];
    const minimum = applicant.majorCategory === 'electrical' ? 'junior_college' : 'bachelor';
    return [
      { field: 'majorCategory', label: '专业对应学历', expected: '电工类专科起；其余专业本科起', state: !applicant.majorCategory ? 'missing' : degreeCodes.indexOf(applicant.degree) < degreeCodes.indexOf(minimum) ? 'fail' : 'pass' } satisfies Check,
      { field: 'majorMatchesEnrollment', label: '主修专业', expected: '按最高学历主修专业报考', state: applicant.majorMatchesEnrollment === undefined ? 'missing' : applicant.majorMatchesEnrollment ? 'pass' : 'fail' } satisfies Check,
    ];
  });
}

function compareRule(rule: Rule, applicant: RecruitmentApplicant): Check[] {
  const checks: Check[] = [];
  const check = (field: keyof RecruitmentApplicant, label: string, expected: string, passes: boolean) => checks.push({
    field, label, expected, state: applicant[field] === undefined ? 'missing' : passes ? 'pass' : 'fail',
  });
  if (rule.domesticOnly) {
    check('educationLocation', '就读地区', '中国内地院校', applicant.educationLocation === 'domestic');
    // The domestic branch cannot reject an overseas applicant. Its own branch
    // must be reviewed separately, including certificate date windows.
    if (applicant.educationLocation === 'overseas') return [{ field: 'educationLocation', label: '境外学历条件', expected: '核对毕业时间及留服认证', state: 'confirm' }];
    if (!applicant.educationLocation) return checks;
  }
  check('graduationYear', '毕业届别', '2026届', applicant.graduationYear === 2026);
  let minimum = rule.minimumDegree;
  if (rule.electricalDiploma) {
    if (!applicant.majorCategory) checks.push({ field: 'majorCategory', label: '专业类别', expected: '电工类专科起；电子信息/其他工学本科起', state: 'missing' });
    else if (applicant.majorCategory === 'electrical') minimum = 'junior_college';
    else if (!rule.otherMajorsBachelor && !['electronic_information', 'other_engineering'].includes(applicant.majorCategory)) {
      checks.push({ field: 'majorCategory', label: '具体专业', expected: '核对岗位专业目录', state: 'confirm' });
      minimum = undefined;
    }
    // No major selected: do not wrongly fail a possible electrical diploma branch.
    if (!applicant.majorCategory) minimum = undefined;
  }
  if (minimum) check('degree', '学历', `${degreeLabel[minimum]}及以上`, degreeCodes.indexOf(applicant.degree) >= degreeCodes.indexOf(minimum));
  if (rule.requiresJobReview) checks.push({ field: 'majorCategory', label: '岗位专业', expected: '学历下限之外，拟报岗位专业与其他条件须单独核对', state: 'confirm' });
  if (rule.fresh) check('freshGraduate', '毕业状态', '应届毕业生', applicant.freshGraduate === true);
  if (rule.unified) check('nationalUnifiedAdmission', '招生方式', '国家统招普通高校', applicant.nationalUnifiedAdmission === true);
  if (rule.mainMajor) check('majorMatchesEnrollment', '主修专业', '与学籍报告一致，非辅修或第二学位', applicant.majorMatchesEnrollment === true);
  if (rule.grades) check('gradesAcceptable', '成绩', '学业成绩合格', applicant.gradesAcceptable === true);
  if (rule.crossDegreeMajor && ['master', 'doctor'].includes(applicant.degree)) checks.push({ field: 'crossDegreeMajor', label: '本硕专业衔接', expected: '本硕专业相同、相近，或属于公司所需专业，需按具体专业核对', state: 'confirm' });
  return checks;
}

function groupedRequirements(rows: Row[]): Group[] {
  return Object.entries(categoryLabels).flatMap(([category, title]) => {
    const items = unique(rows.filter(row => row.category === category).map(row => recruitmentDisplayText(row.excerpt ?? row.text)));
    return items.length ? [{ category, title, items }] : [];
  });
}
const followUpLabels = ['按拟报岗位核对专业名称与证书', '确认毕业证、学位证取得时间', '完成报名材料与体检要求核对'];

type ReferenceComparison = { decision: RecruitmentDecision; label: string; summary: string; checks: Check[] };
type ReferenceRule = { key: string; province: string; company: string; unitKey: string; row: number; text: string; kind: 'public_domestic' | 'public_or_qs100' | 'qs_unclear' | 'bachelor' | 'public' };
// Reviewed cells C3:C24. Column E (experience / priority guesses) and the
// analysis-template row are intentionally not admission predicates. The exact
// source identity, version, cell and text must still exist in the published DB.
export const reviewedReferenceRules: ReferenceRule[] = [
  { key: 'fact.ae24b40e95fbf5cfb871d0fa', province: '山东', company: '山东', unitKey: 'sgcc-unit:10554018', row: 3, text: '国内公办二本及以上', kind: 'public_domestic' },
  { key: 'fact.46fd93758cbfc7a0f0c422f4', province: '湖北', company: '湖北', unitKey: 'sgcc-unit:10450001', row: 4, text: '国内公办二本及以上和qs前100院校', kind: 'public_or_qs100' },
  { key: 'fact.6217051d4ae0d878fee4207b', province: '浙江', company: '浙江', unitKey: 'sgcc-unit:10250037', row: 5, text: '国内公办二本及以上和qs前100国网院校', kind: 'qs_unclear' },
  { key: 'fact.4e472b81f9d9105eff4a685b', province: '河南', company: '河南', unitKey: 'sgcc-unit:10522000', row: 6, text: '国内公办二本及以上', kind: 'public_domestic' },
  { key: 'fact.16cd7220357755eaec0ca349', province: '江西', company: '江西', unitKey: 'sgcc-unit:10090003', row: 7, text: '国内公办二本及以上', kind: 'public_domestic' },
  { key: 'fact.1c5767ceae05ae21d68df54d', province: '安徽', company: '安徽', unitKey: 'sgcc-unit:10330026', row: 8, text: '国内公办二本及以上', kind: 'public_domestic' },
  { key: 'fact.31ed06da6dafba75ee4cb4ad', province: '吉林', company: '吉林', unitKey: 'sgcc-unit:10200226', row: 9, text: '国内公办二本及以上', kind: 'public_domestic' },
  { key: 'fact.42ce8662bceb69578a2b7660', province: '黑龙江', company: '黑龙江', unitKey: 'sgcc-unit:10416705', row: 10, text: '国内公办二本以上', kind: 'public_domestic' },
  { key: 'fact.656dc8d29125a5068980d794', province: '辽宁', company: '辽宁', unitKey: 'sgcc-unit:10130000', row: 11, text: '国内公办二本以上', kind: 'public_domestic' },
  { key: 'fact.3a614f61857f314e4a1a2a5d', province: '江苏', company: '江苏', unitKey: 'sgcc-unit:10430000', row: 12, text: '本科及以上学历', kind: 'bachelor' },
  { key: 'fact.0a12c35b9b9df6df8cb83c35', province: '湖南', company: '湖南', unitKey: 'sgcc-unit:10175326', row: 13, text: '国内公办二本及以上和qs前100国外院校', kind: 'public_or_qs100' },
  { key: 'fact.1df247995be57188bebe4ba7', province: '陕西', company: '陕西', unitKey: 'sgcc-unit:10750030', row: 14, text: '国内公办二本及以上', kind: 'public_domestic' },
  { key: 'fact.7cfa92290ba1464a84e31ae0', province: '宁夏', company: '宁夏', unitKey: 'sgcc-unit:10605000', row: 15, text: '国内公办二本及以上', kind: 'public_domestic' },
  { key: 'fact.10b61b473335ef1e1b1f3036', province: '青海', company: '青海', unitKey: 'sgcc-unit:10797627', row: 16, text: '民办本科，独立学院及以上', kind: 'bachelor' },
  { key: 'fact.5e8c846b4c69b01d3ac4b639', province: '甘肃', company: '甘肃', unitKey: 'sgcc-unit:10769004', row: 17, text: '国内公办二本及以上', kind: 'public_domestic' },
  { key: 'fact.a5189b23c36c171aab3ce5bd', province: '新疆', company: '新疆', unitKey: 'sgcc-unit:10625124', row: 18, text: '国内公办二本及以上', kind: 'public_domestic' },
  { key: 'fact.99c4d4e3f2e97e9876333709', province: '山西', company: '山西', unitKey: 'sgcc-unit:10578000', row: 19, text: '国内公办二本及以上', kind: 'public_domestic' },
  { key: 'fact.d5685a6f3d199649fbf09a46', province: '河北', company: '河北', unitKey: 'sgcc-unit:10372265', row: 20, text: '国内公办二本及以上', kind: 'public_domestic' },
  { key: 'fact.12108b166fae02818e58c4dc', province: '河北', company: '冀北', unitKey: 'sgcc-unit:10683000', row: 21, text: '国内公办二本及以上', kind: 'public_domestic' },
  { key: 'fact.9f93888f3d7e467d724d962a', province: '重庆', company: '重庆', unitKey: 'sgcc-unit:10060000', row: 22, text: '公办二本及以上', kind: 'public' },
  { key: 'fact.e33e28a3730ff069e2b1edbf', province: '四川', company: '四川', unitKey: 'sgcc-unit:10300000', row: 23, text: '公办二本及以上', kind: 'public' },
  { key: 'fact.7741bc5ccd3b0523994fbc46', province: '福建', company: '福建', unitKey: 'sgcc-unit:10220000', row: 24, text: '国内公办二本及以上和qs前100院校', kind: 'public_or_qs100' },
];
function referenceComparison(rule: ReferenceRule, applicant: RecruitmentApplicant): ReferenceComparison {
  const checks: Check[] = [
    { field: 'degree', label: '学历', expected: '本科及以上', state: applicant.degree === 'junior_college' ? 'fail' : 'pass' },
    { field: 'graduationYear', label: '毕业届别', expected: '2026届', state: applicant.graduationYear === undefined ? 'missing' : applicant.graduationYear === 2026 ? 'pass' : applicant.educationLocation === 'overseas' ? 'confirm' : 'fail' },
  ];
  if (rule.kind !== 'bachelor') {
    if (!applicant.educationLocation) checks.push({ field: 'educationLocation', label: '就读地区', expected: '请选择学校所在地区', state: 'missing' });
    else if (applicant.educationLocation === 'overseas' && rule.kind === 'public_or_qs100') {
      checks.push({ field: 'qsTop100', label: '境外学校范围', expected: 'QS前100院校；具体榜单年份另核', state: applicant.qsTop100 === undefined ? 'missing' : applicant.qsTop100 ? 'pass' : 'fail' });
    } else if (applicant.educationLocation === 'overseas' && rule.kind === 'qs_unclear') {
      checks.push({ field: 'educationLocation', label: '境外学校范围', expected: '该项境外院校描述不完整，需另行核对', state: 'confirm' });
    } else if (applicant.educationLocation === 'overseas' && rule.kind === 'public_domestic') {
      checks.push({ field: 'educationLocation', label: '就读地区', expected: '中国内地院校', state: 'fail' });
    } else {
      checks.push({ field: 'schoolTags', label: '学校性质', expected: '公办院校', state: applicant.schoolTagsConfirmed !== true ? 'missing' : applicant.schoolTags?.includes('public_institution') ? 'pass' : 'fail' });
    }
  }
  const decision = checks.some(c => c.state === 'fail') ? 'reference_mismatch' : checks.some(c => c.state === 'missing') ? 'missing_input' : checks.some(c => c.state === 'confirm') ? 'needs_confirmation' : 'reference_match';
  return { decision, label: decision === 'reference_match' ? '参考条件匹配' : decision === 'reference_mismatch' ? '与参考条件不符' : decision === 'missing_input' ? '参考比对需补充信息' : '参考条件需确认', summary: '仅比对学历、学校范围和届别，用于缩小报考方向；不代表已满足具体岗位条件。', checks };
}
function publishedReferenceRule(rows: Row[], unitKey: string): ReferenceRule | undefined {
  return reviewedReferenceRules.find(rule => rule.unitKey === unitKey && rows.some(row =>
    row.datasetKey === 'user-materials-2026-grid-query' && row.version === '2026.09.22.2' &&
    row.sourceKey === 'excel.a1761d20694bde6ac43d' && row.factKey === rule.key && row.text === rule.text &&
    row.evidenceLocator === `26各省综合情况!C${rule.row}` && row.province === rule.province && row.company === rule.company &&
    row.cohortYear === 2026 && row.batchCode === 'batch_1' && row.grid === 'sgcc' && row.scope === 'province' &&
    row.category === 'education' && row.dataStatus === 'reference' && !row.issueReason));
}

export type RecruitmentHistoricalResult = Pick<RecruitmentResult, 'id' | 'provinceAdcode' | 'provinceName' | 'targetName' | 'grid' | 'operatorScope' | 'officialRecruitmentUrl' | 'batchCode' | 'batchLabel' | 'groups' | 'ruleScope'>;
export type RecruitmentEligibilityInput = {
  applicant: RecruitmentApplicant;
  cohortYear: number;
  comparisonMode?: 'current' | 'historical' | 'reference' | undefined;
  batchCodes?: RecruitmentBatchCode[] | undefined;
  provinces: Row[];
  companies: Row[];
  requirements: Row[];
  sources: Row[];
  earlyPolicies: EarlyBatchPolicyRecord[];
  referenceFacts?: Row[] | undefined;
};

/** Common notice conditions only. Job education/major and physical examinations
 * remain separate, even if all self-reported common conditions match. */
function compareNativeNotice(notice: NativeNotice, applicant: RecruitmentApplicant): { checks: Check[]; groups: Group[] } {
  const c = notice.conditions;
  const groups: Group[] = [];
  if (notice.scopeNote) groups.push({ category: 'scope', title: '招聘范围', items: [notice.scopeNote] });
  if (notice.positions.length) groups.push({ category: 'positions', title: '招聘方向', items: notice.positions });
  if (notice.notes?.length) groups.push({ category: 'arrangements', title: '报考安排', items: notice.notes });
  if (!c) return { checks: [], groups };
  const checks: Check[] = [];
  const bool = (field: keyof RecruitmentApplicant, label: string, expected: string, desired = true) => {
    checks.push({ field, label, expected, state: applicant[field] === undefined ? 'missing' : applicant[field] === desired ? 'pass' : 'fail' });
  };
  const endDate = applicant.degree === 'doctor' && c.overseasDoctorDecember ? '2026-12-31' : '2026-06-30';
  const certificateDeadline = applicant.degree === 'doctor' ? '2026年12月底' : '2026年8月底';
  const educationItems = [
    `境内：国家招生计划内普通高校${c.domesticCohort === '2026' ? '2026届' : ''}应届毕业生，在校期间非在职。`,
    `境外：2025年7月至2026年6月毕业${c.overseasBachelor ? '，本科及以上学历' : ''}${c.overseasDoctorDecember ? '；博士毕业时间可至2026年12月' : ''}。`,
    '学历、学位和专业按拟报岗位分别核对，使用最高学历及对应主修专业。',
  ];
  if (c.careerWindowException) educationItems.push('涉及国家或地方择业期政策的，另按适用政策确认。');
  groups.push({ category: 'education', title: '毕业与学历', items: educationItems });
  groups.push({ category: 'qualification', title: '取证与报到', items: ['一般须在2026年8月底前取得认证的学历和学位，博士可至2026年12月。', ...(c.socialInsurance ? [`在校及毕业后，国内不得有${c.socialInsurance === 'employer' ? '用人单位' : ''}社保缴费记录。`] : [])] });
  groups.push({ category: 'other_conditions', title: '其他条件', items: ['身体条件须符合岗位和电力行业要求；具体体检项目按所选岗位核对。', '须符合遵纪守法、品行及诚信要求；资料与学籍信息应真实一致。', ...(c.minimumAge ? [`应聘时须年满${c.minimumAge}周岁，并具备相应行为和劳动能力。`] : [])] });
  if (!applicant.educationLocation) checks.push({ field: 'educationLocation', label: '就读地区', expected: '选择境内或境外院校，以匹配毕业要求', state: 'missing' });
  else if (applicant.educationLocation === 'domestic') {
    bool('nationalUnifiedAdmission', '招生方式', '国家招生计划内普通高校');
    bool('nonEmployedDuringStudy', '在校期间身份', '非在职就读（不等同于仅填写全日制）');
    if (applicant.freshGraduate === false && c.careerWindowException) checks.push({ field: 'freshGraduate', label: '应届或择业期', expected: '须确认本人适用的国家或地方择业期政策', state: 'confirm' });
    else bool('freshGraduate', '应届身份', '应届毕业生');
    const yearState = applicant.graduationYear === undefined ? 'missing' : applicant.graduationYear === 2026 ? 'pass'
      : c.careerWindowException || c.domesticCohort === 'fresh' ? 'confirm' : 'fail';
    checks.push({ field: 'graduationYear', label: '毕业届别', expected: c.careerWindowException ? '2026届；其他届别按适用择业期政策确认' : '2026届', state: yearState });
  } else {
    const date = applicant.graduationDate;
    // A valid 2025 overseas graduation may be inside this cohort's window.
    checks.push({ field: 'graduationDate', label: '境外毕业日期', expected: `2025-07-01 至 ${endDate}`, state: !date ? 'missing' : date >= '2025-07-01' && date <= endDate ? 'pass' : 'fail' });
    if (c.overseasBachelor) checks.push({ field: 'degree', label: '境外学历', expected: '本科、硕士或博士', state: applicant.degree === 'junior_college' ? 'fail' : 'pass' });
  }
  bool('qualificationsByDeadline', '毕业取证期限', `${certificateDeadline}前取得本岗位所需认证学历、学位`);
  const conflictingInsurance = c.socialInsurance && applicant.hasDomesticEmployerSocialInsurance === true && applicant.hasDomesticSocialInsurance === false;
  if (conflictingInsurance) checks.push({ field: 'socialInsuranceConsistency', label: '社保信息需确认', expected: '用人单位社保属于国内社保；请统一核对两项填写结果', state: 'confirm' });
  else {
    if (c.socialInsurance === 'employer') bool('hasDomesticEmployerSocialInsurance', '用人单位社保', '就读期间及毕业后无国内用人单位社保缴费记录', false);
    if (c.socialInsurance === 'any') bool('hasDomesticSocialInsurance', '国内社保', '就读期间及毕业后无国内社保缴费记录', false);
  }
  if (c.minimumAge) checks.push({ field: 'ageAtApplication', label: '应聘时年龄', expected: `应聘时年满${c.minimumAge}周岁`, state: applicant.ageAtApplication === undefined ? 'missing' : applicant.ageAtApplication >= c.minimumAge ? 'pass' : 'fail' });
  return { checks, groups };
}

// Cross-cohort comparison is an explicit projection, not a date-shifted copy
// of an old eligibility decision. Only these reviewed non-temporal dimensions
// may influence it. Unknown predicates remain manual rather than being passed.
const referenceFields = new Set(['degree', 'educationLocation', 'majorCategory', 'schoolTags', 'schoolIdentity', 'schoolProvinceAdcode', 'schoolTagsConfirmed', 'qsTop100', 'fullTime', 'nationalUnifiedAdmission', 'majorMatchesEnrollment', 'hasFailedCourses', 'gradesAcceptable', 'languageQualification', 'cet4OrHigher', 'cet6OrHigher', 'computerLevel2', 'crossDegreeMajor']);
const temporalFields = new Set(['graduationYear', 'graduationDate', 'freshGraduate', 'age', 'ageAtApplication', 'certificatesObtainedBeforeApplication', 'qualificationsByDeadline', 'nonEmployedDuringStudy', 'hasDomesticEmployerSocialInsurance', 'hasDomesticSocialInsurance', 'socialInsuranceConsistency']);
function referenceDecision(checks: Check[]): RecruitmentDecision {
  return checks.some(c => c.state === 'fail') ? 'reference_mismatch'
    : checks.some(c => c.state === 'missing') ? 'missing_input'
      : checks.length && checks.every(c => c.state === 'pass') ? 'reference_match' : 'needs_confirmation';
}
function stableChecks(checks: Check[]): Check[] {
  return checks.filter(c => !temporalFields.has(c.field)).map(c => referenceFields.has(c.field) ? c
    : { ...c, state: 'confirm', expected: '该条件须按具体岗位单独核对' });
}
function compareReferenceCampus(policy: EarlyBatchPolicyRecord, applicant: RecruitmentApplicant): Check[] {
  const model = eligibilityModel(policy);
  const branches = model.branches.map(branch => {
    const predicates = branch.predicates.filter(p => !temporalFields.has(p.field)).map(p => referenceFields.has(p.field) ? p
      : { ...p, operator: 'requires_manual_review' });
    // Removing dates from a date-only branch must not create vacuous success.
    return { ...branch, predicates, outcome: predicates.length ? branch.outcome : 'manual_review' as const };
  });
  const projection = { ...policy, eligibilityModel: { ...model, branches } };
  const evaluated = evaluateEarlyBatchPolicy(projection, applicant as EarlyBatchApplicant);
  const matched = branches.find(branch => branch.key === evaluated.matchedBranchKey);
  const checks: Check[] = [
    ...(evaluated.decision === 'eligible_under_workbook_rule' && matched ? matched.predicates.map(p => ({ field: p.field, label: p.label, expected: expectedValueText(p.value), state: 'pass' as const })) : []),
    ...evaluated.missingInputs.map(p => ({ field: p.field, label: p.label, expected: expectedValueText(p.expected), state: 'missing' as const })),
    ...evaluated.unmetRequirements.map(p => ({ field: p.field, label: p.label, expected: expectedValueText(p.expected), state: 'fail' as const })),
  ];
  if (evaluated.decision === 'manual_review') checks.push({ field: 'referenceScope', label: '单独核对的条件', expected: '该路径含人工核对或未结构化条件，不能自动匹配', state: 'confirm' });
  return checks;
}

export function evaluateRecruitmentEligibility(request: RecruitmentEligibilityInput) {
  const referenceMode = request.comparisonMode === 'reference';
  const targetCohortYear = request.cohortYear;
  const { referenceCohortYear, referenceSelection } = resolveRecruitmentReferenceCohort(targetCohortYear);
  const sourceCohortYear = referenceMode ? referenceCohortYear : targetCohortYear;
  // This local query view changes only the requested source year. The original
  // input, applicant's graduation year, records and policy models are untouched.
  const input = { ...request, cohortYear: sourceCohortYear };
  const batchCodes = input.batchCodes ?? [...recruitmentBatchCodes];
  const availableRuleCohorts = [2026];
  const emptySummary = { total: 0, initialMatch: 0, referenceMatch: 0, referenceMismatch: 0, notMatched: 0, missingInput: 0, needsConfirmation: 0 };
  const historical = input.comparisonMode === 'historical';
  // Coverage is not eligibility. In particular, a 2027 candidate must not be
  // rejected merely because this engine currently only has reviewed 2026 rules.
  // Earlier graduation is still handled by the actual notice's overseas and
  // career-window exceptions below; do not blanket reject those applicants.
  const unsupported = !availableRuleCohorts.includes(input.cohortYear);
  const futureApplicant = !historical && !referenceMode && input.applicant.graduationYear !== undefined && input.applicant.graduationYear > input.cohortYear;
  if (unsupported || futureApplicant) {
    return {
      schemaVersion: '1.4.0', cohortYear: targetCohortYear, targetCohortYear, referenceCohortYear, referenceSelection, sourceCohortYear, comparisonMode: request.comparisonMode ?? 'current', batchCodes,
      coverage: { status: unsupported ? 'not_loaded' as const : 'cohort_mismatch' as const, ruleCohortYear: unsupported ? null : input.cohortYear, availableRuleCohorts },
      notice: unsupported && referenceMode ? `报考${targetCohortYear}届，默认参考${referenceCohortYear}届；${referenceCohortYear}届可匹配规则尚未收录，已有资料可在信息汇总中查看，不会替换为其他届规则。` : unsupported
        ? `${input.cohortYear}届报考条件尚未收录，暂不作资格判断；可单独查看2026届历史条件。`
        : `毕业年份为${input.applicant.graduationYear}年，不能套用${input.cohortYear}届条件判断；请切换报考届别，或单独查看历史条件。`,
      summary: emptySummary, results: [] as RecruitmentResult[], historicalResults: [] as RecruitmentHistoricalResult[],
    };
  }
  const privateIndex = privateSourceIndex(input.sources);
  const sources = publicSourceRows(input.sources, privateIndex);
  const sourceKeys = new Set(sources.filter(row => (row.cohortYear === undefined || Number(row.cohortYear) === input.cohortYear) && ['current_official_page', 'official_attachment', 'national_official_page', 'national_official_attachment'].includes(String(row.sourceType))).flatMap(row => [row.sourceKey, row.id].filter((v): v is string => typeof v === 'string')));
  const companies = publicSourceRows(input.companies, privateIndex);
  const referenceFacts = publicSourceRows(input.referenceFacts ?? [], privateIndex);
  const requirements = publicSourceRows(input.requirements, privateIndex).filter(row => {
    const company = companies.find(company => (row.companyId && company.id === row.companyId) || (row.unitKey && eligibilityUnitKey(company) === row.unitKey));
    const unitKey = company ? eligibilityUnitKey(company) : cleanText(row.unitKey);
    return /^sgcc-unit:/.test(unitKey) && Number(row.cohortYear) === input.cohortYear && batchCodes.includes(row.batchCode as RecruitmentBatchCode);
  });
  const provinceCode = (row: Row) => cleanText(row.provinceAdcode) || cleanText(input.provinces.find(p => p.id === row.provinceId)?.adcode);
  const official = (row: Row) => {
    const refs = [...(Array.isArray(row.sourceKeys) ? row.sourceKeys : []), row.sourceDocumentId].filter(Boolean);
    return row.evidenceTier === 'A' && row.status === 'verified_current_official_excerpt' && refs.length > 0 && refs.every(key => sourceKeys.has(String(key)));
  };
  const results: RecruitmentResult[] = [];
  const labels: Record<RecruitmentDecision, string> = { initial_match: '已比对基础条件匹配', reference_match: '参考条件匹配', reference_mismatch: '与参考条件不符', not_matched: '条件不匹配', missing_input: '请补充信息', needs_confirmation: '需进一步确认' };
  for (const province of input.provinces.filter(row => !['710000', '810000', '820000'].includes(String(row.adcode)))) {
    const code = cleanText(province.adcode);
    if (!/^\d{6}$/.test(code)) continue;
    for (const batchCode of batchCodes) {
      if (!['campus', 'batch_1', 'batch_2', 'batch_3'].includes(batchCode)) continue;
      const rows = requirements.filter(row => provinceCode(row) === code && row.batchCode === batchCode);
      const provinceUnits = companies.filter(row => provinceCode(row) === code && /^sgcc-unit:/.test(eligibilityUnitKey(row)));
      const policies = batchCode === 'campus' ? input.earlyPolicies.filter(policy =>
        (policy.provinceAdcode ?? policy.parentProvinceAdcode) === code && policy.cohortYear === input.cohortYear &&
        policy.publicationStatus === 'published' && publicSourceRows([policy as unknown as Row], privateIndex).length) : [];
      // Preserve distinct early-batch reference targets (e.g. 河北 / 冀北 /
      // 苏北县招). A provincial reference must never be copied to another unit.
      const unitKeys = policies.length ? policies.map(policy => `policy:${policy.targetCode}`) : unique([...rows.map(row => cleanText(row.companyId ?? row.unitKey) || 'province'), ...provinceUnits.map(row => cleanText(row.id ?? row.companyKey ?? row.unitKey))]);
      // SGCC batches must not manufacture empty cards for CSG-only provinces.
      // An absent result is not a rejection of that province's own recruitment.
      if (!unitKeys.length) continue;
      for (const unitKey of unitKeys) {
        const policy = policies.find(policy => `policy:${policy.targetCode}` === unitKey);
        const scopedCampusKeys: Record<string, string> = { 'PROV-130000': 'sgcc-unit:10372265', 'UNIT-JIBEI': 'sgcc-unit:10683000', 'UNIT-MENGDONG': 'sgcc-unit:10040352' };
        const campusCompanyKey = policy ? scopedCampusKeys[policy.targetCode] ??
          (policy.targetKind === 'province' && provinceUnits.length === 1 ? eligibilityUnitKey(provinceUnits[0]) : '') : '';
        const campusCompany = campusCompanyKey ? provinceUnits.find(row => eligibilityUnitKey(row) === campusCompanyKey) : undefined;
        const requirementUnitKey = campusCompany ? cleanText(campusCompany.id ?? campusCompany.companyKey ?? campusCompany.unitKey) : unitKey;
        const unitRows = rows.filter(row => (cleanText(row.companyId ?? row.unitKey) || 'province') === requirementUnitKey);
        const company = companies.find(row => row.id === unitKey || row.companyKey === unitKey || row.unitKey === unitKey);
        let targetName = policy?.targetName || cleanText(company?.name ?? company?.unitName) || cleanText(province.name);
        const resolvedUnitKey = eligibilityUnitKey(company) || unitKey;
        const review = reviewedRecruitmentRules.find(rule => reviewedUnitKeys[code] === resolvedUnitKey && rule.province === code && rule.batch === batchCode && unitRows.some(row => official(row) && hasReviewedRequirementKey(row, rule.key) && cleanText(row.excerpt) === rule.excerpt && (!rule.sourceKey || sources.some(source => source.sourceKey === rule.sourceKey && source.checksumSha256 === rule.sourceChecksum && Number(source.cohortYear) === input.cohortYear && source.batchCode === batchCode && (Array.isArray(row.sourceKeys) ? row.sourceKeys : []).includes(rule.sourceKey)))));
        let checks = review ? compareRule(review, input.applicant) : [];
        if (review && (!review.domesticOnly || input.applicant.educationLocation === 'domestic')) checks.push(...supplementalChecks(unitRows.filter(official), input.applicant));
        if (review && !input.applicant.majorCategory) checks.push({ field: 'majorCategory', label: '专业类别', expected: '填写专业类别后继续比对', state: 'missing' });
        if (review?.province === '230000' && review.batch === 'batch_2' && input.applicant.degree === 'junior_college') checks.push({ field: 'majorCategory', label: '专科对应岗位', expected: '需按岗位表确认接受专科的专业与单位', state: 'confirm' });
        if (code === '310000' && batchCode === 'batch_3' && unitRows.some(row => official(row) && hasReviewedRequirementKey(row, 'requirement:b00273db2e69689c711861e6') && row.excerpt === '国网上海市电力公司（以下简称“上海公司”）2026年高校毕业生第三批招聘单位为上海隆源供电服务有限公司，上海隆源供电服务有限公司（以下简称“隆源公司”）成立于2001年4月，为上海恒能泰企业管理有限公司全资子公司。')) targetName = '上海隆源供电服务有限公司';
        let ruleScope: 'basic_conditions' | 'reference' | 'not_structured' = review ? 'basic_conditions' : 'not_structured';
        let groups = groupedRequirements(unitRows);
        // Positive means only the displayed, reviewed subset matched. It is not
        // a determination that all admission conditions or job gates passed.
        let decision: RecruitmentDecision = checks.some(check => check.state === 'fail') ? 'not_matched' : checks.some(check => check.state === 'missing') ? 'missing_input' : review && checks.length && checks.every(check => check.state === 'pass') ? 'initial_match' : 'needs_confirmation';
        let reference: ReferenceComparison | undefined;
        if (batchCode === 'batch_1') {
          const referenceRule = publishedReferenceRule(referenceFacts, resolvedUnitKey);
          if (referenceRule) {
            reference = referenceComparison(referenceRule, input.applicant);
            if (!review) { decision = reference.decision; ruleScope = 'reference'; checks = reference.checks; }
          }
        }
        if (batchCode === 'campus' && policy) {
            ruleScope = 'reference';
            const campusText = recruitmentDisplayText(policy.recruitmentRequirements);
            groups = [...groupedRequirements(unitRows.filter(official)).map(group => ({ ...group, title: `公告 · ${group.title}` })), ...(campusText ? [{ category: 'campus_reference', title: '提前批参考条件', items: [campusText] }] : [])];
            if (referenceMode) {
              checks = compareReferenceCampus(policy, input.applicant);
              decision = referenceDecision(checks);
            } else if (input.applicant.degree !== 'junior_college') {
              const evaluated = evaluateEarlyBatchPolicy(policy, input.applicant as EarlyBatchApplicant);
              checks = [...evaluated.missingInputs.map(item => ({ field: item.field, label: item.label, expected: '补充后比对', state: 'missing' as const })), ...evaluated.unmetRequirements.map(item => ({ field: item.field, label: item.label, expected: expectedValueText(item.expected), state: 'fail' as const }))];
              decision = evaluated.decision === 'missing_input' ? 'missing_input' : evaluated.decision === 'eligible_under_workbook_rule' ? 'reference_match' : evaluated.decision === 'ineligible_under_workbook_rule' ? 'reference_mismatch' : 'needs_confirmation';
              if (input.applicant.graduationYear !== 2026) {
                checks.push({ field: 'graduationYear', label: '毕业届别', expected: '2026届；其他毕业时间需单独核对', state: input.applicant.graduationYear === undefined ? 'missing' : 'confirm' });
                decision = input.applicant.graduationYear === undefined ? 'missing_input' : 'needs_confirmation';
              }
            }
        }
        const nextSteps = ruleScope === 'not_structured'
          ? (groups.length ? ['按下面分类要求核对拟报单位和岗位'] : ['选择有招聘条件的单位后继续核对'])
          : ruleScope === 'reference' ? ['核对具体单位的岗位专业与证书条件', ...checks.filter(check => check.state !== 'pass').map(check => check.label)]
            : followUpLabels;
        const summary = decision === 'not_matched' ? '当前填写信息与该单位已核对的基础条件不一致。'
            : decision === 'reference_match' ? '与已整理的参考条件相符，可作为优先了解的方向；仍需核对具体岗位条件。'
              : decision === 'reference_mismatch' ? '与已整理的参考条件不符，不等于该单位正式拒绝报名。'
            : decision === 'missing_input' ? '补齐下列信息后可继续比对。'
              : ruleScope === 'reference' ? '已整理参考条件，请继续核对具体单位和岗位。'
                : review && checks.every(check => check.state === 'pass') ? '已比对的条件匹配；具体岗位专业、证书和体检条件仍需逐项确认。'
                : groups.length ? '已按类别整理要求，具体岗位需逐项确认。' : '目前没有可直接比对的岗位条件，不能据此认定可报或不可报。';
        const mengdong = resolvedUnitKey === 'sgcc-unit:10040352' || campusCompanyKey === 'sgcc-unit:10040352';
        const originReferences = recruitmentOriginReferences({ sourceCohortYear, unitKey: campusCompanyKey || resolvedUnitKey, batchCode, applicant: input.applicant, referenceFacts, sources });
        results.push({ id: `${code}:${batchCode}:${unitKey}`, provinceAdcode: code, provinceName: cleanText(province.name), targetName, grid: 'sgcc', operatorScope: mengdong ? 'mengdong' : 'sgcc', batchCode, batchLabel: recruitmentBatchLabels[batchCode], decision, decisionLabel: labels[decision], summary, checks, groups, nextSteps: unique(nextSteps), ruleScope, ...(reference ? { referenceComparison: reference } : {}), ...(originReferences.length ? { originReferences } : {}) });
      }
    }
  }
  // A named 2026 native notice is its own unit/batch scope. It must never be
  // synthesized by relabelling a State Grid batch, an undated education fact,
  // or a different CSG company's announcement (notably Shenzhen/Guangdong).
  const publishedProvinceCodes = new Set(input.provinces.map(row => cleanText(row.adcode)));
  for (const notice of nativeReviewed2026Notices.filter(row => row.cohortYear === input.cohortYear && publishedProvinceCodes.has(row.provinceAdcode) && batchCodes.includes(row.batchCode))) {
    const linkedSources = input.sources.filter(row => row.sourceKey === notice.key || row.officialUrl === notice.sourceUrl);
    if (!publicSourceRows([{ sourceKey: notice.key, sourceKeys: linkedSources.flatMap(row => [row.sourceKey, row.id].filter(Boolean)) }], privateIndex).length) continue;
    const { checks, groups } = compareNativeNotice(notice, input.applicant);
    const isOfficial = notice.sourceKind === 'official_direct';
    let decision: RecruitmentDecision = !notice.conditions ? 'needs_confirmation' : checks.some(check => check.state === 'fail') ? (isOfficial ? 'not_matched' : 'reference_mismatch') : checks.some(check => check.state === 'missing') ? 'missing_input' : checks.some(check => check.state === 'confirm') ? 'needs_confirmation' : isOfficial ? 'initial_match' : 'reference_match';
    // This is a common-condition comparison, never a complete job decision.
    const summary = !notice.conditions ? '可查看招聘单位与岗位，具体报名条件需逐项确认。'
      : decision === 'not_matched' || decision === 'reference_mismatch' ? '填写信息与该批次已整理的基础条件不一致，请查看具体差异。'
        : decision === 'missing_input' ? '补齐下列信息后可继续比对该批次条件。'
          : decision === 'needs_confirmation' ? '有需要单独确认的信息，请查看下列条件。'
            : `${isOfficial ? '已比对基础条件匹配' : '参考条件匹配'}；具体岗位的学历、专业、能力和体检要求还须单独确认。`;
    results.push({ id: `${notice.provinceAdcode}:${notice.batchCode}:${notice.key}`, provinceAdcode: notice.provinceAdcode, provinceName: notice.provinceName, targetName: notice.targetName, grid: notice.grid, operatorScope: notice.grid === 'impc' ? 'mengxi' : 'csg', officialRecruitmentUrl: notice.officialRecruitmentUrl, batchCode: notice.batchCode, batchLabel: recruitmentBatchLabels[notice.batchCode], decision, decisionLabel: !notice.conditions ? '查看单位与岗位' : labels[decision], summary, checks, groups, nextSteps: ['选择具体单位和岗位后，核对该岗位的学历与主修专业要求', '逐项核对证书、体检与其他岗位要求，查看该届报名时间'], ruleScope: !notice.conditions ? 'not_structured' : isOfficial ? 'basic_conditions' : 'reference' });
  }
  if (referenceMode) for (const result of results) {
    result.checks = stableChecks(result.checks);
    result.decision = referenceDecision(result.checks);
    // An official general-education subset and a workbook school-range subset
    // are independent evidence lanes. Do not silently discard the latter, or
    // promote it into an official hard rejection. A discrepancy merits review.
    const supplemental = result.ruleScope === 'basic_conditions' ? result.referenceComparison : undefined;
    if (supplemental) {
      const checks = stableChecks(supplemental.checks);
      const decision = referenceDecision(checks);
      result.referenceComparison = { checks, decision,
        label: decision === 'reference_match' ? `${sourceCohortYear}届补充学校范围匹配` : decision === 'reference_mismatch' ? `${sourceCohortYear}届补充学校范围有差异` : decision === 'missing_input' ? `${sourceCohortYear}届补充学校范围需填写信息` : `${sourceCohortYear}届补充学校范围需确认`,
        summary: `${sourceCohortYear}届补充参考单独比对，不代替单位公告，不决定${targetCohortYear}届资格。` };
      if (result.decision === 'reference_match' && decision !== 'reference_match') result.decision = 'needs_confirmation';
    } else delete result.referenceComparison; // Already the main reference lane.
    result.decisionLabel = result.decision === 'reference_match' ? `${sourceCohortYear}届条件参考匹配` : result.decision === 'reference_mismatch' ? `与${sourceCohortYear}届条件有差异` : labels[result.decision];
    result.summary = result.decision === 'reference_match' ? `与${sourceCohortYear}届已比对条件相符，可优先了解；不是${targetCohortYear}届资格结论。`
      : result.decision === 'reference_mismatch' ? `与${sourceCohortYear}届条件有差异，不等于${targetCohortYear}届不可报。`
        : result.decision === 'missing_input' ? `补充信息后，可继续与${sourceCohortYear}届条件作参考比对。`
          : `${sourceCohortYear}届要求已整理；具体岗位条件需要单独核对。`;
    if (supplemental && result.referenceComparison?.decision !== 'reference_match') result.summary += `另有${sourceCohortYear}届学校范围参考需要单独查看；差异不等于不可报。`;
    result.nextSteps = [`当前参考${sourceCohortYear}届，查看${targetCohortYear}届相应单位和岗位的新要求`, '历史毕业年份、年龄计算日与取证截止时间不参与跨届匹配', '具体专业目录、岗位与体检条件另行核对'];
    result.ruleScope = result.ruleScope === 'not_structured' ? 'not_structured' : 'reference';
  }
  return {
    schemaVersion: '1.4.0', cohortYear: targetCohortYear, targetCohortYear, referenceCohortYear, referenceSelection, sourceCohortYear, comparisonMode: request.comparisonMode ?? 'current', batchCodes,
    coverage: { status: historical ? 'historical_only' as const : referenceMode ? 'reference_only' as const : 'available' as const, ruleCohortYear: sourceCohortYear, availableRuleCohorts },
    notice: referenceMode ? `报考${targetCohortYear}届 · 参考${sourceCohortYear}届。按学历、专业和学校等已收录条件比对；历史毕业、年龄与取证日期不平移，不代表本届网申资格。` : historical ? '正在查看2026届历史条件，不对当前考生作可报或不符合判断。' : '按2026届招聘条件初筛；条件匹配不代表网申通过或录取。',
    summary: historical ? emptySummary : { total: results.length, initialMatch: results.filter(row => row.decision === 'initial_match').length, referenceMatch: results.filter(row => row.decision !== 'not_matched' && (row.decision === 'reference_match' || (!referenceMode && row.referenceComparison?.decision === 'reference_match'))).length, referenceMismatch: results.filter(row => row.decision === 'reference_mismatch' || (!referenceMode && row.referenceComparison?.decision === 'reference_mismatch')).length, notMatched: results.filter(row => row.decision === 'not_matched').length, missingInput: results.filter(row => row.decision === 'missing_input').length, needsConfirmation: results.filter(row => row.decision === 'needs_confirmation').length },
    results: historical ? [] : results,
    // The read-only history projection has no decisions, pass/fail checks,
    // candidate-dependent next steps or supplemental comparison outcomes.
    historicalResults: historical ? results.filter(row => row.groups.length > 0).map(({ id, provinceAdcode, provinceName, targetName, grid, operatorScope, officialRecruitmentUrl, batchCode, batchLabel, groups, ruleScope }) => ({ id, provinceAdcode, provinceName, targetName, grid, operatorScope, ...(officialRecruitmentUrl ? { officialRecruitmentUrl } : {}), batchCode, batchLabel, groups, ruleScope })) : [],
  };
}
