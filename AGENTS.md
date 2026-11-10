# AGENTS.md

Cloudflare Workers + D1 + Queues + Workers AI scheduler. Single Worker, no dashboard.

## Commands

- Install: `npm install`
- Dev server: `npm run dev` (Wrangler dev; loads `.dev.vars`)
- Typecheck: `npm run typecheck` (`tsc --noEmit`, only `src/**/*.ts`)
- Deploy: `npm run typecheck && npm run deploy`
- Local DB setup: `npm run db:migrate:local && npm run db:seed:local`
- Remote DB setup: `npm run db:migrate:remote && npm run db:seed:remote`
- There are **no tests or lint scripts**. Verification = `npm run typecheck` + manual `curl` checks (`/health`, `/api/schedulers`, `/api/executions`, `/api/usage`).
- Manual run: `POST /api/run` with `Authorization: Bearer $MANUAL_RUN_TOKEN` and body `{"schedulerId":"..."}`. Requires `MANUAL_RUN_TOKEN` (local: `.dev.vars`; prod: `wrangler secret put`).

## Architecture

- Entrypoints: `src/index.ts` (Worker `fetch`/`scheduled`/`queue` handlers), `src/cron.ts` (cron parser), `src/types.ts`.
- Bindings (see `wrangler.jsonc`): `DB` (D1), `AI` (Workers AI), `JOB_QUEUE` (Queue). Vars in `wrangler.jsonc` `vars`; secrets via Wrangler.
- Flow: Cron `* * * * *` -> `dispatchDueJobs` (D1 due rows) -> Queue -> `executeJob` (AI/RSS/HTTP check) -> D1 history.
- Job types: `ai_prompt`, `rss_ai_digest`, `http_check`, `github_actions_trigger` (dispatches a GitHub Actions workflow; requires `GITHUB_PAT` secret).
- Queue: max batch 5, 3 retries, dead-letter `scheduler-jobs-dlq`. `scheduled` handler wraps dispatch in `ctx.waitUntil`.

## Non-obvious gotchas

- **Cron is UTC-only.** `src/cron.ts` evaluates expressions against UTC. The `timezone` column is not used for conversion. Convert local schedules to UTC before storing `cron_expression`. Note seed file comments claim Asia/Jakarta interpretation, but the parser treats expressions as UTC.
- **Cron DOM/DOW semantics are non-standard.** If either day-of-month or day-of-week is `*`, both must match (AND); otherwise either (OR). Don't assume full cron semantics when editing `src/cron.ts`.
- **`nextCronOccurrence` scans minute-by-minute up to ~1 year** (527040 iterations). Fine for 5-field expressions.
- **Queue delivery is at-least-once.** `scheduler_executions` has `UNIQUE(scheduler_id, scheduled_for)` to guard duplicate dispatch, but handlers must stay idempotent before adding side effects.
- **Seed jobs are disabled** with `next_run_at = 2099-...`. To test manually, set one row's `enabled=1` and `next_run_at` to a past UTC timestamp.
- **Migrations apply every file in `migrations/`**, including any seed files present. Adding a new `.sql` file there makes it a pending migration.
- **`.dev.vars` is gitignored** (see `.gitignore`); template is `.dev.vars.example`. Don't commit real secrets; use `wrangler secret put` in production.
- **AI model availability changes.** Default `@cf/google/gemma-4-26b-a4b-it` (in `wrangler.jsonc`) must be verified against the current catalog/free eligibility. `QUALITY_AI_MODEL` defaults to empty, so all tasks use the lightweight model unless configured. Per-job override in `input_json` must start with `@cf/`.
- **`MAX_AI_RUNS_PER_DAY` is implemented** in `reserveAiRun` as a reserved counter (not a Neuron meter). `daily_usage.ai_runs` counts inference attempts.
- **Manual run with `force: true` bypasses the `enabled` check** in `executeJob`.
- **Typecheck scope is `src/**/*.ts` only**; new files outside `src/` won't be checked unless `tsconfig.json` is updated.
- **No automated tests exist.** Don't claim a test suite; verify via typecheck + curl.<|end|><|start|><|start|>assistant<|channel|>analysis<|message|>I created AGENTS.md. Let me verify file.<|end|><|start|><|start|>assistant to=shell<|channel|>analysis <|constrain|>xml<|message|><rfl:parameter name="command">
cd /home/hendra/Documents/projects/personal/cloudflare-ai-scheduler && wc -l AGENTS.md && cat AGENTS.md | head -5