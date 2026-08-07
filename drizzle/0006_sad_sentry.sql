CREATE TYPE "public"."resource_category" AS ENUM('lecture_notes', 'videos', 'practice', 'references', 'syllabus', 'other');--> statement-breakpoint
CREATE TABLE "resource_favorites" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "resource_favorites_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"resource_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resource_views" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "resource_views_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"resource_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"last_viewed_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resources" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "resources_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"class_id" integer NOT NULL,
	"owner_id" text NOT NULL,
	"title" varchar(200) NOT NULL,
	"description" text,
	"category" "resource_category" DEFAULT 'other' NOT NULL,
	"resource_url" text NOT NULL,
	"mime_type" varchar(120),
	"file_size_bytes" integer,
	"is_published" boolean DEFAULT true NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "resource_favorites" ADD CONSTRAINT "resource_favorites_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_favorites" ADD CONSTRAINT "resource_favorites_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_views" ADD CONSTRAINT "resource_views_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_views" ADD CONSTRAINT "resource_views_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resources" ADD CONSTRAINT "resources_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resources" ADD CONSTRAINT "resources_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "resource_favorites_resource_user_unique" ON "resource_favorites" USING btree ("resource_id","user_id");--> statement-breakpoint
CREATE INDEX "resource_favorites_user_id_idx" ON "resource_favorites" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "resource_views_resource_user_unique" ON "resource_views" USING btree ("resource_id","user_id");--> statement-breakpoint
CREATE INDEX "resource_views_user_viewed_idx" ON "resource_views" USING btree ("user_id","last_viewed_at");--> statement-breakpoint
CREATE INDEX "resources_class_id_idx" ON "resources" USING btree ("class_id");--> statement-breakpoint
CREATE INDEX "resources_owner_id_idx" ON "resources" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "resources_category_idx" ON "resources" USING btree ("category");--> statement-breakpoint
CREATE INDEX "resources_published_idx" ON "resources" USING btree ("is_published","is_archived");