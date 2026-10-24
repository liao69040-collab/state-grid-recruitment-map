<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import GridInformationMobile from './GridInformationMobile.vue';
import { APPLICANT_COHORT_OPTIONS, DEFAULT_APPLICANT_COHORT } from '@/config/recruitment-cohorts';
const route = useRoute();
const field = (key: string) => typeof route.query[key] === 'string' ? String(route.query[key]).slice(0, 120) : '';
const province = computed(() => field('province'));
const city = computed(() => field('city'));
const targetCohortYear = computed(() => APPLICANT_COHORT_OPTIONS.includes(Number(field('targetCohortYear'))) ? Number(field('targetCohortYear')) : DEFAULT_APPLICANT_COHORT);
const tab = computed(() => ['batches', 'regions', 'schools'].includes(field('tab')) ? field('tab') : province.value ? 'regions' : 'batches');
</script>

<template>
  <GridInformationMobile :key="route.fullPath" :province="province" :city="city" :initial-tab="tab" :target-cohort-year="targetCohortYear" standalone />
</template>
