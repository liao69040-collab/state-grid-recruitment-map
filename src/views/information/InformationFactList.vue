<script setup lang="ts">
import { computed } from 'vue';
import type { GridFact } from '@/services/grid-information';
import type { InformationFact } from '@/services/mobile-information';
import { informationFactContext, informationFactDisplayText, informationFactPreview, informationFactTitle, summarizeInformationFacts } from './information-display';
const props = withDefaults(defineProps<{ items: (GridFact | InformationFact)[]; foldIndexes?: boolean }>(), { foldIndexes: true });
const groups = computed(() => summarizeInformationFacts(props.items));
</script>

<template>
  <div class="information-facts" data-qa="organized-information-facts">
    <section v-for="group in groups" :key="group.key" class="info-fact-group" :aria-label="group.title">
      <header><h3>{{ group.title }}</h3><small>{{ group.description }}</small></header>
      <div class="info-fact-rows">
        <details v-for="item in group.items" :key="`${item.datasetKey}:${item.factKey}`" class="info-fact-row">
          <summary><span class="info-fact-row-heading"><strong>{{ informationFactTitle(item.title) }}</strong><span class="info-fact-expand">展开</span></span><small>{{ informationFactContext(item) }}</small><span class="info-fact-preview"><span v-for="(line, index) in informationFactPreview(item.text)" :key="index">{{ line }}</span></span></summary>
          <div class="info-fact-content"><p class="fact-copy">{{ informationFactDisplayText(item.text) }}</p><small v-if="item.scope === 'city'">适用地区：{{ item.city }}</small><small v-if="item.applicability === 'province_inherited'">适用地区：{{ item.province }}全省</small></div>
        </details>
      </div>
    </section>
  </div>
</template>
