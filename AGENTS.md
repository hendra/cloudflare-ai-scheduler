# AGENTS.md

Cloudflare Workers + D1 + Queues + Workers AI scheduler. Single Worker, no dashboard. Since Nov 2026 also the origin of several **GitHub Actions content pipelines** (see `docs/status.md`).

## Commands

- Install: `npm install`
- Dev server: `npm run dev` (Wrangler dev; loads `.dev.vars`)
- Typecheck: `npm run typecheck` (`tsc --noEmit`, only `src/**/*.ts`)
- Deploy: `npm run typecheck && npm run deploy` (manual; no CI deploys)
- Local DB setup: `npm run db:migrate:local`
- Remote DB setup: `npm run db:migrate:remote` ← **migrations don't propagate remotely; run this after adding a migration**
- `wrangler.jsonc` is gitignored and generated from `wrangler.template.jsonc` by `npm run gen:config`, which reads `D1_DATABASE_ID` from `.dev.vars` (auto-runs before `dev`/`deploy`/migration commands). Edit the template, never the generated file.
- No tests or lint scripts. Verification = `npm run typecheck` + `curl` checks (`/health`, `/api/schedulers`, `/api/executions`, `/api/usage`).
- Manual run: `POST /api/run` with `Authorization: Bearer $MANUAL_RUN_TOKEN` and body `{"schedulerId":"..."}`.

## Architecture

- Worker: `src/index.ts` (fetch/scheduled/queue), `src/cron.ts` (UTC cron parser), `src/types.ts`, `src/index.ts` also dispatches `github_actions_trigger` jobs to arbitrary GitHub repos.
- Bindings (wrangler.template.jsonc): `DB` (D1), `AI` (Workers AI binding), `JOB_QUEUE` (Queue).
- Job types: `ai_prompt`, `rss_ai_digest`, `http_check`, `github_actions_trigger`.
- Queue: max batch 5, 3 retries, dead-letter `scheduler-jobs-dlq`.
- Pipelines (`scripts/*.mjs`): `github-trending-digest.mjs` (daily #news), `rails-job-search.mjs` (daily #jobs), `rails-blog-writer.mjs` (PR-only pilot on railsdev-site). Deterministic, zero-npm-dep Node 20 scripts — no agent tool-calling anywhere (free-model tool-calls are unreliable on current free tiers).
- AI chain (all pipelines): `AI_PROVIDER` (default `groq`) → fallbacks `cloudflare,gemini,cerebras,openrouter,mistral` → skip providers without keys; retry without `response_format` on Groq `json_validate_failed`.
- D1 rows: `github-trending-daily` (enabled), `rails-job-search-daily` (enabled), `rails-blog-writer` (manual), `ig-reel-daily` (disabled).

## Non-obvious gotchas

- **Cron is UTC-only** in `src/cron.ts`; `timezone` column is cosmetic. Convert local schedules before storing `cron_expression`.
- **DOM/DOW semantics are non-standard**: if either is `*`, both must match; otherwise OR.
- **`nextCronOccurrence` scans minute-by-minute** (~1 year worst case). Fine for 5-field cron.
- **Queue is at-least-once**; `scheduler_executions UNIQUE(scheduler_id, scheduled_for)` dedups; handlers must stay idempotent.
- **Migrations apply every `.sql` file in `migrations/`**; adding one creates a pending migration. Seeds were removed (0002 empty, 0006 deletes old rows).
- **`wrangler.template.jsonc`** holds binding config; the generated `wrangler.jsonc` is gitignored.
- **AI model availability changes.** `DEFAULT_AI_MODEL` (`@cf/google/gemma-4-26b-a4b-it`) must be verified against the current catalog; `QUALITY_AI_MODEL` empty = all tasks use the lightweight model. Per-job `input_json.model` must start with `@cf/`.
- **`MAX_AI_RUNS_PER_DAY`** is a reserved-attempt counter, not a Neuron meter.
- **`force: true`** on `executeJob` bypasses `enabled`.
- **Groq is the default free brain** for pipelines; `openai/gpt-oss-120b` is unusable for structured JSON on free keys and capped at 8k TPM; use `openai/gpt-oss-20b`. Cloudflare Neurons are shared and exhaust daily (~10k/day).
- **Astro schema gates the pipelines** — if a generated `.md` fails `astro build`, the run aborts with a ⚠️ Slack note, never a bad PR.
- **We Work Remotely is Cloudflare-gated** (empty 301). Jobs digest lists it as ❌ in the footer; do not "fix" by scraping harder.
- **Typecheck covers `src/**/*.ts` only**; new files outside `src/` aren't checked unless `tsconfig.json` is updated.
- **No automated tests.** Don't claim a test suite; verify via typecheck + curl + a `dry_run=true` dispatch.

## Pull requests

Never commit directly to `main`; every change lands via a PR. PR descriptions follow GitHub best practice: a `## Summary` (what and why, linked spec/plan where one exists), a `## What …`/scope section with concrete bullets, a `## Verification` checklist with real commands/outcomes, `## Out of scope` where relevant, and refs to related PRs. Keep them scannable and honest — don't claim checks that weren't run. **Stacked PRs don't rebase onto `main` automatically** — cherry-pick onto fresh `main` and open a new PR.

## Migrated automations (prompts 1–8)

| Prompt | Status |
|---|---|
| 2 (Trending daily → #news) | ✅ live |
| 3 (Rails jobs → #jobs) | ✅ live |
| 4 (RailsDev blog → PR) | ✅ built, one PR open (`hendra/railsdev-site#28`), manual only |
| 5 (FullstackWeb.dev blog) | ⏳ not started |
| 6 (INASOFT blog) | ⏳ not started |
| 7 (INASOFT news digest) | ⏳ not started |
| 8 (Trending weekly) | ⏳ not started |
| 1 (IG Reel) | ⏳ deferred; workflow scaffolded, untested E2E |

See `docs/status.md` for production state, secrets inventory, and command cheatsheets.
