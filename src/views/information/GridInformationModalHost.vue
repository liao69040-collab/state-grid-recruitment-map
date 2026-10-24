<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { DEFAULT_APPLICANT_COHORT, referenceCohortYear } from '@/config/recruitment-cohorts';
import { Close } from '@element-plus/icons-vue';
import { INFORMATION_OPEN_EVENT, type InformationPageTarget } from '@/services/information-navigation';
import GridInformationMobile from './GridInformationMobile.vue';

const emit = defineEmits<{ unauthorized: [] }>();
const target = ref<InformationPageTarget | null>(null);
const referenceYear = computed(() => referenceCohortYear(target.value?.targetCohortYear || DEFAULT_APPLICANT_COHORT));
const panel = ref<HTMLElement | null>(null);
const identity = ref(0);
let restoreFocus: HTMLElement | null = null;
let priorOverflow = '';
let background: { element: HTMLElement; inert: boolean }[] = [];
function open(event: Event) {
  const detail = (event as CustomEvent<InformationPageTarget>).detail || {};
  if (!target.value) {
    restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    priorOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    background = Array.from(document.body.children).filter((node): node is HTMLElement => node instanceof HTMLElement && !node.hasAttribute('data-information-modal'))
      .map(element => ({ element, inert: element.inert }));
    background.forEach(({ element }) => { element.inert = true; });
  }
  target.value = { province: detail.province || '', city: detail.city || '', tab: detail.tab || (detail.province ? 'regions' : 'batches'), targetCohortYear: detail.targetCohortYear || DEFAULT_APPLICANT_COHORT };
  identity.value++;
  void nextTick(() => panel.value?.focus());
}
function close() {
  target.value = null;
  background.forEach(({ element, inert }) => { element.inert = inert; });
  background = [];
  document.body.style.overflow = priorOverflow;
  void nextTick(() => restoreFocus?.isConnected && restoreFocus.focus());
}
function unauthorized() { close(); emit('unauthorized'); }
function keys(event: KeyboardEvent) {
  // Inner detail sheets consume Escape/Tab first.
  if (event.defaultPrevented) return;
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
  if (event.key !== 'Tab') return;
  const controls = Array.from(panel.value?.querySelectorAll<HTMLElement>('button:not([disabled]), input, select, a[href], summary, [tabindex="0"]') || [])
    .filter(item => item.getClientRects().length && !item.closest('[inert]'));
  const first = controls[0], last = controls.at(-1);
  if (!first) { event.preventDefault(); return; }
  if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.value)) { event.preventDefault(); last?.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}
onMounted(() => window.addEventListener(INFORMATION_OPEN_EVENT, open));
onBeforeUnmount(() => { window.removeEventListener(INFORMATION_OPEN_EVENT, open); if (target.value) close(); });
</script>

<template>
  <Teleport to="body">
    <div v-if="target" class="information-window-backdrop" data-information-modal @click.self="close">
      <section ref="panel" class="information-window" role="dialog" aria-modal="true" :aria-label="`${referenceYear}届信息汇总`" tabindex="-1" @keydown="keys">
        <header class="information-window-bar"><span>{{ referenceYear }}届信息汇总</span><button aria-label="关闭信息汇总" @click="close"><Close aria-hidden="true" />关闭</button></header>
        <GridInformationMobile :key="identity" :province="target.province" :city="target.city" :initial-tab="target.tab" :target-cohort-year="target.targetCohortYear" @unauthorized="unauthorized" />
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.information-window-backdrop { position: fixed; inset: 0; z-index: 2147482000; padding: 20px; display: flex; align-items: center; justify-content: center; background: #102f4566; }
.information-window { width: min(1080px, 100%); height: min(960px, calc(100dvh - 40px)); display: flex; flex-direction: column; overflow: hidden; border-radius: 20px; background: #eef3ef; box-shadow: 0 24px 90px #06263a55; color: #183d33; }
.information-window-bar { display: flex; align-items: center; justify-content: space-between; padding: 10px 18px; background: #fff; border-bottom: 1px solid #dce6df; font: 600 14px/1.5 system-ui, sans-serif; }
.information-window-bar button { display: flex; align-items: center; gap: 5px; border: 1px solid #d4e2d8; border-radius: 9px; background: #f2f7f3; color: #315c4b; padding: 8px 12px; cursor: pointer; font: inherit; }
.information-window-bar button:focus-visible { outline: 3px solid #168966; outline-offset: 2px; }
.information-window-bar svg { width: 17px; height: 17px; }
.information-window :deep(.information-mobile) { height: auto; flex: 1; min-height: 0; }
@media(max-width: 650px), (max-height: 480px) { .information-window-backdrop { padding: 0; }.information-window { height: 100dvh; width: 100%; border-radius: 0; } }
</style>
