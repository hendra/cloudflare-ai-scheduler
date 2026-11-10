# Production status — Cloudflare AI Scheduler

**Last updated:** 2026-11-11 (all local dates Asia/Jakarta; cron fields UTC)
**Scope:** what is running, where secrets live, and the non-obvious fixes that make it work.
If you change something here, update this file.

## Live D1 row shape (`schedulers` table)

| id | enabled | cron (UTC) | WIB | next_run_at | destination |
|---|---|---|---|---|---|
| `github-trending-daily` | 1 | `50 23 * * *` | 06:50 | 2026-11-10T23:50:00.000Z | #news |
| `rails-job-search-daily` | 1 | `50 0 * * *` | 07:50 | 2026-11-11T00:50:00.000Z | #jobs |
| `rails-blog-writer` | 0 | `0 1 * * *` (manual) | manual | 2099-… | railsdev-site PR |
| `ig-reel-daily` | 0 | `15 10 * * *` | manual | 2099-… | ig-reel GHA workflow |

Apply pending migrations: `npm run db:migrate:remote`. **The remote DB required `0007` to be applied manually — local migrations do not propagate.**

Enable/disable:
```bash
npx wrangler d1 execute scheduler-db --remote --command \
  "UPDATE schedulers SET enabled=1, next_run_at='2026-11-11T00:50:00.000Z' WHERE id='rails-job-search-daily'"
npx wrangler d1 execute scheduler-db --remote --command \
  "UPDATE schedulers SET enabled=0 WHERE id='rails-job-search-daily'"
```

## GitHub Actions workflows in this repo

| Workflow | File | Purpose |
|---|---|---|
| `ci` | `.github/workflows/ci.yml` | typecheck on push/PR |
| `github-trending` | `.github/workflows/github-trending.yml` | daily top-10 → #news; deterministic pipeline |
| `rails-job-search` | `.github/workflows/rails-job-search.yml` | daily jobs digest → #jobs |
| `rails-blog-writer` | `.github/workflows/rails-blog-writer.yml` | draft PR on railsdev-site |
| `ig-reel` | `.github/workflows/ig-reel.yml` | IG Reel pipeline (Python Pillow/ffmpeg) |
| `github-trending` is `workflow_dispatch` + dispatched by `github_actions_trigger` job type in the Worker. |

Verify locally: `npm run typecheck`; verify CI: every PR.

## Secrets inventory (names only; values live elsewhere)

**GitHub repo secrets** (cloudflare-ai-scheduler): `CF_ACCOUNT_ID`, `CF_API_TOKEN`, `GROQ_API_KEY`, `RAILSDEV_PAT` (contents/PR RW on `hendra/railsdev-site` only), `SLACK_BOT_TOKEN` (xoxb, chat:write), `SLACK_NEWS_CHANNEL_ID`, `SLACK_JOBS_CHANNEL_ID`.

**Actions variables:** `GROQ_MODEL` (deleted; code default is now `openai/gpt-oss-20b`), `PUBLIC_FORMSPREE_FORM_ID`, `AI_*` (unset; defaults in code).

**Worker secrets** (`wrangler secret put`): `GITHUB_PAT` (dispatch scope), `MANUAL_RUN_TOKEN`.

**Local `.dev.vars`** (gitignored): `D1_DATABASE_ID`, `MANUAL_RUN_TOKEN`, `GROQ_API_KEY` (added for local testing). Template: `.dev.vars.example`.

## Operational gotchas (learned the hard way)

1. **Groq `openai/gpt-oss-120b` is unusable for structured JSON on free keys**: always returns `json_validate_failed` for even trivial meta prompts, emits empty completions, and is capped at 8k TPM. Use `openai/gpt-oss-20b` everywhere. Code default was changed; remove `GROQ_MODEL` Actions variable.
2. **JSON mode is a preference, not a contract.** All scripts catch `json_validate_failed` and retry once **without** `response_format` (`callCompletion` helper).
3. **Wording matters less than structure.** Prompt-validation by proprietary validators is unreliable; keep JSON asks small, retry with feedback, and run a tolerant regex extraction.
4. **Cloudflare Neurons are shared**: ~10k/day across everything; CF often hits 429 before GHA runs. Groq is primary; CF is fallback only.
5. **GitHub Actions `workflow_dispatch` needs the workflow on the default branch** — you can't dispatch a branch-only workflow.
6. **`gh` CLI can't run `if: failure()`-style dispatch without the workflow existing on main.** Merge first.
7. **We Work Remotely is Cloudflare-gated** (empty 301 / JS challenge). Source disclosed as ❌ in the digest footer, never silently absent.
8. **Astro build is the schema enforcer**: if `pubDate`, `cover`, `description` 120–160 chars, etc. are wrong, `npm run build` fails and the pipeline aborts with a ⚠️ note — never a bad PR.
9. **Stacked PRs get merged into the wrong base.** If PR A:branch→B:branch and B is merged, A does not retarget. Cherry-pick onto `main` and open a fresh PR.
10. **Never `git stash pop` a change into a branch that will delete the tracked file.** The ig-reel deletion stash from the pre-merge state could have clobbered the merged pipeline.
11. **`not_allowed_token_type`** on `chat.postMessage` = wrong Slack token (xapp-, Client Secret, Signing Secret, or user token where bot token required), or app not installed/lacks `chat:write` or isn't invited to the channel.
12. **Migrations don't auto-apply remotely** (`0007` required manual `db:migrate:remote`).
13. **Direct push to `main` is an anti-pattern that already happened once** (`8b0b7f9`, reverted in #27). Use PRs for everything; `gh pr create` with the repo's PR checklist.

## Slack destinations

- `#news` (`SLACK_NEWS_CHANNEL_ID`) — trending digest (daily), failure notes
- `#jobs` (`SLACK_JOBS_CHANNEL_ID`) — Rails jobs digest (daily)
- `#railsdev` (`SLACK_RAILSDEV_CHANNEL_ID`) — blog-writer PR summaries (bot is in the channel; one summary per PR, never the article body)

## Verification checklist (before enabling any row)

```bash
# 1. typecheck
npm run typecheck
# 2. dry run on main with no Slack posts
gh workflow run github-trending.yml --ref main -f dry_run=true && gh run watch
gh workflow run rails-job-search.yml --ref main -f dry_run=true && gh run watch
# 3. confirm D1 row disabled until ready
npx wrangler d1 execute scheduler-db --remote --command "SELECT id, enabled FROM schedulers"
# 4. enable
npx wrangler d1 execute scheduler-db --remote --command \
  "UPDATE schedulers SET enabled=1, next_run_at='<next UTC>' WHERE id='…'"
```

## Security notes

- Cloudflare API token leaked in `prompts/1.md` (never committed). Treat as compromised; rotate.
- `GITHUB_PAT` has `repo` scope on this repo only (dispatch of `workflow_dispatch`).
- `RAILSDEV_PAT` is scoped to `hendra/railsdev-site` (Contents RW + PR RW).
- `PUBLIC_FORMSPREE_FORM_ID` (Actions **variable**, not secret) — public value read from railsdev.io homepage.
