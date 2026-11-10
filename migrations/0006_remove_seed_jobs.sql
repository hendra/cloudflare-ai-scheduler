-- Remove the starter seed jobs (0002_seed.sql) from databases that already
-- applied it. They were placeholders with enabled=0 and next_run_at=2099.
-- Child rows are removed first (FK on scheduler_id) before the parent rows.

DELETE FROM scheduler_executions WHERE scheduler_id IN (
  'daily-ai-digest', 'rails-trends', 'github-trending', 'remote-rails-jobs',
  'seo-weekly', 'content-research', 'ai-engineering-brief', 'railsdev-article-draft',
  'website-health', 'weekly-engineering-report'
);

DELETE FROM scheduler_locks WHERE scheduler_id IN (
  'daily-ai-digest', 'rails-trends', 'github-trending', 'remote-rails-jobs',
  'seo-weekly', 'content-research', 'ai-engineering-brief', 'railsdev-article-draft',
  'website-health', 'weekly-engineering-report'
);

DELETE FROM schedulers WHERE id IN (
  'daily-ai-digest', 'rails-trends', 'github-trending', 'remote-rails-jobs',
  'seo-weekly', 'content-research', 'ai-engineering-brief', 'railsdev-article-draft',
  'website-health', 'weekly-engineering-report'
);
