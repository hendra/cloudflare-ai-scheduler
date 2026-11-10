-- Enable the fullstackweb-blog-writer scheduler for automatic daily dispatch.
-- The Cloudflare `github_actions_trigger` dispatcher passes
-- `inputs: { dry_run: false }` straight through to the workflow, which
-- produces one article PR per dispatch on hendra/fullstackwebdev-site.
UPDATE schedulers
SET enabled = 1,
    next_run_at = '2026-11-11T01:30:00.000Z',
    input_json = '{"owner":"hendra","repo":"cloudflare-ai-scheduler","workflow":"fullstackweb-blog-writer.yml","ref":"main","inputs":{"dry_run":false}}'
WHERE id = 'fullstackweb-blog-writer';
