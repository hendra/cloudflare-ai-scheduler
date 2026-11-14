// After a blog article is merged: wait until it is live, then tell search engines.
//   Bing/Yandex — IndexNow ping with the article URL (key file is public on each site).
//   Google      — resubmit <site>/sitemap-index.xml via the Search Console API
//                 (service account in GSC_SERVICE_ACCOUNT_JSON, Owner or Full user in GSC).
// Never throws: the article is already published; every outcome is a short string
// ("ok" | "skipped: …" | "failed: …") for the Slack note.
// env.INDEXNOW_DRY=1 skips the IndexNow call (used by site-index-selfcheck.mjs).
//
// Manual re-run (e.g. the deploy took longer than the 10-min wait):
//   GSC_SERVICE_ACCOUNT_JSON="$(cat key.json)" node scripts/site-index.mjs <siteUrl> <slug> <indexNowKey>
import { createSign } from "node:crypto";
import { pathToFileURL } from "node:url";

const FETCH_TIMEOUT_MS = 20000;
const GSC_SCOPE = "https://www.googleapis.com/auth/webmasters";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const GSC_API = "https://www.googleapis.com/webmasters/v3";

const reason = (e) => String(e?.message || e).replace(/\s+/g, " ").slice(0, 150);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = (url, init = {}) => fetch(url, { redirect: "follow", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), ...init });
// Cache-buster so an edge-cached sitemap never hides a fresh deploy.
const fresh = (url) => `${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`;
const locsOf = (xml) => [...String(xml).matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);

// Google API errors carry the useful part (which permission is missing) in error.message.
async function apiError(label, res) {
  const body = await res.json().catch(() => ({}));
  const msg = body?.error?.message || body?.error_description || body?.error || "";
  return `${label} HTTP ${res.status}${msg ? ` ${String(msg).replace(/\s+/g, " ").slice(0, 100)}` : ""}`;
}

// First <loc> whose last non-empty path segment is exactly `slug` (not a substring match)
// and that is not in `knownLocs` — a page live before the merge (e.g. a pillar/category
// page sharing the slug) must never be mistaken for the new article.
export function matchSitemapLoc(xml, slug, knownLocs = new Set()) {
  for (const loc of locsOf(xml)) {
    if (knownLocs.has(loc)) continue;
    try {
      const segs = new URL(loc).pathname.split("/").filter(Boolean);
      if (segs[segs.length - 1] === slug) return loc;
    } catch { /* malformed loc */ }
  }
  return null;
}

// All page <loc>s across every sitemap listed in <site>/sitemap-index.xml (falls back to
// sitemap-0.xml if the index can't be read). Concatenated as one XML-ish string so
// matchSitemapLoc can scan it. Throws if no sitemap could be read.
async function readSitemaps(siteUrl) {
  let children = [`${siteUrl}/sitemap-0.xml`];
  try {
    const idx = await get(fresh(`${siteUrl}/sitemap-index.xml`));
    if (idx.ok) {
      const listed = locsOf(await idx.text()).filter((u) => u.endsWith(".xml"));
      if (listed.length) children = listed;
    } else await idx.body?.cancel();
  } catch { /* use the fallback */ }
  const parts = [];
  for (const url of children) {
    const res = await get(fresh(url));
    if (!res.ok) { await res.body?.cancel(); throw new Error(`${url} HTTP ${res.status}`); }
    parts.push(await res.text());
  }
  return parts.join("\n");
}

// Locs in the live sitemaps right now. Call BEFORE merging and pass the result to
// indexArticle as knownLocs. Never throws; empty set if the sitemaps can't be read.
export async function sitemapLocs(siteUrl) {
  try { return new Set(locsOf(await readSitemaps(siteUrl))); } catch { return new Set(); }
}

async function waitForLive(siteUrl, slug, knownLocs, waitMs, pollMs) {
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      const url = matchSitemapLoc(await readSitemaps(siteUrl), slug, knownLocs);
      if (url) {
        const res = await get(url);
        await res.body?.cancel();
        if (res.status === 200) return url;
      }
    } catch { /* deploy in progress / transient network error: keep polling */ }
    if (Date.now() + pollMs > deadline) return null;
    await sleep(pollMs);
  }
}

async function submitIndexNow(siteUrl, key, url) {
  const res = await get("https://api.indexnow.org/indexnow", {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ host: new URL(siteUrl).host, key, keyLocation: `${siteUrl}/${key}.txt`, urlList: [url] }),
  });
  const text = await res.text().catch(() => "");
  if (res.status === 200 || res.status === 202) return "ok";
  return `failed: IndexNow HTTP ${res.status} ${text.replace(/\s+/g, " ").slice(0, 80)}`.trim();
}

async function googleAccessToken(sa) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const iat = Math.floor(Date.now() / 1000);
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ iss: sa.client_email, scope: GSC_SCOPE, aud: TOKEN_URL, iat, exp: iat + 3600 })}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(sa.private_key, "base64url");
  const res = await get(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${signature}` }),
  });
  if (!res.ok) throw new Error(await apiError("token", res));
  const body = await res.json().catch(() => ({}));
  if (!body.access_token) throw new Error("token response lacks access_token");
  return body.access_token;
}

async function submitGoogleSitemap(siteUrl, saJson) {
  const sa = JSON.parse(saJson);
  if (!sa.client_email || !sa.private_key) throw new Error("service account JSON lacks client_email/private_key");
  const auth = { authorization: `Bearer ${await googleAccessToken(sa)}` };
  const list = await get(`${GSC_API}/sites`, { headers: auth });
  if (!list.ok) return `failed: ${await apiError("sites.list", list)}`;
  const host = new URL(siteUrl).host;
  const wanted = new Set([`sc-domain:${host}`, `${siteUrl}/`]);
  const entries = ((await list.json()).siteEntry || []).filter((s) => wanted.has(s.siteUrl) && s.permissionLevel !== "siteUnverifiedUser");
  const entry = entries.find((s) => s.permissionLevel !== "siteRestrictedUser");
  if (!entry) {
    return entries.length
      ? "skipped: service account has Restricted access in Search Console — make it Owner or Full user"
      : "skipped: service account not added to Search Console";
  }
  const res = await get(`${GSC_API}/sites/${encodeURIComponent(entry.siteUrl)}/sitemaps/${encodeURIComponent(`${siteUrl}/sitemap-index.xml`)}`, { method: "PUT", headers: auth });
  if (res.ok) { await res.body?.cancel(); return "ok"; }
  return `failed: ${await apiError("sitemaps.submit", res)}`;
}

export async function indexArticle({ siteUrl, slug, indexNowKey, env, knownLocs = new Set(), waitMs = 600000, pollMs = 30000 }) {
  const url = await waitForLive(siteUrl, slug, knownLocs, waitMs, pollMs);
  if (!url) {
    const s = `skipped: not live after ${Math.round(waitMs / 60000) || "<1"} min`;
    return { url: null, live: false, bing: s, google: s };
  }
  let bing;
  if (env.INDEXNOW_DRY === "1") bing = "skipped: INDEXNOW_DRY";
  else { try { bing = await submitIndexNow(siteUrl, indexNowKey, url); } catch (e) { bing = `failed: ${reason(e)}`; } }
  let google;
  if (!env.GSC_SERVICE_ACCOUNT_JSON) google = "skipped: no credentials";
  else { try { google = await submitGoogleSitemap(siteUrl, env.GSC_SERVICE_ACCOUNT_JSON); } catch (e) { google = `failed: ${reason(e)}`; } }
  return { url, live: true, bing, google };
}

// CLI: manual re-run for an article that is already live (no wait beyond one check).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [siteUrl, slug, indexNowKey] = process.argv.slice(2);
  if (!siteUrl || !slug || !indexNowKey) {
    console.error("usage: node scripts/site-index.mjs <siteUrl> <slug> <indexNowKey>");
    process.exit(2);
  }
  console.log(JSON.stringify(await indexArticle({ siteUrl: siteUrl.replace(/\/$/, ""), slug, indexNowKey, env: process.env, waitMs: 1, pollMs: 1 })));
}
