# Blog auto-indexing (Bing + Google) — design

**Date:** 2026-11-15 · **Size:** small change · **Why:** more SEO content gets found faster — each auto-merged article is announced to search engines as soon as it is live.

## Goals / non-goals
- Goal: after a blog writer's PR merges and the article is live, notify Bing (IndexNow) and Google (Search Console sitemap resubmit).
- Non-goal: articles merged by hand, non-blog pages, Google Indexing API (owner chose the within-the-rules route).
- Anti-goal: an indexing failure must never fail the run or hide that the article was published.

## Approaches
- **Inside the blog writers after merge (chosen)** — one helper, one secret set, result in the existing Slack note.
- Per-site-repo push workflow — rejected: 3 copies + 3 secret sets, still has to wait for the Cloudflare deploy.
- Worker cron sweeping sitemaps — rejected: new D1 table + JWT signing in the Worker for little gain.

## Design
- New `scripts/site-index.mjs`, zero-dep, never throws:
  `indexArticle({ siteUrl, slug, indexNowKey, env }) → { url, live, bing, google }` (each `"ok" | "skipped: …" | "failed: …"`).
  1. **Wait for live:** poll `<siteUrl>/sitemap-0.xml` every 30s, up to 10 min, until a `<loc>` whose last path segment is `slug` appears; then `GET` that URL must answer 200. That `<loc>` is the canonical URL (handles inasoft's category paths and per-site trailing slash). Not live in time → `live:false`, Bing/Google `skipped: not live after 10 min`.
  2. **Bing:** `POST https://api.indexnow.org/indexnow` `{ host, key, keyLocation: <siteUrl>/<key>.txt, urlList: [url] }`; 200/202 = ok.
  3. **Google:** if secret `GSC_SERVICE_ACCOUNT_JSON` is unset → `skipped: no credentials`. Else sign a service-account JWT with `node:crypto` (RS256, scope `https://www.googleapis.com/auth/webmasters`), exchange at `https://oauth2.googleapis.com/token`, list `webmasters/v3/sites` and pick the property matching the host (`sc-domain:<host>` or `<siteUrl>/`), then `PUT webmasters/v3/sites/{property}/sitemaps/{siteUrl}/sitemap-index.xml`. No matching property → `skipped: service account not added to Search Console`.
- Per-site constants in each writer: site URL + IndexNow key — railsdev `https://railsdev.io` / `85dd4d96ba8c4f5ca1e8c7f26ddffb80`; fullstackweb `https://fullstackweb.dev` / `3eacbfaa1e224de7899cdbf42fac1c59`; inasoft `https://inasoft.id` / `3817864a76ab43dab819179b3d2f933f` (keys are public files on each site).
- Writers call it only when `mergePr` returned `merged:true`; the published Slack note gains a line: `🔎 <url> · Bing: ok · Google sitemap: ok` (or the skip/fail reason). `DRY_RUN` unchanged.
- Workflows pass `GSC_SERVICE_ACCOUNT_JSON` from repo secrets. Job time: +≤10 min, inside the existing 30-min limit.

## Owner setup (one-time, outside code)
1. Google Cloud: create a service account, enable the Search Console API, download its JSON key.
2. Search Console: add the service account's email as **Owner** on each of the 3 properties.
3. `gh secret set GSC_SERVICE_ACCOUNT_JSON < key.json` in this repo.
Until done, Google reports `skipped: no credentials`; Bing works without setup.

## Verification
- Run the helper locally against an existing live article per site (Bing ok expected; Google skipped/ok depending on setup).
- Slug not in sitemap → `live:false` after the timeout (use a short timeout override in the check).
- `node --check`, `npm run typecheck`, `dry_run=true` dispatch per workflow; first live run shows the 🔎 line.
- Update `docs/status.md` (secrets inventory + flow).
