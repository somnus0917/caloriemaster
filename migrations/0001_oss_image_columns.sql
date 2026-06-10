ALTER TABLE "food_records" ADD COLUMN "image_object_key" text;--> statement-breakpoint
ALTER TABLE "food_records" ADD COLUMN "image_mime_type" varchar(30);--> statement-breakpoint
ALTER TABLE "food_records" ADD COLUMN "image_size" integer;