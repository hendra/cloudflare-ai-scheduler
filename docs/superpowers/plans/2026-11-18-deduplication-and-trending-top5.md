# Content Deduplication & GitHub Trending Top 5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Guarantee zero duplicate publications across blog articles, IG Reels, `inasoft-news-digest`, and `rails-job-search` using a D1 ledger + destination hardening, and change `github-trending-digest` (daily & weekly) to Top 5.

**Architecture:** A new `published_items` table in D1 (`scheduler-db`) exposed via `GET /api/published` and `POST /api/published` on the Cloudflare Worker gives all stateless GitHub Actions pipelines shared cross-run memory. Each pipeline filters out seen URLs, keys, slugs, and near-duplicate titles in code before calling AI, skips cleanly (`exit 0`, posts nothing) when nothing new remains, and records published items after a real publish succeeds.

**Tech Stack:** Cloudflare Workers (TypeScript), Cloudflare D1 (SQLite), Node 20 (zero-dependency ESM `.mjs`), Python 3.11 (stdlib), GitHub Actions YAML.

**Spec:** `docs/superpowers/specs/2026-11-18-deduplication-and-trending-top5-design.md`

## Global Constraints

- Never commit directly to `main`; work in a feature branch and open a PR. Scan for conflict markers (`git grep -n -E '^(<<<<<<< |>>>>>>> )' -- .`) before committing.
- `github-trending-digest.mjs` stays snapshot-based with **no** deduplication; only its repo count changes from `10` to `5`.
- Do not add new keys to generated blog `.md` frontmatter (external Astro schemas in `railsdev-site`, `fullstackwebdev-site`, `inasoft-site` are strict).
- `DRY_RUN=true` reads from `/api/published` (falling back to `[]` if `SCHEDULER_URL` or `MANUAL_RUN_TOKEN` is unset) and **never** calls `POST /api/published`.
- `DRY_RUN=false` **fails closed** if `SCHEDULER_URL` or `MANUAL_RUN_TOKEN` is missing or if `GET /api/published` fails after retries; if `POST /api/published` fails *after* content was already published, log `::warning::` and exit `0`.
- When all candidates are filtered out (or `< 4` unseen stories remain for `inasoft-news-digest`), **skip cleanly**: exit `0`, post nothing to Slack/Buffer/PR, do not write `failure-posted`.
- Worker typecheck (`npm run typecheck`) covers `src/**/*.ts` only; Node helpers use assert-based `*-selfcheck.mjs`, Python changes extend `scripts/ig_reel/selfcheck.py`.

## Review Focus

- URL with tracking params/hash/trailing slash (`https://Example.com/post/?utm_source=hn&b=2&a=1#sec` vs `https://example.com/post/?a=1&b=2`) must produce the exact same `item_key` in both Node (`canonicalUrl`) and Python (`canonical_url`).
- Real run (`DRY_RUN=false`) with missing `SCHEDULER_URL`/`MANUAL_RUN_TOKEN` or unreachable `GET /api/published` must fail closed before calling AI or publishing; `DRY_RUN=true` without those env vars logs and continues with `[]`.
- `POST /api/published` returning HTTP 500 after Slack/PR/Buffer already succeeded must not exit 1 or trigger a false Slack failure alert.
- `ai-labs` IG Reel tip mode: duplicate check blocks matching hooks and `sample_prompt`s within `dedupe_posts` without permanently banning the 27 rotating themes.
- `rails-job-search`: when 15 candidates are scored and 12 are `shown` while 3 are `notShown`, only the 12 `shown` jobs are recorded in `published_items`.

---

### Task 1: D1 `published_items` migration & Worker `/api/published` endpoints

**Files:**
- Create: `migrations/0021_published_items.sql`
- Modify: `src/index.ts` (inside `fetch`, under the `/api/*` `isAuthorized` guard)

**Interfaces:**
- Produces HTTP API (Bearer `MANUAL_RUN_TOKEN`):
  - `GET /api/published?pipeline=<id>&days=<n>&limit=<m>` → `200 { pipeline: string, items: Array<{ id: number, item_key: string, title: string | null, url: string | null, meta_json: string | null, published_at: string }> }`
  - `POST /api/published` with JSON `{ pipeline: string, items: Array<{ item_key: string, title?: string, url?: string, meta?: unknown }> }` (1..50 items) → `200 { ok: true, pipeline: string, received: number, inserted: number }`

- [ ] **Step 1: Create `migrations/0021_published_items.sql`**
  - Define `published_items` (`id INTEGER PRIMARY KEY AUTOINCREMENT`, `pipeline TEXT NOT NULL`, `item_key TEXT NOT NULL`, `title TEXT`, `url TEXT`, `meta_json TEXT`, `published_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`, `UNIQUE(pipeline, item_key)`) and `idx_published_pipeline_at ON published_items(pipeline, published_at DESC)`.

- [ ] **Step 2: Implement `GET /api/published` and `POST /api/published` in `src/index.ts`**
  - Place both routes after the existing `if (url.pathname.startsWith("/api/") && !isAuthorized(request, env))` gate in `fetch()`.
  - `GET /api/published`: require non-empty `pipeline` query param (`400` if missing); parse optional `days` (`1..3650`, compute ISO cutoff `new Date(Date.now() - days * 86400_000).toISOString()` and filter `published_at >= ?`); parse optional `limit` (default `500`, clamped `1..1000`); query `ORDER BY published_at DESC, id DESC LIMIT ?`.
  - `POST /api/published`: parse JSON body (`400` on invalid JSON); validate non-empty `pipeline` string and non-empty `items` array (`1..50`) where each entry has non-empty `item_key` string (`400` otherwise); prepare `INSERT OR IGNORE INTO published_items (pipeline, item_key, title, url, meta_json) VALUES (?, ?, ?, ?, ?)` with `JSON.stringify(item.meta)` when `item.meta !== undefined`, run via `env.DB.batch(stmts)`, sum `r.meta?.changes ?? 0` as `inserted`, return `json({ ok: true, pipeline, received: items.length, inserted })`.

- [ ] **Step 3: Verify migration + typecheck**
  - Run `npm run typecheck` — expected: exit 0, no TS errors.
  - Run `npm run db:migrate:local` — expected: `0021_published_items.sql` applies cleanly.
  - Verify table exists locally: `npx wrangler d1 execute scheduler-db --local --command "SELECT name FROM sqlite_master WHERE type='table' AND name='published_items'"` — expected: `published_items` row returned.

- [ ] **Step 4: Commit**
  - `git add migrations/0021_published_items.sql src/index.ts`
  - `git commit -m "feat(worker): add published_items ledger table and /api/published routes"`

---

### Task 2: Shared Node ledger & deduplication helpers (`scripts/published.mjs`)

**Files:**
- Create: `scripts/published.mjs`
- Create: `scripts/published-selfcheck.mjs`
- Modify: `package.json` (`scripts` entry `"published:selfcheck": "node scripts/published-selfcheck.mjs"`)

**Interfaces:**
- Consumes: Task 1 Worker endpoints (`GET /api/published`, `POST /api/published`).
- Produces (`scripts/published.mjs`):
  - `canonicalUrl(rawUrl: string): string`
  - `normalizeTitle(text: string): string`
  - `isSimilarTitle(a: string, b: string): boolean`
  - `buildPublishedIndex(rows: Array<{ item_key: string, title?: string, url?: string, meta_json?: string }>): { keys: Set<string>, urls: Set<string>, titles: string[], metaList: object[] }`
  - `fetchPublished({ pipeline, days, limit, dryRun }): Promise<Array<object>>`
  - `recordPublished({ pipeline, items, dryRun }): Promise<{ ok: boolean, inserted: number }>`

- [ ] **Step 1: Write failing self-check `scripts/published-selfcheck.mjs`**
  - Assert `canonicalUrl("https://Example.com/post/?utm_source=hn&b=2&a=1#top") === "https://example.com/post?a=1&b=2"`.
  - Assert `canonicalUrl("https://example.com/") === "https://example.com/"` and `canonicalUrl("javascript:alert(1)") === ""`.
  - Assert `isSimilarTitle("Introducing OpenAI GPT-5 for Developers", "OpenAI introduces GPT-5 for developers!") === true` and `isSimilarTitle("Ruby on Rails 8 Release Notes", "PostgreSQL Vacuum Tuning Guide") === false`.
  - Assert `buildPublishedIndex([{ item_key: "slug-1", title: "Alpha Post", url: "https://ex.com/a?utm_medium=rss", meta_json: '{"keyword":"alpha"}' }])` populates `keys.has("slug-1")`, `urls.has("https://ex.com/a")`, `titles.includes("Alpha Post")`, and `metaList[0].keyword === "alpha"`.
  - Assert `fetchPublished({ pipeline: "inasoft-news", dryRun: true })` (with `SCHEDULER_URL` deleted) resolves to `[]`, whereas `fetchPublished({ pipeline: "inasoft-news", dryRun: false })` rejects with an Error mentioning `SCHEDULER_URL`.
  - Assert `recordPublished({ pipeline: "inasoft-news", items: [{ item_key: "x" }], dryRun: true })` resolves to `{ ok: true, inserted: 0 }` without calling `fetch`.
  - Assert `recordPublished` with mocked `fetch` returning HTTP 500 in `dryRun: false` resolves to `{ ok: false, inserted: 0 }` without throwing.

- [ ] **Step 2: Run self-check to confirm it fails**
  - Run: `node scripts/published-selfcheck.mjs`
  - Expected: FAIL (`ERR_MODULE_NOT_FOUND` for `./published.mjs`).

- [ ] **Step 3: Implement `scripts/published.mjs` and wire `package.json`**
  - Implement `canonicalUrl`, `normalizeTitle`, `isSimilarTitle` (Jaccard ≥ 0.65 with ≥ 3 shared tokens ≥ 3 chars, or ≥ 0.75 for 2-token titles, plus exact normalized equality), `buildPublishedIndex`, `fetchPublished` (retries transient 5xx/network up to 2× with 1s/2s delay; throws on `!dryRun` if env missing or fetch fails), and `recordPublished` (no-op in `dryRun`, chunks in batches of ≤ 50, logs `::warning::` on failure instead of throwing).
  - Add `"published:selfcheck": "node scripts/published-selfcheck.mjs"` to `package.json`.

- [ ] **Step 4: Run self-checks**
  - Run: `npm run published:selfcheck && npm run selfcheck`
  - Expected: `published self-check: ok` and `ai-providers self-check: ok`.

- [ ] **Step 5: Commit**
  - `git add scripts/published.mjs scripts/published-selfcheck.mjs package.json`
  - `git commit -m "feat(scripts): add shared published ledger client and URL/title deduplication helpers"`

---

### Task 3: Deduplicate `inasoft-news-digest.mjs` & `rails-job-search.mjs`

**Files:**
- Modify: `scripts/inasoft-news-digest.mjs`
- Modify: `scripts/rails-job-search.mjs`
- Modify: `scripts/published-selfcheck.mjs` (add assertions for job-shown filtering and digest minimum-4 skip condition)

**Interfaces:**
- Consumes: `canonicalUrl`, `isSimilarTitle`, `buildPublishedIndex`, `fetchPublished`, `recordPublished` from `./published.mjs`.

- [ ] **Step 1: Add unit assertions to `scripts/published-selfcheck.mjs` and run**
  - Export/test pure filter helpers or test `canonicalUrl`/`dedupeKey` collision logic for jobs (matching URL OR matching `company|title` key) and news (matching URL OR similar title), verifying `DRY_RUN=true` runs cleanly.
  - Run `node scripts/published-selfcheck.mjs` (fails until helper/logic added if any new helper exported, or add pure `filterUnseenNews` / `filterUnseenJobs` helpers in `scripts/published.mjs` so both scripts and selfcheck test them directly!).
  - Note: Adding `filterUnseenCandidates(items, index, { getUrl, getTitle, getKey })` to `scripts/published.mjs` keeps the filter logic DRY and directly assert-tested in `published-selfcheck.mjs`. Add failing asserts for `filterUnseenCandidates` first, run `npm run published:selfcheck` to see it fail, then implement in `scripts/published.mjs`.

- [ ] **Step 2: Update `scripts/inasoft-news-digest.mjs`**
  - Fetch ledger via `fetchPublished({ pipeline: "inasoft-news", days: 60, limit: 500, dryRun: DRY_RUN })` (call `await fail(...)` if `fetchPublished` throws in real run).
  - Dedupe `all` within the run itself (same canonical URL or similar title across sources), then filter out items matching `publishedIndex` via `filterUnseenCandidates`.
  - If `unseen.length < 4`: log `skipping: only ${unseen.length} unseen items (need 4)` and `process.exit(0)` cleanly (post nothing to Slack).
  - Pass `unseen` (not `all`) to AI selection and ref grounding.
  - After `postSlackParts` succeeds (`!DRY_RUN && r.ok`), call `await recordPublished({ pipeline: "inasoft-news", dryRun: DRY_RUN, items: ordered.map(s => ({ item_key: canonicalUrl(s.url) || s.url, title: s.headline, url: s.url, meta: { category: s.category, source: s.source } })) })`.

- [ ] **Step 3: Update `scripts/rails-job-search.mjs`**
  - Fetch ledger via `fetchPublished({ pipeline: "rails-jobs", days: 45, limit: 500, dryRun: DRY_RUN })` (call `await fail(...)` if it throws in real run).
  - Build `seenKeys` from `index.keys` and `index.metaList.map(m => m.dedupeKey).filter(Boolean)`.
  - After `deduped` + `FRESH` filtering, filter out jobs whose `canonicalUrl(j.url)` is in `index.urls` OR `dedupeKey(j)` is in `seenKeys`.
  - If `candidates.length === 0`: log `skipping: no new fresh candidates (all already published)` and return cleanly (`exit 0`, post nothing).
  - Update `render()` to return `{ text, shown }` (where `shown` is the ≤12 posted jobs).
  - After `postSlackParts` succeeds (`!DRY_RUN && r.ok`), call `await recordPublished({ pipeline: "rails-jobs", dryRun: DRY_RUN, items: shown.map(j => ({ item_key: canonicalUrl(j.url) || `job:${dedupeKey(j)}`, title: `${j.company} — ${j.title}`, url: j.url, meta: { dedupeKey: dedupeKey(j), source: j.source, tier: j.tier, score: j.score } })) })`.

- [ ] **Step 4: Verify**
  - Run `npm run published:selfcheck` — expected: `published self-check: ok`.
  - Run `DRY_RUN=true AI_STUB=true node scripts/rails-job-search.mjs` — expected: exit 0, prints digest (or clean skip if feeds empty), no errors.
  - Run `node --check scripts/inasoft-news-digest.mjs && node --check scripts/rails-job-search.mjs` — expected: exit 0.

- [ ] **Step 5: Commit**
  - `git add scripts/published.mjs scripts/published-selfcheck.mjs scripts/inasoft-news-digest.mjs scripts/rails-job-search.mjs`
  - `git commit -m "feat(pipelines): deduplicate inasoft-news-digest and rails-job-search via D1 ledger"`

---

### Task 4: Harden & deduplicate the three blog writers

**Files:**
- Modify: `scripts/railsdev-blog-writer.mjs`
- Modify: `scripts/fullstackweb-blog-writer.mjs`
- Modify: `scripts/inasoft-blog-writer.mjs`
- Modify: `scripts/published.mjs` & `scripts/published-selfcheck.mjs` (shared `loadOpenPrs` / `hasTopicCollision` helpers so logic isn't duplicated 3×)

**Interfaces:**
- Consumes: `canonicalUrl`, `normalizeTitle`, `isSimilarTitle`, `buildPublishedIndex`, `fetchPublished`, `recordPublished`, `filterUnseenCandidates` from `./published.mjs`.
- Produces in `scripts/published.mjs`:
  - `loadOpenPrs({ siteDir, pat }): { slugs: Set<string>, titles: string[] }` (runs `gh pr list --state open --json headRefName,title --limit 50`; returns empty sets on error/missing PAT in `DRY_RUN`, logs warning).
  - `checkTopicCollision({ slug, title, topic, keyword, signalUrl }, { slugs, urls, titles, keywords }): string | null` (returns human-readable collision reason or `null`).

- [ ] **Step 1: Add `checkTopicCollision` tests in `scripts/published-selfcheck.mjs` and run**
  - Assert collision detection for: matching `slug`, matching `signalUrl` (with UTM params), similar `title`, similar `topic`, and exact normalized `keyword`; assert non-colliding topic returns `null`.
  - Run `npm run published:selfcheck` and verify failure before implementing.

- [ ] **Step 2: Implement `loadOpenPrs` and `checkTopicCollision` in `scripts/published.mjs`**
  - Verify `npm run published:selfcheck` passes.

- [ ] **Step 3: Update all three blog writers (`railsdev-blog-writer.mjs`, `fullstackweb-blog-writer.mjs`, `inasoft-blog-writer.mjs`)**
  - Expand `loadCorpus(dir)` to parse `slug`, `title`, `keyword`, and `seoTitle` from **every** `.md` file in `src/content/blog`.
  - Fetch D1 history (`fetchPublished({ pipeline: "blog:<site>", limit: 500, dryRun: DRY_RUN })`; call `await fail(...)` if it throws in real run) and open PRs (`loadOpenPrs`).
  - Build combined `history`: `slugs` (corpus + open PR `blog/*` slugs + D1 `item_key`), `urls` (D1 `url`), `titles` (corpus titles + open PR titles + D1 titles), `keywords` (normalized corpus `keyword` + D1 `meta.keyword`).
  - Pre-filter `signals` using `filterUnseenCandidates` against `history.urls` and `history.titles`. If `signals.length === 0`: log clean skip and `process.exit(0)`.
  - Update `topicPrompt` to include `"signalIndex":<1..N>` in the required JSON schema and pass up to 150 existing `title`s (+ `keyword`s) in `Avoid all of these existing posts`.
  - In the topic selection loop (up to 3 attempts), validate `checkTopicCollision(...)` against `history` using the chosen `signals[topic.signalIndex - 1]?.url`. If collision occurs, log the reason and append it to the next attempt's prompt (`Previous topic rejected (<reason>); pick a DIFFERENT signal from Signals.`). If all 3 attempts collide (or `topic` is null after collisions), log clean skip and `process.exit(0)`. (Genuine AI provider outages still call `fail(...)`.)
  - Validate `corpusSlugs` in `validateArticle` using all known `history.slugs`.
  - After PR creation in step 8 (non-`DRY_RUN`), call `await recordPublished({ pipeline: "blog:<site>", dryRun: DRY_RUN, items: [{ item_key: article.slug, title: article.title, url: chosenSignal?.url || "", meta: { keyword: article.keyword, topic: topic.topic, pr } }] })`.

- [ ] **Step 4: Verify**
  - Run `node --check scripts/railsdev-blog-writer.mjs && node --check scripts/fullstackweb-blog-writer.mjs && node --check scripts/inasoft-blog-writer.mjs` — expected: exit 0.
  - Run `npm run published:selfcheck` — expected: ok.

- [ ] **Step 5: Commit**
  - `git add scripts/published.mjs scripts/published-selfcheck.mjs scripts/railsdev-blog-writer.mjs scripts/fullstackweb-blog-writer.mjs scripts/inasoft-blog-writer.mjs`
  - `git commit -m "feat(blogs): block duplicate topics, signals, keywords, and open PRs before generation"`

---

### Task 5: Harden & deduplicate IG Reel (`scripts/ig_reel/`)

**Files:**
- Modify: `scripts/ig_reel/story.py`
- Modify: `scripts/ig_reel_daily.py`
- Modify: `scripts/ig_reel/selfcheck.py`

**Interfaces:**
- Consumes: Worker `GET /api/published` and `POST /api/published` (`SCHEDULER_URL`, `MANUAL_RUN_TOKEN`).
- Produces in `scripts/ig_reel/story.py`:
  - `canonical_url(raw_url: str) -> str`
  - `normalize_title(text: str) -> str`
  - `is_similar_title(a: str, b: str) -> bool`
  - `extract_buffer_seen(captions: list[str]) -> tuple[set[str], list[str]]` (returns `(seen_urls, seen_hooks)` parsed from `Sumber: ... (<url>)` and caption first lines)

- [ ] **Step 1: Add failing asserts to `scripts/ig_reel/selfcheck.py`**
  - Assert `canonical_url("https://Example.com/news/?utm_source=ig&b=2&a=1#frag") == "https://example.com/news?a=1&b=2"`.
  - Assert `is_similar_title("Webb finds glass rain on exoplanet", "NASA Webb Finds Glass Rain on Exoplanet!")` is `True`, and unrelated titles are `False`.
  - Assert `extract_buffer_seen(["Bayangkan hujan kaca.\n\nIsi.\n\nSumber: NASA (https://nasa.gov/story/?utm_medium=ig)"])` returns `({"https://nasa.gov/story"}, ["Bayangkan hujan kaca."])`.

- [ ] **Step 2: Run `python3 scripts/ig_reel/selfcheck.py` and verify it fails**

- [ ] **Step 3: Implement `canonical_url`, `normalize_title`, `is_similar_title`, `extract_buffer_seen` in `scripts/ig_reel/story.py`**

- [ ] **Step 4: Run `python3 scripts/ig_reel/selfcheck.py` and verify it passes**

- [ ] **Step 5: Update `scripts/ig_reel_daily.py`**
  - Add `fetch_published_ledger(pipeline)` and `record_published_ledger(pipeline, items)` using `urllib.request`:
    - In real runs (`not DRY_RUN`): fail via `fail(...)` if `SCHEDULER_URL` or `MANUAL_RUN_TOKEN` is missing or `GET /api/published` fails after 2 retries. In `DRY_RUN`: log and return `[]` if env missing.
    - `record_published_ledger`: no-op in `DRY_RUN`; warns on failure after `buffer_create_and_confirm` without failing the run.
  - Update `_posts_query` in `ig_reel_daily.py` from `status: [sent]` to `status: [sent, scheduled]`.
  - Combine D1 items (`pipeline=f"ig-reel:{ACCOUNT['id']}"`, `limit=500`) + Buffer `extract_buffer_seen(recent)` into `seen_urls`, `seen_titles`, `seen_hooks` (and `seen_tip_hooks` / `seen_tip_prompts` capped to `DEDUPE_POSTS`).
  - In `find_news_story`: filter `candidates` in code before `pick_shortlist` (drop if `canonical_url(link) in seen_urls` or `is_similar_title(title, t)` for `t in seen_titles`). If `not candidates`: return `None, "all_published"`. Also reject generated story if `is_similar_title(story["hook"], h)` for `h in seen_hooks`, continuing to next ref.
  - When `find_news_story` returns `(None, reason)` and `(MODE == "news" or not themes)`: if `reason == "all_published"`, log `REPORT {"status": "skipped", "account": ACCOUNT["id"], "reason": "all candidates already published", "posted": False}` and `return` (exit `0`, no Slack failure note!).
  - In `write_tip`: pass combined D1 + Buffer avoid strings; reject in validation if `story["hook"]` matches `seen_tip_hooks` or `story["sample_prompt"]` matches `seen_tip_prompts` (triggers repair retry or next theme). If all `TIP_TRIES` collide on duplicate tips, log `REPORT {"status": "skipped", ...}` and `return` (exit `0`).
  - After `buffer_create_and_confirm` succeeds (non-`DRY_RUN`), capture `post_id, reel_link = buffer_create_and_confirm(...)` (preserving `source_link = link` from the RSS candidate) and call `record_published_ledger`:
    - News: `item_key = canonical_url(source_link)`, `url = source_link`, `title = story["hook"]`, `meta = {"mode": "news", "source": source, "cand_title": cand["title"], "post_id": post_id, "reel": reel_link}`.
    - Tip: `item_key = "tip:" + hashlib.sha256(normalize_title(story["hook"]).encode()).hexdigest()[:16]`, `title = story["hook"]`, `meta = {"mode": "tip", "tool": theme["tool"], "topic": theme["topic"], "sample_prompt": story["sample_prompt"], "post_id": post_id, "reel": reel_link}`.

- [ ] **Step 6: Verify Python syntax & selfcheck**
  - Run: `python3 -c "import ast; ast.parse(open('scripts/ig_reel_daily.py').read())" && python3 scripts/ig_reel/selfcheck.py`
  - Run local dry-run test: `DRY_RUN=true PLACEHOLDER_IMAGES=true ACCOUNT=kaliajatau python3 scripts/ig_reel_daily.py` (when AI keys available, or check syntax + selfcheck).

- [ ] **Step 7: Commit**
  - `git add scripts/ig_reel/story.py scripts/ig_reel_daily.py scripts/ig_reel/selfcheck.py`
  - `git commit -m "feat(ig-reel): enforce D1 + Buffer deduplication and clean skip on no new items"`

---

### Task 6: GitHub Trending Top 5, GHA workflows, and `docs/status.md`

**Files:**
- Modify: `scripts/github-trending-digest.mjs`
- Modify: `.github/workflows/github-trending.yml`
- Modify: `.github/workflows/github-trending-weekly.yml`
- Modify: `.github/workflows/railsdev-blog-writer.yml`
- Modify: `.github/workflows/fullstackweb-blog-writer.yml`
- Modify: `.github/workflows/inasoft-blog-writer.yml`
- Modify: `.github/workflows/inasoft-news-digest.yml`
- Modify: `.github/workflows/rails-job-search.yml`
- Modify: `.github/workflows/ig-reel.yml`
- Modify: `docs/status.md`

- [ ] **Step 1: Update `scripts/github-trending-digest.mjs` to Top 5**
  - Define `const TOP_N = 5;` and replace `10` / `Top 10` across `collect()` (`repos.slice(0, TOP_N)`), `collectFallback()` (`per_page=${TOP_N}`), `digestTitle` (`Top ${TOP_N} of the Week` / `Top ${TOP_N} Today`), `analyze()` prompt (`For each of the ${repos.length} repositories below`, `across the ${repos.length}`, `exactly ${repos.length} items`), and Slack split (`const mid = Math.ceil(analysis.repos.length / 2)`).
  - Run `DRY_RUN=true AI_STUB=true node scripts/github-trending-digest.mjs` and `WEEKLY=true DRY_RUN=true AI_STUB=true node scripts/github-trending-digest.mjs` — expected: both print `Top 5` with 5 repos (indices 1..5).

- [ ] **Step 2: Update all 8 workflow files**
  - In `github-trending.yml` and `github-trending-weekly.yml`: update Top 10 → Top 5 comments.
  - In `railsdev-blog-writer.yml`, `fullstackweb-blog-writer.yml`, `inasoft-blog-writer.yml`, `inasoft-news-digest.yml`, `rails-job-search.yml`, and `ig-reel.yml`: add `SCHEDULER_URL: ${{ vars.SCHEDULER_URL }}` and `MANUAL_RUN_TOKEN: ${{ secrets.MANUAL_RUN_TOKEN }}` to the script step's `env:`.

- [ ] **Step 3: Update `docs/status.md`**
  - Document `0021_published_items`, `/api/published`, `SCHEDULER_URL` (Actions variable), `MANUAL_RUN_TOKEN` (Actions secret), GitHub Trending Top 5, and the clean-skip behavior.

- [ ] **Step 4: Full local verification & conflict-marker scan**
  - Run: `npm run typecheck && npm run selfcheck && npm run published:selfcheck && npm run index:selfcheck && npm run cover:selfcheck && python3 scripts/ig_reel/selfcheck.py`
  - Run: `git grep -n -E '^(<<<<<<< |>>>>>>> )' -- .` (must return nothing / exit 1).

- [ ] **Step 5: Commit**
  - `git add scripts/github-trending-digest.mjs .github/workflows/ docs/status.md`
  - `git commit -m "feat(trending,workflows): switch GitHub Trending to Top 5 and wire D1 ledger env vars"`
