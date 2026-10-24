# 绿色手机资料页

本模块是现有 Vue 项目的真实竖屏页面，不是手机模型、截图或原 HTML iframe。地图继续使用其既有横屏画布。

## 入口

- `/#/information?tab=batches`：批次总览。
- `/#/information?tab=regions&province=湖北省&city=武汉`：地区与城市资料。
- `/#/information?tab=schools&province=广东省`：按招聘目的省筛选的全国院校榜。
- `GridInformationPortal.vue` 仅保留兼容包装，所有内容仍由同一个绿色界面承载，不再有原页 / 数据库双 pane。

地图内入口由 `src/services/information-navigation.ts` 触发 `grid-information-open`：桌面使用 `GridInformationModalHost.vue` 的顶层 Teleport 弹窗，地图路由与缩放状态不变；直接访问 `/#/information` 仍为独立阅读页。触屏桌面画布通过限定同源的 `postMessage` 请求真实 viewport 父宿主打开阅读层，由 `public/map-touch-host.js` 管理；关闭返回原地图，不能在 1920px 缩放画布内显示小字。

桌面弹窗有背景 inert、键盘焦点约束、Escape 关闭、关闭后焦点恢复。独立阅读 iframe 的 URL 标记 `__information_modal=1`，返回地图按钮发送 `grid-information-close`，由父宿主验证同源与发送 frame 后关闭。页面沿用认证会话；退出、失效及过期响应都会清空已加载私有数据。资料不写入浏览器持久存储。

## 数据

1. `private/grid-aggregates/information`：精确匿名聚合批次指标、地区目录及参考指标。
2. `private/grid-information/provinces/:adcode`：当届提前批完整要求、其余批次、未分批及历史资料。
3. `private/grid-query/facets|facts`、`private/grid-aggregates/rankings`：筛选目录、信息检索与精确院校排名；每页 20 项，翻页复用已提交条件。
4. `private/grid-aggregates/schools/:campusKey|companies/:companyKey`：独立校区、公司和五批次明细。母校排名使用后端 `campusKeys`，不按名称猜关联。

招聘名额、录用公示、报名人次与竞争指标分别保留原计量单位、年份和范围。`displayValue` 可以表达多个不可相加范围；不能把 `value=null` 改成零。录用公示只接受 `complete_anonymous_aggregates` 精确指标，不展示旧阈值下限，不改叫去重人数或最终入职人数。详情按届次、电网及批次展示，不继承榜单的院校层次 / 公司类别过滤；明确指定届别的榜单沿用该届，跨年榜单详情单列当前报考届别的上一届，不混加多届。

2026-10-04现行规则：报考届别与资料届别分开，`referenceCohortYear` 对支持的报考届别使用已审核的参考映射。2027、2028 报考读取当前完整的 2026，2026 报考读取 2025；过滤器初始化、重置、统计、省份条件、院校/公司详情和独立手机路由均传递该参考届别。切换时同步取消旧请求、清空已展示资料，再加载新届，绝不将其他届数据冒充所选参考届；未来目标按明确配置使用最近完整参考届，不能简单推成 Y-1。`referenceDataAvailable` 表示该届有可见资料；`rosterDataAvailable` 专门表示有录用聚合。只有条件资料没有录用数据时仍展示条件，不显示虚假的 0 录用卡、旧学校目录校数或跨届总数。本人毕业年独立于报考届别，不随切换改写。回归入口：`scripts/validate-reference-year-20260927.mjs`。

2026-09-23 调整：省份先选有内容的批次，内容按「报考条件 / 招聘与报名 / 考试分数 / 时间与流程 / 经验参考 / 薪酬待遇 / 其他信息」归类。一组共用一个卡片，条目默认显示标题、实际年份/范围和最多三条短摘要，展开完整内容；省份页底部提供条件检索入口，不重复展开另一份全量列表。校招经历、单位竞争与主观择校说法单列经验参考，不当作报名门槛；混合经验的段落也归入经验组。提前批上传规则按字段呈现条件、流程、考核、名额和录用数量。历史/未注明年份单独显示，不改写成 2026 政策。

只对相同年份、电网、批次、地区、公司、范围、学历与正文的展示重复去重；剔除已知导入器附加说明后，主题索引仅在同一范围完整正文中包含其全部文字时隐藏，否则保留，分类不同但文字相同的索引合并。原始 0/1 机器标记不当作阅读条目。原始数组不修改，不跨年/批次合并，不求和不同人数指标。

`information-display.ts` 只放展示词汇与纯函数，不含私有事实。公开副本使用项目品牌；联系方式由 `VITE_PROJECT_CONTACT` 可选配置，默认留空且不显示联系入口。按用户要求从前台阅读页去除 Excel 文件名、证据定位、数据库/HTML 技术标签与重复的原文说明；源数据、API 元数据及后台审计未删除，也不将参考材料标成官方确定政策。

头部纯闪电复用用户原 HTML 的现有单路径图标（原文件第 409 行），仅保存无脚本几何至 `src/assets/icons/information-lightning.svg`；其余图标沿用 Element Plus。

## 回归

运行 `node --experimental-strip-types --test src/views/information/information-display.test.mjs src/views/information/information-entity.test.mjs`（16 项通过）、`node --experimental-strip-types scripts/validate-mobile-information.mjs` 与 `npm run type-check`（均通过）。新增测试覆盖分组、去重边界、导入说明清理、经验与条件隔离、计量单位、桌面弹窗事件、触屏顶层阅读请求与关闭接口、地区入口覆盖、无名册不伪造零校区；现有测试覆盖空值 / 下限、查询分页、API 认证/失效/中止行为。

视觉验收由主任务通过 CUA 执行并写入项目 `design-qa.md`；本模块的代码检查不代替浏览器或手机实机验证。首轮 390×844 已反馈并修复单位换行、过高卡片、默认展开历史材料和提前批主条件位置问题；须以主任务复测截图为最终视觉证据。
