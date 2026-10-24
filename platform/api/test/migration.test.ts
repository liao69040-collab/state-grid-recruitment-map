import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('initial PostgreSQL migration', () => {
  it('creates every required security and business table', async () => {
    const sql = `${await readFile(
      new URL('../drizzle/0000_unusual_firelord.sql', import.meta.url),
      'utf8',
    )}\n${await readFile(new URL('../drizzle/0001_demonic_earthquake.sql', import.meta.url), 'utf8')}\n${await readFile(
      new URL('../drizzle/0002_silent_cardiac.sql', import.meta.url),
      'utf8',
    )}\n${await readFile(new URL('../drizzle/0003_users_phone_lookup_active_unique.sql', import.meta.url), 'utf8')}\n${await readFile(
      new URL('../drizzle/0004_daffy_giant_man.sql', import.meta.url),
      'utf8',
    )}\n${await readFile(new URL('../drizzle/0005_keen_eddie_brock.sql', import.meta.url), 'utf8')}\n${await readFile(
      new URL('../drizzle/0006_talented_next_avengers.sql', import.meta.url),
      'utf8',
    )}\n${await readFile(new URL('../drizzle/0007_glorious_garia.sql', import.meta.url), 'utf8')}\n${await readFile(
      new URL('../drizzle/0008_brief_ares.sql', import.meta.url),
      'utf8',
    )}\n${await readFile(new URL('../drizzle/0009_lush_franklin_richards.sql', import.meta.url), 'utf8')}\n${await readFile(
      new URL('../drizzle/0010_pretty_prowler.sql', import.meta.url),
      'utf8',
    )}`;
    for (const table of [
      'admins',
      'admin_sessions',
      'users',
      'user_sessions',
      'provinces',
      'cities',
      'schools',
      'companies',
      'recruitment_batches',
      'recruitment_events',
      'recruitment_requirements',
      'recruitment_metrics',
      'source_documents',
      'data_revisions',
      'early_batch_policies',
      'audit_events',
    ]) {
      expect(sql).toContain(`CREATE TABLE \"${table}\"`);
    }
    expect(sql).toContain('recruitment_metrics_value_or_display_ck');
    expect(sql).toContain('CREATE UNIQUE INDEX "early_batch_policies_target_revision_uq"');
    expect(sql).toContain('CREATE UNIQUE INDEX "recruitment_requirements_key_uq"');
    expect(sql).toContain('CREATE INDEX "early_batch_policies_year_publication_idx"');
    expect(sql).toContain('"metadata" jsonb');
    expect(sql).toContain('"business_data_status" varchar(100)');
    expect(sql).toContain('USING "status"::text');
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "users_phone_lookup_uq" ON "users" USING btree ("phone_lookup_hash") WHERE "users"."deleted_at" is null',
    );
    for (const column of [
      '"value_kind" varchar(100)',
      '"aggregation_grain" varchar(120)',
      '"is_approximate" boolean',
      '"subject_scope" text',
      '"suppressed_range" varchar(80)',
      '"suppression_reason" varchar(120)',
      '"zero_confirmed" boolean',
      '"source_keys" jsonb',
      '"starts_on" date',
      '"raw_time_text" text',
      '"location_kind" varchar(60)',
      '"evidence_tier" varchar(8)',
      '"content_text" text',
      '"destination_scope" varchar(40)',
      '"discipline_group" varchar(40)',
      '"discipline_evidence_status" varchar(40)',
      '"major_category" varchar(80)',
      '"major_evidence_status" varchar(40)',
      '"scope_kind" varchar(40)',
      '"category_tags" jsonb',
      '"evidence_group_key" varchar(200)',
      '"applicability_status" varchar(40)',
    ]) {
      expect(sql).toContain(column);
    }
    expect(sql).toContain('recruitment_metrics_destination_scope_ck');
    expect(sql).toContain('recruitment_metrics_discipline_group_ck');
    expect(sql).toContain('recruitment_metrics_discipline_evidence_status_ck');
    expect(sql).toContain('recruitment_metrics_major_evidence_status_ck');
    expect(sql).toContain('recruitment_requirements_scope_kind_ck');
    expect(sql).toContain('recruitment_events_scope_kind_ck');
    expect(sql).toContain("source.\"source_key\" = 'public-selection-aggregate-2026'");
    expect(sql).toContain("metric.\"aggregation_grain\" IN ('cohort_school', 'cohort_batch_school')");
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "recruitment_batches_year_code_scope_uq" ON "recruitment_batches" USING btree ("cohort_year","code","province_id","company_id")',
    );
    expect(sql.indexOf('SET "province_id" = province."id"')).toBeLessThan(
      sql.indexOf('ALTER COLUMN "province_id" SET NOT NULL'),
    );
    expect(sql.indexOf('"unit" = COALESCE')).toBeLessThan(
      sql.indexOf('ALTER COLUMN "unit" SET NOT NULL'),
    );
  });
});
