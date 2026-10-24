<script setup lang="ts">
import { computed } from 'vue';
import type { RecruitmentCounts, SchoolRecruitmentSummary } from '@/services/grid-map';
import { gridMapBatchOptions, gridMapGridLabel } from './grid-map-display';
const props = defineProps<{ summary: SchoolRecruitmentSummary }>();
const sections = computed(() => [
  ...(props.summary.targetProvince ? [{ label: `去向 ${props.summary.targetProvince.name}`, value: props.summary.targetProvince }] : []),
  ...(props.summary.otherProvinces ? [{ label: '其他地区', value: props.summary.otherProvinces }] : []),
  { label: '全国合计', value: props.summary.national },
]);
const batches = (counts: RecruitmentCounts) => Object.entries(counts.batchCounts).filter(([, value]) => value !== null).map(([key, value]) => ({ label: gridMapBatchOptions.find(option => option[0] === key)?.[1] || `其他批次（${key}）`, value }));
const count = (value: number | null) => value === null ? '' : value.toLocaleString('zh-CN');
</script>
<template>
  <section class="school-recruitment-summary" aria-label="学校全国与各省招聘去向" :data-scope="summary.scope">
    <p>{{ summary.cohortYear }}届 · {{ gridMapGridLabel(summary.grid) }} · 全批次录用公示</p>
    <div class="summary-segments"><article v-for="section in sections.filter(item => item.value.recordCount !== null)" :key="section.label"><header><span>{{ section.label }}</span><strong>{{ count(section.value.recordCount) }}</strong></header><dl><div v-for="batch in batches(section.value)" :key="batch.label"><dt>{{ batch.label }}</dt><dd>{{ count(batch.value) }}</dd></div></dl></article></div>
    <details class="province-distribution"><summary>查看各省录用分布</summary><div class="province-distribution-list"><article v-for="(destination, index) in summary.destinations" :key="`${destination.provinceAdcode || destination.provinceName || 'unassigned'}:${index}`"><header><b>{{ destination.provinceName || '其他单位' }}</b><strong>{{ count(destination.recordCount) }}</strong></header><div class="batch-chips"><span v-for="batch in batches(destination)" :key="batch.label">{{ batch.label }} <b>{{ count(batch.value) }}</b></span></div></article></div></details>
  </section>
</template>
<style scoped>
.province-distribution-list { max-height: 320px; overflow-y: auto; overscroll-behavior: contain; }
.school-recruitment-summary { --summary-accent: #126f93; width: 100%; min-width: 0; color: inherit; font-size: 12px; }p { color: #6d8491; line-height: 1.7; } .summary-segments { display: grid; grid-template-columns: repeat(auto-fit,minmax(min(100%,180px),1fr)); gap: 8px; }article { min-width: 0; padding: 11px; border: 1px solid #d5e6ec; border-radius: 9px; background: #f8fcfd; }header { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; overflow-wrap: anywhere; }header strong { color: var(--summary-accent); font-size: 21px; white-space: nowrap; }small { margin-left: 3px; font-size: 10px; }dl { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 8px; margin: 12px 0 0; }dl div { display: flex; justify-content: space-between; gap: 4px; }dt { color: #65828d; font-size: 10px; }dd { margin: 0; font-weight: 650; color: var(--summary-accent); }.province-distribution { margin-top: 14px; }.province-distribution summary { cursor: pointer; padding: 7px 0; }.province-distribution article { margin-top: 7px; }.province-distribution header strong { font-size: 14px; }.batch-chips { display: flex; flex-wrap: wrap; gap: 5px 12px; margin-top: 9px; color: #6c8290; font-size: 10px; }.batch-chips b { color: var(--summary-accent); }
</style>
