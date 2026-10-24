<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { GridMapDetail, GridMapSchoolDetail, GridMapCompanyDetail, GridMapBatch } from '@/services/grid-map';
import { gridLabels, gridBatchLabels } from './grid-information-display';
import { companyHasRecruitmentCount, gridMapBatchOptions, mapCountText, mapSchoolName, schoolLocationLabel } from './grid-map-display';
import SchoolRecruitmentSummary from './SchoolRecruitmentSummary.vue';
import SchoolIntroduction from './SchoolIntroduction.vue';
import { schoolProfileTags } from './school-data-display';
import SchoolAdmissions from './SchoolAdmissions.vue';
import { recruitmentDisplayText, recruitmentDisplayTitle } from '@/utils/recruitment-display';

const props = defineProps<{ detail: GridMapDetail; provinceName: string; filterLabel: string; cohortYear?: number }>();
defineEmits<{ (event: 'open-school', key: string): void; (event: 'open-company', key: string): void }>();
const schoolDetail = computed(() => 'school' in props.detail ? props.detail as GridMapSchoolDetail : null);
const companyDetail = computed(() => 'company' in props.detail ? props.detail as GridMapCompanyDetail : null);
const displayedCohortYear = computed(() => props.cohortYear ?? schoolDetail.value?.recruitmentSummary?.cohortYear ?? null);
const subject = computed(() => schoolDetail.value?.school || companyDetail.value!.company);
const schoolLimit = ref(40);
const schoolQuery = ref('');
const visibleBatches = computed(() => gridMapBatchOptions.filter(([key]) => key && typeof subject.value.batchCounts[key] === 'number'));
const companyHasCounts = computed(() => Boolean(companyDetail.value && companyHasRecruitmentCount(companyDetail.value.company)));
const relatedCampuses = computed(() => schoolDetail.value?.relatedCampuses.filter(school => school.campusKey !== schoolDetail.value!.school.campusKey) || []);
const companySchools = computed(() => (companyDetail.value?.schools || []).filter(school =>
  !schoolQuery.value.trim() || [mapSchoolName(school), school.city, school.province].filter(Boolean).join(' ').includes(schoolQuery.value.trim())));
const companyRequirements = computed(() => {
  const groups = new Map<string, { label: string; facts: GridMapCompanyDetail['policyFacts'] }>();
  for (const fact of companyDetail.value?.policyFacts || []) {
    if (!recruitmentDisplayText(fact.text)) continue;
    const key = `${fact.cohortYear ?? ''}:${fact.batchCode}`;
    const label = [fact.cohortYear ? `${fact.cohortYear}届` : '', gridBatchLabels[fact.batchCode] || '招聘要求'].filter(Boolean).join(' · ');
    const group = groups.get(key) || { label, facts: [] };
    if (!group.facts.some(item => item.title === fact.title && item.text === fact.text)) group.facts.push(fact);
    groups.set(key, group);
  }
  return [...groups.values()];
});
const candidateApplications = computed(() => [...new Map((companyDetail.value?.candidate?.references || []).map(reference => [reference.factKey, reference])).values()]);
watch(() => props.detail, () => { schoolLimit.value = 40; schoolQuery.value = ''; });
</script>

<template>
  <div class="grid-map-detail">
    <p class="scope-note"><template v-if="displayedCohortYear">{{ displayedCohortYear }}届 · </template>{{ filterLabel }}<span v-if="subject.countBasis === 'released_cells_only'"> · 仅显示公开部分</span></p>
    <template v-if="schoolDetail">
      <div v-if="schoolProfileTags(schoolDetail.school).length" class="tags"><span v-for="tag in schoolProfileTags(schoolDetail.school)" :key="tag">{{ tag }}</span></div>
      <SchoolAdmissions :school="schoolDetail.school" />
      <SchoolRecruitmentSummary v-if="schoolDetail.recruitmentSummary" :summary="schoolDetail.recruitmentSummary" />
      <div v-else class="totals">
        <article><span>全国录用公示</span><strong>{{ mapCountText(schoolDetail.school.nationalRecordCount, subject.countBasis) }}</strong></article>
        <article><span>进入 {{ provinceName }}</span><strong>{{ mapCountText(schoolDetail.school.destinationProvinceRecordCount, subject.countBasis) }}</strong></article>
      </div>
      <SchoolIntroduction v-if="schoolDetail.school.introduction" :introduction="schoolDetail.school.introduction" />
      <dl class="facts">
        <div v-if="schoolDetail.school.province || schoolDetail.school.city"><dt>学校所在地</dt><dd>{{ [schoolDetail.school.province, schoolDetail.school.city].filter(Boolean).join(' · ') }}</dd></div>
        <div v-if="schoolDetail.school.locationPrecision !== 'unlocated'"><dt>地图位置</dt><dd>{{ schoolLocationLabel(schoolDetail.school) }}</dd></div>
        <div v-if="schoolDetail.school.campusName && schoolDetail.school.campusName !== schoolDetail.school.schoolName"><dt>所属学校</dt><dd>{{ schoolDetail.school.schoolName }}</dd></div>
        <div v-if="schoolDetail.school.schoolCode"><dt>学校代码</dt><dd>{{ schoolDetail.school.schoolCode }}</dd></div>
        <div v-if="schoolDetail.school.educationLevel || schoolDetail.school.ownership"><dt>院校性质</dt><dd>{{ [schoolDetail.school.educationLevel, schoolDetail.school.ownership].filter(Boolean).join(' · ') }}</dd></div>
      </dl>
    </template>

    <template v-if="companyDetail">
      <div class="tags"><span>{{ gridLabels[companyDetail.company.grid] || companyDetail.company.grid }}</span><span v-if="companyDetail.company.province">{{ companyDetail.company.province }}</span><span v-if="companyDetail.company.companyCity">{{ companyDetail.company.companyCity }}</span></div>
      <div v-if="companyHasCounts" class="totals">
        <article><span>录用公示</span><strong>{{ mapCountText(companyDetail.company.recordCount, subject.countBasis) }}</strong><small>{{ filterLabel }}</small></article>
        <article><span>毕业院校</span><strong>{{ companyDetail.company.schoolCount }}<small class="inline-unit">所</small></strong><small>点击下方院校查看去向</small></article>
      </div>
      <p v-else class="empty-note">暂未收录该单位录用人数，可查看下方招聘要求。</p>
      <p v-if="companyDetail.company.destinationCity" class="scope-note">录用城市：{{ companyDetail.company.destinationCity }}</p>
      <template v-if="candidateApplications.length">
        <h3>报名情况</h3>
        <div class="batch-grid"><article v-for="reference in candidateApplications" :key="reference.factKey"><span>{{ reference.cohortYear ? `${reference.cohortYear}届 · ` : '' }}{{ gridBatchLabels[reference.batchCode] || '报名' }}</span><strong>{{ reference.applicationCount.toLocaleString('zh-CN') }}<small class="inline-unit">人次</small></strong></article></div>
        <p class="compact-note">报名人次与录用人数分开统计。</p>
      </template>
    </template>

    <template v-if="!schoolDetail?.recruitmentSummary && visibleBatches.length">
      <h3>分批录用公示</h3>
      <div class="batch-grid"><article v-for="entry in visibleBatches" :key="entry[0]"><span>{{ entry[1] }}</span><strong>{{ mapCountText(subject.batchCounts[entry[0] as GridMapBatch], subject.countBasis) }}</strong></article></div>
    </template>

    <template v-if="schoolDetail">
      <h3>录用单位 <small class="inline-unit">{{ filterLabel }}</small></h3>
      <div class="records"><button v-for="company in schoolDetail.destinations.slice(0, schoolLimit)" :key="company.companyKey" @click="$emit('open-company', company.companyKey)"><span><strong>{{ company.company }}</strong><small>{{ [company.province, gridLabels[company.grid] || company.grid].filter(Boolean).join(' · ') }}</small><span class="destination-batches"><small v-for="batch in gridMapBatchOptions.filter(item => item[0] && typeof company.batchCounts[item[0] as GridMapBatch] === 'number')" :key="batch[0]">{{ batch[1] }} {{ mapCountText(company.batchCounts[batch[0] as GridMapBatch], company.countBasis) }}</small></span></span><b>{{ mapCountText(company.recordCount, company.countBasis) }}</b></button><button v-if="schoolDetail.destinations.length > schoolLimit" @click="schoolLimit += 40">查看更多单位（{{ schoolLimit }} / {{ schoolDetail.destinations.length }}）</button></div>
      <template v-if="relatedCampuses.length"><h3>其他校区</h3><div class="records"><button v-for="school in relatedCampuses" :key="school.campusKey" @click="$emit('open-school', school.campusKey)"><span><strong>{{ mapSchoolName(school) }}</strong><small>{{ [school.province, school.city].filter(Boolean).join(' · ') }}</small></span></button></div></template>
    </template>

    <template v-if="companyDetail">
      <template v-if="companyDetail.schools.length">
        <h3>毕业院校 <small class="inline-unit">{{ companyDetail.schools.length }}所</small></h3>
        <label class="school-search"><span class="sr-only">搜索毕业院校</span><input v-model="schoolQuery" type="search" placeholder="搜索学校、省份或城市" @input="schoolLimit = 40"></label>
        <div class="records"><button v-for="school in companySchools.slice(0, schoolLimit)" :key="school.campusKey" @click="$emit('open-school', school.campusKey)"><span><strong>{{ mapSchoolName(school) }}</strong><small>{{ [school.province, school.city].filter(Boolean).join(' · ') }}</small><span class="destination-batches"><small v-for="batch in gridMapBatchOptions.filter(item => item[0] && typeof school.batchCounts[item[0] as GridMapBatch] === 'number')" :key="batch[0]">{{ batch[1] }} {{ mapCountText(school.batchCounts[batch[0] as GridMapBatch], school.countBasis) }}</small></span></span><b>{{ mapCountText(school.recordCount, school.countBasis) }}</b></button><p v-if="!companySchools.length" class="compact-note">没有找到对应院校，请换个关键词。</p><button v-if="companySchools.length > schoolLimit" @click="schoolLimit += 40">查看更多院校（{{ schoolLimit }} / {{ companySchools.length }}）</button></div>
      </template>
      <template v-if="companyRequirements.length">
        <h3>招聘要求</h3>
        <details v-for="(group, index) in companyRequirements" :key="group.label" class="requirements-group" :open="index === 0"><summary>{{ group.label }}<small>{{ group.facts.length }}项</small></summary><div class="requirements-list"><article v-for="fact in group.facts" :key="fact.factKey"><strong>{{ recruitmentDisplayTitle(fact.title) }}</strong><p>{{ recruitmentDisplayText(fact.text) }}</p></article></div></details>
      </template>
    </template>
    <p class="compact-note">录用公示按发布批次统计，不等于最终入职人数；学校所在地与录用去向分开显示。</p>
  </div>
</template>

<style scoped>
.grid-map-detail { color: #345d75; font-size: 12px; }
.destination-batches { display: flex; flex-wrap: wrap; gap: 3px 9px; margin-top: 5px; }.records button > span { min-width: 0; }.records strong,.facts dd { overflow-wrap: anywhere; }
.scope-note { padding: 9px 12px; border-radius: 9px; background: #edf6fb; color: #627c8e; line-height: 1.65; }.compact-note { color: #748a98; font-size: 10px; line-height: 1.65; margin: 12px 0; }.empty-note { padding: 14px; background: #f3f8fb; border: 1px solid #dbe9ef; border-radius: 10px; line-height: 1.8; }
.tags { display: flex; flex-wrap: wrap; gap: 6px; margin: 12px 0; }.tags span { padding: 5px 8px; border-radius: 7px; color: #176a95; background: #e7f4fb; }
.totals,.batch-grid { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 8px; }.totals article,.batch-grid article { display: grid; gap: 7px; padding: 14px 12px; border: 1px solid #cee3ee; border-radius: 10px; background: #f6fbfe; }.totals strong { color: #076b9f; font-size: 25px; }.batch-grid strong { color: #176f99; font-size: 17px; }
small { display: block; color: #71899a; font-size: 10px; line-height: 1.65; }.inline-unit { display: inline; margin-left: 5px; font-size: 11px; font-weight: 400; }.facts { margin: 14px 0; }.facts div { display: grid; grid-template-columns: 82px 1fr; padding: 8px 0; border-bottom: 1px solid #e0edf4; gap: 10px; }.facts dt { color: #7992a2; }.facts dd { margin: 0; line-height: 1.6; }
h3 { margin: 20px 0 10px; font-size: 14px; color: #215975; }.records { display: grid; gap: 7px; max-height: 360px; overflow-y: auto; overscroll-behavior: contain; }.records button,.records article { padding: 11px; border: 1px solid #d8e8f0; border-radius: 9px; background: white; text-align: left; color: #345d75; }.records button { display: flex; align-items: center; justify-content: space-between; gap: 12px; cursor: pointer; }.records button:hover { border-color: #85bddd; background: #f4fbfe; }.records strong { font-size: 12px; }.records b { white-space: nowrap; color: #126f9b; }.records p { line-height: 1.7; }
.school-search { display: block; margin-bottom: 9px; }.school-search input { width: 100%; box-sizing: border-box; padding: 10px 12px; border: 1px solid #c9e0ed; border-radius: 8px; background: #fff; color: inherit; }.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; }
.requirements-group { border: 1px solid #d8e8f0; border-radius: 9px; margin: 8px 0; background: #f8fcfe; }.requirements-group summary { padding: 12px; cursor: pointer; color: #216381; font-weight: 650; }.requirements-group summary small { display: inline; margin-left: 8px; font-weight: 400; }.requirements-list { padding: 0 12px; }.requirements-list article { padding: 12px 0; border-top: 1px solid #e1edf3; }.requirements-list p { white-space: pre-line; overflow-wrap: anywhere; line-height: 1.8; margin: 8px 0 0; }
</style>
