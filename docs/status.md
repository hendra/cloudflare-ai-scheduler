# Production status — Cloudflare AI Scheduler

**Last updated:** 2026-11-11 (all dates Asia/Jakarta; cron fields UTC)
**Purpose:** what is running, where secrets live, and the non-obvious fixes that make it work.
If you change something here, update this file.

## Live D1 row shape (`schedulers`)

| id | enabled | cron (UTC) | WIB | next_run_at | destination |
|---|---|---|---|---|---|
| `github-trending-daily` | 1 | `50 23 * * *` | 06:50 | `2026-11-10T23:50:00.000Z` | #news |
| `rails-job-search-daily` | 1 | `50 0 * * *` | 07:50 | `2026-11-11T00:50:00.000Z` | #jobs |
| `railsdev-blog-writer` | 1 | `0 1 * * *` | 08:00 | `2026-11-11T01:00:00.000Z` | railsdev-site PR |
| `fullstackweb-blog-writer` | 1 | `30 1 * * *` | 08:30 | `2026-11-11T01:30:00.000Z` | fullstackwebdev-site PR |
| `inasoft-blog-writer` | 1 | `0 2 * * *` | 09:00 | `2026-11-11T02:00:00.000Z` | inasoft-site PR |
| `inasoft-news-digest` | 1 | `30 2 * * *` | 09:30 | `2026-11-11T02:30:00.000Z` | #news |
| `ig-reel-daily` | 0 | `15 10 * * *` | manual | `2099-01-01T00:00:00.000Z` | ig-reel GHA workflow |

Apply pending migrations: `npm run db:migrate:remote`. Remote migrations required manual fixes historically (e.g. 0007); always run it after adding a migration.

```bash
npx wrangler d1 execute scheduler-db --remote --command \
  "SELECT id, enabled FROM schedulers"
npx wrangler d1 execute scheduler-db --remote --command \
  "UPDATE schedulers SET enabled=0 WHERE id='railsdev-blog-writer'"
```

## GitHub Actions workflows in this repo

| Workflow | File | Purpose |
|---|---|---|
| `ci` | `.github/workflows/ci.yml` | typecheck on push/PR |
| `github-trending` | `.github/workflows/github-trending.yml` | daily top-10 → #news |
| `rails-job-search` | `.github/workflows/rails-job-search.yml` | daily jobs digest → #jobs |
| `railsdev-blog-writer` | `.github/workflows/railsdev-blog-writer.yml` | draft PR on railsdev-site |
| `fullstackweb-blog-writer` | `.github/workflows/fullstackweb-blog-writer.yml` | draft PR on fullstackwebdev-site |
| `inasoft-blog-writer` | `.github/workflows/inasoft-blog-writer.yml` | Bahasa Indonesia draft PR on inasoft-site |
| `ig-reel` | `.github/workflows/ig-reel.yml` | IG Reel pipeline (Python Pillow/ffmpeg) |

## Secrets inventory (names only)

**GitHub repo secrets** (cloudflare-ai-scheduler): `CF_ACCOUNT_ID`, `CF_API_TOKEN`, `GROQ_API_KEY`, `OPENROUTER_API_KEY` (production `@preset/ai-scheduler`), `RAILSDEV_PAT`, `FULLSTACKWEB_PAT`, `INASOFT_PAT` (Contents RW + PR RW, each scoped to its site), `SLACK_BOT_TOKEN` (xoxb, `chat:write`), `SLACK_NEWS_CHANNEL_ID`, `SLACK_JOBS_CHANNEL_ID`, `SLACK_RAILSDEV_CHANNEL_ID`, `SLACK_FULLSTACKWEBDEV_CHANNEL_ID`, `SLACK_INASOFT_CHANNEL_ID`.

**Actions variables:** `GROQ_MODEL` (deleted; code default `openai/gpt-oss-20b`), `PUBLIC_FORMSPREE_FORM_ID` (`xaeeywav`, public), `AI_PROVIDER`, `AI_FALLBACKS` (unset; code defaults).

**Worker secrets** (`wrangler secret put`): `GITHUB_PAT` (dispatch), `MANUAL_RUN_TOKEN`.

**Local `.dev.vars`** (gitignored): `D1_DATABASE_ID`, `MANUAL_RUN_TOKEN`, `GROQ_API_KEY`, `OPENROUTER_API_KEY` (local testing), plus `OLLAMA_BASE_URL` / `OLLAMA_MODEL`. Template: `.dev.vars.example`.

## Operational gotchas (learned the hard way)

1. **Groq `openai/gpt-oss-120b` is unusable for structured JSON on free keys**: always returns `json_validate_failed`, emits empty completions, 8k TPM. Use `openai/gpt-oss-20b`.
2. **OpenRouter with preset `@preset/ai-scheduler`** is the production default; keep the Bearer token in GitHub secrets, not in code or workflows-as-text.
3. **JSON mode is a preference, not a contract.** All scripts catch `json_validate_failed` and retry once **without** `response_format`.
4. **Cloudflare Neurons are shared**: ~10k/day. CF 429s are normal; Groq primary + CF fallback pattern applies.
5. **`workflow_dispatch` needs the workflow on the default branch**; branch-only dispatches 404.
6. **We Work Remotely is Cloudflare-gated** (empty 301 / JS challenge). Source disclosed as ❌ in the digest footer.
7. **Astro build is the schema enforcer**: pubDate, cover, description 120–160 chars, etc. If wrong, `astro build` fails and the pipeline aborts with a ⚠️ Slack note.
8. **Stacked PRs don't retarget**: cherry-pick onto `main`.
9. **Never `git stash pop` into a branch whose deletion could clobber a tracked file** (ig-reel deletion stash incident).
10. **`not_allowed_token_type`** on `chat.postMessage` = wrong Slack token type, missing scope, or bot not in channel.
11. **Migrations don't auto-apply remotely**; always `npm run db:migrate:remote` after adding a migration.
12. **Direct push to `main` is an anti-pattern that already happened once** (`8b0b7f9`, reverted in #27). Use PRs for everything.
13. **PR #345 (writer)**: `gh pr create` with `--body` heredoc fails under `execSync`; use `--body-file`.
14. **Commit author**: use `*-bot / bot@*.id` per pipeline; don't default to a cross-repo bot name.
15. **`INASOFT_PAT` was initially mismatched** (name vs value for public token); re-check secrets are repo-correct after copying values.
16. **ruff-style commit message discipline matters**: refer to actual file/migration/row names (GHA workflow names are case-sensitive).

## Slack destinations

- `#news` (`SLACK_NEWS_CHANNEL_ID`) — daily GitHub Trending digest, failure notes
- `#jobs` (`SLACK_JOBS_CHANNEL_ID`) — daily Rails remote job search, failure notes
- `#railsdev` (`SLACK_RAILSDEV_CHANNEL_ID`) — blog-writer PR summaries
- `#fullstackwebdev` (`SLACK_FULLSTACKWEBDEV_CHANNEL_ID`) — blog-writer PR summaries
- `#inasoft` (`SLACK_INASOFT_CHANNEL_ID`) — blog-writer PR summaries

## Verification checklist (before enabling any row)

```bash
npm run typecheck
gh workflow run railsdev-blog-writer.yml    --ref main -f dry_run=true && gh run watch
gh workflow run fullstackweb-blog-writer.yml --ref main -f dry_run=true && gh run watch
gh workflow run inasoft-blog-writer.yml      --ref main -f dry_run=true && gh run watch
npx wrangler d1 execute scheduler-db --remote --command "SELECT id, enabled FROM schedulers"
```

## Security notes

- `prompts/1.md` contained a raw Cloudflare token (never committed to Git). Treat as compromised; rotate.
- `GITHUB_PAT` has `repo` scope on this repo only (dispatch).
- Each site PAT is scoped to its site (Contents RW + PR RW) — `RAILSDEV_PAT`, `FULLSTACKWEB_PAT`, `INASOFT_PAT`.
- OpenRouter production key `@preset/ai-scheduler` never in code.
- `PUBLIC_FORMSPREE_FORM_ID=xaeeywav` is public (read from railsdev.io).
