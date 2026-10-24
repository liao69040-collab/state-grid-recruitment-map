/** Reviewed 2026 recruitment notices, not inferred from provincial statistics.
 * Direct bodies were read from CSG's public announcement detail + notice APIs.
 * SHA is the UTF-8 notice HTML body (university mirrors: whole response HTML).
 * A notice's common conditions never certify a particular job or another unit.
 * No runtime crawl, credentials, applicant data or opaque access token is used.
 */
export type NativeBatchCode = 'csg_autumn' | 'csg_spring' | 'csg_campus' | 'impc_campus';
export type NativeNotice = {
  key: string; provinceAdcode: string; provinceName: string; targetName: string;
  grid: 'csg' | 'impc'; batchCode: NativeBatchCode; cohortYear: 2026;
  sourceKind: 'official_direct' | 'university_notice' | 'directory';
  sourceUrl: string; officialRecruitmentUrl: string; bodySha256?: string;
  reviewedAt: string; title: string; positions: string[]; scopeNote?: string;
  conditions?: {
    domesticCohort: '2026' | 'fresh'; careerWindowException?: boolean;
    socialInsurance?: 'employer' | 'any'; overseasDoctorDecember: boolean;
    overseasBachelor?: boolean; minimumAge?: number;
    invitedSchoolsOnly?: boolean;
  };
  notes?: string[];
};
const officialRoot = 'https://zhaopin.csg.cn/';
const notice = (id: string, provinceAdcode: string, provinceName: string, batchCode: 'csg_autumn' | 'csg_spring', bodySha256: string, conditions: NonNullable<NativeNotice['conditions']>, positions: string[]): NativeNotice => ({
  key: `csg-2026:${id}`, provinceAdcode, provinceName, targetName: `${provinceName}电网有限责任公司`, grid: 'csg', batchCode, cohortYear: 2026,
  sourceKind: 'official_direct', sourceUrl: `${officialRoot}recruitment-dmz/service/announcement/loadDetailById/${id}`,
  officialRecruitmentUrl: officialRoot, bodySha256, reviewedAt: '2026-09-23',
  title: `${provinceName}电网有限责任公司2026年${batchCode === 'csg_spring' ? '春季' : ''}校园招聘公告`, conditions, positions,
  ...(provinceAdcode === '440000' ? { scopeNote: '广东电网所属单位（不含深圳供电局）；深圳招聘条件须单独核对。' } : {}),
});

export const nativeReviewed2026Notices: readonly NativeNotice[] = [
  notice('CEE39465C06044799241515E76B43C80', '530000', '云南', 'csg_autumn', '08431d03ab3418edba068cfe2e719638a176ec37a5a1d5cb3f6fe9e42f15ccd5',
    { domesticCohort: '2026', overseasDoctorDecember: false }, ['电气、信息通信、安全、规划基建、环化材料、机械测控、发电、配电及经营管理岗位']),
  notice('93A84F99742B4E289E46751D92769906', '530000', '云南', 'csg_spring', '62bfb9b065c13e0d4449da39207e4b1cbd1f6a842b237d338c89af4fbf3790e2',
    { domesticCohort: '2026', overseasDoctorDecember: true }, ['电气、信息通信、安全、规划基建、环化材料、机械测控、发电、经济财会岗位']),
  notice('93262B9FFDBD443992102B2C5CCEC075', '440000', '广东', 'csg_autumn', 'fc062121f4776f53eaadf7e5df5449753bb82e5a78924e621cfe6f92f05742e6',
    { domesticCohort: 'fresh', careerWindowException: true, socialInsurance: 'any', overseasDoctorDecember: true }, ['电力生产类及经营管理类岗位；不同岗位分别规定学历与专业']),
  notice('0ABD3B36814D4F7BADBE88B29B768DC6', '440000', '广东', 'csg_spring', '8348cd6d27312da215565f3eecee91c99bd6c8c6cfdc64ab1b6380eef09c622b',
    { domesticCohort: 'fresh', careerWindowException: true, socialInsurance: 'any', overseasDoctorDecember: true }, ['电气类业务、机械测控业务']),
  notice('E43936953A9F4C5E9DDD8C55C54BAE61', '520000', '贵州', 'csg_spring', '87e178e4af575ad3f34436940e58c142f9a4d368141442fc543619ede93cce75',
    { domesticCohort: '2026', socialInsurance: 'employer', overseasDoctorDecember: true }, ['电气类、信息通信、规划基建等岗位']),
  notice('28F053D7589A4742862CF642075DE3C1', '450000', '广西', 'csg_spring', '4f5a7eeae0d4274149c3c61c3ca894e9cd5d6f7c91d1d7e31332dfae5ef91669',
    { domesticCohort: '2026', careerWindowException: true, socialInsurance: 'employer', overseasDoctorDecember: true }, ['电气类业务、机械测控业务']),
  notice('3E0C17C1EA264634A9E12DE2B28BEA05', '460000', '海南', 'csg_autumn', '9da61d79fc67bd90d5f206631656d6578aa5add9fdaffeb3be9adffea56e0d4b',
    { domesticCohort: '2026', socialInsurance: 'employer', overseasDoctorDecember: true, minimumAge: 18 }, ['电气、发电、信息通信、规划基建、供应链、机械测控、环化材料、安全及经营管理岗位']),
  {
    key: 'csg-2026:guizhou-autumn-university', provinceAdcode: '520000', provinceName: '贵州', targetName: '贵州电网有限责任公司', grid: 'csg', batchCode: 'csg_autumn', cohortYear: 2026,
    sourceKind: 'university_notice', sourceUrl: 'https://dsjyj.gufe.edu.cn/info/1371/5552.htm', officialRecruitmentUrl: officialRoot,
    bodySha256: '8e9df89030a39e16f184bf5fe3a535b991f4bd94a5ab242416fdae10c0438ec2', reviewedAt: '2026-09-23', title: '贵州电网有限责任公司2026年校园招聘公告',
    conditions: { domesticCohort: '2026', socialInsurance: 'employer', overseasDoctorDecember: true },
    positions: ['电气、信息通信、规划基建、机械测控、环化材料、经济财会、法律等岗位'],
  },
  {
    key: 'csg-2026:guangxi-autumn-university', provinceAdcode: '450000', provinceName: '广西', targetName: '广西电网有限责任公司', grid: 'csg', batchCode: 'csg_autumn', cohortYear: 2026,
    sourceKind: 'university_notice', sourceUrl: 'https://career.hebut.edu.cn/correcruit/content/id/75446.html', officialRecruitmentUrl: officialRoot,
    bodySha256: 'f6c1b2356ef51434b2671ec30704a85e873d3b101069ec27524950574b27cbf6', reviewedAt: '2026-09-23', title: '广西电网有限责任公司2026年校园招聘公告',
    conditions: { domesticCohort: 'fresh', careerWindowException: true, socialInsurance: 'employer', overseasDoctorDecember: true, overseasBachelor: true },
    positions: ['电气、信息通信、规划基建、供应链、机械测控、行政、人力资源、经济财会、法律岗位'],
  },
  {
    key: 'csg-2026:hainan-spring-directory', provinceAdcode: '460000', provinceName: '海南', targetName: '海南电网有限责任公司', grid: 'csg', batchCode: 'csg_spring', cohortYear: 2026,
    sourceKind: 'university_notice', sourceUrl: 'https://jy.htu.edu.cn/detail/news?id=1766368', officialRecruitmentUrl: officialRoot,
    bodySha256: '841034e0c9e1cc1d64a2feda454531ac897e66421248067fa015fa46a2fbca24', reviewedAt: '2026-09-23', title: '海南电网有限责任公司2026年春季校园招聘公告',
    positions: ['电气类业务、发电业务、信息通信业务、规划基建业务、机械测控业务'],
    notes: ['招聘单位包括所属市县供电局、专业公司和直属机构。', '已找到春招岗位目录；具体学历、专业及其他报名要求需在所选岗位中查看。'],
  },
  {
    key: 'csg-2026:guangdong-campus-directory', provinceAdcode: '440000', provinceName: '广东', targetName: '广东电网有限责任公司', grid: 'csg', batchCode: 'csg_campus', cohortYear: 2026,
    sourceKind: 'university_notice', sourceUrl: 'https://jy.ncu.edu.cn/detail/job?id=2605559', officialRecruitmentUrl: officialRoot,
    bodySha256: '54f77ed76a8f45c82f2385344aad0f4d4b9c564052e339d2ed7b6fcfb90ca8d7', reviewedAt: '2026-09-23', title: '广东电网有限责任公司2026年校园招聘提前批',
    positions: ['电气、信息通信、经济财会、法律、人力资源、国际业务等岗位'],
    notes: ['提前批主要面向已收到公司函件或已发布招聘通知的高校毕业生；其他高校可参加后续招聘。', '须核对本人所在学校是否在该批次通知范围内，不能根据院校标签自动认定。', '一般须在报到当年8月底前取得认证学历、学位，博士可至12月；就读期间及毕业后须无国内社保缴费记录。'],
    scopeNote: '广东电网所属单位（不含深圳供电局）；提前批与秋招、春招分别核对。',
  },
  {
    key: 'impc-2026:campus-directory', provinceAdcode: '150000', provinceName: '内蒙古', targetName: '内蒙古电力（集团）有限责任公司（蒙西）', grid: 'impc', batchCode: 'impc_campus', cohortYear: 2026,
    sourceKind: 'directory', sourceUrl: 'https://zhaopin.impc.com.cn/', officialRecruitmentUrl: 'https://zhaopin.impc.com.cn/', reviewedAt: '2026-09-23', title: '内蒙古电力校园招聘入口', positions: [],
    notes: ['蒙西由内蒙古电力集团组织招聘，与国家电网蒙东招聘单位、批次和条件分别核对。', '可进入招聘平台查看单位和岗位；不套用蒙东或其他省份的报名条件。'],
  },
];
