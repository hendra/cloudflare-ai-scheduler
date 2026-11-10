# GitHub Trending Digest Pilot — Design

**Date:** 2026-11-10 · **Status:** Draft, pending approval · **Scope:** Pilot only (prompt 2). Prompts 3–8 and the deferred IG Reel (1) come later, one at a time.

## Intent and why

The owner runs eight autonomous "Claude Scheduler" prompts off Claude's cloud. Goal: move them onto a **zero-spend** stack — Cloudflare (schedule/dispatch) + GitHub Actions (execution) — without changing what each prompt achieves. This document covers the pilot: **prompt 2.md, "GitHub Trending Top 10 → Slack #news", daily at 06:50 WIB.**

Hard constraint: zero spend, ever. Anthropic/Claude APIs are ruled out. Everything must fit free tiers (Workers AI free Neurons, free GitHub Actions, free Slack).

## Goals / non-goals

Goals:
- Daily 06:50 Asia/Jakarta (GMT+7) dispatch from the Cloudflare Worker; execution in GitHub Actions; digest posted to Slack **#news** by a bot, message format as specified in `prompts/github-trending-daily.md` (mrkdwn, fallback labeling, failure note on total collection failure).
- Prompt "goal must keep same": find today's GitHub Trending Top 10 (Asia/Jakarta date), verify from github.com/trending (fallback: GitHub search API via `gh`), analyze, post once to #news.
- D1 execution history row records the dispatch (existing `github_actions_trigger` semantics).

Non-goals (pilot):
- Prompts 3–8 migration, IG Reel (1), blog auto-merge pipelines.
- Reading the agent run's outcome back into D1 (see Known limitations).
- Neuron metering/quota enforcement for the GHA path.

Anti-goals: no paid APIs; no posting to any channel other than #news; no inventing star counts; no duplicate posts per run.

## Approaches considered

**A. Custom minimal agent loop in GHA** — a hand-written Node script calling Workers AI's OpenAI-compatible endpoint with tool definitions. Full control; but we build and debug an agent harness ourselves.

**B. Headless OpenCode in GitHub Actions, backed by Workers AI (chosen).** The workflow writes an `opencode.json` defining a custom provider pointed at `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/v1` (API key = CF_API_TOKEN), then runs `opencode run "<contents of prompts/github-trending-daily.md>"` non-interactively. OpenCode is already the agent in use here; it brings bash/web/file tools, CI permissions config, and needs no harness code.
- Why B over A: no custom loop to maintain; same harness the owner already uses interactively. Risk: Workers AI tool-calling quality through the OpenAI-compatible endpoint — must be verified at build time; if it fails, fall back to A (documented escape hatch).

**C. Agent loop inside the Cloudflare Worker** — rejected: long agent runs fight Worker CPU/subrequest limits and burn the shared 10k Neurons/day budget.

## Design

### Schedule & dispatch (Cloudflare side)
- Add `migrations/0005_github_trending.sql` inserting one `schedulers` row:
  - `name`: `GitHub Trending — Daily Top 10 → Slack #news`
  - `job_type`: `github_actions_trigger`
  - `cron_expression`: `50 23 * * *` (UTC; 06:50 WIB = 23:50 UTC the previous day — project cron is UTC-only; `timezone` column is not used for conversion)
  - `timezone`: `Asia/Jakarta` (cosmetic)
  - `prompt`: `GitHub Actions workflow .github/workflows/github-trending.yml executing prompts/github-trending-daily.md` (column is NOT NULL; unused by this job type)
  - `input_json`: `{"owner":"hendra","repo":"cloudflare-ai-scheduler","workflow":"github-trending.yml","ref":"main","inputs":{}}`
  - `enabled`: `0`, `next_run_at`: `2099-01-01 00:00:00` (template pattern) until manually verified
  - `max_retries`: default
- Dispatch path is unchanged: cron → `dispatchDueJobs` → Queue → `executeJob` → `runGitHubActionsTrigger` (existing), which POSTs `/actions/workflows/github-trending.yml/dispatches` with `GITHUB_PAT`.

### Execution (GitHub Actions side)
- New workflow `.github/workflows/github-trending.yml` (this repo — established pattern: `ig-reel.yml` scaffold already lives here):
  - `on: workflow_dispatch` (optional `dry_run: true|false` input, default false)
  - `permissions: contents: read`
  - Steps: checkout → setup Node → `npm i -g opencode-ai` → write `opencode.ci.json` (gitignored or heredoc in the step) with custom provider:
    - `baseURL`: `https://api.cloudflare.com/client/v4/accounts/${{ secrets.CF_ACCOUNT_ID }}/ai/v1`
    - `apiKey`: `${{ secrets.CF_API_TOKEN }}`
    - model id: builder verifies the current free, tool-calling-capable Workers AI model at implementation time (start from `@cf/meta/llama-3.3-70b-instruct-fp8-fast`; adjust per current catalog — model availability changes)
  - Run: `opencode run --print-logs "$(cat prompts/github-trending-daily.md)"` with non-interactive/auto-approve permission config; env: `SLACK_BOT_TOKEN`, `SLACK_NEWS_CHANNEL_ID`, plus `GH_TOKEN` for the `gh` fallback path in the prompt.
  - `timeout-minutes: 20`
- Workflow-level `if: failure()` step posts a short ⚠️ note to #news (covers crashes the prompt's own failure paths can't). (Builder check addition — my call.)
- `dry_run=true`: agent gathers data and prints the would-be Slack message instead of posting (for verification runs).
- **Scope call (owner):** B-only. If Workers AI tool-calling fails verification, the plan stops and Option A becomes a separate, later decision — not built under this plan.
- **Cutover:** the Claude-cloud version of prompt 2 is already off (owner-confirmed), so enabling the D1 row needs no Claude-side gate. `prompts/` in this repo is a copy, not synced to Claude cloud — safe to edit.

### Prompt rewrite (`prompts/github-trending-daily.md` → keep goal, change mechanics)
- Slack section becomes: post via `curl -X POST https://slack.com/api/chat.postMessage` with `Authorization: Bearer $SLACK_BOT_TOKEN`, channel = `$SLACK_NEWS_CHANNEL_ID` (fixed #news channel ID from a secret; no channel search needed). Keep: split into two messages if long, post once, never DM, failure note to #news on total data-collection failure, honest error reporting.
- Date/timezone: Asia/Jakarta. Fetch `https://github.com/trending?since=daily`; fallback `gh api "search/repositories?q=created:>=<yesterday>&sort=stars&order=desc&per_page=10"` labeled "fallback: newly created repos by stars".
- Remove references to Claude-only tools (`slack_search_channels`, "connected Slack integration").
- Everything else (verification rules, categories, mrkdwn template, error handling, final execution report) unchanged in intent.

### Secrets
- Slack bot app with `chat:write` exists and is in #news (owner-confirmed); only the two secrets need creating.
- GitHub repo secrets (this repo): `CF_ACCOUNT_ID`, `CF_API_TOKEN` (new, scoped Workers AI only — the token leaked in `prompts/ig-reel-daily.md` must be rotated/revoked), `SLACK_BOT_TOKEN`, `SLACK_NEWS_CHANNEL_ID`. `GITHUB_TOKEN` (implicit) used for `gh` fallback.
- Worker secret (already required by existing code): `GITHUB_PAT` with `actions: write` on this repo.
- Owner has confirmed both are creatable.

### Data flow
cron (23:50 UTC) → D1 due row (once enabled) → Queue → Worker marks execution `queued→succeeded` at dispatch time and stores "Dispatched workflow …" as `result_text` → GHA workflow runs agent → Slack post (or failure/error report in workflow logs; failure note posted to #news by the agent on total collection failure).

### Verification plan
1. `gh workflow run github-trending.yml -f dry_run=true` → inspect logs; confirm the composed digest looks right, no Slack post.
2. `gh workflow run github-trending.yml -f dry_run=false` → confirm #news receives exactly one message (or one two-part message).
3. Enable the D1 row (`enabled=1`, `next_run_at` = next 23:50 UTC) after both pass; check next morning's `scheduler_executions` row and the Slack post.
4. Watch daily Neuron usage in Cloudflare dashboard for a few days.

## Known limitations (accepted for pilot)
- D1 `scheduler_executions` reflects *dispatch*, not agent outcome; GHA failure is visible only in workflow logs. A signed callback endpoint (`POST /api/gha-callback` with a shared secret, updating the execution row) is the follow-up if needed — deliberately out of pilot scope.
- Shared Workers AI free Neuron budget (~10k/day) is consumed by this job and existing AI jobs; heavy prompts may need re-examination later.
- Workers AI model output quality is unproven for long tool-use loops; fallback is Option A harness.

## Builder's call
- Exact `opencode` CI permission flags and provider JSON shape (verify against installed opencode version at build time).
- Exact Workers AI model id from the current free catalog.
- `dry_run` implementation details.
- Whether `opencode-ai` is pinned (`@latest` vs specific version) — pin if reproducibility matters.

## Owner's checklist before first run
- [ ] Revoke/rotate the Cloudflare token leaked in `prompts/ig-reel-daily.md`; create scoped `CF_API_TOKEN`
- [ ] Create GitHub secrets: `CF_ACCOUNT_ID`, `CF_API_TOKEN`, `SLACK_BOT_TOKEN`, `SLACK_NEWS_CHANNEL_ID`
- [ ] Confirm `GITHUB_PAT` (Worker secret) has Actions write on this repo
- [ ] Approve this document — approval covers the design; enabling the D1 row after verification is a separate explicit go-ahead from the owner
