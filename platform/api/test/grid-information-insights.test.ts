import { describe, expect, it } from 'vitest';
import { buildInformationInsights, mentionsBachelorRoute, salaryReference, scoreReference } from '../src/lib/grid-information-insights.js';
import { buildGridInformationOverview, type InformationFact, type GridInformationInput } from '../src/lib/grid-information.js';
import { gridVersion, type GridDataset } from '../src/lib/grid-query.js';
import { nativeReviewed2026Notices } from '../src/lib/native-grid-recruitment-2026.js';

const provinces=[{adcode:'420000',name:'湖北省'},{adcode:'150000',name:'内蒙古自治区'},{adcode:'440000',name:'广东省'},{adcode:'130000',name:'河北省'}];
function fact(key:string, patch:Partial<InformationFact>={}):InformationFact {
  return {factKey:key,sourceKey:'excel.safe',cohortYear:2026,grid:'sgcc',batchCode:'campus',scope:'province',province:'湖北',city:null,company:'湖北',category:'education',title:'招聘要求',text:'985院校电工类硕士；特定县局可放宽至本科',educationLevel:null,schoolTier:null,evidenceLocator:'条件!C2',dataStatus:'reference',issueReason:null,relatedOfficialSourceKey:null,
    source:{sourceKey:'excel.safe',title:'条件.xlsx',sourceType:'user_material',sourceUrl:null,note:'参考'},datasetKey:'test',version:'1',origin:'database',yearLabel:'2026',...patch};
}
const allEducation=(result:ReturnType<typeof buildInformationInsights>,historical=false)=>
  (historical?result.educationDistribution.historicalBatches:result.educationDistribution.batches).flatMap(b=>b.groups.flatMap(g=>g.entries));
describe('education and regional insight projections',()=>{
  it('keeps complete exceptions, supplemental conditions, and explicit same-year distribution',()=>{
    const result=buildInformationInsights([fact('current'),fact('supplement',{title:'其他补充',category:'other',text:'英语四级；不招专升本'}),fact('old',{cohortYear:2025}),fact('undated',{cohortYear:null,batchCode:'batch_2'})],provinces,2026);
    expect(allEducation(result)).toHaveLength(1);
    expect(allEducation(result)[0]).toMatchObject({text:'985院校电工类硕士；特定县局可放宽至本科',qualifiers:['英语四级；不招专升本']});
    expect(result.educationDistribution.batches[0]?.groups[0]?.key).toBe('mixed');
    expect(allEducation(result,true).map(e=>e.year)).toEqual([2025,null]);
    expect(result.educationDistribution.batches.find(b=>b.batchCode==='batch_2')).toBeUndefined();
  });
  it('does not transform undated Southern second-batch or rural material into a native hiring batch',()=>{
    const result=buildInformationInsights([fact('csg.generic',{cohortYear:null,grid:'csg',batchCode:'unspecified',province:'广东',company:'广东',title:'二批学历范围（HTML批次标签，未等同春秋招）',text:'南网批次安排不同，以招聘公告为准'}),
      fact('csg.autumn',{grid:'csg',batchCode:'csg_autumn',province:'广东',company:'广东',text:'2026届全日制本科及以上；岗位另有要求'}),fact('rural',{batchCode:'unspecified',title:'供服/农网学历范围',text:'专科及以上'})],provinces,2026);
    expect(allEducation(result).map(e=>e.key)).toEqual(['csg.autumn']);
    expect(result.educationDistribution.batches.find(b=>b.batchCode==='csg_spring')).toBeUndefined();
    expect(result.educationDistribution.batches.find(b=>b.batchCode==='batch_3')).toBeUndefined();
  });
  it('retains Mengdong, Mengxi, Jibei and Shenzhen recruiting scopes separately from province links',()=>{
    const result=buildInformationInsights([fact('east',{province:'内蒙古',company:'蒙东'}),fact('west',{province:'内蒙古',company:'蒙西',grid:'other'}),fact('jibei',{province:'河北',company:'冀北'}),fact('sz',{province:'广东',company:'深圳',grid:'csg',batchCode:'csg_autumn'})],provinces,2026);
    expect(allEducation(result).find(e=>e.key==='east')).toMatchObject({adcode:'150000',region:'蒙东 · 内蒙古'});
    expect(allEducation(result).find(e=>e.key==='jibei')).toMatchObject({adcode:'130000',region:'冀北 · 河北'});
    expect(allEducation(result).find(e=>e.key==='sz')).toMatchObject({adcode:'440000',region:'深圳 · 广东'});
    // Other-grid conditions are not put into a State Grid batch.
    expect(allEducation(result).some(e=>e.key==='west')).toBe(false);
    expect(result.regionInsights.undergraduateEarly.find(e=>e.key==='west')?.grid).toBe('other');
  });
  it('does not turn contradictory/raw flags, experience or missing values into eligibility',()=>{
    const result=buildInformationInsights([fact('flag',{title:'提前批本科通道原始标记',text:'1'}),fact('conflict',{dataStatus:'conflict'}),fact('private',{dataStatus:'quarantined'}),fact('empty',{text:'原资料空白/未提供。'}),fact('experience',{title:'提前批要求（经验）',text:'似乎要求本科'})],provinces,2026);
    expect(allEducation(result)).toEqual([]);
    expect(result.regionInsights.undergraduateEarly).toEqual([]);
  });
  it('requires a positive bachelor route and rejects age-only, negative and prior-degree clauses',()=>{
    for(const text of ['本科不收','不招本科生','本科不能参加提前批','本科≤25岁、硕士≤28岁','银川需985硕士（本科电气专业）'])expect(mentionsBachelorRoute(text)).toBe(false);
    expect(mentionsBachelorRoute('原电以上本科可投')).toBe(true);
    expect(mentionsBachelorRoute('偏远地区可放宽至本科生')).toBe(true);
    expect(mentionsBachelorRoute('南宁需9本/华电本/行程内硕士',true)).toBe(true);
    expect(mentionsBachelorRoute('武汉需985本硕',true)).toBe(false);
    expect(mentionsBachelorRoute('市局需双985硕士',true)).toBe(false);
  });
  it('combines same company clauses without inflating regions, retaining every clause and provenance',()=>{
    const result=buildInformationInsights([fact('one'),fact('two',{text:'另一个岗位：电工本科可参加统一考试后录用',evidenceLocator:'条件!G2'})],provinces,2026);
    const entries=allEducation(result);
    expect(entries).toHaveLength(1);expect(entries[0]?.text).toContain('条款 1');expect(entries[0]?.text).toContain('条款 2');
    expect(entries[0]?.evidenceLocators).toEqual(['条件!C2','条件!G2']);
    expect(result.educationDistribution.batches[0]?.groups[0]?.regionCount).toBe(1);
  });
  it('reuses reviewed native notices without inferring a bachelor requirement or a Mengxi policy',()=>{
    const result=buildInformationInsights([],provinces,2026,nativeReviewed2026Notices);
    expect(result.educationDistribution.batches.map(b=>[b.batchCode,b.regionCount])).toEqual([['csg_autumn',5],['csg_spring',5],['csg_campus',1]]);
    expect(allEducation(result).every(e=>e.grid==='csg'&&e.text.includes('按具体岗位分别规定'))).toBe(true);
    expect(result.regionInsights.undergraduateEarly).toEqual([]);
    expect(result.regionInsights.recruitmentNotices.find(n=>n.grid==='impc')?.noticeSource?.kind).toBe('directory');
    expect(allEducation(buildInformationInsights([],provinces,2027,nativeReviewed2026Notices))).toEqual([]);
    const existing=fact('csg.database',{province:'广东',company:'广东',grid:'csg',batchCode:'csg_autumn',text:'按本公司岗位明确要求'});
    const ownFirst=buildInformationInsights([existing],provinces,2026,nativeReviewed2026Notices);
    const gd=allEducation(ownFirst).filter(e=>e.adcode==='440000'&&e.batchCode==='csg_autumn');
    expect(gd).toHaveLength(1);expect(gd[0]?.key).toBe('csg.database');
  });
  it('database requirement theme wins over an alternate HTML title, same scope only',()=>{
    const result=buildInformationInsights([fact('db'),fact('html',{sourceKey:'html.safe',origin:'html_fallback',title:'一批学历范围',text:'本科',batchCode:'campus'}),fact('html.other',{origin:'html_fallback',province:'广东',company:'广东',title:'一批学历范围',text:'本科'})],provinces,2026);
    expect(allEducation(result).map(e=>e.key)).toEqual(['db','html.other']);
  });
  it('sorts exact salary references only within documented year and tax/tenure basis',()=>{
    const f=fact('salary',{cohortYear:null,category:'compensation',batchCode:'unspecified',text:'地区原文：苏州；数值原文：30w。\n待遇参考（三年后到手年薪）。\n资料时点：2025-26届'});
    const e=buildInformationInsights([f],provinces,2026).regionInsights.salaries[0]!;
    expect(e).toMatchObject({amount:'30w',sortValue:30,comparisonKey:'historical_2025_2026|after_three_years_net_annual|wan_cny',year:null});
    const range=salaryReference({...f,text:f.text.replace('30w','20-30w')},e);
    expect(range).toMatchObject({minimum:20,maximum:30,sortValue:null,amount:'20-30w'});
    expect(salaryReference({...f,text:f.text.replace('30w','约30w')},e).sortValue).toBeNull();
    expect(salaryReference({...f,text:'地区原文：苏州；数值原文：300000元。\n税前年薪\n资料时点：2025-26届'},e)).toMatchObject({sortValue:30,comparisonKey:'historical_2025_2026|gross_annual|wan_cny'});
    expect(salaryReference({...f,text:'地区原文：苏州；数值原文：30w。'},e).sortValue).toBeNull();
  });
  it('uses only explicitly comparable exam lines, never hiring counts, ranges or other majors',()=>{
    const f=fact('score',{batchCode:'batch_1',category:'score',title:'26一批笔试线',educationLevel:'本科',text:'对象：电工类 / 本科。\n71.5'});
    const result=buildInformationInsights([f,fact('same',{...f,factKey:'same',title:'26一批分数线',evidenceLocator:'笔试分数线!K3'}),fact('admission',{...f,factKey:'admission',title:'26一批综合录取分数线',text:'对象：电工类 / 本科。\n76.1'}),fact('headcount',{category:'headcount',title:'录用人数',text:'250'}),fact('masters',{...f,factKey:'masters',text:'对象：电工类 / 硕士。\n68'})],provinces,2026);
    expect(result.regionInsights.scores).toHaveLength(2);
    expect(result.regionInsights.scores.map(s=>s.value)).toEqual([71.5,76.1]);
    expect(scoreReference({...f,text:'对象：电工类 / 本科。\n70-80'},result.regionInsights.scores[0]!)).toBeNull();
    expect(scoreReference({...f,text:'对象：电工类 / 本科。\n0'},result.regionInsights.scores[0]!)).toBeNull();
    expect(scoreReference({...f,title:'26一批分数线',evidenceLocator:'模糊阶段!A3'},result.regionInsights.scores[0]!)).toBeNull();
    expect(scoreReference({...f,educationLevel:'硕士'},result.regionInsights.scores[0]!)).toBeNull();
    const conflicting=buildInformationInsights([f,{...f,factKey:'conflicting',text:'对象：电工类 / 本科。\n72'}],provinces,2026).regionInsights.scores[0]!;
    expect(conflicting).toMatchObject({value:null,displayValue:'71.5 / 72'});
  });
  it('inherits overview visibility filtering before forming the new fields',()=>{
    const a=fact('public'),b=fact('restricted',{sourceKey:'private.safe',text:'PRIVATE_EDUCATION_VALUE'});
    const dataset:GridDataset={schemaVersion:'grid-query-1',datasetKey:'test',version:'1',title:'Test',createdAt:'2026-09-23T00:00:00Z',notes:[],sources:[{...a.source,sha256:'a'.repeat(64)},{...b.source,sourceKey:'private.safe',sha256:'b'.repeat(64)}],policyFacts:[a,b],schoolOutcomes:[]};
    const input:GridInformationInput={snapshot:{datasets:[dataset],versions:[gridVersion(dataset)]},catalogs:[],policies:[],provinces,sources:[{sourceKey:'private.safe',metadata:{visibility:'admin_only'}}]};
    const result=buildGridInformationOverview(input,2026,true);
    expect(result.educationDistribution.batches[0]?.regionCount).toBe(1);
    expect(JSON.stringify(result)).not.toContain('PRIVATE_EDUCATION_VALUE');
    const nativeKey=nativeReviewed2026Notices[0]!.key;
    const blocked=buildGridInformationOverview({...input,sources:[...input.sources!,{sourceKey:nativeKey,metadata:{visibility:'admin_only'}}]},2026,true);
    expect(blocked.regionInsights.recruitmentNotices.some(n=>n.key===nativeKey)).toBe(false);
    const aliasBlocked = buildGridInformationOverview({...input, sources: [...input.sources!, {
      id: 'native-source-alias-id', sourceKey: 'native-source-alias',
      officialUrl: nativeReviewed2026Notices[0]!.sourceUrl, metadata: {visibility: 'admin_only'},
    }]}, 2026, true);
    expect(aliasBlocked.regionInsights.recruitmentNotices.some(n => n.key === nativeKey)).toBe(false);
    expect(aliasBlocked.educationDistribution.batches.flatMap(b => b.groups.flatMap(g => g.entries))
      .some(entry => entry.sourceKeys.includes(nativeKey))).toBe(false);
    expect(aliasBlocked.regionInsights.recruitmentNotices.some(n => n.key === nativeReviewed2026Notices[1]!.key)).toBe(true);
  });
});
