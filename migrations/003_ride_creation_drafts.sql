CREATE TABLE IF NOT EXISTS ride_drafts (
  id BIGSERIAL PRIMARY KEY,
  owner_discord_id TEXT NOT NULL REFERENCES users(discord_id) ON DELETE CASCADE,
  source_template_id BIGINT REFERENCES ride_templates(id) ON DELETE SET NULL,
  source_ride_id BIGINT REFERENCES rides(id) ON DELETE SET NULL,
  published_ride_id BIGINT UNIQUE REFERENCES rides(id) ON DELETE SET NULL,
  discord_channel_id TEXT NOT NULL,
  title TEXT,
  description TEXT,
  ride_type TEXT CHECK (ride_type IS NULL OR ride_type IN ('social', 'intervals', 'endurance', 'race', 'outdoor')),
  starts_at TIMESTAMPTZ,
  duration_minutes INTEGER CHECK (duration_minutes IS NULL OR duration_minutes BETWEEN 15 AND 600),
  zwift_url TEXT,
  route_world TEXT,
  pace_workout TEXT,
  notes TEXT,
  extra_comment TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'publishing', 'published', 'cancelled', 'expired')),
  publication_error TEXT,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ride_drafts_owner_status_idx
  ON ride_drafts(owner_discord_id, status);
CREATE INDEX IF NOT EXISTS ride_drafts_expires_at_idx
  ON ride_drafts(expires_at)
  WHERE status = 'active';

ALTER TABLE rides ADD COLUMN IF NOT EXISTS creation_draft_id BIGINT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'rides_creation_draft_id_fkey'
      AND conrelid = 'rides'::regclass
  ) THEN
    ALTER TABLE rides
      ADD CONSTRAINT rides_creation_draft_id_fkey
      FOREIGN KEY (creation_draft_id) REFERENCES ride_drafts(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS rides_creation_draft_unique
  ON rides(creation_draft_id)
  WHERE creation_draft_id IS NOT NULL;
