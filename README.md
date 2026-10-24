# Hengzhen Grid Atlas · 衡真电网招聘图谱

**把电网招聘的地区、学校、批次和报考条件，放进一张可以探索的地图。**

面向学生、家长、教育工作者和开发者的电网招聘信息可视化项目。提供桌面地图、手机查询页和独立管理端，支持国网与南网的分批次统计、学校排名、地域去向和条件参考匹配。

[English](README.en.md) · [在线产品](https://ai-education.cn/) · [快速开始](#快速开始) · [架构](docs/architecture.md) · [数据模型](docs/data-model.md) · [版本记录](CHANGELOG.md)

> 这是衡真教育维护的独立信息工具，与国家电网、南方电网不存在官方隶属或授权背书关系。公开仓库提供应用源码和明确标记的合成演示数据；线上服务的真实业务资料、会员数据与权限不随源码开放。

## 界面预览

以下截图来自本地合成演示，学校与录用数字均为虚构。

![Desktop map and rankings](docs/images/desktop-demo.png)

<details>
<summary>Mobile · 手机查询</summary>

<img src="docs/images/mobile-demo.png" alt="Synthetic mobile query demo" width="390" />

</details>

## 你可以用它做什么

| 需求 | 对应功能 |
|---|---|
| 看全国电网招聘分布 | 全国与省级地图、地区与电网筛选、国网一/二/三批和南网秋/春招统计 |
| 查学校进入电网的去向 | 全国前 200 学校滚动榜、全部学校表、学校与校区明细 |
| 看某省的招聘来源 | 全国高校进入该省电网的排名 |
| 看某省高校的全国去向 | 该省高校进入全国电网的排名，按校区所在地统计 |
| 按个人条件找方向 | 学历、专业、学校等条件参考匹配，区分匹配、待确认与不符合 |
| 手机上快速查询 | 搜索优先的录用查询、我能报哪、报考指南与逐级详情 |
| 维护一套可追溯的数据 | 独立后台、来源记录、年份与批次边界、API 权限控制 |

学校名称旁可展示已录入的办学性质、学校层次、校史标签；高考分数按招生省份、年份、科类、专业和指标分别呈现。没有依据的信息保留缺失状态。

## 两种省份排名，回答两个不同的问题

| 模式 | 选择湖北时的含义 | 学校范围 | 录用去向范围 |
|---|---|---|---|
| 全国高校 → 湖北电网 | 哪些学校的毕业生进入了湖北的电网单位？ | 全国 | 湖北 |
| 湖北高校 → 全国电网 | 湖北的学校有多少毕业生进入全国电网？ | 湖北学校/校区 | 全国 |

两种排名都能继续看电网和批次。学校所在地与招聘单位所在地独立存储；同一大学的异地校区分别识别，所在地未知的校区不会被猜测分配到某省。

## 快速开始

需要 **Node.js 24.x** 和 npm。演示模式使用内存数据，不需要安装 PostgreSQL。

```bash
git clone https://github.com/liao69040-collab/hengzhen-grid-atlas.git
cd hengzhen-grid-atlas
npm ci
npm ci --prefix platform/api
npm ci --prefix admin-app
npm run demo
```

启动后打开：

| 页面 | 本地地址 |
|---|---|
| 桌面地图 | http://127.0.0.1:8112/#/index?view=desktop |
| 手机查询 | http://127.0.0.1:8112/#/mobile |
| 管理端 | http://127.0.0.1:4174/ |

**以下仅是本地合成演示账号，不能登录线上产品：**

| 身份 | 账号 | 密码 |
|---|---|---|
| 演示会员 | `13800138000` | `GridAtlasDemo123!` |
| 演示管理员 | `demo-admin` | `GridAtlasDemo123!` |

演示包含 240 所虚构学校、三个省份与五个招聘批次，用来体验地图、前 200 榜单、双向省份排名和学校明细。数据与账号在重启后重置；演示进程只监听本机，并拒绝在 production 模式下运行。它不附带真实高考分数、完整省份报考条件或招聘原文；这些功能需要接入有来源的授权资料。演示学校和数值不得用作真实报考依据。更多说明见 [demo/README.md](demo/README.md)。

## 技术与目录

```text
src/                    Vue 3 + TypeScript 前台与手机页面
admin-app/              独立 Vue 管理端
platform/api/           Fastify API、Drizzle 数据层与数据库迁移
demo/                   合成演示数据与本地 API 入口
public/                 可公开的前端静态资源
scripts/                演示启动与校验工具
deploy/example/         通用部署示例
docs/                   架构、数据边界和版本维护说明
```

前端采用 Vue 3、Vite、TypeScript、ECharts；API 使用 Fastify、Zod、Drizzle ORM，持久化部署使用 PostgreSQL。前台、后台与 API 可分别构建。详见[架构说明](docs/architecture.md)。

## 开发与验证

```bash
# 合成演示合同
npm run test:demo

# 前台
npm run type-check
npm run build

# API
npm --prefix platform/api run typecheck
npm --prefix platform/api run build

# 管理端
npm --prefix admin-app run typecheck
npm --prefix admin-app run build
```

公开包的检查结果以该版本的 Release 与 CI 为准。源码项目的历史生产验收不能替代本次克隆后的本地运行检查。实体 iPhone/微信的边缘手势、连续交互性能及不同设备的布局仍需要实际设备验证。

## 数据与使用边界

- **软件和数据分开发布。** 本仓库没有生产数据库、个人名册、真实用户账号、会话、访问令牌或原始受限资料；自行部署需接入自己有权使用的数据。
- **报名、计划、公示和入职是不同指标。** 比率只能由同一年、批次、单位与范围下可比较的数据计算，不能把公示记录数直接解释为录取概率。
- **历史参考与当届资格分开。** 历史资料不会自动平移为下一届条件；报考要求以对应招聘主体的当届公告及资格审查为准。
- **缺失信息不补造。** 学校属性、考试地点、分数线等绑定来源与适用范围。未知、待核实和不适用分别处理。
- **地图与图片保留各自来源。** 软件许可证不代替地图、照片、标识或其他第三方内容的许可。

数据字段与接入约定见[数据模型](docs/data-model.md)。

## 参与维护

欢迎提交可复现的问题、地图与移动端体验改进、数据模型建议和有来源的纠错。先阅读 [CONTRIBUTING.md](CONTRIBUTING.md)，再选择 Issue 模板或提交 Pull Request。安全漏洞按 [SECURITY.md](SECURITY.md) 处理。请勿在公开 Issue、截图或附件中发送个人信息、账号密码、数据库导出或尚未公开的业务资料。

项目使用带版本号的 Git 标签和 Release 固定可交付版本；日常修改经分支和提交保留，变更说明集中在 [CHANGELOG.md](CHANGELOG.md)。维护方式见[版本管理](docs/versioning.md)。

## 许可与致谢

项目基于 [daidaibg/IofTV-Screen-Vue3](https://github.com/daidaibg/IofTV-Screen-Vue3) 二次开发，保留原作者 **daidai** 的版权声明和 [MIT License](LICENSE)。感谢 Vue、Vite、ECharts、Fastify、Drizzle ORM、PostgreSQL 及各依赖项目。

软件代码按仓库中的许可证使用；第三方图片、地图数据、商标和另有声明的资料遵循各自许可。衡真教育名称与品牌标识的展示不构成对第三方产品的背书。
