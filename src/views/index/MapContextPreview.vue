<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ArrowLeftBold, ArrowRight, Close, Location, School } from '@element-plus/icons-vue';
import { previewCountText, type MapContextPreviewData, type MapPreviewEligibilityRequest } from './map-context-preview';
import { provinceBackdropAttribution, provinceBackdropStyle, terrainPreviewStyle } from './map-terrain';
import type { GridRankingRow } from '@/services/grid-information';
import { schoolDataName, schoolProfileTags } from './school-data-display';

export type MapPreviewRankingScope = 'destination' | 'school_location';
export interface MapPreviewRankingRequest { batchCode?: string; label: string; scope?: MapPreviewRankingScope }
export interface MapPreviewRanking { title: string; rows: GridRankingRow[]; loading: boolean; error: string; batchCode?: string; scope?: MapPreviewRankingScope; total?: number }
export interface MapPreviewConditionRow { title: string; excerpt?: string; applicability?: string | null }
export interface MapPreviewConditionGroup { code: string; label: string; rows: MapPreviewConditionRow[] }
export interface MapPreviewConditions { title: string; groups: MapPreviewConditionGroup[]; loading: boolean; error: string }
/** Full-school figures: a batch-filtered ranking row only counts that batch. */
export interface MapPreviewSchoolDetail { schoolKey: string; recordCount: number | null;
  batchCounts: Record<string, number | null>; gridCounts: Record<string, number | null>;
  loading: boolean; error: string }

const props = withDefaults(defineProps<{
  preview: MapContextPreviewData | null;
  loading?: boolean;
  error?: string;
  canOpenDetails?: boolean;
  unavailableYear?: number | null;
  ranking?: MapPreviewRanking | null;
  conditions?: MapPreviewConditions | null;
  schoolDetail?: MapPreviewSchoolDetail | null;
  /** 接口下发的统计口径说明；此前从不渲染，匿名访客看到精确数字却拿不到口径。 */
  disclaimer?: string | null;
}>(), { loading: false, error: '', canOpenDetails: false, ranking: null, conditions: null, schoolDetail: null });
const emit = defineEmits<{
  close: [];
  'open-province': [adcode: string];
  'open-school': [campusKey: string];
  eligibility: [request: MapPreviewEligibilityRequest];
  login: [];
  'request-ranking': [request: MapPreviewRankingRequest];
  'clear-ranking': [];
  'request-conditions': [];
  'clear-conditions': [];
  'request-school-detail': [row: GridRankingRow];
}>();

// Ranking and per-school figures stay inside this card: the user asked for
// drill-down here, not a jump into the eligibility page.
const selectedSchool = ref<GridRankingRow | null>(null);
const cardView = computed(() => (selectedSchool.value ? 'school' : props.ranking ? 'ranking' : props.conditions ? 'conditions' : 'summary'));
watch(() => props.preview?.provinceAdcode, () => { selectedSchool.value = null; emit('clear-ranking'); emit('clear-conditions'); });
watch(() => props.ranking, value => { if (!value) selectedSchool.value = null; });
watch(() => [props.ranking?.scope, props.ranking?.batchCode], () => { selectedSchool.value = null; });
const rankingGeography = computed<MapPreviewRankingScope>(() => props.ranking?.scope ?? 'destination');
const schoolScopeLabel = computed(() => rankingGeography.value === 'school_location'
  ? '全国国网、南网 · 全部批次' : `进入${props.preview?.title ?? '本省'}电网 · 全部批次`);
const rankingCaption = computed(() => rankingGeography.value === 'school_location'
  ? `${props.preview?.title ?? '本省'}的高校，按进入全国国网、南网的录用公示数排名`
  : `全国高校，按进入${props.preview?.title ?? '本省'}电网的录用公示数排名`);
const rankingCountLabel = computed(() => {
  const count = props.ranking?.rows.length ?? 0;
  const total = props.ranking?.total;
  return total !== undefined && total > count ? `前 ${count} 所 · 共 ${total} 所` : `${count} 所学校`;
});
const GRID_LABELS: Record<string, string> = { sgcc: '国家电网', csg: '南方电网' };
const BATCH_LABELS: Record<string, string> = {
  batch_1: '国网第一批', batch_2: '国网第二批', batch_3: '国网第三批',
  csg_autumn: '南网秋招', csg_spring: '南网春招',
};
// A ranking filtered to one batch reports only that batch for each row, so the
// per-school view uses the unfiltered figures the parent fetches on demand.
const schoolFigures = computed(() => {
  const row = selectedSchool.value;
  if (!row) return null;
  const full = props.schoolDetail;
  return full && full.schoolKey === row.schoolKey && !full.loading && !full.error ? full : null;
});
const schoolTotal = computed(() => schoolFigures.value?.recordCount ?? (props.ranking?.batchCode ? null : selectedSchool.value?.recordCount ?? null));
const schoolBreakdown = computed(() => {
  const source = schoolFigures.value ?? (props.ranking?.batchCode ? null : selectedSchool.value);
  if (!source) return [];
  return [
    ...Object.entries(source.gridCounts ?? {}).map(([key, value]) => ({ key, label: GRID_LABELS[key] ?? key, value })),
    ...Object.entries(source.batchCounts ?? {}).map(([key, value]) => ({ key, label: BATCH_LABELS[key] ?? key, value })),
  ].filter(item => item.value !== null && item.value !== undefined);
});
const selectSchool = (row: GridRankingRow) => { selectedSchool.value = row; emit('request-school-detail', row); };
const askRanking = (request: MapPreviewRankingRequest) => { if (props.canOpenDetails) emit('request-ranking', request); };
const backFromRanking = () => { if (selectedSchool.value) selectedSchool.value = null; else emit('clear-ranking'); };
const RANKING_SCOPES: ReadonlyArray<{ batchCode?: string; label: string }> = [
  { label: '总排名' }, { batchCode: 'batch_1', label: '国网一批' }, { batchCode: 'batch_2', label: '国网二批' },
  { batchCode: 'batch_3', label: '国网三批' }, { batchCode: 'csg_autumn', label: '南网秋招' }, { batchCode: 'csg_spring', label: '南网春招' },
];
const switchRankingScope = (scope: { batchCode?: string; label: string }) =>
  askRanking({ ...(scope.batchCode ? { batchCode: scope.batchCode } : {}), label: `${scope.label}学校排名`, scope: rankingGeography.value });
const switchRankingGeography = (scope: MapPreviewRankingScope) => {
  selectedSchool.value = null;
  const batchCode = props.ranking?.batchCode;
  const batch = RANKING_SCOPES.find(item => (item.batchCode ?? '') === (batchCode ?? ''));
  askRanking({ scope, ...(batchCode ? { batchCode } : {}), label: `${batch?.label ?? '总排名'}学校排名` });
};
const publicOnly = computed(() => props.preview?.countBasis === 'released_cells_only');
const hasDecoration = computed(() => props.preview?.kind === 'province' && Boolean(props.preview.provinceAdcode));
const decorationStyle = computed(() => provinceBackdropStyle(props.preview?.provinceAdcode || '')
  ?? terrainPreviewStyle(props.preview?.provinceAdcode || '', 2.5));
const backdropAttribution = computed(() => props.preview?.kind === 'province'
  ? provinceBackdropAttribution(props.preview.provinceAdcode || '') : null);
// Known province cards share one compact heading across summary and drill-down
// views. Unknown, national and school cards retain their original fallback.
const compactProvinceHeading = computed(() => Boolean(backdropAttribution.value && hasDecoration.value && !props.loading && !props.error));
const southernProvincesWithoutCampusRule = new Set(['450000', '460000', '520000', '530000']);
const conditionsAction = computed<{ label: string; batchCode?: MapPreviewEligibilityRequest['batchCode'] }>(() => {
  const province = props.preview?.provinceAdcode;
  // These shortcuts reflect the locally available native channels, not a
  // claim that other provinces have no advance recruitment in the real world.
  if (province === '440000') return { label: '南网提前批条件', batchCode: 'csg_campus' };
  if (province && southernProvincesWithoutCampusRule.has(province)) return { label: '查看报考条件' };
  return { label: '提前批条件', batchCode: 'campus' };
});
const requestEligibility = (campus = false) => {
  if (!props.preview) return;
  emit('eligibility', { provinceAdcode: props.preview.provinceAdcode,
    ...(campus && conditionsAction.value.batchCode ? { batchCode: conditionsAction.value.batchCode } : {}), targetCohortYear: props.preview.targetCohortYear });
};
const openDetails = () => {
  if (!props.canOpenDetails || !props.preview) return;
  if (props.preview.kind === 'province' && props.preview.provinceAdcode) emit('open-province', props.preview.provinceAdcode);
  if (props.preview.kind === 'school' && props.preview.campusKey) emit('open-school', props.preview.campusKey);
};
</script>

<template>
  <section class="map-context-preview" :class="{ 'has-decoration': hasDecoration && !loading && !error, 'has-compact-heading': compactProvinceHeading }" aria-label="地图数据预览" :aria-busy="loading"
    @keydown.esc.stop.prevent="emit('close')">
    <div v-if="hasDecoration && !loading && !error" class="province-decoration" :style="decorationStyle" aria-hidden="true"></div>
    <div class="preview-content">
    <header class="preview-heading">
      <div class="preview-identity">
        <p class="preview-eyebrow">
          <School v-if="preview?.kind === 'school'" aria-hidden="true" />
          <Location v-else aria-hidden="true" />
          <span>{{ preview?.subtitle || '探索电网录用去向' }}</span>
          <span v-if="compactProvinceHeading && preview?.dataCohortYear" class="preview-cohort is-inline">{{ preview.dataCohortYear }} 届录用统计</span>
        </p>
        <div v-if="compactProvinceHeading" class="preview-title-row">
          <h2>{{ preview?.title }}</h2>
          <a v-if="backdropAttribution" class="preview-landmark" :href="backdropAttribution.href"
            target="_blank" rel="noopener noreferrer">{{ backdropAttribution.label }}</a>
        </div>
        <h2 v-else>{{ preview?.title || '全国电网' }}</h2>
        <p v-if="!compactProvinceHeading && preview?.dataCohortYear" class="preview-cohort">{{ preview.dataCohortYear }} 届录用统计</p>
        <div v-if="(cardView === 'summary' || compactProvinceHeading) && preview && !loading && !error && !unavailableYear"
          class="heading-total" :class="{ 'is-inline': compactProvinceHeading }">
          <span>{{ preview.totalLabel }}</span>
          <strong>{{ previewCountText(preview.total) }}</strong>
          <span v-if="compactProvinceHeading" class="heading-scope">{{ preview.scopeLabel }}<span v-if="publicOnly"> · 公开可见部分</span></span>
        </div>
      </div>
      <button v-if="preview?.kind !== 'national'" type="button" class="preview-close" aria-label="关闭地图预览" @click="emit('close')">
        <Close aria-hidden="true" />
      </button>
    </header>

    <nav v-if="canOpenDetails && preview?.kind === 'province' && !loading && !error && !unavailableYear && cardView !== 'conditions'"
      class="ranking-geographies" aria-label="学校排名统计方向">
      <button type="button" :class="{ active: ranking && rankingGeography === 'destination' }"
        :aria-pressed="Boolean(ranking && rankingGeography === 'destination')"
        :aria-label="`全国学校进入${preview.title}电网排名`" @click="switchRankingGeography('destination')">
        <strong>进入{{ preview.title }}电网</strong><span>全国高校排名</span>
      </button>
      <button type="button" :class="{ active: ranking && rankingGeography === 'school_location' }"
        :aria-pressed="Boolean(ranking && rankingGeography === 'school_location')"
        :aria-label="`${preview.title}学校进入全国电网排名`" @click="switchRankingGeography('school_location')">
        <strong>{{ preview.title }}高校</strong><span>进入全国电网排名</span>
      </button>
    </nav>

    <p v-if="loading" class="preview-state" role="status">正在加载录用去向…</p>
    <p v-else-if="error" class="preview-state preview-error" role="status">{{ error }}</p>
    <p v-else-if="unavailableYear" class="preview-state" role="status">暂无{{ unavailableYear }}届录用资料，不以其他届别数据替代。</p>
    <template v-else-if="cardView === 'conditions' && conditions">
      <button type="button" class="preview-back" @click="emit('clear-conditions')">
        <ArrowLeftBold aria-hidden="true" />返回
      </button>
      <p class="preview-scope">{{ conditions.title }}</p>
      <p v-if="conditions.loading" class="preview-state" role="status">正在加载各批次条件…</p>
      <p v-else-if="conditions.error" class="preview-state preview-error" role="status">{{ conditions.error }}</p>
      <p v-else-if="!conditions.groups.length" class="preview-state" role="status">该省暂无已收录的批次条件。</p>
      <div v-else class="preview-conditions">
        <section v-for="group in conditions.groups" :key="group.code">
          <h3>{{ group.label }}<small>{{ group.rows.length }} 条</small></h3>
          <ul>
            <li v-for="(row, i) in group.rows" :key="i">
              <strong>{{ row.title }}</strong>
              <p v-if="row.excerpt">{{ row.excerpt }}</p>
              <small v-if="row.applicability">适用：{{ row.applicability }}</small>
            </li>
          </ul>
        </section>
        <p class="preview-no-count">条件摘自已收录资料，不代替当届官方公告与资格审查。</p>
      </div>
    </template>
    <template v-else-if="cardView !== 'summary' && ranking && canOpenDetails">
      <button type="button" class="preview-back" @click="backFromRanking">
        <ArrowLeftBold aria-hidden="true" />{{ selectedSchool ? ranking.title : '返回' }}
      </button>
      <template v-if="selectedSchool">
        <p class="preview-scope">{{ schoolDataName(selectedSchool) }}</p>
        <div class="preview-reading-surface">
          <div class="preview-total">
            <span>录用公示合计</span><small class="school-statistics-scope">{{ schoolScopeLabel }}</small><strong>{{ previewCountText(schoolTotal) }}</strong>
          </div>
          <p v-if="schoolDetail?.loading" class="preview-no-count">正在加载该校完整统计…</p>
          <p v-else-if="schoolDetail?.error" class="preview-no-count">{{ schoolDetail.error }}</p>
          <dl v-else-if="schoolBreakdown.length" class="preview-batches" aria-label="该校各电网与批次录用统计">
            <div v-for="item in schoolBreakdown" :key="item.key">
              <dt>{{ item.label }}</dt><dd>{{ previewCountText(item.value) }}</dd>
            </div>
          </dl>
          <p v-else class="preview-no-count">该校在此范围内没有可展示的分项数值。</p>
        </div>
      </template>
      <template v-else>
        <p class="preview-scope">{{ ranking.title }}</p>
        <p class="ranking-caption">{{ rankingCaption }}</p>
        <nav class="ranking-scopes" aria-label="排名批次">
          <button v-for="scope in RANKING_SCOPES" :key="scope.label" type="button"
            :class="{ active: (ranking.batchCode || '') === (scope.batchCode || '') }"
            :aria-pressed="(ranking.batchCode || '') === (scope.batchCode || '')"
            @click="switchRankingScope(scope)">{{ scope.label }}</button>
        </nav>
        <p v-if="ranking.loading" class="preview-state" role="status">正在加载学校排名…</p>
        <p v-else-if="ranking.error" class="preview-state preview-error" role="status">{{ ranking.error }}</p>
        <p v-else-if="!ranking.rows.length" class="preview-state" role="status">该范围没有可展示的学校排名。</p>
        <template v-else>
        <p class="ranking-result-count">{{ rankingCountLabel }}</p>
        <ol class="preview-ranking" :aria-label="rankingCaption" tabindex="0">
          <li v-for="(row, position) in ranking.rows" :key="row.schoolKey">
            <button type="button" @click="selectSchool(row)">
              <span class="rank-no">{{ row.rank ?? position + 1 }}</span>
              <span class="rank-name">{{ schoolDataName(row) }}<small v-if="schoolProfileTags(row).length" class="rank-school-tags">{{ schoolProfileTags(row).join(' · ') }}</small></span>
              <span class="rank-count">{{ previewCountText(row.recordCount) }}
                <small v-if="row.gridCounts" class="rank-grid-counts">国网 {{ previewCountText(row.gridCounts.sgcc) }} · 南网 {{ previewCountText(row.gridCounts.csg) }}</small>
              </span>
              <ArrowRight aria-hidden="true" />
            </button>
          </li>
        </ol>
        </template>
      </template>
    </template>
    <template v-else-if="preview">
      <p v-if="!compactProvinceHeading" class="preview-scope">{{ preview.scopeLabel }}<span v-if="publicOnly"> · 公开可见部分</span></p>
      <div class="preview-reading-surface">
        <p v-if="preview.total === null" class="preview-no-count">{{ !canOpenDetails && preview.kind === 'national' ? '登录后查看全国录用总数与各批次统计' : '该范围没有可展示的录用数值' }}</p>
        <dl v-if="preview.metrics.length" class="preview-metrics">
          <div v-for="metric in preview.metrics" :key="metric.key">
            <dt>{{ metric.label }}</dt><dd>{{ previewCountText(metric.value) }}</dd>
          </div>
        </dl>
        <div v-for="group in preview.gridGroups" :key="group.grid" class="preview-grid-group">
          <p class="grid-group-name">{{ group.label }}</p>
          <dl v-if="group.batches.length" class="preview-batches" :aria-label="`${group.label}各批次录用统计`">
            <div v-for="batch in group.batches" :key="batch.key" :class="{ 'is-drillable': canOpenDetails && preview.kind === 'province' }">
              <dt>{{ batch.label }}</dt>
              <dd>{{ previewCountText(batch.value) }}</dd>
              <button v-if="canOpenDetails && preview.kind === 'province'" type="button" class="batch-drill"
                :aria-label="`查看${preview.title}${batch.label}的学校录取排名`"
                @click="askRanking({ batchCode: batch.key, label: `${batch.label}学校排名` })">
                <ArrowRight aria-hidden="true" />
              </button>
            </div>
          </dl>
          <p v-else class="grid-group-empty">{{ !canOpenDetails ? `登录查看${group.label}各批次资料` : `当前筛选暂无${group.label}可展示的批次统计` }}</p>
        </div>
        <button v-if="preview.kind !== 'school'" type="button" class="preview-condition-link" @click="emit('request-conditions')">
          各批次条件 <ArrowRight aria-hidden="true" />
        </button>
      </div>
      <button v-if="!canOpenDetails" type="button" class="preview-primary" @click="emit('login')">
        登录查看详细去向 <ArrowRight aria-hidden="true" />
      </button>
      <button v-else-if="preview.kind === 'national'" type="button" class="preview-primary" @click="requestEligibility()">
        按我的条件找方向 <ArrowRight aria-hidden="true" />
      </button>
      <button v-else type="button" class="preview-primary" @click="openDetails">
        {{ preview.kind === 'school' ? '查看各批次与去向' : `进入${preview.title}` }} <ArrowRight aria-hidden="true" />
      </button>
      <details v-if="disclaimer" class="preview-disclaimer">
        <summary>统计口径说明</summary>
        <p>{{ disclaimer }}</p>
      </details>
    </template>
    <p v-else class="preview-state">选择省份或学校，查看录用去向与报考条件。</p>
    </div>
  </section>
</template>

<style scoped>
.map-context-preview {
  --preview-ink: #103966;
  --preview-muted: #526c86;
  --preview-padding: 20px;
  --preview-radius: 26px;
  --preview-reading-bg: rgba(248, 252, 255, .94);
  position: relative; isolation: isolate; overflow: hidden;
  width: 100%; min-width: 0; box-sizing: border-box; padding: var(--preview-padding);
  color: var(--preview-ink); background: rgba(238, 247, 255, .93);
  border: 1px solid rgba(255, 255, 255, .96); border-radius: var(--preview-radius);
  box-shadow: 0 10px 28px rgba(38, 88, 131, .13), inset 0 0 0 1px rgba(155, 196, 223, .23);
}
@supports ((backdrop-filter: blur(12px)) or (-webkit-backdrop-filter: blur(12px))) {
  .map-context-preview { --preview-reading-bg: rgba(248, 252, 255, .73); background: rgba(235, 246, 255, .8); -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px); }
  .has-decoration .preview-reading-surface, .has-decoration .preview-ranking,
  .has-decoration .preview-conditions li { -webkit-backdrop-filter: blur(1px); backdrop-filter: blur(1px); }
}
.map-context-preview.has-decoration { --preview-reading-bg: rgba(248,252,255,.32); background: rgba(238,247,255,.18); -webkit-backdrop-filter: none; backdrop-filter: none; }
.has-decoration .preview-content { color: #103966; text-shadow: 0 1px 1.5px rgba(255,255,255,.6); }
.has-decoration .preview-primary { text-shadow: none; }
.preview-content { position: relative; z-index: 1; min-width: 0; }
.preview-heading { position: relative; display: flex; align-items: flex-start; gap: 8px; min-width: 0; }
.has-decoration .preview-heading { min-height: 124px; }
.preview-identity { position: relative; flex: 1; min-width: 0; z-index: 1; }
.has-decoration .preview-identity::before { content: ''; position: absolute; inset: -12px -16px -14px calc(-1 * var(--preview-padding)); z-index: -1; pointer-events: none; background: radial-gradient(ellipse 100% 50% at left center, rgba(248,252,255,.72), rgba(248,252,255,.52) 45%, rgba(248,252,255,.15) 75%, rgba(248,252,255,0) 100%); }
.has-decoration .preview-eyebrow, .has-decoration .heading-total > span { color: #244a6b; }
.preview-eyebrow { margin: 0 0 10px; display: flex; align-items: center; gap: 6px; color: var(--preview-muted); font-size: 12px; line-height: 1.45; overflow-wrap: anywhere; }
.preview-eyebrow svg { width: 15px; height: 15px; flex: 0 0 auto; }
h2 { margin: 0; font-size: 28px; line-height: 1.25; font-weight: 750; letter-spacing: -.02em; overflow-wrap: anywhere; }
.preview-cohort { margin: 9px 0 0; font-size: 14px; line-height: 1.5; font-weight: 600; }
/* Scoped specificity also overrides the map shell's former 153px title slot. */
.map-context-preview.has-compact-heading { --preview-muted: #244a6b; }
.map-context-preview.has-compact-heading .preview-content { color: #0b3157; }
.map-context-preview.has-compact-heading .preview-heading { min-height: 0; margin-bottom: 8px; }
.map-context-preview.has-compact-heading .preview-eyebrow { flex-wrap: wrap; gap: 2px 6px; margin-bottom: 4px; color: #173e60; font-weight: 600; }
.map-context-preview.has-compact-heading .preview-cohort.is-inline { margin: 0; font-size: 12px; line-height: inherit; color: #173e60; }
.preview-title-row { display: flex; flex-wrap: wrap; align-items: baseline; gap: 3px 8px; min-width: 0; max-width: 100%; }
.map-context-preview.has-compact-heading .preview-heading h2 { min-width: 0; max-width: 100%; font-size: 26px; line-height: 1.3; color: #0b3157; }
.preview-landmark { display: inline-flex; align-items: center; min-height: 24px; min-width: 0; max-width: 100%; font-size: 12px; line-height: 1.5; font-weight: 650; color: #064a7c; overflow-wrap: anywhere; text-decoration-color: rgba(6,74,124,.65); text-underline-offset: 3px; }
.preview-landmark:focus-visible { outline: 3px solid #096db8; outline-offset: 3px; border-radius: 3px; }
.map-context-preview.has-compact-heading .heading-total.is-inline { display: flex; flex-wrap: wrap; align-items: baseline; gap: 3px 8px; margin: 6px 0 0; min-width: 0; }
.map-context-preview.has-compact-heading .heading-total.is-inline > span { min-width: 0; color: #173e60; line-height: 1.5; overflow-wrap: anywhere; }
.map-context-preview.has-compact-heading .heading-total.is-inline strong { min-width: 0; max-width: 100%; font-size: 20px; line-height: 1.25; color: #0b3157; overflow-wrap: anywhere; }
.map-context-preview.has-compact-heading .heading-total.is-inline .heading-scope { font-size: 11px; font-weight: 600; }
.province-decoration { position: absolute; inset: 0; z-index: 0; background-repeat: no-repeat; pointer-events: none; user-select: none; border-radius: inherit; }
.province-decoration::after {
  content: ''; position: absolute; inset: 0; pointer-events: none;
  background: linear-gradient(90deg, rgba(239,248,254,.4), rgba(239,248,254,.22) 38%, rgba(239,248,254,.04) 100%),
    linear-gradient(180deg, rgba(239,248,254,.02), rgba(239,248,254,.04) 35%, rgba(239,248,254,.12));
}
/* overflow:clip does not create another scroll container. The zero-height
   sticky anchor therefore follows the existing outer card's scrollport. */
@supports (overflow: clip) {
  .map-context-preview { overflow: clip; }
  .province-decoration { position: sticky; inset: auto; top: 0; height: 0; margin: 0 calc(-1 * var(--preview-padding)); border-radius: 0; }
  .province-decoration::before, .province-decoration::after { position: absolute; top: calc(-1 * var(--preview-padding)); left: 0; right: 0; bottom: auto; height: calc(var(--preview-backdrop-height, 100dvh) + var(--preview-padding)); }
  .province-decoration::before { content: ''; background-image: inherit; background-size: inherit; background-position: inherit; background-repeat: inherit; pointer-events: none; }
}
button { font: inherit; cursor: pointer; color: inherit; }
button:focus-visible { outline: 3px solid #096db8; outline-offset: 3px; }
.preview-close { display: grid; place-items: center; border: 1px solid #c8dff0; background: #eef8ff; border-radius: 50%; width: 40px; height: 40px; flex: 0 0 auto; padding: 8px; }
.preview-close svg { width: 20px; height: 20px; }
.preview-close:hover { background: #dcedfa; }
.preview-scope { margin: 14px 0 12px; font-size: 12px; line-height: 1.55; color: var(--preview-muted); overflow-wrap: anywhere; }
.preview-reading-surface { padding: 18px; background: var(--preview-reading-bg); border: 1px solid rgba(255,255,255,.86); border-radius: 18px; box-shadow: inset 0 1px 0 rgba(255,255,255,.85); }
.heading-total { margin: 12px 0 0; display: grid; gap: 2px; }
.heading-total > span { font-size: 12px; font-weight: 600; color: var(--preview-muted); }
.heading-total strong { font-size: clamp(30px, 3vw, 40px); line-height: 1.1; font-weight: 750; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
.preview-total { display: grid; gap: 5px; }
.preview-total > span { font-size: 14px; font-weight: 600; }
.preview-total strong { font-size: clamp(32px, 3.3vw, 44px); line-height: 1.12; font-weight: 750; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.preview-metrics, .preview-batches { margin: 14px 0 0; }
.preview-metrics { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; padding-top: 14px; border-top: 1px solid #d6e6f3; }
.preview-metrics div { min-width: 0; }
.preview-metrics dt { color: var(--preview-muted); font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; }
.preview-metrics dd { margin: 4px 0 0; font-size: 23px; font-weight: 650; font-variant-numeric: tabular-nums; }
.preview-batches div { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; padding: 12px 0; border-top: 1px solid #d6e6f3; }
.preview-batches dt { font-size: 14px; line-height: 1.4; }
.preview-batches dd { margin: 0; font-size: 21px; font-weight: 650; font-variant-numeric: tabular-nums; }
.preview-condition-link { width: 100%; display: flex; justify-content: space-between; align-items: center; min-height: 44px; gap: 8px; border: 0; border-top: 1px solid #d6e6f3; margin-top: 5px; padding: 13px 0 0; background: transparent; font-weight: 600; text-align: left; }
.preview-condition-link:hover { color: #0076bd; }
.preview-condition-link svg, .preview-primary svg { width: 19px; height: 19px; flex: 0 0 auto; }
.preview-primary { width: 100%; display: flex; justify-content: center; align-items: center; min-height: 48px; padding: 12px 16px; gap: 12px; background: #136aa8; color: #fff; border: 1px solid #0b609d; border-radius: 28px; box-shadow: inset 0 1px 0 rgba(255, 255, 255, .35), 0 4px 12px rgba(31, 105, 160, .2); font-size: 15px; font-weight: 650; }
.preview-primary:hover { background: #0d5e99; }
.preview-batches div.is-drillable { display: grid; grid-template-columns: 1fr auto auto; align-items: center; }
.batch-drill { display: grid; place-items: center; width: 30px; height: 30px; margin-left: 8px; padding: 0; border: 0; border-radius: 9px; background: transparent; color: #3f7ba6; }
.batch-drill:hover { background: #dcecf8; color: #0076bd; }
.batch-drill svg { width: 17px; height: 17px; }
.preview-back { display: flex; align-items: center; gap: 6px; margin: 14px 0 0; padding: 9px 12px; border: 1px solid #c8dff0; border-radius: 12px; background: #eef8ff; font-size: 12px; font-weight: 600; }
.preview-back:hover { background: #dcedfa; }
.preview-back svg { width: 14px; height: 14px; }
.preview-ranking { max-height: min(48dvh, 560px); overflow-y: auto; overscroll-behavior-y: contain; scrollbar-width: thin; scrollbar-color: #91b1c5 transparent; list-style: none; margin: 0; padding: 4px 10px; display: grid; background: var(--preview-reading-bg); border: 1px solid rgba(255,255,255,.86); border-radius: 18px; }
.preview-ranking button { display: grid; grid-template-columns: 34px 1fr auto 18px; align-items: center; gap: 10px; width: 100%; padding: 12px 6px; border: 0; border-top: 1px solid #d6e6f3; background: transparent; text-align: left; }
.preview-ranking li:first-child button { border-top: 0; }
.preview-ranking button:hover { background: #eaf4fc; }
.preview-ranking .rank-no { font-size: 13px; font-weight: 700; color: #3f7ba6; font-variant-numeric: tabular-nums; }
.preview-ranking .rank-name { font-size: 14px; min-width: 0; overflow-wrap: anywhere; }
.preview-ranking .rank-count { text-align: right; font-size: 17px; font-weight: 650; font-variant-numeric: tabular-nums; }
.preview-ranking svg { width: 15px; height: 15px; color: #6d8ba3; }
.preview-grid-group + .preview-grid-group { margin-top: 6px; }
.grid-group-name { margin: 14px 0 0; padding-top: 12px; border-top: 1px solid #d6e6f3; font-size: 12px; font-weight: 650; color: #3f6d8b; }
.grid-group-empty { margin: 6px 0 0; font-size: 12px; color: var(--preview-muted); }
.preview-grid-group .preview-batches { margin-top: 0; }
.preview-grid-group .preview-batches div:first-child { border-top: 0; }
.ranking-geographies { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; margin: 12px 0; }
.ranking-geographies button { display: grid; gap: 3px; align-content: center; min-height: 58px; min-width: 0; padding: 9px 7px; border: 1px solid #bad4e6; border-radius: 12px; color: #214d6a; background: rgba(246,252,255,.84); text-align: center; }
.ranking-geographies strong { font-size: 12px; line-height: 1.4; overflow-wrap: anywhere; }
.ranking-geographies span { font-size: 11px; line-height: 1.4; }
.ranking-geographies button.active { background: #136aa8; border-color: #136aa8; color: #fff; text-shadow: none; }
.ranking-caption, .ranking-result-count, .school-statistics-scope { margin: 0 0 10px; font-size: 11px; line-height: 1.5; color: #244a6b; overflow-wrap: anywhere; }
.ranking-caption { padding: 6px 8px; border-radius: 8px; background: rgba(248,252,255,.65); }
.ranking-result-count { margin-bottom: 6px; }
.school-statistics-scope { margin: 0; font-weight: 400; }
.rank-grid-counts { display: block; margin-top: 4px; font-size: 10px; line-height: 1.4; font-weight: 400; color: #3f617b; white-space: nowrap; }
.ranking-scopes { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 12px; }
.ranking-scopes button { padding: 7px 11px; font-size: 11px; color: #45708e; background: #e8f3fc; border: 1px solid #fff; border-radius: 10px; }
.ranking-scopes button.active { background: #136aa8; color: #fff; font-weight: 600; }
.preview-conditions section { margin: 0 0 14px; }
.preview-conditions h3 { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; margin: 0 0 8px; font-size: 13px; font-weight: 650; }
.preview-conditions h3 small { font-size: 11px; font-weight: 400; color: var(--preview-muted); }
.preview-conditions ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.preview-conditions li { display: grid; gap: 4px; padding: 10px 12px; background: var(--preview-reading-bg); border: 1px solid rgba(255,255,255,.86); border-radius: 12px; }
.preview-conditions strong { font-size: 12px; font-weight: 620; }
.preview-conditions p { margin: 0; font-size: 12px; line-height: 1.6; color: #4e6c86; overflow-wrap: anywhere; }
.preview-conditions small { font-size: 11px; color: var(--preview-muted); }
.has-decoration .preview-conditions p, .has-decoration .preview-conditions small,
.has-decoration .grid-group-empty { color: #244a6b; }
.has-decoration .grid-group-name { color: #244a6b; background: linear-gradient(90deg, rgba(248,252,255,.26), rgba(248,252,255,0) 75%); }
.has-decoration .grid-group-empty { width: fit-content; max-width: 100%; padding: 2px 4px; border-radius: 4px; background: rgba(248,252,255,.22); }
.has-decoration .preview-conditions p { color: #103966; background: linear-gradient(90deg, rgba(248,252,255,.22), rgba(248,252,255,.06)); border-radius: 4px; }
.has-decoration .preview-disclaimer { width: fit-content; max-width: 100%; box-sizing: border-box; padding: 6px 8px; border-radius: 8px; background: rgba(248,252,255,.32); }
.has-decoration .preview-disclaimer summary,
.has-decoration .preview-disclaimer p { color: #244a6b; }
.preview-disclaimer { margin-top: 10px; border-top: 1px solid #d5e6f2; padding-top: 8px; }
.preview-disclaimer summary { cursor: pointer; font-size: 12px; color: #4a6b84; list-style: none; }
.preview-disclaimer summary::-webkit-details-marker { display: none; }
.preview-disclaimer summary::after { content: ' ⌄'; }
.preview-disclaimer[open] summary::after { content: ' ⌃'; }
.preview-disclaimer p { margin: 6px 0 0; font-size: 12px; line-height: 1.6; color: #5b7285; }
.preview-state { padding: 22px 0; margin: 0; font-size: 14px; line-height: 1.6; color: var(--preview-muted); }
.preview-error { color: #8f3023; }
.preview-no-count { margin: 8px 0 0; color: var(--preview-muted); font-size: 12px; line-height: 1.5; }
@media (pointer: coarse) { .preview-landmark { min-height: 44px; } }
@media (max-width: 600px) {
  .map-context-preview { --preview-padding: 16px; --preview-radius: 22px; }
  h2 { font-size: 24px; }
  .map-context-preview.has-compact-heading .preview-heading h2 { font-size: 22px; }
  .preview-close { width: 44px; height: 44px; }
}
@media (prefers-reduced-transparency: reduce) {
  .map-context-preview { --preview-reading-bg: #f8fcff !important; -webkit-backdrop-filter: none; backdrop-filter: none; background: #eef7ff !important; }
  .province-decoration { display: none; }
  .has-decoration .preview-content { text-shadow: none; }
  .has-decoration .preview-reading-surface, .has-decoration .preview-ranking,
  .has-decoration .preview-conditions li { -webkit-backdrop-filter: none; backdrop-filter: none; }
}
.touch-performance-mode .map-context-preview,
.low-effects .map-context-preview { -webkit-backdrop-filter: none; backdrop-filter: none; background: #eef7ff; }
.touch-performance-mode .map-context-preview.has-decoration,
.low-effects .map-context-preview.has-decoration { --preview-reading-bg: rgba(248,252,255,.34); background: rgba(238,247,255,.18); }
.touch-performance-mode .preview-reading-surface, .touch-performance-mode .preview-ranking, .touch-performance-mode .preview-conditions li,
.low-effects .preview-reading-surface, .low-effects .preview-ranking, .low-effects .preview-conditions li { -webkit-backdrop-filter: none; backdrop-filter: none; }
@media (prefers-reduced-motion: reduce) {
  .map-context-preview, .province-decoration, .province-decoration::before, .province-decoration::after { animation: none; transition: none; }
}
.rank-school-tags { display: block; font-size: 9px; font-weight: 400; line-height: 1.4; margin-top: 3px; color: #526f84; white-space: normal; }
</style>
