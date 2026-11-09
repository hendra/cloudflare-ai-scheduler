PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schedulers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  job_type TEXT NOT NULL DEFAULT 'ai_prompt',
  cron_expression TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Asia/Jakarta',
  prompt TEXT NOT NULL,
  input_json TEXT NOT NULL DEFAULT '{}',
  model_preference TEXT NOT NULL DEFAULT 'automatic',
  priority INTEGER NOT NULL DEFAULT 100,
  max_retries INTEGER NOT NULL DEFAULT 2,
  next_run_at TEXT NOT NULL,
  last_run_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_schedulers_due
  ON schedulers(enabled, next_run_at, priority);

CREATE TABLE IF NOT EXISTS scheduler_executions (
  id TEXT PRIMARY KEY,
  scheduler_id TEXT NOT NULL,
  scheduled_for TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'skipped')),
  model TEXT,
  input_characters INTEGER NOT NULL DEFAULT 0,
  output_characters INTEGER NOT NULL DEFAULT 0,
  result_text TEXT,
  error_text TEXT,
  attempt INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (scheduler_id) REFERENCES schedulers(id),
  UNIQUE (scheduler_id, scheduled_for)
);

CREATE INDEX IF NOT EXISTS idx_executions_scheduler_created
  ON scheduler_executions(scheduler_id, created_at DESC);

CREATE TABLE IF NOT EXISTS daily_usage (
  usage_date TEXT PRIMARY KEY,
  ai_runs INTEGER NOT NULL DEFAULT 0,
  input_characters INTEGER NOT NULL DEFAULT 0,
  output_characters INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS scheduler_locks (
  scheduler_id TEXT PRIMARY KEY,
  execution_id TEXT NOT NULL,
  locked_until TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (scheduler_id) REFERENCES schedulers(id)
);
