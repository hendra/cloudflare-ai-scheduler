# Blog Site GitHub Environment Separation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Isolate each of the four blog writer workflows into its own GitHub Environment (`blog-railsdev`, `blog-fullstackweb`, `blog-inasoft`, `blog-hendranicholas`) so each site uses its own AI provider keys.

**Architecture:** Add `environment: blog-<site>` to `jobs.write` in each of the four `*-blog-writer.yml` workflows while preserving all existing secret/variable names and `.mjs` scripts. Repo-level secrets/vars remain intact as fallback and for other pipelines (`github-trending`, `rails-job-search`, `inasoft-news-digest`, `ig-reel`).

**Tech Stack:** GitHub Actions YAML workflows, Markdown documentation.

**Spec:** `docs/superpowers/specs/2026-11-28-blog-environment-separation-design.md`

## Global Constraints
- Keep existing secret and variable names unchanged; do not edit `scripts/*-blog-writer.mjs`.
- Do not remove repository-level AI provider keys (`github-trending`, `rails-job-search`, `inasoft-news-digest`, and `ig-reel` depend on them).
- Do not commit directly to `main`; land changes via a PR.

## Review Focus
- **Missing environment in GitHub:** If a workflow references `environment: blog-<site>` before the environment is created in GitHub Settings, GitHub Actions auto-creates an empty environment on first run and falls back to repo-level secrets/vars (no job failure, but shared quota until populated).
- **Silent fallback on missing AI key:** If an environment omits one of the AI provider keys (`GROQ_API_KEY`, `OPENROUTER_API_KEY`, `GOOGLE_API_KEY`, `CF_ACCOUNT_ID`, `CF_API_TOKEN`, `KILO_API_KEY`, `OPENCODE_API_KEY`), that key silently falls back to the repo-level secret.
- **Partial Cloudflare credentials:** Overriding `CF_API_TOKEN` without `CF_ACCOUNT_ID` (or vice versa) in an environment pairs the environment token with the repo-level account ID; always set both together in each environment.
- **Formspree variable mismatch:** `railsdev`, `fullstackweb`, and `inasoft` read `vars.PUBLIC_FORMSPREE_FORM_ID`, whereas `hendranicholas` reads `vars.PUBLIC_FORMSPREE_ID`.
- **Indentation / YAML placement:** `environment:` must sit under `jobs.write:` (same level as `runs-on:` and `timeout-minutes:`), not at the top level or under `env:`.

---

### Task 1: Add `environment: blog-<site>` to the four blog writer workflows

**Files:**
- Modify: `.github/workflows/railsdev-blog-writer.yml:27-30`
- Modify: `.github/workflows/fullstackweb-blog-writer.yml:27-30`
- Modify: `.github/workflows/inasoft-blog-writer.yml:27-30`
- Modify: `.github/workflows/hendranicholas-blog-writer.yml:27-30`

- [ ] **Step 1: Add `environment:` under `jobs.write` in all four workflows**

Add `    environment: blog-<site>` right after `timeout-minutes: 45` in each file:
- `.github/workflows/railsdev-blog-writer.yml` → `    environment: blog-railsdev`
- `.github/workflows/fullstackweb-blog-writer.yml` → `    environment: blog-fullstackweb`
- `.github/workflows/inasoft-blog-writer.yml` → `    environment: blog-inasoft`
- `.github/workflows/hendranicholas-blog-writer.yml` → `    environment: blog-hendranicholas`

- [ ] **Step 2: Verify YAML structure and existing checks**

Run:
```bash
python3 -c "import yaml, glob; [yaml.safe_load(open(f)) for f in glob.glob('.github/workflows/*-blog-writer.yml')]" && grep -n "environment: blog-" .github/workflows/*-blog-writer.yml && npm run typecheck
```
Expected: Python exits 0, `grep` prints 4 matching lines (`blog-railsdev`, `blog-fullstackweb`, `blog-inasoft`, `blog-hendranicholas`), and `npm run typecheck` exits 0.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/railsdev-blog-writer.yml .github/workflows/fullstackweb-blog-writer.yml .github/workflows/inasoft-blog-writer.yml .github/workflows/hendranicholas-blog-writer.yml
git commit -m "ci: separate blog writer workflows into per-site GitHub environments"
```

---

### Task 2: Document blog environments in `docs/status.md`

**Files:**
- Modify: `docs/status.md:55` (Secrets inventory → Environments list)

- [ ] **Step 1: Update `docs/status.md` Environments inventory**

In `docs/status.md` under `## Secrets inventory (names only)`, update the `**Environments:**` sentence to list `blog-railsdev`, `blog-fullstackweb`, `blog-inasoft`, and `blog-hendranicholas` alongside `ig-kaliajatau` and `ig-ai-labs`, noting that each blog environment holds per-site AI provider keys (and optional site overrides) with repo-level fallback for un-overridden keys.

- [ ] **Step 2: Verify docs and conflict-marker check**

Run:
```bash
grep -n "blog-railsdev" docs/status.md && ! git grep -n -E '^(<<<<<<< |>>>>>>> )' -- .
```
Expected: `grep` matches the updated line in `docs/status.md` and conflict-marker check is clean.

- [ ] **Step 3: Commit**

```bash
git add docs/status.md
git commit -m "docs: document per-site blog GitHub environments in status"
```

---

### Task 3: Create GitHub Environments, populate per-site AI keys, and verify via `dry_run=true`

**Files:**
- None (GitHub repo settings + `gh workflow run` verification after PR merge or on branch)

- [ ] **Step 1: Create the four GitHub Environments and set per-site AI provider secrets**

In GitHub Repo → Settings → Environments (or via `gh api` / `gh secret set --env <name>`), create:
- `blog-railsdev`
- `blog-fullstackweb`
- `blog-inasoft`
- `blog-hendranicholas`

In each environment, set its own AI provider secrets:
`GROQ_API_KEY`, `OPENROUTER_API_KEY`, `GOOGLE_API_KEY`, `CF_ACCOUNT_ID`, `CF_API_TOKEN`, `KILO_API_KEY`, `OPENCODE_API_KEY` (and optionally `AI_MODEL`, `OPENCODE_MODEL`, `OPENCODE_BASE_URL` vars, plus site-specific overrides `GSC_SERVICE_ACCOUNT_JSON`, `PUBLIC_FORMSPREE_FORM_ID` / `PUBLIC_FORMSPREE_ID`, `<SITE>_PAT`, `SLACK_<SITE>_CHANNEL_ID`).

- [ ] **Step 2: Run a `dry_run=true` dispatch for each blog workflow**

Run:
```bash
gh workflow run railsdev-blog-writer.yml -f dry_run=true
gh workflow run fullstackweb-blog-writer.yml -f dry_run=true
gh workflow run inasoft-blog-writer.yml -f dry_run=true
gh workflow run hendranicholas-blog-writer.yml -f dry_run=true
```
Expected: Each run completes with exit 0 under its respective `blog-<site>` environment.
