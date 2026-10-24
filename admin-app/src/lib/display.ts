import type { FieldDefinition } from "../types";

// Presentation only: never rewrite stored enums, source text or identifiers.
export const valueLabels: Record<string, string> = {
  sgcc: "国家电网", csg: "南方电网", admin: "管理员", user: "用户", system: "系统", anonymous: "未登录访问者",
  campus: "提前批", batch_1: "第一批", batch_2: "第二批", batch_3: "第三批", csg_spring: "南网春招", csg_autumn: "南网秋招",
  all: "全部", unknown: "未注明", other: "其他", unspecified: "未注明批次", not_applicable: "不适用",
  published: "已发布", draft: "草稿", archived: "已归档", active: "启用", inactive: "停用", enabled: "启用", disabled: "停用",
  available: "已有数据", pending: "需补充", verified: "已核验", reference: "参考资料", conflict: "存在冲突", quarantined: "已隔离",
  derived: "派生值已核对", partially_verified: "部分核验", partially_verified_nonofficial: "非官方参考 · 部分核验",
  pending_separate_count: "需单独统计", verified_name_only: "仅名称已核验", verified_name_location_derived: "名称已核验 · 位置为派生值",
  verified_official_unit: "官方单位已核验", current_official_plus_historical_reference: "当届官方资料 · 含历史参考", official_current_plus_historical_reference: "当届官方资料 · 含历史参考",
  historical_reference_only: "仅历史参考", verified_current_official_mention: "当届公告数值已核验", pending_official_release: "尚未官方发布", pending_official_source_mapping: "需逐项对应官方来源",
  archived_current_official: "当届官方页面已归档", archived_official_attachment: "官方附件已归档", archived_national_official_attachment: "全国官方附件已归档", archived_national_official_page_metadata: "全国官方页信息已归档",
  historical_reference_tier_b: "历史参考已复核", historical_map_checked_tier_c: "历史对应关系已检查", historical_cross_checked_tier_c: "历史资料已交叉检查", validated_after_build: "构建校验通过", source_traced_historical_archive: "历史归档已溯源", internal_snapshot: "内部数据版本",
  lexical_reference: "资料名称地区索引", source_confirmed: "来源明确对应", unlocated: "尚无确认位置",
  success: "成功", denied: "已拒绝", failure: "失败", failed: "失败", invalid: "无效", allowed: "已允许",
  domestic: "中国内地院校", overseas: "境外院校", public: "公办", private: "民办",
  junior_college: "专科", bachelor: "本科", master: "硕士", doctor: "博士", public_institution: "公办院校",
  legacy_985: "原985院校", legacy_211: "原211院校", former_power_ministry: "原电力部直属院校",
  electrical: "电工类", non_electrical: "非电工类", computer: "计算机类", communication: "通信类", electronic_information: "电子信息类",
  artificial_intelligence: "人工智能类", finance: "财务类", human_resources: "人力资源类", law: "法学类", other_engineering: "其他工学",
  national: "全国", province: "省级范围", city: "城市范围", company: "单位范围", unit: "单位范围", school: "学校", parent: "母校合并",
  province_company: "省份及省公司", network_total: "全国电网汇总", special_unit: "直属或特殊单位",
  roster_unit: "录用公示单位", reference_candidate: "招聘参考单位", policy_reference: "政策资料单位",
  public_notice_record_count: "录用公示条数", planned_headcount_raw_mention: "公告招聘名额原值", planned_headcount: "招聘名额",
  public_notice_records: "项录用公示", people: "人", records: "条", entities: "个实体", count: "个", ratio: "占比", regions: "个地区", sections: "个分区", as_provided: "来源原值",
  derived_aggregate: "汇总计算值", official_announcement_mention: "公告所述数值", exact: "精确值", approximate: "约数",
  cohort_school: "按届别与学校汇总", stated_batch_or_scope_total: "来源明确的批次或范围合计", announcement_row_or_subscope: "公告条目或子范围",
  cohort_school_destination: "按届别、学校与去向汇总", province_total: "全省合计", company_total: "单位合计",
  source_not_provided: "来源未提供", pending_verification: "需核验", verified_source: "来源已核验", partial_source: "仅部分来源",
  source_not_provided_pending: "来源尚未提供", not_disclosed: "未披露", not_reviewed: "尚未复核", needs_review: "需人工复核",
  exact_source_label: "已对应来源单位名称", partial_mapping: "仅部分对应", mapped: "已对应", unmapped: "尚未对应",
  official_current: "当届官方资料", current_official: "当届官方资料", historical_reference: "往届参考", reference_only: "仅供参考",
  verified_current_official_excerpt: "当届公告原文已核验", verified_current_official: "当届公告已核验",
  uploaded_reference_unverified: "上传参考资料，未外部核验", pending_reference_verification: "仅供管理员核验", pending_no_business_data: "尚无业务数据",
  current_official_page: "当届官方网页", national_official_page: "全国官方网页", official_attachment: "官方附件", national_official_attachment: "全国官方附件",
  official_page_archive: "官方网页归档", official_school_page: "学校官网", official_school_master: "官方学校名录", official_current_tag_list: "官方现行院校名单",
  official_historical_tag_list: "官方历史院校名单", official_web: "官方网页", uploaded_workbook: "上传表格", provided_nonofficial_image: "上传参考图片",
  provided_public_list_aggregate: "录用公示汇总", provided_aggregate: "上传汇总数据", historical_supplement: "历史补充资料",
  user_material: "上传资料", official_reference: "官方关联参考", roster_aggregate: "录用公示汇总", internal_dataset_snapshot: "内部数据版本",
  source_traced_index: "来源查询目录", source_traced_timeline: "来源时间线", maintenance_template: "维护模板", local_archive: "本地归档",
  education: "学历要求", major: "专业要求", age: "年龄要求", certificate: "证书要求", cohort: "毕业届别", training_mode: "培养方式",
  language_and_computer: "外语与计算机", application_materials: "报名材料", academic_verification: "学籍与学历", overseas_education: "境外学历",
  health: "体检要求", integrity: "品行要求", special_obligation: "岗位与服务约定", student_origin: "学籍与生源", score: "考试分数",
  compensation: "薪酬参考", application: "网申报名", exam: "考试安排", headcount: "招聘与报名数量",
  official_verbatim_excerpt: "官方逐字摘录", official_excerpt: "官方摘录", preference: "优先条件", manual_review: "人工核验条件",
  province_inherited: "省级适用", city_specific: "城市专属", direct: "直接对应",
  admin_only: "仅管理员可见", member: "已授权用户可见", public_aggregate: "公开汇总", image_ocr: "图片文字识别资料",
  true: "是", false: "否", in: "属于以下范围", not_in: "不属于以下范围", eq: "等于", gte: "不低于", lte: "不高于",
  eligible_reference: "符合参考条件", ineligible_reference: "不符合参考条件", manual_confirmation: "需人工确认",
  "Asia/Shanghai": "北京时间", "admin.login": "管理员登录", "admin.logout": "管理员退出",
  "admin.user_created": "开通用户权限", "admin.user_updated": "更新用户权限", "admin.user_password_reset": "重置用户密码",
  "user.create": "开通用户权限", "user.update": "更新用户权限", "user.enable": "启用用户", "user.disable": "停用用户", "user.delete": "移除用户授权", "user.reset_password": "重置用户密码",
  "resource.create": "新建数据", "resource.update": "更新数据", "resource.delete": "删除数据", "data.created": "新建数据", "data.updated": "更新数据", "data.deleted": "删除数据",
};

export const fieldLabels: Record<string, string> = {
  id: "内部编号", name: "名称", title: "标题", text: "内容", description: "说明", note: "说明", notes: "备注", status: "状态", dataStatus: "核验状态",
  sourceStatus: "来源核验状态", publicationStatus: "发布状态", count: "数量", total: "合计", recordCount: "录用公示条数", value: "数值", unit: "单位",
  cohortYear: "招聘届别", year: "年份", batchCode: "批次", batchCounts: "分批汇总", gridCounts: "电网汇总", grid: "电网", version: "版本",
  province: "省份", provinceName: "省份", provinceAdcode: "省级区划编码", city: "城市", cityName: "城市", company: "单位", companyName: "单位名称",
  schoolName: "学校名称", campusName: "校区名称", schoolTier: "院校层次", educationLevel: "办学层次", location: "位置", longitude: "经度", latitude: "纬度",
  sourceKey: "来源编号", sourceKeys: "关联来源编号", sourceType: "来源类型", sourceUrl: "来源链接", publisher: "发布单位", publishedAt: "发布时间",
  createdAt: "建立时间", updatedAt: "更新时间", sha256: "内容校验值", checksumSha256: "内容校验值", datasetKey: "资料集编号", dataset_id: "资料集编号",
  original_requirement_keys: "原始条件编号", official_unit_id: "官方单位编号", province_adcode: "省级区划编码", evidence_locator: "原文位置", sum_safe: "是否可直接加总",
  metadata: "归档与关联信息", payload: "核对摘要", source: "来源信息", visibility: "可见范围", materialKind: "资料类型", category: "内容类别",
  branches: "判定分支", predicates: "对应条件", field: "判断项目", operator: "比较方式", outcome: "结果", reason: "原因", label: "名称", key: "内部标识",
  confidence: "判断依据", eligibilityModel: "筛选规则", degree: "学历", schoolTags: "院校属性", majorCategory: "专业类别", graduationYear: "毕业年份",
  freshGraduate: "应届毕业生", fullTime: "全日制", nationalUnifiedAdmission: "国家统招", cet4OrHigher: "英语四级及以上", cet6OrHigher: "英语六级及以上",
  computerLevel2: "计算机二级", hasFailedCourses: "是否挂科", gradesAcceptable: "成绩合格", schoolNature: "学校性质", educationLocation: "就读地区",
  evidenceAssets: "证据附件", externalEvidence: "外部核验资料", missingFields: "缺失字段", rows: "条目", sourceCount: "来源数量", factCount: "资料数量", outcomeCount: "汇总单元数量",
  aliases: "原名与别名", sources: "关联来源", candidate: "参考单位资料", relatedCampuses: "相关校区", school: "学校资料", geography: "位置资料",
  campusKey: "校区编号", parentSchoolKey: "母校编号", companyKey: "单位编号", schoolCode: "学校代码", rawNames: "来源原名", ownership: "办学性质",
  is985: "原985院校", is211: "原211院校", isDoubleFirst: "双一流院校", kind: "类型", matchStatus: "对应状态", industryTags: "行业标签",
  introduction: "学校介绍", asOf: "资料日期", cityAdcode: "城市区划编码", coordinates: "参考坐标", locationPrecision: "位置精度", coordinateSystem: "坐标体系", address: "地址", locationNote: "位置说明", sourceUrls: "关联链接",
  nationalRecordCount: "全国录用公示条数", destinationProvinceRecordCount: "本省录用公示条数", countBasis: "统计范围", orgCategory: "单位类别", companyGroup: "单位分组",
  destinationCity: "录用城市", candidateStatus: "名录类别", companyCity: "单位城市索引", companyCityAdcode: "单位城市区划编码", cityEvidenceStatus: "城市对应依据",
  schoolCount: "院校数量", policyFactCount: "招聘资料数量", candidateKey: "参考单位编号", companyRegion: "地区索引", entityStatus: "单位对应状态", references: "参考条目",
  factKey: "资料条目编号", applicationCount: "报名人次", metricType: "指标类型", measureUnit: "计量单位", batch_1: "第一批", batch_2: "第二批", batch_3: "第三批", csg_autumn: "南网秋招", csg_spring: "南网春招", sgcc: "国家电网", csg: "南方电网",
};

export const labelForKey = (key: string) => fieldLabels[key] || key.replace(/_/g, " ");
export const rawValue = (value: unknown) => value == null ? "" : typeof value === "object" ? JSON.stringify(value, null, 2) : String(value);
export function displayText(value: unknown, fallback = "未提供", field?: Pick<FieldDefinition, "key" | "options">): string {
  if (value === null || value === undefined || value === "") return fallback;
  const option = field?.options?.find(item => String(item.value) === String(value));
  if (option) return option.label;
  if (field?.key === 'locationPrecision') return ({ campus: '校园代表点', city: '城市参考点', province: '省级范围参考点', unlocated: '尚无确认位置' } as Record<string,string>)[String(value)] || String(value);
  if (field?.key === 'view') return ({ campus: '校区明细', parent: '母校合并' } as Record<string,string>)[String(value)] || String(value);
  if (field?.key === 'visibility') return ({ public: '公开可见', private: '仅内部可见', admin_only: '仅管理员可见' } as Record<string,string>)[String(value)] || valueLabels[String(value)] || String(value);
  if (field && /(?:Year|year)$/.test(field.key)) return String(value);
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "number") return Number.isFinite(value) ? value.toLocaleString("zh-CN", { maximumFractionDigits: 20 }) : fallback;
  if (Array.isArray(value)) return value.length ? value.map(item => displayText(item)).join("、") : "暂无条目";
  if (typeof value === "object") return `${Object.keys(value).length} 项详细信息`;
  return valueLabels[String(value)] || String(value);
}

export function dateText(value: unknown): string {
  if (value === null || value === undefined || value === "") return "未提供";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return displayText(value);
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

export const fieldGroup = (field: FieldDefinition) => {
  if (field.kind === 'json' || /^(metadata|payload|eligibilityModel|missingFields|externalEvidence|evidenceAssets)$/.test(field.key) || /(?:Id|Key|Keys|Hash|Sha256|Path)$/.test(field.key)) return "关联与技术信息";
  if (/source|evidence|publication|status|revision/i.test(field.key) || /(?:notes|otherNotes)$/.test(field.key)) return "发布、来源与核验";
  if (/count|metric|value|batch[123]|discipline|major|destination|scope|privacy|suppres|zeroConfirmed/i.test(field.key)) return "统计与适用范围";
  return "基本信息与业务内容";
};
export function groupFields(fields: FieldDefinition[]) {
  return ["基本信息与业务内容", "统计与适用范围", "发布、来源与核验", "关联与技术信息"]
    .map(label => ({ label, fields: fields.filter(field => fieldGroup(field) === label) })).filter(group => group.fields.length);
}
export const hasEncodingIssue = (value: unknown) => /\uFFFD/.test(rawValue(value));
