# Cloudflare AI Scheduler

Cloudflare Workers + D1 + Queues + Workers AI scheduler. Single Worker, no dashboard — and, since late 2026, the home of three **zero-spend content automations** delivered straight to Slack (trending digests, a Rails jobs digest) and to a GitHub PR (RailsDev blog writer).

## What this repo runs today

| Automation | Schedule (UTC) | Destination | Status |
|---|---|---|---|
| GitHub Trending Top 10 (`github-trending-daily`) | `50 23 * * *` (06:50 WIB) | Slack `#news` | **enabled** |
| Rails remote job search (`rails-job-search-daily`) | `50 0 * * *` (07:50 WIB) | Slack `#jobs` | **enabled** |
| RailsDev blog writer (`rails-blog-writer`, `enabled=0`) | manual dispatch | PR on `hendra/railsdev-site` | manual only |
| IG Reel pipeline (`ig-reel-daily`, `enabled=0`) | manual / future | Buffer | disabled |

Backing model: **Groq `openai/gpt-oss-20b`** (default in all pipelines) with fallback to Cloudflare Workers AI (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`). Zero spend is a hard constraint; free tiers are shared and rate-limited, so pipelines degrade to a ⚠️ Slack note rather than a fake digest.

## Architecture

Two dispatch paths coexist:

1. **Worker dispatcher** (this repo, `src/index.ts`): cron → D1 due rows → Queue → `executeJob` → Workers AI / RSS / HTTP / `github_actions_trigger` → D1 history. `github_actions_trigger` jobs POST to a workflow dispatch endpoint on any GitHub repo (used for `ig-reel-daily`).
2. **GitHub Actions pipelines** (`scripts/*.mjs`, one workflow each): triggered by `github_actions_trigger` or `workflow_dispatch`. Deterministic, zero-npm-dependency Node scripts (or, for the blog writer, more steps) run headless OpenCode only where agentic tool-calling is justified — which, as of Nov 2026, is nowhere; all pipelines use a fixed pipeline with one or two LLM completions.

AI provider chain (same in all pipelines): `AI_PROVIDER` (default `groq`) → `AI_FALLBACKS` (`cloudflare,gemini,cerebras,openrouter,mistral`) → skip providers without credentials; retry without `response_format` on `json_validate_failed`.

## Setup

```bash
npm install
npx wrangler login

# 1. Create D1 + queues, put database_id in .dev.vars
npx wrangler d1 create scheduler-db           # → database_id → .dev.vars as D1_DATABASE_ID
npx wrangler queues create scheduler-jobs
npx wrangler queues create scheduler-jobs-dlq
npm run db:migrate:local

# 2. Worker secret (manual API / github_actions_trigger)
npx wrangler secret put GITHUB_PAT            # classic PAT with `repo` scope

# 3. .dev.vars (gitignored; see .dev.vars.example)
#    D1_DATABASE_ID and MANUAL_RUN_TOKEN are required; provider keys optional.

npm run dev                              # dev server
curl http://localhost:8787/health
```

`wrangler.jsonc` is gitignored and **generated** from `wrangler.template.jsonc` by `npm run gen:config` (auto-runs before `dev`/`deploy`/migrations). Edit the template, never the generated file.

Production:

```bash
npm run db:migrate:remote          # apply pending migrations (e.g. 0007)
npm run typecheck && npm run deploy
```

## Managing jobs

All admin is via D1 SQL through Wrangler or `/api/*` with `Authorization: Bearer $MANUAL_RUN_TOKEN`. See `docs/status.md` for the live-row dump, enable/disable commands, and the secrets inventory.

```bash
npx wrangler d1 execute scheduler-db --remote --command \
  "SELECT id, name, enabled, cron_expression, next_run_at FROM schedulers ORDER BY priority"
```

## Documentation

- `docs/status.md` — production state, live rows, secrets inventory, operational gotchas, prompt-migration scorecard.
- `docs/superpowers/specs/` · `docs/superpowers/plans/` — approved designs and implementation plans (trending digest, rails jobs, railsdev blog writer).
- `AGENTS.md` — commands, runtime gotchas, PR conventions.
- `prompts/` — the original Claude Scheduler prompts (goals retained, execution rewritten for CI).

## Security

- Never commit `.dev.vars` or real tokens. `gen:config` writes only local files.
- **`prompts/1.md` originally contained a plaintext Cloudflare API token.** It was scrubbed and never committed to Git history, but the token must be treated as compromised — rotate/revoke it.
- `GITHUB_PAT` used for dispatch only; site repos use `RAILSDEV_PAT` scoped to contents+PRs of that repo only.
- Slack tokens are bot tokens (`xoxb-…`) with `chat:write`; failure with `not_allowed_token_type` means the wrong token type was set, or the bot isn't installed / lacks the scope.
- RSS and API payloads are untrusted input; scripts only pass through verified fields.

## Status of the Claude Scheduler migration

| Prompt | Automation | State |
|---|---|---|
| 2 | GitHub Trending daily → #news | ✅ live, enabled 06:50 WIB |
| 3 | Rails remote jobs → #jobs | ✅ live, enabled 07:50 WIB |
| 4 | RailsDev.io blog → PR | ✅ PR open `hendra/railsdev-site#28`; writer built & verified; manual only |
| 5, 6 | FullstackWeb.dev / INASOFT blog writers | ⏳ not started (same pattern as #4) |
| 7 | INASOFT news digest → #news | ⏳ not started |
| 8 | GitHub Trending weekly → #news | ⏳ not started (same pipeline, `since=weekly`) |
| 1 | IG Reel pipeline | ⏳ deferred; workflow exists but untested end-to-end |
