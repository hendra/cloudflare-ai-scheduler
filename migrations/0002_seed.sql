-- Example schedules only. Review and edit these before applying to production.
-- All times are interpreted in Asia/Jakarta. The scheduler computes next_run_at
-- in UTC. This starter supports standard 5-field cron expressions.

INSERT OR IGNORE INTO schedulers
(id, name, description, enabled, job_type, cron_expression, timezone, prompt, input_json, priority, next_run_at)
VALUES
('daily-ai-digest', 'Daily AI and technology digest', 'Summarize selected RSS feeds into a concise digest.', 0, 'rss_ai_digest', '0 1 * * *', 'Asia/Jakarta',
 'Summarize the supplied feed items. Group the most useful developments into AI, AI engineering, software development and technology. Cite each item using its source URL. Do not invent facts.',
 '{"feeds":["https://www.technologyreview.com/feed/","https://hnrss.org/frontpage"]}', 10, '2099-01-01T00:00:00.000Z'),

('rails-trends', 'Ruby on Rails trends', 'Research Rails ecosystem updates from RSS feeds.', 0, 'rss_ai_digest', '30 1 * * *', 'Asia/Jakarta',
 'Create a concise Ruby on Rails engineering update from the supplied feed items. Prioritize releases, security advisories, performance, gems and production practices. Include source URLs and dates. Do not invent details.',
 '{"feeds":["https://rubyonrails.org/feed.xml"]}', 20, '2099-01-01T00:00:00.000Z'),

('github-trending', 'GitHub trending digest', 'Summarize public GitHub repository activity from configured sources.', 0, 'ai_prompt', '0 2 * * *', 'Asia/Jakarta',
 'Prepare a GitHub trending research report. IMPORTANT: no web search tool is configured in this starter. Do not claim to have checked live trending data. Explain what data is missing unless repository data is supplied in input_json.',
 '{"repositories":[]}', 30, '2099-01-01T00:00:00.000Z'),

('remote-rails-jobs', 'Remote Rails jobs digest', 'Prepare a job-search report from supplied job listings.', 0, 'ai_prompt', '0 3 * * 1-5', 'Asia/Jakarta',
 'Summarize only the job listings supplied in the input. Include company, role, location, remote policy, date and application URL when available. Do not fabricate openings or URLs.',
 '{"job_listings":[]}', 30, '2099-01-01T00:00:00.000Z'),

('seo-weekly', 'Weekly SEO review', 'Analyze supplied SEO metrics and suggest actions.', 0, 'ai_prompt', '0 2 * * 1', 'Asia/Jakarta',
 'Analyze the SEO metrics supplied in the input. Separate observed metrics from hypotheses. Prioritize practical technical SEO and content recommendations. Do not claim to have accessed Search Console unless data is provided.',
 '{"site":"https://example.com","metrics":{}}', 40, '2099-01-01T00:00:00.000Z'),

('content-research', 'Daily content research', 'Generate content ideas from supplied source material.', 0, 'ai_prompt', '0 4 * * *', 'Asia/Jakarta',
 'Generate five original article ideas from the supplied source material. For each include audience, search intent, working title, outline and evidence needed. Do not present unverified claims as facts.',
 '{"sources":[],"topics":["Ruby on Rails","React","TypeScript","AI engineering"]}', 50, '2099-01-01T00:00:00.000Z'),

('ai-engineering-brief', 'AI engineering brief', 'Summarize supplied AI engineering materials.', 0, 'ai_prompt', '0 6 * * *', 'Asia/Jakarta',
 'Write a concise AI engineering briefing based only on supplied materials. Cover LLMs, RAG, agents, MCP, evaluation and deployment where relevant. Include source URLs from the input.',
 '{"sources":[]}', 50, '2099-01-01T00:00:00.000Z'),

('railsdev-article-draft', 'RailsDev article draft', 'Draft an article from a supplied topic and verified source pack.', 0, 'ai_prompt', '50 0,4,9 * * *', 'Asia/Jakarta',
 'Draft an original technical article in English using only the supplied topic and source pack. Mark gaps requiring verification. Include title, meta description, slug, outline, article and references. Do not invent benchmarks, APIs or citations.',
 '{"topic":"Replace with a researched topic","sources":[]}', 5, '2099-01-01T00:00:00.000Z'),

('website-health', 'Website health check', 'Check configured URLs for HTTP status and latency.', 0, 'http_check', '*/30 * * * *', 'Asia/Jakarta',
 'Report the supplied HTTP check results. Distinguish failed requests, non-2xx responses and slow responses.',
 '{"urls":["https://example.com"]}', 1, '2099-01-01T00:00:00.000Z'),

('weekly-engineering-report', 'Weekly engineering report', 'Summarize supplied engineering activity.', 0, 'ai_prompt', '0 9 * * 5', 'Asia/Jakarta',
 'Create a weekly engineering report from the supplied commits, pull requests and notes. Summarize delivery, risks, quality and next steps. Do not claim access to GitHub unless data is supplied.',
 '{"commits":[],"pull_requests":[],"notes":[]}', 60, '2099-01-01T00:00:00.000Z');

