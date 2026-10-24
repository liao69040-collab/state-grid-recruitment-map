<script setup lang="ts">
import ToastStack from "@/components/ToastStack.vue";
import PowerAtmosphere from "@/components/PowerAtmosphere.vue";
import transmissionPhoto from "@/assets/transmission-20261004.webp";
const syntheticDemo = import.meta.env.VITE_SYNTHETIC_DEMO === 'true';
</script>

<template>
  <div class="liquid-admin" :class="{ 'synthetic-demo': syntheticDemo }">
    <div v-if="syntheticDemo" class="synthetic-demo-notice" role="note">合成演示 · 学校与录用数均为虚构</div>
    <PowerAtmosphere :photo-url="transmissionPhoto" />
    <RouterView />
    <ToastStack />
  </div>
</template>

<style scoped>
.synthetic-demo { box-sizing: border-box; padding-top: 24px; }
.synthetic-demo-notice {
  position: fixed; inset: 0 0 auto; z-index: 100000;
  height: 24px; display: flex; align-items: center; justify-content: center;
  padding: 0 8px; box-sizing: border-box; pointer-events: none;
  color: #574214; background: #fff3cc; border-bottom: 1px solid #e2cd8d;
  font: 600 11px/1.2 system-ui, "PingFang SC", sans-serif;
  letter-spacing: .03em;
}
.synthetic-demo :deep(.sidebar) { top: 24px; }
.synthetic-demo :deep(.app-shell),
.synthetic-demo :deep(.login-page) { min-height: calc(100dvh - 24px); }
</style>
