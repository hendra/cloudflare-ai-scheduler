-- Daily GitHub Trending Top 10 -> Slack #news via GitHub Actions.
-- Disabled by default; set enabled=1 and next_run_at=<next 23:50 UTC ISO ts> only after manual verification.

INSERT OR IGNORE INTO schedulers
(id, name, description, enabled, job_type, cron_expression, timezone, prompt, input_json, priority, next_run_at)
VALUES
('github-trending-daily', 'GitHub Trending — Daily Top 10 → Slack #news', 'Dispatch GitHub Actions workflow github-trending.yml daily at 06:50 Asia/Jakarta (23:50 UTC previous day).', 0, 'github_actions_trigger', '50 23 * * *', 'Asia/Jakarta',
 'GitHub Actions workflow .github/workflows/github-trending.yml executing prompts/github-trending-daily.md',
 '{"owner":"hendra","repo":"cloudflare-ai-scheduler","workflow":"github-trending.yml","ref":"main","inputs":{}}',
 5, '2099-01-01T00:00:00.000Z');
