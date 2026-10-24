<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { InformationOverview } from '@/services/mobile-information';
import { educationPreview, insightContext } from './information-insights-display';

const props=defineProps<{overview:InformationOverview}>();
defineEmits<{(e:'open-province',adcode:string):void}>();
const historical=ref(false), selected=ref('sgcc-campus');
const batches=computed(()=>historical.value ? props.overview.educationDistribution?.historicalBatches??[] : props.overview.educationDistribution?.batches??[]);
const batch=computed(()=>batches.value.find(b=>b.key===selected.value)??batches.value[0]);
watch(batches,rows=>{if(!rows.some(b=>b.key===selected.value))selected.value=rows[0]?.key??'';});
</script>

<template>
  <section v-if="overview.educationDistribution&&(overview.educationDistribution.batches.length||overview.educationDistribution.historicalBatches.length)" class="education-distribution" aria-labelledby="education-distribution-title">
    <header><div><span class="eyebrow">按批次看条件</span><h2 id="education-distribution-title">学历要求 · 地区分布</h2></div><span class="year">{{ overview.cohortYear }} 届</span></header>
    <p class="intro">按学历查看地区，展开了解院校、专业与岗位要求；同一地区可有多类岗位。</p>
    <div class="reading-period"><button :class="{active:!historical}" @click="historical=false">{{ overview.cohortYear }} 届条件</button><button v-if="overview.educationDistribution.historicalBatches.length" :class="{active:historical}" @click="historical=true">历史条件参考</button></div>
    <nav aria-label="学历条件批次" class="batch-tabs"><button v-for="item in batches" :key="item.key" :class="{active:item.key===batch?.key}" :aria-pressed="item.key===batch?.key" @click="selected=item.key">{{ item.title }}</button></nav>
    <template v-if="batch">
      <div class="batch-heading"><h3>{{ batch.title }}</h3><span v-if="batch.regionCount">{{ batch.regionCount }} 个招聘地区有条件内容</span></div>
      <div class="degree-groups" :class="{ 'has-single-group': batch.groups.length === 1 }">
        <article v-for="group in batch.groups" :key="group.key" class="degree-group">
          <h4>{{ group.label }} · {{ group.regionCount }} 个招聘地区</h4>
          <details v-for="entry in group.entries" :key="entry.key" class="region-requirement">
            <summary><strong>{{ entry.region }}</strong><span>{{ educationPreview(entry.text) }}</span></summary>
            <div class="requirement-body"><small>{{ insightContext(entry) }}</small><p>{{ entry.text }}</p><small v-if="/qs前100国网院校/i.test(entry.text)">“QS前100国网院校”为资料中的表述，院校范围需结合浙江对应招聘条件核对。</small><div v-if="entry.qualifiers.length" class="qualifiers"><h5>还需同时关注</h5><p v-for="(text,index) in entry.qualifiers" :key="index">{{ text }}</p></div><button v-if="entry.adcode" class="open-region" @click="$emit('open-province',entry.adcode)">查看地区详情 →</button></div>
          </details>
        </article>
      </div>
    </template>
  </section>
</template>

<style scoped>
.education-distribution{padding:24px;border:1px solid #dce9e3;border-radius:22px;background:#fff;color:#183a32;margin:20px 0}.education-distribution header,.batch-heading{display:flex;justify-content:space-between;align-items:center;gap:12px}.eyebrow{font-size:12px;color:#64857b;letter-spacing:.08em}.education-distribution h2{font-size:22px;margin:5px 0}.year{white-space:nowrap;border-radius:20px;background:#eaf4ee;padding:6px 12px;color:#24705c;font-size:13px}.intro,.empty{line-height:1.65;color:#688179;font-size:13px}.reading-period,.batch-tabs{display:flex;gap:8px;flex-wrap:wrap;margin:15px 0}.reading-period button,.batch-tabs button{border:1px solid #d5e5dd;border-radius:20px;background:#f9fcfa;color:#466b5f;padding:8px 13px;cursor:pointer;font:inherit;font-size:13px}.reading-period button.active,.batch-tabs button.active{background:#08765a;color:#fff;border-color:#08765a}.batch-heading h3{font-size:16px;margin:8px 0}.batch-heading>span{font-size:12px;color:#71897f}.degree-groups{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.degree-group{background:#f5f9f6;border-radius:16px;padding:15px;min-width:0}.degree-group h4{margin:0 0 12px;font-size:15px;color:#0b7558}.region-requirement{border-top:1px solid #dce8e1}.region-requirement summary{cursor:pointer;padding:12px 0;line-height:1.5}.region-requirement summary strong{font-size:14px}.region-requirement summary span{display:block;font-size:12px;color:#72877f;margin:4px 0 0;overflow-wrap:anywhere}.requirement-body{padding:0 0 14px;font-size:13px;line-height:1.7;overflow-wrap:anywhere}.requirement-body small{color:#8a9d95}.requirement-body p{white-space:pre-line;margin:8px 0}.qualifiers{border-left:3px solid #aad8c4;padding-left:12px;margin-top:12px}.qualifiers h5{margin:0;color:#5b7b6d;font-size:12px}.open-region{border:0;background:transparent;color:#08765a;padding:6px 0;cursor:pointer}.education-distribution button:focus-visible,.region-requirement summary:focus-visible{outline:3px solid #4eb68f;outline-offset:3px}@media(max-width:620px){.education-distribution{padding:18px 14px}.education-distribution h2{font-size:19px}.degree-groups{grid-template-columns:1fr}.batch-tabs{gap:6px}.batch-tabs button{padding:8px 10px;font-size:12px}.batch-heading{align-items:flex-start}.batch-heading>span{max-width:130px;text-align:right}}
.degree-groups.has-single-group{grid-template-columns:minmax(0,1fr)}
</style>
