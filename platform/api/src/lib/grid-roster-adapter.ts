import { z } from 'zod';
import { gridDatasetSchema, type GridDataset, type GridOutcome } from './grid-query.js';

// The legacy aggregate handoff has private sourceRows for provenance. Validate
// only its aggregate shape and intentionally never copy those rows into this DB.
const rowSchema=z.object({
  aggregateKey:z.string(),cohortYear:z.number().int(),grid:z.enum(['国网','南网']),batch:z.enum(['一批','二批','三批','春招','秋招']),
  unitCategory:z.enum(['省公司','供电局单列','直属单位','总部','分部','分部所属单位','省属上市公司','省属产业单位','供电服务公司']),
  province:z.string(),unitName:z.string(),unitKey:z.string(),parentSchoolKey:z.string(),schoolName:z.string(),campusKey:z.string(),campusName:z.string(),tier:z.string(),
  count:z.number().int().positive(),metricType:z.literal('public_notice_record_count'),destinationCity:z.null(),destinationScope:z.literal('recruiting_unit_only'),sourceKey:z.string(),sourceSheet:z.string(),
});
const handoffSchema=z.object({
  schemaVersion:z.literal('roster-handoff-1'),datasetKey:z.string(),cohortYear:z.number().int(),totalRecordCount:z.number().int().positive(),aggregateCount:z.number().int().positive(),
  sources:z.array(z.object({sourceKey:z.string(),title:z.string(),sha256:z.string(),notes:z.string()})),
  schoolAliases:z.array(z.object({parentSchoolKey:z.string(),campusKey:z.string(),level:z.string(),ownership:z.string(),schoolProvince:z.string(),industryTags:z.string()})),
  aggregates:z.array(rowSchema),notes:z.array(z.string()),
});
const batchMap={一批:'batch_1',二批:'batch_2',三批:'batch_3',春招:'csg_spring',秋招:'csg_autumn'} as const;
const orgMap={省公司:'province_company',供电局单列:'supply_bureau',直属单位:'direct_unit',总部:'headquarters',分部:'branch',分部所属单位:'branch_subunit',省属上市公司:'listed_company',省属产业单位:'industry',供电服务公司:'service'} as const;
export function adaptRosterHandoff(input:unknown):GridDataset {
  const data=handoffSchema.parse(input);
  if(data.aggregateCount!==data.aggregates.length||data.totalRecordCount!==data.aggregates.reduce((sum,row)=>sum+row.count,0))throw new Error('ROSTER_TOTAL_MISMATCH');
  const aliases=new Map(data.schoolAliases.map(row=>[row.campusKey,row]));
  const schoolOutcomes:GridOutcome[]=data.aggregates.map(row=>{
    const school=aliases.get(row.campusKey);
    return {outcomeKey:row.aggregateKey,sourceKey:row.sourceKey,cohortYear:row.cohortYear,grid:row.grid==='国网'?'sgcc':'csg',batchCode:batchMap[row.batch],
      province:row.province||null,city:null,companyKey:row.unitKey,company:row.unitName,orgCategory:orgMap[row.unitCategory],
      parentSchoolKey:row.parentSchoolKey,schoolName:row.schoolName,campusKey:row.campusKey,campusName:row.campusName,schoolTier:row.tier,
      educationLevel:school?.level||null,schoolOwnership:school?.ownership||null,schoolProvince:school?.schoolProvince||null,industryTags:school?.industryTags.split(/[、,，;；]/).map(v=>v.trim()).filter(Boolean)??[],
      metricType:'public_notice_record_count',recordCount:row.count,evidenceLocator:`工作表：${row.sourceSheet}；脱敏聚合，不提供名单行号`,};
  });
  return gridDatasetSchema.parse({schemaVersion:'grid-query-1',datasetKey:data.datasetKey,version:'roster-handoff-1',title:'2026届全国国网南网院校公示记录汇总',createdAt:'2026-09-22T00:00:00.000Z',
    sources:data.sources.map(s=>({sourceKey:s.sourceKey,title:s.title,sourceType:'roster_aggregate',sha256:s.sha256,sourceUrl:null,note:s.notes})),policyFacts:[],schoolOutcomes,
    notes:[...data.notes,'创建时间为本次规范适配版本日期，不是原公示发布时间。','名单统计未逐条官方网站重新核验；不等于自然人数或实际入职人数。'],});
}
