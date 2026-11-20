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
- Ledger self-check: `npm run published:selfcheck`.
- AEO/GEO self-check: `npm run aeo:selfcheck`.
- Topic-mix self-check: `npm run topicmix:selfcheck`.
- Hendranicholas blog self-check: `npm run hendranicholas:selfcheck`.
- Grounding self-checks: `npm run grounding:selfcheck`, `npm run blog:grounding:selfcheck`.

## Architecture

- Worker: `src/index.ts` (fetch/scheduled/queue), `src/cron.ts` (UTC cron parser), `src/types.ts`. The dispatcher handles `ai_prompt`, `rss_ai_digest`, `http_check`, and `github_actions_trigger`.
- Bindings (wrangler.template.jsonc): `DB` (D1), `AI` (Workers AI binding), `JOB_QUEUE` (Queue).
- Queue: max batch 5, 3 retries, dead-letter `scheduler-jobs-dlq`.
- Pipelines (`scripts/*.mjs`): deterministic, zero-dep Node 20 scripts driven by GitHub Actions
  (`github-trending-digest.mjs`, `rails-job-search.mjs`, `railsdev-blog-writer.mjs`, `fullstackweb-blog-writer.mjs`, `inasoft-blog-writer.mjs`, `inasoft-news-digest.mjs`).
- AI chain (all pipelines): `AI_PROVIDER` (default `opencode` — OpenCode Console, model `glm-5.3-flash-free`) → fallbacks `opencode,openrouter,groq,gemini,kilo,cloudflare` → skip providers without keys (Kilo's free tier runs keyless); OpenCode Console (`opencode.ai`) needs `OPENCODE_API_KEY` and speaks the OpenAI chat-completions API at `https://opencode.ai/inference/openai/v1`.
- IG Reel: `scripts/ig_reel_daily.py` orchestrates; `scripts/ig_reel/` renders one-story cinematic Reels (story grounding + Indonesian check, scene HTML, per-frame capture, soundtrack). Music = a pre-made track from `scripts/ig_reel/music_library/<account-id>/<mood>-<n>.mp3` (Suno, generated once by the owner from `docs/ig-reel-suno-prompts.md`, leading silence removed and trimmed to 30 s before committing), picked by account + the story's `mood` (`curious` | `wonder` | `energetic` | `mysterious` | `uplifting`, written by the story AI call) + date/slot, then trimmed to 28.6 s, faded and loudness-normalised (−20 LUFS) by ffmpeg (`scripts/ig_reel/library.py`). Mood without a track → any of the account's tracks; account without tracks or a broken file → the numpy synth in `music.py` in the account file's `music.style` (`cinematic` | `electronic`), at the old level. Each account has its own track for all 5 moods (2026-11-18). Check: `python3 scripts/ig_reel/selfcheck.py`. `scripts/ig-kit/` stays byte-identical to the playbook kit. Sources: ScienceDaily, MIT News, NASA (Phys.org article pages are 403 to non-browser clients).
- IG Reel accounts: one workflow, many accounts. `scripts/ig_reel/accounts/<id>.json` (handle, niche, feeds, tip themes with optional `weight` 1-3, pinned Buffer channel + Cloudinary cloud) + GitHub environment `ig-<id>` (that account's secrets, same names) + 4 D1 rows with `inputs.account`. `kaliajatau` = default, repo-level secrets. `ai-labs` (Claude/ChatGPT/Gemini creative tips — photo, video and animation creation/editing first, plus prompt, content, voice, work, learning and coding tips, 27 themes, creative ones weighted 2×; fresh announcement in the morning slot, else a theme tip) is **live** since 2026-11-15 (rows `ig-reel-ai-labs*` enabled, handle `@ailabs01.id`; environment `ig-ai-labs` holds its secrets). A real run refuses to post when its secrets don't match the account file. Add one: `docs/ig-reel-add-account.md`.
- Blog indexing: `scripts/site-index.mjs` — after auto-merge, waits for the article in the live sitemap, then IndexNow (Bing) + Search Console sitemap resubmit (Google, secret `GSC_SERVICE_ACCOUNT_JSON`). Check: `npm run index:selfcheck`.
- Blog covers: `scripts/cover/` — one AI cover-spec JSON (`spec.mjs`), three site skins copied from each site's oldest cover (`templates.mjs`), rendered by headless Chrome (`render.mjs`, `generateCover()`). Check: `npm run cover:selfcheck`. fullstackweb covers are title-less (owner decision).
- Published-items ledger: `migrations/0021_published_items.sql` + `GET/POST /api/published` (Bearer `MANUAL_RUN_TOKEN`); helpers in `scripts/published.mjs` (`canonicalUrl`, `normalizeTitle`, `isSimilarTitle`, `fetchPublished`, `recordPublished`, `loadOpenPrs`, `buildBlogHistory`, `checkTopicCollision`). Check: `npm run published:selfcheck`.
- Blog grounding: `scripts/grounding.mjs` (number normalisation, prose extraction, `fetchSourceText`, `checkGrounding`) + `scripts/blog-grounding.mjs` (`groundArticle`) — all three blog writers fetch every cited page and the chosen signal page, then require each risky number in the prose to appear in those sources. One repair call carries the source texts; still ungrounded → Slack note and `exit 0`, nothing published. `riskyNumbers` exempts four-digit years and counts below 10.
- Shared blog AEO/GEO rules: `scripts/blog-aeo.mjs` (`buildAeoGeoBodyRules`, `validateAeoGeo`, `servicePathFor`, `runSitePostCheck`, `ensureRequiredLinks`, `generateBody`) used by all three blog writers; check: `npm run aeo:selfcheck`. Code inserts the service/contact/signal-source links and `text` fence tags the model forgot (every body, incl. grounding repair); a short draft is expanded, not discarded; still < 1500 words → Slack note and `exit 0`, nothing published (owner decision 2026-11-19). Article bodies call `callModel(..., { prefer: LONGFORM_MODELS })` = groq `qwen/qwen3.8-27b` → gemini `gemma-4-31b-it` (240 s timeout) → normal chain; the blog workflows run `groq,openrouter,gemini,kilo,cloudflare` (no `opencode`: always 429 in CI) with a 45-minute job timeout.
- Every content pipeline reads the ledger before publishing and skips cleanly (exit 0, nothing posted) when nothing new remains. `SCHEDULER_URL` (Actions variable) + `MANUAL_RUN_TOKEN` (Actions secret) are required or real runs fail closed.
- D1 rows enabled (8 base + 4 multi-fire clones; blog writers use one cron-list row each): `github-trending-daily`, `github-trending-weekly`, `rails-job-search-daily`, `rails-job-search-daily-2000`, `railsdev-blog-writer`, `fullstackweb-blog-writer`, `inasoft-blog-writer`, `inasoft-news-digest`, `ig-reel-daily`, `ig-reel-daily-1145`, `ig-reel-daily-1635`, `ig-reel-daily-1930`, `ig-reel-ai-labs`, `ig-reel-ai-labs-1145`, `ig-reel-ai-labs-1635`, `ig-reel-ai-labs-1930`.

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
- **AI provider chain is `opencode` → `openrouter` → `groq` → `gemini` → `kilo` → `cloudflare`** (`scripts/ai-providers.mjs`). Primary: OpenCode Console (opencode.ai), model `glm-5.3-flash-free` ("GLM-5.3-Flash Free", $0), base `https://opencode.ai/inference/openai/v1` (pay-as-you-go; Go plan = `https://opencode.ai/inference/go/openai/v1`), key `OPENCODE_API_KEY` (`oc_sk_…`). Fallbacks: OpenRouter preset `@preset/ai-scheduler` (free tier = 50 free-model requests/day, resets 00:00 UTC), Groq (`openai/gpt-oss-120b`), Gemini (`gemini-3.5-flash`, key `GEMINI_API_KEY` or `GOOGLE_API_KEY`), Kilo AI Gateway (`kilo-auto/free`, base `https://ai-gateway.kilo.ai/api/v1`, key `KILO_API_KEY` optional — anonymous free tier, 200 req/hour/IP), Cloudflare Workers AI (`@cf/openai/gpt-oss-120b`); `cerebras`, `mistral` removed (no keys, no callers); `ollama` stays but skips without keys. **Console free-tier chat models (`*-free`) are OpenCode-client-only** — the default `glm-5.3-flash-free` answers HTTP 429 `FreeUsageLimitError` outside the OpenCode client (measured 2026-11-12), so CI falls through to groq → gemini → kilo → cloudflare; a Go plan or a paid model id (`glm-5.3-flash`) + workspace credits is what makes opencode itself answer.
- **429s are waited out, not skipped**: `callModel` retries the same provider up to 2 times, waiting ≤70s from `retry-after` / `x-ratelimit-reset-tokens`. OpenRouter's daily-cap 429 carries no retry hint → the chain falls through immediately.
- **Astro schema gates the pipelines** — if a generated `.md` fails `astro build`, the run aborts with a ⚠️ Slack note, never a bad PR.
- **We Work Remotely is Cloudflare-gated** (empty 301). Jobs digest lists it as ❌ in the footer.
- **Typecheck covers `src/**/*.ts` only**; new files outside `src/` aren't checked unless `tsconfig.json` is updated.
- **No automated tests.** Verify via typecheck + curl + a `dry_run=true` dispatch per workflow.

## Pull requests

Never commit directly to `main`; every change lands via a PR. **Conflict markers are resolved before committing, always:** after resolving any `git` conflict / cherry-pick, run `git grep -n -E '^(<<<<<<< |>>>>>>> )' -- .` once and confirm it is clean before `git commit` — never commit the in-progress resolution text (see docs/status.md gotcha 20). CI enforces this on every PR. PR descriptions follow GitHub best practice: a `## Summary` (what and why, linked spec/plan where one exists), a `## What …`/scope section with concrete bullets, a `## Verification` checklist with real commands/outcomes, `## Out of scope` where relevant, and refs to related PRs. Keep them scannable and honest — don't claim checks that weren't run. **Stacked PRs don't rebase onto `main` automatically** — cherry-pick onto fresh `main` and open a new PR.

**Cleanup after merge is part of the workflow, not a follow-up request.** Once a PR shows `MERGED` (a closed-but-unmerged PR never qualifies), remove its worktree, then its local branch, then its remote branch, then `git worktree prune`. Order matters: a branch cannot be deleted while a worktree has it checked out, so `git worktree remove <path>` comes first, and never `rm -rf` the directory. Refuse and report instead of forcing when the branch is checked out elsewhere, has commits not in `main`, has uncommitted or untracked files, or still backs an open PR. GitHub now deletes the remote branch on merge (`delete_branch_on_merge=true`), so that step is usually already done. Never touch `main` or a branch another task is using.

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
