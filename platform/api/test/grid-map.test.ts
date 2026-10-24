import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';
import { buildApp } from '../src/app.js';
import type { AppConfig } from '../src/config.js';
import { createDatabase } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrate.js';
import { secretDigest } from '../src/lib/crypto.js';
import { gridChecksum, gridDatasetSchema, gridVersion, type GridSnapshot } from '../src/lib/grid-query.js';
import { importGridDataset, normalizedDataset } from '../src/lib/grid-query-import.js';
import { gridMapCatalogSchema, normalizeGridMapCatalog, type GridMapCatalog } from '../src/lib/grid-map-catalog.js';
import { importGridMapCatalog } from '../src/lib/grid-map-import.js';
import { gridMapCoverage, gridMapQuerySchema, queryGridMapCompany, queryGridMapOverview, queryGridMapSchool } from '../src/lib/grid-map.js';
import { MemoryStore } from '../src/store/memory.js';
import { PostgresStore } from '../src/store/postgres.js';
import * as originalHtml from '../src/lib/grid-original-html.js';

function fixture(){
  const outcome={outcomeKey:'hb-1',sourceKey:'roster',cohortYear:2026,grid:'sgcc',batchCode:'batch_1',province:'湖北',city:null,companyKey:'hb-power',company:'国网湖北电力',orgCategory:'province_company',parentSchoolKey:'school-a',schoolName:'测试大学',campusKey:'campus-a',campusName:'测试大学',schoolTier:'211',educationLevel:'本科',schoolOwnership:'公办',schoolProvince:'湖北',industryTags:['原电力部院校'],metricType:'public_notice_record_count',recordCount:10,evidenceLocator:'脱敏聚合'};
  const fact={factKey:'city-policy',sourceKey:'policy',cohortYear:2026,grid:'sgcc',batchCode:'all',scope:'company',province:'浙江',city:'杭州市',company:'杭州市资料单位',category:'application',title:'招录资料',text:'材料条目，不是录用人数。',educationLevel:null,schoolTier:null,evidenceLocator:'公开资料条目',dataStatus:'reference',issueReason:null,relatedOfficialSourceKey:null};
  const dataset=normalizedDataset(gridDatasetSchema.parse({schemaVersion:'grid-query-1',datasetKey:'grid-map-test',version:'v1',title:'合成测试',createdAt:'2026-09-22T00:00:00.000Z',notes:[],sources:[{sourceKey:'roster',title:'脱敏公示',sourceType:'roster_aggregate',sha256:'a'.repeat(64),sourceUrl:null,note:'合成统计'},{sourceKey:'policy',title:'用户政策',sourceType:'user_material',sha256:'b'.repeat(64),sourceUrl:null,note:'参考'}],
    policyFacts:[fact,{...fact,factKey:'hidden-policy',company:'隔离单位',dataStatus:'quarantined',issueReason:'城市错配'}],
    schoolOutcomes:[outcome,{...outcome,outcomeKey:'hb-2',batchCode:'batch_2',recordCount:2},{...outcome,outcomeKey:'zj-1',province:'浙江',companyKey:'zj-power',company:'国网浙江电力',recordCount:20},{...outcome,outcomeKey:'csg-spring',province:'广东',companyKey:'gd-power',company:'广东电网',grid:'csg',batchCode:'csg_spring',recordCount:5},{...outcome,outcomeKey:'csg-autumn',province:'广东',companyKey:'gd-power',company:'广东电网',grid:'csg',batchCode:'csg_autumn',recordCount:7},{...outcome,outcomeKey:'unlocated',parentSchoolKey:'school-b',schoolName:'校区待核验',campusKey:'campus-b',campusName:'校区待核验',recordCount:1},{...outcome,outcomeKey:'head-office',province:null,companyKey:'national-unit',company:'直属测试单位',orgCategory:'direct_unit',recordCount:8}]}));
  const alias={rawName:'测试大学',parentSchoolKey:'school-a',campusKey:'campus-a',schoolName:'测试大学',campusName:'测试大学',tier:'211',level:'本科',ownership:'公办',schoolProvince:'湖北',schoolCode:'4200123456',is985:false,is211:true,isDoubleFirst:true,kind:'普通高等学校',matchStatus:'测试核验',notes:'别名原文',sourceUrls:['https://example.edu.cn/about'],historicalLevel:'本科',industryTags:'原电力部院校'};
  const region=(adcode:string,name:string,longitude:number,latitude:number)=>({adcode,provinceAdcode:null,name,longitude,latitude,coordinateSystem:null,precision:'province',sourceLabel:'参考中心',sourceFile:'test.json',sourceProperty:'centroid'});
  const geo={campusKey:'campus-a',parentSchoolKey:'school-a',schoolName:'测试大学',campusName:'测试大学',schoolCode:'4200123456',province:'湖北省',provinceAdcode:'420000',city:'武汉市',cityAdcode:'420100',longitude:114.3,latitude:30.6,precision:'city',coordinateSystem:null,address:null,sourceUrls:['https://example.edu.cn/about'],sourceLabel:'城市参考',note:'城市中心不是校址',locationStatus:'official_city_approximate',pendingReason:null};
  const catalog=normalizeGridMapCatalog({schemaVersion:'grid-map-catalog-1',datasetKey:dataset.datasetKey,rosterVersion:dataset.version,version:'geo-v1',rosterChecksumSha256:gridChecksum(dataset),schoolAliases:[alias,{...alias,rawName:'测试大学旧称'}, {...alias,rawName:'校区待核验',parentSchoolKey:'school-b',campusKey:'campus-b',schoolName:'校区待核验',campusName:'校区待核验',schoolCode:''}],unitAliases:[{grid:'国网',unit:'湖北电力',category:'省公司',company_group:'湖北',province:'湖北',region:'华中',standardized_unit:'国网湖北电力',notes:'招聘主体范围',source_urls:[],evidence_status:'用户源',companyKeys:['hb-power']}],schoolGeography:[geo,{...geo,campusKey:'campus-b',parentSchoolKey:'school-b',schoolName:'校区待核验',campusName:'校区待核验',schoolCode:null,city:null,cityAdcode:null,longitude:null,latitude:null,precision:'unlocated',pendingReason:'校区未查证'}],provinces:[region('420000','湖北省',114,30),region('330000','浙江省',120,30),region('440000','广东省',113,23)],cities:[{...region('420100','武汉市',114.3,30.6),provinceAdcode:'420000',precision:'city'},{...region('330100','杭州市',120.2,30.3),provinceAdcode:'330000',precision:'city'}],sources:[]});
  return {dataset,catalog,snapshot:{datasets:[dataset],versions:[gridVersion(dataset)]} satisfies GridSnapshot};
}
const query=(provinceAdcode?:string)=>gridMapQuerySchema.parse(provinceAdcode?{provinceAdcode}:{});
describe('national map data contract',()=>{
  it('reports precise source-year coverage without relabelling another year or a protected count',()=>{
    const {snapshot,catalog}=fixture();
    expect(queryGridMapOverview(snapshot,[catalog],gridMapQuerySchema.parse({cohortYear:2025}))).toMatchObject({referenceDataAvailable:false,rosterDataAvailable:false});
    expect(queryGridMapOverview(snapshot,[catalog],query(),false,true)).toMatchObject({referenceDataAvailable:true,rosterDataAvailable:true});
    const dataset=snapshot.datasets[0]!;
    dataset.schoolOutcomes=dataset.schoolOutcomes.map(row=>({...row,recordCount:1}));
    const protectedYear={...snapshot};
    const result=queryGridMapOverview(protectedYear,[catalog],query(),false,true);
    expect(result.referenceDataAvailable).toBe(true);expect(result.rosterDataAvailable).toBe(true);
    expect(result.provinceSummaries.every(row=>row.recordCount===null)).toBe(true);
    dataset.schoolOutcomes=[];
    expect(queryGridMapOverview({...snapshot},[catalog],query())).toMatchObject({referenceDataAvailable:true,rosterDataAvailable:false});
    dataset.policyFacts=dataset.policyFacts.map(fact=>({...fact,cohortYear:null}));
    expect(queryGridMapOverview({...snapshot},[catalog],query())).toMatchObject({referenceDataAvailable:false,rosterDataAvailable:false});
  });
  it('reuses one public body across provinceAdcode values while still echoing the caller selection',()=>{
    const {snapshot,catalog}=fixture();
    // The cache is keyed on the catalogs array identity, so a caller that rebuilt
    // `[catalog]` per request would never hit it — hoist it the way the app does.
    const catalogs=[catalog];
    const base=queryGridMapOverview(snapshot,catalogs,query(),false,true);
    const hubei=queryGridMapOverview(snapshot,catalogs,query('420000'),false,true);
    const guangdong=queryGridMapOverview(snapshot,catalogs,query('999999'),false,true);
    // provinceAdcode does not reach the public projection, so it must not be able to
    // mint a fresh cache entry: any six digits the schema accepts would otherwise be
    // a guaranteed miss and a full province rescan on every anonymous request.
    expect(hubei.provinceSummaries).toBe(base.provinceSummaries);
    expect(guangdong.provinceSummaries).toBe(base.provinceSummaries);
    // The echo is per request even though the body is shared.
    expect(base.selection.provinceAdcode).toBeNull();
    expect(hubei.selection.provinceAdcode).toBe('420000');
    expect(guangdong.selection.provinceAdcode).toBe('999999');
    // Parameters that really do change the payload must still split the cache.
    const sgcc=queryGridMapOverview(snapshot,catalogs,gridMapQuerySchema.parse({grid:'sgcc'}),false,true);
    expect(sgcc.provinceSummaries).not.toBe(base.provinceSummaries);
    expect(queryGridMapOverview(snapshot,catalogs,gridMapQuerySchema.parse({grid:'sgcc'}),false,true).provinceSummaries).toBe(sgcc.provinceSummaries);
    // A cohort the snapshot has no roster for is never cached, so 2000-2100 cannot
    // be cycled to evict the real entries.
    const empty=queryGridMapOverview(snapshot,catalogs,gridMapQuerySchema.parse({cohortYear:2099}),false,true);
    expect(queryGridMapOverview(snapshot,catalogs,gridMapQuerySchema.parse({cohortYear:2099}),false,true).provinceSummaries).not.toBe(empty.provinceSummaries);
    expect(queryGridMapOverview(snapshot,catalogs,query(),false,true).provinceSummaries).toBe(base.provinceSummaries);
  });
  it('distinguishes school geography from recruitment destination and never invents destination cities',()=>{
    const {snapshot,catalog}=fixture();
    const hz=queryGridMapOverview(snapshot,[catalog],query('330000'));
    expect('localSchools' in hz&&hz.localSchools).toEqual([]);
    expect('sourceSchools' in hz&&hz.sourceSchools[0]).toMatchObject({campusKey:'campus-a',province:'湖北省',city:'武汉市',recordCount:20,nationalRecordCount:50,destinationProvinceRecordCount:20});
    expect('cities' in hz&&hz.cities[0]).toMatchObject({name:'杭州市',recordCount:null,schoolCount:0,policyFactCount:1,destinationCityStatus:'source_not_provided'});
    expect('companies' in hz&&hz.companies.find(company=>company?.companyKey==='zj-power')).toMatchObject({destinationCity:null,locationPrecision:'province',recordCount:20});
  });
  it('hides fixed low cells before province, school, company and batch filtering; zero is not invented',()=>{
    const {snapshot,catalog}=fixture();
    const detail=queryGridMapSchool(snapshot,[catalog],'campus-a',query('420000'))!;
    expect(detail.school).toMatchObject({recordCount:50,destinationProvinceRecordCount:10,batchCounts:{batch_1:38,batch_2:null,batch_3:null,csg_spring:5,csg_autumn:7}});
    expect(queryGridMapSchool(snapshot,[catalog],'campus-b',query())?.school).toMatchObject({recordCount:null,coordinates:null,locationPrecision:'unlocated'});
    expect(queryGridMapCompany(snapshot,[catalog],'hb-power',gridMapQuerySchema.parse({batchCode:'batch_2'}))?.company.recordCount).toBeNull();
    expect(queryGridMapSchool(snapshot,[catalog],'campus-a',query(),true)?.school.recordCount).toBe(52);
    expect(JSON.stringify(detail)).not.toMatch(/outcomeKey|sourceRows|evidenceLocator/);
  });
  it('retains full aliases, campuses and nationwide unassigned units, without adding Hubei legacy numbers',()=>{
    const {snapshot,catalog}=fixture();
    const detail=queryGridMapSchool(snapshot,[catalog],'campus-a',query('420000'))!;
    expect(detail.aliases).toHaveLength(2);expect(detail.aliases[0]?.isDoubleFirst).toBe(true);
    expect(detail.destinations.find(row=>row?.companyKey==='national-unit')).toMatchObject({province:null,coordinates:null,recordCount:8});
    const overview=queryGridMapOverview(snapshot,[catalog],query('420000'),true);
    expect(overview.provinceSummaries.find(row=>row.adcode==='420000')?.recordCount).toBe(13);
    expect('localSchools' in overview&&overview.localSchools).toHaveLength(2);
    expect(gridMapCoverage(snapshot,[catalog])).toMatchObject({schoolAliasCount:3,campusCount:2,locationCounts:{city:1,unlocated:1,campus:0}});
  });
  it('returns policy-only units with null counts and hides quarantined units',()=>{
    const {snapshot,catalog}=fixture();
    const overview=queryGridMapOverview(snapshot,[catalog],query('330000'));
    const company='companies' in overview?overview.companies.find(row=>row?.company==='杭州市资料单位'):null;
    expect(company).toMatchObject({recordCount:null,policyFactCount:1});
    expect('companies' in overview&&overview.companies.some(row=>row?.company==='隔离单位')).toBe(false);
    expect(queryGridMapCompany(snapshot,[catalog],company!.companyKey,query())?.policyFacts[0]?.text).toContain('不是录用人数');
  });
  it('exposes only province summaries publicly and works safely before catalog import',()=>{
    const {snapshot,catalog}=fixture();
    const output=queryGridMapOverview(snapshot,[catalog],query(),false,true);
    expect(output).not.toHaveProperty('localSchools');
    expect(output).not.toHaveProperty('sourceSchools');expect(output).not.toHaveProperty('companies');expect(output).not.toHaveProperty('cities');
    // The public leaderboard carries names and totals only: no geography,
    // alias, tier, company or per-batch school detail rides along with it.
    for(const row of (output as {topSchools:Record<string,unknown>[]}).topSchools){
      expect(Object.keys(row).sort()).toEqual(['campusKey','campusName','gridCounts','rank','recordCount','schoolName']);
      expect(Object.keys(row.gridCounts as object).sort()).toEqual(['csg','sgcc']);
    }
    expect(JSON.stringify(output)).not.toMatch(/coordinates|cityAdcode|schoolTier|companyKey|outcomeKey|batchCounts":\{"batch_1":\d+,"batch_2":\d+,"batch_3":\d+,"csg_spring":\d+,"csg_autumn":\d+\}[^}]*campus/);
    expect(queryGridMapOverview(snapshot,[],query()).provinceSummaries).toEqual([]);
    expect(queryGridMapSchool(snapshot,[],'campus-a',query())?.school.coordinates).toBeNull();
  });
  it('rejects unlocated coordinates, unknown fields and broken campus identity',()=>{
    const {catalog}=fixture();
    expect(()=>gridMapCatalogSchema.parse({...catalog,phone:'13800138000'})).toThrow();
    expect(()=>gridMapCatalogSchema.parse({...catalog,schoolGeography:[{...catalog.schoolGeography[0],precision:'unlocated'}]})).toThrow();
    expect(()=>gridMapCatalogSchema.parse({...catalog,schoolGeography:[{...catalog.schoolGeography[0],parentSchoolKey:'wrong'}]})).toThrow();
  });
  it('preserves explicit unknown campus province instead of falling back to a mother-school alias',()=>{
    const {snapshot,catalog}=fixture();
    const geo=catalog.schoolGeography.find(row=>row.campusKey==='campus-b')!;geo.province=null;geo.provinceAdcode=null;
    expect(queryGridMapSchool(snapshot,[catalog],'campus-b',query())?.school).toMatchObject({province:null,provinceAdcode:null,coordinates:null});
    expect(gridMapCoverage(snapshot,[catalog]).unlocatedSchools.find(row=>row.campusKey==='campus-b')?.province).toBeNull();
    const overview=queryGridMapOverview(snapshot,[catalog],query('420000'));
    expect('localSchools' in overview&&overview.localSchools.some(row=>row.campusKey==='campus-b')).toBe(false);
  });
  it('maps candidate facts once and keeps application counts out of roster metrics',()=>{
    const {snapshot,catalog}=fixture();
    const candidateKey=`company.candidate.${'c'.repeat(32)}`;
    const enriched=normalizeGridMapCatalog({...catalog,companyCandidates:{schemaVersion:'national-company-candidates-1',version:'2026.09.22.1',title:'参考候选',sources:[{sourceKey:'policy',title:'用户政策',sha256:'b'.repeat(64),sourceType:'user_material'}],notes:['报名不是录用'],candidates:[{
      candidateKey,grid:'sgcc',province:'浙江',city:'杭州市',companyRegion:'浙江',name:'杭州市资料单位',entityStatus:'unverified_candidate',cityEvidenceStatus:'lexical_reference',references:[{
        factKey:'city-policy',sourceKey:'policy',inputId:'ref-test',cohortYear:2026,batchCode:'batch_1',batchRaw:'一批',applicationCount:1001,metricType:'application_record_count_reference',measureUnit:'人次',dataStatus:'reference',sourceScope:'company',sourceTable:'html_application_units',
      }],
    }]}});
    const overview=queryGridMapOverview(snapshot,[enriched],query('330000'));
    expect('companies' in overview&&overview.companies.filter(row=>row?.company==='杭州市资料单位')).toHaveLength(1);
    const detail=queryGridMapCompany(snapshot,[enriched],candidateKey,query())!;
    expect(detail.company).toMatchObject({recordCount:null,candidateStatus:'reference_candidate',companyCity:'杭州市',companyCityAdcode:'330100',coordinates:[120.2,30.3],destinationCity:null});
    expect(detail.candidate?.references[0]).toMatchObject({applicationCount:1001,metricType:'application_record_count_reference'});
    expect(queryGridMapCompany(snapshot,[enriched],candidateKey,gridMapQuerySchema.parse({grid:'csg'}),true)?.candidate?.references).toEqual([]);
    expect(queryGridMapSchool(snapshot,[enriched],'campus-a',query(),true)?.school.recordCount).toBe(52);
  });
});

const config:AppConfig={nodeEnv:'test',host:'127.0.0.1',port:8790,trustProxyHops:0,databaseUrl:'postgresql://unused',publicOrigins:['https://example.test'],cookieSecure:true,sessionTtlSeconds:7200,sessionSecret:'test-map-session-secret-at-least-32-characters',phonePepper:'test-map-phone-pepper-at-least-32-characters',phoneEncryptionKey:Buffer.alloc(32,1),mapGeojsonDir:'/tmp',autoMigrate:false};

describe('bounded public overview memoization',()=>{
  it('keys only on the filters that change the body, never on the echoed provinceAdcode',()=>{
    const {snapshot,catalog}=fixture(),catalogs=[catalog];
    const first=queryGridMapOverview(snapshot,catalogs,query(),false,true);
    expect(queryGridMapOverview(snapshot,catalogs,query(),false,true).provinceSummaries).toBe(first.provinceSummaries);
    // cohortYear/grid/batchCode change the projection, so each must split the cache.
    for(const filters of [{cohortYear:2025},{grid:'csg'},{batchCode:'batch_2'}]){
      const q=gridMapQuerySchema.parse(filters),result=queryGridMapOverview(snapshot,catalogs,q,false,true);
      expect(result.provinceSummaries).not.toBe(first.provinceSummaries);
      expect(result.selection).not.toEqual(first.selection);
    }
    // provinceAdcode changes nothing but the echo. Keying on it let an anonymous
    // caller mint a distinct key per request out of the schema's six-digit space.
    for(const adcode of ['420000','999999','100001']){
      const result=queryGridMapOverview(snapshot,catalogs,query(adcode),false,true);
      expect(result.provinceSummaries).toBe(first.provinceSummaries);
      expect(result.selection.provinceAdcode).toBe(adcode);
    }
  });
  it('invalidates on snapshot identity and catalog-array identity',()=>{
    const {snapshot,catalog}=fixture(),catalogs=[catalog];
    const first=queryGridMapOverview(snapshot,catalogs,query(),false,true);
    // Top-level objects always differ now (the selection echo is per request), so
    // invalidation has to be judged on the shared body, not on the wrapper.
    expect(queryGridMapOverview({...snapshot},catalogs,query(),false,true).provinceSummaries).not.toBe(first.provinceSummaries);
    const second=queryGridMapOverview(snapshot,[catalog],query(),false,true);
    expect(second.provinceSummaries).not.toBe(first.provinceSummaries);
    expect(second).toEqual(first);
  });
  it('cannot be evicted by a caller: the whole legal key space fits inside the cache',()=>{
    const {snapshot,catalog}=fixture(),catalogs=[catalog];
    const first=queryGridMapOverview(snapshot,catalogs,query(),false,true);
    // Every grid x batch pair the schema accepts, for the one cohort with roster
    // data. The old test reached the limit only by cycling provinceAdcode, which
    // is precisely the unbounded key space this cache must no longer expose.
    const legal:Array<Record<string,unknown>>=[];
    for(const grid of [undefined,'sgcc','csg']) for(const batchCode of [undefined,'batch_1','batch_2','batch_3','csg_spring','csg_autumn','all']){
      const filters={...(grid?{grid}:{}),...(batchCode?{batchCode}:{})};
      const parsed=gridMapQuerySchema.safeParse(filters);
      if(parsed.success)legal.push(filters);
    }
    expect(legal.length).toBeGreaterThan(10);
    for(const filters of legal)queryGridMapOverview(snapshot,catalogs,gridMapQuerySchema.parse(filters),false,true);
    // Nothing a caller can ask for has pushed the unfiltered body out.
    expect(queryGridMapOverview(snapshot,catalogs,query(),false,true).provinceSummaries).toBe(first.provinceSummaries);
    // Neither do six-digit provinceAdcodes, which no longer occupy entries at all.
    for(let i=1;i<=80;i++)queryGridMapOverview(snapshot,catalogs,query(String(100000+i)),false,true);
    expect(queryGridMapOverview(snapshot,catalogs,query(),false,true).provinceSummaries).toBe(first.provinceSummaries);
    // Cohort years with no roster are computed but never stored, so cycling the
    // schema's 2000-2100 range cannot evict the real entries either.
    for(let year=2000;year<=2100;year++)queryGridMapOverview(snapshot,catalogs,gridMapQuerySchema.parse({cohortYear:year}),false,true);
    expect(queryGridMapOverview(snapshot,catalogs,query(),false,true).provinceSummaries).toBe(first.provinceSummaries);
  });
  it.each([[false,false],[true,false],[false,true]] as const)('does not retain authenticated shape admin=%s exact=%s',(admin,exact)=>{
    const {snapshot,catalog}=fixture(),catalogs=[catalog];
    const first=queryGridMapOverview(snapshot,catalogs,query(),admin,false,exact);
    expect(queryGridMapOverview(snapshot,catalogs,query(),admin,false,exact)).not.toBe(first);
    expect(queryGridMapOverview(snapshot,catalogs,query(),admin,false,exact).provinceSummaries).not.toBe(first.provinceSummaries);
  });
  it('rejects a batch that belongs to the other operator instead of answering with an empty map',()=>{
    // 200-with-all-nulls made "no such combination" indistinguishable from "no data".
    for(const bad of [{grid:'csg',batchCode:'batch_1'},{grid:'sgcc',batchCode:'csg_autumn'},{grid:'csg',batchCode:'batch_3'}]){
      expect(()=>gridMapQuerySchema.parse(bad)).toThrow();
    }
    for(const ok of [{grid:'sgcc',batchCode:'batch_1'},{grid:'csg',batchCode:'csg_spring'},{batchCode:'batch_2'},{grid:'csg'},{}]){
      expect(()=>gridMapQuerySchema.parse(ok)).not.toThrow();
    }
  });
  it('publishes complete province totals publicly but still hides a group below the minimum',()=>{
    const {snapshot,catalog}=fixture(),catalogs=[catalog];
    const pub=queryGridMapOverview(snapshot,catalogs,query(),false,true);
    // Narrow the province/national response union while asserting this fixture
    // really exercises the public national branch (not a province response).
    if (!('nationalSummary' in pub) || !('topSchools' in pub)) throw new Error('Expected public national overview');
    const hubei=pub.provinceSummaries.find(p=>p.adcode==='420000')!;
    // 10 + 2 + 1: the sub-5 cells still count toward the province figure.
    expect(hubei.recordCount).toBe(13);
    // batch_2 holds a single 2-record cell. Hiding only that cell used to leave
    // batch_1=11 published beside a complete total of 13, so 13-11 handed the
    // hidden 2 straight back. The whole batch group goes with it instead.
    expect(hubei.batchCounts.batch_2).toBeNull();
    expect(hubei.batchCounts.batch_1).toBeNull();
    const published=Object.values(hubei.batchCounts).filter((value):value is number=>value!==null);
    expect(published).toEqual([]);
    expect(hubei.recordCount! - published.reduce((a,b)=>a+b,0)).toBe(13);
    // A province whose cells all clear the floor keeps its breakdown.
    const guangdong=pub.provinceSummaries.find(p=>p.adcode==='440000')!;
    expect(guangdong.recordCount).toBe(12);
    expect(guangdong.batchCounts.csg_spring).toBe(5);
    expect(guangdong.batchCounts.csg_autumn).toBe(7);
    expect(pub.privacy).toMatchObject({minimumCellCount:5,suppressionApplied:true,countBasis:'complete_anonymous_aggregates'});
    // Entity counts are not person counts and are published as-is; the stated
    // basis has to say so rather than claim a floor it does not apply.
    expect(pub.privacy.basis).toMatch(/个数不属于人数口径/);
    // The public national total is no longer withheld from anonymous callers.
    // 10+2 (hubei) + 20 (zhejiang) + 5+7 (guangdong) + 1 (unlocated campus) + 8
    // (province-less head office) = 53 across two campuses.
    expect(pub.nationalSummary).toMatchObject({recordCount:53,campusCount:2,countBasis:'complete_anonymous_aggregates'});
    // The national figure counts destinations with no province too, so it is
    // deliberately larger than the sum of the province rows.
    const provinceSum=pub.provinceSummaries.reduce((total,row)=>total+(row.recordCount??0),0);
    expect(provinceSum).toBe(45);
    expect(pub.nationalSummary.recordCount! - provinceSum).toBe(8);
    // Two campuses of one university stay distinguishable in the leaderboard.
    const campuses=pub.topSchools.map(row=>[row.schoolName,row.campusName]);
    expect(campuses.every(([name,campus])=>typeof name==='string'&&campus!==undefined)).toBe(true);
    // The member grid-map route keeps the released-cells lower bound.
    const member=queryGridMapOverview(snapshot,catalogs,query(),false,false);
    expect(member.provinceSummaries.find(p=>p.adcode==='420000')!.recordCount).toBe(10);
    expect(member.privacy.countBasis).toBe('released_cells_only');
  });
  it('cannot elevate a cached public response with administrator/exact flags',()=>{
    const {snapshot,catalog}=fixture(),catalogs=[catalog];
    const elevated=queryGridMapOverview(snapshot,catalogs,query(),true,true,true);
    expect(elevated.privacy).toMatchObject({suppressionApplied:true,minimumCellCount:5,countBasis:'complete_anonymous_aggregates'});
    expect(elevated).not.toHaveProperty('localSchools');
    expect(queryGridMapOverview(snapshot,catalogs,query(),false,true).provinceSummaries).toBe(elevated.provinceSummaries);
  });
});

describe('public map request validation cost boundary',()=>{
  it('rejects invalid queries with safe errors and no database reads',async()=>{
    const store=new MemoryStore();
    const snapshot=vi.spyOn(store,'gridQuerySnapshot');
    const catalog=vi.spyOn(store,'gridMapCatalogSnapshot');
    const sources=vi.spyOn(store,'adminOnlySources');
    const app=await buildApp({config,store});
    try{
      for(const q of ['cohortYear=oops','provinceAdcode=42','grid=not-a-grid','batchCode=not-a-batch','exact=true']){
        const response=await app.inject(`/api/v2/public/grid-map/overview?${q}`);
        expect(response.statusCode).toBe(400);
        expect(response.headers['cache-control']).toContain('no-store');
        expect(response.json().error).toMatchObject({code:'VALIDATION_ERROR',message:'请求参数无效'});
        expect(response.json()).not.toHaveProperty('datasets');
      }
      expect(snapshot).not.toHaveBeenCalled();
      expect(catalog).not.toHaveBeenCalled();
      // The error handler emits safe envelopes with no source material. They
      // must stay available even when the source database itself is down.
      expect(sources).not.toHaveBeenCalled();
    }finally{await app.close();vi.restoreAllMocks();}
  });
});
describe('map API auth',()=>{
  const store=new MemoryStore();let app:Awaited<ReturnType<typeof buildApp>>;let userId:string;
  beforeAll(async()=>{
    const {dataset,catalog}=fixture();store.seedGridDataset(dataset);store.seedGridMapCatalog(catalog);
    const admin=await store.upsertAdmin({username:'grid-map-admin',displayName:'测试',passwordHash:'synthetic-password'});
    const user=await store.createUser({phoneLookupHash:'grid-map-test',phoneCiphertext:'synthetic',phoneLast4:'0000',passwordHash:'synthetic-password',createdByAdminId:admin.id});userId=user.id;
    const session={csrfHash:'synthetic',expiresAt:new Date(Date.now()+60000),ipHash:'synthetic',userAgentHash:'synthetic'};
    await store.createUserSession(user.id,{...session,tokenHash:secretDigest('map-user',config.sessionSecret)});
    await store.createAdminSession(admin.id,{...session,tokenHash:secretDigest('map-admin',config.sessionSecret)});
    app=await buildApp({config,store});
  });
  afterAll(async()=>{await app.close();});
  it('allows public province overview but authenticates every entity route and admin coverage',async()=>{
    expect((await app.inject({url:'/api/v2/public/grid-map/overview'})).statusCode).toBe(200);
    for(const route of ['private/grid-map/overview','private/grid-map/schools/campus-a','private/grid-map/companies/hb-power','admin/grid-map/coverage','private/grid-query/original-html','admin/grid-query/original-html'])expect((await app.inject({url:`/api/v2/${route}`})).statusCode).toBe(401);
    expect((await app.inject({url:'/api/v2/admin/grid-map/coverage',headers:{cookie:'hz_user_session=map-user'}})).statusCode).toBe(401);
    const response=await app.inject({url:'/api/v2/private/grid-map/schools/campus-a?provinceAdcode=420000',headers:{cookie:'hz_user_session=map-user'}});
    expect(response.statusCode).toBe(200);expect(response.headers['cache-control']).toContain('no-store');expect(response.json().school.destinationProvinceRecordCount).toBe(10);
    const admin=await app.inject({url:'/api/v2/admin/grid-map/schools/campus-a',headers:{cookie:'hz_admin_session=map-admin'}});expect(admin.json().school.recordCount).toBe(52);
  });
  it('validates filters and returns 404 for missing entities',async()=>{
    const headers={cookie:'hz_user_session=map-user'};
    expect((await app.inject({url:'/api/v2/private/grid-map/overview?provinceAdcode=999999',headers})).statusCode).toBe(404);
    expect((await app.inject({url:'/api/v2/private/grid-map/overview?batchCode=unsafe',headers})).statusCode).toBe(400);
    expect((await app.inject({url:'/api/v2/private/grid-map/schools/unknown',headers})).statusCode).toBe(404);
  });
  it('sets deny-by-default CSP before authentication for both historical HTML audiences',async()=>{
    for(const audience of ['private','admin']){
      const response=await app.inject({url:`/api/v2/${audience}/grid-query/original-html`});
      expect(response.statusCode).toBe(401);
      expect(response.headers['content-security-policy']).toContain("default-src 'none'");
      expect(response.headers['content-security-policy']).toContain('sandbox;');
      expect(response.headers['content-security-policy']).toContain("frame-ancestors 'none'");
      expect(response.headers['content-security-policy']).not.toContain('allow-scripts');
      expect(response.headers['cache-control']).toContain('no-store');
      expect(response.headers['x-content-type-options']).toBe('nosniff');
    }
  });
  it('fails closed when the protected original HTML artifact is not configured',async()=>{
    const previous=process.env.GRID_QUERY_ORIGINAL_HTML_PATH;delete process.env.GRID_QUERY_ORIGINAL_HTML_PATH;
    try{
      for(const [audience,cookie] of [['private','hz_user_session=map-user'],['admin','hz_admin_session=map-admin']]){
        const response=await app.inject({url:`/api/v2/${audience}/grid-query/original-html`,headers:{cookie:cookie!}});
        expect(response.statusCode).toBe(503);expect(response.body).not.toContain('data-private');
        expect(response.headers['content-security-policy']).toContain("default-src 'none'");
        expect(response.headers['content-security-policy']).toContain('sandbox;');
        expect(response.headers['content-security-policy']).toContain("frame-ancestors 'none'");
        expect(response.headers['content-security-policy']).not.toContain('allow-scripts');
      }
    }
    finally{if(previous!==undefined)process.env.GRID_QUERY_ORIGINAL_HTML_PATH=previous;}
  });
  it('replaces the fallback CSP only after the historical HTML helper succeeds',async()=>{
    const csp="default-src 'none'; script-src 'sha256-synthetic-test'; sandbox allow-scripts; frame-ancestors 'self';";
    const reader=vi.spyOn(originalHtml,'readGridOriginalDocument').mockResolvedValue({html:'<!doctype html><title>合成资料</title>',csp});
    try{
      const response=await app.inject({url:'/api/v2/private/grid-query/original-html',headers:{cookie:'hz_user_session=map-user'}});
      expect(response.statusCode).toBe(200);expect(response.headers['content-security-policy']).toBe(csp);
      expect(response.headers['content-type']).toContain('text/html');expect(response.headers['x-original-source-sha256']).toBe(originalHtml.GRID_ORIGINAL_SHA256);
      expect(response.headers['cache-control']).toContain('no-store');expect(response.headers['x-content-type-options']).toBe('nosniff');
    }finally{reader.mockRestore();}
  });
  it('immediately revokes map access when user disabled',async()=>{
    await store.updateUser(userId,{enabled:false});
    expect((await app.inject({url:'/api/v2/private/grid-map/overview',headers:{cookie:'hz_user_session=map-user'}})).statusCode).toBe(401);
  });
});

const dbUrl=process.env.GRID_MAP_TEST_DATABASE_URL;
describe.runIf(Boolean(dbUrl))('map catalog real PostgreSQL',()=>{
  let pool:Pool;let store:PostgresStore;const {dataset,catalog}=fixture();
  beforeAll(async()=>{
    const url=new URL(dbUrl!);if(!['127.0.0.1','localhost'].includes(url.hostname)||!url.pathname.includes('integration'))throw new Error('Dedicated loopback integration database required');
    const connection=createDatabase(dbUrl!);pool=connection.pool;store=new PostgresStore(connection.db);await runMigrations(connection.db);
  });
  afterAll(async()=>{if(pool){await pool.query('DELETE FROM grid_map_catalogs WHERE dataset_version_id IN(SELECT id FROM grid_dataset_versions WHERE dataset_key=$1)',[dataset.datasetKey]);for(const table of ['grid_policy_facts','grid_school_outcomes','grid_query_sources'])await pool.query(`DELETE FROM ${table} WHERE version_id IN(SELECT id FROM grid_dataset_versions WHERE dataset_key=$1)`,[dataset.datasetKey]);await pool.query('DELETE FROM grid_dataset_versions WHERE dataset_key=$1',[dataset.datasetKey]);await pool.end();}});
  it('imports with lineage, validates readback and rejects same-version changes without touching legacy tables',async()=>{
    const client=await pool.connect();
    try{
      const legacy=async()=>(await client.query("SELECT (SELECT count(*) FROM schools)::int schools,(SELECT count(*) FROM companies)::int companies,(SELECT count(*) FROM recruitment_metrics)::int metrics,(SELECT count(*) FROM users)::int users")).rows[0];
      const before=await legacy();await importGridDataset(client,dataset);
      expect((await importGridMapCatalog(client,catalog)).inserted).toBe(true);expect((await importGridMapCatalog(client,catalog)).inserted).toBe(false);
      await expect(importGridMapCatalog(client,{...catalog,sources:[{sourceKey:'new',title:'变动',sourceUrl:null,note:''}]})).rejects.toThrow('GRID_MAP_VERSION_CONTENT_CONFLICT');
      expect(await legacy()).toEqual(before);
      const loaded=await store.gridMapCatalogSnapshot();expect(loaded.find(row=>row.datasetKey===dataset.datasetKey)).toEqual(catalog);
      const snapshot=await store.gridQuerySnapshot();expect(queryGridMapSchool(snapshot,loaded,'campus-a',query())?.school.recordCount).toBe(50);
    }finally{client.release();}
  });
  it('switches catalog versions atomically, caches by active checksum and never rolls back by reimporting old version',async()=>{
    const client=await pool.connect();try{
      const next:GridMapCatalog={...catalog,version:'geo-v2'};await importGridMapCatalog(client,next);
      expect((await importGridMapCatalog(client,catalog)).active).toBe(false);
      expect((await store.gridMapCatalogSnapshot()).find(row=>row.datasetKey===dataset.datasetKey)?.version).toBe('geo-v2');
      await expect(importGridMapCatalog(client,{...next,version:'bad-checksum',rosterChecksumSha256:'c'.repeat(64)})).rejects.toThrow('GRID_MAP_ROSTER_CHECKSUM_MISMATCH');
    }finally{client.release();}
  });
});
