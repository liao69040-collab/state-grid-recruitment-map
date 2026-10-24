CREATE TYPE "public"."audit_outcome" AS ENUM('success', 'failure');--> statement-breakpoint
CREATE TYPE "public"."publication_status" AS ENUM('draft', 'published', 'archived');--> statement-breakpoint
CREATE TYPE "public"."verification_status" AS ENUM('verified', 'derived', 'pending');--> statement-breakpoint
CREATE TABLE "admin_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"csrf_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"ip_hash" varchar(64),
	"user_agent_hash" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" varchar(80) NOT NULL,
	"display_name" varchar(120) NOT NULL,
	"password_hash" text NOT NULL,
	"role" varchar(32) DEFAULT 'superadmin' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_type" varchar(32) NOT NULL,
	"actor_id" uuid,
	"action" varchar(120) NOT NULL,
	"resource_type" varchar(100),
	"resource_id" varchar(100),
	"outcome" "audit_outcome" NOT NULL,
	"request_id" varchar(100),
	"ip_hash" varchar(64),
	"user_agent_hash" varchar(64),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"province_id" uuid NOT NULL,
	"adcode" varchar(6) NOT NULL,
	"name" varchar(80) NOT NULL,
	"longitude" numeric(10, 7),
	"latitude" numeric(10, 7),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_key" varchar(160) NOT NULL,
	"name" varchar(240) NOT NULL,
	"parent_company_id" uuid,
	"province_id" uuid,
	"city_id" uuid,
	"company_type" varchar(100),
	"address" text,
	"longitude" numeric(10, 7),
	"latitude" numeric(10, 7),
	"cohort_year" integer,
	"batch_code" varchar(80),
	"unit_scope" varchar(200),
	"source_document_id" uuid,
	"status" "verification_status" DEFAULT 'pending' NOT NULL,
	"publication_status" "publication_status" DEFAULT 'draft' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"revision_key" varchar(160) NOT NULL,
	"title" varchar(240) NOT NULL,
	"description" text,
	"cohort_year" integer,
	"batch_code" varchar(80),
	"unit_scope" varchar(200),
	"source_document_id" uuid,
	"status" "publication_status" DEFAULT 'draft' NOT NULL,
	"data_status" "verification_status" DEFAULT 'pending' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"published_at" timestamp with time zone,
	"created_by_admin_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provinces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"adcode" varchar(6) NOT NULL,
	"name" varchar(80) NOT NULL,
	"short_name" varchar(40),
	"region" varchar(40),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recruitment_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cohort_year" integer NOT NULL,
	"code" varchar(80) NOT NULL,
	"name" varchar(120) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"unit_scope" varchar(200) DEFAULT '国家电网' NOT NULL,
	"application_starts_at" timestamp with time zone,
	"application_ends_at" timestamp with time zone,
	"exam_starts_at" timestamp with time zone,
	"exam_ends_at" timestamp with time zone,
	"source_document_id" uuid,
	"status" "verification_status" DEFAULT 'pending' NOT NULL,
	"publication_status" "publication_status" DEFAULT 'draft' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recruitment_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cohort_year" integer NOT NULL,
	"batch_id" uuid,
	"batch_code" varchar(80) NOT NULL,
	"province_id" uuid,
	"city_id" uuid,
	"company_id" uuid,
	"unit_scope" varchar(200) NOT NULL,
	"event_type" varchar(80) NOT NULL,
	"title" text NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"timezone" varchar(64) DEFAULT 'Asia/Shanghai' NOT NULL,
	"source_document_id" uuid,
	"status" "verification_status" DEFAULT 'pending' NOT NULL,
	"publication_status" "publication_status" DEFAULT 'draft' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recruitment_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cohort_year" integer NOT NULL,
	"batch_id" uuid,
	"batch_code" varchar(80) NOT NULL,
	"province_id" uuid,
	"city_id" uuid,
	"school_id" uuid,
	"company_id" uuid,
	"unit_scope" varchar(200) NOT NULL,
	"metric_type" varchar(100) NOT NULL,
	"value" numeric(18, 4),
	"display_value" varchar(120),
	"unit" varchar(40),
	"sample_size" integer,
	"privacy_suppressed" boolean DEFAULT false NOT NULL,
	"source_document_id" uuid,
	"status" "verification_status" DEFAULT 'pending' NOT NULL,
	"publication_status" "publication_status" DEFAULT 'draft' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recruitment_metrics_value_or_display_ck" CHECK ("recruitment_metrics"."value" is not null or "recruitment_metrics"."display_value" is not null)
);
--> statement-breakpoint
CREATE TABLE "schools" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_key" varchar(160) NOT NULL,
	"name" varchar(240) NOT NULL,
	"province_id" uuid,
	"city_id" uuid,
	"nature" varchar(120),
	"education_level" varchar(80),
	"address" text,
	"longitude" numeric(10, 7),
	"latitude" numeric(10, 7),
	"cohort_year" integer,
	"batch_code" varchar(80),
	"unit_scope" varchar(200),
	"source_document_id" uuid,
	"status" "verification_status" DEFAULT 'pending' NOT NULL,
	"publication_status" "publication_status" DEFAULT 'draft' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_key" varchar(160) NOT NULL,
	"title" text NOT NULL,
	"source_type" varchar(80) NOT NULL,
	"publisher" varchar(200),
	"official_url" text,
	"archive_path" text,
	"checksum_sha256" varchar(64),
	"published_at" timestamp with time zone,
	"accessed_at" timestamp with time zone,
	"cohort_year" integer,
	"batch_code" varchar(80),
	"unit_scope" varchar(200),
	"status" "verification_status" DEFAULT 'pending' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"csrf_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"ip_hash" varchar(64),
	"user_agent_hash" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone_lookup_hash" varchar(64) NOT NULL,
	"phone_ciphertext" text NOT NULL,
	"phone_last4" varchar(4) NOT NULL,
	"display_name" varchar(120),
	"password_hash" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by_admin_id" uuid,
	"password_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "admin_sessions" ADD CONSTRAINT "admin_sessions_admin_id_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cities" ADD CONSTRAINT "cities_province_id_provinces_id_fk" FOREIGN KEY ("province_id") REFERENCES "public"."provinces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_province_id_provinces_id_fk" FOREIGN KEY ("province_id") REFERENCES "public"."provinces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_source_document_id_source_documents_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."source_documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_revisions" ADD CONSTRAINT "data_revisions_source_document_id_source_documents_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."source_documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_revisions" ADD CONSTRAINT "data_revisions_created_by_admin_id_admins_id_fk" FOREIGN KEY ("created_by_admin_id") REFERENCES "public"."admins"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruitment_batches" ADD CONSTRAINT "recruitment_batches_source_document_id_source_documents_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."source_documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruitment_events" ADD CONSTRAINT "recruitment_events_batch_id_recruitment_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."recruitment_batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruitment_events" ADD CONSTRAINT "recruitment_events_province_id_provinces_id_fk" FOREIGN KEY ("province_id") REFERENCES "public"."provinces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruitment_events" ADD CONSTRAINT "recruitment_events_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruitment_events" ADD CONSTRAINT "recruitment_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruitment_events" ADD CONSTRAINT "recruitment_events_source_document_id_source_documents_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."source_documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruitment_metrics" ADD CONSTRAINT "recruitment_metrics_batch_id_recruitment_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."recruitment_batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruitment_metrics" ADD CONSTRAINT "recruitment_metrics_province_id_provinces_id_fk" FOREIGN KEY ("province_id") REFERENCES "public"."provinces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruitment_metrics" ADD CONSTRAINT "recruitment_metrics_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruitment_metrics" ADD CONSTRAINT "recruitment_metrics_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruitment_metrics" ADD CONSTRAINT "recruitment_metrics_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruitment_metrics" ADD CONSTRAINT "recruitment_metrics_source_document_id_source_documents_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."source_documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schools" ADD CONSTRAINT "schools_province_id_provinces_id_fk" FOREIGN KEY ("province_id") REFERENCES "public"."provinces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schools" ADD CONSTRAINT "schools_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schools" ADD CONSTRAINT "schools_source_document_id_source_documents_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."source_documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_created_by_admin_id_admins_id_fk" FOREIGN KEY ("created_by_admin_id") REFERENCES "public"."admins"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "admin_sessions_token_uq" ON "admin_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "admin_sessions_admin_idx" ON "admin_sessions" USING btree ("admin_id");--> statement-breakpoint
CREATE INDEX "admin_sessions_expiry_idx" ON "admin_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "admins_username_uq" ON "admins" USING btree ("username");--> statement-breakpoint
CREATE INDEX "audit_events_created_idx" ON "audit_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_events_actor_idx" ON "audit_events" USING btree ("actor_type","actor_id");--> statement-breakpoint
CREATE INDEX "audit_events_resource_idx" ON "audit_events" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cities_adcode_uq" ON "cities" USING btree ("adcode");--> statement-breakpoint
CREATE INDEX "cities_province_idx" ON "cities" USING btree ("province_id");--> statement-breakpoint
CREATE UNIQUE INDEX "companies_key_uq" ON "companies" USING btree ("company_key");--> statement-breakpoint
CREATE INDEX "companies_parent_idx" ON "companies" USING btree ("parent_company_id");--> statement-breakpoint
CREATE INDEX "companies_location_idx" ON "companies" USING btree ("province_id","city_id");--> statement-breakpoint
CREATE UNIQUE INDEX "data_revisions_key_uq" ON "data_revisions" USING btree ("revision_key");--> statement-breakpoint
CREATE UNIQUE INDEX "provinces_adcode_uq" ON "provinces" USING btree ("adcode");--> statement-breakpoint
CREATE UNIQUE INDEX "recruitment_batches_year_code_scope_uq" ON "recruitment_batches" USING btree ("cohort_year","code","unit_scope");--> statement-breakpoint
CREATE INDEX "recruitment_events_year_batch_idx" ON "recruitment_events" USING btree ("cohort_year","batch_code");--> statement-breakpoint
CREATE INDEX "recruitment_events_location_idx" ON "recruitment_events" USING btree ("province_id","city_id");--> statement-breakpoint
CREATE INDEX "recruitment_metrics_year_batch_idx" ON "recruitment_metrics" USING btree ("cohort_year","batch_code");--> statement-breakpoint
CREATE INDEX "recruitment_metrics_dimensions_idx" ON "recruitment_metrics" USING btree ("province_id","city_id","school_id","company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "schools_key_uq" ON "schools" USING btree ("school_key");--> statement-breakpoint
CREATE INDEX "schools_location_idx" ON "schools" USING btree ("province_id","city_id");--> statement-breakpoint
CREATE INDEX "schools_year_batch_idx" ON "schools" USING btree ("cohort_year","batch_code");--> statement-breakpoint
CREATE UNIQUE INDEX "source_documents_key_uq" ON "source_documents" USING btree ("source_key");--> statement-breakpoint
CREATE INDEX "source_documents_year_batch_idx" ON "source_documents" USING btree ("cohort_year","batch_code");--> statement-breakpoint
CREATE UNIQUE INDEX "user_sessions_token_uq" ON "user_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "user_sessions_user_idx" ON "user_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_sessions_expiry_idx" ON "user_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_phone_lookup_uq" ON "users" USING btree ("phone_lookup_hash");--> statement-breakpoint
CREATE INDEX "users_enabled_idx" ON "users" USING btree ("enabled");