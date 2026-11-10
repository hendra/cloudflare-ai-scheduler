-- Enable the rails-blog-writer scheduler for automatic daily dispatch.
-- This makes the Cloudflare dispatcher fire the rails-blog-writer.yml
-- workflow every day at 01:00 UTC (08:00 Asia/Jakarta).
-- The workflow itself never auto-merges; it opens one draft PR on
-- hendra/railsdev-site for human review.
UPDATE schedulers
SET enabled = 1,
    next_run_at = '2026-11-11T01:00:00.000Z',
    input_json = '{"owner":"hendra","repo":"cloudflare-ai-scheduler","workflow":"rails-blog-writer.yml","ref":"main","inputs":{"dry_run":false}}'
WHERE id = 'rails-blog-writer';
