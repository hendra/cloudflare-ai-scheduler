-- Reproducible production state (verified against remote D1, 2026-11-12).
-- Brings every pipeline scheduler row to: enabled=1, job_type='github_actions_trigger',
-- cron_expression per the table below. Rows already exist via earlier migrations
-- (0004, 0005, 0007, 0008/0014, 0010, 0012, 0015, 0016, 0017) — this migration does NOT insert.
--
-- next_run_at strategy: set to a fixed past sentinel ('2026-01-01T00:00:00.000Z').
-- The schema declares next_run_at NOT NULL, so NULL is not an option. The dispatcher
-- (src/index.ts) skips runs whose scheduled time is more than 15 minutes in the past
-- and re-arms next_run_at to the next occurrence after "now", so on the first tick
-- after applying this migration the 18 rows are quietly re-armed to their correct
-- future fire times — no catch-up storm, and no dependence on hand-computed dates.
-- (Previously the rows carried 2099-01-01 / fixed 2026-11-10..11 values, which meant
-- they either never fired again or were permanently overdue.)
--
-- Idempotent: safe to re-run; only updates the 18 known ids.

UPDATE schedulers SET enabled=1, job_type='github_actions_trigger', cron_expression='45 0 * * *', next_run_at='2026-01-01T00:00:00.000Z' WHERE id='fullstackweb-blog-writer';
UPDATE schedulers SET enabled=1, job_type='github_actions_trigger', cron_expression='30 4 * * *', next_run_at='2026-01-01T00:00:00.000Z' WHERE id='fullstackweb-blog-writer-1130';
UPDATE schedulers SET enabled=1, job_type='github_actions_trigger', cron_expression='20 9 * * *', next_run_at='2026-01-01T00:00:00.000Z' WHERE id='fullstackweb-blog-writer-1620';
UPDATE schedulers SET enabled=1, job_type='github_actions_trigger', cron_expression='50 23 * * *', next_run_at='2026-01-01T00:00:00.000Z' WHERE id='github-trending-daily';
UPDATE schedulers SET enabled=1, job_type='github_actions_trigger', cron_expression='10 0 * * 1', next_run_at='2026-01-01T00:00:00.000Z' WHERE id='github-trending-weekly';
UPDATE schedulers SET enabled=1, job_type='github_actions_trigger', cron_expression='15 1 * * *', next_run_at='2026-01-01T00:00:00.000Z' WHERE id='ig-reel-daily';
UPDATE schedulers SET enabled=1, job_type='github_actions_trigger', cron_expression='45 4 * * *', next_run_at='2026-01-01T00:00:00.000Z' WHERE id='ig-reel-daily-1145';
UPDATE schedulers SET enabled=1, job_type='github_actions_trigger', cron_expression='35 9 * * *', next_run_at='2026-01-01T00:00:00.000Z' WHERE id='ig-reel-daily-1635';
UPDATE schedulers SET enabled=1, job_type='github_actions_trigger', cron_expression='30 12 * * *', next_run_at='2026-01-01T00:00:00.000Z' WHERE id='ig-reel-daily-1930';
UPDATE schedulers SET enabled=1, job_type='github_actions_trigger', cron_expression='45 0 * * *', next_run_at='2026-01-01T00:00:00.000Z' WHERE id='inasoft-blog-writer';
UPDATE schedulers SET enabled=1, job_type='github_actions_trigger', cron_expression='30 4 * * *', next_run_at='2026-01-01T00:00:00.000Z' WHERE id='inasoft-blog-writer-1130';
UPDATE schedulers SET enabled=1, job_type='github_actions_trigger', cron_expression='20 9 * * *', next_run_at='2026-01-01T00:00:00.000Z' WHERE id='inasoft-blog-writer-1620';
UPDATE schedulers SET enabled=1, job_type='github_actions_trigger', cron_expression='30 2 * * *', next_run_at='2026-01-01T00:00:00.000Z' WHERE id='inasoft-news-digest';
UPDATE schedulers SET enabled=1, job_type='github_actions_trigger', cron_expression='45 23 * * *', next_run_at='2026-01-01T00:00:00.000Z' WHERE id='rails-job-search-daily';
UPDATE schedulers SET enabled=1, job_type='github_actions_trigger', cron_expression='0 13 * * *', next_run_at='2026-01-01T00:00:00.000Z' WHERE id='rails-job-search-daily-2000';
UPDATE schedulers SET enabled=1, job_type='github_actions_trigger', cron_expression='45 0 * * *', next_run_at='2026-01-01T00:00:00.000Z' WHERE id='railsdev-blog-writer';
UPDATE schedulers SET enabled=1, job_type='github_actions_trigger', cron_expression='30 4 * * *', next_run_at='2026-01-01T00:00:00.000Z' WHERE id='railsdev-blog-writer-1130';
UPDATE schedulers SET enabled=1, job_type='github_actions_trigger', cron_expression='20 9 * * *', next_run_at='2026-01-01T00:00:00.000Z' WHERE id='railsdev-blog-writer-1620';
