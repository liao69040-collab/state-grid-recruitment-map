<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import { Search, Filter, Close } from '@element-plus/icons-vue';
import type { GridFacets } from '@/services/grid-information';
import { gridLabels, gridBatchLabels, gridOrgCategoryLabels, sameGridRegion } from '../index/grid-information-display';
import { defaultInformationFilters, informationCategoryLabels, informationSchoolLevels, selectInformationSchoolLevel, selectedInformationSchoolLevel, informationQuery } from './information-display';
import { informationEducationOptions, informationTierOptions } from './information-filter-options';
import { informationActiveFilters, clearInformationFilter } from './information-filter-state';
const props = defineProps<{ facets: GridFacets | null; kind: 'facts' | 'rankings'; loading: boolean; applied?: Record<string, string>; referenceYear?: number }>();
const model = defineModel<ReturnType<typeof defaultInformationFilters>>({ required: true });
const emit = defineEmits<{ search: []; reset: [] }>();
const expanded = ref(false);
const searchInput = ref<HTMLInputElement | null>(null);
const advancedId = computed(() => `information-advanced-${props.kind}`);
const filterDefaults = computed(() => defaultInformationFilters(props.referenceYear));
const yearOptions = computed(() => [...new Set([Number(filterDefaults.value.cohortYear), ...(props.facets?.years || [])])].sort((a, b) => b - a));
const appliedFilters = computed(() => ({ ...filterDefaults.value, ...(props.applied || model.value) }));
const activeFilters = computed(() => informationActiveFilters(appliedFilters.value, filterDefaults.value, { grids: gridLabels, batches: gridBatchLabels, organizations: gridOrgCategoryLabels }));
const hasDraftChanges = computed(() => props.kind === 'rankings' && props.applied && JSON.stringify(informationQuery(model.value, 'rankings')) !== JSON.stringify(informationQuery(appliedFilters.value, 'rankings')));
const rankingScope = computed(() => [
  appliedFilters.value.province || '全国',
  appliedFilters.value.grid ? gridLabels[appliedFilters.value.grid] : '国网 · 南网',
  appliedFilters.value.batchCode ? gridBatchLabels[appliedFilters.value.batchCode] : '全部批次',
].filter(Boolean).join(' · '));
function removeFilter(key: string) {
  model.value = clearInformationFilter(appliedFilters.value, key, filterDefaults.value);
  emit('search');
  // The clicked chip disappears after submission; keep keyboard users in the
  // search flow instead of leaving focus on the document body.
  void nextTick(() => searchInput.value?.focus({ preventScroll: true }));
}
const cityOptions = computed(() => (props.facets?.cities || []).filter(item => !model.value.province || sameGridRegion(item.province, model.value.province)));
const companies = computed(() => (props.facets?.companies || []).filter(item => !model.value.company || item.includes(model.value.company)).slice(0, 30));
const batchOptions = computed(() => (props.facets?.batches || ['batch_1', 'batch_2', 'batch_3', 'csg_autumn', 'csg_spring'])
  .filter(value => ['campus', 'batch_1', 'batch_2', 'batch_3', 'csg_autumn', 'csg_spring'].includes(value))
  .filter(value => props.kind !== 'rankings' || value !== 'campus')
  .filter(value => model.value.grid !== 'sgcc' || !value.startsWith('csg_'))
  .filter(value => model.value.grid !== 'csg' || value.startsWith('csg_') || props.kind === 'facts' && value === 'campus')
  .sort((a, b) => ['campus', 'batch_1', 'batch_2', 'batch_3', 'csg_autumn', 'csg_spring'].indexOf(a) - ['campus', 'batch_1', 'batch_2', 'batch_3', 'csg_autumn', 'csg_spring'].indexOf(b)));
function selectBatch(batch: string) { model.value.batchCode = batch; emit('search'); }
function selectLevel(level: string) { model.value = selectInformationSchoolLevel(model.value, level, props.facets?.industryTags); emit('search'); }
function changeGrid() {
  if ((model.value.grid === 'sgcc' && model.value.batchCode.startsWith('csg_')) || (model.value.grid === 'csg' && /^batch_/.test(model.value.batchCode))) model.value.batchCode = '';
  if (props.kind === 'rankings') emit('search');
}
function changeProvince() { model.value.city = ''; if (props.kind === 'rankings') emit('search'); }
function changeBatch() { if (props.kind === 'rankings') emit('search'); }
function changeCity() {
  const matches = cityOptions.value.filter(item => item.city === model.value.city);
  if (matches.length === 1) model.value.province = matches[0].province;
}
</script>

<template>
  <div v-if="kind === 'rankings'" class="info-ranking-quick-filters">
    <fieldset class="info-filter-chips"><legend>按批次排名</legend><div><button type="button" :aria-pressed="!model.batchCode" @click="selectBatch('')">按总数</button><button v-for="value in batchOptions" :key="value" type="button" :aria-pressed="model.batchCode === value" @click="selectBatch(value)">{{ gridBatchLabels[value] }}</button></div></fieldset>
    <fieldset class="info-filter-chips"><legend>院校层次</legend><div><button v-for="level in informationSchoolLevels" :key="level.key" type="button" :aria-pressed="selectedInformationSchoolLevel(model) === level.key" @click="selectLevel(level.key)">{{ level.label }}</button></div></fieldset>
  </div>
  <form class="information-filter" :class="{ 'is-ranking-filter': kind === 'rankings' }" @submit.prevent="emit('search')">
    <div v-if="kind === 'facts'" class="info-filter-heading"><strong>查找招聘条件</strong><small>选择范围后，点击下方筛选</small></div>
    <div class="info-search"><Search aria-hidden="true" /><input ref="searchInput" v-model="model.q" type="search" maxlength="120" :aria-label="kind === 'rankings' ? '学校关键词' : '资料关键词'" :placeholder="kind === 'rankings' ? '搜索学校 / 校区名称' : '搜索专业、学历、分数或政策关键词'" /><template v-if="kind === 'rankings'"><button type="submit" :disabled="loading">搜索</button><button type="button" class="info-search-filter-toggle" :aria-expanded="expanded" :aria-controls="advancedId" @click="expanded = !expanded"><Filter aria-hidden="true" /><span>{{ expanded ? '收起' : '筛选' }}</span></button></template></div>
    <div v-if="kind === 'rankings'" class="info-ranking-filter-scope"><span>{{ rankingScope }}</span><button type="button" @click="emit('reset')">重置</button></div>
    <div v-if="kind === 'rankings' && activeFilters.length" class="info-active-filters" role="group" aria-label="已用筛选条件">
      <button v-for="item in activeFilters" :key="item.key" type="button" :aria-label="`移除${item.label}`" @click="removeFilter(item.key)"><span>{{ item.label }}</span><Close aria-hidden="true" /></button>
    </div>
    <p v-if="hasDraftChanges && !loading" class="info-filter-draft" role="status">条件已修改，点击搜索或筛选后更新排名。</p>
    <div v-if="kind === 'facts' || expanded" :id="advancedId" class="info-filter-details">
    <div class="info-filter-main">
      <label><span>电网</span><select v-model="model.grid" @change="changeGrid"><option value="">国网 · 南网</option><option v-for="value in facets?.grids || ['sgcc', 'csg']" :key="value" :value="value">{{ gridLabels[value] || value }}</option></select></label>
      <label><span>{{ kind === 'rankings' ? '录用省份' : '地区' }}</span><select v-model="model.province" @change="changeProvince"><option value="">全国</option><option v-for="province in facets?.provinces || []" :key="province" :value="province">{{ province }}</option></select></label>
      <label><span>批次</span><select v-model="model.batchCode" @change="changeBatch"><option value="">全部批次</option><option v-for="value in batchOptions" :key="value" :value="value">{{ gridBatchLabels[value] || value }}</option></select></label>
    </div>
    <button v-if="kind === 'facts'" type="button" class="info-filter-toggle" :aria-expanded="expanded" @click="expanded = !expanded"><Filter aria-hidden="true" />{{ expanded ? '收起更多条件' : '更多条件' }}</button>
    <div v-if="expanded" class="info-filter-expanded">
      <label v-if="kind === 'facts'">城市<select v-model="model.city" @change="changeCity"><option value="">全部城市 / 省级</option><option v-for="item in cityOptions" :key="`${item.province}:${item.city}`" :value="item.city">{{ item.city }}</option></select></label>
      <label>年份<select v-model="model.cohortYear"><option value="">全部年份</option><option v-if="kind === 'facts'" value="unknown">年份未注明</option><option v-for="year in yearOptions" :key="year" :value="String(year)">{{ year }}届</option></select></label>
      <label>公司<input v-model="model.company" :list="`information-companies-${kind}`" placeholder="输入单位完整名称" /><datalist :id="`information-companies-${kind}`"><option v-for="company in companies" :key="company" :value="company" /></datalist></label>
      <label>院校层次<select v-model="model.schoolTier"><option value="">全部院校层次</option><option v-for="value in informationTierOptions(facets?.schoolTiers)" :key="value" :value="value">{{ value }}</option></select></label>
      <label>{{ kind === 'facts' ? '学历要求' : '学校办学层次' }}<select v-model="model.educationLevel"><option value="">全部</option><option v-for="value in informationEducationOptions(facets?.educationLevels, kind)" :key="value" :value="value">{{ value }}</option></select></label>
      <label v-if="kind === 'facts'">信息类别<select v-model="model.category"><option value="">全部类别</option><option v-for="(label, value) in informationCategoryLabels" :key="value" :value="value">{{ label }}</option></select></label>
      <template v-else>
        <label>招聘单位类别<select v-model="model.orgCategory"><option value="">全部类别</option><option v-for="value in facets?.orgCategories || []" :key="value" :value="value">{{ gridOrgCategoryLabels[value] || value }}</option></select></label>
        <label>电力院校标签<select v-model="model.industryTag"><option value="">全部标签</option><option v-for="value in facets?.industryTags || []" :key="value" :value="value">{{ value }}</option></select></label>
        <label>统计视角<select v-model="model.view"><option value="campus">独立校区</option><option value="parent">母校合并</option></select></label>
      </template>
    </div>
    <div class="info-filter-actions"><button type="button" @click="emit('reset')">重置为全国</button><button type="submit" class="info-primary" :disabled="loading"><Filter aria-hidden="true" />{{ loading ? '正在筛选…' : kind === 'rankings' ? '筛选并查看排名' : '筛选招聘条件' }}</button></div>
    </div>
  </form>
</template>
