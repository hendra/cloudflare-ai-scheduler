-- Blog writers 4x daily (user directive, 2026-11-15; spec: docs/superpowers/specs/2026-11-14-blog-writer-4x-daily-design.md):
--   railsdev-blog-writer, fullstackweb-blog-writer, inasoft-blog-writer → 07:30, 11:30, 16:30, 19:30 WIB
--
-- All four slots share minute :30, so one cron list per site covers them
-- (`30 0,4,9,12 * * *` UTC). The per-slot clone rows from 0017 (-1130, -1620)
-- are removed; their FK children (locks, executions) go first because
-- PRAGMA foreign_keys=ON rejects deleting a referenced schedulers row.

UPDATE schedulers SET cron_expression='30 0,4,9,12 * * *', next_run_at='2026-11-16T00:30:00.000Z',
  description='4 daily slots (07:30/11:30/16:30/19:30 WIB). Auto-merged PR on railsdev-site.'
WHERE id='railsdev-blog-writer';
UPDATE schedulers SET cron_expression='30 0,4,9,12 * * *', next_run_at='2026-11-16T00:30:00.000Z',
  description='4 daily slots (07:30/11:30/16:30/19:30 WIB). Auto-merged PR on fullstackwebdev-site.'
WHERE id='fullstackweb-blog-writer';
UPDATE schedulers SET cron_expression='30 0,4,9,12 * * *', next_run_at='2026-11-16T00:30:00.000Z',
  description='4 daily slots (07:30/11:30/16:30/19:30 WIB). Auto-merged Bahasa Indonesia PR on inasoft-site.'
WHERE id='inasoft-blog-writer';

DELETE FROM scheduler_locks WHERE scheduler_id IN (
  'railsdev-blog-writer-1130', 'railsdev-blog-writer-1620',
  'fullstackweb-blog-writer-1130', 'fullstackweb-blog-writer-1620',
  'inasoft-blog-writer-1130', 'inasoft-blog-writer-1620');
DELETE FROM scheduler_executions WHERE scheduler_id IN (
  'railsdev-blog-writer-1130', 'railsdev-blog-writer-1620',
  'fullstackweb-blog-writer-1130', 'fullstackweb-blog-writer-1620',
  'inasoft-blog-writer-1130', 'inasoft-blog-writer-1620');
DELETE FROM schedulers WHERE id IN (
  'railsdev-blog-writer-1130', 'railsdev-blog-writer-1620',
  'fullstackweb-blog-writer-1130', 'fullstackweb-blog-writer-1620',
  'inasoft-blog-writer-1130', 'inasoft-blog-writer-1620');
