# Blog writers 4× daily — design

**Date:** 2026-11-14 · **Size:** small change

## Intent
More SEO content: each blog site (RailsDev, FullstackWeb.dev, INASOFT) gets 4 draft-PR articles/day instead of 3.

## Schedule (owner decision)
07:30, 11:30, 16:30, 19:30 WIB = `30 0,4,9,12 * * *` UTC, all three sites.

## Approaches
- **A. Add a 4th clone row per site** (19:30) — keeps per-slot rows; 12 rows total. Not chosen: owner's times share one minute, so a list fits.
- **B. One row per site with a cron list (chosen)** — `30 0,4,9,12 * * *` on each base row; the `-1130`/`-1620` clones go away. Parser supports lists; one row per site is simpler to operate.
- 2 articles per run — rejected: script changes, longer runs, one failure kills both.

## Design
- New migration `0019_blog_writer_4x_daily.sql`:
  - `UPDATE` `railsdev-blog-writer`, `fullstackweb-blog-writer`, `inasoft-blog-writer`: `cron_expression='30 0,4,9,12 * * *'`, `next_run_at` = first future slot (`2026-11-15T00:30:00.000Z`; the dispatcher re-arms overdue rows anyway), names/descriptions mention 4 slots.
  - Remove the 6 clone rows (`*-1130`, `*-1620`): `DELETE` if `scheduler_executions` FK allows (delete their execution rows first), else `enabled=0`. Builder checks the FK.
- Apply with `npm run db:migrate:remote`.
- Update `docs/status.md` row table and `AGENTS.md` enabled-row list.
- No Worker or workflow changes.

### Auto-merge (owner decision, 2026-11-15)
PRs merge without human review. Native GitHub auto-merge is unavailable (`allow_auto_merge=false`, branch protection needs GitHub Pro on these private repos), so each writer (`railsdev-`, `fullstackweb-`, `inasoft-blog-writer.mjs`) merges its own PR right after `gh pr create`:
- `gh pr merge <url> --squash --delete-branch` with the site PAT (Contents RW + Pull requests RW already required).
- Gate stays `astro check && astro build` (already aborts the run before any PR on failure).
- Merge failure → PR stays open, run still succeeds (article delivered), Slack note says "PR opened, auto-merge failed: <reason>" (my call: the PR is still a usable deliverable).
- Success → Slack note "published" + PR link; PR body drops "DO NOT MERGE WITHOUT REVIEW" / human-review checkbox.
- `DRY_RUN` unchanged (no PR, no merge).

## Constraints / risks
- 12 AI generations/day for blogs (was 9) on the free fallback chain — may hit provider caps; accepted for SEO volume.
- No human review: factual/code errors in articles go live (accepted by owner for volume).

## Verification
`npm run typecheck`; `npm run db:migrate:local` then remote; `SELECT id, cron_expression, next_run_at, enabled FROM schedulers WHERE id LIKE '%blog-writer%'` shows 3 rows on the new cron.
