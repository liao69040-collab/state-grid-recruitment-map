import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dist = join(root, "dist");
const source = join(root, "src");
const failures = [];

const assert = (condition, message) => {
  if (!condition) failures.push(message);
};

const walk = (directory) => readdirSync(directory).flatMap((name) => {
  const file = join(directory, name);
  return statSync(file).isDirectory() ? walk(file) : [file];
});

assert(existsSync(join(dist, "index.html")), "dist/index.html 不存在，请先运行 npm run build");

const sourceFiles = walk(source).filter((file) => /\.(ts|vue)$/.test(file));
const allSource = sourceFiles.map((file) => readFileSync(file, "utf8")).join("\n");

[
  "/admin/auth/login",
  "/admin/auth/me",
  "/admin/auth/logout",
  "/admin/dashboard",
  "/admin/users",
  "/admin/provinces",
  "/admin/cities",
  "/admin/schools",
  "/admin/companies",
  "/admin/recruitment-batches",
  "/admin/recruitment-events",
  "/admin/recruitment-metrics",
  "/admin/early-batch-policies",
  "/admin/sources",
  "/admin/revisions",
  "/admin/audit-events",
].forEach((endpoint) => assert(allSource.includes(endpoint), `缺少 API contract：${endpoint}`));

assert(allSource.includes('credentials: "include"'), "API 请求未启用 credentials: include");
assert(allSource.includes('headers.set("X-CSRF-Token"'), "管理写请求未设置 X-CSRF-Token");
assert(!/localStorage\.(setItem|getItem)\([^)]*(password|csrf|session)/i.test(allSource), "敏感会话信息不应写入 localStorage");
assert(!/(admin|root)[-_ ]?(password|token)\s*[:=]\s*["'][^"']{8,}["']/i.test(allSource), "疑似硬编码管理员凭据");
assert(allSource.includes("@element-plus/icons-vue"), "可见图标必须使用 @element-plus/icons-vue");
assert(!/>\s*(人|锁|省|市|校|网|数|源|版|审|↻|!|∅|×|⌕|→|↗|✓|\?|＋)\s*</.test(allSource), "发现文字字形充当图标");

for (const field of ["createdAt", "action", "actorType", "actorId", "outcome", "requestId", "ipHash", "userAgentHash"]) {
  assert(allSource.includes(`key: "${field}"`), `审计日志缺少实际响应字段映射：${field}`);
}

const dashboardSource = readFileSync(join(source, "views", "DashboardView.vue"), "utf8");
assert(
  dashboardSource.includes('readList("/admin/audit-events", 6)'),
  "管理总览必须从审计列表接口读取最近后台操作，不能把 dashboard 汇总对象当作事件数组",
);

const usersSource = readFileSync(join(source, "views", "UsersView.vue"), "utf8");
assert(usersSource.includes('const DEFAULT_USER_PASSWORD = "12345678"'), "普通授权用户默认密码必须固定为 12345678");
assert(!usersSource.includes('v-model="createForm.password"'), "授权手机号时不应要求管理员手输初始密码");
assert(!usersSource.includes('v-model="resetForm.password"'), "重置密码时不应要求管理员手输新密码");
assert(!usersSource.includes('password: DEFAULT_USER_PASSWORD'), "默认密码应由服务端统一应用，后台请求不应重复传入明文密码");

const resourcesSource = readFileSync(join(source, "config", "resources.ts"), "utf8");
const resourceViewSource = readFileSync(join(source, "views", "ResourceView.vue"), "utf8");
const entityDialogSource = readFileSync(join(source, "components", "EntityDialog.vue"), "utf8");
assert(resourcesSource.includes('value: "pending_reference_verification"'), "来源管理缺少仅管理员待核筛选");
assert(!resourcesSource.includes('label: "官方正文纯文本"'), "用户汇编/OCR不能一律标成官方正文");
assert(resourceViewSource.includes('currentResource.endpoint}/${encodeURIComponent(String(id))}'), "来源编辑/查看应按ID请求完整详情");
assert(resourceViewSource.includes('generation !== detailGeneration'), "来源详情应阻断换页后过期响应");
assert(resourceViewSource.includes('const detail = detailPayload?.item;'), "来源详情必须解包API的item，不能把响应包装对象当记录");
assert(resourceViewSource.includes('String(itemId(detail) ?? "") !== String(id)'), "来源详情ID必须匹配所请求记录，防止编辑错用POST");
assert(resourceViewSource.includes('viewingOnly.value) return'), "只读来源查看不能保存");
assert(resourceViewSource.includes('/admin/sources/${encodeURIComponent(String(editingItem.value.id))}/asset'), "原图必须通过管理员鉴权端点读取");
assert(!resourceViewSource.includes('metadata.sourceAssetUrl'), "后台不得直接展示未经验证的原始下载URL");
assert(entityDialogSource.includes('if (props.readonly) return'), "只读弹窗提交必须被阻止");
assert(entityDialogSource.includes('v-if="!readonly" type="submit"'), "只读弹窗不得展示保存按钮");
assert(entityDialogSource.includes('@error="previewError = true"'), "原图不可用须显示明确状态");
const recruitmentEventSource = resourcesSource.match(
  /\n  \{\n    key: "recruitment-events",[\s\S]*?\n  \},\n  \{\n    key: "recruitment-requirements",/,
)?.[0] || "";
const recruitmentRequirementSource = resourcesSource.match(
  /\n  \{\n    key: "recruitment-requirements",[\s\S]*?\n  \},\n  \{\n    key: "recruitment-metrics",/,
)?.[0] || "";
const earlyBatchPolicySource = resourcesSource.match(
  /\n  \{\n    key: "early-batch-policies",[\s\S]*?\n  \},\n  \{\n    key: "sources",/,
)?.[0] || "";
assert(earlyBatchPolicySource, "后台缺少资源 key early-batch-policies");
assert(
  earlyBatchPolicySource.includes('endpoint: "/admin/early-batch-policies"'),
  "提前批政策资源 endpoint 不正确",
);
for (const field of [
  "policyKey",
  "cohortYear",
  "batchCode",
  "targetKind",
  "targetCode",
  "targetName",
  "recruitmentRequirements",
  "eligibilityModel",
  "sourceLocator",
  "sourceStatus",
  "sourceDocumentId",
  "revisionId",
  "publicationStatus",
]) {
  assert(
    earlyBatchPolicySource.includes(`key: "${field}"`),
    `提前批政策缺少必要字段 ${field}`,
  );
}
for (const field of ["eligibilityModel", "missingFields", "evidenceAssets", "externalEvidence", "metadata"]) {
  assert(
    new RegExp(`key: "${field}"[^\\n]*kind: "json"`).test(earlyBatchPolicySource),
    `提前批政策字段 ${field} 必须使用 JSON 编辑器`,
  );
}
assert(
  dashboardSource.includes('key: "early-batch-policies"')
    && dashboardSource.includes('path: "/data/early-batch-policies"'),
  "管理总览缺少提前批政策卡片",
);
assert(
  resourceViewSource.includes("Number.isFinite(numeric)"),
  "数字格式化必须保留 <5 等隐私展示值，不能渲染成 NaN",
);
assert(resourceViewSource.includes("slice(0, 18)"), "管理表不得在12列前截断来源回查字段");
for (const field of ["sourceTitle", "sourcePublisher", "sourcePublishedAt", "sourceOfficialUrl"]) {
  assert(resourcesSource.includes(`key: "${field}"`), `时间线/要求管理缺少来源回查字段 ${field}`);
}
assert(resourceViewSource.includes("option.parentValue === parentValue"), "单位和城市下拉必须随省份级联动");
assert(resourceViewSource.includes("limit: 200"), "动态单位下拉不得被100条截断");
assert(recruitmentEventSource, "后台缺少考试与网申时间线资源");
assert(
  recruitmentEventSource.includes('hierarchySteps: ["省份", "省级公司/单位", "批次", "时间节点"]'),
  "时间线必须明确省份到节点的四级层级",
);
assert(recruitmentEventSource.includes('groupSeparator: " → "'), "时间线分组必须按业务层级展示");
assert(recruitmentEventSource.includes('countNoun: "来源级节点"'), "时间线数量必须注明来源级节点口径");
assert(recruitmentEventSource.includes('emptyLabel: "待官方补充"'), "时间线缺失日期必须显示待官方补充");
assert(recruitmentEventSource.includes('format: "eventTimeline"'), "时间线必须合并显示官方时间语义");
assert(resourceViewSource.includes("仅公布截止/结束"), "仅公布截止日的节点不得误显示为普通缺日期");
assert(resourceViewSource.includes("官方未披露精确日期"), "未披露日期的节点必须显示明确语义");
assert(recruitmentEventSource.includes('format: "eventType"'), "时间线节点类型必须启用中文显示格式");
assert(
  resourceViewSource.includes('if (format === "eventType") return "其他招聘节点（待归类）"'),
  "未知节点类型不得直接显示英文编码",
);
assert(recruitmentRequirementSource, "后台缺少招聘要求与材料资源");
assert(
  recruitmentRequirementSource.includes(
    'hierarchySteps: ["省份", "省级公司/单位", "批次", "要求类别", "官方原文证据"]',
  ),
  "招聘要求必须明确省份到官方原文证据的五级层级",
);
assert(
  recruitmentRequirementSource.includes(
    'groupBy: ["provinceName", "companyName", "batchCode", "category"]',
  ),
  "招聘要求必须按省份、单位、批次和类别分组",
);
assert(recruitmentRequirementSource.includes('countNoun: "去重证据组"'), "招聘要求数量必须注明去重证据组口径");
for (const batchCode of ["campus", "batch_1", "batch_2", "batch_3", "all", "not_applicable"]) {
  assert(resourcesSource.includes(`value: "${batchCode}"`), `后台缺少 canonical 批次编码 ${batchCode}`);
}
for (const field of [
  "metricKey",
  "valueKind",
  "aggregationGrain",
  "disciplineEvidenceStatus",
  "majorEvidenceStatus",
  "isApproximate",
  "subjectScope",
  "suppressedRange",
  "suppressionReason",
  "zeroConfirmed",
  "sourceKeys",
]) {
  assert(resourcesSource.includes(`key: "${field}"`), `招聘指标缺少口径字段 ${field}`);
}
for (const field of [
  "nationalGridRecordCount",
  "hubeiGridRecordCount",
  "hubeiBatch1RecordCount",
  "hubeiBatch2RecordCount",
  "hubeiBatch3RecordCount",
  "hubeiDisciplineEvidenceStatus",
  "hubeiMajorCategories",
  "hubeiMajorEvidenceStatus",
  "majorBreakdownStatus",
]) {
  assert(resourcesSource.includes(`key: "${field}"`), `学校列表缺少新口径对账列 ${field}`);
}
assert(resourcesSource.includes("湖北第一批（公示记录）"), "学校分批列必须同时标明去向和公示记录口径");
assert(resourcesSource.includes("全国国网（公示记录）"), "学校列表必须与国网湖北口径分开显示全国口径");
assert(!resourcesSource.includes("录用统计请在招聘指标中"), "学校公示统计不得误称录用统计");
assert(resourcesSource.includes("学校主数据核验"), "学校表核验状态必须明确仅指学校主数据");
assert(resourcesSource.includes("源数据未提供·待补"), "专业数据缺口必须显式标记为源数据未提供·待补");
assert(resourcesSource.includes("不得根据学校性质或专业目录推测入网专业"), "招聘指标必须保留专业证据边界提示");
assert(resourcesSource.includes('value: "public_notice_records"'), "公示记录单位必须使用 public_notice_records");
assert(!resourcesSource.includes('value: "first"'), "不得使用旧批次编码 first");
assert(!resourcesSource.includes('value: "second"'), "不得使用旧批次编码 second");
assert(!resourcesSource.includes('value: "third"'), "不得使用旧批次编码 third");

for (const sourceField of ["sourceType", "sourceEvidenceTier", "sourcePrivacyBoundary", "status"]) {
  assert(
    resourcesSource.includes(`key: "${sourceField}"`),
    `来源文档缺少可见的来源/证据/隐私字段 ${sourceField}`,
  );
}
for (const tier of ["A", "B", "C", "D"]) {
  assert(resourcesSource.includes(`value: "${tier}"`), `招聘要求缺少证据层级 ${tier}`);
}
assert(resourcesSource.includes("所有 2026 来源不得改标其他届别"), "来源文档必须明确 2026 不得改标其他届别");
assert(resourcesSource.includes("技术发布状态") && resourcesSource.includes("事实核验状态"), "更新记录必须分开技术发布与事实核验状态");
assert(resourceViewSource.includes("仅聚合公开｜个人字段禁出"), "来源列表必须显示 C 级聚合数据的隐私边界");
assert(resourceViewSource.includes("待官方发布"), "后台状态必须识别未发布事实");

if (failures.length) {
  console.error("Admin app smoke failed:\n- " + failures.join("\n- "));
  process.exit(1);
}

console.log(`Admin app smoke passed (${sourceFiles.length} source files checked).`);
