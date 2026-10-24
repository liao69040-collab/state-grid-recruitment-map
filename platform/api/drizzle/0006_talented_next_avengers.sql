CREATE TABLE "recruitment_requirements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requirement_key" varchar(200) NOT NULL,
	"cohort_year" integer NOT NULL,
	"batch_code" varchar(80) NOT NULL,
	"province_id" uuid,
	"company_id" uuid,
	"unit_scope" varchar(200) NOT NULL,
	"category" varchar(80) NOT NULL,
	"requirement_kind" varchar(80) DEFAULT 'official_excerpt' NOT NULL,
	"title" varchar(240) NOT NULL,
	"excerpt" text NOT NULL,
	"applicability" text,
	"evidence_locator" varchar(240),
	"evidence_tier" varchar(8) DEFAULT 'A' NOT NULL,
	"source_document_id" uuid NOT NULL,
	"source_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" varchar(80) DEFAULT 'pending' NOT NULL,
	"publication_status" "publication_status" DEFAULT 'draft' NOT NULL,
	"notes" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "recruitment_events" ADD COLUMN "starts_on" date;--> statement-breakpoint
ALTER TABLE "recruitment_events" ADD COLUMN "ends_on" date;--> statement-breakpoint
ALTER TABLE "recruitment_events" ADD COLUMN "raw_time_text" text;--> statement-breakpoint
ALTER TABLE "recruitment_events" ADD COLUMN "date_precision" varchar(40);--> statement-breakpoint
ALTER TABLE "recruitment_events" ADD COLUMN "time_status" varchar(80);--> statement-breakpoint
ALTER TABLE "recruitment_events" ADD COLUMN "certainty" varchar(40);--> statement-breakpoint
ALTER TABLE "recruitment_events" ADD COLUMN "location_text" text;--> statement-breakpoint
ALTER TABLE "recruitment_events" ADD COLUMN "location_kind" varchar(60);--> statement-breakpoint
ALTER TABLE "recruitment_events" ADD COLUMN "evidence_excerpt" text;--> statement-breakpoint
ALTER TABLE "recruitment_events" ADD COLUMN "evidence_tier" varchar(8) DEFAULT 'A' NOT NULL;--> statement-breakpoint
ALTER TABLE "recruitment_events" ADD COLUMN "source_kind" varchar(60) DEFAULT 'current_official' NOT NULL;--> statement-breakpoint
ALTER TABLE "recruitment_requirements" ADD CONSTRAINT "recruitment_requirements_province_id_provinces_id_fk" FOREIGN KEY ("province_id") REFERENCES "public"."provinces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruitment_requirements" ADD CONSTRAINT "recruitment_requirements_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruitment_requirements" ADD CONSTRAINT "recruitment_requirements_source_document_id_source_documents_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."source_documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "recruitment_requirements_key_uq" ON "recruitment_requirements" USING btree ("requirement_key");--> statement-breakpoint
CREATE INDEX "recruitment_requirements_scope_idx" ON "recruitment_requirements" USING btree ("cohort_year","batch_code","province_id","company_id");--> statement-breakpoint
CREATE INDEX "recruitment_requirements_category_idx" ON "recruitment_requirements" USING btree ("category");