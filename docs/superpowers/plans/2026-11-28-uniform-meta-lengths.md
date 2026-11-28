# Uniform `seoTitle` and `description` Lengths Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce uniform `seoTitle` (50–60 characters) and `description` (120–160 characters) rules across `scripts/blog-aeo.mjs` and all four blog writer pipelines (`railsdev`, `inasoft`, `fullstackweb`, `hendranicholas`).

**Architecture:** Centralize `seoTitleMin = 50`, `seoTitleMax = 60`, `descMin = 120`, `descMax = 160` defaults in `validateAeoGeo` (`scripts/blog-aeo.mjs`) and align all four blog writers to require `seoTitle` and `description` within those exact bounds in prompts, `META_KEYS`, `fixPrompt`, stubs, and YAML frontmatter. Remove per-writer overrides (`180`, `49`, `50`) and silent `clampAtWord` truncation that could drop lengths below the minimums.

**Tech Stack:** Node.js 20 ESM (`node:assert/strict`), zero external dependencies.

**Spec:** [2026-11-28-uniform-meta-lengths-design.md](file:///home/hendra/Documents/projects/personal/cloudflare-ai-scheduler/docs/superpowers/specs/2026-11-28-uniform-meta-lengths-design.md)

## Global Constraints

- `seoTitle` must be **50–60 characters** (inclusive) across all 4 blog writers (`railsdev`, `inasoft`, `fullstackweb`, `hendranicholas`).
- `description` must be **120–160 characters** (inclusive) across all 4 blog writers.
- `title` (H1) remains **20–120 characters** (unchanged).
- Length violations must surface through `validateAeoGeo` (`META_ERR_RE` matchable) so the `fixPrompt` AI repair loop fixes them, rather than silently truncating below the minimum via `clampAtWord`.
- External Astro site repositories are out of scope for this repo.

## Review Focus

- `seoTitle` missing or empty (`""` / `undefined`) -> `validateAeoGeo` emits `"missing seoTitle"` (matched by `META_ERR_RE`).
- `seoTitle` at boundary lengths (`49`, `50`, `60`, `61` chars) -> `49` and `61` fail with `seoTitle <len> not in 50-60` (matched by `META_ERR_RE`); `50` and `60` pass.
- `description` at boundary lengths (`119`, `120`, `160`, `161` chars) -> `119` and `161` fail with `description <len> not in 120-160`; `120` and `160` pass.
- `inasoft-blog-writer.mjs` `seoTitle` > 60 or < 50 -> no longer silently clamped to `<= 50` (which could drop below 50); instead flows to `validateAeoGeo` and `fixPrompt`.
- `fullstackweb-blog-writer.mjs` and `hendranicholas-blog-writer.mjs` -> `frontmatter()` writes `seoTitle`, `META_KEYS` includes `"seoTitle"`, and `stubArticle()` passes `validateArticle()`.

---

### Task 1: Centralize `seoTitle` (50–60) and `description` (120–160) defaults in `scripts/blog-aeo.mjs`

**Files:**
- Modify: `scripts/blog-aeo.mjs:314-327`
- Test: `scripts/blog-aeo-selfcheck.mjs:136-530` (and new boundary assertions)

**Interfaces:**
- Produces: `validateAeoGeo(article, cfg)` in `scripts/blog-aeo.mjs` with default `seoTitleMin = 50`, `seoTitleMax = 60` (when `cfg.requireSeoTitle !== false` or `cfg.seoTitleMin != null || cfg.seoTitleMax != null`; default `seoTitleMin = 50`, `seoTitleMax = 60` whenever `seoTitle` is validated—make `seoTitle` validated by default in `validateAeoGeo` unless `cfg.seoTitle === false`), `descMin = 120`, `descMax = 160`.

- [ ] **Step 1: Update `scripts/blog-aeo-selfcheck.mjs` with 50–60 `seoTitle` and 120–160 `description` tests (failing first)**

Update existing fixtures in `scripts/blog-aeo-selfcheck.mjs` that used `< 50` char `seoTitle` or `descMax: 180` to use valid 50–60 char `seoTitle` and `120–160` `description`, and add boundary tests:
```js
// seoTitle bounds: 50-60 default
assert.ok(
  validateAeoGeo({ ...railsArticle, seoTitle: "x".repeat(49) }, railsdevCfg).metaErrs.some((e) =>
    /seoTitle 49 not in 50-60/.test(e),
  ),
);
assert.ok(
  validateAeoGeo({ ...railsArticle, seoTitle: "x".repeat(61) }, railsdevCfg).metaErrs.some((e) =>
    /seoTitle 61 not in 50-60/.test(e),
  ),
);
assert.equal(validateAeoGeo({ ...railsArticle, seoTitle: "x".repeat(50) }, railsdevCfg).ok, true);
assert.equal(validateAeoGeo({ ...railsArticle, seoTitle: "x".repeat(60) }, railsdevCfg).ok, true);
```
And verify `descMin = 120`, `descMax = 160` boundary (`119`, `120`, `160`, `161`) and `"missing seoTitle"` when `seoTitle` is omitted.

- [ ] **Step 2: Run self-check to verify it fails**

Run: `npm run aeo:selfcheck`
Expected: FAIL (`seoTitle` 49-char check does not fail / `seoTitle 49 not in 50-60` missing).

- [ ] **Step 3: Update `validateAeoGeo` in `scripts/blog-aeo.mjs:314-327`**

Change `seoTitle` validation in `validateAeoGeo(article = {}, cfg = {})`:
- Default `const seoTitleMin = cfg.seoTitleMin ?? 50;` and `const seoTitleMax = cfg.seoTitleMax ?? 60;`.
- Unless `cfg.seoTitle === false`, validate `seoTitle`: if empty push `"missing seoTitle"`; else if `seoTitle.length < seoTitleMin || seoTitle.length > seoTitleMax` push `` `seoTitle ${seoTitle.length} not in ${seoTitleMin}-${seoTitleMax}` ``.
- Keep `descMin = cfg.descMin ?? 120` and `descMax = cfg.descMax ?? 160`.

- [ ] **Step 4: Run self-check to verify it passes**

Run: `npm run aeo:selfcheck`
Expected: PASS (`blog-aeo-selfcheck: ok` / exit 0).

- [ ] **Step 5: Commit**

```bash
git add scripts/blog-aeo.mjs scripts/blog-aeo-selfcheck.mjs
git commit -m "feat(blog-aeo): enforce uniform 50-60 seoTitle and 120-160 description"
```

---

### Task 2: Align `railsdev-blog-writer.mjs` and `inasoft-blog-writer.mjs` to `50–60` `seoTitle`

**Files:**
- Modify: `scripts/railsdev-blog-writer.mjs:165,187,264,269,373-395`
- Modify: `scripts/inasoft-blog-writer.mjs:85,202,247-266,293,352,364,482-503`

**Interfaces:**
- Consumes: `validateAeoGeo` defaults (`seoTitleMin = 50`, `seoTitleMax = 60`, `descMin = 120`, `descMax = 160`) from `scripts/blog-aeo.mjs`.

- [ ] **Step 1: Update `scripts/railsdev-blog-writer.mjs`**

1. Remove `seoTitleMax: 49` and `descMax: DESC_MAX_CHARS` overrides in `validateArticle` (rely on `validateAeoGeo` defaults `50–60` and `120–160`).
2. Update prompt JSON schema (`"seoTitle":"50-60 chars"`) and `fixPrompt` (`- seoTitle: 50-60 chars`, `- description: 120-160 chars`).
3. Update `stubArticle()` and stub `topic` so `seoTitle` is 50–60 chars (e.g., `"Rails Migration Testing: A Practical Zero-Downtime Guide"` — 56 chars).
4. Remove pre-validation `clampAtWord(article.description, DESC_MAX_CHARS)` before `runValidate` (keep only `fixPrompt` repair loop, or if clamping after `fixPrompt`, only clamp when `<=` would stay `>= 120`, never silently below `120`).

- [ ] **Step 2: Update `scripts/inasoft-blog-writer.mjs`**

1. Remove `SEO_TITLE_MAX = 50` and `DESC_MAX_CHARS = 160` overrides in `validateArticle` (rely on `validateAeoGeo` defaults `50–60` and `120–160`).
2. Remove `clampAtWord(a.seoTitle, SEO_TITLE_MAX)` in `validateArticle` (lines 247–251) and `.slice(0, 50)` fallback in `frontmatter()` (line 293).
3. Update prompt JSON schema (`"seoTitle":"50-60 chars"`) and `fixPrompt` (`- seoTitle: 50-60 chars`, `- description: 120-160 chars`).
4. Update `stubArticle()` and stub `topic` so `seoTitle` is 50–60 chars (e.g., `"Panduan Praktis Implementasi AI untuk Bisnis di Indonesia"` — 57 chars).
5. Remove pre-validation `clampAtWord(article.description, DESC_MAX_CHARS)` before `runValidate`.

- [ ] **Step 3: Verify with `AI_STUB=1 DRY_RUN=1` or syntax/self-check**

Run: `node --check scripts/railsdev-blog-writer.mjs && node --check scripts/inasoft-blog-writer.mjs && npm run aeo:selfcheck`
Expected: PASS (exit 0).

- [ ] **Step 4: Commit**

```bash
git add scripts/railsdev-blog-writer.mjs scripts/inasoft-blog-writer.mjs
git commit -m "feat(blogs): align railsdev and inasoft seoTitle to 50-60 chars"
```

---

### Task 3: Add `seoTitle` (50–60) and enforce `description` (120–160) in `fullstackweb-blog-writer.mjs` and `hendranicholas-blog-writer.mjs`

**Files:**
- Modify: `scripts/fullstackweb-blog-writer.mjs` (stub, `META_KEYS`, `validateArticle`, `frontmatter`, prompt JSON, `fixPrompt`, `clampAtWord` removal)
- Modify: `scripts/hendranicholas-blog-writer.mjs` (stub, `META_KEYS`, `validateArticle`, `frontmatter`, prompt JSON, `fixPrompt`, `clampAtWord` removal)
- Test: `scripts/hendranicholas-blog-selfcheck.mjs` and `scripts/fullstackweb-category-selfcheck.mjs`

**Interfaces:**
- Consumes: `validateAeoGeo` defaults (`seoTitleMin = 50`, `seoTitleMax = 60`, `descMin = 120`, `descMax = 160`) from `scripts/blog-aeo.mjs`.

- [ ] **Step 1: Add `seoTitle` and `120–160` `description` assertions to `scripts/hendranicholas-blog-selfcheck.mjs`**

Add assertions verifying:
- `base.seoTitle.length >= 50 && base.seoTitle.length <= 60`
- `base.description.length >= 120 && base.description.length <= 160`
- `validateArticle({ ...base, seoTitle: "Too short" }, []).ok === false`
- `validateArticle({ ...base, description: "Too short description under 120 chars." }, []).ok === false`

- [ ] **Step 2: Run self-checks to verify they fail**

Run: `npm run hendranicholas:selfcheck`
Expected: FAIL (`base.seoTitle` undefined / `descMin: 100` allows < 120).

- [ ] **Step 3: Update `scripts/fullstackweb-blog-writer.mjs`**

1. Remove `DESC_MAX_CHARS = 180`, `descMin: 100`, `descMax: DESC_MAX_CHARS` (use `validateAeoGeo` defaults `50–60` and `120–160`).
2. Add `"seoTitle"` to `META_KEYS`, prompt JSON schema (`"seoTitle":"50-60 chars"`), `fixPrompt` (`- seoTitle: 50-60 chars`, `- description: 120-160 chars`), and `frontmatter()` (`seoTitle: ${JSON.stringify(a.seoTitle)}\n`).
3. Update `stubArticle()` and stub `topic` to include a 50–60 char `seoTitle` and 120–160 char `description`.
4. Remove pre-validation `clampAtWord(article.description, DESC_MAX_CHARS)` before `runValidate`.

- [ ] **Step 4: Update `scripts/hendranicholas-blog-writer.mjs`**

1. Remove `DESC_MAX_CHARS = 180`, `descMin: 100`, `descMax: DESC_MAX_CHARS` (use `validateAeoGeo` defaults `50–60` and `120–160`).
2. Add `"seoTitle"` to `META_KEYS`, prompt JSON schema (`"seoTitle":"50-60 chars"`), `fixPrompt` (`- seoTitle: 50-60 chars`, `- description: 120-160 chars`), and `frontmatter()` (`seoTitle: ${JSON.stringify(a.seoTitle)}\n`).
3. Update `stubArticle()` and stub `topic` to include a 50–60 char `seoTitle` and 120–160 char `description`.
4. Remove pre-validation `clampAtWord(article.description, DESC_MAX_CHARS)` before `runValidate`.

- [ ] **Step 5: Run all self-checks and typecheck**

Run: `npm run typecheck && npm run aeo:selfcheck && npm run hendranicholas:selfcheck && node scripts/fullstackweb-category-selfcheck.mjs`
Expected: All PASS (exit 0).

- [ ] **Step 6: Commit**

```bash
git add scripts/fullstackweb-blog-writer.mjs scripts/hendranicholas-blog-writer.mjs scripts/hendranicholas-blog-selfcheck.mjs
git commit -m "feat(blogs): add 50-60 seoTitle and enforce 120-160 description in fullstackweb and hendranicholas"
```
