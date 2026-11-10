-- GitHub Trending — Weekly Top 10 → Slack #news (every Monday 07:10 WIB = 00:10 UTC).
-- Deterministic github-trending pipeline with WEEKLY=true; previous Monday–Sunday in Asia/Jakarta.
-- Disabled by default; enable after a good dry run by setting enabled=1 and next_run_at to the next Monday 00:10 UTC.
INSERT OR IGNORE INTO schedulers
(id, name, description, enabled, job_type, cron_expression, timezone, prompt, input_json, priority, next_run_at)
VALUES
('github-trending-weekly', 'GitHub Trending — Top 10 of the Week → Slack #news', 'Weekly top-10 from the previous Monday–Sunday, split into two Slack messages, posted to #news.', 0, 'github_actions_trigger', '10 0 * * 1', 'Asia/Jakarta',
 'GitHub Actions workflow .github/workflows/github-trending-weekly.yml (spec: prompts/github-trending-weekly.md)',
 '{"owner":"hendra","repo":"cloudflare-ai-scheduler","workflow":"github-trending-weekly.yml","ref":"main","inputs":{"dry_run":false}}',
 9, '2099-01-01T00:00:00.000Z');
