# Cloudflare AI Scheduler

Cloudflare Workers + D1 + Queues + Workers AI scheduler — and, since late 2026, the host of several **zero-spend content automations** delivered to Slack and to GitHub PRs.

## What this repo runs today

| Automation | Schedule (UTC) | Destination | Status |
|---|---|---|---|
| GitHub Trending Top 10 (`github-trending-daily`) | `50 23 * * *` (06:50 WIB) | Slack `#news` | **enabled** |
| GitHub Trending weekly (`github-trending-weekly`) | `10 0 * * 1` (Mon 07:10 WIB) | Slack `#news` | **enabled** |
| Rails remote job search (`rails-job-search-daily` + `-2000`) | 06:45 + 20:00 WIB | Slack `#jobs` | **enabled** |
| RailsDev.io blog writer (`railsdev-blog-writer` + `-1130`, `-1620`) | 07:45 + 11:30 + 16:20 WIB | PR on `hendra/railsdev-site` | **enabled** |
| FullstackWeb.dev blog writer (`fullstackweb-blog-writer` + `-1130`, `-1620`) | 07:45 + 11:30 + 16:20 WIB | PR on `hendra/fullstackwebdev-site` | **enabled** |
| INASOFT blog writer (`inasoft-blog-writer` + `-1130`, `-1620`) | 07:45 + 11:30 + 16:20 WIB | PR on `hendra/inasoft-site` | **enabled** |
| IG Reel pipeline (`ig-reel-daily` + 3 sibling rows) | 4 rows — `15 1`, `45 4`, `35 9`, `30 12` UTC (08:15, 11:45, 16:35, 19:30 WIB) | Instagram @kaliajatau.id via Buffer | **enabled** |

Pipelines are deterministic. Most are zero-dependency Node 20 scripts (one file each, plus `scripts/ai-providers.mjs` / `scripts/make-cover.py`); the IG Reel is a Python orchestrator (`scripts/ig_reel_daily.py`; pip deps installed in the workflow). No agent tool-calling; 1–2 LLM completions per run.

**Production default model: OpenCode Console `glm-5.3-flash`** (opencode.ai) with fallback `openrouter` (preset `@preset/ai-scheduler`).

## Architecture

Two dispatch paths share the D1 `schedulers` table:

1. **Worker dispatcher** (this repo, `src/index.ts`): cron → D1 due rows → Queue → `executeJob` → Workers AI / RSS / HTTP / `github_actions_trigger` → D1 history.
2. **GitHub Actions pipelines** (`scripts/*.mjs` called from `.github/workflows/*.yml`): `workflow_dispatch` only, invoked by the Worker scheduler (D1 `schedulers` rows where `job_type = github_actions_trigger`). They are **not** routed through the Worker's queue.

AI provider chain (all pipelines): `AI_PROVIDER` (default `opencode`) → `AI_FALLBACKS` (`openrouter`) → skip providers without credentials. OpenCode Console speaks the OpenAI chat-completions API at `https://opencode.ai/inference/go/openai/v1` and needs `OPENCODE_API_KEY` (`oc_sk_…`).

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

All admin is via D1 SQL through Wrangler or `/api/*` with `Authorization: Bearer $MANUAL_RUN_TOKEN` — **every** `/api/*` route (reads included) requires the bearer token, checked in constant time. See `docs/status.md`.

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
- Production OpenCode Console key (`OPENCODE_API_KEY`) and the OpenRouter fallback key live only in GitHub Actions secrets and local `.dev.vars`.

## Migration status map

| Prompt | Automation | State |
|---|---|---|
| 2 | GitHub Trending daily → #news | ✅ live (PR #19/#20-era pipeline) |
| 3 | Rails remote jobs → #jobs | ✅ live |
| 4 | RailsDev.io blog → PR | ✅ live |
| 5 | FullstackWeb.dev blog → PR | ✅ live (first PR 2026-11-10 via #36) |
| 6 | INASOFT blog → PR | ✅ live (first PR `inasoft-site#64`) |
| 7 | INASOFT news digest → #news | ✅ live |
| 8 | GitHub Trending weekly → #news | ✅ live |
| 1 | IG Reel pipeline → Instagram @kaliajatau.id | ✅ live (first Reel 2026-11-11, confirmed `sent` via Buffer) |
