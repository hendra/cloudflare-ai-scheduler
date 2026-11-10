# GitHub Trending Digest (Pilot) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cloudflare cron at 06:50 WIB dispatches a GitHub Actions workflow daily; the workflow runs headless OpenCode backed by Cloudflare Workers AI to execute `prompts/github-trending-daily.md` (GitHub Trending Top 10 → Slack #news); D1 records the dispatch.

**Architecture:** No Worker code changes. The existing `github_actions_trigger` path (cron → Queue → `executeJob` → `runGitHubActionsTrigger`) dispatches `.github/workflows/github-trending.yml` in this repo. The workflow installs OpenCode, points it at Workers AI's OpenAI-compatible endpoint, and lets it run the prompt as a headless agent. A failure step posts ⚠️ to #news if the run crashes.

**Tech Stack:** Cloudflare Worker (existing, unchanged), D1 (existing), GitHub Actions, `opencode` CLI (headless), Cloudflare Workers AI (OpenAI-compatible endpoint), Slack Web API, `gh` CLI.

**Spec:** `docs/superpowers/specs/2026-11-10-github-trending-digest-design.md`

## Global Constraints

- Zero spend. Workers AI model must be free-tier and present in the current catalog (model availability changes; verify at build time — do not trust any hardcoded id blindly).
- Cron stored UTC: `50 23 * * *` (= 06:50 Asia/Jakarta; project cron is UTC-only, `timezone` column is cosmetic).
- `github_actions_trigger` only dispatches; D1 row stays `enabled = 0` until owner explicitly enables it after verification (separate go-ahead, out of this plan).
- B-only: if Workers AI tool-calling through the OpenAI-compatible endpoint fails verification, STOP — Option A is a separate decision, not this plan.
- Slack delivery uses `curl chat.postMessage` with `$SLACK_BOT_TOKEN` and fixed `$SLACK_NEWS_CHANNEL_ID` (mirrors the rewritten prompt). No channel search, never a DM.
- Secrets live in GitHub Actions repo secrets + Worker `GITHUB_PAT` (existing, Actions write on this repo). Never commit secrets; `.dev.vars` stays untracked.
- Every commit lands via a PR — never push to `main`.
- No Worker code, no `migrations/0002_seed.sql` edits; new seed content goes only in the new `0005` file.

## Review Focus

1. **Workers AI model id drift / no tool-calling support** → `opencode` run errors or loops forever producing garbage; most likely failure. Mitigation is Task 2 Step 5 (catalog check) and Task 4 (dry run gate); if the run can't post a sane digest dry, stop per B-only. Test added in Task 4: dry-run log must contain a parseable digest draft, not an empty/error transcript.
2. **Workflow posts to #news on a dry run by accident** → violates "never posts without approval". Test in Task 4: with `dry_run=true`, the Slack API is never called (grep workflow log for `chat.postMessage` POST → must be absent) and dry run must print the would-be message.
3. **Timezone mismatch: the D1 seed row runs at the wrong hour** → one-hour-off morning digest, silent and embarrassing. Mitigation: plan pins `50 23 * * *` and reviewer re-verifies `timezone: Asia/Jakarta` is cosmetic only; enabling is owner's action with this reminder in the PR body.
4. **Crash before the agent can post anything** (node install, catalog check, opencode startup) leaves #news silent and looks like "no news day" → `if: failure()` step in Task 3 posts ⚠️ with the run URL so silence is never ambiguous.
5. **Duplicate posts on re-run / re-dispatch** (GHA has no dedup; queue is at-least-once and `UNIQUE(scheduler_id, scheduled_for)` covers D1 only) → the prompt instructs single posting; reviewer checks the posted message appears exactly once per name/date before enabling the schedule.

---

### Task 1: Seed the scheduler row (disabled)

**Files:**
- Create: `migrations/0005_github_trending.sql`

**Interfaces:**
- Consumes: existing `schedulers` table shape (see `migrations/0001_initial.sql`): `(id, name, description, enabled, job_type, cron_expression, timezone, prompt, input_json, priority, next_run_at)`
- Produces: row `id = 'github-trending-daily'` that Task 4 references when enabling; `input_json.workflow` must equal the workflow filename `github-trending.yml` created in Task 3.

- [ ] **Step 1: Write the migration**

```sql
-- Daily GitHub Trending Top 10 -> Slack #news via GitHub Actions.
-- Disabled by default; set enabled=1 and next_run_at=<next 23:50 UTC ISO ts> only after manual verification.
INSERT OR IGNORE INTO schedulers
(id, name, description, enabled, job_type, cron_expression, timezone, prompt, input_json, priority, next_run_at)
VALUES
('github-trending-daily', 'GitHub Trending — Daily Top 10 → Slack #news', 'Dispatch GitHub Actions workflow github-trending.yml daily at 06:50 Asia/Jakarta (23:50 UTC previous day).', 0, 'github_actions_trigger', '50 23 * * *', 'Asia/Jakarta',
 'GitHub Actions workflow .github/workflows/github-trending.yml executing prompts/github-trending-daily.md',
 '{"owner":"hendra","repo":"cloudflare-ai-scheduler","workflow":"github-trending.yml","ref":"main","inputs":{}}',
 5, '2099-01-01T00:00:00.000Z');
```

- [ ] **Step 2: Apply locally and verify the row**

Run: `npm run db:migrate:local && npx wrangler d1 execute scheduler-db --local --command "SELECT id, name, enabled, cron_expression, next_run_at, input_json FROM schedulers WHERE id='github-trending-daily'"`
Expected: one row, `enabled=0`, `cron_expression=50 23 * * *`, `next_run_at=2099-01-01T00:00:00.000Z`, input_json as above. (If `db:migrate:local` needs `scheduler-db` locally, it is already configured from the prior local setup.)

- [ ] **Step 3: Verify no other migrations or seeds were added**

Run: `git status --short && git diff --cached --stat`
Expected: only `migrations/0005_github_trending.sql` added.

- [ ] **Step 4: Commit on branch `feat/github-trending-pilot`**

---

### Task 2: Workflow skeleton + Workers AI model verification

No production posts in this task; ends with a valid workflow file and a recorded, verified model id.

**Files:**
- Create: `.github/workflows/github-trending.yml`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: workflow `github-trending.yml` with `workflow_dispatch` trigger and inputs `dry_run` (bool, default `false`); env names `CF_ACCOUNT_ID`, `CF_API_TOKEN`, `SLACK_BOT_TOKEN`, `SLACK_NEWS_CHANNEL_ID`, `GH_TOKEN` — these names are used by Task 3 and Task 4 and must not change.

- [ ] **Step 1: Create branch `feat/github-trending-pilot` from latest `origin/main`**

- [ ] **Step 2: Query the current Workers AI catalog for a free, tool-calling-capable text model**

Run (with `$CF_API_TOKEN` available in your shell or via `gh secret list`; ask the owner for a one-off token if needed — do not print it):

```bash
curl -s "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/ai/models/search?task=text-generation" \
  -H "Authorization: Bearer $CF_API_TOKEN" | python3 -c "import json,sys; [print(m['name']) for m in json.load(sys.stdin)['result']]" | sort
```

Expected: a list of model ids. Pick the strongest tool-calling-capable model on the free tier; first candidate: `@cf/meta/llama-3.3-70b-instruct-fp8-fast`. Record the chosen id and the date in a comment at the top of the workflow file. If NO free tool-calling model exists in the catalog, STOP and report — do not substitute a non-free model (zero-spend constraint).

- [ ] **Step 3: Verify `opencode` non-interactive invocation and permission flags**

Run: `npx opencode --version` and `npx opencode run --help` (install first with `npm install -g opencode-ai` if needed). Record the exact flags that run a prompt non-interactively with tools allowed (e.g., `opencode run "<prompt>"` with permissions configured via config file, not interactive prompts). If the installed version uses a different headless mechanism than `opencode run`, use its documented one instead — this step pins the actual mechanism before the workflow is written.

- [ ] **Step 4: Write the workflow**

Requirements the file must meet (implementer writes the YAML):
- `on: workflow_dispatch: inputs: dry_run (boolean, default false; description: "gather + compose digest but do NOT post to Slack")`
- `permissions: contents: read`
- `timeout-minutes: 20`
- Steps: `actions/checkout@v4` → `actions/setup-node@v4` (node 20, `cache: npm`) → `npm install -g opencode-ai@<exact version verified in Step 3>` → write `opencode.ci.json` (heredoc, NOT committed) → run agent.
- `opencode.ci.json` (version shape verified against the opencode version from Step 3 — provider block with npm package `@ai-sdk/openai-compatible`, `options.baseURL` = `https://api.cloudflare.com/client/v4/accounts/${{ secrets.CF_ACCOUNT_ID }}/ai/v1`, `options.apiKey` = `{env:CF_API_TOKEN}`, and an explicit `models` entry for the model id from Step 2; top-level `model` = `cloudflare/<model-id>`; a restrictive-but-functional `permission` block allowing bash/read/write/webfetch — nothing else).
- Agent step: `opencode run --model cloudflare/<model-id> "$(cat prompts/github-trending-daily.md)$( [ "${{ inputs.dry_run }}" = "true" ] && printf '\n\nDRY RUN OVERRIDE: Do everything except post to Slack. Print the final would-be message (and nothing else) as your last output.' )"` with env `CF_ACCOUNT_ID`, `CF_API_TOKEN`, `SLACK_BOT_TOKEN`, `SLACK_NEWS_CHANNEL_ID`, `GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}`.
- A `if: failure()` step that posts `⚠️ GitHub Trending digest failed — see <run url>` to `https://slack.com/api/chat.postMessage` with `channel: $SLACK_NEWS_CHANNEL_ID`, `Authorization: Bearer $SLACK_BOT_TOKEN`, only when `inputs.dry_run != true`? No — also fine on dry runs; it is a crash notice, not a digest. Either way is safe; keep it unconditional.
- Logs: `echo` the chosen model id and dry_run at step start (no secrets).

- [ ] **Step 5: Validate the YAML**

Run: `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/github-trending.yml'))" && npx prettier --check .github/workflows/github-trending.yml || true`
Expected: parses clean. If `prettier` not configured, YAML parse alone suffices.

- [ ] **Step 6: Commit Task 2-3 changes together (see Task 3) — or commit separately if preferred**

---

### Task 3: Failure-notification step and pinning

Fold into Task 2 if Task 2 is done in one sitting (they touch the same file). Otherwise:

- [ ] **Step 1: Add the `if: failure()` Slack notifier to `.github/workflows/github-trending.yml`** (per Task 2 Step 4 requirements) and pin the `opencode-ai` version installed in the workflow to the exact version verified in Task 2 Step 3 (comment line: `# pinned YYYY-MM-DD per Task 2 verification`).

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/github-trending.yml migrations/0005_github_trending.sql
git commit -m "feat: add github-trending-daily migration and dispatch workflow"
```

---

### Task 4: Verify end-to-end (requires owner secrets; do not merge to main before this passes)

**Files:** none (execution), except any workflow fix-ups the run reveals.

- [ ] **Step 1: Push branch and open PR (draft) `feat: github-trending workflow + seed`**

- [ ] **Step 2: Confirm the four repo secrets exist** (`gh secret list`): `CF_ACCOUNT_ID`, `CF_API_TOKEN`, `SLACK_BOT_TOKEN`, `SLACK_NEWS_CHANNEL_ID`. If any missing, STOP and ask the owner — the owner confirmed they can create these; the plan does not create them.

- [ ] **Step 3: Dry run**

Run: `gh workflow run github-trending.yml --ref feat/github-trending-pilot -f dry_run=true && gh run watch`
Expected: workflow completes; log shows the composed digest (repo list, stars, trend summary) as final output; **no** POST to `chat.postMessage` (grep the log for `chat.postMessage` — must only appear in the failure-step definition, never as an executed request). If the agent output is garbage/empty/looped: STOP, report; per B-only this plan does not build Option A.

- [ ] **Step 4: Real run**

Run: `gh workflow run github-trending.yml --ref feat/github-trending-pilot -f dry_run=false && gh run watch`
Expected: workflow completes and exactly one Slack message (or one two-part message) appears in #news for today's date; workflow log ends with `ok: true`-equivalent confirmation. If double-posted or malformed: fix workflow/prompt, re-run with `dry_run` guard first, and note the incident; owner decides whether to enable.

- [ ] **Step 5: Report to owner; STOP before enabling the D1 row**

Tell the owner: PR #N passed dry + real run; the row stays `enabled=0`; to enable: `npx wrangler d1 execute scheduler-db --remote --command "UPDATE schedulers SET enabled=1, next_run_at='<next 23:50 UTC ISO>' WHERE id='github-trending-daily'"` (dry-run that UPDATE first with `--local` semantics or SELECT; enabling is the owner's explicit go-ahead, not part of this plan).

- [ ] **Step 6: PR from `feat/github-trending-pilot` → `main` with:** task checklist, dry/real run links, model id and date, outstanding items (enable command, secretrotation reminder, delete stale remote branches `refactor/prompts-standard*`, `chore/prompts-cleanup`).

---

## Spec Coverage Self-Check

- Schedule/dispatch/UTC: Task 1 (cron `50 23 * * *`); timezone is cosmetic by design (Review Focus #3).
- Workflow mechanics + model verification + dry_run: Tasks 2–4.
- Slack via `curl chat.postMessage`, fixed channel, never DM: prompt already rewritten (merged in #12); Task 4 verifies behavior; failure step covers crashes.
- D1 dispatch semantics unchanged: Task 1 uses `github_actions_trigger`, no Worker code touched.
- B-only stop condition: Review Focus #1 and Task 4 Step 3.
- Owner checklist from spec (token rotation, secrets, enabling): Task 4 Steps 2 & 5; enabling deliberately excluded from this plan.
- Migration applies via `db:migrate:local/remote`; nothing else in `migrations/` added.
