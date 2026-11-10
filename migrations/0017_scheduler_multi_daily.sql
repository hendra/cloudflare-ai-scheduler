-- Multi-fire schedules (user directive, 2026-11-11):
--   fullstackweb-blog-writer, railsdev-blog-writer, inasoft-blog-writer → 07:45, 11:30, 16:20 WIB
--   ig-reel-daily                                            → 08:15, 11:45, 16:35, 19:30 WIB
--   rails-job-search-daily                                   → 06:45, 20:00 WIB
--
-- The repo's cron parser matches fields independently (lists OK) but cannot pair
-- (minute,hour) tuples, so each fire time is one D1 row. Base rows keep their ids;
-- new rows get `-<time>` suffixes, copy prompt/inputs/priority from their base row,
-- same workflow refs, inputs.dry_run=false (real dispatch).
--
-- Also fixes ig-reel-daily's input_json: it still held placeholder owner/repo and
-- inputs{} (which would have dispatched dry_run=true or failed). Set real values.

-- 0) fix ig-reel-daily input_json (owner/repo/dry_run)
UPDATE schedulers
SET input_json='{"owner":"hendra","repo":"cloudflare-ai-scheduler","workflow":"ig-reel.yml","ref":"main","inputs":{"dry_run":false}}'
WHERE id='ig-reel-daily';

-- 1) re-time the base rows (first post-change occurrence)
UPDATE schedulers SET cron_expression='45 0 * * *',  next_run_at='2026-11-11T00:45:00.000Z' WHERE id='railsdev-blog-writer';
UPDATE schedulers SET cron_expression='45 0 * * *',  next_run_at='2026-11-11T00:45:00.000Z' WHERE id='fullstackweb-blog-writer';
UPDATE schedulers SET cron_expression='45 0 * * *',  next_run_at='2026-11-11T00:45:00.000Z' WHERE id='inasoft-blog-writer';
UPDATE schedulers SET cron_expression='15 1 * * *',  next_run_at='2026-11-11T01:15:00.000Z' WHERE id='ig-reel-daily';
UPDATE schedulers SET cron_expression='45 23 * * *', next_run_at='2026-11-10T23:45:00.000Z' WHERE id='rails-job-search-daily';

-- 2) additional fire-time rows (enabled=1)
INSERT OR IGNORE INTO schedulers
(id, name, description, enabled, job_type, cron_expression, timezone, prompt, input_json, priority, next_run_at)
VALUES
('railsdev-blog-writer-1130', 'RailsDev.io blog writer (11:30 WIB)', 'Second of 3 daily slots (07:45/11:30/16:20). Draft PR on railsdev-site.', 1, 'github_actions_trigger', '30 4 * * *', 'Asia/Jakarta',
 'GitHub Actions workflow .github/workflows/railsdev-blog-writer.yml (spec: prompts/railsdev-blog.md)',
 '{"owner":"hendra","repo":"cloudflare-ai-scheduler","workflow":"railsdev-blog-writer.yml","ref":"main","inputs":{"dry_run":false}}',
 9, '2026-11-11T04:30:00.000Z'),
('railsdev-blog-writer-1620', 'RailsDev.io blog writer (16:20 WIB)', 'Third of 3 daily slots. Draft PR on railsdev-site.', 1, 'github_actions_trigger', '20 9 * * *', 'Asia/Jakarta',
 'GitHub Actions workflow .github/workflows/railsdev-blog-writer.yml (spec: prompts/railsdev-blog.md)',
 '{"owner":"hendra","repo":"cloudflare-ai-scheduler","workflow":"railsdev-blog-writer.yml","ref":"main","inputs":{"dry_run":false}}',
 9, '2026-11-11T09:20:00.000Z'),
('fullstackweb-blog-writer-1130', 'FullstackWeb.dev blog writer (11:30 WIB)', 'Second of 3 daily slots. Draft PR on fullstackwebdev-site.', 1, 'github_actions_trigger', '30 4 * * *', 'Asia/Jakarta',
 'GitHub Actions workflow .github/workflows/fullstackweb-blog-writer.yml (spec: prompts/fullstackweb-blog.md)',
 '{"owner":"hendra","repo":"cloudflare-ai-scheduler","workflow":"fullstackweb-blog-writer.yml","ref":"main","inputs":{"dry_run":false}}',
 9, '2026-11-11T04:30:00.000Z'),
('fullstackweb-blog-writer-1620', 'FullstackWeb.dev blog writer (16:20 WIB)', 'Third of 3 daily slots. Draft PR on fullstackwebdev-site.', 1, 'github_actions_trigger', '20 9 * * *', 'Asia/Jakarta',
 'GitHub Actions workflow .github/workflows/fullstackweb-blog-writer.yml (spec: prompts/fullstackweb-blog.md)',
 '{"owner":"hendra","repo":"cloudflare-ai-scheduler","workflow":"fullstackweb-blog-writer.yml","ref":"main","inputs":{"dry_run":false}}',
 9, '2026-11-11T09:20:00.000Z'),
('inasoft-blog-writer-1130', 'INASOFT blog writer (11:30 WIB)', 'Second of 3 daily slots. Bahasa Indonesia draft PR on inasoft-site.', 1, 'github_actions_trigger', '30 4 * * *', 'Asia/Jakarta',
 'GitHub Actions workflow .github/workflows/inasoft-blog-writer.yml (spec: prompts/inasoft-blog.md)',
 '{"owner":"hendra","repo":"cloudflare-ai-scheduler","workflow":"inasoft-blog-writer.yml","ref":"main","inputs":{"dry_run":false}}',
 9, '2026-11-11T04:30:00.000Z'),
('inasoft-blog-writer-1620', 'INASOFT blog writer (16:20 WIB)', 'Third of 3 daily slots. Bahasa Indonesia draft PR on inasoft-site.', 1, 'github_actions_trigger', '20 9 * * *', 'Asia/Jakarta',
 'GitHub Actions workflow .github/workflows/inasoft-blog-writer.yml (spec: prompts/inasoft-blog.md)',
 '{"owner":"hendra","repo":"cloudflare-ai-scheduler","workflow":"inasoft-blog-writer.yml","ref":"main","inputs":{"dry_run":false}}',
 9, '2026-11-11T09:20:00.000Z'),
('ig-reel-daily-1145', 'IG Reel — Interesting Facts (11:45 WIB)', 'Second of 4 daily slots (08:15/11:45/16:35/19:30). Instagram @kaliajatau.id via Buffer.', 1, 'github_actions_trigger', '45 4 * * *', 'Asia/Jakarta',
 'GitHub Actions workflow .github/workflows/ig-reel.yml (spec: prompts/ig-reel-daily.md)',
 '{"owner":"hendra","repo":"cloudflare-ai-scheduler","workflow":"ig-reel.yml","ref":"main","inputs":{"dry_run":false}}',
 5, '2026-11-11T04:45:00.000Z'),
('ig-reel-daily-1635', 'IG Reel — Interesting Facts (16:35 WIB)', 'Third of 4 daily slots (08:15/11:45/16:35/19:30). Instagram @kaliajatau.id via Buffer.', 1, 'github_actions_trigger', '35 9 * * *', 'Asia/Jakarta',
 'GitHub Actions workflow .github/workflows/ig-reel.yml (spec: prompts/ig-reel-daily.md)',
 '{"owner":"hendra","repo":"cloudflare-ai-scheduler","workflow":"ig-reel.yml","ref":"main","inputs":{"dry_run":false}}',
 5, '2026-11-11T09:35:00.000Z'),
('ig-reel-daily-1930', 'IG Reel — Interesting Facts (19:30 WIB)', 'Fourth of 4 daily slots (08:15/11:45/16:35/19:30). Instagram @kaliajatau.id via Buffer.', 1, 'github_actions_trigger', '30 12 * * *', 'Asia/Jakarta',
 'GitHub Actions workflow .github/workflows/ig-reel.yml (spec: prompts/ig-reel-daily.md)',
 '{"owner":"hendra","repo":"cloudflare-ai-scheduler","workflow":"ig-reel.yml","ref":"main","inputs":{"dry_run":false}}',
 5, '2026-11-11T12:30:00.000Z'),
('rails-job-search-daily-2000', 'Rails remote job search (20:00 WIB)', 'Second of 2 daily slots (06:45/20:00). Rails remote jobs digest → #jobs.', 1, 'github_actions_trigger', '0 13 * * *', 'Asia/Jakarta',
 'GitHub Actions workflow .github/workflows/rails-job-search.yml (spec: prompts/rails-job-search.md)',
 '{"owner":"hendra","repo":"cloudflare-ai-scheduler","workflow":"rails-job-search.yml","ref":"main","inputs":{}}',
 5, '2026-11-11T13:00:00.000Z');
