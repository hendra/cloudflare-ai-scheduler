# RailsDev Blog Writer — Design (Pilot)

**Date:** 2026-11-11 · **Status:** Draft, pending approval · **Scope:** `railsdev-site` only (FullstackWeb.dev and INASOFT follow after this proves out) · **PR-only, no merge automation in v1.**

## Intent and why

The owner wants the Claude Scheduler SEO blog pipelines (`railsdev-blog.md`, `fullstackweb-blog.md`, `inasoft-blog.md`) migrated to the zero-spend Cloudflare/GitHub Actions stack, keeping each site's goal: research trending Rails/AI/dev content, write an SEO-optimized article, ship it. Manual-merges only in v1 — quality on free models will not match the existing hand-crafted posts, and brand trust + SEO is why nothing merges automatically.

## Goals / non-goals

Goals:
- One manual run → one **draft PR** on `hendra/railsdev-site` with a complete article + required cover, OR a Slack note saying why not.
- Everything `astro build` enforces is generated correctly the first time (schema, description 120–160, `seoTitle` ≤ 49, `keyword`, `cover`, `coverAlt`, `service` from the site's enum, `pubDate`).
- Topic uniqueness vs existing posts; sources cited; no invented benchmarks or version numbers (the article must carry an honest "verification note" where anything is unverified — same convention the site's posts already use).
- Zero spend; failures loud (Slack note), never silent empty PRs.

Non-goals (v1):
- Auto-merge; cron schedule (manual `workflow_dispatch` only — cadence is a quality-driven decision later).
- FullstackWeb.dev / INASOFT replication; image-generated covers via AI; social-media repurposing.
- Multi-language; the pipeline writes English like the rest of the site.

## Approach

Central workflow in `cloudflare-ai-scheduler` (same `workflow_dispatch` pattern as the digests): job checks out `hendra/railsdev-site` (shallow, `fetch-depth: 1`) using `RAILSDEV_PAT`, runs the pipeline, opens a PR. One workflow, one script, one place to maintain.

**Steps (single script `scripts/rails-blog-writer.mjs`, zero deps):**

1. **Signals (parallel, all tolerant):** Hacker News top stories (Algolia, ~30), GitHub Trending page (reuse the pilot's parser, top ~15), plus the Rails 8 release changelog page (fetch; failures skipped). Normalize to `{title, url, source, signals}`.
2. **Existing corpus:** fetch the list of current posts via the GitHub contents API (title + slug from frontmatter) — used to block duplicates.
3. **Topic selection** (1 AI completion): pick the best RailsDev.io angle + keyword from the signals, avoid all existing titles, return strict JSON `{topic, keyword, rationale, plannedSections}`.
4. **Article** (1 AI completion, JSON mode): returns `{title, seoTitle, description, keyword, slug, service, coverAlt, bodyMarkdown}`. Validation, all enforced in code (any failure → abort with a Slack note, no PR):
   - `description` 120–160 chars; `seoTitle` ≤ 49; `title` non-trivial; `keyword` present in title/desc/intro; `slug` kebab-case unique; `service` ∈ `contactServices` enum; `pubDate` = run date (+07:00).
   - `bodyMarkdown`: H1 absent (schema wants H1 only in title? site posts don't use H1 inside body — they use `##` sections; enforce: no `# ` at line starts; `##`/`###` only), required sections present (intro + ≥4 `##` sections, incl. "How this works" and "Pitfalls/Common mistakes"), all external links HEAD-checked (≤ 15 links; 4xx → link dropped or article aborted if > 2 dead), code fences balanced, ≥ 1,500 words, no placeholder tokens (`TODO`, `lorem`, `[insert`, `{placeholder}`), no invented numbers without `from <source>` attribution in nearby text (soft check: flag for the PR body, not a hard gate).
5. **Cover:** 1200×630 PNG generated with ImageMagick (preinstalled on `ubuntu-latest`): dark `#090d16` background, emerald→indigo gradient rule, big white `title` (wrapped), footer `railsdev.io · <service>`. Written to `src/assets/blog/<slug>.png`.
6. **Write file** `src/content/blog/<slug>.md` + cover; **verify** with `npm ci && npm run build` (= `astro check && astro build`); **only if build passes**: create branch `blog/<slug>`, commit, push, `gh pr create` (title `content: add <slug>`; body = metadata table + sources + validation checklist + "DO NOT MERGE without human review").
7. **Notify:** Slack #railsdev — one message: topic, PR link, build result, word count. Never posts the article body.

## Constraints / rules

- Zero spend (Groq free tier via the existing chain; falls back to CF-as-fallback).
- Astro build must pass — if it fails, no commit, Slack note with error excerpt.
- No auto-merge, ever, in v1. Branch protection on `main` may auto-require checks; irrelevant — PR stays open.
- Site `main` is never pushed to directly.
- AI never picks `pubDate`; never fabricates stats; uncertainty is written as an explicit "Verification note: …" blockquote (same convention as existing posts).
- Links in the article are either to the article's own sources (verified) or internal `/blog/...` links to existing posts (validated against corpus).

## Files

- `.github/workflows/rails-blog-writer.yml` (workflow_dispatch only in v1)
- `scripts/rails-blog-writer.mjs`
- reuses `scripts/github-trending-parser` logic inline (copy, not import)
- migration `0008_rails_blog_writer.sql`: `schedulers` row `rails-blog-writer`, `enabled=0`, cron placeholder `0 1 * * *` (manual use only in v1)

## Verification plan

1. Local `node scripts/rails-blog-writer.mjs` with `DRY_RUN=true` (+ `AI_STUB=true` offline) — signals fetched, topic picked, article validated against fixtures, cover rendered, message printed.
2. Workflow dispatch with `dry_run=true` — full run except git push/PR; build must pass; Slack note suppressed.
3. Live dispatch → PR opened, #railsdev notified; owner reviews/merges manually.
4. After ≥ 3 good merges, revisit enabling a schedule.

## Secrets (repo: cloudflare-ai-scheduler) — owner must create

- `RAILSDEV_PAT` — classic PAT, `repo` + `pull_requests: write` (or fine-grained: Contents RW, Pull requests RW on `railsdev-site` only).
- `SLACK_RAILSDEV_CHANNEL_ID` — already exists (used by other pipelines) — confirm bot in #railsdev.
- `SLACK_BOT_TOKEN` — exists.
- `GROQ_API_KEY` / `CF_*` — exist; provider chain identical to other pipelines.

## Known limitations

- Article quality is below the site's hand-written bar in v1 — expect edits before merge. That's deliberate.
- Topic selection via free models may miss nuance; expect to reject some iterations (abort, not bad articles).
- Covers are typographic diagrams, not illustrations — upgrading is a separate decision.
- Build uses the site's own lockfiles (`npm ci`) — requires network access to npm in CI (fine).
