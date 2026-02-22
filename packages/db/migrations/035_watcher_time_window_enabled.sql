-- Optional time window: when true, watcher runs only between window_start_hour and window_end_hour
ALTER TABLE watcher_config
  ADD COLUMN IF NOT EXISTS time_window_enabled BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN watcher_config.time_window_enabled IS 'When true, watcher runs only within window_start_hour–window_end_hour; when false, runs 24/7';
