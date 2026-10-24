ALTER TABLE "recruitment_events" ADD COLUMN "scope_kind" varchar(40) DEFAULT 'province_company' NOT NULL;--> statement-breakpoint
ALTER TABLE "recruitment_requirements" ADD COLUMN "scope_kind" varchar(40) DEFAULT 'province_company' NOT NULL;--> statement-breakpoint
ALTER TABLE "recruitment_requirements" ADD COLUMN "category_tags" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "recruitment_requirements" ADD COLUMN "evidence_group_key" varchar(200);--> statement-breakpoint
ALTER TABLE "recruitment_requirements" ADD COLUMN "applicability_status" varchar(40) DEFAULT 'not_reviewed' NOT NULL;--> statement-breakpoint
CREATE INDEX "recruitment_requirements_evidence_group_idx" ON "recruitment_requirements" USING btree ("evidence_group_key");--> statement-breakpoint
ALTER TABLE "recruitment_events" ADD CONSTRAINT "recruitment_events_scope_kind_ck" CHECK ("recruitment_events"."scope_kind" in ('province_company', 'national', 'special_unit'));--> statement-breakpoint
ALTER TABLE "recruitment_requirements" ADD CONSTRAINT "recruitment_requirements_scope_kind_ck" CHECK ("recruitment_requirements"."scope_kind" in ('province_company', 'national', 'special_unit'));