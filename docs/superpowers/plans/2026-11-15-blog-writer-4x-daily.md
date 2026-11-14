# Blog writers 4× daily + auto-merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** All three blog writers fire at 07:30/11:30/16:30/19:30 WIB and merge their own PR after a passing build.

**Architecture:** One D1 migration retimes the three base `schedulers` rows to a cron list and removes the six clone rows. A small shared helper squash-merges the just-opened PR; each writer calls it and reports merged/failed to Slack.

**Tech Stack:** Cloudflare D1 (SQL migration), Node 20 zero-dep ESM scripts, `gh` CLI.

**Spec:** `docs/superpowers/specs/2026-11-14-blog-writer-4x-daily-design.md`

## Global Constraints

- Cron for all three: `30 0,4,9,12 * * *` (UTC) = 07:30, 11:30, 16:30, 19:30 WIB.
- First `next_run_at`: `2026-11-16T00:30:00.000Z` (spec said 11-15; that slot has passed — dispatcher re-arms overdue rows, but use the next future slot).
- Merge command: `gh pr merge <url> --squash --delete-branch`, `GH_TOKEN` = site PAT.
- Merge failure must NOT fail the run; PR stays open; Slack says why.
- `DRY_RUN` behavior unchanged (no PR, no merge).
- Never commit to `main`; branch `feat/blog-writer-4x-daily`, one PR.
- No tests exist in repo; verification = `npm run typecheck`, `node --check`, local migration + SELECT, `dry_run=true` dispatch.

## Review Focus

- `gh pr merge` fails (PAT lacks merge rights, PR not mergeable) → PR left open, Slack "auto-merge failed: <stderr first 200c>", exit 0. Pinned in Task 2 Step 2.
- `gh pr merge` hangs → bounded by `timeout: 120000` in the helper; treated as failure.
- Slack post fails after merge → warning only, run still green (existing behavior; keep the try/catch).
- Re-running migration 0019 locally twice → idempotent (`UPDATE`/`DELETE … WHERE id IN`), no error.
- Clone rows have FK children (`scheduler_executions`, `scheduler_locks`) → delete children first or `DELETE FROM schedulers` fails with FK error under `PRAGMA foreign_keys=ON`.

---

### Task 1: Migration 0019 — retime base rows, remove clones

**Files:**
- Create: `migrations/0019_blog_writer_4x_daily.sql`
- Modify: `docs/status.md:15-23` (row table: 3 blog rows, new cron/WIB `07:30/11:30/16:30/19:30`, next_run_at), `AGENTS.md` (enabled-row list: drop the six `-1130`/`-1620` ids; "5 base + 10 multi-fire clones" → "5 base + 4 multi-fire clones")

**Interfaces:** Produces D1 state only.

- [ ] **Step 1: Write the migration**
  - Header comment: user directive 2026-11-15, 4 slots, why cron list now works (shared minute).
  - `UPDATE schedulers SET cron_expression='30 0,4,9,12 * * *', next_run_at='2026-11-16T00:30:00.000Z', description='4 daily slots (07:30/11:30/16:30/19:30 WIB). Auto-merged PR on <site>.' WHERE id='<base id>';` ×3 (`railsdev-blog-writer`/railsdev-site, `fullstackweb-blog-writer`/fullstackwebdev-site, `inasoft-blog-writer`/inasoft-site).
  - Clone ids: `railsdev-blog-writer-1130`, `railsdev-blog-writer-1620`, `fullstackweb-blog-writer-1130`, `fullstackweb-blog-writer-1620`, `inasoft-blog-writer-1130`, `inasoft-blog-writer-1620`.
  - `DELETE FROM scheduler_locks WHERE scheduler_id IN (…)`; `DELETE FROM scheduler_executions WHERE scheduler_id IN (…)`; `DELETE FROM schedulers WHERE id IN (…)` — in that order.

- [ ] **Step 2: Apply locally and verify**

Run: `npm run db:migrate:local && npx wrangler d1 execute scheduler-db --local --command "SELECT id, cron_expression, next_run_at, enabled FROM schedulers WHERE id LIKE '%blog-writer%'"`
Expected: migration succeeds; if local DB lacks prod rows, 0 rows is acceptable (UPDATE no-ops) — no FK/SQL error is the pass condition. Verify cron parse: `node -e` is not available for TS; instead confirm `src/cron.ts` handles comma lists in the hour field by reading its field parser.

- [ ] **Step 3: Update docs** (status.md table + AGENTS.md list as above; add a status.md "Last updated" line).

- [ ] **Step 4: Commit**

```bash
git add migrations/0019_blog_writer_4x_daily.sql docs/status.md AGENTS.md
git commit -m "feat(schedule): blog writers 4x daily via one cron row per site"
```

### Task 2: Auto-merge after PR creation

**Files:**
- Create: `scripts/site-pr.mjs`
- Modify: `scripts/railsdev-blog-writer.mjs:326-333`, `scripts/fullstackweb-blog-writer.mjs:362-369`, `scripts/inasoft-blog-writer.mjs:452-459`; `docs/status.md:48-50` ("draft PR" → "auto-merged PR"); workflow header comments in `.github/workflows/{railsdev,fullstackweb}-blog-writer.yml:5` (and inasoft if it says draft)

**Interfaces:**
- Produces: `export function mergePr(prUrl: string, opts: { cwd: string, env: object }): { merged: boolean, error?: string }` — runs `execFileSync("gh", ["pr","merge",prUrl,"--squash","--delete-branch"], { cwd, env, stdio: "pipe", timeout: 120000 })`; on throw returns `{ merged:false, error }` where error = first 200 chars of stderr or message. Never throws.

- [ ] **Step 1: Implement `mergePr` in `scripts/site-pr.mjs`**

- [ ] **Step 2: Self-check the failure path**

Run: `node -e 'import("./scripts/site-pr.mjs").then(m=>console.log(JSON.stringify(m.mergePr("https://github.com/hendra/nonexistent-xyz/pull/1",{cwd:".",env:process.env}))))'`
Expected: `{"merged":false,"error":"…"}` and exit 0 (no throw).

- [ ] **Step 3: Wire into each writer** (same change ×3)
  - PR body: drop "**requires human review before merge**", the `- [ ] **Human: verify…**` line, and `DO NOT MERGE WITHOUT REVIEW.`; add `Auto-merged by the pipeline after astro build passed.`
  - After `console.log("PR opened:", pr)`: `const m = mergePr(pr, { cwd: SITE_DIR, env: gitEnv });` log result; on failure also `console.log("::warning title=Auto-merge failed::…")`.
  - Slack text: merged → `🖌️ _<Site> article published_\n*title*\n→ pr\n<words> words · keyword: <kw>`; failed → `🖌️ _<Site> PR opened — auto-merge failed_\n*title*\n→ pr\n<error>\nMerge it by hand.` Keep the existing try/catch around `postToSlack`.

- [ ] **Step 4: Verify**

Run: `node --check scripts/site-pr.mjs scripts/railsdev-blog-writer.mjs scripts/fullstackweb-blog-writer.mjs scripts/inasoft-blog-writer.mjs && npm run typecheck && git grep -n "DO NOT MERGE\|needs your review" scripts/`
Expected: checks pass, grep prints nothing.

- [ ] **Step 5: Commit**

```bash
git add scripts/site-pr.mjs scripts/*-blog-writer.mjs docs/status.md .github/workflows/*blog-writer.yml
git commit -m "feat(blog): auto-merge blog writer PRs after build passes"
```

### Task 3: Ship

- [ ] **Step 1:** `git grep -n -E '^(<<<<<<< |>>>>>>> )' -- .` → empty. Push branch, open PR (Summary / What changed / Verification / Out of scope per AGENTS.md).
- [ ] **Step 2 (after merge, owner-confirmed):** `npm run db:migrate:remote`, then `npx wrangler d1 execute scheduler-db --remote --command "SELECT id, cron_expression, next_run_at, enabled FROM schedulers WHERE id LIKE '%blog-writer%'"` → exactly 3 rows, cron `30 0,4,9,12 * * *`, enabled 1.
- [ ] **Step 3:** `gh workflow run railsdev-blog-writer.yml --ref main -f dry_run=true && gh run watch` (repeat for fullstackweb, inasoft) → green, "DRY RUN — would open PR".
