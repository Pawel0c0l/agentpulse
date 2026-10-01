ALTER TABLE "sessions" ADD COLUMN "last_agent_turn_completed_at" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "last_user_acknowledged_at" text;