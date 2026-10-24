<script setup lang="ts">
import GridInformationMobile from '../information/GridInformationMobile.vue';
import { DEFAULT_APPLICANT_COHORT } from '@/config/recruitment-cohorts';
withDefaults(defineProps<{ province?: string; city?: string; initialTab?: 'facts' | 'rankings'; initialOriginal?: boolean; targetCohortYear?: number }>(), { province: '', city: '', initialTab: 'facts', initialOriginal: false, targetCohortYear: DEFAULT_APPLICANT_COHORT });
defineEmits<{ unauthorized: [] }>();
</script>

<template>
  <GridInformationMobile :province="province" :city="city" :initial-tab="initialTab" :initial-original="initialOriginal" :target-cohort-year="targetCohortYear" @unauthorized="$emit('unauthorized')" />
</template>
