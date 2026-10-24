DROP INDEX "users_phone_lookup_uq";--> statement-breakpoint
CREATE UNIQUE INDEX "users_phone_lookup_uq" ON "users" USING btree ("phone_lookup_hash") WHERE "users"."deleted_at" is null;