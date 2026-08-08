CREATE TABLE IF NOT EXISTS users (
  discord_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rides (
  id BIGSERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  ride_type TEXT NOT NULL CHECK (ride_type IN ('social', 'intervals', 'endurance', 'race', 'outdoor')),
  starts_at TIMESTAMPTZ NOT NULL,
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes BETWEEN 15 AND 600),
  zwift_url TEXT,
  creator_discord_id TEXT NOT NULL REFERENCES users(discord_id),
  discord_channel_id TEXT NOT NULL,
  discord_event_id TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'cancelled', 'completed')),
  reminder_24h_sent BOOLEAN NOT NULL DEFAULT FALSE,
  reminder_30m_sent BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS rides_starts_at_idx ON rides(starts_at);
CREATE INDEX IF NOT EXISTS rides_status_idx ON rides(status);

CREATE TABLE IF NOT EXISTS ride_participants (
  ride_id BIGINT NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  discord_id TEXT NOT NULL REFERENCES users(discord_id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('going', 'maybe', 'declined')),
  attended_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (ride_id, discord_id)
);

CREATE TABLE IF NOT EXISTS strava_connections (
  discord_id TEXT PRIMARY KEY REFERENCES users(discord_id) ON DELETE CASCADE,
  athlete_id BIGINT NOT NULL UNIQUE,
  access_token_enc TEXT NOT NULL,
  refresh_token_enc TEXT NOT NULL,
  expires_at BIGINT NOT NULL,
  scope TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS activities (
  strava_activity_id BIGINT PRIMARY KEY,
  discord_id TEXT NOT NULL REFERENCES users(discord_id) ON DELETE CASCADE,
  ride_id BIGINT REFERENCES rides(id) ON DELETE SET NULL,
  sport_type TEXT NOT NULL,
  name TEXT,
  start_date TIMESTAMPTZ NOT NULL,
  distance_m DOUBLE PRECISION,
  moving_time_s INTEGER,
  elevation_m DOUBLE PRECISION,
  average_watts DOUBLE PRECISION,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS activities_discord_id_idx ON activities(discord_id);
CREATE INDEX IF NOT EXISTS activities_ride_id_idx ON activities(ride_id);
