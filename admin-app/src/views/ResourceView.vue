<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import EntityDialog from "@/components/EntityDialog.vue";
import { resourceMap } from "@/config/resources";
import { API_BASE_URL, normalizePage, queryString, request } from "@/lib/api";
import { toast } from "@/lib/toast";
import type { FieldDefinition, FieldOption, FilterDefinition, ResourceDefinition } from "@/types";
import AppIcon from "@/components/AppIcon.vue";
import { displayText } from "@/lib/display";

const route = useRoute();
const router = useRouter();
const resource = computed(() => resourceMap.get(String(route.params.resource)));
const items = ref<Record<string, unknown>[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(15);
const search = ref("");
const loading = ref(false);
const loadError = ref("");
let loadGeneration = 0;
const dialogOpen = ref(false);
const detailLoading = ref(false);
const viewingOnly = ref(false);
let detailGeneration = 0;
const editingItem = ref<Record<string, unknown> | null>(null);
const saving = ref(false);
const deleting = ref(false);
const pendingDelete = ref<Record<string, unknown> | null>(null);
const pendingDeleteResourceKey = ref("");
const filters = ref<Record<string, string>>({});
const filterOptions = ref<Record<string, FieldOption[]>>({});
let filterOptionsGeneration = 0;

// Source title, publisher, publication date and official URL are acceptance-critical.
// Keep enough horizontal columns for them instead of silently truncating at 12.
const tableFields = computed(() => resource.value?.fields.filter((field) => field.table).slice(0, 18) || []);
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)));
const firstRow = computed(() => total.value ? (page.value - 1) * pageSize.value + 1 : 0);
const lastRow = computed(() => Math.min(page.value * pageSize.value, total.value));
const sourcePreviewSrc = computed(() => {
  if (resource.value?.key !== "sources" || !viewingOnly.value || !editingItem.value) return undefined;
  const metadata = editingItem.value.metadata as Record<string, unknown> | null;
  if (metadata?.visibility !== "admin_only" || metadata?.materialKind !== "image_ocr") return undefined;
  return `${API_BASE_URL}/admin/sources/${encodeURIComponent(String(editingItem.value.id))}/asset`;
});

const itemId = (item: Record<string, unknown>) =>
  item.id ?? item.schoolId ?? item.companyId ?? item.batchId ?? item.eventId ?? item.metricId ?? item.sourceId ?? item.revisionId;

const initializeFilters = () => {
  filters.value = Object.fromEntries((resource.value?.filters ?? []).map((filter) => [filter.key, ""]));
};

const loadFilterOptions = async () => {
  const generation = ++filterOptionsGeneration;
  const resourceKey = resource.value?.key;
  filterOptions.value = {};
  const isCurrent = () => generation === filterOptionsGeneration && resource.value?.key === resourceKey;
  const dynamicFilters = (resource.value?.filters ?? []).filter((filter) => filter.optionsEndpoint);
  const loaded: Record<string, FieldOption[]> = {};
  await Promise.all(dynamicFilters.map(async (filter) => {
    try {
      const optionPageSize = 200;
      const allItems: Record<string, unknown>[] = [];
      let offset = 0;
      let expectedTotal = Number.POSITIVE_INFINITY;
      while (offset < expectedTotal && isCurrent()) {
        const payload = await request<Record<string, unknown>>(
          `${filter.optionsEndpoint}${queryString({ limit: 200, offset })}`,
        );
        if (!isCurrent()) return;
        const normalized = normalizePage(
          payload as { items?: Record<string, unknown>[]; total?: number },
          Math.floor(offset / optionPageSize) + 1,
          optionPageSize,
        );
        allItems.push(...normalized.items);
        expectedTotal = normalized.meta.total;
        if (!normalized.items.length || normalized.items.length < optionPageSize) break;
        offset += normalized.items.length;
      }
      const labelKey = filter.optionLabelKey || "name";
      const valueKey = filter.optionValueKey || "id";
      loaded[filter.key] = allItems
        .filter((item) => item[valueKey] !== null && item[valueKey] !== undefined)
        .map((item) => ({
          label: String(item[labelKey] ?? item[valueKey]),
          value: String(item[valueKey]),
          ...(filter.optionParentKey && item[filter.optionParentKey] !== null && item[filter.optionParentKey] !== undefined
            ? { parentValue: String(item[filter.optionParentKey]) }
            : {}),
        }));
    } catch {
      loaded[filter.key] = [];
    }
  }));
  if (isCurrent()) filterOptions.value = loaded;
};

const optionsForFilter = (filter: FilterDefinition) => {
  const options = filter.options ?? filterOptions.value[filter.key] ?? [];
  const parentKey = filter.dependsOn;
  if (!parentKey || !filters.value[parentKey]) return options;
  const parentValue = filters.value[parentKey];
  return options.filter((option) => option.parentValue === parentValue);
};

const onFilterChange = (filter: FilterDefinition) => {
  for (const dependent of resource.value?.filters ?? []) {
    if (dependent.dependsOn === filter.key) filters.value[dependent.key] = "";
  }
};

const hasActiveFilters = computed(() =>
  Boolean(search.value.trim()) || Object.values(filters.value).some((value) => value !== ""),
);

const load = async () => {
  const generation = ++loadGeneration;
  const currentResource = resource.value;
  if (!currentResource) {
    items.value = [];
    total.value = 0;
    loading.value = false;
    loadError.value = "";
    await router.replace("/");
    return;
  }
  const requestedPage = page.value;
  const requestedPageSize = pageSize.value;
  loading.value = true;
  loadError.value = "";
  try {
    const payload = await request<Record<string, unknown>>(
      `${currentResource.endpoint}${queryString({
        q: search.value.trim(),
        ...filters.value,
        limit: requestedPageSize,
        offset: (requestedPage - 1) * requestedPageSize,
      })}`,
    );
    if (generation !== loadGeneration || resource.value?.key !== currentResource.key) return;
    const normalized = normalizePage(
      payload as { items?: Record<string, unknown>[]; total?: number; page?: number; pageSize?: number },
      requestedPage,
      requestedPageSize,
    );
    items.value = normalized.items;
    total.value = normalized.meta.total;
    if (page.value > totalPages.value) {
      page.value = totalPages.value;
      await load();
    }
  } catch (error) {
    if (generation !== loadGeneration || resource.value?.key !== currentResource.key) return;
    loadError.value = error instanceof Error ? error.message : "数据读取失败。";
    items.value = [];
    total.value = 0;
  } finally {
    if (generation === loadGeneration) loading.value = false;
  }
};

const searchNow = () => {
  page.value = 1;
  void load();
};

const resetSearch = () => {
  search.value = "";
  initializeFilters();
  page.value = 1;
  void load();
};

const openCreate = () => {
  detailGeneration += 1;
  detailLoading.value = false;
  viewingOnly.value = false;
  editingItem.value = null;
  dialogOpen.value = true;
};

const openEdit = async (item: Record<string, unknown>, readonly = false) => {
  const currentResource = resource.value;
  if (!currentResource) return;
  const generation = ++detailGeneration;
  viewingOnly.value = readonly;
  if (currentResource.key !== "sources") {
    editingItem.value = item;
    dialogOpen.value = true;
    return;
  }
  // Source lists intentionally omit OCR/body text. Fetch the complete record
  // only on demand; otherwise saving a list row could erase the original text.
  detailLoading.value = true;
  try {
    const id = itemId(item);
    if (!id) throw new Error("来源记录缺少 ID。");
    const detailPayload = await request<{ item?: Record<string, unknown> }>(`${currentResource.endpoint}/${encodeURIComponent(String(id))}`);
    if (generation !== detailGeneration || resource.value?.key !== currentResource.key) return;
    const detail = detailPayload?.item;
    if (!detail || typeof detail !== "object" || Array.isArray(detail) || String(itemId(detail) ?? "") !== String(id)) {
      throw new Error("来源详情返回不完整，请重新加载后再试。");
    }
    editingItem.value = detail;
    dialogOpen.value = true;
  } catch (error) {
    if (generation === detailGeneration) toast.error(error instanceof Error ? error.message : "来源正文加载失败。");
  } finally {
    if (generation === detailGeneration) detailLoading.value = false;
  }
};

const closeDialog = () => {
  if (saving.value) return;
  dialogOpen.value = false;
  detailGeneration += 1;
  viewingOnly.value = false;
  editingItem.value = null;
};

const normalizeFormPayload = (payload: Record<string, unknown>) => {
  if (typeof payload.payload === "string" && payload.payload.trim()) {
    try {
      payload.payload = JSON.parse(payload.payload);
    } catch {
      throw new Error("附加信息必须是有效的 JSON。 ");
    }
  }
  return payload;
};

const saveItem = async (rawPayload: Record<string, unknown>) => {
  if (!resource.value || viewingOnly.value) return;
  const currentResource = resource.value;
  if (currentResource.readonly) return;
  saving.value = true;
  try {
    const payload = normalizeFormPayload({ ...rawPayload });
    const id = editingItem.value ? itemId(editingItem.value) : null;
    await request(`${currentResource.endpoint}${id !== null && id !== undefined ? `/${encodeURIComponent(String(id))}` : ""}`, {
      method: id !== null && id !== undefined ? "PATCH" : "POST",
      body: JSON.stringify(payload),
    });
    toast.success(`${currentResource.singular}已${id !== null && id !== undefined ? "更新" : "创建"}。`);
    if (resource.value?.key !== currentResource.key) return;
    dialogOpen.value = false;
    editingItem.value = null;
    await load();
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "保存失败。 ");
  } finally {
    saving.value = false;
  }
};

const confirmDelete = (item: Record<string, unknown>) => {
  if (!resource.value || resource.value.readonly) return;
  pendingDeleteResourceKey.value = resource.value.key;
  pendingDelete.value = item;
};

const deleteItem = async () => {
  if (!resource.value || !pendingDelete.value) return;
  const currentResource = resource.value;
  if (currentResource.readonly || currentResource.key !== pendingDeleteResourceKey.value) { pendingDelete.value = null; return; }
  const id = itemId(pendingDelete.value);
  if (id === null || id === undefined) {
    toast.error("该记录缺少 ID，无法删除。 ");
    pendingDelete.value = null;
    return;
  }
  deleting.value = true;
  try {
    await request(`${currentResource.endpoint}/${encodeURIComponent(String(id))}`, { method: "DELETE" });
    toast.success(`${currentResource.singular}已删除。`);
    if (resource.value?.key !== currentResource.key) return;
    pendingDelete.value = null;
    await load();
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "删除失败。 ");
  } finally {
    deleting.value = false;
  }
};

const goPage = (next: number) => {
  if (next < 1 || next > totalPages.value || next === page.value) return;
  page.value = next;
  void load();
};

const statusLabel = (value: unknown) => {
  const labels: Record<string, string> = {
    published: "已发布",
    draft: "草稿",
    pending: "待补充",
    archived: "已归档",
    verified: "官方已核验",
    derived: "派生值已核对",
    partially_verified: "部分核验",
    partially_verified_nonofficial: "非官方参考·部分核验",
    pending_separate_count: "待单独统计",
    verified_name_only: "仅名称已核验",
    verified_name_location_derived: "名称已核验·位置为派生值",
    verified_official_unit: "官方单位已核验",
    current_official: "当前官方资料",
    current_official_plus_historical_reference: "当前官方资料·含历史参考",
    historical_reference_only: "仅历史参考",
    historical_reference: "历史参考",
    verified_current_official: "当前官方资料已核验",
    verified_current_official_mention: "当前官方原文数值已核验",
    pending_no_business_data: "待补业务数据",
    reference: "历史参考",
    reference_only: "仅作历史参考",
    pending_official_release: "待官方发布",
    pending_official_source_mapping: "待官方逐源映射",
    verified_current_official_excerpt: "当前官方原文已核验",
    archived_current_official: "当前官方页面已归档",
    archived_official_attachment: "官方附件已归档",
    archived_national_official_attachment: "全国官方附件已归档",
    archived_national_official_page_metadata: "全国官方页元数据已归档",
    historical_reference_tier_b: "B级历史参考已复核",
    historical_map_checked_tier_c: "C级历史映射已检查",
    historical_cross_checked_tier_c: "C级历史资料已交叉检查",
    validated_after_build: "构建后校验通过",
    source_traced_historical_archive: "历史归档已溯源",
    official_current: "当前官方资料",
    official_current_plus_historical_reference: "当前官方资料·含历史参考",
    internal_snapshot: "内部数据快照",
    active: "启用",
    uploaded_reference_unverified: "上传参考·待外部核验",
    pending_reference_verification: "仅管理员·待核验",
    invalid: "不可用",
    success: "成功",
    denied: "拒绝",
  };
  return labels[String(value)] || displayText(value, "未提供");
};

const auditActionLabel = (value: unknown) => {
  const labels: Record<string, string> = {
    "admin.login": "管理员登录",
    "admin.logout": "管理员退出",
    "user.create": "授权手机号",
    "user.update": "更新用户权限",
    "user.enable": "启用用户",
    "user.disable": "停用用户",
    "user.delete": "移除用户授权",
    "user.reset_password": "重置用户密码",
    "resource.create": "新建数据",
    "resource.update": "更新数据",
    "resource.delete": "删除数据",
  };
  return labels[String(value)] || displayText(value, "未提供");
};

const sourceEvidenceTier = (item: Record<string, unknown>) => {
  const sourceType = String(item.sourceType || "");
  const status = String(item.status || "");
  if (
    [
      "current_official_page",
      "national_official_page",
      "official_attachment",
      "national_official_attachment",
      "official_current_tag_list",
      "official_page_archive",
      "official_school_master",
      "official_web",
    ].includes(sourceType)
  ) return "A｜官方原始证据";
  if (["official_school_page", "official_historical_tag_list"].includes(sourceType)) {
    return "B｜学校官网/沿革证据";
  }
  if (sourceType === "provided_public_list_aggregate" || sourceType === "provided_aggregate") {
    return "C｜用户公示聚合";
  }
  if (["provided_nonofficial_image", "uploaded_workbook", "reference"].includes(sourceType)) {
    return "D｜用户参考线索";
  }
  if (sourceType === "historical_supplement") {
    return status.includes("tier_c") ? "C｜历史映射待核" : "B｜历史参考";
  }
  return "内部派生/索引｜回查原始来源";
};

const sourcePrivacyBoundary = (item: Record<string, unknown>) => {
  const metadata = item.metadata as Record<string, unknown> | null;
  if (metadata?.visibility === "admin_only" || String(item.sourceKey ?? "").startsWith("DEMO-PRIVATE-")) {
    return "仅管理员核验｜不进统计或资格判断";
  }
  const sourceType = String(item.sourceType || "");
  if (["provided_public_list_aggregate", "provided_aggregate"].includes(sourceType)) {
    return "仅聚合公开｜个人字段禁出";
  }
  if (["provided_nonofficial_image", "uploaded_workbook", "reference"].includes(sourceType)) {
    return "内部参考｜原件与个人信息不公开";
  }
  if (["internal_dataset_snapshot", "maintenance_template", "local_archive"].includes(sourceType)) {
    return "内部工件｜路径与原始明细不公开";
  }
  return "可引证必要字段｜本地路径不公开";
};

const derivedValue = (item: Record<string, unknown>, field: FieldDefinition) => {
  if (field.derive === "sourceEvidenceTier") return sourceEvidenceTier(item);
  if (field.derive === "sourcePrivacyBoundary") return sourcePrivacyBoundary(item);
  return item[field.key];
};

const displayValue = (item: Record<string, unknown>, field: FieldDefinition) => {
  if (field.format === "eventTimeline") {
    const start = item.startsAt ?? item.startsOn;
    const end = item.endsAt ?? item.endsOn;
    const formatTime = (raw: unknown) => {
      const value = String(raw);
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return value;
      const hasClock = /T|\d{2}:\d{2}/.test(value);
      return new Intl.DateTimeFormat("zh-CN", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        ...(hasClock ? { hour: "2-digit", minute: "2-digit", hour12: false } : {}),
      }).format(date);
    };
    if (start && end) return `开始 ${formatTime(start)}；结束 ${formatTime(end)}`;
    if (start) return `开始/发生 ${formatTime(start)}`;
    if (end) return `仅公布截止/结束 ${formatTime(end)}`;
    return "官方未披露精确日期";
  }
  const value = derivedValue(item, field);
  if (value === null || value === undefined || value === "") return field.emptyLabel || "—";
  const option = field.options?.find((entry) => String(entry.value) === String(value));
  if (option) return option.label;
  const format = field.format;
  if (format === "eventType") return "其他招聘节点（待归类）";
  if (format === "requirementTags") {
    const labels: Record<string, string> = {
      application_materials: "报名材料", major: "专业要求", education: "学历要求",
      academic_verification: "学籍/学历核验", health: "健康要求", age: "年龄要求",
      cohort: "应届生范围", language_and_computer: "外语与计算机", overseas_education: "境外学历要求",
      special_obligation: "特殊义务", integrity: "诚信要求", training_mode: "培养方式",
    };
    return (Array.isArray(value) ? value : [value]).map((entry) => labels[String(entry)] || "其他要求").join("、");
  }
  if (format === "eventSemantic") {
    const raw = String(value);
    const exact = /minute|exact|session|clock/i.test(raw);
    const dateRange = /range|window|period|multi.?day/i.test(raw);
    const dateOnly = /date|day|deadline/i.test(raw);
    const month = /month/i.test(raw);
    const relative = /relative|after|before|next|expected|estimated|tentative/i.test(raw);
    const unpublished = /not.?published|not.?disclosed|unknown|pending|tbd/i.test(raw);
    if (field.key === "sourceKind") return /historical|archive|supplement|recovered/i.test(raw) ? "历史官方资料补录" : "当前官方资料";
    if (field.key === "locationKind") {
      if (/written|exam/i.test(raw)) return "笔试/考核地点";
      if (/campus|publicity|presentation/i.test(raw)) return "校园宣讲地点";
      if (/medical|physical/i.test(raw)) return "体检/体能测试地点";
      return unpublished ? "官方未披露地点" : "招聘活动地点";
    }
    if (unpublished) return "官方未披露";
    if (relative) return "相对时间安排";
    if (month) return "仅公布月份";
    if (dateRange) return "日期区间";
    if (exact) return "精确到时刻/场次";
    if (dateOnly) return "仅公布日期";
    return "原文时间口径待标准化";
  }
  if (format === "auditAction") return auditActionLabel(value);
  if (format === "boolean") return value ? "是" : "否";
  if (format === "number") {
    const numeric = Number(value);
    return Number.isFinite(numeric)
      ? new Intl.NumberFormat("zh-CN").format(numeric)
      : String(value);
  }
  if (format === "date" || format === "datetime") {
    const date = new Date(String(value));
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      ...(format === "datetime" ? { hour: "2-digit", minute: "2-digit", hour12: false } : {}),
    }).format(date);
  }
  return displayText(value, field.emptyLabel || "未提供", field);
};

const dialogItem = computed(() => !viewingOnly.value || !editingItem.value ? editingItem.value : {
  ...editingItem.value,
  ...Object.fromEntries((resource.value?.fields || []).filter(field => field.derive).map(field => [field.key, derivedValue(editingItem.value!, field)])),
});

const groupEntries = computed(() => {
  const keys = resource.value?.groupBy ?? [];
  let previous = "";
  return items.value.map((item, index) => {
    const parts = keys.map((key) => {
      const field = resource.value?.fields.find((candidate) => candidate.key === key);
      if (
        resource.value?.key === "recruitment-requirements"
        && key === "category"
        && filters.value.category
      ) {
        return field?.options?.find(
          (option) => String(option.value) === filters.value.category,
        )?.label || "当前筛选类别";
      }
      if (field) return displayValue(item, field);
      return String(item[key] ?? "未分类");
    });
    const groupKey = parts.join("|");
    const groupStart = Boolean(keys.length) && (index === 0 || groupKey !== previous);
    previous = groupKey;
    return {
      item,
      rowKey: String(itemId(item)),
      groupStart,
      groupLabel: parts.filter(Boolean).join(resource.value?.groupSeparator ?? " · ") || "未分类",
    };
  });
});

watch(() => route.params.resource, () => {
  detailGeneration += 1;
  detailLoading.value = false;
  viewingOnly.value = false;
  dialogOpen.value = false;
  editingItem.value = null;
  pendingDelete.value = null;
  pendingDeleteResourceKey.value = "";
  page.value = 1;
  pageSize.value = resource.value?.defaultPageSize ?? 15;
  search.value = "";
  initializeFilters();
  void loadFilterOptions();
  void load();
});

onBeforeUnmount(() => {
  loadGeneration++; detailGeneration++; filterOptionsGeneration++;
  items.value = []; filterOptions.value = {}; editingItem.value = null; pendingDelete.value = null;
});

onMounted(() => {
  pageSize.value = resource.value?.defaultPageSize ?? 15;
  initializeFilters();
  void loadFilterOptions();
  void load();
});
</script>

<template>
  <section v-if="resource" class="page-section">
    <div class="page-lead">
      <div>
        <span class="eyebrow">业务维护 · 分类管理</span>
        <h2>{{ resource.title }}</h2>
        <p>{{ resource.description }}</p>
      </div>
      <button v-if="!resource.readonly" type="button" class="button primary" @click="openCreate">
        <AppIcon name="Plus" :size="15" /> 新建{{ resource.singular }}
      </button>
    </div>

    <div class="boundary-note" role="note">
      <span class="boundary-icon"><AppIcon name="InfoFilled" :size="15" /></span>
      <p><b>维护说明：</b> {{ resource.entryNote || "缺失字段保持为空，不推测补齐；数量须明确年份、批次、单位与来源。发布状态和事实核验状态分别维护。" }}</p>
    </div>
    <div v-if="['schools', 'companies', 'provinces', 'cities'].includes(resource.key)" class="boundary-note" role="note"><p>这里维护基础关系名录，不代表全国数据总量。查看与前台共用的全国学校、单位和录用汇总，请进入 <RouterLink to="/grid-query?tab=directory">省市学校与单位名录</RouterLink> 或 <RouterLink to="/grid-query?tab=rankings">全国院校榜</RouterLink>。</p></div>

    <div v-if="resource.hierarchySteps?.length" class="hierarchy-strip" aria-label="数据层级">
      <template v-for="(step, index) in resource.hierarchySteps" :key="step">
        <span>{{ step }}</span>
        <AppIcon v-if="index < resource.hierarchySteps.length - 1" name="ArrowRight" :size="12" />
      </template>
    </div>

    <div class="data-card">
      <div class="data-toolbar">
        <form class="search-form" @submit.prevent="searchNow">
          <AppIcon name="Search" :size="18" />
          <input v-model="search" type="search" :placeholder="`搜索${resource.singular}或关键字段`" />
          <label v-for="filter in resource.filters || []" :key="filter.key" class="filter-control">
            <span>{{ filter.label }}</span>
            <select v-if="filter.kind === 'select'" v-model="filters[filter.key]" @change="onFilterChange(filter)">
              <option value="">{{ filter.emptyOptionLabel || `全部${filter.label}` }}</option>
              <option v-for="option in optionsForFilter(filter)" :key="String(option.value)" :value="String(option.value)">
                {{ option.label }}
              </option>
            </select>
            <input
              v-else
              v-model="filters[filter.key]"
              :type="filter.kind === 'number' ? 'number' : 'text'"
              :placeholder="filter.placeholder || filter.label"
            />
          </label>
          <button type="submit" class="button secondary compact">搜索</button>
          <button v-if="hasActiveFilters" type="button" class="text-button" @click="resetSearch">重置</button>
        </form>
        <div class="result-count"><b>{{ total }}</b> {{ resource.countNoun || "条记录" }}</div>
      </div>

      <div v-if="loading" class="table-loading" aria-label="数据加载中">
        <span v-for="n in 6" :key="n"></span>
      </div>
      <div v-else-if="loadError" class="state-panel error-state">
        <div class="state-icon"><AppIcon name="WarningFilled" :size="24" /></div>
        <h3>数据读取失败</h3>
        <p>{{ loadError }}</p>
        <button type="button" class="button secondary" @click="load">重新加载</button>
      </div>
      <div v-else-if="!items.length" class="state-panel empty-state">
        <div class="state-icon"><AppIcon name="DocumentRemove" :size="25" /></div>
        <h3>{{ search ? "没有匹配记录" : `还没有${resource.singular}数据` }}</h3>
        <p>{{ search ? "请调整关键词后重试。" : resource.readonly ? "审计事件产生后会显示在这里。" : "可新建第一条记录，或通过数据导入任务批量写入。" }}</p>
        <button v-if="!resource.readonly && !search" type="button" class="button primary" @click="openCreate">新建{{ resource.singular }}</button>
        <button v-else-if="search" type="button" class="button secondary" @click="resetSearch">清除搜索</button>
      </div>
      <div v-else class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th v-for="field in tableFields" :key="field.key">{{ field.label }}</th>
              <th class="action-column">操作</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="entry in groupEntries" :key="entry.rowKey">
              <tr v-if="entry.groupStart" class="group-row">
                <td :colspan="tableFields.length + 1">{{ entry.groupLabel }}</td>
              </tr>
              <tr>
                <td v-for="field in tableFields" :key="field.key">
                  <a v-if="field.format === 'url' && entry.item[field.key]" :href="String(entry.item[field.key])" class="table-link" target="_blank" rel="noreferrer">查看来源 <AppIcon name="TopRight" :size="12" /></a>
                  <span v-else-if="field.format === 'status'" class="status-pill" :class="`status-${String(entry.item[field.key])}`">{{ statusLabel(entry.item[field.key]) }}</span>
                  <span v-else :title="displayValue(entry.item, field)">{{ displayValue(entry.item, field) }}</span>
                </td>
                <td class="row-actions">
                  <button type="button" class="row-button" :disabled="detailLoading" @click="openEdit(entry.item, true)">{{ resource.key === 'sources' ? '查看原文' : '查看详情' }}</button>
                  <button v-if="!resource.readonly" type="button" class="row-button" :disabled="detailLoading" @click="openEdit(entry.item)">编辑</button>
                  <button v-if="!resource.readonly" type="button" class="row-button danger-text" @click="confirmDelete(entry.item)">删除</button>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>

      <footer v-if="!loading && !loadError && total" class="pagination-bar">
        <span>显示 {{ firstRow }}–{{ lastRow }}，共 {{ total }} 条</span>
        <div class="pagination-actions">
          <button type="button" :disabled="page <= 1" @click="goPage(page - 1)">上一页</button>
          <b>{{ page }} / {{ totalPages }}</b>
          <button type="button" :disabled="page >= totalPages" @click="goPage(page + 1)">下一页</button>
        </div>
      </footer>
    </div>

    <EntityDialog
      v-if="dialogOpen"
      :resource="resource"
      :item="dialogItem"
      :loading="saving"
      :readonly="viewingOnly"
      :preview-src="sourcePreviewSrc"
      @cancel="closeDialog"
      @submit="saveItem"
    />
    <ConfirmDialog
      v-if="pendingDelete"
      :title="`删除${resource.singular}`"
      description="删除后该记录将不再供前端读取。相关审计记录会继续保留，此操作需要谨慎确认。"
      confirm-text="确认删除"
      danger
      :loading="deleting"
      @cancel="pendingDelete = null"
      @confirm="deleteItem"
    />
  </section>
</template>
