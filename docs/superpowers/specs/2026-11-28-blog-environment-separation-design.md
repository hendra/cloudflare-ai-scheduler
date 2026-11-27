# Blog Site GitHub Environment Separation Design

**Date:** 2026-11-28
**Size:** Small change

## Intent & Why
Isolate each of the four blog pipelines (`railsdev`, `fullstackweb`, `inasoft`, `hendranicholas`) into its own GitHub Environment so every blog site uses its own AI provider keys (separate quotas/billing) and can optionally override site-specific secrets/variables without affecting other pipelines.

## Goals & Non-Goals
- **Goals:**
  - Add `environment: blog-<site>` to `jobs.write` in each of the four `*-blog-writer.yml` workflows.
  - Document the four environments (`blog-railsdev`, `blog-fullstackweb`, `blog-inasoft`, `blog-hendranicholas`) and the environment secrets/vars to configure in GitHub Settings.
- **Non-Goals:**
  - Do not rename existing site-specific secrets (`<SITE>_PAT`, `SLACK_<SITE>_CHANNEL_ID`) or edit `scripts/*-blog-writer.mjs`.
  - Do not remove repo-level AI provider keys, as `github-trending`, `rails-job-search`, `inasoft-news-digest`, and `ig-reel` (`kaliajatau`) still rely on them.
  - Do not consolidate the four workflows into one parameterized workflow.

## Constraints
- GitHub Environments are free on this public repository.
- In GitHub Actions, any secret/var missing from an environment silently falls back to the repo-level secret/var of the same name.

## Approaches Considered
1. **Add `environment: blog-<site>` to each workflow, keeping existing secret names (Selected):** 1-line change per workflow, zero script changes, safe incremental rollout with repo-level fallback.
2. **Add `environment: blog-<site>` + standardize secret names (`SITE_PAT`, `SLACK_CHANNEL_ID`):** Cleaner uniform schema across environments, but requires editing all four `.mjs` scripts and migrating PAT/Slack secrets before the next scheduled run.
3. **Consolidate into one parameterized `blog-writer.yml` (like `ig-reel.yml`):** Rejected because the four sites differ in Node version (22 vs 24), package manager (`npm` vs `pnpm`), checkout depth (`fetch-depth: 0` on `hendranicholas`), and Formspree var names.

## Design
1. **Workflows:** Add `environment: blog-<site>` to `jobs.write` in:
   - `.github/workflows/railsdev-blog-writer.yml` → `environment: blog-railsdev`
   - `.github/workflows/fullstackweb-blog-writer.yml` → `environment: blog-fullstackweb`
   - `.github/workflows/inasoft-blog-writer.yml` → `environment: blog-inasoft`
   - `.github/workflows/hendranicholas-blog-writer.yml` → `environment: blog-hendranicholas`
2. **GitHub Environments (owner setup via GitHub UI or `gh`):**
   - Create `blog-railsdev`, `blog-fullstackweb`, `blog-inasoft`, and `blog-hendranicholas`.
   - Set per-site AI provider secrets in each environment: `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `GOOGLE_API_KEY`, `CF_ACCOUNT_ID`, `CF_API_TOKEN`, `KILO_API_KEY`, `OPENCODE_API_KEY` (and optionally `AI_MODEL`, `OPENCODE_MODEL`, `OPENCODE_BASE_URL` vars).
   - Optionally move/override site-specific secrets/vars (`GSC_SERVICE_ACCOUNT_JSON`, `PUBLIC_FORMSPREE_FORM_ID` / `PUBLIC_FORMSPREE_ID`, `<SITE>_PAT`, `SLACK_<SITE>_CHANNEL_ID`) per environment.
   - Keep `SCHEDULER_URL`, `MANUAL_RUN_TOKEN`, and `SLACK_BOT_TOKEN` at the repository level.
3. **Verification:** `dry_run=true` workflow dispatch per blog workflow after environments are configured.
