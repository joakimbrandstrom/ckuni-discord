ALTER TABLE rides ADD COLUMN IF NOT EXISTS route_world TEXT;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS pace_workout TEXT;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS discord_message_id TEXT;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS template_id BIGINT;

CREATE TABLE IF NOT EXISTS ride_templates (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  ride_type TEXT NOT NULL CHECK (ride_type IN ('social', 'intervals', 'endurance', 'race', 'outdoor')),
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes BETWEEN 15 AND 600),
  route_world TEXT,
  pace_workout TEXT,
  notes TEXT,
  creator_discord_id TEXT NOT NULL REFERENCES users(discord_id),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (creator_discord_id, name)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'rides_template_id_fkey'
      AND conrelid = 'rides'::regclass
  ) THEN
    ALTER TABLE rides
      ADD CONSTRAINT rides_template_id_fkey
      FOREIGN KEY (template_id) REFERENCES ride_templates(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS rides_template_start_unique
  ON rides(template_id, starts_at)
  WHERE template_id IS NOT NULL AND status <> 'cancelled';
