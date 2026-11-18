# Blog SEO, AEO & GEO Optimization Across All Three Sites

**Date:** 2026-11-18
**Status:** Approved
**Approach selected:** Approach A — Shared AEO/GEO writer core in `cloudflare-ai-scheduler` + per-site rules and Astro template/schema parity across `railsdev-site`, `fullstackwebdev-site`, and `inasoft-site`.

## Intent and Why

Every automated blog article produced by `cloudflare-ai-scheduler` (`railsdev-blog-writer.mjs`, `fullstackweb-blog-writer.mjs`, `inasoft-blog-writer.mjs`) should ship with strong **SEO** (search ranking & intent alignment), **AEO** (answer-first passages, structured Q&A/FAQ, extractable headings/tables for featured snippets and answer engines), and **GEO** (verifiable citations, clear entity attribution, Markdown twins, and zero fabricated benchmarks for Google AI Overviews/AI Mode, ChatGPT, and Perplexity), tailored to each website's audience, language, and positioning.

Right now the four repositories are at different stages of AEO/GEO readiness:
- `railsdev-site` recently added entity graph fixes, `/about`, dynamic `/llms.txt`, and strict AEO/GEO enforcement in `.claude/skills/write-blog-article/scripts/check_post.mjs` + PR CI (`#67`, `#73`), and `scripts/railsdev-blog-writer.mjs` was updated in PR `#94` (`6366479`) to require `## Frequently asked questions`, `## Conclusion`, `/services/<slug>`, `/#contact`, keyword in first paragraph, and `check_post.mjs`. **However**, `railsdev-blog-writer.mjs` still lacks shared structured-table / self-contained-passage / duplicate-keyword / voice-and-heading pre-checks (so `check_post.mjs` can still fail fatally after generation with no retry), and `railsdev-site` still lacks per-post `.md` twins and blog `FAQPage` JSON-LD.
- `inasoft-site` already extracts `## Pertanyaan yang sering diajukan` (`###` items) into `FAQPage` JSON-LD and serves `.md` twins (`c018219`), **but** `scripts/inasoft-blog-writer.mjs` does not generate that FAQ heading format, emits legacy 301 `/blog/<slug>` internal link hints instead of `/blog/<category>/<subcategory>/<slug>`, does not run `check_post.mjs` or `npm run verify` (`format:check && check && build && audit:seo`), and its `check_post.mjs` rules are mostly `WARN` instead of `ERROR`.
- `fullstackwebdev-site` serves `.md` twins for every page and checks them in `scripts/check-blog-build.mjs`, **but** its `BlogPosting` JSON-LD omits `wordCount`, `timeRequired`, `keywords`, and `isPartOf`, it has no per-post `check_post` linter, and `fullstackweb-blog-writer.mjs` lacks AEO/GEO structure, citations, and voice guards.

## Goals, Non-Goals, and Anti-Goals

### Goals
1. **Shared AEO/GEO generation & validation core** in `cloudflare-ai-scheduler` (`scripts/blog-aeo.mjs`) reused by all three blog writers.
2. **Site-specific rules preserved** (language, persona/pronouns, service URL patterns, CTA wording, trailing-slash conventions, and `FAQPage` JSON-LD policy).
3. **Closed validation loop before PR creation**: writer validation incorporates site `check_post` errors into the AI retry loop before cover generation, Astro build, and git/PR steps.
4. **Astro template/schema parity** across the three websites so every new (and existing, where template-driven) article exposes clean structured data, machine-readable `.md` twins, and valid internal/external citations.

### Non-Goals
- **Backfilling all existing published `.md` articles** in the three site repositories (legacy posts stay untouched unless template/schema changes wrap them automatically; CI continues checking only added/modified posts where applicable).
- **Adding new paid SEO APIs or external dependencies** (all scripts remain zero-dependency Node 20 ESM).
- **Changing the blog cover pipeline** (`scripts/cover/`) or deduplication ledger (`scripts/published.mjs`).

### Anti-Goals
- **Breaking site-specific positioning**: e.g., using `"our team"` on solo-consultant sites (`railsdev.io`, `fullstackweb.dev`), publishing hourly rates/prices, or using startup-only framing on `inasoft.id`.
- **Adding `FAQPage` JSON-LD to `fullstackwebdev-site`**, whose `CLAUDE.md` explicitly forbids `FAQPage` schema on the site (it will still render a visible `## Frequently asked questions` section for AEO/GEO readability without JSON-LD).
- **Fabricating benchmarks, client metrics, or URLs**: prompts and validators must reinforce factual grounding, require at least one HEAD-verified primary-source citation, and keep `"Verification note"` / `"Catatan verifikasi"` blockquotes.

## Constraints

- **PR-only workflow on all 4 repos**: never commit directly to `main`; every repo lands changes via branch + PR (`cloudflare-ai-scheduler` first or coordinated with site repo PRs before enabling live runs).
- **CSP & performance on all 3 Astro sites**: zero inline `<script>`/`<style>` attributes that break hash-based CSP, zero client-side frameworks, static output only.
- **URL and contact-link conventions**:
  - `railsdev.io`: no trailing slash (`/blog/<slug>`, `/services/<slug>`, `/#contact`).
  - `inasoft.id`: no trailing slash (`trailingSlash: "never"`, `/blog/<cat>/<sub>/<slug>`, `/layanan/<slug>`, `/#contact`).
  - `fullstackweb.dev`: trailing slash (`trailingSlash: "always"`, `/blog/<slug>/`, `/services/<slug>/`, **`/contact/`** — matching `CtaBanner.astro`, `Footer.astro`, `llms.txt.ts`, and all existing blog posts).
- **Astro content schemas**:
  - `railsdev-site`: `seoTitle` max 49, `description` 120–160, `service` from `contactServices`.
  - `inasoft-site`: `seoTitle` max 50, `description` max 160, `category`/`subcategory`/`pillar`/`service` validated against closed enums.
  - `fullstackwebdev-site`: `category` from `BLOG_CATEGORIES`, `services` array of service slugs, `keyword` currently not in schema (to be added as optional `z.string().optional()` in `content.config.ts` so existing posts don't break while new posts carry `keyword` for `BlogPosting.keywords` and duplicate-keyword checks).

## Approaches Considered

- **Approach A — Shared AEO/GEO writer core + per-site rules & targeted Astro parity (Chosen):** Centralize universal AEO/GEO prompting, structural checks, and retry-with-feedback in `scripts/blog-aeo.mjs`; keep each writer's persona/schema/CTA config in its own script; close only the real AEO/GEO gaps in each Astro repo while respecting `CLAUDE.md` policies.
- **Approach B — 100% identical schema/templates everywhere:** Force `FAQPage` JSON-LD onto `fullstackwebdev-site` as well, overriding its `CLAUDE.md` decision. Rejected because it contradicts existing site policy without user demand.
- **Approach C — Prompts/scripts only in `cloudflare-ai-scheduler`:** Skip `.md` twins on `railsdev-site`, `BlogPosting` enrichment/`check_post` on `fullstackwebdev-site`, and strict `check_post` upgrades on `inasoft-site`. Rejected because the user explicitly asked for both the article generator and Astro template/schema updates, and leaving validators uneven invites drift.

## Detailed Design

### 1. Shared Module: `scripts/blog-aeo.mjs` (`cloudflare-ai-scheduler`)

A small zero-dependency helper module imported by all three `*-blog-writer.mjs` scripts:

1. **`buildAeoGeoBodyRules(config)`**: Returns prompt instructions tailored by language (`"en"` | `"id"`) and site config:
   - **Answer-first lead (AEO/GEO citability):** The very first paragraph (before any `##` heading) MUST be 40–65 words, directly answer/define the primary topic and `keyword`, and contain the exact `keyword` naturally (no opening with a multi-sentence personal anecdote before answering what the topic is).
   - **Scannable, extractable structure:**
     - `>= 5` `##` headings, with at least 2 phrased as natural questions or clear decision topics matching search intent (e.g., `## How does X work?` / `## Cara kerja X`).
     - Short paragraphs (2–4 sentences), bullet/numbered steps, and **at least one Markdown comparison or decision table** (`| ... | ... |`).
     - Self-contained answer paragraphs right under each `##` heading (first 1–2 sentences directly answer that heading before diving into details/code).
     - No `#` H1 in body, no skipped heading levels (`##` → `####` forbidden), no `mermaid` fences, every code fence tagged with a language.
   - **Factual grounding & citations (GEO authority):**
     - **At least 1–2 external primary-source citations** as inline Markdown links (`https://...` to official docs, GitHub repo, release notes, or RFC/spec) — never invented URLs.
     - Explicit `"Verification note"` (EN) or `"Catatan verifikasi"` (ID) blockquote for unverified/environment-dependent claims; **strictly forbid** inventing benchmarks, performance percentages, pricing/rates, or client case studies.
   - **Internal links & contextual CTA:**
     - **2–4 relative internal links** (never `https://<own-domain>/...`):
       - Link to the matching service page (`config.serviceUrl`, e.g., `/services/ai-software-development`, `/services/ai-engineering/`, or `/layanan/jasa-pembuatan-ai-agent`).
       - 1–2 links to existing corpus posts from the provided list.
       - Closing CTA inside `## Conclusion` / `## Kesimpulan` linking `config.contactUrl` (`/#contact` for `railsdev` and `inasoft`; `/contact/` for `fullstackweb`), plus site-specific CTA phrasing (e.g., `"Konsultasi Gratis"` for INASOFT).
   - **Closing FAQ section (AEO + `FAQPage` extraction):**
     - Final section MUST be `## Frequently asked questions` (EN) or `## Pertanyaan yang sering diajukan` (ID) with **4–6 `### Question?` subheadings**. Each answer is 2–4 sentences starting with the direct answer first.

2. **`validateAeoGeo(article, config)`**: Fast, deterministic pre-build checks run inside the writer's validation & retry loop (catching issues before writing `.md` or rendering cover):
   - Keyword appears in first paragraph (case/punctuation-folded, matching each site's `check_post.mjs` logic) and does not duplicate any existing post's `keyword`.
   - No skipped heading levels (`next > level + 1`), no H1 in body, no `mermaid`, every opening code fence specifies a language (` ```lang `).
   - Required sections present: Conclusion heading (`## Conclusion` / `## Kesimpulan`) and FAQ heading (`## Frequently asked questions` / `## Pertanyaan yang sering diajukan`) with `>= 3` `###` subheadings, each having non-empty answer text.
   - Markdown table present (`/^\|.+\|\s*\n\|[\s:-]+\|/m`).
   - Relative internal links: `>= 2` distinct internal links, includes `config.serviceUrl` (when a service page applies), includes `config.contactUrl` (`/#contact` or `/contact/`), zero absolute self-domain links, and every `/blog/...` link exists in `config.validBlogPaths`.
   - External citations: `>= 1` `https://...` link not pointing to the site's own domain (still HEAD-checked by existing step 4b, failing if all external citations are dead).
   - Site-specific banned phrases & language checks (e.g. `"our team"`/`"our developers"` and Indonesian slip check for EN sites; `"engineer senior"`, `"Rp <num>"`, `"nomor 1"` for INASOFT; unverifiable superlatives across all 3).
   - `isMetaErr` / `isBodyErr` classification preserved so metadata fixes only fix metadata and body retries receive the exact AEO/GEO failure list.

3. **`runSitePostCheck({ siteDir, relMdPath })`**: Runs `node .claude/skills/write-blog-article/scripts/check_post.mjs <relMdPath>` (if present in `siteDir`) after writing `.md` and before `astro build`, failing with stdout/stderr tail if exit != 0.

4. **`servicePathFor(site, article)`** mapping:
   - `railsdev`: Preserves existing `SERVICE_LINKS` in `railsdev-blog-writer.mjs` (`MVP Build` → `/services/saas-mvp-development`, `Rails Upgrade` → `/services/legacy-rails-modernization`, `Custom Module` → `/services/custom-web-application-development`, `Code Audit` → `/services/ruby-on-rails-consulting`, `AI Integration` → `/services/ai-software-development`).
   - `fullstackweb`: Picks primary `article.services[0]` → `/services/${slug}/` (trailing slash).
   - `inasoft`: `article.service` → `/layanan/${article.service}` (no trailing slash).

### 2. Per-Writer Updates (`cloudflare-ai-scheduler`)

- **`scripts/railsdev-blog-writer.mjs`**:
  - Refactor PR `#94` inline checks into shared `blog-aeo.mjs`; update `topicPrompt` to avoid duplicating any existing post's `keyword` (pass existing keywords in prompt + enforce in `checkTopicCollision` / validation); update `bodyPrompt` with `buildAeoGeoBodyRules` (adding the structured comparison/decision table, self-contained section openings, and `>= 3` `###` FAQ items).
  - Add the missing pre-write checks in `validateAeoGeo` (no skipped heading levels, tagged code fences, no `mermaid`, `>= 3` `###` FAQ items, Markdown table, duplicate keyword, banned voice/Indonesian-word guards) so failures trigger the AI retry loop instead of dying at `check_post.mjs`.
  - Update `stubArticle()` to satisfy every AEO/GEO & `check_post.mjs` rule (including a table and `>= 3` `###` FAQ items) so `AI_STUB=true DRY_RUN=true` passes end-to-end.
- **`scripts/fullstackweb-blog-writer.mjs`**:
  - Same integration, configured for `fullstackweb.dev`: first-person `"I"`, English, `keyword` emitted in topic JSON (checked for duplicates) and written to frontmatter (`keyword: ${JSON.stringify(a.keyword)}`), trailing-slash internal links (`/blog/<slug>/`, `/services/<slug>/`, `/contact/`), `## Conclusion`, `## Frequently asked questions` with `>= 3` `###` questions, table, external citation.
  - Update `stubArticle()` to pass all checks.
  - Run `check_post.mjs` (or `scripts/check-post.mjs`) + `npm run build` + `node scripts/check-blog-build.mjs`.
- **`scripts/inasoft-blog-writer.mjs`**:
  - Same integration, configured for `inasoft.id`: Bahasa Indonesia (KBBI, `"kami"` / `"tim developer berpengalaman"`, never `"engineer senior"` or startup-only framing `"Series A"`/`"runway"`/`"pendanaan"` or prices `Rp ...`), `/layanan/<service>`, `/blog/<category>/<subcategory>/<slug>` (update `loadBlogCorpus` / `existingLinks` so internal blog links use canonical `/blog/<category>/<subcategory>/<slug>`, not legacy 301 `/blog/<slug>`), `/#contact` + `"Konsultasi Gratis"`, `## Kesimpulan`, `## Pertanyaan yang sering diajukan` with `>= 3` `###` questions, table, external citation, `Catatan verifikasi`.
  - Update `stubArticle()` to pass all checks.
  - Format the written `.md` with `npx prettier --write` (so `format:check` passes on `main` Cloudflare deploys), then run `check_post.mjs` + `npm run verify` (`format:check && check && build && audit:seo`)!

> **Important existing bug caught during inspection:** `inasoft-blog-writer.mjs` currently builds `existingLinks` as `/blog/${c.slug}` — which on `inasoft-site` is a legacy 301 redirect, NOT the canonical `/blog/<category>/<subcategory>/<slug>` URL! `inasoft-site/scripts/seo-audit.mjs` and `check_post.mjs` explicitly reject links to redirects or flat `/blog/<slug>`! `loadBlogCorpus` (or `inasoft-blog-writer.mjs`) will read `category` + `subcategory` from frontmatter so `existingLinks` and link validation use `/blog/<category>/<subcategory>/<slug>`.

### 3. Astro Site Repository Updates

#### A. `railsdev-site`
1. **Per-post Markdown twins (`src/pages/blog/[slug].md.ts`)**:
   - Mirror `inasoft-site` / `fullstackwebdev-site`: serve each published post as `text/markdown; charset=utf-8` at `/blog/<slug>.md` with masthead (`# title`, `> description`, canonical URL, published/updated dates, author, body).
   - Add `<link rel="alternate" type="text/markdown" href="/blog/<slug>.md" />` on `src/pages/blog/[slug].astro` (via optional `markdownUrl` prop on `Layout.astro`).
   - Add `X-Robots-Tag: noindex` rule for `/blog/*.md` in `public/_headers` (matching `fullstackwebdev-site`) so Google indexes the HTML canonical while AI crawlers/agents fetch `.md` cleanly.
   - Update `src/pages/llms.txt.ts` so blog entries include the `.md` URL (or keep HTML + `.md` note consistently).
2. **Blog `FAQPage` JSON-LD (`src/lib/post-faq.ts` + `src/pages/blog/[slug].astro`)**:
   - Extract `## Frequently asked questions` (`###` subheadings) into `{ question, answer }[]` (plain text flattened, matching `inasoft-site/src/lib/post-faq.ts`).
   - When non-empty, append a `FAQPage` node (`@id: `${url}#faq``) to the `graph` prop in `src/pages/blog/[slug].astro` (matching `services/[slug].astro` which already uses `FAQPage`).
3. **`check_post.mjs`**:
   - Ensure under `## Frequently asked questions` it checks for `>= 3` `###` subheadings (as `ERROR`) so `FAQPage` schema is never emitted empty on new posts.

#### B. `inasoft-site`
1. **Upgrade `.claude/skills/write-blog-article/scripts/check_post.mjs` AEO/GEO rules to `ERROR`** (matching `railsdev-site` #73):
   - `h2Count < 4` → `ERROR`
   - Missing `## Kesimpulan` / `## Conclusion` → `ERROR`
   - Missing `## Pertanyaan yang sering diajukan` / `## Frequently asked questions` → `ERROR`
   - `< 3` `###` Q&A items inside the FAQ section (or empty question/answer) → `ERROR` (guarantees `post-faq.ts` + `seo-audit.mjs` always produce valid `FAQPage` schema)
   - Distinct internal links `< 2` → `ERROR`
   - Missing `/#contact` CTA link or `"Konsultasi Gratis"` → `ERROR` (keep `/layanan/<service>` check already `ERROR`)
   - External primary-source citations `< 1` (`https://...` outside `inasoft.id`) → `ERROR`
2. *(Optional template polish)*: Check that `BlogPosting` in `[slug].astro` already has `keywords`, `articleSection`, `inLanguage`, `author`, `publisher`, `FAQPage`, `.md` twin, and `updatedDate`. (Already present from `c018219`; verify `wordCount` / `timeRequired` can be added cleanly to `BlogPosting` alongside `railsdev-site`.)

#### C. `fullstackwebdev-site`
1. **Schema & Frontmatter (`src/content.config.ts`, `src/lib/schema.ts`, `src/pages/blog/[slug].astro`)**:
   - Add optional `keyword: z.string().optional()` to `blog` schema in `src/content.config.ts` (non-breaking for existing posts; new automated posts populate it).
   - Enrich `articleNode()` in `src/lib/schema.ts` with optional `keywords`, `wordCount`, `timeRequired` (`PTnM`), and `isPartOf: { '@id': WEBSITE_ID }` (passed from `src/pages/blog/[slug].astro`).
   - Keep `FAQPage` **off** per `CLAUDE.md` ("Don't add `FAQPage` or rating markup").
2. **Per-post AEO/GEO linter (`scripts/check-post.mjs` + `"check:post"` in `package.json`)**:
   - Enforce `fullstackwebdev-site` rules: `title`, `description` (120–160), `keyword` (when present: in first paragraph + no duplicate across corpus), `category`, `services`, `cover`/`coverAlt`, `>= 4` H2s, no H1 in body, no skipped heading levels, closed code fences with language, no mermaid, `## Conclusion`, `## Frequently asked questions` (`>= 3` `###` questions), `>= 2` valid relative trailing-slash internal links (including at least one `/services/<slug>/` and `/contact/`), `>= 1` external primary-source citation, and voice rules (`"I"` not `"our team"`/`"our developers"`, no unverifiable superlatives or unpublished rates).
   - Add `scripts/check-post.mjs` check on changed `src/content/blog/*.md` in CI if a PR workflow is present, and run `pnpm check:post` inside `fullstackweb-blog-writer.mjs` alongside `npm run build` and `node scripts/check-blog-build.mjs`.

## Verification Strategy

1. **Per Astro repo** (on feature branches via PRs):
   - `railsdev-site`: `npm run check:post -- <sample-or-new-post>` + `npm run build` (`dist/blog/<slug>.md` exists, `<link rel="alternate" type="text/markdown">` + `FAQPage` JSON-LD present in built HTML).
   - `inasoft-site`: `node .claude/skills/write-blog-article/scripts/check_post.mjs <sample-post>` + `npm run verify` (`format:check`, `check`, `build`, `audit:seo`).
   - `fullstackwebdev-site`: `npm run check:post -- <sample-post>` + `npm run build` + `node scripts/check-blog-build.mjs` (verify `BlogPosting` includes `wordCount`/`timeRequired`/`isPartOf` and `keywords` when set).
2. **In `cloudflare-ai-scheduler`**:
   - Self-check unit/assertion test for `scripts/blog-aeo.mjs` (`npm run aeo:selfcheck` or similar) covering valid AEO/GEO articles, missing FAQ `###`s, missing external citations, missing answer-first keyword, skipped headings, and INASOFT canonical category URLs.
   - `npm run typecheck`.
   - `AI_STUB=true DRY_RUN=true` runs of all 3 writers against local checkouts of the 3 updated site repos (`SITE_DIR=... PUBLIC_FORMSPREE_FORM_ID=test`).
   - Live `dry_run=true` workflow dispatches on GitHub Actions after site repo PRs merge.

## Left to the Builder

- Exact regex patterns and helper factorization inside `scripts/blog-aeo.mjs`.
- Handling legacy posts when running `check_post.mjs` in CI (e.g., `railsdev-site` and `inasoft-site` / `fullstackwebdev-site` only lint PR-added/modified posts so legacy posts don't block unrelated PRs).
- Rollout order: land & merge site-repo PRs first (or ensure `cloudflare-ai-scheduler` writers remain compatible before & after merge), then merge the `cloudflare-ai-scheduler` PR.
