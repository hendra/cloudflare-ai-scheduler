# Per-Site `seoTitle` Suffix Budget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce `seoTitle` bounds of `(50 - suffixLen)..(60 - suffixLen)` across all four blog writers and their site `check_post` scripts so every rendered `<title>` (`${seoTitle} | <Brand>`) stays 50–60 characters.

**Architecture:** `scripts/blog-aeo.mjs` already accepts `seoTitleMin` and `seoTitleMax` in `validateAeoGeo`. Each of the four blog writers passes its site-specific bounds (`40–50`, `39–49`, `29–39`, `32–42`) and updates its prompts, `repairMetadata` prompt, and `AI_STUB` fixtures. Each external site repo's `check_post.mjs` / `check-post.mjs` enforces the matching max (`50`, `49`, `39`).

**Tech Stack:** Node 20 ESM, GitHub CLI (`gh`).

**Spec:** [`docs/superpowers/specs/2026-11-28-per-site-seotitle-suffix-budget-design.md`](file:///home/hendra/Documents/projects/personal/cloudflare-ai-scheduler/docs/superpowers/specs/2026-11-28-per-site-seotitle-suffix-budget-design.md)

## Global Constraints
- `inasoft`: `seoTitleMin = 40`, `seoTitleMax = 50` (`" | INASOFT"` = 10 chars)
- `railsdev`: `seoTitleMin = 39`, `seoTitleMax = 49` (`" | RailsDev"` = 11 chars)
- `fullstackweb`: `seoTitleMin = 29`, `seoTitleMax = 39` (`" | Full-Stack Web Dev"` = 21 chars)
- `hendranicholas`: `seoTitleMin = 32`, `seoTitleMax = 42` (`" | Hendra Nicholas"` = 18 chars)
- Never commit directly to `main`; every repo change lands via a PR.

## Review Focus
- `AI_STUB` `seoTitle` lengths in all four writers must fall inside their new `[min, max]` range.
- `fullstackweb-blog-writer.mjs` stub fallback (`rawSeoTitle.length < 50 ? ... : rawSeoTitle.slice(0, 60)`) must not exceed `39` chars.
- `scripts/blog-aeo-selfcheck.mjs` and `scripts/hendranicholas-blog-selfcheck.mjs` must pass after updating bounds.
- `check_post.mjs` / `check-post.mjs` in `inasoft-site`, `railsdev-site`, and `fullstackwebdev-site` must reject `max + 1` and accept `max`.

---

### Task 1: Update all four blog writers and self-checks in `cloudflare-ai-scheduler`

**Files:**
- Modify: `scripts/inasoft-blog-writer.mjs:202,243-255,333,345,478`
- Modify: `scripts/railsdev-blog-writer.mjs:166,174-186,252,257,376`
- Modify: `scripts/fullstackweb-blog-writer.mjs:288-292,388-405,474,629`
- Modify: `scripts/hendranicholas-blog-writer.mjs:221,282-300,365,525`
- Modify: `scripts/hendranicholas-blog-selfcheck.mjs:24,28`
- Modify: `scripts/blog-aeo-selfcheck.mjs:171-177`

- [ ] **Step 1: Create branch `fix/per-site-seotitle-budget`**

- [ ] **Step 2: Update `inasoft-blog-writer.mjs` (`40–50` chars)**
  - Define `SEO_TITLE_MIN = 40`, `SEO_TITLE_MAX = 50`.
  - Pass `seoTitleMin: SEO_TITLE_MIN, seoTitleMax: SEO_TITLE_MAX` to `validateAeoGeo`.
  - Update topic prompt (`"seoTitle":"40-50 chars"`), `repairMetadata` prompt (`- seoTitle: 40-50 chars`), and stub `seoTitle` (`"Panduan Praktis AI untuk Bisnis di Indonesia"` = 44 chars).

- [ ] **Step 3: Update `railsdev-blog-writer.mjs` (`39–49` chars)**
  - Define `SEO_TITLE_MIN = 39`, `SEO_TITLE_MAX = 49`.
  - Pass `seoTitleMin: SEO_TITLE_MIN, seoTitleMax: SEO_TITLE_MAX` to `validateAeoGeo`.
  - Update topic prompt (`"seoTitle":"39-49 chars"`), `repairMetadata` prompt (`- seoTitle: 39-49 chars`), and stub `seoTitle` (`"Rails Migration Testing: A Practical Guide"` = 42 chars).

- [ ] **Step 4: Update `fullstackweb-blog-writer.mjs` (`29–39` chars)**
  - Define `SEO_TITLE_MIN = 29`, `SEO_TITLE_MAX = 39`.
  - Pass `seoTitleMin: SEO_TITLE_MIN, seoTitleMax: SEO_TITLE_MAX` to `validateAeoGeo`.
  - Update topic prompt (`"seoTitle":"29-39 chars"`), `repairMetadata` prompt (`- seoTitle: 29-39 chars`), and stub `seoTitle` builder so `seoTitle` is 29–39 chars (e.g., `rawSeoTitle.slice(0, SEO_TITLE_MAX)` when `>= SEO_TITLE_MIN`).

- [ ] **Step 5: Update `hendranicholas-blog-writer.mjs` (`32–42` chars)**
  - Define `SEO_TITLE_MIN = 32`, `SEO_TITLE_MAX = 42`.
  - Pass `seoTitleMin: SEO_TITLE_MIN, seoTitleMax: SEO_TITLE_MAX` to `validateAeoGeo`.
  - Update topic prompt (`"seoTitle":"32-42 chars"`), `repairMetadata` prompt (`- seoTitle: 32-42 chars`), and stub `seoTitle` (`"FastAPI Dependency Injection & Pydantic v2"` = 42 chars).

- [ ] **Step 6: Update `scripts/hendranicholas-blog-selfcheck.mjs` and `scripts/blog-aeo-selfcheck.mjs`**
  - Update `hendranicholas-blog-selfcheck.mjs` stub assertion to `32–42` chars and add `43`-char failure assertion.
  - Add a per-site override check (`seoTitleMin: 40, seoTitleMax: 50`) in `blog-aeo-selfcheck.mjs`.

- [ ] **Step 7: Verify with self-checks, commit, push, and open PR**
  - Run `npm run aeo:selfcheck && npm run hendranicholas:selfcheck && npm run typecheck`.

---

### Task 2: Restore `max 50` in `inasoft-site` `check_post.mjs`

**Files:**
- Modify: `../inasoft-site/.claude/skills/write-blog-article/scripts/check_post.mjs:49-50`

- [ ] **Step 1: Branch `fix/seotitle-max-50`, change `60` -> `50`, verify on `vibe-coding-adalah.md` + 50/51 boundary, commit, push, open PR**

---

### Task 3: Restore `max 49` in `railsdev-site` `check_post.mjs`

**Files:**
- Modify: `../railsdev-site/.claude/skills/write-blog-article/scripts/check_post.mjs:48-50`

- [ ] **Step 1: Branch `fix/seotitle-max-49`, change `60` -> `49`, verify on `solid-queue-rails.md` + 49/50 boundary, commit, push, open PR**

---

### Task 4: Set `max 39` in `fullstackwebdev-site` `check-post.mjs`

**Files:**
- Modify: `../fullstackwebdev-site/scripts/check-post.mjs:164-166`

- [ ] **Step 1: Branch `fix/seotitle-max-39`, change `60` -> `39`, verify on `production-rag-applications.md` + 39/40 boundary, commit, push, open PR**
