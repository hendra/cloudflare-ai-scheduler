# FullstackWeb topic-mix percentages & 4-category simplification — design

**Date:** 2026-11-20 · **Size:** project (cross-repo: `hendra/fullstackwebdev-site` + `hendra/cloudflare-ai-scheduler`)

## Intent

1. Simplify `fullstackweb.dev`'s visible blog taxonomy (`BLOG_CATEGORIES`) to four clear categories: **Backend**, **Frontend**, **DevOps**, and **AI Engineering**, and recategorize all existing posts into those four categories.
2. Steer `scripts/fullstackweb-blog-writer.mjs` toward a fixed 6-stack editorial mix (**Python 20%, Rust 20%, Node 20%, AI Engineering and Integration 20%, Go 15%, Rails 5%**) using the deterministic deficit picker in `scripts/blog-topic-mix.mjs`, with evergreen topic fallback (`signalIndex: 0`) when daily Trending/HN signals don't cover the due stack.

## Goals, non-goals, anti-goals

- **Goals:**
  - Narrow `BLOG_CATEGORIES` (`src/content.config.ts`) and `TOPICS` (`src/lib/topics.ts`) in `hendra/fullstackwebdev-site` to `['AI Engineering', 'Backend', 'Frontend', 'DevOps']`, update `src/lib/topics.test.mjs`, add `301` redirects in `public/_redirects` for removed `/blog/topic/<slug>/` hubs, and recategorize all 21 existing posts that currently sit in removed categories.
  - Update `scripts/fullstackweb-blog-writer.mjs` to emit only those 4 categories, pick the next due stack from `FULLSTACKWEB_SHARES` based on existing non-draft posts in `corpus`, and allow `signalIndex: 0` evergreen topics when no unseen Trending/HN signal fits the due stack.
  - Add offline assert-based self-checks for the stack classifier and updated 4-category normalization.
- **Non-goals:**
  - Modifying `hendranicholas-blog-writer.mjs`, `railsdev-blog-writer.mjs`, or `inasoft-blog-writer.mjs`.
  - Adding new service pages (such as a Go service page) to `hendra/fullstackwebdev-site`.
  - Changing `scripts/check-blog-build.mjs` or Astro templates (they already derive topic hubs dynamically from `TOPICS` and post categories).
- **Anti-goals:**
  - Keeping old categories (`Dev Tools`, `Python and FastAPI`, `Node.js and TypeScript`, `Rust`, `Engineering Leadership`) or adding `Go` / `Ruby on Rails` to `BLOG_CATEGORIES`.
  - Ignoring existing published posts when computing stack counts (which would fail to correct the current ~25-post AI skew).
  - Staying strictly signal-only (which would starve rare stacks like `Rails` 5% and `Go` 15% or force-fit unrelated links).

## Constraints

- **Rollout order:** `hendra/cloudflare-ai-scheduler` should merge first (or together with `hendra/fullstackwebdev-site`), because the 4 target categories are already valid under the current 9-category enum in `fullstackwebdev-site`, whereas narrowing `fullstackwebdev-site` first while the old writer is still running could fail a scheduled run if the old writer emits a removed category.
- All changes in both repos must land via PR (`main` is never committed to directly).
- `hendra/fullstackwebdev-site` builds with `npm run build` + `node scripts/check-blog-build.mjs` + `node --test src/lib/topics.test.mjs` + `node scripts/check-post.mjs` on each changed post.
- `hendra/cloudflare-ai-scheduler` verifies with `npm run typecheck`, `npm run topicmix:selfcheck`, `node scripts/fullstackweb-category-selfcheck.mjs`, `npm run published:selfcheck`, `npm run aeo:selfcheck`, and a `dry_run=true` workflow dispatch.

## Approaches

- **1. Corpus-backed 6-stack picker + Evergreen fallback (`signalIndex: 0`) + 4-category site cleanup (chosen)**
  - Classify existing non-draft posts in `fullstackwebdev-site` into the 6 stack buckets (`Python`, `Rust`, `Node`, `AI Engineering and Integration`, `Go`, `Rails`) using `category`, `services`, `slug`, `title`, and `keyword`; run `pickCategory(FULLSTACKWEB_SHARES, counts)` to select the due stack; and allow `signalIndex: 0` evergreen topics when no unseen Trending/HN signal matches that stack.
  - Keeps percentages accurate across low-frequency stacks (`Rails`, `Go`, `Rust`) without skipped runs.
- **2. Same 4-category cleanup + 6-stack picker, strictly Signal-only (rejected)**
  - Walks down the deficit list until a stack matches an unseen Trending/HN signal, or skips if none. Rejected because Trending/HN skews heavily toward AI/JS tooling and would keep `Rails`, `Go`, and `Rust` behind target.

## Design

### Part 1 — `hendra/fullstackwebdev-site` (PR)

1. **`src/content.config.ts`:**
   - Set `BLOG_CATEGORIES = ['AI Engineering', 'Backend', 'Frontend', 'DevOps'] as const;`.
2. **`src/lib/topics.ts` & `src/lib/topics.test.mjs`:**
   - Trim `TOPICS` to the 4 hubs: `AI Engineering` (`ai-engineering`), `Backend` (`backend`), `Frontend` (`frontend`), `DevOps` (`devops`).
   - Update the `'Rust'` fixture in `src/lib/topics.test.mjs` (`topicCounts drops clusters below the minimum`) to `'Frontend'` so test fixtures use only valid `BLOG_CATEGORIES`.
3. **`public/_redirects`:**
   - Add `301` redirects (both no-slash and trailing-slash, matching file convention) for the 5 retired topic hubs:
     - `/blog/topic/dev-tools` & `/blog/topic/dev-tools/` → `/blog/topic/ai-engineering/`
     - `/blog/topic/python-and-fastapi` & `/blog/topic/python-and-fastapi/` → `/blog/topic/backend/`
     - `/blog/topic/nodejs-and-typescript` & `/blog/topic/nodejs-and-typescript/` → `/blog/topic/backend/`
     - `/blog/topic/rust` & `/blog/topic/rust/` → `/blog/topic/backend/`
     - `/blog/topic/engineering-leadership` & `/blog/topic/engineering-leadership/` → `/blog/`
4. **Recategorize the 21 existing posts currently outside the 4 categories:**
   - **`Backend` (9 posts):**
     - `django-6-1-fetch-modes-db-on-delete-mailers.md` (was `Python and FastAPI`)
     - `django-vs-fastapi.md` (was `Python and FastAPI`)
     - `python-3-15-lazy-imports.md` (was `Python and FastAPI`)
     - `rust-1-99-c-variadic-functions-debug-profile.md` (was `Rust`)
     - `nodejs-release-schedule-one-lts-per-year.md` (was `Node.js and TypeScript`)
     - `temporal-api-nodejs-26.md` (was `Node.js and TypeScript`)
     - `typescript-7-migration-guide.md` (was `Node.js and TypeScript`)
     - `what-github-trending-tells-senior-engineers.md` (was `Dev Tools`; general engineering/architecture signal analysis)
     - `fractional-lead-vs-agency-vs-hire.md` (was `Engineering Leadership`; technical leadership/staffing trade-offs)
   - **`Frontend` (1 post):**
     - `embed-ai-office-suite-react-nextjs-univer-sdk.md` (was `Dev Tools`; React/Next.js UI SDK embedding, matching `embed-ai-agents-react-nextjs-ag-ui.md` in `Frontend`)
   - **`AI Engineering` (11 posts):**
     - `ai-code-planning-workspace.md`
     - `ai-powered-codex-security-typescript-ci.md`
     - `build-agent-native-cli-tools.md`
     - `chrome-devtools-ai-coding-assistant.md`
     - `hybrid-ai-code-review-deterministic-pipelines-llm-agents.md`
     - `integrate-open-source-ai-coding-agents.md`
     - `llm-code-audit-cost-optimization.md`
     - `orchestrating-self-hosted-ai-coding-agents-loopforge.md`
     - `protecting-codebase-openai-codex-security-typescript.md`
     - `scaling-ai-code-reviews-hybrid-pipelines.md`
     - `unified-agent-skill-framework.md`
   - Posts already in `AI Engineering` (15), `Backend` (3, including both Go posts), `Frontend` (4), and `DevOps` (2) stay unchanged.

### Part 2 — `hendra/cloudflare-ai-scheduler` (PR)

1. **`scripts/published.mjs`:**
   - Extend `loadBlogCorpus(siteDir)` to parse `services` from YAML frontmatter (supporting both inline `["a", "b"]` / `['a', 'b']` arrays and multi-line `- a` lists) so stack classification can inspect `post.services`.
2. **`scripts/blog-topic-mix.mjs`:**
   - Export `FULLSTACKWEB_SHARES`:
     - `"Python": 0.20`
     - `"Rust": 0.20`
     - `"Node": 0.20`
     - `"AI Engineering and Integration": 0.20`
     - `"Go": 0.15`
     - `"Rails": 0.05`
   - Export `classifyFullstackwebTopic(post)` and `countFullstackwebTopics(posts)`:
     - Maps each non-draft corpus post into one of the 6 keys above (or `null` for non-stack posts such as `DevOps`, `Frontend`, or general `Backend` posts like `api-versioning-mastery`, which `pickCategory` ignores because `total` counts only keys in `shares`).
     - **Scoping & catch-all guard (our call):**
       - Return `null` immediately when `post.category === "Frontend"` or `post.category === "DevOps"` (so UI posts such as `embed-ai-agents-react-nextjs-ag-ui` and `embed-ai-office-suite-react-nextjs-univer-sdk` stay excluded even though they link to AI services).
       - Inspect `post.services` only when `Array.isArray(post.services) && post.services.length > 0 && post.services.length <= 4`, preventing catch-all posts that list all 10 service slugs (such as `api-versioning-mastery`) from being misclassified.
     - Classification order (matching normalized `slug`/`title`/`keyword` + bounded `services`, including common framework names per stack):
       1. `"AI Engineering and Integration"` when `post.category === "AI Engineering"` or narrow AI services (`ai-engineering`, `ai-agent-development`, `rag-llm-development`) are present.
       2. `"Rails"` when `ruby-on-rails-development` is in narrow `services` or Rails/Ruby tokens (`rails`, `ruby on rails`, `activerecord`, `hotwire`, `turbo`, `sinatra`) match (`slug`/`title`/`keyword`).
       3. `"Python"` when `python-fastapi-development` is in narrow `services` or Python tokens (`python`, `fastapi`, `django`, `flask`, `pydantic`, `uv`, `pytest`) match.
       4. `"Rust"` when Rust tokens (`rust`, `cargo`, `tokio`, `rustc`, `axum`, `actix`, `crate`) match.
       5. `"Go"` when Go tokens (`go`, `golang`, `goroutine`, `gin`, `fiber`, `go 1.x`) match.
       6. `"Node"` when `nodejs-typescript-development` is in narrow `services` or Node/TS tokens (`node`, `nodejs`, `node.js`, `typescript`, `nestjs`, `fastify`, `hono`, `express`) match.
3. **`scripts/fullstackweb-blog-writer.mjs`:**
   - Narrow `CATEGORY_VALUES` to `["AI Engineering", "Backend", "Frontend", "DevOps"]`.
   - Update `CATEGORY_ALIASES` and `normalizeCategory` to map any legacy/stack name (`AI/LLM`, `Dev Tools`, `Python and FastAPI`, `Node.js and TypeScript`, `Rust`, `Go`, `Ruby on Rails`, `Engineering Leadership`, etc.) cleanly to one of the 4 categories (default `"Backend"`).
   - Compute `targetTopic = pickCategory(FULLSTACKWEB_SHARES, countFullstackwebTopics(corpus.filter((c) => !c.draft)))` and `targetCategory = targetTopic === "AI Engineering and Integration" ? "AI Engineering" : "Backend"`.
   - Keep fetching Trending + HN signals, but make signals optional (same pattern as `scripts/hendranicholas-blog-writer.mjs`): if `signals.length === 0`, continue with evergreen fallback instead of `process.exit(0)`.
   - Update `topicPrompt` to require `targetTopic` (explaining stack focus, e.g. for `"AI Engineering and Integration"` focus on production AI engineering or LLM/agent integration; for `"Node"` focus on Node.js/TypeScript backend or full-stack services; for `"Python"`/`"Rust"`/`"Go"`/`"Rails"` focus on that stack) and require `category: targetCategory`, with `"signalIndex": <0..N>` (`0` = evergreen tutorial/guide with no signal source URL).
   - In the 3-attempt topic loop, validate `sigIdx` in `0..signals.length` (`0` → `chosenSignal = null`), enforce **both** `normalizeCategory(candidate.category, candidate) === targetCategory` and `classifyFullstackwebTopic({ ...candidate, category: targetCategory }) === targetTopic` **(our call: prevents silent drift onto Node/general Backend when `Rails`, `Go`, `Rust`, or `Python` is due)**, retrying with explicit feedback if either mismatches, and check `checkTopicCollision`.
   - Update `AI_STUB` topic/category alignment so `AI_STUB=true DRY_RUN=true` produces a topic matching `targetTopic` / `targetCategory`.
   - Record `topicBucket: targetTopic` in `recordPublished` `meta`.
4. **Self-checks:**
   - Update `scripts/fullstackweb-category-selfcheck.mjs` for the 4 categories and updated `normalizeCategory` rules.
   - Extend `scripts/blog-topic-mix-selfcheck.mjs` with tests for `FULLSTACKWEB_SHARES` (sums to 1.0, `pickCategory` order/convergence) and `classifyFullstackwebTopic` / `countFullstackwebTopics` (AI priority, hyphenated slugs, services array, non-stack posts returning `null`).

## Left to the builder

- Exact regex word-boundary patterns inside `classifyFullstackwebTopic` (ensuring `go` does not false-positive on unrelated words like `"google"` or `"going"`).
- Exact `services` frontmatter parser implementation in `scripts/published.mjs` (and verifying `npm run published:selfcheck` still passes).
- Exact prompt wording in `scripts/fullstackweb-blog-writer.mjs` so `topicPrompt` steers the model reliably into `targetTopic` on both signal-matched and evergreen runs.
- Running full verification in both repos before merging PRs.
