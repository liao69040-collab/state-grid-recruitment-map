import { createDatabase } from '../src/db/client.js';
import { PostgresStore } from '../src/store/postgres.js';
import { loadGridInformation } from '../src/lib/grid-information.js';
import { queryExactGridOverview, queryExactGridRankings, queryExactGridSchool, queryExactInformation } from '../src/lib/grid-aggregates.js';
import { gridMapQuerySchema } from '../src/lib/grid-map.js';
import { gridRankingQuerySchema } from '../src/lib/grid-query.js';
import { privateSourceIndex } from '../src/lib/private-source-boundary.js';

const url=new URL(process.env.DATABASE_URL??'');
if(!['127.0.0.1','localhost'].includes(url.hostname)||!url.pathname.includes('integration'))throw new Error('Dedicated loopback integration database only');
url.searchParams.set('options','-c default_transaction_read_only=on');
const {db,pool}=createDatabase(url.toString());
const year=2026;
try{
  const started=performance.now(),input=await loadGridInformation(new PostgresStore(db),year),loaded=performance.now();
  const sourceKeys=[...privateSourceIndex(input.sources??[]).keys];
  const from=`FROM grid_school_outcomes o JOIN grid_dataset_versions v ON v.id=o.version_id WHERE v.active=true AND o.cohort_year=$1 AND NOT(o.source_key=ANY($2::text[])) AND o.source_key NOT LIKE 'DEMO-PRIVATE-%'`;
  const nationalSql=`SELECT o.grid,o.batch_code,SUM(o.record_count)::int AS record_count ${from} GROUP BY o.grid,o.batch_code ORDER BY o.grid,o.batch_code`;
  const national=(await pool.query(nationalSql,[year,sourceKeys])).rows as {grid:string;batch_code:string;record_count:number}[];
  const campusSql=`SELECT o.campus_key,SUM(o.record_count)::int AS record_count ${from} GROUP BY o.campus_key ORDER BY o.campus_key`;
  const campuses=(await pool.query(campusSql,[year,sourceKeys])).rows as {campus_key:string;record_count:number}[];
  const sqlSchoolCounts=new Map(campuses.map(r=>[r.campus_key,r.record_count]));
  const information=queryExactInformation(input,year);
  for(const row of national){
    const card=information.cards.find(c=>c.grid===row.grid&&c.batchCode===row.batch_code);
    if(card?.publicNotice.value!==row.record_count)throw new Error(`NATIONAL_SQL_API_MISMATCH:${row.grid}:${row.batch_code}`);
  }
  let checkedCampuses=0;
  for(let page=1;page<=Math.ceil(campuses.length/100);page++){
    const result=queryExactGridRankings(input,gridRankingQuerySchema.parse({cohortYear:year,view:'campus',page,pageSize:100}));
    for(const row of result.items){if(sqlSchoolCounts.get(row.schoolKey)!==row.recordCount)throw new Error('CAMPUS_SQL_API_MISMATCH');checkedCampuses++;}
  }
  if(checkedCampuses!==campuses.length)throw new Error('CAMPUS_COUNT_MISMATCH');
  const overviewStart=performance.now(),overview=queryExactGridOverview(input,gridMapQuerySchema.parse({cohortYear:year})),overviewEnd=performance.now();
  const warmStart=performance.now();queryExactGridOverview(input,gridMapQuerySchema.parse({cohortYear:year}));const warmMs=performance.now()-warmStart;
  const total=national.reduce((n,r)=>n+r.record_count,0);
  if(overview.nationalSummary.recordCount!==total)throw new Error('NATIONAL_TOTAL_MISMATCH');
  const regionSum=overview.provinceSummaries.reduce((n,r)=>n+(r.recordCount??0),0)+(overview.nationalSummary.unassignedDestinationRecordCount??0);
  if(regionSum!==total)throw new Error('PROVINCE_SUM_MISMATCH');
  const example=input.snapshot.datasets.flatMap(d=>d.schoolOutcomes).find(r=>r.schoolName==='三峡大学')??input.snapshot.datasets.flatMap(d=>d.schoolOutcomes)[0];
  const school=example?queryExactGridSchool(input,example.campusKey,gridMapQuerySchema.parse({cohortYear:year,provinceAdcode:'420000'})):null;
  if(school&&!Object.values(school.recruitmentSummary.equations).every(v=>v===true))throw new Error('SCHOOL_EQUATION_MISMATCH');
  if(school)for(const [batch,count] of Object.entries(school.recruitmentSummary.national.batchCounts)){
    if((school.recruitmentSummary.targetProvince?.batchCounts[batch]??0)+(school.recruitmentSummary.otherProvinces?.batchCounts[batch]??0)!==count)throw new Error('SCHOOL_BATCH_EQUATION_MISMATCH');
  }
  const explain=(await pool.query(`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ${nationalSql}`,[year,sourceKeys])).rows[0]['QUERY PLAN'];
  const campusExplain=(await pool.query(`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ${campusSql}`,[year,sourceKeys])).rows[0]['QUERY PLAN'];
  console.log(JSON.stringify({verifiedAt:new Date().toISOString(),databaseScope:'loopback integration only',transactionReadOnly:(await pool.query('SHOW transaction_read_only')).rows[0].transaction_read_only,
    versions:input.snapshot.versions.map(v=>({datasetKey:v.datasetKey,version:v.version,checksumSha256:v.checksumSha256,factCount:v.factCount,outcomeCount:v.outcomeCount})),
    catalogVersions:input.catalogs.map(c=>c.version),national,total,unassignedDestinationRecordCount:overview.nationalSummary.unassignedDestinationRecordCount,
    checkedCampuses,checks:{allCampusCountsMatchSQL:true,provincePlusUnassignedEqualsNational:true,nationalBatchCardsMatchSQL:true,schoolTargetOtherAndDestinationEquations:true},
    sampleSchool:school?{campusKey:school.school.campusKey,campusName:school.school.campusName,recruitmentSummary:school.recruitmentSummary}:null,
    performanceMs:{load:Math.round(loaded-started),overviewCold:Math.round(overviewEnd-overviewStart),overviewWarm:Math.round(warmMs)},
    explain:{sql:nationalSql,parameters:[year,sourceKeys],plan:explain},campusExplain:{sql:campusSql,plan:campusExplain},
    databaseChanges:'none; read-only verification; no migrations, seed replay, fixture inserts, user or credential writes'},null,2));
}finally{await pool.end();}
