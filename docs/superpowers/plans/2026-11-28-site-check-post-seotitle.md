# Align External Site `check_post.mjs` `seoTitle` Limits to 60 Chars Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update the blog post lint scripts in `inasoft-site`, `railsdev-site`, and `fullstackwebdev-site` so `seoTitle` up to 60 characters passes `check_post.mjs` / `check-post.mjs`, and land all changes via PRs.

**Architecture:** Each external Astro site repo already has `seoTitle: z.string().max(60)` in `src/content.config.ts` and appends its brand suffix in `src/pages/blog/.../[slug].astro`. Only the Node 20 post-lint scripts (`check_post.mjs` / `check-post.mjs`) reject `seoTitle > 50` or `> 49`. Each repo gets a dedicated branch, minimal edit, verification run against a real post, and PR.

**Tech Stack:** Node 20 ESM, Astro, GitHub CLI (`gh`).

**Spec:** [`docs/superpowers/specs/2026-11-28-site-check-post-seotitle-design.md`](file:///home/hendra/Documents/projects/personal/cloudflare-ai-scheduler/docs/superpowers/specs/2026-11-28-site-check-post-seotitle-design.md)

## Global Constraints
- `seoTitle` max length in all site post-lint scripts must be **60** characters.
- Do not change `src/content.config.ts` or blog `[slug].astro` layouts (they already allow `max(60)` and append the brand suffix).
- Never commit directly to `main`; every repo change lands via a PR.

## Review Focus
- `seoTitle` at boundary lengths (`50`, `54`, `60` pass; `61` fails) in `inasoft-site` and `railsdev-site`.
- `fullstackwebdev-site/scripts/check-post.mjs` must still pass on older posts that omit `seoTitle` (`optional()` in schema).
- `check_post.mjs` / `check-post.mjs` exits `0` on an existing valid post after the change.

---

### Task 1: Update `inasoft-site` `check_post.mjs` to max 60 chars

**Files:**
- Modify: `../inasoft-site/.claude/skills/write-blog-article/scripts/check_post.mjs:49-50`

- [ ] **Step 1: Create feature branch in `inasoft-site`**

Run: `git -C ../inasoft-site checkout -b fix/seotitle-max-60`

- [ ] **Step 2: Update `seoTitle` max check from `50` to `60`**

In `../inasoft-site/.claude/skills/write-blog-article/scripts/check_post.mjs:49-50`, change:
```js
if ((data.seoTitle ?? "").length > 60)
  errors.push(`seoTitle is ${data.seoTitle.length} chars (max 60)`);
```

- [ ] **Step 3: Verify `check_post.mjs` against a real post and a 54-char `seoTitle`**

Run `node .claude/skills/write-blog-article/scripts/check_post.mjs src/content/blog/redis-adalah.md` in `../inasoft-site`, and verify with a temporary test or inline check that a 54-char `seoTitle` passes and a 61-char `seoTitle` triggers `seoTitle is 61 chars (max 60)`.

- [ ] **Step 4: Commit, push, and open PR**

```bash
git -C ../inasoft-site add .claude/skills/write-blog-article/scripts/check_post.mjs
git -C ../inasoft-site commit -m "fix: raise check_post seoTitle max to 60 chars"
git -C ../inasoft-site push -u origin fix/seotitle-max-60
gh pr create --repo hendra/inasoft-site --head fix/seotitle-max-60 --title "fix: raise check_post seoTitle max to 60 chars" --body "..."
```

---

### Task 2: Update `railsdev-site` `check_post.mjs` to max 60 chars

**Files:**
- Modify: `../railsdev-site/.claude/skills/write-blog-article/scripts/check_post.mjs:48-50`

- [ ] **Step 1: Create feature branch in `railsdev-site`**

Run: `git -C ../railsdev-site checkout -b fix/seotitle-max-60`

- [ ] **Step 2: Update `seoTitle` max check from `49` to `60`**

In `../railsdev-site/.claude/skills/write-blog-article/scripts/check_post.mjs:48-50`, update the comment and check:
```js
// Matches content.config.ts seoTitle.max(60) and cloudflare-ai-scheduler's 50-60 char rule
if ((data.seoTitle ?? "").length > 60)
  errors.push(`seoTitle is ${data.seoTitle.length} chars (max 60)`);
```

- [ ] **Step 3: Verify `check_post.mjs` against an existing post**

Run `node .claude/skills/write-blog-article/scripts/check_post.mjs src/content/blog/solid-queue-rails.md` in `../railsdev-site` and confirm exit code `0`.

- [ ] **Step 4: Commit, push, and open PR**

```bash
git -C ../railsdev-site add .claude/skills/write-blog-article/scripts/check_post.mjs
git -C ../railsdev-site commit -m "fix: raise check_post seoTitle max to 60 chars"
git -C ../railsdev-site push -u origin fix/seotitle-max-60
gh pr create --repo hendra/railsdev-site --head fix/seotitle-max-60 --title "fix: raise check_post seoTitle max to 60 chars" --body "..."
```

---

### Task 3: Add `seoTitle` max 60 check in `fullstackwebdev-site` `check-post.mjs`

**Files:**
- Modify: `../fullstackwebdev-site/scripts/check-post.mjs:164-171`

- [ ] **Step 1: Create feature branch in `fullstackwebdev-site`**

Run: `git -C ../fullstackwebdev-site checkout -b fix/seotitle-max-60`

- [ ] **Step 2: Add `seoTitle` max 60 validation when present**

In `../fullstackwebdev-site/scripts/check-post.mjs`, right before the `description` length check (around line 164), add:
```js
if (typeof data.seoTitle === 'string' && data.seoTitle.length > 60) {
  errors.push(`seoTitle is ${data.seoTitle.length} chars (max 60)`);
}
```
Leave `seoTitle` optional so legacy posts without `seoTitle` continue passing.

- [ ] **Step 3: Verify `check-post.mjs` against an existing post**

Run `node scripts/check-post.mjs src/content/blog/production-rag-applications.md` in `../fullstackwebdev-site` and confirm exit code `0`.

- [ ] **Step 4: Commit, push, and open PR**

```bash
git -C ../fullstackwebdev-site add scripts/check-post.mjs
git -C ../fullstackwebdev-site commit -m "fix: validate seoTitle max 60 chars in check-post"
git -C ../fullstackwebdev-site push -u origin fix/seotitle-max-60
gh pr create --repo hendra/fullstackwebdev-site --head fix/seotitle-max-60 --title "fix: validate seoTitle max 60 chars in check-post" --body "..."
```

---

### Task 4: Open PR for spec & plan in `cloudflare-ai-scheduler`

**Files:**
- Commit: `docs/superpowers/specs/2026-11-28-site-check-post-seotitle-design.md`
- Commit: `docs/superpowers/plans/2026-11-28-site-check-post-seotitle.md`

- [ ] **Step 1: Create branch, commit spec & plan, push, and open PR**

```bash
git checkout -b docs/site-check-post-seotitle
git add docs/superpowers/specs/2026-11-28-site-check-post-seotitle-design.md docs/superpowers/plans/2026-11-28-site-check-post-seotitle.md
git commit -m "docs: add spec and plan for site check_post seoTitle alignment"
git push -u origin docs/site-check-post-seotitle
gh pr create --head docs/site-check-post-seotitle --title "docs: add spec and plan for site check_post seoTitle alignment" --body "..."
```
