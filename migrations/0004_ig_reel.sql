-- Daily Instagram Reel trigger via GitHub Actions.
-- Disabled by default; review inputs and set next_run_at before enabling.

INSERT OR IGNORE INTO schedulers
(id, name, description, enabled, job_type, cron_expression, timezone, prompt, input_json, priority, next_run_at)
VALUES
('ig-reel-daily', 'Daily Instagram Reel (Interesting Facts)', 'Trigger GitHub Actions to build and post a Reel.', 0, 'github_actions_trigger', '15 10 * * *', 'Asia/Jakarta',
 'Trigger the ig-reel pipeline workflow.',
 '{"owner":"YOUR_GITHUB_OWNER","repo":"YOUR_PIPELINE_REPO","workflow":"ig-reel.yml","ref":"main","inputs":{}}',
 5, '2099-01-01T00:00:00.000Z');
