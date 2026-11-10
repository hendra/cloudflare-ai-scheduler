# Cloudflare AI Scheduler

Cloudflare Workers + D1 + Queues + Workers AI scheduler — and, since late 2026, the host of several **zero-spend content automations** delivered to Slack and to GitHub PRs.

## What this repo runs today

| Automation | Schedule (UTC) | Destination | Status |
|---|---|---|---|
| GitHub Trending Top 10 (`github-trending-daily`) | `50 23 * * *` (06:50 WIB) | Slack `#news` | **enabled** |
| Rails remote job search (`rails-job-search-daily`) | `50 0 * * *` (07:50 WIB) | Slack `#jobs` | **enabled** |
| RailsDev.io blog writer (`railsdev-blog-writer`) | `0 1 * * *` (08:00 WIB) | PR on `hendra/railsdev-site` | **enabled** |
| FullstackWeb.dev blog writer (`fullstackweb-blog-writer`) | `30 1 * * *` (08:30 WIB) | PR on `hendra/fullstackwebdev-site` | **enabled** |
| INASOFT blog writer (`inasoft-blog-writer`) | `0 2 * * *` (09:00 WIB) | PR on `hendra/inasoft-site` | **enabled** |
| IG Reel pipeline (`ig-reel-daily`) | manual / future | Buffer | disabled |

All pipelines are deterministic, zero-dependency Node 20 scripts (one file each, plus `scripts/ai-providers.mjs` / `scripts/make-cover.py`). No agent tool-calling; 1–2 LLM completions per run.

**Production default model: OpenRouter `@preset/ai-scheduler`** with fallbacks `openrouter,groq,cloudflare`. Local development: **Ollama `gemma4:e2b`** (configurable via `OLLAMA_*`).

## Architecture

Two dispatch paths share the D1 `schedulers` table:

1. **Worker dispatcher** (this repo, `src/index.ts`): cron → D1 due rows → Queue → `executeJob` → Workers AI / RSS / HTTP / `github_actions_trigger` → D1 history.
2. **GitHub Actions pipelines** (`scripts/*.mjs` called from `.github/workflows/*.yml`): triggered by cron (independent of the Worker) or `workflow_dispatch`. They are **not** routed through the Worker's queue.

AI provider chain (all pipelines): `AI_PROVIDER` (default `openrouter`) → `AI_FALLBACKS` (`openrouter,groq,cloudflare`) → skip providers without credentials; retry without `response_format` on Groq `json_validate_failed`.

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
#    D1_DATABASE_ID and MANUAL_RUN_TOKEN are required; provider keys and PAT scopes are documented there.

npm run dev                              # dev server
curl http://localhost:8787/health
```

`wrangler.jsonc` is gitignored and **generated** from `wrangler.template.jsonc` by `npm run gen:config` (auto-runs before `dev`/`deploy`/migrations). Edit the template, never the generated file.

Production:

```bash
npm run db:migrate:remote          # apply pending migrations
npm run typecheck && npm run deploy
```

## Managing jobs

All admin is via D1 SQL through Wrangler or `/api/*` with `Authorization: Bearer $MANUAL_RUN_TOKEN`. See `docs/status.md`.

```bash
npx wrangler d1 execute scheduler-db --remote --command \
  "SELECT id, name, enabled, cron_expression, next_run_at FROM schedulers ORDER BY priority"
```

## Documentation

- `docs/status.md` — production state, live rows, secrets inventory, operational gotchas.
- `docs/superpowers/specs/` · `docs/superpowers/plans/` — approved designs and implementation plans.
- `AGENTS.md` — runtime conventions and PRs.
- `prompts/` — original Claude Scheduler prompts (goals retained, execution rewritten for CI).

## Security

- Never commit `.dev.vars` or real tokens. `gen:config` writes only local files.
- **`prompts/1.md` originally contained a plaintext Cloudflare API token.** It was scrubbed before any commit; treat the token as compromised — rotate it if you haven't already.
- `GITHUB_PAT` is used for workflow dispatch; site repos use `RAILSDEV_PAT` / `FULLSTACKWEB_PAT` / `INASOFT_PAT` scoped to contents+PRs of those repos only.
- Slack tokens are bot tokens (`xoxb-…`) with `chat:write`; `not_allowed_token_type` means wrong token type / scope / missing invite.
- Production OpenRouter key (`@preset/ai-scheduler`) lives only in GitHub Actions secrets and local `.dev.vars`.

## Migration status map

| Prompt | Automation | State |
|---|---|---|
| 2 | GitHub Trending daily → #news | ✅ live (PR #19/#20-era pipeline) |
| 3 | Rails remote jobs → #jobs | ✅ live |
| 4 | RailsDev.io blog → PR | ✅ live |
| 5 | FullstackWeb.dev blog → PR | ✅ live (first PR 2026-11-10 via #36) |
| 6 | INASOFT blog → PR | ✅ live (first PR `inasoft-site#64`) |
| 7 | INASOFT news digest → #news | ⏳ not started |
| 8 | GitHub Trending weekly → #news | ⏳ not started |
| 1 | IG Reel pipeline | ⏳ deferred, workflow scaffold exists |
