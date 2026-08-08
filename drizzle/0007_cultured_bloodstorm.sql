ALTER TABLE "assignments" ADD COLUMN "attachment_url" text;--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN "attachment_name" varchar(255);--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN "attachment_mime_type" varchar(120);--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN "attachment_size_bytes" integer;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "attachment_url" text;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "attachment_name" varchar(255);--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "attachment_mime_type" varchar(120);--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "attachment_size_bytes" integer;