<script setup lang="ts">
import { computed } from 'vue';
import { authState } from '@/services/auth';
import type { InformationOverview } from '@/services/mobile-information';
import type { InsightEvidence } from '@/services/information-insights';
import type { NationalApplicationReference, ReferenceCount, ReferenceProfile } from '@/services/recruitment-reference';
import { hasInformationMetric, informationMetricText } from './information-display';
import { educationPreview, insightContext, salaryAmountLabel } from './information-insights-display';
import { gridBatchLabels } from '../index/grid-information-display';

type Section = 'national' | 'province' | 'education';
const props = withDefaults(defineProps<{
  overview: InformationOverview;
  provinceAdcode?: string;
  grid?: string;
  batchCode?: string;
  sections?: Section[];
}>(), { provinceAdcode: '', grid: '', batchCode: '', sections: () => ['national', 'province', 'education'] });
const enabled = (section: Section) => props.sections.includes(section);
const number = (value: number) => value.toLocaleString('zh-CN');
const countText = (count: ReferenceCount) => count.status === 'reference' && count.value !== null ? number(count.value) : '—';
const sameBatch = (batch: string) => !props.batchCode || batch === props.batchCode || ['all', 'unspecified'].includes(batch);
const nationalRows = computed(() => enabled('national') && !props.provinceAdcode && (!props.grid || props.grid === 'sgcc')
  ? (props.overview.nationalApplicationReferences || []).filter(row => row.cohortYear === props.overview.cohortYear && sameBatch(row.batchCode)) : []);
const publicNotice = (row: NationalApplicationReference) => {
  const metric = props.overview.cards.find(card => card.cohortYear === row.cohortYear && card.grid === row.grid && card.batchCode === row.batchCode)?.publicNotice;
  return metric && hasInformationMetric(metric) ? metric : undefined;
};
const segmentLabel = (segment: string) => ({ yp: '一批', ep: '二批', nd: '农电', sc: '三产' }[segment] || segment);
const batchLabel = (row: NationalApplicationReference) => gridBatchLabels[row.batchCode]?.replace('国网', '') || row.title;
const profiles = computed(() => enabled('province') && props.provinceAdcode
  ? (props.overview.referenceProfiles || []).filter(profile => profile.adcode === props.provinceAdcode && (!props.grid || profile.grid === props.grid) && sameBatch(profile.batchCode))
    .slice().sort((a, b) => (b.cohortYear === props.overview.cohortYear ? 1 : 0) - (a.cohortYear === props.overview.cohortYear ? 1 : 0) || (b.cohortYear || 0) - (a.cohortYear || 0)) : []);
const evidenceMatches = (row: InsightEvidence) => (!props.grid || row.grid === props.grid) && sameBatch(row.batchCode);
const uniqueEvidence = <T extends InsightEvidence>(rows: T[]) => [...new Map(rows.filter(evidenceMatches).map(row => [row.key, row])).values()];
const cityClauses = (profile: ReferenceProfile) => uniqueEvidence([...profile.undergraduateCity.scopeClauses, ...profile.undergraduateCity.conditionClauses]);
const profileGroups = (profile: ReferenceProfile) => [
  { label: '本科市局 / 招聘范围', rows: cityClauses(profile) },
  { label: '院校与城区要求', rows: uniqueEvidence(profile.schoolTierClauses) },
  { label: '外地 / 户籍要求', rows: uniqueEvidence(profile.outsideRegionClauses) },
  { label: '年龄与证书', rows: uniqueEvidence(profile.ageCertificateClauses) },
  { label: '学历与专业条件', rows: uniqueEvidence(profile.educationClauses) },
  { label: '提前批条件', rows: uniqueEvidence(profile.earlyBatchClauses) },
  { label: '定岗与补充条件', rows: uniqueEvidence(profile.assignmentClauses) },
].filter(group => group.rows.length);
const scoreLabel = (kind: string) => kind === 'written' ? '笔试线' : kind === 'admission' ? '综合录取线' : '进面分数参考';
const profileContext = (profile: ReferenceProfile) => insightContext({ year: profile.cohortYear, grid: profile.grid, batchCode: profile.batchCode } as InsightEvidence);
const educationBatches = computed(() => {
  if (!enabled('education')) return [];
  const education = props.overview.educationDistribution;
  return [...(education?.batches || []).map(batch => ({ ...batch, historical: false })), ...(education?.historicalBatches || []).map(batch => ({ ...batch, historical: true }))]
    .filter(batch => (!props.grid || batch.grid === props.grid) && sameBatch(batch.batchCode))
    .map(batch => ({ ...batch, groups: batch.groups.map(group => ({ ...group, entries: group.entries.filter(row => (!props.provinceAdcode || row.adcode === props.provinceAdcode) && evidenceMatches(row)) })).filter(group => group.entries.length) }))
    .filter(batch => batch.groups.length);
});
const educationRegionCount = (entries: InsightEvidence[]) => new Set(entries.map(row => `${row.adcode || row.province}|${row.region}|${row.company || ''}`)).size;
const sourceText = (keys: string[]) => keys.map(key => props.overview.sources.find(source => source.sourceKey === key)?.title || key).join('；');
const hasContent = computed(() => nationalRows.value.length || profiles.value.length || educationBatches.value.length);
</script>

<template>
  <section v-if="authState.authenticated && overview.referenceDataAvailable !== false && hasContent" class="recruitment-reference" aria-label="报名与报考条件">
    <section v-if="nationalRows.length" class="reference-national" aria-label="全国报名情况">
      <div class="reference-heading"><h3>报名与录用</h3><small>{{ overview.cohortYear }}届 · 国网</small></div>
      <div class="reference-batches">
        <article v-for="row in nationalRows" :key="row.key" class="reference-batch">
          <h4>{{ batchLabel(row) }}</h4>
          <dl class="reference-metrics">
            <div><dt>报名{{ row.applications.measureUnit === '报名人次' || row.applications.measureUnit === '人次' ? '人次' : '人数' }}</dt><dd>{{ countText(row.applications) }}</dd></div>
            <div><dt>计划名额</dt><dd><template v-if="row.planReferences.length"><span v-for="count in row.planReferences" :key="count.segment"><small v-if="row.planReferences.length > 1">{{ segmentLabel(count.segment) }} </small>{{ countText(count) }}</span></template><template v-else>—</template></dd></div>
            <div><dt>录用公示</dt><dd>{{ publicNotice(row) ? informationMetricText(publicNotice(row)!) : '—' }}</dd></div>
          </dl>
        </article>
      </div>
      <p class="reference-note">报名与录用公示分别统计；— 表示暂无可用数据。</p>
    </section>
    <details v-if="profiles.length" class="reference-province">
      <summary><b>查看报考详情</b><span class="reference-action">市局条件 · 学历 · 分数 · 待遇</span></summary>
      <details v-for="profile in profiles" :key="profile.key" class="reference-profile">
        <summary><b>{{ profile.company || profile.region }}{{ profile.city ? ` · ${profile.city}` : '' }}</b><span class="reference-context">{{ profileContext(profile) }} · {{ profile.region }}</span></summary><p v-if="profile.yearNote" class="reference-note">{{ profile.yearNote }}</p>
        <div v-for="group in profileGroups(profile)" :key="group.label" class="reference-clause-group"><h5>{{ group.label }}</h5>
          <div v-for="clause in group.rows" :key="clause.key" class="reference-clause"><p>{{ clause.text }}</p><p v-for="(qualifier, index) in clause.qualifiers" :key="index">{{ qualifier }}</p><small>{{ insightContext(clause) }} · {{ clause.nature === 'experience_reference' ? '经验参考' : '条件参考' }}</small><p v-if="clause.sourceKeys.length" class="reference-source">来源：{{ sourceText(clause.sourceKeys) }} · {{ clause.evidenceLocators.join('；') }}</p></div>
        </div>
        <div v-if="profile.scores.filter(evidenceMatches).length" class="reference-clause-group"><h5>分数参考</h5>
          <div v-for="score in profile.scores.filter(evidenceMatches)" :key="score.key" class="reference-clause"><p><b>{{ score.audienceLabel }} · {{ scoreLabel(score.kind) }}：{{ score.displayValue }}</b></p><p>{{ insightContext(score) }} · {{ score.comparisonLabel }}</p><p>{{ score.text }}</p><p v-for="(qualifier, index) in score.qualifiers" :key="index">{{ qualifier }}</p><p v-if="!score.comparable" class="reference-note">适用岗位与专业请以原文为准。</p><p class="reference-source">来源：{{ sourceText(score.sourceKeys) }} · {{ score.evidenceLocators.join('；') }}</p></div>
        </div>
        <div v-if="profile.salaries.filter(evidenceMatches).length" class="reference-clause-group"><h5>待遇经验参考</h5>
          <div v-for="salary in profile.salaries.filter(evidenceMatches)" :key="salary.key" class="reference-clause"><p><b>{{ salaryAmountLabel(salary) }} · {{ salary.location || salary.region }}</b></p><p>{{ insightContext(salary) }} · {{ salary.comparisonLabel }}</p><p>{{ salary.text }}</p><p v-for="(qualifier, index) in salary.qualifiers" :key="index">{{ qualifier }}</p><p class="reference-source">来源：{{ sourceText(salary.sourceKeys) }} · {{ salary.evidenceLocators.join('；') }}</p></div>
        </div>
      </details>
    </details>
    <details v-if="educationBatches.length" class="reference-education"><summary><b>学历条件分布</b><span class="reference-action">查看各批次要求</span></summary>
      <p class="reference-note">统计所收录招聘条件的地区与条目，不推算个人学历或录用占比。</p>
      <details v-for="batch in educationBatches" :key="`${batch.historical ? 'history' : 'current'}-${batch.key}`" class="reference-education-batch"><summary>{{ batch.title }}<small>{{ batch.historical ? '历史条件参考' : `${overview.cohortYear}届条件分组` }} · {{ batch.groups.length }}组</small></summary>
        <div v-for="group in batch.groups" :key="group.key" class="reference-clause-group"><h5>{{ group.label }} <small>{{ props.provinceAdcode ? educationRegionCount(group.entries) : group.regionCount }}个招聘范围</small></h5>
          <details v-for="entry in group.entries" :key="entry.key" class="reference-education-entry"><summary>{{ entry.company || entry.region }}<small>{{ insightContext(entry) }}</small></summary><p>{{ entry.text }}</p><p v-for="(qualifier, index) in entry.qualifiers" :key="index">{{ qualifier }}</p><p class="reference-source">来源：{{ sourceText(entry.sourceKeys) }} · {{ entry.evidenceLocators.join('；') }}</p></details>
        </div>
      </details>
    </details>
  </section>
</template>

<style scoped>
.recruitment-reference { min-width: 0; max-width: 100%; color: #163e55; font-size: 13px; line-height: 1.65; overflow-wrap: anywhere; }
.recruitment-reference p { margin: 5px 0; white-space: pre-line; }
.reference-national,.reference-province,.reference-education { margin: 10px 0; padding: 12px; border: 1px solid #ffffffc4; border-radius: 16px; background: #f7fcff87; }
.reference-heading { display:flex; align-items:baseline; justify-content:space-between; gap:8px; }
.reference-heading h3 { margin:0; font-size:16px; }
.recruitment-reference small,.reference-note,.reference-source { color:#496776; font-size:11px; }
.reference-batches { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:10px; margin-top:8px; }
.reference-batch { min-width:0; padding:10px; border-radius:12px; background:#ffffff6e; }
.reference-batch h4 { margin:0 0 7px; font-size:14px; }
.reference-metrics { display:flex; flex-wrap:wrap; gap:12px; margin:0; }
.reference-metrics > div { flex:1; min-width:60px; }
.reference-metrics dt { font-size:11px; color:#496776; }
.reference-metrics dd { margin:2px 0 0; font-size:16px; font-weight:700; font-variant-numeric:tabular-nums; color:#145566; }
.reference-metrics dd span { display:block; }
.recruitment-reference summary { box-sizing:border-box; min-height:44px; padding:9px 0; color:#174c5d; cursor:pointer; }
.recruitment-reference summary:focus-visible { outline:3px solid #2785a2; outline-offset:3px; }
.reference-action { display:block; font-size:12px; color:#496776; font-weight:400; }
.reference-province { margin:0; padding:0 12px; border-top:0; }
.reference-profile { border-top:1px solid #dce8ed; padding:8px 0; }
.reference-clause-group h5 { margin:7px 0 3px; font-size:13px; color:#174c5d; }
.reference-clause+.reference-clause { margin-top:9px; }
.reference-context { display:block; color:#496776; font-size:12px; }
.reference-source { font-size:11px; }
.reference-education summary small { display:block; }
.reference-education-batch,.reference-education-entry { border-top:1px solid #dce8ed; }
.reference-education-entry { padding-left:8px; }
.reference-education-entry summary { font-size:13px; }
@media(max-width:700px) { .reference-batches { grid-template-columns:minmax(0,1fr); gap:6px; } .reference-batch { padding:8px 10px; } .reference-batch h4 { margin-bottom:3px; } .reference-metrics { gap:8px; } .reference-metrics dd { font-size:15px; } }
@media(prefers-reduced-transparency:reduce) { .reference-national,.reference-province,.reference-education { background:#f8fcff; } }
@media(prefers-contrast:more) { .recruitment-reference,.recruitment-reference small,.reference-note,.reference-source { color:#153949; } .reference-national,.reference-province,.reference-education { background:#fff; border-color:#7198a8; } }
</style>
