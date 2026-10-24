CREATE TABLE "grid_dataset_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dataset_key" varchar(160) NOT NULL,
	"version" varchar(160) NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"checksum_sha256" varchar(64) NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"source_count" integer NOT NULL,
	"fact_count" integer NOT NULL,
	"outcome_count" integer NOT NULL,
	"notes" jsonb NOT NULL,
	CONSTRAINT "grid_dataset_counts_ck" CHECK ("grid_dataset_versions"."source_count">0 AND "grid_dataset_versions"."fact_count">=0 AND "grid_dataset_versions"."outcome_count">=0)
);
--> statement-breakpoint
CREATE TABLE "grid_policy_facts" (
	"version_id" uuid NOT NULL,
	"fact_key" varchar(160) NOT NULL,
	"source_key" varchar(160) NOT NULL,
	"cohort_year" integer,
	"province" text,
	"city" text,
	"batch_code" varchar(32) NOT NULL,
	"data_status" varchar(32) NOT NULL,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grid_query_sources" (
	"version_id" uuid NOT NULL,
	"source_key" varchar(160) NOT NULL,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grid_school_outcomes" (
	"version_id" uuid NOT NULL,
	"outcome_key" varchar(160) NOT NULL,
	"source_key" varchar(160) NOT NULL,
	"cohort_year" integer NOT NULL,
	"grid" varchar(16) NOT NULL,
	"batch_code" varchar(32) NOT NULL,
	"province" text,
	"org_category" varchar(32) NOT NULL,
	"parent_school_key" varchar(160) NOT NULL,
	"campus_key" varchar(160) NOT NULL,
	"record_count" integer NOT NULL,
	"payload" jsonb NOT NULL,
	CONSTRAINT "grid_school_count_ck" CHECK ("grid_school_outcomes"."record_count">0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "grid_query_source_uq" ON "grid_query_sources" USING btree ("version_id","source_key");--> statement-breakpoint
ALTER TABLE "grid_policy_facts" ADD CONSTRAINT "grid_policy_facts_version_id_grid_dataset_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."grid_dataset_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grid_policy_facts" ADD CONSTRAINT "grid_policy_facts_version_id_source_key_grid_query_sources_version_id_source_key_fk" FOREIGN KEY ("version_id","source_key") REFERENCES "public"."grid_query_sources"("version_id","source_key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grid_query_sources" ADD CONSTRAINT "grid_query_sources_version_id_grid_dataset_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."grid_dataset_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grid_school_outcomes" ADD CONSTRAINT "grid_school_outcomes_version_id_grid_dataset_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."grid_dataset_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grid_school_outcomes" ADD CONSTRAINT "grid_school_outcomes_version_id_source_key_grid_query_sources_version_id_source_key_fk" FOREIGN KEY ("version_id","source_key") REFERENCES "public"."grid_query_sources"("version_id","source_key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "grid_dataset_version_uq" ON "grid_dataset_versions" USING btree ("dataset_key","version");--> statement-breakpoint
CREATE UNIQUE INDEX "grid_dataset_active_uq" ON "grid_dataset_versions" USING btree ("dataset_key") WHERE "grid_dataset_versions"."active"=true;--> statement-breakpoint
CREATE UNIQUE INDEX "grid_policy_fact_uq" ON "grid_policy_facts" USING btree ("version_id","fact_key");--> statement-breakpoint
CREATE INDEX "grid_policy_region_idx" ON "grid_policy_facts" USING btree ("version_id","province","city","cohort_year");--> statement-breakpoint
CREATE UNIQUE INDEX "grid_school_outcome_uq" ON "grid_school_outcomes" USING btree ("version_id","outcome_key");--> statement-breakpoint
CREATE INDEX "grid_school_query_idx" ON "grid_school_outcomes" USING btree ("version_id","cohort_year","grid","batch_code","province");
