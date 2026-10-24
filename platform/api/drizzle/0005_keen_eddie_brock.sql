CREATE TABLE "early_batch_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"policy_key" varchar(200) NOT NULL,
	"cohort_year" integer NOT NULL,
	"batch_code" varchar(80) DEFAULT 'campus' NOT NULL,
	"target_kind" varchar(40) NOT NULL,
	"target_code" varchar(120) NOT NULL,
	"target_name" varchar(120) NOT NULL,
	"province_id" uuid,
	"parent_province_id" uuid,
	"recruitment_requirements" text NOT NULL,
	"recruitment_process" text,
	"planned_headcount_display" varchar(120),
	"assessment_method" text,
	"itinerary_reference" text,
	"site_quota_display" text,
	"admission_rule" text,
	"actual_headcount_display" varchar(120),
	"other_notes" text,
	"missing_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"eligibility_model" jsonb NOT NULL,
	"source_locator" varchar(120) NOT NULL,
	"evidence_assets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"external_evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_status" varchar(100) NOT NULL,
	"source_document_id" uuid NOT NULL,
	"revision_id" uuid NOT NULL,
	"status" varchar(80) DEFAULT 'active' NOT NULL,
	"publication_status" "publication_status" DEFAULT 'draft' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "early_batch_policies" ADD CONSTRAINT "early_batch_policies_province_id_provinces_id_fk" FOREIGN KEY ("province_id") REFERENCES "public"."provinces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "early_batch_policies" ADD CONSTRAINT "early_batch_policies_parent_province_id_provinces_id_fk" FOREIGN KEY ("parent_province_id") REFERENCES "public"."provinces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "early_batch_policies" ADD CONSTRAINT "early_batch_policies_source_document_id_source_documents_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."source_documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "early_batch_policies" ADD CONSTRAINT "early_batch_policies_revision_id_data_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."data_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "early_batch_policies_key_uq" ON "early_batch_policies" USING btree ("policy_key");--> statement-breakpoint
CREATE UNIQUE INDEX "early_batch_policies_target_revision_uq" ON "early_batch_policies" USING btree ("cohort_year","target_code","revision_id");--> statement-breakpoint
CREATE INDEX "early_batch_policies_year_publication_idx" ON "early_batch_policies" USING btree ("cohort_year","publication_status");--> statement-breakpoint
CREATE INDEX "early_batch_policies_parent_province_idx" ON "early_batch_policies" USING btree ("parent_province_id");