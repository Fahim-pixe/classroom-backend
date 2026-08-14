CREATE TYPE "public"."attendance_correction_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "attendance_corrections" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "attendance_corrections_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"attendance_record_id" integer NOT NULL,
	"student_id" text NOT NULL,
	"requested_status" "attendance_status" NOT NULL,
	"reason" text NOT NULL,
	"status" "attendance_correction_status" DEFAULT 'pending' NOT NULL,
	"reviewer_id" text,
	"review_note" text,
	"reviewed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_attendance_record_id_attendance_records_id_fk" FOREIGN KEY ("attendance_record_id") REFERENCES "public"."attendance_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_student_id_user_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_reviewer_id_user_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attendance_corrections_record_id_idx" ON "attendance_corrections" USING btree ("attendance_record_id");--> statement-breakpoint
CREATE INDEX "attendance_corrections_student_status_idx" ON "attendance_corrections" USING btree ("student_id","status");--> statement-breakpoint
CREATE INDEX "attendance_corrections_status_created_idx" ON "attendance_corrections" USING btree ("status","created_at");