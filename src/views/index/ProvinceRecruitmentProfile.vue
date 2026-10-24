<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { eventDate, eventClock, hasOfficialClockTime } from "./recruitment-event-time";
import { groupProvinceRequirements, recruitmentReadingLabel } from './province-recruitment-display';
import type {
  ProvinceRecruitmentProfile,
  ProvincialRecruitmentEvent,
  ProvincialRecruitmentHeadcountFact,
  ProvincialRecruitmentUnit,
} from "@/services/provincial-recruitment";

const props = withDefaults(defineProps<{
  data: ProvinceRecruitmentProfile | null;
  loading?: boolean;
  error?: string;
  provinceName?: string;
  provinceAdcode?: string;
  variant?: "panel" | "dialog";
  headingId?: string;
}>(), {
  loading: false,
  error: "",
  provinceName: "",
  provinceAdcode: "",
  variant: "panel",
  headingId: undefined,
});

const emit = defineEmits<{
  retry: [];
  openFull: [];
}>();

const selectedUnitKey = ref("");
const selectedBatch = ref("all");

const units = computed(() => Array.isArray(props.data?.units) ? props.data!.units! : []);
const unitKey = (unit: ProvincialRecruitmentUnit, index = 0) => String(
  unit.company?.companyKey || unit.company?.name || `unit-${index + 1}`,
);
const unitName = (unit: ProvincialRecruitmentUnit, index = 0) => String(
  unit.company?.name || unit.profile?.unitName || unit.profile?.unit_name || `招聘单位${index + 1}`,
);

watch(units, (nextUnits) => {
  if (!nextUnits.length) {
    selectedUnitKey.value = "";
    return;
  }
  if (!nextUnits.some((unit, index) => unitKey(unit, index) === selectedUnitKey.value)) {
    selectedUnitKey.value = unitKey(nextUnits[0], 0);
  }
}, { immediate: true });

watch(selectedUnitKey, () => {
  selectedBatch.value = "all";
});

const activeUnit = computed(() => units.value.find((unit, index) => (
  unitKey(unit, index) === selectedUnitKey.value
)) ?? units.value[0] ?? null);
const unitProfile = computed<Record<string, any>>(() => activeUnit.value?.profile ?? {});
const unitEvents = computed(() => Array.isArray(activeUnit.value?.events) ? activeUnit.value!.events! : []);
const unitRequirements = computed(() => Array.isArray(activeUnit.value?.requirements) ? activeUnit.value!.requirements! : []);
const unitHeadcountFacts = computed(() => Array.isArray(activeUnit.value?.headcountFacts) ? activeUnit.value!.headcountFacts! : []);

const normalizedBatchCode = (value: unknown) => {
  const code = String(value ?? "").trim().toLowerCase();
  if (!code) return "unassigned";
  if (/campus|early|advance|提前|校园/.test(code)) return "campus";
  if (/batch[_ -]?1|first|one|第一|一批/.test(code)) return "batch_1";
  if (/batch[_ -]?2|second|two|第二|二批/.test(code)) return "batch_2";
  if (/batch[_ -]?3|third|three|第三|三批/.test(code)) return "batch_3";
  return code;
};

const batchLabel = (value: unknown) => ({
  campus: "校园招聘 / 提前批",
  batch_1: "第一批",
  batch_2: "第二批",
  batch_3: "第三批",
  unassigned: "未标明批次",
}[normalizedBatchCode(value)] || String(value || "其他批次"));

const batchOptions = computed(() => {
  const values = new Set<string>();
  for (const batch of activeUnit.value?.batches ?? []) {
    values.add(normalizedBatchCode(batch.batchCode ?? batch.code ?? batch.name ?? batch.title));
  }
  for (const event of unitEvents.value) values.add(normalizedBatchCode(event.batchCode));
  for (const requirement of unitRequirements.value) values.add(normalizedBatchCode(requirement.batchCode));
  for (const fact of unitHeadcountFacts.value) values.add(normalizedBatchCode(fact.batchCode));
  values.delete("unassigned");
  const order = ["campus", "batch_1", "batch_2", "batch_3"];
  return [...values].sort((left, right) => {
    const leftIndex = order.indexOf(left);
    const rightIndex = order.indexOf(right);
    if (leftIndex === -1 && rightIndex === -1) return left.localeCompare(right, "zh-CN");
    if (leftIndex === -1) return 1;
    if (rightIndex === -1) return -1;
    return leftIndex - rightIndex;
  });
});

const matchesBatch = (batchCode: unknown) => (
  selectedBatch.value === "all" || normalizedBatchCode(batchCode) === selectedBatch.value
);

const eventSortKey = (event: ProvincialRecruitmentEvent) => String(
  event.startsAt || event.startsOn || event.endsAt || event.endsOn || "9999-99-99",
);
const filteredEvents = computed(() => unitEvents.value
  .filter((event) => matchesBatch(event.batchCode))
  .slice()
  .sort((left, right) => eventSortKey(left).localeCompare(eventSortKey(right), "zh-CN")));
const visibleEvents = computed(() => props.variant === "dialog" ? filteredEvents.value : filteredEvents.value.slice(0, 14));
const filteredRequirements = computed(() => unitRequirements.value.filter((item) => matchesBatch(item.batchCode)));
const requirementGroups = computed(() => groupProvinceRequirements(filteredRequirements.value));
const filteredHeadcountFacts = computed(() => unitHeadcountFacts.value.filter((item) => matchesBatch(item.batchCode)
  && (typeof item.value === 'number' && Number.isFinite(item.value) || /\d/.test(String(item.displayValue || '')))));
const visibleHeadcountFacts = computed(() => props.variant === 'dialog' ? filteredHeadcountFacts.value : filteredHeadcountFacts.value.slice(0, 6));

const headcountDisplay = (item: ProvincialRecruitmentHeadcountFact) => {
  const explicit = String(item.displayValue ?? "").trim();
  if (explicit) return explicit;
  if (Number.isFinite(item.value)) return `${item.isApproximate === false ? "" : "约"}${Number(item.value)}人`;
  return "";
};

const headcountGrainLabel = (value: unknown) => ({
  stated_batch_or_scope_total: "本批次 / 范围合计",
  announcement_row_or_subscope: "单位 / 岗位分项",
}[String(value ?? "")] || "本项数量");

const dayText = (value: unknown) => {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const dateOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) return `${dateOnly[1]}年${Number(dateOnly[2])}月${Number(dateOnly[3])}日`;
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "numeric",
      day: "numeric",
    }).format(parsed);
  }
  const fallback = raw.match(/(\d{4})-(\d{2})-(\d{2})/);
  return fallback ? `${fallback[1]}年${Number(fallback[2])}月${Number(fallback[3])}日` : raw;
};


const locationKindLabel = (value: unknown) => {
  const kind = String(value ?? "").toLowerCase();
  if (/exam|written|interview|assessment|qualification|考试|笔试|面试|资审|体检|测评/.test(kind)) return "考务地点";
  if (/campus|briefing|publicity|fair|presentation|宣讲|校园|双选|招聘活动/.test(kind)) return "校招活动地点";
  if (/work|coverage|management|service|工作|管理|服务|覆盖/.test(kind)) return "工作 / 管理范围";
  return "地点";
};

const normalizedTier = (value: unknown) => {
  const tier = String(value ?? "").trim().toUpperCase();
  if (tier === "A" || tier.startsWith("A_") || tier.startsWith("A-")) return "A";
  if (tier === "B" || tier.startsWith("B_") || tier.startsWith("B-")) return "B";
  if (tier === "C" || tier.startsWith("C_") || tier.startsWith("C-")) return "C";
  return tier || "C";
};
const eventTier = (event: ProvincialRecruitmentEvent) => {
  if (event.evidenceTier) return event.evidenceTier;
  const kind = String(event.sourceKind ?? "").toLowerCase();
  if (/official.*current|current.*official|当届官方/.test(kind)) return "A";
  if (/histor|recover|历史|恢复/.test(kind)) return "B";
  return "C";
};

const toDisplayText = (value: unknown): string => {
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (!value || typeof value !== "object") return "";
  const item = value as Record<string, unknown>;
  const label = item.title || item.label || item.name || item.recruitingSubject || item.subject || item.item || item.stage || item.category;
  const jobTypes = Array.isArray(item.jobTypes) ? item.jobTypes.filter(Boolean).join("、") : "";
  const detail = item.note || item.notes || item.description || item.detail || item.reason || item.resolution || item.value || item.text || jobTypes;
  return [label, detail].filter(Boolean).map(String).join("：");
};

const profileList = (...keys: string[]) => {
  for (const key of keys) {
    const value = unitProfile.value[key];
    if (Array.isArray(value)) return value.map(toDisplayText).filter(Boolean);
    if (value) return [toDisplayText(value)].filter(Boolean);
  }
  return [];
};

const specialSubjects = computed(() => profileList("serviceRecruitmentSubjects", "specialRecruitmentSubjects", "special_recruitment_subjects", "specialSubjects"));
const managementCity = computed(() => String(unitProfile.value.managementCity || unitProfile.value.management_city || "").trim());
const workAreaNote = computed(() => String(unitProfile.value.workAreaNote || unitProfile.value.work_area_note || "").trim());

const isMongdongOnly = computed(() => props.provinceAdcode === "150000");
const displayProvinceName = computed(() => props.data?.province?.name || props.provinceName || "当前省份");
const activeUnitName = computed(() => activeUnit.value ? unitName(activeUnit.value, units.value.indexOf(activeUnit.value)) : "招聘单位待加载");
const idPrefix = computed(() => `province-profile-${props.provinceAdcode || "unknown"}-${props.variant}-${selectedUnitKey.value || "unit"}`.replace(/[^a-zA-Z0-9_-]/g, "-"));
const activeSummary = computed<Record<string, any>>(() => activeUnit.value?.summary ?? {});
const eventCount = computed(() => Number(activeSummary.value.eventCount ?? activeSummary.value.event_count ?? unitEvents.value.length));
const requirementCount = computed(() => Number(activeSummary.value.requirementCount ?? activeSummary.value.requirement_count ?? unitRequirements.value.length));
</script>

<template>
  <section :class="['province-recruitment-profile', `variant-${variant}`]" :aria-busy="loading">
    <div v-if="loading && !data" class="profile-state" role="status">
      <span class="loading-ring" aria-hidden="true"></span>
      <strong :id="headingId">正在读取{{ provinceName }}招聘信息…</strong>
      <p>按单位与批次查看条件和时间。</p>
    </div>

    <div v-else-if="error && !data" class="profile-state error" role="alert">
      <strong :id="headingId">省级资料暂未加载</strong>
      <p>{{ error }}</p>
      <button type="button" @click="emit('retry')">重新加载</button>
    </div>

    <div v-else-if="!units.length" class="profile-state empty">
      <strong :id="headingId">暂无{{ provinceName }}单位招聘信息</strong>
      <button type="button" @click="emit('retry')">重新加载</button>
    </div>

    <template v-else>
      <header class="profile-head">
        <div>
          <span class="profile-eyebrow"><template v-if="data?.cohortYear">{{ data.cohortYear }}届 · </template>招聘指南</span>
          <h2 :id="headingId">{{ displayProvinceName }}报考条件与安排</h2>
          <p>{{ activeUnitName }}<template v-if="data?.dataAsOf"> · 更新 {{ dayText(data.dataAsOf) }}</template></p>
        </div>
        <button v-if="variant === 'panel'" class="open-full" type="button" @click="emit('openFull')">展开查看</button>
      </header>

      <div v-if="isMongdongOnly" class="territory-warning" role="note">
        <strong>国网蒙东</strong>
        <span>适用蒙东经营区域，不包含蒙西电网。</span>
      </div>

      <div v-if="units.length > 1" class="unit-tabs" role="tablist" aria-label="切换招聘单位">
        <button
          v-for="(unit, index) in units"
          :key="unitKey(unit, index)"
          type="button"
          role="tab"
          :aria-selected="selectedUnitKey === unitKey(unit, index)"
          :class="{ active: selectedUnitKey === unitKey(unit, index) }"
          @click="selectedUnitKey = unitKey(unit, index)"
        >
          {{ unitName(unit, index) }}
        </button>
      </div>

      <dl class="profile-metrics">
        <div><dt>招聘批次</dt><dd>{{ activeUnit?.batches?.length ?? batchOptions.length }}</dd></div>
        <div><dt>时间节点</dt><dd>{{ eventCount }}</dd></div>
        <div><dt>报考条件</dt><dd>{{ requirementCount }}</dd></div>
      </dl>

      <div class="batch-tabs" role="tablist" aria-label="按招聘批次筛选">
        <button type="button" role="tab" :aria-selected="selectedBatch === 'all'" :class="{ active: selectedBatch === 'all' }" @click="selectedBatch = 'all'">全部</button>
        <button
          v-for="batch in batchOptions"
          :key="batch"
          type="button"
          role="tab"
          :aria-selected="selectedBatch === batch"
          :class="{ active: selectedBatch === batch }"
          @click="selectedBatch = batch"
        >
          {{ batchLabel(batch) }}
        </button>
      </div>

      <div v-if="managementCity || workAreaNote" class="scope-card">
        <span>管理所在地与工作范围</span>
        <strong v-if="managementCity">{{ managementCity }}</strong>
        <p v-if="workAreaNote">{{ workAreaNote }}</p>
      </div>

      <section v-if="requirementGroups.length" class="profile-section requirements-section" :aria-labelledby="`${idPrefix}-requirements-heading`">
        <div class="section-heading"><div><h3 :id="`${idPrefix}-requirements-heading`">报考条件</h3></div><small>{{ filteredRequirements.length }}项</small></div>
        <details v-for="(group, groupIndex) in requirementGroups" :key="group.key" class="requirement-group" :open="variant === 'dialog' || groupIndex === 0">
          <summary>{{ group.label }}<small>{{ group.items.length }}项</small></summary>
          <div class="requirement-list">
            <article v-for="(item, index) in group.items" :key="item.requirementKey || `${item.category}-${index}`">
              <header><span :class="['evidence-badge', `tier-${normalizedTier(item.evidenceTier).toLowerCase()}`]">{{ recruitmentReadingLabel(item.evidenceTier) }}</span><small>{{ batchLabel(item.batchCode) }}</small></header>
              <strong>{{ item.title || group.label }}</strong>
              <p v-if="item.excerpt">{{ item.excerpt }}</p>
              <small v-if="item.applicability" class="applicability">适用范围：{{ item.applicability }}</small>
            </article>
          </div>
        </details>
      </section>

      <section v-if="visibleHeadcountFacts.length" class="profile-section headcount-section" :aria-labelledby="`${idPrefix}-headcount-heading`">
        <div class="section-heading">
          <div><h3 :id="`${idPrefix}-headcount-heading`">招聘名额</h3></div>
          <small>{{ filteredHeadcountFacts.length }}项</small>
        </div>
        <p class="headcount-boundary" role="note">
          合计与单位、岗位分项分别展示，不重复相加。
        </p>
        <div v-if="visibleHeadcountFacts.length" class="headcount-list">
          <article v-for="(item, index) in visibleHeadcountFacts" :key="item.headcountKey || `${item.batchCode}-${index}`">
            <header>
              <span :class="['evidence-badge', `tier-${normalizedTier(item.evidenceTier).toLowerCase()}`]">{{ recruitmentReadingLabel(item.evidenceTier) }}</span>
              <small>{{ batchLabel(item.batchCode) }}</small>
            </header>
            <strong>{{ headcountDisplay(item) }}</strong>
            <b>{{ headcountGrainLabel(item.aggregationGrain) }}</b>
            <p v-if="item.subjectScope">适用范围：{{ item.subjectScope }}</p>
            <details v-if="item.evidenceExcerpt" class="raw-time"><summary>查看人数说明</summary><p>{{ item.evidenceExcerpt }}</p></details>
          </article>
        </div>
        <button v-if="filteredHeadcountFacts.length > visibleHeadcountFacts.length" type="button" class="more-button" @click="emit('openFull')">查看其余{{ filteredHeadcountFacts.length - visibleHeadcountFacts.length }}项名额</button>
      </section>

      <section class="profile-section timeline-section" :aria-labelledby="`${idPrefix}-timeline-heading`">
        <div class="section-heading">
          <div><h3 :id="`${idPrefix}-timeline-heading`">报名与考试安排</h3></div>
          <small>{{ filteredEvents.length }} 个节点</small>
        </div>
        <ol v-if="visibleEvents.length" class="event-list">
          <li v-for="(event, index) in visibleEvents" :key="event.eventKey || `${event.title}-${index}`">
            <span class="event-index">{{ String(index + 1).padStart(2, '0') }}</span>
            <div class="event-copy">
              <header>
              <span :class="['evidence-badge', `tier-${normalizedTier(eventTier(event)).toLowerCase()}`]">{{ recruitmentReadingLabel(eventTier(event)) }}</span>
                <small>{{ batchLabel(event.batchCode) }}</small>
              </header>
              <strong>{{ event.title || event.eventType || '招聘时间节点' }}</strong>
              <time v-if="event.startsAt || event.startsOn || event.endsAt || event.endsOn" :datetime="event.startsAt || event.startsOn || undefined">{{ eventDate(event) }}</time>
              <b v-if="hasOfficialClockTime(event)">{{ eventClock(event) }}</b>
              <details v-if="event.rawTimeText" class="raw-time">
                <summary>完整行程（非单场时间）</summary>
                <p>{{ event.rawTimeText }}</p>
              </details>
              <p v-if="event.locationText" class="location-line"><span>{{ locationKindLabel(event.locationKind || event.eventType) }}</span>{{ event.locationText }}</p>
              <details v-if="event.evidenceExcerpt" class="raw-time"><summary>查看安排说明</summary><p>{{ event.evidenceExcerpt }}</p></details>
            </div>
          </li>
        </ol>
        <p v-else class="section-empty">当前批次没有已收录的时间安排。</p>
        <button v-if="variant === 'panel' && filteredEvents.length > visibleEvents.length" class="more-button" type="button" @click="emit('openFull')">
          查看其余 {{ filteredEvents.length - visibleEvents.length }} 个节点
        </button>
      </section>

      <section v-if="specialSubjects.length" class="profile-section compact-section">
        <div class="section-heading"><div><h3>招聘类型与单位</h3></div></div>
        <ul><li v-for="item in specialSubjects" :key="item">{{ item }}</li></ul>
      </section>

      <div class="boundary-note">
        <span>往届与参考信息分别标注；条件匹配不等于网申通过或录用。</span>
      </div>
    </template>
  </section>
</template>

<style scoped>
.province-recruitment-profile { min-height: 0; color: #173f5b; }
.variant-panel { display: flex; flex: 1; flex-direction: column; gap: 10px; margin-top: 12px; padding-right: 2px; overflow-y: auto; }
.variant-dialog { display: grid; gap: 14px; }
.profile-state { display: grid; place-items: center; gap: 9px; margin: auto 0; padding: 24px 18px; border: 1px solid #cfe3ee; border-radius: 15px; background: rgba(255,255,255,.72); text-align: center; }
.profile-state strong { font-size: 16px; }
.profile-state p { margin: 0; color: #6c8595; font-size: 11px; line-height: 1.65; }
.profile-state button, .more-button { padding: 8px 11px; border-radius: 8px; color: white; background: #197eb3; font-size: 10px; font-weight: 800; }
.profile-state.error { border-color: #efd0b5; background: #fff9f2; }
.profile-state.error strong { color: #a25f2b; }
.loading-ring { width: 25px; height: 25px; border: 3px solid #d8edf7; border-top-color: #1686bf; border-radius: 50%; animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.profile-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.profile-eyebrow, .section-heading span { color: #378bb6; font-size: 8px; font-weight: 900; letter-spacing: .12em; }
.profile-head h2 { margin: 3px 0; font-size: 18px; }
.variant-dialog .profile-head h2 { font-size: 28px; }
.profile-head p { margin: 0; color: #758d9c; font-size: 9px; }
.open-full { flex: 0 0 auto; padding: 7px 9px; border: 1px solid #acd4e7; border-radius: 8px; color: #1479aa; background: #edf8fd; font-size: 9px; font-weight: 850; }
.territory-warning { display: grid; gap: 3px; padding: 10px 11px; border-left: 4px solid #d18b3f; border-radius: 0 9px 9px 0; color: #735a40; background: #fff5e7; font-size: 9px; line-height: 1.55; }
.territory-warning strong { color: #9a5d20; font-size: 11px; }
.unit-tabs, .batch-tabs { display: flex; flex-wrap: wrap; gap: 5px; }
.unit-tabs button, .batch-tabs button { padding: 7px 9px; border: 1px solid #cfe3ed; border-radius: 8px; color: #58768a; background: white; font-size: 9px; font-weight: 800; }
.unit-tabs button.active, .batch-tabs button.active { border-color: #1686bf; color: white; background: #1686bf; }
.profile-metrics { display: grid; grid-template-columns: repeat(3, 1fr); gap: 5px; margin: 0; }
.profile-metrics div { min-width: 0; padding: 8px; border: 1px solid #d8e8f0; border-radius: 9px; background: rgba(255,255,255,.82); }
.profile-metrics dt { overflow: hidden; color: #78909f; font-size: 8px; text-overflow: ellipsis; white-space: nowrap; }
.profile-metrics dd { margin: 3px 0 0; color: #1377a9; font-size: 17px; font-weight: 900; }
.scope-card { padding: 11px; border: 1px solid #cce3ee; border-radius: 11px; background: #f5fbfe; }
.scope-card > span, .scope-card > strong, .scope-card > small { display: block; }
.scope-card > span { color: #4d8ead; font-size: 8px; font-weight: 850; }
.scope-card > strong { margin-top: 3px; font-size: 13px; }
.scope-card p { margin: 5px 0; color: #587486; font-size: 9px; line-height: 1.55; }
.scope-card small { color: #8a765d; font-size: 8px; }
.coverage-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 5px; }
.coverage-grid span { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 7px 8px; border-radius: 8px; color: #6b8494; background: #edf6fa; font-size: 8px; }
.coverage-grid b { color: #176f9d; font-size: 10px; }
.profile-section { padding: 11px; border: 1px solid #d5e6ee; border-radius: 12px; background: rgba(255,255,255,.82); }
.section-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
.section-heading h3 { margin: 2px 0 0; font-size: 13px; }
.section-heading > small { color: #78909f; font-size: 8px; }
.requirement-list, .source-list { display: grid; gap: 6px; }
.headcount-boundary { margin: 0 0 8px; padding: 7px 8px; border: 1px solid #ead5b5; border-radius: 8px; color: #805f33; background: #fff8ec; font-size: 8px; font-weight: 750; line-height: 1.55; }
.headcount-list { display: grid; gap: 6px; }
.headcount-list article { padding: 9px; border: 1px solid #d7e8f0; border-radius: 9px; background: #f7fbfd; }
.headcount-list article header { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
.headcount-list article header small { color: #78909f; font-size: 8px; }
.headcount-list article > strong { display: block; margin-top: 7px; color: #1377a9; font-size: 18px; line-height: 1.1; }
.headcount-list article > b { display: block; margin-top: 4px; color: #496b7e; font-size: 8px; }
.headcount-list article > p { margin: 5px 0 0; color: #607b8c; font-size: 8px; line-height: 1.55; }
.headcount-list .headcount-excerpt { padding: 6px 7px; border-left: 2px solid #a9d1e4; background: #eef7fb; }
.headcount-list article > a { display: inline-flex; margin-top: 6px; padding: 5px 7px; border-radius: 6px; color: #1478aa; background: #e5f3f9; font-size: 7px; font-weight: 850; text-decoration: none; }
.headcount-more { margin: 7px 0 0; color: #728997; font-size: 8px; line-height: 1.55; }
.requirement-list article { padding: 9px; border-left: 3px solid #4da7d0; border-radius: 0 8px 8px 0; background: #f4fafd; }
.requirement-group + .requirement-group { margin-top: 9px; }.requirement-group > summary { padding: 10px 0; color: #246480; font-size: 11px; font-weight: 700; cursor: pointer; }.requirement-group > summary small { margin-left: 8px; font-size: 9px; color: #758c99; font-weight: 400; }.requirement-list p { white-space: pre-line; overflow-wrap: anywhere; }
.requirement-list header, .event-copy header { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
.requirement-list header > small, .event-copy header > small { color: #78909f; font-size: 8px; }
.requirement-list article > strong { display: block; margin-top: 6px; font-size: 11px; }
.requirement-list p { margin: 4px 0; color: #536f81; font-size: 9px; line-height: 1.65; }
.applicability { display: block; color: #826e54; font-size: 8px; }
.evidence-badge { display: inline-flex; width: fit-content; padding: 3px 5px; border-radius: 5px; color: #08715f; background: #e3f5ef; font-size: 7px; font-weight: 900; }
.evidence-badge.tier-b { color: #9a621e; background: #fff0d8; }
.evidence-badge.tier-c { color: #9a493b; background: #ffe8e1; }
.event-list { display: grid; gap: 7px; margin: 0; padding: 0; list-style: none; }
.event-list li { display: grid; grid-template-columns: 25px minmax(0, 1fr); gap: 8px; padding: 9px; border: 1px solid #dce9ef; border-radius: 9px; background: #f9fcfe; }
.event-index { display: grid; width: 25px; height: 25px; place-items: center; border-radius: 7px; color: white; background: #2d8dbb; font-size: 8px; font-weight: 900; }
.event-copy { min-width: 0; }
.event-copy > strong, .event-copy > time, .event-copy > b { display: block; }
.event-copy > strong { margin-top: 5px; font-size: 11px; line-height: 1.4; }
.event-copy > time { margin-top: 3px; color: #195e82; font-size: 10px; font-weight: 800; }
.event-copy > b { margin-top: 2px; color: #087762; font-size: 9px; }
.event-copy > b.unpublished { color: #95652f; }
.event-copy p { margin: 5px 0 0; color: #607b8c; font-size: 8px; line-height: 1.55; }
.raw-time { padding: 5px 7px; border-radius: 6px; color: #607b8c; background: #eef7fb; font-size: 8px; line-height: 1.55; }
.raw-time summary { cursor: pointer; font-size: inherit; }
.location-line span { display: inline-flex; margin-right: 5px; padding: 2px 4px; border-radius: 4px; color: #7b5c28; background: #fff0cf; font-weight: 850; }
.evidence-excerpt { padding-left: 7px; border-left: 2px solid #bed9e7; }
.certainty { display: block; margin-top: 4px; color: #8799a5; font-size: 7px; }
.more-button { width: 100%; margin-top: 8px; }
.compact-section ul, .gap-section ul { margin: 5px 0 0; padding-left: 17px; color: #5d7788; font-size: 9px; line-height: 1.65; }
.gap-section { border-color: #ecd7ba; background: #fffbf4; }
.gap-section > div + div { margin-top: 9px; }
.gap-section strong { color: #946127; font-size: 9px; }
.tier-legend { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 8px; }
.tier-legend span { padding: 4px 6px; border-radius: 6px; font-size: 7px; font-weight: 850; }
.tier-a { color: #08715f; background: #e3f5ef; }
.tier-b { color: #9a621e; background: #fff0d8; }
.tier-c { color: #9a493b; background: #ffe8e1; }
.source-list article { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: start; gap: 7px; padding: 8px; border-radius: 8px; background: #f5fafc; }
.source-list article div { min-width: 0; }
.source-list article strong, .source-list article small { display: block; }
.source-list article strong { font-size: 9px; line-height: 1.45; }
.source-list article small { margin-top: 2px; color: #7b909d; font-size: 7px; }
.source-list article a, .no-link { align-self: center; padding: 5px 6px; border-radius: 6px; color: #1478aa; background: #e5f3f9; font-size: 7px; font-weight: 850; text-decoration: none; white-space: nowrap; }
.no-link { color: #9a6640; background: #fff1e2; }
.section-empty { margin: 0; padding: 9px; border-radius: 8px; color: #748b99; background: #f1f7fa; font-size: 9px; line-height: 1.55; }
.boundary-note { display: grid; gap: 4px; padding: 10px 11px; border-left: 4px solid #c4873d; border-radius: 0 9px 9px 0; color: #725f48; background: #fff5e6; font-size: 8px; line-height: 1.6; }
.boundary-note strong { color: #965b22; font-size: 9px; }
.variant-dialog .profile-metrics { grid-template-columns: repeat(3, 1fr); }
.variant-dialog .headcount-list { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.variant-dialog .requirement-list { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.variant-dialog .event-list { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.variant-dialog .source-list { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.variant-dialog .source-list article { grid-template-columns: auto minmax(0, 1fr); }
.variant-dialog .source-list article a, .variant-dialog .source-list .no-link { grid-column: 2; justify-self: start; }
@media (max-width: 720px) {
  .variant-dialog .profile-head { padding-right: 44px; }
  .variant-dialog .profile-head h2 { font-size: 22px; }
  .variant-dialog .profile-metrics, .profile-metrics { grid-template-columns: repeat(2, 1fr); }
  .variant-dialog .headcount-list, .variant-dialog .requirement-list, .variant-dialog .event-list, .variant-dialog .source-list { grid-template-columns: 1fr; }
  .source-list article { grid-template-columns: auto minmax(0, 1fr); }
  .source-list article a, .source-list .no-link { grid-column: 2; justify-self: start; }
}
@media (prefers-reduced-motion: reduce) { .loading-ring { animation-duration: 1.8s; } }
</style>
