# Production status — Cloudflare AI Scheduler

**Last updated:** 2026-11-11 — `github-trending-weekly` enabled (Mon 07:10 WIB); **`ig-reel-daily` enabled (17:15 WIB), first Reel confirmed `sent` (https://www.instagram.com/reel/DflBHH1jFFC/)**; image fallback chain added
**Purpose:** what is running, where secrets live, and the non-obvious fixes that make it work.
If you change something here, update this file.

## Live D1 row shape (`schedulers`)

| id | enabled | cron (UTC) | WIB | next_run_at | destination |
|---|---|---|---|---|---|
| `github-trending-daily` | 1 | `50 23 * * *` | 06:50 | `2026-11-10T23:50:00.000Z` | #news |
| `github-trending-weekly` | 1 | `10 0 * * 1` | Mon 07:10 | `2026-11-16T00:10:00.000Z` | #news |
| `rails-job-search-daily` | 1 | `45 23 * * *` | 06:45 | `2026-11-10T23:45:00.000Z` | #jobs |
| `rails-job-search-daily-2000` | 1 | `0 13 * * *` | 20:00 | `2026-11-11T13:00:00.000Z` | #jobs |
| `railsdev-blog-writer` | 1 | `45 0 * * *` | 07:45 | `2026-11-11T00:45:00.000Z` | railsdev-site PR |
| `railsdev-blog-writer-1130` | 1 | `30 4 * * *` | 11:30 | `2026-11-11T04:30:00.000Z` | railsdev-site PR |
| `railsdev-blog-writer-1620` | 1 | `20 9 * * *` | 16:20 | `2026-11-11T09:20:00.000Z` | railsdev-site PR |
| `fullstackweb-blog-writer` | 1 | `45 0 * * *` | 07:45 | `2026-11-11T00:45:00.000Z` | fullstackwebdev-site PR |
| `fullstackweb-blog-writer-1130` | 1 | `30 4 * * *` | 11:30 | `2026-11-11T04:30:00.000Z` | fullstackwebdev-site PR |
| `fullstackweb-blog-writer-1620` | 1 | `20 9 * * *` | 16:20 | `2026-11-11T09:20:00.000Z` | fullstackwebdev-site PR |
| `inasoft-blog-writer` | 1 | `45 0 * * *` | 07:45 | `2026-11-11T00:45:00.000Z` | inasoft-site PR |
| `inasoft-blog-writer-1130` | 1 | `30 4 * * *` | 11:30 | `2026-11-11T04:30:00.000Z` | inasoft-site PR |
| `inasoft-blog-writer-1620` | 1 | `20 9 * * *` | 16:20 | `2026-11-11T09:20:00.000Z` | inasoft-site PR |
| `inasoft-news-digest` | 1 | `30 2 * * *` | 09:30 | `2026-11-11T02:30:00.000Z` | #news |
| `ig-reel-daily` | 1 | `15 1 * * *` | 08:15 | `2026-11-11T01:15:00.000Z` | ig-reel GHA workflow → Instagram |
| `ig-reel-daily-1145` | 1 | `45 4 * * *` | 11:45 | `2026-11-11T04:45:00.000Z` | ig-reel → Instagram |
| `ig-reel-daily-1635` | 1 | `35 9 * * *` | 16:35 | `2026-11-11T09:35:00.000Z` | ig-reel → Instagram |
| `ig-reel-daily-1930` | 1 | `30 12 * * *` | 19:30 | `2026-11-11T12:30:00.000Z` | ig-reel → Instagram |

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
| `github-trending-weekly` | `.github/workflows/github-trending-weekly.yml` | weekly top-10 → #news |
| `rails-job-search` | `.github/workflows/rails-job-search.yml` | daily jobs digest → #jobs |
| `railsdev-blog-writer` | `.github/workflows/railsdev-blog-writer.yml` | draft PR on railsdev-site |
| `fullstackweb-blog-writer` | `.github/workflows/fullstackweb-blog-writer.yml` | draft PR on fullstackwebdev-site |
| `inasoft-blog-writer` | `.github/workflows/inasoft-blog-writer.yml` | Bahasa Indonesia draft PR on inasoft-site |
| `ig-reel` | `.github/workflows/ig-reel.yml` | Interesting Facts Reel → IG @kaliajatau.id via Buffer |

## Secrets inventory (names only)

**GitHub repo secrets** (cloudflare-ai-scheduler): `CF_ACCOUNT_ID`, `CF_API_TOKEN`, `GROQ_API_KEY`, `OPENROUTER_API_KEY` (production `@preset/ai-scheduler`), `RAILSDEV_PAT`, `FULLSTACKWEB_PAT`, `INASOFT_PAT` (Contents RW + PR RW, each scoped to its site), `SLACK_BOT_TOKEN` (xoxb, `chat:write`), `SLACK_NEWS_CHANNEL_ID`, `SLACK_JOBS_CHANNEL_ID`, `SLACK_RAILSDEV_CHANNEL_ID`, `SLACK_FULLSTACKWEBDEV_CHANNEL_ID`, `SLACK_INASOFT_CHANNEL_ID`, **IG Reel:** `BUFFER_ACCESS_TOKEN`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `POLLINATIONS_SECRET_KEY`, plus (optional, currently unusable on free tier) `GOOGLE_API_KEY`, `GOOGLE_IMAGE_MODEL`, `HF_TOKEN`, `HF_IMAGE_MODEL`.

**Actions variables:** `GROQ_MODEL` (deleted; code default `openai/gpt-oss-20b`), `PUBLIC_FORMSPREE_FORM_ID` (`xaeeywav`, public), `AI_PROVIDER`, `AI_FALLBACKS` (unset; code defaults), plus optional `BUFFER_CHANNEL_ID` / `BUFFER_ORG_ID` (default to the playbook values) and `IMAGE_ORDER` for the IG Reel image chain.

**Worker secrets** (`wrangler secret put`): `GITHUB_PAT` (dispatch), `MANUAL_RUN_TOKEN`.

**Local `.dev.vars`** (gitignored): `D1_DATABASE_ID`, `MANUAL_RUN_TOKEN`, `GROQ_API_KEY`, `OPENROUTER_API_KEY` (local testing), plus `OLLAMA_BASE_URL` / `OLLAMA_MODEL`; for the IG Reel locally also `BUFFER_ACCESS_TOKEN`, `CLOUDINARY_*`, `POLLINATIONS_SECRET_KEY`, `GOOGLE_API_KEY`, `HF_TOKEN`. Template: `.dev.vars.example`.

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
17. **OpenRouter `@preset/ai-scheduler` routes to a reasoning model** (`nemotron-3.5-lightning:free` as of 2026-11-11) that returns `content: null` when the reasoning budget eats `max_tokens` — every call was "empty completion" and the chain silently fell back to Groq. All OpenRouter calls now send `reasoning.effort: "none"` (override via `OPENROUTER_REASONING_EFFORT`). If the preset is ever re-pointed to another reasoning model, keep this or set `OPENROUTER_MODEL` explicitly (pick a non-reasoning free model).
18. **IG Reel image chain (owner override of playbook "CF-only")**: images go Cloudflare Workers AI → Google AI Studio (`GOOGLE_API_KEY`) → Hugging Face serverless (`HF_TOKEN`) → Pollinations.ai. **Reality check 2026-11-11:** Google's Free Tier has *0 image quota* (429 `limit: 0 … on Free Tier`) and HF's `hf-inference` provider deprecated image models (410/400) — both fail fast and are skipped. Pollinations does the real work: **with `POLLINATIONS_SECRET_KEY` (`sk_…`) the pipeline uses the modern `gen.pollinations.ai/image` endpoint — Bearer auth, no per-IP pacing, no watermark.** Without a key it falls back to the classic endpoint (1 image / 45 s per IP, 3× retry incl. 402/503, watermark bottom-right). First live Reel confirmed `sent` via Buffer (https://www.instagram.com/reel/DflBHH1jFFC/).
19. **Worker trigger tick is every 5 minutes** (`crons: ["*/5 * * * *"]`, set 2026-11-11): queue dispatch wakes on the 5-minute grid. Every `cron_expression` in `schedulers` stays on 00/05…55 — anything else fires ≤5 min late.
20. **Stray `<<<<<<< HEAD` marker shipped in #58 (commit `fea6554`)**: the hand-resolved `git cherry-pick --continue` pushed the in-progress conflict text; two merges later nobody noticed. **Rule going forward:** after EVERY conflict/cherry-pick resolution, scan the working tree for markers (`git grep -n -E '^(<<<<<<< |>>>>>>> )' -- .`) before committing — never commit an in-progress resolution. CI now runs the same check on every PR. Marker removed in PR #61 (`1347dd6`) and rule added here.
21. **Site-repo PATs broke 2026-11-10 evening** (`RAILSDEV_PAT` / `FULLSTACKWEB_PAT` / `INASOFT_PAT`): pushes 403 (`Write access to repository not granted`) or `gh pr create` fails with `GraphQL: Resource not accessible by personal access token (createPullRequest)`. Articles generated fine — only the git/PR stage died. All three PATs need **Contents: RW + Pull requests: RW** on their site repo; re-mint them if 403/`Resource not accessible` returns. Separately, the blog-writer validation retry only regenerated the **body**, so description/slug/keyword validation errors could never self-correct — scripts now clamp over-limit descriptions at a word boundary and issue a metadata-only fix call before the body retry. Branches pushed but never PR'd can be PR'd manually (2026-11-11: fullstackwebdev-site #23, #24; inasoft #64 was merged by hand after its create failed).

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
