<script setup lang="ts">
import { computed, ref } from 'vue';
import { authState } from '@/services/auth';
import type { PhotoProvinceSupplement, PhotoScoreColumn, PhotoUnitRequirements } from '@/services/photo-materials';

const props = defineProps<{ supplement?: PhotoProvinceSupplement | null; unitRequirements?: PhotoUnitRequirements | null; requirementsOnly?: boolean }>();
const data = computed(() => authState.authenticated && props.supplement?.schemaVersion === 'grid-photo-supplement-1' && props.supplement.cohortYear === 2026 ? props.supplement : null);
const units = computed(() => authState.authenticated && props.unitRequirements?.schemaVersion === 'grid-photo-supplement-1' && props.unitRequirements.cohortYear === 2026 ? props.unitRequirements : null);
const groups = computed(() => props.requirementsOnly ? units.value?.groups ?? [] : data.value?.requirementGroups ?? []);
const sources = computed(() => props.requirementsOnly ? units.value?.sources ?? [] : data.value?.sources ?? []);
const selected = ref<Record<string, string>>({});
const column = (unitKey: string, columns: PhotoScoreColumn[]) => columns.find(row => row.key === selected.value[unitKey]) ?? columns[0];
const strengthLabel = (strength: 'required' | 'preferred' | 'reference') => ({ required: '要求', preferred: '优先', reference: '参考' })[strength];
const scoreText = (score: number) => Number.isFinite(score) && score >= 0 && score <= 100 ? String(score) : '—';
</script>

<template>
  <section v-if="requirementsOnly ? groups.length : data && (data.examLocations.length || data.scoreGroups.length || groups.length)" class="photo-supplement" aria-label="衡真教育整理资料">
    <p class="photo-caption">衡真教育整理 · 历史资料参考</p>
    <details v-if="!requirementsOnly && data?.examLocations.length" class="photo-block">
      <summary>笔试地点参考</summary>
      <p class="photo-note">图片未注明年份/批次，实际地点以当次准考证为准。</p>
      <dl class="photo-locations"><div v-for="row in data.examLocations" :key="`${row.unitKey}:${row.evidenceLocator}`"><dt>{{ row.unitName }}</dt><dd>{{ row.address }}</dd></div></dl>
    </details>
    <details v-if="!requirementsOnly && data?.scoreGroups.length" class="photo-block">
      <summary>2026届笔试分数线</summary>
      <p class="photo-note">笔试分数参考，不代表综合录取线或最终录用；按招聘主体、批次、专业与学历分别查看。</p>
      <article v-for="group in data.scoreGroups" :key="group.unitKey" class="photo-unit">
        <h4>{{ group.unitName }}</h4>
        <div class="photo-batch-tabs" role="group" :aria-label="`${group.unitName}分数批次`" data-swipe-ignore><button v-for="item in group.columns" :key="item.key" type="button" :aria-pressed="column(group.unitKey,group.columns)?.key === item.key" @click="selected[group.unitKey]=item.key">{{ item.title }}</button></div>
        <template v-if="column(group.unitKey,group.columns)">
          <p v-if="column(group.unitKey,group.columns)!.segment === 'sc'" class="photo-scope">第三批仅三产，不与省公司主批次合并。</p>
          <p v-else-if="column(group.unitKey,group.columns)!.segment === 'supply_service'" class="photo-scope">供电服务 · 原图未注明批次。</p>
          <dl v-if="column(group.unitKey,group.columns)!.status === 'recorded' && column(group.unitKey,group.columns)!.entries.length" class="photo-score-rows"><div v-for="(entry,index) in column(group.unitKey,group.columns)!.entries" :key="`${entry.label}:${index}`"><dt>{{ entry.label }}<small v-if="entry.qualifier">{{ entry.qualifier }}</small></dt><dd>{{ scoreText(entry.score) }}<small>分</small></dd></div></dl>
          <p v-else class="photo-note">{{ column(group.unitKey,group.columns)!.status === 'slash' ? '原资料为“/”，未给出分数。' : column(group.unitKey,group.columns)!.status === 'not_threshold' ? '该栏为条件说明，未给出可展示的分数线。' : '原资料未填写分数。' }}</p>
          <details v-if="column(group.unitKey,group.columns)!.originalText" class="photo-original"><summary>查看资料原文</summary><p>{{ column(group.unitKey,group.columns)!.originalText }}</p></details>
        </template>
      </article>
    </details>
    <details v-if="groups.length" class="photo-block">
      <summary>{{ requirementsOnly ? '直属单位材料参考' : '2026届报名材料' }}</summary>
      <p class="photo-note">材料与证书要求参考；以各招聘单位、岗位及当届公告为准。这里不作个人资格判定。</p>
      <article v-for="group in groups" :key="group.unitKey" class="photo-unit"><h4>{{ group.unitName }}</h4><ul class="photo-requirements"><li v-for="item in group.items" :key="item.key"><header><strong>{{ item.label }}</strong><span :class="`photo-strength-${item.strength}`">{{ strengthLabel(item.strength) }}</span></header><p>{{ item.text }}</p></li></ul></article>
    </details>
    <details v-if="sources.length" class="photo-original photo-sources"><summary>资料来源与说明</summary><p v-for="source in sources" :key="source.sourceKey"><strong>{{ source.title }}</strong><br />{{ source.note }}</p></details>
  </section>
</template>

<style scoped>
.photo-supplement{margin:10px 0;color:#183d50;font-size:13px;line-height:1.6;min-width:0}.photo-caption{margin:0 0 5px;font-size:11px;color:#496573}.photo-block{border-bottom:1px solid #c9dce5}.photo-block>summary,.photo-original>summary{min-height:44px;box-sizing:border-box;padding:10px 4px;cursor:pointer;font-weight:650;color:#14586b;overflow-wrap:anywhere}.photo-note,.photo-scope{margin:4px 0 10px;font-size:12px;color:#486574;overflow-wrap:anywhere}.photo-scope{color:#235269}.photo-unit{padding:8px 0}.photo-unit+.photo-unit{border-top:1px solid #d4e2e8}.photo-unit h4{margin:0 0 6px;font-size:14px;color:#153f53}.photo-batch-tabs{display:flex;gap:5px;flex-wrap:wrap}.photo-batch-tabs button{font:inherit;font-size:12px;min-height:44px;padding:6px 10px;border:1px solid #a8cbd8;border-radius:8px;color:#155167;background:#eef7fa;cursor:pointer}.photo-batch-tabs button[aria-pressed=true]{background:#145e76;border-color:#145e76;color:#fff}.photo-locations,.photo-score-rows{margin:0}.photo-locations>div{padding:7px 0}.photo-locations dt{font-weight:650}.photo-locations dd{margin:2px 0 0;overflow-wrap:anywhere}.photo-score-rows>div{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;padding:7px 2px;border-bottom:1px solid #d6e4e9}.photo-score-rows dt{min-width:0;overflow-wrap:anywhere}.photo-score-rows dt small{display:block;color:#486574;font-size:11px}.photo-score-rows dd{margin:0;font-size:16px;font-weight:700;font-variant-numeric:tabular-nums;color:#104c64;white-space:nowrap}.photo-score-rows dd small{font-size:11px;font-weight:400;margin-left:3px}.photo-original>summary{font-size:12px;font-weight:400}.photo-original>p,.photo-requirements p{margin:3px 0 10px;white-space:pre-line;overflow-wrap:anywhere}.photo-requirements{list-style:none;padding:0;margin:0}.photo-requirements li{padding:6px 0}.photo-requirements header{display:flex;align-items:flex-start;gap:8px;justify-content:space-between}.photo-requirements header strong{min-width:0;overflow-wrap:anywhere}.photo-requirements header span{flex:none;font-size:11px;padding:1px 6px;border-radius:5px;background:#eaf3f8;color:#315c73}.photo-requirements header .photo-strength-preferred{background:#f5f0df;color:#725315}.photo-sources{margin-top:2px}.photo-supplement summary:focus-visible,.photo-supplement button:focus-visible{outline:3px solid #3295b5;outline-offset:2px}@media(prefers-reduced-transparency:reduce){.photo-batch-tabs button{background:#eef7fa}}@media(prefers-contrast:more){.photo-supplement,.photo-note,.photo-caption{color:#12394d}.photo-block,.photo-score-rows>div{border-color:#7c9ba9}}
</style>
