<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { GridMapDetail, GridMapSchoolDetail, GridMapCompanyDetail } from '@/services/grid-map';
import { companyHasRecruitmentCount, gridMapBatchOptions, mapCountText, mapSchoolName } from '../index/grid-map-display';
import { gridLabels, gridBatchLabels } from '../index/grid-information-display';
import { informationYear } from './information-display';
import InformationFactList from './InformationFactList.vue';
import SchoolRecruitmentSummary from '../index/SchoolRecruitmentSummary.vue';
import SchoolIntroduction from '../index/SchoolIntroduction.vue';
const props = defineProps<{ detail: GridMapDetail; province: string; year: string }>();
defineEmits<{ school: [key: string]; company: [key: string] }>();
const school = computed(() => 'school' in props.detail ? props.detail as GridMapSchoolDetail : null);
const company = computed(() => 'company' in props.detail ? props.detail as GridMapCompanyDetail : null);
const companyHasCounts = computed(() => Boolean(company.value && companyHasRecruitmentCount(company.value.company)));
const subject = computed(() => school.value?.school || company.value!.company);
const visibleBatches = computed(() => company.value && !companyHasCounts.value ? [] : gridMapBatchOptions.filter(([key]) => key && subject.value.batchCounts[key] !== null));
const limit = ref(40);
watch(() => props.detail, () => { limit.value = 40; });
</script>

<template>
  <div class="information-entity">
    <p class="info-reading-note">{{ year || '全部年份' }} · {{ company && !companyHasCounts ? '招聘信息' : '录用公示统计' }}</p>
    <template v-if="school">
      <div class="info-tags"><span v-if="school.school.schoolTier">{{ school.school.schoolTier }}</span><span v-if="school.school.is985">原985</span><span v-if="school.school.is211">原211</span><span v-if="school.school.isDoubleFirst">双一流</span><span v-for="tag in school.school.industryTags" :key="tag">{{ tag }}</span></div>
      <SchoolRecruitmentSummary v-if="school.recruitmentSummary" :summary="school.recruitmentSummary" />
      <div v-else class="info-metric-grid"><article v-if="school.school.nationalRecordCount !== null" class="info-card"><span>全国招聘去向</span><strong>{{ mapCountText(school.school.nationalRecordCount, subject.countBasis) }}</strong></article><article v-if="province && school.school.destinationProvinceRecordCount !== null" class="info-card"><span>去向 {{ province }}</span><strong>{{ mapCountText(school.school.destinationProvinceRecordCount, subject.countBasis) }}</strong><small>招聘单位所在省</small></article></div>
      <SchoolIntroduction v-if="school.school.introduction" :introduction="school.school.introduction" />
      <dl class="info-definition"><div><dt>学校主体</dt><dd>{{ school.school.schoolName }}</dd></div><div v-if="school.school.campusName"><dt>独立校区</dt><dd>{{ school.school.campusName }}</dd></div><div v-if="school.school.schoolCode"><dt>学校代码</dt><dd>{{ school.school.schoolCode }}</dd></div><div v-if="school.school.educationLevel || school.school.ownership"><dt>院校层次与性质</dt><dd>{{ [school.school.educationLevel, school.school.ownership].filter(Boolean).join(" · ") }}</dd></div><div><dt>学校所在地</dt><dd>{{ [school.school.province, school.school.city].filter(Boolean).join(' · ') || '未展示' }}</dd></div></dl>
    </template>
    <template v-if="company">
      <div class="info-card"><span>{{ companyHasCounts ? '录用公示数量' : company.candidate ? '报名情况' : '招聘信息' }}</span><strong v-if="companyHasCounts" class="info-big-number">{{ mapCountText(company.company.recordCount, subject.countBasis) }}</strong><p>{{ gridLabels[company.company.grid] }} · {{ company.company.companyCity || company.company.province || '' }}</p></div>
      
      <template v-if="company.candidate"><h3>各批次报名情况</h3><article v-for="reference in company.candidate.references" :key="reference.factKey" class="info-card"><strong>{{ reference.applicationCount.toLocaleString('zh-CN') }} 人次</strong><p>{{ informationYear(reference.cohortYear) }} · {{ gridBatchLabels[reference.batchCode] || '批次未注明' }}</p><small>报名人次</small></article></template>
    </template>
    <template v-if="!school?.recruitmentSummary && visibleBatches.length"><h3>各批次录用公示</h3><div class="info-batch-values"><div v-for="[key, label] in visibleBatches" :key="key"><span>{{ label }}</span><strong>{{ mapCountText(subject.batchCounts[key as keyof typeof subject.batchCounts], subject.countBasis) }}</strong></div></div></template>
    <template v-if="school">
      <h3>招聘去向 · {{ school.destinations.length }} 个单位</h3><div class="info-records"><button v-for="item in school.destinations.slice(0, limit)" :key="item.companyKey" @click="$emit('company', item.companyKey)"><span><strong>{{ item.company }}</strong><small>{{ item.province || '' }} · {{ gridLabels[item.grid] }}</small></span><b>{{ mapCountText(item.recordCount, item.countBasis) }}</b></button><button v-if="limit < school.destinations.length" class="info-more" @click="limit += 40">继续显示（{{ limit }} / {{ school.destinations.length }}）</button></div>
      <template v-if="school.relatedCampuses.length"><h3>其他校区</h3><div class="info-records"><button v-for="item in school.relatedCampuses" :key="item.campusKey" @click="$emit('school', item.campusKey)">{{ mapSchoolName(item) }}</button></div></template>
      
    </template>
    <template v-if="company"><template v-if="companyHasCounts"><h3>录用院校 · {{ company.schools.length }} 个校区</h3><div class="info-records"><button v-for="item in company.schools.slice(0, limit)" :key="item.campusKey" @click="$emit('school', item.campusKey)"><span>{{ mapSchoolName(item) }}</span><b>{{ mapCountText(item.recordCount, item.countBasis) }}</b></button><button v-if="limit < company.schools.length" class="info-more" @click="limit += 40">继续显示（{{ limit }} / {{ company.schools.length }}）</button></div></template><InformationFactList v-if="company.policyFacts.length" :items="company.policyFacts" /></template>
    
    
  </div>
</template>
