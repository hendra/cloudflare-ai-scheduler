-- Enable the inasoft-blog-writer scheduler for automatic daily dispatch.
-- The Cloudflare `github_actions_trigger` dispatcher passes
-- `inputs: { dry_run: false }` straight through to the workflow, which
-- produces one article PR per dispatch on hendra/inasoft-site.
-- Schedule: 02:00 UTC = 09:00 Asia/Jakarta (after the other writers).
UPDATE schedulers
SET enabled = 1,
    next_run_at = '2026-11-11T02:00:00.000Z',
    input_json = '{"owner":"hendra","repo":"cloudflare-ai-scheduler","workflow":"inasoft-blog-writer.yml","ref":"main","inputs":{"dry_run":false}}'
WHERE id = 'inasoft-blog-writer';
