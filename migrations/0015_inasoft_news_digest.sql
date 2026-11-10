-- INASOFT technology & AI news digest, daily 09:30 WIB (02:30 UTC) after the blog writer (09:00).
-- Delivers a 4-story digest to the Slack #news channel.
INSERT OR IGNORE INTO schedulers
(id, name, description, enabled, job_type, cron_expression, timezone, prompt, input_json, priority, next_run_at)
VALUES
('inasoft-news-digest', 'INASOFT — Tech & AI News Digest → Slack #news', 'Daily digest of four high-quality AI/AI Engineering/Software Development/Technology stories, posted to Slack #news.', 0, 'github_actions_trigger', '30 2 * * *', 'Asia/Jakarta',
 'GitHub Actions workflow .github/workflows/inasoft-news-digest.yml (spec: prompts/inasoft-news-digest.md)',
 '{"owner":"hendra","repo":"cloudflare-ai-scheduler","workflow":"inasoft-news-digest.yml","ref":"main","inputs":{"dry_run":false}}',
 8, '2099-01-01T00:00:00.000Z');
