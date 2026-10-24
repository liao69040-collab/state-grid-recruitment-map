<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { createMobileNavigation, queryText } from '../mobile/mobile-navigation';
import type { InformationOverview } from '@/services/mobile-information';
import type { InsightEvidence, SalaryReference, ScoreReference } from '@/services/information-insights';
import { hasInformationProvinceContent } from './information-display';
import { compactRegionInsightModes, compactRegionReferences, comparisonOptions, conditionEvidenceRows, difficultyComparisonRows, insightContext, matchesInsightProvince, regionInsightModes, salaryAmountLabel, scoreKindLabel, sortedComparableRows, type RegionInsightMode } from './information-insights-display';
import type { DirectRegionMode } from './mobile-information-navigation';
import RecruitmentReferencePanel from './RecruitmentReferencePanel.vue';

const route=useRoute(),navigation=createMobileNavigation(useRouter());
const historyEnabled=computed(()=>route.name==='mobile-query'||route.name==='information');
const props=withDefaults(defineProps<{overview:InformationOverview;compact?:boolean;directMode?:DirectRegionMode}>(),{compact:false});
defineEmits<{(e:'open-province',adcode:string):void}>();
const mode=ref<RegionInsightMode>('all'),search=ref(''),groupKey=ref(''),direction=ref<'asc'|'desc'>('desc'),historical=ref(false),limit=ref(12);
const modes=computed(()=>props.compact?compactRegionInsightModes:regionInsightModes);
const provinceCode=ref(''),grid=ref('');
const filterExpanded=ref(false);
const insights=computed(()=>props.overview.regionInsights);
const allEvidence=computed(()=>{
  const i=insights.value;
  const profiles=(props.overview.referenceProfiles??[]).flatMap(profile=>[
    ...profile.undergraduateCity.scopeClauses,...profile.undergraduateCity.conditionClauses,
    ...profile.schoolTierClauses,...profile.outsideRegionClauses,...profile.ageCertificateClauses,
    ...profile.educationClauses,...profile.earlyBatchClauses,...profile.assignmentClauses,...profile.scores,...profile.salaries,
  ]);
  return [...(i?[...i.undergraduateCity,...i.undergraduateEarly,...i.salaries,...i.scores,...(i.recruitmentNotices??[])]:[]),
    ...(props.overview.educationDistribution?.batches??[]).flatMap(b=>b.groups.flatMap(g=>g.entries)),...profiles];
});
const matchesRegion=(r:InsightEvidence)=>(!provinceCode.value||r.adcode===provinceCode.value)&&(!grid.value||r.grid===grid.value);
const provinces=computed(()=>props.overview.provinces.filter(hasInformationProvinceContent).filter(p=>matchesInsightProvince(p,allEvidence.value,{q:search.value,provinceCode:provinceCode.value,grid:grid.value})));
const directCards=computed(()=>{
  if(!props.directMode)return [];
  const q=search.value.trim();
  return compactRegionReferences(props.overview.referenceProfiles??[],props.directMode,props.overview.cohortYear,props.overview.photoCardScores??[])
    .filter(row=>(!provinceCode.value||row.adcode===provinceCode.value)&&(!grid.value||row.grid===grid.value)&&(!q||row.searchable.includes(q)));
});
const visibleDirectCards=computed(()=>directCards.value.slice(0,limit.value));
const comparable=computed<(SalaryReference|ScoreReference)[]>(()=>mode.value==='salary'?insights.value?.salaries??[]:mode.value==='difficulty'?difficultyComparisonRows(insights.value?.scores??[]):(insights.value?.scores??[]).filter(row=>row.kind===mode.value));
const options=computed(()=>comparisonOptions(comparable.value));
const effectiveGroup=computed(()=>options.value.some(o=>o.key===groupKey.value)||groupKey.value==='unmatched'?groupKey.value:options.value[0]?.key??'unmatched');
const hasUnmatched=computed(()=>comparable.value.some(r=>!r.comparisonKey));
const showComparisonSelect=computed(()=>options.value.length+(hasUnmatched.value?1:0)>1);
const comparisonLabel=computed(()=>options.value.find(o=>o.key===effectiveGroup.value)?.label||(mode.value==='salary'?'其他待遇明细':'其他分数明细（不排序）'));
watch(options,items=>{if(!items.some(o=>o.key===groupKey.value)&&!(groupKey.value==='unmatched'&&hasUnmatched.value))groupKey.value=items[0]?.key??'unmatched';},{immediate:true});
const conditions=computed(()=>conditionEvidenceRows(mode.value==='city'?insights.value?.undergraduateCity??[]:insights.value?.undergraduateEarly??[],props.overview.cohortYear,historical.value));
const rows=computed(()=>{
  const selected=['salary','difficulty','written','admission'].includes(mode.value)?sortedComparableRows(comparable.value,effectiveGroup.value,direction.value):conditions.value;
  const q=search.value.trim();return selected.filter(r=>matchesRegion(r)&&(!q||[r.region,r.company,r.text].some(t=>t?.includes(q))));
});
const visible=computed(()=>rows.value.slice(0,limit.value));
watch(mode,()=>{groupKey.value=options.value[0]?.key??'unmatched';historical.value=mode.value==='city';limit.value=12;},{flush:'sync'});
watch([search,groupKey,historical,direction,provinceCode,grid],()=>{limit.value=12;});
const regionTags=(adcode:string)=>{
  const data=insights.value;if(!data)return [];
  return [...new Set([...(data.recruitmentNotices??[]),...data.undergraduateCity,...data.undergraduateEarly,...data.salaries,...data.scores].filter(e=>e.adcode===adcode&&(!grid.value||e.grid===grid.value)).map(e=>e.company||e.province))].slice(0,4);
};
const displayText=(text:string)=>text.replace(/地区原文/g,'地区').replace(/数值原文/g,'金额');
const isSalary=(row:InsightEvidence):row is SalaryReference=>'amount' in row&&'sortValue' in row;
const isScore=(row:InsightEvidence):row is ScoreReference=>'displayValue' in row&&'value' in row;
const rowContext=(row:InsightEvidence)=>insightContext(row).replace(/ 届参考/g,' 届').replace('历史参考 · 年份未注明','历年条件');
const salaryLocation=(row:SalaryReference)=>row.location&&row.location!==row.region?row.location:'';
function selectMode(value:RegionInsightMode){
  if(historyEnabled.value)void navigation.push({insightMode:value==='all'?null:value,insightGroup:null,insightHistorical:value==='city'?'1':null});
  else mode.value=value;
}
function restoreInsightRoute(){
  if(!historyEnabled.value)return;
  const requested=queryText(route.query,'insightMode');
  mode.value=props.directMode||(modes.value.some(item=>item.key===requested)?requested as RegionInsightMode:'all');
  search.value=queryText(route.query,'insightSearch');
  const province=queryText(route.query,'insightProvince');
  provinceCode.value=props.overview.provinces.some(item=>item.adcode===province)?province:'';
  const operator=queryText(route.query,'insightGrid');grid.value=['sgcc','csg','impc','other'].includes(operator)?operator:'';
  groupKey.value=queryText(route.query,'insightGroup')||options.value[0]?.key||'unmatched';
  direction.value=queryText(route.query,'insightOrder')==='asc'?'asc':'desc';
  historical.value=queryText(route.query,'insightHistorical')==='1'||!queryText(route.query,'insightHistorical')&&mode.value==='city';
}
watch(()=>route.fullPath,restoreInsightRoute,{immediate:true});
watch(()=>props.directMode,value=>{if(value)mode.value=value;limit.value=12;},{immediate:true});
watch([search,groupKey,historical,direction,provinceCode,grid],()=>{
  if(historyEnabled.value)void navigation.replace({insightSearch:search.value,insightGroup:groupKey.value,insightHistorical:historical.value?'1':'0',insightOrder:direction.value==='desc'?null:direction.value,insightProvince:provinceCode.value,insightGrid:grid.value});
});
</script>

<template>
  <section class="region-insights" :class="{'is-compact':compact}" :aria-labelledby="compact?undefined:'region-insights-title'" :aria-label="compact?'地区条件':undefined">
    <header v-if="!compact"><div><span class="eyebrow">全国招聘地区</span><h2 id="region-insights-title">选地区，看机会与条件</h2></div><span class="year">{{ overview.cohortYear }} 届</span></header>
    <nav v-if="!directMode" class="insight-tabs" aria-label="地区条件分类"><button v-for="item in modes" :key="item.key" :class="{active:mode===item.key}" :aria-pressed="mode===item.key" @click="selectMode(item.key)">{{ item.label }}</button></nav>
    <div class="compact-region-search"><label class="search"><span>地区 / 公司</span><input v-model="search" placeholder="搜索湖北、蒙东、深圳…" type="search" /></label><button v-if="directMode" class="compact-filter-toggle" type="button" :aria-expanded="filterExpanded" @click="filterExpanded=!filterExpanded">筛选</button></div>
    <div v-if="!directMode||filterExpanded" class="controls region-controls"><label class="compare"><span>地区</span><select v-model="provinceCode"><option value="">全国</option><option v-for="province in overview.provinces.filter(hasInformationProvinceContent)" :key="province.adcode" :value="province.adcode">{{ province.name }}</option></select></label><label class="compare"><span>电网</span><select v-model="grid"><option value="">全部电网</option><option value="sgcc">国家电网</option><option value="csg">南方电网</option><option value="impc">内蒙古电力（蒙西）</option><option value="other">其他地方电力企业</option></select></label></div>
    <template v-if="directMode">
      <p class="compact-reading-note">{{ overview.cohortYear }}届资料参考 · 历年条件、待遇与完整限制见详情</p>
      <div class="compact-region-list">
        <article v-for="row in visibleDirectCards" :key="row.key" class="compact-region-card">
          <button type="button" class="compact-region-row" :aria-label="`查看${row.company||row.region}详情`" @click="$emit('open-province',row.adcode)">
            <span class="compact-region-left"><strong>{{ row.company||row.region }}</strong><small>{{ row.tags.filter(tag=>!/^\d{4}届$/u.test(tag)).join(' · ') }}<template v-if="row.company&&row.company!==row.region"> · {{ row.region }}</template></small><span class="compact-region-clause">{{ row.summary }}</span></span>
            <span class="compact-region-right"><span v-for="badge in row.badges" :key="badge.key" class="compact-region-badge" :title="badge.note">{{ badge.label }}<small v-if="badge.qualifier">{{ badge.qualifier }}</small></span><span class="compact-region-detail">详情 <span aria-hidden="true">→</span></span></span>
          </button>
        </article>
      </div>
      <p v-if="!directCards.length" class="empty">当前范围暂无已收录资料，请换地区或查看其他入口。</p>
      <button v-if="visibleDirectCards.length<directCards.length" class="load-more" @click="limit+=12">继续查看（{{ visibleDirectCards.length }} / {{ directCards.length }}）</button>
    </template>
    <template v-else-if="mode==='all'">
      <p class="intro">国网、南网与地方电力企业按各自招聘范围查看；同省内的不同招聘主体分别保留。</p>
      <div class="province-grid"><article v-for="province in provinces" :key="province.adcode" class="province-reference-row"><button type="button" @click="$emit('open-province',province.adcode)"><strong>{{ province.name }}</strong><small>{{ regionTags(province.adcode).join(' · ')||'招聘条件与地区详情' }}</small><span>查看详情 →</span></button><RecruitmentReferencePanel :overview="overview" :province-adcode="province.adcode" :grid="grid" :sections="['province']" /></article></div>
      <p v-if="!provinces.length" class="empty">没有匹配的地区，请换一个关键词。</p>
    </template>
    <template v-else>
      <p v-if="mode==='city'" class="intro">本科可报市局的地区及院校、专业要求，点击地区查看完整条件。</p>
      <p v-else-if="mode==='early'" class="intro">本科提前批通道，须同时满足所列院校、专业和岗位要求。</p>
      <p v-else-if="mode==='salary'" class="intro">历年到手待遇，不代表应届起薪；按同年份、同口径比较。</p>
      <p v-else-if="mode==='difficulty'" class="intro">笔试线与综合录取线分别比较；同年、同批次、同专业口径排序，不等于个人录取概率。</p>
      <p v-else class="intro">同年、同批次电工类本科{{ mode==='written'?'笔试线':'综合录取线' }}，不等于个人录取概率。</p>
      <div v-if="mode==='city'||mode==='early'" class="controls"><label><input v-model="historical" type="checkbox" /> 包含历年条件</label><span>{{ rows.length }} 项条件</span></div>
      <div v-else class="controls comparison-controls"><label v-if="showComparisonSelect" class="compare"><span>比较范围</span><select v-model="groupKey"><option v-for="option in options" :key="option.key" :value="option.key">{{ option.label }}</option><option v-if="hasUnmatched||!options.length" value="unmatched">其他明细（不排序）</option></select></label><span v-else class="comparison-label">{{ comparisonLabel }}</span><button class="order" @click="direction=direction==='desc'?'asc':'desc'">{{ direction==='desc'?'从高到低 ↓':'从低到高 ↑' }}</button></div>
      <div class="insight-list">
        <article v-for="row in visible" :key="row.key" class="insight-card">
          <header><div class="insight-row-title"><h3>{{ row.region }}</h3><small v-if="isSalary(row)">{{ salaryLocation(row) }}</small><small v-else>{{ rowContext(row) }}</small><small v-if="mode==='difficulty'&&isScore(row)" class="score-kind">{{ scoreKindLabel(row.kind) }}</small></div><div class="insight-row-value"><strong v-if="isSalary(row)" class="number">{{ salaryAmountLabel(row) }}<small v-if="row.sortValue===null">范围 / 明细</small></strong><strong v-else-if="isScore(row)" class="number">{{ row.displayValue }}<small>{{ row.value===null?'数值不一致':'分' }}</small></strong><button v-if="row.adcode" class="open-region" @click="$emit('open-province',row.adcode)" :aria-label="`查看${row.region}招聘条件`">地区详情 →</button></div></header>
          <template v-if="mode==='city'||mode==='early'"><p class="clause condition-summary">{{ row.text }}</p><details v-if="row.qualifiers.length"><summary>完整限制条件</summary><p v-for="(text,index) in row.qualifiers" :key="index" class="clause">{{ text }}</p></details></template>
          <details v-else><summary>适用范围与说明</summary><p class="clause">{{ displayText(row.text) }}</p><p v-for="(text,index) in row.qualifiers" :key="index" class="clause">{{ text }}</p></details>
        </article>
      </div>
      <p v-if="!rows.length" class="empty">当前范围没有可比较的条目。可切换年份范围或查看全国地区详情。</p>
      <button v-if="visible.length<rows.length" class="load-more" @click="limit+=12">继续查看（已显示 {{ visible.length }} / {{ rows.length }}）</button>
    </template>
  </section>
</template>

<style scoped>
.region-insights{color:#193c33}.region-insights>header,.insight-card header{display:flex;justify-content:space-between;gap:15px;align-items:flex-start}.eyebrow{font-size:12px;color:#738e82;letter-spacing:.08em}.region-insights h2{font-size:24px;margin:6px 0 18px}.year{color:#287961;background:#e4f0e9;border-radius:18px;padding:7px 12px;font-size:12px;white-space:nowrap}.insight-tabs{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:18px}.insight-tabs button{font:inherit;font-size:13px;color:#406d5b;background:#fff;border:1px solid #cfe1d6;border-radius:22px;padding:10px 14px;cursor:pointer}.insight-tabs button.active{background:#077759;color:#fff;border-color:#077759}.search{display:flex;align-items:center;gap:12px;background:#fff;border:1px solid #d5e5dd;border-radius:13px;padding:10px 14px}.search>span{color:#6d8a7e;font-size:12px;white-space:nowrap}.search input{width:100%;min-width:0;border:0;outline:0;font:inherit;font-size:14px;color:#183b30;background:transparent}.intro,.empty,.comparison-label{font-size:13px;line-height:1.7;color:#6f877d}.comparison-label{color:#0b7658}.province-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.province-grid button{border:1px solid #deebe3;border-radius:18px;background:#fff;padding:18px;text-align:left;color:#173d30;cursor:pointer;font:inherit}.province-grid strong,.province-grid small,.province-grid span{display:block}.province-grid strong{font-size:17px}.province-grid small{color:#7f968a;line-height:1.6;margin:8px 0 13px;min-height:21px}.province-grid span{font-size:12px;color:#08795a}.controls{display:flex;justify-content:space-between;align-items:center;gap:12px;margin:16px 0;color:#60816f;font-size:13px}.compare{display:flex;align-items:center;gap:10px;min-width:0}.compare span{white-space:nowrap}.controls select{border:1px solid #cfe0d6;padding:9px;border-radius:9px;min-width:0;max-width:100%;background:#fff;color:#365e4b}.order{flex:none;padding:9px 12px;border:1px solid #d5e6db;border-radius:10px;color:#386b52;background:#fff;cursor:pointer}.insight-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.insight-card{border:1px solid #dce9e1;border-radius:18px;background:#fff;padding:18px;min-width:0}.insight-card h3{margin:0 0 5px;font-size:17px}.insight-card header small{font-size:11px;color:#83968d;line-height:1.5}.number{font-size:26px;color:#097758;flex:none}.number small{display:block;text-align:right;font-weight:400}.location{font-size:14px;color:#436e59}.clause{white-space:pre-line;overflow-wrap:anywhere;line-height:1.75;font-size:13px;color:#486554}.insight-card details{font-size:12px;line-height:1.65;margin-top:12px}.insight-card summary{color:#668978;cursor:pointer}.insight-card footer{border-top:1px solid #edf2ee;padding-top:12px;margin-top:16px;display:flex;justify-content:space-between;align-items:center;gap:10px}.insight-card footer span{font-size:11px;background:#f3f7f3;border-radius:6px;padding:4px 7px;color:#81968a}.insight-card footer button{border:0;background:transparent;font-size:12px;color:#077458;cursor:pointer}.load-more{display:block;margin:20px auto;background:#fff;border:1px solid #cae1d3;border-radius:12px;padding:12px 24px;color:#237456;cursor:pointer}.region-insights button:focus-visible,.region-insights summary:focus-visible,.region-insights input:focus-visible,.region-insights select:focus-visible{outline:3px solid #4eb68f;outline-offset:3px}@media(max-width:650px){.region-insights h2{font-size:21px}.province-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.province-grid button{padding:15px}.insight-list{grid-template-columns:1fr}.controls{flex-wrap:wrap}.compare{width:100%}.controls select{flex:1}.insight-tabs{gap:6px}.insight-tabs button{padding:9px 11px;font-size:12px}.insight-card{padding:16px}.number{font-size:24px}}
.region-controls{margin:12px 0}.region-controls .compare{flex:0 1 44%}.region-controls select{width:100%}
.province-reference-row{min-width:0}.province-reference-row>button{width:100%;min-height:44px}.province-reference-row:has(>.recruitment-reference)>button{border-bottom-left-radius:0;border-bottom-right-radius:0}
.province-reference-row>button{display:grid;grid-template-columns:minmax(0,1fr) auto;column-gap:8px;padding:12px 14px}.province-reference-row>button>small{grid-column:1;margin:3px 0 0;min-height:0}.province-reference-row>button>span{grid-column:2;grid-row:1 / 3;align-self:center;white-space:nowrap}@media(max-width:650px){.province-grid{grid-template-columns:minmax(0,1fr)}}
.comparison-controls{margin:12px 0}.comparison-label{margin:0;min-width:0}.comparison-controls .compare{flex:1}.comparison-controls select{width:100%}
.insight-list{display:block;border:1px solid #dce9e1;border-radius:16px;overflow:hidden;background:#fff}
.insight-card{padding:15px 20px;border:0;border-radius:0}.insight-card+.insight-card{border-top:1px solid #e2ebe5}
.insight-card header{align-items:center;gap:16px}.insight-card h3{margin:0;font-size:17px}.insight-row-title{min-width:0}.insight-row-title>small{display:block;margin-top:4px;overflow-wrap:anywhere}
.insight-row-value{display:flex;align-items:center;gap:16px;flex-shrink:0}.number{font-size:23px;font-variant-numeric:tabular-nums}.number small{font-size:10px}
.open-region{border:0;background:transparent;padding:7px 0 7px 8px;color:#08765a;white-space:nowrap;font:inherit;font-size:12px;cursor:pointer}
.condition-summary{margin:7px 0 0}.insight-card details{margin-top:7px}.insight-card summary{font-size:11px}.insight-card details[open]{padding-top:4px}
@media(max-width:650px){.region-controls{flex-wrap:nowrap;gap:10px}.region-controls .compare{width:auto;flex:1;gap:6px}.region-controls select{width:100%;font-size:12px;padding:9px 6px}.region-controls .compare>span{font-size:12px}.comparison-controls .compare{width:100%;flex-basis:100%}.insight-card{padding:13px 15px}.insight-row-value{gap:8px;flex-direction:column;align-items:flex-end}.insight-card h3{font-size:16px}.number{font-size:22px}.open-region{font-size:11px;padding:0 0 0 8px}}
.compact-region-search{display:flex;gap:8px;align-items:stretch}.compact-region-search>.search{flex:1;min-width:0;min-height:44px;box-sizing:border-box}.compact-filter-toggle,.compact-region-detail{font:inherit;min-height:44px;flex:none;cursor:pointer;color:#135b70;border:1px solid #bad5df;background:#eef8fb;border-radius:11px;padding:8px 12px}.compact-reading-note{margin:8px 0;color:#496472;font-size:12px}.compact-region-list{display:grid;gap:9px}.compact-region-card{min-width:0;padding:12px;border:1px solid #c9dce5;border-radius:14px;background:rgba(249,253,255,.88);color:#173b4a}.compact-region-heading{display:flex;justify-content:space-between;align-items:center;gap:10px}.compact-region-heading>div{min-width:0}.compact-region-heading h3{margin:0;font-size:16px;line-height:1.4;overflow-wrap:anywhere}.compact-region-heading small{font-size:11px;color:#4e6977}.compact-region-detail{white-space:nowrap;font-size:13px;font-weight:650}.compact-region-tags{display:flex;flex-wrap:wrap;gap:5px;margin:6px 0}.compact-region-tags>span{font-size:11px;line-height:1.5;padding:2px 6px;border-radius:6px;background:#eaf2f6;color:#3c5f70;overflow-wrap:anywhere}.compact-region-clause{margin:0;white-space:normal;overflow-wrap:anywhere;font-size:13px;line-height:1.65;color:#173b4a}@media(max-width:360px){.compact-region-card{padding:10px}.compact-region-detail{font-size:12px;padding:8px 10px}.compact-region-heading h3{font-size:15px}.compact-region-search .search{gap:6px;padding:8px 10px}.compact-region-search .search>span{font-size:11px}}@media(prefers-reduced-transparency:reduce){.compact-region-card{background:#f8fcff}}@media(prefers-contrast:more){.compact-region-card{background:#fff;border-color:#7198a8}.compact-region-tags>span,.compact-reading-note{color:#153949}}
.compact-region-card{padding:0}.compact-region-list{gap:6px}.compact-region-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,112px);align-items:center;gap:10px;width:100%;min-height:44px;box-sizing:border-box;padding:9px 11px;border:0;background:transparent;color:inherit;text-align:left;font:inherit;cursor:pointer}.compact-region-left,.compact-region-right{min-width:0}.compact-region-left>strong{display:block;font-size:16px;line-height:1.4;overflow-wrap:anywhere}.compact-region-left>small{display:block;font-size:11px;color:#446475;margin:2px 0 3px;overflow-wrap:anywhere}.compact-region-left>.compact-region-clause{display:block;font-size:12px;line-height:1.5}.compact-region-right{display:flex;flex-direction:column;align-items:flex-end;gap:4px}.compact-region-badge{max-width:100%;box-sizing:border-box;font-size:11px;line-height:1.4;padding:3px 6px;border-radius:6px;background:#e8f1f7;color:#194b65;text-align:right;overflow-wrap:anywhere}.compact-region-right>.compact-region-detail{min-height:0;padding:1px 0;border:0;border-radius:0;background:transparent;font-size:12px;color:#0d607b;font-weight:650;white-space:nowrap}.compact-region-row:focus-visible{outline:3px solid #3295b5;outline-offset:2px}.compact-region-row:hover{background:#edf7fa66;border-radius:14px}@media(max-width:360px){.compact-region-row{grid-template-columns:minmax(0,1fr) minmax(0,98px);gap:8px;padding:8px 9px}.compact-region-left>strong{font-size:15px}.compact-region-badge{font-size:10px;padding:3px 5px}}@media(prefers-reduced-transparency:reduce){.compact-region-row:hover{background:#edf7fa}}@media(prefers-contrast:more){.compact-region-badge{background:#e5eef5;color:#103e56}.compact-region-left>small{color:#163e52}}
.compact-region-badge>small{display:block;font-size:10px;font-weight:400;line-height:1.4}
</style>
