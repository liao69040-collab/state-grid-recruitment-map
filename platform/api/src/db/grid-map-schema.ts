import { sql } from 'drizzle-orm';
import { boolean, jsonb, pgTable, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import type { GridMapCatalog } from '../lib/grid-map-catalog.js';
import { gridDatasetVersions } from './grid-query-schema.js';

export const gridMapCatalogs=pgTable('grid_map_catalogs',{
  id:uuid('id').primaryKey().defaultRandom(),datasetVersionId:uuid('dataset_version_id').notNull().references(()=>gridDatasetVersions.id),
  version:varchar('version',{length:160}).notNull(),checksumSha256:varchar('checksum_sha256',{length:64}).notNull(),
  active:boolean('active').notNull().default(false),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
  payload:jsonb('payload').$type<GridMapCatalog>().notNull(),
},t=>[uniqueIndex('grid_map_catalog_version_uq').on(t.datasetVersionId,t.version),uniqueIndex('grid_map_catalog_active_uq').on(t.datasetVersionId).where(sql`${t.active}=true`)]);
