-- hendranicholas.com blog writer (4 daily slots: 07:30, 11:30, 16:30, 19:30 WIB).
--
-- Row ships DISABLED with a far-future next_run_at on purpose (0020 pattern). Going live
-- is a separate manual step after PAT/secrets/dry-run verification: set next_run_at to
-- the next :30 slot in UTC and enabled=1.

INSERT OR IGNORE INTO schedulers
(id, name, description, enabled, job_type, cron_expression, timezone, prompt, input_json, priority, next_run_at)
VALUES
('hendranicholas-blog-writer', 'hendranicholas.com — Blog Writer (4× daily) → PR', '4 daily slots (07:30/11:30/16:30/19:30 WIB). Auto-merged PR on hendranicholas-site.', 0, 'github_actions_trigger', '30 0,4,9,12 * * *', 'Asia/Jakarta',
 'GitHub Actions workflow .github/workflows/hendranicholas-blog-writer.yml',
 '{"owner":"hendra","repo":"cloudflare-ai-scheduler","workflow":"hendranicholas-blog-writer.yml","ref":"main","inputs":{"dry_run":false}}',
 9, '2099-01-01T00:00:00.000Z');
