import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildGridInformationOverview, buildGridInformationProvince, GRID_INFORMATION_HTML_SHA256, GRID_INFORMATION_HTML_SOURCE_KEY, GRID_INFORMATION_SUPPLEMENT_KEY, type GridInformationInput } from '../src/lib/grid-information.js';
import { gridDatasetSchema, gridFactQuerySchema, gridRankingQuerySchema, gridVersion, queryGridFacts, queryGridRankings, type GridFact, type GridOutcome } from '../src/lib/grid-query.js';
import { buildApp } from '../src/app.js';
import { MemoryStore } from '../src/store/memory.js';
import { secretDigest } from '../src/lib/crypto.js';
import type { AppConfig } from '../src/config.js';

function fixture():GridInformationInput {
  const fact:GridFact={factKey:'excel.requirement',sourceKey:'excel.safe',cohortYear:2026,grid:'sgcc',batchCode:'campus',scope:'province',province:'湖北',city:null,company:'湖北',category:'education',title:'招聘要求',text:'工作簿原文：研究生；仅历史参考。',educationLevel:null,schoolTier:null,evidenceLocator:'提前批情况!C3',dataStatus:'reference',issueReason:null,relatedOfficialSourceKey:null};
  const outcome:GridOutcome={outcomeKey:'large',sourceKey:'roster',cohortYear:2026,grid:'sgcc',batchCode:'batch_1',province:'湖北',city:null,companyKey:'hb',company:'国网湖北',orgCategory:'province_company',parentSchoolKey:'parent',schoolName:'示例大学',campusKey:'campus-a',campusName:'示例大学甲校区',schoolTier:'本科',educationLevel:'本科',schoolOwnership:'公办',schoolProvince:'湖北',industryTags:[],metricType:'public_notice_record_count',recordCount:10,evidenceLocator:'脱敏汇总'};
  const dataset=gridDatasetSchema.parse({schemaVersion:'grid-query-1',datasetKey:'information-fixture',version:'v1',title:'合成测试数据',createdAt:'2026-09-22T00:00:00Z',notes:[],sources:[
    {sourceKey:'excel.safe',title:'工作簿.xlsx',sourceType:'user_material',sha256:'a'.repeat(64),sourceUrl:null,note:'非官方参考'},
    {sourceKey:'html.safe',title:'历史.html',sourceType:'user_material',sha256:'b'.repeat(64),sourceUrl:null,note:'历史参考'},
    {sourceKey:'roster',title:'脱敏公示',sourceType:'roster_aggregate',sha256:'c'.repeat(64),sourceUrl:null,note:'记录数'},
    {sourceKey:'DEMO-PRIVATE-PRIVATE',title:'隔离来源',sourceType:'user_material',sha256:'d'.repeat(64),sourceUrl:null,note:'私有'},
  ],policyFacts:[fact,
    {...fact,factKey:'html.same',sourceKey:'html.safe',province:'湖北省',title:'提前批要求',text:'旧 HTML 条件不能覆盖'},
    {...fact,factKey:'html.missing',sourceKey:'html.safe',title:'招聘流程',text:'仅有 HTML 流程'},
    {...fact,factKey:'excel.unknown',cohortYear:null,title:'提前批流程',text:'年份未标的历史流程'},
    {...fact,factKey:'excel.older',cohortYear:2025,title:'招聘要求',text:'2025 条件不冒充 2026'},
    {...fact,factKey:'city',scope:'city',city:'武汉',title:'市级材料',text:'仅适用武汉'},
    {...fact,factKey:'quarantine',dataStatus:'quarantined',issueReason:'串省',text:'应被隔离的串省条件'},
    {...fact,factKey:'private',sourceKey:'DEMO-PRIVATE-PRIVATE',text:'管理员私有内容'},
  ],schoolOutcomes:[outcome,{...outcome,outcomeKey:'small',campusKey:'campus-b',campusName:'乙校区',recordCount:3}]});
  return {snapshot:{datasets:[dataset],versions:[gridVersion(dataset)]},catalogs:[],policies:[],provinces:[{adcode:'420000',name:'湖北省'}],sources:[],metrics:[]};
}
describe('mobile information source and measurement boundary',()=>{
  it('separates missing source cohorts, condition-only cohorts and protected roster coverage',()=>{
    const input=fixture();
    expect(buildGridInformationOverview(input,2024)).toMatchObject({referenceDataAvailable:false,rosterDataAvailable:false});
    expect(buildGridInformationOverview(input,2025)).toMatchObject({referenceDataAvailable:true,rosterDataAvailable:false});
    const dataset=input.snapshot.datasets[0]!;
    dataset.schoolOutcomes=dataset.schoolOutcomes.map(row=>({...row,recordCount:1}));
    const result=buildGridInformationOverview({...input,snapshot:{...input.snapshot}},2026);
    expect(result).toMatchObject({referenceDataAvailable:true,rosterDataAvailable:true});
    expect(result.cards[1]!.publicNotice.value).toBeNull();
    const hidden={...input,sources:['roster','excel.safe','html.safe'].map(sourceKey=>({sourceKey,metadata:{visibility:'admin_only'}}))};
    expect(buildGridInformationOverview(hidden,2026)).toMatchObject({referenceDataAvailable:false,rosterDataAvailable:false});
  });
  it('keeps released-cell lower bounds, no false zeros, guessed plans or ratios',()=>{
    const result=buildGridInformationOverview(fixture(),2026);
    expect(result.cards[1]!.publicNotice).toMatchObject({value:10,measureUnit:'条公示记录',status:'available'});
    expect(result.cards[0]!.publicNotice.value).toBeNull();
    expect(result.cards.every(c=>c.competition.value===null && c.plan.value===null)).toBe(true);
    expect(result.privacy).toMatchObject({minimumCellCount:5,countBasis:'released_cells_only',suppressionApplied:true});
    expect(JSON.stringify(result)).not.toContain('outcomeKey');
  });
  it('prefers database workbook topic and exposes unknown/historical early material prominently',()=>{
    const result=buildGridInformationProvince(fixture(),2026,'420000')!;
    expect(result.earlyBatch.facts.map(f=>f.factKey)).toEqual(['excel.requirement','city','html.missing']);
    expect(result.earlyBatch.historicalFacts.map(f=>f.factKey)).toEqual(['excel.older','excel.unknown']);
    expect(result.earlyBatch.historicalFacts.find(f=>f.cohortYear===null)!.yearLabel).toContain('年份待核');
    expect(result.earlyBatch.facts.find(f=>f.factKey==='city')).toMatchObject({scope:'city',city:'武汉'});
    expect(JSON.stringify(result)).not.toMatch(/管理员私有内容|应被隔离|旧 HTML 条件不能覆盖/);
    expect(buildGridInformationProvince(fixture(),2026,'999999')).toBeNull();
  });
  it('refuses province totals, overlapping national evidence, suppressed or unknown-zero metrics',()=>{
    const input=fixture();
    const metric={cohortYear:2026,batchCode:'batch_1',metricType:'plan_count',publicationStatus:'published',aggregationGrain:'national',metadata:{grid:'sgcc'},value:'100',unit:'人',sourceKeys:['source.plan']};
    input.metrics=[{...metric,provinceId:'hb'}];expect(buildGridInformationOverview(input,2026).cards[1]!.plan.value).toBeNull();
    input.metrics=[metric];expect(buildGridInformationOverview(input,2026).cards[1]!.plan.value).toBe(100);
    input.metrics=[metric,{...metric,value:200}];expect(buildGridInformationOverview(input,2026).cards[1]!.plan.value).toBeNull();
    input.metrics=[{...metric,privacySuppressed:true}];expect(buildGridInformationOverview(input,2026).cards[1]!.plan).toMatchObject({value:null,status:'suppressed'});
    input.metrics=[{...metric,value:0}];expect(buildGridInformationOverview(input,2026).cards[1]!.plan.value).toBeNull();
    input.metrics=[{...metric,value:0,zeroConfirmed:true}];expect(buildGridInformationOverview(input,2026).cards[1]!.plan.value).toBe(0);
  });
  it('links parent rankings by canonical campus keys including wholly protected campuses',()=>{
    expect(queryGridRankings(fixture().snapshot,gridRankingQuerySchema.parse({})).items[0]).toMatchObject({campusKeys:['campus-a','campus-b'],recordCount:10});
    expect(queryGridRankings(fixture().snapshot,gridRankingQuerySchema.parse({view:'campus'})).items.find(r=>r.schoolKey==='campus-b')).toMatchObject({campusKeys:['campus-b'],recordCount:null,rank:null});
  });
  it('accepts only audited structured reference metrics, never sums two third-batch segments',()=>{
    const input=fixture(),d=input.snapshot.datasets[0]!,base=d.policyFacts[0]!;
    d.datasetKey=GRID_INFORMATION_SUPPLEMENT_KEY;
    const s=d.sources.find(s=>s.sourceKey==='html.safe')!;s.sourceKey=GRID_INFORMATION_HTML_SOURCE_KEY;s.sha256=GRID_INFORMATION_HTML_SHA256;
    const metric=(key:string,batchCode:'batch_1'|'batch_3',segment:'yp'|'nd'|'sc',value:number)=>({...base,factKey:key,sourceKey:GRID_INFORMATION_HTML_SOURCE_KEY,scope:'national' as const,province:null,company:null,batchCode,title:'移动汇总指标：计划人数',text:JSON.stringify({schema:'grid-information-metric-1',metricType:'plan_count',value,measureUnit:'人',scopeLabel:'27个省级招聘主体资料参考',sourceYear:2026,note:'非官方，不与全体系公示记录计算比例。',segment})});
    d.policyFacts.push(metric('plan1','batch_1','yp',19033),metric('plan3n','batch_3','nd',7218),metric('plan3s','batch_3','sc',1653));
    expect(queryGridFacts(input.snapshot,gridFactQuerySchema.parse({})).items.some(f=>f.title.startsWith('移动汇总指标：'))).toBe(false);
    expect(queryGridFacts(input.snapshot,gridFactQuerySchema.parse({}),true).items.some(f=>f.title.startsWith('移动汇总指标：'))).toBe(true);
    const result=buildGridInformationOverview(input,2026);
    expect(result.cards[1]!.plan).toMatchObject({value:19033,status:'reference',sourceYear:2026});
    expect(result.cards[3]!.plan).toMatchObject({value:null,status:'reference',displayValue:'农电 7,218 / 三产 1,653'});
    expect(result.cards[1]!.competition.value).toBeNull();
    const authoritative={...input,metrics:[{cohortYear:2026,batchCode:'batch_1',metricType:'plan_count',publicationStatus:'published',aggregationGrain:'national',metadata:{grid:'sgcc'},value:99,unit:'人'}]};
    expect(buildGridInformationOverview(authoritative,2026).cards[1]!.plan.value).toBe(99);
    const privateSource={...input,sources:[{sourceKey:GRID_INFORMATION_HTML_SOURCE_KEY,metadata:{visibility:'admin_only'}}]};
    expect(buildGridInformationOverview(privateSource,2026).cards[1]!.plan.value).toBeNull();
  });
  it('drops the two inconsistent HTML raw flags but keeps detailed prose and original year',()=>{
    const input=fixture(),d=input.snapshot.datasets[0]!,base=d.policyFacts[0]!;
    d.policyFacts.push({...base,factKey:'raw.flag',sourceKey:'html.safe',title:'提前批本科通道原始标记',text:'0'});
    expect(queryGridFacts(input.snapshot,gridFactQuerySchema.parse({})).items.some(f=>f.factKey==='raw.flag')).toBe(false);
    expect(queryGridFacts(input.snapshot,gridFactQuerySchema.parse({}),true).items.some(f=>f.factKey==='raw.flag')).toBe(true);
    const result=buildGridInformationProvince(input,2026,'420000')!;
    expect(result.earlyBatch.facts.some(f=>f.factKey==='raw.flag')).toBe(false);
    expect(result.earlyBatch.facts.some(f=>f.factKey==='excel.requirement')).toBe(true);
  });
});
const config:AppConfig={nodeEnv:'test',host:'127.0.0.1',port:8790,trustProxyHops:0,databaseUrl:'postgresql://unused',publicOrigins:['https://example.test'],cookieSecure:true,sessionTtlSeconds:7200,sessionSecret:'test-session-'.padEnd(48,'s'),phonePepper:'test-pepper-'.padEnd(48,'p'),phoneEncryptionKey:Buffer.alloc(32,7),mapGeojsonDir:'/tmp',autoMigrate:false};
describe('mobile information authenticated API',()=>{
  const store=new MemoryStore();let app:Awaited<ReturnType<typeof buildApp>>;let userId:string;
  beforeAll(async()=>{
    const f=fixture();store.seedGridDataset(f.snapshot.datasets[0]);
    await store.createResource('provinces',{adcode:'420000',name:'湖北省',provinceKey:'hb',publicationStatus:'published'},'test-admin');
    const admin=await store.upsertAdmin({username:'info-admin',displayName:'Test',passwordHash:'test'});
    const user=await store.createUser({phoneLookupHash:'info-test',phoneCiphertext:'opaque',phoneLast4:'0000',passwordHash:'test',createdByAdminId:admin.id});userId=user.id;
    const session={csrfHash:'test',expiresAt:new Date(Date.now()+60000),ipHash:'test',userAgentHash:'test'};
    await store.createUserSession(user.id,{...session,tokenHash:secretDigest('info-user',config.sessionSecret)});
    await store.createAdminSession(admin.id,{...session,tokenHash:secretDigest('info-admin',config.sessionSecret)});
    app=await buildApp({config,store});
  });
  afterAll(async()=>{await app.close();});
  it('requires the user audience, validates year/adcode and serves no-store',async()=>{
    for(const path of ['overview','provinces/420000']){
      expect((await app.inject({url:`/api/v2/private/grid-information/${path}`})).statusCode).toBe(401);
      expect((await app.inject({url:`/api/v2/private/grid-information/${path}`,headers:{cookie:'hz_admin_session=info-admin'}})).statusCode).toBe(401);
      const response=await app.inject({url:`/api/v2/private/grid-information/${path}`,headers:{cookie:'hz_user_session=info-user'}});
      expect(response.statusCode).toBe(200);expect(response.headers['cache-control']).toContain('no-store');expect(response.json().schemaVersion).toBe('grid-information-1');
    }
    for(const path of ['overview?cohortYear=2026&admin=true','overview?cohortYear=oops','provinces/not-code'])expect((await app.inject({url:`/api/v2/private/grid-information/${path}`,headers:{cookie:'hz_user_session=info-user'}})).statusCode).toBe(400);
    expect((await app.inject({url:'/api/v2/private/grid-information/provinces/999999',headers:{cookie:'hz_user_session=info-user'}})).statusCode).toBe(404);
  });
  it('revokes the new endpoints when the user is disabled',async()=>{
    await store.updateUser(userId,{enabled:false});expect((await app.inject({url:'/api/v2/private/grid-information/overview',headers:{cookie:'hz_user_session=info-user'}})).statusCode).toBe(401);
  });
});
