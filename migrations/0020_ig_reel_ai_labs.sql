-- Second IG Reel account `ai-labs` (Claude & ChatGPT tips), same four WIB slots as @kaliajatau.id.
-- Spec: docs/superpowers/specs/2026-11-15-ig-reel-multi-account-design.md
--
-- Rows ship DISABLED with a far-future next_run_at on purpose. Going live is a separate,
-- owner-approved step (docs/ig-reel-add-account.md): set next_run_at to the first future
-- slot in UTC at that moment, then enabled=1. A hard-coded date here would repeat the
-- day-late first run of migration 0019.
-- Existing ig-reel-daily* rows are not touched; they dispatch without `account` and the
-- workflow defaults to kaliajatau.

INSERT OR IGNORE INTO schedulers
(id, name, description, enabled, job_type, cron_expression, timezone, prompt, input_json, priority, next_run_at)
VALUES
('ig-reel-ai-labs', 'IG Reel ai-labs — AI tips (08:15 WIB)', 'First of 4 daily slots (08:15/11:45/16:35/19:30). Announcement when fresh, else a tip. Account ai-labs via Buffer.', 0, 'github_actions_trigger', '15 1 * * *', 'Asia/Jakarta',
 'GitHub Actions workflow .github/workflows/ig-reel.yml (account: scripts/ig_reel/accounts/ai-labs.json)',
 '{"owner":"hendra","repo":"cloudflare-ai-scheduler","workflow":"ig-reel.yml","ref":"main","inputs":{"dry_run":false,"account":"ai-labs"}}',
 5, '2099-01-01T00:00:00.000Z'),
('ig-reel-ai-labs-1145', 'IG Reel ai-labs — AI tips (11:45 WIB)', 'Second of 4 daily slots. Theme tip. Account ai-labs via Buffer.', 0, 'github_actions_trigger', '45 4 * * *', 'Asia/Jakarta',
 'GitHub Actions workflow .github/workflows/ig-reel.yml (account: scripts/ig_reel/accounts/ai-labs.json)',
 '{"owner":"hendra","repo":"cloudflare-ai-scheduler","workflow":"ig-reel.yml","ref":"main","inputs":{"dry_run":false,"account":"ai-labs"}}',
 5, '2099-01-01T00:00:00.000Z'),
('ig-reel-ai-labs-1635', 'IG Reel ai-labs — AI tips (16:35 WIB)', 'Third of 4 daily slots. Theme tip. Account ai-labs via Buffer.', 0, 'github_actions_trigger', '35 9 * * *', 'Asia/Jakarta',
 'GitHub Actions workflow .github/workflows/ig-reel.yml (account: scripts/ig_reel/accounts/ai-labs.json)',
 '{"owner":"hendra","repo":"cloudflare-ai-scheduler","workflow":"ig-reel.yml","ref":"main","inputs":{"dry_run":false,"account":"ai-labs"}}',
 5, '2099-01-01T00:00:00.000Z'),
('ig-reel-ai-labs-1930', 'IG Reel ai-labs — AI tips (19:30 WIB)', 'Fourth of 4 daily slots. Theme tip. Account ai-labs via Buffer.', 0, 'github_actions_trigger', '30 12 * * *', 'Asia/Jakarta',
 'GitHub Actions workflow .github/workflows/ig-reel.yml (account: scripts/ig_reel/accounts/ai-labs.json)',
 '{"owner":"hendra","repo":"cloudflare-ai-scheduler","workflow":"ig-reel.yml","ref":"main","inputs":{"dry_run":false,"account":"ai-labs"}}',
 5, '2099-01-01T00:00:00.000Z');
