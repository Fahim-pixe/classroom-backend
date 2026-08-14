ALTER TABLE "assignments" ADD COLUMN "rubric" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN "allow_resubmissions" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN "resubmission_deadline" timestamp;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "rubric_scores" jsonb DEFAULT '[]'::jsonb NOT NULL;