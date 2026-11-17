# Content Deduplication & GitHub Trending Top 5 — Design

**Date:** 2026-11-18
**Status:** Draft (pending owner approval)

## Intent

Prevent duplicate content from being published across four automated pipelines so anything already published is never published again:

1. **Blog writers** (`railsdev-blog-writer.mjs`, `fullstackweb-blog-writer.mjs`, `inasoft-blog-writer.mjs`)
2. **IG Reels** (`ig_reel_daily.py` for all accounts: `kaliajatau`, `ai-labs`, and future accounts)
3. **INASOFT news digest** (`inasoft-news-digest.mjs`)
4. **Rails job search** (`rails-job-search.mjs`)

In the same change, update **GitHub Trending** (`github-trending-digest.mjs`, daily and weekly) from Top 10 to **Top 5**.

## Goals, Non-Goals, and Constraints

- **Goals:**
  - Hard-block already-published items in code **before** spending AI tokens or publishing, not merely as soft prompt hints.
  - When filtering leaves nothing new to publish (or fewer than 4 unseen stories for `inasoft-news-digest`), **skip cleanly** (exit `0`, post nothing to Slack/Buffer/GitHub, and do not trigger failure alerts).
  - Persist published history in D1 (`scheduler-db`) via the existing Cloudflare Worker so stateless GitHub Actions runners share reliable cross-run memory.
  - Keep destination-native checks (full site `.md` corpus + open PRs for blogs; Buffer `sent` + `scheduled` posts for IG Reels) as defense-in-depth for content published before this ledger existed.
  - Change `github-trending-digest.mjs` (daily & weekly) to fetch and summarize the Top 5 repositories.
- **Non-goals:**
  - No deduplication on `github-trending-digest.mjs` (daily and weekly remain true top-5 snapshots).
  - No changes to the three external Astro site repositories' `src/content/config.ts` schemas (generated blog `.md` frontmatter keys stay unchanged).
  - No retroactive scraping of Slack channel history (`channels:history` scope is not added).
- **Constraints:**
  - `DRY_RUN=true` runs read from the ledger to reflect real filtering, but **never** write to `published_items`.
  - In real runs (`DRY_RUN=false`), if `SCHEDULER_URL` and `MANUAL_RUN_TOKEN` are configured and `GET /api/published` fails, **fail closed** rather than proceeding with an empty blocklist (never silently risk double-publishing). If `SCHEDULER_URL` or `MANUAL_RUN_TOKEN` is missing in `DRY_RUN=false`, also fail closed so misconfigured secrets cannot bypass deduplication.
  - Once an article/post/Slack digest has already been published, a failure on `POST /api/published` logs a warning (`::warning::`) rather than failing the run and sending a false "pipeline failed" Slack alert.
  - Worker typecheck (`tsc --noEmit`) covers `src/**/*.ts`; new shared Node scripts get assert-based self-checks, and Python changes extend `scripts/ig_reel/selfcheck.py`.

## Approaches Considered

1. **Approach 1: D1 Ledger via Worker API + Destination Hardening *(Chosen)***
   - Add a `published_items` table to D1 (`migrations/0021_published_items.sql`) and two `MANUAL_RUN_TOKEN`-authenticated Worker routes (`GET /api/published`, `POST /api/published`).
   - Combine with full local corpus + open PR checks for blogs and Buffer `sent` + `scheduled` checks for IG Reels.
   - *Trade-off:* Requires one D1 migration (`npm run db:migrate:remote`), one Worker deploy (`npm run deploy`), and setting `vars.SCHEDULER_URL` + `secrets.MANUAL_RUN_TOKEN` in GitHub Actions. Gives a single, race-free source of truth without external Astro schema changes or Slack OAuth changes.
2. **Approach 2: Destination-Native Checks Only (GitHub / Buffer / Slack API)** — *Rejected.*
   - Requires adding `channels:history` and reinstalling the Slack app, relies on brittle mrkdwn parsing, and cannot track which HN/GitHub signal spawned a blog post without changing external Astro schemas.
3. **Approach 3: Git State Branch (`state` orphan branch in this repo)** — *Rejected.*
   - Concurrent scheduled jobs firing at the same minute (e.g., 2 IG Reel accounts + 3 blog writers at `:30` / `:15`) risk git push conflicts and add repo commit churn.

## Architecture & Design

### 1. D1 Schema (`migrations/0021_published_items.sql`)

```sql
CREATE TABLE IF NOT EXISTS published_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pipeline TEXT NOT NULL,
  item_key TEXT NOT NULL,
  title TEXT,
  url TEXT,
  meta_json TEXT,
  published_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(pipeline, item_key)
);

CREATE INDEX IF NOT EXISTS idx_published_pipeline_at
  ON published_items(pipeline, published_at DESC);
```

Pipeline identifiers:
- `blog:railsdev`, `blog:fullstackweb`, `blog:inasoft`
- `ig-reel:<account-id>` (e.g. `ig-reel:kaliajatau`, `ig-reel:ai-labs`)
- `inasoft-news`
- `rails-jobs`

### 2. Worker API (`src/index.ts`)

Both endpoints sit under `/api/*` and therefore automatically enforce the existing `isAuthorized(request, env)` constant-time bearer check (`MANUAL_RUN_TOKEN`).

- **`GET /api/published?pipeline=<id>&days=<n>&limit=<m>`**
  - `pipeline`: required non-empty string (`400` if missing).
  - `days`: optional positive integer (`1..3650`). When provided, filters `published_at >= datetime('now', '-' || ? || ' days')` (or ISO cutoff string computed in JS).
  - `limit`: optional positive integer (default `500`, clamped `1..1000`).
  - Response `200`: `{ pipeline, items: [{ id, item_key, title, url, meta_json, published_at }] }` ordered by `published_at DESC, id DESC`.
- **`POST /api/published`**
  - Body: `{ pipeline: string, items: Array<{ item_key: string, title?: string, url?: string, meta?: unknown }> }`.
  - Validates `pipeline` non-empty and `items` non-empty array (max 50 items per request; each `item_key` non-empty string). Returns `400` on invalid payload.
  - Inserts via `env.DB.batch(...)` using `INSERT OR IGNORE INTO published_items (pipeline, item_key, title, url, meta_json) VALUES (?, ?, ?, ?, ?)`, so duplicate/retry writes are idempotent.
  - Response `200`: `{ ok: true, pipeline, received: items.length, inserted }`.

### 3. Shared Normalization & Matching Helpers

Implemented in `scripts/published.mjs` (Node 20, zero-dep, with `scripts/published-selfcheck.mjs`) and mirrored for IG Reel in `scripts/ig_reel/story.py` (covered by `scripts/ig_reel/selfcheck.py`):

- **`canonicalUrl(rawUrl)`**:
  - Parses http(s) URL; returns `""` if unparseable or non-http(s).
  - Lowercases scheme and hostname.
  - Strips `#fragment`.
  - Removes tracking query parameters (`utm_*`, `ref`, `source`, `fbclid`, `gclid`, `igshid`, `mc_cid`, `mc_eid`), sorts remaining query params alphabetically.
  - Strips trailing `/` on pathname (except root `/`).
- **`normalizeTitle(text)` & `isSimilarTitle(a, b)`**:
  - Lowercases, strips punctuation/diacritics/HTML entities, collapses whitespace.
  - Extracts meaningful tokens (length ≥ 3, excluding tiny stopwords).
  - Matches if exact normalized strings are equal, OR Jaccard token similarity ≥ `0.65` with at least `3` shared meaningful tokens (or ≥ `0.75` for shorter 2-token titles).
- **`fetchPublished({ pipeline, days, limit, dryRun })` & `recordPublished({ pipeline, items, dryRun })`**:
  - Uses `SCHEDULER_URL` (trimmed, trailing slash stripped) + `MANUAL_RUN_TOKEN`.
  - Retries transient 5xx/network errors up to 2 times with short backoff.
  - In `dryRun`: if `SCHEDULER_URL` or `MANUAL_RUN_TOKEN` is unset, logs a note and returns `[]` on fetch; `recordPublished` is always a no-op in `dryRun`.
  - In real run (`!dryRun`): if `SCHEDULER_URL` or `MANUAL_RUN_TOKEN` is unset or `fetchPublished` fails, throws/exits via `fail(...)` so the run never proceeds blind. If `recordPublished` fails after publishing, logs `::warning::` and returns cleanly.

### 4. Per-Pipeline Deduplication Rules

#### A. Blog Writers (`railsdev-blog-writer.mjs`, `fullstackweb-blog-writer.mjs`, `inasoft-blog-writer.mjs`)
1. **Collect full local + remote history before calling AI:**
   - `loadCorpus(SITE_DIR)` reads **all** `.md` files in `src/content/blog/` and extracts `slug`, `title`, `keyword` (when present in frontmatter), and `seoTitle`.
   - Query open PRs on the target site repo (`gh pr list --state open --json headRefName,title --limit 50` using the site PAT when available; best-effort if `DRY_RUN=true` without PAT). Extract `blog/<slug>` branch slugs and PR titles as in-flight/already-covered items.
   - Call `fetchPublished({ pipeline: "blog:<site>", limit: 500 })` to get `item_key` (slug), `url` (source signal URL), `title`, and `meta_json` (`keyword`, `topic`).
2. **Pre-filter signals before topic selection:**
   - Remove any HN or GitHub Trending signal whose `canonicalUrl(s.url)` is in `publishedSignalUrls` OR whose `s.title` matches any title in `publishedTitles` via `isSimilarTitle`.
   - If `signals.length === 0`, log and **skip cleanly** (exit `0`, no PR, no Slack alert).
3. **Topic selection & hard code gate before body generation:**
   - Update `topicPrompt` to include `"signalIndex": <1..N>` (1-based index into `Signals:`) in the required JSON response.
   - Pass up to 150 recent titles/keywords in `Avoid all of these existing posts`.
   - In code, check the chosen topic against `publishedSlugs`, `publishedSignalUrls` (via `signalIndex`), `publishedTitles` (similarity against both `article.title` and `topic.topic`), and exact normalized `keyword` match against `publishedKeywords`.
   - If a collision is detected, retry topic selection (up to 3 total attempts, adding explicit feedback naming the collision and telling the AI to choose a different signal). If all attempts collide, **skip cleanly** (exit `0`).
4. **Record on publish:**
   - After PR creation (and merge attempt) in non-`DRY_RUN`, call `recordPublished` with:
     - `pipeline: "blog:<site>"`
     - `item_key: article.slug`
     - `title: article.title`
     - `url: chosenSignal?.url || ""`
     - `meta: { keyword: article.keyword, topic: topic.topic, pr }`

#### B. IG Reel (`scripts/ig_reel_daily.py`, `scripts/ig_reel/story.py`)
1. **Collect history (D1 + Buffer) before calling AI:**
   - Fetch `GET /api/published?pipeline=ig-reel:<account>&limit=500`.
   - Update `recent_post_captions()` in `ig_reel_daily.py` to query Buffer for `status: [sent, scheduled]` (instead of `sent` only). Parse any URLs inside `Sumber: ... (<url>)` lines from captions into `seen_urls`, and extract caption openers/hooks into `seen_hooks`.
   - Combine D1 items + Buffer items into `seen_urls`, `seen_titles`, and `seen_hooks` (for tips, keep `seen_tip_hooks` within the account's `dedupe_posts` window so themes can still cycle with fresh angles without repeating hooks/prompts).
2. **News mode (`kaliajatau`, and `ai-labs` morning slot):**
   - Filter `fetch_candidates()` in code before `pick_shortlist()`: drop any candidate whose `canonical_url(link)` is in `seen_urls` or whose `title` matches `seen_titles` via `is_similar_title`.
   - If no unseen candidates remain:
     - If `MODE == "auto"` and the account has `themes` (e.g. `ai-labs`): log and fall back to `tip` mode (existing behavior).
     - Otherwise (`kaliajatau` or `MODE=news`): **skip cleanly** (exit `0`, log `REPORT {"status":"skipped","reason":"all candidates already published"}`, do not upload to Cloudinary, post to Buffer, or notify Slack of failure).
   - Also reject a generated story in `find_news_story` if its `hook` matches `seen_hooks`, advancing to the next shortlisted ref.
3. **Tip mode (`ai-labs`):**
   - Include D1 recent tip hooks/topics + Buffer captions in the `avoid` block passed to `write_tip`.
   - In `write_tip` validation: reject if normalized `story["hook"]` matches any hook in `seen_tip_hooks` or if normalized `story["sample_prompt"]` matches any recent `sample_prompt` (triggers repair retry or next theme in `TIP_TRIES`). If all `TIP_TRIES` collide, **skip cleanly** (exit `0`, log `REPORT {"status":"skipped", ...}`).
4. **Record on publish:**
   - After `buffer_create_and_confirm` succeeds (non-`DRY_RUN`), call `POST /api/published` with:
     - News: `item_key = canonical_url(link)`, `url = link`, `title = story["hook"]`, `meta = { mode: "news", source, cand_title: cand["title"], post_id, reel }`.
     - Tip: `item_key = "tip:" + sha256(norm_hook)[:16]`, `title = story["hook"]`, `meta = { mode: "tip", tool: theme["tool"], topic: theme["topic"], sample_prompt: story["sample_prompt"], post_id, reel }`.

#### C. INASOFT News Digest (`scripts/inasoft-news-digest.mjs`)
1. Fetch `GET /api/published?pipeline=inasoft-news&days=60&limit=500`.
2. Dedupe fetched RSS/Atom candidates within the run itself (by `canonicalUrl` and `isSimilarTitle`), then filter out any candidate whose `canonicalUrl(url)` or `title` matches `published_items`.
3. If fewer than `4` unseen candidates remain, log and **skip cleanly** (exit `0`, post nothing to Slack).
4. After `postSlackParts` succeeds (non-`DRY_RUN` and `r.ok`), call `recordPublished` for the 4 published stories (`item_key: canonicalUrl(s.url)`, `title: s.headline`, `url: s.url`, `meta: { category: s.category, source: s.source }`).

#### D. Rails Job Search (`scripts/rails-job-search.mjs`)
1. Fetch `GET /api/published?pipeline=rails-jobs&days=45&limit=500` (covers the 30-day job freshness cutoff with margin).
2. After normalizing/deduping/freshness-filtering the 4 sources, drop any candidate whose `canonicalUrl(j.url)` OR `dedupeKey(j)` (`normalizedCompany|normalizedTitle`) appears in `published_items`.
3. If `candidates.length === 0`, log and **skip cleanly** (exit `0`, post nothing to Slack).
4. After `postSlackParts` succeeds (non-`DRY_RUN` and `r.ok`), call `recordPublished` for the **`shown`** jobs (the up-to-12 listings actually posted to `#jobs`), with `item_key: canonicalUrl(j.url) || "job:" + dedupeKey(j)`, `title: "${j.company} — ${j.title}"`, `url: j.url`, `meta: { dedupeKey: dedupeKey(j), source: j.source, tier: j.tier, score: j.score }`. (Jobs filtered out of `#jobs` as `notShown` are not recorded because they were not published.)

#### E. GitHub Trending Top 5 (`scripts/github-trending-digest.mjs`)
- Change `TOP_N = 5` across `collect()` (`repos.slice(0, 5)`), `collectFallback()` (`per_page=5`), `analyze()` prompt (`"For each of the 5 repositories below"`, `"exactly 5 items"`), digest labels (`"Top 5 Today"`, `"Top 5 of the Week"`), and Slack message splitting (`slice(0, Math.ceil(repos.length / 2))` if `full.length > 3500`, though 5 repos will normally fit in one message).
- Update workflow comments/descriptions in `.github/workflows/github-trending.yml` and `.github/workflows/github-trending-weekly.yml` to say Top 5.

### 5. GitHub Actions Workflows & Secrets

Pass two env vars to the six deduplicated workflows (`railsdev-blog-writer.yml`, `fullstackweb-blog-writer.yml`, `inasoft-blog-writer.yml`, `inasoft-news-digest.yml`, `rails-job-search.yml`, `ig-reel.yml`):
- `SCHEDULER_URL: ${{ vars.SCHEDULER_URL }}`
- `MANUAL_RUN_TOKEN: ${{ secrets.MANUAL_RUN_TOKEN }}`

Note: `ig-reel.yml` uses `environment: ig-${{ inputs.account || 'kaliajatau' }}`; repo-level `vars.SCHEDULER_URL` and `secrets.MANUAL_RUN_TOKEN` automatically apply to all environments unless overridden.

## Verification & Rollout

- **Automated checks:**
  - `npm run typecheck` (covers `src/index.ts` changes).
  - New `scripts/published-selfcheck.mjs` (wired into `npm run selfcheck` or `package.json`) testing URL canonicalization, title similarity, and dry-run/error semantics.
  - Extended `scripts/ig_reel/selfcheck.py` testing `canonical_url`, `is_similar_title`, tip hook/prompt duplicate rejection, and Buffer caption URL/hook extraction.
  - `AI_STUB=true DRY_RUN=true` runs on the Node scripts and `PLACEHOLDER_IMAGES=true DRY_RUN=true` on `ig_reel_daily.py`, plus `dry_run=true` GHA dispatches for all workflows (including `github-trending.yml` and `github-trending-weekly.yml` verifying Top 5 output).
- **Deploy sequence (must follow this order):**
  1. Apply D1 migration remotely: `npm run db:migrate:remote`
  2. Deploy Worker: `npm run typecheck && npm run deploy`
  3. Set GitHub Actions variable `SCHEDULER_URL` and secret `MANUAL_RUN_TOKEN` (verify `MANUAL_RUN_TOKEN` matches the Worker secret).
  4. Dispatch `dry_run=true` on each workflow to verify connectivity (`GET /api/published` returns `200`) and Top 5 output on GitHub Trending.

## Left to the Builder

- Exact helper module naming/layout within `scripts/` (e.g., `scripts/published.mjs` vs splitting helpers) and exact `docs/status.md` updates.
- Handling partial `shown` extraction in `rails-job-search.mjs` so `render()` returns both the rendered message and the `shown` array cleanly.
- Exact `INSERT OR IGNORE` row count reporting in `POST /api/published` (`meta.changes` sum across D1 batch results).
