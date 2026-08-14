ALTER TABLE "resources" ADD COLUMN "folder" varchar(120);--> statement-breakpoint
ALTER TABLE "resources" ADD COLUMN "tags" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "resources" ADD COLUMN "expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "resources" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE INDEX "resources_class_folder_idx" ON "resources" USING btree ("class_id","folder");--> statement-breakpoint
CREATE INDEX "resources_expires_at_idx" ON "resources" USING btree ("expires_at");