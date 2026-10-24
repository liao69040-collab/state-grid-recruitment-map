<script setup lang="ts">
import { computed } from 'vue';
import type { InformationCard } from '@/services/mobile-information';
import { informationMetricText, populatedInformationMetrics } from '../information/information-display';
const props = defineProps<{ cards: InformationCard[]; scope: string; cohortYear?: number; compact?: boolean }>();
const populated = computed(() => props.cards.map(card => ({ card, rows: populatedInformationMetrics(card).filter(row => row.metric.metricType === 'public_notice_record_count'), additional: populatedInformationMetrics(card).filter(row => ['application_count', 'application_entries_reference', 'exam_attendance', 'exam_attendance_count'].includes(row.metric.metricType)) })).filter(item => item.rows.length));
</script>
<template>
  <section v-if="populated.length" class="grid-batch-statistics" :class="{ compact }" :aria-label="`${scope}各批次统计`">
    <p class="batch-scope">{{ scope }} · {{ cohortYear || cards[0]?.cohortYear }}届录用公示</p>
    <article v-for="{ card, rows, additional } in populated" :key="card.key" class="batch-stat-card">
      <h4>{{ card.title }}</h4>
      <dl><div v-for="row in rows" :key="row.label"><dt>录用公示</dt><dd>{{ informationMetricText(row.metric) }}</dd></div><div v-for="row in additional" :key="row.label"><dt>{{ row.label }}</dt><dd>{{ informationMetricText(row.metric) }}<small>{{ row.metric.measureUnit }}</small></dd></div></dl>
    </article>
  </section>
</template>
<style scoped>
.grid-batch-statistics { display: grid; gap: 9px; flex: 0 0 auto; }
.batch-scope { margin: 0; color: #71899a; font-size: 10px; line-height: 1.6; }
.batch-stat-card { padding: 11px 12px; border: 1px solid #d5e7f1; border-radius: 10px; background: #f7fbfe; }
h4 { margin: 0 0 9px; color: #245e7d; font-size: 13px; }
dl { display: grid; gap: 8px; margin: 0; } dl div { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }dt { color: #708999; font-size: 11px; }dd { margin: 0; color: #076b9f; font-size: 19px; font-weight: 700; text-align: right; overflow-wrap: anywhere; }dd small { margin-left: 4px; font-size: 10px; font-weight: 400; }
details { margin-top: 8px; font-size: 10px; line-height: 1.7; color: #607f92; } summary { cursor: pointer; } .batch-evidence { padding-top: 8px; }p { margin: 3px 0; }small { overflow-wrap: anywhere; } .batch-evidence small { display: block; }
.compact { gap: 0; margin-bottom: 16px; }
.compact .batch-scope { margin-bottom: 8px; }
.compact .batch-stat-card { display: grid; grid-template-columns: minmax(0,1fr) auto; align-items: center; gap: 8px; border-radius: 0; border-width: 0 0 1px; padding: 12px 4px; background: transparent; }
.compact h4 { margin: 0; font-size: 12px; }
.compact dl div { gap: 8px; }
.compact dt { font-size: 10px; }
.compact dd { font-size: 20px; }
</style>
