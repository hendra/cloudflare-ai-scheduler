-- INASOFT blog writer pilot (manual workflow_dispatch in v1).
INSERT OR IGNORE INTO schedulers
(id, name, description, enabled, job_type, cron_expression, timezone, prompt, input_json, priority, next_run_at)
VALUES
('inasoft-blog-writer', 'INASOFT — Blog Writer (manual) → PR', 'Draft one SEO blog article (Bahasa Indonesia) and open a review PR on hendra/inasoft-site.', 0, 'github_actions_trigger', '0 2 * * *', 'Asia/Jakarta',
 'GitHub Actions workflow .github/workflows/inasoft-blog-writer.yml (spec: prompts/inasoft-blog.md)',
 '{"owner":"hendra","repo":"cloudflare-ai-scheduler","workflow":"inasoft-blog-writer.yml","ref":"main","inputs":{"dry_run":true}}',
 9, '2099-01-01T00:00:00.000Z');
