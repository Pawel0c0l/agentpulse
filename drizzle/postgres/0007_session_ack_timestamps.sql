-- Acknowledgement model (WAITING vs IDLE): two nullable server receive-time
-- timestamps on sessions. last_agent_turn_completed_at is stamped on Stop,
-- last_user_acknowledged_at on UserPromptSubmit and the synthetic
-- UserAcknowledge hook. Rows predating the columns stay NULL (clients treat
-- a legacy active, non-working row as WAITING until a real event stamps it).
-- IF NOT EXISTS mirrors migration 0003 so an operator who pre-added the
-- columns out-of-band does not fail the in-band migration.
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "last_agent_turn_completed_at" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "last_user_acknowledged_at" text;