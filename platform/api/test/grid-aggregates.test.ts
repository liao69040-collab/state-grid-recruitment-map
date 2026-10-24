import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { AppConfig } from '../src/config.js';
import { secretDigest } from '../src/lib/crypto.js';
import { EXACT_AGGREGATE_BASIS, gridAggregateRankingQuerySchema, queryExactGridCompany, queryExactGridOverview, queryExactGridRankings, queryExactGridSchool, queryExactInformation } from '../src/lib/grid-aggregates.js';
import type { GridInformationInput } from '../src/lib/grid-information.js';
import { gridMapCatalogSchema } from '../src/lib/grid-map-catalog.js';
import { gridMapQuerySchema, queryGridMapOverview } from '../src/lib/grid-map.js';
import { gridChecksum, gridDatasetSchema, gridRankingQuerySchema, gridVersion } from '../src/lib/grid-query.js';
import { MemoryStore } from '../src/store/memory.js';

function fixture():GridInformationInput {
  const row={outcomeKey:'hb1',sourceKey:'roster',cohortYear:2026,grid:'sgcc',batchCode:'batch_1',province:'湖北',city:null,companyKey:'hb',company:'湖北电力',orgCategory:'province_company',parentSchoolKey:'school',schoolName:'测试大学',campusKey:'campus-a',campusName:'测试大学甲校区',schoolTier:'211',educationLevel:'本科',schoolOwnership:'公办',schoolProvince:'湖北',industryTags:[],metricType:'public_notice_record_count',recordCount:10,evidenceLocator:'脱敏汇总'};
  const fact={factKey:'policy',sourceKey:'policy',cohortYear:2026,grid:'sgcc',batchCode:'batch_1',scope:'company',province:'湖北',city:null,company:'参考单位',category:'application',title:'参考说明',text:'报名人次不是录用人数。',educationLevel:null,schoolTier:null,evidenceLocator:'参考材料',dataStatus:'reference',issueReason:null,relatedOfficialSourceKey:null};
  const d=gridDatasetSchema.parse({schemaVersion:'grid-query-1',datasetKey:'exact-test',version:'v1',title:'匿名合成测试',createdAt:'2026-09-22T00:00:00Z',notes:[],
    sources:[{sourceKey:'roster',title:'合成公示',sourceType:'roster_aggregate',sha256:'a'.repeat(64),sourceUrl:null,note:'公示记录'},{sourceKey:'policy',title:'资料参考',sourceType:'user_material',sha256:'b'.repeat(64),sourceUrl:null,note:'非官方'}],
    policyFacts:[fact,{...fact,factKey:'quarantined',company:'隔离单位',dataStatus:'quarantined',issueReason:'来源冲突',text:'不应出现在用户详情'}],
    schoolOutcomes:[row,{...row,outcomeKey:'hb2',batchCode:'batch_2',recordCount:2},{...row,outcomeKey:'zj1',province:'浙江',companyKey:'zj',company:'浙江电力',recordCount:20},
      {...row,outcomeKey:'csg-spring',province:'广东',companyKey:'gd',company:'广东电网',grid:'csg',batchCode:'csg_spring',recordCount:5},
      {...row,outcomeKey:'csg-autumn',province:'广东',companyKey:'gd',company:'广东电网',grid:'csg',batchCode:'csg_autumn',recordCount:7},
      {...row,outcomeKey:'no-province',province:null,companyKey:'direct',company:'全国直属',orgCategory:'direct_unit',recordCount:8},
      {...row,outcomeKey:'tiny',campusKey:'campus-b',campusName:'乙校区',recordCount:1}]});
  const region=(adcode:string,name:string)=>({adcode,name,provinceAdcode:null,longitude:114,latitude:30,coordinateSystem:null,precision:'province',sourceLabel:'行政区参考',sourceFile:'fixture.json',sourceProperty:'centroid'});
  const alias={rawName:'测试大学甲校区',parentSchoolKey:'school',campusKey:'campus-a',schoolName:'测试大学',campusName:'测试大学甲校区',tier:'211',level:'本科',ownership:'公办',schoolProvince:'湖北',schoolCode:'12345',is985:false,is211:true,isDoubleFirst:true,kind:'高校',matchStatus:'reference',notes:'',sourceUrls:['https://example.edu.cn'],historicalLevel:'本科',industryTags:''};
  const geo={campusKey:'campus-a',parentSchoolKey:'school',schoolName:'测试大学',campusName:'测试大学甲校区',schoolCode:'12345',province:'湖北省',provinceAdcode:'420000',city:'武汉市',cityAdcode:'420100',longitude:114,latitude:30,precision:'city',coordinateSystem:null,address:null,sourceUrls:['https://example.edu.cn'],sourceLabel:'城市级参考',note:'非校园坐标',locationStatus:'city_reference',pendingReason:null};
  const c=gridMapCatalogSchema.parse({schemaVersion:'grid-map-catalog-1',datasetKey:d.datasetKey,rosterVersion:d.version,version:'geo1',rosterChecksumSha256:gridChecksum(d),schoolAliases:[alias,{...alias,campusKey:'campus-b',campusName:'乙校区'}],unitAliases:[],schoolGeography:[geo,{...geo,campusKey:'campus-b',campusName:'乙校区',province:null,provinceAdcode:null,city:null,cityAdcode:null,longitude:null,latitude:null,precision:'unlocated',pendingReason:'待核'}],provinces:[region('420000','湖北省'),region('330000','浙江省'),region('440000','广东省')],cities:[],sources:[]});
  return {snapshot:{datasets:[d],versions:[gridVersion(d)]},catalogs:[c],policies:[],sources:[]};
}
const q=(extra={})=>gridMapQuerySchema.parse(extra);
const rankingQuery=(extra={})=>gridAggregateRankingQuerySchema.parse({cohortYear:2026,view:'campus',...extra});
function provinceRankingFixture():GridInformationInput {
  const input=fixture(),dataset=input.snapshot.datasets[0]!,catalog=input.catalogs[0]!,row=dataset.schoolOutcomes[0]!,geo=catalog.schoolGeography[0]!;
  // An out-of-province campus is hired INTO Hubei. Its old raw schoolProvince
  // disagrees deliberately: only the canonical campus geography may locate it.
  dataset.schoolOutcomes.push({...row,outcomeKey:'outside-hired-hb',parentSchoolKey:'outside',schoolName:'外省大学',campusKey:'outside-campus',campusName:'外省大学校区',recordCount:100});
  catalog.schoolGeography.push({...geo,parentSchoolKey:'outside',schoolName:'外省大学',campusKey:'outside-campus',campusName:'外省大学校区',province:'浙江省',provinceAdcode:'330000'});
  return input;
}
describe('school location versus recruiting destination rankings',()=>{
  it('ranks local campuses by nationwide SGCC + CSG totals, independently from inbound schools',()=>{
    const input=provinceRankingFixture(),before=gridChecksum(input);
    const inbound=queryExactGridRankings(input,rankingQuery({province:'湖北省'}));
    expect(inbound.items.map(row=>[row.schoolKey,row.recordCount])).toEqual([['outside-campus',100],['campus-a',12],['campus-b',1]]);
    expect(inbound.scope).toEqual({schoolProvinceAdcode:null,destinationProvince:'湖北省'});
    const local=queryExactGridRankings(input,rankingQuery({schoolProvinceAdcode:'420000'}));
    expect(local.items).toHaveLength(1);
    expect(local.items[0]).toMatchObject({schoolKey:'campus-a',recordCount:52,rank:1,gridCounts:{sgcc:40,csg:12},
      batchCounts:{batch_1:38,batch_2:2,batch_3:0,csg_spring:5,csg_autumn:7}});
    expect(local.scope).toEqual({schoolProvinceAdcode:'420000',destinationProvince:null});
    expect(queryExactGridRankings(input,rankingQuery()).items.find(row=>row.schoolKey==='campus-a')?.rank).toBe(2);
    expect(gridChecksum(input)).toBe(before);
    // Repeat the two-page UI's cached query without modifying its source data.
    expect(queryExactGridRankings(input,rankingQuery({schoolProvinceAdcode:'420000'}))).toEqual(local);
  });
  it('keeps campus location, destination, operator, batch and year independently composable',()=>{
    const input=provinceRankingFixture();
    expect(queryExactGridRankings(input,rankingQuery({schoolProvinceAdcode:'420000',province:'湖北'})).items[0]?.recordCount).toBe(12);
    expect(queryExactGridRankings(input,rankingQuery({schoolProvinceAdcode:'330000'})).items[0]?.recordCount).toBe(100);
    expect(queryExactGridRankings(input,rankingQuery({schoolProvinceAdcode:'420000',grid:'csg'})).items[0]?.recordCount).toBe(12);
    expect(queryExactGridRankings(input,rankingQuery({schoolProvinceAdcode:'420000',batchCode:'batch_2'})).items[0]?.recordCount).toBe(2);
    expect(queryExactGridRankings(input,rankingQuery({schoolProvinceAdcode:'420000',cohortYear:2025})).items).toEqual([]);
    const parent=queryExactGridRankings(input,rankingQuery({schoolProvinceAdcode:'420000',view:'parent'}));
    expect(parent.items[0]).toMatchObject({recordCount:52,campusKeys:['campus-a']});
  });
  it('does not infer unknown campuses from aliases, parent names, raw school province or hiring destination',()=>{
    const input=fixture();
    expect(queryExactGridRankings(input,rankingQuery()).total).toBe(2);
    expect(queryExactGridRankings(input,rankingQuery({schoolProvinceAdcode:'420000'})).items.map(row=>row.schoolKey)).toEqual(['campus-a']);
    input.catalogs[0]!.schoolGeography=[];
    // A fresh immutable snapshot/catalog identity models a refreshed catalog.
    const refreshed={...input,snapshot:{...input.snapshot},catalogs:[{...input.catalogs[0]!}]};
    expect(queryExactGridRankings(refreshed,rankingQuery({schoolProvinceAdcode:'420000'})).total).toBe(0);
  });
  it('does not choose a province when catalogs conflict for the same campus',()=>{
    const input=fixture(),c=input.catalogs[0]!;
    input.catalogs.push({...c,version:'conflicting-geography',schoolGeography:[{...c.schoolGeography[0]!,province:'浙江省',provinceAdcode:'330000'}]});
    expect(queryExactGridRankings(input,rankingQuery({schoolProvinceAdcode:'420000'})).items).toEqual([]);
    expect(queryExactGridRankings(input,rankingQuery({schoolProvinceAdcode:'330000'})).items).toEqual([]);
  });
  it('does not bypass private-source projection and refreshes caches when visibility changes',()=>{
    const input=fixture(),query=rankingQuery({schoolProvinceAdcode:'420000'});
    expect(queryExactGridRankings(input,query).total).toBe(1);
    input.sources=[{sourceKey:'roster',metadata:{visibility:'admin_only'}}];
    expect(queryExactGridRankings(input,query).items).toEqual([]);
    input.sources=[];
    expect(queryExactGridRankings(input,query).items[0]?.recordCount).toBe(52);
  });
  it('serves a top 200 over two bounded pages with continuous ranks',()=>{
    const input=fixture(),dataset=input.snapshot.datasets[0]!,row=dataset.schoolOutcomes[0]!;
    dataset.schoolOutcomes=Array.from({length:205},(_,i)=>({...row,outcomeKey:`national-${i}`,parentSchoolKey:`school-${i}`,campusKey:`campus-${i}`,recordCount:205-i}));
    const first=queryExactGridRankings(input,rankingQuery({pageSize:100,page:1}));
    const second=queryExactGridRankings(input,rankingQuery({pageSize:100,page:2}));
    expect(first.total).toBe(205);expect(first.items).toHaveLength(100);expect(second.items).toHaveLength(100);
    expect([...first.items,...second.items].map(row=>row.rank)).toEqual(Array.from({length:200},(_,i)=>i+1));
    expect(new Set([...first.items,...second.items].map(row=>row.schoolKey)).size).toBe(200);
    expect(()=>rankingQuery({pageSize:101})).toThrow();
  });
});
describe('complete authenticated anonymous aggregate contract',()=>{
  it('counts low cells exactly, includes unassigned destinations and preserves legacy/public suppression',()=>{
    const input=fixture(),result=queryExactGridOverview(input,q());
    expect(result.nationalSummary).toMatchObject({recordCount:53,schoolCount:1,campusCount:2,companyCount:4,unassignedDestinationRecordCount:8,countBasis:EXACT_AGGREGATE_BASIS});
    expect(result.provinceSummaries.reduce((n,p)=>n+(p.recordCount??0),0)+result.nationalSummary.unassignedDestinationRecordCount!).toBe(53);
    expect(result.exactCards.find(c=>c.batchCode==='batch_2')?.publicNotice).toMatchObject({value:2,countBasis:EXACT_AGGREGATE_BASIS});
    const legacy=queryGridMapOverview(input.snapshot,input.catalogs,q(),false,true,true);
    expect(legacy.privacy.suppressionApplied).toBe(true);expect(legacy).not.toHaveProperty('localSchools');
    expect(legacy.provinceSummaries.find(p=>p.adcode==='420000')?.recordCount).toBe(13);
    expect(JSON.stringify(result)).not.toMatch(/outcomeKey|sourceRows|不应出现在用户详情|隔离单位/);
  });
  it('reconciles national = target + other = destination sum for every batch and never infers city from school',()=>{
    const result=queryExactGridSchool(fixture(),'campus-a',q({provinceAdcode:'420000',batchCode:'batch_2'}))!;
    expect(result.school.recordCount).toBe(2); // Current selection remains explicit.
    const s=result.recruitmentSummary;
    expect(s.national.recordCount).toBe(52);expect(s.targetProvince?.recordCount).toBe(12);expect(s.otherProvinces?.recordCount).toBe(40);expect(s.unassignedDestination.recordCount).toBe(8);
    for(const [batch,total] of Object.entries(s.national.batchCounts)) {
      expect((s.targetProvince!.batchCounts[batch]??0)+(s.otherProvinces!.batchCounts[batch]??0)).toBe(total);
      expect(s.destinations.reduce((n,p)=>n+(p.batchCounts[batch]??0),0)).toBe(total);
    }
    expect(s.equations).toEqual({targetPlusOtherEqualsNational:true,destinationSumEqualsNational:true,batchSumEqualsNational:true});
    expect(result.school.locationPrecision).toBe('city');expect(result.destinations.every(d=>d?.destinationCity===null)).toBe(true);
  });
  it('retains exact 1-record campuses and parent totals, does not promote policy-only companies to actual admissions',()=>{
    const input=fixture(),r=queryExactGridRankings(input,gridRankingQuerySchema.parse({}));
    expect(r.items[0]).toMatchObject({recordCount:53,rank:1,campusKeys:['campus-a','campus-b'],countBasis:EXACT_AGGREGATE_BASIS});
    expect(queryExactGridSchool(input,'campus-b',q())?.recruitmentSummary.national.recordCount).toBe(1);
    const overview=queryExactGridOverview(input,q());
    const company='companies' in overview?overview.companies.find(c=>c?.candidateStatus==='policy_reference'):null;
    expect(company?.recordCount).toBeNull();expect(queryExactGridCompany(input,company!.companyKey,q())?.policyFacts).toHaveLength(1);
  });
  it('does not invent zero totals for unloaded years or show empty cards or transplant national plans into a province',()=>{
    const input=fixture();
    expect(queryExactInformation(input,2027).cards).toEqual([]);
    expect(queryExactGridOverview(input,q({cohortYear:2027})).nationalSummary.recordCount).toBeNull();
    expect(queryExactGridSchool(input,'campus-a',q({cohortYear:2027}))).toBeNull();
    const hb=queryExactGridOverview(input,q({provinceAdcode:'420000'}));
    expect(hb.exactCards.map(c=>c.publicNotice.value)).toEqual([11,2]);
    expect(hb.exactCards.every(c=>c.plan.value===null&&c.applications.value===null&&c.competition.value===null)).toBe(true);
  });
  it('respects admin-only source metadata independently of exact-count permission',()=>{
    const input=fixture();input.sources=[{sourceKey:'roster',metadata:{visibility:'admin_only'}}];
    expect(queryExactGridOverview(input,q()).nationalSummary.recordCount).toBeNull();
    expect(queryExactGridSchool(input,'campus-a',q())).toBeNull();
    expect(queryExactInformation(input,2026).cards).toEqual([]);
  });
  it('requires source/CRS/address for campus precision and keeps old catalog hashes stable',()=>{
    const c=fixture().catalogs[0]!,before=gridChecksum(c);
    expect(gridChecksum(gridMapCatalogSchema.parse(c))).toBe(before);
    expect(()=>gridMapCatalogSchema.parse({...c,schoolGeography:[{...c.schoolGeography[0],precision:'campus'}]})).toThrow();
    const exact=gridMapCatalogSchema.parse({...c,schoolGeography:[{...c.schoolGeography[0],precision:'campus',coordinateSystem:'WGS84',address:'已核官网地址',introduction:{text:'来源支持的简介',sourceUrls:['https://example.edu.cn/about'],status:'reference',asOf:'2026-09-22',note:'不代表学生所属校区'}}]});
    expect(exact.schoolGeography[0]?.introduction?.text).toBe('来源支持的简介');
  });
});

const config:AppConfig={nodeEnv:'test',host:'127.0.0.1',port:8790,trustProxyHops:0,databaseUrl:'postgresql://unused',publicOrigins:['https://example.test'],cookieSecure:true,sessionTtlSeconds:7200,sessionSecret:'test-session-'.padEnd(48,'s'),phonePepper:'test-pepper-'.padEnd(48,'p'),phoneEncryptionKey:Buffer.alloc(32,7),mapGeojsonDir:'/tmp',autoMigrate:false};
describe('authenticated exact API permission isolation',()=>{
  const store=new MemoryStore();let app:Awaited<ReturnType<typeof buildApp>>,userId:string;
  const paths=['overview','information','rankings','rankings?schoolProvinceAdcode=420000&view=campus','schools/campus-a','companies/hb'];
  beforeAll(async()=>{
    const input=fixture();store.seedGridDataset(input.snapshot.datasets[0]);store.seedGridMapCatalog(input.catalogs[0]);
    const admin=await store.upsertAdmin({username:'exact-admin',displayName:'Test',passwordHash:'test'});
    const user=await store.createUser({phoneLookupHash:'exact-test',phoneCiphertext:'opaque',phoneLast4:'0000',passwordHash:'test',createdByAdminId:admin.id});userId=user.id;
    const session={csrfHash:'test',expiresAt:new Date(Date.now()+60000),ipHash:'test',userAgentHash:'test'};
    await store.createUserSession(user.id,{...session,tokenHash:secretDigest('exact-user',config.sessionSecret)});
    await store.createAdminSession(admin.id,{...session,tokenHash:secretDigest('exact-admin',config.sessionSecret)});
    app=await buildApp({config,store});
  });
  afterAll(async()=>{await app.close();});
  it('requires correct user authentication, rejects switches/injection and sends no-store',async()=>{
    for(const path of paths){
      expect((await app.inject({url:`/api/v2/private/grid-aggregates/${path}`})).statusCode).toBe(401);
      expect((await app.inject({url:`/api/v2/private/grid-aggregates/${path}`,headers:{cookie:'hz_admin_session=exact-admin'}})).statusCode).toBe(401);
      const response=await app.inject({url:`/api/v2/private/grid-aggregates/${path}`,headers:{cookie:'hz_user_session=exact-user'}});
      expect(response.statusCode).toBe(200);expect(response.headers['cache-control']).toContain('no-store');expect(response.json().privacy).toMatchObject({suppressionApplied:false,personalRecordsIncluded:false,countBasis:EXACT_AGGREGATE_BASIS});
    }
    expect((await app.inject({url:'/api/v2/public/grid-aggregates/overview'})).statusCode).toBe(404);
    for(const path of ['overview?admin=true','overview?exact=true','schools/campus-a?provinceAdcode=bad','rankings?cohortYear=2026%20OR%201=1','rankings?schoolProvinceAdcode=bad','rankings?schoolProvinceAdcode=420000%20OR%201=1','rankings?schoolProvinceAdcode=420000&pageSize=101'])expect((await app.inject({url:`/api/v2/private/grid-aggregates/${path}`,headers:{cookie:'hz_user_session=exact-user'}})).statusCode).toBe(400);
    expect((await app.inject({url:'/api/v2/private/grid-aggregates/overview?provinceAdcode=999999',headers:{cookie:'hz_user_session=exact-user'}})).statusCode).toBe(404);
    expect((await app.inject({url:'/api/v2/private/grid-aggregates/rankings?schoolProvinceAdcode=999999',headers:{cookie:'hz_user_session=exact-user'}})).statusCode).toBe(404);
    const local=await app.inject({url:'/api/v2/private/grid-aggregates/rankings?schoolProvinceAdcode=420000&view=campus',headers:{cookie:'hz_user_session=exact-user'}});
    expect(local.json().items).toHaveLength(1);expect(local.json().items[0]).toMatchObject({schoolKey:'campus-a',recordCount:52});
    // Legacy routes have no canonical geography projection and must reject it.
    expect((await app.inject({url:'/api/v2/private/grid-query/rankings?schoolProvinceAdcode=420000',headers:{cookie:'hz_user_session=exact-user'}})).statusCode).toBe(400);
  });
  it('revokes every new endpoint when the account is disabled',async()=>{
    await store.updateUser(userId,{enabled:false});
    for(const path of paths)expect((await app.inject({url:`/api/v2/private/grid-aggregates/${path}`,headers:{cookie:'hz_user_session=exact-user'}})).statusCode).toBe(401);
  });
});
