import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { buildApp } from '../src/app.js';
import type { AppConfig } from '../src/config.js';
import { secretDigest } from '../src/lib/crypto.js';
import { MemoryStore } from '../src/store/memory.js';
import { PostgresStore } from '../src/store/postgres.js';
import { createDatabase } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrate.js';
import { gridDatasetSchema, gridFactQuerySchema, gridRankingQuerySchema, queryGridFacts, queryGridRankings, gridFacets, gridVersion, type GridDataset, type GridFact, type GridOutcome, type GridSnapshot } from '../src/lib/grid-query.js';
import { importGridDataset, normalizedDataset } from '../src/lib/grid-query-import.js';

export function gridFixture():GridDataset {
  const fact:GridFact={factKey:'hb-province',sourceKey:'policy',cohortYear:2026,grid:'sgcc',batchCode:'campus',scope:'province',province:'湖北',city:null,company:null,category:'education',title:'湖北提前批学历',text:'硕士研究生及以上。此为用户材料参考。',educationLevel:null,schoolTier:null,evidenceLocator:'要求表!B2',dataStatus:'reference',issueReason:null,relatedOfficialSourceKey:null};
  const outcome:GridOutcome={outcomeKey:'a1',sourceKey:'roster',cohortYear:2026,grid:'sgcc',batchCode:'batch_1',province:'湖北',city:null,companyKey:'hb',company:'国网湖北电力',orgCategory:'province_company',parentSchoolKey:'three-gorges',schoolName:'三峡大学',campusKey:'three-gorges-main',campusName:'三峡大学',schoolTier:'公办本科',educationLevel:'本科',schoolOwnership:'公办',schoolProvince:'湖北',industryTags:['原电力部院校（校史）'],metricType:'public_notice_record_count',recordCount:190,evidenceLocator:'一批工作表；脱敏汇总'};
  return gridDatasetSchema.parse({schemaVersion:'grid-query-1',datasetKey:'test-fixture',version:'v1',title:'合成测试资料',createdAt:'2026-09-22T00:00:00.123Z',notes:[],
    sources:[{sourceKey:'policy',title:'测试政策资料',sourceType:'user_material',sha256:'a'.repeat(64),sourceUrl:null,note:'仅供参考'},{sourceKey:'roster',title:'测试脱敏汇总',sourceType:'roster_aggregate',sha256:'b'.repeat(64),sourceUrl:null,note:'公示记录口径'}],
    policyFacts:[fact,{...fact,factKey:'wh-city',scope:'city',city:'武汉',category:'score',cohortYear:2025,title:'武汉历史分数',text:'电工类参考进面线60分。'},
      {...fact,factKey:'yc-city',scope:'city',city:'宜昌',category:'score',cohortYear:2024,title:'宜昌历史分数',text:'电工类参考进面线59分。'},
      {...fact,factKey:'bad-note',dataStatus:'quarantined',issueReason:'串省文字',text:'长株潭备注不适用于湖北'}],
    schoolOutcomes:[outcome,{...outcome,outcomeKey:'a2',batchCode:'batch_2',recordCount:49},{...outcome,outcomeKey:'a3',batchCode:'batch_3',recordCount:28},
      {...outcome,outcomeKey:'a4',province:'浙江',companyKey:'zj',company:'国网浙江电力',recordCount:544},
      {...outcome,outcomeKey:'small',parentSchoolKey:'small-school',campusKey:'small-campus',schoolName:'样本院校',campusName:'样本院校',recordCount:3},
      {...outcome,outcomeKey:'hidden-three',batchCode:'batch_3',province:'广东',companyKey:'gd',company:'广东电网',grid:'csg',recordCount:2}],});
}
function snapshot(d=gridFixture()):GridSnapshot{return {datasets:[d],versions:[gridVersion(d)]};}
describe('grid-query schemas and query boundary',()=>{
  it('is strict, source-linked, identity-free and distinguishes city evidence',()=>{
    const d=gridFixture();
    expect(()=>gridDatasetSchema.parse({...d,records:[]})).toThrow();
    expect(()=>gridDatasetSchema.parse({...d,schoolOutcomes:[{...d.schoolOutcomes[0],sourceRows:'2',phone:'13800138000'}]})).toThrow();
    expect(()=>gridDatasetSchema.parse({...d,policyFacts:[{...d.policyFacts[0],scope:'city',city:null}]})).toThrow();
    expect(()=>gridDatasetSchema.parse({...d,policyFacts:[{...d.policyFacts[0],sourceKey:'missing'}]})).toThrow();
    expect(()=>gridDatasetSchema.parse({...d,policyFacts:[{...d.policyFacts[0],text:'联系电话13800138000'}]})).toThrow();
    expect(()=>gridDatasetSchema.parse({...d,policyFacts:[{...d.policyFacts[0],dataStatus:'quarantined',issueReason:null}]})).toThrow();
  });
  it('keeps provincial inheritance and cities separate; quarantined only admin',()=>{
    const result=queryGridFacts(snapshot(),gridFactQuerySchema.parse({province:'湖北省',city:'武汉市'}));
    expect(result.items.map(i=>i.factKey).sort()).toEqual(['hb-province','wh-city']);
    expect(result.items.find(i=>i.factKey==='hb-province')?.applicability).toBe('province_inherited');
    expect(result.items.find(i=>i.factKey==='wh-city')?.applicability).toBe('city_specific');
    expect(queryGridFacts(snapshot(),gridFactQuerySchema.parse({dataStatus:'quarantined'})).total).toBe(0);
    expect(queryGridFacts(snapshot(),gridFactQuerySchema.parse({dataStatus:'quarantined'}),true).total).toBe(1);
    expect(queryGridFacts(snapshot(),gridFactQuerySchema.parse({cohortYear:2027})).total).toBe(0);
  });
  it('does not inherit every province when a city query omits province',()=>{
    const d=gridFixture();d.policyFacts.push({...d.policyFacts[0]!,factKey:'hunan',province:'湖南'});
    expect(queryGridFacts(snapshot(d),gridFactQuerySchema.parse({city:'武汉'})).items.map(i=>i.factKey)).not.toContain('hunan');
  });
  it('returns exact admin batch totals, national vs province, and industry tags',()=>{
    const full=queryGridRankings(snapshot(),gridRankingQuerySchema.parse({grid:'sgcc'}),true);
    expect(full.items[0]).toMatchObject({schoolName:'三峡大学',recordCount:811,gridCounts:{sgcc:811,csg:0},batchCounts:{batch_1:734,batch_2:49,batch_3:28},industryTags:['原电力部院校（校史）']});
    expect(queryGridRankings(snapshot(),gridRankingQuerySchema.parse({province:'湖北省',grid:'sgcc'}),true).items[0]?.recordCount).toBe(267);
    expect(queryGridRankings(snapshot(),gridRankingQuerySchema.parse({province:'湖北',batchCode:'batch_2'}),true).items[0]?.recordCount).toBe(49);
  });
  it('suppresses atomic low counts before all filters and keeps null school rows',()=>{
    const result=queryGridRankings(snapshot(),gridRankingQuerySchema.parse({}));
    expect(result.items.find(i=>i.schoolName==='样本院校')).toMatchObject({recordCount:null,rank:null,batchCounts:{batch_1:null},gridCounts:{sgcc:null,csg:0}});
    expect(result.items.find(i=>i.schoolName==='三峡大学')).toMatchObject({recordCount:811,gridCounts:{sgcc:811,csg:null}});
    const smallOnly=queryGridRankings(snapshot(),gridRankingQuerySchema.parse({q:'样本',province:'湖北',company:'国网湖北电力',batchCode:'batch_1'}));
    expect(smallOnly.items[0]?.recordCount).toBeNull();
    expect(JSON.stringify(result)).not.toContain('sourceRows');
    expect(JSON.stringify(result)).not.toContain('outcomeKey');
    expect(result.privacy.suppressionApplied).toBe(true);
  });
  it('sums identical atomic cells before k-check independent of source/sort',()=>{
    const d=gridFixture();d.schoolOutcomes.push({...d.schoolOutcomes.find(r=>r.outcomeKey==='small')!,outcomeKey:'small-part-two',recordCount:2});
    const result=queryGridRankings(snapshot(d),gridRankingQuerySchema.parse({q:'样本'}));
    expect(result.items[0]?.recordCount).toBe(5);
    d.schoolOutcomes.reverse();
    expect(queryGridRankings(snapshot(d),gridRankingQuerySchema.parse({q:'样本'})).items[0]?.recordCount).toBe(5);
  });
  it('retains arbitrary school tiers and separate industry/unit filters',()=>{
    const d=gridFixture();d.schoolOutcomes[0]!.schoolTier='海外院校';d.schoolOutcomes[0]!.orgCategory='supply_bureau';
    expect(gridFacets(snapshot(d)).schoolTiers).toContain('海外院校');
    expect(queryGridRankings(snapshot(d),gridRankingQuerySchema.parse({orgCategory:'supply_bureau'}),true).items[0]?.recordCount).toBe(190);
    expect(queryGridRankings(snapshot(d),gridRankingQuerySchema.parse({industryTag:'不存在'}),true).total).toBe(0);
    expect(queryGridRankings(snapshot(d),gridRankingQuerySchema.parse({q:'样本'}),true).items[0]?.rank).toBe(2);
  });
  it('normalizes JSONB ordering and preserves timestamp milliseconds',()=>{
    const d=gridFixture();const d2=structuredClone(d);d2.sources.reverse();d2.policyFacts.reverse();d2.schoolOutcomes.reverse();
    expect(normalizedDataset(d)).toEqual(normalizedDataset(d2));
    expect(normalizedDataset(d).createdAt).toBe('2026-09-22T00:00:00.123Z');
  });
  it('keeps mixed parent-school levels explicit and all school facet values',()=>{
    const d=gridFixture();d.schoolOutcomes[1]!.educationLevel='研究生';d.schoolOutcomes[1]!.schoolTier='研究生培养院校';
    d.schoolOutcomes.find(r=>r.outcomeKey==='small')!.schoolTier='罕见低样本层次';
    expect(gridFacets(snapshot(d)).schoolTiers).toContain('罕见低样本层次');
    expect(queryGridRankings(snapshot(d),gridRankingQuerySchema.parse({}),true).items[0]).toMatchObject({educationLevel:null,schoolTier:'多层次（详见明细）',schoolTiers:['公办本科','研究生培养院校']});
  });
});

const testConfig:AppConfig={nodeEnv:'test',host:'127.0.0.1',port:8790,trustProxyHops:0,databaseUrl:'postgresql://unused',publicOrigins:['https://example.test'],cookieSecure:true,sessionTtlSeconds:7200,sessionSecret:'test-session-'.padEnd(48,'s'),phonePepper:'test-pepper-'.padEnd(48,'p'),phoneEncryptionKey:Buffer.alloc(32,7),mapGeojsonDir:'/tmp',autoMigrate:false};
describe('grid-query authenticated HTTP API',()=>{
  const store=new MemoryStore();
  let app:Awaited<ReturnType<typeof buildApp>>;
  let userId:string;
  beforeAll(async()=>{
    store.seedGridDataset(gridFixture());
    const admin=await store.upsertAdmin({username:'grid-test-admin',displayName:'Test',passwordHash:'test-not-a-real-password'});
    const user=await store.createUser({phoneLookupHash:'test-hash',phoneCiphertext:'opaque-test',phoneLast4:'0000',passwordHash:'test-not-a-real-password',createdByAdminId:admin.id});userId=user.id;
    const session={csrfHash:'test-csrf',expiresAt:new Date(Date.now()+60000),ipHash:'test-ip',userAgentHash:'test-agent'};
    await store.createAdminSession(admin.id,{...session,tokenHash:secretDigest('grid-admin-token',testConfig.sessionSecret)});
    await store.createUserSession(user.id,{...session,tokenHash:secretDigest('grid-user-token',testConfig.sessionSecret)});
    app=await buildApp({config:testConfig,store});
  });
  afterAll(async()=>{await app.close();});
  it('blocks anonymous, wrong audience and route parameter injection',async()=>{
    for(const path of ['private/grid-query/facts','private/grid-query/rankings','private/grid-query/facets','private/grid-query/versions','admin/grid-query/facts','admin/grid-query/sources']){
      const response=await app.inject({method:'GET',url:`/api/v2/${path}`});expect(response.statusCode).toBe(401);expect(response.body).not.toContain('三峡大学');
    }
    const wrong=await app.inject({method:'GET',url:'/api/v2/admin/grid-query/rankings',headers:{cookie:'hz_user_session=grid-user-token'}});expect(wrong.statusCode).toBe(401);
    const malformed=await app.inject({method:'GET',url:'/api/v2/private/grid-query/facts?pageSize=1000',headers:{cookie:'hz_user_session=grid-user-token'}});expect(malformed.statusCode).toBe(400);
  });
  it('serves privacy-protected member data and exact admin summaries with no-store',async()=>{
    const member=await app.inject({method:'GET',url:'/api/v2/private/grid-query/rankings?q='+encodeURIComponent('样本'),headers:{cookie:'hz_user_session=grid-user-token'}});
    expect(member.statusCode).toBe(200);expect(member.headers['cache-control']).toContain('no-store');expect(member.json().items[0]).toMatchObject({recordCount:null,rank:null});
    const admin=await app.inject({method:'GET',url:'/api/v2/admin/grid-query/rankings?q='+encodeURIComponent('样本'),headers:{cookie:'hz_admin_session=grid-admin-token'}});
    expect(admin.statusCode).toBe(200);expect(admin.json().items[0].recordCount).toBe(3);
    const userFacts=await app.inject({method:'GET',url:'/api/v2/private/grid-query/facts',headers:{cookie:'hz_user_session=grid-user-token'}});expect(userFacts.body).not.toContain('长株潭');
    const adminFacts=await app.inject({method:'GET',url:'/api/v2/admin/grid-query/facts?dataStatus=quarantined',headers:{cookie:'hz_admin_session=grid-admin-token'}});expect(adminFacts.json().total).toBe(1);
  });
  it('revokes all query access immediately for disabled users',async()=>{
    await store.updateUser(userId,{enabled:false});
    const response=await app.inject({method:'GET',url:'/api/v2/private/grid-query/facets',headers:{cookie:'hz_user_session=grid-user-token'}});expect(response.statusCode).toBe(401);
  });
});

const localDb=process.env.GRID_QUERY_TEST_DATABASE_URL;
describe.runIf(!!localDb)('grid-query real PostgreSQL transaction and parity',()=>{
  let pool:Pool;
  let store:PostgresStore;
  const dataset={...gridFixture(),datasetKey:'transaction-test-grid',version:'v1'};
  beforeAll(async()=>{
    const url=new URL(localDb!);
    if(!['127.0.0.1','localhost'].includes(url.hostname)||!url.pathname.includes('integration'))throw new Error('Tests require dedicated loopback integration DB');
    const connection=createDatabase(localDb!);pool=connection.pool;store=new PostgresStore(connection.db);
    await runMigrations(connection.db);
  });
  afterAll(async()=>{
    if(pool){
      for(const table of ['grid_policy_facts','grid_school_outcomes','grid_query_sources'])await pool.query(`DELETE FROM ${table} WHERE version_id IN (SELECT id FROM grid_dataset_versions WHERE dataset_key='transaction-test-grid')`);
      await pool.query("DELETE FROM grid_dataset_versions WHERE dataset_key='transaction-test-grid'");
      await pool.end();
    }
  });
  it('imports, checks every payload, preserves old tables and rejects conflicts/overlap',async()=>{
    const client=await pool.connect();
    try{
      const legacy=async()=>{
        const result:Record<string,string>={};
        for(const table of ['admins','admin_sessions','users','user_sessions','source_documents','provinces','cities','schools','companies','data_revisions','recruitment_batches','recruitment_events','recruitment_requirements','recruitment_metrics','early_batch_policies','audit_events']){
          result[table]=(await client.query(`SELECT md5(COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id)::text,'[]')) AS hash FROM ${table} t`)).rows[0].hash;
        }return result;
      };
      const before=await legacy();
      const imported=await importGridDataset(client,dataset);expect(imported.active).toBe(true);
      expect((await importGridDataset(client,dataset)).inserted).toBe(false);
      await client.query('UPDATE grid_dataset_versions SET fact_count=fact_count+1 WHERE dataset_key=$1 AND version=$2',[dataset.datasetKey,dataset.version]);
      await expect(importGridDataset(client,dataset)).rejects.toThrow('GRID_STORED_COUNT_MISMATCH');
      await client.query('UPDATE grid_dataset_versions SET fact_count=fact_count-1 WHERE dataset_key=$1 AND version=$2',[dataset.datasetKey,dataset.version]);
      await expect(importGridDataset(client,{...dataset,title:'同版不同内容'})).rejects.toThrow('GRID_VERSION_CONTENT_CONFLICT');
      await expect(importGridDataset(client,{...dataset,datasetKey:'overlap-other-dataset'})).rejects.toThrow('GRID_ACTIVE_ROSTER_SOURCE_OVERLAP');
      await expect(importGridDataset(client,{...dataset,version:'bad-official',policyFacts:[{...dataset.policyFacts[0],relatedOfficialSourceKey:'self-claimed-official'}]})).rejects.toThrow('GRID_OFFICIAL_LINK_NOT_VERIFIED');
      const failMidway={query:async(sql:string,values?:unknown[])=>{
        if(sql.startsWith('INSERT INTO grid_policy_facts'))throw new Error('INJECTED_MID_TRANSACTION_FAILURE');
        return client.query(sql,values);
      }} as unknown as typeof client;
      await expect(importGridDataset(failMidway,{...dataset,version:'mid-failure'})).rejects.toThrow('INJECTED_MID_TRANSACTION_FAILURE');
      expect(await legacy()).toEqual(before);
      expect((await client.query("SELECT count(*)::int n FROM grid_dataset_versions WHERE dataset_key='overlap-other-dataset' OR version IN ('bad-official','mid-failure')")).rows[0].n).toBe(0);
    }finally{client.release();}
  });
  it('keeps old version immutable, switches newest atomically and matches MemoryStore',async()=>{
    const client=await pool.connect();
    const next={...dataset,version:'v2',title:'第二版测试'};
    try{
      await importGridDataset(client,next);
      expect((await importGridDataset(client,dataset)).active).toBe(false);
      const pg=await store.gridQuerySnapshot();
      const live=pg.datasets.find(d=>d.datasetKey===dataset.datasetKey)!;
      expect(live.version).toBe('v2');
      const memory=new MemoryStore();memory.seedGridDataset(next);
      const filtered={datasets:[live],versions:pg.versions.filter(v=>v.datasetKey===dataset.datasetKey)};
      expect(queryGridRankings(filtered,gridRankingQuerySchema.parse({}),true)).toEqual(queryGridRankings(await memory.gridQuerySnapshot(),gridRankingQuerySchema.parse({}),true));
    }finally{client.release();}
  });
});
