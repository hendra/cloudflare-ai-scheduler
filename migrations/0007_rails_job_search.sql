-- Daily Rails remote job search -> Slack #jobs via GitHub Actions.
-- Disabled by default; enable only after dry-run verification and owner go-ahead.

INSERT OR IGNORE INTO schedulers
(id, name, description, enabled, job_type, cron_expression, timezone, prompt, input_json, priority, next_run_at)
VALUES
('rails-job-search-daily', 'Rails — Remote Job Search (daily) → Slack #jobs', 'Dispatch GitHub Actions workflow rails-job-search.yml daily at 07:50 Asia/Jakarta (00:50 UTC).', 0, 'github_actions_trigger', '50 0 * * *', 'Asia/Jakarta',
 'GitHub Actions workflow .github/workflows/rails-job-search.yml executing scripts/rails-job-search.mjs (spec: prompts/rails-job-search.md)',
 '{"owner":"hendra","repo":"cloudflare-ai-scheduler","workflow":"rails-job-search.yml","ref":"main","inputs":{}}',
 5, '2099-01-01T00:00:00.000Z');
