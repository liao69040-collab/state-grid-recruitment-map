<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import { authState } from '@/services/auth';
import { fetchInformationOverview, type InformationOverview } from '@/services/mobile-information';
import RecruitmentReferencePanel from './RecruitmentReferencePanel.vue';

const props = withDefaults(defineProps<{ cohortYear: number; provinceAdcode?: string; grid?: string; batchCode?: string; docked?: boolean }>(), { provinceAdcode: '', grid: '', batchCode: '', docked: false });
const expanded = ref(false);
const overview = ref<InformationOverview | null>(null);
const loading = ref(false);
const error = ref('');
let controller: AbortController | null = null;
let generation = 0;
let disposed = false;

async function load() {
  controller?.abort();
  const id = ++generation;
  overview.value = null; error.value = ''; loading.value = false;
  if (!authState.authenticated || !expanded.value || disposed) return;
  const request = new AbortController(); controller = request;
  const year = props.cohortYear;
  loading.value = true;
  try {
    const result = await fetchInformationOverview(request.signal, year);
    if (disposed || request.signal.aborted || id !== generation || !authState.authenticated || props.cohortYear !== year) return;
    overview.value = result;
  } catch (cause) {
    if (disposed || request.signal.aborted || id !== generation || !authState.authenticated) return;
    error.value = cause instanceof Error ? cause.message : '资料暂时无法读取，请重试。';
  } finally { if (id === generation && !disposed) loading.value = false; }
}
watch([() => props.cohortYear, () => authState.authenticated, expanded], () => { void load(); });
onBeforeUnmount(() => { disposed = true; generation++; controller?.abort(); overview.value = null; });
function toggle(event: Event) { expanded.value = (event.currentTarget as HTMLDetailsElement).open; }
</script>

<template>
  <details v-if="authState.authenticated" class="reference-home" :class="{ docked }" @toggle="toggle" @keydown.esc="expanded=false" :open="expanded">
    <summary>报名与学历 <span>{{ cohortYear }}届</span></summary>
    <div v-if="expanded" class="reference-home-content">
      <p v-if="loading" role="status">正在读取…</p>
      <div v-else-if="error" role="alert"><p>{{ error }}</p><button type="button" @click="load">重新读取</button></div>
      <RecruitmentReferencePanel v-else-if="overview" :overview="overview" :province-adcode="provinceAdcode" :grid="grid" :batch-code="batchCode" />
    </div>
  </details>
</template>

<style scoped>
.reference-home { margin: 16px 0; border: 1px solid #ffffffd9; border-radius: 18px; color: #173e63; background: #f8fcffb3; box-shadow: 0 8px 24px #204d7910; }
.reference-home summary { min-height: 44px; padding: 12px 14px; box-sizing: border-box; font-size: 14px; font-weight: 650; cursor: pointer; }
.reference-home summary span { color: #496c84; font-size: 12px; font-weight: 400; margin-left: 8px; }
.reference-home-content { padding: 0 12px 12px; font-size: 14px; }
.reference-home-content > p { margin: 10px 0; }
.reference-home-content button { min-height: 44px; color: #165d87; padding: 8px 12px; background: #fff9; border-radius: 12px; }
.reference-home.docked { margin: 0; border: 0; background: transparent; box-shadow: none; }
.reference-home.docked summary { min-height: 32px; padding: 8px; font-size: 11px; }
.reference-home.docked summary span { display: none; }
.reference-home.docked .reference-home-content { position: absolute; bottom: 48px; left: 50%; transform: translateX(-50%); width: min(1040px, calc(100vw - 48px)); max-height: 65dvh; overflow-y: auto; overscroll-behavior: contain; border: 1px solid #ffffffd9; border-radius: 20px; padding: 16px; box-sizing: border-box; background: #f2f9fff2; box-shadow: 0 16px 44px #204d7930; backdrop-filter: blur(12px); }
@media (prefers-reduced-transparency: reduce) { .reference-home, .reference-home.docked .reference-home-content { background: #f2f9ff; backdrop-filter: none; } }
@media (max-width: 700px) { .reference-home summary span { display: block; margin: 4px 0 0; } .reference-home.docked .reference-home-content { width: calc(100vw - 24px); padding: 10px; } }
</style>
