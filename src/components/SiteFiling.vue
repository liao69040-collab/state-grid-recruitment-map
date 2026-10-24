<script setup lang="ts">
import { siteFiling } from '@/config/site-filing';
</script>
<template>
  <span class="site-filing">
    <a v-if="siteFiling.icpNumber" :href="siteFiling.icpUrl" target="_blank" rel="noopener noreferrer">{{ siteFiling.icpNumber }}</a>
    <a href="/assets/grid-atmosphere/credits.html" target="_blank" rel="noopener noreferrer">背景署名</a>
  </span>
</template>
<style scoped>
.site-filing { display: inline-flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 4px 10px; background: transparent; border: 0; box-shadow: none; padding: 0; line-height: 1.5; }
.site-filing a { color: #315878; font-size: 10px; text-underline-offset: 3px; }
.site-filing a:hover { color: #065c98; }
.site-filing a:focus-visible { outline: 3px solid #096db8; outline-offset: 3px; }
@media (pointer: coarse) { .site-filing a { min-height: 44px; display: inline-flex; align-items: center; } }
</style>
