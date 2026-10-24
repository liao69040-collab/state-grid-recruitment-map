ALTER TABLE "cities" ADD COLUMN "status" varchar(80) DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "provinces" ADD COLUMN "status" varchar(80) DEFAULT 'pending' NOT NULL;