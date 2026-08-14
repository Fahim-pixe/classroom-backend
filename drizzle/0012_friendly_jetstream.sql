CREATE TABLE "gradebook_categories" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "gradebook_categories_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"class_id" integer NOT NULL,
	"title" varchar(120) NOT NULL,
	"weight" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gradebook_entry_audits" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "gradebook_entry_audits_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"gradebook_entry_id" integer NOT NULL,
	"actor_id" text NOT NULL,
	"action" varchar(32) NOT NULL,
	"details" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gradebook_entries" ADD COLUMN "category_id" integer;--> statement-breakpoint
ALTER TABLE "gradebook_entries" ADD COLUMN "is_released" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "gradebook_entries" ADD COLUMN "released_at" timestamp;--> statement-breakpoint
ALTER TABLE "gradebook_categories" ADD CONSTRAINT "gradebook_categories_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gradebook_entry_audits" ADD CONSTRAINT "gradebook_entry_audits_gradebook_entry_id_gradebook_entries_id_fk" FOREIGN KEY ("gradebook_entry_id") REFERENCES "public"."gradebook_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gradebook_entry_audits" ADD CONSTRAINT "gradebook_entry_audits_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gradebook_categories_class_active_idx" ON "gradebook_categories" USING btree ("class_id","is_active");--> statement-breakpoint
CREATE INDEX "gradebook_entry_audits_entry_created_idx" ON "gradebook_entry_audits" USING btree ("gradebook_entry_id","created_at");--> statement-breakpoint
ALTER TABLE "gradebook_entries" ADD CONSTRAINT "gradebook_entries_category_id_gradebook_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."gradebook_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gradebook_entries_class_release_idx" ON "gradebook_entries" USING btree ("class_id","is_released");--> statement-breakpoint
CREATE INDEX "gradebook_entries_category_idx" ON "gradebook_entries" USING btree ("category_id");