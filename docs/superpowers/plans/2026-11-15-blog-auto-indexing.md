# Blog auto-indexing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a blog writer auto-merges, wait until the article is live, then ping IndexNow (Bing) and resubmit the sitemap to Google Search Console.

**Architecture:** New zero-dep helper `scripts/site-index.mjs` (never throws), called by the three writers only after `mergePr` → `merged:true`; result appended to the "published" Slack note.

**Tech Stack:** Node 20+ ESM (`fetch`, `node:crypto`), GitHub Actions secrets.

**Spec:** `docs/superpowers/specs/2026-11-15-blog-auto-indexing-design.md`

## Global Constraints

- Never throws; never fails the run. Every outcome string is `"ok"`, `"skipped: <reason>"` or `"failed: <reason>"` (reason ≤150c).
- Live check: poll `<siteUrl>/sitemap-0.xml` every 30s up to 10 min for a `<loc>` whose last non-empty path segment === slug; then that URL must `GET` 200.
- IndexNow: `POST https://api.indexnow.org/indexnow`, JSON `{ host, key, keyLocation: "<siteUrl>/<key>.txt", urlList: [url] }`; 200/202 = ok.
- Google: secret `GSC_SERVICE_ACCOUNT_JSON`; RS256 JWT, scope `https://www.googleapis.com/auth/webmasters`, token `https://oauth2.googleapis.com/token`; property = `sc-domain:<host>` or `<siteUrl>/` from `GET https://www.googleapis.com/webmasters/v3/sites`; `PUT …/sites/{enc(property)}/sitemaps/{enc(siteUrl + "/sitemap-index.xml")}`.
- Site constants: railsdev `https://railsdev.io` / `85dd4d96ba8c4f5ca1e8c7f26ddffb80`; fullstackweb `https://fullstackweb.dev` / `3eacbfaa1e224de7899cdbf42fac1c59`; inasoft `https://inasoft.id` / `3817864a76ab43dab819179b3d2f933f`.
- `DRY_RUN` unchanged. Branch `feat/blog-auto-indexing`, one PR.

## Review Focus

- Deploy slower than 10 min → `live:false`, both `skipped: not live after 10 min`; Slack still says published. Test: Task 1 Step 2 (short timeout).
- Slug is a substring of another slug (`foo` vs `foo-bar`) → must match the last path segment exactly, not `includes`. Test: Task 1 Step 2 (`matchSitemapLoc` unit check).
- Malformed `GSC_SERVICE_ACCOUNT_JSON` → `google: "failed: …"`, Bing still attempted.
- Service account not owner of the property → `skipped: service account not added to Search Console`.
- Network error/timeout on any fetch → per-step failed string; each fetch has `AbortSignal.timeout(20000)`.

---

### Task 1: `scripts/site-index.mjs`

**Files:** Create `scripts/site-index.mjs`, `scripts/site-index-selfcheck.mjs`; modify `package.json` (add `"index:selfcheck": "node scripts/site-index-selfcheck.mjs"`).

**Interfaces — Produces:**
- `export function matchSitemapLoc(xml: string, slug: string): string | null` — first `<loc>` whose last non-empty path segment === slug.
- `export async function indexArticle({ siteUrl, slug, indexNowKey, env, waitMs = 600000, pollMs = 30000 }) → Promise<{ url: string|null, live: boolean, bing: string, google: string }>`.
- Internal: `submitIndexNow(siteUrl, key, url)`, `submitGoogleSitemap(siteUrl, saJson)`, `googleAccessToken(sa)` (JWT via `crypto.createSign("RSA-SHA256")`, base64url header/claims `{iss: sa.client_email, scope, aud: token url, iat, exp: iat+3600}`).

- [ ] **Step 1: Write the self-check** `scripts/site-index-selfcheck.mjs` (node:assert):
  - `matchSitemapLoc('<loc>https://x.io/blog/foo-bar</loc><loc>https://x.io/blog/a/b/foo/</loc>', 'foo') === 'https://x.io/blog/a/b/foo/'`
  - `matchSitemapLoc(same, 'nope') === null`
  - `indexArticle({ siteUrl: "https://railsdev.io", slug: "no-such-slug-zz", indexNowKey: "k", env: {}, waitMs: 1000, pollMs: 500 })` → `live === false`, `bing` and `google` start with `"skipped: not live"`.
  - Live article, no creds, IndexNow disabled via `env.INDEXNOW_DRY = "1"` (helper returns `"skipped: INDEXNOW_DRY"` for bing): slug `rails-monitoring-uptime-kuma` on railsdev → `live === true`, `url === "https://railsdev.io/blog/rails-monitoring-uptime-kuma"`, `google === "skipped: no credentials"`.
  - `env.GSC_SERVICE_ACCOUNT_JSON = "{bad"` on the same live article → `google` starts with `"failed:"`.
- [ ] **Step 2: Run** `npm run index:selfcheck` → FAIL (module missing).
- [ ] **Step 3: Implement** `scripts/site-index.mjs` per Interfaces + Global Constraints. `INDEXNOW_DRY` is the only env switch (keeps selfcheck from pinging real engines).
- [ ] **Step 4: Run** `npm run index:selfcheck` → all assertions pass; then one real ping: `node -e` calling `indexArticle` for the railsdev article without `INDEXNOW_DRY` → `bing === "ok"`.
- [ ] **Step 5: Commit** `feat(index): add site-index helper (IndexNow + GSC sitemap)`.

### Task 2: Wire into writers, workflows, docs

**Files:** modify `scripts/{railsdev,fullstackweb,inasoft}-blog-writer.mjs` (import + call after merge + Slack line), `.github/workflows/{railsdev,fullstackweb,inasoft}-blog-writer.yml` (job `env:` add `GSC_SERVICE_ACCOUNT_JSON: ${{ secrets.GSC_SERVICE_ACCOUNT_JSON }}`), `docs/status.md` (secrets inventory + flow + owner setup), `AGENTS.md` (one line under Architecture: indexing helper).

**Interfaces — Consumes:** `indexArticle` from Task 1.

- [ ] **Step 1:** In each writer add `const SITE_URL = "<site>"; const INDEXNOW_KEY = "<key>";` near `SITE_DIR`. After `mergePr`: `const ix = m.merged ? await indexArticle({ siteUrl: SITE_URL, slug: article.slug, indexNowKey: INDEXNOW_KEY, env: process.env }) : null;` log it; merged Slack text gains `\n🔎 ${ix.url || "(not live)"} · Bing: ${ix.bing} · Google sitemap: ${ix.google}`.
- [ ] **Step 2: Verify** `for f in scripts/site-index.mjs scripts/*-blog-writer.mjs; do node --check $f; done && npm run typecheck && npm run index:selfcheck` → pass; `grep -c GSC_SERVICE_ACCOUNT_JSON .github/workflows/*blog-writer.yml` → 1 each.
- [ ] **Step 3: Commit** `feat(blog): index articles after auto-merge`.

### Task 3: Ship

- [ ] `git grep -n -E '^(<<<<<<< |>>>>>>> )' -- .` → empty; push; open PR (Summary / What changed / Verification / Out of scope / owner setup steps).
- [ ] After merge: `dry_run=true` dispatch ×3 → green. First live run shows the 🔎 line with `Bing: ok`.
