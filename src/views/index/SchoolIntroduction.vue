<script setup lang="ts">
import type { GridSchoolIntroduction } from '@/services/grid-map';
defineProps<{ introduction: GridSchoolIntroduction }>();
</script>
<template>
  <section class="school-introduction" aria-label="学校简介">
    <h3>学校简介</h3><p>{{ introduction.text }}</p>
  </section>
</template>
<style scoped>
.school-introduction { padding: 12px; margin: 14px 0; background: #f4f9f9; border: 1px solid #d7e7e8; border-radius: 10px; color: #395e6c; }h3 { margin: 0 0 8px; font-size: 14px; }p { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.8; margin: 0 0 9px; font-size: 12px; }small,.introduction-note { font-size: 10px; color: #758b93; }.introduction-note { margin: 6px 0; }a { display: inline-block; margin: 5px 12px 0 0; font-size: 11px; color: #148076; }
</style>
