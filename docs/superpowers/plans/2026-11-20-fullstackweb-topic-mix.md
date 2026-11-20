# FullstackWeb Topic-Mix & 4-Category Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Narrow `fullstackweb.dev` blog categories to `AI Engineering`, `Backend`, `Frontend`, and `DevOps`, recategorize existing posts into those 4 categories, and steer `scripts/fullstackweb-blog-writer.mjs` toward Python 20%, Rust 20%, Node 20%, AI Engineering and Integration 20%, Go 15%, and Rails 5% with evergreen fallback.

**Architecture:** `scripts/published.mjs` exposes `services` in `loadBlogCorpus` so `scripts/blog-topic-mix.mjs` can classify non-draft posts into the 6 stack buckets (`FULLSTACKWEB_SHARES`) and pick the furthest-behind stack with `pickCategory`. `scripts/fullstackweb-blog-writer.mjs` narrows `CATEGORY_VALUES` to the 4 site categories, steers `topicPrompt` to the picked stack (allowing `signalIndex: 0` evergreen topics when daily Trending/HN signals have no match), and validates both category and stack before writing. In `hendra/fullstackwebdev-site`, `BLOG_CATEGORIES`, `TOPICS`, `public/_redirects`, and 21 existing posts are updated via a separate PR merged right after the scheduler PR.

**Tech Stack:** Node 20 ESM (zero-dep scripts), Astro (`hendra/fullstackwebdev-site`), GitHub Actions + `gh` CLI.

**Spec:** `docs/superpowers/specs/2026-11-20-fullstackweb-topic-mix-design.md`

## Global Constraints

- Narrow `BLOG_CATEGORIES` in `hendra/fullstackwebdev-site` and `CATEGORY_VALUES` in `scripts/fullstackweb-blog-writer.mjs` to `["AI Engineering", "Backend", "Frontend", "DevOps"]`.
- `FULLSTACKWEB_SHARES` must equal `{ "Python": 0.20, "Rust": 0.20, "Node": 0.20, "AI Engineering and Integration": 0.20, "Go": 0.15, "Rails": 0.05 }` (sum = `1.0`).
- All changes in both `hendra/cloudflare-ai-scheduler` and `hendra/fullstackwebdev-site` must land via PR (never direct commit to `main`).
- Rollout order: merge the `hendra/cloudflare-ai-scheduler` PR first (or together with `fullstackwebdev-site`), because the 4 categories are already valid under the existing 9-category enum in `fullstackwebdev-site`.
- Keep zero merge-conflict markers (`git grep -n -E '^(<<<<<<< |>>>>>>> )' -- .` clean) and follow global PR cleanup after merge (`git worktree remove`, delete local/remote branches, `git worktree prune`).

## Review Focus

- `"go"` substring false positives (`"google"`, `"going"`, `"django"`, `"mongodb"`, `"algorithms"`) must not classify a post as `"Go"` → tested in Task 2 (`scripts/blog-topic-mix-selfcheck.mjs`).
- Catch-all multi-service posts (`api-versioning-mastery.md` with all 10 `services`) and `Frontend`/`DevOps` posts with AI `services` (`embed-ai-agents-react-nextjs-ag-ui.md`) must return `null` from `classifyFullstackwebTopic` → tested in Task 2 (`scripts/blog-topic-mix-selfcheck.mjs`).
- `loadBlogCorpus` must parse both inline (`services: ['a', 'b']`) and multi-line (`services:\n  - a`) YAML arrays and return `[]` when missing → tested in Task 1 (`scripts/published-selfcheck.mjs`).
- Topic selection must reject candidates that satisfy `targetCategory` (`Backend`) but drift onto a different stack (e.g. Node when Rails/Go/Rust is due), and `stubArticle(targetTopic)` must align with `targetTopic` → tested in Task 3 (`scripts/fullstackweb-category-selfcheck.mjs`).
- Narrowing `BLOG_CATEGORIES` in `hendra/fullstackwebdev-site` must leave `src/lib/topics.test.mjs`, `scripts/check-post.mjs`, `npm run build`, `scripts/check-blog-build.mjs`, and `public/_redirects` for retired hubs all passing → verified in Task 4.

---

### Task 1: Parse `services` in `loadBlogCorpus` (`scripts/published.mjs`)

**Files:**
- Modify: `scripts/published.mjs:319-365`
- Test: `scripts/published-selfcheck.mjs:424-455`

**Interfaces:**
- Produces: `loadBlogCorpus(siteDir)` entries now include `services: string[]` alongside `slug`, `title`, `keyword`, `seoTitle`, `category`, `subcategory`, `draft`.

- [ ] **Step 1: Write the failing test in `scripts/published-selfcheck.mjs`**

Add fixtures and assertions in section `5h` (`scripts/published-selfcheck.mjs:433-454`):
- `first-post.md`: add `services: ["python-fastapi-development", 'backend-api-development']` → assert `assert.deepEqual(first.services, ["python-fastapi-development", "backend-api-development"])`.
- `second-post.md`: omit `services` → assert `assert.deepEqual(second.services, [])`.
- Add `third-post.md` with multi-line YAML `services:\n  - ruby-on-rails-development\n  - backend-api-development\n` → assert `assert.deepEqual(third.services, ["ruby-on-rails-development", "backend-api-development"])` (and update `corpus.length` assertion from `2` to `3`).

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run published:selfcheck`
Expected: FAIL (`AssertionError` on `first.services`, `undefined` vs `["python-fastapi-development", "backend-api-development"]`).

- [ ] **Step 3: Implement `parseFrontmatterList(fm, key)` and wire `services` in `loadBlogCorpus` (`scripts/published.mjs`)**

Add `parseFrontmatterList(fm, key)` to parse:
1. Inline YAML array (`key: [ ... ]`) splitting items and stripping matching single/double quotes.
2. Block YAML array (`key:\n  - item1\n  - item2`) until the next non-indented key or blank/non-list line.
Include `services: parseFrontmatterList(fm, "services")` in each `out.push({...})` entry of `loadBlogCorpus`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run published:selfcheck`
Expected: PASS (`published-selfcheck: ok`).

- [ ] **Step 5: Commit**

```bash
git add scripts/published.mjs scripts/published-selfcheck.mjs
git commit -m "feat(published): parse services frontmatter in loadBlogCorpus"
```

---

### Task 2: Add `FULLSTACKWEB_SHARES` and corpus stack classifier (`scripts/blog-topic-mix.mjs`)

**Files:**
- Modify: `scripts/blog-topic-mix.mjs`
- Test: `scripts/blog-topic-mix-selfcheck.mjs`

**Interfaces:**
- Consumes: `post` shape from `loadBlogCorpus` (`{ slug?, title?, keyword?, category?, services?: string[] }`) and `pickCategory(shares, counts)`.
- Produces:
  - `export const FULLSTACKWEB_SHARES`: `{ "Python": 0.20, "Rust": 0.20, "Node": 0.20, "AI Engineering and Integration": 0.20, "Go": 0.15, "Rails": 0.05 }`
  - `export function classifyFullstackwebTopic(post): "Python" | "Rust" | "Node" | "AI Engineering and Integration" | "Go" | "Rails" | null`
  - `export function countFullstackwebTopics(posts): Record<string, number>`

- [ ] **Step 1: Write failing tests in `scripts/blog-topic-mix-selfcheck.mjs`**

Import `FULLSTACKWEB_SHARES`, `classifyFullstackwebTopic`, `countFullstackwebTopics` and assert:
1. Feeding 100 picks of `FULLSTACKWEB_SHARES` into `pickCategory` converges to exact counts: `{ Python: 20, Rust: 20, Node: 20, "AI Engineering and Integration": 20, Go: 15, Rails: 5 }`.
2. Direct classifications:
   - `{ slug: "django-vs-fastapi", category: "Backend", services: ["python-fastapi-development"] }` → `"Python"`
   - `{ slug: "rust-1-99-c-variadic-functions", title: "Rust 1.99: Cargo Changes", category: "Backend", services: ["backend-api-development"] }` → `"Rust"`
   - `{ slug: "go-1-27-generic-methods", title: "Go 1.27 Generic Methods", category: "Backend", services: ["backend-api-development"] }` → `"Go"`
   - `{ slug: "hotwire-turbo-streams-guide", title: "Hotwire Turbo Streams", category: "Backend", services: [] }` → `"Rails"`
   - `{ slug: "temporal-api-nodejs-26", title: "Temporal in Node.js 26", category: "Backend", services: ["nodejs-typescript-development"] }` → `"Node"`
   - `{ slug: "protecting-codebase-openai-codex-security-typescript", title: "Codex Security in TypeScript", category: "AI Engineering", services: ["nodejs-typescript-development"] }` → `"AI Engineering and Integration"` (AI priority over Node)
3. Review Focus edge cases:
   - `"go"` false-positive guard: `{ slug: "google-cloud-django-guide", title: "Going Beyond Algorithms with MongoDB", category: "Backend", services: [] }` → `null`
   - `Frontend` / `DevOps` scope guard: `{ slug: "embed-ai-agents-react-nextjs-ag-ui", title: "Embed AI Agents in React", category: "Frontend", services: ["ai-engineering", "ai-agent-development"] }` → `null`; `{ slug: "arcane-modern-docker-management", title: "Arcane Docker", category: "DevOps", services: ["cloud-devops"] }` → `null`
   - Catch-all `services` guard: `{ slug: "api-versioning-mastery", title: "Mastering API Versioning", category: "Backend", services: ["full-stack-development", "nodejs-typescript-development", "react-nextjs-development", "backend-api-development", "cloud-devops", "ruby-on-rails-development", "python-fastapi-development", "ai-engineering", "ai-agent-development", "rag-llm-development"] }` → `null`
4. `countFullstackwebTopics(sampleCorpus)` skips `null` posts and tallies matching buckets accurately.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run topicmix:selfcheck`
Expected: FAIL (`FULLSTACKWEB_SHARES` / `classifyFullstackwebTopic` is not a function).

- [ ] **Step 3: Implement `FULLSTACKWEB_SHARES`, `classifyFullstackwebTopic`, and `countFullstackwebTopics` in `scripts/blog-topic-mix.mjs`**

Implementation rules:
- Normalize `post.category` trimmed lowercase: return `null` immediately for `"frontend"` or `"devops"`.
- Compute `narrowServices = Array.isArray(post.services) && post.services.length > 0 && post.services.length <= 4 ? post.services : []`.
- Build normalized searchable text from `${post.slug.replace(/-/g, " ")} ${post.title} ${post.keyword}`.
- Check in strict order:
  1. `"AI Engineering and Integration"`: `cat === "ai engineering"` or `narrowServices` includes `ai-engineering` / `ai-agent-development` / `rag-llm-development`. (Note: does not auto-match `Frontend`/`DevOps` because of the early return.)
  2. `"Rails"`: `narrowServices.includes("ruby-on-rails-development")` or `/\b(rails|ruby on rails|ruby|activerecord|hotwire|turbo|sinatra|sidekiq)\b/i`.
  3. `"Python"`: `narrowServices.includes("python-fastapi-development")` or `/\b(python|fastapi|django|flask|pydantic|pytest|uv)\b/i`.
  4. `"Rust"`: `/\b(rust|cargo|tokio|rustc|axum|actix|crate)\b/i`.
  5. `"Go"`: `/\b(golang|goroutine|gin|fiber|chi)\b/i` or `/\bgo\b/i` on original `title`/`keyword`/`slug.replace(/-/g, " ")` (case-insensitive `\bgo\b` safely excludes `"google"`, `"going"`, `"django"`, `"mongodb"`, `"algorithms"`).
  6. `"Node"`: `narrowServices.includes("nodejs-typescript-development")` or `/\b(node\.?js|nodejs|node|typescript|nestjs|fastify|hono|express)\b/i`.
  7. Otherwise `null`.
- `countFullstackwebTopics(posts)` accumulates non-null labels across `posts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run topicmix:selfcheck`
Expected: PASS (`topic-mix self-check: ok`).

- [ ] **Step 5: Commit**

```bash
git add scripts/blog-topic-mix.mjs scripts/blog-topic-mix-selfcheck.mjs
git commit -m "feat(blogs): add FullstackWeb 6-stack topic-mix shares and classifier"
```

---

### Task 3: Steer `scripts/fullstackweb-blog-writer.mjs` with 4 categories, `FULLSTACKWEB_SHARES`, and evergreen fallback

**Files:**
- Modify: `scripts/fullstackweb-blog-writer.mjs`
- Modify: `scripts/fullstackweb-category-selfcheck.mjs`

**Interfaces:**
- Consumes: `pickCategory`, `FULLSTACKWEB_SHARES`, `classifyFullstackwebTopic`, `countFullstackwebTopics` from `./blog-topic-mix.mjs`.
- Produces:
  - `export const CATEGORY_VALUES = ["AI Engineering", "Backend", "Frontend", "DevOps"]`
  - `export function normalizeCategory(raw, ctx)` returning one of those 4 categories
  - `export function targetCategoryForTopic(topic)` (`"AI Engineering and Integration"` → `"AI Engineering"`, else `"Backend"`)
  - `export function validateTopicCandidate(candidate, { targetTopic, targetCategory, signalCount })` returning `{ ok, reason, signalIndex }`
  - `export function stubArticle(targetTopic = "Node")` aligned with `targetTopic` and `targetCategory`

- [ ] **Step 1: Update `scripts/fullstackweb-category-selfcheck.mjs` with failing tests for the 4 categories + topic steering**

Replace the old 9-category assertions in `scripts/fullstackweb-category-selfcheck.mjs` with assertions verifying:
1. `CATEGORY_VALUES` is `["AI Engineering", "Backend", "Frontend", "DevOps"]`.
2. Legacy mappings normalize into the 4 categories: `"AI/LLM"` → `"AI Engineering"`, `"Dev Tools"` → `"AI Engineering"`, `"Web/Frontend"` → `"Frontend"`, `"Infra/DevOps"` → `"DevOps"`, `"Python and FastAPI"` → `"Backend"`, `"Node.js and TypeScript"` → `"Backend"`, `"Rust"` → `"Backend"`, `"Ruby on Rails"` → `"Backend"`, `"Engineering Leadership"` → `"Backend"`, unknown/empty/`"Foo\nbar: baz"` → `"Backend"`.
3. `targetCategoryForTopic("AI Engineering and Integration") === "AI Engineering"` and `targetCategoryForTopic("Go") === "Backend"`, `targetCategoryForTopic("Rails") === "Backend"`.
4. `validateTopicCandidate`:
   - Rejects a `Node` candidate when `targetTopic === "Rails"` (`ok: false`, mentions `Rails`).
   - Rejects `signalIndex: -1` or `signalIndex > signalCount`, accepts `signalIndex: 0` (evergreen).
   - Accepts a valid `Go` candidate (`category: "Backend"`, `signalIndex: 0`, title/slug mentioning Go/Goroutine).
5. `stubArticle("Rust")` and `stubArticle("AI Engineering and Integration")` both pass `validateArticle(..., [])` and classify back to `"Rust"` / `"AI Engineering and Integration"`.

- [ ] **Step 2: Run selfcheck to verify it fails**

Run: `node scripts/fullstackweb-category-selfcheck.mjs`
Expected: FAIL (`CATEGORY_VALUES` still has 9 items / `targetCategoryForTopic` not exported).

- [ ] **Step 3: Update `scripts/fullstackweb-blog-writer.mjs`**

Apply the changes cleanly:
1. Narrow `CATEGORY_VALUES` to `["AI Engineering", "Backend", "Frontend", "DevOps"]`.
2. Update `CATEGORY_ALIASES` and `normalizeCategory` fallback rules so every stack/legacy value maps into one of the 4 categories (default `"Backend"`).
3. Export `targetCategoryForTopic(topic)` and `validateTopicCandidate(candidate, { targetTopic, targetCategory, signalCount })` (checks `signalIndex` in `0..signalCount`, normalizes category against `targetCategory`, and verifies `classifyFullstackwebTopic({ ...candidate, category: targetCategory }) === targetTopic`).
4. Export `stubArticle(targetTopic = "Node")` with matching stub metadata/body per `targetTopic` (`Python`, `Rust`, `Go`, `Rails`, `Node`, `AI Engineering and Integration`).
5. In `main()`:
   - Compute `targetTopic = pickCategory(FULLSTACKWEB_SHARES, countFullstackwebTopics(corpus.filter((c) => !c.draft)))` and `targetCategory = targetCategoryForTopic(targetTopic)`. Log both.
   - Make Trending/HN signals optional (mirror `scripts/hendranicholas-blog-writer.mjs`: log warning if both fail, and if `signals.length === 0`, continue with `"(none — pick an evergreen topic in the target stack and set signalIndex to 0)"`).
   - Update `topicPrompt` to require `targetTopic`, `category: targetCategory`, and `"signalIndex": <0..N>` (`0` for evergreen when no signal matches `targetTopic`), and tell the model to explicitly name the stack/framework in `title`, `slug`, and `keyword` and include the matching service slug in `services`.
   - Use `validateTopicCandidate` inside the 3-attempt topic loop and pass `chosenSignal = sigIdx === 0 ? null : signals[sigIdx - 1]`.
   - When `AI_STUB` is set, construct `topic` from `stubArticle(targetTopic)`.
   - Include `topicBucket: targetTopic` in `recordPublished` `meta`.

- [ ] **Step 4: Run all scheduler self-checks and typecheck**

Run:
```bash
npm run typecheck
npm run topicmix:selfcheck
node scripts/fullstackweb-category-selfcheck.mjs
npm run published:selfcheck
npm run aeo:selfcheck
DRY_RUN=true AI_STUB=true SITE_DIR=/home/hendra/Documents/projects/personal/websites/fullstackwebdev-site node scripts/fullstackweb-blog-writer.mjs
```
Expected: All commands exit 0; dry run selects `Rails` or `Rust` (or lowest-share stack on the current corpus), generates valid frontmatter/cover, and passes `astro check`/`npm run build`.

- [ ] **Step 5: Commit**

```bash
git add scripts/fullstackweb-blog-writer.mjs scripts/fullstackweb-category-selfcheck.mjs
git commit -m "feat(blogs): steer FullstackWeb writer with 4 categories and 6-stack mix"
```

---

### Task 4: Narrow categories and recategorize 21 posts in `hendra/fullstackwebdev-site`

**Files (in `/home/hendra/Documents/projects/personal/websites/fullstackwebdev-site`, on a new branch from `origin/main`):**
- Modify: `src/content.config.ts`
- Modify: `src/lib/topics.ts`
- Modify: `src/lib/topics.test.mjs`
- Modify: `public/_redirects`
- Modify: 21 blog files in `src/content/blog/*.md`

- [ ] **Step 1: Create branch from fresh `origin/main` in `fullstackwebdev-site`**

```bash
git -C /home/hendra/Documents/projects/personal/websites/fullstackwebdev-site fetch origin main
git -C /home/hendra/Documents/projects/personal/websites/fullstackwebdev-site checkout -b chore/simplify-blog-categories origin/main
```

- [ ] **Step 2: Update `src/content.config.ts`, `src/lib/topics.ts`, `src/lib/topics.test.mjs`, and `public/_redirects`**

- `src/content.config.ts`: `export const BLOG_CATEGORIES = ['AI Engineering', 'Backend', 'Frontend', 'DevOps'] as const;`
- `src/lib/topics.ts`: keep only the 4 `TOPICS` entries (`AI Engineering`, `Backend`, `Frontend`, `DevOps`).
- `src/lib/topics.test.mjs`: change `'Rust'` on line 24 to `'Frontend'`.
- `public/_redirects`: add `301` redirects for the 5 retired topic hubs (no-slash + trailing-slash):
  - `/blog/topic/dev-tools` & `/blog/topic/dev-tools/` → `/blog/topic/ai-engineering/`
  - `/blog/topic/python-and-fastapi` & `/blog/topic/python-and-fastapi/` → `/blog/topic/backend/`
  - `/blog/topic/nodejs-and-typescript` & `/blog/topic/nodejs-and-typescript/` → `/blog/topic/backend/`
  - `/blog/topic/rust` & `/blog/topic/rust/` → `/blog/topic/backend/`
  - `/blog/topic/engineering-leadership` & `/blog/topic/engineering-leadership/` → `/blog/`

- [ ] **Step 3: Recategorize the 21 existing posts per the spec**

- To `'Backend'` (9): `django-6-1-fetch-modes-db-on-delete-mailers.md`, `django-vs-fastapi.md`, `python-3-15-lazy-imports.md`, `rust-1-99-c-variadic-functions-debug-profile.md`, `nodejs-release-schedule-one-lts-per-year.md`, `temporal-api-nodejs-26.md`, `typescript-7-migration-guide.md`, `what-github-trending-tells-senior-engineers.md`, `fractional-lead-vs-agency-vs-hire.md`
- To `'Frontend'` (1): `embed-ai-office-suite-react-nextjs-univer-sdk.md`
- To `'AI Engineering'` (11): `ai-code-planning-workspace.md`, `ai-powered-codex-security-typescript-ci.md`, `build-agent-native-cli-tools.md`, `chrome-devtools-ai-coding-assistant.md`, `hybrid-ai-code-review-deterministic-pipelines-llm-agents.md`, `integrate-open-source-ai-coding-agents.md`, `llm-code-audit-cost-optimization.md`, `orchestrating-self-hosted-ai-coding-agents-loopforge.md`, `protecting-codebase-openai-codex-security-typescript.md`, `scaling-ai-code-reviews-hybrid-pipelines.md`, `unified-agent-skill-framework.md`

- [ ] **Step 4: Run full site verification**

Run in `/home/hendra/Documents/projects/personal/websites/fullstackwebdev-site`:
```bash
node --test src/lib/topics.test.mjs
npm run build
node scripts/check-blog-build.mjs
```
Also verify no post still uses a retired category and re-run `node scripts/check-post.mjs` on a sample or all 21 changed posts.
Expected: all tests pass, `check-blog-build.mjs` outputs `OK`.

- [ ] **Step 5: Commit**

```bash
git add src/content.config.ts src/lib/topics.ts src/lib/topics.test.mjs public/_redirects src/content/blog
git commit -m "chore(blog): narrow BLOG_CATEGORIES to Backend, Frontend, DevOps, AI Engineering"
```

---

### Task 5: Open PRs, run CI dry-run verification, merge in order, and clean up

- [ ] **Step 1: Open PR on `hendra/cloudflare-ai-scheduler`**

Push branch, check `git grep -n -E '^(<<<<<<< |>>>>>>> )' -- .` is clean, open PR with summary/verification checklist, wait for `ci` workflow green, and merge PR #1 first.

- [ ] **Step 2: Open PR on `hendra/fullstackwebdev-site`**

Push `chore/simplify-blog-categories`, open PR listing the schema change, redirects, and 21 recategorized posts, wait for site CI green, and merge PR #2.

- [ ] **Step 3: Run a `dry_run=true` workflow dispatch on `fullstackweb-blog-writer.yml`**

Run: `gh workflow run fullstackweb-blog-writer.yml -f dry_run=true`
Watch run logs and verify it picks the due underrepresented stack (e.g., `Rails` or `Rust`), passes validation + grounding + cover + `astro build`, and exits 0.

- [ ] **Step 4: Mandatory post-merge Git cleanup (both repos)**

Verify both PRs are `MERGED`, remove any worktrees (`git worktree remove`), delete local/remote feature branches, run `git worktree prune`, switch back to clean `main` pulled from `origin/main`, and verify `git branch --list`, `git branch -r`, and `git worktree list`.
