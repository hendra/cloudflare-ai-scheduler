# FullstackWeb Blog Writer Category Enum Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the broken `astro build` on `hendra/fullstackwebdev-site` and align `scripts/fullstackweb-blog-writer.mjs` with the site's 9-value `BLOG_CATEGORIES` enum.

**Architecture:** First patch and merge the stale `"AI/LLM"` category on `superpowers-agentic-skills-framework.md` in `hendra/fullstackwebdev-site` so `main` builds cleanly. Then update `scripts/fullstackweb-blog-writer.mjs` on a feature branch to declare `CATEGORY_VALUES`, prompt only those 9 values, normalize/fallback any off-list model reply via `normalizeCategory(...)`, and verify with an assertion-based self-check plus `DRY_RUN=true` / `npm run typecheck`.

**Tech Stack:** Node.js 20+ (zero-dep ESM), Astro 7 content collections (`z.enum`), GitHub CLI (`gh`).

**Spec:** `docs/superpowers/specs/2026-11-18-fullstackweb-category-enum-design.md`

## Global Constraints

- `hendra/fullstackwebdev-site` `src/content.config.ts` requires `category` in:
  `AI Engineering`, `Backend`, `Frontend`, `Dev Tools`, `DevOps`, `Node.js and TypeScript`, `Python and FastAPI`, `Rust`, `Engineering Leadership`.
- Never commit directly to `main` in `hendra/cloudflare-ai-scheduler`; every change lands via a PR.
- No new runtime dependencies; `scripts/` stays zero-dep Node 20+ ESM.
- PRs in `hendra/cloudflare-ai-scheduler` must pass `npm run typecheck` and have zero merge-conflict markers.

## Review Focus

- Legacy category strings (`"AI/LLM"`, `"Web/Frontend"`, `"Infra/DevOps"`, `"Data"`, `"Ruby on Rails"`) map directly to their new `BLOG_CATEGORIES` equivalents instead of falling back generically to `"Dev Tools"`.
- Case and whitespace variants (`"ai engineering"`, `" devops "`, `"node.js and typescript"`) resolve to the exact canonical casing in `CATEGORY_VALUES`.
- Unknown, empty, non-string, or multiline-injection inputs (`""`, `null`, `"Machine Learning"`, `"Foo\ninjected: true"`) are sanitized and resolved via keyword heuristics to a valid `CATEGORY_VALUES` entry (defaulting to `"Dev Tools"`).
- The metadata self-correction prompt (`fixPrompt`) advertises `CATEGORY_VALUES`, not the removed 7-value list, and `validateArticle` keeps `article.category` valid after `fixPrompt`.
- Importing `scripts/fullstackweb-blog-writer.mjs` from a test/self-check does not execute the main pipeline IIFE.

---

### Task 1: Fix `superpowers-agentic-skills-framework.md` in `hendra/fullstackwebdev-site`

**Files:**
- Modify (in `hendra/fullstackwebdev-site`): `src/content/blog/superpowers-agentic-skills-framework.md:4`

**Interfaces:**
- Consumes: `BLOG_CATEGORIES` in `hendra/fullstackwebdev-site` `src/content.config.ts`.
- Produces: Green `main` branch on `hendra/fullstackwebdev-site` (`pnpm verify:blog` passes for all 40 posts).

- [ ] **Step 1: Clone `hendra/fullstackwebdev-site` to `/tmp/opencode/fullstackwebdev-site` and reproduce the failure**

Run:
```bash
gh repo clone hendra/fullstackwebdev-site /tmp/opencode/fullstackwebdev-site
cd /tmp/opencode/fullstackwebdev-site
pnpm install --frozen-lockfile --ignore-scripts
pnpm build
```
Expected: FAIL with `[InvalidContentEntryDataError] blog → superpowers-agentic-skills-framework data does not match collection schema. category: Invalid option`.

- [ ] **Step 2: Create a branch and update `category` from `"AI/LLM"` to `"AI Engineering"`**

Create branch `fix/superpowers-category` in `/tmp/opencode/fullstackwebdev-site` and edit line 4 of `src/content/blog/superpowers-agentic-skills-framework.md` from `category: "AI/LLM"` to `category: "AI Engineering"`.

- [ ] **Step 3: Verify the full site check, build, and blog verification pass**

Run (in `/tmp/opencode/fullstackwebdev-site`):
```bash
pnpm check && pnpm verify:blog && pnpm test
```
Expected: `astro check` 0 errors, `astro build` succeeds, `check-blog-build.mjs` prints `OK`, tests pass.

- [ ] **Step 4: Commit, open PR, and merge**

Run (in `/tmp/opencode/fullstackwebdev-site`):
```bash
git add src/content/blog/superpowers-agentic-skills-framework.md
git commit -m "fix(blog): migrate superpowers-agentic-skills-framework category to AI Engineering"
git push -u origin fix/superpowers-category
gh pr create --base main --head fix/superpowers-category --title "fix(blog): migrate superpowers-agentic-skills-framework category" --body "Fixes #53/#54 race where superpowers-agentic-skills-framework.md kept legacy category \"AI/LLM\" after BLOG_CATEGORIES enum enforcement."
gh pr merge --squash --delete-branch
```
Expected: PR created and merged into `hendra/fullstackwebdev-site` `main`.

---

### Task 2: Align `scripts/fullstackweb-blog-writer.mjs` with `BLOG_CATEGORIES` and add self-check

**Files:**
- Modify: `scripts/fullstackweb-blog-writer.mjs`
- Create: `scripts/fullstackweb-category-selfcheck.mjs`

**Interfaces:**
- Produces (exported from `scripts/fullstackweb-blog-writer.mjs`):
  - `CATEGORY_VALUES: readonly string[]` (the 9 `BLOG_CATEGORIES` values)
  - `normalizeCategory(raw: unknown, context?: { title?: string; keyword?: string; services?: string[] }): string`
  - `validateArticle(a: object, corpusSlugs: string[]): { ok: boolean; errs: string[]; wordCount: number; links: string[] }`

- [ ] **Step 1: Write the failing self-check `scripts/fullstackweb-category-selfcheck.mjs`**

```javascript
import assert from "node:assert/strict";
import { CATEGORY_VALUES, normalizeCategory, validateArticle } from "./fullstackweb-blog-writer.mjs";

assert.deepEqual(CATEGORY_VALUES, [
  "AI Engineering",
  "Backend",
  "Frontend",
  "Dev Tools",
  "DevOps",
  "Node.js and TypeScript",
  "Python and FastAPI",
  "Rust",
  "Engineering Leadership",
]);

// Exact and case/whitespace matches
assert.equal(normalizeCategory("AI Engineering"), "AI Engineering");
assert.equal(normalizeCategory("  node.js and typescript "), "Node.js and TypeScript");

// Legacy category aliases
assert.equal(normalizeCategory("AI/LLM"), "AI Engineering");
assert.equal(normalizeCategory("Web/Frontend"), "Frontend");
assert.equal(normalizeCategory("Infra/DevOps"), "DevOps");
assert.equal(normalizeCategory("Data"), "Backend");
assert.equal(normalizeCategory("Ruby on Rails"), "Backend");

// Unknown / empty / injection inputs fall back cleanly via context or default
assert.equal(normalizeCategory("Machine Learning", { title: "Building FastAPI RAG", services: ["python-fastapi-development"] }), "Python and FastAPI");
assert.equal(normalizeCategory("Other", { title: "React 19 Compiler Guide", keyword: "react compiler" }), "Frontend");
assert.equal(normalizeCategory("Other", { title: "Rust Async Runtime Tuning" }), "Rust");
assert.equal(normalizeCategory("Other", { title: "Kubernetes Deployment Patterns" }), "DevOps");
assert.equal(normalizeCategory("Other", { title: "Staff Engineer Architecture Reviews" }), "Engineering Leadership");
assert.equal(normalizeCategory("Foo\nbar: baz", { title: "Unclassified Note" }), "Dev Tools");
assert.equal(normalizeCategory("", {}), "Dev Tools");
assert.equal(normalizeCategory(null, {}), "Dev Tools");

// validateArticle normalizes off-list category instead of failing or passing stale value through
const body = "## Intro\n\nword ".repeat(4) + "word ".repeat(1500) + "\n\n## Details\n\n```ts\nconst x = 1;\n```\n\n## Tradeoffs\n\n> Verification note: test fixture.\n\n## Conclusion\n\nDone.";
const article = {
  title: "Building Scalable AI Agents with TypeScript",
  description: "Practical guide to building scalable AI agents with TypeScript, schema validation, and deterministic workflows in production.",
  keyword: "ai agents",
  slug: "building-scalable-ai-agents-ts",
  category: "AI/LLM",
  services: ["ai-engineering"],
  coverAlt: "Diagram of AI agent pipeline",
  body,
};
const res = validateArticle(article, []);
assert.equal(res.ok, true, `expected valid article, got: ${res.errs.join("; ")}`);
assert.equal(article.category, "AI Engineering");

console.log("fullstackweb-category-selfcheck: ok");
```

- [ ] **Step 2: Run the self-check to verify it fails**

Run: `node scripts/fullstackweb-category-selfcheck.mjs`
Expected: FAIL (missing exports and/or main pipeline runs on import).

- [ ] **Step 3: Implement `CATEGORY_VALUES`, `normalizeCategory`, prompt updates, and entrypoint guard in `scripts/fullstackweb-blog-writer.mjs`**

1. Guard the main IIFE (`(async () => { ... })()`) so it only runs when `process.argv[1]` resolves to `import.meta.url` (using `node:path` `resolve` + `node:url` `pathToFileURL`).
2. Add `export const CATEGORY_VALUES = [...]` with the 9 exact `BLOG_CATEGORIES` values.
3. Add `export function normalizeCategory(raw, { title = "", keyword = "", services = [] } = {})`:
   - Strip `\r`/`\n`, trim, collapse internal whitespace.
   - Return canonical `CATEGORY_VALUES` entry on case-insensitive exact match.
   - Map legacy aliases (`ai/llm` → `AI Engineering`, `web/frontend` → `Frontend`, `infra/devops` → `DevOps`, `data` → `Backend`, `ruby on rails` → `Backend`).
   - Otherwise match heuristics across `raw + " " + title + " " + keyword + " " + services.join(" ")` (covering `Rust`, `Python and FastAPI`, `Node.js and TypeScript`, `Frontend`, `AI Engineering`, `DevOps`, `Backend`, `Engineering Leadership`), defaulting to `"Dev Tools"`.
4. Replace lines 183–187 in `validateArticle` with `a.category = normalizeCategory(a.category, a);` and export `validateArticle`.
5. Update `topicPrompt` (line 256) and `fixPrompt` (line 356) to use `CATEGORY_VALUES.join("|")` / `CATEGORY_VALUES.join(" | ")`.

- [ ] **Step 4: Run self-check, `AI_STUB=true DRY_RUN=true` site build against Task 1's checkout, and `npm run typecheck`**

Run:
```bash
node scripts/fullstackweb-category-selfcheck.mjs
npm run typecheck
SITE_DIR=/tmp/opencode/fullstackwebdev-site AI_STUB=true DRY_RUN=true PUBLIC_FORMSPREE_FORM_ID=xaeeywav node scripts/fullstackweb-blog-writer.mjs
git -C /tmp/opencode/fullstackwebdev-site checkout -- . && git -C /tmp/opencode/fullstackwebdev-site clean -fd src/
```
Expected: `fullstackweb-category-selfcheck: ok`, `npm run typecheck` exits 0, `fullstackweb-blog-writer.mjs` completes `astro check && astro build` (`build passed`) and exits 0 in dry-run mode, temp site repo stays clean.

- [ ] **Step 5: Create feature branch, commit, push, and open PR on `hendra/cloudflare-ai-scheduler`**

Run:
```bash
git checkout -b fix/fullstackweb-category-enum
git add docs/superpowers/specs/2026-11-18-fullstackweb-category-enum-design.md docs/superpowers/plans/2026-11-18-fullstackweb-category-enum.md scripts/fullstackweb-blog-writer.mjs scripts/fullstackweb-category-selfcheck.mjs
git grep -n -E '^(<<<<<<< |>>>>>>> )' -- .
git commit -m "fix(fullstackweb): align blog writer categories with site enum"
git push -u origin fix/fullstackweb-category-enum
gh pr create --base main --head fix/fullstackweb-category-enum --title "fix(fullstackweb): align blog writer categories with site enum" --body "..."
```
Expected: PR created on `hendra/cloudflare-ai-scheduler`, CI passes, ready for merge and live `dry_run=true` workflow dispatch check.
