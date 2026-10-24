<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { isEarlyBatchUnauthorized, searchEarlyBatchSchools } from '@/services/early-batch';
import type { EarlyBatchCatalog, EarlyBatchEvaluation, EarlyBatchSchoolMatch, MajorCategoryCode, SchoolTagCode } from '@/services/early-batch';
import { evaluateRecruitmentEligibility } from '@/services/recruitment-eligibility';
import type { RecruitmentApplicant, RecruitmentBatchCode, RecruitmentDecision, RecruitmentEvaluation, RecruitmentResult, RecruitmentInitialApplicant } from '@/services/recruitment-eligibility';
import { recruitmentDisplayText } from '@/utils/recruitment-display';
import { DEFAULT_APPLICANT_COHORT, referenceCohortYear, hasReviewedCohortRules, recruitmentPlanningStages } from '@/config/recruitment-cohorts';
import { isPositiveRecruitmentResult, matchesRecruitmentResultFilter } from './recruitment-match-display';
import type { RecruitmentResultFilter } from './recruitment-match-display';

const props = defineProps<{ provinceOptions: Array<{ name: string; adcode: string }>; selectedProvinceAdcode?: string; embedded?: boolean; cohortYear?: number; initialBatch?: RecruitmentBatchCode | ''; initialApplicant?: RecruitmentInitialApplicant }>();
const emit = defineEmits<{ unauthorized: []; close: []; 'catalog-change': [catalog: EarlyBatchCatalog | null]; 'evaluation-change': [evaluation: EarlyBatchEvaluation | null]; 'recruitment-evaluation': [evaluation: RecruitmentEvaluation | null] }>();
type Choice = '' | 'yes' | 'no';
const degree = ref<RecruitmentApplicant['degree'] | ''>('');
const schoolName = ref('');
const schoolProvinceAdcode = ref('');
const homeProvinceAdcode = ref('');
const originalHukouProvinceAdcode = ref('');
const studentOriginProvinceAdcode = ref('');
const educationLocation = ref<'domestic' | 'overseas' | ''>('');
const majorCategory = ref<MajorCategoryCode | ''>('');
const applicantCohort = computed(() => props.cohortYear ?? DEFAULT_APPLICANT_COHORT);
const historicalView = ref(false);
const referenceYear = computed(() => referenceCohortYear(applicantCohort.value));
const comparisonCohort = computed(() => historicalView.value ? referenceYear.value : applicantCohort.value);
const referenceRulesAvailable = computed(() => hasReviewedCohortRules(referenceYear.value));
const planningStages = computed(() => recruitmentPlanningStages(applicantCohort.value));
const graduationYear = ref<number | null>(props.initialApplicant?.graduationYear ?? applicantCohort.value);
const age = ref<number | null>(null);
const ageAtApplication = ref<number | null>(null);
const graduationDate = ref('');
const schoolNature = ref('');
const schoolTags = ref<SchoolTagCode[]>([]);
const attributesConfirmed = ref(false);
const selectedSchool = ref<EarlyBatchSchoolMatch | null>(null);
const schoolMatches = ref<EarlyBatchSchoolMatch[]>([]);
const schoolSearchBusy = ref(false);
const schoolSearchError = ref('');
const flags = ref<Record<string, Choice>>({ freshGraduate: '', fullTime: '', nationalUnifiedAdmission: '', majorMatchesEnrollment: '', cet4OrHigher: '', cet6OrHigher: '', computerLevel2: '', certificatesObtainedBeforeApplication: '', hasFailedCourses: '', gradesAcceptable: '', qsTop100: '', nonEmployedDuringStudy: '', hasDomesticEmployerSocialInsurance: '', hasDomesticSocialInsurance: '', qualificationsByDeadline: '' });
const evaluating = ref(false);
const errorMessage = ref('');
const results = ref<RecruitmentEvaluation | null>(null);
const selectedBatch = ref<RecruitmentBatchCode | 'all'>('all');
const decisionFilter = ref<RecruitmentResultFilter>('positive');
const selectedProvince = ref('');
const expanded = ref('');
const compactStage = ref<'form' | 'result'>('form');
let sequence = 0;
let searchSequence = 0;
let autoTimer: ReturnType<typeof setTimeout> | undefined;
const batchOptions: Array<{ value: RecruitmentBatchCode; label: string }> = [{ value: 'campus', label: '国网提前批' }, { value: 'batch_1', label: '国网第一批' }, { value: 'batch_2', label: '国网第二批' }, { value: 'batch_3', label: '国网第三批' }, { value: 'csg_campus', label: '南网提前批' }, { value: 'csg_autumn', label: '南网秋招' }, { value: 'csg_spring', label: '南网春招' }, { value: 'impc_campus', label: '蒙西校园招聘' }];
const southernProvinces = new Set(['440000', '450000', '460000', '520000', '530000']);
const applicableBatchOptions = computed(() => batchOptions.filter(batch => !selectedProvince.value || (southernProvinces.has(selectedProvince.value)
  ? batch.value === 'csg_autumn' || batch.value === 'csg_spring' || (selectedProvince.value === '440000' && batch.value === 'csg_campus')
  : ['campus', 'batch_1', 'batch_2', 'batch_3'].includes(batch.value) || (selectedProvince.value === '150000' && batch.value === 'impc_campus'))));
const degreeOptions = [{ value: 'junior_college', label: '专科' }, { value: 'bachelor', label: '本科' }, { value: 'master', label: '硕士研究生' }, { value: 'doctor', label: '博士研究生' }];
const majorOptions: Array<{ value: MajorCategoryCode; label: string }> = [{ value: 'electrical', label: '电工类 / 电气类' }, { value: 'computer', label: '计算机类' }, { value: 'communication', label: '通信类' }, { value: 'electronic_information', label: '电子信息类' }, { value: 'artificial_intelligence', label: '人工智能类' }, { value: 'finance', label: '财务类' }, { value: 'human_resources', label: '人力资源类' }, { value: 'law', label: '法学类' }, { value: 'other_engineering', label: '其他工学' }, { value: 'other', label: '其他专业' }];
const tagOptions: Array<{ value: SchoolTagCode; label: string }> = [{ value: 'legacy_985', label: '原985' }, { value: 'legacy_211', label: '原211' }, { value: 'former_power_ministry', label: '原电力部直属院校' }];
const basicFlags = [{ field: 'fullTime', label: '全日制' }, { field: 'nationalUnifiedAdmission', label: '国家统招普通高校' }, { field: 'majorMatchesEnrollment', label: '主修专业与学籍一致' }];
const extraFlags = [{ field: 'cet4OrHigher', label: '已具备英语四级及以上' }, { field: 'cet6OrHigher', label: '已具备英语六级及以上' }, { field: 'computerLevel2', label: '已具备计算机二级' }, { field: 'hasFailedCourses', label: '是否有挂科' }, { field: 'gradesAcceptable', label: '学业成绩合格' }];
const decisionLabels: Record<RecruitmentDecision, string> = { initial_match: '已比对基础条件匹配', reference_match: '参考条件匹配', reference_mismatch: '与参考条件不符', not_matched: '条件不匹配', missing_input: '补充信息', needs_confirmation: '进一步确认' };
const decisions: RecruitmentDecision[] = ['initial_match', 'reference_match', 'missing_input', 'needs_confirmation', 'reference_mismatch', 'not_matched'];
const otherDecisions = decisions.filter(decision => decision !== 'initial_match' && decision !== 'reference_match');
const provinceResults = computed(() => (results.value?.results ?? []).filter(row => !selectedProvince.value || row.provinceAdcode === selectedProvince.value));
const batchResults = computed(() => (results.value?.results ?? []).filter(row => (selectedBatch.value === 'all' || row.batchCode === selectedBatch.value) && (!selectedProvince.value || row.provinceAdcode === selectedProvince.value)));
const historicalResults = computed(() => (results.value?.historicalResults ?? []).filter(row => (selectedBatch.value === 'all' || row.batchCode === selectedBatch.value) && (!selectedProvince.value || row.provinceAdcode === selectedProvince.value)));
const uncovered = computed(() => results.value?.coverage?.status === 'not_loaded' || results.value?.coverage?.status === 'cohort_mismatch');
// The filter partitions unit/batch results. Supplemental comparisons stay inside each card.
const matchesDecision = (row: RecruitmentResult, decision: RecruitmentDecision) => row.decision === decision;
const visibleResults = computed(() => batchResults.value.filter(row => matchesRecruitmentResultFilter(row, decisionFilter.value)).sort((a, b) => decisions.indexOf(a.decision) - decisions.indexOf(b.decision) || Number(b.provinceAdcode === homeProvinceAdcode.value) - Number(a.provinceAdcode === homeProvinceAdcode.value) || a.provinceName.localeCompare(b.provinceName, 'zh-CN') || batchOptions.findIndex(o => o.value === a.batchCode) - batchOptions.findIndex(o => o.value === b.batchCode)));
const resultBatchOptions = computed(() => {
  const rows = historicalView.value
    ? (results.value?.historicalResults ?? []).filter(row => !selectedProvince.value || row.provinceAdcode === selectedProvince.value)
    : provinceResults.value.filter(row => matchesRecruitmentResultFilter(row, decisionFilter.value));
  return applicableBatchOptions.value.filter(batch => rows.some(row => row.batchCode === batch.value));
});
const otherResultCount = computed(() => provinceResults.value.filter(row => !isPositiveRecruitmentResult(row)).length);
const selectedBatchLabel = computed(() => batchOptions.find(batch => batch.value === selectedBatch.value)?.label || '');
const toggleOtherResults = () => { decisionFilter.value = decisionFilter.value === 'positive' ? 'other' : 'positive'; selectedBatch.value = 'all'; expanded.value = ''; };
const counts = computed(() => Object.fromEntries(decisions.map(decision => [decision, batchResults.value.filter(row => matchesDecision(row, decision)).length])));
const availableProvinceOptions = computed(() => props.provinceOptions.filter(province => !['710000', '810000', '820000'].includes(province.adcode)));
const authorize = (error: unknown) => { if (!isEarlyBatchUnauthorized(error)) return false; emit('unauthorized'); return true; };

const searchSchool = async () => {
  const requestId = ++searchSequence;
  schoolSearchError.value = '';
  if (schoolName.value.trim().length < 2) { schoolSearchError.value = '请输入至少两个字的学校名称。'; return; }
  schoolSearchBusy.value = true;
  try {
    const rows = await searchEarlyBatchSchools(schoolName.value.trim());
    if (requestId !== searchSequence) return;
    schoolMatches.value = rows;
    if (!rows.length) schoolSearchError.value = '没有找到对应学校，可继续手动填写学校属性。';
  } catch (error) { if (requestId === searchSequence && !authorize(error)) schoolSearchError.value = '学校查询失败，请重试。'; }
  finally { if (requestId === searchSequence) schoolSearchBusy.value = false; }
};
const chooseSchool = (school: EarlyBatchSchoolMatch) => {
  selectedSchool.value = school;
  schoolName.value = school.name;
  schoolProvinceAdcode.value = school.provinceAdcode || '';
  schoolTags.value = school.schoolTags.filter(tag => tag !== 'public_institution');
  schoolNature.value = school.schoolTags.includes('public_institution') ? 'public' : school.nature === '民办' ? 'private' : '';
  attributesConfirmed.value = false;
  schoolMatches.value = [];
};
const makeApplicant = (): RecruitmentApplicant => {
  const tags = [...schoolTags.value];
  if (schoolNature.value === 'public') tags.push('public_institution');
  const booleans = Object.fromEntries(Object.entries(flags.value).filter(([, value]) => value).map(([field, value]) => [field, value === 'yes']));
  return {
    degree: degree.value as RecruitmentApplicant['degree'], ...booleans,
    ...(schoolName.value ? { schoolName: schoolName.value } : {}),
    ...(selectedSchool.value?.schoolKey ? { schoolKey: selectedSchool.value.schoolKey } : {}),
    ...(schoolProvinceAdcode.value ? { schoolProvinceAdcode: schoolProvinceAdcode.value } : {}),
    ...(homeProvinceAdcode.value ? { homeProvinceAdcode: homeProvinceAdcode.value } : {}),
    ...(originalHukouProvinceAdcode.value ? { originalHukouProvinceAdcode: originalHukouProvinceAdcode.value } : {}),
    ...(studentOriginProvinceAdcode.value ? { studentOriginProvinceAdcode: studentOriginProvinceAdcode.value } : {}),
    ...(educationLocation.value ? { educationLocation: educationLocation.value } : {}),
    ...(majorCategory.value ? { majorCategory: majorCategory.value } : {}),
    ...(graduationYear.value ? { graduationYear: graduationYear.value } : {}),
    ...(age.value ? { age: age.value } : {}),
    ...(ageAtApplication.value ? { ageAtApplication: ageAtApplication.value } : {}),
    ...(graduationDate.value ? { graduationDate: graduationDate.value } : {}),
    schoolTagsConfirmed: attributesConfirmed.value,
    ...(attributesConfirmed.value ? { schoolTags: tags } : {}),
  };
};
const evaluate = async (showResults = true) => {
  if (autoTimer) clearTimeout(autoTimer);
  if (!degree.value) return;
  const requestId = ++sequence;
  evaluating.value = true;
  errorMessage.value = '';
  const applicant = makeApplicant();
  try {
    const allBatches = await evaluateRecruitmentEligibility(applicant, { cohortYear: comparisonCohort.value, comparisonMode: historicalView.value ? 'historical' : 'reference' });
    if (requestId !== sequence) return;
    results.value = allBatches;
    emit('recruitment-evaluation', allBatches.coverage?.status === 'reference_only' && !historicalView.value ? allBatches : null);
    emit('evaluation-change', null);
    if (showResults) compactStage.value = 'result';
  } catch (error) {
    if (requestId !== sequence) return;
    results.value = null; emit('evaluation-change', null); emit('recruitment-evaluation', null);
    if (!authorize(error)) {
      const message = recruitmentDisplayText(error instanceof Error ? error.message : '');
      errorMessage.value = /[\u3400-\u9fff]/.test(message) ? message : '查询暂时无法完成，请检查网络后重试。';
    }
  } finally { if (requestId === sequence) evaluating.value = false; }
};
const importantChecks = (result: RecruitmentResult) => result.checks.filter(check => check.state !== 'pass');
const checkExpectedText = (check: RecruitmentResult['checks'][number]) => check.field === 'schoolProvinceAdcode'
  ? check.expected.replace(/\b\d{6}\b/g, code => props.provinceOptions.find(province => province.adcode === code)?.name || '对应省份')
  : check.expected;
const matchedDimensions = (result: RecruitmentResult) => [...new Set(result.checks.filter(check => check.state === 'pass').map(check => check.label))].join('、');
const clearChangedSchool = (next: string) => {
  searchSequence += 1; schoolSearchBusy.value = false; schoolMatches.value = [];
  if (selectedSchool.value && next !== selectedSchool.value.name) {
    // Changing the selected school must not retain the previous school's
    // province/tags. These fields influence the comparison, not just its label.
    selectedSchool.value = null; attributesConfirmed.value = false;
    schoolProvinceAdcode.value = ''; schoolNature.value = ''; schoolTags.value = [];
  }
};
watch(schoolName, clearChangedSchool);
watch([schoolNature, schoolTags], () => { attributesConfirmed.value = false; }, { deep: true });
watch([degree, schoolName, schoolProvinceAdcode, homeProvinceAdcode, originalHukouProvinceAdcode, studentOriginProvinceAdcode, educationLocation, majorCategory, graduationYear, graduationDate, age, ageAtApplication, flags, schoolNature, schoolTags, attributesConfirmed, comparisonCohort, historicalView], () => {
  sequence += 1; results.value = null; decisionFilter.value = 'positive'; evaluating.value = Boolean(props.embedded && degree.value); errorMessage.value = ''; expanded.value = ''; emit('evaluation-change', null); emit('recruitment-evaluation', null);
  if (autoTimer) clearTimeout(autoTimer);
  if (props.embedded && degree.value) autoTimer = setTimeout(() => void evaluate(false), 600);
}, { deep: true });
watch(selectedProvince, () => { if (selectedBatch.value !== 'all' && !applicableBatchOptions.value.some(batch => batch.value === selectedBatch.value)) selectedBatch.value = 'all'; });
watch(() => props.selectedProvinceAdcode, code => { selectedProvince.value = code || ''; if (code && results.value) compactStage.value = 'result'; }, { immediate: true });
watch(() => props.initialBatch, batch => {
  selectedBatch.value = batch && applicableBatchOptions.value.some(option => option.value === batch) ? batch : 'all';
}, { immediate: true });
// Quick-entry fields describe the applicant only; never infer other credentials.
watch(() => props.initialApplicant, applicant => {
  if (!applicant) return;
  if (applicant.degree !== undefined) degree.value = applicant.degree;
  if (applicant.majorCategory !== undefined) majorCategory.value = applicant.majorCategory;
  if (applicant.graduationYear !== undefined) graduationYear.value = applicant.graduationYear;
  if (applicant.originalHukouProvinceAdcode !== undefined) originalHukouProvinceAdcode.value = applicant.originalHukouProvinceAdcode ?? '';
  if (applicant.studentOriginProvinceAdcode !== undefined) studentOriginProvinceAdcode.value = applicant.studentOriginProvinceAdcode ?? '';
}, { immediate: true, deep: true });
// Reference planning never invokes the legacy 2026 qualification endpoints.
watch([applicantCohort, historicalView], () => { decisionFilter.value = 'positive'; emit('catalog-change', null); });
onMounted(() => { emit('catalog-change', null); if (props.embedded && degree.value) void evaluate(false); });
onBeforeUnmount(() => { sequence += 1; searchSequence += 1; if (autoTimer) clearTimeout(autoTimer); emit('catalog-change', null); emit('evaluation-change', null); emit('recruitment-evaluation', null); });
</script>

<template>
  <div :class="['eligibility-dialog', { embedded }, `compact-${compactStage}`]">
    <header v-if="!embedded" class="eligibility-header"><span>{{ applicantCohort }}届 · 报考规划</span><h2 id="eligibility-title">招聘批次智能筛选</h2><p>一次填写，分别查看国网各批次、南网秋招与春招，以及蒙西招聘。条件匹配不代表网申通过或录取。</p></header>
    <div class="eligibility-workspace">
      <form class="applicant-form" @submit.prevent="evaluate()">
        <header class="panel-head"><div><small>报考{{ applicantCohort }}届 · 参考{{ referenceYear }}届</small><h2>{{ historicalView ? `${referenceYear}届条件浏览` : '招聘条件参考匹配' }}</h2></div><button v-if="embedded" type="button" @click="emit('close')">返回地图</button></header>
        <aside class="cohort-notice" role="status">
          <template v-if="historicalView"><b>正在查看{{ referenceYear }}届条件</b><p>保留当届要求与日期，当前仅浏览，不作个人匹配。</p></template>
          <template v-else><b>用已收录的历史资料，选择报考方向</b><p>{{ applicantCohort }}届报考参考{{ referenceYear }}届学历、专业和学校条件；不代表{{ applicantCohort }}届网申资格。</p></template>
          <button type="button" :aria-pressed="historicalView" @click="historicalView = !historicalView">{{ historicalView ? '返回参考匹配' : `仅浏览${referenceYear}届要求` }}</button>
        </aside>
        <button v-if="embedded" class="compact-switch" type="button" @click="compactStage = 'result'">查看筛选结果</button>
        <section class="form-section"><h3>1. 学历与毕业信息</h3><div class="field-grid">
          <label><span>最高学历</span><select v-model="degree" required><option value="" disabled>请选择</option><option v-for="item in degreeOptions" :key="item.value" :value="item.value">{{ item.label }}</option></select></label>
          <label><span>就读地区</span><select v-model="educationLocation"><option value="">暂不填写</option><option value="domestic">中国内地院校</option><option value="overseas">国（境）外院校</option></select></label>
          <label><span>毕业年份</span><input v-model.number="graduationYear" type="number" min="2020" max="2100" /></label>
          <label v-if="educationLocation === 'overseas'"><span>境外毕业日期</span><input v-model="graduationDate" type="date" /></label>
          <label><span>专业类别</span><select v-model="majorCategory"><option value="">暂不填写</option><option v-for="item in majorOptions" :key="item.value" :value="item.value">{{ item.label }}</option></select></label>
        </div><p class="hint">学历与毕业年份按本人实际情况填写，切换报考届别不会自动改写本人信息。</p></section>
        <section class="form-section"><h3>2. 学校与属性</h3><label><span>学校名称</span><div class="school-search-row"><input v-model.trim="schoolName" placeholder="例如：三峡大学" /><button type="button" :disabled="schoolSearchBusy" @click="searchSchool">{{ schoolSearchBusy ? '识别中' : '识别' }}</button></div></label>
          <p v-if="schoolSearchError" class="hint">{{ schoolSearchError }}</p><div v-if="schoolMatches.length" class="school-match-list"><button v-for="school in schoolMatches" :key="school.schoolKey" type="button" @click="chooseSchool(school)"><b>{{ school.name }}</b><span>{{ school.educationLevel }} {{ school.nature }}</span></button></div>
          <p v-if="selectedSchool" class="matched-school">已选择 {{ selectedSchool.name }}</p>
          <div class="field-grid"><label><span>学校所在省份</span><select v-model="schoolProvinceAdcode"><option value="">暂不填写</option><option v-for="province in provinceOptions" :key="province.adcode" :value="province.adcode">{{ province.name }}</option></select></label><label><span>希望优先查看的省份</span><select v-model="homeProvinceAdcode"><option value="">全国</option><option v-for="province in provinceOptions" :key="province.adcode" :value="province.adcode">{{ province.name }}</option></select></label></div>
          <div class="field-grid"><label><span>原户籍地（省份）</span><select v-model="originalHukouProvinceAdcode"><option value="">暂不填写</option><option v-for="province in provinceOptions" :key="province.adcode" :value="province.adcode">{{ province.name }}</option></select></label><label><span>生源地（省份）</span><select v-model="studentOriginProvinceAdcode"><option value="">暂不填写</option><option v-for="province in provinceOptions" :key="province.adcode" :value="province.adcode">{{ province.name }}</option></select></label></div>
          <p class="hint">原户籍地、生源地分别填写，不自动使用现居地或就学省份替代。生源地按拟报单位定义核对；地域条款须看具体批次、县域与单位，不自动加分或判定可报。</p>
          <p class="hint">默认查询全国，偏好省份只影响展示顺序。内蒙古分别查看蒙东和蒙西。</p>
          <label><span>学校性质</span><select v-model="schoolNature"><option value="">暂不填写</option><option value="public">公办</option><option value="private">民办</option></select></label>
          <label v-if="educationLocation === 'overseas'"><span>是否QS前100院校</span><select v-model="flags.qsTop100"><option value="">暂不填写</option><option value="yes">是</option><option value="no">否</option></select></label>
          <div class="tag-options"><label v-for="tag in tagOptions" :key="tag.value"><input v-model="schoolTags" type="checkbox" :value="tag.value" />{{ tag.label }}</label></div>
          <label class="check-line"><input v-model="attributesConfirmed" type="checkbox" />我已核对以上学校属性</label>
        </section>
        <section v-if="!historicalView" class="form-section"><h3>3. 补充参考匹配信息</h3><div class="field-grid"><label v-for="field in basicFlags" :key="field.field"><span>{{ field.label }}</span><select v-model="flags[field.field]"><option value="">暂不填写</option><option value="yes">是</option><option value="no">否</option></select></label></div>
          <details class="extra-fields"><summary>已有证书与成绩</summary><div class="field-grid"><label v-for="field in extraFlags" :key="field.field"><span>{{ field.label }}</span><select v-model="flags[field.field]"><option value="">暂不填写</option><option value="yes">是</option><option value="no">否</option></select></label></div></details>
          <p class="hint">历史毕业年份、年龄计算日和取证截止时间不参与跨届匹配；本人毕业届别保持不变。</p>
        </section>
        <p v-if="errorMessage" role="alert" class="error">{{ errorMessage }}</p><button class="evaluate-button" type="submit" :disabled="!degree || evaluating">{{ evaluating ? '正在查询…' : historicalView ? `查看${referenceYear}届要求` : '查看参考匹配' }}</button>
        <p class="hint">结果用于选择报考方向，不代表已经通过网申或考试。</p>
      </form>
      <section class="result-panel" aria-live="polite"><button v-if="embedded" class="compact-switch" type="button" @click="compactStage = 'form'">返回填写信息</button><header class="panel-head"><div><small>国网 · 南网 · 蒙西 · {{ referenceYear }}届资料</small><h2>{{ historicalView ? `${referenceYear}届条件浏览` : `${applicantCohort}届报考方向` }}</h2></div></header>
        <nav class="batch-tabs" aria-label="批次筛选"><button type="button" :class="{ active: selectedBatch === 'all' }" @click="selectedBatch = 'all'">{{ historicalView ? '全部历史批次' : decisionFilter === 'positive' ? '全部可匹配批次' : '全部其他批次' }}</button><button v-for="batch in resultBatchOptions" :key="batch.value" type="button" :class="{ active: selectedBatch === batch.value }" @click="selectedBatch = batch.value">{{ batch.label }}</button></nav>
        <div class="result-filters"><label><span>查看地区</span><select v-model="selectedProvince"><option value="">全国</option><option v-for="province in availableProvinceOptions" :key="province.adcode" :value="province.adcode">{{ province.name }}</option></select></label><label v-if="!historicalView && !uncovered && decisionFilter !== 'positive'"><span>其他结果（不代表匹配）</span><select v-model="decisionFilter"><option value="other">全部其他结果</option><option v-for="decision in otherDecisions" :key="decision" :value="decision">{{ decisionLabels[decision] }} {{ counts[decision] || 0 }}</option></select></label></div>
        <button v-if="results && !historicalView && !uncovered && (otherResultCount || decisionFilter !== 'positive')" class="other-results-toggle" type="button" :aria-pressed="decisionFilter !== 'positive'" @click="toggleOtherResults">{{ decisionFilter === 'positive' ? `查看需补充或其他结果（${otherResultCount}）` : '返回参考匹配' }}</button>
        <p v-if="results && !historicalView && !uncovered" class="hint">{{ decisionFilter === 'positive' ? '这里只列出已匹配的基础或历史参考条件，不代表当届可报、网申通过或录取。' : '补充信息、进一步确认与条件不符的结果单独查看，不计入参考匹配。' }}</p>
        <p v-if="evaluating" class="hint">正在比对，请稍候…</p><p v-if="errorMessage" class="error" role="alert">{{ errorMessage }}</p>
        <div v-if="results && uncovered" class="cohort-notice"><b>暂不作资格判断</b><p>{{ results.notice }}</p></div>
        <template v-else-if="results && historicalView"><p class="hint">{{ results.notice }}</p><p class="result-count">{{ historicalResults.length }} 个历史单位批次</p><div class="result-list"><article v-for="result in historicalResults" :key="result.id" class="result-card historical-card"><header><span class="batch-chip">{{ referenceYear }}届 · {{ result.batchLabel }}</span><b>历史条件</b></header><h3>{{ result.targetName }}</h3><p class="province-label">{{ result.provinceName }}</p><button class="details-button" type="button" :aria-expanded="expanded === result.id" @click="expanded = expanded === result.id ? '' : result.id">{{ expanded === result.id ? '收起条件' : '查看当届要求' }}</button><div v-if="expanded === result.id" class="requirements"><section v-for="group in result.groups" :key="group.category"><h4>{{ group.title }}</h4><ul><li v-for="item in group.items" :key="item">{{ item }}</li></ul></section></div></article></div><p v-if="!historicalResults.length" class="hint">这个范围暂未收录历史条件，可切换地区或批次。</p></template>
        <template v-else-if="results"><p class="hint">{{ results.notice }}</p><p class="result-count">当前 {{ visibleResults.length }} 个单位批次</p><div class="result-list"><article v-for="result in visibleResults" :key="result.id" :class="['result-card', result.decision]"><header><span class="batch-chip">{{ referenceYear }}届 · {{ result.batchLabel }}</span><b class="decision-chip">{{ result.decisionLabel }}</b></header><h3>{{ result.targetName }}</h3><p class="province-label">{{ result.provinceName }}<span v-if="result.provinceAdcode === homeProvinceAdcode"> · 优先查看</span></p><p>{{ result.summary }}</p>
          <ul v-if="importantChecks(result).length" class="check-results"><li v-for="check in importantChecks(result)" :key="check.field"><b>{{ check.label }}</b><span>{{ checkExpectedText(check) }}</span></li></ul>
          <p v-if="matchedDimensions(result)" class="matched-dimensions">已比对：{{ matchedDimensions(result) }}</p>
          <p v-if="result.decision === 'initial_match'" class="remaining-conditions">尚需核对：具体岗位专业、证书、毕业取证时间及体检条件。</p>
          <aside v-if="result.referenceComparison" class="reference-comparison"><b>{{ result.referenceComparison.label }}</b><p>{{ result.referenceComparison.summary }}</p><ul v-if="result.referenceComparison.checks.some(check => check.state !== 'pass')"><li v-for="check in result.referenceComparison.checks.filter(check => check.state !== 'pass')" :key="check.field">{{ check.label }}：{{ checkExpectedText(check) }}</li></ul></aside>
          <aside v-for="origin in result.originReferences || []" :key="origin.id" class="reference-comparison"><b>{{ origin.label }} · {{ origin.scope }}</b><p>{{ origin.summary }}</p><p class="hint">{{ origin.applicantContext }} 不改变本次参考匹配结果或排名。</p></aside>
          <button class="details-button" type="button" :aria-expanded="expanded === result.id" @click="expanded = expanded === result.id ? '' : result.id">{{ expanded === result.id ? '收起条件' : '查看报考要求' }}</button>
          <a v-if="result.officialRecruitmentUrl" class="details-button official-link" :href="result.officialRecruitmentUrl" target="_blank" rel="noopener noreferrer">进入招聘平台查看岗位 ↗</a>
          <div v-if="expanded === result.id" class="requirements"><section v-for="group in result.groups" :key="group.category"><h4>{{ group.title }}</h4><ul><li v-for="item in group.items" :key="item">{{ item }}</li></ul></section><section v-if="result.nextSteps.length"><h4>下一步</h4><ul><li v-for="step in result.nextSteps" :key="step">{{ step }}</li></ul></section></div>
        </article></div><p v-if="!visibleResults.length" class="hint">{{ decisionFilter === 'positive' ? `当前${selectedBatchLabel ? selectedBatchLabel + '、' : ''}地区与个人条件下，暂无有依据的参考匹配。可补充信息或查看其他结果，不自动改为全部结果。` : '当前范围没有此类其他结果，可切换批次、地区或返回参考匹配。' }}</p></template>
        <div v-else-if="!evaluating" class="placeholder"><h3>{{ !referenceRulesAvailable ? `${referenceYear}届可匹配规则尚未收录` : degree ? '信息已更新，请点击参考匹配' : '先选择学历' }}</h3><p v-if="!referenceRulesAvailable">报考{{ applicantCohort }}届需参考{{ referenceYear }}届；不自动改用其他年份。</p><p v-else>填写本人信息后，直接参考{{ referenceYear }}届条件选择方向。</p></div>
        <section v-if="!historicalView" class="cohort-planning" aria-label="国网报考准备窗口">
          <h3>{{ applicantCohort }}届 · 国网准备窗口</h3>
          <ul><li v-for="stage in planningStages" :key="stage.key"><b>{{ stage.label }}</b><span>{{ stage.period }}</span></li></ul>
          <p>这是准备窗口，不是正式报名日程；具体时间与是否招聘须看相应单位安排。</p>
          <p>南网秋招、春招及明确的提前批，蒙西校园招聘，均按独立渠道查看，不套国网批次。</p>
        </section>
      </section>
    </div>
  </div>
</template>

<style scoped>
.other-results-toggle{min-height:44px;padding:8px 10px;border:1px solid #bad7df;border-radius:8px;background:#edf6f8;color:#315c6e;font:inherit;font-size:12px;cursor:pointer}.other-results-toggle:focus-visible{outline:2px solid #75bfdf;outline-offset:2px}
.cohort-notice{padding:11px 12px;border:1px solid #bad7df;background:#edf6f8;border-radius:10px;color:#315c6e;font-size:12px;line-height:1.65}.cohort-notice p{margin:5px 0}.cohort-notice button{border:1px solid #8fc3d4;border-radius:7px;background:#fff;color:#176d8b;padding:7px 10px;cursor:pointer}.historical-card>header>b{color:#6d7785;font-weight:500}
.cohort-planning{margin-top:14px;padding:12px;border:1px solid #cde2ed;border-radius:11px;background:#f0f7fb}.cohort-planning h3{margin:0 0 9px;font-size:13px}.cohort-planning ul{list-style:none;margin:0;padding:0}.cohort-planning li{display:flex;justify-content:space-between;gap:12px;padding:9px 0;border-bottom:1px solid #dce9ef;font-size:12px;line-height:1.5}.cohort-planning li span{text-align:right;color:#42677c}.cohort-planning li:last-child{border-bottom:0}.cohort-planning p{font-size:11px;line-height:1.65;color:#557483;margin:8px 0 0}
.official-link{display:block;text-decoration:none}
.matched-dimensions{font-size:11px;color:#285f75;background:#edf7fc;padding:7px 9px;border-radius:7px}.remaining-conditions{font-size:11px;color:#76572d;background:#fff7e8;padding:7px 9px;border-radius:7px}.reference-comparison{border-top:1px solid #e0e9ed;margin-top:10px;padding-top:9px;font-size:11px;color:#655333}.reference-comparison p{margin:5px 0}.reference_match .decision-chip{color:#32647b;background:#e4f3fa}.reference_mismatch .decision-chip{color:#83613b;background:#fff3df}
.eligibility-dialog{color:#173e58}.eligibility-header h2{font-size:25px;margin:6px 0}.eligibility-header>p,.hint{color:#68818f;font-size:11px;line-height:1.65;margin:6px 0}.eligibility-header>span,.panel-head small{color:#227dab;font-size:10px}.eligibility-workspace{display:grid;grid-template-columns:minmax(310px,.9fr) minmax(380px,1.1fr);gap:16px;margin-top:16px}.applicant-form,.result-panel{min-width:0;border:1px solid #cde2ed;border-radius:15px;background:#f8fcff;padding:15px;max-height:72dvh;overflow:auto;overscroll-behavior:contain}.applicant-form{display:grid;gap:12px;align-content:start}.panel-head{display:flex;align-items:start;justify-content:space-between;gap:10px}.panel-head h2{font-size:19px;margin:4px 0 8px}.panel-head button,.school-search-row button,.compact-switch{border:0;border-radius:8px;background:#e4f2f8;color:#236d92;padding:8px 10px;cursor:pointer}.form-section{padding:12px;border:1px solid #d9e8ef;border-radius:11px;background:white;display:grid;gap:10px}.form-section h3{font-size:13px;margin:0}.field-grid,.result-filters{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}label{min-width:0;display:grid;gap:5px;font-size:11px;color:#42677c}input:not([type=checkbox]),select{width:100%;min-width:0;min-height:38px;border:1px solid #c7dfe9;border-radius:8px;padding:8px;color:#1d4660;background:white;font:inherit;box-sizing:border-box}input:focus,select:focus{outline:2px solid #75bfdf;outline-offset:1px}.school-search-row{display:grid;grid-template-columns:1fr auto;gap:6px}.school-match-list{display:grid;gap:5px}.school-match-list button{display:flex;justify-content:space-between;gap:8px;padding:10px;background:#eff8fc;border:1px solid #c8e3ee;border-radius:8px;text-align:left;color:#245978;cursor:pointer}.matched-school{font-size:11px;color:#087862;margin:0}.tag-options{display:flex;gap:7px;flex-wrap:wrap}.tag-options label,.check-line{display:flex;align-items:center;gap:5px}.check-line{line-height:1.5}.extra-fields{font-size:11px}.extra-fields summary{cursor:pointer;color:#1e739a;padding:8px 0}.extra-fields[open] summary{margin-bottom:7px}.evaluate-button{padding:13px;border:0;border-radius:10px;background:#1486bb;color:white;font-weight:800;cursor:pointer}.evaluate-button:disabled{opacity:.5;cursor:default}.error{font-size:12px;line-height:1.6;color:#a33243;background:#fff0f1;padding:9px;border-radius:8px}.batch-tabs{display:flex;gap:5px;flex-wrap:wrap;margin:10px 0}.batch-tabs button{border:1px solid #c6e0eb;border-radius:8px;padding:8px 10px;background:white;color:#3a6a80;cursor:pointer}.batch-tabs button.active{background:#1583b6;color:white;border-color:#1583b6}.result-filters{margin:10px 0}.result-count{font-size:11px;color:#527b8f}.result-list{display:grid;gap:10px}.result-card{border:1px solid #d0e3ed;background:white;border-radius:12px;padding:13px;font-size:12px;line-height:1.6}.result-card>header{display:flex;justify-content:space-between;gap:8px;font-size:10px}.batch-chip{color:#277fa7;background:#edf7fb;border-radius:5px;padding:2px 6px}.decision-chip{color:#826230}.initial_match .decision-chip{color:#09775f}.not_matched .decision-chip{color:#b14c50}.missing_input .decision-chip{color:#247aaa}.result-card h3{font-size:15px;margin:9px 0 0}.result-card p{margin:5px 0;color:#537387}.province-label{font-size:10px!important;color:#7a919f!important}.check-results{list-style:none;padding:8px;background:#f5f9fc;border-radius:7px;margin:9px 0}.check-results li{display:flex;gap:8px;justify-content:space-between}.check-results span{text-align:right;color:#688291}.details-button{background:transparent;border:0;color:#1682b1;cursor:pointer;padding:7px 0;font-size:11px}.requirements{padding-top:6px;border-top:1px solid #e0ebf0}.requirements h4{font-size:12px;margin:10px 0 5px}.requirements ul{padding-left:18px;margin:0}.requirements li{margin:6px 0;overflow-wrap:anywhere}.placeholder{padding:25px 10px;color:#6e8999;font-size:13px;line-height:1.8}.compact-switch{display:none}.embedded{display:contents}.embedded .eligibility-workspace{display:contents;margin:0}.embedded .applicant-form,.embedded .result-panel{position:absolute;z-index:16;top:90px;bottom:58px;max-height:none;box-shadow:0 15px 35px #2a6c8d1c}.embedded .applicant-form{left:18px;width:var(--left-panel-width);box-sizing:border-box}.embedded .result-panel{right:18px;width:var(--right-panel-width);box-sizing:border-box}.embedded .field-grid,.embedded .result-filters{grid-template-columns:1fr}.embedded .panel-head h2{font-size:16px}.embedded .batch-tabs{gap:4px}.embedded .batch-tabs button{padding:7px;font-size:10px}@media(max-width:720px){.eligibility-workspace{grid-template-columns:1fr}.applicant-form,.result-panel{max-height:none}.field-grid{grid-template-columns:1fr}.embedded .compact-switch{display:block}.embedded .applicant-form,.embedded .result-panel{left:10px;right:10px;width:auto;top:85px;bottom:56px}.embedded.compact-form .result-panel{display:none}.embedded.compact-result .applicant-form{display:none}.eligibility-header{padding-right:38px}}
</style>
