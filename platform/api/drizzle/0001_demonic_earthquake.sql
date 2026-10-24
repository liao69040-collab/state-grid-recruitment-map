ALTER TABLE "cities" ALTER COLUMN "adcode" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "companies" ALTER COLUMN "status" SET DATA TYPE varchar(80) USING "status"::text;--> statement-breakpoint
ALTER TABLE "companies" ALTER COLUMN "status" SET DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE "data_revisions" ALTER COLUMN "data_status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "data_revisions" ALTER COLUMN "data_status" SET DATA TYPE varchar(80) USING "data_status"::text;--> statement-breakpoint
ALTER TABLE "data_revisions" ALTER COLUMN "data_status" SET DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE "recruitment_batches" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "recruitment_batches" ALTER COLUMN "status" SET DATA TYPE varchar(80) USING "status"::text;--> statement-breakpoint
ALTER TABLE "recruitment_batches" ALTER COLUMN "status" SET DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE "recruitment_events" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "recruitment_events" ALTER COLUMN "status" SET DATA TYPE varchar(80) USING "status"::text;--> statement-breakpoint
ALTER TABLE "recruitment_events" ALTER COLUMN "status" SET DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE "recruitment_metrics" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "recruitment_metrics" ALTER COLUMN "status" SET DATA TYPE varchar(80) USING "status"::text;--> statement-breakpoint
ALTER TABLE "recruitment_metrics" ALTER COLUMN "status" SET DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE "schools" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "schools" ALTER COLUMN "status" SET DATA TYPE varchar(80) USING "status"::text;--> statement-breakpoint
ALTER TABLE "schools" ALTER COLUMN "status" SET DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE "source_documents" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "source_documents" ALTER COLUMN "status" SET DATA TYPE varchar(80) USING "status"::text;--> statement-breakpoint
ALTER TABLE "source_documents" ALTER COLUMN "status" SET DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE "cities" ADD COLUMN "city_key" varchar(160);--> statement-breakpoint
ALTER TABLE "cities" ADD COLUMN "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "data_revisions" ADD COLUMN "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "provinces" ADD COLUMN "province_key" varchar(160);--> statement-breakpoint
ALTER TABLE "provinces" ADD COLUMN "map_clickable" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "provinces" ADD COLUMN "map_center" jsonb;--> statement-breakpoint
ALTER TABLE "provinces" ADD COLUMN "map_centroid" jsonb;--> statement-breakpoint
ALTER TABLE "provinces" ADD COLUMN "map_children_count" integer;--> statement-breakpoint
ALTER TABLE "provinces" ADD COLUMN "geometry_source_id" varchar(200);--> statement-breakpoint
ALTER TABLE "provinces" ADD COLUMN "business_data_status" varchar(100) DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "provinces" ADD COLUMN "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "recruitment_batches" ADD COLUMN "batch_key" varchar(160);--> statement-breakpoint
ALTER TABLE "recruitment_batches" ADD COLUMN "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "recruitment_events" ADD COLUMN "event_key" varchar(160);--> statement-breakpoint
ALTER TABLE "recruitment_events" ADD COLUMN "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "recruitment_metrics" ADD COLUMN "metric_key" varchar(160);--> statement-breakpoint
ALTER TABLE "recruitment_metrics" ADD COLUMN "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "schools" ADD COLUMN "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "source_documents" ADD COLUMN "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "cities_key_uq" ON "cities" USING btree ("city_key");--> statement-breakpoint
CREATE UNIQUE INDEX "provinces_key_uq" ON "provinces" USING btree ("province_key");--> statement-breakpoint
CREATE UNIQUE INDEX "recruitment_batches_key_uq" ON "recruitment_batches" USING btree ("batch_key");--> statement-breakpoint
CREATE UNIQUE INDEX "recruitment_events_key_uq" ON "recruitment_events" USING btree ("event_key");--> statement-breakpoint
CREATE UNIQUE INDEX "recruitment_metrics_key_uq" ON "recruitment_metrics" USING btree ("metric_key");--> statement-breakpoint
DROP TYPE "public"."verification_status";
