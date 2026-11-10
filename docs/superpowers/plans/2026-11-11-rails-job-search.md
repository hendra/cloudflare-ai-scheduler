# Rails Job Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Daily 07:50 WIB (00:50 UTC) dispatch posts a Rails remote-job digest to Slack #jobs — scored against the hardcoded profile — from four public sources, zero spend.

**Architecture:** Identical to the GitHub Trending pilot: Cloudflare cron `50 0 * * *` → D1 `github_actions_trigger` → `.github/workflows/rails-job-search.yml` → zero-dep `scripts/rails-job-search.mjs` → Slack. AI chain: Groq `openai/gpt-oss-120b` (JSON mode) → CF/other configured providers.

**Spec:** `docs/superpowers/specs/2026-11-11-rails-job-search-design.md`

## Global Constraints

- Zero spend; JSON mode + one retry; failure → ⚠️ note to #jobs; never fabricate postings/URLs/dates/salaries; LLM annotates only, facts pass through.
- Sources: Remotive API, Remote OK JSON, WWR RSS, HN "Who is hiring" (Algolia, best-effort) — all free/unauthenticated; per-source isolation; ⚠️ note if all fail.
- Freshness ≤ 30 days (when date known); eligibility ∈ worldwide|international|country-restricted|regional; dedupe by URL + normalized company+title; cap 40 candidates; sort date desc.
- Delivery: `SLACK_BOT_TOKEN` + `SLACK_JOBS_CHANNEL_ID` (bot is in #jobs); `chat.postMessage`; ≤ 3,500 chars per message; verified `ok:true`.
- `github-trending` conventions: `DRY_RUN` input (default false), `concurrency: rails-job-search`, `if: failure()` notifier skipped on dry runs and when `failure-posted` exists.
- D1 row `rails-job-search-daily`: `job_type=github_actions_trigger`, cron `50 0 * * *`, `enabled=0`, `next_run_at=2099-01-01T00:00:00.000Z` — **owner go-ahead required** to enable.
- Local verification: `AI_STUB=true` (no model calls) → `DRY_RUN=true` (real AI) → GHA dry run → live run (owner) → enable (owner).

## Review Focus

1. **Source fetch/parse fragility (regex on HTML/RSS/JSON)** — wrong parse yields junk or zero jobs silently. Mitigation: unit-check each parser against a saved sample (`/tmp` fixtures via curl at build time); assert ≥1 job per working source or explicit per-source skip log; never silently emit empty.
2. **LLM re-writing facts (scores treated as gospel; eligibility guessed)** — "Indonesian eligibility inferred from 'Remote' alone". Mitigation: script re-validates every returned index maps to an input job; eligibility restricted to the four enum values; per-field fallbacks (score null → excluded from "Top matches", listed in footer count only); LLM text never alters URL/title/company.
3. **All-sources failure posts a "fake digest"** — violates the core rule. Mitigation: hard guard — if zero candidates after fetch+dedupe+filter, post ⚠️ note, never a digest; per-source errors logged (source names listed in footer when partial).
4. **Slack failure duplicates** (script ⚠️ then workflow notifier also posts) — Mitigation: `failure-posted` marker honored by workflow's `if: failure()` step (already proven in pilot).
5. **Freshness/location filters silently dropping everything** (e.g. APIs return dateless items) — Mitigation: only drop when a date exists; log drop counts; footer notes "N undated listings included".

---

### Task 1: Seed migration

**Files:** Create `migrations/0007_rails_job_search.sql`

- [ ] **Step 1:** Write the row: id `rails-job-search-daily`, name `Rails — Remote Job Search (daily) → Slack #jobs`, description, `enabled=0`, `job_type=github_actions_trigger`, cron `50 0 * * *`, `timezone Asia/Jakarta`, `prompt` per pilot style, `input_json` with workflow `rails-job-search.yml` on `hendra/cloudflare-ai-scheduler`, `priority 5`, `next_run_at=2099-01-01T00:00:00.000Z`.
- [ ] **Step 2:** `npm run db:migrate:local` then `wrangler d1 execute scheduler-db --local --command "SELECT id, enabled, cron_expression FROM schedulers WHERE id='rails-job-search-daily'"` → expect the row.
- [ ] **Step 3:** Commit.

### Task 2: Pipeline script

**Files:** Create `scripts/rails-job-search.mjs`

- [ ] **Step 1:** Implement: env parsing (DRY_RUN, AI_STUB, AI_PROVIDER/AI_FALLBACKS/AI_MODEL/`<PROVIDER>_MODEL`, SLACK_BOT_TOKEN, SLACK_JOBS_CHANNEL_ID, CF_*, GROQ_API_KEY, GH_TOKEN); reuse the pilot's provider table + `callCompletion` pattern (copy, adapting comment header).
- [ ] **Step 2:** Sources (each isolated try/catch, 15s timeout, ≥1 source must succeed with ≥1 job):
  - Remotive: `GET https://remotive.com/api/remote-jobs?search=rails` → items (title, company_name, url, publication_date, candidate_required_location, salary, description strip-300)
  - Remote OK: `GET https://remoteok.com/api?tag=ruby` → array (skip index 0), filter title/description/tags match rails|ruby; fields (position, company, url, date, location, salary, tags)
  - WWR RSS: `GET https://weworkremotely.com/categories/remote-ruby-on-rails-jobs.rss` → `<item>` blocks: title (strip "Company: " prefix heuristically), link, pubDate, description strip-300
  - HN Who is hiring: Algolia `search_by_date?query="who%20is%20hiring"&tags=story&hitsPerPage=3` → latest monthly thread; fetch `https://hn.algolia.com/api/v1/items/<id>` → walk children (comments); keep text matching /rails/i; company/location best-effort via regex `(at|@|[A-Z][\w.]+)\s+(in|remote|anywhere)/i` (fallback: "see thread"); url = extracted link or the HN item link
- [ ] **Step 3:** Normalize/dedupe/filter/cap: normalize URL (strip trailing slash, lowercase host), dedupe URL and normalized `company|title`, drop dated items older than 30d, sort date desc, cap 40; `failures[]` collected for footer. If zero candidates → `fail()` path (⚠️ note, exit 1).
- [ ] **Step 4:** Scoring prompt: condensed profile + indexed candidates (~300 chars desc) → strict JSON `{jobs:[{index, score, tier, eligibility, restricts, why}], summary}`; enforce: index ∈ input range; eligibility ∈ 4 enums; tier ∈ 5 tiers; why ≤ 160 chars (truncate); score 0–100 clamp; retry once; on double failure → strict ⚠️ (no fake digest).
- [ ] **Step 5:** Render: header `💼 _Rails Remote Jobs — <date>_ | sources: Remotive, RemoteOK, WWR, HN | N jobs` → sections Excellent/Strong/Good (Good only if needed to fill; else show Good+Moderate top by score to fill ≥ 5 jobs, max 12) → each entry: `_<n>. <company>_ — <title> · <location|Remote> [<tier> <score>] · <eligibility tag>\n→ <url>\n💡 <why>` → footer: sources OK/failed, counts, "date unknown" note when applicable, AI chain used. Split at 3,500 chars; ≤ 3 messages. Post or print (DRY_RUN).
- [ ] **Step 6:** Local `AI_STUB=true` run → prints full message; sanity-check output shape; then `DRY_RUN=true` with real AI chain → verify scores look sane; iterate on prompt/format until pass. No Slack calls in either.
- [ ] **Step 7:** Commit.

### Task 3: Workflow

**Files:** Create `.github/workflows/rails-job-search.yml`

- [ ] **Step 1:** Same skeleton as `github-trending.yml` post-#20: `workflow_dispatch` with `dry_run` (bool, default false), `permissions: contents: read`, `concurrency: rails-job-search, cancel-in-progress: false`, timeout 20, checkout → setup-node 20 → `node scripts/rails-job-search.mjs`; env: CF/GROQ/other provider secrets, `SLACK_BOT_TOKEN`, `SLACK_JOBS_CHANNEL_ID`, `GH_TOKEN`, `DRY_RUN: ${{ inputs.dry_run }}`; `if: failure() && env.DRY_RUN != 'true' && !hashFiles('failure-posted')` notifier with ⚠️ text pointing at the run.
- [ ] **Step 2:** YAML parse + commit.

### Task 4: Verify on GitHub Actions (owner participates)

- [ ] **Step 1:** Push branch, open PR (title `feat: Rails job search pipeline (daily)`).
- [ ] **Step 2:** `gh workflow run rails-job-search.yml --ref <branch> -f dry_run=true` → verify log: source counts, composed digest, **no Slack calls**.
- [ ] **Step 3:** `gh workflow run rails-job-search.yml --ref <branch> -f dry_run=false` → expect exactly one digest in #jobs (≤ 3 messages). Owner confirms receipt.
- [ ] **Step 4:** Owner go-ahead to enable D1 row (`enabled=1`, next 00:50 UTC) — separate decision, not in this PR.

## Spec Coverage Check
- Goal/schedule/cron → Tasks 1,3. Sources + per-source isolation → Task 2 Step 2. Scoring rubric + eligibility → Task 2 Step 4. Freshness/dedupe/cap → Step 3. Digest format/split/footer → Step 5. Failure behavior + notifier guard → Step 5/7, Task 3. Secrets → Task 3. Verification gates → Task 4.
