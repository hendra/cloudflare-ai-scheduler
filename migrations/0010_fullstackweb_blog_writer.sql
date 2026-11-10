-- FullstackWeb.dev blog writer pilot (manual workflow_dispatch in v1).
INSERT OR IGNORE INTO schedulers
(id, name, description, enabled, job_type, cron_expression, timezone, prompt, input_json, priority, next_run_at)
VALUES
('fullstackweb-blog-writer', 'FullstackWeb.dev — Blog Writer (manual) → PR', 'Draft one SEO blog article and open a review PR on hendra/fullstackwebdev-site.', 0, 'github_actions_trigger', '30 1 * * *', 'Asia/Jakarta',
 'GitHub Actions workflow .github/workflows/fullstackweb-blog-writer.yml (spec: prompts/fullstackweb-blog.md)',
 '{"owner":"hendra","repo":"cloudflare-ai-scheduler","workflow":"fullstackweb-blog-writer.yml","ref":"main","inputs":{"dry_run":false}}',
 9, '2099-01-01T00:00:00.000Z');
