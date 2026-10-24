import { sql } from 'drizzle-orm';
import { boolean, check, foreignKey, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import type { GridDataset, GridFact, GridOutcome, GridSource } from '../lib/grid-query.js';

export const gridDatasetVersions=pgTable('grid_dataset_versions',{
  id:uuid('id').primaryKey().defaultRandom(),datasetKey:varchar('dataset_key',{length:160}).notNull(),version:varchar('version',{length:160}).notNull(),
  title:text('title').notNull(),createdAt:timestamp('created_at',{withTimezone:true}).notNull(),importedAt:timestamp('imported_at',{withTimezone:true}).notNull().defaultNow(),
  checksumSha256:varchar('checksum_sha256',{length:64}).notNull(),active:boolean('active').notNull().default(false),
  sourceCount:integer('source_count').notNull(),factCount:integer('fact_count').notNull(),outcomeCount:integer('outcome_count').notNull(),
  notes:jsonb('notes').$type<GridDataset['notes']>().notNull(),
},t=>[uniqueIndex('grid_dataset_version_uq').on(t.datasetKey,t.version),uniqueIndex('grid_dataset_active_uq').on(t.datasetKey).where(sql`${t.active}=true`),check('grid_dataset_counts_ck',sql`${t.sourceCount}>0 AND ${t.factCount}>=0 AND ${t.outcomeCount}>=0`)]);
export const gridQuerySources=pgTable('grid_query_sources',{
  versionId:uuid('version_id').notNull().references(()=>gridDatasetVersions.id),sourceKey:varchar('source_key',{length:160}).notNull(),
  payload:jsonb('payload').$type<GridSource>().notNull(),
},t=>[uniqueIndex('grid_query_source_uq').on(t.versionId,t.sourceKey)]);
export const gridPolicyFacts=pgTable('grid_policy_facts',{
  versionId:uuid('version_id').notNull().references(()=>gridDatasetVersions.id),factKey:varchar('fact_key',{length:160}).notNull(),sourceKey:varchar('source_key',{length:160}).notNull(),
  cohortYear:integer('cohort_year'),province:text('province'),city:text('city'),batchCode:varchar('batch_code',{length:32}).notNull(),dataStatus:varchar('data_status',{length:32}).notNull(),
  payload:jsonb('payload').$type<GridFact>().notNull(),
},t=>[uniqueIndex('grid_policy_fact_uq').on(t.versionId,t.factKey),index('grid_policy_region_idx').on(t.versionId,t.province,t.city,t.cohortYear),foreignKey({columns:[t.versionId,t.sourceKey],foreignColumns:[gridQuerySources.versionId,gridQuerySources.sourceKey]})]);
export const gridSchoolOutcomes=pgTable('grid_school_outcomes',{
  versionId:uuid('version_id').notNull().references(()=>gridDatasetVersions.id),outcomeKey:varchar('outcome_key',{length:160}).notNull(),sourceKey:varchar('source_key',{length:160}).notNull(),
  cohortYear:integer('cohort_year').notNull(),grid:varchar('grid',{length:16}).notNull(),batchCode:varchar('batch_code',{length:32}).notNull(),province:text('province'),
  orgCategory:varchar('org_category',{length:32}).notNull(),parentSchoolKey:varchar('parent_school_key',{length:160}).notNull(),campusKey:varchar('campus_key',{length:160}).notNull(),recordCount:integer('record_count').notNull(),
  payload:jsonb('payload').$type<GridOutcome>().notNull(),
},t=>[uniqueIndex('grid_school_outcome_uq').on(t.versionId,t.outcomeKey),index('grid_school_query_idx').on(t.versionId,t.cohortYear,t.grid,t.batchCode,t.province),check('grid_school_count_ck',sql`${t.recordCount}>0`),foreignKey({columns:[t.versionId,t.sourceKey],foreignColumns:[gridQuerySources.versionId,gridQuerySources.sourceKey]})]);
