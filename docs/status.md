# Production status — Cloudflare AI Scheduler

**Last updated:** 2026-11-12 — hardening pass after full code review: `/api/*` routes all require the bearer token; dispatcher claims execution rows (queue re-delivery safe); overdue runs >15 min skipped and re-armed from `now`; migration `0018_production_state` brings the D1 rows in line with production (all 18 `github_actions_trigger`, `enabled=1`); pipeline scripts fail jobs only when Slack accepts the failure note (`failure-posted` contract); IG kit vendored into `scripts/ig-kit/`; pip/actions pinned. Also: `github-trending-weekly` enabled 2026-11-11 (Mon 07:10 WIB); **`ig-reel-daily` enabled (08:15 WIB), first Reel confirmed `sent` (https://www.instagram.com/reel/DflBHH1jFFC/)**; image fallback chain added.
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
| `inasoft-news-digest` | `.github/workflows/inasoft-news-digest.yml` | daily tech/AI digest → #news |
| `railsdev-blog-writer` | `.github/workflows/railsdev-blog-writer.yml` | draft PR on railsdev-site |
| `fullstackweb-blog-writer` | `.github/workflows/fullstackweb-blog-writer.yml` | draft PR on fullstackwebdev-site |
| `inasoft-blog-writer` | `.github/workflows/inasoft-blog-writer.yml` | Bahasa Indonesia draft PR on inasoft-site |
| `ig-reel` | `.github/workflows/ig-reel.yml` | Interesting Facts Reel → IG @kaliajatau.id via Buffer |

## Secrets inventory (names only)

**GitHub repo secrets** (cloudflare-ai-scheduler): `CF_ACCOUNT_ID`, `CF_API_TOKEN` (IG Reel images + Cloudflare Workers AI text fallback), `GROQ_API_KEY` (Groq text fallback), `OPENROUTER_API_KEY` (fallback preset `@preset/ai-scheduler`), `OPENCODE_API_KEY` (opencode.ai Console, `oc_sk_…` — set 2026-11-12; workspace has **no Go subscription and no credits**, see gotcha 1a), `RAILSDEV_PAT`, `FULLSTACKWEB_PAT`, `INASOFT_PAT` (Contents RW + PR RW, each scoped to its site), `SLACK_BOT_TOKEN` (xoxb, `chat:write`), `SLACK_NEWS_CHANNEL_ID`, `SLACK_JOBS_CHANNEL_ID`, `SLACK_RAILSDEV_CHANNEL_ID`, `SLACK_FULLSTACKWEBDEV_CHANNEL_ID`, `SLACK_INASOFT_CHANNEL_ID`, **IG Reel:** `BUFFER_ACCESS_TOKEN`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `POLLINATIONS_SECRET_KEY`, plus (optional, currently unusable on free tier) `GOOGLE_API_KEY` (image chain + Gemini text fallback), `GOOGLE_IMAGE_MODEL`, `HF_TOKEN`, `HF_IMAGE_MODEL`.

**Actions variables:** `OPENCODE_MODEL` (unset; code default `glm-5.3-flash`), `OPENCODE_BASE_URL` (set to `https://opencode.ai/inference/openai/v1` — pay-as-you-go), `PUBLIC_FORMSPREE_FORM_ID` (`xaeeywav`, public), `AI_PROVIDER` (unset; code default `opencode`), `AI_FALLBACKS` (unset; code default `openrouter,groq,gemini,cloudflare`), plus optional `BUFFER_CHANNEL_ID` / `BUFFER_ORG_ID` (default to the playbook values) and `IMAGE_ORDER` for the IG Reel image chain.

**Read routes:** every `/api/*` GET (`/api/schedulers`, `/api/executions`, `/api/usage`) requires `Authorization: Bearer $MANUAL_RUN_TOKEN` (constant-time comparison). Set `MANUAL_RUN_TOKEN` via `wrangler secret put`.

**Worker secrets** (`wrangler secret put`): `GITHUB_PAT` (dispatch), `MANUAL_RUN_TOKEN`.

**Local `.dev.vars`** (gitignored): `D1_DATABASE_ID`, `MANUAL_RUN_TOKEN`, `OPENROUTER_API_KEY` (local testing), `GROQ_API_KEY`, `OPENCODE_API_KEY` / `OPENCODE_MODEL`; for the IG Reel locally also `BUFFER_ACCESS_TOKEN`, `CLOUDINARY_*`, `POLLINATIONS_SECRET_KEY`, `GOOGLE_API_KEY`, `HF_TOKEN`. Template: `.dev.vars.example`.

## Operational gotchas (learned the hard way)

1. **AI chain is `opencode` → `openrouter` → `groq` → `gemini` → `cloudflare`** (2026-11-12: Groq, Cloudflare, Gemini, Cerebras, Mistral and Ollama were re-added to `scripts/ai-providers.mjs` after the OpenCode-only cut, because OpenCode has no credits and the OpenRouter free cap is small). Primary = OpenCode Console (opencode.ai), model `glm-5.3-flash` ("GLM-5.3-Flash", $0.15/$0.50 per 1M), base `https://opencode.ai/inference/openai/v1` (pay-as-you-go; Go plan = `https://opencode.ai/inference/go/openai/v1`), key `OPENCODE_API_KEY` (`oc_sk_…`), override with `OPENCODE_MODEL` / `OPENCODE_BASE_URL` (also a repo variable). Fallbacks = OpenRouter preset `@preset/ai-scheduler` → Groq `openai/gpt-oss-120b` → Gemini `gemini-3.5-flash` (key `GEMINI_API_KEY` or `GOOGLE_API_KEY`) → Cloudflare Workers AI `@cf/openai/gpt-oss-120b`; `cerebras`, `mistral`, `ollama` are registered but skipped without keys. **Console free-tier chat models are OpenCode-client-only** — CI gets HTTP 429 `FreeUsageLimitError` for `*-free` models even with a key, so CI needs a Go plan or a paid model id + workspace credits. Model catalog: `curl https://opencode.ai/inference/v1/models` (pay-as-you-go, 85 models) and `https://opencode.ai/inference/go/v1/models` (Go, 30 models).
1a. **OpenCode Console plan vs. credits (measured 2026-11-12 in CI, key `oc_sk_…`, org `org_01M77RE0CMX9JCT11HCWXRAB5H`):** the Go base answers **HTTP 403** `permission_error` "An active OpenCode Go subscription is required to use OpenCode Go models"; the pay-as-you-go base answers **HTTP 402** `invalid_request_error` "Insufficient balance" for a paid model and **HTTP 429** `FreeUsageLimitError` for `*-free`. The key itself is valid — it reaches the API. So CI can only run opencode with **credits on the workspace** (top-up link in the 402 body: `https://opencode.ai/console/org_01M77RE0CMX9JCT11HCWXRAB5H/billing?credits=1`) or an **active Go subscription** (then set `OPENCODE_BASE_URL` to the Go base). Until then the OpenRouter fallback carries the pipelines (free tier = 50 requests/day, resets 00:00 UTC).
1b. **A hard usage-limit 429 is not waited out**: `callModel` skips the ≤70s wait when the body says "free usage limit reached" / "insufficient balance" — waiting cannot clear it, so the chain falls through to the next provider at once.
2. **OpenRouter with preset `@preset/ai-scheduler`** is the fallback provider; keep the Bearer token in GitHub secrets, not in code or workflows-as-text.
3. **JSON mode is a preference, not a contract.** All scripts catch `json_validate_failed` and retry once **without** `response_format`.
4. **Cloudflare Neurons are shared**: ~10k/day, and CF 429s are normal — CF is the last AI fallback for the pipelines (`@cf/openai/gpt-oss-120b`) and also backs the IG Reel image chain via `CF_ACCOUNT_ID` / `CF_API_TOKEN`.
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
17. **OpenRouter `@preset/ai-scheduler` routes to a reasoning model** (`nemotron-3.5-lightning:free` as of 2026-11-11) that returns `content: null` when the reasoning budget eats `max_tokens` — every call was "empty completion" and the chain silently fell back. All OpenRouter calls now send `reasoning: { exclude: true }` (no reasoning tokens, whole budget for the body). `reasoning: { effort: "none" }` is **rejected by the preset with HTTP 400** ("Model call failed: invalid request") — measured 2026-11-12; `effort` values `low`/`minimal`/`high` and `exclude: true` are accepted. Override with `OPENROUTER_REASONING_EFFORT` (sends `effort` instead of `exclude`) or set `OPENROUTER_MODEL` explicitly.
18. **IG Reel image chain (owner override of playbook "CF-only")**: images go Cloudflare Workers AI → Google AI Studio (`GOOGLE_API_KEY`) → Hugging Face serverless (`HF_TOKEN`) → Pollinations.ai. **Reality check 2026-11-11:** Google's Free Tier has *0 image quota* (429 `limit: 0 … on Free Tier`) and HF's `hf-inference` provider deprecated image models (410/400) — both fail fast and are skipped. Pollinations does the real work: **with `POLLINATIONS_SECRET_KEY` (`sk_…`) the pipeline uses the modern `gen.pollinations.ai/image` endpoint — Bearer auth, no per-IP pacing, no watermark.** Without a key it falls back to the classic endpoint (1 image / 45 s per IP, 3× retry incl. 402/503, watermark bottom-right). First live Reel confirmed `sent` via Buffer (https://www.instagram.com/reel/DflBHH1jFFC/).
19. **Worker trigger tick is every 5 minutes** (`crons: ["*/5 * * * *"]`, set 2026-11-11): queue dispatch wakes on the 5-minute grid. Every `cron_expression` in `schedulers` stays on 00/05…55 — anything else fires ≤5 min late.
20. **Stray `<<<<<<< HEAD` marker shipped in #58 (commit `fea6554`)**: the hand-resolved `git cherry-pick --continue` pushed the in-progress conflict text; two merges later nobody noticed. **Rule going forward:** after EVERY conflict/cherry-pick resolution, scan the working tree for markers (`git grep -n -E '^(<<<<<<< |>>>>>>> )' -- .`) before committing — never commit an in-progress resolution. CI now runs the same check on every PR. Marker removed in PR #61 (`1347dd6`) and rule added here.
21. **Site-repo PATs broke 2026-11-10 evening** (`RAILSDEV_PAT` / `FULLSTACKWEB_PAT` / `INASOFT_PAT`): pushes 403 (`Write access to repository not granted`) or `gh pr create` fails with `GraphQL: Resource not accessible by personal access token (createPullRequest)`. Articles generated fine — only the git/PR stage died. All three PATs need **Contents: RW + Pull requests: RW** on their site repo; re-mint them if 403/`Resource not accessible` returns. Separately, the blog-writer validation retry only regenerated the **body**, so description/slug/keyword validation errors could never self-correct — scripts now clamp over-limit descriptions at a word boundary and issue a metadata-only fix call before the body retry. Branches pushed but never PR'd can be PR'd manually (2026-11-11: fullstackwebdev-site #23, #24; inasoft #64 was merged by hand after its create failed). Astro schema description caps differ per site and must match the writer scripts: railsdev-site `min(120).max(160)` (= writer), inasoft-site `max(160)` (writer was 180 — articles passed the writer then failed `astro build` with `description: Too big`; writer now clamps/validates at 160), fullstackwebdev-site `z.string()` (unbounded). Astro error output was also swallowed by `out.slice(-500)` + ANSI escapes — writers now strip escapes and print the last 30 non-empty lines (PR #64).

22. **OpenRouter free tier = 50 free-model requests/day**, shared by every pipeline on the key, resetting 00:00 UTC (`x-ratelimit-reset` = epoch ms of the next midnight). When it runs out the API answers HTTP 429 `Rate limit exceeded: free-models-per-day` **with no `retry-after`** → the chain falls through to the next provider immediately (waiting would be pointless). 2026-11-12: the cap was the root cause of the `inasoft-blog-writer` failures (11 of 15 runs failed with `only 563 words (need >= 1500)`) — the fallbacks then in use (Groq `gpt-oss-20b`, CF `llama-3.3-70b`) cannot reach 1500 words. **A $10 OpenRouter top-up raises the free-model limit to 1000 requests/day** — owner/billing decision, not a code change.

23. **Restored AI fallbacks (2026-11-12)** — chain is `opencode → openrouter → groq → gemini → cloudflare` again. Measured live with the repo keys: opencode **HTTP 402** (no credits), openrouter **HTTP 429** (free daily cap), groq `openai/gpt-oss-120b` **OK**, gemini **OK**, cloudflare `@cf/openai/gpt-oss-120b` **OK**. Model traps: `gemini-2.5-flash` → **HTTP 404** "no longer available to new users" (use `gemini-3.5-flash`, the current default); `gemini-3.8-flash` / `gemini-flash-latest` → **HTTP 503** high demand. Groq rejects `response_format: json_object` unless the prompt contains the word "json" (**HTTP 400**) — the pipeline prompts do. Cloudflare `gpt-oss-120b` returns **empty completion** when `max_tokens` is tiny (the reasoning budget eats it) — pipelines use 2800.

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
