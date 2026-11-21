ALTER TABLE "routes" ADD COLUMN "days" integer[] DEFAULT '{1,2,3,4,5,6}'::integer[] NOT NULL;--> statement-breakpoint
ALTER TABLE "routes" ADD COLUMN "path" jsonb;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "monthly_fee_paise" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_student_period_uq" ON "invoices" USING btree ("student_id","period_start");