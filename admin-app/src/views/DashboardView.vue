<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { resources } from "@/config/resources";
import { request } from "@/lib/api";
import AppIcon from "@/components/AppIcon.vue";
import { displayText } from "@/lib/display";

interface CountCard {
  key: string;
  label: string;
  icon: string;
  total: number | null;
  path: string;
  note: string;
}

interface ResourceStat {
  total: number | null;
  pending: number | null;
  updatedAt: string | null;
}

interface DashboardPayload {
  resources?: Array<Record<string, unknown>> | Record<string, Record<string, unknown>>;
  users?: Record<string, unknown>;
  auditEvents?: Record<string, unknown>[] | Record<string, unknown>;
  latestRevision?: Record<string, unknown> | null;
  generatedAt?: string;
}

const cards = ref<CountCard[]>([
  { key: "users", label: "授权用户", icon: "User", total: null, path: "/users", note: "可进入省级地图" },
  { key: "schools", label: "基础学校记录", icon: "School", total: null, path: "/data/schools", note: "基础维护表，非全国院校总量" },
  { key: "companies", label: "基础单位记录", icon: "OfficeBuilding", total: null, path: "/data/companies", note: "基础维护表，非全国单位总量" },
  { key: "recruitment-metrics", label: "招聘指标", icon: "TrendCharts", total: null, path: "/data/recruitment-metrics", note: "按年批次可追溯" },
  { key: "recruitment-requirements", label: "招聘要求", icon: "Tickets", total: null, path: "/data/recruitment-requirements", note: "按省份、单位与批次" },
  { key: "early-batch-policies", label: "提前批政策", icon: "Finished", total: null, path: "/data/early-batch-policies", note: "资格与流程参考" },
  { key: "sources", label: "来源文档", icon: "Document", total: null, path: "/data/sources", note: "官方及归档来源" },
]);

const recentAudits = ref<Record<string, unknown>[]>([]);
const recentRevisions = ref<Record<string, unknown>[]>([]);
const loading = ref(false);
const partialErrors = ref(0);
const lastRefresh = ref<Date | null>(null);
const resourceStats = ref<Record<string, ResourceStat>>({});

const endpoints: Record<string, string> = Object.fromEntries(resources.map((item) => [item.key, item.endpoint]));

const totalRecords = computed(() => {
  const stats = Object.values(resourceStats.value).filter(stat => stat.total !== null);
  return stats.length ? stats.reduce((sum, stat) => sum + stat.total!, 0) : null;
});
const numberOrNull = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null;
const numberText = (value: number | null) => value === null ? '—' : value.toLocaleString('zh-CN');

const readList = async (path: string, limit = 1) => request<{ items?: Record<string, unknown>[]; total?: number }>(`${path}?limit=${limit}&offset=0`);

const normalizeStat = (value: Record<string, unknown>): ResourceStat => ({
  total: numberOrNull(value.total),
  pending: numberOrNull(value.pending ?? value.pendingCount),
  updatedAt: value.updatedAt ? String(value.updatedAt) : null,
});

const applyDashboard = (payload: DashboardPayload) => {
  const nextStats: Record<string, ResourceStat> = {};
  if (Array.isArray(payload.resources)) {
    payload.resources.forEach((entry) => {
      const key = String(entry.resource || entry.key || entry.name || "");
      if (key) nextStats[key] = normalizeStat(entry);
    });
  } else if (payload.resources) {
    Object.entries(payload.resources).forEach(([key, value]) => { nextStats[key] = normalizeStat(value); });
  }
  resourceStats.value = nextStats;
  cards.value.forEach((card) => {
    if (card.key === "users") card.total = numberOrNull(payload.users?.total);
    else card.total = nextStats[card.key]?.total ?? null;
  });
  recentAudits.value = Array.isArray(payload.auditEvents) ? payload.auditEvents : [];
  recentRevisions.value = payload.latestRevision ? [payload.latestRevision] : [];
  lastRefresh.value = payload.generatedAt ? new Date(payload.generatedAt) : new Date();
};

const load = async () => {
  loading.value = true;
  partialErrors.value = 0;
  try {
    const payload = await request<DashboardPayload>("/admin/dashboard");
    applyDashboard(payload);
    try {
      const auditPayload = await readList("/admin/audit-events", 6);
      recentAudits.value = auditPayload.items || [];
    } catch {
      partialErrors.value += 1;
      recentAudits.value = [];
    }
    loading.value = false;
    return;
  } catch {
    partialErrors.value += 1;
    resourceStats.value = {};
  }
  const results = await Promise.allSettled(cards.value.map((card) => readList(card.key === "users" ? "/admin/users" : endpoints[card.key])));
  results.forEach((result, index) => {
    if (result.status === "fulfilled") cards.value[index].total = numberOrNull(result.value.total);
    else {
      cards.value[index].total = null;
      partialErrors.value += 1;
    }
  });

  const [auditResult, revisionResult] = await Promise.allSettled([
    readList("/admin/audit-events", 6),
    readList("/admin/revisions", 4),
  ]);
  if (auditResult.status === "fulfilled") recentAudits.value = auditResult.value.items || [];
  else partialErrors.value += 1;
  if (revisionResult.status === "fulfilled") recentRevisions.value = revisionResult.value.items || [];
  else partialErrors.value += 1;

  lastRefresh.value = new Date();
  loading.value = false;
};

const dateText = (value: unknown) => {
  if (!value) return "时间待补";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(date);
};

const auditName = (value: unknown) => {
  const labels: Record<string, string> = {
    "admin.login": "管理员登录",
    "admin.logout": "管理员退出",
    "admin.user_created": "授权手机号",
    "admin.user_updated": "更新用户权限",
    "admin.user_password_reset": "重置用户密码",
    "user.create": "授权手机号",
    "user.update": "更新用户权限",
    "user.enable": "启用用户",
    "user.disable": "停用用户",
    "user.delete": "移除用户授权",
    "user.reset_password": "重置用户密码",
    "data.created": "新建数据",
    "data.updated": "更新数据",
    "data.deleted": "删除数据",
  };
  return labels[String(value)] || displayText(value, "后台操作");
};

const actorText = (item: Record<string, unknown>) => {
  if (item.actor || item.username) return String(item.actor || item.username);
  const type = displayText(item.actorType || "admin");
  const id = String(item.actorId || "");
  return id ? `${type} · ${id.slice(-8)}` : type;
};

const statFor = (key: string) => resourceStats.value[key] || { total: null, pending: null, updatedAt: null };

onMounted(load);
</script>

<template>
  <section class="dashboard-page">
    <div class="dashboard-hero">
      <div>
        <span class="eyebrow">系统总览</span>
        <h2>全站数据与权限，一屏掌握</h2>
        <p>全国查询与前台共用数据版本；基础维护表独立管理，修改记录保留来源、时间和操作留痕。</p>
      </div>
      <button type="button" class="button secondary" :disabled="loading" @click="load">
        <AppIcon name="Refresh" :size="15" :class="{ 'spin-icon': loading }" />
        {{ loading ? "刷新中…" : "刷新数据" }}
      </button>
    </div>

    <div v-if="partialErrors" class="boundary-note warning-note" role="status">
      <span class="boundary-icon"><AppIcon name="WarningFilled" :size="15" /></span><p>有 {{ partialErrors }} 项统计暂时无法读取，不影响其他模块使用。可刷新或检查 API 服务。</p>
    </div>

    <section class="dashboard-card national-entry">
      <header><div><span class="eyebrow">全国数据 · 前台同步</span><h3>先选业务，再按地区逐层查找</h3></div><span class="record-chip">默认 2026 届</span></header>
      <div class="national-entry-links">
        <RouterLink to="/grid-query?tab=directory"><AppIcon name="School" :size="22" /><div><b>省市学校与单位名录</b><p>全国 → 省份 → 城市 → 学校 / 单位详情</p></div></RouterLink>
        <RouterLink to="/grid-query?tab=rankings"><AppIcon name="TrendCharts" :size="22" /><div><b>全国院校与录用公示</b><p>与前台按相同年份、电网、批次核对</p></div></RouterLink>
        <RouterLink to="/grid-query?tab=facts"><AppIcon name="Tickets" :size="22" /><div><b>招聘资料与报考条件</b><p>按地区、年份、批次、条件分类检索</p></div></RouterLink>
        <RouterLink to="/grid-query?tab=map"><AppIcon name="Location" :size="22" /><div><b>地图目录与位置核对</b><p>查看全国覆盖范围和位置补充清单</p></div></RouterLink>
      </div>
      <p class="national-entry-note">全国全量请使用以上入口。下方为基础维护记录，不代表全国院校、单位或录用人数；基础表修改不会自动重算全国汇总。</p>
    </section>

    <div class="metric-grid">
      <RouterLink v-for="card in cards" :key="card.key" :to="card.path" class="metric-card">
        <span class="metric-icon"><AppIcon :name="card.icon" :size="20" /></span>
        <div><small>{{ card.label }}</small><b>{{ card.total === null ? "—" : card.total.toLocaleString("zh-CN") }}</b><p>{{ card.note }}</p></div>
        <span class="metric-arrow"><AppIcon name="ArrowRight" :size="15" /></span>
      </RouterLink>
    </div>

    <div class="dashboard-grid">
      <section class="dashboard-card quick-data-card">
        <header><div><span class="eyebrow">基础数据维护</span><h3>按业务类型维护</h3></div><span v-if="totalRecords !== null" class="record-chip">已读取 {{ numberText(totalRecords) }} 条维护记录</span></header>
        <div class="quick-links stats-links">
          <RouterLink v-for="resource in resources.filter((item) => !item.readonly)" :key="resource.key" :to="`/data/${resource.key}`">
            <span class="quick-icon"><AppIcon :name="resource.icon" :size="15" /></span>
            <div>
              <b>{{ resource.title }}</b>
              <small>
                共 {{ numberText(statFor(resource.key).total) }} 条
                <template v-if="statFor(resource.key).pending !== null"> · 需补充 {{ numberText(statFor(resource.key).pending) }} 条</template>
                · {{ statFor(resource.key).updatedAt ? dateText(statFor(resource.key).updatedAt) : "暂无更新时间" }}
              </small>
            </div>
            <AppIcon name="ArrowRight" :size="15" />
          </RouterLink>
        </div>
      </section>

      <div class="dashboard-side">
        <section class="dashboard-card">
          <header><div><span class="eyebrow">更新与版本</span><h3>最近数据更新</h3></div><RouterLink to="/data/revisions">全部</RouterLink></header>
          <div v-if="recentRevisions.length" class="revision-list">
            <RouterLink v-for="item in recentRevisions" :key="String(item.id || item.revisionKey)" to="/data/revisions">
              <span class="revision-dot"></span><div><b>{{ item.title || item.revisionKey || "数据更新" }}</b><small>{{ item.description || item.unitScope || "更新说明待补" }}</small></div><time>{{ dateText(item.publishedAt || item.updatedAt) }}</time>
            </RouterLink>
          </div>
          <div v-else class="compact-empty">暂无已记录的数据更新</div>
        </section>

        <section class="dashboard-card">
          <header><div><span class="eyebrow">安全与操作留痕</span><h3>最近后台操作</h3></div><RouterLink to="/data/audit-events">全部</RouterLink></header>
          <div v-if="recentAudits.length" class="audit-list">
            <div v-for="item in recentAudits" :key="String(item.id)">
              <span class="audit-symbol"><AppIcon name="CircleCheck" :size="14" /></span><div><b>{{ auditName(item.event || item.action) }}</b><small>{{ actorText(item) }}</small></div><time>{{ dateText(item.occurredAt || item.createdAt) }}</time>
            </div>
          </div>
          <div v-else class="compact-empty">暂无可显示的审计记录</div>
        </section>
      </div>
    </div>

    <footer class="dashboard-footer-note">
      <span class="status-dot"></span>
      <p><b>最后读取：</b>{{ lastRefresh ? dateText(lastRefresh) : "尚未读取" }}　 · 　数据更新时间以“已发布”的更新记录为准</p>
    </footer>
  </section>
</template>

<style scoped>
.national-entry{margin-bottom:22px}.national-entry-links{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.national-entry-links>a{display:flex;gap:15px;align-items:center;padding:18px;border:1px solid var(--line);border-radius:12px;background:#f5fbff}.national-entry-links>a:hover{border-color:var(--primary);background:#eef9ff}.national-entry-links b{font-size:15px;color:var(--ink-strong)}.national-entry-links p,.national-entry-note{color:var(--ink-muted);font-size:12px;line-height:1.7;margin:6px 0 0}.national-entry-note{margin-top:16px}@media(max-width:680px){.national-entry-links{grid-template-columns:1fr}}
</style>
