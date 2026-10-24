CREATE TABLE "grid_map_catalogs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "dataset_version_id" uuid NOT NULL REFERENCES "grid_dataset_versions"("id"),
  "version" varchar(160) NOT NULL,
  "checksum_sha256" varchar(64) NOT NULL,
  "active" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "grid_map_catalog_version_uq" ON "grid_map_catalogs" ("dataset_version_id", "version");
--> statement-breakpoint
CREATE UNIQUE INDEX "grid_map_catalog_active_uq" ON "grid_map_catalogs" ("dataset_version_id") WHERE "active" = true;
