<script setup lang="ts">
import { computed, ref } from 'vue';
import type { SchoolProfileIdentity } from './school-data-display';
import { getSchoolAdmissions2026, getSchoolAdmissionQueryLink2026, schoolAdmissionProvinces2026 } from '@/data/school-admissions-2026';

const props = defineProps<{ school: SchoolProfileIdentity }>();
const admissionProvince = ref('');
const scores = computed(() => getSchoolAdmissions2026(props.school.schoolName, props.school.campusName ?? null, admissionProvince.value));
const source = computed(() => getSchoolAdmissionQueryLink2026(props.school.schoolName, props.school.campusName ?? null, admissionProvince.value));
const provinceName = computed(() => schoolAdmissionProvinces2026.find(item => item.adcode === admissionProvince.value)?.name ?? '');
</script>

<template>
  <details class="school-admissions">
    <summary>2026 高考电气类分数</summary>
    <label>高考招生省份<select v-model="admissionProvince" aria-label="学校详情高考招生省份"><option value="">选择招生省份</option><option v-for="province in schoolAdmissionProvinces2026" :key="province.adcode" :value="province.adcode">{{ province.name }}</option></select></label>
    <ul v-if="scores.length">
      <li v-for="row in scores" :key="[row.sourceUrl, row.sourceProgrammeCode, row.programmeName, row.subjectCategory, row.admissionType].join(':')">
        <div><strong>{{ row.programmeName }}</strong><b>{{ row.minScore }} 分</b></div>
        <small>2026 · {{ row.provinceName }} · {{ row.subjectCategory }} · {{ row.scoreKind === 'programme_filing_score' ? '专业投档分' : '专业录取最低分' }}<template v-if="row.rank !== null"> · 位次 {{ row.rank.toLocaleString('zh-CN') }}</template></small>
        <small>{{ row.admissionBatch }} · {{ row.admissionType }}</small>
        <a :href="row.sourceUrl" target="_blank" rel="noopener noreferrer">官方来源 ↗</a>
      </li>
    </ul>
    <p v-else-if="admissionProvince">暂未收录该校在{{ provinceName }}的 2026 电气类专业分数。<a v-if="source" :href="source.url" target="_blank" rel="noopener noreferrer">官方查询 ↗</a></p>
    <p v-else>选择招生省份，查看该校已收录的专业分数。</p>
    <small class="admissions-note">高考招生与电网招聘分别统计；专业投档分与最终专业录取分按官方原口径展示。</small>
  </details>
</template>

<style scoped>
.school-admissions { margin: 12px 0; padding: 12px; border: 1px solid #d2e4ec; border-radius: 12px; background: #f3faffad; font-size: 12px; color: #365b72; }
summary { cursor: pointer; font-weight: 650; }
label { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin: 12px 0; }
select { min-width: 0; width: 150px; max-width: 60%; border: 1px solid #b9d8e5; border-radius: 8px; padding: 8px; background: #ffffffc4; color: #244a66; font: inherit; }
ul { list-style: none; padding: 0; margin: 0; display: grid; gap: 9px; }
li { padding: 9px; background: #ffffffab; border-radius: 9px; }
li div { display: flex; justify-content: space-between; gap: 12px; align-items: start; }
strong { min-width: 0; overflow-wrap: anywhere; font-size: 12px; } b { white-space: nowrap; color: #146b83; }
small { display: block; line-height: 1.6; font-size: 10px; color: #526e80; margin-top: 4px; overflow-wrap: anywhere; }
a { color: #176e8d; display: inline-block; padding: 6px 0; font-size: 11px; } p { line-height: 1.7; }
.admissions-note { margin-top: 10px; }
</style>
