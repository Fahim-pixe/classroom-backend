CREATE TYPE "public"."storage_asset_kind" AS ENUM('avatar', 'class_banner', 'resource', 'assignment_attachment', 'submission_attachment');--> statement-breakpoint
CREATE TYPE "public"."storage_asset_state" AS ENUM('pending', 'active', 'archived', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."storage_migration_status" AS ENUM('not_required', 'pending', 'in_progress', 'migrated', 'verified', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."storage_provider" AS ENUM('cloudinary', 'supabase');--> statement-breakpoint
CREATE TYPE "public"."storage_upload_intent_status" AS ENUM('pending', 'completed', 'expired', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."storage_verification_status" AS ENUM('pending', 'verified', 'failed');--> statement-breakpoint
CREATE TYPE "public"."storage_visibility" AS ENUM('private');--> statement-breakpoint
CREATE TABLE "storage_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_kind" "storage_asset_kind" NOT NULL,
	"entity_type" varchar(80) NOT NULL,
	"entity_id" text,
	"owner_id" text NOT NULL,
	"class_id" integer,
	"subject_id" integer,
	"storage_provider" "storage_provider" NOT NULL,
	"bucket" varchar(120),
	"object_path" text,
	"source_provider" "storage_provider",
	"source_identifier" text,
	"source_url" text,
	"file_name" varchar(255) NOT NULL,
	"mime_type" varchar(120),
	"file_size_bytes" integer,
	"checksum_sha256" varchar(64),
	"visibility" "storage_visibility" DEFAULT 'private' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"state" "storage_asset_state" DEFAULT 'pending' NOT NULL,
	"migration_status" "storage_migration_status" DEFAULT 'not_required' NOT NULL,
	"verification_status" "storage_verification_status" DEFAULT 'pending' NOT NULL,
	"verified_at" timestamp,
	"migration_attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"replaced_by_asset_id" uuid,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "storage_migration_events" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "storage_migration_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"asset_id" uuid,
	"event_name" varchar(120) NOT NULL,
	"severity" varchar(20) DEFAULT 'info' NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"details" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "storage_upload_intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_kind" "storage_asset_kind" NOT NULL,
	"owner_id" text NOT NULL,
	"class_id" integer,
	"entity_type" varchar(80) NOT NULL,
	"entity_id" text,
	"bucket" varchar(120) NOT NULL,
	"object_path" text NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"requested_mime_type" varchar(120) NOT NULL,
	"requested_file_size_bytes" integer NOT NULL,
	"status" "storage_upload_intent_status" DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"completed_asset_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "storage_upload_intents_object_path_unique" UNIQUE("object_path")
);
--> statement-breakpoint
CREATE TABLE "user_storage_assets" (
	"user_id" text PRIMARY KEY NOT NULL,
	"avatar_asset_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN "attachment_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "classes" ADD COLUMN "banner_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "resources" ADD COLUMN "storage_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "attachment_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "storage_assets" ADD CONSTRAINT "storage_assets_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_migration_events" ADD CONSTRAINT "storage_migration_events_asset_id_storage_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."storage_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_upload_intents" ADD CONSTRAINT "storage_upload_intents_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_upload_intents" ADD CONSTRAINT "storage_upload_intents_completed_asset_id_storage_assets_id_fk" FOREIGN KEY ("completed_asset_id") REFERENCES "public"."storage_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_storage_assets" ADD CONSTRAINT "user_storage_assets_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_storage_assets" ADD CONSTRAINT "user_storage_assets_avatar_asset_id_storage_assets_id_fk" FOREIGN KEY ("avatar_asset_id") REFERENCES "public"."storage_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "storage_assets_entity_idx" ON "storage_assets" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "storage_assets_class_idx" ON "storage_assets" USING btree ("class_id");--> statement-breakpoint
CREATE INDEX "storage_assets_owner_idx" ON "storage_assets" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "storage_assets_provider_path_unique" ON "storage_assets" USING btree ("storage_provider","bucket","object_path");--> statement-breakpoint
CREATE INDEX "storage_assets_migration_idx" ON "storage_assets" USING btree ("migration_status","verification_status");--> statement-breakpoint
CREATE INDEX "storage_migration_events_asset_event_idx" ON "storage_migration_events" USING btree ("asset_id","created_at");--> statement-breakpoint
CREATE INDEX "storage_migration_events_event_name_idx" ON "storage_migration_events" USING btree ("event_name");--> statement-breakpoint
CREATE INDEX "storage_upload_intents_owner_status_idx" ON "storage_upload_intents" USING btree ("owner_id","status");--> statement-breakpoint
CREATE INDEX "storage_upload_intents_expires_at_idx" ON "storage_upload_intents" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_attachment_asset_id_storage_assets_id_fk" FOREIGN KEY ("attachment_asset_id") REFERENCES "public"."storage_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classes" ADD CONSTRAINT "classes_banner_asset_id_storage_assets_id_fk" FOREIGN KEY ("banner_asset_id") REFERENCES "public"."storage_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resources" ADD CONSTRAINT "resources_storage_asset_id_storage_assets_id_fk" FOREIGN KEY ("storage_asset_id") REFERENCES "public"."storage_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_attachment_asset_id_storage_assets_id_fk" FOREIGN KEY ("attachment_asset_id") REFERENCES "public"."storage_assets"("id") ON DELETE set null ON UPDATE no action;