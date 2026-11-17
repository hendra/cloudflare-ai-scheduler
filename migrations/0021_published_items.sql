CREATE TABLE IF NOT EXISTS published_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pipeline TEXT NOT NULL,
  item_key TEXT NOT NULL,
  title TEXT,
  url TEXT,
  meta_json TEXT,
  published_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (pipeline, item_key)
);

CREATE INDEX IF NOT EXISTS idx_published_pipeline_at
  ON published_items(pipeline, published_at DESC);
