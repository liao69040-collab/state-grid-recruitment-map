<script setup lang="ts">
import { RouterView } from "vue-router";
</script>

<template>
  <main class="app-viewport">
    <RouterView />
  </main>
</template>

<style scoped>
.app-viewport {
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100dvh;
  min-width: 320px;
  overflow: hidden;
  color: #163850;
  background: #e8f5fc;
}
</style>
