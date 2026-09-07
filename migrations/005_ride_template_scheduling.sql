ALTER TABLE ride_templates ADD COLUMN IF NOT EXISTS default_weekday SMALLINT;
ALTER TABLE ride_templates ADD COLUMN IF NOT EXISTS default_start_time TIME WITHOUT TIME ZONE;
ALTER TABLE ride_templates ADD COLUMN IF NOT EXISTS quick_create BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE ride_templates ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

ALTER TABLE ride_templates
  ADD CONSTRAINT ride_templates_schedule_complete
  CHECK (
    (default_weekday IS NULL AND default_start_time IS NULL)
    OR (default_weekday BETWEEN 1 AND 7 AND default_start_time IS NOT NULL)
  );

ALTER TABLE ride_templates
  ADD CONSTRAINT ride_templates_sort_order_nonnegative
  CHECK (sort_order >= 0);

CREATE INDEX ride_templates_quick_create_order_idx
  ON ride_templates(sort_order, name)
  WHERE active = TRUE AND quick_create = TRUE;
