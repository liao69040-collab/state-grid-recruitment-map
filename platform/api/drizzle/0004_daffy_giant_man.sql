DROP INDEX "recruitment_batches_year_code_scope_uq";--> statement-breakpoint
ALTER TABLE "recruitment_batches" ADD COLUMN "province_id" uuid;--> statement-breakpoint
ALTER TABLE "recruitment_batches" ADD COLUMN "company_id" uuid;--> statement-breakpoint
ALTER TABLE "recruitment_batches" ADD COLUMN "source_keys" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "recruitment_events" ADD COLUMN "source_keys" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "recruitment_metrics" ADD COLUMN "value_kind" varchar(100) DEFAULT 'unspecified' NOT NULL;--> statement-breakpoint
ALTER TABLE "recruitment_metrics" ADD COLUMN "aggregation_grain" varchar(120) DEFAULT 'unspecified' NOT NULL;--> statement-breakpoint
ALTER TABLE "recruitment_metrics" ADD COLUMN "is_approximate" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "recruitment_metrics" ADD COLUMN "subject_scope" text;--> statement-breakpoint
ALTER TABLE "recruitment_metrics" ADD COLUMN "suppressed_range" varchar(80);--> statement-breakpoint
ALTER TABLE "recruitment_metrics" ADD COLUMN "suppression_reason" varchar(120);--> statement-breakpoint
ALTER TABLE "recruitment_metrics" ADD COLUMN "zero_confirmed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "recruitment_metrics" ADD COLUMN "source_keys" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint

UPDATE "recruitment_batches"
SET "source_keys" = CASE
  WHEN jsonb_typeof("metadata"->'source_ids') = 'array' THEN "metadata"->'source_ids'
  ELSE '[]'::jsonb
END;--> statement-breakpoint
UPDATE "recruitment_events"
SET "source_keys" = CASE
  WHEN jsonb_typeof("metadata"->'source_ids') = 'array' THEN "metadata"->'source_ids'
  ELSE '[]'::jsonb
END;--> statement-breakpoint
UPDATE "recruitment_metrics"
SET
  "value_kind" = COALESCE(NULLIF("metadata"->>'value_kind', ''), 'unspecified'),
  "aggregation_grain" = COALESCE(NULLIF("metadata"->>'aggregation_grain', ''), 'unspecified'),
  "is_approximate" = CASE
    WHEN "metadata"->>'is_approximate' IN ('true', 'false')
      THEN ("metadata"->>'is_approximate')::boolean
    ELSE false
  END,
  "subject_scope" = NULLIF("metadata"->>'subject_scope', ''),
  "suppressed_range" = NULLIF("metadata"->>'suppressed_range', ''),
  "suppression_reason" = NULLIF("metadata"->>'suppression_reason', ''),
  "zero_confirmed" = CASE
    WHEN "metadata"->>'zero_confirmed' IN ('true', 'false')
      THEN ("metadata"->>'zero_confirmed')::boolean
    ELSE false
  END,
  "source_keys" = CASE
    WHEN jsonb_typeof("metadata"->'source_ids') = 'array' THEN "metadata"->'source_ids'
    ELSE '[]'::jsonb
  END,
  "unit" = COALESCE(NULLIF("unit", ''), NULLIF("metadata"->>'metric_unit', ''), 'unspecified');--> statement-breakpoint

UPDATE "recruitment_batches" AS batch
SET "province_id" = province."id"
FROM "provinces" AS province
WHERE province."province_key" = batch."metadata"->>'province_id';--> statement-breakpoint
UPDATE "recruitment_batches" AS batch
SET
  "company_id" = company."id",
  "unit_scope" = company."name"
FROM "companies" AS company
WHERE company."company_key" = batch."metadata"->>'company_id';--> statement-breakpoint

UPDATE "recruitment_events" AS event
SET "batch_code" = batch."code"
FROM "recruitment_batches" AS batch
WHERE event."batch_id" = batch."id";--> statement-breakpoint
UPDATE "recruitment_metrics" AS metric
SET "batch_code" = batch."code"
FROM "recruitment_batches" AS batch
WHERE metric."batch_id" = batch."id";--> statement-breakpoint
UPDATE "recruitment_metrics"
SET "batch_code" = CASE
  WHEN "aggregation_grain" = 'cohort_school' THEN 'all'
  ELSE 'not_applicable'
END
WHERE "batch_id" IS NULL;--> statement-breakpoint

UPDATE "recruitment_metrics" AS metric
SET "source_document_id" = source."id"
FROM "source_documents" AS source
WHERE source."source_key" = 'public-selection-aggregate-2026'
  AND metric."source_keys" ? 'public-selection-aggregate-2026'
  AND (
    metric."metric_type" IN ('public_notice_record_count', 'batch_share')
    OR metric."value_kind" = 'data_quality_reconciliation'
  );--> statement-breakpoint

UPDATE "recruitment_metrics" AS metric
SET
  "province_id" = province."id",
  "company_id" = company."id",
  "city_id" = NULL,
  "unit_scope" = company."name"
FROM "provinces" AS province, "companies" AS company
WHERE province."province_key" = 'PROV-CN-420000'
  AND company."company_key" = 'COMPANY-SGCC-HUBEI'
  AND metric."aggregation_grain" IN ('cohort_school', 'cohort_batch_school')
  AND metric."source_keys" ? 'public-selection-aggregate-2026';--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "recruitment_batches"
    WHERE "province_id" IS NULL OR "company_id" IS NULL
  ) THEN
    RAISE EXCEPTION 'recruitment_batches contains rows without canonical province/company metadata';
  END IF;
END
$$;--> statement-breakpoint

ALTER TABLE "recruitment_metrics" ALTER COLUMN "unit" SET DEFAULT 'unspecified';--> statement-breakpoint
ALTER TABLE "recruitment_metrics" ALTER COLUMN "unit" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "recruitment_batches" ALTER COLUMN "province_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "recruitment_batches" ALTER COLUMN "company_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "recruitment_batches" ADD CONSTRAINT "recruitment_batches_province_id_provinces_id_fk" FOREIGN KEY ("province_id") REFERENCES "public"."provinces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruitment_batches" ADD CONSTRAINT "recruitment_batches_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recruitment_batches_scope_idx" ON "recruitment_batches" USING btree ("province_id","company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "recruitment_batches_year_code_scope_uq" ON "recruitment_batches" USING btree ("cohort_year","code","province_id","company_id");
