-- RailsDev blog writer pilot (manual workflow_dispatch in v1; cron is
-- placeholder until quality is proven by >= 3 good merges).
INSERT OR IGNORE INTO schedulers
(id, name, description, enabled, job_type, cron_expression, timezone, prompt, input_json, priority, next_run_at)
VALUES
('rails-blog-writer', 'RailsDev — Blog Writer (manual) → PR', 'Draft one SEO blog article and open a review PR on hendra/railsdev-site.', 0, 'github_actions_trigger', '0 1 * * *', 'Asia/Jakarta',
 'GitHub Actions workflow .github/workflows/rails-blog-writer.yml (spec: prompts/railsdev-blog.md)',
 '{"owner":"hendra","repo":"cloudflare-ai-scheduler","workflow":"rails-blog-writer.yml","ref":"main","inputs":{}}',
 9, '2099-01-01T00:00:00.000Z');
