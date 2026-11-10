# AGENTS.md

Cloudflare Workers + D1 + Queues + Workers AI scheduler. Single Worker, no dashboard. Since Nov 2026 also the origin of several **GitHub Actions content pipelines** (see `docs/status.md`).

## Commands

- Install: `npm install`
- Dev server: `npm run dev` (Wrangler dev; loads `.dev.vars`)
- Typecheck: `npm run typecheck` (`tsc --noEmit`, only `src/**/*.ts`)
- Deploy: `npm run typecheck && npm run deploy` (manual; no CI deploys)
- Local DB setup: `npm run db:migrate:local`
- Remote DB setup: `npm run db:migrate:remote` ← **migrations don't auto-apply remotely; run this after adding a migration**
- `wrangler.jsonc` is gitignored and generated from `wrangler.template.jsonc` by `npm run gen:config`. Edit the template, never the generated file.
- No tests or lint scripts. Verification = `npm run typecheck` + `curl` checks + a `dry_run=true` dispatch per workflow.
- Manual run: `POST /api/run` with `Authorization: Bearer $MANUAL_RUN_TOKEN` and body `{"schedulerId":"..."}`.

## Architecture

- Worker: `src/index.ts` (fetch/scheduled/queue), `src/cron.ts` (UTC cron parser), `src/types.ts`. The dispatcher handles `ai_prompt`, `rss_ai_digest`, `http_check`, and `github_actions_trigger`.
- Bindings (wrangler.template.jsonc): `DB` (D1), `AI` (Workers AI binding), `JOB_QUEUE` (Queue).
- Queue: max batch 5, 3 retries, dead-letter `scheduler-jobs-dlq`.
- Pipelines (`scripts/*.mjs`): deterministic, zero-dep Node 20 scripts driven by GitHub Actions
  (`github-trending-digest.mjs`, `rails-job-search.mjs`, `railsdev-blog-writer.mjs`, `fullstackweb-blog-writer.mjs`, `inasoft-blog-writer.mjs`, `inasoft-news-digest.mjs`).
- AI chain (all pipelines): `AI_PROVIDER` (default `openrouter` with preset `@preset/ai-scheduler`) → fallbacks `openrouter,groq,cloudflare` → skip providers without keys; retry without `response_format` on Groq `json_validate_failed`.
- Cover generation shared via `scripts/make-cover.py` + env overrides for branding (title, badge, gradient colors).
- D1 rows enabled (5 base + 10 multi-fire clones): `github-trending-daily`, `github-trending-weekly`, `rails-job-search-daily`, `rails-job-search-daily-2000`, `railsdev-blog-writer`, `railsdev-blog-writer-1130`, `railsdev-blog-writer-1620`, `fullstackweb-blog-writer`, `fullstackweb-blog-writer-1130`, `fullstackweb-blog-writer-1620`, `inasoft-blog-writer`, `inasoft-blog-writer-1130`, `inasoft-blog-writer-1620`, `inasoft-news-digest`, `ig-reel-daily`, `ig-reel-daily-1145`, `ig-reel-daily-1635`, `ig-reel-daily-1930`.

## Non-obvious gotchas

- **Cron is UTC-only** in `src/cron.ts`; `timezone` column is cosmetic. Convert local schedules before storing `cron_expression`.
- **DOM/DOW semantics are non-standard**: if either is `*`, both must match; otherwise OR.
- **`nextCronOccurrence` scans minute-by-minute** (~1 year worst case). Fine for 5-field cron.
- **Worker tick = every 5 minutes** (`crons: ["*/5 * * * *"]` in the wrangler template). Keep all `cron_expression` rows on the 5-minute grid or accept ≤5 min lag on dispatch.
- **Queue is at-least-once**; `scheduler_executions UNIQUE(scheduler_id, scheduled_for)` dedups; handlers must stay idempotent.
- **Migrations apply every `.sql` file in `migrations/`**; adding one creates a pending migration. Seeds were removed (0002 empty, 0006 deletes old rows). Apply migrations to remote yourself: `npm run db:migrate:remote`.
- **`wrangler.template.jsonc`** holds binding config; generated `wrangler.jsonc` is gitignored.
- **AI model availability changes.** `DEFAULT_AI_MODEL` (`@cf/google/gemma-4-26b-a4b-it`) must be verified; `QUALITY_AI_MODEL` empty = all tasks use the lightweight model. Per-job `input_json.model` must start with `@cf/`.
- **`MAX_AI_RUNS_PER_DAY`** is a reserved-attempt counter, not a Neuron meter.
- **`force: true`** on `executeJob` bypasses `enabled`.
- **Groq is the fallback free brain**; production primary is **OpenRouter `@preset/ai-scheduler`** (`openai/gpt-oss-20b` is unusable for structured JSON on free keys; use `openai/gpt-oss-20b` via OpenRouter). Cloudflare Neurons are shared and exhaust daily (~10k/day).
- **Astro schema gates the pipelines** — if a generated `.md` fails `astro build`, the run aborts with a ⚠️ Slack note, never a bad PR.
- **We Work Remotely is Cloudflare-gated** (empty 301). Jobs digest lists it as ❌ in the footer.
- **Typecheck covers `src/**/*.ts` only**; new files outside `src/` aren't checked unless `tsconfig.json` is updated.
- **No automated tests.** Verify via typecheck + curl + a `dry_run=true` dispatch per workflow.

## Pull requests

Never commit directly to `main`; every change lands via a PR. PR descriptions follow GitHub best practice: a `## Summary` (what and why, linked spec/plan where one exists), a `## What …`/scope section with concrete bullets, a `## Verification` checklist with real commands/outcomes, `## Out of scope` where relevant, and refs to related PRs. Keep them scannable and honest — don't claim checks that weren't run. **Stacked PRs don't rebase onto `main` automatically** — cherry-pick onto fresh `main` and open a new PR.

## Migrated automations (prompts 1–8)

| Prompt | Status |
|---|---|
| 2 (Trending daily → #news) | ✅ live |
| 3 (Rails jobs → #jobs) | ✅ live |
| 4 (RailsDev blog → PR) | ✅ live |
| 5 (FullstackWeb.dev blog) | ✅ live |
| 6 (INASOFT blog) | ✅ live |
| 7 (INASOFT news digest → #news) | ✅ live |
| 8 (Trending weekly → #news) | ✅ live |
| 1 (IG Reel → IG @kaliajatau.id via Buffer) | ✅ live |

See `docs/status.md` for production state, secrets inventory, and command cheatsheets.
