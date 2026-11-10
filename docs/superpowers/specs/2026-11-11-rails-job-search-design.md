# Rails Remote Job Search Migration — Design

**Date:** 2026-11-11 · **Status:** Draft, pending approval · **Source prompt:** `prompts/rails-job-search.md`

## Intent and why

Migrate the job-search prompt off Claude Scheduler onto the same zero-spend pattern as the GitHub Trending pilot (`github-trending-digest.mjs` + `github-trending.yml`): Cloudflare cron → GitHub Actions → deterministic Node script → free LLM completion → Slack. The goal is unchanged: daily remote Ruby on Rails remote-job research delivered to Slack **#jobs**, matched against the hardcoded profile, with match scoring, prioritizing worldwide/international-remote roles.

## Goals / non-goals

Goals:
- Daily 07:50 WIB (Asia/Jakarta) = `50 0 * * *` UTC; one dispatch via `github_actions_trigger`; deterministic pipeline; report posted to #jobs (or a ⚠️ note on failure).
- Match score 0–100 per the original rubric (Rails 25 / seniority 20 / remote-from-Indonesia 20 / full-stack 10 / backend arch 10 / stack 5 / salary 5 / credibility 5), classified Excellent/Strong/Good/Moderate/Low.
- Location eligibility classification: `worldwide`, `international` (restrictions noted), `country-restricted`, `regional/timezone`; digest prioritizes the first two.
- Only verified postings from the four sources; freshness ≤ 30 days (API-provided dates where available); dedupe by URL and normalized title+company.
- LLM never rewrites facts: it only scores/classifies/annotates; URLs, titles, companies pass through untouched.

Non-goals (v1):
- LinkedIn/Indeed/Wellfound/SEEK/JobStreet/Wantedly/Green/Saramin/JobKorea/etc. — no free/scrapable APIs; excluded and disclosed in the digest footer ("sources searched").
- Auto-apply, saved searches, Job Match tracking in D1.
- Per-job notifications for "90+" matches (one consolidated message instead).

## Approach

Same architecture as the pilot:
`Cloudflare cron (50 0 * * * UTC) → D1 dispatch → GitHub Actions → scripts/rails-job-search.mjs → Slack #jobs`
`AI chain: Groq (openai/gpt-oss-120b, JSON mode) → fall back to Cloudflare / other configured providers → ⚠️ note if all fail.`
`DRY_RUN=true` prints the would-be message; `AI_STUB=true` exercises the pipeline offline without model calls.

### Data sources (all free, no auth)
- **Remotive** — `https://remotive.com/api/remote-jobs?search=ruby` (filter ruby/rails mentions client-side; JSON with description, publication date, candidate_required_location, url).
- **Remote OK** — `https://remoteok.com/api?tag=ruby` (JSON; first element is the legal notice; fields: position, company, location, date, url, tags, salary).
- **We Work Remotely RSS** — `https://weworkremotely.com/categories/remote-ruby-on-rails-jobs.rss` (items with title, link, description, pubDate; parse `<item>` blocks).
- **Hacker News Who is Hiring** — Algolia: latest "Ask HN: Who is hiring?" story (`search_by_date?query=%22who%20is%20hiring%22&tags=story`), then `items/<id>` comment tree; keep comments mentioning `rails` (case-insensitive); extract URL/location best-effort via regex. Marked best-effort; failures are isolated per-source (one failing source never kills the run).

Each source is best-effort: failures are logged and skipped; if ALL sources fail, the run posts a ⚠️ note (never a fabricated digest).

### Pipeline
1. Fetch all four sources in parallel (per-source timeout, tolerate failures; require ≥ 1 source with ≥ 1 job else ⚠️ note).
2. Normalize → `{source, company, title, url, postedAt, location, description, salaryHint}`; enforce Rails/Ruby relevance for loose matches; dedupe by normalized URL and (normalized company + title); drop items older than 30 days when a date exists; sort by date desc; cap at 40 candidates for the LLM call.
3. Build scoring prompt: candidate profile (condensed from `prompts/rails-job-search.md` — title, 12+ yrs, Rails/React, remote-from-Indonesia preference, target countries/regions) + candidate list (index-tagged, ~300 chars desc each). LLM returns strict JSON: `{jobs: [{index, score, tier, eligibility, restricts, why}], summary}` — `tier` ∈ Excellent/Strong/Good/Moderate/Low; `eligibility` ∈ worldwide/international/country-restricted/regional; `restricts` = restriction note or "".
4. Render digest: header (date, sources, counts) → **Top matches** grouped by Excellent/Strong/Good (Good included only if ≥ 5 jobs shown; else include Moderate to fill), each: company/title · location tag · score · why (1 line) · apply URL → "Also found (Moderate/Low): N jobs not shown" → footer with sources searched + freshness note + fallback note if any source failed.
5. Split > 3,500 chars into ≤ 3 consecutive #jobs messages. Post via `chat.postMessage` (bot token, `SLACK_JOBS_CHANNEL_ID`), verify `ok:true`; failure → ⚠️ note (already working pattern).

### Files
- `scripts/rails-job-search.mjs` — pipeline (zero deps), ~350–450 lines.
- `.github/workflows/rails-job-search.yml` — same skeleton as trending (Node 20, dry_run input, concurrency `rails-job-search`, `if: failure()` notifier skipped on dry runs / when `failure-posted` marker exists).
- `migrations/0007_rails_job_search.sql` — `github-trending`-style enabled=0 row: `id=rails-job-search-daily`, cron `50 0 * * *`, `next_run_at=2099-01-01`, `job_type=github_actions_trigger`, `workflow=rails-job-search.yml`.
- Local `AI_STUB=true` for offline verification.

### Secrets (new)
- `SLACK_JOBS_CHANNEL_ID` — channel ID for #jobs (bot needs `chat:write` and must be a member).

### Constraints / rules (kept from original prompt)
- Never invent vacancies, companies, salaries, dates, or URLs — LLM annotates only; every URL passes through from source APIs.
- Freshness note on every entry (date or "date unknown").
- Eligibility flags distinguish worldwide vs restricted; never infer Indonesia-eligibility from "Remote" alone — use listing text or mark "restriction unknown".
- No DMs; #jobs only; one digest per run; honest failure reporting.
- Zero spend; JSON mode + one retry; failure → ⚠️ note.

## Verification plan
1. `AI_STUB=true node scripts/rails-job-search.mjs` → parses all four sources, prints composed #jobs message.
2. Local `DRY_RUN=true` with real AI chain → verify scores/format sanity (manually inspect: are known worldwide-remote Rails roles scored high?).
3. Live `workflow_dispatch` with `dry_run=true` → logs must show collection counts, any skipped sources, composed message, **zero Slack calls**.
4. Live `dry_run=false` → exactly one digest (possibly split) in #jobs.
5. Enabling the D1 row is a separate owner go-ahead (`enabled=1`, next 00:50 UTC).

## Known limitations / accepted for v1
- Source coverage is narrower than the original prompt (4 sources vs ~30 named platforms); the digest footer discloses exactly which sources were searched and which failed.
- HN hiring-thread comment parsing is best-effort and may produce noisy entries; still scored but flagged `source: HN Who is hiring`.
- Match scores are LLM judgment; they prioritize review, not auto-apply.
- Slack free workspace; no message guarantees (same as pilot).
- Scoring is per-run, not tracked across days (no "already notified" dedup).

## Builder's call
- Exact regex/RSS-parse approach for WWR/HN; per-source field mapping details; prompt wording for the scoring call; message split points; candidate cap.

## Owner checklist before first run
- [ ] `SLACK_JOBS_CHANNEL_ID` secret created for #jobs (bot invited to the channel)
- [ ] Approve this document
- [ ] (After verification) explicit `enabled=1` for the D1 row
