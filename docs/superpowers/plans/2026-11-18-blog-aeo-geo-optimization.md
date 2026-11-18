# Blog SEO, AEO & GEO Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align all three automated blog writers (`railsdev-blog-writer.mjs`, `fullstackweb-blog-writer.mjs`, `inasoft-blog-writer.mjs`) and the three Astro site repositories (`railsdev-site`, `fullstackwebdev-site`, `inasoft-site`) so every generated article achieves strong SEO, AEO, and GEO without pipeline-vs-CI drift.

**Architecture:** Centralize universal AEO/GEO prompting, deterministic structural/citation validation, and post-check runner helpers in `scripts/blog-aeo.mjs` inside `cloudflare-ai-scheduler`, while keeping each site's voice, language, URL conventions, and `FAQPage` policy intact. Upgrade each Astro repo (`railsdev-site`: `.md` twins + `FAQPage` JSON-LD + `>=3` FAQ check; `inasoft-site`: strict `ERROR` AEO/GEO checks + `BlogPosting` wordCount/timeRequired; `fullstackwebdev-site`: `BlogPosting` enrichment + optional `keyword` + `scripts/check-post.mjs` keeping `FAQPage` off) and close the loop in the writers before PR creation.

**Tech Stack:** Node 20+ ESM (zero new npm dependencies), Astro 7, TypeScript (`strictest` / `astro check`), Tailwind CSS v4, Prettier (`inasoft-site`), `node --test` / Node `assert/strict` self-checks.

**Spec:** `docs/superpowers/specs/2026-11-18-blog-aeo-geo-optimization-design.md`

## Global Constraints

- **PR-only workflow on all 4 repos:** Never commit or push directly to `main` on `cloudflare-ai-scheduler`, `railsdev-site`, `fullstackwebdev-site`, or `inasoft-site`; every repo ships via feature branch + Pull Request.
- **Zero new dependencies in `cloudflare-ai-scheduler`:** `scripts/*.mjs` stay zero-dep Node 20 ESM.
- **URL & contact conventions per site:**
  - `railsdev.io`: no trailing slash (`/blog/<slug>`, `/services/<slug>`, `/#contact`).
  - `inasoft.id`: no trailing slash (`trailingSlash: "never"`, `/blog/<cat>/<sub>/<slug>`, `/layanan/<slug>`, `/#contact`).
  - `fullstackweb.dev`: trailing slash (`trailingSlash: "always"`, `/blog/<slug>/`, `/services/<slug>/`, `/contact/`).
- **FAQPage policy:** `railsdev-site` and `inasoft-site` emit `FAQPage` JSON-LD extracted from the closing FAQ `##` + `###` blocks; `fullstackwebdev-site` renders `## Frequently asked questions` visibly with `###` Q&As for AEO/GEO **without** `FAQPage` JSON-LD (`CLAUDE.md` rule).
- **No fabricated claims & strict voice:** Never invent benchmarks, percentages, client results, or rates; require `>= 1` real external primary-source citation and `"Verification note"` / `"Catatan verifikasi"` blockquote; enforce `"I"` (no `"our team"`/`"our developers"`) on `railsdev.io` and `fullstackweb.dev`, and `"tim developer berpengalaman"` (no `"engineer senior"`, startup-only framing, or `Rp <digits>`) on `inasoft.id`.
- **CSP & static assets:** No inline `style=""` attributes, no unhashed inline `<script>`s, no external scripts/fonts on any Astro site.

## Review Focus

1. **Punctuated/hyphenated keywords in lead & headings** (e.g., `keyword: "node.js streams"` or `"next-js caching"`): normalization must fold punctuation/hyphens identically in `blog-aeo.mjs` and each `check_post` script so `"Node.js"` matches `"node js"`.
2. **Code fences containing `#` / `###` comments and empty FAQ answers:** `###` counting and heading-level checks must ignore fenced code blocks, and `post-faq.ts` / `validateAeoGeo` must require `>= 3` non-empty `###` Q&As strictly inside the FAQ section (stopping at any subsequent `##`).
3. **Canonical INASOFT internal blog URLs vs legacy 301 redirects:** `loadBlogCorpus` + `inasoft-blog-writer.mjs` must construct `/blog/<category>/<subcategory>/<slug>` (never flat `/blog/<slug>`, which fails `inasoft-site` `audit:seo` as a redirect link).
4. **Metadata vs body error routing in retry loop:** When `validateAeoGeo` catches both metadata errors (e.g., duplicate `keyword`) and body errors (e.g., missing comparison table), metadata fix runs first and body retries receive only body/AEO failures.
5. **Prettier formatting before `inasoft-site` `npm run verify`:** Unformatted LLM-generated Markdown tables/quotes would pass `astro build` and `audit:seo` but break `format:check` on Cloudflare Workers Builds after auto-merge; `inasoft-blog-writer.mjs` must format `.md` via Prettier and run `npm run verify`.

---

### Task 1: Upgrade `railsdev-site` with Markdown twins and blog `FAQPage` JSON-LD

**Repo:** `/home/hendra/Documents/projects/personal/websites/railsdev-site`

**Files:**
- Create: `src/lib/post-faq.ts`
- Create: `src/pages/blog/[slug].md.ts`
- Modify: `src/layouts/Layout.astro:12-27,120-142`
- Modify: `src/pages/blog/[slug].astro:1-85`
- Modify: `src/pages/llms.txt.ts:28-33`
- Modify: `public/_headers:16-22`
- Modify: `.claude/skills/write-blog-article/scripts/check_post.mjs:145-150`

**Interfaces:**
- `postFaqs(body: string): { question: string; answer: string }[]` in `src/lib/post-faq.ts` (matches `## Frequently asked questions` case-insensitively on `^## Frequently asked questions\s*$/i`, splits `^### /m`, flattens Markdown to plain text).
- `Layout.astro` accepts optional `markdownUrl?: string` prop and emits `<link rel="alternate" type="text/markdown" href={markdownUrl} />` in `<head>`.
- `GET` in `src/pages/blog/[slug].md.ts` serves `/blog/<slug>.md` with `Content-Type: text/markdown; charset=utf-8` (skipping `draft: true` via `getPosts()`).

- [ ] **Step 1: Add `src/lib/post-faq.ts` and `src/pages/blog/[slug].md.ts`**

Create `src/lib/post-faq.ts` exporting `postFaqs(body: string): { question: string; answer: string }[]` (ignoring `###` inside fenced code blocks, matching `## Frequently asked questions`, stopping at next `##`, flattening Markdown syntax to plain text).

Create `src/pages/blog/[slug].md.ts` using `getPosts()` from `../lib/blog` to emit `# ${data.title}`, `> ${data.description}`, canonical URL, published/updated dates (`Asia/Jakarta` or ISO date), author (`site.author`), and raw Markdown body.

- [ ] **Step 2: Wire `markdownUrl` and `FAQPage` into `Layout.astro`, `blog/[slug].astro`, `llms.txt.ts`, and `public/_headers`**

- In `src/layouts/Layout.astro`, add optional `markdownUrl?: string` to `Props` and emit `<link rel="alternate" type="text/markdown" href={markdownUrl} />` near `<link rel="alternate" type="application/rss+xml" ... />` when provided.
- In `src/pages/blog/[slug].astro`, call `const faqs = postFaqs(post.body ?? '');`, build `faqPage` node (`@type: 'FAQPage'`, `@id: `${url}#faq``, `mainEntity` array) when `faqs.length > 0`, append it to `graph`, and pass `markdownUrl={`/blog/${post.id}.md`}` to `<Layout>`.
- In `src/pages/llms.txt.ts`, include the `.md` twin URL alongside each post (`- [${post.data.title}](${url(`/blog/${post.id}`)}) ([Markdown](${url(`/blog/${post.id}.md`)}))`).
- In `public/_headers`, add:
  ```
  /blog/*.md
    X-Robots-Tag: noindex
  ```

- [ ] **Step 3: Require `>= 3` `###` FAQ questions in `check_post.mjs`**

In `.claude/skills/write-blog-article/scripts/check_post.mjs` around lines 145–149, extract the `## Frequently asked questions` section (prose only, stopping at next `##`) and push an error if fewer than 3 `### ` subheadings or any empty Q/A entry is found.

- [ ] **Step 4: Verify `railsdev-site` build and outputs**

Run:
```bash
PUBLIC_FORMSPREE_FORM_ID=test npm run build
node -e '
import("node:fs").then(fs => {
  const md = fs.readFileSync("dist/blog/ai-bug-hunting-rails-claude-bughunter.md", "utf8");
  const html = fs.readFileSync("dist/blog/ruby-on-rails-ai-integration.html", "utf8");
  if (!md.startsWith("# ")) throw new Error("missing .md masthead");
  if (!html.includes("type=\"text/markdown\"")) throw new Error("missing alternate markdown link");
  console.log("railsdev-site checks passed");
});
'
```
Expected: `astro check` + `astro build` exit 0, `dist/blog/*.md` exists, and alternate link renders in built HTML. (Also test `postFaqs` on a post containing `## Frequently asked questions` + `###` items to verify `FAQPage` appears in its built `<script type="application/ld+json">`.)

- [ ] **Step 5: Commit on a feature branch in `railsdev-site` (for PR)**

```bash
git checkout -b feat/blog-aeo-geo-twins-faq
git add src/lib/post-faq.ts src/pages/blog/[slug].md.ts src/layouts/Layout.astro src/pages/blog/[slug].astro src/pages/llms.txt.ts public/_headers .claude/skills/write-blog-article/scripts/check_post.mjs
git commit -m "feat(seo): add blog .md twins, FAQPage schema, and strict FAQ check"
```

---

### Task 2: Upgrade `inasoft-site` `check_post.mjs` and `BlogPosting` schema

**Repo:** `/home/hendra/Documents/projects/personal/websites/inasoft-site`

**Files:**
- Modify: `.claude/skills/write-blog-article/scripts/check_post.mjs:140-226`
- Modify: `src/pages/blog/[category]/[subcategory]/[slug].astro:120-165`

**Interfaces:**
- `check_post.mjs` exits 1 on missing/weak AEO/GEO requirements (upgrading `h2Count < 4`, `Conclusion`/`Kesimpulan`, `Frequently asked questions`/`Pertanyaan yang sering diajukan`, `>= 3` `###` FAQ items, `>= 2` distinct internal links, `"Konsultasi Gratis"` or `/#contact` CTA, and `>= 1` external primary-source citation from `WARN`/missing to `ERROR`).
- `BlogPosting` in `src/pages/blog/[category]/[subcategory]/[slug].astro` gains `wordCount` and `timeRequired` (`PTnM`, matching `railsdev-site`).

- [ ] **Step 1: Upgrade AEO/GEO checks in `inasoft-site/.claude/skills/write-blog-article/scripts/check_post.mjs`**

Update lines 147–206 of `check_post.mjs`:
- `h2Count < 4` → `errors.push(...)`
- Missing `## ${conclusionH2}` → `errors.push(...)`
- Missing `## ${faqH2}` → `errors.push(...)`
- Parse `### ` entries inside the `## ${faqH2}` section (stopping at next `##`, outside code fences); if `< 3` questions or any question has an empty answer → `errors.push(...)`
- `new Set(internal).size < 2` → `errors.push(...)` (keep `< 3` as `warnings` if desired, or error at `< 2`)
- Require `/#contact` link OR `"Konsultasi Gratis"` CTA → `if (!internal.some((h) => h === "/#contact") && !prose.includes("Konsultasi Gratis")) errors.push(...)` (and require `/#contact` link in `## ${conclusionH2}` or body as `errors`)
- Add external primary-source check: count `https://` links in `prose` not matching `inasoft.id`; if `< 1` → `errors.push("missing external primary-source citation (need at least 1)")`

- [ ] **Step 2: Add `wordCount` and `timeRequired` to `BlogPosting` in `[slug].astro`**

In `src/pages/blog/[category]/[subcategory]/[slug].astro`, compute `wordCount` and `timeRequired = `PT${Math.max(1, Math.round(wordCount / 230))}M`` from `post.body` and include both in the `BlogPosting` JSON-LD node.

- [ ] **Step 3: Verify `inasoft-site` with `npm run verify` and `check_post.mjs`**

Run:
```bash
npm run format
npm run verify
node .claude/skills/write-blog-article/scripts/check_post.mjs src/content/blog/ai-bug-hunting-claude-bughunter.md || true
```
Expected: `npm run verify` (`format:check && check && build && audit:seo`) passes with 0 errors; `check_post.mjs` reports the expected new errors on the pre-update legacy post (confirming the linter catches missing FAQ `###`s / external links / `/#contact` without breaking `npm run verify`).

- [ ] **Step 4: Commit on a feature branch in `inasoft-site` (for PR)**

```bash
git checkout -b feat/aeo-geo-post-checks
git add .claude/skills/write-blog-article/scripts/check_post.mjs src/pages/blog/[category]/[subcategory]/[slug].astro
git commit -m "feat(seo): enforce AEO/GEO rules in check_post and add BlogPosting metrics"
```

---

### Task 3: Enrich `fullstackwebdev-site` schema and add `scripts/check-post.mjs`

**Repo:** `/home/hendra/Documents/projects/personal/websites/fullstackwebdev-site`

**Files:**
- Modify: `src/content.config.ts:24-43`
- Modify: `src/lib/schema.ts:79-96`
- Modify: `src/pages/blog/[slug].astro:24-50`
- Create: `scripts/check-post.mjs`
- Modify: `package.json:10-18`

**Interfaces:**
- `src/content.config.ts`: adds `keyword: z.string().optional()` to `blog` schema.
- `articleNode(post)` in `src/lib/schema.ts` accepts optional `keywords?: string`, `wordCount?: number`, `timeRequired?: string` and emits them plus `isPartOf: { '@id': WEBSITE_ID }` (still NO `FAQPage`).
- `scripts/check-post.mjs` (exposed as `"check:post": "node scripts/check-post.mjs"` in `package.json`) validates one `.md` file against `fullstackwebdev-site` SEO/AEO/GEO rules.

- [ ] **Step 1: Add optional `keyword` to `src/content.config.ts` and enrich `articleNode` in `src/lib/schema.ts` + `src/pages/blog/[slug].astro`**

- In `src/content.config.ts`, add `keyword: z.string().optional()` to the `blog` schema.
- In `src/lib/schema.ts`, extend `articleNode` parameter type with `keywords?: string; wordCount?: number; timeRequired?: string;` and emit `...(post.keywords ? { keywords: post.keywords } : {}), ...(post.wordCount ? { wordCount: post.wordCount } : {}), ...(post.timeRequired ? { timeRequired: post.timeRequired } : {}), isPartOf: { '@id': WEBSITE_ID }`.
- In `src/pages/blog/[slug].astro`, compute `wordCount` and `timeRequired` from `post.body`, and pass `keywords: post.data.keyword`, `wordCount`, `timeRequired` into `articleNode(...)`.

- [ ] **Step 2: Create `scripts/check-post.mjs` and add `"check:post"` to `package.json`**

Create `scripts/check-post.mjs` (zero-dep Node ESM, mirroring `railsdev-site` `check_post.mjs` adapted to `fullstackwebdev-site`):
- Frontmatter checks: `title`, `description` (120–160 error if >180 or <100; warn if <120 or >160), `category` in `BLOG_CATEGORIES`, `pubDate` with time & offset, `services` non-empty array of valid slugs from `src/data/services/*.ts`, `cover` exists & `coverAlt` non-empty, `slug` lowercase-hyphenated.
- If `data.keyword` is set: `keyword` (punctuation-folded) must appear in first paragraph (`ERROR`), and must not duplicate another post's `keyword` (`ERROR`).
- Headings & fences (outside code fences): no `#` H1 in body, no skipped heading levels, closed code fences, all fences specify a language, no `mermaid`, `>= 4` H2s, `## Conclusion` present, `## Frequently asked questions` present with `>= 3` `###` subheadings and non-empty answers.
- Links: relative internal links must exist (`/`, `/about/`, `/contact/`, `/blog/`, `/services/`, `/projects/`, `/services/<slug>/`, `/blog/<slug>/`, `/projects/<slug>/`), reject absolute `https://fullstackweb.dev/...` links, require `>= 2` distinct internal links including `>= 1` `/services/<slug>/` and `/contact/`, and require `>= 1` external `https://` primary-source citation.
- Voice & language: ban `"our team"`/`"our developers"`/`"our engineers"`, unverifiable superlatives (`number one`, `world-class`, `best-in-class`), hourly rates (`$.../hr`), and `>= 3` Indonesian function words.

Add `"check:post": "node scripts/check-post.mjs"` to `package.json`.

- [ ] **Step 3: Verify `fullstackwebdev-site` build and scripts**

Run:
```bash
PUBLIC_FORMSPREE_FORM_ID=test pnpm verify:blog
pnpm test
node scripts/check-post.mjs src/content/blog/automated-bug-hunting-with-claude-llm.md || true
```
Expected: `pnpm verify:blog` and `pnpm test` pass with 0 errors; `BlogPosting` in `dist/blog/automated-bug-hunting-with-claude-llm/index.html` contains `wordCount`, `timeRequired`, and `isPartOf`; `check-post.mjs` runs cleanly and reports expected legacy missing items.

- [ ] **Step 4: Commit on a feature branch in `fullstackwebdev-site` (for PR)**

```bash
git checkout -b feat/aeo-geo-schema-and-post-check
git add src/content.config.ts src/lib/schema.ts src/pages/blog/[slug].astro scripts/check-post.mjs package.json
git commit -m "feat(seo): enrich BlogPosting JSON-LD and add check:post AEO/GEO linter"
```

---

### Task 4: Build shared `scripts/blog-aeo.mjs` and corpus fix in `cloudflare-ai-scheduler`

**Repo:** `/home/hendra/Documents/projects/personal/cloudflare-ai-scheduler`

**Files:**
- Modify: `scripts/published.mjs:296-332`
- Create: `scripts/blog-aeo.mjs`
- Create: `scripts/blog-aeo-selfcheck.mjs`
- Modify: `package.json:18-23`

**Interfaces:**
- `loadBlogCorpus(siteDir)` in `scripts/published.mjs` now handles nested `.md` files (already needed or verify `inasoft-site` — check `readdirSync`! Currently `loadBlogCorpus` is flat; if `inasoft-site` has flat `.md` files under `src/content/blog/`, still read `category`, `subcategory`, `draft` from frontmatter into each returned object: `{ slug, title, keyword, seoTitle, category, subcategory, draft }`).
- `buildAeoGeoBodyRules(cfg)` in `scripts/blog-aeo.mjs`: returns formatted Markdown prompt block for `cfg = { siteName, lang, domain, voiceRule, keyword, serviceHref, contactHref, ctaInstruction, validPostLinks, extraRules }`.
- `validateAeoGeo(article, cfg)` in `scripts/blog-aeo.mjs`: returns `{ ok, errs, metaErrs, bodyErrs, links, wordCount }` checking:
  - Title/description/slug/keyword presence + duplicate `keyword` against `cfg.existingKeywords` (as `metaErr`!)
  - Answer-first lead: `keyword` (folded) in first paragraph, opening paragraph present before first `##`
  - Heading structure: no H1, no skipped heading levels (`next > level + 1`), `>= 4` H2s, all fences closed and language-tagged, no `mermaid`, no placeholder tokens
  - Markdown table present (`/^\|.+\|\s*\n\|[\s:-]+\|/m`)
  - Required closing sections: `cfg.conclusionHeading` and `cfg.faqHeading` with `>= 3` `###` Q&As strictly inside the FAQ section (ignoring code fences) and each answer non-empty
  - Verification blockquote present (`cfg.verificationPattern`)
  - Relative internal links: zero `https://${cfg.domain}` links, `>= 2` distinct internal links, includes `cfg.servicePrefix` (when required), includes `cfg.contactHref`, and every `/blog/...` link exists in `cfg.validBlogPaths`
  - External primary-source citations: `>= 1` `https://` link not on `cfg.domain`
  - Site banned phrases & language checks (`cfg.bannedPatterns`, `cfg.indonesianGuard`)
- `servicePathFor(site, article)` in `scripts/blog-aeo.mjs`: maps `railsdev`, `fullstackweb`, `inasoft` services to canonical service paths.
- `runSitePostCheck({ siteDir, relMdPath })` in `scripts/blog-aeo.mjs`: runs `.claude/skills/write-blog-article/scripts/check_post.mjs` or `scripts/check-post.mjs` when present and throws descriptive error on failure.

- [ ] **Step 1: Write failing self-check `scripts/blog-aeo-selfcheck.mjs`**

Test all 5 Review Focus cases plus baseline valid/invalid cases using `node:assert/strict`:
1. Valid EN (`railsdev`, `fullstackweb`) and valid ID (`inasoft`) articles pass `validateAeoGeo`.
2. Punctuated/hyphenated keywords (`"node.js streams"` matched against `"Node.js streams..."` in first paragraph) pass, while missing keyword from first paragraph fails.
3. `### ` inside a fenced bash/python code block is ignored; an FAQ section with only 2 `###` items or an empty answer fails; a `## Conclusion` after FAQ stops FAQ parsing cleanly.
4. Absolute self-domain link (`https://inasoft.id/blog/...`) or legacy flat `/blog/rag-adalah` link when `validBlogPaths` holds `/blog/ai-engineering/rag/rag-adalah` fails validation.
5. Duplicate `keyword` returns `metaErrs` separately from `bodyErrs` (`missing Markdown comparison/decision table`, `skipped heading level`, `"our team"` on solo-dev sites, `"engineer senior"` on INASOFT).

- [ ] **Step 2: Run self-check to verify it fails**

Run: `node scripts/blog-aeo-selfcheck.mjs`
Expected: FAIL (`Cannot find module './blog-aeo.mjs'`).

- [ ] **Step 3: Extend `loadBlogCorpus` in `scripts/published.mjs` and implement `scripts/blog-aeo.mjs`**

- Update `loadBlogCorpus(siteDir)` in `scripts/published.mjs` to include `category`, `subcategory`, `draft: /^draft:\s*true/im.test(fm)`.
- Implement `scripts/blog-aeo.mjs` with `foldText`, `buildAeoGeoBodyRules`, `validateAeoGeo`, `servicePathFor`, `runSitePostCheck`, and `isMetaErr`.
- Add `"aeo:selfcheck": "node scripts/blog-aeo-selfcheck.mjs"` to `package.json`.

- [ ] **Step 4: Run self-check to verify it passes**

Run: `npm run aeo:selfcheck`
Expected: PASS (all assertions green, exit 0).

- [ ] **Step 5: Commit shared AEO/GEO module**

```bash
git add scripts/published.mjs scripts/blog-aeo.mjs scripts/blog-aeo-selfcheck.mjs package.json
git commit -m "feat(blog): add shared AEO/GEO prompt, validator, and self-check"
```

---

### Task 5: Integrate `blog-aeo.mjs` into all three blog writers and verify end-to-end

**Repo:** `/home/hendra/Documents/projects/personal/cloudflare-ai-scheduler`

**Files:**
- Modify: `scripts/railsdev-blog-writer.mjs`
- Modify: `scripts/fullstackweb-blog-writer.mjs`
- Modify: `scripts/inasoft-blog-writer.mjs`

**Interfaces:**
- Each writer imports `{ buildAeoGeoBodyRules, validateAeoGeo, servicePathFor, runSitePostCheck, isMetaErr }` from `./blog-aeo.mjs`.
- Each writer passes existing corpus keywords into `topicPrompt` ("Avoid these existing target keywords: ...") and `validateAeoGeo` so duplicate keywords are caught before writing `.md`.
- Each writer updates `stubArticle()` so `AI_STUB=true DRY_RUN=true` passes `validateAeoGeo`, site `check:post`, and site build/verify commands.

- [ ] **Step 1: Refactor `scripts/railsdev-blog-writer.mjs` onto `blog-aeo.mjs`**

- Pass `existingKeywords` to `topicPrompt` and `validateAeoGeo`.
- Replace inline AEO/GEO rules in `bodyPrompt` and `validateArticle` with `buildAeoGeoBodyRules` + `validateAeoGeo` (preserving `railsdev` constraints: `seoTitle <= 49`, `description 120–160`, `SERVICE_LINKS` with `"Custom Module": "/services/custom-web-application-development"`, `"I"` voice, `/#contact`, `## Frequently asked questions`, `## Conclusion`, `Verification note`).
- Update `stubArticle()` to include a comparison table and `>= 3` `###` FAQ items.
- Keep `runSitePostCheck` + `npm run build` before PR creation.

- [ ] **Step 2: Update `scripts/fullstackweb-blog-writer.mjs` with `blog-aeo.mjs` and site verification**

- Add `keyword` to `META_KEYS`, `topicPrompt`, `fixPrompt`, and `frontmatter(article)` (`keyword: ${JSON.stringify(a.keyword)}\n`).
- Replace `bodyPrompt` and `validateArticle` with `buildAeoGeoBodyRules` + `validateAeoGeo` configured for `fullstackweb.dev` (trailing slashes: `/blog/<slug>/`, `/services/<slug>/`, `/contact/`, `"I"` voice, `## Frequently asked questions` with `>= 3` `###` items, `## Conclusion`, comparison table, external citation, `Verification note`).
- Update `stubArticle()` to pass all checks (comparison table, `>= 3` `###` FAQ items, `/services/.../`, `/contact/`, external link).
- After writing `.md`, run `runSitePostCheck` (`scripts/check-post.mjs`) and `npm run build && node scripts/check-blog-build.mjs`.

- [ ] **Step 3: Update `scripts/inasoft-blog-writer.mjs` with `blog-aeo.mjs`, canonical links, Prettier, and `npm run verify`**

- Build `validBlogPaths` and `existingLinks` using canonical `/blog/${c.category}/${c.subcategory}/${c.slug}` from `loadBlogCorpus` (falling back only if missing).
- Replace `bodyPrompt` and `validateArticle` with `buildAeoGeoBodyRules` + `validateAeoGeo` configured for `inasoft.id` (Bahasa Indonesia, KBBI, `"kami"` / `"tim developer berpengalaman"`, banned `"engineer senior"` / `"Series A"` / `"runway"` / `"pendanaan"` / `Rp <digits>`, `/layanan/<service>`, `/#contact` + `"Konsultasi Gratis"`, `## Pertanyaan yang sering diajukan` with `>= 3` `###` items, `## Kesimpulan`, comparison table, external citation, `Catatan verifikasi`).
- Update `stubArticle()` with realistic Indonesian stub containing a Markdown table, `>= 3` `###` FAQ items, canonical internal links (`/layanan/jasa-pembuatan-ai-agent`, `/#contact`, existing post `/blog/...`), `"Konsultasi Gratis"`, and external primary source.
- After writing `.md` and generating cover: run `npx prettier --write <mdPath>` (best-effort if `prettier` installed in `SITE_DIR`), run `runSitePostCheck`, and run `npm run verify` (`format:check && check && build && audit:seo`) instead of bare `npm run build`!

- [ ] **Step 4: Run full verification across all 4 repos**

Run in `cloudflare-ai-scheduler`:
```bash
npm run typecheck
npm run aeo:selfcheck
npm run published:selfcheck
SITE_DIR=/home/hendra/Documents/projects/personal/websites/railsdev-site DRY_RUN=true AI_STUB=true PUBLIC_FORMSPREE_FORM_ID=test node scripts/railsdev-blog-writer.mjs
SITE_DIR=/home/hendra/Documents/projects/personal/websites/fullstackwebdev-site DRY_RUN=true AI_STUB=true PUBLIC_FORMSPREE_FORM_ID=test node scripts/fullstackweb-blog-writer.mjs
SITE_DIR=/home/hendra/Documents/projects/personal/websites/inasoft-site DRY_RUN=true AI_STUB=true PUBLIC_FORMSPREE_FORM_ID=test node scripts/inasoft-blog-writer.mjs
```
*(Clean up any generated stub `.md`/`.png` files in the 3 local site checkouts immediately after verifying so those repos stay clean on their feature branches.)*

Expected: `typecheck`, `aeo:selfcheck`, `published:selfcheck`, and all 3 `DRY_RUN=true AI_STUB=true` runs pass end-to-end (including `check_post` and Astro build/verify!).

- [ ] **Step 5: Commit writer updates and verify clean git status**

```bash
git add scripts/railsdev-blog-writer.mjs scripts/fullstackweb-blog-writer.mjs scripts/inasoft-blog-writer.mjs
git commit -m "feat(blogs): integrate shared AEO/GEO generation and verification across all 3 writers"
git grep -n -E '^(<<<<<<< |>>>>>>> )' -- .
```
Expected: clean commit on feature branch, zero conflict markers.

---

## Self-Review Summary

- **Spec coverage:** Every section of `2026-11-18-blog-aeo-geo-optimization-design.md` maps directly to Tasks 1–5 (`railsdev-site` Task 1, `inasoft-site` Task 2, `fullstackwebdev-site` Task 3, `blog-aeo.mjs` + `published.mjs` Task 4, 3 writers + end-to-end verification Task 5).
- **Type & signature consistency:** `validateAeoGeo`, `buildAeoGeoBodyRules`, `servicePathFor`, `runSitePostCheck`, `isMetaErr` match between Task 4 and Task 5; `postFaqs` matches `inasoft-site` and `railsdev-site` Task 1; `articleNode` fields match `fullstackwebdev-site` Task 3.
- **Rollout order:** Open and merge PRs for Tasks 1–3 in the 3 Astro site repos first (or alongside Task 4–5), then merge the `cloudflare-ai-scheduler` PR and run `workflow_dispatch` with `dry_run=true` on each blog writer workflow.
