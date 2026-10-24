<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { authState } from '@/services/auth';
import { DEFAULT_APPLICANT_COHORT, referenceCohortYear } from '@/config/recruitment-cohorts';
import { fetchInformationProvince, type InformationProvinceDetail } from '@/services/mobile-information';
import { navigateInformationPage } from '@/services/information-navigation';
import { requirementParagraphs } from './province-recruitment-display';

const props = withDefaults(defineProps<{ adcode: string; province: string; targetCohortYear?: number }>(), { targetCohortYear: DEFAULT_APPLICANT_COHORT });
const referenceYear = computed(() => referenceCohortYear(props.targetCohortYear));
const data = ref<InformationProvinceDetail | null>(null);
const loading = ref(false);
const error = ref('');
let pending: AbortController | null = null;
const load = async () => {
  pending?.abort();
  data.value = null;
  error.value = '';
  loading.value = false;
  if (!props.adcode || !authState.authenticated) return;
  const controller = new AbortController();
  pending = controller;
  loading.value = true;
  try { const result = await fetchInformationProvince(props.adcode, controller.signal, referenceYear.value); if (!controller.signal.aborted && result.cohortYear === referenceYear.value) data.value = result; }
  catch (cause) { if (!controller.signal.aborted) error.value = cause instanceof Error ? cause.message : '资料暂未加载'; }
  finally { if (pending === controller) loading.value = false; }
};
watch(() => [props.adcode, props.targetCohortYear, authState.authenticated], load, { immediate: true, flush: 'sync' });
onBeforeUnmount(() => pending?.abort());
const requirements = computed(() => {
  const policy = data.value?.earlyBatch.policies.find(item => {
    const target = item.target as { kind?: string } | undefined;
    return target?.kind === 'province' && typeof item.requirements === 'string' && item.requirements.trim();
  });
  if (policy) return { text: String(policy.requirements), label: `${policy.cohortYear ? `${policy.cohortYear}届 · ` : ''}报考参考` };
  const facts = data.value?.earlyBatch.facts.filter(item => item.scope === 'province' && !/^原文条款/.test(item.title)) || [];
  const fact = facts.find(item => /^(招聘要求|提前批要求|提前批招聘要求)$/.test(item.title))
    || facts.find(item => /要求|条件/.test(item.title));
  return fact ? { text: fact.text, label: `${fact.cohortYear ? `${fact.cohortYear}届 · ` : ''}报考参考` } : null;
});
const paragraphs = computed(() => requirementParagraphs(requirements.value?.text || ''));
const open = () => navigateInformationPage({ province: props.province, tab: 'regions', targetCohortYear: props.targetCohortYear });
</script>

<template>
  <section class="province-early-card" aria-label="本省提前批要求" data-qa="province-early-summary">
    <div class="early-heading"><strong>{{ province }} · 提前批要求</strong><span>先看条件</span></div>
    <p v-if="loading" role="status">正在读取本省提前批资料…</p>
    <div v-else-if="error"><p role="alert">{{ error }}</p><button @click="load">重新加载</button></div>
    <template v-else-if="requirements"><small>{{ requirements.label }}</small><div class="early-requirement"><p v-for="(paragraph, index) in paragraphs" :key="index">{{ paragraph }}</p></div></template>
    <p v-else>暂无{{ referenceYear }}届省级提前批统一条件，可继续查看同届城市与单位要求。</p>
    <button class="early-open" @click="open">查看各地条件与招聘流程 ↗</button>
  </section>
</template>

<style scoped>
.province-early-card{margin:12px 0;padding:14px;border:1px solid #b4d9e5;border-radius:12px;background:#eff9fc;color:#174b67}
.early-heading{display:flex;align-items:center;justify-content:space-between;gap:8px}.early-heading strong{font-size:14px}.early-heading span{font-size:10px;color:#337b7e;white-space:nowrap}.province-early-card p{font-size:12px;line-height:1.7;white-space:pre-wrap;margin:9px 0}.province-early-card small{display:block;color:#527487;line-height:1.6;font-size:10px}.early-requirement{max-height:180px;overflow:auto;overscroll-behavior:contain}.province-early-card button{border:1px solid #90c6d8;border-radius:8px;background:white;color:#14698a;padding:9px;cursor:pointer;text-align:left}.early-open{width:100%;margin:8px 0}.province-early-card button:focus-visible{outline:2px solid #0879a5;outline-offset:2px}
</style>
