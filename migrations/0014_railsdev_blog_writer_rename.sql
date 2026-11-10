-- Rename the RailsDev blog writer scheduler row to match the renamed
-- workflow file and script.
-- The migration files 0008/0009 already ran; this migration only renames
-- the row and its input_json (workflow path). Do not re-order or edit
-- 0008/0009.

UPDATE schedulers
SET id = 'railsdev-blog-writer',
    name = 'RailsDev — Blog Writer (manual) → PR',
    description = 'Draft one SEO blog article and open a review PR on hendra/railsdev-site.',
    input_json = '{"owner":"hendra","repo":"cloudflare-ai-scheduler","workflow":"railsdev-blog-writer.yml","ref":"main","inputs":{"dry_run":false}}'
WHERE id = 'rails-blog-writer';
